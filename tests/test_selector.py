"""Tests for ProviderSelector softmax selection."""

import pytest

from server.selector import ProviderSelector


def test_selects_best_provider_with_tau_01():
    selector = ProviderSelector(tau=0.1)
    candidates = {
        "openai": {"error_rate": 0.0, "latency_p99": 10.0},
        "anthropic": {"error_rate": 0.0, "latency_p99": 5000.0},
        "groq": {"error_rate": 0.5, "latency_p99": 50.0},
    }
    picks = {"openai": 0, "anthropic": 0, "groq": 0}
    for _ in range(100):
        pick = selector.select(candidates, exclude=set())
        picks[pick] += 1
    assert picks["openai"] > picks["anthropic"]
    assert picks["anthropic"] > picks["groq"]


def test_excludes_providers():
    selector = ProviderSelector(tau=0.1)
    candidates = {
        "openai": {"error_rate": 0.0, "latency_p99": 100.0},
        "anthropic": {"error_rate": 0.0, "latency_p99": 200.0},
    }
    pick = selector.select(candidates, exclude={"openai"})
    assert pick == "anthropic"


def test_returns_none_when_no_candidates():
    selector = ProviderSelector(tau=0.1)
    assert selector.select({}, exclude=set()) is None


def test_all_excluded_returns_none():
    selector = ProviderSelector(tau=0.1)
    candidates = {"openai": {"error_rate": 0.0, "latency_p99": 100.0}}
    assert selector.select(candidates, exclude={"openai"}) is None


def test_combination_formula():
    selector = ProviderSelector(tau=0.1, w_error=0.7, w_latency=0.3, max_latency=10000.0)
    candidates = {
        "fast": {"error_rate": 0.0, "latency_p99": 50.0},
        "slow": {"error_rate": 0.0, "latency_p99": 5000.0},
    }
    picks = {"fast": 0, "slow": 0}
    for _ in range(50):
        pick = selector.select(candidates, exclude=set())
        picks[pick] += 1
    assert picks["fast"] > picks["slow"]


def test_validation_tau_not_positive():
    with pytest.raises(ValueError, match="tau must be > 0"):
        ProviderSelector(tau=0)


def test_validation_max_latency_not_positive():
    with pytest.raises(ValueError, match="max_latency must be > 0"):
        ProviderSelector(max_latency=0)


def test_all_equal_scores():
    selector = ProviderSelector(tau=0.1)
    candidates = {
        "a": {"error_rate": 0.1, "latency_p99": 100.0},
        "b": {"error_rate": 0.1, "latency_p99": 100.0},
        "c": {"error_rate": 0.1, "latency_p99": 100.0},
    }
    picks = {"a": 0, "b": 0, "c": 0}
    for _ in range(300):
        pick = selector.select(candidates, exclude=set())
        picks[pick] += 1
    assert all(v > 0 for v in picks.values())


def test_single_candidate():
    selector = ProviderSelector(tau=0.1)
    candidates = {"only": {"error_rate": 0.5, "latency_p99": 5000.0}}
    for _ in range(10):
        assert selector.select(candidates, exclude=set()) == "only"


def test_very_small_tau():
    selector = ProviderSelector(tau=0.001)
    candidates = {
        "best": {"error_rate": 0.0, "latency_p99": 10.0},
        "worst": {"error_rate": 0.9, "latency_p99": 9000.0},
    }
    for _ in range(50):
        assert selector.select(candidates, exclude=set()) == "best"


def test_very_large_tau():
    selector = ProviderSelector(tau=100.0)
    candidates = {
        "good": {"error_rate": 0.0, "latency_p99": 10.0},
        "bad": {"error_rate": 0.9, "latency_p99": 9000.0},
    }
    picks = {"good": 0, "bad": 0}
    for _ in range(200):
        pick = selector.select(candidates, exclude=set())
        picks[pick] += 1
    assert picks["good"] > 0 and picks["bad"] > 0
