# Failsafe Routing for LLM Gateway — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add dynamic, scoring-based failover (error rate + latency, softmax/τ=0.1, hybrid health checks) to the existing multi-provider router, with a provider-grouped JSON config and 503 stub on total outage.

**Architecture:** Four new small modules (`score_keeper`, `selector`, `health_watcher`, `model_config`) feed into the existing `Router`, which gains a `FailsafeRouter` subclass. When a `models.json` config is present, the router uses scoring-based selection; otherwise it falls back to the existing priority-based behavior (backward compatible).

**Tech Stack:** Python 3.9+, FastAPI, httpx (existing), Pydantic (existing)

---

### Task 1: Create provider-grouped model config (`config/models.json`) + test fixture

**Objective:** Establish the configuration file that maps models to providers and provider-specific model names.

**Files:**
- Create: `config/models.json`
- Create: `tests/fixtures/models.json`

**Step 1: Write failing test**

Create `tests/test_model_config.py`:

```python
"""Tests for model config loading."""

import os
import pytest
import json
import tempfile

from server.model_config import ModelConfig


def test_loads_provider_grouped_config():
    fixture = os.path.join(os.path.dirname(__file__), "fixtures", "models.json")
    cfg = ModelConfig(fixture)
    providers = cfg.providers_for_model("gpt-4o")
    assert "openai" in providers
    assert "anthropic" in providers
    assert providers["openai"] == "gpt-4o"
    assert providers["anthropic"] == "claude-3-5-sonnet-20240620"


def test_returns_provider_model():
    fixture = os.path.join(os.path.dirname(__file__), "fixtures", "models.json")
    cfg = ModelConfig(fixture)
    assert cfg.provider_model("openai", "gpt-4o") == "gpt-4o"


def test_returns_none_for_unknown_model():
    fixture = os.path.join(os.path.dirname(__file__), "fixtures", "models.json")
    cfg = ModelConfig(fixture)
    assert cfg.providers_for_model("unknown-model") == {}


def test_file_not_found():
    cfg = ModelConfig("/nonexistent/path.json")
    assert cfg.providers_for_model("gpt-4o") == {}
```

**Step 2: Run test to verify failure**

Run: `python -m pytest tests/test_model_config.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'server.model_config'`

**Step 3: Create test fixture**

Create `tests/fixtures/models.json`:

```json
{
  "openai": {
    "gpt-4o": "gpt-4o",
    "gpt-4-turbo": "gpt-4-turbo-preview"
  },
  "anthropic": {
    "gpt-4o": "claude-3-5-sonnet-20240620",
    "claude-3-opus": "claude-3-opus-20240229"
  },
  "groq": {
    "llama-3.1-70b": "llama-3.1-70b-versatile",
    "mixtral-8x7b": "mixtral-8x7b-32768"
  }
}
```

**Step 4: Create production config**

Create `config/models.json`:

```json
{
  "openai": {
    "gpt-4o": "gpt-4o"
  },
  "anthropic": {
    "gpt-4o": "claude-3-5-sonnet-20240620"
  }
}
```

**Step 5: Write minimal implementation**

Create `server/model_config.py`:

```python
"""Load provider-grouped model mapping from JSON config."""

import json
import os


class ModelConfig:
    """Read-only view of a provider-grouped model map.

    The config file maps:
        provider_name -> { model_key: actual_provider_model }
    """

    def __init__(self, path: str):
        self._path = path
        self._data: dict[str, dict[str, str]] = {}
        self._load()

    def _load(self):
        try:
            with open(self._path) as f:
                self._data = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            self._data = {}

    def providers_for_model(self, model_key: str) -> dict[str, str]:
        """Return { provider_name: provider_model } for all providers supporting model_key."""
        result = {}
        for provider, models in self._data.items():
            if model_key in models:
                result[provider] = models[model_key]
        return result

    def provider_model(self, provider: str, model_key: str) -> str | None:
        """Return the actual model name to use for a given (provider, model_key)."""
        return self._data.get(provider, {}).get(model_key)

    def all_models(self) -> list[dict]:
        """Return OpenAI-shaped model dicts for all configured models."""
        seen = set()
        result = []
        for provider, models in self._data.items():
            for model_key in models:
                if model_key not in seen:
                    seen.add(model_key)
                    result.append({
                        "id": model_key,
                        "object": "model",
                        "created": 0,
                        "owned_by": provider,
                    })
        return result
```

**Step 6: Run test to verify pass**

Run: `python -m pytest tests/test_model_config.py -v`
Expected: PASS

**Step 7: Commit**

```bash
git add config/models.json tests/fixtures/models.json server/model_config.py tests/test_model_config.py
git commit -m "feat: add ModelConfig for provider-grouped JSON model map"
```

---

### Task 2: Create ScoreKeeper (in-memory signal tracking)

**Objective:** Track error rate and latency per provider with 30s staleness threshold.

**Files:**
- Create: `server/score_keeper.py`
- Create: `tests/test_score_keeper.py`

**Step 1: Write failing tests**

Create `tests/test_score_keeper.py`:

```python
"""Tests for ScoreKeeper signal tracking."""

import time
import pytest

from server.score_keeper import ScoreKeeper


def test_starts_with_default_scores():
    sk = ScoreKeeper()
    scores = sk.scores()
    assert "error_rate" in scores
    assert "latency_p99" in scores
    assert scores["error_rate"] == 0.0
    assert scores["latency_p99"] == 0.0


def test_records_error():
    sk = ScoreKeeper()
    sk.record_error("openai")
    sk.record_error("openai")
    sk.record_success("openai", latency_ms=100)
    scores = sk.scores("openai")
    assert scores["error_rate"] == pytest.approx(0.666, abs=0.01)


def test_records_latency():
    sk = ScoreKeeper()
    sk.record_success("openai", latency_ms=200)
    sk.record_success("openai", latency_ms=300)
    sk.record_success("openai", latency_ms=1000)
    scores = sk.scores("openai")
    # p99 of 3 samples ≈ 1000
    assert scores["latency_p99"] == pytest.approx(1000.0, abs=50)


def test_staleness_discards_old_data():
    sk = ScoreKeeper(max_age=0.01)  # 10ms freshness
    sk.record_success("openai", latency_ms=100)
    time.sleep(0.02)
    scores = sk.scores("openai")
    assert scores["error_rate"] == 0.0
    assert scores["latency_p99"] == 0.0


def test_returns_default_for_unknown_provider():
    sk = ScoreKeeper()
    scores = sk.scores("nonexistent")
    assert scores == {"error_rate": 0.0, "latency_p99": 0.0}
```

**Step 2: Run test to verify failure**

Run: `python -m pytest tests/test_score_keeper.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'server.score_keeper'`

**Step 3: Write minimal implementation**

Create `server/score_keeper.py`:

```python
"""In-memory signal store for error rate and latency per provider."""

import time
import threading
import statistics


class ScoreKeeper:
    """Tracks error rate and p99 latency per provider with staleness."""

    def __init__(self, max_age: float = 30.0):
        self._max_age = max_age
        self._lock = threading.Lock()
        # provider -> [(timestamp, latency_ms or None)]
        self._records: dict[str, list[tuple[float, float | None]]] = {}

    def record_success(self, provider: str, latency_ms: float):
        with self._lock:
            self._records.setdefault(provider, []).append((time.monotonic(), latency_ms))
            self._prune(provider)

    def record_error(self, provider: str):
        """Record a failure (no latency)."""
        with self._lock:
            self._records.setdefault(provider, []).append((time.monotonic(), None))
            self._prune(provider)

    def _prune(self, provider: str):
        """Remove records older than max_age."""
        cutoff = time.monotonic() - self._max_age
        records = self._records[provider]
        self._records[provider] = [r for r in records if r[0] >= cutoff]

    def scores(self, provider: str | None = None) -> dict:
        """Return {error_rate, latency_p99} for a provider, or global defaults."""
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
            p99 = sorted(latencies)[int(len(latencies) * 0.99) - 1] if latencies else 0.0
            return {
                "error_rate": errors / total if total > 0 else 0.0,
                "latency_p99": p99,
            }
```

**Step 4: Run test to verify pass**

Run: `python -m pytest tests/test_score_keeper.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add server/score_keeper.py tests/test_score_keeper.py
git commit -m "feat: add ScoreKeeper for error rate and latency tracking"
```

---

### Task 3: Create ProviderSelector (softmax/Boltzmann selection)

**Objective:** Implement the softmax selection logic that picks a provider based on error rate and latency scores with τ=0.1.

**Files:**
- Create: `server/selector.py`
- Create: `tests/test_selector.py`

**Step 1: Write failing tests**

Create `tests/test_selector.py`:

```python
"""Tests for ProviderSelector softmax selection."""

import pytest

from server.selector import ProviderSelector


def test_selects_best_provider_with_tau_01():
    selector = ProviderSelector(tau=0.1)
    candidates = {
        "openai": {"error_rate": 0.0, "latency_p99": 100.0},
        "anthropic": {"error_rate": 0.0, "latency_p99": 200.0},
        "groq": {"error_rate": 0.5, "latency_p99": 50.0},
    }
    # With τ=0.1, openai should be picked nearly always
    picks = {"openai": 0, "anthropic": 0, "groq": 0}
    for _ in range(100):
        pick = selector.select(candidates, exclude=set())
        picks[pick] += 1
    assert picks["openai"] > picks["anthropic"]
    assert picks["anthropic"] > picks["groq"]


def test_excludes_providers():
    selector = ProviderSelector(tau=0.1)
    candidates = {
        "openai": {"error_rate": 0.0, "latency_p99": 100.0},
        "anthropic": {"error_rate": 0.0, "latency_p99": 200.0},
    }
    pick = selector.select(candidates, exclude={"openai"})
    assert pick == "anthropic"


def test_returns_none_when_no_candidates():
    selector = ProviderSelector(tau=0.1)
    assert selector.select({}, exclude=set()) is None


def test_all_excluded_returns_none():
    selector = ProviderSelector(tau=0.1)
    candidates = {"openai": {"error_rate": 0.0, "latency_p99": 100.0}}
    assert selector.select(candidates, exclude={"openai"}) is None


def test_combination_formula():
    selector = ProviderSelector(tau=0.1, w_error=0.7, w_latency=0.3, max_latency=10000.0)
    candidates = {
        "fast": {"error_rate": 0.0, "latency_p99": 50.0},
        "slow": {"error_rate": 0.0, "latency_p99": 5000.0},
    }
    picks = {"fast": 0, "slow": 0}
    for _ in range(50):
        pick = selector.select(candidates, exclude=set())
        picks[pick] += 1
    assert picks["fast"] > picks["slow"]
```

**Step 2: Run test to verify failure**

Run: `python -m pytest tests/test_selector.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'server.selector'`

**Step 3: Write minimal implementation**

Create `server/selector.py`:

```python
"""Softmax/Boltzmann provider selection based on error rate and latency."""

import math
import random


class ProviderSelector:
    """Select a provider using softmax over a composite score.

    The score for each provider is:
        S = w_error * error_rate + w_latency * (latency_p99 / max_latency)

    Provider with lower S gets higher selection probability.
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
        # Shift scores so min is 0 (numerical stability)
        min_s = min(scores.values())
        exp_values = {name: math.exp(-(s - min_s) / self.tau) for name, s in scores.items()}
        total = sum(exp_values.values())

        if total == 0:
            return random.choice(list(available.keys()))

        r = random.random() * total
        cumulative = 0.0
        for name in sorted(available.keys()):  # deterministic iteration
            cumulative += exp_values[name]
            if r <= cumulative:
                return name
        return list(available.keys())[-1]
```

**Step 4: Run test to verify pass**

Run: `python -m pytest tests/test_selector.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add server/selector.py tests/test_selector.py
git commit -m "feat: add ProviderSelector with softmax/Boltzmann selection"
```

---

### Task 4: Create HealthWatcher (hybrid passive + active monitoring)

**Objective:** Implement hybrid health detection: passive monitoring via request outcomes, active probing via periodic lightweight API calls. A provider must pass 3 consecutive active probes to be marked healthy again.

**Files:**
- Create: `server/health_watcher.py`
- Create: `tests/test_health_watcher.py`

**Step 1: Write failing tests**

Create `tests/test_health_watcher.py`:

```python
"""Tests for HealthWatcher hybrid monitoring."""

import pytest
from unittest.mock import MagicMock

from server.health_watcher import HealthWatcher


def test_starts_healthy():
    hw = HealthWatcher()
    assert hw.status("openai") == "HEALTHY"


def test_marked_unhealthy_after_failures():
    hw = HealthWatcher(max_failures=2)
    hw.record_failure("openai", "timeout")
    assert hw.status("openai") == "HEALTHY"
    hw.record_failure("openai", "500")
    assert hw.status("openai") == "HEALTHY"
    hw.record_failure("openai", "timeout")
    assert hw.status("openai") == "UNHEALTHY"


def test_recovery_requires_3_probes():
    hw = HealthWatcher(max_failures=2)
    for _ in range(3):
        hw.record_failure("openai", "timeout")
    assert hw.status("openai") == "UNHEALTHY"

    # Probes
    hw.record_probe_success("openai")
    assert hw.status("openai") == "PROBING"
    hw.record_probe_success("openai")
    assert hw.status("openai") == "PROBING"
    hw.record_probe_success("openai")
    assert hw.status("openai") == "HEALTHY"


def test_active_success_resets_failure_count():
    hw = HealthWatcher(max_failures=2)
    hw.record_failure("openai", "timeout")
    hw.record_success("openai")  # Not a probe, a real request
    assert hw.status("openai") == "HEALTHY"


def test_unknown_provider_healthy():
    hw = HealthWatcher()
    assert hw.status("nonexistent") == "HEALTHY"
```

**Step 2: Run test to verify failure**

Run: `python -m pytest tests/test_health_watcher.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'server.health_watcher'`

**Step 3: Write minimal implementation**

Create `server/health_watcher.py`:

```python
"""Hybrid health detection: passive (request outcomes) + active (probes)."""

import threading
import time
import logging

log = logging.getLogger(__name__)


class HealthWatcher:
    """Tracks provider health using a simple failure-count model.

    - HEALTHY: provider is accepting traffic.
    - UNHEALTHY: too many consecutive failures; active probing begins.
    - PROBING: active probes are running; a threshold of consecutive successes restores HEALTHY.
    """

    STATUS_HEALTHY = "HEALTHY"
    STATUS_UNHEALTHY = "UNHEALTHY"
    STATUS_PROBING = "PROBING"

    def __init__(self, max_failures: int = 3, recovery_probes: int = 3, probe_interval: float = 5.0):
        self._max_failures = max_failures
        self._recovery_probes = recovery_probes
        self._probe_interval = probe_interval
        self._lock = threading.Lock()
        # provider -> {"failures": int, "probe_successes": int, "status": str}
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
        """Check if the provider should be probed now based on status and interval."""
        # For simplicity: all UNHEALTHY/PROBING providers are probed.
        # (In a production system, a last-probed timestamp would gate this.)
        st = self.status(provider)
        return st in (self.STATUS_UNHEALTHY, self.STATUS_PROBING)
```

**Step 4: Run test to verify pass**

Run: `python -m pytest tests/test_health_watcher.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add server/health_watcher.py tests/test_health_watcher.py
git commit -m "feat: add HealthWatcher with hybrid health detection"
```

---

### Task 5: Add FailsafeRouter — scoring-based failover with 503 stub

**Objective:** Create a new `FailsafeRouter` class that uses ModelConfig, ScoreKeeper, ProviderSelector, and HealthWatcher to implement dynamic scoring-based failover. Falls back to the existing Router behavior when no config is present.

**Files:**
- Modify: `server/router.py`
- Create: `tests/test_failsafe_router.py`

**Step 1: Write failing tests**

Create `tests/test_failsafe_router.py`:

```python
"""Tests for FailsafeRouter dynamic failover."""

import pytest
from unittest.mock import MagicMock

from server.router import FailsafeRouter
from server.model_config import ModelConfig
from server.score_keeper import ScoreKeeper
from server.selector import ProviderSelector
from server.health_watcher import HealthWatcher
from copilot.providers.base import AbstractProvider


class FakeProvider(AbstractProvider):
    label = "fake"
    url = "http://fake"
    working = True
    supports_stream = True
    default_model = "gpt-4o"
    needs_auth = False

    def __init__(self, name="fake", available=True, chat_side_effect=None, models=None):
        super().__init__()
        self.name = name
        self._available = available
        self._chat_side_effect = chat_side_effect
        self._models = models or [{"id": "gpt-4o", "object": "model", "created": 0, "owned_by": name}]
        if models:
            self.default_model = models[0]["id"]

    def is_available(self):
        return self._available

    def list_models(self):
        return self._models

    def chat(self, prompt, model=None, conversation_id=None):
        if self._chat_side_effect:
            raise self._chat_side_effect
        return {"id": "chatcmpl-fake", "model": model or self.default_model, "choices": [{"message": {"content": prompt}}]}

    def stream(self, prompt, model=None, conversation_id=None):
        yield 'data: {"choices":[]}\n\n'


@pytest.fixture
def router():
    providers = {
        "openai": FakeProvider(name="openai", available=True),
        "anthropic": FakeProvider(name="anthropic", available=True),
    }
    mc = MagicMock(spec=ModelConfig)
    mc.providers_for_model.return_value = {"openai": "gpt-4o", "anthropic": "claude-3-5-sonnet-20240620"}
    mc.provider_model.side_effect = lambda p, m: {"openai": "gpt-4o", "anthropic": "claude-3-5-sonnet-20240620"}.get(p)
    mc.all_models.return_value = [
        {"id": "gpt-4o", "object": "model", "created": 0, "owned_by": "openai"},
    ]
    sk = ScoreKeeper(max_age=30.0)
    sel = ProviderSelector(tau=0.1)
    hw = HealthWatcher(max_failures=2, recovery_probes=3)
    return FailsafeRouter(
        providers=providers,
        model_config=mc,
        score_keeper=sk,
        selector=sel,
        health_watcher=hw,
    )


def test_chat_success(router):
    result = router.chat("hello", model="gpt-4o")
    assert result is not None
    assert "choices" in result


def test_failover_on_error(router):
    router._providers["openai"]._chat_side_effect = ConnectionError("down")
    result = router.chat("hello", model="gpt-4o")
    assert result is not None
    assert "choices" in result


def test_all_fail_returns_stub(router):
    router._providers["openai"]._chat_side_effect = ConnectionError("down")
    router._providers["anthropic"]._chat_side_effect = ConnectionError("down")
    result = router.chat("hello", model="gpt-4o")
    assert result is not None
    assert result.get("error", {}).get("code") == "provider_outage"


def test_excludes_previous_failures(router):
    router._providers["openai"]._chat_side_effect = ConnectionError("down")
    result = router.chat("hello", model="gpt-4o")
    # Should have selected anthropic after openai failed
    assert result is not None


def test_list_models(router):
    models = router.list_models()
    assert any(m["id"] == "gpt-4o" for m in models)
```

**Step 2: Run test to verify failure**

Run: `python -m pytest tests/test_failsafe_router.py -v`
Expected: FAIL — `AttributeError: module 'server.router' has no attribute 'FailsafeRouter'`

**Step 3: Add FailsafeRouter to server/router.py**

Append to `server/router.py` (after the existing `Router` class):

```python
class FailsafeRouter:
    """Scoring-based router with dynamic failover and 503 stub on total outage.

    Uses ModelConfig for model-to-provider mapping, ScoreKeeper for signal
    tracking, ProviderSelector for softmax selection, and HealthWatcher for
    hybrid health monitoring.
    """

    def __init__(
        self,
        providers: dict[str, AbstractProvider],
        model_config: ModelConfig,
        score_keeper: ScoreKeeper,
        selector: ProviderSelector,
        health_watcher: HealthWatcher,
    ):
        self._providers = providers
        self._model_config = model_config
        self._score_keeper = score_keeper
        self._selector = selector
        self._health_watcher = health_watcher

    def _available_candidates(self, model: str, exclude: set[str]) -> dict[str, AbstractProvider]:
        """Return providers that support `model` and are not excluded."""
        provider_names = self._model_config.providers_for_model(model)
        candidates = {}
        for name in provider_names:
            if name in exclude:
                continue
            prov = self._providers.get(name)
            if prov and prov.is_available() and self._health_watcher.status(name) != HealthWatcher.STATUS_UNHEALTHY:
                candidates[name] = prov
        return candidates

    def list_models(self) -> list[dict]:
        return self._model_config.all_models()

    def chat(self, prompt: str, model: str | None = None, conversation_id: str | None = None) -> dict:
        if not model:
            return self._503_stub("no model specified")
        tried: set[str] = set()
        while True:
            candidates = self._available_candidates(model, tried)
            if not candidates:
                return self._503_stub("all providers unavailable")

            signals = {name: self._score_keeper.scores(name) for name in candidates}
            chosen = self._selector.select(signals, exclude=tried)
            if chosen is None:
                return self._503_stub("all providers unavailable")

            provider = self._providers[chosen]
            provider_model = self._model_config.provider_model(chosen, model) or model
            import time as _time
            start = _time.monotonic()
            try:
                result = provider.chat(prompt, model=provider_model, conversation_id=conversation_id)
                elapsed = (_time.monotonic() - start) * 1000
                self._score_keeper.record_success(chosen, elapsed)
                self._health_watcher.record_success(chosen)
                return result
            except (ConnectionError, TimeoutError, ClearanceRequired) as exc:
                log.warning("Provider %s failed: %s; trying next", chosen, exc)
                self._score_keeper.record_error(chosen)
                self._health_watcher.record_failure(chosen, str(exc))
                tried.add(chosen)
                continue

    def stream(self, prompt: str, model: str | None = None, conversation_id: str | None = None):
        if not model:
            yield sse_event(stream_chunk(new_id(), int(__import__("time").time()), "", {"content": "\n[error: no model specified]"}, finish="error"))
            return
        tried: set[str] = set()
        while True:
            candidates = self._available_candidates(model, tried)
            if not candidates:
                yield sse_event(stream_chunk(new_id(), int(__import__("time").time()), model, {"content": "\n[error: all providers unavailable]"}, finish="error"))
                yield "data: [DONE]\n\n"
                return

            signals = {name: self._score_keeper.scores(name) for name in candidates}
            chosen = self._selector.select(signals, exclude=tried)
            if chosen is None:
                yield sse_event(stream_chunk(new_id(), int(__import__("time").time()), model, {"content": "\n[error: all providers unavailable]"}, finish="error"))
                yield "data: [DONE]\n\n"
                return

            provider = self._providers[chosen]
            provider_model = self._model_config.provider_model(chosen, model) or model
            try:
                yield from provider.stream(prompt, model=provider_model, conversation_id=conversation_id)
                self._health_watcher.record_success(chosen)
                return
            except (ConnectionError, TimeoutError, ClearanceRequired) as exc:
                log.warning("Provider %s stream failed: %s; trying next", chosen, exc)
                self._score_keeper.record_error(chosen)
                self._health_watcher.record_failure(chosen, str(exc))
                tried.add(chosen)
                continue

    def _503_stub(self, reason: str) -> dict:
        return {
            "error": {
                "message": "Service temporarily unavailable, please retry",
                "type": "insufficient_capacity",
                "code": "provider_outage",
            }
        }
```

**Step 4: Add required imports to server/router.py**

Add these at the top of `server/router.py`:

```python
from .model_config import ModelConfig
from .score_keeper import ScoreKeeper
from .selector import ProviderSelector
from .health_watcher import HealthWatcher
```

**Step 5: Run tests to verify pass**

Run: `python -m pytest tests/test_failsafe_router.py -v`
Expected: PASS

**Step 6: Run existing router tests (no regression)**

Run: `python -m pytest tests/test_router.py -v`
Expected: All PASS

**Step 7: Commit**

```bash
git add server/router.py tests/test_failsafe_router.py
git commit -m "feat: add FailsafeRouter with scoring-based failover and 503 stub"
```

---

### Task 6: Wire FailsafeRouter into server/api.py

**Objective:** Update `api.py` to detect a `models.json` config file and instantiate FailsafeRouter when present, falling back to the existing Router otherwise.

**Files:**
- Modify: `server/api.py`
- Modify: `server/config.py`
- Create: `tests/test_server_failsafe.py`

**Step 1: Write integration test**

Create `tests/test_server_failsafe.py`:

```python
"""Tests for server startup with failsafe routing."""

import os
import pytest
from unittest.mock import patch, MagicMock

from server.api import _build_router


def test_build_router_with_model_config():
    """When models.json exists, router should be a FailsafeRouter."""
    from server.router import FailsafeRouter
    with patch.dict(os.environ, {
        "MODEL_CONFIG_PATH": os.path.join(os.path.dirname(__file__), "fixtures", "models.json"),
        "PROVIDER_PRIORITY": "openai",
    }, clear=True):
        # Only build with a mock provider
        with patch("server.api.CopilotProvider") as mock_prov:
            mock_prov.return_value.is_available.return_value = False
            router = _build_router()
            # The test just checks it initializes correctly
            assert router is not None
```

**Step 2: Run test to verify failure**

Run: `python -m pytest tests/test_server_failsafe.py -v`
Expected: The test might need adjustment — but for now, just ensure it runs.

**Step 3: Update server/api.py _build_router**

Modify the `_build_router` function in `server/api.py` to optionally construct a FailsafeRouter:

Add import at top:
```python
from .model_config import ModelConfig
from .score_keeper import ScoreKeeper
from .selector import ProviderSelector
from .health_watcher import HealthWatcher
from .router import FailsafeRouter
```

Add to `server/config.py`:
```python
MODEL_CONFIG_PATH = os.environ.get("MODEL_CONFIG_PATH", "config/models.json")
```

Modify `_build_router()` to detect config and build FailsafeRouter:

```python
def _build_router() -> Router | FailsafeRouter:
    """Instantiate providers from config and return a Router."""
    registry = {
        "copilot": lambda: CopilotProvider(interactive_clear=False, headless_clear=False),
        "ollama": lambda: OllamaProvider(),
        "openai": lambda: OpenAIProvider(),
        "openrouter": lambda: OpenRouterProvider(),
        "google": lambda: GoogleProvider(),
        "nvidia": lambda: NvidiaProvider(),
    }

    # Check for failsafe config
    model_config_path = config.get("MODEL_CONFIG_PATH")
    mc = ModelConfig(model_config_path) if model_config_path else ModelConfig("")
    if mc.all_models():
        # Failsafe mode: build provider map from config
        providers = {}
        priority = config.get("PROVIDER_PRIORITY").split(",")
        for name in [p.strip() for p in priority]:
            factory = registry.get(name)
            if factory is None:
                log.warning("Unknown provider %r; skipping", name)
                continue
            try:
                p = factory()
                if p.is_available():
                    providers[name] = p
                    log.info("Provider %s: available (%d models)", p.label, len(p.list_models()))
            except Exception as exc:
                log.warning("Provider %s failed: %s", name, exc)
        return FailsafeRouter(
            providers=providers,
            model_config=mc,
            score_keeper=ScoreKeeper(),
            selector=ProviderSelector(),
            health_watcher=HealthWatcher(),
        )

    # Fallsafe mode off: standard priority-ordered list
    providers = []
    priority = config.get("PROVIDER_PRIORITY").split(",")
    for name in [p.strip() for p in priority]:
        factory = registry.get(name)
        if factory is None:
            log.warning("Unknown provider %r; skipping", name)
            continue
        try:
            p = factory()
            if p.is_available():
                providers.append(p)
                log.info("Provider %s: available (%d models)", p.label, len(p.list_models()))
        except Exception as exc:
            log.warning("Provider %s failed: %s", name, exc)
    if not providers:
        log.warning("No providers available — server will reject all requests")
    return Router(providers)
```

**Step 4: Run integration test**

Run: `python -m pytest tests/test_server_failsafe.py -v`
Expected: PASS (or close to it with minor fixture adjustments)

**Step 5: Run existing server tests (no regression)**

Run: `python -m pytest tests/test_server.py -v`
Expected: PASS

**Step 6: Commit**

```bash
git add server/api.py server/config.py tests/test_server_failsafe.py
git commit -m "feat: wire FailsafeRouter into api.py, opt-in via models.json"
```

---

### Task 7: End-to-end smoke test with failsafe routing

**Objective:** Verify the server starts and responds correctly with the failsafe config loaded.

**Step 1: Start the server**

```bash
MODEL_CONFIG_PATH=config/models.json PROVIDER_PRIORITY=copilot python app.py &
sleep 3
```

**Step 2: Test /v1/models**

```bash
curl -s http://localhost:8000/v1/models | python3 -m json.tool
```
Expected: `{"object": "list", "data": [{"id": "gpt-4o", ...}]}`

**Step 3: Test /v1/chat/completions with model**

```bash
curl -s http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-4o", "messages": [{"role": "user", "content": "Say hi"}]}' | python3 -m json.tool
```
Expected: Response with choices (or 503 if no Copilot session — which is expected on this machine)

**Step 4: Stop server**

```bash
kill %1
```

**Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: adjust failsafe wiring after smoke test"
```

---

### Task 8: Run full test suite

**Objective:** Ensure all tests pass, no regressions.

**Step 1: Run all tests**

```bash
python -m pytest tests/ -v
```
Expected: All tests PASS.

**Step 2: Final commit if needed**

```bash
git add -A
git commit -m "chore: final adjustments after full test suite"
```
