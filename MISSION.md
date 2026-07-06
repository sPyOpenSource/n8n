# Mission: Word-Level Markov Models for Synthetic Text Generation

## Why
I want to generate synthetic children's stories to augment the TinyStories dataset for training my nanoGPT SLM on Apple Silicon. The Ollama-based approach is too slow (~45 stories/min). A Markov model can generate 10,000+ stories in seconds, but I need to understand how they work, how to build one, and what their limitations are.

## Success looks like
- Build a working word-level Markov model that generates coherent children's stories
- Generate 10K+ synthetic stories in under 60 seconds
- Integrate the synthetic data into the SLM training pipeline
- Understand when a Markov model is the right tool vs. when a neural approach is needed

## Constraints
- Must run on Apple Silicon (MLX ecosystem)
- Python implementation, no new external dependencies
- Training the nanoGPT SLM on mixed synthetic + real data

## Out of scope
- Character-level Markov models (word-level is the focus)
- Neural language model architecture details
- Production-grade text generation systems
