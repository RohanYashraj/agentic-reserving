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

Story 2.3 widened this shape pre-export (2.6 has not frozen it yet):
BF and Mack joined the ``methods`` Literal, ``RunParameters`` gained
``apriori_loss_ratios``, ``OriginResult`` gained optional Mack fields,
and ``MethodResult`` gained ``total_mack_std_err``. ``schema_version``
stays "1.0.0" — versioning governance is Story 2.6's.
"""

import math
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel

_MODEL_CONFIG = ConfigDict(frozen=True, alias_generator=to_camel, populate_by_name=True)


def _require_finite(value: float) -> float:
    if not math.isfinite(value):
        raise ValueError(f"value is {value!r}; NaN and infinite values are not permitted")
    return value


def _require_finite_or_none(value: float | None) -> float | None:
    if value is None:
        return None
    return _require_finite(value)


class AprioriLossRatio(BaseModel):
    """One Origin Period's BF prior: A Priori Loss Ratio plus exposure base.

    BF's expected ultimate is ``loss_ratio × exposure``. That is
    reserve-figure arithmetic, so it happens inside the engine (AD-1) —
    which is why the exposure travels with the loss ratio rather than
    being multiplied upstream. A zero loss ratio is a legal "expect
    nothing more" prior; a non-positive exposure is garbage.
    """

    model_config = _MODEL_CONFIG

    origin: str
    loss_ratio: float
    exposure: float

    _finite = field_validator("loss_ratio", "exposure")(_require_finite)

    @field_validator("loss_ratio")
    @classmethod
    def _non_negative_loss_ratio(cls, value: float) -> float:
        if value < 0:
            raise ValueError(f"loss_ratio is {value!r}; must be >= 0")
        return value

    @field_validator("exposure")
    @classmethod
    def _positive_exposure(cls, value: float) -> float:
        if value <= 0:
            raise ValueError(f"exposure is {value!r}; must be > 0")
        return value


class RunParameters(BaseModel):
    """All caller-supplied knobs for a run. Recorded verbatim in Lineage."""

    model_config = _MODEL_CONFIG

    # At least one Method: an empty run would assemble a ResultSet carrying
    # zero reserve figures, which is never a valid Run outcome.
    methods: tuple[Literal["chain_ladder", "bornhuetter_ferguson", "mack"], ...] = Field(
        default=("chain_ladder",), min_length=1
    )
    apriori_loss_ratios: tuple[AprioriLossRatio, ...] = ()


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
    """Ultimate and IBNR for one Origin Period.

    The Mack fields are populated only when the Method is Mack (``None``
    for CL/BF). ``reserve_low``/``reserve_high`` are the engine-computed
    ±1-standard-error band around IBNR — not floored at zero: a band
    that crosses zero is information, not an error.
    """

    model_config = _MODEL_CONFIG

    origin: str
    ultimate: float
    ibnr: float
    mack_std_err: float | None = None
    reserve_low: float | None = None
    reserve_high: float | None = None

    _finite = field_validator("ultimate", "ibnr")(_require_finite)
    _finite_optional = field_validator("mack_std_err", "reserve_low", "reserve_high")(
        _require_finite_or_none
    )


class MethodResult(BaseModel):
    """One Method's full output: LDFs plus one OriginResult per row.

    ``total_mack_std_err`` (Mack only, else ``None``) is emitted by the
    engine because the total is NOT the sum of per-origin standard
    errors (correlation term) — nothing outside the engine may compute
    it (AD-1).
    """

    model_config = _MODEL_CONFIG

    method: Literal["chain_ladder", "bornhuetter_ferguson", "mack"]
    development_factors: tuple[DevelopmentFactor, ...]
    origin_results: tuple[OriginResult, ...]
    total_mack_std_err: float | None = None

    _finite_optional = field_validator("total_mack_std_err")(_require_finite_or_none)


class ResultSet(BaseModel):
    """The engine's complete, self-describing output for one run."""

    model_config = _MODEL_CONFIG

    schema_version: str = "1.0.0"
    lineage: Lineage
    method_results: tuple[MethodResult, ...]
