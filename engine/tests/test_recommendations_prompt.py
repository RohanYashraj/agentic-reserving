"""Agent draft model + prompt builder + parser tests (Story 5.3, Task 3).

The agent emits a raw, placeholder-bearing draft that engine_service then
gates + structurally validates. These test the PURE pieces (no model, no
network): the prompt teaches the contract provider-neutrally, and the
parser robustly extracts the draft JSON (fenced / prose-wrapped / malformed
→ a typed, re-promptable ``DraftParseError``).
"""

import pytest

from copilot_agent.recommendations import (
    DraftParseError,
    MethodRecommendationDraft,
    RecommendationDraft,
    build_recommendation_prompt,
    parse_recommendation_draft,
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


# --------------------------------------------------------------------------- #
# build_recommendation_prompt — teaches the contract (AC-1, AC-4)              #
# --------------------------------------------------------------------------- #


def test_prompt_teaches_placeholder_grammar_and_contract():
    result_set, bundle = _run()
    prompt = build_recommendation_prompt(result_set, bundle)
    assert isinstance(prompt, str)
    # Placeholder grammar (5.2 interpretation "B").
    assert "{{rs:" in prompt
    assert "{{dx:" in prompt
    # The five rs fields the gate can render.
    for field in ("ultimate", "ibnr", "mackStdErr", "reserveLow", "reserveHigh"):
        assert field in prompt
    # The core rule: exactly one method per origin, ≥1 cited reason.
    lowered = prompt.lower()
    assert "exactly one" in lowered
    assert "reason" in lowered
    # Provider-neutral: it names the read-only tools, not any provider tokens.
    for tool in ("list_diagnostics", "get_diagnostic", "get_result_fields", "get_run_metadata"):
        assert tool in prompt
    # Grounds the scope in this Run: the runId and the executed methods appear.
    assert RUN_ID in prompt
    assert "bornhuetter_ferguson" in prompt


def test_prompt_only_lists_executed_methods():
    result_set, bundle = _run(methods=("chain_ladder",))
    prompt = build_recommendation_prompt(result_set, bundle)
    assert "chain_ladder" in prompt
    # A method that was NOT run must not be offered as a choice. (Only the
    # unambiguous method name is asserted — "mack" is a substring of the
    # always-present "mackStdErr" rs field, so it is not a clean signal.)
    assert "bornhuetter_ferguson" not in prompt


# --------------------------------------------------------------------------- #
# parse_recommendation_draft — robust extraction (AC-1)                        #
# --------------------------------------------------------------------------- #

_GOOD_JSON = (
    '{"recommendations": [{"origin": "2001", "method": "chain_ladder", '
    '"reasons": ["Stable LDFs {{dx:run-5-3-test:ldf_stability:12}}."]}]}'
)


def test_parse_plain_json():
    draft = parse_recommendation_draft(_GOOD_JSON)
    assert isinstance(draft, RecommendationDraft)
    assert draft.recommendations[0].origin == "2001"
    assert draft.recommendations[0].method == "chain_ladder"
    assert draft.recommendations[0].reasons[0].startswith("Stable LDFs")


def test_parse_fenced_json():
    draft = parse_recommendation_draft(f"```json\n{_GOOD_JSON}\n```")
    assert draft.recommendations[0].origin == "2001"


def test_parse_prose_wrapped_json():
    text = f"Here is my analysis of the run:\n\n{_GOOD_JSON}\n\nThat is my recommendation."
    draft = parse_recommendation_draft(text)
    assert draft.recommendations[0].method == "chain_ladder"


def test_parse_keeps_method_as_plain_string():
    # A method NOT in the Run must NOT be a hard parse error — it surfaces as a
    # typed unrun_method rejection later (Task 1.3), so the loop can re-prompt.
    text = '{"recommendations": [{"origin": "2001", "method": "not_a_method", "reasons": ["x {{dx:a}}"]}]}'
    draft = parse_recommendation_draft(text)
    assert draft.recommendations[0].method == "not_a_method"


def test_parse_malformed_raises_draft_parse_error():
    with pytest.raises(DraftParseError):
        parse_recommendation_draft("this is not json at all, just prose")


def test_parse_empty_raises_draft_parse_error():
    with pytest.raises(DraftParseError):
        parse_recommendation_draft("")


def test_parse_wrong_shape_raises_draft_parse_error():
    # Valid JSON, wrong shape (missing the recommendations key) → DraftParseError.
    with pytest.raises(DraftParseError):
        parse_recommendation_draft('{"foo": "bar"}')


def test_draft_model_is_constructible_directly():
    draft = RecommendationDraft(
        recommendations=(
            MethodRecommendationDraft(
                origin="2001", method="mack", reasons=("reason {{dx:x}}",)
            ),
        )
    )
    assert draft.recommendations[0].reasons == ("reason {{dx:x}}",)
