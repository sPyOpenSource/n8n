"""
One-time data preparation for TinyStories nanoGPT experiments.
Downloads TinyStories parquet shards and trains BPE tokenizer.
"""

import argparse
import math
import os
import pickle
import sys
import time
from multiprocessing import Pool

import mlx.core as mx
import numpy as np
import pyarrow.parquet as pq
import requests
import rustbpe
import tiktoken

# ---------------------------------------------------------------------------
# Constants (fixed, do not modify)
# ---------------------------------------------------------------------------

MAX_SEQ_LEN = 512
TIME_BUDGET = 300
EVAL_TOKENS = 3 * 131072

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

CACHE_DIR = os.path.join(os.path.expanduser("~"), ".cache", "autoresearch")
DATA_DIR = os.path.join(CACHE_DIR, "data")
TOKENIZER_DIR = os.path.join(CACHE_DIR, "tokenizer")
BASE_URL = "https://huggingface.co/datasets/roneneldan/TinyStories/resolve/main/data"
TRAIN_SHARDS = [
    "train-00000-of-00004-2d5a1467fff1081b.parquet",
    "train-00001-of-00004-5852b56a2bd28fd9.parquet",
    "train-00002-of-00004-a26307300439e943.parquet",
    "train-00003-of-00004-d243063613e5a057.parquet",
]
VAL_SHARD = "validation-00000-of-00001-869c898b519ad725.parquet"
VOCAB_SIZE = 4096

SPLIT_PATTERN = r"""'(?i:[sdmt]|ll|ve|re)|[^\r\n\p{L}\p{N}]?+\p{L}+|\p{N}{1,2}| ?[^\s\p{L}\p{N}]++[\r\n]*|\s*[\r\n]|\s+(?!\S)|\s+"""

SPECIAL_TOKENS = [f"<|reserved_{i}|>" for i in range(4)]
BOS_TOKEN = "<|reserved_0|>"


def download_single_shard(filename):
    filepath = os.path.join(DATA_DIR, filename)
    if os.path.exists(filepath):
        return True

    url = f"{BASE_URL}/{filename}"
    max_attempts = 5
    for attempt in range(1, max_attempts + 1):
        try:
            response = requests.get(url, stream=True, timeout=30)
            response.raise_for_status()
            temp_path = filepath + ".tmp"
            with open(temp_path, "wb") as handle:
                for chunk in response.iter_content(chunk_size=1024 * 1024):
                    if chunk:
                        handle.write(chunk)
            os.rename(temp_path, filepath)
            print(f"  Downloaded {filename}")
            return True
        except (requests.RequestException, IOError) as exc:
            print(f"  Attempt {attempt}/{max_attempts} failed for {filename}: {exc}")
            for path in [filepath + ".tmp", filepath]:
                if os.path.exists(path):
                    try:
                        os.remove(path)
                    except OSError:
                        pass
            if attempt < max_attempts:
                time.sleep(2**attempt)
    return False


def download_data(download_workers=8):
    os.makedirs(DATA_DIR, exist_ok=True)
    all_shards = TRAIN_SHARDS + [VAL_SHARD]

    existing = sum(
        1 for name in all_shards if os.path.exists(os.path.join(DATA_DIR, name))
    )
    if existing == len(all_shards):
        print(f"Data: all {len(all_shards)} shards already downloaded at {DATA_DIR}")
        return

    needed = len(all_shards) - existing
    print(f"Data: downloading {needed} shards ({existing} already exist)...")

    workers = max(1, min(download_workers, needed))
    with Pool(processes=workers) as pool:
        results = pool.map(download_single_shard, all_shards)

    ok = sum(1 for result in results if result)
    print(f"Data: {ok}/{len(all_shards)} shards ready at {DATA_DIR}")


def list_parquet_files():
    files = sorted(
        name for name in os.listdir(DATA_DIR)
        if name.endswith(".parquet") and not name.endswith(".tmp")
    )
    return [os.path.join(DATA_DIR, name) for name in files]


def text_iterator(max_chars=200_000_000, doc_cap=2000):
    parquet_paths = [
        path for path in list_parquet_files() if not path.endswith(VAL_SHARD)
    ]
    nchars = 0
    for filepath in parquet_paths:
        parquet_file = pq.ParquetFile(filepath)
        for rg_idx in range(parquet_file.num_row_groups):
            row_group = parquet_file.read_row_group(rg_idx)
            for text in row_group.column("text").to_pylist():
                doc = text[:doc_cap] if len(text) > doc_cap else text
                nchars += len(doc)
                yield doc
                if nchars >= max_chars:
                    return


def train_tokenizer():
    tokenizer_pkl = os.path.join(TOKENIZER_DIR, "tokenizer.pkl")
    token_bytes_path = os.path.join(TOKENIZER_DIR, "token_bytes.npy")

    if os.path.exists(tokenizer_pkl) and os.path.exists(token_bytes_path):
        print(f"Tokenizer: already trained at {TOKENIZER_DIR}")
        return

    os.makedirs(TOKENIZER_DIR, exist_ok=True)

    parquet_files = list_parquet_files()
    if len(parquet_files) < 2:
        print("Tokenizer: need at least 2 data shards (1 train + 1 val). Download more data first.")
        sys.exit(1)

    print("Tokenizer: training BPE tokenizer on TinyStories...")
    t0 = time.time()

    tokenizer = rustbpe.Tokenizer()
    vocab_size_no_special = VOCAB_SIZE - len(SPECIAL_TOKENS)
    tokenizer.train_from_iterator(text_iterator(), vocab_size_no_special, pattern=SPLIT_PATTERN)

    pattern = tokenizer.get_pattern()
    mergeable_ranks = {bytes(key): value for key, value in tokenizer.get_mergeable_ranks()}
    tokens_offset = len(mergeable_ranks)
    special_tokens = {name: tokens_offset + i for i, name in enumerate(SPECIAL_TOKENS)}
    enc = tiktoken.Encoding(
        name="rustbpe",
        pat_str=pattern,
        mergeable_ranks=mergeable_ranks,
        special_tokens=special_tokens,
    )

    with open(tokenizer_pkl, "wb") as handle:
        pickle.dump(enc, handle)

    t1 = time.time()
    print(f"Tokenizer: trained in {t1 - t0:.1f}s, saved to {tokenizer_pkl}")

    print("Tokenizer: building token_bytes lookup...")
    special_set = set(SPECIAL_TOKENS)
    token_bytes_list = []
    for token_id in range(enc.n_vocab):
        token_str = enc.decode([token_id])
        if token_str in special_set:
            token_bytes_list.append(0)
        else:
            token_bytes_list.append(len(token_str.encode("utf-8")))
    token_bytes = np.array(token_bytes_list, dtype=np.int32)
    np.save(token_bytes_path, token_bytes)
    print(f"Tokenizer: saved token_bytes to {token_bytes_path}")

    test = "Once upon a time there was a little girl named Lily."
    encoded = enc.encode_ordinary(test)
    decoded = enc.decode(encoded)
    assert decoded == test, f"Tokenizer roundtrip failed: {test!r} -> {decoded!r}"
    print(f"Tokenizer: sanity check passed (vocab_size={enc.n_vocab})")


class Tokenizer:
    def __init__(self, enc):
        self.enc = enc
        self.bos_token_id = enc.encode_single_token(BOS_TOKEN)

    @classmethod
    def from_directory(cls, tokenizer_dir=TOKENIZER_DIR):
        with open(os.path.join(tokenizer_dir, "tokenizer.pkl"), "rb") as handle:
            enc = pickle.load(handle)
        return cls(enc)

    def get_vocab_size(self):
        return self.enc.n_vocab

    def get_bos_token_id(self):
        return self.bos_token_id

    def encode(self, text, prepend=None, num_threads=8):
        if prepend is not None:
            prepend_id = prepend if isinstance(prepend, int) else self.enc.encode_single_token(prepend)
        if isinstance(text, str):
            ids = self.enc.encode_ordinary(text)
            if prepend is not None:
                ids.insert(0, prepend_id)
        elif isinstance(text, list):
            ids = self.enc.encode_ordinary_batch(text, num_threads=num_threads)
            if prepend is not None:
                for row in ids:
                    row.insert(0, prepend_id)
        else:
            raise ValueError(f"Invalid input type: {type(text)}")
        return ids

    def decode(self, ids):
        return self.enc.decode(ids)


def get_token_bytes():
    path = os.path.join(TOKENIZER_DIR, "token_bytes.npy")
    if not os.path.exists(path):
        raise FileNotFoundError(f"Missing token_bytes lookup at {path}. Run prepare.py first.")
    token_bytes = np.load(path)
    return mx.array(token_bytes, dtype=mx.int32)


def _document_batches(split, tokenizer_batch_size=128):
    parquet_paths = list_parquet_files()
    assert len(parquet_paths) > 0, "No parquet files found. Run prepare.py first."
    if split == "train":
        parquet_paths = [path for path in parquet_paths if not path.endswith(VAL_SHARD)]
    else:
        parquet_paths = [path for path in parquet_paths if path.endswith(VAL_SHARD)]
    epoch = 1
    while True:
        for filepath in parquet_paths:
            parquet_file = pq.ParquetFile(filepath)
            for rg_idx in range(parquet_file.num_row_groups):
                row_group = parquet_file.read_row_group(rg_idx)
                batch = row_group.column("text").to_pylist()
                for i in range(0, len(batch), tokenizer_batch_size):
                    yield batch[i:i + tokenizer_batch_size], epoch
        epoch += 1


def make_dataloader(tokenizer, batch_size, seq_len, split, buffer_size=1000):
    assert split in ["train", "val"]
    row_capacity = seq_len + 1
    batches = _document_batches(split)
    bos_token = tokenizer.get_bos_token_id()
    doc_buffer = []
    epoch = 1

    def refill_buffer():
        nonlocal epoch
        doc_batch, epoch = next(batches)
        token_lists = tokenizer.encode(doc_batch, prepend=bos_token)
        doc_buffer.extend(token_lists)

    while True:
        all_rows = []
        for _ in range(batch_size):
            row = []
            pos = 0
            while pos < row_capacity:
                while len(doc_buffer) < buffer_size:
                    refill_buffer()

                remaining = row_capacity - pos
                best_idx = -1
                best_len = 0
                for index, doc in enumerate(doc_buffer):
                    doc_len = len(doc)
                    if doc_len <= remaining and doc_len > best_len:
                        best_idx = index
                        best_len = doc_len

                if best_idx >= 0:
                    doc = doc_buffer.pop(best_idx)
                    row.extend(doc)
                    pos += len(doc)
                else:
                    shortest_idx = min(
                        range(len(doc_buffer)),
                        key=lambda index: len(doc_buffer[index]),
                    )
                    doc = doc_buffer.pop(shortest_idx)
                    row.extend(doc[:remaining])
                    pos += remaining

            all_rows.append(row[:row_capacity])

        row_array = mx.array(all_rows, dtype=mx.int32)
        inputs = row_array[:, :-1]
        targets = row_array[:, 1:]
        yield inputs, targets, epoch


def evaluate_bpb(model, tokenizer, batch_size):
    token_bytes = get_token_bytes()
    val_loader = make_dataloader(tokenizer, batch_size, MAX_SEQ_LEN, "val")
    steps = EVAL_TOKENS // (batch_size * MAX_SEQ_LEN)
    total_nats = 0.0
    total_bytes = 0

    for _ in range(steps):
        x, y, _ = next(val_loader)
        loss_flat = model(x, y, reduction="none").reshape(-1)
        y_flat = y.reshape(-1)
        nbytes = mx.take(token_bytes, y_flat, axis=0)
        mask = nbytes > 0
        total_nats += mx.sum(loss_flat * mask).item()
        total_bytes += int(mx.sum(nbytes).item())

    if total_bytes == 0:
        return float("inf")
    return total_nats / (math.log(2) * total_bytes)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Prepare TinyStories data and tokenizer")
    parser.add_argument(
        "--download-workers", type=int, default=8, help="Number of parallel download workers"
    )
    args = parser.parse_args()

    print(f"Cache directory: {CACHE_DIR}")
    print()
    download_data(download_workers=args.download_workers)
    print()
    train_tokenizer()
    print()
    print("Done! Ready to train nanoGPT on TinyStories.")
