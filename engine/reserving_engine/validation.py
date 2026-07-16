"""Boundary validation for Triangles (FR-2 core).

Pure-core contract (AD-2): no file, network, environment, clock, or
logging side effects. ``validate_triangle`` is a pure function that
collects ALL domain defects into a typed, JSON-serialisable report with
cell-level ``{origin, dev, reason}`` findings — never a generic failure,
never fail-fast on the first defect.

Semantics on partially-observed rectangles (fixed by Story 2.1):

- The *observed region* of a row is its leading contiguous run of
  non-``None`` cells; everything after the row's first ``None`` is the
  unobserved future.
- ``missing_cell``: a ``None`` with a value somewhere later in the same
  row — a hole inside the observed region (hard rejection in v1).
- ``shape``: a row with zero observed cells, or an observed prefix that
  grows from an older origin row to a newer one. Prefix lengths ignore
  interior holes so one defect is never reported under two codes.
- ``paid_monotonicity``: paid triangles only (PRD OQ-6 — incurred can
  legitimately decrease). A cell strictly below its immediate observed
  predecessor is flagged at the decreasing cell; equal values are fine.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, model_validator

from reserving_engine.triangle import Triangle

FindingCode = Literal["shape", "paid_monotonicity", "missing_cell"]


class ValidationFinding(BaseModel):
    """One cell-level defect, addressed by period labels (never indices)."""

    model_config = ConfigDict(frozen=True)

    origin: str
    dev: str
    reason: str
    code: FindingCode


class ValidationReport(BaseModel):
    """Typed validation outcome; ``valid`` is derived from ``findings``."""

    model_config = ConfigDict(frozen=True)

    valid: bool
    findings: tuple[ValidationFinding, ...]

    @model_validator(mode="after")
    def _valid_matches_findings(self) -> "ValidationReport":
        if self.valid != (len(self.findings) == 0):
            raise ValueError("valid must be True exactly when findings is empty")
        return self


def _observed_length(row: tuple[float | None, ...]) -> int:
    """Observed prefix length ignoring interior holes: 1 past the last value."""
    length = 0
    for j, cell in enumerate(row):
        if cell is not None:
            length = j + 1
    return length


def validate_triangle(triangle: Triangle) -> ValidationReport:
    """Collect every domain defect in ``triangle`` into one report."""
    findings: list[ValidationFinding] = []
    origins = triangle.origin_periods
    devs = triangle.development_periods

    lengths = [_observed_length(row) for row in triangle.cells]

    for i, row in enumerate(triangle.cells):
        length = lengths[i]

        if length == 0:
            findings.append(
                ValidationFinding(
                    origin=origins[i],
                    dev=devs[0],
                    code="shape",
                    reason=f"origin {origins[i]} has no observed cells",
                )
            )
            continue

        for j in range(length):
            cell = row[j]
            if cell is None:
                findings.append(
                    ValidationFinding(
                        origin=origins[i],
                        dev=devs[j],
                        code="missing_cell",
                        reason=(
                            f"missing value inside the observed region at "
                            f"origin {origins[i]}, development {devs[j]}"
                        ),
                    )
                )
            elif triangle.kind == "paid":
                prev = row[j - 1] if j > 0 else None
                if prev is not None and cell < prev:
                    findings.append(
                        ValidationFinding(
                            origin=origins[i],
                            dev=devs[j],
                            code="paid_monotonicity",
                            reason=(
                                f"cumulative paid decreases from {prev} to {cell} "
                                f"at origin {origins[i]}, development {devs[j]}"
                            ),
                        )
                    )

    for i in range(1, len(lengths)):
        if lengths[i] > lengths[i - 1]:
            findings.append(
                ValidationFinding(
                    origin=origins[i],
                    dev=devs[lengths[i - 1]],
                    code="shape",
                    reason=(
                        f"origin {origins[i]} has more observed development "
                        f"periods than older origin {origins[i - 1]}"
                    ),
                )
            )

    return ValidationReport(valid=not findings, findings=tuple(findings))
