"""engine_service wire models (request / response).

Reuse ``reserving_engine``'s shared alias config (``_MODEL_CONFIG``) so
this boundary speaks the same camelCase contract as the engine models
(AD-10) — no second config to drift from. The response nests the
engine's ``ResultSet`` / ``DiagnosticsBundle`` unchanged; those already
carry their own aliases.
"""

from typing import Literal

from pydantic import BaseModel, field_validator

from engine_service.recommendations_flow import (
    AttemptRecord,
    RecommendationsAccepted,
    RecommendationsOutcome,
)
from reserving_engine import (
    DiagnosticsBundle,
    Recommendations,
    ResultSet,
    RunParameters,
    Triangle,
)
from reserving_engine.resultset import _MODEL_CONFIG


class ValidateRequest(BaseModel):
    """``POST /validate`` body. No runId — validation mints no IDs and is
    naturally idempotent."""

    model_config = _MODEL_CONFIG

    triangle: Triangle


class RunRequest(BaseModel):
    """``POST /runs`` body. ``run_id`` is the AD-7 idempotency key and the
    value handed to ``compute_diagnostics`` to mint Diagnostic IDs (2.4)."""

    model_config = _MODEL_CONFIG

    run_id: str
    triangle: Triangle
    parameters: RunParameters | None = None

    @field_validator("run_id")
    @classmethod
    def _non_empty_run_id(cls, value: str) -> str:
        if not value:
            raise ValueError("run_id must not be empty")
        return value


class RunResponse(BaseModel):
    """``POST /runs`` response. ``run_id`` is echoed back — the async-upgrade
    seam (a future ``202 + HMAC callback`` returns the same runId, then
    posts ``{runId, resultSet, diagnosticsBundle}``; additive, not a
    rewrite)."""

    model_config = _MODEL_CONFIG

    run_id: str
    result_set: ResultSet
    diagnostics_bundle: DiagnosticsBundle


class ReDeriveRequest(BaseModel):
    """``POST /rederive`` body (Story 4.7, FR-6). Replays a stored ResultSet's
    Lineage: the engine re-executes with ``triangle`` and the parameters read
    from ``stored_result_set.lineage.parameters`` (re-deriving *from Lineage*,
    not from a separate field), then compares against ``stored_result_set``.
    ``run_id`` is the audit correlation key echoed onto the report."""

    model_config = _MODEL_CONFIG

    run_id: str
    triangle: Triangle
    stored_result_set: ResultSet

    @field_validator("run_id")
    @classmethod
    def _non_empty_run_id(cls, value: str) -> str:
        if not value:
            raise ValueError("run_id must not be empty")
        return value


class RecommendRequest(BaseModel):
    """``POST /recommendations`` body (Story 5.3). engine_service is stateless
    (AD-3), so the Run's stored ResultSet + DiagnosticsBundle are passed DOWN
    from Convex — never fetched by the engine. ``run_id`` is the AD-7
    correlation key."""

    model_config = _MODEL_CONFIG

    run_id: str
    result_set: ResultSet
    diagnostics_bundle: DiagnosticsBundle

    @field_validator("run_id")
    @classmethod
    def _non_empty_run_id(cls, value: str) -> str:
        if not value:
            raise ValueError("run_id must not be empty")
        return value


class RecommendResponse(BaseModel):
    """``POST /recommendations`` response (Story 5.3). A discriminated result
    carrying the per-attempt transcript(s) in EVERY arm so the Convex caller
    audit-logs the full LLM interaction on success AND on failure (FR-15,
    AD-6). Both ``accepted`` and ``rejected`` return HTTP 200 — a gate /
    structural exhaustion is a normal, auditable outcome, not a server error
    (``model_unavailable`` and bad input use the error envelope instead).

    ``recommendations`` is the accepted document (``null`` on rejection);
    ``rejection_summary`` explains a rejection (``null`` on acceptance)."""

    model_config = _MODEL_CONFIG

    status: Literal["accepted", "rejected"]
    recommendations: Recommendations | None = None
    attempts: tuple[AttemptRecord, ...]
    rejection_summary: str | None = None

    @classmethod
    def from_outcome(
        cls, run_id: str, outcome: RecommendationsOutcome
    ) -> "RecommendResponse":
        if isinstance(outcome, RecommendationsAccepted):
            return cls(
                status="accepted",
                recommendations=outcome.recommendations,
                attempts=outcome.attempts,
                rejection_summary=None,
            )
        return cls(
            status="rejected",
            recommendations=None,
            attempts=outcome.attempts,
            rejection_summary=outcome.reason_summary,
        )


class CanonicalizeResponse(BaseModel):
    """``POST /canonicalize`` response (Story 3.3). The single value is the
    canonical-triangle-JSON sha256 — *the* Lineage Triangle hash (AD-11),
    computed by ``reserving_engine.triangle_hash``. The request reuses
    ``ValidateRequest`` (``{triangle}``); the Triangle model's structural
    validation is the backstop (duplicate/empty labels, NaN/Inf → 422). Wire
    key ``triangleHash`` (camelCase via ``_MODEL_CONFIG``), matching
    ``Lineage.triangleHash`` so the acceptance-time hash and the run-time
    Lineage hash are the same string."""

    model_config = _MODEL_CONFIG

    triangle_hash: str
