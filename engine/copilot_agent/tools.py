"""Read-only tool views over the current Run (AD-8, FR-9).

The agent's ENTIRE data-access boundary is the four callables returned by
``build_read_tools``. Each is a closure over the request's in-memory
``ResultSet`` and ``DiagnosticsBundle`` (both ``frozen=True`` Pydantic
models), so the surface is structurally read-only and request-scoped:
there is deliberately no create / update / delete / write / set / patch
verb, no filesystem, no network, no Convex reference. The tool list is
the whole seam the model can reach.

Every tool returns plain JSON-serialisable data via
``model_dump(mode="json", by_alias=True)`` so the wire the model sees is
the same camelCase AD-10 contract the rest of the system speaks. Nothing
here computes a reserve figure — figures are READ verbatim from the
engine's output (AD-1); any arithmetic already happened in
``reserving_engine``.

Diagnostic IDs are resolved by ``resolve_diagnostic`` (dict lookup over
the bundle), never by splitting the opaque ``dx:`` string.
"""

from collections.abc import Callable

from reserving_engine import (
    DiagnosticsBundle,
    ResultSet,
    UnknownDiagnosticIdError,
    resolve_diagnostic,
)
from reserving_engine.diagnostics import (
    AveElement,
    ClBfDivergenceElement,
    LdfStabilityElement,
    ResidualElement,
)

_KIND_BY_TYPE = {
    LdfStabilityElement: "ldf_stability",
    AveElement: "ave",
    ClBfDivergenceElement: "cl_bf_divergence",
    ResidualElement: "residual",
}


def _summarize(element) -> dict:
    """One ``list_diagnostics`` row. ``kind`` comes from the Python type,
    never from parsing the opaque ``dx:`` id. Coordinate keys are emitted
    only when the element carries them (LDF stability has no origin;
    CL-vs-BF divergence has no dev transition)."""
    summary: dict = {"id": element.id, "kind": _KIND_BY_TYPE[type(element)]}
    for attr, key in (("origin", "origin"), ("from_dev", "fromDev"), ("to_dev", "toDev")):
        value = getattr(element, attr, None)
        if value is not None:
            summary[key] = value
    return summary


def build_read_tools(
    result_set: ResultSet, diagnostics_bundle: DiagnosticsBundle
) -> list[Callable]:
    """Return the four read-only tool callables closed over this Run's
    ResultSet and DiagnosticsBundle (AD-8). Fresh closures every call — no
    module-level state, no cross-request sharing (AD-3)."""

    def list_diagnostics() -> list:
        """List every Diagnostic in this Run as {id, kind, coordinates}."""
        elements = (
            *diagnostics_bundle.ldf_stability,
            *diagnostics_bundle.ave,
            *(diagnostics_bundle.cl_bf_divergence or ()),
            *diagnostics_bundle.residuals,
        )
        return [_summarize(element) for element in elements]

    def get_diagnostic(diagnostic_id: str) -> dict:
        """Get one Diagnostic's full values by its dx: id."""
        try:
            element = resolve_diagnostic(diagnostics_bundle, diagnostic_id)
        except UnknownDiagnosticIdError:
            return {"error": "unknown_diagnostic", "diagnosticId": diagnostic_id}
        return element.model_dump(mode="json", by_alias=True)

    def get_result_fields(method: str, origin: str | None = None) -> dict:
        """Get a Method's stored figures, optionally narrowed to one Origin Period."""
        method_result = next(
            (m for m in result_set.method_results if m.method == method), None
        )
        if method_result is None:
            return {"error": "unknown_method", "method": method}
        dumped = method_result.model_dump(mode="json", by_alias=True)
        if origin is None:
            return dumped
        narrowed = [o for o in dumped["originResults"] if o["origin"] == origin]
        if not narrowed:
            return {"error": "unknown_origin", "method": method, "origin": origin}
        return {**dumped, "originResults": narrowed}

    def get_run_metadata() -> dict:
        """Get this Run's Lineage, schema versions, and Method list."""
        return {
            "runId": diagnostics_bundle.run_id,
            "schemaVersion": result_set.schema_version,
            "diagnosticsSchemaVersion": diagnostics_bundle.schema_version,
            "lineage": result_set.lineage.model_dump(mode="json", by_alias=True),
            "methods": [m.method for m in result_set.method_results],
        }

    return [list_diagnostics, get_diagnostic, get_result_fields, get_run_metadata]
