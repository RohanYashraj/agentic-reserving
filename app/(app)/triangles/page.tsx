"use client";

import { useAuth } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { useState } from "react";

import {
  TriangleStatusIndicator,
  type TriangleStatus,
} from "@/components/TriangleStatusIndicator";
import { UploadWizard } from "@/components/UploadWizard";
import { api } from "@/convex/_generated/api";

function shortHash(hash: string): string {
  return `${hash.slice(0, 12)}…`;
}

export default function TrianglesPage() {
  const { orgId } = useAuth();
  const triangles = useQuery(
    api.triangles.listByWorkspace,
    orgId ? { workspaceId: orgId } : "skip",
  );

  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  async function copyHash(hash: string) {
    await navigator.clipboard.writeText(hash);
    setCopiedHash(hash);
    window.setTimeout(() => setCopiedHash(null), 1500);
  }

  return (
    <div className="mx-auto w-full max-w-screen-2xl">
      <h1 className="text-xl font-semibold">Triangles</h1>

      {/* UX-DR8 three-step upload wizard (File → Validation → Periods). */}
      <div className="mt-6">
        {orgId && <UploadWizard workspaceId={orgId} />}
      </div>

      <div className="mt-10">
        <h2 className="mb-3 text-base font-semibold">Triangle library</h2>
        {triangles === undefined ? (
          <p className="text-sm text-muted-foreground">Loading Triangles…</p>
        ) : triangles.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No triangles yet. Upload the first one to start the quarter.
          </p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-2 pr-4 font-medium">Filename</th>
                <th className="py-2 pr-4 font-medium">Label</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Raw-file hash</th>
                <th className="py-2 pr-4 font-medium">Uploaded</th>
              </tr>
            </thead>
            <tbody>
              {triangles.map((triangle) => (
                <tr
                  key={triangle._id}
                  id={`triangle-${triangle._id}`}
                  className="border-b border-border/60 target:bg-caution-subtle"
                >
                  <td className="py-2 pr-4">{triangle.filename}</td>
                  <td className="py-2 pr-4 capitalize">{triangle.label}</td>
                  <td className="py-2 pr-4">
                    <TriangleStatusIndicator
                      status={triangle.status as TriangleStatus}
                    />
                  </td>
                  <td className="py-2 pr-4">
                    <button
                      type="button"
                      onClick={() => void copyHash(triangle.rawFileHash)}
                      title="Copy full hash"
                      className="numeric text-muted-foreground hover:text-foreground"
                    >
                      {copiedHash === triangle.rawFileHash
                        ? "Copied"
                        : shortHash(triangle.rawFileHash)}
                    </button>
                  </td>
                  <td className="numeric py-2 pr-4 text-muted-foreground">
                    {triangle.uploadedAt}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
