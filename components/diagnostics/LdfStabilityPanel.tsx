import { AccessibleChart } from "@/components/diagnostics/AccessibleChart";
import { DiagnosticId } from "@/components/diagnostics/DiagnosticId";
import type { DiagnosticsBundle } from "@/convex/lib/engineContract";
import { formatFactor, formatFigure } from "@/lib/formatNumber";

// Story 4.5 (AC2/3/4/5): LDF stability small-multiples by Development Period.
// One mini chart per age-to-age transition plotting its link-ratio series (one
// point per Origin) with the engine's selectedFactor marked. Every value is a
// stored field verbatim; the SVG scaling is display GEOMETRY only — no printed
// number is computed (AD-1). Accessible table toggle shows the same data.

type LdfElement = DiagnosticsBundle["ldfStability"][number];

// Small-multiple viewBox — points are placed in display space only.
const W = 120;
const H = 48;
const PAD = 6;

function SmallMultiple({ element }: { element: LdfElement }) {
  const factors = element.linkRatios.map((r) => r.factor);
  // Include selectedFactor so its guide line sits within the drawn range.
  const all = [...factors, element.selectedFactor];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1; // avoid /0 when all equal — display geometry
  const y = (v: number) => H - PAD - ((v - min) / span) * (H - 2 * PAD);
  const x = (i: number) =>
    factors.length <= 1
      ? W / 2
      : PAD + (i / (factors.length - 1)) * (W - 2 * PAD);

  const polyline = element.linkRatios
    .map((r, i) => `${x(i)},${y(r.factor)}`)
    .join(" ");
  const selY = y(element.selectedFactor);

  return (
    <figure className="space-y-1">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label={`LDF stability ${element.fromDev} to ${element.toDev}, selected factor ${formatFactor(element.selectedFactor)}`}
      >
        {/* selected-factor guide line */}
        <line
          x1={PAD}
          x2={W - PAD}
          y1={selY}
          y2={selY}
          stroke="var(--color-provenance)"
          strokeWidth="0.75"
          strokeDasharray="2 2"
        />
        {factors.length > 1 && (
          <polyline
            points={polyline}
            fill="none"
            stroke="var(--color-primary)"
            strokeWidth="1.25"
          />
        )}
        {element.linkRatios.map((r, i) => (
          <circle
            key={r.origin}
            cx={x(i)}
            cy={y(r.factor)}
            r="1.75"
            fill="var(--color-primary)"
          />
        ))}
      </svg>
      <figcaption className="flex items-center justify-between gap-2">
        <span className="numeric text-xs text-muted-foreground">
          {element.fromDev} → {element.toDev}
        </span>
        <DiagnosticId id={element.id} />
      </figcaption>
    </figure>
  );
}

function DataTable({ elements }: { elements: LdfElement[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-sm">
        <caption className="sr-only">
          LDF stability by development period: selected factor, sigma, standard
          error, and coefficient of variation per age-to-age transition.
        </caption>
        <thead>
          <tr>
            {["Transition", "Selected", "σ", "Std err", "CV"].map((h, i) => (
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
                <span className="numeric mr-2">
                  {e.fromDev} → {e.toDev}
                </span>
                <DiagnosticId id={e.id} />
              </th>
              <td className="numeric border border-border p-cell-pad text-right tabular-nums">
                {formatFactor(e.selectedFactor)}
              </td>
              <td className="numeric border border-border p-cell-pad text-right tabular-nums">
                {formatFigure(e.sigma)}
              </td>
              <td className="numeric border border-border p-cell-pad text-right tabular-nums">
                {formatFigure(e.stdErr)}
              </td>
              <td className="numeric border border-border p-cell-pad text-right tabular-nums">
                {formatFigure(e.cv)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function LdfStabilityPanel({
  elements,
}: {
  elements: DiagnosticsBundle["ldfStability"];
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-semibold">
        LDF stability by development period
      </h3>
      {elements.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No LDF stability data for this Run.
        </p>
      ) : (
        <div className="mt-3">
          <AccessibleChart
            label="LDF stability small-multiples by development period"
            chart={
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                {elements.map((e) => (
                  <SmallMultiple key={e.id} element={e} />
                ))}
              </div>
            }
            table={<DataTable elements={elements} />}
          />
        </div>
      )}
    </section>
  );
}
