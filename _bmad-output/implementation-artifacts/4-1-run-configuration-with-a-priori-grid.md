---
baseline_commit: ac465394df6a8bc49d9641c118783d5fdb37ef40
---

# Story 4.1: Run Configuration with A Priori Grid

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an Analyst,
I want to configure a Run selecting Methods and entering BF a prioris (a loss ratio and a premium per Origin Period),
so that I can start exactly the computation the review needs. (FR-4)

## Acceptance Criteria

**AC1 — Method selection + BF a-priori grid, gated Start (FR-4)**
Given a validated Triangle (`triangles` doc, `status: "validated"`),
When the Analyst opens "Run methods",
Then they can select any subset of `{CL, BF, Mack}`; selecting BF opens an a-priori grid with **two** Geist-Mono (`numeric`) inputs per Origin Period — an **A Priori Loss Ratio** and a **Premium** (exposure) — each supporting a pasted column,
And the Start button stays disabled until **every** Origin Period has **both** a loss ratio (finite, ≥ 0) **and** a premium (finite, > 0) whenever BF is selected, and at least one Method is selected. When BF is not selected the grid is hidden and Start requires only ≥ 1 Method.

> **Design decision (Rohan, 2026-07-19):** the grid captures **both** loss ratio and premium per Origin Period because the built engine's BF computes expected ultimate = `loss_ratio × exposure` (`reserving_engine.AprioriLossRatio {origin, loss_ratio, exposure}`, Epic 2, golden-tested/frozen). A loss ratio alone cannot produce a reserve figure, and there is no premium anywhere else in the system (Triangles are loss-only). This extends the PRD/UX "one loss ratio per Origin Period" (FR-4, EXPERIENCE.md:133) to two columns; the a-priori grid is the sole premium-entry surface. The stored `{origin, lossRatio, exposure}` maps 1:1 to the engine wire contract (`aprioriLossRatioValidator` already in `engineContract.ts`), so Story 4.2 sends `parameters` straight to `/runs`.

**AC2 — Job-record-first: `runs` doc created `queued`, sole status authority (AD-7)**
Given a Start,
When the `createRun` **mutation** executes,
Then a `runs` document is created with `status: "queued"`, carrying the Triangle reference (`triangleId` + denormalized `triangleHash`), the selected Methods and the parameters (`{ methods, aprioriLossRatios }`, camelCase, engine-ready),
And the `runs` record is the **sole authority on status** — the `status` union is the closed AD-7 vocabulary `queued | running | complete | failed`, but 4.1 only ever writes `queued` (the `running | complete | failed` transitions are owned exclusively by Story 4.2's orchestration path; no other code path writes status).

**AC3 — Fail-closed server-side gating, not UI-hiding (AD-4, FR-4)**
Given the `createRun` mutation,
When it executes,
Then it **re-validates** every gate server-side (never trusting the client): `requireMember` first; the `triangleId` is re-checked for tenancy and `status === "validated"`; ≥ 1 Method; and when BF is selected, the a-prioris must cover **exactly** the Triangle's Origin Periods (one per origin, no duplicates, no unknown origins) with each `lossRatio` finite ≥ 0 and each `exposure` finite > 0 — mirroring the engine's `_check_aprioris` + `AprioriLossRatio` field validators so a bad set is rejected here, not deep in 4.2's engine call. Each failure throws a typed `ConvexError({ code, message })`.

**AC4 — Run creation is audit-logged, atomically (AD-6, FR-15)**
Given a successful `createRun`,
When the run is inserted,
Then a `run.created` entry is appended to `auditLogs` **in the same transaction** as the run insert (so a queued run always carries its creation audit — no orphan runs, no orphan entries), through the single AD-6 writer path (never an inline `auditLogs` insert). Payload is lean: `{ runId, triangleId, methods, originCount, aprioriCount }` — the full parameters live on the `runs` row, not duplicated into the audit entry.

**AC5 — Guard, gating, and job-record-first tests (AD-4, AD-6, AD-7, NFR-3)**
convex-test covers: unauthenticated `createRun` rejects; a member of Workspace B cannot create a Run against Workspace A's Triangle (`TRIANGLE_NOT_FOUND`); a non-`validated` Triangle is refused (`TRIANGLE_NOT_RUNNABLE`); zero Methods refused; BF-with-incomplete-a-prioris refused (missing origin, duplicate origin, unknown origin, `exposure ≤ 0`, negative `lossRatio`) with no `runs` row and no audit entry written; a happy path (CL-only, and CL+BF+Mack with a complete grid) creates exactly one `queued` run with the expected `parameters` **and** exactly one `run.created` audit entry in the same commit. `runs:createRun` is registered in the auth-guard enumeration test, and the auditLogs append-only source-scan test stays green (single `.insert("auditLogs")` call site).

## Scope Boundary (read first)

This story opens Epic 4. It delivers **run configuration** — the "Run methods" surface with Method selection and the BF a-priori grid — and the **job record**: a `createRun` mutation that atomically creates a `queued` `runs` document and audits it. **Nothing executes.** A queued run is inert until Story 4.2 wires durable orchestration.

**In scope:**
- New `runs` table in `convex/schema.ts` (AD-7 status vocabulary; parameters reusing the engine contract shape).
- `convex/runs.ts` (new): `createRun` **public mutation** — job-record-first, fail-closed gating, atomic audit.
- An invariant-preserving refactor of `convex/auditLogs.ts` so a **mutation** can append to the chain **within its own transaction** (extract the chain-append body into `export async function appendAuditEntryInTransaction(ctx, args)`; `appendAuditEntry` internalMutation delegates to it; `createRun` calls it directly). Keeps AD-6's single insert call-site.
- Export the parameter validators from `convex/lib/engineContract.ts` (`methodValidator`, `aprioriLossRatioValidator`, `runParametersValidator`) so `schema.ts` and `createRun` reuse the exact engine-contract shape (single source, no re-declaration).
- Run-config UI: `components/RunConfig.tsx` (client) — Method checkboxes + conditional two-column a-priori grid with pasteable columns + gated Start; a route `app/(app)/triangles/[triangleId]/run/page.tsx` (flow surface) that loads the `validated` Triangle and hosts it; a "Run methods" action on the Triangle detail page (only for `validated` Triangles).
- Tests: `convex/runs.test.ts`, `convex/authGuard.test.ts` registration, `tests/audit-append-only.test.ts` kept green (adjust only its position-comment if needed), light component test for the a-priori gating booleans / paste split.

**Explicitly OUT of scope (do NOT build — later stories own them):**
- **Durable orchestration, the engine `/runs` call, and any `queued → running → complete|failed` transition** → Story 4.2. `createRun` writes `queued` and stops. Do **not** call `callEngine`, do **not** schedule a workflow, do **not** add result/diagnostics storage fields to the `runs` table (4.2 adds them just-in-time).
- **Run detail page, step rail, live status** → Story 4.3. 4.1's Start shows an inline "Run queued" confirmation with the `runId`; there is no `/runs/[id]` page yet. Do **not** stub one.
- **Results / Diagnostics / Interpretation / Report tabs** → 4.4–4.6, Epic 5/6.
- **CSV import of a-prioris** (PRD OQ-5, bulk/many-segment) — paste-a-column covers v1; CSV import is deferred.
- **`getRun` / run listing queries** → 4.3 (Run detail) / dashboard (Epic 7). 4.1 needs no run read path; `createRun` returns `{ runId, status }`.

## Tasks / Subtasks

- [x] **Task 1 — Export parameter validators from the engine contract (AC: 1, 2, 3)**
  - [x] `convex/lib/engineContract.ts` → **export** the three currently-private validators so `schema.ts` and `runs.ts` reuse the *exact* engine-contract shape (do not re-declare them):
    - `export const methodValidator` (the `v.union("chain_ladder","bornhuetter_ferguson","mack")` already at the top of the file).
    - `export const aprioriLossRatioValidator` (`{ origin, lossRatio, exposure }`).
    - `export const runParametersValidator` (`{ methods: v.array(methodValidator), aprioriLossRatios: v.array(aprioriLossRatioValidator) }`).
  - [x] Add `export type Method = Infer<typeof methodValidator>`, `export type AprioriLossRatio = Infer<typeof aprioriLossRatioValidator>`, `export type RunParameters = Infer<typeof runParametersValidator>` alongside the existing inferred types. (These are the **camelCase** wire shapes — same as `Lineage.parameters` — so a stored `RunParameters` is directly sendable as the `/runs` `parameters` body in 4.2. Do not confuse with the snake_case `triangleValidator`.)
  - [x] No change to the JSON-Schema drift chain: these validators are already drift-checked as part of `resultSetValidator` (they compose `lineageValidator.parameters`); exporting them adds no new surface. Keep `tests/engine-contract.test.ts` green.

- [x] **Task 2 — `runs` table (AC: 2)**
  - [x] `convex/schema.ts` → add a `runs` table (import `runParametersValidator` from `./lib/engineContract`, same as `triangleValidator` is imported today):
    - `workspaceId: v.string()` — Clerk org ID (the Workspace).
    - `triangleId: v.id("triangles")` — the Triangle this Run is over (the reference, AC2).
    - `triangleHash: v.string()` — denormalized copy of the Triangle's canonical `triangleHash` at creation (immutable provenance on the run record; the engine will re-stamp the same value into `ResultSet.lineage.triangleHash` in 4.2).
    - `status: v.union(v.literal("queued"), v.literal("running"), v.literal("complete"), v.literal("failed"))` — the closed AD-7 vocabulary. **Comment it** the way `triangles.status` is commented: 4.1 only ever writes `queued`; the `running | complete | failed` transitions are written **only** by Story 4.2's orchestration path (the runs record is the sole status authority, AD-7).
    - `parameters: runParametersValidator` — `{ methods, aprioriLossRatios }`, camelCase, engine-ready.
    - `createdBy: v.string()` (Clerk user id / `identity.subject`), `createdAt: v.string()` (ISO-8601 UTC).
    - **Do NOT** add result/diagnostics/lineage/error fields — Story 4.2 adds those (optional, just-in-time) when it stores the ResultSet.
  - [x] Index `.index("by_workspace", ["workspaceId"])` (Run listing lands in 4.3/Epic 7; this is the obvious next query). Add nothing else — 4.1 does not query runs.
  - [x] Update the `auditLogs.runId` comment (line ~13, `v.id("runs") once Epic 4 adds the table`) — the table now exists; `runId` stays `v.optional(v.string())` (a string correlation key, **not** widened to `v.id("runs")` — the audit chain is engine/runtime-correlation-keyed and 3.x entries carry no runId; do not migrate).

- [x] **Task 3 — auditLogs: make the chain-append callable inside a mutation transaction (AC: 4)**
  - [x] `convex/auditLogs.ts` → extract the chain-append body (dedupe check, chain-head read, seq/prevHash, `toHashableEntry` + `computeEntryHash`, the `ctx.db.insert("auditLogs", …)`, return `{ seq, hash }`) into:
    ```ts
    export async function appendAuditEntryInTransaction(
      ctx: MutationCtx,
      args: /* the appendAuditEntryArgs shape */,
    ): Promise<{ seq: number; hash: string }> { /* moved body incl. the single insert */ }
    ```
    Use the generated `MutationCtx` type (`import type { MutationCtx } from "./_generated/server"`).
  - [x] `appendAuditEntry` **stays** an `internalMutation({ args: appendAuditEntryArgs, handler: (ctx, args) => appendAuditEntryInTransaction(ctx, args) })` — unchanged public/internal surface, still THE registered writer for action callers (webhooks in `http.ts`, the triangle actions).
  - [x] **Critical placement for the append-only guard:** define `appendAuditEntryInTransaction` as an `export async function` (a hoisted function declaration, **NOT** `export const … = async () =>`), positioned **textually between** `export const appendAuditEntry = internalMutation` and `export const verifyChain`. `tests/audit-append-only.test.ts` asserts the single `.insert("auditLogs")` sits after the `appendAuditEntry` declaration and before the next `export const`; a hoisted function there keeps that true and is not counted as a registered mutation (no `isMutation` flag) — so all four append-only assertions stay green **unmodified**. If the extraction shifts the insert’s position, update only the position-comment/assertion in that test while preserving the "exactly one `.insert("auditLogs")` call site, in `convex/auditLogs.ts`" invariant — do not weaken it.
  - [x] Run `npx convex codegen` after (no new registered function, but `MutationCtx` import is from `_generated`).
  - [x] **Why atomic, not scheduled:** a mutation cannot `ctx.runMutation` (that is actions-only) and `ctx.scheduler.runAfter` would append the audit in a *separate* transaction — a crash between commit and the scheduled run would leave a queued run with no creation audit. Calling the shared helper inside `createRun`'s transaction makes run-insert + audit one atomic unit (the chain-head read enters `createRun`'s read set, so concurrent same-Workspace appends still serialize under OCC exactly as before).

- [x] **Task 4 — `createRun` public mutation (AC: 1, 2, 3, 4)**
  - [x] `convex/runs.ts` (new). `export const createRun = mutation({ args, handler })`.
  - [x] **Args:** `{ workspaceId: v.string(), triangleId: v.id("triangles"), parameters: runParametersValidator }`. (The client sends the full camelCase `parameters` it built in the UI. Convex validates arg shape *before* the handler — a malformed a-priori entry 400s at the boundary.)
  - [x] **Handler, in order (fail-closed):**
    1. `const { identity } = await requireMember(ctx, workspaceId)` → `actor = identity.subject`. (AD-4 first statement.)
    2. `const triangle = await ctx.db.get(triangleId)` (a mutation reads the DB directly — no internal query needed). Tenancy + existence: `triangle === null || triangle.workspaceId !== workspaceId` → `throw new ConvexError({ code: "TRIANGLE_NOT_FOUND", message })` (same code for wrong-workspace and absent, so tenancy existence never leaks — mirror `guards.ts` `requireMember` reasoning).
    3. Runnability: `triangle.status !== "validated"` → `TRIANGLE_NOT_RUNNABLE` ("Only an accepted (validated) Triangle can be run."). A `validated` row is guaranteed to carry `acceptedTriangle` + `triangleHash` (Story 3.3 sets them together at acceptance).
    4. `const { methods, aprioriLossRatios } = parameters`. `methods.length === 0` → `RUN_NO_METHODS`.
    5. **BF gating (server-side, mirrors `methods.py:_check_aprioris` + `AprioriLossRatio`):** if `methods.includes("bornhuetter_ferguson")`:
       - `const origins = triangle.acceptedTriangle!.origin_periods` (the authoritative Origin Period set).
       - No duplicate `origin` in `aprioriLossRatios` → `RUN_DUPLICATE_APRIORI`.
       - No `origin` not in `origins` → `RUN_UNKNOWN_APRIORI`.
       - Every `origins[i]` is covered → else `RUN_MISSING_APRIORI` (include the missing origins in the message).
       - Every entry: `Number.isFinite(lossRatio) && lossRatio >= 0` else `RUN_INVALID_APRIORI`; `Number.isFinite(exposure) && exposure > 0` else `RUN_INVALID_APRIORI`. (Arg-validation already blocked non-numbers; this catches `NaN`/`Infinity`/negative/zero that pass `v.number()`.)
       - **AD-1 note:** this is parameter validation on user-supplied inputs (loss ratios, premiums) — **no arithmetic on reserve figures**. The `loss_ratio × exposure` computation is the engine's, in `methods.py` (4.2), never here.
    6. When BF is **not** selected, ignore/normalize `aprioriLossRatios` to `[]` before storing (don't persist stray a-prioris for a non-BF run — keep the record clean; the engine ignores them anyway).
    7. `const now = new Date(Date.now()).toISOString()`.
    8. `const runId = await ctx.db.insert("runs", { workspaceId, triangleId, triangleHash: triangle.triangleHash!, status: "queued", parameters: { methods, aprioriLossRatios: bfSelected ? aprioriLossRatios : [] }, createdBy: actor, createdAt: now })`.
    9. **Atomic audit (same transaction):** `await appendAuditEntryInTransaction(ctx, { workspaceId, actor, eventType: "run.created", runId, payload: { runId, triangleId, methods, originCount: triangle.acceptedTriangle!.origin_periods.length, aprioriCount: bfSelected ? aprioriLossRatios.length : 0 } })`. Pass `runId` (the new run's `_id` stringified — `runId` is a `v.optional(v.string())` correlation key). **Never** inline an `auditLogs` insert (AD-6).
    10. `return { runId, status: "queued" as const }`.
  - [x] Import `ConvexError` from `convex/values`, `requireMember` from `./lib/guards`, `appendAuditEntryInTransaction` from `./auditLogs`, `runParametersValidator` from `./lib/engineContract`, `mutation` from `./_generated/server`.
  - [x] `npx convex codegen` to publish `api.runs.createRun`.

- [x] **Task 5 — Run-config UI: `RunConfig` component + route + Triangle-detail entry (AC: 1)**
  - [x] `components/RunConfig.tsx` (new, client). Props: `{ workspaceId, triangleId, triangle }` where `triangle` is the accepted content (`acceptedTriangle`: kind/origin_periods/development_periods/cells) from `getById`.
    - **Method selection:** three checkboxes — `Chain Ladder` (`chain_ladder`), `Bornhuetter-Ferguson` (`bornhuetter_ferguson`), `Mack` (`mack`). Labels are the UX names ("CL, BF, Mack" per EXPERIENCE.md:133); stored values are the engine literals.
    - **A-priori grid (only when BF checked):** one row per `origin_periods` entry; each row has the origin label (read-only) + **two** `numeric` (Geist-Mono) inputs — **A Priori Loss Ratio** and **Premium**. Column headers name the unit ("Loss ratio", "Premium" — voice rule: numbers carry their unit, EXPERIENCE.md:49). Use the `numeric` typography role (DESIGN.md:100 — "a number set in Geist Mono is evidence").
    - **Pasteable columns (AC1):** an `onPaste` on a column input splits the clipboard text on newlines (and strips a single trailing newline), coercing each line to a number, and fills that column downward from the focused row. Handle a pasted block that also contains tabs (a two-column spreadsheet paste) by routing tab-separated values across the loss-ratio/premium columns of each row. Keep it forgiving: ignore blank trailing lines; never throw on a bad paste (leave unparseable cells empty so the gate stays disabled). Add a tiny helper `splitPastedColumn(text): (number|null)[]` — unit-test it.
    - **Gated Start (AC1) — compute during render (no set-state-in-effect, matching the wizard's discipline):** `canStart = methods.length >= 1 && (!bfSelected || everyOriginHasLrAndPremium)` where `everyOriginHasLrAndPremium` checks each origin row has a finite `lossRatio >= 0` and a finite `exposure > 0`. Disabled Start shows *why* (inline helper text: "Enter a loss ratio and premium for every Origin Period" / "Select at least one method").
    - **Start:** `useMutation(api.runs.createRun)`; build `parameters = { methods, aprioriLossRatios: bfSelected ? origin_periods.map((origin, i) => ({ origin, lossRatio, exposure })) : [] }`. **Not** optimistic — the Start button enters a pending state (`aria-live="polite"`, disabled while in-flight; audit-generating actions confirm on server ack, never optimistic — EXPERIENCE.md:102). On success show an inline confirmation: "Run queued" + the `runId` (Run detail arrives in Story 4.3 — do not link to a non-existent `/runs/[id]`). On `ConvexError` render `.data.message` verbatim with a retry affordance (reuse the `errorMessage` helper pattern from `UploadWizard.tsx`).
    - **Surface:** flow surface (`max-w-4xl`, single column, generous whitespace — DESIGN.md), reusing the button/token idiom already in `UploadWizard.tsx`.
  - [x] `app/(app)/triangles/[triangleId]/run/page.tsx` (new, `"use client"`). `useAuth().orgId` + `useQuery(api.triangles.getById, orgId ? { workspaceId: orgId, triangleId } : "skip")`. If the Triangle is not `validated`, render a guard state ("This Triangle isn't accepted yet") — do **not** render `RunConfig`. Loading / not-found states mirror the Triangle detail page tone.
  - [x] `app/(app)/triangles/[triangleId]/page.tsx` → add a **"Run methods"** primary action (link to `/triangles/{triangleId}/run`) shown **only** when `status === "validated"` (a `pending_validation`/`validation_failed` Triangle is not runnable). Place it near the accepted-status header.

- [x] **Task 6 — Tests (AC: 5)**
  - [x] `convex/runs.test.ts` (new; follow `convex/triangles.test.ts` patterns — `convexTest(schema)`, `t.withIdentity({ subject, org_id, org_role: "org:analyst" })`, seed a `validated` triangle via `t.run(async (ctx) => ctx.db.insert("triangles", {…, status:"validated", acceptedTriangle:{…}, triangleHash:"…"}))`). No engine stub needed — `createRun` makes **no** `fetch`.
    - Happy CL-only: `createRun` with `methods:["chain_ladder"], aprioriLossRatios:[]` → one `runs` row `status:"queued"` with the expected `parameters`, `triangleId`, `triangleHash`, `createdBy`, `createdAt`; **exactly one** `run.created` audit entry with `payload.runId` matching, `aprioriCount:0`. Assert the audit entry and the run row exist after the single call (atomicity: both present).
    - Happy CL+BF+Mack with a complete grid (one `{origin, lossRatio, exposure>0}` per accepted origin) → queued run; `parameters.aprioriLossRatios` length === origin count; `run.created` `aprioriCount` === origin count.
    - BF normalization: BF **not** selected but client sends stray a-prioris → stored `parameters.aprioriLossRatios` is `[]`.
    - Gating rejections (each: throws the right code, **no** `runs` row, **no** audit entry):
      - zero methods → `RUN_NO_METHODS`.
      - BF + missing an origin → `RUN_MISSING_APRIORI`; BF + duplicate origin → `RUN_DUPLICATE_APRIORI`; BF + unknown origin → `RUN_UNKNOWN_APRIORI`; BF + `exposure: 0` (and `-1`) → `RUN_INVALID_APRIORI`; BF + `lossRatio: -0.1` → `RUN_INVALID_APRIORI`; BF + `exposure: NaN`/`Infinity` (if it slips past `v.number()`) → `RUN_INVALID_APRIORI`.
    - Status gate: a `pending_validation` triangle → `TRIANGLE_NOT_RUNNABLE`; a `validation_failed` triangle → `TRIANGLE_NOT_RUNNABLE` (no run, no audit).
    - Guards + tenancy: unauthenticated `createRun` → rejects; identity in org B against org A's triangle → `TRIANGLE_NOT_FOUND` (no run, no audit).
  - [x] `convex/authGuard.test.ts` → register `"runs:createRun"` in `publicFunctionArgs` with a real injected `v.id("triangles")` (seed a row, same as the `triangles:*` entries) + a minimal valid `parameters` (`{ methods:["chain_ladder"], aprioriLossRatios:[] }`) — Convex validates args before the guard, so the shape must be valid. Extend the `path === …` id-injection branch (lines ~191–201) to also handle `"runs:createRun"` (inject `triangleId`).
  - [x] `tests/audit-append-only.test.ts` → **must stay green**. Run it; if the helper extraction moved the insert's textual position, update only the position assertion/comment (Task 3) — the "single `.insert("auditLogs")` call site in `convex/auditLogs.ts`" invariant must still hold and `createRun` must NOT contain its own `auditLogs` insert.
  - [x] `convex/auditLogs.test.ts` → add a case proving `appendAuditEntryInTransaction` works from a mutation transaction and produces a chain-valid entry (or rely on `runs.test.ts`'s atomic-audit assertion + `verifyChain` after a `createRun` returning `valid:true`). Prefer a `verifyChain`-after-`createRun` assertion in `runs.test.ts` (proves the run.created entry keeps the chain intact).
  - [x] Component test (jsdom, light — the ACs live in convex-test): `splitPastedColumn` unit tests (newlines, trailing newline, tab-separated two-column, blanks, garbage→null); and a `RunConfig` gating test (Start disabled with BF selected + an empty premium; enabled once every origin has both values). Do not over-invest in DOM.
  - [x] **Full gates green before → review:** `npm test`, root `npx tsc --noEmit` + `npx tsc -p convex/tsconfig.json --noEmit`, `npm run lint`, `npm run build` (compiles `/triangles/[triangleId]/run`), and `cd engine && uv run pytest` (unchanged — no engine edits this story, but keep it green). Leave the single Playwright smoke as-is.

## Dev Notes

### This story creates the job record; it does NOT run anything (AD-7, scope)

`createRun` writes a `queued` `runs` row and returns. There is deliberately **no** engine call, **no** workflow, **no** status transition. AD-7's "job-record-first" means the Convex `runs` record exists — atomically, audited — *before* any orchestration touches it; Story 4.2 adds the `@convex-dev/workflow` path that reads `queued` runs, calls `engine_service` `/runs` with the Convex run ID as idempotency key, and drives `queued → running → complete|failed`. If a reviewer asks "how does the queued run ever run?" the honest answer is: it doesn't yet — that is 4.2. Keep 4.1 from leaking into orchestration.

### Why `createRun` is a mutation (not an action) — and how it audits atomically

The AC says "when the **mutation** executes," and it is the right tool: 4.1 does no I/O (no `fetch`, no storage), so it belongs in a single transaction where the run insert and its `run.created` audit entry commit together. The existing audit callers (`createFromUpload`, `validateTriangle`, `acceptTriangle`) are **actions** only because they call the engine over `fetch`; they reach the audit writer via `ctx.runMutation(internal.auditLogs.appendAuditEntry, …)`. A mutation has no `runMutation`. So Task 3 extracts the chain-append body into a plain `appendAuditEntryInTransaction(ctx, args)` helper that `createRun` calls **inside its own transaction** — atomic, and still the single `auditLogs` insert call-site. This is an evolution of AD-6's plumbing that **preserves the invariant**: exactly one place computes the hash-chain and inserts; `appendAuditEntry` (the internalMutation) stays the entry point for action callers. Do not reach for `ctx.scheduler` (separate transaction → possible orphan run) or an inline insert (violates AD-6).

### The a-priori shape is the engine's, exactly (AD-10, decision above)

`aprioriLossRatioValidator = { origin, lossRatio, exposure }` and `runParametersValidator = { methods, aprioriLossRatios }` already exist in `engineContract.ts` (they compose `Lineage.parameters`, drift-checked via `resultSetValidator`). Task 1 only **exports** them. Because they are the camelCase wire shape the engine `/runs` `parameters` body expects (the engine `RunParameters`/`AprioriLossRatio` carry `_MODEL_CONFIG` camelCase aliases — verified: `AprioriLossRatio(origin, loss_ratio, exposure)` ↔ wire `{origin, lossRatio, exposure}`), the `parameters` object 4.1 stores is what 4.2 sends verbatim. **Do not** invent a second run-parameter shape, and **do not** store snake_case here (that quirk is only the `Triangle` body).

### Server-side gating mirrors the engine — fail closed, don't UI-hide (AD-4, FR-4)

The client disables Start, but the mutation re-checks every gate (AD-4: UI-hiding is never sufficient). The BF rules are a TypeScript mirror of `reserving_engine.methods._check_aprioris` (duplicate origin, unknown origin, missing origin) plus the `AprioriLossRatio` field validators (`loss_ratio >= 0`, `exposure > 0`, both finite). The Origin Period authority is `triangle.acceptedTriangle.origin_periods` — never the client's claim. This makes an incomplete/garbage a-priori set fail fast in Convex with a typed code, not deep inside 4.2's engine call. Keep the codes stable (they will appear in `RunConfig`'s error rendering).

### AD-1: no arithmetic here

Loss ratios and premiums are **user-supplied inputs**, not engine figures; storing and range-checking them is allowed on the product plane. The only BF arithmetic (`expected ultimate = loss_ratio × exposure`) lives in `reserving_engine.methods._build_exposure_diagonal` (already built, AD-1-compliant). `createRun`, `RunConfig`, and `schema.ts` do **no** arithmetic on reserve figures — do not compute totals, expected ultimates, or previews.

### UI specifics (DESIGN.md, EXPERIENCE.md)

- **"From the Triangle: Run methods"** (EXPERIENCE.md:133) — the entry point is the accepted Triangle's detail page, gated to `status === "validated"`.
- **Numeric = evidence** (DESIGN.md:100): the a-priori inputs are `numeric` (Geist Mono) — they are the numbers the engine will consume. Method labels and helper text are Geist Sans prose.
- **Pasteable column** (EXPERIENCE.md:133, "mono inputs, pasteable column"): actuaries live in Excel — paste a column of loss ratios (and premiums) from a spreadsheet. Support single-column and tab-separated two-column pastes; be forgiving (never throw).
- **Banned patterns** (EXPERIENCE.md:102): no optimistic UI for the audit-generating Start (confirm on server ack); no auto-advance; no bare spinner (named pending state, `aria-live="polite"`).
- **Voice** (EXPERIENCE.md:49): column headers/labels carry units ("Loss ratio", "Premium"); the queued confirmation is calm and specific ("Run queued — Chain Ladder, BF, Mack over <triangle label>"), never "Oops"/"✨".
- **Surface widths:** the run-config flow is `max-w-4xl` (flow), consistent with the wizard; the Triangle detail page it launches from stays `max-w-screen-2xl` (data).

### Existing patterns to reuse (do not reinvent)

- **Public function shape + guard:** `triangles.getById` / `acceptTriangle` — first statement `requireMember`, tenancy re-check on the fetched row (`triangleId` is attacker-controllable), typed `ConvexError` codes.
- **Audit composition:** `appendAuditEntry` chain logic (`convex/auditLogs.ts`) + `auditChain.ts` (`toHashableEntry`, `computeEntryHash`, `GENESIS_PREV_HASH`) — Task 3 refactors, doesn't rewrite, the chain math.
- **Contract reuse:** `convex/lib/engineContract.ts` — export, don't duplicate. Read the top-of-file wire-discipline comment (camelCase vs the snake_case `Triangle`).
- **Guard tests:** `convex/authGuard.test.ts` (enumeration — register `runs:createRun`, inject a real id) and `convex/triangles.test.ts` (per-function convex-test with `t.withIdentity`, cross-Workspace assertions, `t.run` seeding).
- **UI idiom:** `components/UploadWizard.tsx` — `errorMessage` helper, named-stage pending discipline, token/button classes, `useMutation`/`useAction` wiring, the flow-surface layout.
- **Status/date:** `new Date(Date.now()).toISOString()` for `createdAt` (matches `acceptedAt`); no `datetime`/clock in the engine (irrelevant here — this is Convex).

### Project Structure Notes

- **New:** `convex/runs.ts`, `convex/runs.test.ts`, `components/RunConfig.tsx`, `app/(app)/triangles/[triangleId]/run/page.tsx`.
- **Edit:** `convex/schema.ts` (`runs` table + `auditLogs.runId` comment), `convex/auditLogs.ts` (extract `appendAuditEntryInTransaction`), `convex/lib/engineContract.ts` (export the three validators + types), `convex/authGuard.test.ts` (register `runs:createRun`), `app/(app)/triangles/[triangleId]/page.tsx` ("Run methods" action), possibly `tests/audit-append-only.test.ts` (position comment only, if needed).
- **Regen:** `npx convex codegen` after adding `runs.ts` and the `MutationCtx` import (publishes `api.runs.createRun`).
- **No `reserving_engine` or `engine_service` changes** — the `/runs` endpoint already exists (Epic 2) and is 4.2's consumer; 4.1 makes no engine call. `pytest` should be unaffected (keep it green).
- **Doc:** append a 4.1 section to `_bmad-output/implementation-artifacts/deferred-work.md` for anything punted (e.g. CSV a-priori import per OQ-5; whether the audit `run.created` payload should also carry the a-priori values once the Audit Log browser lands in Epic 7).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.1] — story statement + ACs (lines 434–450); Epic 4 summary (430–432)
- [Source: _bmad-output/planning-artifacts/prds/prd-agentic-reserving-2026-07-16/prd.md] — FR-4 Run execution (95–98), A Priori Loss Ratio glossary (52), BF description (93), OQ-5 a-priori CSV import (290), UJ-1 (38)
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-agentic-reserving-2026-07-16/EXPERIENCE.md] — run config flow (133–134), Run queued state (84), banned patterns / no optimistic UI (102), voice/units (49), component behavior (67)
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-agentic-reserving-2026-07-16/DESIGN.md] — `numeric` (Geist Mono) = engine evidence (100), flow-vs-data surfaces
- [Source: _bmad-output/planning-artifacts/architecture/architecture-agentic-reserving-2026-07-16/ARCHITECTURE-SPINE.md] — AD-7 job-record-first (89–93), AD-4 auth guards (71–75), AD-6 append-only single-writer (83–87), AD-10 versioned contracts (107–111), AD-1 numbers only in engine (53–57), Capability map FR-4..6 (192)
- [Source: engine/reserving_engine/resultset.py] — `RunParameters`, `AprioriLossRatio` (origin/loss_ratio/exposure, `exposure > 0`, `loss_ratio >= 0`) — the exact shape 4.1 stores and 4.2 sends
- [Source: engine/reserving_engine/methods.py:276-293] — `_check_aprioris` (duplicate/unknown/missing origin) — the rules `createRun` mirrors server-side; `_build_exposure_diagonal:172-197` (expected ultimate = loss_ratio × exposure, the engine's AD-1 arithmetic)
- [Source: engine/engine_service/app.py:60-69, models.py:25-53] — the existing `/runs` endpoint + `RunRequest`/`RunResponse` (4.2's consumer; 4.1 does not call it)
- [Source: convex/lib/engineContract.ts:24-52] — `methodValidator`, `aprioriLossRatioValidator`, `runParametersValidator`, `lineageValidator.parameters` (export these; already drift-checked)
- [Source: convex/schema.ts] — `triangles` table + status-widening comment pattern to mirror for `runs.status`; `auditLogs.runId` note to update
- [Source: convex/auditLogs.ts] — `appendAuditEntry` chain-append body to extract into `appendAuditEntryInTransaction`; OCC read-into-read-set serialization
- [Source: tests/audit-append-only.test.ts] — the source-scan guard that constrains the Task-3 refactor (single `.insert("auditLogs")`, positioned inside `appendAuditEntry`’s block)
- [Source: convex/triangles.ts] — `acceptTriangle`/`getById` guard + tenancy + typed-error patterns; `convex/lib/guards.ts` `requireMember`
- [Source: convex/authGuard.test.ts:37-201] — `publicFunctionArgs` + id-injection branch to extend for `runs:createRun`
- [Source: components/UploadWizard.tsx] — flow-surface layout, `errorMessage`, named-stage pending, mutation wiring; [components/TriangleStatusIndicator.tsx], [app/(app)/triangles/[triangleId]/page.tsx] — the detail page to add "Run methods" to
- [Source: _bmad-output/implementation-artifacts/3-3-period-confirmation-and-triangle-acceptance.md] — accepted-Triangle fields (`acceptedTriangle.origin_periods`, `triangleHash`, `status:"validated"`) this story consumes; action→internal + audit precedent
- [Source: _bmad-output/project-context.md] — Constitution, layering, auth, audit, vocabulary rules

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Claude Code, bmad-dev-story workflow)

### Debug Log References

- `npx convex codegen` — regenerated `convex/_generated/api.*` for `api.runs.createRun` (new `runs.ts` module) and the `MutationCtx` import used by the extracted `appendAuditEntryInTransaction`.
- Append-only guard caught a self-inflicted regression: my new JSDoc comment on `appendAuditEntryInTransaction` contained the literal `.insert("auditLogs")`, which the source-scan regex counted as a second insert call-site (`expected [x2] to equal [x1]`). Reworded the comment to avoid the literal → green. This is exactly the guard doing its job (single writer call-site).
- Full gates: `npm test` → **215 passed / 19 files**; `npx tsc --noEmit` + `npx tsc -p convex/tsconfig.json --noEmit` both exit 0; `npm run lint` clean; `npm run build` compiles the new `/triangles/[triangleId]/run` route; `cd engine && uv run pytest` → **205 passed, 9 skipped** (no engine changes this story).

### Completion Notes List

- **Job record only — nothing executes (AD-7 scope).** `convex/runs.ts` `createRun` is a **mutation** that creates a `queued` `runs` row and returns `{ runId, status: "queued" }`. No engine call, no `fetch`, no `@convex-dev/workflow`, no status transition — orchestration and every `queued → running → complete|failed` transition are Story 4.2. A queued run is inert by design (documented in deferred-work so it isn't misread as a bug).
- **Atomic audit via an invariant-preserving AD-6 refactor.** A mutation has no `ctx.runMutation`, so the chain-append body was extracted into `export async function appendAuditEntryInTransaction(ctx, args)` in `convex/auditLogs.ts`; the `appendAuditEntry` internalMutation now delegates to it (unchanged surface for action callers), and `createRun` calls it **inside its own transaction** — the run insert and the `run.created` entry commit together (no orphan runs/entries). The single-writer invariant holds: exactly one `auditLogs` insert call-site, still inside `auditLogs.ts`, positioned so `tests/audit-append-only.test.ts` stays green unmodified. `runs.test.ts` proves atomicity (both rows present) and chain integrity (`verifyChain` → `{ valid: true, length: 1 }` after a create).
- **Fail-closed gating mirrors the engine (AD-4).** `createRun` re-checks every gate server-side: `requireMember` first; tenancy + existence on the fetched Triangle (`TRIANGLE_NOT_FOUND`, same code for wrong-workspace/absent); `status === "validated"` (`TRIANGLE_NOT_RUNNABLE`); ≥ 1 method (`RUN_NO_METHODS`); and when BF is selected, a TS mirror of `reserving_engine.methods._check_aprioris` + the `AprioriLossRatio` field validators — duplicate (`RUN_DUPLICATE_APRIORI`), unknown (`RUN_UNKNOWN_APRIORI`), missing (`RUN_MISSING_APRIORI`), and non-finite/negative loss ratio or non-finite/≤0 premium (`RUN_INVALID_APRIORI`). The Origin Period authority is `triangle.acceptedTriangle.origin_periods`, never the client. Non-BF runs never persist stray a-prioris. 15 convex-test cases assert every rejection writes **nothing**.
- **Two-column a-priori grid (Rohan's decision).** `components/RunConfig.tsx` captures loss ratio **and** premium per Origin Period (both `numeric`/Geist-Mono, both pasteable) because the engine's BF is `loss_ratio × exposure`. Pasting supports single-column and tab-separated two-column spreadsheet blocks via the pure `components/runConfigPaste.ts` helpers (unit-tested: newlines, CRLF, trailing newline, tabs, grouped `5,000,000`, garbage→null — forgiving, never throws). Gating computed during render (no set-state-in-effect); Start is non-optimistic (pending state, `aria-live`, confirms on server ack — EXPERIENCE.md:102). On success: an inline "Run queued" confirmation with the `runId` (no `/runs/[id]` link — that's 4.3).
- **AD-1 kept.** `createRun`, `RunConfig`, and `schema.ts` do no arithmetic on reserve figures — loss ratios and premiums are user inputs, range-checked only; the `loss_ratio × exposure` math stays in `reserving_engine`.
- **Contract single-sourced (AD-10).** Only **exported** the already-drift-checked `methodValidator`/`aprioriLossRatioValidator`/`runParametersValidator` (+ `Method`/`AprioriLossRatio`/`RunParameters` types) from `engineContract.ts`; `schema.ts` `runs.parameters` and `createRun` args reuse them, so the stored camelCase `parameters` is what 4.2 sends to `/runs` verbatim. No new schema-export surface.
- **Verification scope:** all five ACs proven by automated tests — the convex-test matrix (happy CL-only + CL+BF+Mack, BF-not-selected normalization, chain-valid, and every gating/tenancy rejection), the pure paste-helper suite, and a jsdom `RunConfig` gating test (Start disabled with BF + empty/zero premium; enabled once every origin has both). Production build compiles the new route. A live interactive browser run (sign-in → accept Triangle → configure → start) was **not** executed — same posture as 3.1–3.3 (needs the Clerk test-user password, not stored) — but no engine/live service is required for 4.1 since `createRun` makes no `fetch`.

### File List

- `convex/lib/engineContract.ts` (modified) — exported `methodValidator`, `aprioriLossRatioValidator`, `runParametersValidator` + `Method`/`AprioriLossRatio`/`RunParameters` types (already drift-checked; no new surface).
- `convex/schema.ts` (modified) — new `runs` table (AD-7 status vocab, `parameters: runParametersValidator`, `by_workspace` index); imports `runParametersValidator`; updated the `auditLogs.runId` comment.
- `convex/auditLogs.ts` (modified) — extracted `appendAuditEntryInTransaction` (the sole auditLogs insert call-site); `appendAuditEntry` delegates to it; `MutationCtx` import.
- `convex/runs.ts` (new) — `createRun` public mutation (job-record-first, fail-closed gating, atomic audit).
- `convex/runs.test.ts` (new) — 15 convex-test cases (happy paths, gating rejections, tenancy/guards, chain integrity).
- `convex/authGuard.test.ts` (modified) — registered `runs:createRun` + id-injection branch.
- `convex/_generated/api.d.ts`, `convex/_generated/api.js` (regenerated).
- `components/runConfigPaste.ts` (new) — pure pasteable-column helpers.
- `components/RunConfig.tsx` (new) — Method selection + two-column a-priori grid + gated Start.
- `app/(app)/triangles/[triangleId]/run/page.tsx` (new) — "Run methods" flow surface (guards non-validated Triangles).
- `app/(app)/triangles/[triangleId]/page.tsx` (modified) — "Run methods" action on accepted Triangles.
- `tests/run-config-paste.test.ts` (new) — 9 paste-helper unit tests.
- `tests/run-config.test.tsx` (new) — 4 jsdom gating tests.
- `_bmad-output/implementation-artifacts/deferred-work.md` (modified) — 4.1 deferral notes.

### Change Log

- 2026-07-19 — Story 4.1 created (ready-for-dev): run configuration with Method selection + a two-column BF a-priori grid (loss ratio + premium, resolving the engine's `loss_ratio × exposure` need vs the PRD/UX single-input description); `createRun` mutation creating a job-record-first `queued` run with atomic `run.created` audit via an invariant-preserving `appendAuditEntryInTransaction` extraction; fail-closed server-side BF gating mirroring the engine. Opens Epic 4. Orchestration/execution deferred to Story 4.2.
- 2026-07-19 — Story 4.1 implemented (→ review): all 6 tasks complete. `runs` table + `createRun` mutation (job-record-first, atomic `run.created` audit via the extracted single-writer helper, fail-closed BF gating mirroring the engine); two-column pasteable a-priori grid (`RunConfig` + pure paste helpers); "Run methods" surface off the accepted Triangle detail page. Contract validators single-sourced from `engineContract.ts`. Gates green: npm test 215/19 files, tsc ×2 clean, lint clean, build (compiles `/triangles/[triangleId]/run`), pytest 205/9-skip.
