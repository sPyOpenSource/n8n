"""OpenRouter provider — proxies requests to OpenRouter's OpenAI-compatible API."""

import os

import httpx

from .base import AbstractProvider
from server.config import config

class OpenRouterProvider(AbstractProvider):
    """Provider backed by OpenRouter API."""

    label = "OpenRouter"
    url = "https://openrouter.ai"
    working = True
    supports_stream = True
    default_model = "nvidia/nemotron-3-ultra-550b-a55b:free"
    needs_auth = True

    def __init__(self, base_url: str | None = None):
        super().__init__()
        self._api_key = os.environ.get("OPENROUTER_API_KEY", config.get("OPENROUTER_API_KEY"))
        self._base_url = (base_url or os.environ.get("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")).rstrip("/")
        self._models_str = os.environ.get("OPENROUTER_MODELS", "openrouter/auto,anthropic/claude-3.5-sonnet,google/gemini-pro")
        self._client = httpx.Client(timeout=120.0)

    def _headers(self) -> dict:
        h = {"Authorization": f"Bearer {self._api_key}", "Content-Type": "application/json"}
        h["HTTP-Referer"] = os.environ.get("OPENROUTER_REFERER", "https://github.com/xuyi/Windows-Copilot-API")
        h["X-Title"] = os.environ.get("OPENROUTER_TITLE", "Windows-Copilot-API")
        return h

    def is_available(self) -> bool:
        return bool(self._api_key)

    def list_models(self) -> list[dict]:
        names = [n.strip() for n in self._models_str.split(",") if n.strip()]
        return [
            {"id": name, "object": "model", "created": 0, "owned_by": "openrouter"}
            for name in names
        ]

    def chat(self, prompt: str, model: str, conversation_id: str | None = None) -> dict:
        resp = self._client.post(
            f"{self._base_url}/chat/completions",
            headers=self._headers(),
            json={
                "model": self.default_model,
                "messages": [{"role": "user", "content": prompt}],
                "stream": False,
            },
        )
        resp.raise_for_status()
        return resp.json()

    def stream(self, prompt: str, model: str, conversation_id: str | None = None):
        with self._client.stream(
            "POST",
            f"{self._base_url}/chat/completions",
            headers=self._headers(),
            json={
                "model": self.default_model,
                "messages": [{"role": "user", "content": prompt}],
                "stream": True,
            },
        ) as resp:
            resp.raise_for_status()
            for line in resp.iter_lines():
                if not line:
                    continue
                # Zorg dat de byte-line een normale Python string wordt
                if isinstance(line, bytes):
                    line = line.decode("utf-8")
                if line.startswith("data: "):
                    yield line + "\n\n"
                    if line == "data: [DONE]":
                        return