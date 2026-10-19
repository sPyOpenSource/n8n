# Episode 3 — Bits Per Byte: How to Fairly Compare Any Two Language Models

**Series:** Autoresearch on Apple Silicon · Ep. 3 of 3
**Target length:** ~9 min
**Source material:** `lessons/0003-bits-per-byte.html`, `prepare.py` (evaluate_bpb)

---

## Meta

- **Primary keyword:** bits per byte bpb
- **Secondary:** compare language models, perplexity vs bpb, evaluate LLM
- **Promise:** "After this video you'll be able to take any two language models —
  different tokenizers, different sizes — and compare them honestly with one number."
- **End CTA:** subscribe + "what should I build next?" (community prompt).

## Thumbnail

- **Big text:** "bpb = ?" with "1.59 vs 1.92" underneath.
- **Visual:** two model cards (BPE, Byte) with a balance scale between them;
  formula `bpb = loss / ln(2)` overlaid.
- **Color:** dark bg, blue accent.

## Title Options

1. *Bits Per Byte: The One Number That Compares Any Two Language Models* ← recommended
2. *Why Perplexity Lies (and bpb Doesn't)*
3. *How to Fairly Compare BPE vs Byte-Level Models (bpb Explained)*

## Chapters

```
0:00  Why perplexity lies
0:45  What bpb actually measures
2:00  The formula
3:00  Worked example (your numbers)
4:30  Why not perplexity?
5:30  The random baseline (sanity check)
6:15  What bpb tells you about the mission
7:00  The verdict: byte-level or BPE?
8:00  Wrap-up + what's next
```

---

## Script

### [0:00] COLD OPEN

**VISUAL:** Two big numbers on screen: `Perplexity: 12.4` vs `Perplexity: 8.7`,
then a red X over both, then `bpb: 1.59` vs `bpb: 1.92`.

**NARRATION:**
> These two models report perplexity 12.4 and 8.7. The second looks better. But
> it's a lie — the two models use different tokenizers, so the numbers aren't in
> the same units. Comparing them is like comparing miles-per-gallon to
> liters-per-100km. The number that actually compares them honestly is bits per
> byte. This video is what it is, how to compute it, and how to read it.

### [0:45] WHAT bpb MEASURES

**VISUAL:** Definition card.

**NARRATION:**
> Bits per byte — bpb — is the average number of bits the model needs to encode
> each byte of text, given its predictions. Lower is better: fewer bits means the
> model is less surprised by the data. It's the byte-level analog of perplexity.
> Where perplexity asks "how many tokens is the model choosing among?", bpb asks
> "how many bits per byte does the model need?"

### [2:00] THE FORMULA

**VISUAL:** Formula on screen, then the nats conversion.

```
bpb = −log₂ P(x) / |bytes| = cross-entropy (bits) ÷ bytes

For byte-level models (1 token = 1 byte):
bpb = loss_nats ÷ ln(2)
```

**NARRATION:**
> The definition: negative log probability of the text, divided by its byte length,
> in base 2. In practice, frameworks report cross-entropy loss in nats — natural
> log. For a byte-level model, every token is exactly one byte, so the conversion
> is just divide by ln(2). That's the whole formula. One division.

### [3:00] WORKED EXAMPLE — YOUR NUMBERS

**VISUAL:** The lesson's worked-example table, then the perplexity-per-byte
conversion.

**NARRATION:**
> From episode 2's experiment: BPE = 1.592583 bpb, byte-level = 1.922753 bpb.
> Convert to "perplexity per byte" — how many bytes the model is effectively
> choosing among at each position: 2^bpb. BPE: 2^1.59 ≈ 3.0 bytes. Byte-level:
> 2^1.92 ≈ 3.8 bytes. So at each position, the byte-level model is about as
> uncertain as picking among ~4 bytes; BPE picks among ~3. Byte-level is slightly
> more surprised — consistent with having to learn word structure from raw bytes.
> That's the honest, apples-to-apples comparison.

### [4:30] WHY NOT PERPLEXITY?

**VISUAL:** Diagram of BPE token spanning multiple bytes vs single-byte token.

**NARRATION:**
> Perplexity is normalized per token. But BPE tokens and bytes are different units:
> one BPE token can be one byte, "a", or several bytes, an emoji. Comparing raw
> perplexity across tokenizers is comparing different-sized rulers. bpb normalizes
> by bytes, which is intrinsic to the text and tokenizer-independent. That's why
> Gao et al. in The Pile proposed bpb as the standard way to compare models with
> different tokenizations. It's the only fair ruler.

### [5:30] SANITY CHECK

**VISUAL:** `log₂(256) = 8` on screen, then 1.92 far below it.

**NARRATION:**
> Sanity check: a model that guesses uniformly at random among 256 bytes needs
> log₂(256) = 8 bpb. Your model at 1.92 is far below 8, so it clearly learned
> real structure — not memorization, not chance. If your bpb comes out near 8,
> something is broken: bad data, a bug, or a model that hasn't trained.

### [6:15] WHAT bpb TELLS YOU ABOUT THE MISSION

**VISUAL:** Bullet list, then the mission card.

**NARRATION:**
> For the mission — synthetic stories for a nanoGPT SLM — bpb does three things.
> One: it lets you compare byte-level versus BPE quality on equal terms, so you
> can decide whether byte-level's efficiency gains are worth ~0.33 bpb of quality.
> Two: lower bpb means better compression means better next-byte prediction
> means generally better downstream generation. Three: in `evaluate_bpb`, the
> byte-level case is trivial — every target is one byte, so no `token_bytes`
> lookup is needed. That's the simplification you got when you removed the
> tokenizer.

### [7:00] THE VERDICT

**VISUAL:** Decision matrix: byte-level vs BPE across VRAM, steps, bpb,
complexity.

**NARRATION:**
> So: byte-level or BPE? For this project — small model, Apple Silicon, memory
> constrained, autoresearch loop where iteration speed matters — byte-level. 2.4×
> more steps per budget, half the VRAM, simpler pipeline, and only ~0.33 bpb
> worse. If you had a big model and a big GPU, BPE's quality edge would matter
> more. The point isn't that byte-level always wins. The point is that now you
> have the number — bpb — to make that call honestly for your own setup.

### [8:00] WRAP-UP + WHAT'S NEXT

**VISUAL:** Series recap: 3 levers (data, input, metric). End card with
community prompt.

**NARRATION:**
> Three episodes, three levers. Faster data with Markov. Simpler input with
> bytes. Honest measurement with bpb. That's the toolkit. The autoresearch loop
> keeps running — edit `train.py`, five minutes, read `val_bpb`, keep or revert.
> If you want to see what the loop finds next, subscribe. And tell me in the
> comments: what should I build next — temperature sampling and backoff for the
> Markov model, or mixing Markov synthetic data into the SLM and measuring the
> bpb delta? I'll do whichever gets more votes. Code's in the description.

---

## Description

```
Perplexity lies when you compare models with different tokenizers. Bits per byte
(bpb) doesn't. Here's what bpb measures, how to compute it, and how to read it.

Episode 3 of "Autoresearch on Apple Silicon."

In this episode:
• Why raw perplexity can't compare BPE vs byte-level models
• bpb defined: average bits per byte, lower is better
• Formula: bpb = −log₂ P(x)/|bytes|; byte-level: loss_nats ÷ ln(2)
• Worked example: 1.59 vs 1.92 bpb → ~3.0 vs ~3.8 bytes perplexity
• Why Gao et al. (The Pile) proposed bpb
• Sanity check: random guessing = 8 bpb
• The verdict on byte-level vs BPE for this project

Code: https://github.com/<you>/autoresearch-mlx
  → prepare.py (evaluate_bpb), lessons/0003-bits-per-byte.html

Chapters:
0:00 Why perplexity lies
0:45 What bpb measures
2:00 The formula
3:00 Worked example
4:30 Why not perplexity
5:30 Sanity check
6:15 What bpb tells you
7:00 The verdict
8:00 Wrap-up

#bitsperbyte #evaluation #languagemodel #mlx #applesilicon #machinelearning
```

## Tags

`bits per byte, bpb, language model evaluation, perplexity vs bpb, compare language models, MLX, Apple Silicon, on device ML, nanoGPT, autoresearch, byte level, BPE, The Pile, gao et al, python, machine learning`
"""