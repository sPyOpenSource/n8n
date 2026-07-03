"""In-memory signal store for error rate and latency per provider."""

import time
import threading


class ScoreKeeper:
    """Tracks error rate and p99 latency per provider with staleness."""

    def __init__(self, max_age: float = 30.0):
        self._max_age = max_age
        self._lock = threading.Lock()
        self._records: dict[str, list[tuple[float, float | None]]] = {}

    def record_success(self, provider: str, latency_ms: float):
        with self._lock:
            self._records.setdefault(provider, []).append((time.monotonic(), latency_ms))
            self._prune(provider)

    def record_error(self, provider: str):
        with self._lock:
            self._records.setdefault(provider, []).append((time.monotonic(), None))
            self._prune(provider)

    def _prune(self, provider: str):
        cutoff = time.monotonic() - self._max_age
        records = self._records[provider]
        self._records[provider] = [r for r in records if r[0] >= cutoff]

    def scores(self, provider: str | None = None) -> dict:
        with self._lock:
            if provider is None or provider not in self._records:
                return {"error_rate": 0.0, "latency_p99": 0.0}
            self._prune(provider)
            records = self._records[provider]
            if not records:
                return {"error_rate": 0.0, "latency_p99": 0.0}
            total = len(records)
            errors = sum(1 for _, lat in records if lat is None)
            latencies = [lat for _, lat in records if lat is not None]
            p99 = sorted(latencies)[min(int(len(latencies) * 0.99), len(latencies) - 1)] if latencies else 0.0
            return {
                "error_rate": errors / total if total > 0 else 0.0,
                "latency_p99": p99,
            }
