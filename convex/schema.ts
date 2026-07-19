import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  diagnosticsBundleValidator,
  recommendationsValidator,
  reserveReportValidator,
  resultSetValidator,
  runParametersValidator,
  triangleValidator,
} from "./lib/engineContract";

// Tables are defined just-in-time by the story that first needs them.
export default defineSchema({
  // Append-only, per-Workspace hash-chained audit trail (AD-6, FR-15).
  // Exactly one internal mutation — auditLogs.appendAuditEntry — inserts
  // rows; NO code path may patch or delete them (enforced by
  // tests/audit-append-only.test.ts and code review).
  auditLogs: defineTable({
    workspaceId: v.string(), // Clerk org ID — the Workspace
    // Correlation key. Stays v.optional(v.string()) even though the `runs`
    // table now exists (Epic 4): the chain also carries non-Run events (1.x/3.x
    // entries have no runId), and run.created stringifies the new run's _id into
    // it — a string correlation key, deliberately NOT widened to v.id("runs").
    runId: v.optional(v.string()),
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
  // the user confirms periods in 3.3, at which point acceptance flips it to
  // `validated` and freezes the accepted content (Story 3.3, AD-3 immutability).
  triangles: defineTable({
    workspaceId: v.string(), // Clerk org ID — the Workspace
    label: v.union(v.literal("paid"), v.literal("incurred")),
    status: v.union(
      v.literal("pending_validation"),
      v.literal("validation_failed"),
      v.literal("validated"),
    ),
    format: v.union(v.literal("csv"), v.literal("xlsx")),
    storageId: v.id("_storage"),
    rawFileHash: v.string(), // sha256 lowercase hex of the raw uploaded bytes
    filename: v.string(),
    uploadedBy: v.string(), // Clerk user id (identity.subject)
    uploadedAt: v.string(), // ISO-8601 UTC

    // --- Accepted-Triangle fields (Story 3.3) --------------------------------
    // All optional: set ONLY at acceptance (status → validated), absent on
    // pending/failed rows. Once set they are immutable — no code path patches a
    // `validated` row's content (enforced by markAccepted's status gate + tests).
    //
    // triangleHash is the canonical-triangle-JSON sha256 (AD-11 Lineage hash),
    // ENGINE-computed via /canonicalize — distinct from rawFileHash (the
    // byte-for-byte dedupe hash from 3.1). Named to match Lineage.triangleHash.
    triangleHash: v.optional(v.string()),
    // The confirmed, immutable Triangle content (kind + confirmed labels +
    // cells) — the source for the detail-page grid and future re-derivation.
    acceptedTriangle: v.optional(triangleValidator),
    // Confirmed granularity/interval for display only (opaque strings; never
    // used in any computation — AD-1).
    periodMeta: v.optional(
      v.object({
        originGranularity: v.string(),
        developmentInterval: v.string(),
      }),
    ),
    acceptedBy: v.optional(v.string()), // Clerk user id (identity.subject)
    acceptedAt: v.optional(v.string()), // ISO-8601 UTC
  })
    // Library list, newest-first per Workspace.
    .index("by_workspace", ["workspaceId"])
    // Duplicate lookup + OCC-serialized insert-if-absent.
    .index("by_workspace_hash", ["workspaceId", "rawFileHash"]),

  // Runs (FR-4, AD-7). Story 4.1 creates the job record; Story 4.2 runs it. The
  // runs doc is the SOLE authority on status. The `status` union is the closed
  // AD-7 vocabulary; 4.1 only ever writes `queued`. The
  // `queued → running → complete | failed` transitions are written ONLY by
  // Story 4.2's @convex-dev/workflow orchestration path (markRunning /
  // storeResultSet / markRunFailed) — no other code path writes status. That
  // path also fills the just-in-time result/diagnostics/error/timestamp fields
  // below (all optional: a `queued` row carries none of them).
  // Job-record-first: this row exists (atomically audited) before any
  // orchestration touches it.
  runs: defineTable({
    workspaceId: v.string(), // Clerk org ID — the Workspace
    triangleId: v.id("triangles"), // the Triangle this Run is over
    // Denormalized copy of the Triangle's canonical triangleHash at creation
    // (immutable provenance on the run record; the engine re-stamps the SAME
    // value into ResultSet.lineage.triangleHash in 4.2 — storeResultSet asserts
    // they match, AD-11 chain of custody).
    triangleHash: v.string(),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("complete"),
      v.literal("failed"),
    ),
    // { methods, aprioriLossRatios } — camelCase, engine-ready (sent to /runs
    // verbatim in 4.2). Single-sourced from the engine contract.
    parameters: runParametersValidator,
    createdBy: v.string(), // Clerk user id (identity.subject)
    createdAt: v.string(), // ISO-8601 UTC

    // --- Orchestration fields (Story 4.2) ------------------------------------
    // All optional: set ONLY by the @convex-dev/workflow orchestration path,
    // absent on a freshly-queued row.
    //
    // The WorkflowId (stringified) from workflow.start, kept for status/cancel
    // observability (4.3). Stored as a plain string — no component-type import
    // into schema.ts.
    workflowId: v.optional(v.string()),
    // The schema-validated ResultSet / DiagnosticsBundle (AD-10), set together
    // at `complete`. Typed by the shared engine-contract validators, so a
    // schema-invalid engine response can never be stored here (storeResultSet's
    // args are validated at the boundary).
    resultSet: v.optional(resultSetValidator),
    diagnosticsBundle: v.optional(diagnosticsBundleValidator),
    // Story 5.3: the accepted Method-recommendation document (FR-10), machine-
    // drafted through the Provenance Gate + structural validator, persisted
    // inline exactly like resultSet/diagnosticsBundle (no child table — same
    // pattern, "document linked to the Run" is the row itself). Typed by the
    // shared engine-contract validator, so a schema-invalid document can never
    // be stored (storeRecommendations's arg is validated at the boundary, AD-10).
    // Absent until generateRecommendations succeeds; overwritten by a re-run.
    recommendations: v.optional(recommendationsValidator),
    // Story 5.6 (AD-9): the durable per-Run interpretation-FAILURE state. Set
    // when an Interpretation attempt fails closed — the model was unreachable
    // (`model_unavailable`, which ALSO flips the workspace-global Engine-Only
    // Mode), or this Run hit its per-Run token/cost ceiling or time limit
    // (per-Run only, NOT global — D1). Distinct from `runs.status` (the AD-7
    // enum stays queued|running|complete|failed) and from a gate rejection
    // (`run.interpretationRejected`): a fail-closed attempt that could not
    // run/complete. This closes 5.5's deferred durable *failed* state (survives
    // reload, unlike the transient useAction flag); the durable *running* state
    // still needs the async transport and stays deferred. Additive optional →
    // no migration. Lean — the reason enum + timestamp, NO figures (AD-1).
    interpretationFailure: v.optional(
      v.object({
        reason: v.union(
          v.literal("model_unavailable"),
          v.literal("cost_ceiling_exceeded"),
          v.literal("interpretation_timeout"),
        ),
        at: v.number(),
      }),
    ),
    // The failure reason, set at `failed` (engine error or a validation/hash
    // mismatch surfaced via onRunComplete).
    error: v.optional(v.object({ code: v.string(), message: v.string() })),
    // Lifecycle timestamps, ISO-8601 UTC.
    startedAt: v.optional(v.string()),
    completedAt: v.optional(v.string()),
    failedAt: v.optional(v.string()),
  })
    // Run listing per Workspace (Run detail 4.3 / dashboard Epic 7).
    .index("by_workspace", ["workspaceId"]),

  // Reserve Reports (FR-11). Story 5.4 drafts a machine-authored report through
  // the Provenance Gate and persists the accepted document here. This is a
  // DELIBERATE reversal of 5.3's inline-on-runs choice: the Reserve Report is a
  // human-owned artifact from the moment it exists (PRD §4.5) with an
  // independent lifecycle (draft → awaiting review → published, Epic 6.2/6.4),
  // immutable published versions + "start new version" superseding records
  // (Epic 6.4, FR-13), and human-edit content versioning (Epic 6.1) — none of
  // which fit an inline optional on `runs`. Ship it LEAN: `status` is a single
  // `draft` literal (Epic 6 extends the union so a schema-invalid status can't
  // be written); no versioning columns yet (Epic 6 owns them); one row per run
  // that a re-draft overwrites. `report` is typed by `reserveReportValidator`,
  // so a schema-invalid document THROWS at the mutation boundary and is never
  // stored (AD-10).
  reserveReports: defineTable({
    workspaceId: v.string(), // Clerk org ID — the Workspace (AD-4 scoping)
    runId: v.id("runs"), // the Run this report interprets
    status: v.union(v.literal("draft")), // 5.4 writes only "draft"; Epic 6 adds awaiting_review/published
    machineDrafted: v.boolean(), // AC-3 provenance marker (true for the agent path)
    report: reserveReportValidator, // the four gated sections (typed by the engine contract, AD-10)
    createdBy: v.string(), // Clerk user id (identity.subject) who triggered drafting
    createdAt: v.string(), // ISO-8601 UTC
  })
    // One report per run in 5.4 (re-draft overwrites); Epic 6 versions.
    .index("by_run", ["runId"])
    // Review-queue / dashboard listing (Epic 6/7).
    .index("by_workspace", ["workspaceId"]),

  // Engine-Only Mode state (Story 5.6, AD-9, D2). The per-Workspace, durable,
  // SERVER-DERIVED system-of-record for the workspace-global Engine-Only Mode:
  // written ONLY by server code (the two interpretation actions on model
  // outage + the recovery probe) from the engine's typed response, never a
  // client guess. The global banner + the run page SUBSCRIBE to it
  // (`getInterpretationMode`, reactive, survives reload, no polling — FR-20).
  // ONE row per Workspace (the global-mode singleton). Holds ONLY the derived
  // Engine-Only flag + provenance of the last transition — never role/run-status
  // (single-source-of-truth rule). NO figures (AD-1).
  interpretationModes: defineTable({
    workspaceId: v.string(), // Clerk org ID — the Workspace
    engineOnly: v.boolean(), // the derived Engine-Only Mode flag
    since: v.number(), // ms timestamp of the current-state transition
    reason: v.optional(v.string()), // provenance of the last entry (e.g. "model_unavailable")
    lastRunId: v.optional(v.id("runs")), // the Run whose failed attempt drove the last transition
  })
    // The singleton lookup + subscription per Workspace.
    .index("by_workspace", ["workspaceId"]),
});
