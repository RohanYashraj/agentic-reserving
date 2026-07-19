"use client";

import { useDiagnosticSelection } from "@/components/diagnostics/selection";
import { cn } from "@/lib/utils";

// Story 4.5 (AC3, UX-DR10): every diagnostic element carries its Diagnostic ID
// as a hoverable anchor. The stored `element.id` (canonical dx:{runId}:{kind}:
// {key}, minted only by the engine — Story 2.4) IS that identity; render it
// verbatim in the `provenance` (violet) token family — violet is licensed ONLY
// for Diagnostic-ID references / Lineage links (DESIGN.md:89,126), used for
// nothing else in these panels.
//
// Story 4.6 (AC1/3/4): the chip is now the element's SELECTION control and its
// DOM scroll target. It is a real <button> (Enter/Space for free) that selects
// the element into the context rail on click, carries `id={id}` (the
// `#<diagnosticId>` deep-link target — canonical id verbatim), and shows a
// primary-teal selected ring + `aria-current` when selected. Teal (the working
// colour, DESIGN.md:88) is deliberately NOT violet, so "selected" and "ID
// reference" never read ambiguously. Resolve/scroll to these ids with
// getElementById — never a CSS selector (canonical ids contain ":").

export function DiagnosticId({
  id,
  className,
}: {
  id: string;
  className?: string;
}) {
  const { selectedId, select } = useDiagnosticSelection();
  const selected = selectedId === id;
  return (
    <button
      type="button"
      id={id}
      title={id}
      aria-current={selected ? "true" : undefined}
      onClick={() => select(id)}
      className={cn(
        "numeric inline-block rounded bg-provenance-subtle px-1.5 py-0.5 text-[11px] leading-none text-provenance",
        "cursor-pointer hover:bg-provenance/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        selected && "ring-2 ring-primary ring-offset-1",
        className,
      )}
    >
      {id}
    </button>
  );
}
