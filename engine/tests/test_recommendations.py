"""Recommendations contract + structural validator tests (Story 5.3).

``reserving_engine.recommendations`` is the AD-10 cross-runtime contract
for the recommendations document plus one PURE structural check
(``validate_recommendations``) — it computes NO figures (AD-1) and does
NO I/O (AD-2). It only defines the shape and checks well-formedness of a
recommendation set against a completed Run's ResultSet + DiagnosticsBundle.

The Run objects are built from the live engine (Taylor-Ashe + the canonical
BF prior) — no golden literals: origins and a real ``dx:`` id are read off
the live objects, so the suite is platform-agnostic.
"""

from reserving_engine import (
    AprioriLossRatio,
    RunParameters,
    compute_diagnostics,
    run_methods,
)
from reserving_engine.recommendations import (
    MethodRecommendation,
    RecommendationReason,
    Recommendations,
    RecommendationRejection,
    validate_recommendations,
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


def _origins(result_set):
    return [o.origin for o in result_set.method_results[0].origin_results]


def _real_dx(bundle):
    return bundle.ave[0].id


def _well_formed(result_set, bundle, *, method="chain_ladder"):
    """One MethodRecommendation per origin, each reason a resolvable citation."""
    citation = _real_dx(bundle)
    return Recommendations(
        run_id=RUN_ID,
        recommendations=tuple(
            MethodRecommendation(
                origin=origin,
                method=method,
                reasons=(
                    RecommendationReason(
                        text=f"Chosen for {origin}.", citations=(citation,)
                    ),
                ),
            )
            for origin in _origins(result_set)
        ),
    )


def _codes(rejections):
    return [r.code for r in rejections]


# --------------------------------------------------------------------------- #
# Well-formed → empty tuple (AC-1)                                              #
# --------------------------------------------------------------------------- #


def test_well_formed_recommendations_pass():
    result_set, bundle = _run()
    rejections = validate_recommendations(_well_formed(result_set, bundle), result_set, bundle)
    assert rejections == ()


# --------------------------------------------------------------------------- #
# Coverage — exactly one per Origin Period (AC-2)                               #
# --------------------------------------------------------------------------- #


def test_missing_origin_is_rejected():
    result_set, bundle = _run()
    doc = _well_formed(result_set, bundle)
    dropped = doc.recommendations[0]
    trimmed = doc.model_copy(update={"recommendations": doc.recommendations[1:]})
    rejections = validate_recommendations(trimmed, result_set, bundle)
    assert "missing_origin" in _codes(rejections)
    missing = next(r for r in rejections if r.code == "missing_origin")
    assert missing.origin == dropped.origin


def test_duplicated_origin_is_rejected():
    result_set, bundle = _run()
    doc = _well_formed(result_set, bundle)
    doubled = doc.model_copy(
        update={"recommendations": doc.recommendations + (doc.recommendations[0],)}
    )
    rejections = validate_recommendations(doubled, result_set, bundle)
    assert "duplicate_origin" in _codes(rejections)
    dup = next(r for r in rejections if r.code == "duplicate_origin")
    assert dup.origin == doc.recommendations[0].origin


def test_unknown_origin_is_rejected():
    result_set, bundle = _run()
    doc = _well_formed(result_set, bundle)
    bogus = MethodRecommendation(
        origin="1066",
        method="chain_ladder",
        reasons=(RecommendationReason(text="x", citations=(_real_dx(bundle),)),),
    )
    # Replace one real origin with a bogus one → both a missing and an unknown.
    replaced = doc.model_copy(
        update={"recommendations": doc.recommendations[1:] + (bogus,)}
    )
    rejections = validate_recommendations(replaced, result_set, bundle)
    codes = _codes(rejections)
    assert "unknown_origin" in codes
    unknown = next(r for r in rejections if r.code == "unknown_origin")
    assert unknown.origin == "1066"


# --------------------------------------------------------------------------- #
# Method validity (AC-1)                                                        #
# --------------------------------------------------------------------------- #


def test_method_not_run_is_rejected():
    # CL-only Run: recommending Mack is meaningless (its figures don't exist).
    result_set, bundle = _run(methods=("chain_ladder",))
    doc = _well_formed(result_set, bundle, method="mack")
    rejections = validate_recommendations(doc, result_set, bundle)
    assert "unrun_method" in _codes(rejections)
    unrun = next(r for r in rejections if r.code == "unrun_method")
    assert unrun.origin in _origins(result_set)


# --------------------------------------------------------------------------- #
# Reason + citation minima (AC-2, FR-10)                                        #
# --------------------------------------------------------------------------- #


def test_no_reason_is_rejected():
    result_set, bundle = _run()
    doc = _well_formed(result_set, bundle)
    stripped = doc.recommendations[0].model_copy(update={"reasons": ()})
    mutated = doc.model_copy(
        update={"recommendations": (stripped,) + doc.recommendations[1:]}
    )
    rejections = validate_recommendations(mutated, result_set, bundle)
    assert "no_reason" in _codes(rejections)


def test_uncited_reason_is_rejected():
    result_set, bundle = _run()
    doc = _well_formed(result_set, bundle)
    uncited = RecommendationReason(text="no citation here", citations=())
    rec = doc.recommendations[0].model_copy(update={"reasons": (uncited,)})
    mutated = doc.model_copy(update={"recommendations": (rec,) + doc.recommendations[1:]})
    rejections = validate_recommendations(mutated, result_set, bundle)
    assert "uncited_reason" in _codes(rejections)


def test_unresolvable_citation_is_rejected():
    result_set, bundle = _run()
    doc = _well_formed(result_set, bundle)
    bad_reason = RecommendationReason(
        text="cites a ghost", citations=("dx:run-5-3-test:ave:9999",)
    )
    rec = doc.recommendations[0].model_copy(update={"reasons": (bad_reason,)})
    mutated = doc.model_copy(update={"recommendations": (rec,) + doc.recommendations[1:]})
    rejections = validate_recommendations(mutated, result_set, bundle)
    assert "unresolvable_citation" in _codes(rejections)
    bad = next(r for r in rejections if r.code == "unresolvable_citation")
    assert bad.details == {"diagnosticId": "dx:run-5-3-test:ave:9999"}


# --------------------------------------------------------------------------- #
# Accumulation — the bounded loop wants the complete list (AC-2)                #
# --------------------------------------------------------------------------- #


def test_multiple_problems_accumulate():
    result_set, bundle = _run()
    doc = _well_formed(result_set, bundle)
    # Drop origin 0 (missing) AND make origin 1 uncited → ≥2 distinct problems.
    uncited = doc.recommendations[1].model_copy(
        update={"reasons": (RecommendationReason(text="x", citations=()),)}
    )
    mutated = doc.model_copy(
        update={"recommendations": (uncited,) + doc.recommendations[2:]}
    )
    rejections = validate_recommendations(mutated, result_set, bundle)
    codes = set(_codes(rejections))
    assert {"missing_origin", "uncited_reason"} <= codes
    assert len(rejections) >= 2


# --------------------------------------------------------------------------- #
# Wire shape — camelCase round-trip (AC-3, AD-10)                               #
# --------------------------------------------------------------------------- #


def test_models_round_trip_camelcase():
    result_set, bundle = _run()
    doc = _well_formed(result_set, bundle)
    wire = doc.model_dump(mode="json", by_alias=True)
    assert set(wire) == {"schemaVersion", "runId", "recommendations"}
    assert wire["runId"] == RUN_ID
    assert wire["schemaVersion"] == "1.0.0"
    rec = wire["recommendations"][0]
    assert set(rec) == {"origin", "method", "reasons"}
    assert set(rec["reasons"][0]) == {"text", "citations"}
    # Round-trips back through the model with the camelCase wire keys.
    assert Recommendations.model_validate(wire) == doc


def test_rejection_is_typed_and_camelcase():
    rej = RecommendationRejection(
        code="missing_origin", message="m", origin="2001", details={"k": "v"}
    )
    wire = rej.model_dump(mode="json", by_alias=True)
    assert wire["code"] == "missing_origin"
    assert wire["origin"] == "2001"
    assert wire["details"] == {"k": "v"}
