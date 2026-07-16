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
});
