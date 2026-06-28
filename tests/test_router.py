"""Tests for the Router."""

import pytest
from unittest.mock import MagicMock
from server.router import Router
from copilot.providers.base import AbstractProvider


class FakeProvider(AbstractProvider):
    label = "fake"
    url = "http://fake"
    working = True
    supports_stream = True
    default_model = "fake-model"
    needs_auth = False

    def __init__(self, available=True, models=None, chat_side_effect=None):
        super().__init__()
        self._available = available
        self._models = models or [{"id": self.default_model, "object": "model", "created": 0, "owned_by": "fake"}]
        if models:
            self.default_model = models[0]["id"]
        self._chat_side_effect = chat_side_effect

    def is_available(self):
        return self._available

    def list_models(self):
        return self._models

    def chat(self, prompt, model=None, conversation_id=None):
        if self._chat_side_effect:
            raise self._chat_side_effect
        return {"id": "chatcmpl-fake", "model": model or self.default_model, "choices": [{"message": {"content": prompt}}]}

    def stream(self, prompt, model=None, conversation_id=None):
        yield 'data: {"choices":[]}\\n\\n'


def test_iterates_priority_order():
    p1 = FakeProvider(available=True, models=[{"id": "a", "object": "model", "created": 0, "owned_by": "x"}])
    p2 = FakeProvider(available=True, models=[{"id": "b", "object": "model", "created": 0, "owned_by": "y"}])
    r = Router([p1, p2])
    result = r.chat("hello")
    assert result["model"] == "a"


def test_skips_unavailable():
    p1 = FakeProvider(available=False)
    p2 = FakeProvider(available=True, models=[{"id": "b", "object": "model", "created": 0, "owned_by": "y"}])
    r = Router([p1, p2])
    result = r.chat("hello")
    assert result["model"] == "b"


def test_failover_on_connection_error():
    p1 = FakeProvider(available=True, chat_side_effect=ConnectionError("down"))
    p2 = FakeProvider(available=True, models=[{"id": "b", "object": "model", "created": 0, "owned_by": "y"}])
    r = Router([p1, p2])
    result = r.chat("hello")
    assert result["model"] == "b"


def test_returns_last_error_when_all_fail():
    p1 = FakeProvider(available=True, chat_side_effect=ConnectionError("err1"))
    p2 = FakeProvider(available=True, chat_side_effect=ConnectionError("err2"))
    r = Router([p1, p2])
    with pytest.raises(ConnectionError, match="err2"):
        r.chat("hello")


def test_aggregates_models():
    p1 = FakeProvider(available=True, models=[{"id": "a", "object": "model", "created": 0, "owned_by": "x"}])
    p2 = FakeProvider(available=True, models=[{"id": "b", "object": "model", "created": 0, "owned_by": "y"}])
    r = Router([p1, p2])
    models = r.list_models()
    ids = [m["id"] for m in models]
    assert "a" in ids
    assert "b" in ids


def test_model_specific_routing():
    p1 = FakeProvider(available=True, models=[{"id": "copilot", "object": "model", "created": 0, "owned_by": "microsoft"}])
    p2 = FakeProvider(available=True, models=[{"id": "llama3", "object": "model", "created": 0, "owned_by": "ollama"}])
    r = Router([p1, p2])
    result = r.chat("hello", model="llama3")
    assert result["model"] == "llama3"
