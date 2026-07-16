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
    InvalidTriangleError,
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
