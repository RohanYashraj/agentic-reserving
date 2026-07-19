"""Agent-side recommendation draft: parse model + prompt + parser (Story 5.3).

The interpretation agent emits a **structured draft** — raw, placeholder-
bearing text — that engine_service then gates (Story 5.2) and structurally
validates (``reserving_engine.validate_recommendations``). This module owns
the three PURE agent-side pieces:

* ``RecommendationDraft`` / ``MethodRecommendationDraft`` — the internal
  parse model. NOT schema-exported: it never reaches Convex (only the
  accepted, gated ``Recommendations`` document does). ``method`` is a plain
  ``str`` (not the Method literal) and each reason is RAW text carrying
  ``{{dx:...}}`` (and optionally ``{{rs:...}}``) placeholders — the pre-gate
  form. A bad method surfaces later as a typed ``unrun_method`` rejection the
  bounded loop re-prompts, never a hard parse error.
* ``build_recommendation_prompt`` — the provider-neutral instructions
  (plain English + JSON, no Gemini-specific tokens; AD-8) that teach the
  model its job, the read-only tools, and the AD-1 placeholder grammar.
* ``parse_recommendation_draft`` — robustly extract the draft JSON from the
  model's final text. A parse failure is a typed, re-promptable
  ``DraftParseError`` (caught by the loop), never an uncaught exception.

Layer position (AD-2): ``copilot_agent`` imports only ``reserving_engine`` +
stdlib, never ``engine_service`` (the gate composition is upward, in the
shell). Pure — no I/O, unit-testable with a canned string.
"""

import json
from typing import Any

from pydantic import BaseModel, ValidationError

from copilot_agent._draft_json import DraftParseError, _extract_json_object
from reserving_engine import DiagnosticsBundle, ResultSet
from reserving_engine.resultset import _MODEL_CONFIG

__all__ = [
    "DraftParseError",
    "MethodRecommendationDraft",
    "RecommendationDraft",
    "build_recommendation_prompt",
    "parse_recommendation_draft",
]

# The five rs fields the Provenance Gate can render, in the exact camelCase the
# gate's ``_RS_FIELD_ATTRS`` keys on. Kept as a literal list (not imported from
# engine_service, which is upward) — the prompt teaches these names.
_RS_FIELDS = ("ultimate", "ibnr", "mackStdErr", "reserveLow", "reserveHigh")


class MethodRecommendationDraft(BaseModel):
    """One origin's draft recommendation, pre-gate.

    ``method`` is a plain ``str`` (validated structurally in Task 1, not by
    the parser). ``reasons`` are RAW strings that may carry ``{{dx:...}}`` /
    ``{{rs:...}}`` placeholders.
    """

    model_config = _MODEL_CONFIG

    origin: str
    method: str
    reasons: tuple[str, ...]


class RecommendationDraft(BaseModel):
    """The agent's structured draft: one entry per Origin Period."""

    model_config = _MODEL_CONFIG

    recommendations: tuple[MethodRecommendationDraft, ...]


def build_recommendation_prompt(
    result_set: ResultSet, diagnostics_bundle: DiagnosticsBundle
) -> str:
    """Provider-neutral instructions teaching the recommendation contract (AD-8).

    Plain English + a JSON output shape — no provider-specific tokens. The
    prompt names the four read-only tools the model must call to ground its
    reasons, the AD-1 placeholder grammar (figures are never literals), and
    the FR-10 contract (exactly one Method per Origin Period, ≥1 cited
    reason). It offers ONLY the methods this Run actually executed.
    """
    run_id = diagnostics_bundle.run_id
    executed_methods = [m.method for m in result_set.method_results]
    origins = [o.origin for o in result_set.method_results[0].origin_results]
    methods_list = " | ".join(executed_methods)
    rs_fields = " | ".join(_RS_FIELDS)

    return "\n".join(
        [
            "You are a reserving analyst assistant. For every Origin Period in "
            "this Run you recommend EXACTLY ONE reserving Method, with at least "
            "one reason, and every reason must cite at least one Diagnostic ID.",
            "",
            f"This Run's id is {run_id!r}.",
            f"This Run executed these Methods (choose ONLY from these): {methods_list}.",
            f"The Origin Periods you MUST each cover exactly once: {', '.join(origins)}.",
            "",
            "Ground every recommendation in evidence. You inspect the Run ONLY "
            "through these four read-only tools — call them, do not guess:",
            "  - list_diagnostics(): every Diagnostic in this Run as {id, kind, coordinates}.",
            "  - get_diagnostic(diagnostic_id): one Diagnostic's full values by its dx: id.",
            "  - get_result_fields(method, origin=None): a Method's stored figures.",
            "  - get_run_metadata(): this Run's Lineage, schema versions, and Method list.",
            "",
            "THE CONSTITUTION — you NEVER write a literal number. Every figure is "
            "written as a placeholder the system renders from the engine output:",
            f"  - A figure: {{{{rs:{run_id}:<method>:<origin>:<field>}}}} where <field> is "
            f"one of {rs_fields} and <method> is one of the executed methods above.",
            "  - A citation: {{dx:<diagnosticId>}} where <diagnosticId> is the FULL "
            "id exactly as it appears in list_diagnostics / get_diagnostic (it "
            "already starts with 'dx:' — do NOT add a second 'dx:' prefix).",
            "A reason that states a quantity must both write it as an {{rs:...}} "
            "placeholder AND carry at least one {{dx:...}} citation, or it will be "
            "rejected.",
            "",
            "Output ONLY a JSON object of this exact shape, with no prose before "
            "or after it, one entry per Origin Period:",
            "{",
            '  "recommendations": [',
            '    {"origin": "<origin>", "method": "<method>", '
            '"reasons": ["<reason text with {{dx:...}} citations>", ...]}',
            "  ]",
            "}",
        ]
    )


def parse_recommendation_draft(output_text: str) -> RecommendationDraft:
    """Parse the model's final text into a ``RecommendationDraft``.

    Robust to code fences and leading/trailing prose. Any failure — no JSON,
    invalid JSON, or a JSON value of the wrong shape — is raised as a typed
    ``DraftParseError`` the bounded loop catches and re-prompts. Pure: no
    model, unit-testable with a canned string.
    """
    candidate = _extract_json_object(output_text)
    try:
        parsed: Any = json.loads(candidate)
    except (json.JSONDecodeError, ValueError) as exc:
        raise DraftParseError(f"model output is not valid JSON: {exc}") from exc
    try:
        return RecommendationDraft.model_validate(parsed)
    except ValidationError as exc:
        raise DraftParseError(
            f"model output did not match the recommendation draft shape: {exc}"
        ) from exc
