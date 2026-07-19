"""The Provenance Gate: placeholder rendering + numeric-token checker (AD-5).

The gate is the programmatic guard over machine-drafted content: the LLM
never emits figures, only placeholders (AD-1), and this gate is what makes
that structural. It runs in two phases — **template injection first,
numeric checker second** (AD-5):

1. Render ``{{rs:<runId>:<method>:<origin>:<field>}}`` figure placeholders
   from the ResultSet and ``{{dx:<diagnosticId>}}`` citation placeholders
   from the DiagnosticsBundle. Any unresolvable / cross-run / malformed
   placeholder fails the gate.
2. Over the rendered output, verify every numeric token matches an engine
   source value under the documented canonicalization rule (whitelisting
   structural numerals — headings, dates, origin-year labels), and that
   every quantitative claim (a paragraph block asserting a figure) cites
   ≥1 resolvable Diagnostic ID.

**AD-5 canonicalization rule** (the single comparison key both the
renderer and the numeric checker use): parse → ``Decimal`` → quantize
round-half-to-even to 2 decimal places → normalized plain-decimal string,
no grouping separators, ``-0 → 0``, trailing ``.00``/``.x0`` stripped —
so ``18834.0 → "18834"``, ``1.0234 → "1.02"``, ``-12.5 → "-12.5"``. A
draft number is "sourced" iff its canonical form is a member of
``engine_source_values(result_set, bundle)``. A fabricated number that
*coincidentally* canonicalizes to a real engine value passes — that is a
deliberate, bounded AD-5 residual (a number equal to an engine value is
sourced-equivalent/verifiable), not a hole.

**Purity (AD-2/AD-3):** this module performs no I/O, HTTP, Convex, Clerk,
filesystem, clock, logging, or randomness — it is the imperative shell's
pure gate helper, directly unit-testable and safe inside stateless
request handling. It imports only ``reserving_engine`` (downward) + the
stdlib. A rejected draft yields NO ``rendered_content`` — a failing draft
is never handed onward as reviewable. The gate does not persist or
audit-log; it returns a typed ``GateRejected``/``GateAccepted`` and the
caller (a Convex action via a later story's endpoint) audit-logs the
rejection and drives the bounded redraft loop.

Diagnostic IDs are resolved by ``resolve_diagnostic`` (dict lookup over
the bundle), never by splitting the opaque ``dx:`` string.
"""

import re
from collections.abc import Sequence
from decimal import ROUND_HALF_EVEN, Decimal, InvalidOperation
from typing import Literal

from pydantic import BaseModel

from reserving_engine import (
    DiagnosticsBundle,
    ResultSet,
    UnknownDiagnosticIdError,
    resolve_diagnostic,
)
from reserving_engine.resultset import _MODEL_CONFIG

# The 2-decimal-place quantum is the documented canonicalization tolerance
# (module docstring). The renderer's display precision and the checker's
# comparison precision are the SAME constant, by construction.
_QUANTUM = Decimal("0.01")

# Fields readable through an ``{{rs:...}}`` placeholder — the camelCase
# ``OriginResult`` wire names (AD-10). Snake_case attrs on the Python model.
_RS_FIELD_ATTRS = {
    "ultimate": "ultimate",
    "ibnr": "ibnr",
    "mackStdErr": "mack_std_err",
    "reserveLow": "reserve_low",
    "reserveHigh": "reserve_high",
}

_PLACEHOLDER_RE = re.compile(r"\{\{(.*?)\}\}")

# A numeric token: a grouped form (≥1 thousands separator) tried first so a
# full "5,339,085" is one token, else a plain number. Optional sign / decimal
# / trailing percent.
_NUMBER_RE = re.compile(r"-?\d{1,3}(?:,\d{3})+(?:\.\d+)?%?|-?\d+(?:\.\d+)?%?")

# Structural numerals exempt from the source-value check (AD-5 whitelist).
# Applied as a pre-mask before the numeric scan so ISO dates, four-digit
# years / Origin-Period labels, and heading/list ordinals never reach it.
_STRUCTURAL_WHITELIST = (
    re.compile(r"\b\d{4}-\d{2}-\d{2}\b"),  # ISO-8601 date
    re.compile(r"\b(?:19|20)\d{2}\b"),  # four-digit year / origin-year label
    # heading / list ordinal at a line start: "2.", "2.4", "## 3." — requires
    # trailing punctuation or sub-numbering so a leading figure is NOT exempted
    re.compile(r"(?m)^[#>\s*+-]*(?:\d+(?:\.\d+)+|\d+[.)])(?=\s|$)"),
)


class CitationRef(BaseModel):
    """One resolved ``{{dx:...}}`` reference — what Story 5.5 renders as a
    ``CitationChip``."""

    model_config = _MODEL_CONFIG

    diagnostic_id: str


class GateRejection(BaseModel):
    """One typed rejection reason — everything the redraft loop and the
    audit entry need to explain and retry a failed draft."""

    model_config = _MODEL_CONFIG

    code: Literal[
        "malformed_placeholder",
        "cross_run_placeholder",
        "unresolvable_rs_placeholder",
        "unresolvable_dx_citation",
        "unsourced_number",
        "uncited_claim",
    ]
    message: str
    token: str | None = None
    details: dict | None = None


class GateAccepted(BaseModel):
    """A draft that passed the gate: the rendered content is safe to persist
    as reviewable, with the resolved citations for chip rendering."""

    model_config = _MODEL_CONFIG

    accepted: Literal[True] = True
    rendered_content: str
    citations: tuple[CitationRef, ...]


class GateRejected(BaseModel):
    """A draft that failed the gate. It carries ONLY the typed reasons —
    never ``rendered_content`` — so a failing draft is structurally
    incapable of being handed onward as reviewable (AD-5)."""

    model_config = _MODEL_CONFIG

    accepted: Literal[False] = False
    reasons: tuple[GateRejection, ...]


def canonicalize_number(value: float | int | str | Decimal) -> str:
    """Return the AD-5 canonical comparison key for a number.

    Round half-to-even to 2 dp, no grouping separators, normalized sign,
    trailing zeros stripped: ``18834.0 → "18834"``, ``1.0234 → "1.02"``,
    ``-0.0 → "0"``.
    """
    dec = value if isinstance(value, Decimal) else Decimal(str(value))
    quantized = dec.quantize(_QUANTUM, rounding=ROUND_HALF_EVEN)
    if quantized == 0:  # collapse -0.00 → 0
        quantized = Decimal("0")
    text = format(quantized, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"


def format_figure(value: float | int) -> str:
    """Display-format an engine figure: thousands separators at the
    canonicalization precision (``18834.0 → "18,834"``). A display concern,
    not computation — the checker strips separators before canonicalizing,
    so the displayed and the canonical forms reconcile by construction."""
    canonical = canonicalize_number(value)
    negative = canonical.startswith("-")
    digits = canonical[1:] if negative else canonical
    int_part, _, frac_part = digits.partition(".")
    grouped = f"{int(int_part):,}"
    out = f"{grouped}.{frac_part}" if frac_part else grouped
    return f"-{out}" if negative else out


def _collect_numeric_leaves(value, out: list[str]) -> None:
    if isinstance(value, bool):  # bool is an int subclass — never a figure
        return
    if isinstance(value, (int, float)):
        out.append(canonicalize_number(value))
    elif isinstance(value, dict):
        for item in value.values():
            _collect_numeric_leaves(item, out)
    elif isinstance(value, (list, tuple)):
        for item in value:
            _collect_numeric_leaves(item, out)
    # str / None are not source figures — skipped (labels, ids, versions)


def engine_source_values(
    result_set: ResultSet, diagnostics_bundle: DiagnosticsBundle
) -> frozenset[str]:
    """The canonical forms of EVERY numeric leaf of the ResultSet and the
    DiagnosticsBundle — the set a draft number must belong to (or be
    whitelisted) to pass. A structural walk of the frozen models (not a
    hardcoded field list), so a future engine field is covered
    automatically. Collects and canonicalizes existing engine numbers only
    — it derives no new figure (AD-1)."""
    leaves: list[str] = []
    _collect_numeric_leaves(result_set.model_dump(mode="json", by_alias=True), leaves)
    _collect_numeric_leaves(
        diagnostics_bundle.model_dump(mode="json", by_alias=True), leaves
    )
    return frozenset(leaves)


def _resolve_rs(inner: str, result_set: ResultSet, run_id: str) -> tuple[str | None, GateRejection | None]:
    """Resolve an ``rs:`` placeholder's inner text to a display figure, or a
    typed rejection. ``inner`` is the full ``rs:<runId>:<method>:<origin>:<field>``."""
    token = "{{" + inner + "}}"
    parts = inner[len("rs:") :].split(":")
    if len(parts) != 4:
        return None, GateRejection(
            code="malformed_placeholder",
            message=f"rs placeholder needs exactly runId:method:origin:field — got {len(parts)} parts",
            token=token,
        )
    placeholder_run_id, method, origin, field = parts
    if placeholder_run_id != run_id:
        return None, GateRejection(
            code="cross_run_placeholder",
            message=f"placeholder runId {placeholder_run_id!r} does not match this Run {run_id!r}",
            token=token,
        )
    attr = _RS_FIELD_ATTRS.get(field)
    if attr is None:
        return None, GateRejection(
            code="unresolvable_rs_placeholder",
            message=f"unknown field {field!r}",
            token=token,
            details={"reason": "unknown_field"},
        )
    method_result = next(
        (m for m in result_set.method_results if m.method == method), None
    )
    if method_result is None:
        return None, GateRejection(
            code="unresolvable_rs_placeholder",
            message=f"unknown method {method!r}",
            token=token,
            details={"reason": "unknown_method"},
        )
    origin_result = next(
        (o for o in method_result.origin_results if o.origin == origin), None
    )
    if origin_result is None:
        return None, GateRejection(
            code="unresolvable_rs_placeholder",
            message=f"unknown origin {origin!r} for method {method!r}",
            token=token,
            details={"reason": "unknown_origin"},
        )
    figure = getattr(origin_result, attr)
    if figure is None:
        return None, GateRejection(
            code="unresolvable_rs_placeholder",
            message=f"field {field!r} is not applicable for method {method!r} origin {origin!r}",
            token=token,
            details={"reason": "none_field"},
        )
    return format_figure(figure), None


def _resolve_dx(inner: str, diagnostics_bundle: DiagnosticsBundle) -> tuple[str | None, GateRejection | None, str | None]:
    """Resolve a ``dx:`` placeholder's inner text (the full Diagnostic ID) to
    a digit-masked citation marker, or a typed rejection. Returns
    ``(marker, rejection, diagnostic_id)``."""
    token = "{{" + inner + "}}"
    try:
        resolve_diagnostic(diagnostics_bundle, inner)
    except UnknownDiagnosticIdError:
        return None, GateRejection(
            code="unresolvable_dx_citation",
            message=f"no Diagnostic with id {inner!r} in this Run",
            token=token,
            details={"diagnosticId": inner},
        ), None
    # The marker carries the id for 5.5's CitationChip; its own id digits are
    # excluded from the numeric scan by masking this span (see run_provenance_gate).
    return f"[[cite:{inner}]]", None, inner


def _render(
    draft: str, result_set: ResultSet, diagnostics_bundle: DiagnosticsBundle
):
    """Phase 1 (AD-5): render placeholders, accumulating ALL placeholder
    rejections. Returns ``(rendered, citations, citation_spans, rejections)``
    where spans index into ``rendered``."""
    run_id = diagnostics_bundle.run_id
    pieces: list[str] = []
    citations: list[CitationRef] = []
    citation_spans: list[tuple[int, int]] = []
    rejections: list[GateRejection] = []
    pos = 0
    cursor = 0

    for match in _PLACEHOLDER_RE.finditer(draft):
        literal = draft[pos : match.start()]
        pieces.append(literal)
        cursor += len(literal)
        pos = match.end()

        inner = match.group(1)
        if inner.startswith("rs:"):
            rendered, rejection = _resolve_rs(inner, result_set, run_id)
            if rejection is not None:
                rejections.append(rejection)
                continue
            pieces.append(rendered)
            cursor += len(rendered)
        elif inner.startswith("dx:"):
            marker, rejection, diagnostic_id = _resolve_dx(inner, diagnostics_bundle)
            if rejection is not None:
                rejections.append(rejection)
                continue
            citations.append(CitationRef(diagnostic_id=diagnostic_id))
            citation_spans.append((cursor, cursor + len(marker)))
            pieces.append(marker)
            cursor += len(marker)
        else:
            rejections.append(
                GateRejection(
                    code="malformed_placeholder",
                    message="placeholder is neither an rs figure nor a dx citation",
                    token=match.group(0),
                )
            )

    pieces.append(draft[pos:])
    rendered = "".join(pieces)
    return rendered, tuple(citations), citation_spans, rejections


def _blank(text: str, start: int, end: int) -> str:
    """Replace ``text[start:end]`` with spaces (preserving length so later
    spans still line up)."""
    return text[:start] + (" " * (end - start)) + text[end:]


def _mask_regions(text: str, spans: Sequence[tuple[int, int]]) -> str:
    for start, end in spans:
        text = _blank(text, start, end)
    return text


def _mask_whitelist(text: str, whitelist: Sequence[re.Pattern]) -> str:
    for pattern in whitelist:
        text = pattern.sub(lambda m: " " * (m.end() - m.start()), text)
    return text


def _block_bounds(text: str) -> list[tuple[int, int]]:
    """Paragraph-block char spans (split on blank lines) — the 5.2 claim
    granularity."""
    bounds: list[tuple[int, int]] = []
    for match in re.finditer(r"\S.*?(?=\n\s*\n|\Z)", text, flags=re.DOTALL):
        bounds.append((match.start(), match.end()))
    return bounds


def run_provenance_gate(
    draft: str,
    result_set: ResultSet,
    diagnostics_bundle: DiagnosticsBundle,
    *,
    whitelist: Sequence[re.Pattern] | None = None,
) -> GateAccepted | GateRejected:
    """Run the AD-5 Provenance Gate over a machine draft.

    Template injection first, numeric checker second. Returns
    ``GateAccepted(rendered_content, citations)`` on a clean draft, or
    ``GateRejected(reasons)`` — which never carries rendered content — on
    any failure. Pure and deterministic; the caller audit-logs a rejection
    and drives the bounded redraft loop.
    """
    patterns = _STRUCTURAL_WHITELIST if whitelist is None else tuple(whitelist)

    # Phase 1: render placeholders. Any placeholder failure short-circuits —
    # a draft that cannot even be rendered is never numerically checked.
    rendered, citations, citation_spans, rejections = _render(
        draft, result_set, diagnostics_bundle
    )
    if rejections:
        return GateRejected(reasons=tuple(rejections))

    # Phase 2: numeric-token + claim-citation checks over the rendered output.
    source_values = engine_source_values(result_set, diagnostics_bundle)
    # Mask citation markers (their dx: ids carry digits) then structural
    # numerals, so only genuine claim figures reach the numeric scan.
    scan_text = _mask_whitelist(
        _mask_regions(rendered, citation_spans), patterns
    )

    reasons: list[GateRejection] = []
    claim_spans: list[tuple[int, int]] = []
    for match in _NUMBER_RE.finditer(scan_text):
        raw = match.group(0)
        claim_spans.append((match.start(), match.end()))
        cleaned = raw.rstrip("%").replace(",", "")
        try:
            canonical = canonicalize_number(cleaned)
        except (InvalidOperation, ValueError):
            canonical = raw
        if canonical not in source_values:
            reasons.append(
                GateRejection(
                    code="unsourced_number",
                    message=f"numeric token {raw!r} does not match any engine source value",
                    token=raw,
                    details={"canonical": canonical},
                )
            )

    # Claim-citation check: a paragraph block asserting a non-whitelisted
    # figure must contain ≥1 resolved citation.
    for start, end in _block_bounds(rendered):
        has_figure = any(start <= s < end for s, _ in claim_spans)
        if not has_figure:
            continue
        has_citation = any(start <= s < end for s, _ in citation_spans)
        if not has_citation:
            reasons.append(
                GateRejection(
                    code="uncited_claim",
                    message="quantitative claim cites no resolvable Diagnostic ID",
                    details={"blockExcerpt": rendered[start:end][:120]},
                )
            )

    if reasons:
        return GateRejected(reasons=tuple(reasons))
    return GateAccepted(rendered_content=rendered, citations=citations)


__all__ = [
    "CitationRef",
    "GateAccepted",
    "GateRejected",
    "GateRejection",
    "canonicalize_number",
    "engine_source_values",
    "format_figure",
    "run_provenance_gate",
]
