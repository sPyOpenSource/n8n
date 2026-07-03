"""Hybrid health detection: passive (request outcomes) + active (probes)."""

import threading
import time
import logging

log = logging.getLogger(__name__)


class HealthWatcher:
    STATUS_HEALTHY = "HEALTHY"
    STATUS_UNHEALTHY = "UNHEALTHY"
    STATUS_PROBING = "PROBING"

    def __init__(self, max_failures: int = 3, recovery_probes: int = 3, probe_interval: float = 5.0):
        self._max_failures = max_failures
        self._recovery_probes = recovery_probes
        self._probe_interval = probe_interval
        self._lock = threading.Lock()
        self._state: dict[str, dict] = {}

    def _ensure(self, provider: str) -> dict:
        if provider not in self._state:
            self._state[provider] = {"failures": 0, "probe_successes": 0, "status": self.STATUS_HEALTHY}
        return self._state[provider]

    def record_failure(self, provider: str, reason: str):
        with self._lock:
            s = self._ensure(provider)
            s["failures"] += 1
            s["probe_successes"] = 0
            if s["failures"] >= self._max_failures:
                s["status"] = self.STATUS_UNHEALTHY
                log.info("Provider %s marked UNHEALTHY (%d failures)", provider, s["failures"])

    def record_success(self, provider: str):
        with self._lock:
            s = self._ensure(provider)
            s["failures"] = 0
            if s["status"] != self.STATUS_PROBING:
                s["status"] = self.STATUS_HEALTHY

    def record_probe_success(self, provider: str):
        with self._lock:
            s = self._ensure(provider)
            s["failures"] = 0
            s["probe_successes"] += 1
            if s["probe_successes"] >= self._recovery_probes:
                s["status"] = self.STATUS_HEALTHY
                s["probe_successes"] = 0
                log.info("Provider %s restored to HEALTHY", provider)
            else:
                s["status"] = self.STATUS_PROBING

    def record_probe_failure(self, provider: str):
        with self._lock:
            s = self._ensure(provider)
            s["probe_successes"] = 0
            s["status"] = self.STATUS_UNHEALTHY

    def status(self, provider: str) -> str:
        with self._lock:
            return self._ensure(provider)["status"]

    def should_probe(self, provider: str) -> bool:
        st = self.status(provider)
        return st in (self.STATUS_UNHEALTHY, self.STATUS_PROBING)
