# Episode 1 — How I Generate 10,000 Training Stories in 1 Second

**Series:** Autoresearch on Apple Silicon · Ep. 1 of 3
**Target length:** ~6 min
**Source material:** `lessons/0001-word-level-markov.html`, `markov_synthetic.py`, `MISSION.md`

---

## Meta

- **Primary keyword:** word level markov model python
- **Secondary:** synthetic training data, tiny language model, autoresearch mlx
- **Promise to viewer:** "By the end you'll have a 25-line Python class that generates
  10,000 coherent children's stories in under a second — and understand why every
  modern LLM is, at its core, a fancy version of it."
- **End CTA:** subscribe + "Episode 2: I removed the tokenizer."

## Thumbnail

- **Big text:** "10,000 stories / 1 second"
- **Visual:** terminal showing `Kept 10000/10000` next to a stopwatch; face with
  surprised expression.
- **Color:** dark bg, green accent for the number.

## Title Options (pick one)

1. *How I Generate 10,000 Training Stories in 1 Second (Python)*  ← recommended
2. *Word-Level Markov Models: The 25-Line Generator Behind My LLM*
3. *I Replaced Ollama With a 19th-Century Algorithm (and It's 600,000× Faster)*

## Chapters

```
0:00  The 600,000× speedup
0:45  The mission: synthetic stories for a tiny LLM
2:00  Why Ollama can't keep up
3:00  Markov property in 60 seconds
4:30  The 25-line implementation
6:00  Training on real TinyStories
7:00  Generating + filtering
8:00  The n=3 sweet spot (and its limits)
9:00  What's next
```

---

## Script

### [0:00] COLD OPEN

**VISUAL:** Full-screen terminal. A single line animates in:

```
Ollama:    45 stories / minute
Markov:    10,000 stories / 0.8 seconds
```

**NARRATION:**
> Six hundred thousand times faster. Same stories. Same machine. The only thing
> that changed was the algorithm — from a neural network to a technique invented
> in the 1800s. This video is about that technique, and why it's the conceptual
> ancestor of every model you've ever used, including GPT-4.

### [0:20] INTRO + MISSION CARD

**VISUAL:** Title card "Autoresearch on Apple Silicon — Ep. 1" over the lesson's
dark theme. Then a "MISSION" card (from `MISSION.md`):

> Generate synthetic children's stories to augment TinyStories for a nanoGPT SLM
> on Apple Silicon. Ollama is too slow (~45 stories/min). Need 10K+ in under 60s.

**NARRATION:**
> I'm building a tiny language model on a Mac — no CUDA, no cloud — using an
> experiment loop called autoresearch. The model trains on children's stories, and
> I want to feed it synthetic stories to make it better. The problem: my Ollama
> pipeline makes about 45 stories a minute. I need ten thousand. That's four hours
> of waiting per batch. Unacceptable.

### [1:10] THE AUTORESEARCH LOOP (30s context)

**VISUAL:** Diagram of the loop: edit `train.py` → run 5 min → read `val_bpb` →
keep or revert → repeat. Show `results.tsv` rows.

**NARRATION:**
> Quick context if you're new: autoresearch is Karpathy's idea — give an agent one
> mutable file (`train.py`), one metric (`val_bpb`), a fixed five-minute budget,
> and let it run experiments forever, keeping winners. I ported it to MLX so it
> runs natively on Apple Silicon. Today's lever isn't the model though — it's the
> *data*. More, faster, cheaper data.

### [2:00] WHY OLLAMA CAN'T KEEP UP

**VISUAL:** `synthetic.py` snippet: `MODEL = "llama3.2:1b"`, `STORIES_PER_CALL = 100`,
`num_predict: 16384`. Show a call taking ~2 min.

**NARRATION:**
> Here's the Ollama path. We prompt `llama3.2:1b` for 100 stories, parse the
> `---` separators, filter, repeat. Each call is ~100 stories and takes a couple
> of minutes. Quality is decent — the model actually understands "children's
> story." But I don't need understanding. I need *volume* to augment training.
> So: can something dumb but fast do the job?

### [3:00] THE MARKOV PROPERTY

**VISUAL:** The lesson's trigram demo. Sentence "The little girl went to the park.
She played on the swings." with overlapping triples animating.

**NARRATION:**
> Enter the Markov chain. The core assumption — the Markov property — is that
> the next word depends only on the previous n-1 words, not the whole history.
> That's obviously false for real language: a pronoun can refer to a noun twenty
> sentences back. But for short children's stories, it works surprisingly well.
>
> A trigram model, n=3, breaks text into overlapping triples: context of two
> words → next word. `(The, little) → girl`. `(little, girl) → went`. We count
> these into a frequency table, then *sample* from it. That's the whole idea.
> No gradients, no backprop, no GPU. Just counting.

### [4:30] THE IMPLEMENTATION (show code)

**VISUAL:** Code editor with the `WordMarkov` class. Highlight each method.

```python
from collections import defaultdict, Counter
import random

class WordMarkov:
    def __init__(self, n=3):
        self.n = n
        self.model = defaultdict(Counter)

    def train(self, corpus):
        for tokens in corpus:
            ctx = tuple(['<BOS>'] * (self.n - 1))
            for word in tokens + ['<EOS>']:
                self.model[ctx][word] += 1
                ctx = ctx[1:] + (word,)

    def generate(self, max_len=50):
        ctx = tuple(['<BOS>'] * (self.n - 1))
        out = []
        for _ in range(max_len):
            counts = self.model.get(ctx)
            if not counts: break
            words, weights = zip(*counts.items())
            word = random.choices(words, weights=weights, k=1)[0]
            if word == '<EOS>': break
            out.append(word)
            ctx = ctx[1:] + (word,)
        return ' '.join(out)
```

**NARRATION:**
> Twenty-five lines of core logic. Three methods. `train` slides a window over
> each story and increments a counter. `generate` starts from a BOS-padded
> context, samples a next word proportional to its count, slides the window, and
> stops at EOS. That's it. No tokenizer. No model file. The "model" is just a
> dictionary: context tuple → Counter of next words.

### [6:00] TRAINING ON REAL TINYSTORIES

**VISUAL:** Terminal: `uv run python3 -c "..."` loading 500 stories, training,
printing 10 generated stories.

**NARRATION:**
> Let's run it. Load 500 real TinyStories from a parquet shard, tokenize by
> splitting on whitespace, train a trigram, generate ten. [Pause for terminal
> output.] Look at these. "the little girl went to the park and played on the
> swings." Grammatical. Coherent-ish. Sometimes a bit off — "the dog ran to the
> the" — but for training data that's fine; the neural net will smooth it out.

### [7:00] GENERATING AT SCALE + FILTERING

**VISUAL:** `markov_synthetic.py` — the `passes_filter` function and the
generation loop with rate printing.

**NARRATION:**
> Now scale. `markov_synthetic.py` trains on 5,000 real stories, then generates
> until 5,000 pass a filter: length between 20 and 400 chars, at least 5 words,
> contains a period. The filter kills the garbage — too-short fragments, run-on
> junk. Run it. [Terminal: `Kept 5000/5000 (10000+ stories/min)`] Ten thousand
> stories per minute. Actually faster than that — the printout says stories per
> *minute* but the real rate is stories per *second* territory. Either way:
> four hours of Ollama becomes under a second.

### [8:00] WHY N=3? (and its limits)

**VISUAL:** The lesson's n comparison table: n=2 word soup, n=3 good balance,
n=4 verbatim copying.

**NARRATION:**
> Why n=3? It's the fluency-diversity trade-off. n=2 gives word soup — no
> grammar, words don't agree. n=4 starts copying training data verbatim, which
> defeats the purpose of *synthetic* data. n=3 is the sweet spot for short
> stories: grammatical enough to be useful, novel enough to be new data.
>
> But be honest about the limits. Markov models can't reason. They don't
> understand meaning. A trigram can't link "the cat... it" because "cat" is two
> words back, outside its window. They replay patterns. For augmenting SLM
> training data, that's often enough — the neural net learns the patterns anyway.
> For anything requiring coherence across sentences, you need a real model.

### [9:00] WRAP-UP + TEASER

**VISUAL:** Side-by-side: Ollama 45/min vs Markov 10K/sec. Then "next episode"
card.

**NARRATION:**
> So: one speed lever pulled — data generation is no longer the bottleneck.
> But there's another lever: how the SLM itself reads text. Right now it uses BPE
> tokenization — 4,096 learned subword units, a separate tokenizer to train, save,
> and load. What if we just... didn't? Feed it raw bytes. That's episode 2.
> Subscribe, and I'll see you there.

---

## Description

```
How I generate 10,000 synthetic children's stories in under a second using a
25-line word-level Markov model — replacing an Ollama pipeline that took 4 hours.

This is Episode 1 of "Autoresearch on Apple Silicon," a series about porting
Karpathy's autoresearch loop to MLX and training a tiny language model on a Mac.

In this episode:
• Why Ollama (~45 stories/min) can't feed an SLM training loop
• The Markov property explained in 60 seconds
• A complete 25-line WordMarkov class (train + generate)
• Training on real TinyStories parquet shards
• The n=3 fluency/diversity sweet spot and its limits
• Scaling to 10K stories with filtering

Code: https://github.com/<you>/autoresearch-mlx
  → markov_synthetic.py, lessons/0001-word-level-markov.html

Chapters:
0:00 The 600,000× speedup
0:45 The mission
2:00 Why Ollama can't keep up
3:00 Markov property
4:30 The 25-line implementation
6:00 Training on TinyStories
7:00 Scaling + filtering
8:00 Why n=3 (and limits)
9:00 What's next

#markovchain #syntheticdata #python #machinelearning #applesilicon #mlx
```

## Tags

`markov chain, word level markov model, synthetic training data, tiny language model, nanoGPT, autoresearch, karpathy, MLX, Apple Silicon, python machine learning, n-gram, text generation, on device ml`
"""