import type { DiagnosticsBundle } from "@/convex/lib/engineContract";
import {
  formatFactor,
  formatPercent,
  formatResidual,
  formatSignedFigure,
} from "@/lib/formatNumber";

// Story 5.5 (AC2/3): the single source of truth for resolving a `dx:` Diagnostic
// ID → its element in the DiagnosticsBundle, plus display-only helpers. Lifted
// from `DiagnosticContextRail`'s private `buildIndex`/`KIND_LABEL` (Story 4.6) so
// the CitationChip's tooltip preview and the rail resolve identically — the same
// one-source-of-truth reason `selection.tsx` was extracted in 4.6. Reads STORED
// values verbatim and formats them with `lib/formatNumber`; it NEVER computes a
// figure (AD-1) — the "cited value" preview is a rendering of what the engine
// already produced.

export type DiagnosticKind =
  | "ldf_stability"
  | "ave"
  | "cl_bf_divergence"
  | "residual";

export type ResolvedDiagnostic =
  | { kind: "ldf_stability"; el: DiagnosticsBundle["ldfStability"][number] }
  | { kind: "ave"; el: DiagnosticsBundle["ave"][number] }
  | {
      kind: "cl_bf_divergence";
      el: NonNullable<DiagnosticsBundle["clBfDivergence"]>[number];
    }
  | { kind: "residual"; el: DiagnosticsBundle["residuals"][number] };

export const KIND_LABEL: Record<DiagnosticKind, string> = {
  ldf_stability: "LDF stability",
  ave: "Actual vs expected",
  cl_bf_divergence: "CL vs BF divergence",
  residual: "Residual",
};

/** Build an id → resolved-element index across all four Diagnostic kinds. */
export function buildDiagnosticIndex(
  bundle: DiagnosticsBundle,
): Map<string, ResolvedDiagnostic> {
  const index = new Map<string, ResolvedDiagnostic>();
  for (const el of bundle.ldfStability)
    index.set(el.id, { kind: "ldf_stability", el });
  for (const el of bundle.ave) index.set(el.id, { kind: "ave", el });
  for (const el of bundle.clBfDivergence ?? [])
    index.set(el.id, { kind: "cl_bf_divergence", el });
  for (const el of bundle.residuals)
    index.set(el.id, { kind: "residual", el });
  return index;
}

/** Resolve one `dx:` id against a prebuilt index; null if absent (never throws). */
export function resolveDiagnostic(
  index: Map<string, ResolvedDiagnostic>,
  id: string,
): ResolvedDiagnostic | null {
  return index.get(id) ?? null;
}

/**
 * The element's coordinate context (its key), for the CitationChip's accessible
 * name (UX-DR2 "announced as a link with context"). Display-only string built
 * from stored coordinate fields — no figures.
 */
export function diagnosticCoordinate(resolved: ResolvedDiagnostic): string {
  switch (resolved.kind) {
    case "ldf_stability":
      return `${resolved.el.fromDev}→${resolved.el.toDev}`;
    case "ave":
      return resolved.el.origin;
    case "cl_bf_divergence":
      return resolved.el.origin;
    case "residual":
      return `${resolved.el.origin} · ${resolved.el.fromDev}→${resolved.el.toDev}`;
  }
}

/**
 * A one-line preview of the cited Diagnostic's headline value(s) (UX-DR2 "tooltip
 * preview of the cited value"), rendered VERBATIM from the stored bundle via the
 * `lib/formatNumber` display helpers ONLY (no arithmetic — AD-1). Matches how the
 * rail's `Detail` prints each kind's numbers, so chip preview and rail agree.
 */
export function diagnosticPreview(resolved: ResolvedDiagnostic): string {
  switch (resolved.kind) {
    case "ldf_stability":
      return `LDF ${resolved.el.fromDev}→${resolved.el.toDev}: ${formatFactor(
        resolved.el.selectedFactor,
      )}`;
    case "ave":
      return `A/E ${resolved.el.origin}: ${formatPercent(
        resolved.el.actualToExpectedRatio,
      )}`;
    case "cl_bf_divergence":
      return `CL vs BF ${resolved.el.origin}: ${formatSignedFigure(
        resolved.el.divergence,
      )}`;
    case "residual":
      return `Residual ${resolved.el.origin} ${resolved.el.fromDev}→${resolved.el.toDev}: ${formatResidual(
        resolved.el.residual,
      )}`;
  }
}
