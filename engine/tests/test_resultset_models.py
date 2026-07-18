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
    AprioriLossRatio,
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
            RunParameters(methods=("cape_cod",))

    def test_empty_methods_rejected(self):
        # An empty run would assemble a ResultSet carrying zero reserve
        # figures — never a valid Run outcome.
        with pytest.raises(ValidationError):
            RunParameters(methods=())

    def test_all_three_v1_methods_accepted(self):
        params = RunParameters(methods=("chain_ladder", "bornhuetter_ferguson", "mack"))
        assert params.methods == ("chain_ladder", "bornhuetter_ferguson", "mack")

    def test_apriori_loss_ratios_default_empty(self):
        assert RunParameters().apriori_loss_ratios == ()

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
        assert set(payload["lineage"]["parameters"]) == {"methods", "aprioriLossRatios"}
        method = payload["methodResults"][0]
        assert set(method) == {
            "method",
            "developmentFactors",
            "originResults",
            "totalMackStdErr",
        }
        assert set(method["developmentFactors"][0]) == {"fromDev", "toDev", "factor"}
        assert set(method["originResults"][0]) == {
            "origin",
            "ultimate",
            "ibnr",
            "mackStdErr",
            "reserveLow",
            "reserveHigh",
        }

    def test_apriori_loss_ratio_wire_keys(self):
        apriori = AprioriLossRatio(origin="2021", loss_ratio=0.9, exposure=5_000_000.0)
        payload = json.loads(apriori.model_dump_json(by_alias=True))
        assert set(payload) == {"origin", "lossRatio", "exposure"}


class TestAprioriLossRatio:
    def test_valid_apriori_constructs(self):
        apriori = AprioriLossRatio(origin="2021", loss_ratio=0.9, exposure=5_000_000.0)
        assert apriori.loss_ratio == 0.9
        assert apriori.exposure == 5_000_000.0

    def test_zero_loss_ratio_is_legal(self):
        # "Expect nothing more" is a legitimate prior.
        assert AprioriLossRatio(origin="2021", loss_ratio=0.0, exposure=1.0).loss_ratio == 0.0

    def test_negative_loss_ratio_rejected(self):
        with pytest.raises(ValidationError):
            AprioriLossRatio(origin="2021", loss_ratio=-0.1, exposure=1.0)

    def test_zero_exposure_rejected(self):
        with pytest.raises(ValidationError):
            AprioriLossRatio(origin="2021", loss_ratio=0.9, exposure=0.0)

    def test_negative_exposure_rejected(self):
        with pytest.raises(ValidationError):
            AprioriLossRatio(origin="2021", loss_ratio=0.9, exposure=-1.0)

    def test_nan_loss_ratio_rejected(self):
        with pytest.raises(ValidationError):
            AprioriLossRatio(origin="2021", loss_ratio=math.nan, exposure=1.0)

    def test_infinite_exposure_rejected(self):
        with pytest.raises(ValidationError):
            AprioriLossRatio(origin="2021", loss_ratio=0.9, exposure=math.inf)


class TestMackFields:
    def test_mack_fields_default_none(self):
        result = OriginResult(origin="2021", ultimate=175.0, ibnr=0.0)
        assert result.mack_std_err is None
        assert result.reserve_low is None
        assert result.reserve_high is None

    def test_total_mack_std_err_defaults_none(self):
        method = make_resultset().method_results[0]
        assert method.total_mack_std_err is None

    def test_mack_fields_accept_finite_values(self):
        result = OriginResult(
            origin="2021",
            ultimate=175.0,
            ibnr=80.0,
            mack_std_err=12.5,
            reserve_low=67.5,
            reserve_high=92.5,
        )
        assert result.mack_std_err == 12.5
        assert result.reserve_low == 67.5
        assert result.reserve_high == 92.5

    def test_nan_mack_std_err_rejected(self):
        with pytest.raises(ValidationError):
            OriginResult(origin="2021", ultimate=175.0, ibnr=80.0, mack_std_err=math.nan)

    def test_infinite_reserve_high_rejected(self):
        with pytest.raises(ValidationError):
            OriginResult(origin="2021", ultimate=175.0, ibnr=80.0, reserve_high=math.inf)


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
