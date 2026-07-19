"use client";

import { useAuth } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { RunConfig } from "@/components/RunConfig";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

// Story 4.1: the "Run methods" surface, reached from an accepted Triangle. Flow
// surface. Only a `validated` Triangle is runnable — anything else renders a
// guard state rather than the config form.

export default function RunConfigPage() {
  const { orgId } = useAuth();
  const params = useParams<{ triangleId: string }>();
  const triangleId = params.triangleId as Id<"triangles">;

  const triangle = useQuery(
    api.triangles.getById,
    orgId ? { workspaceId: orgId, triangleId } : "skip",
  );

  return (
    <div className="mx-auto w-full max-w-4xl">
      <Link
        href={`/triangles/${triangleId}`}
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← Triangle
      </Link>

      <h1 className="mt-4 text-xl font-semibold">Run methods</h1>

      {triangle === undefined ? (
        <p className="mt-6 text-sm text-muted-foreground">Loading Triangle…</p>
      ) : triangle === null ? (
        <p className="mt-6 text-sm text-muted-foreground">
          This Triangle does not exist in your Workspace.
        </p>
      ) : triangle.status !== "validated" || !triangle.acceptedTriangle ? (
        <div className="mt-6 rounded-md border border-border p-6">
          <p className="text-sm text-muted-foreground">
            This Triangle isn&apos;t accepted yet, so it can&apos;t be run.
            Accept it in the upload wizard&apos;s Periods step first.
          </p>
        </div>
      ) : (
        <div className="mt-6">
          <p className="mb-6 text-sm text-muted-foreground">
            {triangle.filename}
          </p>
          {orgId && (
            <RunConfig
              workspaceId={orgId}
              triangleId={triangleId}
              triangle={triangle.acceptedTriangle}
            />
          )}
        </div>
      )}
    </div>
  );
}
