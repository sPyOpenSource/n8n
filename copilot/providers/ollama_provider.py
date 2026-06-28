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

    _AVAILABILITY_TTL = 30

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
