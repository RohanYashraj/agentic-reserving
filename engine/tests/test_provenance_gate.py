"""Provenance Gate tests (Story 5.2) — placeholder rendering + numeric checker.

The gate is the AD-5 guard over machine-drafted content: it renders
``{{rs:...}}`` figures and ``{{dx:...}}`` citations from the engine's
ResultSet / DiagnosticsBundle, then verifies every numeric token in the
rendered output matches a source value under the documented
canonicalization rule (whitelisting structural numerals), and that every
quantitative claim cites a resolvable Diagnostic ID. A failing draft is
never returned as accepted content — only a typed rejection the caller
audit-logs. These tests read figures/ids from live engine objects (no
hardcoded goldens, platform-agnostic) and use no model / network.
"""

import pytest

from engine_service.provenance_gate import (
    CitationRef,
    GateAccepted,
    GateRejected,
    canonicalize_number,
    engine_source_values,
    format_figure,
    run_provenance_gate,
)
from reserving_engine import (
    AprioriLossRatio,
    RunParameters,
    compute_diagnostics,
    run_methods,
)
from tests.fixtures import TAYLOR_ASHE

RUN_ID = "run-5-2-test"

BF_APRIORIS = tuple(
    AprioriLossRatio(origin=origin, loss_ratio=0.9, exposure=5_000_000.0)
    for origin in TAYLOR_ASHE.origin_periods
)


def _run(methods=("chain_ladder", "bornhuetter_ferguson", "mack")):
    params = RunParameters(methods=methods, apriori_loss_ratios=BF_APRIORIS)
    result_set = run_methods(TAYLOR_ASHE, params)
    bundle = compute_diagnostics(TAYLOR_ASHE, result_set, RUN_ID)
    return result_set, bundle


@pytest.fixture
def run():
    return _run()


def _origin_result(result_set, method, origin):
    mr = next(m for m in result_set.method_results if m.method == method)
    return next(o for o in mr.origin_results if o.origin == origin)


def _first_ave_id(bundle):
    return bundle.ave[0].id


def _codes(rejected: GateRejected) -> set[str]:
    return {r.code for r in rejected.reasons}


# --- Task 1.2/1.3: canonicalization + source-value set --------------------


def test_canonicalize_rule():
    assert canonicalize_number(18834.0) == "18834"
    assert canonicalize_number(1.0234) == "1.02"
    assert canonicalize_number(-0.0) == "0"
    assert canonicalize_number(-12.5) == "-12.5"
    # round half-to-even at the 2dp quantum
    assert canonicalize_number(0.125) == "0.12"
    assert canonicalize_number(0.135) == "0.14"


def test_source_values_contain_engine_leaves_not_fabrications(run):
    result_set, bundle = run
    source = engine_source_values(result_set, bundle)

    ult = _origin_result(result_set, "chain_ladder", "2002").ultimate
    assert canonicalize_number(ult) in source

    ave = bundle.ave[0]
    assert canonicalize_number(ave.actual_minus_expected) in source

    assert canonicalize_number(987654321.0) not in source


# --- Task 6.3: clean pass -------------------------------------------------


def test_clean_pass(run):
    result_set, bundle = run
    ibnr = _origin_result(result_set, "chain_ladder", "2002").ibnr
    dx = _first_ave_id(bundle)
    draft = (
        "## 1. Summary\n\n"
        f"The IBNR for origin 2002 is {{{{rs:{RUN_ID}:chain_ladder:2002:ibnr}}}}, "
        f"supported by the actual-versus-expected diagnostic {{{{{dx}}}}}."
    )
    result = run_provenance_gate(draft, result_set, bundle)

    assert isinstance(result, GateAccepted)
    assert format_figure(ibnr) in result.rendered_content
    # placeholder syntax is gone; citation is masked (its dx: id is not left raw as a claim)
    assert "{{" not in result.rendered_content
    assert result.citations == (CitationRef(diagnostic_id=dx),)


# --- Task 6.4: unresolvable placeholders ----------------------------------


def test_cross_run_placeholder_rejected(run):
    result_set, bundle = run
    draft = f"Value {{{{rs:WRONG-RUN:chain_ladder:2002:ibnr}}}} cited {{{{{_first_ave_id(bundle)}}}}}."
    result = run_provenance_gate(draft, result_set, bundle)
    assert isinstance(result, GateRejected)
    assert "cross_run_placeholder" in _codes(result)
    assert not hasattr(result, "rendered_content")


def test_none_field_placeholder_rejected(run):
    result_set, bundle = run
    # mackStdErr is None on a chain_ladder OriginResult
    draft = f"SE {{{{rs:{RUN_ID}:chain_ladder:2002:mackStdErr}}}}."
    result = run_provenance_gate(draft, result_set, bundle)
    assert isinstance(result, GateRejected)
    assert "unresolvable_rs_placeholder" in _codes(result)


def test_unknown_method_and_origin_and_field_rejected(run):
    result_set, bundle = run
    for tail in ("no_such_method:2002:ibnr", "chain_ladder:1900:ibnr", "chain_ladder:2002:bogus"):
        draft = f"X {{{{rs:{RUN_ID}:{tail}}}}}."
        result = run_provenance_gate(draft, result_set, bundle)
        assert isinstance(result, GateRejected), tail
        assert "unresolvable_rs_placeholder" in _codes(result), tail


def test_malformed_placeholder_rejected(run):
    result_set, bundle = run
    # only 3 tail parts (missing origin)
    draft = f"X {{{{rs:{RUN_ID}:chain_ladder:ibnr}}}}."
    result = run_provenance_gate(draft, result_set, bundle)
    assert isinstance(result, GateRejected)
    assert "malformed_placeholder" in _codes(result)


def test_unresolvable_dx_citation_rejected(run):
    result_set, bundle = run
    draft = "Claim {{dx:dx:bogus:ave:x}}."
    result = run_provenance_gate(draft, result_set, bundle)
    assert isinstance(result, GateRejected)
    assert "unresolvable_dx_citation" in _codes(result)


# --- Task 6.5: wrong-field placeholder ------------------------------------


def test_wrong_field_is_unresolvable_not_semantic(run):
    result_set, bundle = run
    # a field that is not on the model at all → unresolvable (the gate does not
    # judge author intent; "wrong field" == field-not-on-model / None-valued)
    draft = f"X {{{{rs:{RUN_ID}:chain_ladder:2002:premium}}}}."
    result = run_provenance_gate(draft, result_set, bundle)
    assert isinstance(result, GateRejected)
    assert "unresolvable_rs_placeholder" in _codes(result)


# --- Task 6.6: literal-number smuggling -----------------------------------


def test_literal_number_smuggling_rejected(run):
    result_set, bundle = run
    draft = "The reserve is 987654321 pounds."
    result = run_provenance_gate(draft, result_set, bundle)
    assert isinstance(result, GateRejected)
    assert "unsourced_number" in _codes(result)


def test_coincidental_source_literal_passes(run):
    result_set, bundle = run
    ibnr = _origin_result(result_set, "chain_ladder", "2002").ibnr
    dx = _first_ave_id(bundle)
    # a bare literal equal to a real engine value is sourced-equivalent (AD-5 residual)
    draft = f"The IBNR is {format_figure(ibnr)}, per {{{{{dx}}}}}."
    result = run_provenance_gate(draft, result_set, bundle)
    assert isinstance(result, GateAccepted)


# --- Task 6.7: mismatched rounding ----------------------------------------


def test_mismatched_rounding_rejected(run):
    result_set, bundle = run
    ibnr = _origin_result(result_set, "chain_ladder", "2002").ibnr
    dx = _first_ave_id(bundle)
    # perturb the exact figure by +1 → canonical no longer in the source set
    wrong = format_figure(ibnr + 1.0)
    draft = f"The IBNR is {wrong}, per {{{{{dx}}}}}."
    result = run_provenance_gate(draft, result_set, bundle)
    assert isinstance(result, GateRejected)
    assert "unsourced_number" in _codes(result)


# --- Task 6.8: uncited quantitative claim ---------------------------------


def test_uncited_quantitative_claim_rejected(run):
    result_set, bundle = run
    draft = f"The IBNR for 2002 is {{{{rs:{RUN_ID}:chain_ladder:2002:ibnr}}}}."
    result = run_provenance_gate(draft, result_set, bundle)
    assert isinstance(result, GateRejected)
    assert "uncited_claim" in _codes(result)


def test_cited_claim_passes(run):
    result_set, bundle = run
    dx = _first_ave_id(bundle)
    draft = (
        f"The IBNR for 2002 is {{{{rs:{RUN_ID}:chain_ladder:2002:ibnr}}}}, "
        f"per {{{{{dx}}}}}."
    )
    result = run_provenance_gate(draft, result_set, bundle)
    assert isinstance(result, GateAccepted)


# --- Task 6.9: whitelist correctness --------------------------------------


def test_structural_numerals_whitelisted(run):
    result_set, bundle = run
    draft = (
        "## 2. Method selection\n\n"
        "Reviewed on 2026-07-19 for origin 2001 and origin 2002.\n\n"
        "### 2.4 Detail"
    )
    result = run_provenance_gate(draft, result_set, bundle)
    assert isinstance(result, GateAccepted)
    # no non-whitelisted figure → not a quantitative claim → no uncited_claim
    assert result.citations == ()


def test_non_whitelisted_figure_still_fails_amid_structural(run):
    result_set, bundle = run
    draft = "## 2. Method selection\n\nThe fabricated total is 987654321 as of 2026-07-19."
    result = run_provenance_gate(draft, result_set, bundle)
    assert isinstance(result, GateRejected)
    assert "unsourced_number" in _codes(result)


def test_line_start_decimal_figure_is_not_whitelisted_as_ordinal(run):
    # Review F3 (gate bypass): a fabricated decimal figure at a line/paragraph
    # start (the first token of a bullet or sentence) must NOT be masked by the
    # heading-ordinal whitelist before the numeric scan. Pre-fix, "18834.50 …"
    # matched `\d+(?:\.\d+)+` and bypassed BOTH the source-value and uncited-claim
    # checks — a fabricated reserve slipped through as accepted.
    result_set, bundle = run
    draft = "18834.50 is our recommended reserve."
    result = run_provenance_gate(draft, result_set, bundle)
    assert isinstance(result, GateRejected)
    assert "unsourced_number" in _codes(result)


def test_line_start_integer_with_trailing_dot_is_not_whitelisted(run):
    # Review F3: "999999. The reserve…" matched `\d+[.)]` pre-fix and was exempted.
    result_set, bundle = run
    draft = "999999. The reserve is comfortable."
    result = run_provenance_gate(draft, result_set, bundle)
    assert isinstance(result, GateRejected)
    assert "unsourced_number" in _codes(result)


def test_genuine_small_ordinals_remain_whitelisted(run):
    # Review F3: small structural ordinals (1–2-digit segments) still pass, so the
    # tightened bound does not over-reject real headings / numbered lists.
    result_set, bundle = run
    draft = "## 10. Summary\n\n3.2.1 Sub-point\n\n42) A list item"
    result = run_provenance_gate(draft, result_set, bundle)
    assert isinstance(result, GateAccepted)
    assert result.citations == ()


# --- Task 6.10: accumulation + never-persist ------------------------------


def test_multiple_placeholder_rejections_accumulate(run):
    result_set, bundle = run
    draft = "A {{rs:WRONG-RUN:chain_ladder:2002:ibnr}} and B {{dx:dx:bogus:ave:x}}."
    result = run_provenance_gate(draft, result_set, bundle)
    assert isinstance(result, GateRejected)
    assert len(result.reasons) >= 2
    assert {"cross_run_placeholder", "unresolvable_dx_citation"} <= _codes(result)
    assert not hasattr(result, "rendered_content")
