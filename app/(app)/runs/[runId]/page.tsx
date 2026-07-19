"use client";

import { useAuth } from "@clerk/nextjs";
import { ConvexError } from "convex/values";
import { useAction, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { RunDetail } from "@/components/RunDetail";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

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
  const { orgId } = useAuth();
  const params = useParams<{ runId: string }>();
  const runId = params.runId as Id<"runs">;

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
  const retryRun = useMutation(api.runs.retryRun);
  // Story 4.7: re-derivation is an action (it fetches the engine). It returns
  // the ReDerivationReport to RunDetail, which holds it in local state.
  const rederiveRun = useAction(api.runs.rederiveRun);
  // Story 5.5: trigger interpretation. An action (it fetches the engine); its
  // pending state drives the transient "Reading diagnostics…". The durable
  // outcome is the getRecommendations subscription above.
  const generateRecommendations = useAction(api.runs.generateRecommendations);

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
              onRetry={onRetry}
              onRederive={onRederive}
              onGenerateInterpretation={onGenerateInterpretation}
            />
          </div>
        </>
      )}
    </div>
  );
}
