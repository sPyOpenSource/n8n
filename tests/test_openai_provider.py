"""Tests for OpenAIProvider."""

import os
from unittest.mock import patch

from copilot.providers.openai_provider import OpenAIProvider


def test_is_available_no_key():
    with patch.dict(os.environ, {}, clear=True):
        p = OpenAIProvider()
        assert p.is_available() is False


def test_is_available_with_key(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    p = OpenAIProvider()
    assert p.is_available() is True


def test_list_models_default():
    with patch.dict(os.environ, {}, clear=True):
        p = OpenAIProvider()
        models = p.list_models()
    ids = [m["id"] for m in models]
    assert "gpt-4o" in ids
    assert "gpt-4o-mini" in ids
    assert "o3-mini" in ids


def test_list_models_custom(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.setenv("OPENAI_MODELS", "gpt-4o,gpt-4")
    p = OpenAIProvider()
    models = p.list_models()
    ids = [m["id"] for m in models]
    assert ids == ["gpt-4o", "gpt-4"]
    for m in models:
        assert m["owned_by"] == "openai"


def test_env_base_url(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.setenv("OPENAI_BASE_URL", "https://my-proxy.example.com")
    p = OpenAIProvider()
    assert p._base_url == "https://my-proxy.example.com"


def test_headers_include_auth():
    with patch.dict(os.environ, {"OPENAI_API_KEY": "sk-test"}):
        p = OpenAIProvider()
        h = p._headers()
    assert h["Authorization"] == "Bearer sk-test"


def test_headers_include_org(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.setenv("OPENAI_ORG_ID", "org-123")
    p = OpenAIProvider()
    h = p._headers()
    assert h["OpenAI-Organization"] == "org-123"
