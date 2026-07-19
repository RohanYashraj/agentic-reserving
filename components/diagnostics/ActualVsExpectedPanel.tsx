import { DiagnosticId } from "@/components/diagnostics/DiagnosticId";
import type { DiagnosticsBundle } from "@/convex/lib/engineContract";
import { formatFigure, formatPercent, formatSignedFigure } from "@/lib/formatNumber";

// Story 4.5 (AC2/3/5): Actual-vs-Expected on the Latest Diagonal. Already a
// table (no chart toggle needed — AC4). Deviations are mono-printed VERBATIM:
// the signed `actualMinusExpected` and the `actualToExpectedRatio` (as %) are
// STORED engine fields — never `actual − expected` or `ratio − 1` in React
// (AD-1: the sharpest arithmetic temptation on this surface).

type AveElement = DiagnosticsBundle["ave"][number];

function isAdverse(e: AveElement): boolean {
  // Colour is a secondary annotation only — the sign is always printed (AC4).
  return e.actualMinusExpected < 0;
}

export function ActualVsExpectedPanel({
  elements,
}: {
  elements: DiagnosticsBundle["ave"];
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-semibold">
        Actual vs expected — latest diagonal
      </h3>
      {elements.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No actual-vs-expected data for this Run.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="border-collapse text-sm">
            <caption className="sr-only">
              Actual versus expected on the latest diagonal, by origin period,
              with the signed actual-minus-expected deviation and the
              actual-to-expected ratio.
            </caption>
            <thead>
              <tr>
                {["Origin", "Actual", "Expected", "A−E", "A/E"].map((h, i) => (
                  <th
                    key={h}
                    scope="col"
                    className={`border border-border p-cell-pad font-medium text-muted-foreground ${i === 0 ? "text-left" : "text-right"}`}
                  >
                    {h}
                  </th>
                ))}
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
                    {formatFigure(e.actual)}
                  </td>
                  <td className="numeric border border-border p-cell-pad text-right tabular-nums">
                    {formatFigure(e.expected)}
                  </td>
                  <td
                    className={`numeric border border-border p-cell-pad text-right tabular-nums ${isAdverse(e) ? "text-caution" : ""}`}
                  >
                    {formatSignedFigure(e.actualMinusExpected)}
                  </td>
                  <td className="numeric border border-border p-cell-pad text-right tabular-nums">
                    {formatPercent(e.actualToExpectedRatio)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
