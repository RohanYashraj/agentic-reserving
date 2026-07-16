"""reserving_engine: the pure functional core (AD-2).

Plain data in, typed JSON-serialisable Pydantic models out. No file,
network, environment, clock access, or logging side effects — enforced
by the import-linter contracts in pyproject.toml.
"""

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

__all__ = [
    "Triangle",
    "ValidationFinding",
    "ValidationReport",
    "canonical_triangle_json",
    "triangle_hash",
    "validate_triangle",
]
