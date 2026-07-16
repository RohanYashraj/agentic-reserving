"""Taylor-Ashe golden tests (Story 2.2, Task 3 — NFR-1 release gate).

Two assertion tiers per AD-11:

- Everywhere: 1e-8 relative tolerance against pinned full-precision
  literals, plus rounded equality against the independently published
  Mack (1993) values — the same contract-freezing discipline as the
  1.5/2.1 pinned vectors.
- Pinned platform (linux/x86_64, the CI platform): exact ``==`` on the
  full-precision literals. If CI's bits ever differ from these (pinned
  from a macOS arm64 run, verified matching in CI), re-pin from CI
  output and document — the pinned platform is the truth.

These tests carry no skip/xfail markers: a red golden test fails the
existing CI ``python`` job and blocks release.
"""

import math
import platform
import sys

import chainladder as cl
import pytest

from reserving_engine import run_methods
from tests.fixtures import TAYLOR_ASHE

ON_PINNED_PLATFORM = sys.platform == "linux" and platform.machine() == "x86_64"

# Full-precision literals pinned from a run of this engine (AD-11).
PINNED_ULTIMATES = (
    3901463.0,
    5433718.8145487895,
    5378826.290064239,
    5297905.820825462,
    4858199.639049739,
    5111171.457661663,
    5660770.620135548,
    6784799.0119525,
    5642266.263261643,
    4969824.694424728,
)
PINNED_IBNR = (
    0.0,  # fully-developed first origin: chainladder NaN mapped to 0.0
    94633.81454878952,
    469511.29006423894,
    709637.8208254622,
    984888.6390497386,
    1419459.4576616632,
    2177640.6201355476,
    3920301.0119525,
    4278972.263261643,
    4625810.694424728,
)
PINNED_LDFS = (
    3.4906065479322863,
    1.7473326421004893,
    1.4574128360182361,
    1.1738517093997867,
    1.103823532244344,
    1.0862693644363943,
    1.0538743555048127,
    1.0765551783529383,
    1.017724725219544,
)

# Independently published values, Mack (1993).
PUBLISHED_ULTIMATES = (
    3_901_463, 5_433_719, 5_378_826, 5_297_906, 4_858_200,
    5_111_171, 5_660_771, 6_784_799, 5_642_266, 4_969_825,
)
PUBLISHED_LDFS_6DP = (
    3.490607, 1.747333, 1.457413, 1.173852,
    1.103824, 1.086269, 1.053874, 1.076555, 1.017725,
)
PUBLISHED_TOTAL_IBNR = 18_680_856


@pytest.fixture(scope="module")
def taylor_ashe_result():
    return run_methods(TAYLOR_ASHE).method_results[0]


def test_fixture_matches_chainladder_genins_sample():
    # One-time cross-check: the checked-in constant equals the packaged
    # GenIns/Taylor-Ashe dataset (load_sample does I/O — tests only).
    sample = cl.load_sample("genins").to_frame(origin_as_datetime=False)
    for i, row in enumerate(TAYLOR_ASHE.cells):
        for j, cell in enumerate(row):
            sample_value = sample.iloc[i, j]
            if cell is None:
                assert math.isnan(sample_value)
            else:
                assert cell == sample_value


class TestEverywhere:
    """Cross-platform tier: 1e-8 relative + published rounded values."""

    def test_ultimates_close_to_pinned_literals(self, taylor_ashe_result):
        for result, pinned in zip(taylor_ashe_result.origin_results, PINNED_ULTIMATES):
            assert math.isclose(result.ultimate, pinned, rel_tol=1e-8)

    def test_ultimates_round_to_published_mack_values(self, taylor_ashe_result):
        for result, published in zip(taylor_ashe_result.origin_results, PUBLISHED_ULTIMATES):
            assert round(result.ultimate) == published

    def test_ibnr_close_to_pinned_literals(self, taylor_ashe_result):
        for result, pinned in zip(taylor_ashe_result.origin_results, PINNED_IBNR):
            assert math.isclose(result.ibnr, pinned, rel_tol=1e-8, abs_tol=1e-8)

    def test_fully_developed_origin_ibnr_is_exactly_zero(self, taylor_ashe_result):
        # Locks the NaN -> 0.0 mapping for the at-ultimate first origin.
        assert taylor_ashe_result.origin_results[0].ibnr == 0.0

    def test_ldfs_close_to_pinned_literals(self, taylor_ashe_result):
        assert len(taylor_ashe_result.development_factors) == 9
        for factor, pinned in zip(taylor_ashe_result.development_factors, PINNED_LDFS):
            assert math.isclose(factor.factor, pinned, rel_tol=1e-8)

    def test_ldfs_round_to_published_mack_values(self, taylor_ashe_result):
        for factor, published in zip(taylor_ashe_result.development_factors, PUBLISHED_LDFS_6DP):
            assert round(factor.factor, 6) == published

    def test_total_ibnr_rounds_to_published_value(self, taylor_ashe_result):
        total = sum(r.ibnr for r in taylor_ashe_result.origin_results)
        assert round(total) == PUBLISHED_TOTAL_IBNR


@pytest.mark.skipif(not ON_PINNED_PLATFORM, reason="exact-equality tier runs on the pinned platform (linux/x86_64) only")
class TestPinnedPlatformExact:
    """AD-11 exact tier: bit-for-bit equality on the CI platform."""

    def test_ultimates_exact(self, taylor_ashe_result):
        assert tuple(r.ultimate for r in taylor_ashe_result.origin_results) == PINNED_ULTIMATES

    def test_ibnr_exact(self, taylor_ashe_result):
        assert tuple(r.ibnr for r in taylor_ashe_result.origin_results) == PINNED_IBNR

    def test_ldfs_exact(self, taylor_ashe_result):
        assert tuple(f.factor for f in taylor_ashe_result.development_factors) == PINNED_LDFS
