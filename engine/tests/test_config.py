"""engine_service config tests — the Story 5.6 interpretation ceiling/timeout/
attempts (Task 1).

``load_settings`` reads the three new env vars defensively: unset/empty/garbage
falls back to the default (the ceiling to ``None`` = unbounded), so a bad value
never blocks engine_service startup (AD-9). The service secret still fails loud.
"""

import pytest

from engine_service.config import Settings, load_settings

SECRET = "test-service-secret-123"


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    # Start every case from a known-empty interpretation config; each test sets
    # only what it asserts. The service secret is always present so load_settings
    # reaches the interpretation parsing.
    monkeypatch.setenv("ENGINE_SERVICE_SECRET", SECRET)
    for var in (
        "INTERPRETATION_MAX_ATTEMPTS",
        "INTERPRETATION_TOKEN_CEILING",
        "INTERPRETATION_TIMEOUT_SECONDS",
        "GEMINI_API_KEY",
        "GEMINI_MODEL_ID",
    ):
        monkeypatch.delenv(var, raising=False)


def test_defaults_when_unset() -> None:
    settings = load_settings()
    assert settings.interpretation_max_attempts == 3
    assert settings.interpretation_token_ceiling is None  # unbounded
    assert settings.interpretation_timeout_seconds == 600.0


def test_reads_configured_values(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("INTERPRETATION_MAX_ATTEMPTS", "5")
    monkeypatch.setenv("INTERPRETATION_TOKEN_CEILING", "250000")
    monkeypatch.setenv("INTERPRETATION_TIMEOUT_SECONDS", "300")
    settings = load_settings()
    assert settings.interpretation_max_attempts == 5
    assert settings.interpretation_token_ceiling == 250000
    assert settings.interpretation_timeout_seconds == 300.0


def test_empty_strings_fall_back_to_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("INTERPRETATION_MAX_ATTEMPTS", "")
    monkeypatch.setenv("INTERPRETATION_TOKEN_CEILING", "")
    monkeypatch.setenv("INTERPRETATION_TIMEOUT_SECONDS", "")
    settings = load_settings()
    assert settings.interpretation_max_attempts == 3
    assert settings.interpretation_token_ceiling is None
    assert settings.interpretation_timeout_seconds == 600.0


def test_garbage_values_fall_back_to_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    # A non-numeric value must never crash startup (AD-9) — parse-defensive.
    monkeypatch.setenv("INTERPRETATION_MAX_ATTEMPTS", "not-a-number")
    monkeypatch.setenv("INTERPRETATION_TOKEN_CEILING", "lots")
    monkeypatch.setenv("INTERPRETATION_TIMEOUT_SECONDS", "soon")
    settings = load_settings()
    assert settings.interpretation_max_attempts == 3
    assert settings.interpretation_token_ceiling is None
    assert settings.interpretation_timeout_seconds == 600.0


def test_missing_secret_still_fails_loud(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ENGINE_SERVICE_SECRET", raising=False)
    with pytest.raises(RuntimeError):
        load_settings()


def test_settings_dataclass_defaults() -> None:
    # The frozen dataclass defaults let engine-only deployments construct
    # Settings with only the secret (AD-9).
    settings = Settings(service_secret=SECRET)
    assert settings.interpretation_max_attempts == 3
    assert settings.interpretation_token_ceiling is None
    assert settings.interpretation_timeout_seconds == 600.0
