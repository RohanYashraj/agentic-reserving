"""reserving_engine: the pure functional core (AD-2).

Plain data in, typed JSON-serialisable Pydantic models out. No file,
network, environment, clock access, or logging side effects — enforced
by the import-linter contracts in pyproject.toml.
"""

from reserving_engine.methods import InvalidTriangleError, MissingAprioriError, run_methods
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
    "DevelopmentFactor",
    "InvalidTriangleError",
    "Lineage",
    "MethodResult",
    "MissingAprioriError",
    "OriginResult",
    "ResultSet",
    "RunParameters",
    "Triangle",
    "ValidationFinding",
    "ValidationReport",
    "canonical_triangle_json",
    "run_methods",
    "triangle_hash",
    "validate_triangle",
]
