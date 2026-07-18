"""DiagnosticsBundle: the four FR-7 Diagnostics with addressable IDs.

Pure-core contract (AD-2): this module performs no file, network,
environment, clock, or logging side effects. ``run_id`` is plain data
passed in by the caller (engine_service hands down the Convex run ID in
Story 2.5) — the core never generates or fetches it.

Diagnostics computation lives in ``reserving_engine`` because it
produces numbers, so it belongs to the golden-tested core;
``engine_service``'s future diagnostics surface (2.5) is only the
HTTP/serialisation view.

This shape is the second half of the AD-10 cross-runtime contract:
camelCase on the JSON wire (``schemaVersion``, ``runId``,
``triangleHash``, ``ldfStability``, …), snake_case in Python. Story 2.6
exports its JSON Schema and CI-diffs the Convex validators against it —
every field change here is a contract change. ``schema_version`` stays
"1.0.0"; versioning governance is Story 2.6's.

Every reserve-figure derivation here — ``expected = prior × LDF``,
actual − expected, the actual/expected ratio, CL − BF divergence, the
coefficient of variation — is an AD-1 arithmetic that must live in the
engine; nothing downstream (Convex, React, prompts, export) may compute
it. Whatever a UI or the agent will need is a field on these models.

Diagnostic IDs have the fixed AD-10 format ``dx:{runId}:{kind}:{key}``
with ``kind ∈ {ldf_stability, ave, cl_bf_divergence, residual}``. They
are minted only here; both the Convex diagnostics query and the agent
read tool resolve them, never generate them. Labels are opaque strings
(they may themselves contain ``:``), so IDs are resolved by dict lookup
over the bundle, never by string-splitting.
"""

import math

import chainladder as cl
from pydantic import BaseModel, field_validator

from reserving_engine.methods import _build_cl_triangle
from reserving_engine.resultset import (
    _MODEL_CONFIG,
    ResultSet,
    _require_finite,
    _require_finite_or_none,
)
from reserving_engine.triangle import Triangle, triangle_hash


class UnknownDiagnosticIdError(KeyError):
    """Raised when a Diagnostic ID does not resolve against a bundle."""

    def __init__(self, diagnostic_id: str) -> None:
        self.diagnostic_id = diagnostic_id
        super().__init__(f"no Diagnostic with id {diagnostic_id!r} in this bundle")


def diagnostic_id(run_id: str, kind: str, key: str) -> str:
    """Build a Diagnostic ID ``dx:{run_id}:{kind}:{key}`` (AD-10).

    ``run_id``, ``kind``, and ``key`` are joined verbatim; labels are
    opaque strings and are never parsed back out (resolution is by dict
    lookup, not by splitting on ``:``).
    """
    return f"dx:{run_id}:{kind}:{key}"


class LinkRatio(BaseModel):
    """One observed age-to-age factor, child of an LdfStabilityElement.

    Not ID-carrying: it is a value inside a stability element, not a
    citable Diagnostic in its own right.
    """

    model_config = _MODEL_CONFIG

    origin: str
    factor: float

    _finite = field_validator("factor")(_require_finite)


class LdfStabilityElement(BaseModel):
    """LDF stability for one Development Period transition.

    ``sigma``/``std_err``/``cv`` are ``None`` when chainladder cannot
    extrapolate the sigma for this transition (e.g. a single-observation
    column) — "unknown", never a fake 0.0.
    """

    model_config = _MODEL_CONFIG

    id: str
    from_dev: str
    to_dev: str
    selected_factor: float
    link_ratios: tuple[LinkRatio, ...]
    sigma: float | None = None
    std_err: float | None = None
    cv: float | None = None

    _finite = field_validator("selected_factor")(_require_finite)
    _finite_optional = field_validator("sigma", "std_err", "cv")(_require_finite_or_none)


class AveElement(BaseModel):
    """Actual vs expected on the Latest Diagonal for one Origin Period.

    ``expected = prior_cell × selected_factor`` (AD-1 arithmetic).
    ``actual_to_expected_ratio`` is ``None`` when ``expected == 0.0`` —
    never a division by zero, never a non-finite value.
    """

    model_config = _MODEL_CONFIG

    id: str
    origin: str
    from_dev: str
    to_dev: str
    actual: float
    expected: float
    actual_minus_expected: float
    actual_to_expected_ratio: float | None = None

    _finite = field_validator("actual", "expected", "actual_minus_expected")(_require_finite)
    _finite_optional = field_validator("actual_to_expected_ratio")(_require_finite_or_none)


class ClBfDivergenceElement(BaseModel):
    """CL-vs-BF divergence for one Origin Period.

    Read from the two MethodResults' ultimates (never recomputed — the
    ResultSet is the number authority, AD-1). ``relative_divergence`` is
    ``None`` when ``bf_ultimate == 0.0``.
    """

    model_config = _MODEL_CONFIG

    id: str
    origin: str
    cl_ultimate: float
    bf_ultimate: float
    divergence: float
    relative_divergence: float | None = None

    _finite = field_validator("cl_ultimate", "bf_ultimate", "divergence")(_require_finite)
    _finite_optional = field_validator("relative_divergence")(_require_finite_or_none)


class ResidualElement(BaseModel):
    """One standardized development residual (heatmap cell)."""

    model_config = _MODEL_CONFIG

    id: str
    origin: str
    from_dev: str
    to_dev: str
    residual: float

    _finite = field_validator("residual")(_require_finite)


class DiagnosticsBundle(BaseModel):
    """The engine's complete, self-describing Diagnostics for one Run.

    ``cl_bf_divergence`` is ``None`` (wire ``null``) when CL and BF did
    not both run — "not applicable", distinct from ``()`` which would
    read as "computed, nothing found". ``triangle_hash`` ties the bundle
    to its Triangle the same way Lineage does (canonical-triangle-JSON
    sha256, never the raw-file hash).
    """

    model_config = _MODEL_CONFIG

    schema_version: str = "1.0.0"
    run_id: str
    triangle_hash: str
    ldf_stability: tuple[LdfStabilityElement, ...]
    ave: tuple[AveElement, ...]
    cl_bf_divergence: tuple[ClBfDivergenceElement, ...] | None = None
    residuals: tuple[ResidualElement, ...]


_DiagnosticElement = (
    LdfStabilityElement | AveElement | ClBfDivergenceElement | ResidualElement
)


def _iter_elements(bundle: DiagnosticsBundle):
    yield from bundle.ldf_stability
    yield from bundle.ave
    yield from bundle.cl_bf_divergence or ()
    yield from bundle.residuals


def resolve_diagnostic(bundle: DiagnosticsBundle, diagnostic_id: str) -> _DiagnosticElement:
    """Return the bundle element whose ``id`` equals ``diagnostic_id``.

    Resolution walks the bundle's elements by their ``id`` field — never
    by parsing the ID string (labels are opaque and may contain ``:``).
    Raises ``UnknownDiagnosticIdError`` on a miss. This is the seam both
    the Convex diagnostics query and the agent read tool mirror (AD-10).
    """
    for element in _iter_elements(bundle):
        if element.id == diagnostic_id:
            return element
    raise UnknownDiagnosticIdError(diagnostic_id)


def _latest_observed_index(row: tuple[float | None, ...]) -> int:
    """Development index of the last observed cell in a triangle row.

    Validation guarantees the observed region is a clean leading prefix,
    so the last non-``None`` cell is the latest diagonal for this origin.
    ``cell is not None`` — a 0.0 cell is a value.
    """
    latest = 0
    for j, cell in enumerate(row):
        if cell is None:
            break
        latest = j
    return latest


def _compute_ldf_stability(
    triangle: Triangle, cl_triangle, dev, run_id: str
) -> tuple[LdfStabilityElement, ...]:
    devs = triangle.development_periods
    n_dev = len(devs)
    link_ratio_frame = cl_triangle.link_ratio.to_frame(origin_as_datetime=False)
    link_ratios = link_ratio_frame.values  # (n_origins - 1) x (n_dev - 1), NaN outside
    ldf = dev.ldf_.to_frame(origin_as_datetime=False).values[0]
    sigma = dev.sigma_.to_frame(origin_as_datetime=False).values[0]
    std_err = dev.std_err_.to_frame(origin_as_datetime=False).values[0]

    elements = []
    for j in range(n_dev - 1):
        from_dev, to_dev = devs[j], devs[j + 1]
        observed = tuple(
            LinkRatio(origin=triangle.origin_periods[i], factor=float(link_ratios[i][j]))
            for i in range(link_ratios.shape[0])
            if not math.isnan(link_ratios[i][j])
        )
        selected = float(ldf[j])
        sigma_j = float(sigma[j])
        std_err_j = float(std_err[j])
        # A single-observation transition has no estimable variance:
        # chainladder emits sigma NaN but a false-zero std_err. Treat
        # sigma as the governing signal — when it is unknown, the whole
        # stability triple is None ("unknown"), never a fake 0.0.
        if math.isnan(sigma_j):
            sigma_val = std_err_val = cv_val = None
        else:
            sigma_val = sigma_j
            std_err_val = None if math.isnan(std_err_j) else std_err_j
            cv_val = None if std_err_val is None else std_err_val / selected
        elements.append(
            LdfStabilityElement(
                id=diagnostic_id(run_id, "ldf_stability", from_dev),
                from_dev=from_dev,
                to_dev=to_dev,
                selected_factor=selected,
                link_ratios=observed,
                sigma=sigma_val,
                std_err=std_err_val,
                cv=cv_val,
            )
        )
    return tuple(elements)


def _compute_ave(triangle: Triangle, dev, run_id: str) -> tuple[AveElement, ...]:
    devs = triangle.development_periods
    ldf = dev.ldf_.to_frame(origin_as_datetime=False).values[0]

    elements = []
    for i, origin in enumerate(triangle.origin_periods):
        row = triangle.cells[i]
        j = _latest_observed_index(row)
        if j == 0:
            # Newest origin (or any single-cell row): no prior cell to
            # project from — absent, not zero.
            continue
        actual = float(row[j])
        expected = float(row[j - 1]) * float(ldf[j - 1])
        ratio = None if expected == 0.0 else actual / expected
        elements.append(
            AveElement(
                id=diagnostic_id(run_id, "ave", origin),
                origin=origin,
                from_dev=devs[j - 1],
                to_dev=devs[j],
                actual=actual,
                expected=expected,
                actual_minus_expected=actual - expected,
                actual_to_expected_ratio=ratio,
            )
        )
    return tuple(elements)


def _compute_cl_bf_divergence(
    triangle: Triangle, result_set: ResultSet, run_id: str
) -> tuple[ClBfDivergenceElement, ...] | None:
    by_method = {m.method: m for m in result_set.method_results}
    if "chain_ladder" not in by_method or "bornhuetter_ferguson" not in by_method:
        return None

    cl_by_origin = {r.origin: r.ultimate for r in by_method["chain_ladder"].origin_results}
    bf_by_origin = {
        r.origin: r.ultimate for r in by_method["bornhuetter_ferguson"].origin_results
    }
    elements = []
    for origin in triangle.origin_periods:
        cl_ultimate = cl_by_origin[origin]
        bf_ultimate = bf_by_origin[origin]
        divergence = cl_ultimate - bf_ultimate
        relative = None if bf_ultimate == 0.0 else divergence / bf_ultimate
        elements.append(
            ClBfDivergenceElement(
                id=diagnostic_id(run_id, "cl_bf_divergence", origin),
                origin=origin,
                cl_ultimate=cl_ultimate,
                bf_ultimate=bf_ultimate,
                divergence=divergence,
                relative_divergence=relative,
            )
        )
    return tuple(elements)


def _compute_residuals(triangle: Triangle, dev, run_id: str) -> tuple[ResidualElement, ...]:
    devs = triangle.development_periods
    residuals = dev.std_residuals_.to_frame(origin_as_datetime=False).values

    elements = []
    for i in range(residuals.shape[0]):
        for j in range(residuals.shape[1]):
            value = residuals[i][j]
            if math.isnan(value):
                continue
            origin = triangle.origin_periods[i]
            from_dev = devs[j]
            elements.append(
                ResidualElement(
                    id=diagnostic_id(run_id, "residual", f"{origin}:{from_dev}"),
                    origin=origin,
                    from_dev=from_dev,
                    to_dev=devs[j + 1],
                    residual=float(value),
                )
            )
    return tuple(elements)


def compute_diagnostics(
    triangle: Triangle, result_set: ResultSet, run_id: str
) -> DiagnosticsBundle:
    """Derive the four FR-7 Diagnostics for a completed Run.

    ``run_id`` is plain data (never generated here, AD-2). The Triangle
    and ResultSet must belong together: their canonical Triangle hashes
    must match, or the pair is garbage. No re-validation of the Triangle
    beyond that hash check — the ResultSet can only exist for a Triangle
    that already passed ``run_methods``' boundary validation.
    """
    if not run_id:
        raise ValueError("run_id must not be empty")
    if result_set.lineage.triangle_hash != triangle_hash(triangle):
        raise ValueError(
            "result_set.lineage.triangle_hash does not match triangle_hash(triangle); "
            "the ResultSet and Triangle do not belong to the same Run"
        )

    divergence = _compute_cl_bf_divergence(triangle, result_set, run_id)

    if len(triangle.development_periods) == 1:
        # chainladder cannot fit a single-development triangle (same
        # guard as every method runner): no stability, no A-vs-E (every
        # origin's latest cell is at dev 0), no residuals. Divergence
        # needs no development fit, so it stands.
        return DiagnosticsBundle(
            run_id=run_id,
            triangle_hash=result_set.lineage.triangle_hash,
            ldf_stability=(),
            ave=(),
            cl_bf_divergence=divergence,
            residuals=(),
        )

    cl_triangle = _build_cl_triangle(triangle)
    dev = cl.Development().fit(cl_triangle)

    return DiagnosticsBundle(
        run_id=run_id,
        triangle_hash=result_set.lineage.triangle_hash,
        ldf_stability=_compute_ldf_stability(triangle, cl_triangle, dev, run_id),
        ave=_compute_ave(triangle, dev, run_id),
        cl_bf_divergence=divergence,
        residuals=_compute_residuals(triangle, dev, run_id),
    )
