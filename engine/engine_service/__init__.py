"""engine_service: the FastAPI imperative shell over reserving_engine.

The only plane that does I/O and HTTP (AD-2). Stateless between requests
(AD-3) — anything worth keeping is returned to the calling Convex action
to persist. Every endpoint requires the shared service bearer secret
(AD-12); engine_service performs no user auth and never calls Convex or
Clerk. Idempotency by runId is determinism + statelessness, not a cache
(AD-7).

Run locally: ``uv run uvicorn engine_service.app:create_app --factory``
(secret via ``ENGINE_SERVICE_SECRET``).
"""

from engine_service.app import create_app
from engine_service.config import Settings, load_settings
from engine_service.errors import ErrorEnvelope

__all__ = [
    "ErrorEnvelope",
    "Settings",
    "create_app",
    "load_settings",
]
