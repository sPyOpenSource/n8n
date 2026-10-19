# YouTube Series: Autoresearch on Apple Silicon

> A 3-episode series documenting a real, end-to-end experiment: porting Karpathy's
> autoresearch loop to Apple Silicon (MLX), then using it to train a tiny language
> model on children's stories — covering synthetic data generation (Markov), a
> tokenizer-free byte-level pipeline, and fair cross-tokenizer evaluation (bpb).

## Channel / Series Identity

- **Series name:** *Autoresearch on Apple Silicon*
- **Tagline:** "Letting an AI do its own research — on a Mac."
- **Niche:** ML engineering / on-device ML / Apple Silicon / educational deep-dives
- **Target audience:** ML practitioners and curious developers who own a Mac and want
  to run real training loops locally without CUDA. Secondary: students learning NLP
  fundamentals (Markov chains, tokenization, evaluation metrics).
- **Tone:** builder's log — honest, technical, shows failures and trade-offs, not
  hype. Show real terminals, real numbers, real code.
- **Visual identity:** dark theme matching the lesson HTML (`assets/style.css` palette),
  monospace code, terminal captures, annotated charts. No stock footage.

## Episode Map

| # | Title (working) | Core concept | Source lesson | Length |
|---|---|---|---|---|
| 1 | How I Generate 10,000 Training Stories in 1 Second | Word-level Markov models for synthetic data | `lessons/0001-word-level-markov.html` | ~10 min |
| 2 | I Removed the Tokenizer: Byte-Level Language Models on a Mac | Byte-level input, vocab=256 | `lessons/0002-byte-level-input.html` | ~10 min |
| 3 | Bits Per Byte: How to Fairly Compare Any Two Language Models | bpb metric & interpretation | `lessons/0003-bits-per-byte.html` | ~9 min |

## Narrative Arc

1. **Problem → speed lever #1 (data).** Ollama is too slow to feed the SLM → build a
   Markov generator that's 600,000× faster. Establishes the mission and the
   autoresearch loop.
2. **Speed lever #2 (input).** Tokenizers add complexity and memory → drop BPE,
   feed raw UTF-8 bytes. Shows the trade-off (2.4× steps, half VRAM, +0.33 bpb).
3. **Measurement.** You can't compare BPE vs byte-level on raw perplexity → bpb.
   Closes the loop: now we can decide byte-level is worth it.

## Recurring Elements (use in every episode)

- **Cold open (0:00–0:20):** a single surprising number or result on screen, then
  "here's how I got there."
- **"Mission" card:** one slide stating the mission from `MISSION.md` (synthetic
  children's stories for a nanoGPT SLM on Apple Silicon).
- **Terminal proof:** every claim backed by a real run (`uv run train.py`, real
  `val_bpb` numbers).
- **Honest trade-off box:** never hide the downside (Markov = dumb, byte-level =
  higher bpb).
- **End card:** "next episode" teaser + subscribe CTA + GitHub link.

## Standard Description Footer (append to every episode)

```
Code: https://github.com/<you>/autoresearch-mlx
Mission + lessons: see MISSION.md and lessons/ in the repo
Hardware: Apple Silicon (MLX), no CUDA, no PyTorch

Chapters:
<timestamps>

If this helped, subscribe — more on-device ML experiments coming.
```

## Publishing Plan

- **Cadence:** one episode per week, Tue/Thu to catch ML Twitter.
- **Length target:** 9–11 min (sweet spot for retention + mid-roll ads).
- **First 30s retention rule:** state the result number before explaining anything.
- **Thumbnail rule:** one big number + one short phrase + face/terminal. No clutter.

## SEO Keywords (base set, refine per episode)

autoresearch, karpathy autoresearch, MLX, Apple Silicon, on-device machine learning,
tiny language model, nanoGPT, bits per byte, byte level language model, markov chain,
synthetic data, Apple Silicon ML, Python ML, train LLM on Mac.
"""