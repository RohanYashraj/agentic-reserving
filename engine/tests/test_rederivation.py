"""Re-derivation tests (Story 2.2 Task 4 + Story 4.7 — FR-6, NFR-6).

Replays a stored Lineage literally: load the committed golden ResultSet
fixture, prove its Lineage points at the Taylor-Ashe Triangle via the
canonical hash, re-run the engine with the stored parameters, and
compare — exact on the pinned platform (linux/x86_64), 1e-8 relative
field-wise elsewhere (AD-11). This fixture also becomes Story 2.6's
schema-drift artifact.

Story 4.7 lifted the tolerance semantics (``ON_PINNED_PLATFORM``,
``_isclose_optional``) and the compare-and-report logic into the product
module ``reserving_engine.rederivation``; this suite imports them back so the
AD-11 tolerance is defined in exactly one place, and adds coverage for the
``rederive`` product function (untouched → reproduced; tampered → discrepancy;
foreign Triangle → chain-of-custody failure).
"""

import math
from pathlib import Path

import pytest

from reserving_engine import ResultSet, rederive, run_methods, triangle_hash
from reserving_engine.rederivation import ON_PINNED_PLATFORM, _isclose_optional
from tests.fixtures import TAYLOR_ASHE

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "taylor_ashe_resultset.json"
ALL_METHODS_FIXTURE_PATH = (
    Path(__file__).parent / "fixtures" / "taylor_ashe_all_methods_resultset.json"
)


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


# --- Story 4.7: the rederive() product function ------------------------------


def _tamper_first_ultimate(result_set: ResultSet, delta: float) -> ResultSet:
    """Return a copy of ``result_set`` with method 0, origin 1's ultimate
    shifted by ``delta`` — the AC3 "altered stored figure" fixture. Models are
    frozen, so rebuild via ``model_copy``.
    """
    m0 = result_set.method_results[0]
    o1 = m0.origin_results[1]
    tampered_origin = o1.model_copy(update={"ultimate": o1.ultimate + delta})
    tampered_origins = (
        (m0.origin_results[0], tampered_origin) + m0.origin_results[2:]
    )
    tampered_method = m0.model_copy(update={"origin_results": tampered_origins})
    return result_set.model_copy(
        update={"method_results": (tampered_method,) + result_set.method_results[1:]}
    )


def test_rederive_reproduces_an_untouched_resultset():
    stored = run_methods(TAYLOR_ASHE)
    report = rederive(TAYLOR_ASHE, stored, run_id="run_1")
    assert report.reproduced is True
    assert report.triangle_hash_verified is True
    assert report.discrepancies == ()
    assert report.run_id == "run_1"
    assert report.tier == ("exact" if ON_PINNED_PLATFORM else "epsilon")


def test_rederive_reproduces_the_all_methods_fixture():
    stored = ResultSet.model_validate_json(ALL_METHODS_FIXTURE_PATH.read_text())
    report = rederive(TAYLOR_ASHE, stored)
    assert report.reproduced is True
    assert report.triangle_hash_verified is True
    assert report.discrepancies == ()


def test_rederive_detects_a_tampered_stored_figure():
    stored = run_methods(TAYLOR_ASHE)
    tampered = _tamper_first_ultimate(stored, delta=1000.0)
    report = rederive(TAYLOR_ASHE, tampered, run_id="run_1")

    assert report.reproduced is False
    assert report.triangle_hash_verified is True  # Triangle is intact
    assert len(report.discrepancies) == 1
    disc = report.discrepancies[0]
    assert disc.method == "chain_ladder"
    assert disc.field == "ultimate"
    assert disc.key == stored.method_results[0].origin_results[1].origin
    # stored (tampered) − rederived (authoritative) == +1000.
    assert math.isclose(disc.delta, 1000.0, rel_tol=1e-8, abs_tol=1e-6)
    assert disc.stored > disc.rederived


def test_rederive_flags_a_triangle_that_does_not_match_the_lineage_hash():
    stored = run_methods(TAYLOR_ASHE)
    # A different Triangle (same numbers, different kind → different canonical
    # hash) breaks the chain of custody; the engine must NOT re-run.
    foreign = TAYLOR_ASHE.model_copy(update={"kind": "incurred"})
    assert triangle_hash(foreign) != stored.lineage.triangle_hash

    report = rederive(foreign, stored, run_id="run_1")
    assert report.triangle_hash_verified is False
    assert report.reproduced is False
    assert report.discrepancies == ()  # no re-run against a foreign Triangle
