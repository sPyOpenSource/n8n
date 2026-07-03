"""Tests for model config loading."""

import json
import os
import tempfile

import pytest

from server.model_config import ModelConfig


def test_loads_provider_grouped_config(model_config_fixture):
    cfg = model_config_fixture
    providers = cfg.providers_for_model("gpt-4o")
    assert "openai" in providers
    assert "anthropic" in providers
    assert providers["openai"] == "gpt-4o"
    assert providers["anthropic"] == "claude-3-5-sonnet-20240620"


def test_returns_provider_model(model_config_fixture):
    cfg = model_config_fixture
    assert cfg.provider_model("openai", "gpt-4o") == "gpt-4o"


def test_all_models_returns_correct_list(model_config_fixture):
    cfg = model_config_fixture
    models = cfg.all_models()
    ids = [m["id"] for m in models]
    assert "gpt-4o" in ids
    assert "gpt-4-turbo" in ids
    assert "claude-3-opus" in ids
    assert "llama-3.1-70b" in ids
    assert "mixtral-8x7b" in ids
    assert len(models) == 5


def test_all_models_no_duplicates(model_config_fixture):
    cfg = model_config_fixture
    ids = [m["id"] for m in cfg.all_models()]
    assert len(ids) == len(set(ids))


def test_all_models_owned_by_first_provider(model_config_fixture):
    cfg = model_config_fixture
    for m in cfg.all_models():
        if m["id"] == "gpt-4o":
            assert m["owned_by"] == "openai"


def test_provider_model_unknown_key(model_config_fixture):
    cfg = model_config_fixture
    assert cfg.provider_model("openai", "nonexistent-model") is None


def test_provider_model_unknown_provider(model_config_fixture):
    cfg = model_config_fixture
    assert cfg.provider_model("nonexistent-provider", "gpt-4o") is None


def test_returns_none_for_unknown_model(model_config_fixture):
    cfg = model_config_fixture
    assert cfg.providers_for_model("unknown-model") == {}


def test_file_not_found():
    cfg = ModelConfig("/nonexistent/path.json")
    assert cfg.providers_for_model("gpt-4o") == {}


def test_empty_json_file():
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
        json.dump({}, f)
        path = f.name
    try:
        cfg = ModelConfig(path)
        assert cfg.all_models() == []
        assert cfg.providers_for_model("anything") == {}
    finally:
        os.unlink(path)


def test_malformed_json_file():
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
        f.write("this is not json")
        path = f.name
    try:
        cfg = ModelConfig(path)
        assert cfg.all_models() == []
        assert cfg.providers_for_model("anything") == {}
    finally:
        os.unlink(path)


def test_non_dict_json_returns_empty():
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
        json.dump([], f)
        path = f.name
    try:
        cfg = ModelConfig(path)
        assert cfg.all_models() == []
        assert cfg.providers_for_model("anything") == {}
    finally:
        os.unlink(path)


def test_repr_shows_path_and_model_count(model_config_fixture):
    cfg = model_config_fixture
    r = repr(cfg)
    assert "ModelConfig" in r
    assert "models.json" in r
    assert "models=3" in r
