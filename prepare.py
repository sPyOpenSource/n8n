"""
Byte-level data preparation for TinyStories nanoGPT experiments.
No tokenizer — raw UTF-8 bytes are used directly as model input.
"""

import argparse
import math
import os
import time
from multiprocessing import Pool

import mlx.core as mx
import numpy as np
import pyarrow.parquet as pq
import requests

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
BASE_URL = "https://huggingface.co/datasets/roneneldan/TinyStories/resolve/main/data"
TRAIN_SHARDS = [
    "train-00000-of-00004-2d5a1467fff1081b.parquet",
    "train-00001-of-00004-5852b56a2bd28fd9.parquet",
    "train-00002-of-00004-a26307300439e943.parquet",
    "train-00003-of-00004-d243063613e5a057.parquet",
]
VAL_SHARD = "validation-00000-of-00001-869c898b519ad725.parquet"
VOCAB_SIZE = 256  # one token per raw UTF-8 byte


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


def text_to_bytes(text):
    """Convert a text string to a list of UTF-8 byte values (0-255)."""
    return list(text.encode("utf-8"))


def _document_batches(split, batch_size=128):
    """Infinite iterator over document batches as lists of byte lists."""
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
                byte_batch = [text_to_bytes(doc) for doc in batch]
                for i in range(0, len(byte_batch), batch_size):
                    yield byte_batch[i:i + batch_size], epoch
        epoch += 1


def make_dataloader(batch_size, seq_len, split, buffer_size=1000):
    """
    Byte-level dataloader with best-fit packing.
    Every row starts fresh. Documents packed using best-fit to minimize cropping.
    100% utilization (no padding).
    """
    assert split in ["train", "val"]
    row_capacity = seq_len + 1
    batches = _document_batches(split)
    doc_buffer = []
    epoch = 1

    def refill_buffer():
        nonlocal epoch
        doc_batch, epoch = next(batches)
        doc_buffer.extend(doc_batch)

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


def evaluate_bpb(model, batch_size):
    """
    Bits per byte at byte level. Every target token IS a byte (0-255),
    so byte length is 1 per token. No token_bytes lookup needed.
    """
    val_loader = make_dataloader(batch_size, MAX_SEQ_LEN, "val")
    steps = EVAL_TOKENS // (batch_size * MAX_SEQ_LEN)
    total_nats = 0.0
    total_bytes = 0

    for _ in range(steps):
        x, y, _ = next(val_loader)
        loss_flat = model(x, y, reduction="none").reshape(-1)
        y_flat = y.reshape(-1)
        mask = y_flat != -1
        total_nats += mx.sum(loss_flat * mask).item()
        total_bytes += int(mx.sum(mask).item())

    if total_bytes == 0:
        return float("inf")
    return total_nats / (math.log(2) * total_bytes)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Prepare TinyStories data (byte-level, no tokenizer)")
    parser.add_argument(
        "--download-workers", type=int, default=8, help="Number of parallel download workers"
    )
    args = parser.parse_args()

    print(f"Cache directory: {CACHE_DIR}")
    print()
    download_data(download_workers=args.download_workers)
    print()
    print("Done! Byte-level data ready. No tokenizer needed.")
