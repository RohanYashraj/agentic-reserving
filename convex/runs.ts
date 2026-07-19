import { vWorkflowId } from "@convex-dev/workflow";
import { vResultValidator } from "@convex-dev/workpool";
import { ConvexError } from "convex/values";
import { v } from "convex/values";
import { appendAuditEntryInTransaction } from "./auditLogs";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx } from "./_generated/server";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { callEngine } from "./lib/engineClient";
import type {
  DiagnosticsBundle,
  ReDerivationReport,
  Recommendations,
  ReserveReport,
  ResultSet,
} from "./lib/engineContract";
import {
  RESERVE_REPORT_SCHEMA_VERSION,
  diagnosticsBundleValidator,
  reDerivationReportValidator,
  recommendationsValidator,
  reserveReportValidator,
  resultSetValidator,
  runParametersValidator,
} from "./lib/engineContract";
import {
  citationsFromText,
  markersAreWellFormed,
} from "./lib/citationMarker";
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
        // The true Origin-Period count (shared across methods), NOT the a-priori
        // count — `aprioriLossRatios` is [] for a CL-only run. Mirrors the
        // `run.created` payload's originCount.
        originCount: resultSet.methodResults[0]?.originResults.length ?? 0,
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
  handler: async (ctx, { workflowId, result, context }) => {
    const { runId, actor } = context as { runId: Id<"runs">; actor: string };
    // Workflow-generation fence: retryRun re-queues the SAME runId under a NEW
    // workflowId, so a late/duplicate completion callback from a superseded
    // workflow must NOT mark the freshly re-queued run failed. Act only when
    // this callback belongs to the run's current workflow.
    const current = await ctx.db.get(runId);
    if (current === null || current.workflowId !== workflowId) return;
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
    // Story 5.4: one indexed `by_run` read → a boolean gating the Epic-6 Report
    // tab, exactly like hasResults/hasDiagnostics/hasRecommendations. The report
    // lives in its own table (not inline), so this is a lookup, not a field
    // check; it leaks NO figures and keeps getRun lean.
    const reserveReport = await ctx.db
      .query("reserveReports")
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .unique();
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
      // Story 5.3: gates the 5.5 Interpretation tab exactly like hasResults/
      // hasDiagnostics gate Results/Diagnostics — a boolean, NO figures leak.
      hasRecommendations: run.recommendations !== undefined,
      // Story 5.4: gates the Epic-6 Report tab — a boolean, NO figures leak.
      hasReserveReport: reserveReport !== null,
      // Story 5.6: the durable per-Run interpretation-failure state (reason +
      // timestamp) so the Interpretation tab renders it after reload (D2). Lean
      // — the reason enum + `at` only, NO figures.
      interpretationFailure: run.interpretationFailure ?? null,
    };
  },
});

/**
 * The stored ResultSet for one Run, verbatim — the figure read surface Story
 * 4.3's `getRun` deliberately deferred ("the figures arrive in 4.4–4.6"). This
 * is where reserve figures leave Convex; `getRun` stays lean (no figures), and
 * the Results tab subscribes here ONLY when `hasResults` (Story 4.4).
 *
 * Public → requireMember first (AD-4); then the same tenancy re-check as
 * `getRun` returns `null` for a row outside this Workspace (existence never
 * leaks). Returns `run.resultSet` UNCHANGED — no projection, no re-keying — so
 * "every figure is a value from the stored ResultSet verbatim" (AC3) holds by
 * construction. A queued/running/failed Run has no `resultSet` → `null`.
 *
 * AD-1: this query only READS and RETURNS engine figures; it performs no
 * arithmetic. Display formatting (thousands grouping) is the React layer's job.
 */
export const getResultSet = query({
  args: { workspaceId: v.string(), runId: v.id("runs") },
  handler: async (ctx, { workspaceId, runId }) => {
    await requireMember(ctx, workspaceId);
    const run = await ctx.db.get(runId);
    if (run === null || run.workspaceId !== workspaceId) return null;
    return run.resultSet ?? null;
  },
});

/**
 * The stored DiagnosticsBundle for one Run, verbatim — the Diagnostics read
 * surface Story 4.3's `getRun` deferred alongside the figures ("the figures
 * arrive in 4.4–4.6"). The exact structural twin of `getResultSet` (Story 4.4):
 * `getRun` stays lean (no bundle), and the Diagnostics tab subscribes here ONLY
 * when `hasDiagnostics` (Story 4.5).
 *
 * Public → requireMember first (AD-4); then the same tenancy re-check as
 * `getRun`/`getResultSet` returns `null` for a row outside this Workspace
 * (existence never leaks). Returns `run.diagnosticsBundle` UNCHANGED — no
 * projection, no re-keying — so "every value is from the stored bundle
 * verbatim" (AC5) holds by construction. A queued/running/failed Run has no
 * `diagnosticsBundle` → `null`.
 *
 * AD-1: this query only READS and RETURNS engine-computed diagnostics; it
 * performs no arithmetic. Display formatting is the React layer's job.
 */
export const getDiagnosticsBundle = query({
  args: { workspaceId: v.string(), runId: v.id("runs") },
  handler: async (ctx, { workspaceId, runId }) => {
    await requireMember(ctx, workspaceId);
    const run = await ctx.db.get(runId);
    if (run === null || run.workspaceId !== workspaceId) return null;
    return run.diagnosticsBundle ?? null;
  },
});

/**
 * The stored Recommendations document for one Run, verbatim (Story 5.3, FR-10)
 * — the interpretation read surface the 5.5 Interpretation tab subscribes to
 * ONLY when `hasRecommendations` (getRun's boolean gate). The structural twin
 * of `getResultSet`/`getDiagnosticsBundle`.
 *
 * Public → requireMember first (AD-4); then the same tenancy re-check returns
 * `null` for a row outside this Workspace (existence never leaks). Returns
 * `run.recommendations` UNCHANGED — no projection; 5.5 renders it (CitationChip
 * off `reasons[].citations`). A Run with no accepted interpretation → `null`.
 *
 * AD-1: this query only READS and RETURNS the machine-drafted document (whose
 * figures are already gate-rendered from the ResultSet); it computes nothing.
 */
export const getRecommendations = query({
  args: { workspaceId: v.string(), runId: v.id("runs") },
  handler: async (ctx, { workspaceId, runId }) => {
    await requireMember(ctx, workspaceId);
    const run = await ctx.db.get(runId);
    if (run === null || run.workspaceId !== workspaceId) return null;
    return run.recommendations ?? null;
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

// --- Story 4.7: ResultSet re-derivation from Lineage (FR-6, NFR-6, AD-11) -----

/**
 * Ingredients for a re-derivation: the run's stored accepted Triangle, its
 * stored ResultSet, and the frozen `triangleHash`. Internal (no guard — the
 * trusted `rederiveRun` action is the only caller), BUT it re-checks tenancy
 * anyway (returns the same RUN_NOT_FOUND for wrong-workspace and absent, so
 * existence never leaks) because the action passes an attacker-controllable
 * runId. Only a `complete` run carries a `resultSet` — a queued/running/failed
 * run is RUN_NOT_REDERIVABLE.
 */
export const getRunForRederive = internalQuery({
  args: { runId: v.id("runs"), workspaceId: v.string() },
  handler: async (ctx, { runId, workspaceId }) => {
    const run = await ctx.db.get(runId);
    if (run === null || run.workspaceId !== workspaceId) {
      throw new ConvexError({
        code: "RUN_NOT_FOUND",
        message: "That Run does not exist in this Workspace.",
      });
    }
    if (run.status !== "complete" || run.resultSet === undefined) {
      throw new ConvexError({
        code: "RUN_NOT_REDERIVABLE",
        message: "Only a completed Run with a stored ResultSet can be re-derived.",
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
      // Snake_case Triangle body — the exact /rederive `triangle` field.
      triangle: triangle.acceptedTriangle,
      // The stored ResultSet, verbatim — its Lineage is the re-derivation recipe.
      storedResultSet: run.resultSet,
      triangleHash: run.triangleHash,
    };
  },
});

/**
 * Append the `run.rederived` audit entry (AD-6) — the SOLE durable record of a
 * re-derivation (AC4). Deliberately does NOT patch the run row: the stored
 * ResultSet is immutable and re-derivation is a read-only proof, so a run can be
 * re-derived any number of times with no state drift (AC1). Lean payload — the
 * verdict + counts, never reserve figures (AD-1). Guarded so a vanished /
 * cross-tenant run no-ops.
 */
export const recordRederivation = internalMutation({
  args: {
    runId: v.id("runs"),
    workspaceId: v.string(),
    actor: v.string(),
    reproduced: v.boolean(),
    triangleHashVerified: v.boolean(),
    tier: v.union(v.literal("exact"), v.literal("epsilon")),
    discrepancyCount: v.number(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (run === null || run.workspaceId !== args.workspaceId) return;
    await appendAuditEntryInTransaction(ctx, {
      workspaceId: args.workspaceId,
      actor: args.actor,
      eventType: "run.rederived",
      runId: args.runId,
      payload: {
        runId: args.runId,
        reproduced: args.reproduced,
        triangleHashVerified: args.triangleHashVerified,
        tier: args.tier,
        discrepancyCount: args.discrepancyCount,
      },
    });
  },
});

/**
 * Re-derive a stored ResultSet from its Lineage on demand (FR-6, NFR-6) — the
 * auditor's reproducibility proof (UJ-3). A public ACTION (it must `fetch` the
 * engine): `requireMember` is its FIRST statement (AD-4) and runs BEFORE the
 * engine call, so an unauthenticated / non-member caller is rejected without
 * ever reaching the engine. Not `requireRole` — re-derivation writes no product
 * state (only an audit entry), so any member may verify reproducibility;
 * AD-4 reserves `requireRole(senior_actuary)` for the approve/publish/override
 * MUTATION paths (see the story's flagged decision).
 *
 * The report is returned to the caller (the UI holds it in state; a re-run
 * re-fetches) — never persisted on the run row (immutability, AC1). All
 * comparison arithmetic lives in the engine (AD-1); this action carries the
 * report, it computes nothing. Return type annotated to break internal.* cycles.
 */
export const rederiveRun = action({
  args: { workspaceId: v.string(), runId: v.id("runs") },
  returns: reDerivationReportValidator,
  handler: async (ctx, { workspaceId, runId }): Promise<ReDerivationReport> => {
    // AD-4: identity + Workspace membership before anything else (before fetch).
    const { identity } = await requireMember(ctx, workspaceId);
    const actor = identity.subject;

    // Tenancy re-check happens inside getRunForRederive (runId is
    // attacker-controllable); it throws RUN_NOT_FOUND for wrong-workspace/absent.
    const { triangle, storedResultSet, triangleHash } = await ctx.runQuery(
      internal.runs.getRunForRederive,
      { runId, workspaceId },
    );

    // Chain of custody, belt-and-braces (AD-11): the stored ResultSet's Lineage
    // hash must match the run's frozen triangleHash before we even dispatch —
    // mirrors storeResultSet's guard. The engine re-checks against the Triangle
    // it actually re-runs (its authoritative check); this catches a Convex-side
    // tamper before the round-trip.
    if (storedResultSet.lineage.triangleHash !== triangleHash) {
      throw new ConvexError({
        code: "RESULT_HASH_MISMATCH",
        message:
          "The stored ResultSet's Triangle hash does not match the Run's Triangle hash.",
      });
    }

    const report = await callEngine<ReDerivationReport>("/rederive", {
      runId,
      triangle,
      storedResultSet,
    });

    // callEngine casts the JSON unchecked — validate the wire shape against the
    // ReDerivationReport contract BEFORE reading it, so a malformed/partial
    // response surfaces as a coded error (not a raw TypeError on
    // `report.discrepancies.length`) and is never audited as a verdict. The
    // action's `returns` validator re-checks the value at the boundary too.
    if (
      report === null ||
      typeof report !== "object" ||
      typeof report.reproduced !== "boolean" ||
      typeof report.triangleHashVerified !== "boolean" ||
      (report.tier !== "exact" && report.tier !== "epsilon") ||
      !Array.isArray(report.discrepancies)
    ) {
      throw new ConvexError({
        code: "ENGINE_INVALID_RESPONSE",
        message:
          "The /rederive response did not match the ReDerivationReport contract.",
      });
    }

    // Audit the outcome (AC4) — only reached on a successful engine report; a
    // down engine throws above (ENGINE_UNAVAILABLE) and is NOT recorded as a
    // reproducibility verdict.
    await ctx.runMutation(internal.runs.recordRederivation, {
      runId,
      workspaceId,
      actor,
      reproduced: report.reproduced,
      triangleHashVerified: report.triangleHashVerified,
      tier: report.tier,
      discrepancyCount: report.discrepancies.length,
    });

    return report;
  },
});

// --- Story 5.3: Method Recommendations Through the Gate (FR-10, AD-5, AD-9) ---

/** The engine `/recommendations` response wire shape (discriminated result,
 * transcripts in every arm — FR-15). `attempts` rides as opaque JSON to the
 * audit payload; only the `accepted` document is a drift-checked contract. */
type RecommendResponse = {
  status: "accepted" | "rejected";
  recommendations: Recommendations | null;
  attempts: unknown;
  rejectionSummary: string | null;
};

/**
 * Ingredients for interpretation: the run's stored ResultSet + DiagnosticsBundle
 * (passed DOWN into the engine — engine_service is stateless, AD-3). Internal
 * (the trusted `generateRecommendations` action is the only caller), BUT it
 * re-checks tenancy anyway (same RUN_NOT_FOUND for wrong-workspace/absent, so
 * existence never leaks) because the action passes an attacker-controllable
 * runId. Only a `complete` run carries both artifacts — otherwise
 * RUN_NOT_INTERPRETABLE (interpretation needs a completed Run's results +
 * diagnostics). Mirrors `getRunForRederive`.
 */
export const getRunForRecommend = internalQuery({
  args: { runId: v.id("runs"), workspaceId: v.string() },
  handler: async (ctx, { runId, workspaceId }) => {
    const run = await ctx.db.get(runId);
    if (run === null || run.workspaceId !== workspaceId) {
      throw new ConvexError({
        code: "RUN_NOT_FOUND",
        message: "That Run does not exist in this Workspace.",
      });
    }
    if (
      run.status !== "complete" ||
      run.resultSet === undefined ||
      run.diagnosticsBundle === undefined
    ) {
      throw new ConvexError({
        code: "RUN_NOT_INTERPRETABLE",
        message:
          "Only a completed Run with stored results and diagnostics can be interpreted.",
      });
    }
    return { resultSet: run.resultSet, diagnosticsBundle: run.diagnosticsBundle };
  },
});

/**
 * Persist the accepted Recommendations document on the run row + audit the
 * transcript (Story 5.3, FR-10/FR-15). THE schema gate is the typed
 * `recommendations` arg (`recommendationsValidator`): a schema-invalid document
 * THROWS at the boundary and is never stored (AD-10). Guarded on
 * `status === "complete"` and matching workspace (no-op on a vanished /
 * cross-tenant run). Chain of custody: the document's `runId` must match the run
 * (like storeResultSet's hash check). Mirrors `storeResultSet`.
 *
 * The audit payload carries the transcript(s) — the full LLM interaction (FR-15,
 * AD-6) — but NO reserve figures (AD-1/leanness; the recommendations live on the
 * row). `payload` is `v.any()`, so the transcript fits.
 */
export const storeRecommendations = internalMutation({
  args: {
    runId: v.id("runs"),
    workspaceId: v.string(),
    actor: v.string(),
    recommendations: recommendationsValidator,
    transcript: v.any(),
  },
  handler: async (ctx, { runId, workspaceId, actor, recommendations, transcript }) => {
    const run = await ctx.db.get(runId);
    if (run === null || run.workspaceId !== workspaceId || run.status !== "complete") {
      return;
    }
    // Chain of custody (AD-7): the accepted document's correlation key must be
    // this Run's id — a mismatch means a cross-Run document; never store it.
    if (recommendations.runId !== (runId as string)) {
      throw new ConvexError({
        code: "RECOMMENDATIONS_RUN_MISMATCH",
        message: "The recommendations document's runId does not match the Run.",
      });
    }
    await ctx.db.patch(runId, { recommendations });
    await appendAuditEntryInTransaction(ctx, {
      workspaceId,
      actor,
      eventType: "run.recommended",
      runId,
      payload: {
        runId,
        transcript,
        // One recommendation per Origin Period — the true Origin count.
        originCount: recommendations.recommendations.length,
      },
    });
  },
});

/**
 * Record a FAILED Interpretation (gate/structural exhaustion) — append a
 * `run.interpretationRejected` audit entry carrying the transcript + rejections
 * (AD-5/FR-11 "the rejection with reasons is audit-logged"). Persists NO
 * recommendations (AC-2 never-partial). Guarded so a vanished / cross-tenant run
 * no-ops. Single audit writer via `appendAuditEntryInTransaction`.
 */
export const recordInterpretationRejection = internalMutation({
  args: {
    runId: v.id("runs"),
    workspaceId: v.string(),
    actor: v.string(),
    transcript: v.any(),
    rejections: v.any(),
  },
  handler: async (ctx, { runId, workspaceId, actor, transcript, rejections }) => {
    const run = await ctx.db.get(runId);
    if (run === null || run.workspaceId !== workspaceId) return;
    await appendAuditEntryInTransaction(ctx, {
      workspaceId,
      actor,
      eventType: "run.interpretationRejected",
      runId,
      payload: { runId, transcript, rejections },
    });
  },
});

/**
 * Record a FAIL-CLOSED Interpretation attempt (Story 5.6, AD-9). Distinct from
 * `run.interpretationRejected` (a GATE rejection of a draft the model DID
 * produce): `run.interpretationFailed` is the model/cost/timeout fail-closed —
 * the attempt could not run or complete. Patches the durable per-Run
 * `runs.interpretationFailure` (survives reload, D2) and audit-logs the failure
 * (single writer). Guarded so a vanished / cross-tenant run no-ops. This does
 * NOT touch `runs.status` (the AD-7 enum is unchanged) nor the workspace-global
 * mode (that is `transitionEngineOnlyMode`'s job, wired in the action — D1).
 * Lean payload — the reason + runId, NO figures (AD-1).
 */
export const recordInterpretationFailed = internalMutation({
  args: {
    runId: v.id("runs"),
    workspaceId: v.string(),
    actor: v.string(),
    reason: v.union(
      v.literal("model_unavailable"),
      v.literal("cost_ceiling_exceeded"),
      v.literal("interpretation_timeout"),
    ),
    // Story 5.6 review F6: on a model outage, the transcripts of the attempts
    // that COMPLETED before the outage ride here (from the engine's
    // model_unavailable envelope details) so those LLM interactions are still
    // audit-logged (AD-6/FR-15). Opaque JSON — audit payload only; the durable
    // `interpretationFailure` stays lean (reason + at).
    attempts: v.optional(v.any()),
  },
  handler: async (ctx, { runId, workspaceId, actor, reason, attempts }) => {
    const run = await ctx.db.get(runId);
    if (run === null || run.workspaceId !== workspaceId) return;
    await ctx.db.patch(runId, {
      interpretationFailure: { reason, at: Date.now() },
    });
    await appendAuditEntryInTransaction(ctx, {
      workspaceId,
      actor,
      eventType: "run.interpretationFailed",
      runId,
      payload: {
        runId,
        reason,
        ...(attempts !== undefined ? { attempts } : {}),
      },
    });
  },
});

/**
 * Record the TRIGGERING of an Interpretation — append a `run.interpretationTriggered`
 * audit entry (Story 5.5, AD-6/FR-15). Completion (`run.recommended`) and failure
 * (`run.interpretationRejected`) were already audited (5.3); this fills the missing
 * third leg so all of triggering/completion/failure are logged. Mirrors
 * `recordInterpretationRejection`'s shape: guarded so a vanished / cross-tenant run
 * no-ops (defence-in-depth — the action only calls this after `getRunForRecommend`
 * has passed the tenancy check). Single audit writer via
 * `appendAuditEntryInTransaction`. Lean payload — records intent, NO figures.
 */
export const recordInterpretationTriggered = internalMutation({
  args: {
    runId: v.id("runs"),
    workspaceId: v.string(),
    actor: v.string(),
  },
  handler: async (ctx, { runId, workspaceId, actor }) => {
    const run = await ctx.db.get(runId);
    if (run === null || run.workspaceId !== workspaceId) return;
    await appendAuditEntryInTransaction(ctx, {
      workspaceId,
      actor,
      eventType: "run.interpretationTriggered",
      runId,
      payload: { runId },
    });
  },
});

/**
 * Story 5.6 (AD-9, D1): map a fail-closed engine error from an interpretation
 * callEngine into durable per-Run state (+ the workspace-global Engine-Only Mode
 * on model outage), shared by `generateRecommendations` and `generateReserveReport`.
 * Does NOT re-throw — the caller re-throws so its inline error surface still
 * shows (5.5). Only the three fail-closed engine codes leave durable state;
 * transient `ENGINE_UNAVAILABLE`/`ENGINE_UNCONFIGURED` (and anything else) leave
 * NOTHING (matches 5.5's retry surface). `model_unavailable` is the ONLY code
 * that flips the global mode (D1 — a per-Run cost/timeout breach does not, to
 * avoid a semantically-wrong global "interpretation unavailable" + a recovery
 * deadlock).
 */
async function recordInterpretationFailureFromError(
  ctx: ActionCtx,
  {
    err,
    runId,
    workspaceId,
    actor,
  }: { err: unknown; runId: Id<"runs">; workspaceId: string; actor: string },
): Promise<void> {
  const data =
    err instanceof ConvexError
      ? (err.data as { code?: string; details?: { attempts?: unknown } })
      : undefined;
  const code = data?.code;
  if (code === "engine.model_unavailable") {
    await ctx.runMutation(internal.runs.recordInterpretationFailed, {
      runId,
      workspaceId,
      actor,
      reason: "model_unavailable",
      // Review F6: audit the completed attempts' transcripts carried in the
      // 503 envelope (undefined for a misconfig/from-first-call outage).
      attempts: data?.details?.attempts,
    });
    // Model plane down → enter the workspace-global Engine-Only Mode (D1).
    await ctx.runMutation(internal.interpretationMode.transitionEngineOnlyMode, {
      workspaceId,
      engineOnly: true,
      actor,
      reason: "model_unavailable",
      runId,
    });
  } else if (code === "engine.cost_ceiling_exceeded") {
    await ctx.runMutation(internal.runs.recordInterpretationFailed, {
      runId,
      workspaceId,
      actor,
      reason: "cost_ceiling_exceeded",
    });
  } else if (code === "engine.interpretation_timeout") {
    await ctx.runMutation(internal.runs.recordInterpretationFailed, {
      runId,
      workspaceId,
      actor,
      reason: "interpretation_timeout",
    });
  }
  // Any other error (transient / unexpected) leaves NO durable state.
}

/**
 * Clear the workspace-global Engine-Only Mode on a reachable interpretation call
 * (D3 self-heal). Idempotent (D4) — a no-op when already not-Engine-Only, so the
 * happy path adds one cheap read. Shared by both interpretation actions.
 */
async function clearEngineOnlyModeOnSuccess(
  ctx: ActionCtx,
  { runId, workspaceId, actor }: { runId: Id<"runs">; workspaceId: string; actor: string },
): Promise<void> {
  await ctx.runMutation(internal.interpretationMode.transitionEngineOnlyMode, {
    workspaceId,
    engineOnly: false,
    actor,
    runId,
  });
}

/**
 * Generate per-Origin-Period Method recommendations through the Provenance Gate
 * (Story 5.3, FR-10, AD-5). A public ACTION (it must `fetch` the engine):
 * `requireMember` is its FIRST statement (AD-4), BEFORE the engine call, so an
 * unauthenticated / non-member caller is rejected without reaching the model
 * plane. **`requireMember`, not `requireRole`** — machine-drafting recommendations
 * is not a privileged product-state approval; the Senior-Actuary override is
 * Epic 6 (mirrors `rederiveRun`'s member-vs-role decision).
 *
 * The bounded redraft loop lives server-side in the engine (one HTTP call — see
 * the story Dev Notes on why the loop is in engine_service, not here). This
 * action is the thin persist+audit tail: fetch → callEngine → branch on the
 * discriminated result. Re-running simply overwrites `runs.recommendations` with
 * the fresh machine-drafted document (Epic 6 human overrides don't exist yet, so
 * nothing human-owned is clobbered); it adds NO run-status value (5.3 §Scope).
 */
export const generateRecommendations = action({
  args: { workspaceId: v.string(), runId: v.id("runs") },
  returns: v.object({ status: v.union(v.literal("accepted"), v.literal("rejected")) }),
  handler: async (
    ctx,
    { workspaceId, runId },
  ): Promise<{ status: "accepted" | "rejected" }> => {
    // AD-4: identity + Workspace membership before anything else (before fetch).
    const { identity } = await requireMember(ctx, workspaceId);
    const actor = identity.subject;

    // Tenancy re-check happens inside getRunForRecommend (runId is
    // attacker-controllable); it throws RUN_NOT_FOUND for wrong-workspace/absent
    // and RUN_NOT_INTERPRETABLE for a Run without results + diagnostics.
    const { resultSet, diagnosticsBundle } = await ctx.runQuery(
      internal.runs.getRunForRecommend,
      { runId, workspaceId },
    );

    // Story 5.5 (AD-6/FR-15): audit the TRIGGER of interpretation. Logged AFTER
    // getRunForRecommend passes the tenancy/interpretability check (not before) so
    // a bad/cross-tenant runId that never reaches the engine leaves no triggered
    // event with no matching outcome. The completion/failure events follow below.
    await ctx.runMutation(internal.runs.recordInterpretationTriggered, {
      runId,
      workspaceId,
      actor,
    });

    // callEngine maps the engine error envelope → engine.<code>. Story 5.6
    // (AD-9, D1): fail-closed codes leave durable state before re-throwing —
    // `engine.model_unavailable` records the run failed AND flips the global
    // Engine-Only Mode; `engine.cost_ceiling_exceeded` / `engine.interpretation_timeout`
    // record the per-Run failure only (no global flip). Transient
    // ENGINE_UNAVAILABLE / ENGINE_UNCONFIGURED leave NO durable state (5.5's
    // retry surface). Every case re-throws so 5.5's inline error still shows.
    let response: RecommendResponse;
    try {
      response = await callEngine<RecommendResponse>("/recommendations", {
        runId,
        resultSet,
        diagnosticsBundle,
      });
    } catch (err) {
      await recordInterpretationFailureFromError(ctx, {
        err,
        runId,
        workspaceId,
        actor,
      });
      throw err;
    }

    // Defensive wire-shape guard (like rederiveRun's ENGINE_INVALID_RESPONSE):
    // callEngine casts the JSON unchecked, so validate before branching.
    if (
      response === null ||
      typeof response !== "object" ||
      (response.status !== "accepted" && response.status !== "rejected")
    ) {
      throw new ConvexError({
        code: "ENGINE_INVALID_RESPONSE",
        message: "The /recommendations response did not match the expected contract.",
      });
    }

    // The model responded (accepted OR gate-rejected) → self-heal the global
    // Engine-Only Mode if it was set (idempotent no-op otherwise, D3/D4).
    await clearEngineOnlyModeOnSuccess(ctx, { runId, workspaceId, actor });

    if (response.status === "accepted") {
      if (response.recommendations === null) {
        throw new ConvexError({
          code: "ENGINE_INVALID_RESPONSE",
          message: "An accepted interpretation carried no recommendations document.",
        });
      }
      // storeRecommendations re-validates the document at its typed arg boundary
      // (AD-10) and audits the transcript.
      await ctx.runMutation(internal.runs.storeRecommendations, {
        runId,
        workspaceId,
        actor,
        recommendations: response.recommendations,
        transcript: response.attempts,
      });
      return { status: "accepted" as const };
    }

    // Rejected: a clean, audited failed-Interpretation (AC-2) — NOT a 500.
    await ctx.runMutation(internal.runs.recordInterpretationRejection, {
      runId,
      workspaceId,
      actor,
      transcript: response.attempts,
      rejections: response.rejectionSummary,
    });
    return { status: "rejected" as const };
  },
});

// --- Story 5.4: Reserve Report drafting (persistence + audit + action) -------

/** The engine `/reports` response wire shape (discriminated result, transcripts
 * in every arm — FR-15). `attempts` rides as opaque JSON to the audit payload;
 * only the `accepted` document is a drift-checked contract. */
type DraftReportResponse = {
  status: "accepted" | "rejected";
  report: ReserveReport | null;
  attempts: unknown;
  rejectionSummary: string | null;
};

/**
 * Ingredients for report drafting: the run's stored ResultSet + DiagnosticsBundle
 * + the accepted Recommendations (all passed DOWN into the engine —
 * engine_service is stateless, AD-3). Internal (the trusted
 * `generateReserveReport` action is the only caller), BUT it re-checks tenancy
 * anyway (same RUN_NOT_FOUND for wrong-workspace/absent, so existence never
 * leaks) because the action passes an attacker-controllable runId. A report is
 * drafted "Given accepted recommendations" (AC-1 precondition), so a `complete`
 * run WITHOUT stored recommendations is RUN_NOT_INTERPRETABLE (its message names
 * the missing recommendations). Mirrors `getRunForRecommend`.
 */
export const getRunForDraftReport = internalQuery({
  args: { runId: v.id("runs"), workspaceId: v.string() },
  handler: async (ctx, { runId, workspaceId }) => {
    const run = await ctx.db.get(runId);
    if (run === null || run.workspaceId !== workspaceId) {
      throw new ConvexError({
        code: "RUN_NOT_FOUND",
        message: "That Run does not exist in this Workspace.",
      });
    }
    if (
      run.status !== "complete" ||
      run.resultSet === undefined ||
      run.diagnosticsBundle === undefined ||
      run.recommendations === undefined
    ) {
      throw new ConvexError({
        code: "RUN_NOT_INTERPRETABLE",
        message:
          "Drafting a Reserve Report needs a completed Run with stored results, " +
          "diagnostics, and accepted recommendations.",
      });
    }
    return {
      resultSet: run.resultSet,
      diagnosticsBundle: run.diagnosticsBundle,
      recommendations: run.recommendations,
    };
  },
});

/**
 * Persist the accepted Reserve Report in the `reserveReports` table + audit the
 * transcript (Story 5.4, FR-11/FR-15). THE schema gate is the typed `report`
 * arg (`reserveReportValidator`): a schema-invalid document THROWS at the
 * boundary and is never stored (AD-10). Guarded on `status === "complete"` and
 * matching workspace (no-op on a vanished / cross-tenant run). Chain of custody:
 * the document's `runId` must match the run (like storeRecommendations's check
 * → REPORT_RUN_MISMATCH).
 *
 * UPSERT into `reserveReports` via the `by_run` index: re-drafting overwrites
 * the machine draft (no human edits exist in 5.4 to clobber; Epic 6 guards
 * human-owned rows). The audit payload carries the transcript(s) — the full LLM
 * interaction (FR-15, AD-6) — but NO reserve figures (AD-1/leanness; the report
 * lives on the row). `createdAt` is minted here via the repo's standard
 * `new Date(Date.now()).toISOString()` (matching `createRun`) — never a
 * `datetime.now()` in the engine.
 */
export const storeReserveReport = internalMutation({
  args: {
    runId: v.id("runs"),
    workspaceId: v.string(),
    actor: v.string(),
    report: reserveReportValidator,
    transcript: v.any(),
  },
  handler: async (ctx, { runId, workspaceId, actor, report, transcript }) => {
    const run = await ctx.db.get(runId);
    if (run === null || run.workspaceId !== workspaceId || run.status !== "complete") {
      return;
    }
    // Chain of custody (AD-7): the accepted document's correlation key must be
    // this Run's id — a mismatch means a cross-Run document; never store it.
    if (report.runId !== (runId as string)) {
      throw new ConvexError({
        code: "REPORT_RUN_MISMATCH",
        message: "The Reserve Report document's runId does not match the Run.",
      });
    }

    const now = new Date(Date.now()).toISOString();
    const existing = await ctx.db
      .query("reserveReports")
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .unique();
    if (existing !== null) {
      // A submitted report (Story 6.2, awaiting_review) or published report is
      // out of the machine re-draft path: even a machine-drafted-but-submitted
      // row must not be clobbered back to a fresh draft (the submitted version
      // is what the approver signs — AD-5/D1). Only a `draft` is re-draftable.
      if (existing.status !== "draft") {
        throw new ConvexError({
          code: "REPORT_NOT_EDITABLE",
          message:
            "This Reserve Report is no longer a draft and cannot be regenerated.",
        });
      }
      // A re-draft overwrites the MACHINE draft (regenerable) and resets it to a
      // fresh machine-owned v1. But it must NEVER silently discard human edits
      // (AD-5: once edited, the version is human-owned) — if the existing row is
      // human-owned (`machineDrafted === false`), reject rather than clobber. In
      // 6.1 the generate trigger is only offered when no report exists (D6), so
      // this guard is belt-and-braces for a direct/racing action call.
      if (!existing.machineDrafted) {
        throw new ConvexError({
          code: "REPORT_ALREADY_EDITED",
          message:
            "This Reserve Report has human edits; regenerating would discard " +
            "them. Start a new version instead (Epic 6.4).",
        });
      }
      await ctx.db.patch(existing._id, {
        report,
        machineDrafted: true,
        contentVersion: 1,
        createdBy: actor,
        createdAt: now,
        updatedBy: actor,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("reserveReports", {
        workspaceId,
        runId,
        status: "draft",
        machineDrafted: true,
        report,
        contentVersion: 1,
        createdBy: actor,
        createdAt: now,
        updatedBy: actor,
        updatedAt: now,
      });
    }

    await appendAuditEntryInTransaction(ctx, {
      workspaceId,
      actor,
      eventType: "report.drafted",
      runId,
      payload: { runId, transcript },
    });
  },
});

/**
 * Record a FAILED report drafting (gate/structural exhaustion) — append a
 * `report.draftRejected` audit entry carrying the transcript + rejections
 * (AD-5/FR-11 "the rejection with reasons is audit-logged"). Persists NO report
 * (AC-2 never-partial). Guarded so a vanished / cross-tenant run no-ops. Single
 * audit writer via `appendAuditEntryInTransaction`.
 */
export const recordReportDraftRejection = internalMutation({
  args: {
    runId: v.id("runs"),
    workspaceId: v.string(),
    actor: v.string(),
    transcript: v.any(),
    rejections: v.any(),
  },
  handler: async (ctx, { runId, workspaceId, actor, transcript, rejections }) => {
    const run = await ctx.db.get(runId);
    if (run === null || run.workspaceId !== workspaceId) return;
    await appendAuditEntryInTransaction(ctx, {
      workspaceId,
      actor,
      eventType: "report.draftRejected",
      runId,
      payload: { runId, transcript, rejections },
    });
  },
});

/**
 * The stored Reserve Report for one Run, verbatim (Story 5.4, FR-11) — the
 * report read surface the Epic-6 Report tab subscribes to ONLY when
 * `hasReserveReport` (getRun's boolean gate). The structural twin of
 * `getRecommendations`, but reading the dedicated `reserveReports` table.
 *
 * Public → requireMember first (AD-4); then a tenancy re-check (fetch the run,
 * `null` if outside this Workspace — existence never leaks). Returns the
 * `reserveReports` row verbatim (or `null`); Epic 6 renders it (CitationChip off
 * `report.<section>.citations`). No projection.
 *
 * AD-1: this query only READS and RETURNS the machine-drafted document (whose
 * figures are already gate-rendered from the ResultSet); it computes nothing.
 */
export const getReserveReport = query({
  args: { workspaceId: v.string(), runId: v.id("runs") },
  handler: async (ctx, { workspaceId, runId }) => {
    await requireMember(ctx, workspaceId);
    const run = await ctx.db.get(runId);
    if (run === null || run.workspaceId !== workspaceId) return null;
    // Returns the row verbatim — now carrying the 6.1 human-edit columns
    // (contentVersion/updatedBy/updatedAt/status) automatically. No projection.
    return await ctx.db
      .query("reserveReports")
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .unique();
  },
});

// The four canonical Reserve Report sections (FR-11), in editor order.
const reportSectionsValidator = v.object({
  executiveSummary: v.string(),
  methodSelectionRationale: v.string(),
  movementCommentary: v.string(),
  limitations: v.string(),
});

/**
 * Edit a draft Reserve Report (Story 6.1, AC-1, FR-13, AD-5). A member action —
 * `requireMember` FIRST (AD-4); editing a draft is NOT a privileged approval
 * (approve/publish/override are `requireRole(senior_actuary)` in 6.3/6.4).
 *
 * The client sends ONLY the four edited section TEXTS (each with inline
 * `[[cite:...]]` markers). The mutation RE-DERIVES each section's `citations[]`
 * from its markers server-side (`citationsFromText`, D2) — the client is never
 * trusted for the machine-readable pin, so `text`↔`citations` stay consistent by
 * construction (deleting a chip drops its marker → its id disappears). The ONLY
 * edit-time validation is marker-syntax INTEGRITY (`markersAreWellFormed`, keep
 * the text tokenizable) — this is explicitly NOT the Provenance Gate (AD-5:
 * human edits are never re-gated; no numeric-provenance / claim-coupling check).
 *
 * The reassembled document keeps `schemaVersion`/`runId`, flips `machineDrafted`
 * to false (this version is now human-owned), and is re-validated at the typed
 * `report` patch boundary (AD-10: a malformed doc throws, never stored). The row
 * bumps `contentVersion` (+1 — the version the approver signs, AD-5/FR-13) and
 * records `updatedBy`/`updatedAt`. Audited `report.edited` with a LEAN payload
 * ({ runId, contentVersion } only — the content lives on the row; AD-1/AD-6).
 */
export const editReserveReport = mutation({
  args: {
    workspaceId: v.string(),
    runId: v.id("runs"),
    sections: reportSectionsValidator,
  },
  returns: v.object({ contentVersion: v.number() }),
  handler: async (ctx, { workspaceId, runId, sections }) => {
    const { identity } = await requireMember(ctx, workspaceId);
    const actor = identity.subject;

    const existing = await ctx.db
      .query("reserveReports")
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .unique();
    // No existence leak: a vanished / cross-tenant row throws the same
    // REPORT_NOT_FOUND (mirrors getRunForDraftReport's tenancy posture).
    if (existing === null || existing.workspaceId !== workspaceId) {
      throw new ConvexError({
        code: "REPORT_NOT_FOUND",
        message: "That Reserve Report does not exist in this Workspace.",
      });
    }
    // Immutability guard (D5): only a `draft` is editable. An `awaiting_review`
    // (6.2) or `published` (6.4) report is immutable to edits (AC-2 "no one
    // edits a non-draft/published report").
    if (existing.status !== "draft") {
      throw new ConvexError({
        code: "REPORT_NOT_EDITABLE",
        message:
          "This Reserve Report is no longer a draft and cannot be edited.",
      });
    }

    // Marker-syntax integrity per section (keep the stored text tokenizable).
    for (const text of Object.values(sections)) {
      if (!markersAreWellFormed(text)) {
        throw new ConvexError({
          code: "MALFORMED_CITATION_MARKER",
          message:
            "A citation marker in the edited text is malformed. Edit around " +
            "chips — never inside them.",
        });
      }
    }

    // Reassemble the typed document: re-derive citations from the markers.
    const report = {
      ...existing.report,
      machineDrafted: false,
      executiveSummary: {
        text: sections.executiveSummary,
        citations: citationsFromText(sections.executiveSummary),
      },
      methodSelectionRationale: {
        text: sections.methodSelectionRationale,
        citations: citationsFromText(sections.methodSelectionRationale),
      },
      movementCommentary: {
        text: sections.movementCommentary,
        citations: citationsFromText(sections.movementCommentary),
      },
      limitations: {
        text: sections.limitations,
        citations: citationsFromText(sections.limitations),
      },
    };

    const contentVersion = existing.contentVersion + 1;
    const now = new Date(Date.now()).toISOString();
    // The typed `report` patch re-validates the reassembled document (AD-10).
    await ctx.db.patch(existing._id, {
      report,
      machineDrafted: false,
      contentVersion,
      updatedBy: actor,
      updatedAt: now,
    });

    await appendAuditEntryInTransaction(ctx, {
      workspaceId,
      actor,
      eventType: "report.edited",
      runId,
      payload: { runId, contentVersion },
    });

    return { contentVersion };
  },
});

/**
 * Create a Reserve Report shell from the MANUAL template (Story 6.1, AC-2,
 * FR-12, AD-9). Offered whenever no report exists — the ONLY path in Engine-Only
 * Mode, a secondary option otherwise. A member action (`requireMember` first).
 *
 * NO interpretability precondition (unlike `getRunForDraftReport`): hand
 * drafting must work during a model outage (AD-9) — a manual report needs no
 * ResultSet / DiagnosticsBundle / recommendations. It still attaches to a Run
 * (the Report tab lives under `/runs/[runId]`), so the Run must exist in this
 * Workspace. Idempotent: a second call throws `REPORT_ALREADY_EXISTS` rather
 * than clobbering an existing draft / machine draft.
 *
 * Builds a `draft`, `machineDrafted: false`, `contentVersion: 1`, four EMPTY
 * sections (no chips → the atomic-chip / uncited machinery is inert until the
 * Analyst types). `schemaVersion` is the shared engine constant (no engine here
 * to supply it). Audited `report.manualCreated` ({ runId }, lean).
 */
export const createManualReport = mutation({
  args: { workspaceId: v.string(), runId: v.id("runs") },
  returns: v.id("reserveReports"),
  handler: async (ctx, { workspaceId, runId }) => {
    const { identity } = await requireMember(ctx, workspaceId);
    const actor = identity.subject;

    const run = await ctx.db.get(runId);
    if (run === null || run.workspaceId !== workspaceId) {
      throw new ConvexError({
        code: "RUN_NOT_FOUND",
        message: "That Run does not exist in this Workspace.",
      });
    }

    const existing = await ctx.db
      .query("reserveReports")
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .unique();
    if (existing !== null) {
      throw new ConvexError({
        code: "REPORT_ALREADY_EXISTS",
        message: "A Reserve Report already exists for this Run.",
      });
    }

    const emptySection = { text: "", citations: [] as string[] };
    const now = new Date(Date.now()).toISOString();
    const reportId = await ctx.db.insert("reserveReports", {
      workspaceId,
      runId,
      status: "draft",
      machineDrafted: false,
      report: {
        schemaVersion: RESERVE_REPORT_SCHEMA_VERSION,
        runId: runId as string,
        machineDrafted: false,
        executiveSummary: { ...emptySection },
        methodSelectionRationale: { ...emptySection },
        movementCommentary: { ...emptySection },
        limitations: { ...emptySection },
      },
      contentVersion: 1,
      createdBy: actor,
      createdAt: now,
      updatedBy: actor,
      updatedAt: now,
    });

    await appendAuditEntryInTransaction(ctx, {
      workspaceId,
      actor,
      eventType: "report.manualCreated",
      runId,
      payload: { runId },
    });

    return reportId;
  },
});

/**
 * Submit a draft Reserve Report for review (Story 6.2, AC-1, AC-2, FR-13,
 * UX-DR14). A MEMBER action — `requireMember` FIRST (AD-4, D1); submitting a
 * draft is NOT a privileged approval (approve/publish/override are
 * `requireRole(senior_actuary)` in 6.3/6.4).
 *
 * "Race-free" (the AC's word) is Convex transactional serializability + a
 * `status === "draft"` precondition, NOT client coordination (D1). Two
 * concurrent submits: one patches draft → awaiting_review; the second re-reads
 * `awaiting_review` inside its own transaction and throws
 * `REPORT_NOT_SUBMITTABLE`. The same precondition makes a double-click
 * idempotent. This mirrors `editReserveReport`'s guard-on-current-state shape.
 *
 * The draft LOCK is not new code here: flipping `status` to `awaiting_review`
 * makes the existing `editReserveReport` guard (`REPORT_NOT_EDITABLE`) reject
 * edits and the existing `ReportEditorView` render read-only (D2). Submission
 * is a human-owned lifecycle event, NEVER re-gated (AD-5) — it does not touch
 * `contentVersion` (the submitted version is the current one, which the
 * approver signs in 6.4). `assignee` is ADVISORY routing metadata, stored but
 * role-UNVERIFIED server-side (no Clerk-backend seam in Convex — D4). Audited
 * `report.submittedForReview` with a LEAN payload ({ runId, contentVersion,
 * assignee } — no section text/figures; AD-1/AD-6).
 */
export const submitReportForReview = mutation({
  args: {
    workspaceId: v.string(),
    runId: v.id("runs"),
    assignee: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { workspaceId, runId, assignee }) => {
    const { identity } = await requireMember(ctx, workspaceId);
    const actor = identity.subject;

    const existing = await ctx.db
      .query("reserveReports")
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .unique();
    // No existence leak: a vanished / cross-tenant row throws the same
    // REPORT_NOT_FOUND (mirrors editReserveReport's tenancy posture, :1488).
    if (existing === null || existing.workspaceId !== workspaceId) {
      throw new ConvexError({
        code: "REPORT_NOT_FOUND",
        message: "That Reserve Report does not exist in this Workspace.",
      });
    }
    // The race guard (D1): only a `draft` is submittable. A second submit / an
    // already-submitted (awaiting_review) or published report is rejected.
    if (existing.status !== "draft") {
      throw new ConvexError({
        code: "REPORT_NOT_SUBMITTABLE",
        message:
          "This Reserve Report is not a draft and cannot be submitted for review.",
      });
    }

    const now = new Date(Date.now()).toISOString();
    await ctx.db.patch(existing._id, {
      status: "awaiting_review",
      submittedBy: actor,
      submittedAt: now,
      // Advisory routing (D4); omit when not provided.
      assignee: assignee ?? undefined,
    });

    await appendAuditEntryInTransaction(ctx, {
      workspaceId,
      actor,
      eventType: "report.submittedForReview",
      runId,
      payload: { runId, contentVersion: existing.contentVersion, assignee: assignee ?? null },
    });

    return null;
  },
});

/**
 * The review-queue DATA PRIMITIVE (Story 6.2, AC-1, D5) — every Reserve Report
 * awaiting review in this Workspace, lean routing metadata only. Public →
 * `requireMember` FIRST (AD-4). Workspace-scoped, NOT assignee-filtered — the
 * 7.3 dashboard queue shows all `awaiting_review` reports with submitter+date
 * (epics.md:812); the `assignee` is advisory (D4).
 *
 * Projects a LEAN row list (`reportId`/`runId`/`submittedBy`/`submittedAt`/
 * `assignee` — NO `report` document, NO figures; AD-1), newest-submitted first
 * (a string ISO sort is chronological). This is the query 7.3's dashboard
 * consumes; 6.2 ships it + the convex-test only (no UI — the dashboard render
 * is 7.3).
 */
export const listReportsAwaitingReview = query({
  args: { workspaceId: v.string() },
  returns: v.array(
    v.object({
      reportId: v.id("reserveReports"),
      runId: v.id("runs"),
      submittedBy: v.optional(v.string()),
      submittedAt: v.optional(v.string()),
      assignee: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, { workspaceId }) => {
    await requireMember(ctx, workspaceId);
    const rows = await ctx.db
      .query("reserveReports")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .filter((q) => q.eq(q.field("status"), "awaiting_review"))
      .collect();
    return rows
      .map((r) => ({
        reportId: r._id,
        runId: r.runId,
        submittedBy: r.submittedBy,
        submittedAt: r.submittedAt,
        assignee: r.assignee,
      }))
      .sort((a, b) => (b.submittedAt ?? "").localeCompare(a.submittedAt ?? ""));
  },
});

/**
 * Draft a Reserve Report through the Provenance Gate (Story 5.4, FR-11, AD-5). A
 * public ACTION (it must `fetch` the engine): `requireMember` is its FIRST
 * statement (AD-4), BEFORE the engine call, so an unauthenticated / non-member
 * caller is rejected without reaching the model plane. **`requireMember`, not
 * `requireRole`** — machine-drafting a report is not a privileged product-state
 * approval; approve/publish/override land in Epic 6 (`requireRole(senior_actuary)`).
 * Mirrors `generateRecommendations`'s documented member-vs-role decision.
 *
 * The bounded redraft loop lives server-side in the engine (one HTTP call). This
 * action is the thin persist+audit tail: fetch → callEngine → branch on the
 * discriminated result. Re-running overwrites the machine draft in
 * `reserveReports` (via storeReserveReport's upsert); it adds NO run-status value
 * (interpretation status/lifecycle is 5.5/5.6/Epic 6).
 */
export const generateReserveReport = action({
  args: { workspaceId: v.string(), runId: v.id("runs") },
  returns: v.object({ status: v.union(v.literal("accepted"), v.literal("rejected")) }),
  handler: async (
    ctx,
    { workspaceId, runId },
  ): Promise<{ status: "accepted" | "rejected" }> => {
    // AD-4: identity + Workspace membership before anything else (before fetch).
    const { identity } = await requireMember(ctx, workspaceId);
    const actor = identity.subject;

    // Tenancy re-check happens inside getRunForDraftReport (runId is
    // attacker-controllable); it throws RUN_NOT_FOUND for wrong-workspace/absent
    // and RUN_NOT_INTERPRETABLE for a Run without results + diagnostics +
    // recommendations (AC-1 precondition).
    const { resultSet, diagnosticsBundle, recommendations } = await ctx.runQuery(
      internal.runs.getRunForDraftReport,
      { runId, workspaceId },
    );

    // callEngine maps the engine error envelope → engine.<code>. Story 5.6
    // (AD-9, D1): identical fail-closed wiring to generateRecommendations —
    // model outage flips the global mode, cost/timeout are per-Run only,
    // transient errors leave no durable state; every case re-throws.
    let response: DraftReportResponse;
    try {
      response = await callEngine<DraftReportResponse>("/reports", {
        runId,
        resultSet,
        diagnosticsBundle,
        recommendations,
      });
    } catch (err) {
      await recordInterpretationFailureFromError(ctx, {
        err,
        runId,
        workspaceId,
        actor,
      });
      throw err;
    }

    // Defensive wire-shape guard (like generateRecommendations's
    // ENGINE_INVALID_RESPONSE): callEngine casts the JSON unchecked, so validate
    // before branching.
    if (
      response === null ||
      typeof response !== "object" ||
      (response.status !== "accepted" && response.status !== "rejected")
    ) {
      throw new ConvexError({
        code: "ENGINE_INVALID_RESPONSE",
        message: "The /reports response did not match the expected contract.",
      });
    }

    // The model responded → self-heal the global Engine-Only Mode (idempotent).
    await clearEngineOnlyModeOnSuccess(ctx, { runId, workspaceId, actor });

    if (response.status === "accepted") {
      if (response.report === null) {
        throw new ConvexError({
          code: "ENGINE_INVALID_RESPONSE",
          message: "An accepted drafting carried no Reserve Report document.",
        });
      }
      // storeReserveReport re-validates the document at its typed arg boundary
      // (AD-10) and audits the transcript.
      await ctx.runMutation(internal.runs.storeReserveReport, {
        runId,
        workspaceId,
        actor,
        report: response.report,
        transcript: response.attempts,
      });
      return { status: "accepted" as const };
    }

    // Rejected: a clean, audited failed drafting (AC-2/AC-4) — NOT a 500, never
    // a silent queue.
    await ctx.runMutation(internal.runs.recordReportDraftRejection, {
      runId,
      workspaceId,
      actor,
      transcript: response.attempts,
      rejections: response.rejectionSummary,
    });
    return { status: "rejected" as const };
  },
});
