"""Service-boundary auth (AD-12): shared bearer secret, constant-time.

engine_service performs NO user auth — it trusts the caller's already
authorized context and only checks the shared secret. ``make_service_auth``
closes over the app's ``Settings`` and returns the FastAPI dependency
attached to every route (the engine-boundary echo of AD-4's "guard
first"). A missing header, non-``Bearer`` scheme, or mismatch raises
``ServiceAuthError`` → a clean 401 envelope, never a browser realm
challenge.
"""

import secrets
from collections.abc import Callable

from fastapi import Request

from engine_service.config import Settings
from engine_service.errors import ServiceAuthError

_BEARER_PREFIX = "Bearer "


def make_service_auth(settings: Settings) -> Callable[[Request], None]:
    def require_service_auth(request: Request) -> None:
        header = request.headers.get("Authorization", "")
        if not header.startswith(_BEARER_PREFIX):
            raise ServiceAuthError
        presented = header[len(_BEARER_PREFIX) :]
        if not secrets.compare_digest(presented, settings.service_secret):
            raise ServiceAuthError

    return require_service_auth
