---
baseline_commit: 382888f08abe73cf1953c31a610530fb9fdaf610
---

# Story 3.3: Period Confirmation and Triangle Acceptance

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an Analyst,
I want detected Origin/Development Periods presented for my explicit confirmation,
so that the system never silently guesses my triangle's structure. (FR-3)

## Acceptance Criteria

**AC1 — Detected periods shown, editable, confirmation required (FR-3)**
Given a triangle that passed validation (a `triangles` doc, `status: pending_validation`, clean 3.2 pass),
When the wizard's Periods step renders,
Then the detected **Origin Period** labels + granularity and the **Development Period** ages are shown and **editable**, and acceptance requires an **explicit confirmation** action — the step never auto-accepts and never advances on its own (banned pattern: auto-advancing wizard steps).

**AC2 — Ambiguous layout → guided prompt, never a silent guess (FR-3)**
Given a triangle whose layout is ambiguous (e.g. undetectable orientation / labels that do not read as periods),
When the Periods step renders,
Then the user is shown a **guided prompt** to resolve the ambiguity (name the granularity / confirm the axes) — the system **never silently guesses** and never accepts until the user has resolved it.

**AC3 — Acceptance: immutable `validated` Triangle, canonical-JSON Lineage hash, audited (FR-3, FR-15, AD-11)**
Given confirmed periods,
When the Analyst accepts,
Then the Triangle becomes **immutable** with status `validated`; its **canonical-triangle-JSON sha256** is recorded as the Lineage Triangle hash — **engine-computed** (`reserving_engine.triangle_hash`), and **distinct from the raw-file hash** recorded in 3.1; the confirmed Triangle content (kind, confirmed Origin/Development labels, cells) is persisted so it can be rendered and re-derived; and the acceptance is **audit-logged** (`appendAuditEntry`, AD-6).

**AC4 — Triangle detail page with Latest-Diagonal edge-marking (UX-DR5)**
Given an accepted Triangle,
When its detail page renders,
Then it shows the read-only Triangle grid with **Latest Diagonal edge-marking** (2px primary left border on the last observed cell of each origin row), the confirmed periods, the accepted status, and **both** hashes labelled distinctly (raw-file vs canonical-triangle-JSON). The library list links each Triangle to this page.

**AC5 — Immutability + guard + tenancy tests (AD-3, FR-18, NFR-3)**
convex-test verifies **no mutation can alter an accepted Triangle's content** (a `validated` row's stored content/hash cannot be changed by any code path; acceptance is idempotent-gated on `pending_validation`), plus guard enforcement (unauthenticated rejection), cross-Workspace invisibility (a member of Workspace A cannot accept / read Workspace B's Triangle), the status gate (a `validation_failed` or already-`validated` Triangle cannot be accepted), and the engine `/canonicalize` call is stubbed (no live engine in tests).

## Scope Boundary (read first)

This story completes Epic 3: it turns the wizard's **Periods step** (a stub after 3.2) into real period detection + confirmation + **acceptance**, adds the **Triangle detail page**, and records the **canonical-triangle-JSON Lineage hash** at acceptance. Nothing beyond ingestion.

**In scope:**
- The real **Periods step** in `components/UploadWizard.tsx` (replacing the 3.3 stub panel): detected Origin/Development periods shown editable, ambiguous-layout guided prompt, explicit **Accept** action.
- A pure **period-detection** helper (granularity inference + ambiguity flag) in `convex/lib/`.
- The **`acceptTriangle` Convex action**: re-validate the confirmed-label Triangle (fail-closed), get the **engine-computed canonical hash**, persist the immutable accepted Triangle + hash, audit.
- A minimal **engine `/canonicalize` endpoint** returning the canonical-triangle-JSON sha256 (reuses `reserving_engine.triangle_hash`), so the Lineage hash is single-sourced (AD-10/AD-11) — **never** re-implemented in TypeScript.
- Schema: widen `triangles.status` with `validated`; add the accepted-Triangle fields (all optional — only set at acceptance).
- The **Triangle detail page** route + query; library rows link to it; `TriangleStatusIndicator` gains `validated`.

**Explicitly OUT of scope (do NOT build — later epics own them):**
- **Runs / a-priori grid / ResultSets / Diagnostics** → Epic 4. Acceptance makes a Triangle *runnable*; it does not start a Run.
- **ResultSet re-derivation from Lineage** (which *consumes* the stored hash) → Story 4.7. 3.3 only *records* the hash.
- **Enter-opens-cell-in-context-rail** (UX-DR5) — no context rail on this surface (lands in Epic 4 Diagnostics). Reuse the existing `TriangleGrid` (arrow-key nav + focusable cells already built in 3.2).
- **A "superseded by" link / hide-failed filter** for stale `validation_failed` rows — already logged in deferred-work (3.2); do not build here.

## Tasks / Subtasks

- [x] **Task 1 — Schema: `validated` status + accepted-Triangle fields (AC: 3, 4, 5)**
  - [x] `convex/schema.ts` → widen `triangles.status` union to add `v.literal("validated")` (non-breaking widening, per the table's existing comment: `pending_validation | validation_failed | validated`).
  - [x] Add these **optional** fields to the `triangles` table (set only at acceptance; absent on pending/failed rows):
    - `triangleHash: v.optional(v.string())` — the **canonical-triangle-JSON sha256** (engine-computed; the Lineage Triangle hash, AD-11). Distinct field from `rawFileHash`. Name it `triangleHash` (NOT `lineageHash`/`canonicalHash`) — it matches `Lineage.triangleHash` in `engineContract.ts`.
    - `acceptedTriangle: v.optional(triangleContentValidator)` — the confirmed, immutable Triangle content. Define `triangleContentValidator = v.object({ kind, origin_periods, development_periods, cells })` (snake_case wire keys, matching `triangleParse.ts` / the 3.2 `triangleValidator`; reuse `triangleValidator` from `engineContract.ts` if it can be imported into `schema.ts`, else inline the same shape). This is the source for the detail-page grid and future re-derivation.
    - `periodMeta: v.optional(v.object({ originGranularity: v.string(), developmentInterval: v.string() }))` — the confirmed granularity/interval for display (opaque strings; not used in any computation).
    - `acceptedBy: v.optional(v.string())` (Clerk user id), `acceptedAt: v.optional(v.string())` (ISO-8601 UTC).
  - [x] No new index needed (detail page fetches by `_id`; library still uses `by_workspace`).

- [x] **Task 2 — Engine `/canonicalize` endpoint + Convex validator (AC: 3, 5)**
  - [x] `engine/engine_service/models.py` → add `CanonicalizeResponse(BaseModel)` with `model_config = _MODEL_CONFIG` and one field `triangle_hash: str` (wire key `triangleHash` via the shared alias config — camelCase, matching `Lineage.triangleHash`). The request reuses the existing `ValidateRequest` shape (`{ triangle }`) — do **not** add a new request model.
  - [x] `engine/engine_service/app.py` → add `@app.post("/canonicalize", dependencies=[auth])`. Handler: `return JSONResponse(content=CanonicalizeResponse(triangle_hash=triangle_hash(request.triangle)).model_dump(mode="json", by_alias=True))`. Import `triangle_hash` from `reserving_engine`. Pydantic `Triangle` construction (in `ValidateRequest`) is the structural backstop — duplicate/empty labels and NaN/Inf 422 here before any hash is computed. **No engine core changes** — `triangle_hash`/`canonical_triangle_json` are a permanent contract (`engine/reserving_engine/triangle.py`); reuse, never touch.
  - [x] `engine/tests/` → a small pytest for `/canonicalize`: a known Triangle returns `triangleHash` equal to `triangle_hash(triangle)`; a malformed Triangle (duplicate labels) 422s with the error envelope; unauthenticated (no bearer) 401/403 per the existing `make_service_auth` tests. Follow `engine/tests/` service-test patterns (TestClient + injected `Settings`).
  - [x] `convex/lib/engineContract.ts` → add `canonicalizeResponseValidator = v.object({ triangleHash: v.string() })` + `export type CanonicalizeResponse`. (A one-field `{ triangleHash: string }` is trivial; adding it to the schema-export drift chain is **optional** — `CanonicalizeResponse` is an `engine_service` wire model, not a `reserving_engine` core model, so it is fine to validate it Convex-side without a `schemas/*.json` entry. If you do add it to `export_schema.py`, keep all four drift links in lockstep like 3.2 Task 1.)

- [x] **Task 3 — Pure period-detection helper (AC: 1, 2)**
  - [x] `convex/lib/periodDetection.ts` (new, **pure** module — no `ctx`, no I/O; unit-testable and importable by the client). Export `detectPeriods(originLabels: string[], developmentLabels: string[]): PeriodDetection`.
  - [x] `PeriodDetection = { originGranularity: "annual" | "quarterly" | "monthly" | "unknown"; developmentInterval: "months" | "quarters" | "years" | "unknown"; ambiguous: boolean; reason?: string }`.
  - [x] Heuristics (label-shape only — labels are opaque strings; this is metadata inference, **not** arithmetic on reserve figures, so it is allowed on the product plane per AD-1):
    - Origin granularity: all-4-digit-year → `annual`; `YYYYQ[1-4]` / `YYYY-Q[1-4]` → `quarterly`; `YYYY-MM` → `monthly`; otherwise `unknown`.
    - Development interval: numeric ages with a consistent step (12→`months`/`years`, 3→`quarters`, etc.) → the matching interval; otherwise `unknown`.
    - `ambiguous: true` (with a human `reason`) when either axis is `unknown`, or when the axes are individually plausible but mutually inconsistent (e.g. more development columns than any sane age sequence). Keep the rule simple and documented; **when in doubt, flag ambiguous** — never guess (AC2, FR-3).
  - [x] `convex/lib/periodDetection.test.ts` (convex/edge-runtime project): annual/quarterly/monthly detection, `unknown` → `ambiguous`, mixed/garbage labels → `ambiguous` with a reason, and a clean detection → `ambiguous: false`.
  - [x] **Note:** detection runs **client-side** on `validateTriangle`'s returned `triangle.origin_periods`/`development_periods` (no extra round-trip). The helper is pure so it can also be unit-tested and, if ever needed, called server-side. Do **not** persist detection output that the user did not confirm.

- [x] **Task 4 — `acceptTriangle` action + acceptance internal mutation/query (AC: 1, 3, 5)**
  - [x] `convex/triangles.ts` → `getForAcceptance` internalQuery (returns `{ workspaceId, storageId, label, format, status }` or null). Mirrors `getForValidation`.
  - [x] `convex/triangles.ts` → `markAccepted` internalMutation. Args: `{ triangleId, triangleHash, acceptedTriangle, periodMeta, acceptedBy, acceptedAt }`. Handler: `const row = await ctx.db.get(triangleId)`; **re-read status into the read set and gate**: if `row === null` → throw; if `row.status !== "pending_validation"` → throw `ConvexError({ code: "TRIANGLE_NOT_ACCEPTABLE", message })` (refuses `validation_failed` AND already-`validated` — the latter is the **immutability guard** and makes acceptance idempotent-safe under OCC). Else `ctx.db.patch(triangleId, { status: "validated", triangleHash, acceptedTriangle, periodMeta, acceptedBy, acceptedAt })`.
  - [x] `convex/triangles.ts` → `acceptTriangle` public **action**. Args: `{ workspaceId, triangleId, confirmedTriangle }` where `confirmedTriangle` carries the user's confirmed/edited labels + the cells (`{ kind, origin_periods, development_periods, cells }` — the client sends the grid it already holds from `validateTriangle`, with the confirmed labels substituted; cells are unchanged and pass through untouched, AD-1).
    - [x] First statement `const { identity } = await requireMember(ctx, workspaceId)` → `actor = identity.subject`.
    - [x] Tenancy re-check via `getForAcceptance` (the `triangleId` arg is attacker-controllable): `t === null || t.workspaceId !== workspaceId` → `TRIANGLE_NOT_FOUND`. Also gate `t.status === "pending_validation"` early (fail fast; `markAccepted` re-checks authoritatively).
    - [x] **Fail-closed validity re-check:** confirmed labels are opaque to validation and cells are unchanged, but do NOT trust the client/status — call `callEngine<ValidationReport>("/validate", { triangle: confirmedTriangle })`; if `!report.valid` → throw `ConvexError({ code: "TRIANGLE_INVALID", message })` and do **not** accept. (This also structurally validates the confirmed Triangle via the engine `Triangle` model — duplicate/empty labels 422 → mapped ConvexError.)
    - [x] **Engine-computed hash:** `const { triangleHash } = await callEngine<CanonicalizeResponse>("/canonicalize", { triangle: confirmedTriangle })`. Never compute this hash in TypeScript (AD-10/AD-11 — see Dev Notes "Why the hash is engine-computed").
    - [x] `markAccepted` with `{ triangleId, triangleHash, acceptedTriangle: confirmedTriangle, periodMeta, acceptedBy: actor, acceptedAt: new Date(Date.now()).toISOString() }`.
    - [x] Audit via `internal.auditLogs.appendAuditEntry` (AD-6 — never inline): `eventType: "triangle.accepted"`, `payload: { triangleId, triangleHash, originGranularity, developmentInterval, originCount, developmentCount }`. Do **not** put full cell arrays in the payload (keep the audit entry lean; the content lives on the row).
    - [x] Return `{ status: "accepted", triangleId, triangleHash }`.
  - [x] Register `triangles:acceptTriangle` in `convex/authGuard.test.ts` `publicFunctionArgs` (inject a real `v.id("triangles")` from a seeded row + a minimal valid `confirmedTriangle` — Convex validates args before the guard runs).

- [x] **Task 5 — Periods step UI (real) in `UploadWizard` (AC: 1, 2)**
  - [x] `components/UploadWizard.tsx` → replace the Periods **stub** (currently lines ~238–246) with a real `PeriodsStep`. It receives the `result` (`validateTriangle` output: `triangle` + `rawFileHash`) that the clean pass already holds.
  - [x] Run `detectPeriods(triangle.origin_periods, triangle.development_periods)` (Task 3) on mount of the step (compute during render / `useMemo`, not in an effect that sets state — avoid the `set-state-in-effect` lint the wizard already avoids).
  - [x] **Detected view (AC1):** show Origin Period labels + detected granularity and Development ages + interval, **editable** (label inputs per axis, or a granularity selector + editable label list). Keep it a **flow surface** (single column, `max-w-4xl`, generous whitespace — DESIGN.md), reusing the existing button/token idiom in this file. The **Accept** button is the explicit confirmation; nothing auto-advances.
  - [x] **Ambiguous view (AC2):** when `detection.ambiguous`, lead with a guided prompt (the `reason` + a clear ask: pick the Origin granularity / confirm the Development axis) using the **caution** family (`bg-caution-subtle text-caution` — "needs your judgment", not destructive). Accept stays disabled until the user resolves it (picks a granularity / edits labels so the axes read cleanly). Never render a guessed value as if confirmed.
  - [x] Client-side guard before submit: confirmed Origin and Development labels must be **non-empty and unique per axis** (mirror `assertUniqueNonEmpty` in `triangleParse.ts`) — show an inline message rather than letting the engine 422 be the first feedback.
  - [x] On **Accept**: call `acceptTriangle({ workspaceId, triangleId, confirmedTriangle })`, choreograph a named-stage/pending state (`aria-live="polite"`, never a bare spinner — same discipline as the Validation step), then on success show a confirmation with a link to the Triangle detail page (`/triangles/{triangleId}`) and to the library. On a thrown `ConvexError` (`TRIANGLE_INVALID`, engine-availability codes, etc.) render `.data.message` verbatim with a retry/fix affordance (reuse `errorMessage`/`isEngineError` already in the file).
  - [x] Wire `acceptTriangle` via `useAction(api.triangles.acceptTriangle)`.

- [x] **Task 6 — Triangle detail page + query + library link + status indicator (AC: 3, 4)**
  - [x] `convex/triangles.ts` → `getById` public **query**. Args `{ workspaceId, triangleId }`. First statement `requireMember`; tenancy re-check (`row.workspaceId === workspaceId` else return null / `TRIANGLE_NOT_FOUND`). Return the row incl. `status`, `label`, `filename`, `rawFileHash`, `triangleHash`, `acceptedTriangle`, `periodMeta`, `acceptedBy`, `acceptedAt`, `uploadedAt`.
  - [x] `app/(app)/triangles/[triangleId]/page.tsx` (new, `"use client"`). `useAuth().orgId` + `useQuery(api.triangles.getById, orgId ? { workspaceId: orgId, triangleId } : "skip")`.
    - [x] Accepted (`status: "validated"`): render `<TriangleGrid ... showLatestDiagonal />` from `acceptedTriangle` (kind/origin_periods/development_periods/cells), the confirmed periods (`periodMeta`), the accepted `TriangleStatusIndicator`, and **both hashes labelled distinctly**: "Raw-file hash" (`rawFileHash`) and "Triangle hash (canonical)" (`triangleHash`). Data surface (`max-w-screen-2xl`).
    - [x] Non-accepted (`pending_validation`/`validation_failed`): show the status + a note that the Triangle is not yet accepted (no grid, since no confirmed content is persisted). Loading / not-found states mirror the library page tone.
  - [x] `app/(app)/triangles/page.tsx` → make each library row's filename a link to `/triangles/{_id}` (keep the `#triangle-{id}` anchor + `target:` highlight working for the duplicate-jump). Add a "Triangle hash" column? Not required — the library already shows the raw-file hash; the detail page shows both. Keep the list change minimal.
  - [x] `components/TriangleStatusIndicator.tsx` → add `validated` to `TriangleStatus`, `statusLabels` ("Accepted" or "Validated" — use **"Accepted"** for user clarity; the internal status is `validated`), and `statusClasses` → the **published** family (`bg-published/10 text-published` per the token set — accepted is a positive terminal state, like published). Confirm the token exists in `app/globals.css` (the wizard uses `text-published`); if only `text-published` exists, use `bg-published/10 text-published`.

- [x] **Task 7 — Tests (AC: 1, 2, 3, 4, 5)**
  - [x] `convex/triangles.test.ts` extended (engine `fetch` stubbed via `vi.stubGlobal`, env via `vi.stubEnv`, storage seeded via `t.run(ctx.storage.store)` as in 3.1/3.2):
    - [x] Happy accept: a `pending_validation` row + stubbed `/validate` (`valid:true`) + stubbed `/canonicalize` (`{triangleHash}`) → row becomes `status: "validated"` with `triangleHash`, `acceptedTriangle`, `periodMeta`, `acceptedBy`, `acceptedAt` set; a `triangle.accepted` audit entry exists with `payload.triangleHash`. Assert the `/canonicalize` request body is the confirmed snake_case Triangle + `Bearer` header.
    - [x] **Immutability (AC5):** after acceptance, a second `acceptTriangle` (or a direct `markAccepted`) throws `TRIANGLE_NOT_ACCEPTABLE`; the stored `acceptedTriangle`/`triangleHash` are unchanged. There is **no** function that patches a `validated` row's content — assert the status gate holds.
    - [x] Status gate: accepting a `validation_failed` row → `TRIANGLE_NOT_ACCEPTABLE`; invalid confirmed Triangle (stub `/validate` → `valid:false`) → `TRIANGLE_INVALID`, row stays `pending_validation`, no `/canonicalize` call, no accept audit.
    - [x] Guards + tenancy: unauthenticated `acceptTriangle`/`getById` reject; an identity in org B cannot accept or `getById` org A's Triangle (`TRIANGLE_NOT_FOUND`).
  - [x] `convex/authGuard.test.ts`: register `triangles:acceptTriangle` and `triangles:getById` (real injected ids).
  - [x] `convex/lib/periodDetection.test.ts` (Task 3).
  - [x] `engine/tests/` `/canonicalize` test (Task 2).
  - [x] Component tests where practical (jsdom): a `PeriodsStep` ambiguous-prompt render / Accept-disabled-until-resolved test; a detail-page-grid render is covered indirectly by the existing `tests/triangle-grid.test.tsx` (the grid component is unchanged). Prioritize the convex-test + parser/detection suites (the ACs live there); do not over-invest in wizard DOM tests.
  - [x] **Full gates green before marking review:** `npm test`, root `npx tsc --noEmit` + `npx tsc -p convex/tsconfig.json --noEmit`, `npm run lint`, `npm run build` (compiles `/triangles` and `/triangles/[triangleId]`), and `cd engine && uv run pytest`. Keep the single Playwright smoke as-is (do not extend).

### Review Findings

_Epic 3 adversarial code review (2026-07-19), 3 layers (Blind Hunter, Edge Case Hunter, Acceptance Auditor) over the full 3.1+3.2+3.3 diff. Triaged: 8 patch, 4 deferred, 1 dismissed. Acceptance Auditor verdict: all ACs of 3.1/3.2/3.3 satisfied, no out-of-scope work._

- [x] [Review][Patch] **HIGH — `acceptTriangle` freezes client-supplied cells without reconciling against the stored file** [convex/triangles.ts `acceptTriangle`] — the wizard sends `confirmedTriangle` incl. `cells`; the server re-`/validate`s and canonicalizes but never compares cells to the uploaded bytes, so a buggy/malicious client can freeze fabricated numbers with a valid Lineage hash while `rawFileHash` still points at the genuine upload (breaks the AD-1/two-hash provenance design). Fix: re-read `storageId`, re-`parseTriangleGrid`, take **cells from the server parse**, apply only the confirmed **labels**/periodMeta from the client (assert label counts match), then `/validate` + `/canonicalize` + freeze.
- [x] [Review][Defer] **`coerceCell` decimal-comma corruption is SheetJS-owned, not fixable at this layer** [convex/lib/triangleParse.ts] — reclassified from patch after empirical verification: SheetJS's `raw:true` CSV parser coerces `"1,5"`→`15`, `"1e5"`→`100000`, `"0x10"`→`16` **before** `coerceCell` ever runs, so tightening `coerceCell` cannot fix the CSV path (and no test through the real parse path can prove it). The genuine fix is a parse-contract change (read raw cell text with `raw:false`, do all numeric coercion in `coerceCell`), which also affects XLSX date/format handling — deferred to its own story. Mitigated today by the wizard's visible grid preview + explicit human acceptance.
- [x] [Review][Patch] **LOW/MED — `callEngine` success branch is unwrapped and unvalidated** [convex/lib/engineClient.ts:69; convex/triangles.ts `acceptTriangle`] — `if (res.ok) return (await res.json()) as T` lets a 200-with-non-JSON body throw a raw `SyntaxError`, and no shape check means an engine glitch could freeze an empty `triangleHash`. Fix: wrap the ok-branch `json()` in try/catch → `ENGINE_UNAVAILABLE`; assert `triangleHash` non-empty in `acceptTriangle` before `markAccepted`.
- [x] [Review][Patch] **LOW — `isEngineError` misclassifies engine domain 4xx as "engine unavailable"** [components/UploadWizard.tsx `isEngineError`] — it matches the whole `engine.` prefix, so `engine.bad_request` shows "engine service is unavailable" + a Retry that loops on a deterministic failure. Fix: treat only `ENGINE_UNAVAILABLE`/`ENGINE_UNCONFIGURED` (and an `engine.unavailable`-style code) as availability problems, not every `engine.*`.
- [x] [Review][Patch] **LOW — `validateTriangle` has no status gate → post-acceptance audit noise** [convex/triangles.ts `validateTriangle`] — re-running it on a `validated` (accepted, immutable) Triangle re-parses the original file and appends a fresh `triangle.validated` audit entry after acceptance (content stays safe — `markValidationFailed` no-ops on `validated`). Fix: short-circuit `validateTriangle` when `status === "validated"`.
- [x] [Review][Patch] **LOW — `TRIANGLE_INVALID` on accept is a UX dead-end** [components/UploadWizard.tsx `PeriodsStep`] — the error message says "Fix the source and re-upload" but the Periods step exposes no control to return to the File step. Fix: surface a "Back to file / re-upload" action in `PeriodsStep`'s error state (reuse `resetToFile`).
- [x] [Review][Patch] **LOW — clipboard `writeText` unhandled rejection** [app/(app)/triangles/[triangleId]/page.tsx `HashRow`; app/(app)/triangles/page.tsx `copyHash`] — in an insecure context / on permission-deny the promise rejects unhandled and no feedback shows. Fix: wrap in try/catch.
- [x] [Review][Patch] **LOW — detail-page "not accepted" copy is wrong for `validation_failed`** [app/(app)/triangles/[triangleId]/page.tsx] — both `pending_validation` and `validation_failed` rows are told to "complete the Periods step to accept it," but a failed row can never reach that step. Fix: branch the copy by status.
- [x] [Review][Defer] **createFromUpload deletes a caller-supplied `storageId` with no ownership check** [convex/triangles.ts `createFromUpload`] — deferred, pre-existing (Story 3.1); low exploitability (Convex storage ids are unguessable and not exposed cross-tenant).
- [x] [Review][Defer] **`xlsx@^0.18.5` parses untrusted uploads with published advisories** [package.json] — deferred, pre-existing (Story 3.1, already flagged for Rohan); pin/vendor decision.
- [x] [Review][Defer] **A row whose blob vanished is unvalidatable yet dedupe blocks re-upload** [convex/triangles.ts] — deferred, pre-existing (3.1/3.2 interaction edge).
- [x] [Review][Defer] **Period detection omits the "mutually-inconsistent axes" ambiguity trigger** [convex/lib/periodDetection.ts] — deferred, a permitted Task-3 simplification, mitigated by AC1's mandatory explicit confirmation.

## Dev Notes

### Why the hash is engine-computed (AD-10, AD-11) — do NOT reimplement in TypeScript

The **canonical-triangle-JSON sha256** is a *permanent cross-runtime contract*. `engine/reserving_engine/triangle.py` owns it: `canonical_triangle_json` (camelCase keys `kind`/`originPeriods`/`developmentPeriods`/`cells`, `sort_keys=True`, `separators=(",",":")`, `ensure_ascii=True`, `allow_nan=False`, floats via CPython shortest-round-trip `repr`) and `triangle_hash` (sha256 hex of that). The module's own docstring: *"re-derivation must reproduce it forever — do not change it."*

- This hash is **the same value** the engine stamps into `Lineage.triangleHash` when a Run executes (`methods.py:331`), and `diagnostics.py:369` **raises** if a ResultSet's `lineage.triangle_hash != triangle_hash(triangle)`. If 3.3 stored a *TypeScript-computed* hash and it diverged by even one byte (float `repr`, ASCII escaping, key order), then a Run over that accepted Triangle would produce a Lineage hash that never matches the stored one → re-derivation (4.7) and any hash-equality check silently break.
- Therefore acceptance calls the engine (`/canonicalize`, Task 2) and stores exactly what the engine returns. A TS reimplementation of the serialization is the single most dangerous shortcut in this story — **do not do it**, even though it looks like "just a sha256".
- The two hashes stay strictly separate (Consistency Conventions, and 3.1/3.2 dev notes): `rawFileHash` = byte-for-byte dedupe hash (3.1); `triangleHash` = canonical-JSON Lineage hash (3.3). Never conflate, never share a helper. The audit-chain hash (`auditChain.ts`) is a *third* concept.

### The snake_case Triangle wire quirk (carried from 3.2 — do not "fix" it here)

The engine `Triangle` model has **no** camelCase alias generator, so the `/validate` **and** `/canonicalize` request body is snake_case (`origin_periods`/`development_periods`) — matching `triangleParse.ts`, the `triangleValidator`, and the `acceptedTriangle` you persist. The **response** `CanonicalizeResponse` uses `_MODEL_CONFIG` → `triangleHash` (camelCase), matching `Lineage.triangleHash`. This snake-body/camel-response split is a known, logged inconsistency (deferred-work, "Triangle wire keys are snake_case") — 3.3 **matches reality**, it does not change the contract. A uniform-camelCase pass is deferred to before Epic 4 `/runs` hardens.

### Constitution & layering recap (project-context.md, AD-1/2/3/4/6/10/11/12)

- **AD-1:** cells pass through untouched at acceptance — reshaping/relabeling only, never arithmetic. Period detection is *metadata* inference on opaque label strings, not computation on reserve figures — allowed on the product plane.
- **AD-4:** `acceptTriangle` and `getById` are public → first statement `requireMember(ctx, workspaceId)`; both re-check tenancy on the fetched row (`triangleId` is attacker-controllable). Analyst-level — no `requireRole` (acceptance is an Analyst action per the story; approval/publish roles are Epic 6).
- **AD-3 (immutability):** Convex is the sole system of record. The accepted Triangle is the **immutable** persisted content — the `markAccepted` status gate (`pending_validation → validated` only) is what enforces it; there is deliberately no function that patches a `validated` row's content. Also update `markValidationFailed` to be a **no-op-or-throw** if the row is already `validated` (defensive — the flow won't call it, but AC5's "no mutation can alter an accepted Triangle" must hold for every writer).
- **AD-6:** the sole `auditLogs` write (`triangle.accepted`) goes through `internal.auditLogs.appendAuditEntry` — never inline. `runId` omitted (no Run yet).
- **AD-12 / dependency direction:** frontend → Convex → engine_service → reserving_engine. The browser never calls the engine; only the `acceptTriangle` action does, over the shared bearer secret via the existing `callEngine` client (`convex/lib/engineClient.ts`, built generic in 3.2 — reuse it, add no new client).

### Action vs mutation (why acceptance is an action)

`acceptTriangle` reads storage is **not** needed (the client sends the confirmed Triangle it already holds) — but it makes the outbound engine HTTP calls (`/validate`, `/canonicalize`) and reaches the AD-6 writer via `ctx.runMutation`. Both require an **action** (a mutation cannot `fetch` or `runMutation`). This mirrors `validateTriangle`/`createFromUpload`. The default V8 action runtime has `fetch`/`crypto`/`ctx.runMutation` — **no `"use node"`**.

> **Do you even need storage bytes at acceptance?** No — the client passes `confirmedTriangle` (the grid from `validateTriangle` + confirmed labels). Re-parsing from storage would re-run `parseTriangleGrid` and re-apply the *detected* (not confirmed) labels, losing the user's edits. Trust the confirmed Triangle from the client but **fail-closed** by re-validating it through the engine (Task 4) — that is the tenancy/integrity backstop, not the client's word.

### UX specifics (UX-DR5, UX-DR8, DESIGN.md, EXPERIENCE.md)

- **Never a silent guess / never auto-advance** (both are banned patterns, EXPERIENCE.md:102): the Periods step always requires an explicit Accept; ambiguous layouts get a guided caution prompt, not a pre-filled guess.
- **Latest Diagonal edge-marking** (DESIGN.md:129, EXPERIENCE.md:68): 2px `{colors.primary}` left border on the last observed cell per origin row — already implemented in `TriangleGrid` behind `showLatestDiagonal`; the detail page just passes the prop. The wizard's validation preview does **not** need it lit (3.2 decision).
- **Copy tone** (EXPERIENCE.md:49): numbers/periods carry their unit — "Origin 2016–2025, annual; development to 120 months". Never "Oops". The reference walkthrough (EXPERIENCE.md:132): *"Wizard step 3 — Periods. Detected: accident years 2016–2025, annual development to 120 months. She confirms. Triangle lands in the library, immutable."* — build to that moment.
- **Flow vs data surface:** the wizard (incl. the Periods step) is a flow surface (`max-w-4xl`); the Triangle detail page is a data surface (`max-w-screen-2xl`) like the library.
- **Caution vs destructive families:** ambiguity / "needs your judgment" → caution amber; the accepted state → the **published** (positive terminal) family on the status indicator. Hard failures stay destructive.
- **Accepted status label:** show "Accepted" to the user even though the stored status literal is `validated` (the epic AC's word). Keep the literal `validated` in code/schema/audit.

### Existing patterns to reuse (do not reinvent)

- **Action → internal query/mutation + audit composition:** `validateTriangle → getForValidation` / `markValidationFailed` / `appendAuditEntry` (3.2) is the exact template for `acceptTriangle → getForAcceptance` / `markAccepted` / `appendAuditEntry`.
- **Engine client:** `convex/lib/engineClient.ts` `callEngine<T>(path, body)` — reuse verbatim for `/validate` and `/canonicalize`; it already maps the `{code,message,details?}` envelope → `ConvexError("engine.<code>")` and network/unset-config → `ENGINE_UNAVAILABLE`/`ENGINE_UNCONFIGURED`. The wizard's `isEngineError` already recognizes those codes.
- **Contract validators + drift:** `convex/lib/engineContract.ts` (+ `tests/engine-contract.test.ts` if you add `CanonicalizeResponse` to the drift chain) — read the top-of-file wire-discipline comment.
- **Grid:** `components/TriangleGrid.tsx` — unchanged; pass `showLatestDiagonal` on the detail page, `cellKey` for any highlighting.
- **Guard tests:** `convex/authGuard.test.ts` (enumeration — register the two new public functions) and `convex/triangles.test.ts` (per-function convex-test with `t.withIdentity`, cross-Workspace assertions, `ctx.storage.store` seeding, `vi.stubGlobal("fetch", …)` + `vi.stubEnv` for the engine).
- **Status indicator:** `components/TriangleStatusIndicator.tsx` — **widen** (add `validated`), don't replace; do **not** add Triangle statuses to the fixed `StatusBadge` (UX-DR3).

### Two hashes on the detail page — label them (AC4)

The detail page shows **both**: "Raw-file hash" (`rawFileHash`, sha256 of the uploaded bytes — dedupe) and "Triangle hash (canonical)" (`triangleHash`, the canonical-JSON Lineage hash). Distinct labels prevent the exact conflation the architecture warns against. The library list keeps showing only the raw-file hash (it lists non-accepted rows too, which have no `triangleHash`).

### Project Structure Notes

- **New:** `convex/lib/periodDetection.ts` (+ `.test.ts`), `app/(app)/triangles/[triangleId]/page.tsx`, `engine/tests/test_*canonicalize*.py` (or extend an existing service test module).
- **Edit:** `convex/schema.ts` (status + accepted fields), `convex/triangles.ts` (`getForAcceptance`, `markAccepted`, `acceptTriangle`, `getById`; guard `markValidationFailed`), `convex/lib/engineContract.ts` (`canonicalizeResponseValidator`), `convex/authGuard.test.ts`, `convex/triangles.test.ts`, `components/UploadWizard.tsx` (real Periods step), `components/TriangleStatusIndicator.tsx` (`validated`), `app/(app)/triangles/page.tsx` (row links), `engine/engine_service/app.py` + `engine/engine_service/models.py` (`/canonicalize`).
- **Regen:** `npx convex codegen` after adding the new functions. If you add `CanonicalizeResponse` to the schema export: `cd engine && uv run python -m scripts.export_schema` (the `-m` form — `python scripts/export_schema.py` fails the `reserving_engine` import since `package = false`).
- **No `reserving_engine` behavior changes** — the only engine touch is the new `engine_service` `/canonicalize` route + response model, both reusing the existing pure `triangle_hash`. `crypto`/`fetch`/`TextDecoder` are in the Convex default (V8) action runtime — no `"use node"`.
- **Doc:** append a 3.3 section to `_bmad-output/implementation-artifacts/deferred-work.md` for anything punted (e.g. the two-engine-calls-at-accept optimization; the snake/camel Triangle uniformity still open).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.3] — story statement + ACs (lines 412–428)
- [Source: _bmad-output/planning-artifacts/epics.md] — FR3 (line 104: Origin/Development detection + confirmation), Epic 3 summary (141–143)
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-agentic-reserving-2026-07-16/DESIGN.md] — Triangle grid + Latest Diagonal (line 129)
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-agentic-reserving-2026-07-16/EXPERIENCE.md] — grid behavior (68), banned patterns incl. auto-advancing steps (102), Flow 1 step-3 Periods walkthrough (132), immutability language (89–90)
- [Source: _bmad-output/implementation-artifacts/3-2-upload-wizard-validation-with-flagged-grid-preview.md] — wizard shell + Periods stub, `validateTriangle`, `triangleParse`, snake_case wire correction, engine client, status model, drift chain
- [Source: _bmad-output/implementation-artifacts/3-1-triangle-upload-with-duplicate-detection.md] — two-hash rule, action→internal-mutation+audit pattern, status-indicator convention, storage-seeding test pattern
- [Source: engine/reserving_engine/triangle.py] — `Triangle` model, `canonical_triangle_json`, `triangle_hash` (THE permanent canonical-hash contract — reuse, never change)
- [Source: engine/reserving_engine/methods.py:328-334, diagnostics.py:369] — Lineage `triangle_hash` stamping + the hash-equality assertion that makes engine-computed hashing mandatory
- [Source: engine/engine_service/app.py, engine/engine_service/models.py] — `/validate`, `/runs`, `ValidateRequest`, `_MODEL_CONFIG` (the pattern for `/canonicalize` + `CanonicalizeResponse`)
- [Source: convex/triangles.ts] — 3.1/3.2 action/mutation/query patterns to extend; [convex/lib/engineClient.ts] — `callEngine`; [convex/lib/engineContract.ts] — validators + `Lineage.triangleHash`
- [Source: convex/lib/guards.ts] — `requireMember`; [convex/auditLogs.ts] — `appendAuditEntry` single-writer + OCC-serialized read-into-read-set gate (the model for `markAccepted`'s status gate)
- [Source: components/UploadWizard.tsx] — Periods stub to replace, `errorMessage`/`isEngineError`, named-stage progress discipline; [components/TriangleGrid.tsx] — `showLatestDiagonal`, `cellKey`; [components/TriangleStatusIndicator.tsx] — widen with `validated`
- [Source: _bmad-output/project-context.md] — Constitution, layering, auth, audit, two-hash, vocabulary rules
- [Source: _bmad-output/planning-artifacts/architecture/architecture-agentic-reserving-2026-07-16/ARCHITECTURE-SPINE.md] — AD-1/3/4/6/10/11/12; Consistency Conventions (two-hash row); Capability map FR-1..3 (line 191)

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Claude Code, bmad-dev-story workflow)

### Debug Log References

- `npx convex codegen` — regenerated `convex/_generated/api.*` for `internal.triangles.getForAcceptance`/`markAccepted` and `api.triangles.acceptTriangle`/`getById`.
- TDD RED proof: `uv run pytest tests/test_engine_service.py -k canonicalize` → 7 failing (404, route absent) before implementing `/canonicalize`; green after.
- Full gates: `npm test` → **182 passed / 16 files**; `npx tsc --noEmit` + `npx tsc -p convex/tsconfig.json --noEmit` clean; `npm run lint` clean; `npm run build` compiles `/triangles` **and** `/triangles/[triangleId]`; `cd engine && uv run pytest` → **205 passed, 9 skipped**; `uv run ruff check .` clean; `uv run lint-imports` → 2 contracts kept (AD-2 core purity + downward layering intact — the new endpoint sits in the shell, not the core).

### Completion Notes List

- **The Lineage hash is engine-computed, never TypeScript.** Acceptance calls a new `engine_service` `POST /canonicalize` that reuses the pure `reserving_engine.triangle_hash` and returns `{ triangleHash }` (camelCase, matching `Lineage.triangleHash`). A pytest asserts `/canonicalize` returns exactly `triangle_hash(triangle)` **and** that it equals `resultSet.lineage.triangleHash` from `/runs` — proving the acceptance-time hash and the run-time Lineage hash are the same string, so re-derivation (4.7) and the diagnostics hash-equality check can never diverge. No `reserving_engine` core change; the endpoint is a thin shell route (import-linter confirms AD-2 purity kept).
- **Acceptance is fail-closed, not client-trusting.** `acceptTriangle` (action) re-`/validate`s the confirmed-label Triangle (rejects `TRIANGLE_INVALID` if the engine disagrees), then `/canonicalize`s it, then `markAccepted` flips `pending_validation → validated` under an OCC-serialized status gate that refuses every other starting status. Two engine calls at the single acceptance moment (not a hot path) — combining them into one endpoint is noted in deferred-work.
- **Immutability (AC5) is structural, not a flag.** There is deliberately **no** function that patches a `validated` row's content. `markAccepted`'s gate refuses a second accept (`TRIANGLE_NOT_ACCEPTABLE`), and `markValidationFailed` now **no-ops on a `validated` row** so re-validating an accepted Triangle can never demote it. Both paths are pinned by convex-test (second-accept-throws-content-unchanged; markValidationFailed-cannot-demote).
- **Period detection is pure + client-side.** `convex/lib/periodDetection.ts` infers origin granularity (annual/quarterly/monthly) and development interval (months/quarters/years) from opaque label shapes — metadata inference, never arithmetic on figures (AD-1). Ambiguity (`unknown` on either axis) → a caution guided prompt with a specific reason, and the Accept button stays disabled until the user picks a granularity/interval and the labels are non-empty + unique (AC2 — never a silent guess). 11 unit tests.
- **UI:** the wizard's Periods stub became a real `PeriodsStep` (editable origin/dev labels + granularity selects + a live `TriangleGrid` preview with Latest Diagonal; explicit "Accept triangle", nothing auto-advances). New Triangle detail page `/triangles/[triangleId]` renders the accepted grid with Latest-Diagonal edge-marking and **both** hashes labelled distinctly ("Raw-file hash" vs "Triangle hash (canonical)"); library rows link to it. `TriangleStatusIndicator` gained `validated` → shown as "Accepted" in the published (green) family; the stored literal stays `validated`.
- **Contract:** `CanonicalizeResponse` is a one-field `engine_service` wire model validated Convex-side (`canonicalizeResponseValidator`) — deliberately NOT added to the `schemas/*.json` drift chain (no meaningful drift surface on `{ triangleHash: string }`; it is not a `reserving_engine` core model). The snake-body/camel-response Triangle quirk from 3.2 is matched, not changed.
- **Verification scope:** all five ACs proven by automated tests — convex-test with a stubbed engine `fetch` (happy accept, immutability×2, status gate, fail-closed invalid, guards + tenancy, `getById`), the pure period-detection suite, and the engine `/canonicalize` pytest incl. the Lineage-hash-equality proof; production build compiles both routes. A full interactive browser run (sign-in → upload → validate → confirm → accept) was **not** executed — it needs the Clerk test-user password (not stored) and a live/dev engine service, same posture as 3.1/3.2. Per the story's Task 7 guidance, wizard DOM interaction tests were not added (ACs live in the convex-test + detection suites; the derived Accept-gating booleans are trivial).

### File List

- `convex/schema.ts` (modified) — `triangles.status` widened with `validated`; added optional `triangleHash`, `acceptedTriangle`, `periodMeta`, `acceptedBy`, `acceptedAt`; imports `triangleValidator`.
- `convex/triangles.ts` (modified) — `getForAcceptance` (internalQuery), `markAccepted` (internalMutation, status gate), `acceptTriangle` (public action), `getById` (public query); `markValidationFailed` guarded against `validated` rows.
- `convex/lib/engineContract.ts` (modified) — `canonicalizeResponseValidator` + `CanonicalizeResponse` type.
- `convex/lib/periodDetection.ts` (new) — pure granularity/interval detection + ambiguity flag.
- `convex/lib/periodDetection.test.ts` (new) — 11 detection tests.
- `convex/triangles.test.ts` (modified) — 8 new tests: acceptTriangle (happy, immutability×2, status gate, fail-closed invalid, guards/tenancy) + getById (accepted content, guards/tenancy).
- `convex/authGuard.test.ts` (modified) — registered `triangles:acceptTriangle` + `triangles:getById` (real injected ids).
- `convex/_generated/api.d.ts`, `convex/_generated/api.js` (regenerated).
- `engine/engine_service/models.py` (modified) — `CanonicalizeResponse`.
- `engine/engine_service/app.py` (modified) — `POST /canonicalize` route.
- `engine/tests/test_engine_service.py` (modified) — `/canonicalize` in auth coverage + `TestCanonicalize` (hash correctness, Lineage-hash equality, malformed 422).
- `components/UploadWizard.tsx` (modified) — real `PeriodsStep` (detect → confirm → accept) replacing the 3.3 stub.
- `components/TriangleStatusIndicator.tsx` (modified) — added `validated` → "Accepted" (published family).
- `app/(app)/triangles/[triangleId]/page.tsx` (new) — Triangle detail page with Latest-Diagonal grid + both hashes.
- `app/(app)/triangles/page.tsx` (modified) — library rows link to the detail page.
- `_bmad-output/implementation-artifacts/deferred-work.md` (modified) — 3.3 deferral notes.

### Change Log

- 2026-07-18 — Story 3.3 created (ready-for-dev): period detection + confirmation + Triangle acceptance; engine-computed canonical-triangle-JSON Lineage hash via a new `/canonicalize` endpoint; immutable `validated` status; Triangle detail page with Latest-Diagonal edge-marking. Completes Epic 3.
- 2026-07-19 — Story 3.3 implemented (→ review): all 7 tasks complete. Engine `/canonicalize` (single-sourced Lineage hash, proven equal to the run-time Lineage hash); fail-closed `acceptTriangle` action with OCC-gated immutable acceptance; pure client-side period detection with ambiguity prompt; Triangle detail page + Latest-Diagonal. Gates green (npm test 182, pytest 205/9-skip, tsc×2, lint, build, ruff, import-linter).
