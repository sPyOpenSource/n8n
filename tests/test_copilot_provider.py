"""Tests for CopilotProvider."""

from copilot.providers.copilot_provider import CopilotProvider


def test_is_available():
    p = CopilotProvider()
    assert p.is_available() is True


def test_list_models():
    p = CopilotProvider()
    models = p.list_models()
    assert len(models) == 1
    assert models[0]["id"] == "copilot"
    assert models[0]["owned_by"] == "microsoft"


def test_has_lock():
    p = CopilotProvider()
    assert p._lock is not None
