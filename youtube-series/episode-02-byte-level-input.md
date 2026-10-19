# Episode 2 — I Removed the Tokenizer: Byte-Level Language Models on a Mac

**Series:** Autoresearch on Apple Silicon · Ep. 2 of 3
**Target length:** ~10 min
**Source material:** `lessons/0002-byte-level-input.html`, `prepare.py`, `train.py`

---

## Meta

- **Primary keyword:** byte level language model
- **Secondary:** tokenizer free LLM, MLX Apple Silicon, bits per byte
- **Promise:** "I deleted the entire tokenizer from my pipeline. Here's what broke,
  what got faster, and the one number that tells you if it was worth it."
- **End CTA:** subscribe + "Episode 3: Bits Per Byte."

## Thumbnail

- **Big text:** "No tokenizer. 2.4× faster."
- **Visual:** a tokenizer file with a red X over it next to a speedometer; terminal
  showing VRAM 2.0 GB.
- **Color:** dark bg, orange accent.

## Title Options

1. *I Removed the Tokenizer From My Language Model (Byte-Level on a Mac)* ← recommended
2. *Byte-Level Language Models: No Tokenizer, 2× Faster, Half the Memory*
3. *Why I Stopped Using BPE (and Fed My Model Raw Bytes)*

## Chapters

```
0:00  The deleted tokenizer
0:45  What a tokenizer actually costs you
2:00  Byte-level in 60 seconds
3:30  The code diff (prepare.py + train.py)
5:00  The experiment: BPE vs byte-level
6:30  Results table
7:30  The catch (higher bpb)
8:30  When byte-level wins
9:30  What's next
```

---

## Script

### [0:00] COLD OPEN

**VISUAL:** Screen recording of a git diff. Lines in red:

```
- from tokenizer import Tokenizer
- tokenizer = Tokenizer.load(...)
- make_dataloader(batch_size, MAX_SEQ_LEN, "train", tokenizer)
```

Lines in green:

```
+ make_dataloader(batch_size, MAX_SEQ_LEN, "train")
+ vocab_size = 256
```

**NARRATION:**
> I deleted the tokenizer. The whole thing — the trained vocabulary, the encode/decode
> calls, the saved `.json` file. My language model now reads raw bytes. And it got
> 2.4 times faster and used half the memory. There's a catch, and I'll show you
> the number that decides whether the catch is worth it.

### [0:45] WHAT A TOKENIZER COSTS

**VISUAL:** Diagram: text → BPE tokenizer → token IDs → model. Then the same with
byte-level: text → bytes → model.

**NARRATION:**
> Most LLMs use BPE — byte-pair encoding. You train a vocabulary of subword units,
> say 4,096 of them, save it, load it at inference, encode every input. That's
> three costs: training the tokenizer, shipping it, and the complexity in your
> pipeline. In `prepare.py` that meant `rustbpe`, `tiktoken`, a `Tokenizer` class,
> and `train_tokenizer()`. In `train.py`, an import and an instantiation. Every
> place the tokenizer touched was a place something could break.

### [2:00] BYTE-LEVEL IN 60 SECONDS

**VISUAL:** The lesson's demo: `"Cat"` → UTF-8 bytes → `[67, 97, 116]` → token IDs.

**NARRATION:**
> Byte-level means: no tokenization at all. Take the raw UTF-8 bytes of the text
> and feed them straight to the model. `"Cat"` becomes `[67, 97, 116]` — three
> tokens, one per byte. The embedding layer maps each byte value 0–255 to a vector,
> exactly like it would map a BPE token ID. Everything else — attention, MLP, the
> LM head — is unchanged. It just sees more, smaller tokens. Vocab is fixed at
> 256. No training, no saving, no loading. Universal: any UTF-8 text works,
> including emoji and other scripts.

### [3:30] THE CODE DIFF

**VISUAL:** Side-by-side `prepare.py` before/after and `train.py` before/after.

**NARRATION:**
> Here's what changed. In `prepare.py`: remove `rustbpe`, `tiktoken`, the
> `Tokenizer` class, and `train_tokenizer()`. Replace with `text.encode("utf-8")`
> → list of ints. `make_dataloader` drops its tokenizer argument. In `train.py`:
> `vocab_size = 256`, remove the `Tokenizer` import and instantiation,
> `make_dataloader(batch_size, MAX_SEQ_LEN, "train")` with no tokenizer arg, and
> `evaluate_bpb(model, batch_size)` with no tokenizer needed — because every
> target byte has length one. The pipeline got shorter and simpler.

### [5:00] THE EXPERIMENT

**VISUAL:** Terminal running two experiments back to back, or a results table
being filled in.

**NARRATION:**
> Same hardware, same five-minute budget, same data. Only the input representation
> changes. BPE: vocab 4,096, trained tokenizer. Byte-level: vocab 256, no tokenizer.
> Let's run both and read the numbers.

### [6:30] RESULTS

**VISUAL:** The lesson's comparison table, revealed row by row.

| Setup | val_bpb | Steps (5 min) | tok/sec | VRAM |
|---|---|---|---|---|
| BPE (vocab=4,096) | 1.592583 | 83 | ~9,600 | 3.8 GB |
| Byte-level (vocab=256) | 1.922753 | 203 | ~22,000 | 2.0 GB |

**NARRATION:**
> Byte-level fits 2.4 times more steps into the same budget, pushes ~22,000
> tokens per second instead of 9,600, and uses 2.0 GB of VRAM instead of 3.8 —
> 47% less. That's the win: on memory-constrained Apple Silicon, smaller
> embedding tables and shorter per-step work compound into way more training.

### [7:30] THE CATCH

**VISUAL:** Highlight `val_bpb`: 1.59 → 1.92. Then the perplexity-per-byte
conversion: 2^1.59 ≈ 3.0, 2^1.92 ≈ 3.8.

**NARRATION:**
> The catch: val_bpb goes from 1.59 to 1.92. Higher is worse — the byte-level
> model is more surprised by the data. In "perplexity per byte" terms, BPE is
> choosing among ~3 bytes at each position; byte-level among ~4. Why? Because
> byte-level has to learn word structure from scratch — where words start and end,
> which bytes cluster into words — while BPE hands it pre-defined subword units.
> You're trading quality for efficiency.

### [8:30] WHEN BYTE-LEVEL WINS

**VISUAL:** Decision box.

**NARRATION:**
> So when is it worth it? On small models on memory-constrained hardware — which
> is exactly what autoresearch on a Mac is. The embedding table for 256 tokens is
> tiny versus 4,096. Less memory means bigger batches or longer context. More
> steps per minute means faster iteration in the autoresearch loop. And you
> removed a whole class of bugs — no tokenizer version mismatches, no OOV tokens,
> no "why did this string encode differently." For tiny models, byte-level is
> often the better trade-off. But you can't just *say* that — you need to compare
> the two fairly. Raw perplexity won't work, because the units differ: one BPE
> token can be one byte or several. That's episode 3.

### [9:30] WRAP-UP

**VISUAL:** End card: next episode teaser + subscribe.

**NARRATION:**
> Two levers pulled: faster data, simpler input. Next: the metric that lets you
> compare them honestly — bits per byte. Subscribe.

---

## Description

```
I deleted the tokenizer from my language model pipeline. Result: 2.4× more
training steps, 47% less VRAM, but a higher val_bpb. Here's the full trade-off.

Episode 2 of "Autoresearch on Apple Silicon."

In this episode:
• What BPE tokenization actually costs (train, ship, complexity)
• Byte-level input: raw UTF-8 bytes as tokens, vocab fixed at 256
• The exact prepare.py + train.py diff
• Experiment: BPE vs byte-level, same budget, same hardware
• Results: 203 vs 83 steps, 2.0 vs 3.8 GB, 1.92 vs 1.59 bpb
• When byte-level wins on Apple Silicon

Code: https://github.com/<you>/autoresearch-mlx
  → prepare.py, train.py, lessons/0002-byte-level-input.html

Chapters:
0:00 The deleted tokenizer
0:45 Tokenizer costs
2:00 Byte-level in 60 seconds
3:30 Code diff
5:00 The experiment
6:30 Results
7:30 The catch
8:30 When byte-level wins
9:30 What's next

#bytellm #tokenizer #mlx #applesilicon #machinelearning #python
```

## Tags

`byte level language model, no tokenizer, tokenizer free LLM, BPE vs byte level, MLX, Apple Silicon, on device machine learning, nanoGPT, autoresearch, python, val_bpb, training speed, VRAM`
"""