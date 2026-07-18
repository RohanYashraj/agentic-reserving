"""engine_service configuration (imperative shell — AD-2, AD-12).

Environment reads live HERE, never in ``reserving_engine`` (the
import-linter forbids ``os`` there). Only the shared service secret is
in scope this story; ``GEMINI_API_KEY`` / ``GEMINI_MODEL_ID`` / the
per-Run token ceiling are the agent layer's config (Story 5.x) and are
already named in ``.env.example``.

The secret's value is never logged.
"""

import os
from dataclasses import dataclass

_SERVICE_SECRET_ENV = "ENGINE_SERVICE_SECRET"


@dataclass(frozen=True)
class Settings:
    """Immutable process config. The dependency closes over one instance
    (AD-3: config, not request state)."""

    service_secret: str


def load_settings() -> Settings:
    """Read ``ENGINE_SERVICE_SECRET`` from the environment, failing loud
    if it is unset or empty — engine_service cannot authenticate callers
    without it (AD-12)."""
    secret = os.environ.get(_SERVICE_SECRET_ENV, "")
    if not secret:
        raise RuntimeError(
            f"{_SERVICE_SECRET_ENV} is unset or empty; engine_service cannot "
            "start without the shared service secret (AD-12)"
        )
    return Settings(service_secret=secret)
