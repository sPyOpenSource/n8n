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
