"""Error envelope and exception handlers (spine: ``{code, message, details?}``).

One envelope shape for every engine_service error and one mapping site —
routes never build ad-hoc error dicts. Domain errors from the pure core
(``InvalidTriangleError`` with cell-level findings, ``MissingAprioriError``
naming the uncovered Origin Periods) pass through INTACT.
"""

from typing import Any

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from copilot_agent import ModelNotConfiguredError
from reserving_engine import InvalidAprioriError, InvalidTriangleError, MissingAprioriError


class ServiceAuthError(Exception):
    """Raised by the auth dependency when the shared service bearer secret
    is missing, malformed, or wrong. Mapped to a generic 401 — no auth
    oracle."""


class ErrorEnvelope(BaseModel):
    """The only error body any endpoint returns."""

    code: str
    message: str
    details: Any | None = None


def _envelope(status: int, code: str, message: str, details: Any | None = None) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content=ErrorEnvelope(code=code, message=message, details=details).model_dump(),
    )


def register_exception_handlers(app: FastAPI) -> None:
    """Wire every domain / request error to the envelope. No broad
    ``Exception`` handler: unexpected failures are bugs and surface as
    FastAPI's default 500 — never masked into a fake success (decision #6)."""

    @app.exception_handler(ServiceAuthError)
    async def _auth(_request: Request, _exc: ServiceAuthError) -> JSONResponse:
        return _envelope(401, "unauthorized", "missing or invalid service credentials")

    @app.exception_handler(InvalidTriangleError)
    async def _invalid_triangle(_request: Request, exc: InvalidTriangleError) -> JSONResponse:
        return _envelope(
            422,
            "triangle_invalid",
            str(exc),
            [finding.model_dump(by_alias=True) for finding in exc.report.findings],
        )

    @app.exception_handler(MissingAprioriError)
    async def _missing_apriori(_request: Request, exc: MissingAprioriError) -> JSONResponse:
        return _envelope(
            422,
            "missing_apriori",
            str(exc),
            {"missingOrigins": list(exc.missing_origins)},
        )

    @app.exception_handler(InvalidAprioriError)
    async def _invalid_apriori(_request: Request, exc: InvalidAprioriError) -> JSONResponse:
        return _envelope(
            422,
            "invalid_apriori",
            str(exc),
            {"origins": list(exc.origins)},
        )

    @app.exception_handler(ModelNotConfiguredError)
    async def _model_unavailable(_request: Request, _exc: ModelNotConfiguredError) -> JSONResponse:
        # Story 5.3 (AD-9): the interpretation model is not configured. A stable
        # `model_unavailable` (503) so callEngine surfaces `engine.model_unavailable`
        # — the typed signal Story 5.6 keys Engine-Only Mode on. The key is never
        # echoed. Not a bug (no 500): a deliberate fail-closed outcome.
        return _envelope(
            503,
            "model_unavailable",
            "the interpretation model is not configured for this deployment",
        )

    @app.exception_handler(RequestValidationError)
    async def _bad_request(_request: Request, exc: RequestValidationError) -> JSONResponse:
        return _envelope(
            422,
            "bad_request",
            "request body failed validation",
            jsonable_encoder(exc.errors()),
        )
