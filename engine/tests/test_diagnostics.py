"""Behavioral tests for compute_diagnostics (Story 2.4, Task 4).

Golden-value assertions against Taylor-Ashe live in
test_golden_taylor_ashe.py; here we cover the ID scheme, the lookup
function, divergence presence/absence, A-vs-E shape, the guard checks,
determinism, and the wire shape — on small hand-checkable triangles.
"""

import json
import math

import pytest

from reserving_engine import (
    AprioriLossRatio,
    DiagnosticsBundle,
    RunParameters,
    Triangle,
    UnknownDiagnosticIdError,
    compute_diagnostics,
    diagnostic_id,
    resolve_diagnostic,
    run_methods,
)

SMALL_TRIANGLE = Triangle(
    kind="paid",
    origin_periods=("2021", "2022", "2023"),
    development_periods=("12", "24", "36"),
    cells=(
        (100.0, 150.0, 175.0),
        (110.0, 160.0, None),
        (120.0, None, None),
    ),
)

SMALL_APRIORIS = tuple(
    AprioriLossRatio(origin=origin, loss_ratio=0.9, exposure=200.0)
    for origin in SMALL_TRIANGLE.origin_periods
)

ALL_METHODS = RunParameters(
    methods=("chain_ladder", "bornhuetter_ferguson", "mack"),
    apriori_loss_ratios=SMALL_APRIORIS,
)

TWO_BY_TWO = Triangle(
    kind="paid",
    origin_periods=("2022", "2023"),
    development_periods=("12", "24"),
    cells=(
        (100.0, 180.0),
        (120.0, None),
    ),
)


def _cl_result(triangle=SMALL_TRIANGLE):
    return run_methods(triangle)


def _all_methods_result(triangle=SMALL_TRIANGLE, aprioris=SMALL_APRIORIS):
    params = RunParameters(
        methods=("chain_ladder", "bornhuetter_ferguson", "mack"),
        apriori_loss_ratios=aprioris,
    )
    return run_methods(triangle, params)


class TestBundleShape:
    def test_bundle_carries_run_id_and_triangle_hash(self):
        rs = _cl_result()
        bundle = compute_diagnostics(SMALL_TRIANGLE, rs, "run-1")
        assert bundle.run_id == "run-1"
        assert bundle.triangle_hash == rs.lineage.triangle_hash
        assert bundle.schema_version == "1.0.0"

    def test_ldf_stability_one_element_per_transition(self):
        bundle = compute_diagnostics(SMALL_TRIANGLE, _cl_result(), "run-1")
        assert len(bundle.ldf_stability) == 2
        assert (bundle.ldf_stability[0].from_dev, bundle.ldf_stability[0].to_dev) == ("12", "24")
        assert (bundle.ldf_stability[1].from_dev, bundle.ldf_stability[1].to_dev) == ("24", "36")

    def test_link_ratios_include_only_observed_cells(self):
        bundle = compute_diagnostics(SMALL_TRIANGLE, _cl_result(), "run-1")
        # 12->24 has two observed ratios (2021, 2022); 24->36 has one (2021).
        assert tuple(lr.origin for lr in bundle.ldf_stability[0].link_ratios) == ("2021", "2022")
        assert tuple(lr.origin for lr in bundle.ldf_stability[1].link_ratios) == ("2021",)

    def test_residuals_one_per_observed_ratio(self):
        bundle = compute_diagnostics(SMALL_TRIANGLE, _cl_result(), "run-1")
        # Observed ratios: 2021 (two), 2022 (one) => 3 residual cells.
        assert len(bundle.residuals) == 3


class TestDiagnosticIdScheme:
    def test_diagnostic_id_format(self):
        assert diagnostic_id("run-1", "ave", "2021") == "dx:run-1:ave:2021"

    def test_every_element_id_matches_documented_key(self):
        bundle = compute_diagnostics(SMALL_TRIANGLE, _all_methods_result(), "run-1")
        for e in bundle.ldf_stability:
            assert e.id == f"dx:run-1:ldf_stability:{e.from_dev}"
        for e in bundle.ave:
            assert e.id == f"dx:run-1:ave:{e.origin}"
        for e in bundle.cl_bf_divergence:
            assert e.id == f"dx:run-1:cl_bf_divergence:{e.origin}"
        for e in bundle.residuals:
            assert e.id == f"dx:run-1:residual:{e.origin}:{e.from_dev}"

    def test_ids_are_unique_within_a_bundle(self):
        bundle = compute_diagnostics(SMALL_TRIANGLE, _all_methods_result(), "run-1")
        ids = [e.id for e in _all_ids_source(bundle)]
        assert len(ids) == len(set(ids))

    def test_ids_are_stable_across_identical_runs(self):
        a = compute_diagnostics(SMALL_TRIANGLE, _all_methods_result(), "run-1")
        b = compute_diagnostics(SMALL_TRIANGLE, _all_methods_result(), "run-1")
        assert [e.id for e in _all_ids_source(a)] == [e.id for e in _all_ids_source(b)]

    def test_ids_embed_the_run_id(self):
        a = compute_diagnostics(SMALL_TRIANGLE, _cl_result(), "run-1")
        b = compute_diagnostics(SMALL_TRIANGLE, _cl_result(), "run-2")
        assert a.ldf_stability[0].id != b.ldf_stability[0].id
        assert a.ldf_stability[0].id.replace("run-1", "run-2") == b.ldf_stability[0].id


class TestResolveDiagnostic:
    def test_resolves_one_id_of_each_kind(self):
        bundle = compute_diagnostics(SMALL_TRIANGLE, _all_methods_result(), "run-1")
        assert resolve_diagnostic(bundle, bundle.ldf_stability[0].id) is bundle.ldf_stability[0]
        assert resolve_diagnostic(bundle, bundle.ave[0].id) is bundle.ave[0]
        assert (
            resolve_diagnostic(bundle, bundle.cl_bf_divergence[0].id)
            is bundle.cl_bf_divergence[0]
        )
        assert resolve_diagnostic(bundle, bundle.residuals[0].id) is bundle.residuals[0]

    def test_every_id_in_the_bundle_resolves(self):
        bundle = compute_diagnostics(SMALL_TRIANGLE, _all_methods_result(), "run-1")
        for element in _all_ids_source(bundle):
            assert resolve_diagnostic(bundle, element.id).id == element.id

    def test_unknown_id_raises_carrying_the_id(self):
        bundle = compute_diagnostics(SMALL_TRIANGLE, _cl_result(), "run-1")
        with pytest.raises(UnknownDiagnosticIdError) as exc_info:
            resolve_diagnostic(bundle, "dx:run-1:ave:9999")
        assert exc_info.value.diagnostic_id == "dx:run-1:ave:9999"
        assert "dx:run-1:ave:9999" in str(exc_info.value)

    def test_unknown_diagnostic_id_error_is_a_key_error(self):
        assert issubclass(UnknownDiagnosticIdError, KeyError)


class TestClBfDivergencePresence:
    def test_cl_only_run_has_no_divergence(self):
        bundle = compute_diagnostics(SMALL_TRIANGLE, _cl_result(), "run-1")
        assert bundle.cl_bf_divergence is None

    def test_cl_plus_bf_run_has_divergence_per_origin(self):
        rs = _all_methods_result()
        bundle = compute_diagnostics(SMALL_TRIANGLE, rs, "run-1")
        assert bundle.cl_bf_divergence is not None
        assert len(bundle.cl_bf_divergence) == len(SMALL_TRIANGLE.origin_periods)
        cl = {r.origin: r.ultimate for r in rs.method_results[0].origin_results}
        bf = {r.origin: r.ultimate for r in rs.method_results[1].origin_results}
        for element in bundle.cl_bf_divergence:
            assert element.divergence == cl[element.origin] - bf[element.origin]

    def test_bf_only_run_has_no_divergence(self):
        params = RunParameters(
            methods=("bornhuetter_ferguson",), apriori_loss_ratios=SMALL_APRIORIS
        )
        rs = run_methods(SMALL_TRIANGLE, params)
        bundle = compute_diagnostics(SMALL_TRIANGLE, rs, "run-1")
        assert bundle.cl_bf_divergence is None

    def test_mack_presence_does_not_create_divergence(self):
        rs = run_methods(SMALL_TRIANGLE, RunParameters(methods=("chain_ladder", "mack")))
        bundle = compute_diagnostics(SMALL_TRIANGLE, rs, "run-1")
        assert bundle.cl_bf_divergence is None


class TestActualVsExpected:
    def test_newest_origin_has_no_element(self):
        bundle = compute_diagnostics(SMALL_TRIANGLE, _cl_result(), "run-1")
        origins = tuple(e.origin for e in bundle.ave)
        assert "2023" not in origins  # newest, single cell

    def test_element_per_origin_with_prior_cell(self):
        bundle = compute_diagnostics(SMALL_TRIANGLE, _cl_result(), "run-1")
        assert tuple(e.origin for e in bundle.ave) == ("2021", "2022")

    def test_expected_equals_prior_cell_times_selected_factor(self):
        bundle = compute_diagnostics(SMALL_TRIANGLE, _cl_result(), "run-1")
        ldf = {e.from_dev: e.selected_factor for e in bundle.ldf_stability}
        # 2022's latest is dev 24; expected = prior(110 at dev 12) * ldf(12->24).
        element = next(e for e in bundle.ave if e.origin == "2022")
        assert element.actual == 160.0
        assert math.isclose(element.expected, 110.0 * ldf["12"], rel_tol=0, abs_tol=1e-9)
        assert math.isclose(
            element.actual_minus_expected, 160.0 - 110.0 * ldf["12"], rel_tol=0, abs_tol=1e-9
        )
        assert math.isclose(
            element.actual_to_expected_ratio, 160.0 / (110.0 * ldf["12"]), rel_tol=1e-12
        )


class TestNaNPolicy:
    def test_single_observation_column_yields_none_sigma(self):
        # A 2x2 triangle's one transition has a single observation:
        # chainladder cannot extrapolate sigma -> None, not a fake 0.0.
        bundle = compute_diagnostics(TWO_BY_TWO, _cl_result(TWO_BY_TWO), "run-1")
        (element,) = bundle.ldf_stability
        assert element.sigma is None
        assert element.std_err is None
        assert element.cv is None
        assert element.selected_factor == 1.8  # 180/100

    def test_two_by_two_has_one_residual(self):
        bundle = compute_diagnostics(TWO_BY_TWO, _cl_result(TWO_BY_TWO), "run-1")
        # The single observed ratio yields one (near-zero) residual.
        assert len(bundle.residuals) == 1


class TestGuards:
    def test_empty_run_id_raises(self):
        with pytest.raises(ValueError, match="run_id"):
            compute_diagnostics(SMALL_TRIANGLE, _cl_result(), "")

    def test_mismatched_triangle_hash_raises(self):
        # A ResultSet computed for a DIFFERENT triangle must be rejected.
        other = Triangle(
            kind="paid",
            origin_periods=("2021", "2022", "2023"),
            development_periods=("12", "24", "36"),
            cells=(
                (200.0, 300.0, 350.0),
                (210.0, 320.0, None),
                (220.0, None, None),
            ),
        )
        rs_other = run_methods(other)
        with pytest.raises(ValueError, match="do not belong"):
            compute_diagnostics(SMALL_TRIANGLE, rs_other, "run-1")


class TestDeterminism:
    def test_repeated_calls_are_bit_identical(self):
        rs = _all_methods_result()
        a = compute_diagnostics(SMALL_TRIANGLE, rs, "run-1").model_dump_json(by_alias=True)
        b = compute_diagnostics(SMALL_TRIANGLE, rs, "run-1").model_dump_json(by_alias=True)
        assert a == b


class TestDegenerate:
    def test_single_development_period(self):
        one_dev = Triangle(
            kind="paid",
            origin_periods=("2023",),
            development_periods=("12",),
            cells=((100.0,),),
        )
        rs = run_methods(one_dev)
        bundle = compute_diagnostics(one_dev, rs, "run-1")
        assert bundle.ldf_stability == ()
        assert bundle.ave == ()
        assert bundle.residuals == ()
        assert bundle.cl_bf_divergence is None

    def test_single_development_period_keeps_divergence_when_both_methods_ran(self):
        one_dev = Triangle(
            kind="paid",
            origin_periods=("2023",),
            development_periods=("12",),
            cells=((100.0,),),
        )
        params = RunParameters(
            methods=("chain_ladder", "bornhuetter_ferguson"),
            apriori_loss_ratios=(
                AprioriLossRatio(origin="2023", loss_ratio=0.9, exposure=200.0),
            ),
        )
        rs = run_methods(one_dev, params)
        bundle = compute_diagnostics(one_dev, rs, "run-1")
        assert bundle.cl_bf_divergence is not None
        assert len(bundle.cl_bf_divergence) == 1


class TestWireShape:
    def test_json_keys_are_camel_case(self):
        rs = _all_methods_result()
        payload = json.loads(compute_diagnostics(SMALL_TRIANGLE, rs, "run-1").model_dump_json(by_alias=True))
        assert set(payload) == {
            "schemaVersion",
            "runId",
            "triangleHash",
            "ldfStability",
            "ave",
            "clBfDivergence",
            "residuals",
        }
        stability = payload["ldfStability"][0]
        assert set(stability) == {
            "id",
            "fromDev",
            "toDev",
            "selectedFactor",
            "linkRatios",
            "sigma",
            "stdErr",
            "cv",
        }
        assert set(stability["linkRatios"][0]) == {"origin", "factor"}
        ave = payload["ave"][0]
        assert set(ave) == {
            "id",
            "origin",
            "fromDev",
            "toDev",
            "actual",
            "expected",
            "actualMinusExpected",
            "actualToExpectedRatio",
        }
        divergence = payload["clBfDivergence"][0]
        assert set(divergence) == {
            "id",
            "origin",
            "clUltimate",
            "bfUltimate",
            "divergence",
            "relativeDivergence",
        }
        residual = payload["residuals"][0]
        assert set(residual) == {"id", "origin", "fromDev", "toDev", "residual"}

    def test_cl_bf_divergence_serializes_null_when_absent(self):
        payload = json.loads(
            compute_diagnostics(SMALL_TRIANGLE, _cl_result(), "run-1").model_dump_json(by_alias=True)
        )
        assert payload["clBfDivergence"] is None

    def test_bundle_round_trips_through_json(self):
        rs = _all_methods_result()
        bundle = compute_diagnostics(SMALL_TRIANGLE, rs, "run-1")
        assert (
            DiagnosticsBundle.model_validate_json(bundle.model_dump_json(by_alias=True)) == bundle
        )


def _all_ids_source(bundle):
    """Every ID-carrying element in a bundle (all four kinds)."""
    yield from bundle.ldf_stability
    yield from bundle.ave
    yield from bundle.cl_bf_divergence or ()
    yield from bundle.residuals
