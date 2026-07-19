"""Recommendations: the typed per-Origin-Period Method recommendation (FR-10).

Pure-core contract (AD-2): this module performs no file, network,
environment, clock, or logging side effects — typed Pydantic models plus
one pure structural validation function. It is the AD-10 cross-runtime
contract for the recommendations document: Story 5.3 exports its JSON
Schema and CI-diffs the Convex validator against it, exactly like
ResultSet / DiagnosticsBundle.

It does NOT generate recommendations (that is the agent, hosted in
engine_service) and it computes NO figures (AD-1) — the reason ``text`` is
the post-gate rendered string and ``citations`` is the resolved Diagnostic
id list handed over by the Provenance Gate (Story 5.2). This module only
defines the shape and checks well-formedness of a recommendation set
against a completed Run.

``schema_version`` is this document's own contract version ("1.0.0"),
independent of ``ENGINE_VERSION``. Diagnostic IDs are resolved via
``resolve_diagnostic`` (dict lookup over the bundle), never string-split —
labels are opaque (AD-10).
"""

from collections import Counter
from typing import Literal

from pydantic import BaseModel

from reserving_engine.diagnostics import (
    DiagnosticsBundle,
    UnknownDiagnosticIdError,
    resolve_diagnostic,
)
from reserving_engine.resultset import _MODEL_CONFIG, ResultSet


class RecommendationReason(BaseModel):
    """One reason a Method was recommended for an Origin Period.

    ``text`` is the RENDERED reason string (post-gate: ``{{dx:...}}``
    placeholders already rendered to citation markers, any ``{{rs:...}}``
    figure rendered to its display value). ``citations`` is the tuple of
    resolved Diagnostic IDs the reason cites (≥1 for a well-formed reason)
    — the machine-readable pin for the FR-10 "each reason citing ≥1
    Diagnostic ID" guarantee and Story 5.5's CitationChip. It is the
    resolved-``{{dx:...}}`` id list from the gate's ``GateAccepted.citations``,
    NEVER re-parsed from ``text``.
    """

    model_config = _MODEL_CONFIG

    text: str
    citations: tuple[str, ...]


class MethodRecommendation(BaseModel):
    """The recommended Method for one Origin Period, with cited reasons.

    ``method`` reuses the SAME three Method literals as
    ``RunParameters.methods`` / ``MethodResult.method`` (no new enum). There
    is exactly one ``MethodRecommendation`` per Origin Period in the Run;
    ``reasons`` is non-empty (validated in ``validate_recommendations``).
    """

    model_config = _MODEL_CONFIG

    origin: str
    method: Literal["chain_ladder", "bornhuetter_ferguson", "mack"]
    reasons: tuple[RecommendationReason, ...]


class Recommendations(BaseModel):
    """The complete, self-describing recommendations document for one Run.

    ``run_id`` is the correlation key (must equal the request's runId / the
    bundle's ``run_id``). The ``recommendations`` tuple carries exactly one
    ``MethodRecommendation`` per Origin Period in the Run.
    """

    model_config = _MODEL_CONFIG

    schema_version: str = "1.0.0"
    run_id: str
    recommendations: tuple[MethodRecommendation, ...]


class RecommendationRejection(BaseModel):
    """One typed structural rejection — everything the bounded redraft loop
    and the audit entry need to explain and re-prompt a rejected draft.

    Mirrors the Provenance Gate's ``GateRejection`` shape. This model never
    crosses to Convex as persisted state (it rides inside audit payloads as
    ``v.any()``), so it is deliberately NOT schema-exported.
    """

    model_config = _MODEL_CONFIG

    code: Literal[
        "missing_origin",
        "duplicate_origin",
        "unknown_origin",
        "unrun_method",
        "no_reason",
        "uncited_reason",
        "unresolvable_citation",
    ]
    message: str
    origin: str | None = None
    details: dict | None = None


def validate_recommendations(
    recommendations: Recommendations,
    result_set: ResultSet,
    diagnostics_bundle: DiagnosticsBundle,
) -> tuple[RecommendationRejection, ...]:
    """The "validated programmatically before output is accepted" check (AC-1).

    Return an EMPTY tuple when well-formed; otherwise ALL accumulated
    rejections (never fail on the first — the bounded loop wants the complete
    list to re-prompt). Computes no figures (AD-1); resolves Diagnostic IDs
    via ``resolve_diagnostic`` (AD-10), never by string-splitting.
    """
    rejections: list[RecommendationRejection] = []

    # Coverage — exactly one MethodRecommendation per Origin Period. The
    # authoritative set is shared across methods; every method result carries
    # the same origins (Story 2.x), so the first method result is canonical.
    expected_origins = tuple(
        o.origin for o in result_set.method_results[0].origin_results
    )
    expected_set = set(expected_origins)
    counts = Counter(rec.origin for rec in recommendations.recommendations)

    for origin in expected_origins:
        if counts[origin] == 0:
            rejections.append(
                RecommendationRejection(
                    code="missing_origin",
                    message=f"Origin Period {origin!r} has no Method recommendation",
                    origin=origin,
                )
            )
    for origin, count in counts.items():
        if origin not in expected_set:
            rejections.append(
                RecommendationRejection(
                    code="unknown_origin",
                    message=f"origin {origin!r} is not an Origin Period in this Run",
                    origin=origin,
                )
            )
        elif count > 1:
            rejections.append(
                RecommendationRejection(
                    code="duplicate_origin",
                    message=f"Origin Period {origin!r} has {count} recommendations; expected exactly one",
                    origin=origin,
                )
            )

    # Method validity — each recommended Method must be one the Run actually
    # executed (recommending a method that was not run is meaningless — its
    # figures do not exist).
    run_methods_set = {m.method for m in result_set.method_results}

    for rec in recommendations.recommendations:
        if rec.method not in run_methods_set:
            rejections.append(
                RecommendationRejection(
                    code="unrun_method",
                    message=f"method {rec.method!r} was not executed in this Run",
                    origin=rec.origin,
                    details={"method": rec.method},
                )
            )

        # Reason + citation minima.
        if not rec.reasons:
            rejections.append(
                RecommendationRejection(
                    code="no_reason",
                    message=f"Origin Period {rec.origin!r} has no reason",
                    origin=rec.origin,
                )
            )
        for reason in rec.reasons:
            if not reason.citations:
                rejections.append(
                    RecommendationRejection(
                        code="uncited_reason",
                        message=f"a reason for Origin Period {rec.origin!r} cites no Diagnostic ID",
                        origin=rec.origin,
                    )
                )
            for citation in reason.citations:
                try:
                    resolve_diagnostic(diagnostics_bundle, citation)
                except UnknownDiagnosticIdError:
                    rejections.append(
                        RecommendationRejection(
                            code="unresolvable_citation",
                            message=f"citation {citation!r} does not resolve against this Run",
                            origin=rec.origin,
                            details={"diagnosticId": citation},
                        )
                    )

    return tuple(rejections)
