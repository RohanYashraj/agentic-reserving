"""engine_service configuration (imperative shell — AD-2, AD-12).

Environment reads live HERE, never in ``reserving_engine`` (the
import-linter forbids ``os`` there). ``ENGINE_SERVICE_SECRET`` (AD-12)
and the agent-layer model config ``GEMINI_API_KEY`` / ``GEMINI_MODEL_ID``
(Story 5.1) are in scope; the per-Run token/cost ceiling is still the
agent-hardening layer's config (Story 5.6). All three are named in
``.env.example``.

The service secret is required and fails loud. The Gemini values are
OPTIONAL: Engine-Only Mode (AD-9) requires ingestion / runs / diagnostics
to work with NO model configured, so a missing ``GEMINI_API_KEY`` must
never block engine_service startup — the "model not configured" failure
belongs at agent-construction time (``copilot_agent``), feeding 5.6's
fail-closed path, not at process boot.

Neither the service secret nor the Gemini API key is ever logged.
"""

import os
from dataclasses import dataclass

_SERVICE_SECRET_ENV = "ENGINE_SERVICE_SECRET"
_GEMINI_API_KEY_ENV = "GEMINI_API_KEY"
_GEMINI_MODEL_ID_ENV = "GEMINI_MODEL_ID"


@dataclass(frozen=True)
class Settings:
    """Immutable process config. The dependency closes over one instance
    (AD-3: config, not request state).

    ``gemini_api_key`` / ``gemini_model_id`` are ``None`` when unset —
    ``copilot_agent`` (Story 5.1) is handed these values and raises a
    typed error if the caller composes an agent without them (AD-9)."""

    service_secret: str
    gemini_api_key: str | None = None
    gemini_model_id: str | None = None


def load_settings() -> Settings:
    """Read config from the environment. ``ENGINE_SERVICE_SECRET`` fails
    loud if unset/empty — engine_service cannot authenticate callers
    without it (AD-12). ``GEMINI_API_KEY`` / ``GEMINI_MODEL_ID`` are
    optional (``None`` when unset/empty) so engine-only deployments start
    without a model (AD-9)."""
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
    )
