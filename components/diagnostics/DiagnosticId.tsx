import { cn } from "@/lib/utils";

// Story 4.5 (AC3, UX-DR10): every diagnostic element carries its Diagnostic ID
// as a hoverable anchor. The stored `element.id` (canonical dx:{runId}:{kind}:
// {key}, minted only by the engine — Story 2.4) IS that identity; render it
// verbatim in the `provenance` (violet) token family — violet is licensed ONLY
// for Diagnostic-ID references / Lineage links (DESIGN.md:89,126), used for
// nothing else in these panels.
//
// This is NOT the interactive citation chip (Interpretation, Epic 5) and NOT
// the context rail (Story 4.6): the anchor is an identity label only. It is
// kept keyboard-focusable and semantically addressable so Story 4.6 can attach
// selection + a DOM scroll-target `id` to it mechanically — but it wires no
// click/select/deep-link behaviour here.

export function DiagnosticId({
  id,
  className,
}: {
  id: string;
  className?: string;
}) {
  return (
    <span
      tabIndex={0}
      title={id}
      className={cn(
        "numeric inline-block rounded bg-provenance-subtle px-1.5 py-0.5 text-[11px] leading-none text-provenance",
        className,
      )}
    >
      {id}
    </span>
  );
}
