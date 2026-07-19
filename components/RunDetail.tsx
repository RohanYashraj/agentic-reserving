"use client";

import { useState, type ReactNode } from "react";

import { ResultsGrid } from "@/components/ResultsGrid";
import { StatusBadge } from "@/components/StatusBadge";
import { StepRail, type RunStatus } from "@/components/StepRail";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { methodLabel } from "@/components/methods";
import type { Id } from "@/convex/_generated/dataModel";
import type { Method, ResultSet } from "@/convex/lib/engineContract";

// Story 4.3 (AC2/3/4): the live Run-detail body. Status badge + per-Method
// progress rows in an aria-live region + the golden-path step rail + four tabs
// (locked/empty bodies) + a failed banner with an idempotent Retry. NO reserve
// figures anywhere (AD-1) — the ResultSet/Diagnostics rendering is Stories
// 4.4–4.6; this surface only reflects status.

// The lean projection api.runs.getRun returns (no figures — AD-1).
export type RunView = {
  _id: Id<"runs">;
  status: RunStatus;
  triangleId: Id<"triangles">;
  triangleHash: string;
  methods: Method[];
  error: { code: string; message: string } | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  hasResults: boolean;
  hasDiagnostics: boolean;
};

type TabKey = "results" | "diagnostics" | "interpretation" | "report";

/** Per-Method row label for the current run-level status (rows tick together — the
 *  engine returns all Method results in one synchronous call; there is no
 *  per-Method server progress to subscribe to). */
function methodRowState(status: RunStatus): {
  text: string;
  pulsing: boolean;
} {
  switch (status) {
    case "queued":
    case "running":
      return { text: "running…", pulsing: true };
    case "complete":
      return { text: "complete", pulsing: false };
    case "failed":
      return { text: "failed", pulsing: false };
  }
}

function TabPlaceholder({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-border p-6">
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

export function RunDetail({
  run,
  resultSet,
  onRetry,
}: {
  run: RunView;
  resultSet?: ResultSet | null;
  onRetry: () => Promise<void> | void;
}) {
  const [tab, setTab] = useState<TabKey>("results");
  const [retrying, setRetrying] = useState(false);

  const rowState = methodRowState(run.status);

  async function retry() {
    setRetrying(true);
    try {
      await onRetry();
      // On success the getRun subscription flips the run to queued/running and
      // the banner disappears reactively — do NOT optimistically hide it here
      // (audit-generating status actions confirm on server ack, UX primitive).
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div className="space-y-6">
      <StepRail
        runStatus={run.status}
        hasDiagnostics={run.hasDiagnostics}
        triangleId={run.triangleId}
        onSelectDiagnostics={() => setTab("diagnostics")}
      />

      <div className="flex items-center gap-3">
        <StatusBadge status={run.status} />
      </div>

      {/* Live status: re-renders reactively via the getRun subscription (no
          polling, FR-20). aria-live announces transitions to screen readers. */}
      <div aria-live="polite" className="space-y-2">
        <h2 className="text-sm font-medium">Methods</h2>
        <ul className="space-y-1">
          {run.methods.map((method) => (
            <li
              key={method}
              className="flex items-center gap-2 text-sm text-muted-foreground"
            >
              <span className="text-foreground">{methodLabel(method)}</span>
              <span className="inline-flex items-center gap-1.5">
                {rowState.pulsing && (
                  <span
                    aria-hidden="true"
                    className="size-1.5 shrink-0 rounded-full bg-primary animate-pulse"
                  />
                )}
                {rowState.text}
              </span>
            </li>
          ))}
        </ul>
        {run.status === "complete" && (
          <p className="text-sm text-muted-foreground">
            Run complete — see Results and Diagnostics.
          </p>
        )}
      </div>

      {run.status === "failed" && (
        <div
          className="rounded-md bg-destructive/10 p-4 text-destructive"
          role="alert"
        >
          <p className="text-sm font-medium">The Run failed</p>
          <p className="mt-1 text-sm">
            {run.error?.message ?? "The Run failed."}
          </p>
          <button
            type="button"
            onClick={() => void retry()}
            disabled={retrying}
            className="mt-3 w-fit rounded-md bg-destructive px-3 py-1.5 text-sm font-medium text-white hover:bg-destructive/90 disabled:opacity-50"
          >
            {retrying ? "Retrying…" : "Retry run"}
          </button>
        </div>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
        <TabsList>
          <TabsTrigger value="results">Results</TabsTrigger>
          <TabsTrigger value="diagnostics">Diagnostics</TabsTrigger>
          <TabsTrigger value="interpretation">Interpretation</TabsTrigger>
          <TabsTrigger value="report">Report</TabsTrigger>
        </TabsList>

        <TabsContent value="results">
          {resultSet ? (
            <ResultsGrid resultSet={resultSet} runId={run._id} />
          ) : (
            <TabPlaceholder>
              {run.hasResults
                ? "Loading results…"
                : "Results appear once the Run completes."}
            </TabPlaceholder>
          )}
        </TabsContent>

        <TabsContent value="diagnostics">
          <TabPlaceholder>
            {run.hasDiagnostics
              ? "Diagnostics render in a later story (4.5)."
              : "Diagnostics appear once the Run completes."}
          </TabPlaceholder>
        </TabsContent>

        <TabsContent value="interpretation">
          <TabPlaceholder>
            Interpretation unlocks after Diagnostics review (Epic 5).
          </TabPlaceholder>
        </TabsContent>

        <TabsContent value="report">
          <TabPlaceholder>
            Report unlocks after Interpretation (Epic 6).
          </TabPlaceholder>
        </TabsContent>
      </Tabs>
    </div>
  );
}
