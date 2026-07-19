"use client";

import { useCallback } from "react";

import { CitationChip } from "@/components/interpretation/CitationChip";
import {
  parseCitationText,
  serializeCitationNodes,
  uncitedSentences,
  type SectionNode,
} from "@/convex/lib/citationMarker";
import type { DiagnosticsBundle } from "@/convex/lib/engineContract";
import { cn } from "@/lib/utils";

// Story 6.1 (AC-1, UX-DR12, D1/D8): the token-model section editor. Each section
// is an ordered list of nodes — editable TEXT runs and atomic CITE widgets —
// parsed from the stored `section.text` on the inline `[[cite:<dxId>]]` markers
// the Provenance Gate rendered. "Editable around, never inside" is true BY
// CONSTRUCTION: a chip is a React widget (the 5.5 `CitationChip`), not editable
// text — there is no caret position inside it. Deleting a chip is the adjacent
// `×` control (a real <button> OUTSIDE the chip — atomicity). On any text edit
// or chip removal the node array is rebuilt and `serializeCitationNodes` emits
// the next `text` (with markers) back to the tab via `onChange` (controlled —
// state is lifted to `ReportTab`, save is explicit). Citations are re-derived
// server-side from the markers on save (D2) — the client never sends the pin.
//
// This is the segmented token-model editor (D1, resolved with Rohan) — NOT
// `contentEditable`, NOT a raw-marker textarea. Zero new deps, jsdom-testable,
// React-native. Provenance violet stays exclusive to chips (DESIGN.md:89); the
// `×` and the "claim now uncited" flag use the caution family.

export function ReportSectionEditor({
  label,
  text,
  diagnosticsBundle,
  editable,
  onChange,
}: {
  /** Human-readable section heading (e.g. "Executive summary"). */
  label: string;
  /** The stored section text, containing inline `[[cite:<dxId>]]` markers. */
  text: string;
  /** For chip resolution / preview; null on the manual / Engine-Only path. */
  diagnosticsBundle: DiagnosticsBundle | null;
  /** True while the report is an editable draft. */
  editable: boolean;
  /** Emits the next serialized section text (with markers). */
  onChange: (nextText: string) => void;
}) {
  const nodes = parseCitationText(text);
  // An empty section parses to no nodes — show one empty text run so the Analyst
  // has a surface to type into (manual template shell, D7).
  const displayNodes: SectionNode[] =
    nodes.length > 0 ? nodes : [{ kind: "text", value: "" }];

  const emit = useCallback(
    (next: SectionNode[]) => onChange(serializeCitationNodes(next)),
    [onChange],
  );

  const updateTextAt = (index: number, value: string) =>
    emit(
      displayNodes.map((n, i) =>
        i === index && n.kind === "text" ? { kind: "text", value } : n,
      ),
    );

  // Node-level delete (never a partial-id edit) — after removal
  // `citationsFromText` naturally omits the id and the sentence may flag uncited.
  const removeAt = (index: number) =>
    emit(displayNodes.filter((_, i) => i !== index));

  const flagged = uncitedSentences(text);

  return (
    <section
      aria-label={label}
      className="space-y-2 rounded-md border border-border p-4"
    >
      <h3 className="text-sm font-medium text-foreground">{label}</h3>

      <div className="flex flex-wrap items-center gap-1 text-sm">
        {displayNodes.map((node, i) =>
          node.kind === "text" ? (
            editable ? (
              <textarea
                key={i}
                aria-label={`${label} text`}
                value={node.value}
                onChange={(e) => updateTextAt(i, e.target.value)}
                rows={Math.min(12, Math.max(2, node.value.split("\n").length))}
                className="min-w-[16ch] flex-1 resize-y rounded border border-input bg-transparent px-2 py-1 text-sm leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            ) : (
              <span key={i} className="whitespace-pre-wrap leading-relaxed">
                {node.value}
              </span>
            )
          ) : (
            <span key={i} className="inline-flex items-center gap-0.5">
              {diagnosticsBundle ? (
                <CitationChip
                  dxId={node.dxId}
                  diagnosticsBundle={diagnosticsBundle}
                />
              ) : (
                // No bundle (manual / Engine-Only) — a manual report has no
                // chips, but if one is present it stays legible via the raw id.
                <span className="numeric inline-flex items-center rounded-full bg-provenance-subtle px-2 py-0.5 text-[11px] leading-none text-provenance">
                  {node.dxId}
                </span>
              )}
              {editable && (
                <button
                  type="button"
                  aria-label={`Remove citation ${node.dxId}`}
                  onClick={() => removeAt(i)}
                  className={cn(
                    "inline-flex h-4 w-4 items-center justify-center rounded-full text-xs leading-none",
                    "text-muted-foreground hover:bg-caution-subtle hover:text-caution",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-caution",
                  )}
                >
                  ×
                </button>
              )}
            </span>
          ),
        )}
      </div>

      {flagged.length > 0 && (
        <ul className="space-y-1" aria-label={`${label} uncited claims`}>
          {flagged.map((f, i) => (
            <li
              key={i}
              className="flex items-start gap-1.5 rounded bg-caution-subtle px-2 py-1 text-xs text-caution"
            >
              <span aria-hidden>⚠</span>
              <span>
                <span className="font-medium">Claim now uncited:</span>{" "}
                {f.sentence}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
