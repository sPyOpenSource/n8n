"""NVIDIA provider — proxies requests to NVIDIA's NIM/OpenAI-compatible API."""

import os

import httpx

from .base import AbstractProvider
from server.config import config

class NvidiaProvider(AbstractProvider):
    """Provider backed by NVIDIA's NIM API (OpenAI-compatible endpoint)."""

    label = "NVIDIA"
    url = "https://integrate.api.nvidia.com"
    working = True
    supports_stream = True
    default_model = "meta/llama-3.1-8b-instruct"
    needs_auth = True

    def __init__(self, base_url: str | None = None):
        super().__init__()
        self._api_key = config.get("NVIDIA_API_KEY")  # os.environ.get("NVIDIA_API_KEY", "")
        print("NVIDIA_API_KEY:", self._api_key)
        self._base_url = (base_url or os.environ.get("NVIDIA_BASE_URL", "https://integrate.api.nvidia.com/v1")).rstrip("/")
        self._models_str = os.environ.get("NVIDIA_MODELS", "meta/llama-3.1-8b-instruct,meta/llama-3.1-70b-instruct,nvidia/nemotron-3-ultra")
        self._client = httpx.Client(timeout=120.0)

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self._api_key}"}

    def is_available(self) -> bool:
        return bool(self._api_key)

    def list_models(self) -> list[dict]:
        names = [n.strip() for n in self._models_str.split(",") if n.strip()]
        return [
            {"id": name, "object": "model", "created": 0, "owned_by": "nvidia"}
            for name in names
        ]

    def chat(self, prompt: str, model: str, conversation_id: str | None = None) -> dict:
        resp = self._client.post(
            f"{self._base_url}/chat/completions",
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