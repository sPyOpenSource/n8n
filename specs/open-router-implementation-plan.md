# Open Router Functionality — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add multi-provider routing (Copilot, Ollama, OpenAI) with automatic failover to the existing OpenAI-compatible server.

**Architecture:** A `Router` class sits between `server/api.py` and a pool of `AbstractProvider` instances. Each provider implements `is_available()`, `list_models()`, `chat()`, and `stream()`. The router iterates providers in configured priority order, failing over on transient errors. Config is env-var-only.

**Tech Stack:** Python 3.9+, FastAPI, curl_cffi (existing), httpx (new — for Ollama/OpenAI provider HTTP calls)

---

### Task 1: Create providers package structure

**Objective:** Set up the `copilot/providers/` package with the extended `AbstractProvider` base class.

**Files:**
- Create: `copilot/providers/__init__.py`
- Create: `copilot/providers/base.py`

**Step 1: Create `copilot/providers/base.py`**

```python
"""Extended provider interface for multi-provider routing."""

import threading
from abc import ABC, abstractmethod
from typing import Generator


class AbstractProvider(ABC):
    """Interface every provider must implement.

    Subclasses define how to check availability, list models, and execute
    chat/stream requests. The router calls these methods; providers raise
    exceptions on failure and the router decides whether to fail over.
    """

    label: str
    url: str
    working: bool
    supports_stream: bool
    default_model: str
    needs_auth: bool = True
    _lock: threading.Lock = None

    def __init__(self):
        self._lock = threading.Lock()

    @abstractmethod
    def is_available(self) -> bool:
        """Return True if this provider is ready to serve requests."""
        ...

    @abstractmethod
    def list_models(self) -> list[dict]:
        """Return OpenAI-shaped model dicts for GET /v1/models."""
        ...

    @abstractmethod
    def chat(self, prompt: str, model: str, conversation_id: str | None = None) -> dict:
        """Return a non-streaming chat completion dict (OpenAI shape)."""
        ...

    @abstractmethod
    def stream(self, prompt: str, model: str, conversation_id: str | None = None) -> Generator:
        """Yield SSE-formatted chat completion chunk strings."""
        ...
```

**Step 2: Create `copilot/providers/__init__.py`**

```python
from .base import AbstractProvider

__all__ = ["AbstractProvider"]
```

**Step 3: Commit**

```bash
git add copilot/providers/
git commit -m "feat: add providers package with AbstractProvider base class"
```

---

### Task 2: Implement CopilotProvider

**Objective:** Wrap the existing `CopilotClient` as a provider, moving the serialization lock from `api.py` into the provider.

**Files:**
- Create: `copilot/providers/copilot_provider.py`

**Step 1: Write failing test**

Create `tests/test_copilot_provider.py`:

```python
"""Tests for CopilotProvider."""

import pytest
from copilot.providers.copilot_provider import CopilotProvider


def test_is_available():
    p = CopilotProvider()
    assert p.is_available() is True


def test_list_models():
    p = CopilotProvider()
    models = p.list_models()
    assert len(models) == 1
    assert models[0]["id"] == "copilot"
    assert models[0]["owned_by"] == "microsoft"


def test_has_lock():
    p = CopilotProvider()
    assert p._lock is not None
```

**Step 2: Run test to verify failure**

Run: `python -m pytest tests/test_copilot_provider.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'copilot.providers.copilot_provider'`

**Step 3: Write implementation**

Create `copilot/providers/copilot_provider.py`:

```python
"""Copilot provider — wraps the existing CopilotClient."""

import json
import time

from copilot.client import CopilotClient
from copilot.driver import ClearanceRequired

from .base import AbstractProvider


class CopilotProvider(AbstractProvider):
    """Provider backed by the signed-in Copilot session."""

    label = "Microsoft Copilot"
    url = "https://copilot.microsoft.com"
    working = True
    supports_stream = True
    default_model = "copilot"
    needs_auth = False

    def __init__(self, interactive_clear=False, headless_clear=False):
        super().__init__()
        self._client = CopilotClient(
            interactive_clear=interactive_clear,
            headless_clear=headless_clear,
        )

    def is_available(self) -> bool:
        return True

    def list_models(self) -> list[dict]:
        return [
            {"id": self.default_model, "object": "model", "created": 0, "owned_by": "microsoft"}
        ]

    def chat(self, prompt: str, model: str, conversation_id: str | None = None) -> dict:
        with self._lock:
            reply = self._client.chat(prompt, conversation_id=conversation_id)
        return {
            "id": "chatcmpl-copilot",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": model or self.default_model,
            "conversation_id": reply.conversation_id,
            "choices": [
                {"index": 0, "message": {"role": "assistant", "content": reply.text}, "finish_reason": "stop"}
            ],
            "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
        }

    def stream(self, prompt: str, model: str, conversation_id: str | None = None):
        from server.openai_format import new_id, sse_event, stream_chunk

        cid = new_id()
        created = int(time.time())
        with self._lock:
            try:
                yield sse_event(stream_chunk(cid, created, model, {"role": "assistant"}))
                stream = self._client.stream(prompt, conversation_id=conversation_id)
                for piece in stream:
                    if isinstance(piece, str) and piece:
                        yield sse_event(stream_chunk(cid, created, model, {"content": piece}))
                yield sse_event(
                    stream_chunk(cid, created, model, {}, finish="stop",
                                 conversation_id=stream.conversation_id)
                )
            except ClearanceRequired:
                yield sse_event(
                    stream_chunk(cid, created, model,
                                 {"content": "\n[error: Cloudflare clearance expired]"},
                                 finish="error")
                )
            except Exception as exc:
                yield sse_event(
                    stream_chunk(cid, created, model,
                                 {"content": f"\n[error: {exc}]"},
                                 finish="error")
                )
        yield "data: [DONE]\n\n"
```

**Step 4: Run tests**

Run: `python -m pytest tests/test_copilot_provider.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add copilot/providers/copilot_provider.py tests/test_copilot_provider.py
git commit -m "feat: add CopilotProvider wrapping existing CopilotClient"
```

---

### Task 3: Implement OllamaProvider

**Objective:** Create a provider that talks to a local Ollama instance via its REST API.

**Files:**
- Create: `copilot/providers/ollama_provider.py`
- Create: `tests/test_ollama_provider.py`

**Step 1: Write failing tests**

Create `tests/test_ollama_provider.py`:

```python
"""Tests for OllamaProvider."""

import os
import pytest
from unittest.mock import patch, MagicMock
from copilot.providers.ollama_provider import OllamaProvider


def test_is_available_no_server():
    p = OllamaProvider(base_url="http://localhost:99999")
    assert p.is_available() is False


def test_is_available_with_key(monkeypatch):
    monkeypatch.setenv("OLLAMA_BASE_URL", "http://localhost:11434")
    p = OllamaProvider()
    assert p.base_url == "http://localhost:11434"


def test_list_models_format():
    p = OllamaProvider(base_url="http://localhost:11434")
    with patch.object(p, "_get") as mock_get:
        mock_get.return_value = MagicMock(
            status_code=200,
            json=lambda: {"models": [{"name": "llama3"}, {"name": "mistral"}]}
        )
        models = p.list_models()
    assert len(models) == 2
    assert models[0]["id"] == "llama3"
    assert models[0]["owned_by"] == "ollama"


def test_is_available_caches(monkeypatch):
    p = OllamaProvider(base_url="http://localhost:11434")
    p._available = False
    p._available_checked_at = 0  # force recheck
    with patch.object(p, "_get", side_effect=ConnectionError):
        assert p.is_available() is False
```

**Step 2: Run test to verify failure**

Run: `python -m pytest tests/test_ollama_provider.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'copilot.providers.ollama_provider'`

**Step 3: Write implementation**

Create `copilot/providers/ollama_provider.py`:

```python
"""Ollama provider — talks to a local Ollama instance via its REST API."""

import json
import os
import time

import httpx

from .base import AbstractProvider


class OllamaProvider(AbstractProvider):
    """Provider backed by a local Ollama server."""

    label = "Ollama"
    url = "http://localhost:11434"
    working = True
    supports_stream = True
    default_model = "llama3"
    needs_auth = False

    _AVAILABILITY_TTL = 30  # seconds between availability probes

    def __init__(self, base_url: str | None = None):
        super().__init__()
        self.base_url = (base_url or os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")).rstrip("/")
        self._available = False
        self._available_checked_at = 0.0
        self._client = httpx.Client(timeout=120.0)

    def _get(self, path: str):
        return self._client.get(f"{self.base_url}{path}")

    def _post(self, path: str, payload: dict):
        return self._client.post(f"{self.base_url}{path}", json=payload)

    def is_available(self) -> bool:
        now = time.time()
        if now - self._available_checked_at < self._AVAILABILITY_TTL:
            return self._available
        try:
            resp = self._get("/api/tags")
            self._available = resp.status_code == 200
        except (httpx.ConnectError, httpx.TimeoutException):
            self._available = False
        self._available_checked_at = now
        return self._available

    def list_models(self) -> list[dict]:
        try:
            resp = self._get("/api/tags")
            resp.raise_for_status()
            names = [m["name"] for m in resp.json().get("models", [])]
        except Exception:
            names = []
        return [
            {"id": name, "object": "model", "created": 0, "owned_by": "ollama"}
            for name in names
        ]

    def chat(self, prompt: str, model: str, conversation_id: str | None = None) -> dict:
        resp = self._post("/api/chat", {
            "model": model or self.default_model,
            "messages": [{"role": "user", "content": prompt}],
            "stream": False,
        })
        resp.raise_for_status()
        data = resp.json()
        text = data.get("message", {}).get("content", "")
        return {
            "id": "chatcmpl-ollama",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": model or self.default_model,
            "choices": [
                {"index": 0, "message": {"role": "assistant", "content": text}, "finish_reason": "stop"}
            ],
            "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
        }

    def stream(self, prompt: str, model: str, conversation_id: str | None = None):
        from server.openai_format import new_id, sse_event, stream_chunk

        cid = new_id()
        created = int(time.time())
        m = model or self.default_model
        with self._client.stream("POST", f"{self.base_url}/api/chat", json={
            "model": m,
            "messages": [{"role": "user", "content": prompt}],
            "stream": True,
        }) as resp:
            resp.raise_for_status()
            yield sse_event(stream_chunk(cid, created, m, {"role": "assistant"}))
            for line in resp.iter_lines():
                if not line:
                    continue
                try:
                    chunk = json.loads(line)
                except json.JSONDecodeError:
                    continue
                text = chunk.get("message", {}).get("content", "")
                if text:
                    yield sse_event(stream_chunk(cid, created, m, {"content": text}))
                if chunk.get("done"):
                    yield sse_event(stream_chunk(cid, created, m, {}, finish="stop"))
        yield "data: [DONE]\n\n"
```

**Step 4: Install httpx**

Run: `pip install httpx`

**Step 5: Add httpx to requirements.txt**

Add `httpx>=0.27` to `requirements.txt`.

**Step 6: Run tests**

Run: `python -m pytest tests/test_ollama_provider.py -v`
Expected: PASS

**Step 7: Commit**

```bash
git add copilot/providers/ollama_provider.py tests/test_ollama_provider.py requirements.txt
git commit -m "feat: add OllamaProvider with REST API integration"
```

---

### Task 4: Implement OpenAIProvider

**Objective:** Create a provider that proxies requests to the official OpenAI API.

**Files:**
- Create: `copilot/providers/openai_provider.py`
- Create: `tests/test_openai_provider.py`

**Step 1: Write failing tests**

Create `tests/test_openai_provider.py`:

```python
"""Tests for OpenAIProvider."""

import os
import pytest
from unittest.mock import patch, MagicMock
from copilot.providers.openai_provider import OpenAIProvider


def test_is_available_no_key():
    with patch.dict(os.environ, {}, clear=True):
        p = OpenAIProvider()
        assert p.is_available() is False


def test_is_available_with_key(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    p = OpenAIProvider()
    assert p.is_available() is True


def test_list_models_default():
    with patch.dict(os.environ, {}, clear=True):
        p = OpenAIProvider()
        models = p.list_models()
    ids = [m["id"] for m in models]
    assert "gpt-4o" in ids
    assert "gpt-4o-mini" in ids
    assert "o3-mini" in ids


def test_list_models_custom(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.setenv("OPENAI_MODELS", "gpt-4o,gpt-4")
    p = OpenAIProvider()
    models = p.list_models()
    ids = [m["id"] for m in models]
    assert ids == ["gpt-4o", "gpt-4"]
    for m in models:
        assert m["owned_by"] == "openai"
```

**Step 2: Run test to verify failure**

Run: `python -m pytest tests/test_openai_provider.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'copilot.providers.openai_provider'`

**Step 3: Write implementation**

Create `copilot/providers/openai_provider.py`:

```python
"""OpenAI provider — proxies requests to the official OpenAI API."""

import json
import os
import time

import httpx

from .base import AbstractProvider


class OpenAIProvider(AbstractProvider):
    """Provider backed by the official OpenAI API."""

    label = "OpenAI"
    url = "https://api.openai.com"
    working = True
    supports_stream = True
    default_model = "gpt-4o"
    needs_auth = True

    def __init__(self):
        super().__init__()
        self._api_key = os.environ.get("OPENAI_API_KEY", "")
        self._base_url = (os.environ.get("OPENAI_BASE_URL", "https://api.openai.com")).rstrip("/")
        self._org_id = os.environ.get("OPENAI_ORG_ID", "")
        self._models_str = os.environ.get("OPENAI_MODELS", "gpt-4o,gpt-4o-mini,o3-mini")
        self._client = httpx.Client(timeout=120.0)

    def _headers(self) -> dict:
        h = {"Authorization": f"Bearer {self._api_key}"}
        if self._org_id:
            h["OpenAI-Organization"] = self._org_id
        return h

    def is_available(self) -> bool:
        return bool(self._api_key)

    def list_models(self) -> list[dict]:
        names = [n.strip() for n in self._models_str.split(",") if n.strip()]
        return [
            {"id": name, "object": "model", "created": 0, "owned_by": "openai"}
            for name in names
        ]

    def chat(self, prompt: str, model: str, conversation_id: str | None = None) -> dict:
        resp = self._client.post(
            f"{self._base_url}/v1/chat/completions",
            headers=self._headers(),
            json={
                "model": model or self.default_model,
                "messages": [{"role": "user", "content": prompt}],
                "stream": False,
            },
        )
        resp.raise_for_status()
        return resp.json()

    def stream(self, prompt: str, model: str, conversation_id: str | None = None):
        with self._client.stream(
            "POST",
            f"{self._base_url}/v1/chat/completions",
            headers=self._headers(),
            json={
                "model": model or self.default_model,
                "messages": [{"role": "user", "content": prompt}],
                "stream": True,
            },
        ) as resp:
            resp.raise_for_status()
            for line in resp.iter_lines():
                if not line:
                    continue
                if line.startswith("data: "):
                    yield line + "\n\n"
                    if line == "data: [DONE]":
                        return
```

**Step 4: Run tests**

Run: `python -m pytest tests/test_openai_provider.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add copilot/providers/openai_provider.py tests/test_openai_provider.py
git commit -m "feat: add OpenAIProvider with API passthrough"
```

---

### Task 5: Implement the Router

**Objective:** Create the `Router` class that holds the provider pool, routes requests, and handles failover.

**Files:**
- Create: `server/router.py`
- Create: `tests/test_router.py`

**Step 1: Write failing tests**

Create `tests/test_router.py`:

```python
"""Tests for the Router."""

import pytest
from unittest.mock import MagicMock, patch
from server.router import Router
from copilot.providers.base import AbstractProvider


class FakeProvider(AbstractProvider):
    label = "fake"
    url = "http://fake"
    working = True
    supports_stream = True
    default_model = "fake-model"
    needs_auth = False

    def __init__(self, available=True, models=None, chat_side_effect=None):
        super().__init__()
        self._available = available
        self._models = models or [{"id": self.default_model, "object": "model", "created": 0, "owned_by": "fake"}]
        self._chat_side_effect = chat_side_effect

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


def test_iterates_priority_order():
    p1 = FakeProvider(available=True, models=[{"id": "a", "object": "model", "created": 0, "owned_by": "x"}])
    p2 = FakeProvider(available=True, models=[{"id": "b", "object": "model", "created": 0, "owned_by": "y"}])
    r = Router([p1, p2])
    result = r.chat("hello")
    assert result["model"] == "a"


def test_skips_unavailable():
    p1 = FakeProvider(available=False)
    p2 = FakeProvider(available=True, models=[{"id": "b", "object": "model", "created": 0, "owned_by": "y"}])
    r = Router([p1, p2])
    result = r.chat("hello")
    assert result["model"] == "b"


def test_failover_on_connection_error():
    p1 = FakeProvider(available=True, chat_side_effect=ConnectionError("down"))
    p2 = FakeProvider(available=True, models=[{"id": "b", "object": "model", "created": 0, "owned_by": "y"}])
    r = Router([p1, p2])
    result = r.chat("hello")
    assert result["model"] == "b"


def test_returns_last_error_when_all_fail():
    p1 = FakeProvider(available=True, chat_side_effect=ConnectionError("err1"))
    p2 = FakeProvider(available=True, chat_side_effect=ConnectionError("err2"))
    r = Router([p1, p2])
    with pytest.raises(ConnectionError, match="err2"):
        r.chat("hello")


def test_aggregates_models():
    p1 = FakeProvider(available=True, models=[{"id": "a", "object": "model", "created": 0, "owned_by": "x"}])
    p2 = FakeProvider(available=True, models=[{"id": "b", "object": "model", "created": 0, "owned_by": "y"}])
    r = Router([p1, p2])
    models = r.list_models()
    ids = [m["id"] for m in models]
    assert "a" in ids
    assert "b" in ids


def test_model_specific_routing():
    p1 = FakeProvider(available=True, models=[{"id": "copilot", "object": "model", "created": 0, "owned_by": "microsoft"}])
    p2 = FakeProvider(available=True, models=[{"id": "llama3", "object": "model", "created": 0, "owned_by": "ollama"}])
    r = Router([p1, p2])
    result = r.chat("hello", model="llama3")
    assert result["model"] == "llama3"
```

**Step 2: Run test to verify failure**

Run: `python -m pytest tests/test_router.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'server.router'`

**Step 3: Write implementation**

Create `server/router.py`:

```python
"""Router — dispatches requests across a provider pool with failover."""

import logging
from typing import Generator

from copilot.driver import ClearanceRequired
from copilot.providers.base import AbstractProvider

log = logging.getLogger(__name__)


class Router:
    """Holds a priority-ordered list of providers and routes requests.

    On each request, iterates providers in order. If a provider raises a
    transient error (ConnectionError, ClearanceRequired), tries the next.
    If all fail, re-raises the last error.
    """

    def __init__(self, providers: list[AbstractProvider]):
        self._providers = providers
        self._model_to_provider: dict[str, AbstractProvider] = {}
        for p in providers:
            for m in p.list_models():
                mid = m["id"]
                if mid not in self._model_to_provider:
                    self._model_to_provider[mid] = p

    def _active_providers(self) -> list[AbstractProvider]:
        return [p for p in self._providers if p.is_available()]

    def list_models(self) -> list[dict]:
        seen = set()
        result = []
        for p in self._active_providers():
            for m in p.list_models():
                if m["id"] not in seen:
                    seen.add(m["id"])
                    result.append(m)
        return result

    def chat(self, prompt: str, model: str | None = None, conversation_id: str | None = None) -> dict:
        if model and model in self._model_to_provider:
            provider = self._model_to_provider[model]
            if provider.is_available():
                return provider.chat(prompt, model=model, conversation_id=conversation_id)

        last_err = None
        for provider in self._active_providers():
            try:
                return provider.chat(prompt, model=model or provider.default_model, conversation_id=conversation_id)
            except (ConnectionError, ClearanceRequired, TimeoutError) as exc:
                log.warning("Provider %s failed: %s; trying next", provider.label, exc)
                last_err = exc
                continue
        if last_err is not None:
            raise last_err
        raise RuntimeError("No providers available")

    def stream(self, prompt: str, model: str | None = None, conversation_id: str | None = None) -> Generator:
        if model and model in self._model_to_provider:
            provider = self._model_to_provider[model]
            if provider.is_available():
                yield from provider.stream(prompt, model=model, conversation_id=conversation_id)
                return

        for provider in self._active_providers():
            try:
                yield from provider.stream(prompt, model=model or provider.default_model, conversation_id=conversation_id)
                return
            except (ConnectionError, ClearanceRequired, TimeoutError) as exc:
                log.warning("Provider %s failed: %s; trying next", provider.label, exc)
                continue
        raise RuntimeError("No providers available")
```

**Step 4: Run tests**

Run: `python -m pytest tests/test_router.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add server/router.py tests/test_router.py
git commit -m "feat: add Router with provider pool and failover logic"
```

---

### Task 6: Wire Router into api.py

**Objective:** Replace the hardcoded `CopilotClient` in `server/api.py` with the router, preserving backward compatibility.

**Files:**
- Modify: `server/api.py`
- Modify: `server/config.py`

**Step 1: Add provider config to `server/config.py`**

Append to `server/config.py`:

```python
PROVIDER_PRIORITY = [p.strip() for p in os.environ.get("PROVIDER_PRIORITY", "copilot,ollama,openai").split(",")]
```

**Step 2: Rewrite `server/api.py` to use the router**

Replace the existing file content. Key changes:
- Remove the hardcoded `client = CopilotClient(...)` and `_upstream_lock`
- Import and instantiate the router from configured providers
- `chat_completions` delegates to `router.chat()` / `router.stream()`
- `list_models` delegates to `router.list_models()`

The new `server/api.py`:

```python
"""FastAPI app wiring multiple providers onto the OpenAI Chat Completions API."""

import logging

from fastapi import FastAPI
from fastapi.responses import JSONResponse, StreamingResponse

from copilot.driver import ClearanceRequired
from copilot.providers.copilot_provider import CopilotProvider
from copilot.providers.ollama_provider import OllamaProvider
from copilot.providers.openai_provider import OpenAIProvider

from .config import MODEL_NAME, PROVIDER_PRIORITY, RATE_LIMIT_BURST, RATE_LIMIT_RPM
from .openai_format import completion_response, new_id, sse_event, stream_chunk
from .prompt import messages_to_prompt
from .ratelimit import TokenBucket
from .router import Router
from .schemas import ChatCompletionRequest

app = FastAPI(title="Copilot OpenAI-compatible API", version="1.0.0")

log = logging.getLogger(__name__)


def _build_router() -> Router:
    """Instantiate providers from env config and return a Router."""
    registry = {
        "copilot": lambda: CopilotProvider(interactive_clear=False, headless_clear=False),
        "ollama": lambda: OllamaProvider(),
        "openai": lambda: OpenAIProvider(),
    }
    providers = []
    for name in PROVIDER_PRIORITY:
        factory = registry.get(name)
        if factory is None:
            log.warning("Unknown provider %r in PROVIDER_PRIORITY; skipping", name)
            continue
        try:
            p = factory()
            if p.is_available():
                providers.append(p)
                log.info("Provider %s: available (%d models)", p.label, len(p.list_models()))
            else:
                log.info("Provider %s: not available (skipping)", p.label)
        except Exception as exc:
            log.warning("Provider %s failed to initialize: %s; skipping", name, exc)
    if not providers:
        log.warning("No providers available — server will reject all requests")
    return Router(providers)


router = _build_router()

_CLEARANCE_HELP = (
    "Cloudflare clearance expired and could not be refreshed headlessly. "
    "Re-clear in a browser: run `python -m copilot login` (or `python tests/diagnostic.py`) "
    "and pass the 'verify you're human' check, then retry."
)

_rate_limiter = TokenBucket(RATE_LIMIT_RPM, RATE_LIMIT_BURST)


def _rate_limited_response():
    allowed, wait = _rate_limiter.try_acquire()
    if allowed:
        return None
    secs = max(1, round(wait))
    return JSONResponse(
        status_code=429,
        headers={"Retry-After": str(secs)},
        content={"error": {
            "message": f"Rate limit exceeded (>{RATE_LIMIT_RPM:g} req/min). Retry in {secs}s.",
            "type": "rate_limit_error",
            "code": "rate_limit_exceeded",
        }},
    )


def _stream(prompt: str, model: str, conversation_id=None):
    cid = new_id()
    created = int(__import__("time").time())
    try:
        yield from router.stream(prompt, model=model or MODEL_NAME, conversation_id=conversation_id)
    except ClearanceRequired:
        yield sse_event(
            stream_chunk(cid, created, model, {"content": f"\n[error: {_CLEARANCE_HELP}]"}, finish="error")
        )
    except Exception as exc:
        yield sse_event(
            stream_chunk(cid, created, model, {"content": f"\n[error: {exc}]"}, finish="error")
        )


@app.get("/v1/models")
def list_models():
    return {"object": "list", "data": router.list_models()}


@app.get("/v1/models/{model_id:path}")
def get_model_id(model_id: str):
    return {"id": model_id, "object": "model", "created": 0, "owned_by": "unknown"}


@app.get("/api/v1/models")
def list_api_models():
    return {"object": "list", "data": router.list_models()}


@app.get("/v1/probs")
def get_problems():
    return {"problems": []}


@app.post("/api/show")
def post_show():
    return {"show": []}


@app.get("/models")
def get_models():
    return {"object": "list", "data": router.list_models()}


@app.post("/v1/chat/completions")
def chat_completions(req: ChatCompletionRequest):
    prompt = messages_to_prompt(req.messages)
    if not prompt.strip():
        return JSONResponse(
            status_code=400,
            content={"error": {"message": "no text content in messages", "type": "invalid_request_error"}},
        )
    model = req.model or MODEL_NAME

    limited = _rate_limited_response()
    if limited is not None:
        return limited

    if req.stream:
        return StreamingResponse(
            _stream(prompt, model, req.conversation_id), media_type="text/event-stream"
        )

    try:
        result = router.chat(prompt, model=model, conversation_id=req.conversation_id)
    except ClearanceRequired:
        return JSONResponse(
            status_code=503,
            content={"error": {"message": _CLEARANCE_HELP, "type": "clearance_required"}},
        )
    except Exception as exc:
        return JSONResponse(
            status_code=502,
            content={"error": {"message": str(exc), "type": "upstream_error"}},
        )
    return result


@app.get("/version")
def get_version():
    return {"version": app.version}


@app.get("/")
def root():
    return {"service": "Copilot OpenAI-compatible API", "endpoints": ["/v1/models", "/v1/chat/completions", "/version"]}
```

**Step 3: Remove duplicate route in original api.py**

The original `api.py` has `list_models` defined twice (lines 103 and 148). The new version has it once.

**Step 4: Run existing server test**

Run: `python -m pytest tests/test_server.py -v`
Expected: May need adjustment — verify server starts.

**Step 5: Commit**

```bash
git add server/api.py server/config.py
git commit -m "feat: wire Router into api.py, replace hardcoded CopilotClient"
```

---

### Task 7: Update copilot/__init__.py exports

**Objective:** Export the new providers package from the top-level `copilot` module.

**Files:**
- Modify: `copilot/__init__.py`

**Step 1: Add providers import**

Add to `copilot/__init__.py` after existing imports:

```python
from .providers import AbstractProvider
```

Add `"AbstractProvider"` to `__all__`.

**Step 2: Commit**

```bash
git add copilot/__init__.py
git commit -m "feat: export AbstractProvider from copilot package"
```

---

### Task 8: Add httpx to requirements.txt

**Objective:** Ensure the new dependency is recorded. (Already done in Task 3 if httpx was added there — verify.)

**Step 1: Verify requirements.txt contains httpx**

Run: `grep httpx requirements.txt`
Expected: `httpx>=0.27`

If missing, add it. Then commit.

---

### Task 9: End-to-end smoke test

**Objective:** Verify the server starts and responds correctly with only Copilot configured (backward compat).

**Step 1: Start the server**

```bash
python app.py &
sleep 3
```

**Step 2: Test /v1/models**

```bash
curl -s http://localhost:8000/v1/models | python3 -m json.tool
```

Expected: `{"object": "list", "data": [{"id": "copilot", ...}]}`

**Step 3: Test /v1/chat/completions**

```bash
curl -s http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "Say hello in one word"}]}' | python3 -m json.tool
```

Expected: OpenAI-shaped response with copilot model.

**Step 4: Stop server**

```bash
kill %1
```

**Step 5: Commit any fixes**

If any adjustments were needed, commit them.

---

### Task 10: Run full test suite

**Objective:** Ensure all tests pass, no regressions.

**Step 1: Run all tests**

```bash
python -m pytest tests/ -v
```

Expected: All tests PASS.

**Step 2: Final commit if needed**

If any fixes were required, commit them.
