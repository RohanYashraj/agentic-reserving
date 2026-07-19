import { AccessibleChart } from "@/components/diagnostics/AccessibleChart";
import { DiagnosticId } from "@/components/diagnostics/DiagnosticId";
import { useDiagnosticSelection } from "@/components/diagnostics/selection";
import type { DiagnosticsBundle } from "@/convex/lib/engineContract";
import { cn } from "@/lib/utils";
import { formatFigure, formatPercent, formatSignedFigure } from "@/lib/formatNumber";

// Story 4.5 (AC2/3/4/5/6): CL-vs-BF divergence by Origin Period. Rendered ONLY
// when both methods ran — the container omits this panel when clBfDivergence is
// null (absent, not empty — Story 2.4 semantics). Bars are display geometry
// (height ∝ |divergence| / maxAbs); every printed figure (divergence, relative)
// is a STORED field — never clUltimate − bfUltimate in React (AD-1).
//
// Story 4.6 (AC1/4): each bar is a selection control + `#<diagnosticId>` scroll
// target (the compact chart encoding carries no visible chip, so the bar itself
// selects on click/Enter/Space and carries `id={e.id}`). The table-view rows
// select through their DiagnosticId chip; chart and table are mutually
// exclusive (AccessibleChart), so `id={e.id}` is never duplicated.

// The container only mounts this with a non-null array.
type DivergenceElements = NonNullable<DiagnosticsBundle["clBfDivergence"]>;
type DivergenceElement = DivergenceElements[number];

function Bars({ elements }: { elements: DivergenceElement[] }) {
  const { selectedId, select } = useDiagnosticSelection();
  // Axis scale only — never shown as a number (AD-1 display geometry).
  const maxAbs = Math.max(...elements.map((e) => Math.abs(e.divergence)), 1);
  return (
    <div className="flex items-end gap-1.5" style={{ height: 80 }}>
      {elements.map((e) => (
        <div
          key={e.id}
          className="flex flex-1 flex-col items-center justify-end gap-1"
        >
          {/* The bar is the Diagnostic-ID anchor AND the selection control: id
              in title (hoverable), full detail in aria-label, selects into the
              context rail on click/Enter/Space (AC1/4). */}
          <button
            type="button"
            id={e.id}
            title={e.id}
            aria-current={selectedId === e.id ? "true" : undefined}
            aria-label={`Origin ${e.origin}, divergence ${formatSignedFigure(e.divergence)}, ${e.id}`}
            onClick={() => select(e.id)}
            className={cn(
              "w-full rounded-t bg-primary/75 hover:bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
              selectedId === e.id && "ring-2 ring-primary ring-offset-1",
            )}
            style={{ height: `${(Math.abs(e.divergence) / maxAbs) * 100}%` }}
          />
          <span className="numeric text-[9px] text-muted-foreground">
            {e.origin}
          </span>
        </div>
      ))}
    </div>
  );
}

function DataTable({ elements }: { elements: DivergenceElement[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-sm">
        <caption className="sr-only">
          Chain-ladder versus Bornhuetter-Ferguson ultimate by origin period,
          with the signed divergence and relative divergence.
        </caption>
        <thead>
          <tr>
            {["Origin", "CL ultimate", "BF ultimate", "Divergence", "Relative"].map(
              (h, i) => (
                <th
                  key={h}
                  scope="col"
                  className={`border border-border p-cell-pad font-medium text-muted-foreground ${i === 0 ? "text-left" : "text-right"}`}
                >
                  {h}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {elements.map((e) => (
            <tr key={e.id}>
              <th
                scope="row"
                className="border border-border p-cell-pad text-left font-medium text-muted-foreground"
              >
                <span className="numeric mr-2">{e.origin}</span>
                <DiagnosticId id={e.id} />
              </th>
              <td className="numeric border border-border p-cell-pad text-right tabular-nums">
                {formatFigure(e.clUltimate)}
              </td>
              <td className="numeric border border-border p-cell-pad text-right tabular-nums">
                {formatFigure(e.bfUltimate)}
              </td>
              <td className="numeric border border-border p-cell-pad text-right tabular-nums">
                {formatSignedFigure(e.divergence)}
              </td>
              <td className="numeric border border-border p-cell-pad text-right tabular-nums">
                {formatPercent(e.relativeDivergence)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ClBfDivergencePanel({
  elements,
}: {
  elements: DivergenceElements;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-semibold">
        CL vs BF divergence by origin period
      </h3>
      {elements.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No CL-vs-BF divergence data for this Run.
        </p>
      ) : (
        <div className="mt-3">
          <AccessibleChart
            label="Chain-ladder versus Bornhuetter-Ferguson divergence by origin period"
            chart={<Bars elements={elements} />}
            table={<DataTable elements={elements} />}
          />
        </div>
      )}
    </section>
  );
}
