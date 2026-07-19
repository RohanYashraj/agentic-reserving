"""Interpretation transcript: the audit record of one agent session.

The transcript is the ONLY artifact that leaves the agent (AD-3): Convex
is the sole system of record, so ``engine_service`` returns this payload
to the calling Convex action, which appends it via ``appendAuditEntry``
(AD-6) — "every LLM interaction (full prompt, each tool call/result,
response)" (FR-15). Agno holds no durable session state.

``build_transcript`` is a PURE function of Agno's ``RunOutput.messages``
(a ``list`` of ``agno.models.message.Message``): system prompt, user
prompt, each assistant turn with its ``tool_calls``, and each ``tool``-
role result, in order — so it is unit-testable with hand-built messages,
no live model needed (AC-4). It carries roles / content / tool traffic
only; never the API key or raw provider objects.

Wire shape reuses the engine's shared camelCase alias config
(``_MODEL_CONFIG``) so the audit payload matches the AD-10 house
contract (``toolCallId``, ``toolName``, …).
"""

import json
from typing import Any

from pydantic import BaseModel

from reserving_engine.resultset import _MODEL_CONFIG


class TranscriptMessage(BaseModel):
    """One message, projected from an Agno ``Message`` via ``to_dict()``."""

    model_config = _MODEL_CONFIG

    role: str
    content: str | None = None
    tool_name: str | None = None
    tool_args: dict[str, Any] | None = None
    tool_call_id: str | None = None
    tool_calls: tuple[dict[str, Any], ...] | None = None


class ToolCallRecord(BaseModel):
    """A flattened call→result pair: which tool the model invoked, with
    what arguments, and the value the read-only tool returned."""

    model_config = _MODEL_CONFIG

    tool_call_id: str | None = None
    tool_name: str
    tool_args: dict[str, Any] | None = None
    result: str | None = None


class Transcript(BaseModel):
    """The complete, ordered record of one interpretation session."""

    model_config = _MODEL_CONFIG

    messages: tuple[TranscriptMessage, ...]
    tool_calls: tuple[ToolCallRecord, ...]


def _as_str(content: Any) -> str | None:
    if content is None or isinstance(content, str):
        return content
    return json.dumps(content, default=str)


def _as_args(arguments: Any) -> dict[str, Any] | None:
    if arguments is None:
        return None
    if isinstance(arguments, dict):
        return arguments
    if isinstance(arguments, str):
        try:
            parsed = json.loads(arguments)
        except (json.JSONDecodeError, ValueError):
            return {"raw": arguments}
        return parsed if isinstance(parsed, dict) else {"value": parsed}
    return {"value": arguments}


def _to_message(raw: dict[str, Any]) -> TranscriptMessage:
    tool_calls = raw.get("tool_calls")
    return TranscriptMessage(
        role=raw.get("role", ""),
        content=_as_str(raw.get("content")),
        tool_name=raw.get("tool_name"),
        tool_args=_as_args(raw.get("tool_args")),
        tool_call_id=raw.get("tool_call_id"),
        tool_calls=tuple(tool_calls) if tool_calls else None,
    )


def build_transcript(messages: list, tool_executions: list | None = None) -> Transcript:
    """Assemble a :class:`Transcript` from Agno ``RunOutput.messages``.

    Pure: depends only on ``messages`` (each exposing ``to_dict()``). The
    flattened ``tool_calls`` pair every assistant tool-call with the
    ``tool``-role result message carrying the same ``tool_call_id``.
    ``tool_executions`` is accepted for forward-compatibility and unused.
    """
    raw_messages = [m.to_dict() for m in messages]

    results_by_call: dict[str, str | None] = {}
    for raw in raw_messages:
        if raw.get("role") == "tool" and raw.get("tool_call_id"):
            results_by_call[raw["tool_call_id"]] = _as_str(raw.get("content"))

    records: list[ToolCallRecord] = []
    for raw in raw_messages:
        for call in raw.get("tool_calls") or ():
            function = call.get("function", {}) if isinstance(call, dict) else {}
            call_id = call.get("id") if isinstance(call, dict) else None
            records.append(
                ToolCallRecord(
                    tool_call_id=call_id,
                    tool_name=function.get("name", ""),
                    tool_args=_as_args(function.get("arguments")),
                    result=results_by_call.get(call_id),
                )
            )

    return Transcript(
        messages=tuple(_to_message(raw) for raw in raw_messages),
        tool_calls=tuple(records),
    )
