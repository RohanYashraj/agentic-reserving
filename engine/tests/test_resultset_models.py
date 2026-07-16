"""Structural tests for ResultSet/Lineage models (Story 2.2, Task 1).

The ResultSet shape is the AD-10 cross-runtime contract: camelCase on
the JSON wire, snake_case in Python, frozen, non-finite floats rejected
at construction.
"""

import json
import math

import pytest
from pydantic import ValidationError

from reserving_engine import (
    DevelopmentFactor,
    Lineage,
    MethodResult,
    OriginResult,
    ResultSet,
    RunParameters,
)


def make_resultset(**overrides):
    """A minimal valid ResultSet; override any top-level field."""
    kwargs = {
        "schema_version": "1.0.0",
        "lineage": Lineage(
            engine_version="0.1.0",
            chainladder_version="0.9.2",
            triangle_hash="ab" * 32,
            parameters=RunParameters(methods=("chain_ladder",)),
        ),
        "method_results": (
            MethodResult(
                method="chain_ladder",
                development_factors=(
                    DevelopmentFactor(from_dev="12", to_dev="24", factor=1.5),
                ),
                origin_results=(
                    OriginResult(origin="2021", ultimate=175.0, ibnr=0.0),
                    OriginResult(origin="2022", ultimate=240.0, ibnr=80.0),
                ),
            ),
        ),
    }
    kwargs.update(overrides)
    return ResultSet(**kwargs)


class TestConstruction:
    def test_valid_resultset_constructs(self):
        rs = make_resultset()
        assert rs.schema_version == "1.0.0"
        assert rs.lineage.chainladder_version == "0.9.2"
        assert rs.method_results[0].method == "chain_ladder"
        assert rs.method_results[0].origin_results[1].ibnr == 80.0

    def test_run_parameters_default_is_chain_ladder_only(self):
        assert RunParameters().methods == ("chain_ladder",)

    def test_unknown_method_rejected(self):
        with pytest.raises(ValidationError):
            RunParameters(methods=("bornhuetter_ferguson",))

    def test_models_are_frozen(self):
        rs = make_resultset()
        with pytest.raises(ValidationError):
            rs.schema_version = "2.0.0"
        with pytest.raises(ValidationError):
            rs.lineage.engine_version = "9.9.9"

    def test_populate_by_name_accepts_camel_case_input(self):
        # Round-trip: the wire form must validate back into the model.
        rs = make_resultset()
        assert ResultSet.model_validate_json(rs.model_dump_json(by_alias=True)) == rs


class TestWireShape:
    def test_json_keys_are_camel_case(self):
        payload = json.loads(make_resultset().model_dump_json(by_alias=True))
        assert set(payload) == {"schemaVersion", "lineage", "methodResults"}
        assert set(payload["lineage"]) == {
            "engineVersion",
            "chainladderVersion",
            "triangleHash",
            "parameters",
        }
        method = payload["methodResults"][0]
        assert set(method) == {"method", "developmentFactors", "originResults"}
        assert set(method["developmentFactors"][0]) == {"fromDev", "toDev", "factor"}
        assert set(method["originResults"][0]) == {"origin", "ultimate", "ibnr"}


class TestNonFiniteRejection:
    def test_nan_ultimate_rejected(self):
        with pytest.raises(ValidationError):
            OriginResult(origin="2021", ultimate=math.nan, ibnr=0.0)

    def test_infinite_ibnr_rejected(self):
        with pytest.raises(ValidationError):
            OriginResult(origin="2021", ultimate=175.0, ibnr=math.inf)

    def test_nan_factor_rejected(self):
        with pytest.raises(ValidationError):
            DevelopmentFactor(from_dev="12", to_dev="24", factor=math.nan)

    def test_negative_infinite_factor_rejected(self):
        with pytest.raises(ValidationError):
            DevelopmentFactor(from_dev="12", to_dev="24", factor=-math.inf)
