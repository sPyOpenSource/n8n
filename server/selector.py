"""Softmax/Boltzmann provider selection based on error rate and latency."""

import math
import random


class ProviderSelector:
    """Select a provider using softmax over a composite score.

    The score for each provider is:
        S = w_error * error_rate + w_latency * (latency_p99 / max_latency)

    Provider with lower S gets higher selection probability via softmax.
    """

    def __init__(self, tau: float = 0.1, w_error: float = 0.7, w_latency: float = 0.3, max_latency: float = 10000.0):
        self.tau = tau
        self.w_error = w_error
        self.w_latency = w_latency
        self.max_latency = max_latency

    def _score(self, signals: dict) -> float:
        error_rate = signals.get("error_rate", 0.0)
        latency_p99 = signals.get("latency_p99", 0.0)
        return (
            self.w_error * error_rate
            + self.w_latency * (latency_p99 / self.max_latency)
        )

    def select(self, candidates: dict[str, dict], exclude: set[str]) -> str | None:
        """Pick a provider from candidates (excluding those in `exclude`) using softmax."""
        available = {k: v for k, v in candidates.items() if k not in exclude}
        if not available:
            return None

        scores = {name: self._score(sig) for name, sig in available.items()}
        min_s = min(scores.values())
        exp_values = {name: math.exp(-(s - min_s) / self.tau) for name, s in scores.items()}
        total = sum(exp_values.values())

        if total == 0:
            return random.choice(list(available.keys()))

        r = random.random() * total
        cumulative = 0.0
        for name in sorted(available.keys()):
            cumulative += exp_values[name]
            if r <= cumulative:
                return name
        return list(available.keys())[-1]
