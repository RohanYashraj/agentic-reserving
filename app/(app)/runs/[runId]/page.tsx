"use client";

import { useAuth } from "@clerk/nextjs";
import { ConvexError } from "convex/values";
import { useMutation, useQuery } from "convex/react";
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
  const retryRun = useMutation(api.runs.retryRun);

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
              onRetry={onRetry}
            />
          </div>
        </>
      )}
    </div>
  );
}
