"""The bounded draft-gate-validate loop for the Reserve Report (Story 5.4).

This is the imperative composition that wires ``copilot_agent`` (the agent +
read-only tools + transcript) + the Provenance Gate (5.2) +
``validate_reserve_report`` (Task 1) into one bounded redraft loop — the
**exact structural twin of ``engine_service/recommendations_flow.py``**
(Story 5.3). It lives in ``engine_service`` — the shell that hosts the agent
and invokes the gate (AD-2/AD-8) — and imports only downward
(``copilot_agent``, ``engine_service.provenance_gate``, ``reserving_engine``).

**The redraft loop lives HERE, not in Convex** (same rationale as 5.3): a
redraft is an agent turn that must see what failed and try again within one
request, keeping the transient Agno session semantics (AD-3) and the
agent+gate co-located. The Convex ``generateReserveReport`` action stays the
thin persist+audit tail.

It **reuses ``AttemptRecord``, ``AttemptRejection``, ``MAX_ATTEMPTS`` and the
shared ``enforce_interpretation_budget`` guard from ``recommendations_flow``**
(they are generic: ``source``/``code``/``message``/``origin``/``token``/
``details`` + ``transcript``; the section name rides in
``details={"section": name}``, so no edit to the 5.3 types is needed). One
shared bounded-redraft ceiling + one shared fail-closed budget guard; Story 5.6
turns the ceiling/timeout/attempts into config.

Determinism (AD-3): given a deterministic (scripted) ``model`` AND an injected
``now`` clock this function is deterministic — no randomness, no logging. The
timeout deadline is derived from the INJECTED ``now`` (Story 5.6, D5), never
``time.monotonic`` inline. HTTP/JSONResponse concerns stay OUT of this module
(Task 5 owns the route).
"""

import time
from collections.abc import Callable
from typing import Literal

from agno.models.base import Model
from pydantic import BaseModel

from copilot_agent import (
    DraftParseError,
    build_interpretation_agent,
    build_report_prompt,
    parse_report_draft,
    run_interpretation,
)
from engine_service.provenance_gate import GateRejected, run_provenance_gate
from engine_service.recommendations_flow import (
    DEFAULT_TIMEOUT_SECONDS,
    MAX_ATTEMPTS,
    AttemptRecord,
    AttemptRejection,
    enforce_interpretation_budget,
)
from reserving_engine import (
    DiagnosticsBundle,
    Recommendations,
    ReserveReport,
    ReserveReportSection,
    ResultSet,
    validate_reserve_report,
)
from reserving_engine.resultset import _MODEL_CONFIG

# The four report sections as (camelCase wire name, snake_case draft/report
# field). A fixed order the loop gates and assembles by — the wire name carries
# into a rejection's ``details["section"]`` so the redraft prompt names it.
_SECTIONS: tuple[tuple[str, str], ...] = (
    ("executiveSummary", "executive_summary"),
    ("methodSelectionRationale", "method_selection_rationale"),
    ("movementCommentary", "movement_commentary"),
    ("limitations", "limitations"),
)

# The user-turn trigger. The contract itself is taught in the agent's
# instructions (``build_report_prompt``); this just asks for output.
_USER_PROMPT = (
    "Draft the Reserve Report now as the JSON object described, with all four "
    "sections."
)


class ReserveReportAccepted(BaseModel):
    """A clean attempt: the gated + structurally-valid ``ReserveReport`` plus
    every attempt's transcript (for audit — FR-15)."""

    model_config = _MODEL_CONFIG

    status: Literal["accepted"] = "accepted"
    report: ReserveReport
    attempts: tuple[AttemptRecord, ...]


class ReserveReportFailed(BaseModel):
    """Exhaustion (AC-2): ``max_attempts`` with no clean attempt. Carries every
    attempt's transcript + rejections but — by construction — NO ``report``
    attribute (the never-persist guarantee, mirroring ``GateRejected`` /
    ``RecommendationsFailed``)."""

    model_config = _MODEL_CONFIG

    status: Literal["failed"] = "failed"
    reason_summary: str
    attempts: tuple[AttemptRecord, ...]


ReserveReportOutcome = ReserveReportAccepted | ReserveReportFailed


def _report_feedback(rejections: tuple[AttemptRejection, ...]) -> str:
    """Turn the prior attempt's rejections into re-prompt text — the model is
    told exactly what failed so it can fix it (empty section X, unsourced
    number in section Y, uncited claim in section Z, …).

    Unlike 5.3's ``_redraft_feedback`` (which keys off ``rej.origin``), the
    section rides in ``rej.details["section"]`` (report sections are not
    origins), so this report-scoped variant reads it from there.
    """
    lines = ["Your previous attempt was REJECTED for these reasons. Fix ALL of them:"]
    for rej in rejections:
        section = (rej.details or {}).get("section")
        where = f" (section {section})" if section else ""
        lines.append(f"- [{rej.code}]{where} {rej.message}")
    return "\n".join(lines)


def _evaluate_attempt(
    output_text: str,
    result_set: ResultSet,
    diagnostics_bundle: DiagnosticsBundle,
) -> tuple[ReserveReport | None, tuple[AttemptRejection, ...]]:
    """Parse → gate each section → assemble candidate → structural validate.

    Returns ``(candidate, rejections)``. ``candidate`` is the assembled
    ``ReserveReport`` ONLY when all four sections gate-passed (a named-field
    model cannot be partially built); it is ``None`` otherwise. ``rejections``
    is the accumulated set from all three checks — empty iff the attempt is
    clean.
    """
    try:
        draft = parse_report_draft(output_text)
    except DraftParseError as exc:
        return None, (
            AttemptRejection(source="parse", code="draft_unparseable", message=str(exc)),
        )

    rejections: list[AttemptRejection] = []
    gated_sections: dict[str, ReserveReportSection] = {}
    for wire_name, attr in _SECTIONS:
        raw_text = getattr(draft, attr)
        result = run_provenance_gate(raw_text, result_set, diagnostics_bundle)
        if isinstance(result, GateRejected):
            rejections.extend(
                AttemptRejection(
                    source="gate",
                    code=r.code,
                    message=r.message,
                    token=r.token,
                    details={"section": wire_name, **(r.details or {})},
                )
                for r in result.reasons
            )
            continue
        gated_sections[attr] = ReserveReportSection(
            text=result.rendered_content,
            citations=tuple(c.diagnostic_id for c in result.citations),
        )

    # A named-field ReserveReport cannot be assembled unless every section
    # gate-passed. If any was rejected, record and loop (no partial document).
    if len(gated_sections) != len(_SECTIONS):
        return None, tuple(rejections)

    candidate = ReserveReport(
        run_id=diagnostics_bundle.run_id,
        machine_drafted=True,
        executive_summary=gated_sections["executive_summary"],
        method_selection_rationale=gated_sections["method_selection_rationale"],
        movement_commentary=gated_sections["movement_commentary"],
        limitations=gated_sections["limitations"],
    )
    for structural in validate_reserve_report(
        candidate, result_set, diagnostics_bundle
    ):
        rejections.append(
            AttemptRejection(
                source="structural",
                code=structural.code,
                message=structural.message,
                details={"section": structural.section, **(structural.details or {})},
            )
        )
    return candidate, tuple(rejections)


def generate_reserve_report(
    model: Model,
    result_set: ResultSet,
    diagnostics_bundle: DiagnosticsBundle,
    recommendations: Recommendations,
    *,
    max_attempts: int = MAX_ATTEMPTS,
    token_ceiling: int | None = None,
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
    now: Callable[[], float] = time.monotonic,
) -> ReserveReportOutcome:
    """Run the bounded draft-gate-validate loop (AC-1, AC-2, AC-4).

    ``model`` is INJECTED (the 5.1 test seam — tests pass a scripted ``Model``,
    prod passes ``build_gemini_model(...)``); ``recommendations`` is the
    accepted document (AC-1 precondition, fed to ``build_report_prompt``). Each
    iteration builds a fresh agent, runs it, parses the draft, gates every
    section, assembles a candidate, and structurally validates it. A clean
    attempt returns ``ReserveReportAccepted`` immediately; exhaustion after
    ``max_attempts`` returns ``ReserveReportFailed`` carrying every transcript
    — never partial output. ``ModelNotConfiguredError`` from
    ``build_gemini_model`` is raised at the route BEFORE this loop (Task 5) and
    is never a redraftable rejection.

    Story 5.6 (AD-9, D5): the identical fail-closed per-Run budget as
    ``generate_recommendations`` — ``token_ceiling`` (cumulative model tokens,
    ``None`` = unbounded) and ``timeout_seconds`` against a deadline from the
    INJECTED ``now`` clock, enforced by the shared ``enforce_interpretation_budget``
    guard before every model turn and once more at exhaustion. A breach raises
    ``CostCeilingExceededError`` / ``InterpretationTimeoutError`` (503 envelopes).
    """
    instructions = build_report_prompt(result_set, diagnostics_bundle, recommendations)
    attempts: list[AttemptRecord] = []
    prior_rejections: tuple[AttemptRejection, ...] = ()
    deadline = now() + timeout_seconds
    cumulative_tokens = 0

    for _ in range(max_attempts):
        # Fail-closed budget guard BEFORE spending a model turn (AD-9).
        enforce_interpretation_budget(now, deadline, cumulative_tokens, token_ceiling)

        agent = build_interpretation_agent(
            model, result_set, diagnostics_bundle, instructions=instructions
        )
        prompt = _USER_PROMPT
        if prior_rejections:
            prompt = f"{prompt}\n\n{_report_feedback(prior_rejections)}"

        # Model-plane errors propagate to the caller (AD-9 fail-closed); they are
        # NOT swallowed as a redraftable rejection.
        result = run_interpretation(agent, prompt)
        cumulative_tokens += result.token_count

        candidate, rejections = _evaluate_attempt(
            result.output_text, result_set, diagnostics_bundle
        )
        attempts.append(
            AttemptRecord(transcript=result.transcript, rejections=rejections)
        )

        if not rejections:
            # candidate is non-None whenever there are zero rejections (a parse
            # failure or any gate rejection always yields ≥1 rejection).
            assert candidate is not None
            return ReserveReportAccepted(report=candidate, attempts=tuple(attempts))
        prior_rejections = rejections

    # Exhausted the attempt budget with no clean draft. Re-check the budget so a
    # timeout / over-ceiling condition fails closed (503) rather than a plain
    # gate-exhaustion rejection.
    enforce_interpretation_budget(now, deadline, cumulative_tokens, token_ceiling)

    last = attempts[-1].rejections if attempts else ()
    codes = sorted({rej.code for rej in last})
    summary = (
        f"reserve report drafting failed after {max_attempts} attempts; "
        f"last attempt had {len(last)} unresolved rejection(s)"
        + (f" ({', '.join(codes)})" if codes else "")
    )
    return ReserveReportFailed(reason_summary=summary, attempts=tuple(attempts))
