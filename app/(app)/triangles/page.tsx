"use client";

import { useAuth } from "@clerk/nextjs";
import { useAction, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useRef, useState } from "react";

import {
  TriangleStatusIndicator,
  type TriangleStatus,
} from "@/components/TriangleStatusIndicator";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

type Label = "paid" | "incurred";

// Feedback after an upload attempt. A duplicate is NOT an error — it is the
// expected "already here" outcome (AC2); a parse/format rejection surfaces
// the engine error envelope's message verbatim (AC3), never a generic string.
type Feedback =
  | { kind: "duplicate"; existingTriangleId: string }
  | { kind: "error"; message: string }
  | { kind: "created" };

function shortHash(hash: string): string {
  return `${hash.slice(0, 12)}…`;
}

export default function TrianglesPage() {
  const { orgId } = useAuth();
  const triangles = useQuery(
    api.triangles.listByWorkspace,
    orgId ? { workspaceId: orgId } : "skip",
  );

  const generateUploadUrl = useMutation(api.triangles.generateUploadUrl);
  const createFromUpload = useAction(api.triangles.createFromUpload);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [label, setLabel] = useState<Label>("paid");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  async function handleFile(file: File) {
    if (!orgId) return;
    setBusy(true);
    setFeedback(null);
    try {
      const uploadUrl = await generateUploadUrl({ workspaceId: orgId });
      const posted = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!posted.ok) {
        throw new Error("The file could not be uploaded to storage.");
      }
      const { storageId } = (await posted.json()) as { storageId: string };

      const result = await createFromUpload({
        workspaceId: orgId,
        storageId: storageId as Id<"_storage">,
        label,
        filename: file.name,
      });

      if (result.status === "duplicate") {
        setFeedback({
          kind: "duplicate",
          existingTriangleId: result.existingTriangleId,
        });
      } else {
        setFeedback({ kind: "created" });
      }
    } catch (error) {
      // A thrown ConvexError carries the specific { code, message } envelope
      // from createFromUpload's readability gate — show its message verbatim.
      const message =
        error instanceof ConvexError &&
        typeof (error.data as { message?: unknown })?.message === "string"
          ? (error.data as { message: string }).message
          : "The upload failed. Please try again.";
      setFeedback({ kind: "error", message });
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function copyHash(hash: string) {
    await navigator.clipboard.writeText(hash);
    setCopiedHash(hash);
    window.setTimeout(() => setCopiedHash(null), 1500);
  }

  return (
    <div className="mx-auto w-full max-w-screen-2xl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Triangles</h1>

        {/* Minimal upload control — Story 3.2 replaces this with the full
            UX-DR8 three-step wizard and flagged grid preview. */}
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="triangle-label">
            Label
          </label>
          <select
            id="triangle-label"
            value={label}
            onChange={(e) => setLabel(e.target.value as Label)}
            disabled={busy}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          >
            <option value="paid">Paid</option>
            <option value="incurred">Incurred</option>
          </select>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
          <button
            type="button"
            disabled={busy || !orgId}
            onClick={() => fileInputRef.current?.click()}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? "Uploading…" : "Upload triangle"}
          </button>
        </div>
      </div>

      {feedback?.kind === "duplicate" && (
        <p className="mt-4 rounded-md bg-caution-subtle px-3 py-2 text-sm text-caution">
          Identical triangle already exists (hash match).{" "}
          <a
            href={`#triangle-${feedback.existingTriangleId}`}
            className="font-medium underline"
          >
            View the existing Triangle
          </a>
          .
        </p>
      )}
      {feedback?.kind === "error" && (
        <p className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {feedback.message}
        </p>
      )}
      {feedback?.kind === "created" && (
        <p className="mt-4 rounded-md bg-published-subtle px-3 py-2 text-sm text-published">
          Triangle uploaded.
        </p>
      )}

      <div className="mt-6">
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
