"""Triangle: the immutable plain-data input to the reserving engine.

Pure-core contract (AD-2): this module performs no file, network,
environment, clock, or logging side effects. Everything in and out is
plain, JSON-serialisable data.

The Triangle container is always a full rectangle of ``float | None``;
``None`` marks a cell with no value. Domain-level validation (shape,
paid monotonicity, missing cells) lives in ``validation.validate_triangle``
— this model only rejects malformed containers (ragged rows, duplicate
labels, NaN/Infinity) so a caller can never hold a Triangle that lies
about its own dimensions.

Period labels are opaque strings here: period detection/confirmation is
the upload flow's concern (FR-3); the engine receives already-labeled data.
"""

import hashlib
import json
import math
from typing import Literal

from pydantic import BaseModel, ConfigDict, model_validator


def _check_labels(labels: tuple[str, ...], field_name: str) -> None:
    if not labels:
        raise ValueError(f"{field_name} must not be empty")
    if any(label == "" for label in labels):
        raise ValueError(f"{field_name} must not contain empty labels")
    if len(set(labels)) != len(labels):
        raise ValueError(f"{field_name} must not contain duplicate labels")


class Triangle(BaseModel):
    """An immutable cumulative claims triangle.

    Rows follow ``origin_periods`` (oldest first); columns follow
    ``development_periods`` (earliest age first). ``cells`` is a full
    rectangle; ``None`` means the cell holds no value.
    """

    model_config = ConfigDict(frozen=True)

    kind: Literal["paid", "incurred"]
    origin_periods: tuple[str, ...]
    development_periods: tuple[str, ...]
    cells: tuple[tuple[float | None, ...], ...]

    @model_validator(mode="after")
    def _validate_structure(self) -> "Triangle":
        _check_labels(self.origin_periods, "origin_periods")
        _check_labels(self.development_periods, "development_periods")
        if len(self.cells) != len(self.origin_periods):
            raise ValueError(
                f"cells has {len(self.cells)} rows but there are "
                f"{len(self.origin_periods)} origin_periods"
            )
        n_dev = len(self.development_periods)
        for i, row in enumerate(self.cells):
            if len(row) != n_dev:
                raise ValueError(
                    f"cells row {i} has {len(row)} columns but there are "
                    f"{n_dev} development_periods"
                )
            for j, cell in enumerate(row):
                if cell is not None and not math.isfinite(cell):
                    raise ValueError(
                        f"cells[{i}][{j}] is {cell!r}; NaN and infinite "
                        "values are not permitted"
                    )
        return self


def canonical_triangle_json(triangle: Triangle) -> str:
    """Serialize a Triangle to its canonical JSON form.

    This exact serialization is a permanent cross-runtime contract
    (AD-10/AD-11): keys are camelCase (``kind``, ``originPeriods``,
    ``developmentPeriods``, ``cells``), sorted, with no whitespace,
    ASCII-only escapes, and ``None`` cells as ``null``. Lineage records
    hashes of this form; re-derivation must reproduce it forever — do
    not change it.

    Float rendering relies on CPython's shortest round-trip ``repr``,
    which is deterministic across runs and platforms for finite floats;
    NaN/Infinity are rejected at Triangle construction, and
    ``allow_nan=False`` is the fail-loud backstop.
    """
    payload = {
        "kind": triangle.kind,
        "originPeriods": list(triangle.origin_periods),
        "developmentPeriods": list(triangle.development_periods),
        "cells": [list(row) for row in triangle.cells],
    }
    return json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
        allow_nan=False,
    )


def triangle_hash(triangle: Triangle) -> str:
    """Lowercase-hex sha256 of the canonical Triangle JSON.

    This is *the* Triangle hash recorded in Lineage (AD-11). It is
    distinct from the raw-file sha256 used for upload duplicate
    detection (Epic 3) and from the audit-chain hash
    (convex/lib/auditChain.ts). The three are never conflated and
    share no helpers.
    """
    canonical = canonical_triangle_json(triangle)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()
