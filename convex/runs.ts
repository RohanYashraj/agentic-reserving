import { vWorkflowId } from "@convex-dev/workflow";
import { vResultValidator } from "@convex-dev/workpool";
import { ConvexError } from "convex/values";
import { v } from "convex/values";
import { appendAuditEntryInTransaction } from "./auditLogs";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { callEngine } from "./lib/engineClient";
import type { DiagnosticsBundle, ResultSet } from "./lib/engineContract";
import {
  diagnosticsBundleValidator,
  resultSetValidator,
  runParametersValidator,
} from "./lib/engineContract";
import { requireMember } from "./lib/guards";
import { workflow } from "./workflow";

// Story 4.1 — Run configuration (FR-4, AD-7): createRun creates the job record.
// Story 4.2 — Durable orchestration: createRun now kicks off runWorkflow, which
// drives the queued run through engine_service /runs and owns every
// queued → running → complete|failed transition (markRunning / storeResultSet /
// markRunFailed — the SOLE writers of runs.status, AD-7). The engine HTTP call
// lives in the executeEngineRun action step (the workflow handler is
// deterministic — no fetch/crypto/env). Retries are idempotent (NFR-4): /runs
// is deterministic + stateless, and storeResultSet's status guard makes the
// store exactly-once.

/**
 * Create a Run over a validated Triangle (job-record-first, AD-7).
 *
 * A mutation (not an action) because 4.1 does no I/O: the runs insert and its
 * `run.created` audit entry commit ATOMICALLY in one transaction (no orphan
 * runs, no orphan audit rows). Fail-closed: every gate is re-checked
 * server-side (AD-4 — UI-hiding is never sufficient), and the BF a-priori
 * rules mirror the engine's `_check_aprioris` + `AprioriLossRatio` validators
 * so a bad parameter set is rejected here, not deep inside 4.2's engine call.
 *
 * AD-1: loss ratios and premiums are user-supplied INPUTS, not engine figures;
 * range-checking them is allowed. The only BF arithmetic
 * (expected ultimate = loss_ratio × exposure) lives in reserving_engine — never
 * here.
 */
export const createRun = mutation({
  args: {
    workspaceId: v.string(),
    triangleId: v.id("triangles"),
    parameters: runParametersValidator,
  },
  handler: async (ctx, { workspaceId, triangleId, parameters }) => {
    // AD-4: identity + Workspace membership before anything else.
    const { identity } = await requireMember(ctx, workspaceId);
    const actor = identity.subject;

    // Tenancy + existence. triangleId is attacker-controllable, so re-check the
    // fetched row's workspace. Same code for wrong-workspace and absent, so
    // tenancy existence never leaks (mirrors guards.ts requireMember).
    const triangle = await ctx.db.get(triangleId);
    if (triangle === null || triangle.workspaceId !== workspaceId) {
      throw new ConvexError({
        code: "TRIANGLE_NOT_FOUND",
        message: "That Triangle does not exist in this Workspace.",
      });
    }

    // Runnability: only an accepted (validated) Triangle can be run. A
    // validated row is guaranteed to carry acceptedTriangle + triangleHash
    // (Story 3.3 sets them together at acceptance) — guard defensively anyway.
    if (
      triangle.status !== "validated" ||
      triangle.acceptedTriangle === undefined ||
      triangle.triangleHash === undefined
    ) {
      throw new ConvexError({
        code: "TRIANGLE_NOT_RUNNABLE",
        message: "Only an accepted (validated) Triangle can be run.",
      });
    }

    const { methods, aprioriLossRatios } = parameters;

    if (methods.length === 0) {
      throw new ConvexError({
        code: "RUN_NO_METHODS",
        message: "Select at least one method to run.",
      });
    }

    const bfSelected = methods.includes("bornhuetter_ferguson");

    if (bfSelected) {
      // Authoritative Origin Period set is the accepted Triangle's — never the
      // client's claim. Rules mirror reserving_engine.methods._check_aprioris
      // + AprioriLossRatio field validators (loss_ratio >= 0, exposure > 0,
      // both finite).
      const origins = triangle.acceptedTriangle.origin_periods;
      const originSet = new Set(origins);

      const seen = new Set<string>();
      for (const a of aprioriLossRatios) {
        if (seen.has(a.origin)) {
          throw new ConvexError({
            code: "RUN_DUPLICATE_APRIORI",
            message: `Duplicate A Priori Loss Ratio for Origin Period ${a.origin}.`,
          });
        }
        seen.add(a.origin);

        if (!originSet.has(a.origin)) {
          throw new ConvexError({
            code: "RUN_UNKNOWN_APRIORI",
            message: `A Priori Loss Ratio for Origin Period ${a.origin}, which is not in this Triangle.`,
          });
        }

        if (!Number.isFinite(a.lossRatio) || a.lossRatio < 0) {
          throw new ConvexError({
            code: "RUN_INVALID_APRIORI",
            message: `Origin Period ${a.origin}: the A Priori Loss Ratio must be a finite value ≥ 0.`,
          });
        }
        if (!Number.isFinite(a.exposure) || a.exposure <= 0) {
          throw new ConvexError({
            code: "RUN_INVALID_APRIORI",
            message: `Origin Period ${a.origin}: the Premium must be a finite value > 0.`,
          });
        }
      }

      const missing = origins.filter((o) => !seen.has(o));
      if (missing.length > 0) {
        throw new ConvexError({
          code: "RUN_MISSING_APRIORI",
          message: `Bornhuetter-Ferguson needs an A Priori Loss Ratio and Premium for every Origin Period; missing: ${missing.join(", ")}.`,
        });
      }
    }

    // Non-BF runs never persist stray a-prioris (the engine ignores them).
    const storedAprioris = bfSelected ? aprioriLossRatios : [];

    const now = new Date(Date.now()).toISOString();
    const runId = await ctx.db.insert("runs", {
      workspaceId,
      triangleId,
      triangleHash: triangle.triangleHash,
      status: "queued",
      parameters: { methods, aprioriLossRatios: storedAprioris },
      createdBy: actor,
      createdAt: now,
    });

    // Atomic audit (AD-6) — same transaction as the run insert. Lean payload:
    // full parameters live on the runs row, not duplicated here.
    await appendAuditEntryInTransaction(ctx, {
      workspaceId,
      actor,
      eventType: "run.created",
      runId,
      payload: {
        runId,
        triangleId,
        methods,
        originCount: triangle.acceptedTriangle.origin_periods.length,
        aprioriCount: storedAprioris.length,
      },
    });

    // Kick off durable orchestration (Story 4.2, AD-7). Job-record-first is
    // preserved: the run row + run.created audit are written ABOVE, before the
    // workflow starts. workflow.start schedules transactionally within this
    // mutation (exactly-once on commit; re-run safely on OCC retry), so the run
    // exists and is audited before any orchestration touches it. The workflow
    // has no identity of its own — thread `actor` so lifecycle audit entries are
    // attributed to the run's creator.
    const workflowId = await workflow.start(
      ctx,
      internal.runs.runWorkflow,
      { runId, workspaceId, actor },
      { onComplete: internal.runs.onRunComplete, context: { runId, actor } },
    );
    await ctx.db.patch(runId, { workflowId });

    return { runId, status: "queued" as const };
  },
});

// --- Story 4.2: durable orchestration ---------------------------------------

/**
 * Fetch the ingredients executeEngineRun needs to build the /runs request.
 * Internal (no guard — the trusted workflow is the only caller). Returns the
 * accepted Triangle's snake_case body (from triangles.acceptedTriangle) plus
 * the run's camelCase parameters. A `validated` Triangle always carries
 * acceptedTriangle (Story 4.1 gated createRun on it) — throw defensively if it
 * vanished.
 */
export const getRunForEngine = internalQuery({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const run = await ctx.db.get(runId);
    if (run === null) {
      throw new ConvexError({
        code: "RUN_NOT_FOUND",
        message: "That Run no longer exists.",
      });
    }
    const triangle = await ctx.db.get(run.triangleId);
    if (triangle === null || triangle.acceptedTriangle === undefined) {
      throw new ConvexError({
        code: "TRIANGLE_NOT_FOUND",
        message: "The Run's Triangle is missing its accepted content.",
      });
    }
    return {
      // Snake_case Triangle body — the exact /runs `triangle` field (do NOT
      // re-case; triangleValidator is snake_case by design).
      triangle: triangle.acceptedTriangle,
      // camelCase { methods, aprioriLossRatios } — the exact /runs `parameters`.
      parameters: run.parameters,
    };
  },
});

/**
 * THE only /runs fetch site (AD-12 — only Convex calls the engine). An action,
 * so it can `fetch`; run as a retried workflow step (executeEngineRun errors →
 * the workflow retries per the default policy). The engine is deterministic +
 * stateless, so a retried identical request recomputes byte-identically (AD-7).
 */
export const executeEngineRun = internalAction({
  args: { runId: v.id("runs") },
  handler: async (
    ctx,
    { runId },
  ): Promise<{ resultSet: ResultSet; diagnosticsBundle: DiagnosticsBundle }> => {
    const r = await ctx.runQuery(internal.runs.getRunForEngine, { runId });
    // Wire contract (Story 2.5): runId is a top-level camelCase field (the
    // stringified Convex _id), triangle is snake_case, parameters is camelCase.
    const out = await callEngine<{
      runId: string;
      resultSet: ResultSet;
      diagnosticsBundle: DiagnosticsBundle;
    }>("/runs", {
      runId,
      triangle: r.triangle,
      parameters: r.parameters,
    });
    return { resultSet: out.resultSet, diagnosticsBundle: out.diagnosticsBundle };
  },
});

/**
 * queued → running (AD-7). Guarded: only transitions a `queued` run, so a
 * replayed step observes `running` and no-ops (no duplicate run.started). The
 * runs record is the sole status authority; this is one of only three writers.
 */
export const markRunning = internalMutation({
  args: { runId: v.id("runs"), actor: v.string() },
  handler: async (ctx, { runId, actor }) => {
    const run = await ctx.db.get(runId);
    if (run === null || run.status !== "queued") return;
    const now = new Date(Date.now()).toISOString();
    await ctx.db.patch(runId, { status: "running", startedAt: now });
    await appendAuditEntryInTransaction(ctx, {
      workspaceId: run.workspaceId,
      actor,
      eventType: "run.started",
      runId,
      payload: { runId },
    });
  },
});

/**
 * running → complete, persisting the schema-validated ResultSet/DiagnosticsBundle
 * (FR-5, AD-10). THE schema gate is the typed args: Convex validates
 * `resultSet`/`diagnosticsBundle` against the shared engine-contract validators
 * at the arg boundary, so a schema-invalid engine response THROWS before this
 * handler runs — never stored. A thrown error surfaces to onRunComplete →
 * markRunFailed. Guarded on `running` so a duplicate store (idempotent retry)
 * no-ops on an already-`complete` run — exactly one ResultSet, one run.completed
 * (NFR-4).
 */
export const storeResultSet = internalMutation({
  args: {
    runId: v.id("runs"),
    actor: v.string(),
    resultSet: resultSetValidator,
    diagnosticsBundle: diagnosticsBundleValidator,
  },
  handler: async (ctx, { runId, actor, resultSet, diagnosticsBundle }) => {
    const run = await ctx.db.get(runId);
    if (run === null || run.status !== "running") return;

    // Chain of custody (AD-11): the engine re-stamps the accepted Triangle's
    // canonical hash into lineage.triangleHash and the bundle's triangleHash.
    // A mismatch against the run's frozen triangleHash means a broken chain —
    // never store it; fail the Run instead.
    if (
      resultSet.lineage.triangleHash !== run.triangleHash ||
      diagnosticsBundle.triangleHash !== run.triangleHash
    ) {
      throw new ConvexError({
        code: "RESULT_HASH_MISMATCH",
        message:
          "The engine result's Triangle hash does not match the Run's Triangle hash.",
      });
    }

    const now = new Date(Date.now()).toISOString();
    await ctx.db.patch(runId, {
      status: "complete",
      resultSet,
      diagnosticsBundle,
      completedAt: now,
    });
    // Lean audit payload — no reserve figures duplicated (AD-1/leanness; the
    // ResultSet lives on the runs row, verifiable via Lineage).
    await appendAuditEntryInTransaction(ctx, {
      workspaceId: run.workspaceId,
      actor,
      eventType: "run.completed",
      runId,
      payload: {
        runId,
        methodCount: resultSet.methodResults.length,
        originCount: run.parameters.aprioriLossRatios.length,
      },
    });
  },
});

/**
 * → failed (AD-7). Guarded: only transitions a `queued` or `running` run, so a
 * late/duplicate failure NEVER clobbers a `complete` run's stored result. The
 * body is an exported plain function so onRunComplete (a mutation — it cannot
 * ctx.runMutation) can mark failure inside its own transaction, exactly like
 * appendAuditEntryInTransaction's atomic pattern.
 */
export async function markRunFailedInTransaction(
  ctx: MutationCtx,
  args: { runId: Id<"runs">; actor: string; error: { code: string; message: string } },
): Promise<void> {
  const run = await ctx.db.get(args.runId);
  if (run === null) return;
  if (run.status !== "queued" && run.status !== "running") return;
  const now = new Date(Date.now()).toISOString();
  await ctx.db.patch(args.runId, {
    status: "failed",
    error: args.error,
    failedAt: now,
  });
  await appendAuditEntryInTransaction(ctx, {
    workspaceId: run.workspaceId,
    actor: args.actor,
    eventType: "run.failed",
    runId: args.runId,
    payload: { runId: args.runId, code: args.error.code, message: args.error.message },
  });
}

export const markRunFailed = internalMutation({
  args: {
    runId: v.id("runs"),
    actor: v.string(),
    error: v.object({ code: v.string(), message: v.string() }),
  },
  handler: (ctx, args) => markRunFailedInTransaction(ctx, args),
});

/**
 * The durable orchestration (AD-7). Deterministic handler — NO fetch/crypto/env
 * (the engine call is the executeEngineRun action step). markRunning and
 * storeResultSet are exactly-once mutations; executeEngineRun retries on
 * transient failure. Any thrown error (retries exhausted, schema-invalid store,
 * hash mismatch) ends the workflow in `failed` → onRunComplete marks the Run
 * failed. Return type annotated to break internal.* type cycles.
 */
export const runWorkflow = workflow.define({
  args: { runId: v.id("runs"), workspaceId: v.string(), actor: v.string() },
  handler: async (step, { runId, actor }): Promise<void> => {
    await step.runMutation(internal.runs.markRunning, { runId, actor });
    const { resultSet, diagnosticsBundle } = await step.runAction(
      internal.runs.executeEngineRun,
      { runId },
      { retry: true },
    );
    await step.runMutation(internal.runs.storeResultSet, {
      runId,
      actor,
      resultSet,
      diagnosticsBundle,
    });
  },
});

/**
 * The workflow's exactly-once completion sink (AD-9-style clean failure).
 * On `failed`/`canceled`, mark the Run failed (guarded — success already set
 * `complete` via storeResultSet, so this no-ops for it). `result.error` carries
 * the engine error or the schema-validation/hash-mismatch message — this is how
 * AC2's "marked failed with the validation error" reaches the runs row.
 * internalMutation → off the public surface (no auth-guard registration).
 */
export const onRunComplete = internalMutation({
  args: {
    workflowId: vWorkflowId,
    result: vResultValidator,
    context: v.any(),
  },
  handler: async (ctx, { result, context }) => {
    const { runId, actor } = context as { runId: Id<"runs">; actor: string };
    if (result.kind === "failed") {
      await markRunFailedInTransaction(ctx, {
        runId,
        actor,
        error: { code: "RUN_FAILED", message: result.error },
      });
    } else if (result.kind === "canceled") {
      await markRunFailedInTransaction(ctx, {
        runId,
        actor,
        error: { code: "RUN_CANCELED", message: "The Run was canceled." },
      });
    }
    // result.kind === "success": storeResultSet already marked complete — no-op.
  },
});

// --- Story 4.3: the reactive read surface + idempotent retry -----------------

/**
 * A single Run by id, for the live Run-detail page (Story 4.3, AC1/2/3/5). This
 * is the reactive read surface Story 4.2 deliberately deferred ("4.2 only writes
 * the state 4.3 will read"). Convex `useQuery` IS a live subscription: every
 * markRunning/storeResultSet/markRunFailed patch re-renders subscribers — no
 * polling anywhere (FR-20).
 *
 * Public → requireMember first (AD-4); then a tenancy re-check (runId is
 * attacker-controllable) returns `null` for a row outside this Workspace, so
 * existence never leaks (exact shape of triangles.getById).
 *
 * LEAN projection (AD-1): status/methods/error/timestamps + hasResults/
 * hasDiagnostics booleans ONLY — NEVER the resultSet/diagnosticsBundle figures.
 * Reserve-figure rendering is Stories 4.4–4.6.
 */
export const getRun = query({
  args: { workspaceId: v.string(), runId: v.id("runs") },
  handler: async (ctx, { workspaceId, runId }) => {
    await requireMember(ctx, workspaceId);
    const run = await ctx.db.get(runId);
    if (run === null || run.workspaceId !== workspaceId) return null;
    return {
      _id: run._id,
      status: run.status, // queued | running | complete | failed
      triangleId: run.triangleId,
      triangleHash: run.triangleHash,
      methods: run.parameters.methods, // per-Method rows
      error: run.error ?? null, // { code, message } | null
      createdAt: run.createdAt,
      startedAt: run.startedAt ?? null,
      completedAt: run.completedAt ?? null,
      failedAt: run.failedAt ?? null,
      // Booleans gate the Results/Diagnostics tabs + step rail WITHOUT leaking
      // any figures (AD-1) — the figures arrive in 4.4–4.6.
      hasResults: run.resultSet !== undefined,
      hasDiagnostics: run.diagnosticsBundle !== undefined,
    };
  },
});

/**
 * Idempotent "Retry run" (Story 4.3, AC4/6) — the one new status writer Story
 * 4.2 anticipated ("that's 4.3's idempotent 'Retry run' UI, which will re-enter
 * this same orchestration"). The runs record stays the sole status authority
 * (AD-7); this adds exactly one tightly-guarded transition, `failed → queued`,
 * and hands back to the UNCHANGED runWorkflow.
 *
 * Idempotent by construction: the `status === "failed"` guard means a
 * double-click (2nd click sees queued/running) or a retry of a non-failed Run is
 * rejected — no duplicate workflow, no divergent numbers (the engine is
 * deterministic + stateless, NFR-4).
 */
export const retryRun = mutation({
  args: { workspaceId: v.string(), runId: v.id("runs") },
  handler: async (ctx, { workspaceId, runId }) => {
    // AD-4: identity + membership before anything else.
    const { identity } = await requireMember(ctx, workspaceId);
    const actor = identity.subject;

    // Tenancy + existence. Same code for wrong-workspace and absent — existence
    // never leaks (mirrors createRun's triangle check).
    const run = await ctx.db.get(runId);
    if (run === null || run.workspaceId !== workspaceId) {
      throw new ConvexError({
        code: "RUN_NOT_FOUND",
        message: "That Run does not exist in this Workspace.",
      });
    }

    // Idempotency guard (NFR-4): only a failed Run can be retried. A second
    // click (now queued/running) or a retry of a complete/queued/running Run
    // throws — no duplicate work.
    if (run.status !== "failed") {
      throw new ConvexError({
        code: "RUN_NOT_RETRYABLE",
        message: "Only a failed Run can be retried.",
      });
    }

    // The ONE new status writer beyond 4.2 (failed → queued). Clear the stale
    // lifecycle fields; resultSet/diagnosticsBundle are already absent on a
    // failed row.
    await ctx.db.patch(runId, {
      status: "queued",
      error: undefined,
      startedAt: undefined,
      completedAt: undefined,
      failedAt: undefined,
    });

    // Atomic audit (AD-6) — single writer, lean payload (no figures).
    await appendAuditEntryInTransaction(ctx, {
      workspaceId,
      actor,
      eventType: "run.retried",
      runId,
      payload: { runId, retriedFrom: run.error?.code ?? "unknown" },
    });

    // Re-enter the unchanged 4.2 orchestration (identical to createRun's tail).
    // The prior (failed) workflow is terminal; a fresh one is correct and the
    // new workflowId overwrites the stale one. workflow.start schedules
    // transactionally within this mutation (job-record-first is preserved: the
    // run row already exists and the reset + audit commit before kickoff).
    const workflowId = await workflow.start(
      ctx,
      internal.runs.runWorkflow,
      { runId, workspaceId, actor },
      { onComplete: internal.runs.onRunComplete, context: { runId, actor } },
    );
    await ctx.db.patch(runId, { workflowId });

    return { runId, status: "queued" as const };
  },
});
