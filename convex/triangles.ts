import { ConvexError, v } from "convex/values";
import * as XLSX from "xlsx";
import { internal } from "./_generated/api";
import { action, internalMutation, mutation, query } from "./_generated/server";
import { requireMember } from "./lib/guards";

// FR-1 Triangle upload with duplicate detection. Scope (Story 3.1):
// upload → store → hash → dedupe → library list. No engine_service call, no
// wizard, no period/acceptance logic (Stories 3.2/3.3). "Parse" here is
// format-readability ONLY (can the bytes decode as CSV / open as an .xlsx
// workbook), never grid or actuarial validation.

const labelValidator = v.union(v.literal("paid"), v.literal("incurred"));
const formatValidator = v.union(v.literal("csv"), v.literal("xlsx"));

/**
 * Raw-file sha256 for duplicate detection (NOT the canonical-triangle-JSON
 * Lineage hash — that is a different hash computed at acceptance in 3.3).
 */
async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** `.csv` → "csv", `.xlsx` → "xlsx", anything else → null (unsupported). */
function formatFromFilename(filename: string): "csv" | "xlsx" | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".xlsx")) return "xlsx";
  return null;
}

/**
 * Persist-if-new for a (workspaceId, rawFileHash) pair (AC1, AC2).
 *
 * Concurrency: the by_workspace_hash read enters this mutation's read set, so
 * two concurrent identical uploads conflict under Convex OCC — the runtime
 * retries the loser, which then observes the winner and returns created:false.
 * Serialization is by construction, no manual retry code — same reasoning as
 * auditLogs.appendAuditEntry's chain-head read.
 */
export const insertIfNew = internalMutation({
  args: {
    workspaceId: v.string(),
    label: labelValidator,
    format: formatValidator,
    storageId: v.id("_storage"),
    rawFileHash: v.string(),
    filename: v.string(),
    uploadedBy: v.string(),
    uploadedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("triangles")
      .withIndex("by_workspace_hash", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("rawFileHash", args.rawFileHash),
      )
      .unique();
    if (existing !== null) {
      return { created: false as const, existingTriangleId: existing._id };
    }
    const triangleId = await ctx.db.insert("triangles", {
      ...args,
      status: "pending_validation",
    });
    return { created: true as const, triangleId };
  },
});

/**
 * Hand the browser a one-shot Convex storage upload URL (AC1). The client
 * POSTs the file to it and receives a storageId, then calls createFromUpload.
 */
export const generateUploadUrl = mutation({
  args: { workspaceId: v.string() },
  handler: async (ctx, { workspaceId }) => {
    await requireMember(ctx, workspaceId);
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Read the uploaded bytes, gate on format-readability, hash, dedupe, and
 * persist-or-discard (AC1, AC2, AC3).
 *
 * An action (not a mutation) because only actions can read storage bytes
 * (ctx.storage.get) and reach the AD-6 single writer via ctx.runMutation.
 * The audit append MUST go through internal.auditLogs.appendAuditEntry —
 * never inline an auditLogs insert here (AD-6: one writer only).
 */
export const createFromUpload = action({
  args: {
    workspaceId: v.string(),
    storageId: v.id("_storage"),
    label: labelValidator,
    filename: v.string(),
  },
  handler: async (
    ctx,
    { workspaceId, storageId, label, filename },
  ): Promise<
    | { status: "created"; triangleId: string }
    | { status: "duplicate"; existingTriangleId: string }
  > => {
    const { identity } = await requireMember(ctx, workspaceId);
    const actor = identity.subject;

    const blob = await ctx.storage.get(storageId);
    if (blob === null) {
      // Nothing to clean up — the blob is already gone.
      throw new ConvexError({
        code: "UPLOAD_NOT_FOUND",
        message: "The uploaded file could not be found in storage.",
      });
    }
    const bytes = await blob.arrayBuffer();

    const format = formatFromFilename(filename);
    if (format === null) {
      await ctx.storage.delete(storageId);
      throw new ConvexError({
        code: "UNSUPPORTED_FORMAT",
        message: `Unsupported file type for "${filename}". Upload a .csv or .xlsx file.`,
      });
    }

    // Format-readability gate (AC3). On ANY failure: delete the orphan blob
    // THEN throw a ConvexError naming the specific failure — no orphan may
    // remain, and no generic message.
    if (format === "csv") {
      // A fatal TextDecoder rejects invalid UTF-8, but runtimes disagree on
      // HOW: the edge runtime throws, while the Convex V8 action runtime
      // returns `undefined` instead. Handle both — a throw OR an undefined
      // result means the bytes are not valid UTF-8. Decode a Uint8Array view
      // (not the raw ArrayBuffer) for consistency with the xlsx branch.
      let text: string | undefined;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(
          new Uint8Array(bytes),
        );
      } catch {
        text = undefined;
      }
      if (text === undefined) {
        await ctx.storage.delete(storageId);
        throw new ConvexError({
          code: "UNREADABLE_CSV",
          message: "File is not valid UTF-8 text.",
        });
      }
      if (!text.split(/\r?\n/).some((line) => line.trim() !== "")) {
        await ctx.storage.delete(storageId);
        throw new ConvexError({
          code: "EMPTY_CSV",
          message: "File contains no readable rows.",
        });
      }
    } else {
      // XLSX openability gate. Two checks, BOTH required — a magic-byte check
      // alone is not enough, and neither is XLSX.read alone: SheetJS will
      // happily parse plain text / CSV as a one-cell workbook, so an .xlsx
      // label on a text file would otherwise sneak through. So: (1) the bytes
      // must carry the ZIP/OOXML local-header signature "PK\x03\x04", which
      // rejects non-zip payloads; (2) the workbook must then fully open with
      // at least one readable sheet, which rejects truncated/garbage zips and
      // zero-sheet workbooks. This is still openability, NOT grid/actuarial
      // validation (that is 3.2's engine_service /validate) — no cell values
      // are inspected here.
      const view = new Uint8Array(bytes);
      const isZip =
        view[0] === 0x50 &&
        view[1] === 0x4b &&
        view[2] === 0x03 &&
        view[3] === 0x04;
      let readable = false;
      if (isZip) {
        try {
          const wb = XLSX.read(view, { type: "array" });
          readable =
            wb.SheetNames.length > 0 &&
            wb.Sheets[wb.SheetNames[0]] !== undefined;
        } catch {
          readable = false;
        }
      }
      if (!readable) {
        await ctx.storage.delete(storageId);
        throw new ConvexError({
          code: "UNREADABLE_XLSX",
          message: "File is not a readable .xlsx workbook.",
        });
      }
    }

    const rawFileHash = await sha256Hex(bytes);
    const uploadedAt = new Date(Date.now()).toISOString();

    const result = await ctx.runMutation(internal.triangles.insertIfNew, {
      workspaceId,
      label,
      format,
      storageId,
      rawFileHash,
      filename,
      uploadedBy: actor,
      uploadedAt,
    });

    if (result.created) {
      await ctx.runMutation(internal.auditLogs.appendAuditEntry, {
        workspaceId,
        actor,
        eventType: "triangle.uploaded",
        payload: { triangleId: result.triangleId, rawFileHash, label, format, filename },
      });
      return { status: "created", triangleId: result.triangleId };
    }

    // Duplicate: discard the just-uploaded second copy (AC2 — no second stored
    // copy) and audit the collision. The original blob is untouched.
    await ctx.storage.delete(storageId);
    await ctx.runMutation(internal.auditLogs.appendAuditEntry, {
      workspaceId,
      actor,
      eventType: "triangle.upload_duplicate",
      payload: { existingTriangleId: result.existingTriangleId, rawFileHash },
    });
    return { status: "duplicate", existingTriangleId: result.existingTriangleId };
  },
});

/**
 * The Workspace's Triangles, newest first (AC1). Returns the full rawFileHash;
 * the UI truncates for display.
 */
export const listByWorkspace = query({
  args: { workspaceId: v.string() },
  handler: async (ctx, { workspaceId }) => {
    await requireMember(ctx, workspaceId);
    const rows = await ctx.db
      .query("triangles")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .order("desc")
      .collect();
    return rows.map((row) => ({
      _id: row._id,
      label: row.label,
      status: row.status,
      rawFileHash: row.rawFileHash,
      filename: row.filename,
      uploadedAt: row.uploadedAt,
    }));
  },
});
