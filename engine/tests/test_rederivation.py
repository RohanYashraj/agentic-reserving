"""Re-derivation test (Story 2.2, Task 4 — FR-6, NFR-6).

Replays a stored Lineage literally: load the committed golden ResultSet
fixture, prove its Lineage points at the Taylor-Ashe Triangle via the
canonical hash, re-run the engine with the stored parameters, and
compare — exact on the pinned platform (linux/x86_64), 1e-8 relative
field-wise elsewhere (AD-11). This fixture also becomes Story 2.6's
schema-drift artifact.
"""

import math
import platform
import sys
from pathlib import Path

import pytest

from reserving_engine import ResultSet, run_methods, triangle_hash
from tests.fixtures import TAYLOR_ASHE

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "taylor_ashe_resultset.json"
ALL_METHODS_FIXTURE_PATH = (
    Path(__file__).parent / "fixtures" / "taylor_ashe_all_methods_resultset.json"
)

ON_PINNED_PLATFORM = sys.platform == "linux" and platform.machine() == "x86_64"


def _isclose_optional(got: float | None, want: float | None) -> bool:
    if got is None or want is None:
        return got is want
    return math.isclose(got, want, rel_tol=1e-8, abs_tol=1e-8)


def assert_rederivation_reproduces(fixture_path: Path) -> None:
    stored = ResultSet.model_validate_json(fixture_path.read_text())
    assert stored.lineage.triangle_hash == triangle_hash(TAYLOR_ASHE)
    rederived = run_methods(TAYLOR_ASHE, stored.lineage.parameters)

    # Lineage and structure must match exactly on every platform.
    assert rederived.schema_version == stored.schema_version
    assert rederived.lineage == stored.lineage
    assert len(rederived.method_results) == len(stored.method_results)

    if ON_PINNED_PLATFORM:
        assert rederived.model_dump() == stored.model_dump()
        return

    # Cross-platform tier: field-wise 1e-8 relative on the numbers.
    for got_method, want_method in zip(rederived.method_results, stored.method_results):
        assert got_method.method == want_method.method
        assert _isclose_optional(got_method.total_mack_std_err, want_method.total_mack_std_err)
        assert len(got_method.development_factors) == len(want_method.development_factors)
        for got, want in zip(got_method.development_factors, want_method.development_factors):
            assert (got.from_dev, got.to_dev) == (want.from_dev, want.to_dev)
            assert math.isclose(got.factor, want.factor, rel_tol=1e-8)
        assert len(got_method.origin_results) == len(want_method.origin_results)
        for got, want in zip(got_method.origin_results, want_method.origin_results):
            assert got.origin == want.origin
            assert math.isclose(got.ultimate, want.ultimate, rel_tol=1e-8)
            assert math.isclose(got.ibnr, want.ibnr, rel_tol=1e-8, abs_tol=1e-8)
            assert _isclose_optional(got.mack_std_err, want.mack_std_err)
            assert _isclose_optional(got.reserve_low, want.reserve_low)
            assert _isclose_optional(got.reserve_high, want.reserve_high)


def test_stored_lineage_points_at_the_taylor_ashe_triangle():
    stored = ResultSet.model_validate_json(FIXTURE_PATH.read_text())
    assert stored.lineage.triangle_hash == triangle_hash(TAYLOR_ASHE)


def test_rederivation_reproduces_stored_resultset():
    # Story 2.2's CL-only fixture: the widened RunParameters must still
    # parse this pre-2.3 Lineage (backward-compat is part of the contract).
    assert_rederivation_reproduces(FIXTURE_PATH)


def test_rederivation_reproduces_all_methods_resultset():
    # Story 2.3: full three-method run (CL + BF + Mack) with the
    # canonical test prior, replayed from its stored Lineage.
    assert_rederivation_reproduces(ALL_METHODS_FIXTURE_PATH)


def test_all_methods_fixture_contains_all_three_methods():
    stored = ResultSet.model_validate_json(ALL_METHODS_FIXTURE_PATH.read_text())
    assert tuple(m.method for m in stored.method_results) == (
        "chain_ladder",
        "bornhuetter_ferguson",
        "mack",
    )


@pytest.mark.parametrize("path", [FIXTURE_PATH, ALL_METHODS_FIXTURE_PATH])
def test_fixture_parses_as_valid_resultset(path):
    assert isinstance(ResultSet.model_validate_json(path.read_text()), ResultSet)
