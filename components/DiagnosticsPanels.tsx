"use client";

import { useEffect, useMemo } from "react";

import { ActualVsExpectedPanel } from "@/components/diagnostics/ActualVsExpectedPanel";
import { ClBfDivergencePanel } from "@/components/diagnostics/ClBfDivergencePanel";
import { DiagnosticContextRail } from "@/components/diagnostics/DiagnosticContextRail";
import { LdfStabilityPanel } from "@/components/diagnostics/LdfStabilityPanel";
import { ResidualHeatmap } from "@/components/diagnostics/ResidualHeatmap";
import {
  DiagnosticSelectionProvider,
  useDiagnosticSelection,
} from "@/components/diagnostics/selection";
import type { DiagnosticsBundle } from "@/convex/lib/engineContract";
import { cn } from "@/lib/utils";

// Story 4.5 (AC2/6): the four Diagnostics panels rendered from the stored
// DiagnosticsBundle, verbatim, in a 2-column data grid. Story 4.6 (AC1/4/7)
// wraps them with the selection context + the right context rail (a persistent
// column on lg, a bottom sheet on md), and drives `#<diagnosticId>` deep-linking
// (initialSelectedId → select + scroll + transient highlight). Every value is
// still a stored field; 4.6 adds interaction only, no figures (AD-1).

/** All Diagnostic IDs present in the bundle (for deep-link presence checks). */
function collectIds(bundle: DiagnosticsBundle): Set<string> {
  const ids = new Set<string>();
  for (const e of bundle.ldfStability) ids.add(e.id);
  for (const e of bundle.ave) ids.add(e.id);
  for (const e of bundle.clBfDivergence ?? []) ids.add(e.id);
  for (const e of bundle.residuals) ids.add(e.id);
  return ids;
}

function DiagnosticsPanelsInner({
  diagnosticsBundle,
  runId,
  initialSelectedId,
}: {
  diagnosticsBundle: DiagnosticsBundle;
  runId: string;
  initialSelectedId?: string | null;
}) {
  const { selectedId, select } = useDiagnosticSelection();
  const { ldfStability, ave, clBfDivergence, residuals } = diagnosticsBundle;
  const ids = useMemo(() => collectIds(diagnosticsBundle), [diagnosticsBundle]);

  // Deep-link driver (AC4): a hash that names a present element selects it,
  // scrolls it into view, and briefly highlights it. Unknown/stale id → no-op
  // (rail stays empty, nothing throws). Resolve by getElementById — never a CSS
  // selector, since canonical ids contain ":".
  useEffect(() => {
    if (!initialSelectedId || !ids.has(initialSelectedId)) return;
    select(initialSelectedId);
    if (typeof document === "undefined") return;
    const el = document.getElementById(initialSelectedId);
    if (!el) return;
    if (typeof el.scrollIntoView === "function") {
      try {
        el.scrollIntoView({ block: "center" });
      } catch {
        // jsdom / unsupported — selection ring is the fallback highlight.
      }
    }
    // Transient highlight via inline outline so it never strips the selected
    // ring (which is a className). Cleared after ~1.5s.
    el.style.outline = "2px solid var(--color-primary)";
    el.style.outlineOffset = "2px";
    const t = setTimeout(() => {
      el.style.outline = "";
      el.style.outlineOffset = "";
    }, 1500);
    return () => clearTimeout(t);
  }, [initialSelectedId, ids, select]);

  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <LdfStabilityPanel elements={ldfStability} />
        <ActualVsExpectedPanel elements={ave} />
        {/* Absent, not empty: only when CL and BF both ran (Story 4.5 AC6). */}
        {clBfDivergence !== null && (
          <ClBfDivergencePanel elements={clBfDivergence} />
        )}
        <ResidualHeatmap elements={residuals} />
      </div>

      {/* Context rail: persistent right column on lg; a fixed bottom sheet on
          md/below (visible only when an element is selected). One instance,
          responsive — no new Sheet/Dialog dependency (AC7). */}
      <aside
        aria-label="Selected diagnostic detail"
        className={cn(
          "lg:static lg:col-start-2 lg:block",
          "max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-40 max-lg:max-h-[60vh] max-lg:overflow-y-auto max-lg:shadow-lg",
          selectedId ? "block" : "hidden lg:block",
        )}
      >
        <DiagnosticContextRail
          diagnosticsBundle={diagnosticsBundle}
          runId={runId}
        />
      </aside>
    </div>
  );
}

export function DiagnosticsPanels({
  diagnosticsBundle,
  runId,
  initialSelectedId,
}: {
  diagnosticsBundle: DiagnosticsBundle;
  runId: string;
  initialSelectedId?: string | null;
}) {
  return (
    <DiagnosticSelectionProvider>
      <DiagnosticsPanelsInner
        diagnosticsBundle={diagnosticsBundle}
        runId={runId}
        initialSelectedId={initialSelectedId}
      />
    </DiagnosticSelectionProvider>
  );
}
