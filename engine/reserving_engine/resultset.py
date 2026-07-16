"""ResultSet and Lineage: the typed output contract of the engine.

Pure-core contract (AD-2): this module performs no file, network,
environment, clock, or logging side effects. Everything is plain,
JSON-serialisable data.

This shape is the AD-10 cross-runtime contract: camelCase on the JSON
wire (``schemaVersion``, ``engineVersion``, ``triangleHash``, …),
snake_case in Python. Story 2.6 exports its JSON Schema and CI-diffs
the Convex validators against it — every field change here is a
contract change.

Lineage records exactly the AD-11 reproduction ingredients: engine
semver, chainladder version, the canonical Triangle hash, and all run
parameters. ``triangle_hash`` is the sha256 of the canonical Triangle
JSON (``triangle.triangle_hash``) — never the raw-file hash used for
upload dedupe (Epic 3), never the audit-chain hash (Story 1.5).

Non-finite floats (NaN/±Inf) are rejected on every float field: a
ResultSet that fails validation is never stored, so garbage from the
numeric layer fails loud at construction instead of serializing as
``NaN`` and breaking JSON.
"""

import math
from typing import Literal

from pydantic import BaseModel, ConfigDict, field_validator
from pydantic.alias_generators import to_camel

_MODEL_CONFIG = ConfigDict(frozen=True, alias_generator=to_camel, populate_by_name=True)


def _require_finite(value: float) -> float:
    if not math.isfinite(value):
        raise ValueError(f"value is {value!r}; NaN and infinite values are not permitted")
    return value


class RunParameters(BaseModel):
    """All caller-supplied knobs for a run. Recorded verbatim in Lineage."""

    model_config = _MODEL_CONFIG

    methods: tuple[Literal["chain_ladder"], ...] = ("chain_ladder",)


class Lineage(BaseModel):
    """The AD-11 reproduction recipe for a ResultSet."""

    model_config = _MODEL_CONFIG

    engine_version: str
    chainladder_version: str
    triangle_hash: str
    parameters: RunParameters


class DevelopmentFactor(BaseModel):
    """One age-to-age factor, keyed by Development Period labels."""

    model_config = _MODEL_CONFIG

    from_dev: str
    to_dev: str
    factor: float

    _finite = field_validator("factor")(_require_finite)


class OriginResult(BaseModel):
    """Ultimate and IBNR for one Origin Period."""

    model_config = _MODEL_CONFIG

    origin: str
    ultimate: float
    ibnr: float

    _finite = field_validator("ultimate", "ibnr")(_require_finite)


class MethodResult(BaseModel):
    """One Method's full output: LDFs plus one OriginResult per row."""

    model_config = _MODEL_CONFIG

    method: Literal["chain_ladder"]
    development_factors: tuple[DevelopmentFactor, ...]
    origin_results: tuple[OriginResult, ...]


class ResultSet(BaseModel):
    """The engine's complete, self-describing output for one run."""

    model_config = _MODEL_CONFIG

    schema_version: str = "1.0.0"
    lineage: Lineage
    method_results: tuple[MethodResult, ...]
