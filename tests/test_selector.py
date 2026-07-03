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
