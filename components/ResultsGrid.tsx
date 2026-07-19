"use client";

import { methodLabel } from "@/components/methods";
import { ProvenancePopover } from "@/components/ProvenancePopover";
import type { Id } from "@/convex/_generated/dataModel";
import type { ResultSet } from "@/convex/lib/engineContract";
import { formatFactor, formatFigure } from "@/lib/formatNumber";

// Story 4.4 (AC1, AC3, AC6): the ResultSet rendered in the triangle-grid
// texture — ultimates / IBNR / LDFs per Method per Origin Period (+ Mack std
// err and reserve range), every figure verbatim from the stored ResultSet.
//
// AD-1 HARD RULE: no arithmetic anywhere in this file. No sums, no "Total" row
// (the ResultSet has no total-ultimate/total-IBNR field), no ibnr±stdErr
// (reserveLow/High are engine-computed), no CL-vs-BF deltas (those are
// Diagnostics, Story 4.5). Every number is a single formatFigure/formatFactor
// of ONE stored field. Display formatting only.

type Lineage = ResultSet["lineage"];
type MethodResult = ResultSet["methodResults"][number];

export function ResultsGrid({
  resultSet,
  runId,
}: {
  resultSet: ResultSet;
  runId: Id<"runs">;
}) {
  return (
    <div className="space-y-10">
      {resultSet.methodResults.map((mr) => (
        <MethodSection
          key={mr.method}
          mr={mr}
          lineage={resultSet.lineage}
          runId={runId}
        />
      ))}
    </div>
  );
}

function MethodSection({
  mr,
  lineage,
  runId,
}: {
  mr: MethodResult;
  lineage: Lineage;
  runId: Id<"runs">;
}) {
  const label = methodLabel(mr.method);
  const isMack = mr.method === "mack";

  // A figure wrapped in its provenance popover. The accessible name carries the
  // description AND the value so screen readers announce the number within the
  // table-header context (AC3/AC6), not just the provenance action.
  const figure = (desc: string, formatted: string) => (
    <ProvenancePopover
      lineage={lineage}
      runId={runId}
      label={`${desc}: ${formatted}`}
    >
      {formatted}
    </ProvenancePopover>
  );

  return (
    <section aria-labelledby={`results-${mr.method}`} className="space-y-4">
      <h3 id={`results-${mr.method}`} className="text-sm font-semibold">
        {label}
      </h3>

      <div className="overflow-x-auto">
        <table className="border-collapse text-sm">
          <caption className="sr-only">
            {label}: ultimates and IBNR by origin period
            {isMack
              ? ", with Mack standard error and reserve range"
              : ""}
            .
          </caption>
          <thead>
            <tr>
              <th
                scope="col"
                className="border border-border p-cell-pad text-left font-medium text-muted-foreground"
              >
                Origin
              </th>
              <th
                scope="col"
                className="border border-border p-cell-pad text-right font-medium text-muted-foreground"
              >
                Ultimate
              </th>
              <th
                scope="col"
                className="border border-border p-cell-pad text-right font-medium text-muted-foreground"
              >
                IBNR
              </th>
              {isMack && (
                <>
                  <th
                    scope="col"
                    className="border border-border p-cell-pad text-right font-medium text-muted-foreground"
                  >
                    Std Err
                  </th>
                  <th
                    scope="col"
                    className="border border-border p-cell-pad text-right font-medium text-muted-foreground"
                  >
                    Reserve Low
                  </th>
                  <th
                    scope="col"
                    className="border border-border p-cell-pad text-right font-medium text-muted-foreground"
                  >
                    Reserve High
                  </th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {mr.originResults.map((o) => (
              <tr key={o.origin}>
                <th
                  scope="row"
                  className="border border-border p-cell-pad text-left font-medium text-muted-foreground"
                >
                  {o.origin}
                </th>
                <td className="numeric border border-border p-cell-pad text-right tabular-nums">
                  {figure(
                    `${label} ultimate, origin ${o.origin}`,
                    formatFigure(o.ultimate),
                  )}
                </td>
                <td className="numeric border border-border p-cell-pad text-right tabular-nums">
                  {figure(
                    `${label} IBNR, origin ${o.origin}`,
                    formatFigure(o.ibnr),
                  )}
                </td>
                {isMack && (
                  <>
                    <td className="numeric border border-border p-cell-pad text-right tabular-nums">
                      {figure(
                        `${label} standard error, origin ${o.origin}`,
                        formatFigure(o.mackStdErr),
                      )}
                    </td>
                    <td className="numeric border border-border p-cell-pad text-right tabular-nums">
                      {figure(
                        `${label} reserve low, origin ${o.origin}`,
                        formatFigure(o.reserveLow),
                      )}
                    </td>
                    <td className="numeric border border-border p-cell-pad text-right tabular-nums">
                      {figure(
                        `${label} reserve high, origin ${o.origin}`,
                        formatFigure(o.reserveHigh),
                      )}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {mr.developmentFactors.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground">
            Development factors (age-to-age)
          </h4>
          <ul className="flex flex-wrap gap-x-6 gap-y-1">
            {mr.developmentFactors.map((f) => (
              <li key={`${f.fromDev}-${f.toDev}`} className="numeric text-sm">
                <span className="text-muted-foreground">
                  {f.fromDev} → {f.toDev}:{" "}
                </span>
                {figure(
                  `${label} development factor ${f.fromDev} to ${f.toDev}`,
                  formatFactor(f.factor),
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {mr.totalMackStdErr !== null && (
        <p className="text-sm text-muted-foreground">
          Total standard error:{" "}
          <span className="numeric text-foreground">
            {figure(
              `${label} total standard error`,
              formatFigure(mr.totalMackStdErr),
            )}
          </span>
        </p>
      )}
    </section>
  );
}
