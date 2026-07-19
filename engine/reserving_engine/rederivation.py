"""Re-derivation: replay a stored ResultSet's Lineage and compare (FR-6, NFR-6).

Story 4.7 productizes the reproducibility proof that ``tests/test_rederivation.py``
has asserted privately since Story 2.2. Given a stored ResultSet and the
Triangle its Lineage names, ``rederive``:

1. verifies the Triangle is the one Lineage recorded — ``triangle_hash(triangle)``
   must equal ``stored.lineage.triangle_hash`` (AD-11 chain of custody). A
   mismatch short-circuits to a chain-of-custody report (no re-run — comparing
   against a *different* Triangle is meaningless);
2. re-executes the engine *from Lineage* — ``run_methods(triangle,
   stored.lineage.parameters)`` — so the proof is that the **Lineage alone** is
   a sufficient recipe (the auditor's guarantee, UJ-3);
3. compares the freshly re-derived (authoritative) point estimates against the
   stored figures **field-wise**, emitting a fully-computed ``ReDerivationReport``.

Pure-core contract (AD-2): no file, network, environment, clock, or logging
side effects — plain data in, a typed JSON-serialisable report out.

AD-1 lives here on purpose: the discrepancy ``delta = stored − rederived`` is
arithmetic on reserve figures, which may happen **only** inside
``reserving_engine`` (never in Convex or React). The report carries every delta
pre-computed; downstream planes display it, they never subtract.

AD-11 tiers: on the pinned platform (``linux/x86_64``, the CI + Cloud Run image)
point estimates must reproduce **exactly** (``==``); elsewhere the documented
fallback is ``rel_tol=1e-8`` / ``abs_tol=1e-8``. The tolerance semantics are
single-sourced here — ``tests/test_rederivation.py`` imports ``ON_PINNED_PLATFORM``
and ``_isclose_optional`` back from this module.
"""

import math
import platform
import sys
from typing import Literal

from pydantic import BaseModel, field_validator

from reserving_engine.methods import run_methods
from reserving_engine.resultset import (
    MethodResult,
    ResultSet,
    _MODEL_CONFIG,
    _require_finite,
)
from reserving_engine.triangle import Triangle, triangle_hash

# The pinned reproducibility platform (AD-11). Exact equality is required here;
# every other platform falls back to the documented 1e-8 relative tolerance.
ON_PINNED_PLATFORM = sys.platform == "linux" and platform.machine() == "x86_64"

Tier = Literal["exact", "epsilon"]


def _isclose_optional(got: float | None, want: float | None) -> bool:
    """Cross-platform (epsilon) comparison of two optional floats.

    ``None`` matches only ``None`` (identity); two numbers match within the
    AD-11 1e-8 tolerance. Lifted verbatim from the re-derivation test so the
    tolerance is defined in exactly one place.
    """
    if got is None or want is None:
        return got is want
    return math.isclose(got, want, rel_tol=1e-8, abs_tol=1e-8)


def _fields_match(stored: float | None, rederived: float | None) -> bool:
    """True when a stored figure reproduces, per the active AD-11 tier.

    Pinned platform → exact equality (including ``None``-vs-``None``);
    elsewhere → 1e-8 relative/absolute. A present-vs-absent (``None``)
    mismatch is always a discrepancy.
    """
    if stored is None or rederived is None:
        return stored is rederived
    if ON_PINNED_PLATFORM:
        return stored == rederived
    return math.isclose(stored, rederived, rel_tol=1e-8, abs_tol=1e-8)


class Discrepancy(BaseModel):
    """One figure that did not reproduce: where it is, and by how much.

    ``key`` locates the figure within its Method — an Origin Period label for
    per-origin figures, a ``"{from_dev}→{to_dev}"`` transition for factors, or
    ``""`` for Method-level totals / structural counts. ``delta`` is the
    engine-computed ``stored − rederived`` (AD-1). A ``None`` figure (a Mack
    field on a tampered CL/BF result, or a missing structural element) is
    reported as ``0.0`` on that side so the report stays all-float and JSON-clean.
    """

    model_config = _MODEL_CONFIG

    method: str
    field: str
    key: str
    stored: float
    rederived: float
    delta: float

    _finite = field_validator("stored", "rederived", "delta")(_require_finite)


class ReDerivationReport(BaseModel):
    """The outcome of replaying a stored ResultSet from its Lineage.

    ``reproduced`` is the top-line verdict: the Triangle hash verified **and**
    no figure discrepancies. ``triangle_hash_verified`` distinguishes the two
    failure modes — a broken chain of custody (the stored Triangle no longer
    hashes to its Lineage) versus altered stored figures on an authentic
    Triangle. ``tier`` records which AD-11 comparison ran (``exact`` on the
    pinned platform, ``epsilon`` elsewhere) so the surface can be honest about
    the guarantee.
    """

    model_config = _MODEL_CONFIG

    schema_version: str = "1.0.0"
    run_id: str
    reproduced: bool
    triangle_hash_verified: bool
    tier: Tier
    discrepancies: tuple[Discrepancy, ...] = ()


def _num(value: float | None) -> float:
    """The float stand-in for a possibly-``None`` figure in a Discrepancy."""
    return value if value is not None else 0.0


def _disc(method: str, field: str, key: str, stored: float | None, rederived: float | None) -> Discrepancy:
    s, r = _num(stored), _num(rederived)
    return Discrepancy(method=method, field=field, key=key, stored=s, rederived=r, delta=s - r)


def _compare_method(stored: MethodResult, rederived: MethodResult) -> list[Discrepancy]:
    """Field-wise comparison of one Method's stored vs re-derived output.

    Development factors are keyed by ``(from_dev, to_dev)`` and origin results
    by Origin Period, so a reordering or a count change surfaces as its own
    structural discrepancy rather than a misaligned figure diff or a crash — a
    tampered Lineage must be *reported*, never throw.
    """
    discs: list[Discrepancy] = []

    # --- Development factors (keyed by transition) --------------------------
    r_factors = {(f.from_dev, f.to_dev): f.factor for f in rederived.development_factors}
    s_factors = {(f.from_dev, f.to_dev): f.factor for f in stored.development_factors}
    if len(s_factors) != len(r_factors):
        discs.append(
            _disc(
                stored.method,
                "developmentFactorCount",
                "",
                float(len(s_factors)),
                float(len(r_factors)),
            )
        )
    for transition, sv in s_factors.items():
        rv = r_factors.get(transition)
        key = f"{transition[0]}→{transition[1]}"
        if rv is None:
            discs.append(_disc(stored.method, "factor", key, sv, None))
        elif not _fields_match(sv, rv):
            discs.append(_disc(stored.method, "factor", key, sv, rv))

    # --- Origin results (keyed by Origin Period) ---------------------------
    r_origins = {o.origin: o for o in rederived.origin_results}
    s_origins = {o.origin: o for o in stored.origin_results}
    if len(s_origins) != len(r_origins):
        discs.append(
            _disc(stored.method, "originCount", "", float(len(s_origins)), float(len(r_origins)))
        )
    for origin, so in s_origins.items():
        ro = r_origins.get(origin)
        if ro is None:
            discs.append(_disc(stored.method, "originPresence", origin, 1.0, 0.0))
            continue
        for field_name, s_field, r_field in (
            ("ultimate", so.ultimate, ro.ultimate),
            ("ibnr", so.ibnr, ro.ibnr),
            ("mackStdErr", so.mack_std_err, ro.mack_std_err),
            ("reserveLow", so.reserve_low, ro.reserve_low),
            ("reserveHigh", so.reserve_high, ro.reserve_high),
        ):
            if not _fields_match(s_field, r_field):
                discs.append(_disc(stored.method, field_name, origin, s_field, r_field))

    # --- Method-level total (Mack only, else None-vs-None matches) ----------
    if not _fields_match(stored.total_mack_std_err, rederived.total_mack_std_err):
        discs.append(
            _disc(
                stored.method,
                "totalMackStdErr",
                "",
                stored.total_mack_std_err,
                rederived.total_mack_std_err,
            )
        )

    return discs


def rederive(
    triangle: Triangle,
    stored_result_set: ResultSet,
    *,
    run_id: str = "",
) -> ReDerivationReport:
    """Replay ``stored_result_set``'s Lineage and compare against it (FR-6).

    ``run_id`` is metadata echoed onto the report (the audit correlation key);
    the re-run parameters come from ``stored_result_set.lineage.parameters``,
    never from a separate argument — re-deriving *from Lineage* is the point.
    """
    tier: Tier = "exact" if ON_PINNED_PLATFORM else "epsilon"

    # (1) Chain of custody (AD-11): the Triangle must be the one Lineage named.
    # A mismatch is a distinct outcome — do NOT re-run against a foreign Triangle.
    if triangle_hash(triangle) != stored_result_set.lineage.triangle_hash:
        return ReDerivationReport(
            run_id=run_id,
            reproduced=False,
            triangle_hash_verified=False,
            tier=tier,
            discrepancies=(),
        )

    # (2) Re-execute the engine from the stored Lineage's parameters.
    rederived = run_methods(triangle, stored_result_set.lineage.parameters)

    # (3) Compare field-wise. Methods keyed by name so a tampered/reordered
    # method set surfaces structurally rather than misaligning the diff.
    discs: list[Discrepancy] = []
    r_methods = {m.method: m for m in rederived.method_results}
    s_methods = {m.method: m for m in stored_result_set.method_results}
    for method_name, stored_method in s_methods.items():
        rederived_method = r_methods.get(method_name)
        if rederived_method is None:
            discs.append(_disc(method_name, "methodPresence", "", 1.0, 0.0))
            continue
        discs.extend(_compare_method(stored_method, rederived_method))
    for method_name in r_methods.keys() - s_methods.keys():
        discs.append(_disc(method_name, "methodPresence", "", 0.0, 1.0))

    return ReDerivationReport(
        run_id=run_id,
        reproduced=not discs,
        triangle_hash_verified=True,
        tier=tier,
        discrepancies=tuple(discs),
    )
