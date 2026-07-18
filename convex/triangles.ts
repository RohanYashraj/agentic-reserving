import { ConvexError, v } from "convex/values";
import * as XLSX from "xlsx";
import { internal } from "./_generated/api";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import type {
  CanonicalizeResponse,
  ValidationReport,
} from "./lib/engineContract";
import { triangleValidator } from "./lib/engineContract";
import { callEngine } from "./lib/engineClient";
import { requireMember } from "./lib/guards";
import { parseTriangleGrid } from "./lib/triangleParse";

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

// --- Story 3.2: wizard validation via engine_service /validate --------------

/**
 * Fetch the fields validateTriangle needs. Internal (no guard) — the calling
 * action re-checks tenancy against the returned workspaceId before using it.
 */
export const getForValidation = internalQuery({
  args: { triangleId: v.id("triangles") },
  handler: async (ctx, { triangleId }) => {
    const row = await ctx.db.get(triangleId);
    if (row === null) return null;
    return {
      workspaceId: row.workspaceId,
      storageId: row.storageId,
      label: row.label,
      format: row.format,
      rawFileHash: row.rawFileHash,
      status: row.status,
    };
  },
});

/**
 * Mark a Triangle validation_failed after engine findings. Clean passes leave
 * the status as pending_validation (the Triangle still awaits period
 * confirmation in 3.3).
 *
 * Immutability guard (AD-3, Story 3.3): an ACCEPTED (`validated`) Triangle is
 * frozen — never demote it to validation_failed. Re-validating an accepted
 * Triangle (the function is public) must not alter its content, so skip the
 * patch when it is already `validated`. This makes markValidationFailed one of
 * the writers AC5 pins as unable to touch an accepted Triangle.
 */
export const markValidationFailed = internalMutation({
  args: { triangleId: v.id("triangles") },
  handler: async (ctx, { triangleId }) => {
    const row = await ctx.db.get(triangleId);
    if (row === null || row.status === "validated") return;
    await ctx.db.patch(triangleId, { status: "validation_failed" });
  },
});

/**
 * Parse the stored file into the engine Triangle, call engine_service
 * /validate, audit the result, and return the parsed grid + findings for the
 * wizard's flagged preview (FR-2, AC1–AC5).
 *
 * An action (not a mutation): it reads storage bytes, makes the outbound engine
 * HTTP call (AD-12 — only Convex calls the engine), and reaches the AD-6 single
 * writer via ctx.runMutation. The returned grid is transient/re-derivable —
 * NOT persisted; 3.3 persists the canonical form at acceptance (AD-3).
 */
export const validateTriangle = action({
  args: {
    workspaceId: v.string(),
    triangleId: v.id("triangles"),
  },
  handler: async (
    ctx,
    { workspaceId, triangleId },
  ): Promise<{
    triangle: ReturnType<typeof parseTriangleGrid>;
    report: ValidationReport;
    rawFileHash: string;
  }> => {
    const { identity } = await requireMember(ctx, workspaceId);
    const actor = identity.subject;

    // Tenancy: requireMember proves the caller belongs to workspaceId, but the
    // triangleId arg is attacker-controllable — confirm the row is actually in
    // this Workspace. Same FORBIDDEN-style opacity: NOT_FOUND either way.
    const t = await ctx.runQuery(internal.triangles.getForValidation, { triangleId });
    if (t === null || t.workspaceId !== workspaceId) {
      throw new ConvexError({
        code: "TRIANGLE_NOT_FOUND",
        message: "That Triangle does not exist in this Workspace.",
      });
    }
    // An accepted Triangle is immutable (Story 3.3). Re-validating it would
    // re-parse the pre-confirmation file and append a misleading post-acceptance
    // `triangle.validated` audit entry — short-circuit instead.
    if (t.status === "validated") {
      throw new ConvexError({
        code: "TRIANGLE_ALREADY_ACCEPTED",
        message: "This Triangle is already accepted and cannot be re-validated.",
      });
    }

    const blob = await ctx.storage.get(t.storageId);
    if (blob === null) {
      throw new ConvexError({
        code: "UPLOAD_NOT_FOUND",
        message: "The uploaded file could not be found in storage.",
      });
    }
    const bytes = await blob.arrayBuffer();

    // Parse CSV/XLSX → Triangle. A parse ConvexError (UNPARSEABLE_CELL /
    // MALFORMED_TRIANGLE / UNREADABLE_*) propagates verbatim; the wizard shows
    // its message under "Fix source and re-upload". No engine call is made.
    const triangle = parseTriangleGrid(bytes, t.format, t.label);

    // engine_service /validate takes parsed Triangle JSON (it never parses
    // files). Returns { valid, findings[] } — HTTP 200 even when invalid.
    const report = await callEngine<ValidationReport>("/validate", { triangle });

    // Audit the validation result (AD-6 — only appendAuditEntry writes auditLogs;
    // never inline an insert). runId omitted (no Run exists yet).
    await ctx.runMutation(internal.auditLogs.appendAuditEntry, {
      workspaceId,
      actor,
      eventType: "triangle.validated",
      payload: {
        triangleId,
        valid: report.valid,
        findingCount: report.findings.length,
        findingCodes: [...new Set(report.findings.map((f) => f.code))],
      },
    });

    if (!report.valid) {
      await ctx.runMutation(internal.triangles.markValidationFailed, { triangleId });
    }

    // rawFileHash is returned so the wizard can show the content hash on a
    // clean pass (AC4) without a second query. This is the raw-file sha256 —
    // NOT the canonical-triangle-JSON Lineage hash (3.3 computes that).
    return { triangle, report, rawFileHash: t.rawFileHash };
  },
});

// --- Story 3.3: period confirmation + Triangle acceptance --------------------

const periodMetaValidator = v.object({
  originGranularity: v.string(),
  developmentInterval: v.string(),
});

/**
 * Fetch the fields acceptTriangle needs. Internal (no guard) — the calling
 * action re-checks tenancy against the returned workspaceId. `status` is
 * returned so the action can fail fast; markAccepted re-reads it authoritatively.
 */
export const getForAcceptance = internalQuery({
  args: { triangleId: v.id("triangles") },
  handler: async (ctx, { triangleId }) => {
    const row = await ctx.db.get(triangleId);
    if (row === null) return null;
    return {
      workspaceId: row.workspaceId,
      status: row.status,
      storageId: row.storageId,
      format: row.format,
      label: row.label,
    };
  },
});

/**
 * Freeze a Triangle as accepted (Story 3.3, AC3, AC5). This is THE immutability
 * boundary: the status gate below only ever moves `pending_validation → validated`
 * and refuses every other starting status.
 *
 * Concurrency / idempotency: reading the row status into this mutation's read set
 * means two concurrent accepts conflict under Convex OCC — the runtime retries the
 * loser, which then observes `validated` and throws TRIANGLE_NOT_ACCEPTABLE. So a
 * validated row can never be re-accepted or have its content/hash overwritten,
 * and there is deliberately no other function that patches a validated row's
 * content — that is what makes AC5 ("no mutation can alter an accepted Triangle")
 * hold. Same read-into-read-set discipline as auditLogs.appendAuditEntry.
 */
export const markAccepted = internalMutation({
  args: {
    triangleId: v.id("triangles"),
    triangleHash: v.string(),
    acceptedTriangle: triangleValidator,
    periodMeta: periodMetaValidator,
    acceptedBy: v.string(),
    acceptedAt: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.triangleId);
    if (row === null) {
      throw new ConvexError({
        code: "TRIANGLE_NOT_FOUND",
        message: "That Triangle does not exist in this Workspace.",
      });
    }
    if (row.status !== "pending_validation") {
      // Refuses validation_failed AND already-validated (the immutability guard).
      throw new ConvexError({
        code: "TRIANGLE_NOT_ACCEPTABLE",
        message:
          "Only a validated-and-pending Triangle can be accepted. This Triangle is not in that state.",
      });
    }
    await ctx.db.patch(args.triangleId, {
      status: "validated",
      triangleHash: args.triangleHash,
      acceptedTriangle: args.acceptedTriangle,
      periodMeta: args.periodMeta,
      acceptedBy: args.acceptedBy,
      acceptedAt: args.acceptedAt,
    });
  },
});

/** A confirmed label is trimmed, non-empty, and unique within its axis. */
function assertConfirmedLabels(labels: string[], axis: string): string[] {
  const trimmed = labels.map((l) => l.trim());
  if (trimmed.some((l) => l === "")) {
    throw new ConvexError({
      code: "TRIANGLE_INVALID",
      message: `Every ${axis} needs a label before the Triangle can be accepted.`,
    });
  }
  if (new Set(trimmed).size !== trimmed.length) {
    throw new ConvexError({
      code: "TRIANGLE_INVALID",
      message: `Each ${axis} label must be unique.`,
    });
  }
  return trimmed;
}

/**
 * Accept a Triangle: confirm the user's periods, record the ENGINE-computed
 * canonical-triangle-JSON Lineage hash, freeze the content, and audit (FR-3,
 * AC1, AC3, AC5).
 *
 * An action: it re-reads the stored bytes, makes the outbound engine calls
 * (/validate re-check, /canonicalize) — only Convex may call the engine (AD-12) —
 * and reaches the AD-6 writer via ctx.runMutation.
 *
 * Chain of custody (AD-1/AD-3): the client sends only the CONFIRMED LABELS +
 * granularity, never cell values. The action re-parses the stored file and takes
 * the CELLS from that server-side parse — so the accepted, canonical Triangle is
 * provably the uploaded file's numbers, relabeled. A tampered or buggy client can
 * relabel but can never substitute figures; the frozen triangleHash certifies the
 * real upload, not client-authored data.
 */
export const acceptTriangle = action({
  args: {
    workspaceId: v.string(),
    triangleId: v.id("triangles"),
    confirmedOriginPeriods: v.array(v.string()),
    confirmedDevelopmentPeriods: v.array(v.string()),
    periodMeta: periodMetaValidator,
  },
  handler: async (
    ctx,
    { workspaceId, triangleId, confirmedOriginPeriods, confirmedDevelopmentPeriods, periodMeta },
  ): Promise<{ status: "accepted"; triangleId: string; triangleHash: string }> => {
    const { identity } = await requireMember(ctx, workspaceId);
    const actor = identity.subject;

    // Tenancy: requireMember proves membership in workspaceId; the triangleId
    // arg is attacker-controllable, so confirm the row is in this Workspace.
    const t = await ctx.runQuery(internal.triangles.getForAcceptance, { triangleId });
    if (t === null || t.workspaceId !== workspaceId) {
      throw new ConvexError({
        code: "TRIANGLE_NOT_FOUND",
        message: "That Triangle does not exist in this Workspace.",
      });
    }
    // Fail fast on an un-acceptable status; markAccepted re-checks authoritatively.
    if (t.status !== "pending_validation") {
      throw new ConvexError({
        code: "TRIANGLE_NOT_ACCEPTABLE",
        message:
          "Only a validated-and-pending Triangle can be accepted. This Triangle is not in that state.",
      });
    }

    // Re-parse the stored file — the CELLS are taken from here (never the client),
    // closing the chain of custody. A parse ConvexError propagates verbatim.
    const blob = await ctx.storage.get(t.storageId);
    if (blob === null) {
      throw new ConvexError({
        code: "UPLOAD_NOT_FOUND",
        message: "The uploaded file could not be found in storage.",
      });
    }
    const parsed = parseTriangleGrid(await blob.arrayBuffer(), t.format, t.label);

    // The user may relabel (period confirmation) but cannot change the shape:
    // confirmed label counts must match the parsed grid's dimensions.
    if (
      confirmedOriginPeriods.length !== parsed.origin_periods.length ||
      confirmedDevelopmentPeriods.length !== parsed.development_periods.length
    ) {
      throw new ConvexError({
        code: "PERIOD_COUNT_MISMATCH",
        message:
          "The confirmed periods do not match the triangle's shape. Reload the triangle and try again.",
      });
    }
    const originLabels = assertConfirmedLabels(confirmedOriginPeriods, "origin period");
    const developmentLabels = assertConfirmedLabels(
      confirmedDevelopmentPeriods,
      "development period",
    );

    // The Triangle we freeze: server-parsed cells + confirmed labels (AD-1 — cells
    // pass through untouched, never computed on).
    const confirmedTriangle = {
      kind: parsed.kind,
      origin_periods: originLabels,
      development_periods: developmentLabels,
      cells: parsed.cells,
    };

    // Fail-closed validity re-check — we never trust the status alone; the engine
    // is the authority (it also rejects any structurally bad relabeling → 422).
    const report = await callEngine<ValidationReport>("/validate", {
      triangle: confirmedTriangle,
    });
    if (!report.valid) {
      throw new ConvexError({
        code: "TRIANGLE_INVALID",
        message:
          "This triangle no longer passes validation with the confirmed periods. Fix the source and re-upload.",
      });
    }

    // Engine-computed canonical-triangle-JSON sha256 — THE Lineage hash (AD-11).
    // Never reimplement this serialization in TypeScript: it must be byte-identical
    // to the hash the engine stamps into Lineage at run time, or re-derivation
    // (Story 4.7) and the diagnostics hash-equality check silently break.
    const { triangleHash } = await callEngine<CanonicalizeResponse>("/canonicalize", {
      triangle: confirmedTriangle,
    });
    if (typeof triangleHash !== "string" || triangleHash === "") {
      // Defensive: never freeze an empty/garbage Lineage hash if the engine
      // returned a well-formed-looking-but-empty response.
      throw new ConvexError({
        code: "ENGINE_UNAVAILABLE",
        message: "The engine service did not return a Triangle hash.",
      });
    }

    const acceptedAt = new Date(Date.now()).toISOString();
    await ctx.runMutation(internal.triangles.markAccepted, {
      triangleId,
      triangleHash,
      acceptedTriangle: confirmedTriangle,
      periodMeta,
      acceptedBy: actor,
      acceptedAt,
    });

    // Audit the acceptance (AD-6 — only appendAuditEntry writes auditLogs; never
    // inline). Keep the payload lean — the full cell content lives on the row, not
    // in the audit entry.
    await ctx.runMutation(internal.auditLogs.appendAuditEntry, {
      workspaceId,
      actor,
      eventType: "triangle.accepted",
      payload: {
        triangleId,
        triangleHash,
        originGranularity: periodMeta.originGranularity,
        developmentInterval: periodMeta.developmentInterval,
        originCount: confirmedTriangle.origin_periods.length,
        developmentCount: confirmedTriangle.development_periods.length,
      },
    });

    return { status: "accepted", triangleId, triangleHash };
  },
});

/**
 * A single Triangle by id, for the detail page (Story 3.3, AC4). Public →
 * requireMember first; then a tenancy re-check (triangleId is attacker-
 * controllable) returns null for a row outside this Workspace — existence never
 * leaks. Returns the accepted content + both hashes when present.
 */
export const getById = query({
  args: { workspaceId: v.string(), triangleId: v.id("triangles") },
  handler: async (ctx, { workspaceId, triangleId }) => {
    await requireMember(ctx, workspaceId);
    const row = await ctx.db.get(triangleId);
    if (row === null || row.workspaceId !== workspaceId) return null;
    return {
      _id: row._id,
      label: row.label,
      status: row.status,
      filename: row.filename,
      rawFileHash: row.rawFileHash,
      triangleHash: row.triangleHash ?? null,
      acceptedTriangle: row.acceptedTriangle ?? null,
      periodMeta: row.periodMeta ?? null,
      acceptedBy: row.acceptedBy ?? null,
      acceptedAt: row.acceptedAt ?? null,
      uploadedAt: row.uploadedAt,
    };
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
