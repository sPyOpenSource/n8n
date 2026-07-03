"""Tests for ScoreKeeper signal tracking."""

import time
import pytest

from server.score_keeper import ScoreKeeper


def test_starts_with_default_scores():
    sk = ScoreKeeper()
    scores = sk.scores()
    assert "error_rate" in scores
    assert "latency_p99" in scores
    assert scores["error_rate"] == 0.0
    assert scores["latency_p99"] == 0.0


def test_records_error():
    sk = ScoreKeeper()
    sk.record_error("openai")
    sk.record_error("openai")
    sk.record_success("openai", latency_ms=100)
    scores = sk.scores("openai")
    assert scores["error_rate"] == pytest.approx(0.666, abs=0.01)


def test_records_latency():
    sk = ScoreKeeper()
    sk.record_success("openai", latency_ms=200)
    sk.record_success("openai", latency_ms=300)
    sk.record_success("openai", latency_ms=1000)
    scores = sk.scores("openai")
    # p99 of 3 samples ≈ 1000
    assert scores["latency_p99"] == pytest.approx(1000.0, abs=50)


def test_staleness_discards_old_data():
    sk = ScoreKeeper(max_age=0.01)  # 10ms freshness
    sk.record_success("openai", latency_ms=100)
    time.sleep(0.02)
    scores = sk.scores("openai")
    assert scores["error_rate"] == 0.0
    assert scores["latency_p99"] == 0.0


def test_returns_default_for_unknown_provider():
    sk = ScoreKeeper()
    scores = sk.scores("nonexistent")
    assert scores == {"error_rate": 0.0, "latency_p99": 0.0}
