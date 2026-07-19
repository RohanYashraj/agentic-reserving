"""Agent draft model + prompt builder + parser tests (Story 5.4, Task 3).

The agent emits a raw, placeholder-bearing report draft that engine_service
then gates + structurally validates. These test the PURE pieces (no model, no
network): the prompt teaches the contract provider-neutrally and feeds the
accepted method choices WITHOUT the rendered reason literals (AD-1), and the
parser robustly extracts the draft JSON (fenced / prose-wrapped / missing
section → a typed, re-promptable ``DraftParseError``).
"""

import pytest

from copilot_agent.reserve_report import (
    ReserveReportDraft,
    build_report_prompt,
    parse_report_draft,
)
from copilot_agent._draft_json import DraftParseError
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

# A distinctive literal figure planted in a rendered recommendation reason —
# the prompt must NOT echo it (AD-1, §Feeding recommendations without literals).
LITERAL_FIGURE = "123456789"


def _run(methods=("chain_ladder", "bornhuetter_ferguson", "mack")):
    params = RunParameters(methods=methods, apriori_loss_ratios=BF_APRIORIS)
    result_set = run_methods(TAYLOR_ASHE, params)
    bundle = compute_diagnostics(TAYLOR_ASHE, result_set, RUN_ID)
    return result_set, bundle


def _origins(result_set):
    return [o.origin for o in result_set.method_results[0].origin_results]


def _recommendations(result_set, bundle, *, method="bornhuetter_ferguson"):
    """A well-formed Recommendations whose rendered reason text carries a
    literal figure (the post-gate form) — so the prompt-scrubbing test bites."""
    citation = bundle.ave[0].id
    return Recommendations(
        run_id=RUN_ID,
        recommendations=tuple(
            MethodRecommendation(
                origin=origin,
                method=method,
                reasons=(
                    RecommendationReason(
                        text=f"The ultimate is {LITERAL_FIGURE} for {origin}.",
                        citations=(citation,),
                    ),
                ),
            )
            for origin in _origins(result_set)
        ),
    )


# --------------------------------------------------------------------------- #
# build_report_prompt — teaches the contract (AC-1)                            #
# --------------------------------------------------------------------------- #


def test_prompt_teaches_four_sections_and_grammar():
    result_set, bundle = _run()
    prompt = build_report_prompt(result_set, bundle, _recommendations(result_set, bundle))
    assert isinstance(prompt, str)
    # All four sections named.
    for section in (
        "executive_summary",
        "method_selection_rationale",
        "movement_commentary",
        "limitations",
    ):
        assert section in prompt
    # Placeholder grammar.
    assert "{{rs:" in prompt
    assert "{{dx:" in prompt
    for field in ("ultimate", "ibnr", "mackStdErr", "reserveLow", "reserveHigh"):
        assert field in prompt
    # Provider-neutral: names the read-only tools, not any provider tokens.
    for tool in ("list_diagnostics", "get_diagnostic", "get_result_fields", "get_run_metadata"):
        assert tool in prompt
    # Grounds the scope in this Run.
    assert RUN_ID in prompt


def test_prompt_includes_the_per_origin_method_mapping():
    result_set, bundle = _run()
    recs = _recommendations(result_set, bundle, method="bornhuetter_ferguson")
    prompt = build_report_prompt(result_set, bundle, recs)
    # The accepted method choice per origin appears (unambiguous method token —
    # "mack" is a substring of the always-present mackStdErr rs field, so we
    # assert on bornhuetter_ferguson instead; the 5.3 debug-log gotcha).
    assert "bornhuetter_ferguson" in prompt
    for origin in _origins(result_set):
        assert f"{origin} -> bornhuetter_ferguson" in prompt


def test_prompt_does_not_echo_recommendation_reason_literals():
    # AD-1 guard: the recommendations' rendered reason text carries a literal
    # figure; the report prompt MUST NOT feed it to the model (§Feeding
    # recommendations without literals).
    result_set, bundle = _run()
    recs = _recommendations(result_set, bundle)
    prompt = build_report_prompt(result_set, bundle, recs)
    assert LITERAL_FIGURE not in prompt


# --------------------------------------------------------------------------- #
# parse_report_draft — robust extraction (AC-1)                               #
# --------------------------------------------------------------------------- #

_GOOD_JSON = (
    '{"executiveSummary": "The position is stable {{dx:run-5-4-test:ave:2001}}.", '
    '"methodSelectionRationale": "Chain ladder was chosen.", '
    '"movementCommentary": "No notable movements.", '
    '"limitations": "Estimates carry uncertainty."}'
)


def test_parse_plain_json():
    draft = parse_report_draft(_GOOD_JSON)
    assert isinstance(draft, ReserveReportDraft)
    assert draft.executive_summary.startswith("The position is stable")
    assert draft.limitations == "Estimates carry uncertainty."


def test_parse_fenced_json():
    draft = parse_report_draft(f"```json\n{_GOOD_JSON}\n```")
    assert draft.method_selection_rationale == "Chain ladder was chosen."


def test_parse_prose_wrapped_json():
    text = f"Here is the report:\n\n{_GOOD_JSON}\n\nThat is my draft."
    draft = parse_report_draft(text)
    assert draft.movement_commentary == "No notable movements."


def test_parse_missing_section_raises_draft_parse_error():
    # Valid JSON, missing the limitations section → DraftParseError (re-promptable).
    text = (
        '{"executiveSummary": "x", "methodSelectionRationale": "y", '
        '"movementCommentary": "z"}'
    )
    with pytest.raises(DraftParseError):
        parse_report_draft(text)


def test_parse_malformed_raises_draft_parse_error():
    with pytest.raises(DraftParseError):
        parse_report_draft("this is not json at all, just prose")


def test_parse_empty_raises_draft_parse_error():
    with pytest.raises(DraftParseError):
        parse_report_draft("")


def test_draft_model_is_constructible_directly():
    draft = ReserveReportDraft(
        executive_summary="a {{dx:x}}",
        method_selection_rationale="b",
        movement_commentary="c",
        limitations="d",
    )
    assert draft.executive_summary == "a {{dx:x}}"
