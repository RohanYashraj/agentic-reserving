"""Bounded draft-gate-validate loop tests (Story 5.4, Task 4).

``generate_reserve_report`` composes the agent + Provenance Gate (5.2) +
``validate_reserve_report`` (Task 1) into one bounded redraft loop. Driven
by the 5.1/5.3 ``_ScriptedModel`` idiom (no network, no google-genai): each
attempt is a scripted final answer, so the loop is fully deterministic and
golden-testable.

Origins, a real ``dx:`` id, and the runId are read off the live engine
objects — no golden literals pinned. The accepted ``Recommendations`` input
is hand-built from those live objects.
"""

import json

import pytest
from agno.models.base import Model
from agno.models.response import ModelResponse

from copilot_agent import build_gemini_model
from copilot_agent.agent import ModelNotConfiguredError
from engine_service.report_flow import (
    ReserveReportAccepted,
    ReserveReportFailed,
    generate_reserve_report,
)
from reserving_engine import (
    AprioriLossRatio,
    MethodRecommendation,
    RecommendationReason,
    Recommendations,
    RunParameters,
    compute_diagnostics,
    run_methods,
)
from tests.fixtures import TAYLOR_ASHE

RUN_ID = "run-5-4-test"
BF_APRIORIS = tuple(
    AprioriLossRatio(origin=origin, loss_ratio=0.9, exposure=5_000_000.0)
    for origin in TAYLOR_ASHE.origin_periods
)


def _run(methods=("chain_ladder", "bornhuetter_ferguson", "mack")):
    params = RunParameters(methods=methods, apriori_loss_ratios=BF_APRIORIS)
    result_set = run_methods(TAYLOR_ASHE, params)
    bundle = compute_diagnostics(TAYLOR_ASHE, result_set, RUN_ID)
    return result_set, bundle


class _ScriptedModel(Model):
    """Returns a canned final answer per attempt (one invoke per attempt, no
    tool calls). The last output repeats if the loop runs more attempts."""

    def __init__(self, outputs: list[str]) -> None:
        super().__init__(id="scripted-flow-model")
        self.provider = "scripted"
        self._outputs = outputs
        self._i = 0

    def invoke(self, *args, **kwargs) -> ModelResponse:
        out = self._outputs[min(self._i, len(self._outputs) - 1)]
        self._i += 1
        return ModelResponse(role="assistant", content=out)

    async def ainvoke(self, *args, **kwargs) -> ModelResponse:
        return self.invoke(*args, **kwargs)

    def invoke_stream(self, *args, **kwargs):
        yield self.invoke(*args, **kwargs)

    async def ainvoke_stream(self, *args, **kwargs):
        yield self.invoke(*args, **kwargs)

    def _parse_provider_response(self, response, **kwargs) -> ModelResponse:
        return response

    def _parse_provider_response_delta(self, response) -> ModelResponse:
        return response


def _origins(result_set):
    return [o.origin for o in result_set.method_results[0].origin_results]


def _real_dx(bundle):
    return bundle.ldf_stability[0].id


def _recommendations(result_set, bundle, *, method="chain_ladder"):
    citation = bundle.ave[0].id
    return Recommendations(
        run_id=RUN_ID,
        recommendations=tuple(
            MethodRecommendation(
                origin=origin,
                method=method,
                reasons=(RecommendationReason(text=f"Chosen for {origin}.", citations=(citation,)),),
            )
            for origin in _origins(result_set)
        ),
    )


def _draft_json(
    result_set,
    dx_id,
    *,
    method="chain_ladder",
    blank_section=None,
    literal_section=None,
    bogus_dx=False,
    rs_section=None,
):
    """A four-section report draft. ``rs_section`` writes an {{rs:...}} figure in
    that section (to prove the gate rendered it); knobs inject faults."""
    origin = _origins(result_set)[0]
    cite = "dx:run-5-4-test:ave:9999" if bogus_dx else dx_id
    dx_ph = "{{" + cite + "}}"
    rs_ph = "{{rs:" + RUN_ID + ":" + method + ":" + origin + ":ultimate}}"

    def _section(name: str, default: str) -> str:
        if blank_section == name:
            return "   "
        if literal_section == name:
            return f"The ultimate is 987654321 {dx_ph}."
        if rs_section == name:
            return f"The ultimate is {rs_ph} {dx_ph}."
        return default

    return json.dumps(
        {
            "executiveSummary": _section(
                "executiveSummary", f"The overall position is stable {dx_ph}."
            ),
            "methodSelectionRationale": _section(
                "methodSelectionRationale", f"Chain ladder was chosen {dx_ph}."
            ),
            "movementCommentary": _section(
                "movementCommentary", f"No notable movements {dx_ph}."
            ),
            "limitations": _section(
                "limitations", "Estimates carry inherent uncertainty."
            ),
        }
    )


# --------------------------------------------------------------------------- #
# (a) clean first attempt → accepted, one AttemptRecord                        #
# --------------------------------------------------------------------------- #


def test_clean_first_attempt_is_accepted():
    result_set, bundle = _run()
    dx_id = _real_dx(bundle)
    recs = _recommendations(result_set, bundle)
    # executiveSummary carries an {{rs:...}} figure so we prove the gate rendered it.
    output = _draft_json(result_set, dx_id, rs_section="executiveSummary")
    outcome = generate_reserve_report(_ScriptedModel([output]), result_set, bundle, recs)

    assert isinstance(outcome, ReserveReportAccepted)
    assert outcome.status == "accepted"
    assert len(outcome.attempts) == 1
    assert outcome.attempts[0].rejections == ()
    assert outcome.report.run_id == RUN_ID
    assert outcome.report.machine_drafted is True
    # The gate ran: the {{rs:...}} figure rendered to digits in the accepted text,
    # and the citation resolved to the real dx id.
    exec_section = outcome.report.executive_summary
    assert any(ch.isdigit() for ch in exec_section.text)
    assert dx_id in exec_section.citations


# --------------------------------------------------------------------------- #
# (b) first attempt bad, second clean → accepted after 2 attempts              #
# --------------------------------------------------------------------------- #


def test_blank_section_then_clean_is_accepted_after_two_attempts():
    result_set, bundle = _run()
    dx_id = _real_dx(bundle)
    recs = _recommendations(result_set, bundle)
    bad = _draft_json(result_set, dx_id, blank_section="movementCommentary")
    good = _draft_json(result_set, dx_id)
    outcome = generate_reserve_report(_ScriptedModel([bad, good]), result_set, bundle, recs)

    assert isinstance(outcome, ReserveReportAccepted)
    assert len(outcome.attempts) == 2
    assert outcome.attempts[0].rejections  # non-empty
    # A blank section renders empty → the gate passes it, then the structural
    # validator flags empty_section; either way the section is flagged.
    codes = {r.code for r in outcome.attempts[0].rejections}
    assert "empty_section" in codes
    # The rejection carries the section name in details.
    empty = next(r for r in outcome.attempts[0].rejections if r.code == "empty_section")
    assert (empty.details or {}).get("section") == "movementCommentary"
    assert outcome.attempts[1].rejections == ()


def test_unsourced_literal_then_clean_is_accepted():
    result_set, bundle = _run()
    dx_id = _real_dx(bundle)
    recs = _recommendations(result_set, bundle)
    bad = _draft_json(result_set, dx_id, literal_section="executiveSummary")
    good = _draft_json(result_set, dx_id)
    outcome = generate_reserve_report(_ScriptedModel([bad, good]), result_set, bundle, recs)

    assert isinstance(outcome, ReserveReportAccepted)
    codes = {r.code for r in outcome.attempts[0].rejections}
    assert "unsourced_number" in codes
    # The gate rejection carries the section name in details.
    unsourced = next(r for r in outcome.attempts[0].rejections if r.code == "unsourced_number")
    assert (unsourced.details or {}).get("section") == "executiveSummary"


def test_bogus_citation_then_clean_is_accepted():
    result_set, bundle = _run()
    dx_id = _real_dx(bundle)
    recs = _recommendations(result_set, bundle)
    bad = _draft_json(result_set, dx_id, bogus_dx=True)
    good = _draft_json(result_set, dx_id)
    outcome = generate_reserve_report(_ScriptedModel([bad, good]), result_set, bundle, recs)

    assert isinstance(outcome, ReserveReportAccepted)
    assert len(outcome.attempts) == 2
    codes = {r.code for r in outcome.attempts[0].rejections}
    assert "unresolvable_dx_citation" in codes


# --------------------------------------------------------------------------- #
# (c) every attempt bad → failed after max_attempts, no partial output         #
# --------------------------------------------------------------------------- #


def test_persistent_failure_is_failed_never_partial():
    result_set, bundle = _run()
    dx_id = _real_dx(bundle)
    recs = _recommendations(result_set, bundle)
    bad = _draft_json(result_set, dx_id, blank_section="limitations")
    outcome = generate_reserve_report(
        _ScriptedModel([bad]), result_set, bundle, recs, max_attempts=3
    )

    assert isinstance(outcome, ReserveReportFailed)
    assert outcome.status == "failed"
    assert len(outcome.attempts) == 3
    # NEVER partial output — a failed outcome has no report attribute.
    assert not hasattr(outcome, "report")
    assert "3 attempts" in outcome.reason_summary
    assert all(a.transcript is not None for a in outcome.attempts)


def test_unparseable_draft_is_rejected_and_retried():
    result_set, bundle = _run()
    dx_id = _real_dx(bundle)
    recs = _recommendations(result_set, bundle)
    good = _draft_json(result_set, dx_id)
    outcome = generate_reserve_report(
        _ScriptedModel(["not json at all", good]), result_set, bundle, recs
    )
    assert isinstance(outcome, ReserveReportAccepted)
    assert "draft_unparseable" in {r.code for r in outcome.attempts[0].rejections}


# --------------------------------------------------------------------------- #
# Model-not-configured is NOT swallowed by the loop (AD-9, Task 4.5)            #
# --------------------------------------------------------------------------- #


def test_model_not_configured_is_not_swallowed():
    with pytest.raises(ModelNotConfiguredError):
        build_gemini_model("", "")
