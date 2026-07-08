"""Tests for OllamaProvider."""

from unittest.mock import patch, MagicMock

from copilot.providers.ollama_provider import OllamaProvider


def test_default_base_url():
    p = OllamaProvider()
    assert p.base_url == "http://localhost:11434"


def test_env_base_url(monkeypatch):
    monkeypatch.setenv("OLLAMA_BASE_URL", "http://my-ollama:11434")
    p = OllamaProvider()
    assert p.base_url == "http://my-ollama:11434"


def test_custom_base_url():
    p = OllamaProvider(base_url="http://custom:9999")
    assert p.base_url == "http://custom:9999"


def test_list_models_format():
    p = OllamaProvider(base_url="http://localhost:11434")
    mock_resp = MagicMock(
        status_code=200,
        json=lambda: {"models": [{"name": "llama3"}, {"name": "mistral"}]}
    )
    with patch.object(p, "_get", return_value=mock_resp):
        models = p.list_models()
    assert len(models) == 2
    assert models[0]["id"] == "llama3"
    assert models[0]["owned_by"] == "ollama"


def test_list_models_empty():
    p = OllamaProvider(base_url="http://localhost:11434")
    mock_resp = MagicMock(status_code=200, json=lambda: {"models": []})
    with patch.object(p, "_get", return_value=mock_resp):
        models = p.list_models()
    assert models == []


def test_is_available_returns_cached():
    p = OllamaProvider(base_url="http://localhost:11434")
    p._available = True
    p._available_checked_at = 9999999999.0  # far future, won't re-check
    assert p.is_available() is True
