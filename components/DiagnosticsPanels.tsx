import { ActualVsExpectedPanel } from "@/components/diagnostics/ActualVsExpectedPanel";
import { ClBfDivergencePanel } from "@/components/diagnostics/ClBfDivergencePanel";
import { LdfStabilityPanel } from "@/components/diagnostics/LdfStabilityPanel";
import { ResidualHeatmap } from "@/components/diagnostics/ResidualHeatmap";
import type { DiagnosticsBundle } from "@/convex/lib/engineContract";

// Story 4.5 (AC2/6): the four Diagnostics panels rendered from the stored
// DiagnosticsBundle, verbatim, in a 2-column data grid (mockup idiom). The
// CL-vs-BF divergence panel is mounted ONLY when clBfDivergence is non-null —
// absent, not empty (Story 2.4 semantics). No arithmetic anywhere (AD-1);
// every figure is a stored field. (Story 4.6 will add the `runId`-keyed context
// rail + `#<diagnosticId>` deep-linking that attaches to the ID anchors.)

export function DiagnosticsPanels({
  diagnosticsBundle,
}: {
  diagnosticsBundle: DiagnosticsBundle;
}) {
  const { ldfStability, ave, clBfDivergence, residuals } = diagnosticsBundle;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <LdfStabilityPanel elements={ldfStability} />
      <ActualVsExpectedPanel elements={ave} />
      {/* Absent, not empty: only when CL and BF both ran (AC6). */}
      {clBfDivergence !== null && (
        <ClBfDivergencePanel elements={clBfDivergence} />
      )}
      <ResidualHeatmap elements={residuals} />
    </div>
  );
}
