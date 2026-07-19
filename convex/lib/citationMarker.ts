/**
 * The citation-marker grammar (Story 6.1, AD-1/AD-5/AD-10) — the SINGLE source
 * of truth for the inline `[[cite:<dxId>]]` marker the Provenance Gate renders
 * into `section.text` (`engine/engine_service/provenance_gate.py` `_resolve_dx`
 * → `f"[[cite:{inner}]]"`, the inner text the full `dx:{runId}:{kind}:{key}`
 * id). This module is reused by BOTH the frontend tokenizer (the token-model
 * editor, D1) and the Convex `editReserveReport` re-derivation (D2) so the two
 * NEVER diverge. It lives under `convex/lib/` — the established house pattern
 * (`engineContract.ts`): the Convex bundler can only import modules under
 * `convex/`, and the frontend imports it via the `@/convex/lib/...` alias, so
 * one file serves both planes (no byte-identical duplication needed).
 *
 * Everything here is PURE STRING GRAMMAR — no arithmetic, no diagnostic
 * resolution, no gate. `citationsFromText` is the machine-readable "pin" the
 * edit mutation re-derives `citations[]` from server-side (never trusting the
 * client); `uncitedSentences` is the display derivation behind the editor's
 * "claim now uncited" flag (and 6.4's approval blocker). AD-1 clean.
 */

/** An ordered node of a section: editable text, or an atomic citation widget. */
export type SectionNode =
  | { kind: "text"; value: string }
  | { kind: "cite"; dxId: string };

/**
 * Matches a citation marker `[[cite:<dxId>]]` and captures the full dxId. The
 * id is treated as OPAQUE (`dx:[^\]]+`) — never parsed into its
 * `runId`/`kind`/`key` segments (AD-10; a residual id carries extra `:`
 * segments). Global so `matchAll` / `exec`-loops walk every marker in order.
 *
 * NOTE: this is a shared `lastIndex`-bearing global regex. Callers that use
 * `.exec()` in a loop MUST use a fresh instance (`new RegExp(CITE_MARKER_RE)`);
 * the helpers below all do. `String.prototype.matchAll`/`split`/`replace` do
 * not mutate `lastIndex`, so they use the shared instance safely.
 */
export const CITE_MARKER_RE = /\[\[cite:(dx:[^\]]+)\]\]/g;

/**
 * Split `text` into an ordered `SectionNode[]` of alternating text and cite
 * nodes (document order). Empty text runs (adjacent markers, or a marker at the
 * very start/end) are COLLAPSED — never emitted as empty text nodes — so
 * `serializeCitationNodes(parseCitationText(text)) === text` for any input and
 * the node array stays normalized.
 */
export function parseCitationText(text: string): SectionNode[] {
  const nodes: SectionNode[] = [];
  const re = new RegExp(CITE_MARKER_RE); // fresh lastIndex for this loop
  let pos = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > pos) {
      nodes.push({ kind: "text", value: text.slice(pos, match.index) });
    }
    nodes.push({ kind: "cite", dxId: match[1] });
    pos = match.index + match[0].length;
  }
  if (pos < text.length) {
    nodes.push({ kind: "text", value: text.slice(pos) });
  }
  return nodes;
}

/**
 * The inverse of `parseCitationText`: re-emit `[[cite:<dxId>]]` for cite nodes
 * and concatenate text nodes verbatim. This is what the editor serializes back
 * to the stored `section.text` on save.
 */
export function serializeCitationNodes(nodes: SectionNode[]): string {
  let out = "";
  for (const node of nodes) {
    out += node.kind === "cite" ? `[[cite:${node.dxId}]]` : node.value;
  }
  return out;
}

/**
 * The ordered list of dxIds from every marker in `text`, in document order
 * (duplicates preserved). This is exactly what `editReserveReport` re-derives
 * `citations[]` from server-side (D2) — deleting a chip drops its marker, so
 * its id automatically disappears from the derived list; `text`↔`citations`
 * stay consistent by construction.
 */
export function citationsFromText(text: string): string[] {
  const ids: string[] = [];
  for (const match of text.matchAll(CITE_MARKER_RE)) {
    ids.push(match[1]);
  }
  return ids;
}

/**
 * Structural marker integrity (D2): every `[[cite:` opener in `text` must begin
 * a WELL-FORMED `[[cite:dx:...]]` marker (a closed marker whose id starts with
 * `dx:`). This is the ONLY edit-time validation `editReserveReport` runs — it
 * keeps the stored text tokenizable, and is explicitly NOT the Provenance Gate
 * (AD-5: human edits are never re-gated; no numeric-provenance / claim-coupling
 * check here). An unterminated `[[cite:dx:foo`, a non-dx `[[cite:xyz]]`, or an
 * empty `[[cite:]]` is rejected; ordinary prose (no `[[cite:` opener) passes.
 */
export function markersAreWellFormed(text: string): boolean {
  const wellFormedStarts = new Set<number>();
  for (const m of text.matchAll(CITE_MARKER_RE)) {
    if (m.index !== undefined) wellFormedStarts.add(m.index);
  }
  for (const m of text.matchAll(/\[\[cite:/g)) {
    if (m.index !== undefined && !wellFormedStarts.has(m.index)) return false;
  }
  return true;
}

// --- "claim now uncited" derivation (D3) ----------------------------------

/**
 * An engine-figure numeric token, mirroring the gate's `_NUMBER_RE`
 * (`provenance_gate.py`): a grouped form (≥1 thousands separator) tried first so
 * a full `5,339,085` is one token, else a plain number; optional sign / decimal
 * / trailing percent. Kept in lockstep with the gate so the editor's notion of
 * "a figure" matches what the gate treated as a figure.
 */
const NUMBER_RE = /-?\d{1,3}(?:,\d{3})+(?:\.\d+)?%?|-?\d+(?:\.\d+)?%?/g;

/**
 * Structural numerals that are NOT figures (mirrors the gate's
 * `_STRUCTURAL_WHITELIST`, applied as a pre-mask before the numeric scan): ISO
 * dates, four-digit years / Origin-Period labels, and heading/list ordinals at
 * a line start. Kept LENIENT here on purpose (D3) — this is a soft display flag,
 * and over-flagging a year is worse UX than the gate's strictness.
 */
const STRUCTURAL_WHITELIST: RegExp[] = [
  /\b\d{4}-\d{2}-\d{2}\b/g, // ISO-8601 date
  /\b(?:19|20)\d{2}\b/g, // four-digit year / origin-year label
  // heading / list ordinal at a line start: "2.", "2.4", "## 3." — each numeric
  // segment bounded to 1–2 digits so a genuine figure at a line start is NOT
  // masked (matches the gate's Review-F3 bound).
  /^[#>\s*+-]*(?:\d{1,2}(?:\.\d{1,2})+|\d{1,2}[.)])(?=\s|$)/gm,
];

/** Replace every whitelist match with same-length spaces (a positional mask). */
function maskStructural(text: string): string {
  let masked = text;
  for (const re of STRUCTURAL_WHITELIST) {
    masked = masked.replace(re, (m) => " ".repeat(m.length));
  }
  return masked;
}

/** Replace every citation marker with same-length spaces (its id has digits). */
function maskMarkers(text: string): string {
  return text.replace(CITE_MARKER_RE, (m) => " ".repeat(m.length));
}

/**
 * Split `text` into sentences, returning each with its `[start, end)` char span
 * (leading/trailing whitespace trimmed off the span). A pragmatic splitter: a
 * run of `.`/`!`/`?` followed by whitespace or end-of-string ends a sentence.
 * `[[cite:...]]` markers never contain those terminators, so a chip is never
 * split. This is an approximation (abbreviations like "e.g." split early) —
 * acceptable for a soft display flag.
 */
function splitSentences(
  text: string,
): { sentence: string; start: number; end: number }[] {
  const out: { sentence: string; start: number; end: number }[] = [];
  const re = /[.!?]+(?=\s|$)/g;
  let start = 0;
  let match: RegExpExecArray | null;
  const push = (from: number, to: number) => {
    let s = from;
    let e = to;
    while (s < e && /\s/.test(text[s])) s++;
    while (e > s && /\s/.test(text[e - 1])) e--;
    if (e > s) out.push({ sentence: text.slice(s, e), start: s, end: e });
  };
  while ((match = re.exec(text)) !== null) {
    const end = match.index + match[0].length;
    push(start, end);
    start = end;
  }
  if (start < text.length) push(start, text.length);
  return out;
}

/**
 * The sentences that STATE A FIGURE but carry NO `[[cite:...]]` marker — the
 * "claim now uncited" flag (D3, UX-DR12). Sentence granularity (finer than the
 * gate's paragraph-block model — documented divergence). Deleting a chip removes
 * its marker, so a sentence that had a cited figure becomes flagged
 * automatically; re-citing or deleting the sentence clears it naturally. Pure
 * string/metadata over the already-loaded text (AD-1 clean) — no stored boolean,
 * no server round-trip. Backs BOTH the editor's inline flag and 6.4's approval
 * blocker (one source of truth).
 */
export function uncitedSentences(
  text: string,
): { sentence: string; start: number; end: number }[] {
  return splitSentences(text).filter(({ sentence }) => {
    // A sentence with any marker is treated as cited (not flagged).
    if (new RegExp(CITE_MARKER_RE).test(sentence)) return false;
    // Otherwise mask structural numerals, then look for a real figure token.
    const masked = maskStructural(maskMarkers(sentence));
    return new RegExp(NUMBER_RE).test(masked);
  });
}
