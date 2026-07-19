"use client";

import { useAuth } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { useParams } from "next/navigation";
import Link from "next/link";

import { CopyableHash } from "@/components/CopyableHash";
import { TriangleGrid } from "@/components/TriangleGrid";
import {
  TriangleStatusIndicator,
  type TriangleStatus,
} from "@/components/TriangleStatusIndicator";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

// Story 3.3 (AC4): the accepted-Triangle detail page. Read-only grid with
// Latest-Diagonal edge-marking, the confirmed periods, and BOTH hashes labelled
// distinctly (raw-file vs canonical-triangle-JSON) so the two are never
// conflated. Data surface (max-w-screen-2xl), like the library.

export default function TriangleDetailPage() {
  const { orgId } = useAuth();
  const params = useParams<{ triangleId: string }>();
  const triangleId = params.triangleId as Id<"triangles">;

  const triangle = useQuery(
    api.triangles.getById,
    orgId ? { workspaceId: orgId, triangleId } : "skip",
  );

  return (
    <div className="mx-auto w-full max-w-screen-2xl">
      <Link
        href="/triangles"
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← Triangles
      </Link>

      {triangle === undefined ? (
        <p className="mt-6 text-sm text-muted-foreground">Loading Triangle…</p>
      ) : triangle === null ? (
        <p className="mt-6 text-sm text-muted-foreground">
          This Triangle does not exist in your Workspace.
        </p>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-semibold">{triangle.filename}</h1>
            <span className="capitalize text-sm text-muted-foreground">
              {triangle.label}
            </span>
            <TriangleStatusIndicator status={triangle.status as TriangleStatus} />
          </div>

          {triangle.status === "validated" && triangle.acceptedTriangle ? (
            <div className="mt-6 space-y-6">
              <Link
                href={`/triangles/${triangleId}/run`}
                className="inline-block w-fit rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Run methods
              </Link>

              {triangle.periodMeta && (
                <p className="text-sm text-muted-foreground">
                  Origin periods: {triangle.periodMeta.originGranularity} ·
                  development: {triangle.periodMeta.developmentInterval}
                  {triangle.acceptedAt ? (
                    <>
                      {" "}
                      · accepted{" "}
                      <span className="numeric">{triangle.acceptedAt}</span>
                    </>
                  ) : null}
                </p>
              )}

              <TriangleGrid
                kind={triangle.acceptedTriangle.kind}
                originPeriods={triangle.acceptedTriangle.origin_periods}
                developmentPeriods={triangle.acceptedTriangle.development_periods}
                cells={triangle.acceptedTriangle.cells}
                showLatestDiagonal
              />

              <div className="flex flex-wrap gap-8">
                <CopyableHash label="Raw-file hash" hash={triangle.rawFileHash} />
                {triangle.triangleHash && (
                  <CopyableHash
                    label="Triangle hash (canonical)"
                    hash={triangle.triangleHash}
                  />
                )}
              </div>
            </div>
          ) : (
            <div className="mt-6 rounded-md border border-border p-6">
              <p className="text-sm text-muted-foreground">
                {triangle.status === "validation_failed"
                  ? "This Triangle failed validation, so it has no confirmed content. Fix the source file and upload it again."
                  : "This Triangle has not been accepted yet, so there is no confirmed content to display. Complete the upload wizard's Periods step to accept it."}
              </p>
              <div className="mt-4">
                <CopyableHash label="Raw-file hash" hash={triangle.rawFileHash} />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
