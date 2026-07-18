---
baseline_commit: 87601a9c1529fb265ad892a0a038dafb96768741
---

# Story 3.1: Triangle Upload with Duplicate Detection

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an Analyst,
I want to upload a CSV or Excel Triangle into my Workspace, labeled paid or incurred,
so that the quarter's data enters the system exactly once. (FR-1)

## Acceptance Criteria

**AC1 — Upload stored, hashed, audited (FR-1, FR-15)**
Given an authenticated Analyst,
When they upload a `.csv` or `.xlsx` file labeled `paid` or `incurred`,
Then the file is stored via Convex file storage under a new `triangles` document scoped to the Workspace with status `pending_validation`, its raw-file sha256 recorded, and the upload appended to the Audit Log,
And the Triangles library page lists the Workspace's Triangles with label, status, and hash.

**AC2 — Byte-identical duplicate surfaced, never re-stored (UX-DR8)**
Given a byte-identical file already in the Workspace,
When it is uploaded again,
Then the UI shows "Identical triangle already exists (hash match)" with a link to the existing Triangle — no silent dedupe, and no second stored copy (the second blob is discarded).

**AC3 — Unparseable file rejected with a specific error**
Given a file that cannot be read in its declared format,
When it is uploaded,
Then it is rejected with a specific error naming the failure (e.g. "File is not valid UTF-8 text" / "File is not a readable .xlsx workbook") — not a generic message — and no `triangles` document and no stored blob remain.

**AC4 — Guard + tenancy tests (FR-18, NFR-3)**
convex-test covers the mutation/action/query paths including guard enforcement (unauthenticated rejection) and cross-Workspace invisibility (a member of Workspace A can neither list nor read nor duplicate-collide with Workspace B's Triangles).

## Scope Boundary (read first)

This story delivers **upload → store → hash → dedupe → library list**, nothing more. Explicitly **out of scope** (later stories own them — do not build):

- **Engine validation** (shape / paid-monotonicity / missing-cell, `engine_service /validate`) → **Story 3.2**. This story does **not** call `engine_service`.
- **The 3-step upload wizard** (File → Validation → Periods, named-stage progress, flagged grid preview per UX-DR8/UX-DR5) → **Story 3.2**. Build only a minimal, functional upload control here.
- **Period detection/confirmation, Triangle acceptance, immutability, and the canonical-triangle-JSON Lineage hash** → **Story 3.3**.

"Parse" in AC3 means **format readability only** (can the bytes be decoded as CSV text / opened as an OOXML workbook), not grid/actuarial validation.

## Tasks / Subtasks

- [x] **Task 1 — `triangles` table + schema (AC: 1)**
  - [x] Add a `triangles` table to `convex/schema.ts` (table just-in-time, per the file's existing convention). Fields: `workspaceId: v.string()` (Clerk org id — the Workspace), `label: v.union(v.literal("paid"), v.literal("incurred"))`, `status: v.union(v.literal("pending_validation"))` (this story only ever creates `pending_validation`; 3.2/3.3 widen the union — a non-breaking change), `format: v.union(v.literal("csv"), v.literal("xlsx"))`, `storageId: v.id("_storage")`, `rawFileHash: v.string()` (sha256 lowercase hex of the raw bytes), `filename: v.string()`, `uploadedBy: v.string()` (Clerk user id / `identity.subject`), `uploadedAt: v.string()` (ISO-8601 UTC).
  - [x] Indexes: `.index("by_workspace", ["workspaceId"])` (library list) and `.index("by_workspace_hash", ["workspaceId", "rawFileHash"])` (dedupe lookup + atomic insert).

- [x] **Task 2 — Persist-if-new internal mutation (AC: 1, 2)**
  - [x] `convex/triangles.ts` → `insertIfNew` as an `internalMutation`. Args: `workspaceId`, `label`, `format`, `storageId`, `rawFileHash`, `filename`, `uploadedBy`, `uploadedAt`.
  - [x] Query `by_workspace_hash` (`workspaceId` + `rawFileHash`) with `.unique()`. If a row exists → return `{ created: false, existingTriangleId }`. Else `ctx.db.insert("triangles", { ...args, status: "pending_validation" })` and return `{ created: true, triangleId }`.
  - [x] **Atomicity:** the `by_workspace_hash` read puts the dedupe check in the mutation's read set, so two concurrent identical uploads conflict under Convex OCC and the runtime retries the loser, which then observes the winner and returns `created: false`. This mirrors the OCC-serialization comment in `convex/auditLogs.ts` `appendAuditEntry` — no manual retry code.

- [x] **Task 3 — Upload orchestration (AC: 1, 2, 3)**
  - [x] `convex/triangles.ts` → `generateUploadUrl` as a **public** `mutation`. First statement `await requireMember(ctx, workspaceId)`. Return `await ctx.storage.generateUploadUrl()`. (Client POSTs the file to this URL and receives a `storageId`.)
  - [x] `convex/triangles.ts` → `createFromUpload` as a **public** `action`. Args: `{ workspaceId, storageId, label, filename }`.
    - [x] First statement: `const { identity } = await requireMember(ctx, workspaceId);` → `actor = identity.subject`.
    - [x] Read bytes: `const blob = await ctx.storage.get(storageId)`; if `null`, delete nothing and throw `ConvexError({ code: "UPLOAD_NOT_FOUND", message })`. Otherwise `const bytes = await blob.arrayBuffer()`.
    - [x] Determine `format` from the filename extension (`.csv` → `csv`, `.xlsx` → `xlsx`); reject unsupported extensions with a specific `ConvexError`.
    - [x] **Parse-readability check** appropriate to `format` (AC3):
      - CSV → decode bytes as UTF-8 (`new TextDecoder("utf-8", { fatal: true })`) and confirm at least one non-empty line. A decode throw is a specific failure ("File is not valid UTF-8 text").
      - XLSX → **fully open the workbook**: `const wb = XLSX.read(new Uint8Array(bytes), { type: "array" })` (SheetJS `xlsx`) and assert `wb.SheetNames.length > 0` and the first sheet exists (`wb.Sheets[wb.SheetNames[0]]`). A magic-byte check alone is **not** sufficient — the file must actually parse as a workbook with a readable sheet. Any parser throw, an empty workbook, or a missing first sheet → reject with a specific `ConvexError` ("File is not a readable .xlsx workbook"). This is still an **openability** gate, not grid/actuarial validation — do **not** inspect cell values, shape, or monotonicity here (that is 3.2's `engine_service /validate`).
      - On any failure: `await ctx.storage.delete(storageId)` **then** throw `ConvexError({ code, message })` naming the failure. No orphan blob may remain.
    - [x] Compute `rawFileHash`: `crypto.subtle.digest("SHA-256", bytes)` → lowercase hex. This is the **raw-file** sha256 for duplicate detection — see the Two-Hashes note below.
    - [x] `const result = await ctx.runMutation(internal.triangles.insertIfNew, { ...})`.
    - [x] If `result.created`: `await ctx.runMutation(internal.auditLogs.appendAuditEntry, { workspaceId, actor, eventType: "triangle.uploaded", payload: { triangleId: result.triangleId, rawFileHash, label, format, filename } })`. Return `{ status: "created", triangleId: result.triangleId }`.
    - [x] If duplicate: `await ctx.storage.delete(storageId)` (discard the just-uploaded second copy — AC2 "no second stored copy"), append a `triangle.upload_duplicate` audit entry (`payload: { existingTriangleId, rawFileHash }`), and return `{ status: "duplicate", existingTriangleId: result.existingTriangleId }`.
  - [x] **Why an action, not a mutation:** only actions can read storage bytes (`ctx.storage.get`) and call `internal.auditLogs.appendAuditEntry` via `ctx.runMutation`. Mutations cannot `runMutation`. Do **not** try to append audit inside `insertIfNew` by inlining an `auditLogs` insert — AD-6 requires that `appendAuditEntry` be the *only* writer of `auditLogs` (enforced by the append-only test); a second writer breaks the invariant.

- [x] **Task 4 — Library list query (AC: 1, 4)**
  - [x] `convex/triangles.ts` → `listByWorkspace` as a **public** `query`. First statement `await requireMember(ctx, workspaceId)`. Return rows from `by_workspace`, newest first, with `{ _id, label, status, rawFileHash, filename, uploadedAt }`. Return the full `rawFileHash`; the UI truncates for display.

- [x] **Task 5 — Triangle library UI (AC: 1, 2, 3)**
  - [x] Replace the placeholder `app/(app)/triangles/page.tsx` with the library: data surface, `max-w-screen-2xl`. Use `useQuery(api.triangles.listByWorkspace, { workspaceId })` (org id from Clerk `useOrganization()` / auth). Empty state mirrors the dashboard copy tone.
  - [x] Each row: filename, label, **status indicator**, truncated + copyable `rawFileHash`, `uploadedAt`.
  - [x] A minimal **upload control** (button → hidden file input + a paid/incurred selector). On submit: call `generateUploadUrl` → `fetch(url, { method: "POST", body: file })` → read `storageId` from the JSON response → call `createFromUpload`. On `{ status: "duplicate" }` show **"Identical triangle already exists (hash match)"** with a link to the existing Triangle (`existingTriangleId`). On a thrown `ConvexError` show its `.data.message` verbatim (the specific parse/format failure) — never a generic string.
  - [x] **Do not build the 3-step wizard or the flagged grid preview here** — 3.2 replaces this control with the full UX-DR8 wizard.

- [x] **Task 6 — Tests (AC: 1, 2, 3, 4)**
  - [x] `convex/triangles.test.ts` (convex-test + Vitest). Seed storage in tests via `t.run(async (ctx) => await ctx.storage.store(new Blob([bytes])))` to obtain a `storageId`, then drive `createFromUpload` with an identity (`t.withIdentity({ subject, org_id, org_role: "org:analyst" })`).
    - [x] Happy path: new upload → one `triangles` row, `status: "pending_validation"`, `rawFileHash` set; a `triangle.uploaded` audit entry exists with `payload.triangleId`.
    - [x] Duplicate: second byte-identical upload → returns `{ status: "duplicate" }`, still exactly one `triangles` row, second blob deleted.
    - [x] Parse failure — CSV: non-UTF-8 bytes labelled `.csv` → throws a specific `ConvexError`; no `triangles` row and no stored blob remain.
    - [x] Parse failure — XLSX: bytes that are not a readable workbook labelled `.xlsx` (e.g. plain text, a truncated/garbage zip, or a zip with zero sheets) → throws the specific "not a readable .xlsx workbook" `ConvexError`; no row, no blob. Also assert a **genuine** `.xlsx` (build one with `XLSX.write(...)` in the test) passes the open gate and creates the row.
    - [x] Guards: unauthenticated calls to `generateUploadUrl`, `createFromUpload`, `listByWorkspace` reject; cross-Workspace invisibility — an identity in org B cannot `listByWorkspace` org A's Triangles, and an identical file in org B does **not** collide with org A's (dedupe is per-Workspace via `by_workspace_hash`).
  - [x] **Register the three public functions in `convex/authGuard.test.ts` `publicFunctionArgs`** (`triangles:generateUploadUrl`, `triangles:createFromUpload`, `triangles:listByWorkspace`) — the enumeration suite fails the build if a new public function is unregistered (by design). `createFromUpload` needs a valid `v.id("_storage")` in its minimal args (Convex validates args before the guard runs); create one in the harness via `ctx.storage.store` during setup rather than passing a fake id string.

## Dev Notes

### Constitution & layering (project-context.md, AD-1/2/3/4/6/12)

- **AD-4 — every public Convex function's first statement is `requireMember(ctx, workspaceId)`.** No exceptions; UI-hiding is never sufficient. `requireMember`/`requireRole` live in `convex/lib/guards.ts`; `requireMember` returns `{ identity, role }` — use `identity.subject` as the actor. This story is all Analyst-level; no `requireRole` needed.
- **AD-6 — `auditLogs` has exactly one writer, `appendAuditEntry`.** Reach it only via `ctx.runMutation(internal.auditLogs.appendAuditEntry, ...)` from the action. Never insert into `auditLogs` from `triangles.ts`. `runId` is omitted here (no Run exists yet).
- **Dependency direction is strict** (frontend → Convex → engine_service → reserving_engine). This story touches only the frontend and Convex planes. The browser uploads to Convex storage and calls Convex functions; it never calls `engine_service`.
- **No arithmetic on reserve figures** — irrelevant here (no figures yet), but note the Triangle's *actuarial* content is untouched in 3.1; we store raw bytes only.

### Two hashes — never conflate (project-context.md "Hashes", AD-11)

- **This story records the raw-file sha256 only** (`rawFileHash`) — the byte-for-byte hash used for duplicate detection at upload (FR-1).
- The **canonical-triangle-JSON sha256** — *the* Triangle hash written to Lineage and used for re-derivation — is a **different hash computed at acceptance in Story 3.3**. Do not compute or store it here, and do not name this field `triangleHash`/`lineageHash`.

### Status display — do NOT reuse the fixed StatusBadge

- `components/StatusBadge.tsx` (UX-DR3) has a **closed vocabulary for Runs and Reserve Reports** (`draft | running | complete | failed | awaiting review | published | engine-only`). Triangle statuses (`pending_validation`, later `validated`) are **not** in it. Do **not** add Triangle statuses to `StatusBadge.Status`. Render a small, separate status indicator using existing brand tokens (pending → muted/caution treatment). Keep it local to the triangles UI.

### Vocabulary & naming (project-context.md "Code Quality")

- Table `triangles` (plural camelCase); functions camelCase in `convex/triangles.ts`; use the Glossary term **Triangle** in identifiers. Never invent synonyms ("upload", "file record", "dataset"). Rejected/failed uploads use the **destructive** color family; validation-style "needs your judgment" cues use **caution amber** (DESIGN.md) — but there are no validation findings in 3.1.
- Formats: JSON across boundaries; ISO-8601 UTC for `uploadedAt`; engine/Convex error envelope shape `{ code, message, details? }` — `ConvexError` `data` should carry `{ code, message }`.

### Existing patterns to reuse (do not reinvent)

- **OCC-serialized insert-if-absent**: copy the reasoning from `convex/auditLogs.ts` `appendAuditEntry` (read the head/collision key into the read set, let OCC serialize). `insertIfNew` follows the same shape against `by_workspace_hash`.
- **Action → internal-mutation composition**: `convex/http.ts` already calls `ctx.runMutation(internal.auditLogs.appendAuditEntry, ...)` — same pattern for `createFromUpload → insertIfNew` and `→ appendAuditEntry`.
- **Guard tests**: follow `convex/authGuard.test.ts` (enumeration) and `convex/auditLogs.test.ts` (per-function convex-test with `t.withIdentity`, cross-workspace assertions) for structure and fixture usage (`tests/convex-fixtures/`).
- **App-shell conventions**: `app/(app)/dashboard/page.tsx` and `app/(app)/triangles/page.tsx` show the `max-w-screen-2xl` data-surface wrapper and copy tone.

### Project Structure Notes

- New: `convex/triangles.ts`, `convex/triangles.test.ts`; edits to `convex/schema.ts`, `convex/authGuard.test.ts`, `app/(app)/triangles/page.tsx`; possibly a small triangle-status indicator component under `components/`.
- No `engine/` changes. CSV readability uses built-in `TextDecoder`. **XLSX readability requires a pure-JS workbook parser: add the `xlsx` (SheetJS) npm dependency.** It runs in the Convex **default** action runtime (V8) — no `"use node"` directive needed, so the action keeps `crypto.subtle` and `ctx.runMutation` alongside it. Do not reach for `exceljs` (needs the Node runtime and Node streams).
- **Reuse caveat:** this is the only place the TS side opens an `.xlsx`. Story 3.2 sends the file to `engine_service` where Python/pandas does the grid parse for validation, so `xlsx` here is a 3.1-scoped openability gate, not a shared parsing layer — keep its use confined to `createFromUpload`.
- Convex version `^1.42.2`; `crypto.subtle` and `TextDecoder` are available in the Convex action runtime.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.1] — story statement + ACs
- [Source: _bmad-output/planning-artifacts/epics.md#Functional Requirements] — FR1, FR15, FR18
- [Source: _bmad-output/planning-artifacts/epics.md#UX Design Requirements] — UX-DR3 (status badge scope), UX-DR8 (wizard — 3.2)
- [Source: _bmad-output/project-context.md] — Constitution, layering, auth, audit, hashes, vocabulary rules
- [Source: _bmad-output/planning-artifacts/architecture/.../ARCHITECTURE-SPINE.md#Conventions] — two-hash rule; ERD (WORKSPACE ||--o{ TRIANGLE); Capability map FR-1..3
- [Source: convex/auditLogs.ts] — `appendAuditEntry` OCC pattern + the single-writer invariant
- [Source: convex/lib/guards.ts] — `requireMember` returning `{ identity, role }`
- [Source: convex/authGuard.test.ts] — public-function enumeration (register new functions)
- [Source: convex/http.ts] — action → `ctx.runMutation(internal.auditLogs.appendAuditEntry)` pattern

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (Claude Code dev-story workflow)

### Debug Log References

- `npx convex codegen` — regenerated `convex/_generated/api.d.ts` to expose the `triangles` module (`internal.triangles.insertIfNew`, `api.triangles.*`).
- Convex test project: `npx vitest run --project convex` → 75 passed.
- Full suite: `npm test` → 138 passed (13 files). Typecheck (`tsc -p convex/tsconfig.json` and root `tsc --noEmit`) clean. `npm run lint` clean. `npm run build` compiles `/triangles`.

### Completion Notes List

- **SheetJS leniency drove the two-part XLSX gate.** `XLSX.read` will silently parse plain text / CSV as a one-cell workbook, so opening alone would let a text file labelled `.xlsx` through. The gate therefore requires **both** the ZIP/OOXML local-header signature `PK\x03\x04` (rejects non-zip payloads) **and** a full open with ≥1 readable sheet (rejects truncated/garbage zips and zero-sheet workbooks) — exactly the "magic-byte check alone is not sufficient" the story called for. Covered by the plain-text, garbage-zip, and genuine-workbook tests.
- **CSV readability split into two specific errors** for a more precise AC3 message: a fatal UTF-8 decode throw → `UNREADABLE_CSV` "File is not valid UTF-8 text."; a decodable-but-blank file → `EMPTY_CSV` "File contains no readable rows."
- **Error envelope codes** used (all `ConvexError` `{ code, message }`): `UNSUPPORTED_FORMAT`, `UNREADABLE_CSV`, `EMPTY_CSV`, `UNREADABLE_XLSX`, `UPLOAD_NOT_FOUND`. Orphan blob is deleted before every rejection throw (AC3 "no stored blob remain").
- **AD-6 honored**: audit entries (`triangle.uploaded`, `triangle.upload_duplicate`) are written only via `ctx.runMutation(internal.auditLogs.appendAuditEntry, …)` from the action — never inlined in `triangles.ts`. `insertIfNew` reuses the OCC-serialized insert-if-absent pattern from `appendAuditEntry` (the `by_workspace_hash` read is the serialization point; no manual retry).
- **Status indicator kept local** (`components/TriangleStatusIndicator.tsx`) — Triangle statuses are deliberately NOT added to the fixed `StatusBadge` vocabulary (UX-DR3). `pending_validation` uses the caution family.
- **Dependency note / security caveat:** added `xlsx` (SheetJS) `0.18.5` — the newest version published to the **npm registry** (SheetJS ships newer releases only from their own CDN). `npm audit` flags known advisories (prototype-pollution / ReDoS) against `<0.19.3`. Risk is bounded here: parsing runs in the sandboxed Convex V8 isolate on files uploaded by authenticated Workspace members, and only `SheetNames`/sheet-presence is read (no cell traversal). If the advisory is unacceptable, pin the SheetJS CDN build (`https://cdn.sheetjs.com/xlsx-latest/…`) instead — flagged for Rohan's decision.
- **Runtime divergence fixed during manual testing (2026-07-18):** a fatal `TextDecoder` rejects invalid UTF-8 by *throwing* in the vitest edge runtime but by *returning `undefined`* in the Convex V8 action runtime. The original CSV gate only caught the throw, so a bad `.csv` hit `text.split` on `undefined` → a bare `TypeError` → the client's generic fallback instead of the AC3 message. The handler now treats both a throw and an `undefined` result as invalid UTF-8. The convex-test harness cannot reproduce the undefined path (it throws), so a comment in `triangles.test.ts` pins the guard against future "simplification".
- **Verification scope:** all four ACs are proven by convex-test (guard enforcement, cross-Workspace invisibility, per-Workspace dedupe, byte-identical discard, all parse-failure paths). Production build compiles the UI. A full interactive browser run (sign-in → upload) was not executed — it requires the Clerk test-user password, which is not stored.

### File List

- `convex/schema.ts` (modified) — added the `triangles` table with `by_workspace` and `by_workspace_hash` indexes.
- `convex/triangles.ts` (new) — `insertIfNew` (internalMutation), `generateUploadUrl` (mutation), `createFromUpload` (action), `listByWorkspace` (query).
- `convex/triangles.test.ts` (new) — convex-test suite (happy path CSV + genuine XLSX, duplicate discard, all parse failures, guards + tenancy).
- `convex/authGuard.test.ts` (modified) — registered the three new public functions; inject a real `_storage` id for `createFromUpload`.
- `app/(app)/triangles/page.tsx` (modified) — replaced the placeholder with the Triangle library list + minimal upload control.
- `components/TriangleStatusIndicator.tsx` (new) — local Triangle status indicator (separate from `StatusBadge`).
- `convex/_generated/api.d.ts`, `convex/_generated/api.js` (regenerated) — include the `triangles` module.
- `package.json`, `package-lock.json` (modified) — added the `xlsx` dependency.

### Change Log

- 2026-07-18 — Story 3.1 implemented: Triangle upload → store → raw-file-sha256 → per-Workspace dedupe → library list, with format-readability gate (CSV UTF-8 / XLSX openability) and audit logging. Status → review.
