"use client";

import { useId, useMemo, useState } from "react";

import {
  buildDiagnosticIndex,
  diagnosticCoordinate,
  diagnosticPreview,
  KIND_LABEL,
  resolveDiagnostic,
} from "@/components/diagnostics/resolveDiagnostic";
import type { DiagnosticsBundle } from "@/convex/lib/engineContract";
import { cn } from "@/lib/utils";

// Story 5.5 (AC2, UX-DR2): the CitationChip — the trailing pin on every
// interpretation reason. Visual template is `DiagnosticId.tsx` (a provenance-
// violet `numeric` mono pill that is a real <button> carrying the canonical
// `dx:` id — D3, NOT a fabricated "D-LDF-07" label). Interaction template is
// `ProvenancePopover.tsx` (accessible trigger gestures).
//
// Interaction contract (UX-DR2, exact):
//   • Announced as a LINK with context: role="link" + an aria-label of the form
//     "Citation, diagnostic <kind label>, <coordinate>".
//   • Click / Enter → NAVIGATE: set window.location.hash = dxId (raw, no
//     encoding). This is the 4.6 hash contract (D6) — RunDetail's hashchange
//     effect flips to the Diagnostics tab and the rail selects+scrolls+highlights.
//     The chip never reaches into RunDetail's tab state (the hash is the seam).
//   • Hover / focus → PREVIEW the cited value (a one-line render of the stored
//     Diagnostic value — display only, AD-1).
//   • Space → PREVIEW, not navigate (Enter and Space diverge, UX-DR2).
//   • Hover/focus fills the pill full-violet (the "hover fills violet" cue).
//
// Preview surface (Task 3.3 decision): a hand-rolled, non-focus-trapping
// positioned <div> toggled by hover/focus/Space — ZERO new dependencies (the
// same posture as 4.6's hand-rolled bottom sheet). Deferred: promoting this to
// the shadcn Radix Tooltip (would add `@radix-ui/react-tooltip`).
//
// Provenance violet is licensed ONLY for provenance affordances (DESIGN.md:89 —
// "if it's violet, it traces to the engine"); do not use it elsewhere.

export function CitationChip({
  dxId,
  diagnosticsBundle,
}: {
  dxId: string;
  diagnosticsBundle: DiagnosticsBundle;
}) {
  const [open, setOpen] = useState(false);
  const previewId = useId();

  // Resolve once per bundle (the chip is cheap to re-render; the index build is
  // memoised on the bundle identity). Every reason cites ≥1 RESOLVABLE id by the
  // 5.3 contract; a null resolution is handled defensively (still navigable).
  const resolved = useMemo(
    () => resolveDiagnostic(buildDiagnosticIndex(diagnosticsBundle), dxId),
    [diagnosticsBundle, dxId],
  );

  const ariaLabel = resolved
    ? `Citation, diagnostic ${KIND_LABEL[resolved.kind]}, ${diagnosticCoordinate(resolved)}`
    : `Citation, diagnostic ${dxId}`;
  const preview = resolved ? diagnosticPreview(resolved) : null;

  function navigate() {
    // Raw canonical id — RunDetail resolves via getElementById, never a CSS
    // selector (colons). Assigning to location.hash adds the leading '#'.
    window.location.hash = dxId;
  }

  return (
    <span className="relative inline-block">
      <button
        type="button"
        role="link"
        aria-label={ariaLabel}
        aria-describedby={open && preview ? previewId : undefined}
        onClick={navigate}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            navigate();
          } else if (e.key === " " || e.key === "Spacebar") {
            // Stop the native button click (which would fire on Space) and show
            // the preview instead — so Enter and Space diverge (UX-DR2).
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className={cn(
          "numeric inline-flex items-center rounded-full border-none bg-provenance-subtle px-2 py-0.5 text-[11px] leading-none text-provenance",
          "cursor-pointer hover:bg-provenance hover:text-provenance-foreground",
          "focus-visible:bg-provenance focus-visible:text-provenance-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-provenance",
        )}
      >
        {dxId}
      </button>

      {open && preview && (
        // Non-focus-trapping preview of the cited value, aria-associated with the
        // chip via aria-describedby. Display only — no arithmetic (AD-1).
        <span
          id={previewId}
          role="tooltip"
          className="numeric absolute left-0 top-full z-50 mt-1 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-[11px] text-popover-foreground shadow-md"
        >
          {preview}
        </span>
      )}
    </span>
  );
}
