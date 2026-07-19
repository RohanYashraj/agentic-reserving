"""Agent-side report draft: parse model + prompt + parser (Story 5.4).

The interpretation agent emits a **structured draft** — raw, placeholder-
bearing prose — that engine_service then gates (Story 5.2) and structurally
validates (``reserving_engine.validate_reserve_report``). This module owns
the three PURE agent-side pieces (the exact structural twin of
``copilot_agent/recommendations.py``, Story 5.3):

* ``ReserveReportDraft`` — the internal parse model. NOT schema-exported: it
  never reaches Convex (only the accepted, gated ``ReserveReport`` document
  does). Each of the four sections is RAW text carrying ``{{rs:...}}`` (and
  ``{{dx:...}}``) placeholders — the pre-gate form (mirror
  ``RecommendationDraft``). All four fields required (a missing section →
  ``DraftParseError`` → re-promptable in the loop).
* ``build_report_prompt`` — the provider-neutral instructions (plain English
  + JSON, no Gemini-specific tokens; AD-8) that teach the model the four
  sections, the read-only tools, and the AD-1 placeholder grammar. It takes
  the accepted ``Recommendations`` (AC-1) but feeds the model only the
  per-Origin-Period method choices — NEVER the recommendations' rendered
  reason ``text`` (those carry literal figures; echoing them would tempt the
  model to copy a literal and fail the gate; see the story Dev Notes
  §Feeding recommendations without literals).
* ``parse_report_draft`` — robustly extract the draft JSON from the model's
  final text (fenced / prose-wrapped → the shared ``_extract_json_object``).
  A parse failure is the typed, re-promptable ``DraftParseError``.

Layer position (AD-2): ``copilot_agent`` imports only ``reserving_engine`` +
stdlib, never ``engine_service`` (the gate composition is upward, in the
shell). It MAY import the ``Recommendations`` type from ``reserving_engine``
(downward). Pure — no I/O, unit-testable with a canned string.
"""

import json
from typing import Any

from pydantic import BaseModel, ValidationError

from copilot_agent._draft_json import DraftParseError, _extract_json_object
from reserving_engine import DiagnosticsBundle, Recommendations, ResultSet
from reserving_engine.resultset import _MODEL_CONFIG

__all__ = [
    "ReserveReportDraft",
    "build_report_prompt",
    "parse_report_draft",
]

# The five rs fields the Provenance Gate can render, in the exact camelCase the
# gate's ``_RS_FIELD_ATTRS`` keys on. Re-declared identically to
# ``copilot_agent.recommendations._RS_FIELDS`` (not imported — the prompt teaches
# these names, and engine_service is upward).
_RS_FIELDS = ("ultimate", "ibnr", "mackStdErr", "reserveLow", "reserveHigh")

# The four report sections, as (snake_case field, human purpose) — a fixed order
# the prompt renders and the draft model mirrors.
_SECTIONS = (
    (
        "executive_summary",
        "the overall reserve position for the Run",
    ),
    (
        "method_selection_rationale",
        "why each Origin Period's Method was chosen",
    ),
    (
        "movement_commentary",
        "changes and notable Origin Periods",
    ),
    (
        "limitations",
        "caveats and sources of uncertainty",
    ),
)


class ReserveReportDraft(BaseModel):
    """The agent's structured draft: the four sections, pre-gate.

    Each field is RAW prose that may carry ``{{dx:...}}`` / ``{{rs:...}}``
    placeholders. All four required — a missing section surfaces as a
    ``DraftParseError`` the bounded loop re-prompts.
    """

    model_config = _MODEL_CONFIG

    executive_summary: str
    method_selection_rationale: str
    movement_commentary: str
    limitations: str


def _origin_method_lines(recommendations: Recommendations) -> list[str]:
    """The accepted per-Origin-Period Method choice, as ``origin → method``
    lines — the ONLY thing from the recommendations the prompt feeds the model
    (never the rendered reason ``text``, which carries literal figures)."""
    return [
        f"  - {rec.origin} -> {rec.method}"
        for rec in recommendations.recommendations
    ]


def build_report_prompt(
    result_set: ResultSet,
    diagnostics_bundle: DiagnosticsBundle,
    recommendations: Recommendations,
) -> str:
    """Provider-neutral instructions teaching the Reserve Report contract (AD-8).

    Plain English + a JSON output shape — no provider-specific tokens. Teaches
    the four sections, the read-only tools the model must call to ground its
    claims, the AD-1 placeholder grammar (figures are never literals), and the
    accepted per-Origin-Period Method choices it must be consistent with. It
    does NOT echo the recommendations' rendered reason text (see the story Dev
    Notes §Feeding recommendations without literals).
    """
    run_id = diagnostics_bundle.run_id
    executed_methods = [m.method for m in result_set.method_results]
    methods_list = " | ".join(executed_methods)
    rs_fields = " | ".join(_RS_FIELDS)
    section_names = ", ".join(name for name, _ in _SECTIONS)

    return "\n".join(
        [
            "You are a reserving analyst assistant. Draft a Reserve Report with "
            "EXACTLY these four sections, in this order, each as prose:",
            *[f"  - {name}: {purpose}." for name, purpose in _SECTIONS],
            "",
            f"This Run's id is {run_id!r}.",
            f"This Run executed these Methods: {methods_list}.",
            "",
            "You have already been given the accepted Method choice for each "
            "Origin Period. Your report MUST be consistent with these choices "
            "(the method_selection_rationale section explains them):",
            *_origin_method_lines(recommendations),
            "",
            "Ground every claim in evidence. You inspect the Run ONLY through "
            "these four read-only tools — call them, do not guess:",
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
            "Any section that states a quantity must write it as an {{rs:...}} "
            "placeholder AND carry at least one {{dx:...}} citation in the same "
            "paragraph, or it will be rejected. A purely-qualitative caveat with "
            "no figure needs no citation.",
            "",
            "Output ONLY a JSON object of this exact shape, with no prose before "
            f"or after it, one string per section ({section_names}):",
            "{",
            '  "executiveSummary": "<prose with {{rs:...}} figures and {{dx:...}} citations>",',
            '  "methodSelectionRationale": "<prose>",',
            '  "movementCommentary": "<prose>",',
            '  "limitations": "<prose>"',
            "}",
        ]
    )


def parse_report_draft(output_text: str) -> ReserveReportDraft:
    """Parse the model's final text into a ``ReserveReportDraft``.

    Robust to code fences and leading/trailing prose (via the shared
    ``_extract_json_object``). Any failure — no JSON, invalid JSON, or a JSON
    value of the wrong shape (e.g. a missing section) — is raised as the typed
    ``DraftParseError`` the bounded loop catches and re-prompts. Pure: no
    model, unit-testable with a canned string.
    """
    candidate = _extract_json_object(output_text)
    try:
        parsed: Any = json.loads(candidate)
    except (json.JSONDecodeError, ValueError) as exc:
        raise DraftParseError(f"model output is not valid JSON: {exc}") from exc
    try:
        return ReserveReportDraft.model_validate(parsed)
    except ValidationError as exc:
        raise DraftParseError(
            f"model output did not match the reserve report draft shape: {exc}"
        ) from exc
