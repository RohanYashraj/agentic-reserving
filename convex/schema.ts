import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  diagnosticsBundleValidator,
  methodValidator,
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
  // which fit an inline optional on `runs`. `report` is typed by
  // `reserveReportValidator`, so a schema-invalid document THROWS at the mutation
  // boundary and is never stored (AD-10).
  //
  // Story 6.1 extends this table with the human-edit lifecycle the 5.4 comment
  // reserved: (a) `status` grows to the full lifecycle union so the edit
  // immutability guard (`REPORT_NOT_EDITABLE` off a non-`draft` row) is real and
  // testable now — 6.1 WRITES only `draft` (manual create → draft; edit keeps
  // draft); `awaiting_review` (6.2) and `published` (6.4) are those stories'.
  // (b) The content-versioning + human-ownership columns `contentVersion`
  // /`updatedBy`/`updatedAt` — `contentVersion` is the IN-PLACE edit counter
  // (starts 1 at machine draft / manual create, +1 per human edit) the approver
  // signs (AD-5/FR-13); distinct from Epic 6.4's "start new version" supersession
  // (a NEW row, FR-13). `machineDrafted` flips false on the first human edit —
  // the current version is now human-owned (AD-5). These are PRODUCT-PLANE
  // columns on the Convex table, NOT part of the drift-checked `report` document
  // (AD-10) — so the engine contract is untouched. The three new fields are
  // REQUIRED (not optional): the table is Epic-6-fresh (5.4's
  // `generateReserveReport` was never wired to any UI before 6.1 — D6 — so no
  // machine-draft rows exist), and `storeReserveReport` now writes them on the
  // machine path too, so every row is valid under this schema. NOTE: if a stray
  // pre-6.1 dev row exists it must be cleared once (documented, deferred-work
  // §6.1); no supersession columns are added here (Epic 6.4 owns those).
  reserveReports: defineTable({
    workspaceId: v.string(), // Clerk org ID — the Workspace (AD-4 scoping)
    runId: v.id("runs"), // the Run this report interprets
    // Full lifecycle union (6.1). 6.1 writes only "draft"; the two extra
    // literals make the edit-immutability guard + AC-2 "no one edits a published
    // report" a real test (seed a `published` row → the edit is rejected).
    status: v.union(
      v.literal("draft"),
      v.literal("awaiting_review"),
      v.literal("published"),
    ),
    // AC-3 provenance marker: true while purely machine-drafted, false after any
    // human edit (the current version is human-owned — D4/AD-5).
    machineDrafted: v.boolean(),
    report: reserveReportValidator, // the four gated sections (typed by the engine contract, AD-10)
    // In-place human-edit counter (6.1, D4): 1 at machine draft / manual create,
    // +1 on every human edit. The "content version" the approver signs
    // (AD-5/FR-13). NOT Epic 6.4's superseding-version record.
    contentVersion: v.number(),
    createdBy: v.string(), // Clerk user id (identity.subject) who first created the row
    createdAt: v.string(), // ISO-8601 UTC
    updatedBy: v.string(), // Clerk user id of the last writer (machine actor or human editor)
    updatedAt: v.string(), // ISO-8601 UTC of the last write
    // Story 6.2 submission metadata (draft → awaiting_review). Optional — a
    // `draft` has no submitter/assignee until it is submitted (6.2). `assignee`
    // is ADVISORY routing (role-unverified server-side — no Clerk-backend seam;
    // D4); the lock + status flip are the enforced parts.
    assignee: v.optional(v.string()), // Clerk user id of the assigned Senior Actuary (advisory)
    submittedBy: v.optional(v.string()), // Clerk user id of the submitter
    submittedAt: v.optional(v.string()), // ISO-8601 UTC of submission
    // Story 6.4 approval + versioning metadata. Optional — a report has no
    // approver until published (D4), no `supersedes` until a new version is
    // started (D5), and no `draftBaseline` until first human-edited (D9).
    // Published immutability is enforced by the edit/submit status guards + the
    // append-only `publishedReportVersions` snapshot (D3), NOT by these columns.
    approvedBy: v.optional(v.string()), // Clerk user id of the approving Senior Actuary
    approvedAt: v.optional(v.string()), // ISO-8601 UTC of approval
    supersedes: v.optional(v.id("publishedReportVersions")), // the published snapshot a re-opened draft supersedes (D5)
    draftBaseline: v.optional(reserveReportValidator), // the machine-drafted original captured at first human edit (D9)
  })
    // One report per run in 5.4 (re-draft overwrites); Epic 6 versions.
    .index("by_run", ["runId"])
    // Review-queue / dashboard listing (Epic 6/7).
    .index("by_workspace", ["workspaceId"]),

  // Story 6.3 Senior-Actuary overrides (FR-10, UX-DR11). APPEND-ONLY on the data
  // plane — an override is inserted, never patched/deleted; history is never
  // erased (the LATEST per (runId, origin) is the current override, prior ones
  // remain as history + in the audit log). A separate product-plane table so the
  // drift-checked `runs.recommendations` engine document stays immutable (AD-10)
  // and a machine re-run of `generateRecommendations` never clobbers human
  // overrides. Mirrors the `reserveReports` separate-human-artifact precedent
  // (D1). `overridingMethod` reuses the engine-contract `methodValidator` (the
  // same three literals as the Run's methods — no separate enum; no drift, it is
  // already the contract's own type).
  recommendationOverrides: defineTable({
    workspaceId: v.string(), // Clerk org ID — the Workspace (AD-4 scoping)
    runId: v.id("runs"), // the Run whose recommendation is overridden
    origin: v.string(), // the Origin Period of the overridden recommendation
    overridingMethod: methodValidator, // the Method the Senior Actuary chose instead
    reason: v.string(), // the recorded human reason (FR-10 — carried into the audit)
    overriddenBy: v.string(), // Clerk user id (identity.subject) of the Senior Actuary
    overriddenAt: v.string(), // ISO-8601 UTC
  })
    // Per-Run override history (query + latest-per-origin derivation, D9).
    .index("by_run", ["runId"])
    // Tenancy scan / Workspace listing.
    .index("by_workspace", ["workspaceId"]),

  // Story 6.4 immutable published record (FR-13). APPEND-ONLY — a snapshot is
  // inserted on approve, never patched/deleted; it is the durable, signed
  // published content the approver's signature covers. A separate table (not a
  // second `reserveReports` row) keeps the `by_run.unique()` invariant intact
  // across all report functions (D3), mirroring the `recommendationOverrides`
  // separate-append-only precedent. `overrideCount` = distinct overridden
  // Origin Periods at approval time (D4). The frozen `report` reuses
  // `reserveReportValidator` (the drift-checked engine document, unchanged —
  // AD-10; approval/versioning metadata is product-plane, not part of it).
  publishedReportVersions: defineTable({
    workspaceId: v.string(), // Clerk org ID — the Workspace (AD-4 scoping)
    runId: v.id("runs"), // the Run this published version interprets
    reportId: v.id("reserveReports"), // the working row that was published
    contentVersion: v.number(), // the signed in-place edit version (AD-5/FR-13)
    report: reserveReportValidator, // the frozen, signed content copy (immutable)
    approvedBy: v.string(), // Clerk user id of the approving Senior Actuary
    approvedAt: v.string(), // ISO-8601 UTC of approval
    overrideCount: v.number(), // distinct overridden Origin Periods at approval (D4)
  })
    // Latest-version lookup for "Start new version" (D5).
    .index("by_run", ["runId"])
    // Tenancy scan / future 7.x version browser.
    .index("by_workspace", ["workspaceId"])
    // History for one working row.
    .index("by_report", ["reportId"]),

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
