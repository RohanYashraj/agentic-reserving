"""copilot_agent tests (Story 5.1) — read-only tools + transcript capture.

The agent's whole data-access boundary is the four read-only tools over
one Run's in-memory ResultSet / DiagnosticsBundle (AD-8, FR-9). These
tests prove: the surface is structurally read-only (no mutating verb, the
captured models are frozen), the tools read engine figures verbatim
(AD-1 — no computation), the derived tool schemas are provider-neutral
plain JSON Schema, and the audit transcript captures prompt → every tool
call/result → response (AD-3). No network, no real model — a stubbed
model drives the one integration run.
"""

import json
import typing

import pytest
from pydantic import ValidationError
from agno.models.base import Model
from agno.models.message import Message
from agno.models.response import ModelResponse
from agno.tools.function import Function

from copilot_agent import (
    Transcript,
    build_gemini_model,
    build_interpretation_agent,
    build_read_tools,
    build_transcript,
    run_interpretation,
)
from copilot_agent.agent import ModelNotConfiguredError
from engine_service import Settings, load_settings
from reserving_engine import (
    AprioriLossRatio,
    RunParameters,
    compute_diagnostics,
    run_methods,
)
from tests.fixtures import TAYLOR_ASHE

RUN_ID = "run-5-1-test"
TOOL_NAMES = {"list_diagnostics", "get_diagnostic", "get_result_fields", "get_run_metadata"}
# A tool named with any of these would betray a write path — there must be none.
FORBIDDEN_VERBS = (
    "create", "update", "delete", "write", "set", "patch",
    "append", "put", "post", "save", "store", "insert", "remove",
)

BF_APRIORIS = tuple(
    AprioriLossRatio(origin=origin, loss_ratio=0.9, exposure=5_000_000.0)
    for origin in TAYLOR_ASHE.origin_periods
)


def _run(methods):
    params = RunParameters(methods=methods, apriori_loss_ratios=BF_APRIORIS)
    result_set = run_methods(TAYLOR_ASHE, params)
    bundle = compute_diagnostics(TAYLOR_ASHE, result_set, RUN_ID)
    return result_set, bundle


@pytest.fixture
def cl_bf_mack():
    return _run(("chain_ladder", "bornhuetter_ferguson", "mack"))


@pytest.fixture
def cl_only():
    return _run(("chain_ladder",))


@pytest.fixture
def tools(cl_bf_mack):
    result_set, bundle = cl_bf_mack
    return build_read_tools(result_set, bundle)


def _by_name(tools):
    return {t.__name__: t for t in tools}


# --------------------------------------------------------------------------
# Task 7.2 — tool read-onlyness (AC-4)
# --------------------------------------------------------------------------

def test_tool_surface_is_exactly_the_four_read_verbs(tools):
    assert {t.__name__ for t in tools} == TOOL_NAMES


def test_no_tool_name_contains_a_mutating_verb(tools):
    for tool in tools:
        lowered = tool.__name__.lower()
        assert not any(verb in lowered for verb in FORBIDDEN_VERBS), tool.__name__


def test_calling_every_tool_never_mutates_the_captured_models(cl_bf_mack):
    result_set, bundle = cl_bf_mack
    named = _by_name(build_read_tools(result_set, bundle))
    named["list_diagnostics"]()
    named["get_diagnostic"](bundle.ave[0].id)
    named["get_result_fields"]("chain_ladder")
    named["get_run_metadata"]()
    # Same objects, unchanged (the tools only read).
    assert result_set == run_methods(
        TAYLOR_ASHE,
        RunParameters(
            methods=("chain_ladder", "bornhuetter_ferguson", "mack"),
            apriori_loss_ratios=BF_APRIORIS,
        ),
    )


def test_captured_models_are_frozen_so_a_write_would_raise(cl_bf_mack):
    result_set, bundle = cl_bf_mack
    with pytest.raises(ValidationError):
        result_set.method_results = ()  # type: ignore[misc]
    with pytest.raises(ValidationError):
        bundle.run_id = "tampered"  # type: ignore[misc]


# --------------------------------------------------------------------------
# Task 7.3 — tool correctness (AC-2), figures read verbatim (AD-1)
# --------------------------------------------------------------------------

def test_list_diagnostics_covers_every_kind_and_all_ids_resolve(cl_bf_mack):
    result_set, bundle = cl_bf_mack
    named = _by_name(build_read_tools(result_set, bundle))
    rows = named["list_diagnostics"]()

    expected_count = (
        len(bundle.ldf_stability)
        + len(bundle.ave)
        + len(bundle.cl_bf_divergence or ())
        + len(bundle.residuals)
    )
    assert len(rows) == expected_count
    assert {r["kind"] for r in rows} == {"ldf_stability", "ave", "cl_bf_divergence", "residual"}
    # Every listed id resolves via get_diagnostic (the AD-10 lookup seam).
    for row in rows:
        resolved = named["get_diagnostic"](row["id"])
        assert resolved.get("id") == row["id"]
        assert "error" not in resolved


def test_get_diagnostic_unknown_id_returns_typed_error_not_raise(tools):
    result = _by_name(tools)["get_diagnostic"]("dx:bogus:ave:x")
    assert result == {"error": "unknown_diagnostic", "diagnosticId": "dx:bogus:ave:x"}


def test_get_result_fields_reads_the_method_verbatim(cl_bf_mack):
    result_set, bundle = cl_bf_mack
    named = _by_name(build_read_tools(result_set, bundle))
    cl = next(m for m in result_set.method_results if m.method == "chain_ladder")
    # Byte-equal to the engine's own dump — the tool computes nothing (AD-1).
    assert named["get_result_fields"]("chain_ladder") == cl.model_dump(
        mode="json", by_alias=True
    )


def test_get_result_fields_narrows_to_one_origin(cl_bf_mack):
    result_set, bundle = cl_bf_mack
    named = _by_name(build_read_tools(result_set, bundle))
    cl = next(m for m in result_set.method_results if m.method == "chain_ladder")
    origin = cl.origin_results[0].origin
    narrowed = named["get_result_fields"]("chain_ladder", origin=origin)
    assert [o["origin"] for o in narrowed["originResults"]] == [origin]


def test_get_result_fields_unknown_method_and_origin_return_typed_errors(tools):
    named = _by_name(tools)
    assert named["get_result_fields"]("nope") == {"error": "unknown_method", "method": "nope"}
    assert named["get_result_fields"]("chain_ladder", origin="1899") == {
        "error": "unknown_origin",
        "method": "chain_ladder",
        "origin": "1899",
    }


def test_get_run_metadata_echoes_lineage_and_versions(cl_bf_mack):
    result_set, bundle = cl_bf_mack
    named = _by_name(build_read_tools(result_set, bundle))
    meta = named["get_run_metadata"]()
    assert meta["runId"] == RUN_ID
    assert meta["schemaVersion"] == result_set.schema_version
    assert meta["diagnosticsSchemaVersion"] == bundle.schema_version
    assert meta["lineage"]["engineVersion"] == result_set.lineage.engine_version
    assert meta["lineage"]["chainladderVersion"] == result_set.lineage.chainladder_version
    assert meta["lineage"]["triangleHash"] == result_set.lineage.triangle_hash
    assert meta["methods"] == ["chain_ladder", "bornhuetter_ferguson", "mack"]


def test_divergence_absent_when_bf_did_not_run(cl_only):
    result_set, bundle = cl_only
    named = _by_name(build_read_tools(result_set, bundle))
    assert bundle.cl_bf_divergence is None
    rows = named["list_diagnostics"]()
    assert all(r["kind"] != "cl_bf_divergence" for r in rows)


# --------------------------------------------------------------------------
# Task 7.4 — provider-neutral JSON Schema (AC-2)
# --------------------------------------------------------------------------

_ALLOWED_HINT_TYPES = {str, int, float, bool, list, dict, type(None)}


def _hint_types_are_standard(hint) -> bool:
    args = typing.get_args(hint)
    if not args:
        return hint in _ALLOWED_HINT_TYPES
    return all(_hint_types_are_standard(a) for a in args)


def test_tool_signatures_are_provider_neutral(tools):
    for tool in tools:
        assert (tool.__doc__ or "").strip(), f"{tool.__name__} needs a docstring"
        for name, hint in typing.get_type_hints(tool).items():
            assert _hint_types_are_standard(hint), f"{tool.__name__}.{name}={hint!r}"


def test_agno_derives_plain_json_schema_parameters(tools):
    for tool in tools:
        function = Function.from_callable(tool)
        assert isinstance(function.parameters, dict)
        # Standard JSON-Schema property types only — nothing provider-specific.
        for prop in (function.parameters.get("properties") or {}).values():
            if "type" in prop:
                assert prop["type"] in {
                    "string", "integer", "number", "boolean", "array", "object", "null",
                }


# --------------------------------------------------------------------------
# Task 7.5 — transcript completeness on stubbed model output (pure) (AC-3, AC-4)
# --------------------------------------------------------------------------

def test_build_transcript_captures_prompt_calls_results_and_response():
    messages = [
        Message(role="system", content="Interpret reserving diagnostics."),
        Message(role="user", content="Summarize dx:run:ave:2005."),
        Message(
            role="assistant",
            content=None,
            tool_calls=[
                {
                    "id": "call_1",
                    "type": "function",
                    "function": {
                        "name": "get_diagnostic",
                        "arguments": '{"diagnostic_id": "dx:run:ave:2005"}',
                    },
                }
            ],
        ),
        Message(
            role="tool",
            tool_call_id="call_1",
            tool_name="get_diagnostic",
            content='{"id": "dx:run:ave:2005", "actual": 100.0}',
        ),
        Message(role="assistant", content="Origin 2005 actual was 100."),
    ]
    transcript = build_transcript(messages)

    assert [m.role for m in transcript.messages] == [
        "system", "user", "assistant", "tool", "assistant",
    ]
    assert len(transcript.tool_calls) == 1
    call = transcript.tool_calls[0]
    assert call.tool_name == "get_diagnostic"
    assert call.tool_args == {"diagnostic_id": "dx:run:ave:2005"}
    assert call.result == '{"id": "dx:run:ave:2005", "actual": 100.0}'
    assert transcript.messages[-1].content == "Origin 2005 actual was 100."


def test_transcript_wire_shape_is_camelcase():
    messages = [Message(role="user", content="hi")]
    wire = build_transcript(messages).model_dump(by_alias=True)
    assert set(wire) == {"messages", "toolCalls"}


# --------------------------------------------------------------------------
# Task 7.6 — stubbed-model integration through Agno's real tool loop (AC-4)
# --------------------------------------------------------------------------

class _ScriptedModel(Model):
    """A minimal Agno model that drives one real tool call then answers.

    Turn 1: request ``get_diagnostic(<a real id>)``. Turn 2: final text.
    This exercises Agno's genuine tool loop against our read-only tools —
    no network, no google-genai.
    """

    def __init__(self, tool_id: str) -> None:
        super().__init__(id="scripted-test-model")
        self.provider = "scripted"
        self._turn = 0
        self._tool_id = tool_id

    def invoke(self, *args, **kwargs) -> ModelResponse:
        self._turn += 1
        if self._turn == 1:
            return ModelResponse(
                role="assistant",
                content=None,
                tool_calls=[
                    {
                        "id": "call_1",
                        "type": "function",
                        "function": {
                            "name": "get_diagnostic",
                            "arguments": json.dumps({"diagnostic_id": self._tool_id}),
                        },
                    }
                ],
            )
        return ModelResponse(role="assistant", content="Read the diagnostic.")

    async def ainvoke(self, *args, **kwargs) -> ModelResponse:
        return self.invoke(*args, **kwargs)

    def invoke_stream(self, *args, **kwargs):
        yield self.invoke(*args, **kwargs)

    async def ainvoke_stream(self, *args, **kwargs):
        yield self.invoke(*args, **kwargs)

    def _parse_provider_response(self, response, **kwargs) -> ModelResponse:
        return response

    def _parse_provider_response_delta(self, response) -> ModelResponse:
        return response


def test_stubbed_model_run_executes_tool_and_captures_full_transcript(cl_bf_mack):
    result_set, bundle = cl_bf_mack
    real_id = bundle.ave[0].id
    agent = build_interpretation_agent(_ScriptedModel(real_id), result_set, bundle)

    result = run_interpretation(agent, "Summarize the first A-vs-E diagnostic.")

    assert result.output_text == "Read the diagnostic."
    assert len(result.transcript.tool_calls) == 1
    call = result.transcript.tool_calls[0]
    assert call.tool_name == "get_diagnostic"
    assert call.tool_args == {"diagnostic_id": real_id}
    # The tool actually ran — its result carries the resolved diagnostic id.
    assert real_id in (call.result or "")
    roles = [m.role for m in result.transcript.messages]
    assert "tool" in roles and roles[-1] == "assistant"
    # Review F1: AC-3 requires the transcript capture the PROMPT end-to-end (not
    # just the tool/response tail). Pin the user prompt's presence so a future
    # Agno change to RunOutput.messages population can't silently regress AC-3
    # while the surrounding assertions stay green.
    assert "user" in roles
    contents = " ".join(m.content or "" for m in result.transcript.messages)
    assert "Summarize the first A-vs-E diagnostic." in contents


# --------------------------------------------------------------------------
# Task 7.7 — no durable Agno state (AC-3)
# --------------------------------------------------------------------------

def test_agent_has_no_durable_store_and_telemetry_off(cl_bf_mack):
    result_set, bundle = cl_bf_mack
    agent = build_interpretation_agent(None, result_set, bundle)
    assert agent.telemetry is False
    assert getattr(agent, "db", None) is None
    assert {t.__name__ for t in agent.tools} == TOOL_NAMES


def test_each_agent_gets_fresh_tool_closures(cl_bf_mack):
    result_set, bundle = cl_bf_mack
    first = build_interpretation_agent(None, result_set, bundle)
    second = build_interpretation_agent(None, result_set, bundle)
    # Fresh closures per build — nothing shared at module level.
    assert first.tools is not second.tools
    assert all(a is not b for a, b in zip(first.tools, second.tools))


# --------------------------------------------------------------------------
# Task 2 / 4.1 — engine_service model config + model-not-configured guard
# --------------------------------------------------------------------------

def test_settings_gemini_fields_default_none():
    settings = Settings(service_secret="s")
    assert settings.gemini_api_key is None
    assert settings.gemini_model_id is None


def test_load_settings_reads_optional_gemini_config(monkeypatch):
    monkeypatch.setenv("ENGINE_SERVICE_SECRET", "s")
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    monkeypatch.setenv("GEMINI_MODEL_ID", "gemini-3.1-flash-lite")
    settings = load_settings()
    assert settings.gemini_api_key == "k"
    assert settings.gemini_model_id == "gemini-3.1-flash-lite"


def test_load_settings_gemini_absent_is_none_not_fatal(monkeypatch):
    monkeypatch.setenv("ENGINE_SERVICE_SECRET", "s")
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_MODEL_ID", raising=False)
    settings = load_settings()  # engine-only startup must not fail (AD-9)
    assert settings.gemini_api_key is None
    assert settings.gemini_model_id is None


def test_build_gemini_model_requires_key_and_id():
    with pytest.raises(ModelNotConfiguredError):
        build_gemini_model("", "gemini-3.1-flash-lite")
    with pytest.raises(ModelNotConfiguredError):
        build_gemini_model("k", "")


def test_build_gemini_model_names_the_configured_model():
    model = build_gemini_model("k", "gemini-3.1-flash-lite")
    assert model.id == "gemini-3.1-flash-lite"
    assert isinstance(build_transcript([]), Transcript)  # smoke: empty transcript ok
