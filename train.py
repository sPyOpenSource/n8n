"""
nanoGPT-style pretraining on TinyStories with MLX.
"""

import gc
import math
import os
import time
from dataclasses import dataclass

import mlx.core as mx
import mlx.nn as nn
from mlx.utils import tree_flatten, tree_map

from prepare import MAX_SEQ_LEN, TIME_BUDGET, Tokenizer, evaluate_bpb, make_dataloader

os.environ["HF_HUB_DISABLE_PROGRESS_BARS"] = "1"


@dataclass
class GPTConfig:
    block_size: int = 512
    vocab_size: int = 4096
    n_layer: int = 6
    n_head: int = 6
    n_embd: int = 384


def norm(x):
    return x * mx.rsqrt(mx.mean(x * x, axis=-1, keepdims=True) + 1e-5)


def create_causal_mask(seq_len, dtype=mx.bfloat16):
    indices = mx.arange(seq_len)
    mask = indices[:, None] >= indices[None, :]
    return mx.where(mask, mx.array(0.0, dtype=dtype), mx.array(float("-inf"), dtype=dtype))


def get_peak_memory_mb():
    return mx.get_peak_memory() / 1024 / 1024


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
        q, k, v = (
            qkv[:, :, 0, :, :],
            qkv[:, :, 1, :, :],
            qkv[:, :, 2, :, :],
        )
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

    def init_weights(self):
        vocab_size, n_embd = self.config.vocab_size, self.config.n_embd
        scale = 0.02
        self.wte.weight = (mx.random.normal(self.wte.weight.shape) * scale).astype(mx.bfloat16)
        for block in self.blocks:
            block.attn.c_attn.weight = mx.random.uniform(-scale, scale, block.attn.c_attn.weight.shape).astype(mx.bfloat16)
            block.attn.c_proj.weight = mx.zeros_like(block.attn.c_proj.weight).astype(mx.bfloat16)
            block.mlp.c_fc.weight = mx.random.uniform(-scale, scale, block.mlp.c_fc.weight.shape).astype(mx.bfloat16)
            block.mlp.c_proj.weight = mx.zeros_like(block.mlp.c_proj.weight).astype(mx.bfloat16)

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


class AdamW:
    def __init__(self, model, learning_rate, weight_decay, betas):
        self.param_config = {}
        self.adam_state = {}
        flat_params = tree_flatten(model.parameters())
        for path, param in flat_params:
            is_weight = param.ndim >= 2
            self.param_config[path] = {
                "lr": learning_rate,
                "betas": betas,
                "eps": 1e-8,
                "weight_decay": weight_decay if is_weight else 0.0,
            }
        self.initial_lrs = {path: config["lr"] for path, config in self.param_config.items()}

    def _set_path_value(self, model, path, value):
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
            obj[last] = value
        else:
            setattr(obj, last, value)

    def _step(self, path, grad, param, config):
        grad_f32 = grad.astype(mx.float32)
        param_f32 = param.astype(mx.float32)
        lr = config["lr"]
        beta1, beta2 = config["betas"]
        eps = config["eps"]
        weight_decay = config["weight_decay"]

        if path not in self.adam_state:
            self.adam_state[path] = {
                "m": mx.zeros_like(grad_f32),
                "v": mx.zeros_like(grad_f32),
                "t": 0,
            }

        state = self.adam_state[path]
        state["t"] += 1
        state["m"] = beta1 * state["m"] + (1 - beta1) * grad_f32
        state["v"] = beta2 * state["v"] + (1 - beta2) * (grad_f32 * grad_f32)

        bias1 = 1 - beta1 ** state["t"]
        bias2 = 1 - beta2 ** state["t"]
        denom = mx.sqrt(state["v"] / bias2) + eps
        step_size = lr / bias1

        param_f32 = param_f32 * (1 - lr * weight_decay)
        param_f32 = param_f32 - step_size * (state["m"] / denom)
        return param_f32.astype(param.dtype)

    def update(self, model, grads):
        flat_grads = dict(tree_flatten(grads))
        flat_params = dict(tree_flatten(model.parameters()))
        for path, grad in flat_grads.items():
            if path not in self.param_config:
                continue
            config = self.param_config[path]
            param = flat_params[path]
            new_param = self._step(path, grad, param, config)
            self._set_path_value(model, path, new_param)

    def set_lr_multiplier(self, multiplier):
        for path, config in self.param_config.items():
            config["lr"] = self.initial_lrs[path] * multiplier

    @property
    def state(self):
        arrays = []
        for state in self.adam_state.values():
            arrays.extend([state["m"], state["v"]])
        return arrays


# ---------------------------------------------------------------------------
# Hyperparameters
# ---------------------------------------------------------------------------

LEARNING_RATE = 3e-4
WEIGHT_DECAY = 0.1
BETAS = (0.9, 0.95)
WARMUP_RATIO = 0.1
WARMDOWN_RATIO = 0.6
FINAL_LR_FRAC = 0.1

N_LAYER = 6
N_HEAD = 6
N_EMBD = 384
DEVICE_BATCH_SIZE = 32
TOTAL_BATCH_SIZE = 2**15
FINAL_EVAL_BATCH_SIZE = 64
STARTUP_EXCLUDE_STEPS = 1


def get_lr_multiplier(progress):
    if progress < WARMUP_RATIO:
        return progress / WARMUP_RATIO if WARMUP_RATIO > 0 else 1.0
    if progress < 1.0 - WARMDOWN_RATIO:
        return 1.0
    cooldown = (1.0 - progress) / WARMDOWN_RATIO
    return cooldown * 1.0 + (1 - cooldown) * FINAL_LR_FRAC


t_start = time.time()
mx.random.seed(42)

tokenizer = Tokenizer.from_directory()
vocab_size = tokenizer.get_vocab_size()
train_loader = make_dataloader(tokenizer, DEVICE_BATCH_SIZE, MAX_SEQ_LEN, "train")
x, y, epoch = next(train_loader)
t_data = time.time()
print(f"Data/tokenizer loaded in {t_data - t_start:.1f}s")

config = GPTConfig(
    block_size=MAX_SEQ_LEN,
    vocab_size=vocab_size,
    n_layer=N_LAYER,
    n_head=N_HEAD,
    n_embd=N_EMBD,
)

model = GPT(config)
model.init_weights()
mx.eval(model.parameters())
num_params = sum(param.size for _, param in tree_flatten(model.parameters()))

tokens_per_fwdbwd = DEVICE_BATCH_SIZE * MAX_SEQ_LEN
assert TOTAL_BATCH_SIZE % tokens_per_fwdbwd == 0
grad_accum_steps = TOTAL_BATCH_SIZE // tokens_per_fwdbwd

optimizer = AdamW(
    model,
    learning_rate=LEARNING_RATE,
    weight_decay=WEIGHT_DECAY,
    betas=BETAS,
)

loss_grad_fn = nn.value_and_grad(model, lambda model, inputs, targets: model(inputs, targets=targets))

print(f"Time budget: {TIME_BUDGET}s")
print(f"Gradient accumulation steps: {grad_accum_steps}")

smooth_train_loss = 0.0
total_training_time = 0.0
step = 0
t_compiled = None

while True:
    t0 = time.time()
    accum_grads = None
    train_loss = None

    for _ in range(grad_accum_steps):
        loss, grads = loss_grad_fn(model, x, y)
        mx.eval(loss, grads)
        if t_compiled is None:
            t_compiled = time.time()
            print(f"Model compiled in {t_compiled - t_data:.1f}s")
        train_loss = loss
        if accum_grads is None:
            accum_grads = grads
        else:
            accum_grads = tree_map(lambda lhs, rhs: lhs + rhs, accum_grads, grads)
        x, y, epoch = next(train_loader)

    if grad_accum_steps > 1:
        accum_grads = tree_map(lambda grad: grad * (1.0 / grad_accum_steps), accum_grads)

    progress = min(total_training_time / TIME_BUDGET, 1.0)
    lrm = get_lr_multiplier(progress)
    optimizer.set_lr_multiplier(lrm)
    optimizer.update(model, accum_grads)
    mx.eval(model.parameters(), *optimizer.state)

    train_loss_f = float(train_loss.item())
    if train_loss_f > 100:
        print("FAIL")
        raise SystemExit(1)

    dt = time.time() - t0
    if step >= STARTUP_EXCLUDE_STEPS:
        total_training_time += dt

    ema_beta = 0.9
    smooth_train_loss = ema_beta * smooth_train_loss + (1 - ema_beta) * train_loss_f
    debiased_smooth_loss = smooth_train_loss / (1 - ema_beta ** (step + 1))
    pct_done = 100 * progress
    tok_per_sec = int(TOTAL_BATCH_SIZE / dt) if dt > 0 else 0
    remaining = max(0.0, TIME_BUDGET - total_training_time)

    print(
        f"\rstep {step:05d} ({pct_done:.1f}%) | loss: {debiased_smooth_loss:.6f} | "
        f"lrm: {lrm:.2f} | dt: {dt*1000:.0f}ms | tok/sec: {tok_per_sec:,} | "
        f"epoch: {epoch} | remaining: {remaining:.0f}s    ",
        end="",
        flush=True,
    )

    if step == 0:
        gc.collect()
        gc.freeze()
        gc.disable()
    elif (step + 1) % 5000 == 0:
        gc.collect()

    step += 1
    if step >= STARTUP_EXCLUDE_STEPS and total_training_time >= TIME_BUDGET:
        break

print()
t_train = time.time()
print(f"Training completed in {t_train - t_compiled:.1f}s")

total_tokens = step * TOTAL_BATCH_SIZE
print("Starting final eval...")
print(f"Final eval batch size: {FINAL_EVAL_BATCH_SIZE}")
val_bpb = evaluate_bpb(model, tokenizer, FINAL_EVAL_BATCH_SIZE)
t_eval = time.time()
print(f"Final eval completed in {t_eval - t_train:.1f}s")

steady_state_mfu = 0.0
peak_vram_mb = get_peak_memory_mb()

print("---")
print(f"val_bpb:          {val_bpb:.6f}")
print(f"training_seconds: {total_training_time:.1f}")
print(f"total_seconds:    {t_eval - t_start:.1f}")
print(f"peak_vram_mb:     {peak_vram_mb:.1f}")
print(f"mfu_percent:      {steady_state_mfu:.2f}")
print(f"total_tokens_M:   {total_tokens / 1e6:.1f}")
print(f"num_steps:        {step}")
print(f"num_params_M:     {num_params / 1e6:.1f}")
print(f"n_layer:          {N_LAYER}")
print(f"n_embd:           {N_EMBD}")
