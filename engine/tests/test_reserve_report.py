"""ReserveReport contract + structural validator tests (Story 5.4).

``reserving_engine.reserve_report`` is the AD-10 cross-runtime contract for
the drafted Reserve Report document plus one PURE structural check
(``validate_reserve_report``) — it computes NO figures (AD-1) and does NO
I/O (AD-2). It only defines the shape and checks well-formedness of a report
against a completed Run's ResultSet + DiagnosticsBundle.

The Run objects are built from the live engine (Taylor-Ashe + the canonical
BF prior) — no golden literals: a real ``dx:`` id is read off the live
objects, so the suite is platform-agnostic.
"""

import pytest
from pydantic import ValidationError

from reserving_engine import (
    AprioriLossRatio,
    RunParameters,
    compute_diagnostics,
    run_methods,
)
from reserving_engine.reserve_report import (
    ReserveReport,
    ReserveReportRejection,
    ReserveReportSection,
    validate_reserve_report,
)
from tests.fixtures import TAYLOR_ASHE

RUN_ID = "run-5-4-test"

BF_APRIORIS = tuple(
    AprioriLossRatio(origin=origin, loss_ratio=0.9, exposure=5_000_000.0)
    for origin in TAYLOR_ASHE.origin_periods
)

SECTION_FIELDS = (
    "executiveSummary",
    "methodSelectionRationale",
    "movementCommentary",
    "limitations",
)


def _run(methods=("chain_ladder", "bornhuetter_ferguson", "mack")):
    params = RunParameters(methods=methods, apriori_loss_ratios=BF_APRIORIS)
    result_set = run_methods(TAYLOR_ASHE, params)
    bundle = compute_diagnostics(TAYLOR_ASHE, result_set, RUN_ID)
    return result_set, bundle


def _real_dx(bundle):
    return bundle.ave[0].id


def _section(text="Some prose.", citations=()):
    return ReserveReportSection(text=text, citations=citations)


def _well_formed(bundle):
    """Four non-empty sections, each carrying a resolvable citation."""
    citation = _real_dx(bundle)
    return ReserveReport(
        run_id=RUN_ID,
        executive_summary=_section("The overall reserve position is stable.", (citation,)),
        method_selection_rationale=_section("Chain ladder was chosen throughout.", (citation,)),
        movement_commentary=_section("No notable movements this period.", (citation,)),
        # A purely-qualitative limitations caveat with NO citation — legitimate.
        limitations=_section("Estimates carry inherent uncertainty.", ()),
    )


def _codes(rejections):
    return [r.code for r in rejections]


# --------------------------------------------------------------------------- #
# Well-formed → empty tuple (AC-1)                                              #
# --------------------------------------------------------------------------- #


def test_well_formed_report_passes():
    result_set, bundle = _run()
    rejections = validate_reserve_report(_well_formed(bundle), result_set, bundle)
    assert rejections == ()


# --------------------------------------------------------------------------- #
# Non-empty sections (AC-1)                                                     #
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("blank", ["", "   ", "\n\t "])
def test_blank_section_is_rejected(blank):
    result_set, bundle = _run()
    doc = _well_formed(bundle)
    mutated = doc.model_copy(
        update={"movement_commentary": _section(blank, (_real_dx(bundle),))}
    )
    rejections = validate_reserve_report(mutated, result_set, bundle)
    assert "empty_section" in _codes(rejections)
    empty = next(r for r in rejections if r.code == "empty_section")
    assert empty.section == "movementCommentary"


# --------------------------------------------------------------------------- #
# Citation resolvability (AC-1, AD-10)                                          #
# --------------------------------------------------------------------------- #


def test_unresolvable_citation_is_rejected():
    result_set, bundle = _run()
    doc = _well_formed(bundle)
    bogus = "dx:run-5-4-test:ave:9999"
    mutated = doc.model_copy(
        update={"executive_summary": _section("A cited claim.", (bogus,))}
    )
    rejections = validate_reserve_report(mutated, result_set, bundle)
    assert "unresolvable_citation" in _codes(rejections)
    bad = next(r for r in rejections if r.code == "unresolvable_citation")
    assert bad.section == "executiveSummary"
    assert bad.details == {"diagnosticId": bogus}


# --------------------------------------------------------------------------- #
# Accumulation — the bounded loop wants the complete list (AC-2)                #
# --------------------------------------------------------------------------- #


def test_multiple_problems_accumulate():
    result_set, bundle = _run()
    doc = _well_formed(bundle)
    # A blank section AND a bogus citation in a different section → ≥2 problems.
    mutated = doc.model_copy(
        update={
            "movement_commentary": _section("  ", (_real_dx(bundle),)),
            "limitations": _section("A caveat.", ("dx:run-5-4-test:ave:9999",)),
        }
    )
    rejections = validate_reserve_report(mutated, result_set, bundle)
    codes = set(_codes(rejections))
    assert {"empty_section", "unresolvable_citation"} <= codes
    assert len(rejections) >= 2


# --------------------------------------------------------------------------- #
# Named-field coverage — a section cannot be missing (structural)              #
# --------------------------------------------------------------------------- #


def test_report_cannot_be_constructed_without_a_section():
    _, bundle = _run()
    citation = _real_dx(bundle)
    with pytest.raises(ValidationError):
        ReserveReport(
            run_id=RUN_ID,
            executive_summary=_section("x", (citation,)),
            method_selection_rationale=_section("x", (citation,)),
            movement_commentary=_section("x", (citation,)),
            # limitations omitted → cannot form a ReserveReport
        )


# --------------------------------------------------------------------------- #
# Wire shape — camelCase round-trip (AC-3, AD-10)                               #
# --------------------------------------------------------------------------- #


def test_model_round_trips_camelcase():
    _, bundle = _run()
    doc = _well_formed(bundle)
    wire = doc.model_dump(mode="json", by_alias=True)
    assert set(wire) == {
        "schemaVersion",
        "runId",
        "machineDrafted",
        "executiveSummary",
        "methodSelectionRationale",
        "movementCommentary",
        "limitations",
    }
    assert wire["runId"] == RUN_ID
    assert wire["schemaVersion"] == "1.0.0"
    assert wire["machineDrafted"] is True
    for field in SECTION_FIELDS:
        assert set(wire[field]) == {"text", "citations"}
    # Round-trips back through the model with the camelCase wire keys.
    assert ReserveReport.model_validate(wire) == doc


def test_rejection_is_typed_and_camelcase():
    rej = ReserveReportRejection(
        code="empty_section", message="m", section="executiveSummary", details={"k": "v"}
    )
    wire = rej.model_dump(mode="json", by_alias=True)
    assert wire["code"] == "empty_section"
    assert wire["section"] == "executiveSummary"
    assert wire["details"] == {"k": "v"}
