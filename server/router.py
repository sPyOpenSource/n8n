"""Router — dispatches requests across a provider pool with failover."""

import logging
import time as _time
from typing import Any, Generator

from copilot.driver import ClearanceRequired, ProviderError, ResourceExhausted
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

    def __init__(
        self, 
        providers: list[AbstractProvider], 
        token_tracker: Any = None
    ):
        self._providers = providers
        self._token_tracker = token_tracker
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

    def chat(
        self,
        messages: list[dict[str, Any]],
        model: str | None = None,
        tools: list[dict[str, Any]] | None = None,
        tool_choice: str | dict[str, Any] | None = None,
        conversation_id: str | None = None,
    ) -> dict:
        tried: set[int] = set()
        last_err = None

        if model and model in self._model_to_provider:
            provider = self._model_to_provider[model]
            if provider.is_available():
                try:
                    result = provider.chat(messages, model=model, tools=tools, tool_choice=tool_choice, conversation_id=conversation_id)
                    if self._token_tracker and "usage" in result:
                        u = result["usage"]
                        self._token_tracker.record_usage(
                            provider.label, 
                            u.get("prompt_tokens", 0), 
                            u.get("completion_tokens", 0)
                        )
                    return result
                except (ConnectionError, ClearanceRequired, TimeoutError, ResourceExhausted, ProviderError) as exc:

                    log.warning("Provider %s (mapped from model %s) failed: %s; trying next", provider.label, model, exc)
                    tried.add(id(provider))
                    last_err = exc

        for provider in self._active_providers():
            if id(provider) in tried:
                continue
            tried.add(id(provider))
            try:
                result = provider.chat(messages, model=model or provider.default_model, tools=tools, tool_choice=tool_choice, conversation_id=conversation_id)
                if self._token_tracker and "usage" in result:
                    u = result["usage"]
                    self._token_tracker.record_usage(
                        provider.label, 
                        u.get("prompt_tokens", 0), 
                        u.get("completion_tokens", 0)
                    )
                return result
            except (ConnectionError, ClearanceRequired, TimeoutError, ResourceExhausted, ProviderError) as exc:
                log.warning("Provider %s failed: %s; trying next", provider.label, exc)
                last_err = exc
                continue
        if last_err is not None:
            raise last_err
        raise RuntimeError("No providers available")

    def stream(
        self,
        messages: list[dict[str, Any]],
        model: str | None = None,
        tools: list[dict[str, Any]] | None = None,
        tool_choice: str | dict[str, Any] | None = None,
        conversation_id: str | None = None,
    ) -> Generator:
        tried: set[int] = set()

        if model and model in self._model_to_provider:
            provider = self._model_to_provider[model]
            if provider.is_available():
                try:
                    yield from stream_with_usage(provider, messages, model, tools, tool_choice, conversation_id, self._token_tracker)
                    return
                except (ConnectionError, ClearanceRequired, TimeoutError, ResourceExhausted, ProviderError) as exc:
                    log.warning("Provider %s (mapped from model %s) failed: %s; trying next", provider.label, model, exc)
                    tried.add(id(provider))

        for provider in self._active_providers():
            if id(provider) in tried:
                continue
            tried.add(id(provider))
            try:
                yield from stream_with_usage(provider, messages, model or provider.default_model, tools, tool_choice, conversation_id, self._token_tracker)
                return
            except (ConnectionError, ClearanceRequired, TimeoutError, ResourceExhausted, ProviderError) as exc:
                log.warning("Provider %s failed: %s; trying next", provider.label, exc)
                continue
        raise RuntimeError("No providers available")


def stream_with_usage(provider: AbstractProvider, messages, model, tools, tool_choice, conversation_id, token_tracker):
    """Wrapper that yields chunks and captures usage from the final chunk."""
    import json
    usage_recorded = False
    for chunk in provider.stream(messages, model=model, tools=tools, tool_choice=tool_choice, conversation_id=conversation_id):
        yield chunk
        if not usage_recorded and token_tracker:
            if isinstance(chunk, dict) and "usage" in chunk:
                u = chunk["usage"]
                token_tracker.record_usage(provider.label, u.get("prompt_tokens", 0), u.get("completion_tokens", 0))
                usage_recorded = True
            elif isinstance(chunk, str) and chunk.startswith("data: "):
                try:
                    data_str = chunk[6:].strip()
                    if data_str != "[DONE]":
                        data = json.loads(data_str)
                        if isinstance(data, dict) and "usage" in data:
                            u = data["usage"]
                            token_tracker.record_usage(provider.label, u.get("prompt_tokens", 0), u.get("completion_tokens", 0))
                            usage_recorded = True
                except Exception:
                    pass


class FailsafeRouter:
    """Scoring-based router with dynamic failover and 503 stub on total outage."""

    def __init__(
        self,
        providers: dict[str, AbstractProvider],
        model_config: ModelConfig,
        score_keeper: ScoreKeeper,
        selector: ProviderSelector,
        health_watcher: HealthWatcher,
        token_tracker: Any = None,
    ):
        self._providers = providers
        self._model_config = model_config
        self._score_keeper = score_keeper
        self._selector = selector
        self._health_watcher = health_watcher
        self._token_tracker = token_tracker

    def _available_candidates(self, model: str, exclude: set[str]) -> dict[str, AbstractProvider]:
        provider_map = self._model_config.providers_for_model(model)
        candidates = {}
        for name, _provider_model in provider_map.items():
            if name in exclude:
                continue
            prov = self._providers.get(name)
            if prov and prov.is_available() and self._health_watcher.status(name) != HealthWatcher.STATUS_UNHEALTHY:
                candidates[name] = prov
        return candidates

    def list_models(self) -> list[dict]:
        return self._model_config.all_models()

    def chat(
        self,
        messages: list[dict[str, Any]],
        model: str | None = None,
        tools: list[dict[str, Any]] | None = None,
        tool_choice: str | dict[str, Any] | None = None,
        conversation_id: str | None = None,
    ) -> dict:
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
            start = _time.monotonic()
            try:
                result = provider.chat(messages, model=provider_model, tools=tools, tool_choice=tool_choice, conversation_id=conversation_id)
                elapsed = (_time.monotonic() - start) * 1000
                self._score_keeper.record_success(chosen, elapsed)
                self._health_watcher.record_success(chosen)
                if self._token_tracker and isinstance(result, dict) and "usage" in result:
                    u = result["usage"]
                    self._token_tracker.record_usage(
                        provider.label,
                        u.get("prompt_tokens", 0),
                        u.get("completion_tokens", 0)
                    )
                return result
            except (ConnectionError, TimeoutError, ResourceExhausted, ProviderError) as exc:
                log.warning("Provider %s failed: %s; trying next", chosen, exc)
                self._score_keeper.record_error(chosen)
                self._health_watcher.record_failure(chosen, str(exc))
                tried.add(chosen)
                continue

    def _error_sse(self, model: str, message: str):
        from .openai_format import sse_event, stream_chunk, new_id
        cid = new_id()
        created = int(_time.time())
        yield sse_event(stream_chunk(cid, created, model, {"content": f"\n[{message}]"}, finish="error"))
        yield "data: [DONE]\n\n"

    def stream(
        self,
        messages: list[dict[str, Any]],
        model: str | None = None,
        tools: list[dict[str, Any]] | None = None,
        tool_choice: str | dict[str, Any] | None = None,
        conversation_id: str | None = None,
    ):
        if not model:
            yield from self._error_sse("", "error: no model specified")
            return
        tried: set[str] = set()
        while True:
            candidates = self._available_candidates(model, tried)
            if not candidates:
                yield from self._error_sse(model, "error: all providers unavailable")
                return

            signals = {name: self._score_keeper.scores(name) for name in candidates}
            chosen = self._selector.select(signals, exclude=tried)
            if chosen is None:
                yield from self._error_sse(model, "error: all providers unavailable")
                return

            provider = self._providers[chosen]
            provider_model = self._model_config.provider_model(chosen, model) or model
            try:
                start = _time.monotonic()
                yield from stream_with_usage(provider, messages, provider_model, tools, tool_choice, conversation_id, self._token_tracker)
                elapsed = (_time.monotonic() - start) * 1000
                self._score_keeper.record_success(chosen, elapsed)
                self._health_watcher.record_success(chosen)
                return
            except (ConnectionError, TimeoutError, ResourceExhausted, ProviderError) as exc:
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
