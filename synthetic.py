"""
Synthetic TinyStories via Ollama - single massive generation.
"""

import os
import random
import time

import pyarrow as pa
import pyarrow.parquet as pq
import requests

from prepare import DATA_DIR

OLLAMA_URL = "http://localhost:11434/api/generate"
MODEL = "llama3.2:1b"
NUM_SYNTHETIC = 10000
STORIES_PER_CALL = 100

PROMPT = """Write {n} very short children's stories. Each story must be exactly 2-3 sentences. Use very simple words for ages 3-5. Separate each story with "---". Only output the stories, nothing else.

Stories:"""


def call_ollama(prompt, timeout=300):
    try:
        resp = requests.post(
            OLLAMA_URL,
            json={
                "model": MODEL,
                "prompt": prompt,
                "stream": False,
                "options": {"num_predict": 16384, "temperature": 0.9},
            },
            timeout=timeout,
        )
        resp.raise_for_status()
        return resp.json()["response"].strip()
    except Exception as e:
        return None


def passes_filter(story):
    if len(story) < 30 or len(story) > 600:
        return False
    words = story.lower().split()
    if len(words) < 6:
        return False
    if "." not in story:
        return False
    unique_ratio = len(set(story.lower())) / max(len(story), 1)
    if unique_ratio < 0.05:
        return False
    return True


def extract_stories(text):
    parts = text.split("---")
    stories = []
    for p in parts:
        p = p.strip()
        for ch in ["*", '"', "**"]:
            p = p.replace(ch, "").strip()
        if p and passes_filter(p):
            stories.append(p)
    return stories


def main():
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--num", type=int, default=NUM_SYNTHETIC)
    args = parser.parse_args()

    if not os.path.exists(DATA_DIR):
        print("Data directory not found.")
        return

    print(f"Generating {args.num} synthetic stories ({STORIES_PER_CALL} per call)...")

    kept = []
    t0 = time.time()
    call_num = 0

    while len(kept) < args.num:
        call_num += 1
        prompt = PROMPT.format(n=STORIES_PER_CALL)
        print(f"  Call {call_num}... ", end="", flush=True)
        result = call_ollama(prompt)
        if result:
            stories = extract_stories(result)
            kept.extend(stories)
            print(f"got {len(stories)} stories (total: {len(kept)})")
        else:
            print("failed")
            time.sleep(5)
            continue

        if call_num % 3 == 0:
            elapsed = time.time() - t0
            rate = len(kept) / (elapsed / 60)
            remaining = (args.num - len(kept)) / rate if rate > 0 else 0
            print(f"    Rate: {rate:.0f}/min, ETA: {remaining:.0f} min")

    t1 = time.time()
    kept = kept[:args.num]
    print(f"\nDone in {t1 - t0:.1f}s. Kept {len(kept)} stories.")

    if not kept:
        print("No stories generated.")
        return

    random.shuffle(kept)
    table = pa.table({"text": pa.array(kept, type=pa.string())})
    out_path = os.path.join(DATA_DIR, "synthetic-00000-of-00001.parquet")
    pq.write_table(table, out_path)
    print(f"Wrote to {out_path}")


if __name__ == "__main__":
    main()
