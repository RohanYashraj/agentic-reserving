"use client";

import { useAuth, useOrganization } from "@clerk/nextjs";
import { ConvexError } from "convex/values";
import { useAction, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";

import { RunDetail } from "@/components/RunDetail";
import type { SeniorActuary } from "@/components/report/ReportApprovalBar";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { Method } from "@/convex/lib/engineContract";
import { normalizeRole } from "@/convex/lib/guards";

// Story 4.3 (AC1/2/3/5): the live Run-detail surface. useQuery(getRun) IS a
// Convex subscription — status updates arrive reactively with no polling
// (FR-20), and leaving/returning re-reads exact server state on mount (AC5).
// Mirrors the triangle detail page skeleton (loading / null / loaded).

function errorMessage(error: unknown): string {
  return error instanceof ConvexError &&
    typeof (error.data as { message?: unknown })?.message === "string"
    ? (error.data as { message: string }).message
    : "Something went wrong. Please try again.";
}

export default function RunDetailPage() {
  const { orgId, orgRole } = useAuth();
  const params = useParams<{ runId: string }>();
  const runId = params.runId as Id<"runs">;
  // Story 6.3 (D7): the FIRST current-user-role client signal — is the signed-in
  // user a Senior Actuary. DISPLAY gating only (the live-vs-disabled Override
  // control); the server `requireRole` is the authority (AD-4).
  const canOverride = normalizeRole(orgRole) === "senior_actuary";

  const run = useQuery(
    api.runs.getRun,
    orgId ? { workspaceId: orgId, runId } : "skip",
  );
  // Second, immutable-once-stored subscription: the ResultSet figures. Gated on
  // hasResults so no figures are fetched before the Run completes (AC5); the
  // ResultSet never churns once stored (Story 4.4).
  const resultSet = useQuery(
    api.runs.getResultSet,
    orgId && run?.hasResults ? { workspaceId: orgId, runId } : "skip",
  );
  // Third subscription: the DiagnosticsBundle. Gated on hasDiagnostics so no
  // diagnostics are fetched before the Run completes (AC7); immutable-once-
  // stored, so it settles immediately and never churns (Story 4.5).
  const diagnosticsBundle = useQuery(
    api.runs.getDiagnosticsBundle,
    orgId && run?.hasDiagnostics ? { workspaceId: orgId, runId } : "skip",
  );
  // Fourth subscription (Story 5.5): the accepted Recommendations document — the
  // DURABLE interpretation state (AC4). Gated on hasRecommendations so nothing is
  // fetched before an accepted interpretation exists; when storeRecommendations
  // patches runs.recommendations the boolean flips and the table populates
  // reactively (FR-20, no polling), surviving reload.
  const recommendations = useQuery(
    api.runs.getRecommendations,
    orgId && run?.hasRecommendations ? { workspaceId: orgId, runId } : "skip",
  );
  // Story 6.3: the Senior-Actuary overrides (D9). Gated on hasRecommendations
  // exactly like getRecommendations — overrides only exist when recommendations
  // do. On an override confirm the mutation inserts a row → this subscription
  // re-emits → the table re-renders (no optimistic UI, reload-durable, FR-20).
  const overrides = useQuery(
    api.runs.getRecommendationOverrides,
    orgId && run?.hasRecommendations ? { workspaceId: orgId, runId } : "skip",
  );
  // Fifth subscription (Story 5.6): the workspace-global Engine-Only Mode. The
  // banner subscribes to the same query in the app shell; Convex dedupes the two
  // subscriptions, so this run-scoped mirror adds no extra server cost. It
  // disables the Interpretation trigger while the mode holds (AC-3).
  const mode = useQuery(
    api.interpretationMode.getInterpretationMode,
    orgId ? { workspaceId: orgId } : "skip",
  );
  // Sixth subscription (Story 6.1): the Reserve Report row. Gated on
  // hasReserveReport exactly like getRecommendations gates on hasRecommendations
  // — nothing is fetched before a report exists. When editReserveReport /
  // createManualReport patch/insert the row the boolean flips and the editor
  // populates reactively (FR-20, no polling; survives reload).
  const report = useQuery(
    api.runs.getReserveReport,
    orgId && run?.hasReserveReport ? { workspaceId: orgId, runId } : "skip",
  );
  const retryRun = useMutation(api.runs.retryRun);
  // Story 4.7: re-derivation is an action (it fetches the engine). It returns
  // the ReDerivationReport to RunDetail, which holds it in local state.
  const rederiveRun = useAction(api.runs.rederiveRun);
  // Story 5.5: trigger interpretation. An action (it fetches the engine); its
  // pending state drives the transient "Reading diagnostics…". The durable
  // outcome is the getRecommendations subscription above.
  const generateRecommendations = useAction(api.runs.generateRecommendations);
  // Story 6.1: the report edit + manual-create mutations and the 5.4 draft
  // action (6.1 is its first UI caller, D6). The durable outcomes are the
  // getReserveReport subscription above.
  const editReserveReport = useMutation(api.runs.editReserveReport);
  const createManualReport = useMutation(api.runs.createManualReport);
  const generateReserveReport = useAction(api.runs.generateReserveReport);
  // Story 6.2: the submit-for-review mutation. Its durable outcome is the
  // getReserveReport subscription above (status flips to awaiting_review on
  // server ack — no optimistic UI, AC-2/D6).
  const submitReportForReview = useMutation(api.runs.submitReportForReview);
  // Story 6.3: the Senior-Actuary override mutation. Its durable outcome is the
  // getRecommendationOverrides subscription above (a row inserted on server ack —
  // no optimistic UI, AC-2/D6/D9).
  const overrideRecommendation = useMutation(api.runs.overrideRecommendation);

  // Story 6.2 (D4): the Senior-Actuary assignee picker source, built CLIENT-side
  // from Clerk memberships (Convex has no Clerk-backend seam). Roles are emitted
  // as `org:senior_actuary`; normalizeRole strips the prefix. Empty while the
  // membership list loads. The assignee is advisory routing only — the server
  // never verifies it (the lock + status flip are the enforced parts).
  const { memberships } = useOrganization({
    memberships: { infinite: true },
  });
  const seniorActuaries = useMemo<SeniorActuary[]>(() => {
    return (memberships?.data ?? [])
      .filter((m) => normalizeRole(m.role) === "senior_actuary")
      .map((m) => ({
        id: m.publicUserData?.userId ?? m.id,
        name:
          [m.publicUserData?.firstName, m.publicUserData?.lastName]
            .filter(Boolean)
            .join(" ") ||
          m.publicUserData?.identifier ||
          (m.publicUserData?.userId ?? m.id),
      }));
  }, [memberships?.data]);

  const [retryError, setRetryError] = useState<string | null>(null);

  async function onRetry() {
    if (!orgId) return;
    setRetryError(null);
    try {
      await retryRun({ workspaceId: orgId, runId });
    } catch (err) {
      setRetryError(errorMessage(err));
    }
  }

  async function onRederive() {
    if (!orgId) throw new Error("No active Workspace.");
    try {
      return await rederiveRun({ workspaceId: orgId, runId });
    } catch (err) {
      // Surface a readable message; RunDetail renders it in the panel.
      throw new Error(errorMessage(err));
    }
  }

  async function onGenerateInterpretation() {
    if (!orgId) throw new Error("No active Workspace.");
    try {
      // Returns { status: "accepted" | "rejected" }; a rejected outcome is a
      // clean value the tab renders as the quiet failure. model_unavailable /
      // transient errors throw and surface inline (the Engine-Only banner is 5.6).
      return await generateRecommendations({ workspaceId: orgId, runId });
    } catch (err) {
      throw new Error(errorMessage(err));
    }
  }

  async function onEditReport(sections: {
    executiveSummary: string;
    methodSelectionRationale: string;
    movementCommentary: string;
    limitations: string;
  }) {
    if (!orgId) throw new Error("No active Workspace.");
    try {
      return await editReserveReport({ workspaceId: orgId, runId, sections });
    } catch (err) {
      throw new Error(errorMessage(err));
    }
  }

  async function onCreateManual() {
    if (!orgId) throw new Error("No active Workspace.");
    try {
      return await createManualReport({ workspaceId: orgId, runId });
    } catch (err) {
      throw new Error(errorMessage(err));
    }
  }

  async function onGenerateDraft() {
    if (!orgId) throw new Error("No active Workspace.");
    try {
      // Returns { status: "accepted" | "rejected" }; a rejected outcome is a
      // clean value the tab renders as the quiet failure. A model_unavailable
      // error flips the global Engine-Only banner via the 5.6 action wiring.
      return await generateReserveReport({ workspaceId: orgId, runId });
    } catch (err) {
      throw new Error(errorMessage(err));
    }
  }

  async function onOverride(
    origin: string,
    overridingMethod: Method,
    reason: string,
  ) {
    if (!orgId) throw new Error("No active Workspace.");
    try {
      // Returns null; the durable outcome lands via the getRecommendationOverrides
      // subscription on server ack (no optimistic UI, AC-2/D9). Surface readable
      // errors (FORBIDDEN / REASON_REQUIRED / ORIGIN_NOT_FOUND …) inline in the
      // dialog.
      await overrideRecommendation({
        workspaceId: orgId,
        runId,
        origin,
        overridingMethod,
        reason,
      });
    } catch (err) {
      throw new Error(errorMessage(err));
    }
  }

  async function onSubmitForReview(assignee: string | null) {
    if (!orgId) throw new Error("No active Workspace.");
    try {
      // The status flip lands durably via the getReserveReport subscription on
      // server ack (no optimistic UI, AC-2/D6). Pass through the advisory
      // assignee (or undefined when unassigned).
      await submitReportForReview({
        workspaceId: orgId,
        runId,
        assignee: assignee ?? undefined,
      });
    } catch (err) {
      throw new Error(errorMessage(err));
    }
  }

  return (
    <div className="mx-auto w-full max-w-screen-2xl">
      {run === undefined ? (
        <p className="mt-6 text-sm text-muted-foreground">Loading Run…</p>
      ) : run === null ? (
        <p className="mt-6 text-sm text-muted-foreground">
          This Run does not exist in your Workspace.
        </p>
      ) : (
        <>
          <Link
            href={`/triangles/${run.triangleId}`}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← Triangle
          </Link>

          <h1 className="mt-4 text-xl font-semibold">Run detail</h1>

          {retryError && (
            <p
              className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
              aria-live="polite"
            >
              {retryError}
            </p>
          )}

          <div className="mt-6">
            <RunDetail
              run={run}
              resultSet={resultSet ?? null}
              diagnosticsBundle={diagnosticsBundle ?? null}
              recommendations={recommendations ?? null}
              report={report ?? null}
              engineOnly={mode?.engineOnly ?? false}
              onRetry={onRetry}
              onRederive={onRederive}
              onGenerateInterpretation={onGenerateInterpretation}
              onEditReport={onEditReport}
              onCreateManual={onCreateManual}
              onGenerateDraft={onGenerateDraft}
              onSubmitForReview={onSubmitForReview}
              seniorActuaries={seniorActuaries}
              overrides={overrides ?? []}
              canOverride={canOverride}
              onOverride={onOverride}
            />
          </div>
        </>
      )}
    </div>
  );
}
