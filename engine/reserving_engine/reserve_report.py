"""ReserveReport: the typed, gated Reserve Report document (FR-11).

Pure-core contract (AD-2): this module performs no file, network,
environment, clock, or logging side effects — typed Pydantic models plus
one pure structural validation function. It is the AD-10 cross-runtime
contract for the drafted Reserve Report document: Story 5.4 exports its
JSON Schema and CI-diffs the Convex validator against it, exactly like
ResultSet / DiagnosticsBundle / Recommendations.

It does NOT draft the report (that is the agent, hosted in engine_service)
and it computes NO figures (AD-1) — each section's ``text`` is the
post-gate rendered prose and ``citations`` is the resolved Diagnostic id
list handed over by the Provenance Gate (Story 5.2). This module only
defines the shape and checks well-formedness of a report against a
completed Run.

The **four sections are NAMED fields**, not a variable list, so "exactly
the four sections, all present" is structural-by-construction (Pydantic
requires all four; a missing section cannot form a ``ReserveReport``).
``schema_version`` is this document's own contract version ("1.0.0"),
independent of ``ENGINE_VERSION``. Diagnostic IDs are resolved via
``resolve_diagnostic`` (dict lookup over the bundle), never string-split —
labels are opaque (AD-10).

This is the exact structural twin of ``reserving_engine/recommendations.py``
(Story 5.3), with one deliberate divergence: a section's ``citations`` MAY
be empty (a purely-qualitative caveat with no figure) — the gate's
per-block ``uncited_claim`` rule owns the claim-citation coupling, so a
``≥1`` structural requirement here would wrongly reject a legitimately
citation-free qualitative section (see the story Dev Notes §Section
citation minima).
"""

from typing import Literal

from pydantic import BaseModel

from reserving_engine.diagnostics import (
    DiagnosticsBundle,
    UnknownDiagnosticIdError,
    resolve_diagnostic,
)
from reserving_engine.resultset import _MODEL_CONFIG, ResultSet


class ReserveReportSection(BaseModel):
    """One section of the drafted Reserve Report, post-Provenance-Gate.

    ``text`` is the RENDERED section prose (post-gate: ``{{dx:...}}``
    placeholders already rendered to citation markers, any ``{{rs:...}}``
    figure rendered to its display value). ``citations`` is the tuple of
    resolved Diagnostic IDs the section cites — the machine-readable pin
    for the 5.5/Epic-6 CitationChip. It is the resolved-``{{dx:...}}`` id
    list from the gate's ``GateAccepted.citations``, NEVER re-parsed from
    ``text``.

    ``citations`` MAY be empty for a purely-qualitative section (e.g. a
    limitations caveat with no figure): the gate's per-block
    ``uncited_claim`` rule already forces a citation on any block that
    states a figure, at the granularity that matters (see the story Dev
    Notes §Section citation minima). This is the one divergence from
    ``RecommendationReason`` (which requires ≥1 citation).
    """

    model_config = _MODEL_CONFIG

    text: str
    citations: tuple[str, ...]


class ReserveReport(BaseModel):
    """The complete, self-describing Reserve Report document for one Run.

    The **four sections are NAMED fields** — executive summary, method
    selection rationale, movement commentary, limitations (FR-11) — so
    "exactly the four sections, all present" is structural-by-construction:
    Pydantic requires all four, and a missing section cannot form a
    ``ReserveReport``.

    ``run_id`` is the correlation key (must equal the request's runId / the
    bundle's ``run_id``). ``machine_drafted`` marks the AC-3 "machine-drafted
    provenance" (True for this story's agent path — Epic 6 human edits
    flip/version it, out of scope here).
    """

    model_config = _MODEL_CONFIG

    schema_version: str = "1.0.0"
    run_id: str
    machine_drafted: bool = True
    executive_summary: ReserveReportSection
    method_selection_rationale: ReserveReportSection
    movement_commentary: ReserveReportSection
    limitations: ReserveReportSection


class ReserveReportRejection(BaseModel):
    """One typed structural rejection — everything the bounded redraft loop
    and the audit entry need to explain and re-prompt a rejected draft.

    Mirrors ``RecommendationRejection``. This model never crosses to Convex
    as persisted state (it rides inside audit payloads as ``v.any()``), so
    it is deliberately NOT schema-exported. ``section`` carries the wire
    field name (``executiveSummary``, …) the redraft prompt and audit entry
    reference.
    """

    model_config = _MODEL_CONFIG

    code: Literal["empty_section", "unresolvable_citation"]
    message: str
    section: str | None = None
    details: dict | None = None


# The four sections paired with their camelCase wire field name — a fixed
# iteration order so a rejection's ``section`` carries the wire name the
# redraft prompt and audit entry reference. Named-field coverage ("all four
# present") is already guaranteed by the model shape.
def _sections(report: ReserveReport) -> tuple[tuple[str, ReserveReportSection], ...]:
    return (
        ("executiveSummary", report.executive_summary),
        ("methodSelectionRationale", report.method_selection_rationale),
        ("movementCommentary", report.movement_commentary),
        ("limitations", report.limitations),
    )


def validate_reserve_report(
    report: ReserveReport,
    result_set: ResultSet,
    diagnostics_bundle: DiagnosticsBundle,
) -> tuple[ReserveReportRejection, ...]:
    """The pure "validated programmatically before output is accepted" check.

    Return an EMPTY tuple when well-formed; otherwise ALL accumulated
    rejections (never fail on the first — the bounded loop wants the complete
    list to re-prompt). Computes no figures (AD-1); resolves Diagnostic IDs
    via ``resolve_diagnostic`` (AD-10), never by string-splitting.

    Checks (coverage — "all four present" — is guaranteed by the named-field
    model shape, so it is not re-checked here):

    * **Non-empty sections.** Each section's ``text.strip()`` must be
      non-empty → ``empty_section`` (catches a present-but-blank section the
      agent emitted to satisfy the shape).
    * **Citation resolvability.** Every citation id in every section must
      resolve via ``resolve_diagnostic`` → ``unresolvable_citation`` (a
      belt-and-braces re-check of the assembled document; the gate already
      resolved these while rendering).

    ``result_set`` is accepted for signature symmetry with
    ``validate_recommendations`` (and forward-compatibility); this story's
    checks read only the report + bundle.
    """
    rejections: list[ReserveReportRejection] = []

    for name, section in _sections(report):
        if not section.text.strip():
            rejections.append(
                ReserveReportRejection(
                    code="empty_section",
                    message=f"section {name!r} has empty text",
                    section=name,
                )
            )
        for citation in section.citations:
            try:
                resolve_diagnostic(diagnostics_bundle, citation)
            except UnknownDiagnosticIdError:
                rejections.append(
                    ReserveReportRejection(
                        code="unresolvable_citation",
                        message=f"citation {citation!r} does not resolve against this Run",
                        section=name,
                        details={"diagnosticId": citation},
                    )
                )

    return tuple(rejections)
