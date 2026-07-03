"""Tests for server startup with failsafe routing."""

import os
import pytest
from unittest.mock import patch

from server.api import _build_router


def test_build_router_with_model_config():
    """When models.json exists, router should be a FailsafeRouter."""
    from server.router import FailsafeRouter
    fixture_path = os.path.join(os.path.dirname(__file__), "fixtures", "models.json")
    with patch.dict(os.environ, {
        "MODEL_CONFIG_PATH": fixture_path,
        "PROVIDER_PRIORITY": "openai",
    }, clear=True):
        with patch("server.api.OpenAIProvider") as mock_prov:
            mock_prov.return_value.is_available.return_value = False
            router = _build_router()
            assert isinstance(router, FailsafeRouter)


def test_build_router_fallback():
    """Without model config, router should be the legacy Router."""
    from server.router import Router
    with patch("server.api.config.get") as mock_get:
        mock_get.side_effect = lambda key: {
            "MODEL_CONFIG_PATH": "/tmp/nonexistent_models.json",
            "PROVIDER_PRIORITY": "openai",
        }.get(key, "")
        with patch("server.api.OpenAIProvider") as mock_prov:
            mock_prov.return_value.is_available.return_value = False
            router = _build_router()
            assert isinstance(router, Router)
