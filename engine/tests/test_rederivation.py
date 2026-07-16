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

from reserving_engine import ResultSet, run_methods, triangle_hash
from tests.fixtures import TAYLOR_ASHE

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "taylor_ashe_resultset.json"

ON_PINNED_PLATFORM = sys.platform == "linux" and platform.machine() == "x86_64"


def load_stored() -> ResultSet:
    return ResultSet.model_validate_json(FIXTURE_PATH.read_text())


def test_stored_lineage_points_at_the_taylor_ashe_triangle():
    stored = load_stored()
    assert stored.lineage.triangle_hash == triangle_hash(TAYLOR_ASHE)


def test_rederivation_reproduces_stored_resultset():
    stored = load_stored()
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
        assert len(got_method.development_factors) == len(want_method.development_factors)
        for got, want in zip(got_method.development_factors, want_method.development_factors):
            assert (got.from_dev, got.to_dev) == (want.from_dev, want.to_dev)
            assert math.isclose(got.factor, want.factor, rel_tol=1e-8)
        assert len(got_method.origin_results) == len(want_method.origin_results)
        for got, want in zip(got_method.origin_results, want_method.origin_results):
            assert got.origin == want.origin
            assert math.isclose(got.ultimate, want.ultimate, rel_tol=1e-8)
            assert math.isclose(got.ibnr, want.ibnr, rel_tol=1e-8, abs_tol=1e-8)
