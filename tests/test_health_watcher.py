"""Tests for HealthWatcher hybrid monitoring."""

from server.health_watcher import HealthWatcher


def test_starts_healthy():
    hw = HealthWatcher()
    assert hw.status("openai") == "HEALTHY"


def test_marked_unhealthy_after_failures():
    hw = HealthWatcher(max_failures=3)
    hw.record_failure("openai", "timeout")
    assert hw.status("openai") == "HEALTHY"
    hw.record_failure("openai", "500")
    assert hw.status("openai") == "HEALTHY"
    hw.record_failure("openai", "timeout")
    assert hw.status("openai") == "UNHEALTHY"


def test_recovery_requires_3_probes():
    hw = HealthWatcher(max_failures=3)
    for _ in range(3):
        hw.record_failure("openai", "timeout")
    assert hw.status("openai") == "UNHEALTHY"

    hw.record_probe_success("openai")
    assert hw.status("openai") == "PROBING"
    hw.record_probe_success("openai")
    assert hw.status("openai") == "PROBING"
    hw.record_probe_success("openai")
    assert hw.status("openai") == "HEALTHY"


def test_active_success_resets_failure_count():
    hw = HealthWatcher(max_failures=2)
    hw.record_failure("openai", "timeout")
    hw.record_success("openai")
    assert hw.status("openai") == "HEALTHY"


def test_unknown_provider_healthy():
    hw = HealthWatcher()
    assert hw.status("nonexistent") == "HEALTHY"


def test_should_probe_unhealthy():
    hw = HealthWatcher(max_failures=1)
    hw.record_failure("openai", "timeout")
    assert hw.should_probe("openai") is True


def test_should_probe_probing():
    hw = HealthWatcher(max_failures=1)
    hw.record_failure("openai", "timeout")
    hw.record_probe_success("openai")
    assert hw.status("openai") == "PROBING"
    assert hw.should_probe("openai") is True


def test_should_not_probe_healthy():
    hw = HealthWatcher()
    assert hw.should_probe("openai") is False


def test_record_success_during_unhealthy():
    hw = HealthWatcher(max_failures=1)
    hw.record_failure("openai", "timeout")
    assert hw.status("openai") == "UNHEALTHY"
    hw.record_success("openai")
    assert hw.status("openai") == "HEALTHY"


def test_record_failure_during_probing():
    hw = HealthWatcher(max_failures=2, recovery_probes=3)
    hw.record_failure("openai", "timeout")
    hw.record_failure("openai", "timeout")
    assert hw.status("openai") == "UNHEALTHY"
    hw.record_probe_success("openai")
    assert hw.status("openai") == "PROBING"
    hw.record_failure("openai", "timeout")
    assert hw.status("openai") == "UNHEALTHY"


def test_probe_failure_resets():
    hw = HealthWatcher(max_failures=1, recovery_probes=3)
    hw.record_failure("openai", "timeout")
    hw.record_probe_success("openai")
    hw.record_probe_failure("openai")
    assert hw.status("openai") == "UNHEALTHY"
