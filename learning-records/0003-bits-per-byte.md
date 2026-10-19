# Bits Per Byte (bpb) — Core Concepts Covered

Learned what bpb (bits per byte) is, how to compute it, and how to interpret it — specifically in the context of comparing byte-level (vocab=256) vs BPE (vocab=4,096) models on Apple Silicon.

## Evidence

- bpb = average bits needed to encode each byte given the model's predictions; lower is better. It's the byte-level analog of perplexity.
- Formula: bpb = −log₂ P(x) / |bytes| = cross-entropy (bits) ÷ bytes. With loss in nats for byte-level models: bpb = loss_nats ÷ ln(2) (1 token = 1 byte).
- Perplexity per byte = 2^bpb. Applied to own results: BPE 1.59 → ≈3.0 bytes; byte-level 1.92 → ≈3.8 bytes. Byte-level is slightly more surprised, consistent with learning word structure from raw bytes.
- Random baseline: uniform over 256 bytes = log₂(256) = 8 bpb. Own model at 1.92 is far below, so it learned real structure.
- Why bpb over perplexity: perplexity is per-token and tokens differ across tokenizers; bpb divides by bytes (intrinsic to text), enabling fair cross-tokenizer comparison. Proposed by Gao et al. (2020, The Pile).
- Implementation: byte-level `evaluate_bpb` needs no `token_bytes` lookup since every target byte has length 1.

## Implications

- bpb lets the user compare byte-level vs BPE model quality on equal terms — needed to judge whether byte-level input's efficiency gains (~2.4× steps/min, half VRAM) are worth its ~0.33 bpb quality cost.
- Supports the mission decision: byte-level is likely the better trade-off for small models on memory-constrained Apple Silicon.
- Next session should cover: combining byte-level input with Markov synthetic data to test if synthetic augmentation helps byte-level models more than BPE models, and evaluating the result with val_bpb.
