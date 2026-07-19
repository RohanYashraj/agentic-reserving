"""reserving_engine: the pure functional core (AD-2).

Plain data in, typed JSON-serialisable Pydantic models out. No file,
network, environment, clock access, or logging side effects — enforced
by the import-linter contracts in pyproject.toml.
"""

from reserving_engine.diagnostics import (
    AveElement,
    ClBfDivergenceElement,
    DiagnosticsBundle,
    LdfStabilityElement,
    LinkRatio,
    ResidualElement,
    UnknownDiagnosticIdError,
    compute_diagnostics,
    diagnostic_id,
    resolve_diagnostic,
)
from reserving_engine.methods import (
    InvalidAprioriError,
    InvalidTriangleError,
    MissingAprioriError,
    run_methods,
)
from reserving_engine.rederivation import (
    Discrepancy,
    ReDerivationReport,
    rederive,
)
from reserving_engine.resultset import (
    AprioriLossRatio,
    DevelopmentFactor,
    Lineage,
    MethodResult,
    OriginResult,
    ResultSet,
    RunParameters,
)
from reserving_engine.triangle import (
    Triangle,
    canonical_triangle_json,
    triangle_hash,
)
from reserving_engine.validation import (
    ValidationFinding,
    ValidationReport,
    validate_triangle,
)
from reserving_engine.version import ENGINE_VERSION

__all__ = [
    "ENGINE_VERSION",
    "AprioriLossRatio",
    "AveElement",
    "ClBfDivergenceElement",
    "DevelopmentFactor",
    "DiagnosticsBundle",
    "Discrepancy",
    "InvalidAprioriError",
    "InvalidTriangleError",
    "LdfStabilityElement",
    "Lineage",
    "LinkRatio",
    "MethodResult",
    "MissingAprioriError",
    "OriginResult",
    "ReDerivationReport",
    "ResidualElement",
    "ResultSet",
    "RunParameters",
    "Triangle",
    "UnknownDiagnosticIdError",
    "ValidationFinding",
    "ValidationReport",
    "canonical_triangle_json",
    "compute_diagnostics",
    "diagnostic_id",
    "rederive",
    "resolve_diagnostic",
    "run_methods",
    "triangle_hash",
    "validate_triangle",
]
