import { formatFigure, formatSignedFigure } from "@/lib/formatNumber";
import type { ReDerivationReport } from "@/convex/lib/engineContract";

// Story 4.7 (AC1, AC5): the re-derivation outcome. Purely presentational — it
// renders the fully-computed ReDerivationReport (the engine already did every
// comparison and subtraction, AD-1); this component formats stored fields only,
// it performs no arithmetic. Three outcomes:
//   • triangleHashVerified === false → chain-of-custody warning (the stored
//     Triangle no longer matches its Lineage hash — a distinct failure mode);
//   • reproduced === true            → green confirmation naming the AD-11 tier;
//   • otherwise                      → a discrepancy table (per-figure deltas).

function tierText(tier: ReDerivationReport["tier"]): string {
  return tier === "exact"
    ? "Reproduced exactly on the pinned platform."
    : "Reproduced within 1e-8 (cross-platform tolerance).";
}

export function RederivationPanel({ report }: { report: ReDerivationReport }) {
  if (!report.triangleHashVerified) {
    return (
      <div
        className="rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm"
        role="status"
      >
        <p className="font-medium text-amber-700 dark:text-amber-400">
          Chain of custody broken
        </p>
        <p className="mt-1 text-muted-foreground">
          The stored Triangle no longer matches its Lineage hash — this
          ResultSet cannot be re-derived from the Triangle on record.
        </p>
      </div>
    );
  }

  if (report.reproduced) {
    return (
      <div
        className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm"
        role="status"
      >
        <p className="font-medium text-emerald-700 dark:text-emerald-400">
          Reproduced ✓
        </p>
        <p className="mt-1 text-muted-foreground">{tierText(report.tier)}</p>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4">
      <p className="text-sm font-medium text-destructive">
        Discrepancy — {report.discrepancies.length}{" "}
        {report.discrepancies.length === 1 ? "figure" : "figures"} did not
        reproduce
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th scope="col" className="p-cell-pad font-medium">
                Method
              </th>
              <th scope="col" className="p-cell-pad font-medium">
                Figure
              </th>
              <th scope="col" className="p-cell-pad font-medium">
                Where
              </th>
              <th scope="col" className="p-cell-pad text-right font-medium">
                Stored
              </th>
              <th scope="col" className="p-cell-pad text-right font-medium">
                Re-derived
              </th>
              <th scope="col" className="p-cell-pad text-right font-medium">
                Delta
              </th>
            </tr>
          </thead>
          <tbody>
            {report.discrepancies.map((d, i) => (
              <tr key={`${d.method}:${d.field}:${d.key}:${i}`}>
                <td className="p-cell-pad">{d.method}</td>
                <td className="p-cell-pad">{d.field}</td>
                <td className="p-cell-pad">{d.key || "—"}</td>
                <td className="numeric p-cell-pad text-right tabular-nums">
                  {formatFigure(d.stored)}
                </td>
                <td className="numeric p-cell-pad text-right tabular-nums">
                  {formatFigure(d.rederived)}
                </td>
                <td className="numeric p-cell-pad text-right tabular-nums text-destructive">
                  {formatSignedFigure(d.delta)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
