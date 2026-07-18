import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Tables are defined just-in-time by the story that first needs them.
export default defineSchema({
  // Append-only, per-Workspace hash-chained audit trail (AD-6, FR-15).
  // Exactly one internal mutation — auditLogs.appendAuditEntry — inserts
  // rows; NO code path may patch or delete them (enforced by
  // tests/audit-append-only.test.ts and code review).
  auditLogs: defineTable({
    workspaceId: v.string(), // Clerk org ID — the Workspace
    runId: v.optional(v.string()), // correlation key; v.id("runs") once Epic 4 adds the table
    actor: v.string(),
    eventType: v.string(),
    timestamp: v.string(), // ISO-8601 UTC
    payload: v.any(),
    seq: v.number(), // per-Workspace, 0-based, contiguous
    prevHash: v.string(), // previous entry's hash; "" for the genesis entry
    hash: v.string(), // sha256(canonicalJSON(entry) + prevHash), lowercase hex
    dedupeId: v.optional(v.string()), // at-least-once source key (e.g. svix-id)
  })
    // Chain walk + latest-entry lookup.
    .index("by_workspace_seq", ["workspaceId", "seq"])
    // Webhook replay idempotency.
    .index("by_workspace_dedupe", ["workspaceId", "dedupeId"]),

  // Uploaded Triangles (FR-1). Story 3.1 stores the raw upload, its raw-file
  // sha256 (duplicate detection — NOT the canonical-triangle-JSON Lineage
  // hash, which 3.3 computes at acceptance), and lists them per Workspace.
  // The `status` union widens per story (non-breaking): 3.1 pending_validation;
  // 3.2 adds validation_failed (engine /validate found findings); 3.3 adds the
  // accepted `validated` status. A clean 3.2 pass stays pending_validation until
  // the user confirms periods in 3.3.
  triangles: defineTable({
    workspaceId: v.string(), // Clerk org ID — the Workspace
    label: v.union(v.literal("paid"), v.literal("incurred")),
    status: v.union(
      v.literal("pending_validation"),
      v.literal("validation_failed"),
    ),
    format: v.union(v.literal("csv"), v.literal("xlsx")),
    storageId: v.id("_storage"),
    rawFileHash: v.string(), // sha256 lowercase hex of the raw uploaded bytes
    filename: v.string(),
    uploadedBy: v.string(), // Clerk user id (identity.subject)
    uploadedAt: v.string(), // ISO-8601 UTC
  })
    // Library list, newest-first per Workspace.
    .index("by_workspace", ["workspaceId"])
    // Duplicate lookup + OCC-serialized insert-if-absent.
    .index("by_workspace_hash", ["workspaceId", "rawFileHash"]),
});
