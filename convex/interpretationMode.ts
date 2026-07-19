import { ConvexError, v } from "convex/values";
import { appendAuditEntryInTransaction } from "./auditLogs";
import { internal } from "./_generated/api";
import { action, internalMutation, query } from "./_generated/server";
import { callEngine } from "./lib/engineClient";
import { requireMember } from "./lib/guards";

// Story 5.6 (AD-9, D2/D3/D4): the workspace-level Engine-Only Mode concern.
// runs.ts stays run-scoped; this file owns the durable, server-derived,
// client-subscribed Engine-Only flag (`interpretationModes`). It writes the row
// ONLY from server code (the two interpretation actions on model outage + the
// recovery probe) and reuses `appendAuditEntryInTransaction` as the single
// audit writer (AD-6). No arithmetic, no figures (AD-1).

/**
 * Edge-triggered, idempotent Engine-Only Mode transition (D4). Writes the
 * per-Workspace `interpretationModes` row AND audit-logs the transition ONLY
 * when the boolean actually flips — re-entering while already Engine-Only (or
 * clearing while already clear) is a no-op with NO write and NO audit, so a
 * second `model_unavailable` never produces a duplicate `mode.engineOnlyEntered`
 * ("once" enforced at the source, UX-DR4). This is the ONLY place mode audit
 * events are written (single writer). internalMutation — off the public surface
 * (no authGuard registration); the trusted actions/probe are its only callers.
 */
export const transitionEngineOnlyMode = internalMutation({
  args: {
    workspaceId: v.string(),
    engineOnly: v.boolean(),
    actor: v.string(),
    reason: v.optional(v.string()),
    runId: v.optional(v.id("runs")),
  },
  returns: v.object({ changed: v.boolean() }),
  handler: async (ctx, { workspaceId, engineOnly, actor, reason, runId }) => {
    const existing = await ctx.db
      .query("interpretationModes")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .unique();

    const current = existing?.engineOnly ?? false;
    // Idempotent edge trigger (D4): no flip → no write, no audit.
    if (current === engineOnly) {
      return { changed: false };
    }

    const since = Date.now();
    if (existing === null) {
      await ctx.db.insert("interpretationModes", {
        workspaceId,
        engineOnly,
        since,
        reason,
        lastRunId: runId,
      });
    } else {
      await ctx.db.patch(existing._id, {
        engineOnly,
        since,
        reason,
        lastRunId: runId,
      });
    }

    // Audit the transition (AD-6) — lean payload, NO figures. Entering carries
    // the reason; exiting is a clean restore.
    await appendAuditEntryInTransaction(ctx, {
      workspaceId,
      actor,
      eventType: engineOnly ? "mode.engineOnlyEntered" : "mode.engineOnlyExited",
      runId: runId ?? undefined,
      payload: engineOnly ? { reason: reason ?? null, runId: runId ?? null } : { runId: runId ?? null },
    });

    return { changed: true };
  },
});

/**
 * The reactive Engine-Only Mode read surface (D2). The global banner + the run
 * page subscribe here via `useQuery` (live, no polling — FR-20). Public →
 * `requireMember` first (AD-4, no exceptions). Projects the row to the flag +
 * provenance, or the honest default for a Workspace that never entered the mode.
 */
export const getInterpretationMode = query({
  args: { workspaceId: v.string() },
  returns: v.object({
    engineOnly: v.boolean(),
    since: v.union(v.number(), v.null()),
    reason: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, { workspaceId }) => {
    await requireMember(ctx, workspaceId);
    const row = await ctx.db
      .query("interpretationModes")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .unique();
    if (row === null) {
      return { engineOnly: false, since: null, reason: null };
    }
    return {
      engineOnly: row.engineOnly,
      since: row.since,
      reason: row.reason ?? null,
    };
  },
});

/**
 * The banner's "Retry" / "Check again" recovery path (D3). A public ACTION (it
 * must `fetch` the engine): `requireMember` is its FIRST statement (AD-4),
 * BEFORE the engine call. It builds only the model via the cheap
 * `GET /interpretation/health` probe (no full interpretation) and derives the
 * mode server-side: 200 → clear Engine-Only Mode; `engine.model_unavailable` →
 * (re-)enter it; any other (transient) error re-throws unchanged (the mode is
 * untouched). The transition is idempotent (D4) — a no-op when nothing flips.
 */
export const probeInterpretationMode = action({
  args: { workspaceId: v.string() },
  returns: v.object({ engineOnly: v.boolean() }),
  handler: async (ctx, { workspaceId }): Promise<{ engineOnly: boolean }> => {
    // AD-4: identity + Workspace membership before anything else (before fetch).
    const { identity } = await requireMember(ctx, workspaceId);
    const actor = identity.subject;

    try {
      await callEngine<{ ok: boolean }>("/interpretation/health", null, {
        method: "GET",
      });
    } catch (err) {
      const code =
        err instanceof ConvexError
          ? (err.data as { code?: string })?.code
          : undefined;
      if (code === "engine.model_unavailable") {
        // The model is still unreachable — (re-)enter Engine-Only Mode.
        await ctx.runMutation(internal.interpretationMode.transitionEngineOnlyMode, {
          workspaceId,
          engineOnly: true,
          actor,
          reason: "model_unavailable",
        });
        return { engineOnly: true };
      }
      // Transient (ENGINE_UNAVAILABLE / ENGINE_UNCONFIGURED) — leave the mode
      // as-is and surface the error; the banner shows a retry.
      throw err;
    }

    // 200 → the model is reachable; clear the mode (audit-logs the exit on flip).
    await ctx.runMutation(internal.interpretationMode.transitionEngineOnlyMode, {
      workspaceId,
      engineOnly: false,
      actor,
    });
    return { engineOnly: false };
  },
});
