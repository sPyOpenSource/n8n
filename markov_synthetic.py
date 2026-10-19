"""
Generate synthetic TinyStories using a word-level Markov model.
Output: parquet shard(s) in ~/.cache/autoresearch/data/ — automatically mixed into training by make_dataloader.
"""

import os
import random
import time
from collections import defaultdict, Counter

import pyarrow as pa
import pyarrow.parquet as pq

from prepare import DATA_DIR, VAL_SHARD, list_parquet_files

NUM_SYNTHETIC = 5000
MARKOV_N = 3
MAX_STORY_WORDS = 80
SEED_STORIES = 5000


def tokenize(text):
    return text.split()


def load_real_stories(n):
    """Load up to n real TinyStories from parquet shards."""
    parquet_paths = [p for p in list_parquet_files() if not p.endswith(VAL_SHARD)]
    random.shuffle(parquet_paths)
    stories = []
    for filepath in parquet_paths:
        pf = pq.ParquetFile(filepath)
        for rg_idx in range(pf.num_row_groups):
            rg = pf.read_row_group(rg_idx)
            for text in rg.column("text").to_pylist():
                stories.append(text)
                if len(stories) >= n:
                    return stories
    return stories


class WordMarkov:
    def __init__(self, n=3):
        self.n = n
        self.model = defaultdict(Counter)

    def train(self, corpus):
        for tokens in corpus:
            ctx = tuple(["<BOS>"] * (self.n - 1))
            for word in tokens + ["<EOS>"]:
                self.model[ctx][word] += 1
                ctx = ctx[1:] + (word,)

    def generate(self, max_len=80):
        ctx = tuple(["<BOS>"] * (self.n - 1))
        out = []
        for _ in range(max_len):
            counts = self.model.get(ctx)
            if not counts:
                break
            words, weights = zip(*counts.items())
            word = random.choices(words, weights=weights, k=1)[0]
            if word == "<EOS>":
                break
            out.append(word)
            ctx = ctx[1:] + (word,)
        return " ".join(out)


def passes_filter(story):
    if len(story) < 20 or len(story) > 400:
        return False
    words = story.lower().split()
    if len(words) < 5:
        return False
    if "." not in story:
        return False
    return True


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Generate synthetic TinyStories via Markov model")
    parser.add_argument("--num", type=int, default=NUM_SYNTHETIC, help="Target synthetic stories")
    parser.add_argument("--n", type=int, default=MARKOV_N, help="Markov model order (n-gram)")
    parser.add_argument("--seed", type=int, default=SEED_STORIES, help="Real stories to train Markov on")
    args = parser.parse_args()

    if not os.path.exists(DATA_DIR):
        print("Data directory not found. Run `uv run prepare.py` first.")
        return

    print(f"Loading {args.seed} real stories to train Markov model...")
    stories = load_real_stories(args.seed)
    print(f"Loaded {len(stories)} stories")

    print(f"Training {args.n}-gram Markov model...")
    corpus = [tokenize(s) for s in stories]
    model = WordMarkov(n=args.n)
    model.train(corpus)
    print(f"Model has {len(model.model)} contexts")

    print(f"Generating {args.num} synthetic stories...")
    random.seed(42)
    kept = []
    t0 = time.time()
    while len(kept) < args.num:
        story = model.generate(max_len=MAX_STORY_WORDS)
        if passes_filter(story):
            kept.append(story)
        if len(kept) % 500 == 0:
            elapsed = time.time() - t0
            rate = len(kept) / (elapsed / 60) if elapsed > 0 else 0
            print(f"\r  Kept {len(kept)}/{args.num} ({rate:.0f} stories/min)", end="", flush=True)

    t1 = time.time()
    kept = kept[: args.num]
    print(f"\nDone in {t1 - t0:.1f}s. Kept {len(kept)} stories.")

    if not kept:
        print("No stories passed filters.")
        return

    random.shuffle(kept)
    table = pa.table({"text": pa.array(kept, type=pa.string())})
    out_path = os.path.join(DATA_DIR, "markov_synthetic-00000-of-00001.parquet")
    pq.write_table(table, out_path)
    print(f"Wrote {len(kept)} synthetic stories to {out_path}")


if __name__ == "__main__":
    main()
