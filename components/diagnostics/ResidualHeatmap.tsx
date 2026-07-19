import type { DiagnosticsBundle } from "@/convex/lib/engineContract";
import { formatResidual } from "@/lib/formatNumber";

// Story 4.5 (AC2/3/4/5): residual heatmap over Origin × Development. Diverging
// blue↔amber ramp (NEVER red↔green — DESIGN.md:130,139); the residual VALUE is
// always printed in the cell (colour is annotation, the number is the datum —
// EXPERIENCE.md:108). Real table semantics + per-cell Diagnostic-ID anchor make
// it self-accessible (no chart toggle needed — AC4). Axis bucketing is string/
// display work only; no printed number is computed (AD-1).

type ResidualElement = DiagnosticsBundle["residuals"][number];

// Diverging blue (negative) ↔ neutral ↔ amber (positive). Buckets are a display
// annotation of the STORED residual — not a computed datum.
function rampColor(r: number): { background: string; color?: string } {
  if (r >= 1.0) return { background: "#FDBA5B", color: "#7A3E00" };
  if (r >= 0.5) return { background: "#FDE8C8" };
  if (r >= 0.15) return { background: "#FEF3E2" };
  if (r > -0.15) return { background: "#F9FAFB" };
  if (r > -0.35) return { background: "#EFF6FF" };
  return { background: "#DBEAFE" };
}

function devLabel(e: ResidualElement): string {
  return `${e.fromDev}→${e.toDev}`;
}

export function ResidualHeatmap({
  elements,
}: {
  elements: DiagnosticsBundle["residuals"];
}) {
  // Derive axes by collecting distinct labels in first-seen order (string
  // bucketing, not arithmetic — AD-1).
  const origins: string[] = [];
  const devs: string[] = [];
  const byCell = new Map<string, ResidualElement>();
  for (const e of elements) {
    if (!origins.includes(e.origin)) origins.push(e.origin);
    const d = devLabel(e);
    if (!devs.includes(d)) devs.push(d);
    byCell.set(`${e.origin}|${d}`, e);
  }

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-semibold">Residual heatmap</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Blue ↔ amber; value printed in each cell.
      </p>
      {elements.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No residual data for this Run.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="border-collapse text-sm">
            <caption className="sr-only">
              Standardized residuals by origin period (rows) and development
              transition (columns); each cell prints its residual value.
            </caption>
            <thead>
              <tr>
                <th
                  scope="col"
                  className="border border-border p-cell-pad text-left font-medium text-muted-foreground"
                >
                  Origin
                </th>
                {devs.map((d) => (
                  <th
                    key={d}
                    scope="col"
                    className="numeric border border-border p-cell-pad text-right font-medium text-muted-foreground"
                  >
                    {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {origins.map((origin) => (
                <tr key={origin}>
                  <th
                    scope="row"
                    className="numeric border border-border p-cell-pad text-left font-medium text-muted-foreground"
                  >
                    {origin}
                  </th>
                  {devs.map((d) => {
                    const e = byCell.get(`${origin}|${d}`);
                    if (!e) {
                      return (
                        <td
                          key={d}
                          className="border border-border p-cell-pad"
                          aria-hidden="true"
                        />
                      );
                    }
                    const { background, color } = rampColor(e.residual);
                    return (
                      <td
                        key={d}
                        tabIndex={0}
                        title={e.id}
                        aria-label={`Origin ${origin}, ${d}, residual ${formatResidual(e.residual)}`}
                        style={{ background, color }}
                        className="numeric border border-border p-cell-pad text-right tabular-nums"
                      >
                        {formatResidual(e.residual)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
