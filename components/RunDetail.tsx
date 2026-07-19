"use client";

import { useEffect, useState, type ReactNode } from "react";

import { DiagnosticsPanels } from "@/components/DiagnosticsPanels";
import { InterpretationTab } from "@/components/interpretation/InterpretationTab";
import type { RecommendationOverride } from "@/components/interpretation/RecommendationTable";
import { RederivationPanel } from "@/components/RederivationPanel";
import { ReportTab, type ReportSections } from "@/components/report/ReportTab";
import type { SeniorActuary } from "@/components/report/ReportApprovalBar";
import { ResultsGrid } from "@/components/ResultsGrid";
import { StatusBadge } from "@/components/StatusBadge";
import { StepRail, type RunStatus } from "@/components/StepRail";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { methodLabel } from "@/components/methods";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import type {
  DiagnosticsBundle,
  Method,
  ReDerivationReport,
  Recommendations,
  ResultSet,
} from "@/convex/lib/engineContract";

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
  // Story 5.5: gates the Interpretation tab (getRun returns it). A boolean —
  // NO figures leak (AD-1); the recommendations arrive via getRecommendations.
  hasRecommendations: boolean;
  // Story 6.1: gates the Report tab's editor vs. creation state (getRun returns
  // it, runs.ts:507). A boolean — the report itself arrives via getReserveReport.
  hasReserveReport: boolean;
  // Story 5.6: the durable per-Run interpretation-failure state (getRun returns
  // it). Survives reload (D2); the reason enum + timestamp only, NO figures.
  interpretationFailure: {
    reason: "model_unavailable" | "cost_ceiling_exceeded" | "interpretation_timeout";
    at: number;
  } | null;
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
  diagnosticsBundle,
  recommendations,
  report,
  onRetry,
  onRederive,
  onGenerateInterpretation,
  onEditReport,
  onCreateManual,
  onGenerateDraft,
  onSubmitForReview,
  seniorActuaries = [],
  engineOnly = false,
  overrides = [],
  canOverride = false,
  onOverride,
  canApprove = false,
  overrideCount = 0,
  onApprove,
  onStartNewVersion,
}: {
  run: RunView;
  resultSet?: ResultSet | null;
  diagnosticsBundle?: DiagnosticsBundle | null;
  // Story 5.5: the interpretation read surface (getRecommendations) — feeds both
  // the Interpretation tab and the Diagnostics rail's "cited by N" backlink.
  recommendations?: Recommendations | null;
  // Story 6.1: the Reserve Report read surface (getReserveReport) — feeds the
  // Report tab editor and unions into the rail's "cited by N" tally. Optional so
  // the surface degrades to the placeholder where unwired (pre-6.1 tests).
  report?: Doc<"reserveReports"> | null;
  // Story 5.6: the workspace-global Engine-Only Mode flag (run-scoped mirror of
  // the global banner). Affects ONLY the Interpretation tab (disables its
  // trigger) — Upload/Results/Diagnostics stay fully functional (NFR-2 / AC-3).
  // Default false so pre-5.6 tests + the placeholder fallback still render.
  engineOnly?: boolean;
  onRetry: () => Promise<void> | void;
  // Story 4.7: re-derive the stored ResultSet from its Lineage (FR-6). Optional
  // so the surface degrades cleanly where it is not wired (and pre-4.7 tests).
  onRederive?: () => Promise<ReDerivationReport>;
  // Story 5.5: trigger interpretation (generateRecommendations). Optional so the
  // surface degrades cleanly where it is not wired (and pre-5.5 tests).
  onGenerateInterpretation?: () => Promise<{
    status: "accepted" | "rejected";
  }>;
  // Story 6.1: the report edit / manual-create / generate-draft handlers. All
  // optional — when unwired the Report tab degrades to the placeholder (6.3),
  // mirroring how the Interpretation placeholder degrades.
  onEditReport?: (
    sections: ReportSections,
  ) => Promise<{ contentVersion: number }>;
  onCreateManual?: () => Promise<unknown>;
  onGenerateDraft?: () => Promise<{ status: "accepted" | "rejected" }>;
  // Story 6.2: submit-for-review handler + the Senior-Actuary picker source
  // (client-side Clerk, D4). Optional so the surface degrades where unwired.
  onSubmitForReview?: (assignee: string | null) => Promise<void>;
  seniorActuaries?: SeniorActuary[];
  // Story 6.3: the Senior-Actuary override surface, threaded to InterpretationTab.
  // `overrides` defaults to [] so pre-6.3 call sites / the placeholder path
  // degrade cleanly (the interpretation tab still renders without override
  // capability); `canOverride` gates the live-vs-disabled control (D7).
  overrides?: RecommendationOverride[];
  canOverride?: boolean;
  onOverride?: (
    origin: string,
    overridingMethod: Method,
    reason: string,
  ) => Promise<void>;
  // Story 6.4 (D7): the Senior-Actuary approve surface, threaded to ReportTab.
  // `canApprove` gates the approve region (display only; the server requireRole
  // is the authority, AD-4); `overrideCount` (distinct overridden origins) feeds
  // the approval dialog. All optional so pre-6.4 call sites / the placeholder
  // path degrade cleanly (no approve controls).
  canApprove?: boolean;
  overrideCount?: number;
  onApprove?: () => Promise<void>;
  onStartNewVersion?: () => Promise<void>;
}) {
  const [tab, setTab] = useState<TabKey>("results");
  const [retrying, setRetrying] = useState(false);
  // Re-derivation is on-demand: the report lives in local state (never
  // persisted — immutability, AC1), a re-run re-fetches. null = not yet run.
  const [rederiving, setRederiving] = useState(false);
  const [rederiveReport, setRederiveReport] =
    useState<ReDerivationReport | null>(null);
  const [rederiveError, setRederiveError] = useState<string | null>(null);
  // Deep-link (Story 4.6 AC4): a URL hash names a Diagnostic to open. On mount
  // and on in-app hashchange (future citation chips set location.hash), a
  // non-empty hash switches to the Diagnostics tab and targets the element.
  // The fragment IS the canonical `dx:…` id verbatim (raw ":" kept — the rail
  // resolves it via getElementById, never a CSS selector).
  const [initialSelectedId, setInitialSelectedId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    function applyHash() {
      const id = window.location.hash.replace(/^#/, "");
      if (id) {
        setInitialSelectedId(id);
        setTab("diagnostics");
      } else {
        // Empty hash → clear the latched selection so it can't re-drive an old
        // deep-link target on a later navigation.
        setInitialSelectedId(null);
      }
    }
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, []);

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

  async function rederive() {
    if (!onRederive) return;
    setRederiving(true);
    setRederiveError(null);
    try {
      setRederiveReport(await onRederive());
    } catch (err) {
      setRederiveReport(null);
      setRederiveError(
        err instanceof Error ? err.message : "Re-derivation could not be run.",
      );
    } finally {
      setRederiving(false);
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

      {/* Story 4.7: re-derive the stored ResultSet from its Lineage (FR-6) —
          the auditor's reproducibility proof. On-demand; the outcome renders
          inline. Only a completed Run can be re-derived. */}
      {run.status === "complete" && onRederive && (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void rederive()}
              disabled={rederiving}
              className="w-fit rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
            >
              {rederiving ? "Re-deriving…" : "Re-derive"}
            </button>
            <span className="text-sm text-muted-foreground">
              Replay this ResultSet from its Lineage to prove reproducibility.
            </span>
          </div>

          {rederiveError && (
            <p
              className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
              role="alert"
            >
              {rederiveError}
            </p>
          )}

          {rederiveReport && (
            <RederivationPanel report={rederiveReport} />
          )}
        </div>
      )}

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
          {diagnosticsBundle ? (
            <DiagnosticsPanels
              diagnosticsBundle={diagnosticsBundle}
              runId={run._id}
              initialSelectedId={initialSelectedId}
              recommendations={recommendations ?? null}
              report={report ?? null}
            />
          ) : (
            <TabPlaceholder>
              {run.hasDiagnostics
                ? "Loading diagnostics…"
                : "Diagnostics appear once the Run completes."}
            </TabPlaceholder>
          )}
        </TabsContent>

        <TabsContent value="interpretation">
          {onGenerateInterpretation ? (
            <InterpretationTab
              run={run}
              recommendations={recommendations ?? null}
              diagnosticsBundle={diagnosticsBundle ?? null}
              onGenerateInterpretation={onGenerateInterpretation}
              engineOnly={engineOnly}
              overrides={overrides}
              canOverride={canOverride}
              onOverride={onOverride}
            />
          ) : (
            <TabPlaceholder>
              Interpretation unlocks after Diagnostics review (Epic 5).
            </TabPlaceholder>
          )}
        </TabsContent>

        <TabsContent value="report">
          {onEditReport && onCreateManual && onGenerateDraft ? (
            <ReportTab
              run={run}
              report={report ?? null}
              diagnosticsBundle={diagnosticsBundle ?? null}
              engineOnly={engineOnly}
              seniorActuaries={seniorActuaries}
              onEditReport={onEditReport}
              onCreateManual={onCreateManual}
              onGenerateDraft={onGenerateDraft}
              onSubmitForReview={onSubmitForReview}
              canApprove={canApprove}
              overrideCount={overrideCount}
              onApprove={onApprove}
              onStartNewVersion={onStartNewVersion}
            />
          ) : (
            <TabPlaceholder>
              Report unlocks after Interpretation (Epic 6).
            </TabPlaceholder>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
