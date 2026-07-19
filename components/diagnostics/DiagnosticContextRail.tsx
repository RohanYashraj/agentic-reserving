"use client";

import { useDiagnosticSelection } from "@/components/diagnostics/selection";
import type { DiagnosticsBundle } from "@/convex/lib/engineContract";
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

type Kind = "ldf_stability" | "ave" | "cl_bf_divergence" | "residual";

type Resolved =
  | { kind: "ldf_stability"; el: DiagnosticsBundle["ldfStability"][number] }
  | { kind: "ave"; el: DiagnosticsBundle["ave"][number] }
  | {
      kind: "cl_bf_divergence";
      el: NonNullable<DiagnosticsBundle["clBfDivergence"]>[number];
    }
  | { kind: "residual"; el: DiagnosticsBundle["residuals"][number] };

function buildIndex(bundle: DiagnosticsBundle): Map<string, Resolved> {
  const index = new Map<string, Resolved>();
  for (const el of bundle.ldfStability)
    index.set(el.id, { kind: "ldf_stability", el });
  for (const el of bundle.ave) index.set(el.id, { kind: "ave", el });
  for (const el of bundle.clBfDivergence ?? [])
    index.set(el.id, { kind: "cl_bf_divergence", el });
  for (const el of bundle.residuals)
    index.set(el.id, { kind: "residual", el });
  return index;
}

const KIND_LABEL: Record<Kind, string> = {
  ldf_stability: "LDF stability",
  ave: "Actual vs expected",
  cl_bf_divergence: "CL vs BF divergence",
  residual: "Residual",
};

/** A labelled stored value row: label + mono figure. */
function ValueRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="numeric text-sm tabular-nums">{value}</dd>
    </div>
  );
}

function Detail({ resolved }: { resolved: Resolved }) {
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
}: {
  diagnosticsBundle: DiagnosticsBundle;
  runId: string;
}) {
  const { selectedId, clear } = useDiagnosticSelection();
  const resolved = selectedId
    ? (buildIndex(diagnosticsBundle).get(selectedId) ?? null)
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

          {/* Cited by — honest-empty contract shell. Report claims/citations
              arrive with Interpretation (Epic 5) / the Report editor (Epic 6);
              no citation query exists yet (AC6). */}
          <div className="border-t border-border pt-3">
            <h4 className="text-sm font-medium">Cited by</h4>
            <p className="mt-1 text-xs text-muted-foreground">
              Cited by 0 report claims. Backlinks appear once Interpretation
              exists.
            </p>
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
