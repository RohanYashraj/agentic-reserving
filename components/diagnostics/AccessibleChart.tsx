"use client";

import { useId, useState, type ReactNode } from "react";

// Story 4.5 (AC4, UX-DR10 / EXPERIENCE.md:113, WCAG 2.2 AA): the graphical
// diagnostics panels (LDF stability small-multiples, CL-vs-BF divergence bars)
// each ship an accessible table toggle showing the SAME data. One shared
// wrapper so the two panels don't hand-roll the toggle (no drift): a real
// <button> flips a local flag between the chart and a real <table>.

export function AccessibleChart({
  label,
  chart,
  table,
}: {
  label: string;
  chart: ReactNode;
  table: ReactNode;
}) {
  const [showTable, setShowTable] = useState(false);
  const regionId = useId();

  return (
    <div>
      <div className="mb-2 flex justify-end">
        <button
          type="button"
          onClick={() => setShowTable((v) => !v)}
          aria-pressed={showTable}
          aria-controls={regionId}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          {showTable ? `Show chart` : `Show data table`}
        </button>
      </div>
      <div id={regionId} aria-label={label}>
        {showTable ? table : chart}
      </div>
    </div>
  );
}
