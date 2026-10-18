"""
Test script for the saved byte-level nanoGPT model.

Loads the model from saved_models/ and runs:
1. Forward pass on sample input (sanity check)
2. Text generation (sample stories)
3. Validation BPB evaluation
"""

import json
import os
import pickle
import sys
from dataclasses import dataclass

import mlx.core as mx
import mlx.nn as nn
from mlx.utils import tree_flatten

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from prepare import MAX_SEQ_LEN, evaluate_bpb, make_dataloader


# ---------------------------------------------------------------------------
# Model architecture (must match train.py)
# ---------------------------------------------------------------------------

@dataclass
class GPTConfig:
    block_size: int = 512
    vocab_size: int = 256
    n_layer: int = 6
    n_head: int = 6
    n_embd: int = 384


def norm(x):
    return x * mx.rsqrt(mx.mean(x * x, axis=-1, keepdims=True) + 1e-5)


def create_causal_mask(seq_len, dtype=mx.bfloat16):
    indices = mx.arange(seq_len)
    mask = indices[:, None] >= indices[None, :]
    return mx.where(mask, mx.array(0.0, dtype=dtype), mx.array(float("-inf"), dtype=dtype))


class CausalSelfAttention(nn.Module):
    def __init__(self, config):
        super().__init__()
        assert config.n_embd % config.n_head == 0
        self.n_head = config.n_head
        self.n_embd = config.n_embd
        self.head_dim = config.n_embd // config.n_head
        self.c_attn = nn.Linear(config.n_embd, 3 * config.n_embd, bias=False)
        self.c_proj = nn.Linear(config.n_embd, config.n_embd, bias=False)
        self.rope = nn.RoPE(self.head_dim, traditional=True, base=10000)

    def __call__(self, x, mask):
        B, T, C = x.shape
        qkv = self.c_attn(x).reshape(B, T, 3, self.n_head, self.head_dim)
        q, k, v = qkv[:, :, 0, :, :], qkv[:, :, 1, :, :], qkv[:, :, 2, :, :]
        q = self.rope(q.transpose(0, 2, 1, 3))
        k = self.rope(k.transpose(0, 2, 1, 3))
        v = v.transpose(0, 2, 1, 3)
        y = mx.fast.scaled_dot_product_attention(q, k, v, scale=1.0, mask=mask)
        y = y.transpose(0, 2, 1, 3).reshape(B, T, C)
        return self.c_proj(y)


class MLP(nn.Module):
    def __init__(self, config):
        super().__init__()
        self.c_fc = nn.Linear(config.n_embd, 4 * config.n_embd, bias=False)
        self.c_proj = nn.Linear(4 * config.n_embd, config.n_embd, bias=False)

    def __call__(self, x):
        x = self.c_fc(x)
        x = mx.maximum(x, 0) ** 2
        return self.c_proj(x)


class Block(nn.Module):
    def __init__(self, config):
        super().__init__()
        self.attn = CausalSelfAttention(config)
        self.mlp = MLP(config)

    def __call__(self, x, mask):
        x = x + self.attn(norm(x), mask)
        x = x + self.mlp(norm(x))
        return x


class GPT(nn.Module):
    def __init__(self, config):
        super().__init__()
        self.config = config
        self.wte = nn.Embedding(config.vocab_size, config.n_embd)
        self.blocks = [Block(config) for _ in range(config.n_layer)]
        self.lm_head = nn.Linear(config.n_embd, config.vocab_size, bias=False)
        self._mask_cache = {}

    def _get_mask(self, seq_len):
        if seq_len not in self._mask_cache:
            self._mask_cache[seq_len] = create_causal_mask(seq_len)
        return self._mask_cache[seq_len]

    def __call__(self, idx, targets=None, reduction="mean"):
        _, seq_len = idx.shape
        mask = self._get_mask(seq_len)
        x = self.wte(idx)
        for block in self.blocks:
            x = block(x, mask)
        x = norm(x)
        logits = self.lm_head(x).astype(mx.float32)
        logits = 15.0 * mx.tanh(logits / 15.0)
        if targets is None:
            return logits
        valid = targets != -1
        targets_safe = mx.where(valid, targets, mx.zeros_like(targets))
        ce = nn.losses.cross_entropy(logits, targets_safe, reduction="none")
        ce = ce * valid
        if reduction == "none":
            return ce
        denom = mx.maximum(mx.sum(valid), 1)
        return mx.sum(ce) / denom


# ---------------------------------------------------------------------------
# Loading
# ---------------------------------------------------------------------------

SAVE_DIR = "saved_models"


def load_model():
    """Load config + parameters from saved_models/."""
    config_path = os.path.join(SAVE_DIR, "config.json")
    model_path = os.path.join(SAVE_DIR, "model.pkl")

    if not os.path.exists(config_path):
        print(f"ERROR: {config_path} not found. Run train.py first.")
        sys.exit(1)
    if not os.path.exists(model_path):
        print(f"ERROR: {model_path} not found. Run train.py first.")
        sys.exit(1)

    with open(config_path) as f:
        config_dict = json.load(f)

    config = GPTConfig(
        block_size=config_dict["block_size"],
        vocab_size=config_dict["vocab_size"],
        n_layer=config_dict["n_layer"],
        n_head=config_dict["n_head"],
        n_embd=config_dict["n_embd"],
    )

    model = GPT(config)

    with open(model_path, "rb") as f:
        saved_params = pickle.load(f)

    # Set parameters on the model
    for path, value in saved_params.items():
        parts = path.split(".")
        obj = model
        for part in parts[:-1]:
            if isinstance(obj, list):
                obj = obj[int(part)]
            elif isinstance(obj, dict):
                obj = obj[part]
            else:
                obj = getattr(obj, part)
        last = parts[-1]
        if isinstance(obj, dict):
            obj[last] = mx.array(value)
        else:
            setattr(obj, last, mx.array(value))

    mx.eval(model.parameters())
    print(f"Model loaded from {SAVE_DIR}/")
    print(f"  val_bpb: {config_dict.get('val_bpb', 'N/A')}")
    print(f"  steps:   {config_dict.get('num_steps', 'N/A')}")
    print(f"  params:  {sum(p.size for _, p in tree_flatten(model.parameters())) / 1e6:.1f}M")
    return model, config


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_forward_pass(model, config):
    """Sanity check: forward pass on random input."""
    print("\n=== Test 1: Forward pass ===")
    mx.random.seed(42)
    x = mx.random.randint(0, config.vocab_size, (2, 64))
    logits = model(x)
    print(f"Input shape:  {x.shape}")
    print(f"Logits shape: {logits.shape}")
    assert logits.shape == (2, 64, config.vocab_size), "Logits shape mismatch"
    print("PASSED\n")


def test_generation(model, config, num_stories=5, max_len=120):
    """Generate sample stories by sampling from the model."""
    print(f"=== Test 2: Text generation ({num_stories} stories) ===")
    mx.random.seed(123)

    for i in range(num_stories):
        # Start with a BOS-like seed (byte 0 or space)
        idx = mx.array([[0]])  # byte 0 as start
        generated = []

        for _ in range(max_len):
            logits = model(idx[:, -config.block_size:])
            next_logits = logits[0, -1, :] / 1.0  # temperature 1.0
            probs = mx.softmax(next_logits)
            next_byte = mx.random.categorical(probs).item()
            generated.append(next_byte)
            idx = mx.concatenate([idx, mx.array([[next_byte]])], axis=1)

        # Convert bytes to text
        text = bytes(generated).decode("utf-8", errors="replace")
        print(f"\n--- Story {i+1} ---")
        print(text[:200])


def test_validation_bpb(model, batch_size=64):
    """Evaluate validation BPB."""
    print("\n=== Test 3: Validation BPB ===")
    val_bpb = evaluate_bpb(model, batch_size)
    print(f"val_bpb: {val_bpb:.6f}")
    return val_bpb


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    model, config = load_model()

    test_forward_pass(model, config)
    test_generation(model, config, num_stories=5)
    val_bpb = test_validation_bpb(model)

    print("\n=== All tests complete ===")
    print(f"Final val_bpb: {val_bpb:.6f}")
