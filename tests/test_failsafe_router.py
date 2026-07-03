"""Tests for FailsafeRouter dynamic failover."""

import pytest
from unittest.mock import MagicMock

from server.router import FailsafeRouter
from server.model_config import ModelConfig
from server.score_keeper import ScoreKeeper
from server.selector import ProviderSelector
from server.health_watcher import HealthWatcher
from copilot.providers.base import AbstractProvider


class FakeProvider(AbstractProvider):
    label = "fake"
    url = "http://fake"
    working = True
    supports_stream = True
    default_model = "gpt-4o"
    needs_auth = False

    def __init__(self, name="fake", available=True, chat_side_effect=None, stream_side_effect=None, models=None):
        super().__init__()
        self.name = name
        self._available = available
        self._chat_side_effect = chat_side_effect
        self._stream_side_effect = stream_side_effect
        self._models = models or [{"id": "gpt-4o", "object": "model", "created": 0, "owned_by": name}]
        if models:
            self.default_model = models[0]["id"]

    def is_available(self):
        return self._available

    def list_models(self):
        return self._models

    def chat(self, prompt, model=None, conversation_id=None):
        if self._chat_side_effect:
            raise self._chat_side_effect
        return {"id": "chatcmpl-fake", "model": model or self.default_model, "choices": [{"message": {"content": prompt}}]}

    def stream(self, prompt, model=None, conversation_id=None):
        if self._stream_side_effect:
            raise self._stream_side_effect
        yield 'data: {"choices":[]}\n\n'


@pytest.fixture
def router():
    providers = {
        "openai": FakeProvider(name="openai", available=True),
        "anthropic": FakeProvider(name="anthropic", available=True),
    }
    mc = MagicMock(spec=ModelConfig)
    mc.providers_for_model.return_value = {"openai": "gpt-4o", "anthropic": "claude-3-5-sonnet-20240620"}
    mc.provider_model.side_effect = lambda p, m: {"openai": "gpt-4o", "anthropic": "claude-3-5-sonnet-20240620"}.get(p)
    mc.all_models.return_value = [
        {"id": "gpt-4o", "object": "model", "created": 0, "owned_by": "openai"},
    ]
    sk = ScoreKeeper(max_age=30.0)
    sel = ProviderSelector(tau=0.1)
    hw = HealthWatcher(max_failures=2, recovery_probes=3)
    return FailsafeRouter(
        providers=providers,
        model_config=mc,
        score_keeper=sk,
        selector=sel,
        health_watcher=hw,
    )


def test_chat_success(router):
    result = router.chat("hello", model="gpt-4o")
    assert result is not None
    assert "choices" in result


def test_failover_on_error(router):
    router._providers["openai"]._chat_side_effect = ConnectionError("down")
    result = router.chat("hello", model="gpt-4o")
    assert result is not None
    assert "choices" in result


def test_all_fail_returns_stub(router):
    router._providers["openai"]._chat_side_effect = ConnectionError("down")
    router._providers["anthropic"]._chat_side_effect = ConnectionError("down")
    result = router.chat("hello", model="gpt-4o")
    assert result["error"]["code"] == "provider_outage"


def test_excludes_previous_failures(router):
    router._providers["openai"]._chat_side_effect = ConnectionError("down")
    result = router.chat("hello", model="gpt-4o")
    assert result is not None


def test_list_models(router):
    models = router.list_models()
    assert any(m["id"] == "gpt-4o" for m in models)


def test_stream_success(router):
    chunks = list(router.stream("hello", model="gpt-4o"))
    assert len(chunks) > 0
    assert chunks[0] == 'data: {"choices":[]}\n\n'


def test_stream_failover(router):
    router._providers["openai"]._stream_side_effect = ConnectionError("down")
    chunks = list(router.stream("hello", model="gpt-4o"))
    assert len(chunks) > 0
    assert chunks[0] == 'data: {"choices":[]}\n\n'


def test_stream_all_fail(router):
    router._providers["openai"]._stream_side_effect = ConnectionError("down")
    router._providers["anthropic"]._stream_side_effect = ConnectionError("down")
    chunks = list(router.stream("hello", model="gpt-4o"))
    assert len(chunks) == 2
    assert "[error: all providers unavailable]" in chunks[0]
    assert "[DONE]" in chunks[1]


def test_stream_no_model(router):
    chunks = list(router.stream("hello", model=None))
    assert len(chunks) == 2
    assert "[error: no model specified]" in chunks[0]
    assert "[DONE]" in chunks[1]


def test_failover_spies(router):
    router._score_keeper.record_error = MagicMock(wraps=router._score_keeper.record_error)
    router._health_watcher.record_failure = MagicMock(wraps=router._health_watcher.record_failure)

    router._providers["openai"]._stream_side_effect = ConnectionError("down")
    router._providers["anthropic"]._stream_side_effect = ConnectionError("down")
    list(router.stream("hello", model="gpt-4o"))

    assert router._score_keeper.record_error.call_count == 2
    assert router._health_watcher.record_failure.call_count == 2
