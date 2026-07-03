"""Google Gemini provider — proxies requests to Google's Generative Language API."""

import os

import httpx

from .base import AbstractProvider
from server.config import config

class GoogleProvider(AbstractProvider):
    """Provider backed by Google's Gemini API (OpenAI-compatible endpoint)."""

    label = "Google"
    url = "https://generativelanguage.googleapis.com"
    working = True
    supports_stream = True
    default_model = "gemma-4-31b-it"
    needs_auth = True

    def __init__(self, base_url: str | None = None):
        super().__init__()
        self._api_key = config.get("GOOGLE_API_KEY") or os.environ.get("GOOGLE_API_KEY", "")
        self._base_url = (base_url or os.environ.get("GOOGLE_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai")).rstrip("/")
        self._models_str = os.environ.get("GOOGLE_MODELS", "gemini-1.5-flash,gemini-1.5-pro,gemini-1.0-pro")
        self._client = httpx.Client(timeout=120.0)

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self._api_key}"}

    def is_available(self) -> bool:
        return bool(self._api_key)

    def list_models(self) -> list[dict]:
        names = [n.strip() for n in self._models_str.split(",") if n.strip()]
        return [
            {"id": name, "object": "model", "created": 0, "owned_by": "google"}
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
                if line.startswith("data: "):
                    yield line + "\n\n"
                    if line == "data: [DONE]":
                        return