"""Shared JSON-extraction helper for the agent-side draft parsers.

Both ``copilot_agent.recommendations`` (Story 5.3) and
``copilot_agent.reserve_report`` (Story 5.4) parse a structured draft out of
the model's final text, which may be fenced (```json … ```) or wrapped in
leading/trailing prose. ``_extract_json_object`` is the single, shared
extraction primitive so the two parsers cannot drift. Pure — no I/O, no
model — unit-testable with a canned string.

``DraftParseError`` is the ONE typed, re-promptable parse failure both
parsers raise (the bounded redraft loop records it as a ``draft_unparseable``
rejection and tries again) — never an uncaught exception escaping the loop.
"""


class DraftParseError(ValueError):
    """The model's final text could not be parsed into a structured draft.

    A typed, re-promptable condition shared by both draft parsers — never an
    uncaught exception escaping the bounded redraft loop.
    """


def _extract_json_object(text: str) -> str:
    """Return the JSON-object substring of ``text``: strip code fences and any
    leading/trailing prose. The first ``{`` to the matching last ``}``."""
    stripped = text.strip()
    if not stripped:
        raise DraftParseError("model produced empty output")
    # Strip a fenced block (```json ... ``` or ``` ... ```) if present.
    if stripped.startswith("```"):
        inner = stripped[3:]
        if inner[:4].lower() == "json":
            inner = inner[4:]
        fence_end = inner.rfind("```")
        if fence_end != -1:
            inner = inner[:fence_end]
        stripped = inner.strip()
    start = stripped.find("{")
    end = stripped.rfind("}")
    if start == -1 or end == -1 or end < start:
        raise DraftParseError("no JSON object found in model output")
    return stripped[start : end + 1]
