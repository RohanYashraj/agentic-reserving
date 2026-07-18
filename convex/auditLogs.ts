import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import {
  GENESIS_PREV_HASH,
  canonicalJSON,
  computeEntryHash,
  toHashableEntry,
} from "./lib/auditChain";
import { requireMember } from "./lib/guards";

// The sole writer's args: the recordEventArgs contract from Story 1.4's stub,
// plus dedupeId for at-least-once sources. Exported so tests pin the shape.
export const appendAuditEntryArgs = {
  workspaceId: v.string(),
  actor: v.string(),
  eventType: v.string(),
  payload: v.any(),
  runId: v.optional(v.string()),
  dedupeId: v.optional(v.string()),
};

/** The writer's args as a TS type (payload is v.any() → unknown). */
type AppendAuditEntryArgs = {
  workspaceId: string;
  actor: string;
  eventType: string;
  payload: unknown;
  runId?: string;
  dedupeId?: string;
};

/**
 * THE single writer of auditLogs (AD-6). internalMutation by design: never
 * public, so AD-4's requireMember rule (which governs public functions) does
 * not apply. Every consequential event in the system flows through here — or
 * through `appendAuditEntryInTransaction` below, which this delegates to and
 * which other mutations call directly to append atomically (see AD-6 note
 * there). This wrapper stays the entry point for ACTION callers (the Clerk
 * webhook in http.ts, the triangle actions) that reach the writer via
 * ctx.runMutation; a mutation has no ctx.runMutation, so it calls the helper.
 */
export const appendAuditEntry = internalMutation({
  args: appendAuditEntryArgs,
  handler: (ctx, args) => appendAuditEntryInTransaction(ctx, args),
});

/**
 * The chain-append body, callable inside ANY mutation's own transaction.
 * Story 4.1's `runs.createRun` calls this directly so the run insert and its
 * `run.created` audit entry commit ATOMICALLY (a mutation cannot
 * ctx.runMutation, and ctx.scheduler would split the transaction, risking a
 * queued run with no creation audit).
 *
 * AD-6 invariant preserved: this holds the ONLY auditLogs insert call-site in
 * the codebase (tests/audit-append-only.test.ts pins that). It is a hoisted
 * `export async function`, deliberately NOT a registered mutation —
 * `appendAuditEntry` remains the sole registered auditLogs writer.
 *
 * Concurrency: reading the chain head (by_workspace_seq desc, .first()) puts
 * it in the CALLING mutation's read set, so two concurrent appends to the same
 * Workspace conflict under Convex OCC and the runtime retries one
 * automatically — serialization is by construction, no manual retry code.
 *
 * Idempotency: callers with at-least-once delivery (webhooks) pass a
 * dedupeId; a replay returns the original { seq, hash } without inserting.
 */
export async function appendAuditEntryInTransaction(
  ctx: MutationCtx,
  args: AppendAuditEntryArgs,
): Promise<{ seq: number; hash: string }> {
  if (args.dedupeId !== undefined) {
    const existing = await ctx.db
      .query("auditLogs")
      .withIndex("by_workspace_dedupe", (q) =>
        q.eq("workspaceId", args.workspaceId).eq("dedupeId", args.dedupeId),
      )
      .unique();
    if (existing !== null) {
      // A replay is expected to carry identical content. If it diverges,
      // the original entry stands (the chain is immutable) — but the
      // divergence must not vanish silently. runId normalized to null so
      // absent-vs-absent compares equal (canonicalJSON rejects undefined).
      const stored = canonicalJSON({
        actor: existing.actor,
        eventType: existing.eventType,
        payload: existing.payload,
        runId: existing.runId ?? null,
      });
      const incoming = canonicalJSON({
        actor: args.actor,
        eventType: args.eventType,
        payload: args.payload,
        runId: args.runId ?? null,
      });
      if (stored !== incoming) {
        console.warn(
          `appendAuditEntry: dedupeId ${args.dedupeId} replayed with divergent content for workspace ${args.workspaceId}; keeping the original entry (seq ${existing.seq})`,
        );
      }
      return { seq: existing.seq, hash: existing.hash };
    }
  }

  const latest = await ctx.db
    .query("auditLogs")
    .withIndex("by_workspace_seq", (q) => q.eq("workspaceId", args.workspaceId))
    .order("desc")
    .first();
  const seq = latest === null ? 0 : latest.seq + 1;
  const prevHash = latest === null ? GENESIS_PREV_HASH : latest.hash;
  // Date.now() is frozen within a single mutation execution in Convex; an
  // OCC retry is a FRESH execution and may observe a later time. That is
  // fine — hash and insert happen in the same execution, so each committed
  // row is internally consistent; nothing relies on cross-retry timestamps.
  const timestamp = new Date(Date.now()).toISOString();

  const entry = toHashableEntry({
    workspaceId: args.workspaceId,
    runId: args.runId,
    actor: args.actor,
    eventType: args.eventType,
    timestamp,
    payload: args.payload,
    seq,
  });
  const hash = await computeEntryHash(entry, prevHash);

  await ctx.db.insert("auditLogs", {
    ...entry,
    prevHash,
    hash,
    ...(args.dedupeId !== undefined ? { dedupeId: args.dedupeId } : {}),
  });
  return { seq, hash };
}

export type ChainVerification =
  | { valid: true; length: number }
  | {
      valid: false;
      brokenAtSeq: number;
      reason: "seq_gap" | "prev_hash_mismatch" | "hash_mismatch";
    };

/**
 * Re-walks a Workspace's chain in seq order, re-computing every hash.
 * Returns the FIRST broken link; an empty chain is valid with length 0.
 *
 * v1 walks the full chain in one query — fine at current volume.
 * Pagination/cursoring is Epic 7's concern when the Audit Log browser
 * lands (FR-16).
 */
export const verifyChain = query({
  args: { workspaceId: v.string() },
  handler: async (ctx, { workspaceId }): Promise<ChainVerification> => {
    await requireMember(ctx, workspaceId);

    const entries = await ctx.db
      .query("auditLogs")
      .withIndex("by_workspace_seq", (q) => q.eq("workspaceId", workspaceId))
      .order("asc")
      .collect();

    let prevHash = GENESIS_PREV_HASH;
    for (let expectedSeq = 0; expectedSeq < entries.length; expectedSeq++) {
      const row = entries[expectedSeq];
      if (row.seq !== expectedSeq) {
        return { valid: false, brokenAtSeq: row.seq, reason: "seq_gap" };
      }
      if (row.prevHash !== prevHash) {
        return {
          valid: false,
          brokenAtSeq: row.seq,
          reason: "prev_hash_mismatch",
        };
      }
      const recomputed = await computeEntryHash(
        toHashableEntry(row),
        row.prevHash,
      );
      if (recomputed !== row.hash) {
        return { valid: false, brokenAtSeq: row.seq, reason: "hash_mismatch" };
      }
      prevHash = row.hash;
    }
    return { valid: true, length: entries.length };
  },
});
