"""run_methods: the engine's single computation entry point (FR-5).

Pure-core contract (AD-2): plain data in, a typed JSON-serialisable
ResultSet out. No file, network, environment, clock, or logging side
effects. chainladder is invoked strictly as an in-memory computation
library — never ``cl.load_sample`` here (it reads package CSV files;
tests only). ``cl.Triangle``'s valuation date is derived from the data,
not the clock, so identical inputs give identical outputs across days.

Label bridge: the engine treats period labels as opaque strings (they
are never parsed — period semantics belong to the upload flow, Epic 3).
chainladder requires date-typed axes, so we feed it synthetic positional
annual periods (``origin = 2000 + i``, ``development = 2000 + i + j``)
and map results back to our labels by index. Our Triangle's rows and
columns are the only label authority.
"""

import chainladder as cl
import pandas as pd

from reserving_engine.resultset import (
    DevelopmentFactor,
    Lineage,
    MethodResult,
    OriginResult,
    ResultSet,
    RunParameters,
)
from reserving_engine.triangle import Triangle, triangle_hash
from reserving_engine.validation import ValidationReport, validate_triangle
from reserving_engine.version import ENGINE_VERSION


class InvalidTriangleError(ValueError):
    """Raised when run_methods receives a Triangle with validation findings.

    The engine boundary re-validates every Triangle regardless of caller
    discipline — a Method must never see a malformed Triangle. The full
    cell-level report is on ``.report``.
    """

    def __init__(self, report: ValidationReport) -> None:
        self.report = report
        reasons = "; ".join(f.reason for f in report.findings)
        super().__init__(f"triangle failed validation with {len(report.findings)} finding(s): {reasons}")


class MissingAprioriError(ValueError):
    """Raised when BF is requested without a complete a-priori set.

    Every Origin Period needs an A Priori Loss Ratio before BF can run
    (FR-4, enforced at the engine boundary too). The uncovered Origin
    Period labels are on ``.missing_origins``.
    """

    def __init__(self, missing_origins: tuple[str, ...]) -> None:
        self.missing_origins = missing_origins
        super().__init__(
            "bornhuetter_ferguson requires an A Priori Loss Ratio for every "
            f"Origin Period; missing: {', '.join(missing_origins)}"
        )


class InvalidAprioriError(ValueError):
    """Raised when the a-priori set is itself malformed at the boundary.

    A duplicated Origin Period, or an A Priori Loss Ratio naming an Origin
    Period absent from the Triangle (FR-4). A caller-input defect — mapped
    to the same envelope as the missing-a-priori sibling, never a bare 500.
    The offending Origin Period labels are on ``.origins``.
    """

    def __init__(self, reason: str, origins: tuple[str, ...]) -> None:
        self.origins = origins
        super().__init__(reason)


def _to_long_dataframe(triangle: Triangle) -> pd.DataFrame:
    """Observed cells as a long frame with synthetic positional periods.

    Validation guarantees each row's observed region is its leading
    non-``None`` prefix with no interior holes, so taking cells until the
    first ``None`` is exact. ``cell is not None`` — a 0.0 cell is a value.
    """
    records = []
    for i, row in enumerate(triangle.cells):
        for j, cell in enumerate(row):
            if cell is None:
                break
            records.append({"origin": 2000 + i, "development": 2000 + i + j, "values": cell})
    return pd.DataFrame.from_records(records)


def _degenerate_method_result(triangle: Triangle, method: str, mack: bool) -> MethodResult:
    """The n_dev == 1 case chainladder cannot fit (IndexError in its
    development estimator). Every Method degenerates identically there:
    CDF = 1, so each origin is at ultimate with zero IBNR, no factors —
    and for Mack, zero remaining variance.
    """
    return MethodResult(
        method=method,
        development_factors=(),
        origin_results=tuple(
            OriginResult(
                origin=origin,
                ultimate=float(row[0]),
                ibnr=0.0,
                mack_std_err=0.0 if mack else None,
                reserve_low=0.0 if mack else None,
                reserve_high=0.0 if mack else None,
            )
            for origin, row in zip(triangle.origin_periods, triangle.cells)
        ),
        total_mack_std_err=0.0 if mack else None,
    )


def _build_cl_triangle(triangle: Triangle) -> "cl.Triangle":
    df = _to_long_dataframe(triangle)
    return cl.Triangle(
        df, origin="origin", development="development", columns=["values"], cumulative=True
    )


def _extract_development_factors(triangle: Triangle, model) -> tuple[DevelopmentFactor, ...]:
    # ldf_ appends tail columns of 1.0 beyond the triangle horizon;
    # exactly the first n_dev - 1 factors belong to this triangle.
    n_dev = len(triangle.development_periods)
    ldf_row = model.ldf_.to_frame(origin_as_datetime=False).iloc[0, : n_dev - 1]
    return tuple(
        DevelopmentFactor(
            from_dev=triangle.development_periods[j],
            to_dev=triangle.development_periods[j + 1],
            factor=float(ldf_row.iloc[j]),
        )
        for j in range(n_dev - 1)
    )


def _extract_point_estimates(triangle: Triangle, model) -> list[tuple[str, float, float]]:
    """(origin, ultimate, ibnr) per row, with the fully-developed-origin
    NaN IBNR mapped to 0.0 (latest diagonal already at ultimate means
    zero outstanding). Any other non-finite value fails loud when the
    ResultSet models validate.
    """
    ultimates = model.ultimate_.to_frame(origin_as_datetime=False).iloc[:, 0]
    ibnrs = model.ibnr_.to_frame(origin_as_datetime=False).iloc[:, 0]
    estimates = []
    for i, origin in enumerate(triangle.origin_periods):
        ibnr = float(ibnrs.iloc[i])
        if pd.isna(ibnr):
            ibnr = 0.0
        estimates.append((origin, float(ultimates.iloc[i]), ibnr))
    return estimates


def _run_chain_ladder(triangle: Triangle, parameters: RunParameters) -> MethodResult:
    if len(triangle.development_periods) == 1:
        return _degenerate_method_result(triangle, "chain_ladder", mack=False)

    model = cl.Chainladder().fit(_build_cl_triangle(triangle))
    return MethodResult(
        method="chain_ladder",
        development_factors=_extract_development_factors(triangle, model),
        origin_results=tuple(
            OriginResult(origin=origin, ultimate=ultimate, ibnr=ibnr)
            for origin, ultimate, ibnr in _extract_point_estimates(triangle, model)
        ),
    )


def _build_exposure_diagonal(triangle: Triangle, parameters: RunParameters) -> "cl.Triangle":
    """Per-origin BF expected ultimates (loss_ratio × exposure, AD-1
    arithmetic that must live in the engine) as a chainladder exposure
    vector. Every cell sits at the SAME synthetic development year (the
    latest valuation, 2000 + n_origins - 1) — with per-origin development
    years chainladder valuates only the newest origin and silently NaNs
    the rest.
    """
    by_origin = {a.origin: a for a in parameters.apriori_loss_ratios}
    latest_valuation = 2000 + len(triangle.origin_periods) - 1
    records = [
        {
            "origin": 2000 + i,
            "development": latest_valuation,
            "values": by_origin[origin].loss_ratio * by_origin[origin].exposure,
        }
        for i, origin in enumerate(triangle.origin_periods)
    ]
    exposure = cl.Triangle(
        pd.DataFrame.from_records(records),
        origin="origin",
        development="development",
        columns=["values"],
        cumulative=True,
    )
    return exposure.latest_diagonal


def _run_bornhuetter_ferguson(triangle: Triangle, parameters: RunParameters) -> MethodResult:
    if len(triangle.development_periods) == 1:
        return _degenerate_method_result(triangle, "bornhuetter_ferguson", mack=False)

    model = cl.BornhuetterFerguson(apriori=1.0).fit(
        _build_cl_triangle(triangle),
        sample_weight=_build_exposure_diagonal(triangle, parameters),
    )
    return MethodResult(
        method="bornhuetter_ferguson",
        development_factors=_extract_development_factors(triangle, model),
        origin_results=tuple(
            OriginResult(origin=origin, ultimate=ultimate, ibnr=ibnr)
            for origin, ultimate, ibnr in _extract_point_estimates(triangle, model)
        ),
    )


def _run_mack(triangle: Triangle, parameters: RunParameters) -> MethodResult:
    if len(triangle.development_periods) == 1:
        return _degenerate_method_result(triangle, "mack", mack=True)

    # sigma_interpolation="mack" is load-bearing: it is Mack's own
    # last-sigma rule from the 1993 paper, and the only setting under
    # which the Taylor-Ashe golden tests reproduce the published
    # standard errors (the default "log-linear" does not).
    development = cl.Development(sigma_interpolation="mack").fit_transform(
        _build_cl_triangle(triangle)
    )
    model = cl.MackChainladder().fit(development)

    std_errs = model.summary_.to_frame(origin_as_datetime=False)["Mack Std Err"]
    origin_results = []
    for i, (origin, ultimate, ibnr) in enumerate(_extract_point_estimates(triangle, model)):
        std_err = float(std_errs.iloc[i])
        # A fully-developed origin has zero remaining variance; the
        # paper prints a dash where chainladder emits NaN.
        if pd.isna(std_err):
            std_err = 0.0
        origin_results.append(
            OriginResult(
                origin=origin,
                ultimate=ultimate,
                ibnr=ibnr,
                mack_std_err=std_err,
                # ±1-SE band around IBNR, engine-computed (AD-1), not
                # floored at zero: a band that crosses zero is
                # information, not an error.
                reserve_low=ibnr - std_err,
                reserve_high=ibnr + std_err,
            )
        )

    # As with the per-origin std err, a fully-developed / non-estimable
    # total (thin triangle, one link ratio per transition) prints NaN in
    # chainladder; treat it as zero remaining variance rather than letting
    # the non-finite value fail ResultSet construction.
    total_std_err = float(model.total_mack_std_err_.iloc[0, 0])
    if pd.isna(total_std_err):
        total_std_err = 0.0

    return MethodResult(
        method="mack",
        development_factors=_extract_development_factors(triangle, model),
        origin_results=tuple(origin_results),
        total_mack_std_err=total_std_err,
    )


_METHOD_RUNNERS = {
    "chain_ladder": _run_chain_ladder,
    "bornhuetter_ferguson": _run_bornhuetter_ferguson,
    "mack": _run_mack,
}


def _check_aprioris(triangle: Triangle, parameters: RunParameters) -> None:
    """BF boundary checks (FR-4): fail before any Method runs.

    Duplicate and Triangle-unknown a-priori origins are rejected even
    though extras could be "ignored" — silent extras are how mismatched
    grids slip through.
    """
    seen: set[str] = set()
    for apriori in parameters.apriori_loss_ratios:
        if apriori.origin in seen:
            raise InvalidAprioriError(
                f"duplicate A Priori Loss Ratio for Origin Period {apriori.origin}",
                (apriori.origin,),
            )
        seen.add(apriori.origin)

    known = set(triangle.origin_periods)
    unknown = tuple(a.origin for a in parameters.apriori_loss_ratios if a.origin not in known)
    if unknown:
        raise InvalidAprioriError(
            "A Priori Loss Ratio(s) name Origin Period(s) not in the Triangle: "
            f"{', '.join(unknown)}",
            unknown,
        )

    if "bornhuetter_ferguson" in parameters.methods:
        missing = tuple(o for o in triangle.origin_periods if o not in seen)
        if missing:
            raise MissingAprioriError(missing)


def run_methods(triangle: Triangle, parameters: RunParameters | None = None) -> ResultSet:
    """Run the requested Methods on a Triangle, returning a full ResultSet.

    Validates at the engine boundary (raises InvalidTriangleError on any
    finding), then runs each Method in ``parameters.methods`` order and
    assembles the Lineage (AD-11: engine semver, chainladder version,
    canonical Triangle hash, all parameters as defaulted).
    """
    report = validate_triangle(triangle)
    if not report.valid:
        raise InvalidTriangleError(report)

    if parameters is None:
        parameters = RunParameters()

    _check_aprioris(triangle, parameters)

    method_results = tuple(
        _METHOD_RUNNERS[method](triangle, parameters) for method in parameters.methods
    )

    lineage = Lineage(
        engine_version=ENGINE_VERSION,
        chainladder_version=cl.__version__,
        triangle_hash=triangle_hash(triangle),
        parameters=parameters,
    )
    return ResultSet(lineage=lineage, method_results=method_results)
