"""Behavioral tests for run_methods (Story 2.2, Tasks 2 and 4).

Golden-value assertions against Taylor-Ashe live in
test_golden_taylor_ashe.py; here we cover the engine boundary, the
shape of the ResultSet, Lineage contents, determinism, and edge
triangles.
"""

import chainladder
import pytest

from reserving_engine import (
    ENGINE_VERSION,
    AprioriLossRatio,
    InvalidAprioriError,
    InvalidTriangleError,
    MissingAprioriError,
    ResultSet,
    RunParameters,
    Triangle,
    run_methods,
    triangle_hash,
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


class TestResultShape:
    def test_returns_resultset(self):
        rs = run_methods(SMALL_TRIANGLE)
        assert isinstance(rs, ResultSet)
        assert rs.schema_version == "1.0.0"

    def test_one_method_result_per_requested_method(self):
        rs = run_methods(SMALL_TRIANGLE)
        assert len(rs.method_results) == 1
        assert rs.method_results[0].method == "chain_ladder"

    def test_one_origin_result_per_origin_in_row_order(self):
        rs = run_methods(SMALL_TRIANGLE)
        origins = tuple(r.origin for r in rs.method_results[0].origin_results)
        assert origins == ("2021", "2022", "2023")

    def test_development_factors_keyed_by_adjacent_labels(self):
        rs = run_methods(SMALL_TRIANGLE)
        factors = rs.method_results[0].development_factors
        assert len(factors) == 2
        assert (factors[0].from_dev, factors[0].to_dev) == ("12", "24")
        assert (factors[1].from_dev, factors[1].to_dev) == ("24", "36")

    def test_fully_developed_origin_has_zero_ibnr(self):
        rs = run_methods(SMALL_TRIANGLE)
        first = rs.method_results[0].origin_results[0]
        assert first.ultimate == 175.0
        assert first.ibnr == 0.0

    def test_values_are_plain_python_floats(self):
        rs = run_methods(SMALL_TRIANGLE)
        method = rs.method_results[0]
        for r in method.origin_results:
            assert type(r.ultimate) is float
            assert type(r.ibnr) is float
        for f in method.development_factors:
            assert type(f.factor) is float

    def test_single_development_period_yields_no_factors(self):
        one_dev = Triangle(
            kind="paid",
            origin_periods=("2023",),
            development_periods=("12",),
            cells=((100.0,),),
        )
        rs = run_methods(one_dev)
        assert rs.method_results[0].development_factors == ()
        assert rs.method_results[0].origin_results[0].ultimate == 100.0


class TestLineage:
    def test_lineage_records_all_reproduction_ingredients(self):
        rs = run_methods(SMALL_TRIANGLE)
        assert rs.lineage.engine_version == ENGINE_VERSION
        assert rs.lineage.chainladder_version == chainladder.__version__
        assert rs.lineage.triangle_hash == triangle_hash(SMALL_TRIANGLE)
        assert rs.lineage.parameters == RunParameters(methods=("chain_ladder",))

    def test_explicit_parameters_recorded_verbatim(self):
        params = RunParameters(methods=("chain_ladder",))
        rs = run_methods(SMALL_TRIANGLE, params)
        assert rs.lineage.parameters == params


class TestDeterminism:
    def test_repeated_runs_are_bit_identical(self):
        a = run_methods(SMALL_TRIANGLE).model_dump_json(by_alias=True)
        b = run_methods(SMALL_TRIANGLE).model_dump_json(by_alias=True)
        assert a == b

    def test_repeated_three_method_runs_are_bit_identical(self):
        a = run_methods(SMALL_TRIANGLE, ALL_METHODS).model_dump_json(by_alias=True)
        b = run_methods(SMALL_TRIANGLE, ALL_METHODS).model_dump_json(by_alias=True)
        assert a == b


class TestMethodCombinations:
    def test_all_three_methods_in_one_call_one_resultset(self):
        rs = run_methods(SMALL_TRIANGLE, ALL_METHODS)
        assert isinstance(rs, ResultSet)
        assert tuple(m.method for m in rs.method_results) == (
            "chain_ladder",
            "bornhuetter_ferguson",
            "mack",
        )

    def test_two_method_subset(self):
        params = RunParameters(
            methods=("bornhuetter_ferguson", "mack"),
            apriori_loss_ratios=SMALL_APRIORIS,
        )
        rs = run_methods(SMALL_TRIANGLE, params)
        assert tuple(m.method for m in rs.method_results) == ("bornhuetter_ferguson", "mack")

    def test_request_order_is_preserved(self):
        params = RunParameters(methods=("mack", "chain_ladder"))
        rs = run_methods(SMALL_TRIANGLE, params)
        assert tuple(m.method for m in rs.method_results) == ("mack", "chain_ladder")

    def test_cl_and_mack_need_no_aprioris(self):
        rs = run_methods(SMALL_TRIANGLE, RunParameters(methods=("chain_ladder", "mack")))
        assert len(rs.method_results) == 2

    def test_aprioris_recorded_in_lineage_verbatim(self):
        params = RunParameters(
            methods=("bornhuetter_ferguson",), apriori_loss_ratios=SMALL_APRIORIS
        )
        rs = run_methods(SMALL_TRIANGLE, params)
        assert rs.lineage.parameters.apriori_loss_ratios == SMALL_APRIORIS
        assert rs.lineage.parameters == params

    def test_unused_aprioris_without_bf_are_permitted_and_recorded(self):
        params = RunParameters(methods=("chain_ladder",), apriori_loss_ratios=SMALL_APRIORIS)
        rs = run_methods(SMALL_TRIANGLE, params)
        assert rs.lineage.parameters.apriori_loss_ratios == SMALL_APRIORIS


class TestMissingApriori:
    def test_bf_without_aprioris_raises_naming_all_origins(self):
        with pytest.raises(MissingAprioriError) as exc_info:
            run_methods(SMALL_TRIANGLE, RunParameters(methods=("bornhuetter_ferguson",)))
        assert exc_info.value.missing_origins == ("2021", "2022", "2023")
        for origin in ("2021", "2022", "2023"):
            assert origin in str(exc_info.value)

    def test_bf_with_partial_aprioris_names_exactly_the_missing(self):
        params = RunParameters(
            methods=("bornhuetter_ferguson",), apriori_loss_ratios=SMALL_APRIORIS[:1]
        )
        with pytest.raises(MissingAprioriError) as exc_info:
            run_methods(SMALL_TRIANGLE, params)
        assert exc_info.value.missing_origins == ("2022", "2023")
        assert "2021" not in str(exc_info.value)

    def test_missing_apriori_error_is_a_value_error(self):
        assert issubclass(MissingAprioriError, ValueError)

    def test_duplicate_apriori_origin_rejected(self):
        params = RunParameters(
            methods=("bornhuetter_ferguson",),
            apriori_loss_ratios=SMALL_APRIORIS + (SMALL_APRIORIS[0],),
        )
        with pytest.raises(InvalidAprioriError, match="2021") as exc_info:
            run_methods(SMALL_TRIANGLE, params)
        assert exc_info.value.origins == ("2021",)

    def test_unknown_apriori_origin_rejected(self):
        stranger = AprioriLossRatio(origin="1999", loss_ratio=0.9, exposure=200.0)
        params = RunParameters(
            methods=("bornhuetter_ferguson",),
            apriori_loss_ratios=SMALL_APRIORIS + (stranger,),
        )
        with pytest.raises(InvalidAprioriError, match="1999") as exc_info:
            run_methods(SMALL_TRIANGLE, params)
        assert exc_info.value.origins == ("1999",)

    def test_invalid_apriori_error_is_a_value_error(self):
        # Same envelope family as the other boundary a-priori error.
        assert issubclass(InvalidAprioriError, ValueError)


class TestBornhuetterFerguson:
    def test_bf_fully_developed_origin_has_zero_ibnr(self):
        rs = run_methods(SMALL_TRIANGLE, ALL_METHODS)
        bf = rs.method_results[1]
        assert bf.origin_results[0].ultimate == 175.0
        assert bf.origin_results[0].ibnr == 0.0

    def test_bf_values_are_plain_python_floats(self):
        rs = run_methods(SMALL_TRIANGLE, ALL_METHODS)
        bf = rs.method_results[1]
        for r in bf.origin_results:
            assert type(r.ultimate) is float
            assert type(r.ibnr) is float

    def test_bf_single_development_period_degenerates(self):
        one_dev = Triangle(
            kind="paid",
            origin_periods=("2023",),
            development_periods=("12",),
            cells=((100.0,),),
        )
        params = RunParameters(
            methods=("bornhuetter_ferguson",),
            apriori_loss_ratios=(
                AprioriLossRatio(origin="2023", loss_ratio=0.9, exposure=200.0),
            ),
        )
        rs = run_methods(one_dev, params)
        bf = rs.method_results[0]
        assert bf.development_factors == ()
        assert bf.origin_results[0].ultimate == 100.0
        assert bf.origin_results[0].ibnr == 0.0


class TestMackFieldsDiscipline:
    def test_mack_results_carry_std_err_and_range(self):
        rs = run_methods(SMALL_TRIANGLE, RunParameters(methods=("mack",)))
        mack = rs.method_results[0]
        assert mack.total_mack_std_err is not None
        for r in mack.origin_results:
            assert r.mack_std_err is not None
            assert r.reserve_low == r.ibnr - r.mack_std_err
            assert r.reserve_high == r.ibnr + r.mack_std_err

    def test_cl_and_bf_results_carry_no_mack_fields(self):
        rs = run_methods(SMALL_TRIANGLE, ALL_METHODS)
        for method in rs.method_results[:2]:  # chain_ladder, bornhuetter_ferguson
            assert method.total_mack_std_err is None
            for r in method.origin_results:
                assert r.mack_std_err is None
                assert r.reserve_low is None
                assert r.reserve_high is None

    def test_mack_single_development_period_degenerates(self):
        one_dev = Triangle(
            kind="paid",
            origin_periods=("2023",),
            development_periods=("12",),
            cells=((100.0,),),
        )
        rs = run_methods(one_dev, RunParameters(methods=("mack",)))
        mack = rs.method_results[0]
        assert mack.development_factors == ()
        assert mack.origin_results[0].ultimate == 100.0
        assert mack.origin_results[0].ibnr == 0.0
        assert mack.origin_results[0].mack_std_err == 0.0
        assert mack.origin_results[0].reserve_low == 0.0
        assert mack.origin_results[0].reserve_high == 0.0
        assert mack.total_mack_std_err == 0.0


class TestBoundaryValidation:
    def test_triangle_with_findings_raises_invalid_triangle_error(self):
        holed = Triangle(
            kind="paid",
            origin_periods=("2021", "2022"),
            development_periods=("12", "24", "36"),
            cells=(
                (100.0, None, 175.0),  # interior hole
                (110.0, 160.0, None),
            ),
        )
        with pytest.raises(InvalidTriangleError) as exc_info:
            run_methods(holed)
        report = exc_info.value.report
        assert report.valid is False
        assert any(f.origin == "2021" for f in report.findings)

    def test_invalid_triangle_error_is_a_value_error(self):
        assert issubclass(InvalidTriangleError, ValueError)

    def test_incurred_triangle_runs_fine(self):
        incurred = Triangle(
            kind="incurred",
            origin_periods=SMALL_TRIANGLE.origin_periods,
            development_periods=SMALL_TRIANGLE.development_periods,
            cells=SMALL_TRIANGLE.cells,
        )
        rs = run_methods(incurred)
        assert rs.method_results[0].origin_results[0].ultimate == 175.0
