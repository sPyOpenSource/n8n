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
        self._base_url = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com").rstrip("/")
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
