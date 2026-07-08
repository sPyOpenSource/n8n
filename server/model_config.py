"""Load provider-grouped model mapping from JSON config."""

import json
from typing import Any


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
            with open(self._path, encoding="utf-8") as f:
                data = json.load(f)
            self._data = data if isinstance(data, dict) else {}
        except (FileNotFoundError, json.JSONDecodeError):
            self._data = {}

    def providers_for_model(self, model_key: str) -> dict[str, str]:
        """Return { provider_name: provider_model } for all providers supporting model_key."""
        result = {}
        for provider, models in self._data.items():
            #if model_key in models:
            result[provider] = {model_key:""}
        return result

    def provider_model(self, provider: str, model_key: str) -> str | None:
        """Return the actual model name to use for a given (provider, model_key)."""
        return self._data.get(provider, {}).get(model_key)

    def all_models(self) -> list[dict[str, Any]]:
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

    @classmethod
    def proxy_from_providers(cls, providers: list) -> "ModelConfig":
        """Create a dummy config that lists every provider's models under model_key '*'."""
        inst = cls.__new__(cls)
        inst._path = ""
        inst._data = {}
        for p in providers:
            inst._data[p.label] = {m["id"]: m["id"] for m in p.list_models()}
        return inst

    def __repr__(self) -> str:
        return f"<ModelConfig path={self._path!r} models={len(self._data)}>"
