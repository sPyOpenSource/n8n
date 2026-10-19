# Byte-Level Input — Core Concepts Covered

Learned how byte-level input works for language models: every raw UTF-8 byte (0–255) is a token, vocab is fixed at 256, no tokenizer needed. Connected this to the autoresearch project where we switched from BPE (vocab=4,096) to byte-level (vocab=256) in both prepare.py and train.py.

## Evidence

Implemented the full byte-level pipeline: prepare.py now uses text.encode("utf-8") instead of rustbpe/tiktoken Tokenizer; train.py uses vocab_size=256 with no Tokenizer import; evaluate_bpb no longer needs token_bytes lookup since every target byte has length 1. Ran experiments showing byte-level fits 203 steps vs 83 for BPE in the same 5-minute budget, uses 2.0 GB vs 3.8 GB VRAM, but achieves 1.92 bpb vs 1.59 bpb (BPE still better quality, byte-level better efficiency).

## Implications

- Byte-level is the better trade-off for small models on memory-constrained Apple Silicon
- The simplified pipeline (no tokenizer) reduces complexity and potential failure points
- Next session should cover: combining byte-level input with Markov synthetic data to test if synthetic augmentation helps byte-level models more than BPE models
