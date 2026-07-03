"""Router — dispatches requests across a provider pool with failover."""

import logging
from typing import Generator

from copilot.driver import ClearanceRequired
from copilot.providers.base import AbstractProvider

from .health_watcher import HealthWatcher
from .model_config import ModelConfig
from .score_keeper import ScoreKeeper
from .selector import ProviderSelector

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
        #if model and model in self._model_to_provider:
        #provider = self._model_to_provider[model]
        provider = self._model_to_provider["nvidia/nemotron-3-ultra"]
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
        #if model and model in self._model_to_provider:
        print(len(prompt)/10240)
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


class FailsafeRouter:
    """Scoring-based router with dynamic failover and 503 stub on total outage."""

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
            except (ConnectionError, TimeoutError) as exc:
                log.warning("Provider %s failed: %s; trying next", chosen, exc)
                self._score_keeper.record_error(chosen)
                self._health_watcher.record_failure(chosen, str(exc))
                tried.add(chosen)
                continue

    def stream(self, prompt: str, model: str | None = None, conversation_id: str | None = None):
        if not model:
            from .openai_format import sse_event, stream_chunk, new_id
            cid = new_id()
            created = int(__import__("time").time())
            yield sse_event(stream_chunk(cid, created, "", {"content": "\n[error: no model specified]"}, finish="error"))
            yield "data: [DONE]\n\n"
            return
        tried: set[str] = set()
        while True:
            candidates = self._available_candidates(model, tried)
            if not candidates:
                from .openai_format import sse_event, stream_chunk, new_id
                cid = new_id()
                created = int(__import__("time").time())
                yield sse_event(stream_chunk(cid, created, model, {"content": "\n[error: all providers unavailable]"}, finish="error"))
                yield "data: [DONE]\n\n"
                return

            signals = {name: self._score_keeper.scores(name) for name in candidates}
            chosen = self._selector.select(signals, exclude=tried)
            if chosen is None:
                from .openai_format import sse_event, stream_chunk, new_id
                cid = new_id()
                created = int(__import__("time").time())
                yield sse_event(stream_chunk(cid, created, model, {"content": "\n[error: all providers unavailable]"}, finish="error"))
                yield "data: [DONE]\n\n"
                return

            provider = self._providers[chosen]
            provider_model = self._model_config.provider_model(chosen, model) or model
            try:
                yield from provider.stream(prompt, model=provider_model, conversation_id=conversation_id)
                self._health_watcher.record_success(chosen)
                return
            except (ConnectionError, TimeoutError) as exc:
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
