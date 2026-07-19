"""Bounded generate-gate-validate loop tests (Story 5.3, Task 4).

``generate_recommendations`` composes the agent + Provenance Gate (5.2) +
``validate_recommendations`` (Task 1) into one bounded redraft loop. Driven
by the 5.1 ``_ScriptedModel`` idiom (no network, no google-genai): each
attempt is a scripted final answer, so the loop is fully deterministic and
golden-testable.

Origins, a real ``dx:`` id, and the runId are read off the live engine
objects — no golden literals pinned.
"""

import json

import pytest
from agno.exceptions import ModelProviderError
from agno.models.base import Model
from agno.models.metrics import MessageMetrics
from agno.models.response import ModelResponse

from copilot_agent import build_gemini_model
from copilot_agent.agent import ModelNotConfiguredError
from engine_service.interpretation_errors import (
    CostCeilingExceededError,
    InterpretationTimeoutError,
    ModelUnavailableError,
)
from engine_service.recommendations_flow import (
    RecommendationsAccepted,
    RecommendationsFailed,
    generate_recommendations,
)
from reserving_engine import (
    AprioriLossRatio,
    RunParameters,
    compute_diagnostics,
    run_methods,
)
from tests.fixtures import TAYLOR_ASHE

RUN_ID = "run-5-3-test"
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


class _RaisingModel(_ScriptedModel):
    """A model that fails like a LIVE Gemini outage (review F16): Agno funnels
    every provider failure through ``ModelProviderError``. Returns the ``pre``
    scripted outputs first (attempts that COMPLETE before the outage, review F6),
    then raises on every subsequent call."""

    def __init__(self, pre: list[str] | None = None) -> None:
        super().__init__(pre or [])
        self._pre = list(pre or [])

    def invoke(self, *args, **kwargs) -> ModelResponse:
        if self._i < len(self._pre):
            return super().invoke(*args, **kwargs)
        raise ModelProviderError(
            message="gemini is down", model_name="scripted", model_id="x"
        )


def _origins(result_set):
    return [o.origin for o in result_set.method_results[0].origin_results]


def _real_dx(bundle):
    return bundle.ldf_stability[0].id


def _draft_json(
    origins,
    dx_id,
    *,
    method="chain_ladder",
    drop_first=False,
    rs_origin=None,
    literal_origin=None,
    bogus_dx=False,
):
    use = origins[1:] if drop_first else origins
    recs = []
    for origin in use:
        # The dx placeholder inner IS the full id (already starts with "dx:") —
        # no double-prefix (5.2 interpretation "B").
        cite = "dx:run-5-3-test:ave:9999" if bogus_dx else dx_id
        dx_ph = "{{" + cite + "}}"
        if literal_origin is not None and origin == literal_origin:
            reason = f"The ultimate is 999999999 {dx_ph}."
        elif rs_origin is not None and origin == rs_origin:
            rs_ph = "{{rs:" + RUN_ID + ":" + method + ":" + origin + ":ultimate}}"
            reason = f"Ultimate is {rs_ph} {dx_ph}."
        else:
            reason = f"Recommended for {origin} {dx_ph}."
        recs.append({"origin": origin, "method": method, "reasons": [reason]})
    return json.dumps({"recommendations": recs})


# --------------------------------------------------------------------------- #
# (a) clean first attempt → accepted, one AttemptRecord                        #
# --------------------------------------------------------------------------- #


def test_clean_first_attempt_is_accepted():
    result_set, bundle = _run()
    origins = _origins(result_set)
    dx_id = _real_dx(bundle)
    # One origin carries an {{rs:...}} figure so we can prove the gate rendered it.
    rs_origin = origins[0]
    output = _draft_json(origins, dx_id, rs_origin=rs_origin)
    outcome = generate_recommendations(_ScriptedModel([output]), result_set, bundle)

    assert isinstance(outcome, RecommendationsAccepted)
    assert outcome.status == "accepted"
    assert len(outcome.attempts) == 1
    assert outcome.attempts[0].rejections == ()
    # Exactly one recommendation per origin.
    got_origins = [r.origin for r in outcome.recommendations.recommendations]
    assert sorted(got_origins) == sorted(origins)
    assert outcome.recommendations.run_id == RUN_ID
    # The gate ran: the {{rs:...}} figure was rendered to digits in the accepted
    # reason text, and the citation was resolved to the real dx id.
    rs_rec = next(r for r in outcome.recommendations.recommendations if r.origin == rs_origin)
    assert any(ch.isdigit() for ch in rs_rec.reasons[0].text)
    assert dx_id in rs_rec.reasons[0].citations


# --------------------------------------------------------------------------- #
# (b) first attempt bad, second clean → accepted after 2 attempts              #
# --------------------------------------------------------------------------- #


def test_missing_origin_then_clean_is_accepted_after_two_attempts():
    result_set, bundle = _run()
    origins = _origins(result_set)
    dx_id = _real_dx(bundle)
    bad = _draft_json(origins, dx_id, drop_first=True)  # missing origins[0]
    good = _draft_json(origins, dx_id)
    outcome = generate_recommendations(_ScriptedModel([bad, good]), result_set, bundle)

    assert isinstance(outcome, RecommendationsAccepted)
    assert len(outcome.attempts) == 2
    # Both transcripts recorded (FR-15); the first attempt carries the rejection.
    assert outcome.attempts[0].rejections  # non-empty
    assert "missing_origin" in {r.code for r in outcome.attempts[0].rejections}
    assert outcome.attempts[1].rejections == ()


def test_bogus_citation_then_clean_is_accepted():
    result_set, bundle = _run()
    origins = _origins(result_set)
    dx_id = _real_dx(bundle)
    bad = _draft_json(origins, dx_id, bogus_dx=True)
    good = _draft_json(origins, dx_id)
    outcome = generate_recommendations(_ScriptedModel([bad, good]), result_set, bundle)

    assert isinstance(outcome, RecommendationsAccepted)
    assert len(outcome.attempts) == 2
    # The gate catches the unresolvable dx placeholder while rendering.
    codes = {r.code for r in outcome.attempts[0].rejections}
    assert "unresolvable_dx_citation" in codes


def test_literal_figure_is_rejected_unsourced_then_clean_accepted():
    result_set, bundle = _run()
    origins = _origins(result_set)
    dx_id = _real_dx(bundle)
    bad = _draft_json(origins, dx_id, literal_origin=origins[0])
    good = _draft_json(origins, dx_id)
    outcome = generate_recommendations(_ScriptedModel([bad, good]), result_set, bundle)

    assert isinstance(outcome, RecommendationsAccepted)
    codes = {r.code for r in outcome.attempts[0].rejections}
    assert "unsourced_number" in codes


# --------------------------------------------------------------------------- #
# (c) every attempt bad → failed after max_attempts, no partial output         #
# --------------------------------------------------------------------------- #


def test_persistent_failure_is_failed_never_partial():
    result_set, bundle = _run()
    origins = _origins(result_set)
    dx_id = _real_dx(bundle)
    bad = _draft_json(origins, dx_id, drop_first=True)  # always missing an origin
    outcome = generate_recommendations(
        _ScriptedModel([bad]), result_set, bundle, max_attempts=3
    )

    assert isinstance(outcome, RecommendationsFailed)
    assert outcome.status == "failed"
    assert len(outcome.attempts) == 3
    # NEVER partial output — a failed outcome has no recommendations attribute.
    assert not hasattr(outcome, "recommendations")
    assert "3 attempts" in outcome.reason_summary
    # Every attempt's transcript is present (for audit).
    assert all(a.transcript is not None for a in outcome.attempts)


def test_unparseable_draft_is_rejected_and_retried():
    result_set, bundle = _run()
    origins = _origins(result_set)
    dx_id = _real_dx(bundle)
    good = _draft_json(origins, dx_id)
    outcome = generate_recommendations(
        _ScriptedModel(["not json at all", good]), result_set, bundle
    )
    assert isinstance(outcome, RecommendationsAccepted)
    assert "draft_unparseable" in {r.code for r in outcome.attempts[0].rejections}


# --------------------------------------------------------------------------- #
# Model-not-configured is NOT swallowed by the loop (AD-9, Task 4.5)            #
# --------------------------------------------------------------------------- #


def test_model_not_configured_is_not_swallowed():
    # build_gemini_model raises BEFORE the loop is ever entered; the loop never
    # catches ModelNotConfiguredError as a redraftable rejection.
    with pytest.raises(ModelNotConfiguredError):
        build_gemini_model("", "")


# --------------------------------------------------------------------------- #
# Story 5.6 (AD-9, D5): fail-closed per-Run token ceiling + timeout + attempts #
# --------------------------------------------------------------------------- #


class _UsageModel(_ScriptedModel):
    """A scripted model that ALSO reports token usage per turn (agno 2.5.x:
    ModelResponse.response_usage → RunOutput.metrics.total_tokens). Lets the
    token-ceiling test drive cumulative usage deterministically."""

    def __init__(self, outputs: list[str], tokens_per_turn: int) -> None:
        super().__init__(outputs)
        self._tokens = tokens_per_turn

    def invoke(self, *args, **kwargs) -> ModelResponse:
        resp = super().invoke(*args, **kwargs)
        resp.response_usage = MessageMetrics(
            input_tokens=self._tokens // 2,
            output_tokens=self._tokens - self._tokens // 2,
            total_tokens=self._tokens,
        )
        return resp


def _clock(times: list[float]):
    """A deterministic injected clock returning successive values (D5)."""
    it = iter(times)
    return lambda: next(it)


def test_token_ceiling_breach_raises_cost_ceiling():
    result_set, bundle = _run()
    origins = _origins(result_set)
    dx_id = _real_dx(bundle)
    # A persistently-rejected draft (missing an origin) so the loop wants to
    # redraft; each turn reports 1000 tokens, well over the 100 ceiling.
    bad = _draft_json(origins, dx_id, drop_first=True)
    with pytest.raises(CostCeilingExceededError):
        generate_recommendations(
            _UsageModel([bad], tokens_per_turn=1000),
            result_set,
            bundle,
            max_attempts=3,
            token_ceiling=100,
        )


def test_within_token_ceiling_still_accepts():
    result_set, bundle = _run()
    origins = _origins(result_set)
    dx_id = _real_dx(bundle)
    good = _draft_json(origins, dx_id)
    # A clean first attempt within a generous ceiling → accepted (the ceiling
    # never trips on a successful bounded run).
    outcome = generate_recommendations(
        _UsageModel([good], tokens_per_turn=10),
        result_set,
        bundle,
        token_ceiling=1_000_000,
    )
    assert isinstance(outcome, RecommendationsAccepted)


def test_timeout_breach_raises_interpretation_timeout():
    result_set, bundle = _run()
    origins = _origins(result_set)
    dx_id = _real_dx(bundle)
    bad = _draft_json(origins, dx_id, drop_first=True)  # always rejected
    # deadline = 0 + 600 = 600. iter1 check at t=0 (ok), attempt runs, iter2
    # check at t=700 → past the deadline → fail closed.
    with pytest.raises(InterpretationTimeoutError):
        generate_recommendations(
            _ScriptedModel([bad]),
            result_set,
            bundle,
            max_attempts=3,
            timeout_seconds=600.0,
            now=_clock([0.0, 0.0, 700.0]),
        )


def test_max_attempts_from_config_is_honored():
    result_set, bundle = _run()
    origins = _origins(result_set)
    dx_id = _real_dx(bundle)
    bad = _draft_json(origins, dx_id, drop_first=True)  # always rejected
    outcome = generate_recommendations(
        _ScriptedModel([bad]), result_set, bundle, max_attempts=2
    )
    assert isinstance(outcome, RecommendationsFailed)
    assert len(outcome.attempts) == 2
    assert "2 attempts" in outcome.reason_summary


def test_deterministic_under_fake_clock_and_scripted_model():
    # Same scripted model + same fake clock → identical outcome (D5 determinism).
    result_set, bundle = _run()
    origins = _origins(result_set)
    dx_id = _real_dx(bundle)
    good = _draft_json(origins, dx_id)

    def _outcome():
        return generate_recommendations(
            _ScriptedModel([good]),
            result_set,
            bundle,
            timeout_seconds=600.0,
            now=_clock([0.0, 1.0, 2.0, 3.0]),
        )

    a, b = _outcome(), _outcome()
    assert isinstance(a, RecommendationsAccepted)
    assert isinstance(b, RecommendationsAccepted)
    assert a.recommendations.model_dump() == b.recommendations.model_dump()


# --------------------------------------------------------------------------- #
# Review F16 / F6: a live model outage fails closed into model_unavailable     #
# --------------------------------------------------------------------------- #


def test_live_model_outage_fails_closed_into_model_unavailable():
    # F16: a runtime provider failure on every attempt is NOT a redraftable
    # rejection — it raises ModelUnavailableError (→ 503 model_unavailable →
    # Engine-Only Mode), not RecommendationsFailed.
    result_set, bundle = _run()
    with pytest.raises(ModelUnavailableError) as excinfo:
        generate_recommendations(
            _RaisingModel(), result_set, bundle, max_attempts=2
        )
    # Down from the first call → no completed attempts to carry.
    assert excinfo.value.attempts == ()


def test_outage_after_completed_attempt_preserves_transcripts_for_audit():
    # F6: attempt 1 completes (gate-rejected, transcript captured); attempt 2 hits
    # the outage. The fail-closed ModelUnavailableError carries attempt 1's
    # transcript so that already-happened LLM interaction is still audit-logged.
    result_set, bundle = _run()
    origins = _origins(result_set)
    dx_id = _real_dx(bundle)
    bad = _draft_json(origins, dx_id, drop_first=True)  # missing coverage → rejected
    with pytest.raises(ModelUnavailableError) as excinfo:
        generate_recommendations(
            _RaisingModel(pre=[bad]), result_set, bundle, max_attempts=2
        )
    assert len(excinfo.value.attempts) == 1
    # The carried record is JSON-serializable (it rides in the 503 envelope).
    (record,) = excinfo.value.attempts
    assert "transcript" in record


def test_duplicate_dx_citations_are_deduplicated():
    # F8: a reason citing the same Diagnostic twice persists a single citation.
    result_set, bundle = _run()
    origins = _origins(result_set)
    dx_id = _real_dx(bundle)
    dx_ph = "{{" + dx_id + "}}"
    recs = [
        {
            "origin": origin,
            "method": "chain_ladder",
            "reasons": [f"Recommended {dx_ph} and again {dx_ph}."],
        }
        for origin in origins
    ]
    output = json.dumps({"recommendations": recs})
    outcome = generate_recommendations(_ScriptedModel([output]), result_set, bundle)
    assert isinstance(outcome, RecommendationsAccepted)
    for mrec in outcome.recommendations.recommendations:
        for reason in mrec.reasons:
            assert reason.citations == (dx_id,)
