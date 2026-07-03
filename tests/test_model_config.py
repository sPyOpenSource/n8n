"""Tests for model config loading."""

import os
import pytest
import json
import tempfile

from server.model_config import ModelConfig


def test_loads_provider_grouped_config():
    fixture = os.path.join(os.path.dirname(__file__), "fixtures", "models.json")
    cfg = ModelConfig(fixture)
    providers = cfg.providers_for_model("gpt-4o")
    assert "openai" in providers
    assert "anthropic" in providers
    assert providers["openai"] == "gpt-4o"
    assert providers["anthropic"] == "claude-3-5-sonnet-20240620"


def test_returns_provider_model():
    fixture = os.path.join(os.path.dirname(__file__), "fixtures", "models.json")
    cfg = ModelConfig(fixture)
    assert cfg.provider_model("openai", "gpt-4o") == "gpt-4o"


def test_returns_none_for_unknown_model():
    fixture = os.path.join(os.path.dirname(__file__), "fixtures", "models.json")
    cfg = ModelConfig(fixture)
    assert cfg.providers_for_model("unknown-model") == {}


def test_file_not_found():
    cfg = ModelConfig("/nonexistent/path.json")
    assert cfg.providers_for_model("gpt-4o") == {}
