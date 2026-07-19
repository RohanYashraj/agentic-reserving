"""The bounded generate-gate-validate loop for Method recommendations (Story 5.3).

This is the imperative composition the deferred work from Stories 5.1/5.2
pointed here: it wires ``copilot_agent`` (the agent + read-only tools +
transcript) + the Provenance Gate (5.2) + ``validate_recommendations``
(Task 1) into one bounded redraft loop. It lives in ``engine_service`` —
the shell that hosts the agent and invokes the gate (AD-2/AD-8) — and
imports only downward (``copilot_agent``, ``engine_service.provenance_gate``,
``reserving_engine``).

**The redraft loop lives HERE, not in Convex** (reversing 5.2's tentative
"the caller drives the loop"): a redraft is an agent turn that must see what
failed and try again within one request, keeping the transient Agno session
semantics (AD-3) and the agent+gate co-located. The Convex action stays the
thin persist+audit tail (see the story Dev Notes).

Determinism (AD-3): given a deterministic (scripted) ``model`` AND an injected
``now`` clock this function is deterministic — no randomness, no logging. The
timeout deadline is derived from the INJECTED ``now`` (Story 5.6, D5), not
``time.monotonic`` inline, so tests pass a fake clock and the flow stays
reproducible; prod passes the real monotonic clock (allowed in the shell,
AD-2). The only prod nondeterminism is the live model, isolated behind the
injected ``model``. HTTP/JSONResponse concerns stay OUT of this module (Task 5
owns the route).
"""

import time
from collections.abc import Callable
from typing import Literal

from agno.models.base import Model
from pydantic import BaseModel, ValidationError

from copilot_agent import (
    DraftParseError,
    Transcript,
    build_interpretation_agent,
    build_recommendation_prompt,
    parse_recommendation_draft,
    run_interpretation,
)
from engine_service.interpretation_errors import (
    CostCeilingExceededError,
    InterpretationTimeoutError,
)
from engine_service.provenance_gate import GateRejected, run_provenance_gate
from reserving_engine import (
    DiagnosticsBundle,
    MethodRecommendation,
    RecommendationReason,
    Recommendations,
    ResultSet,
    validate_recommendations,
)
from reserving_engine.resultset import _MODEL_CONFIG

# The bounded redraft ceiling — the config default for the "calls" bound
# (INTERPRETATION_MAX_ATTEMPTS, Story 5.6, AD-9). The route threads the config
# value explicitly (app.py); this default keeps back-compat for direct callers /
# tests. Keep it small — each attempt is a full model turn.
MAX_ATTEMPTS = 3

# The default interpretation wall-clock timeout (seconds), mirroring
# Settings.interpretation_timeout_seconds (NFR-7 ≤ 10 min). The route threads the
# config value; this default keeps direct callers / tests unbounded in practice.
DEFAULT_TIMEOUT_SECONDS = 600.0


def enforce_interpretation_budget(
    now: Callable[[], float],
    deadline: float,
    cumulative_tokens: int,
    token_ceiling: int | None,
) -> None:
    """Fail-closed per-Run budget guard shared by both interpretation flows
    (Story 5.6, AD-9, D5). Raises the timeout signal when the injected clock has
    reached the deadline, or the cost-ceiling signal once cumulative token usage
    has crossed the configured ceiling. Neither message echoes prompt content or
    the api key (AD-12). A no-op when within budget (``token_ceiling`` None =
    unbounded)."""
    if now() >= deadline:
        raise InterpretationTimeoutError(
            "interpretation exceeded its per-Run time budget"
        )
    if token_ceiling is not None and cumulative_tokens >= token_ceiling:
        raise CostCeilingExceededError(
            "interpretation exceeded its per-Run token budget"
        )

# The user-turn trigger. The contract itself is taught in the agent's
# instructions (``build_recommendation_prompt``); this just asks for output.
_USER_PROMPT = (
    "Produce the recommendations now as the JSON object described, one entry "
    "per Origin Period."
)


class AttemptRejection(BaseModel):
    """One normalized rejection from any of the three checks in an attempt —
    the parser, the Provenance Gate, or the structural validator.

    A superset carrying everything the redraft prompt and the audit entry
    need. ``source`` records which check produced it; ``code`` is the check's
    own typed code (``draft_unparseable`` / a ``GateRejection.code`` / a
    ``RecommendationRejection.code``)."""

    model_config = _MODEL_CONFIG

    source: Literal["parse", "gate", "structural"]
    code: str
    message: str
    origin: str | None = None
    token: str | None = None
    details: dict | None = None


class AttemptRecord(BaseModel):
    """What one attempt produced (its transcript, for audit — FR-15) and why
    it was rejected. Empty ``rejections`` marks the accepted attempt."""

    model_config = _MODEL_CONFIG

    transcript: Transcript
    rejections: tuple[AttemptRejection, ...]


class RecommendationsAccepted(BaseModel):
    """A clean attempt: the gated + structurally-valid ``Recommendations``
    plus every attempt's transcript (for audit)."""

    model_config = _MODEL_CONFIG

    status: Literal["accepted"] = "accepted"
    recommendations: Recommendations
    attempts: tuple[AttemptRecord, ...]


class RecommendationsFailed(BaseModel):
    """Exhaustion (AC-2): ``max_attempts`` with no clean attempt. Carries every
    attempt's transcript + rejections but — by construction — NO
    ``recommendations`` attribute (the never-persist guarantee, mirroring
    ``GateRejected``)."""

    model_config = _MODEL_CONFIG

    status: Literal["failed"] = "failed"
    reason_summary: str
    attempts: tuple[AttemptRecord, ...]


RecommendationsOutcome = RecommendationsAccepted | RecommendationsFailed


def _redraft_feedback(rejections: tuple[AttemptRejection, ...]) -> str:
    """Turn the prior attempt's rejections into re-prompt text — the model is
    told exactly what failed so it can fix it (missing origin, unresolvable
    citation, unsourced number, …)."""
    lines = ["Your previous attempt was REJECTED for these reasons. Fix ALL of them:"]
    for rej in rejections:
        where = f" (origin {rej.origin})" if rej.origin else ""
        lines.append(f"- [{rej.code}]{where} {rej.message}")
    return "\n".join(lines)


def _gate_reasons(
    reason_texts: tuple[str, ...],
    result_set: ResultSet,
    diagnostics_bundle: DiagnosticsBundle,
) -> tuple[tuple[RecommendationReason, ...], list[AttemptRejection]]:
    """Gate every raw reason text (AC-4). Returns the accepted, rendered reasons
    plus any gate rejections. A reason that fails the gate is dropped from the
    accepted set (so a fully-rejected origin later fails structural coverage)."""
    accepted: list[RecommendationReason] = []
    rejections: list[AttemptRejection] = []
    for text in reason_texts:
        result = run_provenance_gate(text, result_set, diagnostics_bundle)
        if isinstance(result, GateRejected):
            rejections.extend(
                AttemptRejection(
                    source="gate",
                    code=r.code,
                    message=r.message,
                    token=r.token,
                    details=r.details,
                )
                for r in result.reasons
            )
            continue
        accepted.append(
            RecommendationReason(
                text=result.rendered_content,
                citations=tuple(c.diagnostic_id for c in result.citations),
            )
        )
    return tuple(accepted), rejections


def _evaluate_attempt(
    output_text: str,
    result_set: ResultSet,
    diagnostics_bundle: DiagnosticsBundle,
) -> tuple[Recommendations | None, tuple[AttemptRejection, ...]]:
    """Parse → gate each reason → assemble candidate → structural validate.

    Returns ``(candidate, rejections)``. ``candidate`` is the assembled
    ``Recommendations`` (present even when rejections are non-empty, so the
    caller need not rebuild it); ``rejections`` is the accumulated set from
    all three checks — empty iff the attempt is clean.
    """
    try:
        draft = parse_recommendation_draft(output_text)
    except DraftParseError as exc:
        return None, (
            AttemptRejection(source="parse", code="draft_unparseable", message=str(exc)),
        )

    rejections: list[AttemptRejection] = []
    gated_recs: list[MethodRecommendation] = []
    for mrec in draft.recommendations:
        gated_reasons, gate_rejections = _gate_reasons(
            mrec.reasons, result_set, diagnostics_bundle
        )
        rejections.extend(gate_rejections)
        try:
            gated_recs.append(
                MethodRecommendation(
                    origin=mrec.origin,
                    method=mrec.method,
                    reasons=gated_reasons,
                )
            )
        except ValidationError:
            # A method string that is not even one of the three Method literals
            # cannot form a MethodRecommendation. Surface it as a structural
            # rejection the loop re-prompts (its origin then also fails coverage).
            rejections.append(
                AttemptRejection(
                    source="structural",
                    code="unrun_method",
                    message=f"{mrec.method!r} is not a valid Method",
                    origin=mrec.origin,
                    details={"method": mrec.method},
                )
            )

    candidate = Recommendations(
        run_id=diagnostics_bundle.run_id,
        recommendations=tuple(gated_recs),
    )
    for structural in validate_recommendations(
        candidate, result_set, diagnostics_bundle
    ):
        rejections.append(
            AttemptRejection(
                source="structural",
                code=structural.code,
                message=structural.message,
                origin=structural.origin,
                details=structural.details,
            )
        )
    return candidate, tuple(rejections)


def generate_recommendations(
    model: Model,
    result_set: ResultSet,
    diagnostics_bundle: DiagnosticsBundle,
    *,
    max_attempts: int = MAX_ATTEMPTS,
    token_ceiling: int | None = None,
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
    now: Callable[[], float] = time.monotonic,
) -> RecommendationsOutcome:
    """Run the bounded generate-gate-validate loop (AC-1, AC-2, AC-4).

    ``model`` is INJECTED (the 5.1 test seam — tests pass a scripted ``Model``,
    prod passes ``build_gemini_model(...)``). Each iteration builds a fresh
    agent, runs it, parses the draft, gates every reason, assembles a
    candidate, and structurally validates it. A clean attempt returns
    ``RecommendationsAccepted`` immediately; exhaustion after ``max_attempts``
    returns ``RecommendationsFailed`` carrying every transcript — never partial
    output. ``ModelNotConfiguredError`` from ``build_gemini_model`` is raised at
    the route BEFORE this loop (Task 5) and is never a redraftable rejection.

    Story 5.6 (AD-9, D5) adds the fail-closed per-Run budget: ``token_ceiling``
    (cumulative model tokens; ``None`` = unbounded) and ``timeout_seconds``
    against a deadline derived from the INJECTED ``now`` clock. A breach raises
    ``CostCeilingExceededError`` / ``InterpretationTimeoutError`` (503 envelopes,
    NOT redraftable rejections, NOT bugs). The budget is checked before every
    model turn and once more at exhaustion (so the last attempt pushing
    cumulative over the ceiling still fails closed, not silently as an
    exhausted-gate rejection).
    """
    instructions = build_recommendation_prompt(result_set, diagnostics_bundle)
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
            prompt = f"{prompt}\n\n{_redraft_feedback(prior_rejections)}"

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
            # failure always yields ≥1 rejection).
            assert candidate is not None
            return RecommendationsAccepted(
                recommendations=candidate, attempts=tuple(attempts)
            )
        prior_rejections = rejections

    # Exhausted the attempt budget with no clean draft. Re-check the budget so a
    # timeout / over-ceiling condition fails closed (503) rather than surfacing as
    # a plain gate-exhaustion rejection.
    enforce_interpretation_budget(now, deadline, cumulative_tokens, token_ceiling)

    last = attempts[-1].rejections if attempts else ()
    codes = sorted({rej.code for rej in last})
    summary = (
        f"interpretation failed after {max_attempts} attempts; "
        f"last attempt had {len(last)} unresolved rejection(s)"
        + (f" ({', '.join(codes)})" if codes else "")
    )
    return RecommendationsFailed(reason_summary=summary, attempts=tuple(attempts))
