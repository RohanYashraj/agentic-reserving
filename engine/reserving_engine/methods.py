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


def _run_chain_ladder(triangle: Triangle) -> MethodResult:
    n_dev = len(triangle.development_periods)
    if n_dev == 1:
        # chainladder cannot fit a triangle with a single development
        # column (IndexError in its development estimator). Chain Ladder
        # degenerates trivially there: no factors to estimate, every
        # origin is at ultimate with zero IBNR.
        return MethodResult(
            method="chain_ladder",
            development_factors=(),
            origin_results=tuple(
                OriginResult(origin=origin, ultimate=float(row[0]), ibnr=0.0)
                for origin, row in zip(triangle.origin_periods, triangle.cells)
            ),
        )

    df = _to_long_dataframe(triangle)
    cl_triangle = cl.Triangle(
        df, origin="origin", development="development", columns=["values"], cumulative=True
    )
    model = cl.Chainladder().fit(cl_triangle)

    ultimates = model.ultimate_.to_frame(origin_as_datetime=False).iloc[:, 0]
    ibnrs = model.ibnr_.to_frame(origin_as_datetime=False).iloc[:, 0]
    # ldf_ appends tail columns of 1.0 beyond the triangle horizon;
    # exactly the first n_dev - 1 factors belong to this triangle.
    ldf_row = model.ldf_.to_frame(origin_as_datetime=False).iloc[0, : n_dev - 1]

    origin_results = []
    for i, origin in enumerate(triangle.origin_periods):
        ibnr = float(ibnrs.iloc[i])
        # chainladder emits NaN IBNR for a fully-developed origin (latest
        # diagonal already at ultimate); that means zero outstanding.
        if pd.isna(ibnr):
            ibnr = 0.0
        origin_results.append(
            OriginResult(origin=origin, ultimate=float(ultimates.iloc[i]), ibnr=ibnr)
        )

    development_factors = tuple(
        DevelopmentFactor(
            from_dev=triangle.development_periods[j],
            to_dev=triangle.development_periods[j + 1],
            factor=float(ldf_row.iloc[j]),
        )
        for j in range(n_dev - 1)
    )

    return MethodResult(
        method="chain_ladder",
        development_factors=development_factors,
        origin_results=tuple(origin_results),
    )


_METHOD_RUNNERS = {"chain_ladder": _run_chain_ladder}


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

    method_results = tuple(_METHOD_RUNNERS[method](triangle) for method in parameters.methods)

    lineage = Lineage(
        engine_version=ENGINE_VERSION,
        chainladder_version=cl.__version__,
        triangle_hash=triangle_hash(triangle),
        parameters=parameters,
    )
    return ResultSet(lineage=lineage, method_results=method_results)
