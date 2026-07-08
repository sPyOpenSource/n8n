"""Router — dispatches requests across a provider pool with failover."""

import json as _json
import logging
import time as _time
from typing import Any

from copilot.driver import ClearanceRequired, ProviderError, ResourceExhausted
from copilot.providers.base import AbstractProvider

from .health_watcher import HealthWatcher
from .model_config import ModelConfig
from .score_keeper import ScoreKeeper
from .selector import ProviderSelector

log = logging.getLogger(__name__)


def stream_with_usage(provider: AbstractProvider, messages, tools, tool_choice, conversation_id, token_tracker):
    usage_recorded = False
    for chunk in provider.stream(messages, tools=tools, tool_choice=tool_choice, conversation_id=conversation_id):
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
                        data = _json.loads(data_str)
                        if isinstance(data, dict) and "usage" in data:
                            u = data["usage"]
                            token_tracker.record_usage(provider.label, u.get("prompt_tokens", 0), u.get("completion_tokens", 0))
                            usage_recorded = True
                        else:
                            token_tracker.record_usage(provider.label, len(chunk), 0)
                            usage_recorded = True
                except Exception:
                    pass


class Router:
    """Scoring-based router with dynamic failover and 503 stub on total outage.

    Supports two modes:

    *Failsafe.* When ``model_config`` is non-empty, uses scoring, health
    watching, and provider-specific model mapping. Model aliases and
    provider priorities come from the config.

    *Legacy.* When ``model_config`` is empty, falls back to a simple
    priority-ordered dispatch (like the old ``Router``). Create it with
    ``Router.from_priority_list(providers, token_tracker=...)``.
    """

    def __init__(
        self,
        providers: dict[str, AbstractProvider],
        score_keeper: ScoreKeeper,
        selector: ProviderSelector,
        health_watcher: HealthWatcher,
        token_tracker: Any = None,
    ):
        self._providers = providers
        self._score_keeper = score_keeper
        self._selector = selector
        self._health_watcher = health_watcher
        self._token_tracker = token_tracker

    @classmethod
    def from_priority_list(cls, providers: list[AbstractProvider], token_tracker: Any = None) -> "Router":
        """Build a legacy-style router from a simple provider list.

        Internally creates empty scoring/health/select/config plumbing.
        Uses provider labels as names for dict-based dispatch.
        """

        sk = ScoreKeeper()
        sel = ProviderSelector()
        hw = HealthWatcher()

        prov_dict = {p.label: p for p in providers}
        return cls(
            providers=prov_dict,
            score_keeper=sk,
            selector=sel,
            health_watcher=hw,
            token_tracker=token_tracker,
        )

    def _available_candidates(self, exclude: set[str]) -> dict[str, AbstractProvider]:
        candidates = {}
        for name in self._providers:
            if name in exclude:
                continue
            prov = self._providers.get(name)
            if prov and prov.is_available() and self._health_watcher.status(name) != HealthWatcher.STATUS_UNHEALTHY:
                candidates[name] = prov
        return candidates

    def list_models(self) -> list[dict]:
        return []

    def chat(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        tool_choice: str | dict[str, Any] | None = None,
        conversation_id: str | None = None,
    ) -> dict:
        tried: set[str] = set()
        while True:
            candidates = self._available_candidates(tried)
            if not candidates:
                return self._503_stub("all providers unavailable")

            signals = {name: self._score_keeper.scores(name) for name in candidates}
            chosen = self._selector.select(signals, exclude=tried)
            if chosen is None:
                return self._503_stub("all providers unavailable")

            provider = self._providers[chosen]
            start = _time.monotonic()
            try:
                result = provider.chat(messages, tools=tools, tool_choice=tool_choice, conversation_id=conversation_id)
                elapsed = (_time.monotonic() - start) * 1000
                self._score_keeper.record_success(chosen, elapsed)
                self._health_watcher.record_success(chosen)
                if self._token_tracker and isinstance(result, dict) and "usage" in result:
                    u = result["usage"]
                    self._token_tracker.record_usage(provider.label, u.get("prompt_tokens", 0), u.get("completion_tokens", 0))
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
        tools: list[dict[str, Any]] | None = None,
        tool_choice: str | dict[str, Any] | None = None,
        conversation_id: str | None = None,
    ):
        tried: set[str] = set()
        while True:
            candidates = self._available_candidates(tried)
            if not candidates:
                yield from self._error_sse(candidates.default_model, "error: all providers unavailable")
                return

            signals = {name: self._score_keeper.scores(name) for name in candidates}
            chosen = self._selector.select(signals, exclude=tried)
            if chosen is None:
                yield from self._error_sse(candidates.default_model, "error: all providers unavailable")
                return

            provider = self._providers[chosen]
            try:
                start = _time.monotonic()
                yield from stream_with_usage(provider, messages, tools, tool_choice, conversation_id, self._token_tracker)
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
    