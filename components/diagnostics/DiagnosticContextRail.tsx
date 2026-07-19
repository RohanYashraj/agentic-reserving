"use client";

import {
  buildDiagnosticIndex,
  KIND_LABEL,
  resolveDiagnostic,
  type ResolvedDiagnostic,
} from "@/components/diagnostics/resolveDiagnostic";
import { useDiagnosticSelection } from "@/components/diagnostics/selection";
import type {
  DiagnosticsBundle,
  Recommendations,
} from "@/convex/lib/engineContract";
import {
  formatFactor,
  formatFigure,
  formatPercent,
  formatResidual,
  formatSignedFigure,
} from "@/lib/formatNumber";

// Story 4.6 (AC1/2/5/6): the right context rail. It resolves the selected
// Diagnostic ID against the SAME DiagnosticsBundle the panels render (an
// id→element Map across all four kinds) and prints the element's STORED values
// verbatim — no re-fetch, no recompute, no arithmetic (AD-1). Empty state
// "Select any diagnostic element" until something is selected (EXPERIENCE.md:71).
// The "Cited by" section is an honest-empty contract shell — report claims/
// citations arrive with Interpretation (Epic 5) / the Report editor (Epic 6);
// there is no citation query here (AC6/AC8).

// The id→element index, KIND_LABEL, and the ResolvedDiagnostic type now live in
// the shared `resolveDiagnostic` module (Story 5.5) so the CitationChip preview
// and this rail resolve identically. The rail keeps its richer `Detail` renderer.

/**
 * Count the interpretation claims that cite a given Diagnostic ID (Story 5.5,
 * AC3/D4). N = the number of `RecommendationReason`s across all Origin Periods
 * whose `citations[]` include `id`. This reads only citation-id lists (opaque
 * strings) — citation-METADATA aggregation, NOT reserve arithmetic (AD-1 clean).
 * When Epic 6 renders/persists Reserve Report sections, the count extends to
 * union the report's section citations into the same tally.
 */
function countCitingClaims(
  recommendations: Recommendations,
  id: string,
): number {
  let n = 0;
  for (const rec of recommendations.recommendations) {
    for (const reason of rec.reasons) {
      if (reason.citations.includes(id)) n++;
    }
  }
  return n;
}

/** A labelled stored value row: label + mono figure. */
function ValueRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="numeric text-sm tabular-nums">{value}</dd>
    </div>
  );
}

function Detail({ resolved }: { resolved: ResolvedDiagnostic }) {
  switch (resolved.kind) {
    case "ldf_stability": {
      const el = resolved.el;
      return (
        <>
          <h4 className="text-sm font-medium">
            LDF {el.fromDev}→{el.toDev}
          </h4>
          <dl className="mt-3 space-y-1.5">
            <ValueRow
              label="Selected factor"
              value={formatFactor(el.selectedFactor)}
            />
            <ValueRow label="σ" value={formatFigure(el.sigma)} />
            <ValueRow label="Std err" value={formatFigure(el.stdErr)} />
            <ValueRow
              label="Coefficient of variation"
              value={formatFigure(el.cv)}
            />
          </dl>
          {el.linkRatios.length > 0 && (
            <div className="mt-3">
              <p className="text-xs text-muted-foreground">Factor series:</p>
              <p className="numeric mt-1 text-sm tabular-nums">
                {el.linkRatios.map((r) => formatFactor(r.factor)).join(" · ")}
              </p>
            </div>
          )}
        </>
      );
    }
    case "ave": {
      const el = resolved.el;
      return (
        <>
          <h4 className="text-sm font-medium">
            Actual vs expected — {el.origin}
          </h4>
          <dl className="mt-3 space-y-1.5">
            <ValueRow label="Actual" value={formatFigure(el.actual)} />
            <ValueRow label="Expected" value={formatFigure(el.expected)} />
            <ValueRow
              label="A−E"
              value={formatSignedFigure(el.actualMinusExpected)}
            />
            <ValueRow
              label="A/E"
              value={formatPercent(el.actualToExpectedRatio)}
            />
          </dl>
        </>
      );
    }
    case "cl_bf_divergence": {
      const el = resolved.el;
      return (
        <>
          <h4 className="text-sm font-medium">CL vs BF — {el.origin}</h4>
          <dl className="mt-3 space-y-1.5">
            <ValueRow label="CL ultimate" value={formatFigure(el.clUltimate)} />
            <ValueRow label="BF ultimate" value={formatFigure(el.bfUltimate)} />
            <ValueRow
              label="Divergence"
              value={formatSignedFigure(el.divergence)}
            />
            <ValueRow
              label="Relative"
              value={formatPercent(el.relativeDivergence)}
            />
          </dl>
        </>
      );
    }
    case "residual": {
      const el = resolved.el;
      return (
        <>
          <h4 className="text-sm font-medium">
            Residual {el.origin} · {el.fromDev}→{el.toDev}
          </h4>
          <dl className="mt-3 space-y-1.5">
            <ValueRow label="Residual" value={formatResidual(el.residual)} />
          </dl>
        </>
      );
    }
  }
}

export function DiagnosticContextRail({
  diagnosticsBundle,
  runId,
  recommendations,
}: {
  diagnosticsBundle: DiagnosticsBundle;
  runId: string;
  // Story 5.5 (AC3): the interpretation-claims citation source. null until an
  // Interpretation exists — then the "Cited by N report claims" backlink lights up.
  recommendations?: Recommendations | null;
}) {
  const { selectedId, clear } = useDiagnosticSelection();
  const resolved = selectedId
    ? resolveDiagnostic(buildDiagnosticIndex(diagnosticsBundle), selectedId)
    : null;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Selected diagnostic</h3>
        {resolved && (
          <button
            type="button"
            onClick={clear}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        )}
      </div>

      {resolved === null ? (
        // Empty state (AC2) — also shown for an unknown/stale selected id (AC4
        // no-op: the resolver returns null, nothing throws).
        <p className="mt-3 text-sm text-muted-foreground">
          Select any diagnostic element
        </p>
      ) : (
        <div className="mt-3 space-y-4">
          <div>
            <span className="text-xs text-muted-foreground">
              {KIND_LABEL[resolved.kind]}
            </span>
            <div className="mt-1">
              {/* Display echo of the Diagnostic ID (provenance violet) — NOT an
                  anchor: no DOM `id` (the panel element owns the scroll target),
                  no selection button. Avoids duplicate ids. */}
              <span
                title={resolved.el.id}
                className="numeric inline-block rounded bg-provenance-subtle px-1.5 py-0.5 text-[11px] leading-none text-provenance"
              >
                {resolved.el.id}
              </span>
            </div>
          </div>

          <div className="border-t border-border pt-3">
            <Detail resolved={resolved} />
          </div>

          {/* Cited by (Story 5.5, AC3/D4) — the honest-empty shell 4.6 left now
              lights up with the real count. "report claims" = interpretation
              claims from the recommendations document (the citations source 5.5
              subscribes to); Epic 6 unions the Reserve Report's section citations
              into the same count. The "→ view in draft" navigation is deferred
              (the draft isn't rendered in 5.5) — 5.5 ships the count only. */}
          <div className="border-t border-border pt-3">
            <h4 className="text-sm font-medium">Cited by</h4>
            {recommendations == null ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Cited by 0 report claims. Backlinks appear once Interpretation
                exists.
              </p>
            ) : (
              (() => {
                const n = countCitingClaims(recommendations, resolved.el.id);
                return (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Cited by {n} report {n === 1 ? "claim" : "claims"}.
                  </p>
                );
              })()
            )}
          </div>

          <div className="border-t border-border pt-3">
            <p className="text-xs text-muted-foreground">Deep link:</p>
            <p className="numeric mt-1 break-all text-[11px] text-muted-foreground">
              /runs/{runId}/diagnostics#{resolved.el.id}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
