"""engine_service configuration (imperative shell — AD-2, AD-12).

Environment reads live HERE, never in ``reserving_engine`` (the
import-linter forbids ``os`` there). ``ENGINE_SERVICE_SECRET`` (AD-12)
and the agent-layer model config ``GEMINI_API_KEY`` / ``GEMINI_MODEL_ID``
(Story 5.1) are in scope; the per-Run interpretation ceiling / timeout /
attempts land HERE too (Story 5.6, AD-9). All are named in
``.env.example``.

The service secret is required and fails loud. Every other value is
OPTIONAL with a default: Engine-Only Mode (AD-9) requires ingestion /
runs / diagnostics to work with NO model configured, so a missing
``GEMINI_API_KEY`` must never block engine_service startup — the "model
not configured" failure belongs at agent-construction time
(``copilot_agent``), feeding 5.6's fail-closed path, not at process boot.
The interpretation ceiling/timeout/attempts likewise default so an
engine-only deployment still boots (AD-9).

Neither the service secret nor the Gemini API key is ever logged. The
interpretation ceiling / timeout / attempts are NOT secrets and may be
logged or echoed structurally (AD-12).
"""

import os
from dataclasses import dataclass

_SERVICE_SECRET_ENV = "ENGINE_SERVICE_SECRET"
_GEMINI_API_KEY_ENV = "GEMINI_API_KEY"
_GEMINI_MODEL_ID_ENV = "GEMINI_MODEL_ID"
# Story 5.6 (AD-9, NFR-7): the per-Run interpretation ceiling / timeout /
# bounded-redraft attempts. All non-secret.
_INTERPRETATION_MAX_ATTEMPTS_ENV = "INTERPRETATION_MAX_ATTEMPTS"
_INTERPRETATION_TOKEN_CEILING_ENV = "INTERPRETATION_TOKEN_CEILING"
_INTERPRETATION_TIMEOUT_SECONDS_ENV = "INTERPRETATION_TIMEOUT_SECONDS"


@dataclass(frozen=True)
class Settings:
    """Immutable process config. The dependency closes over one instance
    (AD-3: config, not request state).

    ``gemini_api_key`` / ``gemini_model_id`` are ``None`` when unset —
    ``copilot_agent`` (Story 5.1) is handed these values and raises a
    typed error if the caller composes an agent without them (AD-9).

    ``interpretation_max_attempts`` / ``interpretation_token_ceiling`` /
    ``interpretation_timeout_seconds`` bound the interpretation redraft
    loop (Story 5.6, AD-9): the calls ceiling (replaces the old
    ``MAX_ATTEMPTS`` module constant), the per-Run cumulative token
    ceiling (``None`` = unbounded), and the ≤10-min wall-clock timeout
    (NFR-7). A breach fails the Interpretation closed into Engine-Only
    Mode; the engine never persists mode state (Convex owns it)."""

    service_secret: str
    gemini_api_key: str | None = None
    gemini_model_id: str | None = None
    interpretation_max_attempts: int = 3
    interpretation_token_ceiling: int | None = None
    interpretation_timeout_seconds: float = 600.0


def _int_or_default(raw: str | None, default: int) -> int:
    """Parse an int env var defensively: unset/empty/garbage → ``default``.
    Non-secret config never fails startup on a malformed value (AD-9)."""
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _optional_int(raw: str | None) -> int | None:
    """Parse an optional int env var: unset/empty/garbage → ``None``
    (unbounded). Mirrors the ``os.environ.get(...) or None`` idiom."""
    if raw is None or raw.strip() == "":
        return None
    try:
        return int(raw)
    except ValueError:
        return None


def _float_or_default(raw: str | None, default: float) -> float:
    """Parse a float env var defensively: unset/empty/garbage → ``default``."""
    if raw is None or raw.strip() == "":
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def load_settings() -> Settings:
    """Read config from the environment. ``ENGINE_SERVICE_SECRET`` fails
    loud if unset/empty — engine_service cannot authenticate callers
    without it (AD-12). ``GEMINI_API_KEY`` / ``GEMINI_MODEL_ID`` are
    optional (``None`` when unset/empty) so engine-only deployments start
    without a model (AD-9). The interpretation ceiling / timeout / attempts
    parse defensively (unset/empty/garbage → the default; the ceiling is
    ``None`` = unbounded when unset), so a bad value never blocks boot."""
    secret = os.environ.get(_SERVICE_SECRET_ENV, "")
    if not secret:
        raise RuntimeError(
            f"{_SERVICE_SECRET_ENV} is unset or empty; engine_service cannot "
            "start without the shared service secret (AD-12)"
        )
    return Settings(
        service_secret=secret,
        gemini_api_key=os.environ.get(_GEMINI_API_KEY_ENV) or None,
        gemini_model_id=os.environ.get(_GEMINI_MODEL_ID_ENV) or None,
        interpretation_max_attempts=_int_or_default(
            os.environ.get(_INTERPRETATION_MAX_ATTEMPTS_ENV), 3
        ),
        interpretation_token_ceiling=_optional_int(
            os.environ.get(_INTERPRETATION_TOKEN_CEILING_ENV)
        ),
        interpretation_timeout_seconds=_float_or_default(
            os.environ.get(_INTERPRETATION_TIMEOUT_SECONDS_ENV), 600.0
        ),
    )
