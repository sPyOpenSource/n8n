# Word-Level Markov Models — Core Concepts Covered

Learned the core mechanics of word-level n-gram Markov models: the Markov property, the context window (n), the frequency table approach, and the sampling generation algorithm. Connected this to their mission: Markov models can generate 10K synthetic stories in under a second vs. ~45/min for Ollama — a 600,000× speedup that makes synthetic data augmentation practical.

## Evidence

Reviewed a complete 25-line Python implementation of a trigram Markov model. The model builds a `defaultdict(Counter)` mapping context tuples to next-word counts, then generates by sampling. The key insight about n=3 as the sweet spot for TinyStories was understood and contrasted with the failure modes of n=2 (no grammar) and n=4 (verbatim copying).

## Implications

- Markov models are now the "fast path" for synthetic data — can generate at scale vs. Ollama's "quality path"
- Next session should cover: temperature sampling, backoff smoothing for unseen contexts, and integrating Markov-synthetic data into the SLM training pipeline (comparing val_bpb against both baseline and Ollama-synthetic runs)
