---
baseline_commit: d5c799c
---

# Story 4.7: ResultSet Re-Derivation from Lineage

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a Senior Actuary,
I want to re-derive any stored ResultSet from its Lineage on demand,
so that I can prove reproducibility to an auditor months later. (FR-6, NFR-6, UJ-3)

## Acceptance Criteria

**AC1 — "Re-derive" on a complete Run re-executes the engine from stored Lineage and reports exact match (or a discrepancy report) for point estimates (FR-6, AD-11, epics.md:549-551)**
Given a Run with a stored ResultSet (status `complete`),
When "Re-derive" is triggered from the Run detail,
Then the engine **re-executes** `run_methods` with the Run's **stored accepted Triangle** and the **parameters read from `resultSet.lineage.parameters`** (re-deriving *from Lineage*, not from the run row), the re-run's point estimates are compared field-wise against the **stored** ResultSet, and the app reports **exact match** for point estimates on the pinned platform (`linux/x86_64`) — or a **discrepancy report** listing each mismatching figure if not (AD-11 exact/epsilon tiers). The re-derivation **never mutates** the stored ResultSet or the run status (reproducibility is a read-only proof — immutability holds).

**AC2 — The stored Triangle is verified against Lineage by canonical hash before comparison (chain of custody, AD-11)**
Given a re-derivation,
When it runs,
Then the engine recomputes `triangle_hash(triangle)` and asserts it equals `resultSet.lineage.triangleHash`; a **mismatch** is surfaced as a distinct **chain-of-custody failure** ("the stored Triangle no longer matches the Lineage hash") — *not* silently treated as a figure discrepancy and *never* a bare 500. Convex additionally re-checks `resultSet.lineage.triangleHash === run.triangleHash` (defense in depth, mirroring `storeResultSet`) before dispatching to the engine.

**AC3 — A tampered stored ResultSet is detected and surfaced (epics.md:554-556)**
Given a tampered fixture — a stored ResultSet whose figures were altered while the Triangle is intact —
When re-derivation runs,
Then the re-derived (authoritative) figures **do not match** the tampered stored figures, the **mismatch is detected and surfaced** as a discrepancy report (per-figure: method, field, stored value, re-derived value, delta), verified by **convex-test** (product plane) and **pytest** (engine plane) at the appropriate layers.

**AC4 — The re-derivation event and its outcome are audit-logged (AD-6, epics.md:552)**
Given any re-derivation (match, discrepancy, or chain-of-custody failure),
When it completes,
Then exactly one append-only `run.rederived` audit entry is written via `appendAuditEntry` (the sole writer, AD-6) carrying a **lean** payload — `{ runId, reproduced: boolean, tier, discrepancyCount, triangleHashVerified: boolean }`, **no reserve figures** (AD-1 leanness). The audit entry is written whether the outcome is reproduced or not; a re-derivation that fails to reach the engine (engine unavailable) surfaces the error to the caller and is **not** recorded as a reproducibility verdict.

**AC5 — All comparison arithmetic lives in `reserving_engine`; Convex and React only display the report (AD-1)**
Given the discrepancy deltas (`stored − rederived`) and the match/tier decision,
When they are produced,
Then they are computed **exclusively inside `reserving_engine`** — the deltas are arithmetic on reserve figures (AD-1 forbids that anywhere else, "including harmless totals or deltas in the UI"). The engine returns a **fully-formed `ReDerivationReport`**; the Convex action and the React surface **compute nothing** — they carry and display the report verbatim (React does display-formatting only).

**AC6 — `ReDerivationReport` is a versioned cross-runtime contract, drift-checked (AD-10)**
Given the new engine output shape,
When it is added,
Then `ReDerivationReport` is a Pydantic model in `reserving_engine` carrying `schemaVersion`, its JSON Schema is exported to `schemas/rederivation-report.schema.json` (via `scripts/export_schema.py`), a matching Convex `v`-validator + inferred TS type is added to `convex/lib/engineContract.ts`, and both drift links stay green: `engine/tests/test_schema_contract.py` (byte-equality of the committed schema vs a fresh export) and `tests/engine-contract.test.ts` (Convex validator ⇔ committed schema). A `ReDerivationReport` failing schema validation is never accepted by Convex (validated at the action's parse boundary).

**AC7 — `rederiveRun` is a guarded public Convex function; the auth-guard enumeration and append-only guardrails stay green (AD-4)**
Given the new public `runs:rederiveRun`,
When it is added,
Then its **first statement is `requireMember(ctx, workspaceId)`** (AD-4) followed by a tenancy re-check (returns/throws for a run outside this Workspace, existence never leaks); an entry for `runs:rederiveRun` is added to `convex/authGuard.test.ts`'s `publicFunctionArgs` so the enumeration asserts it rejects unauthenticated calls; and `tests/audit-append-only.test.ts` / `convex/auditLogs.test.ts` stay unmodified-green (the audit path is the existing `appendAuditEntry`).

**AC8 — Full gates green**
Given the story is implemented,
When the gates run,
Then `cd engine && uv run pytest`, `npm test` (unit + convex projects), `npx tsc --noEmit` (root) + `npx tsc -p convex/tsconfig.json --noEmit`, `npm run lint`, and `npm run build` all pass. `npx convex codegen` is run (one new public function). The single Playwright smoke is left as-is.

## Scope Boundary (read first)

This is the **reproducibility proof** story — the capstone of Epic 4 and the realization of **UJ-3** (the auditor traces a number: "opens the published Run, shows the Lineage, **re-derives the figure**"). The engine already *proves* re-derivation works in a test (`engine/tests/test_rederivation.py`: replay stored Lineage → `run_methods` → exact/epsilon compare). **This story lifts that private test logic into product code and exposes it as a live, guarded, audited, full-stack action** — engine core → engine_service endpoint → Convex action → Run-detail button + outcome panel.

**The load-bearing architectural decision:** the *comparison* (delta = `stored − rederived`, the exact/epsilon verdict) is **arithmetic on reserve figures**, so by AD-1 it **must** live in `reserving_engine` — exactly as the diagnostics deltas (A−E, CL−BF divergence) do. The engine therefore takes the stored ResultSet *as input*, re-runs authoritatively, and returns a fully-computed `ReDerivationReport`. Convex and React never subtract two figures.

**In scope (four planes):**

- **`engine/reserving_engine/rederivation.py`** (**new**, pure core — AD-2): a `ReDerivationReport` Pydantic model (`_MODEL_CONFIG`, camelCase wire) + a pure `rederive(triangle, stored_result_set)` function. It: (1) verifies `triangle_hash(triangle) == stored_result_set.lineage.triangle_hash` → on mismatch returns a report with `triangleHashVerified=False` and `reproduced=False` (chain-of-custody outcome, AC2); (2) re-runs `run_methods(triangle, stored_result_set.lineage.parameters)`; (3) compares the re-run against the stored ResultSet **field-wise** with the **AD-11 tier logic lifted from `test_rederivation.py`** (`_isclose_optional`, exact `==` on the pinned platform, `rel_tol=1e-8`/`abs_tol=1e-8` elsewhere); (4) emits `reproduced: bool`, `tier: "exact" | "epsilon"`, and a `discrepancies: tuple[Discrepancy, ...]` where each `Discrepancy` carries `{method, field, key, stored, rederived, delta}` (delta engine-computed, AC5). Point estimates only (ultimates, IBNR, LDFs, Mack std errs / total) — **not** diagnostics (the AC scopes to "point estimates"). No I/O, clock, env, or logging (AD-2).
- **`engine/reserving_engine/__init__.py`** (**edit**): export `ReDerivationReport`, `Discrepancy`, `rederive`.
- **`engine/reserving_engine/version.py`** — no change (engine semver bumps are governance, not this story).
- **`engine/engine_service/models.py`** (**new model**): `ReDeriveRequest` (`run_id: str`, `triangle: Triangle`, `stored_result_set: ResultSet`) — reusing `_MODEL_CONFIG`. The re-run parameters come from `stored_result_set.lineage.parameters`, **not** a separate field (re-deriving *from Lineage*). The response is the `ReDerivationReport` (already aliased).
- **`engine/engine_service/app.py`** (**new endpoint**): `POST /rederive` (guarded by the shared bearer secret like every route, AD-12) → `rederive(request.triangle, request.stored_result_set)` → `JSONResponse(report.model_dump(mode="json", by_alias=True))`. Pure delegation; no numbers computed in the shell (AD-1/AD-2).
- **`engine/scripts/export_schema.py`** (**edit**): add `ReDerivationReport: "rederivation-report.schema.json"` to `_TARGETS`; run the exporter to emit `schemas/rederivation-report.schema.json` (committed, generated — never hand-edited).
- **`schemas/rederivation-report.schema.json`** (**new**, generated).
- **`convex/lib/engineContract.ts`** (**edit**): add `reDerivationReportValidator` (`v.object` mirroring the schema — `schemaVersion`, `runId`, `reproduced`, `triangleHashVerified`, `tier`, `discrepancies: v.array(...)`) + `export type ReDerivationReport = Infer<...>`. Match the committed JSON Schema exactly (the drift check enforces it).
- **`convex/schemaContract.ts`** helpers + **`tests/engine-contract.test.ts`** (**edit**): add the `ReDerivationReport` drift assertion (validator ⇔ `rederivation-report.schema.json`), mirroring the four existing ones.
- **`convex/runs.ts`** (**edit**):
  - `getRunForRederive` (**new** `internalQuery`) — returns `{ triangle: run's acceptedTriangle, storedResultSet: run.resultSet, triangleHash: run.triangleHash }` for a `complete` run; throws `RUN_NOT_REDERIVABLE` if the run has no stored ResultSet, `RUN_NOT_FOUND` / `TRIANGLE_NOT_FOUND` defensively (mirrors `getRunForEngine`).
  - `rederiveRun` (**new** public `action`) — `requireMember(ctx, workspaceId)` first (AC7); tenancy re-check; fetch via `getRunForRederive`; assert `storedResultSet.lineage.triangleHash === triangleHash` (AC2 defense-in-depth); `callEngine<ReDerivationReport>("/rederive", { runId, triangle, storedResultSet })`; then `ctx.runMutation(internal.runs.recordRederivation, { runId, workspaceId, actor, report })`; return the `ReDerivationReport` to the caller. An action (needs `fetch`); `requireMember` runs before the fetch so unauthenticated calls are rejected without hitting the engine.
  - `recordRederivation` (**new** `internalMutation`) — re-reads the run (tenancy), appends the `run.rederived` audit entry via `appendAuditEntryInTransaction` (AC4, lean payload). **No** patch to the run row (immutability, AC1). Guarded so a vanished run no-ops.
- **`convex/authGuard.test.ts`** (**edit**): add `"runs:rederiveRun": { workspaceId: "org_test", runId: <seeded> }` to `publicFunctionArgs` and to the run-id-seeding branch (AC7).
- **`convex/runs.test.ts`** (**edit**): convex-test coverage — happy-path re-derivation of a `complete` run audit-logs `run.rederived` with `reproduced=true`; a **tampered stored ResultSet** (altered ultimate on the seeded run row) yields `reproduced=false` with discrepancies and is audit-logged (AC3); a `triangleHash` chain break yields the chain-of-custody outcome (AC2); `rederiveRun` on a non-complete run throws `RUN_NOT_REDERIVABLE`; cross-tenant `rederiveRun` is rejected (AC7). The engine `fetch` is stubbed (the existing test stubs `callEngine`/`fetch` — follow the Story 4.2 pattern of exercising internal functions / mocking the engine boundary; do **not** hit a real engine).
- **`components/RunDetail.tsx`** (**edit**): a "Re-derive" button shown when `run.status === "complete"` (near the status/step area or in the Results tab header). On click it calls an injected `onRederive` and renders the outcome inline in a **re-derivation panel**: a green **"Reproduced exactly"** / **"Reproduced within 1e-8"** confirmation, or a **discrepancy report** table (method · field · stored · re-derived · delta, mono `numeric`), or a chain-of-custody failure banner. Pending state while the engine runs (this is a real engine round-trip, NFR-7 ≤ 60s p95). Display-only — no arithmetic (AC5).
- **`app/(app)/runs/[runId]/page.tsx`** (**edit**): wire `useAction(api.runs.rederiveRun)` → pass `onRederive` into `RunDetail`; hold the returned report / error in local state to render. Mirror the existing `onRetry` wiring.
- **`components/RederivationPanel.tsx`** (**new**, optional): factor the outcome rendering out of `RunDetail` if it grows past a few lines (reuse `lib/formatNumber` formatters + `CopyableHash` idiom; provenance-violet only on Lineage-reference chrome per DESIGN.md:89). A plain inline block in `RunDetail` is acceptable if small.
- **Tests (frontend):** `tests/run-detail.test.tsx` (**extend**): a complete run shows "Re-derive"; clicking it (with a mocked `onRederive` resolving a `reproduced=true` report) renders the confirmation; a `reproduced=false` report renders the discrepancy table; a non-complete run shows no button. Keep all 4.3–4.6 assertions green.
- **Docs:** append a **4.7** section to `deferred-work.md`.

**Explicitly OUT of scope (do NOT build):**
- **Re-deriving the DiagnosticsBundle.** The AC scopes reproducibility to **point estimates** (ultimates, IBNR, LDFs, Mack std errs). Re-running diagnostics comparison is a possible later enhancement — note in `deferred-work.md`, do not build.
- **Persisting the re-derivation verdict on the `runs` row / a new table.** The **Audit Log is the record** (AC4, epics.md:552). No schema change to `runs`, no `rederivations` table. (If a future story wants a "last verified" badge, that reads the audit log — deferred.)
- **`requireRole(senior_actuary)` on `rederiveRun`.** Re-derivation **mutates nothing** — it is a read-only reproducibility proof, so `requireMember` is the architecturally-consistent guard (AD-4 reserves `requireRole` for the approve/publish/**override** *mutation* paths). The *persona* is the Senior Actuary (UJ-3/Priya), but any Workspace member may prove reproducibility. **Flagged decision** — if the product wants re-derivation gated to seniors, that is a one-line `requireMember → requireRole` change; see Dev Notes and the question at the end.
- **A background/scheduled "re-derive everything" job** (NFR-6's "100% re-derivable" is a property the tests assert, not a cron). On-demand only.
- **Bumping `schemaVersion` on `ResultSet`/`DiagnosticsBundle`** — untouched. Only the **new** `ReDerivationReport` carries its own `schemaVersion`.
- **Any change to `run_methods`, the Triangle model, diagnostics, or the existing `/runs` / `/validate` / `/canonicalize` endpoints.** `rederive` *calls* `run_methods`; it does not alter it. Golden tests stay byte-identical.

## Tasks / Subtasks

- [x] **Task 1 — Engine core: `ReDerivationReport` + pure `rederive` (AC: 1, 2, 3, 5)**
  - [x] `engine/reserving_engine/rederivation.py` (**new**): `Discrepancy` and `ReDerivationReport` Pydantic models (`_MODEL_CONFIG`, `schema_version = "1.0.0"`). `ReDerivationReport`: `schema_version`, `run_id: str`, `reproduced: bool`, `triangle_hash_verified: bool`, `tier: Literal["exact", "epsilon"]`, `discrepancies: tuple[Discrepancy, ...]`. `Discrepancy`: `method`, `field` (e.g. `"ultimate"`, `"ibnr"`, `"factor"`, `"mackStdErr"`, `"totalMackStdErr"`), `key` (origin label or dev-transition label; `""` for method-level totals), `stored: float`, `rederived: float`, `delta: float` (all `_require_finite`).
  - [x] `rederive(triangle: Triangle, stored_result_set: ResultSet, *, run_id: str | None = None) -> ReDerivationReport`: (1) if `triangle_hash(triangle) != stored_result_set.lineage.triangle_hash` → return `ReDerivationReport(reproduced=False, triangle_hash_verified=False, tier=..., discrepancies=())` (chain-of-custody; do not re-run). (2) else `rederived = run_methods(triangle, stored_result_set.lineage.parameters)`. (3) compare field-wise; lift `ON_PINNED_PLATFORM` + `_isclose_optional` from `tests/test_rederivation.py` into this **product** module (the test then imports from here, single-sourcing the tolerance semantics). `tier = "exact"` on the pinned platform, else `"epsilon"`; a field is a discrepancy if (pinned) `stored != rederived` or (else) not close. `reproduced = triangle_hash_verified and not discrepancies`.
  - [x] Guard structural drift: if `rederived` has a different method set / origin count than stored (e.g. tampered `methods`), record it as discrepancies (or a clear structural outcome) rather than throwing — a tampered Lineage must be *surfaced*, not crash.
  - [x] Pure-core discipline (AD-2): no I/O, clock, env, logging. `run_id` defaults from `stored_result_set` context if omitted; it is metadata on the report only.

- [x] **Task 2 — Engine core tests (AC: 1, 2, 3, 5)**
  - [x] `engine/tests/test_rederivation.py` (**edit**): refactor to import `ON_PINNED_PLATFORM`/`_isclose_optional`/`rederive` from `reserving_engine.rederivation` (single-source); keep the existing golden-fixture replays green. Add: `rederive` on an untouched fixture → `reproduced=True`, `triangle_hash_verified=True`, `discrepancies=()`. A **tampered** ResultSet (mutate one `ultimate` in a copy) → `reproduced=False` with exactly the expected `Discrepancy` (correct method/field/key, `delta` sign). A Triangle whose hash ≠ Lineage hash → `triangle_hash_verified=False`, `reproduced=False`, no re-run.
  - [x] `engine/tests/test_schema_contract.py` (**edit**): add `rederivation-report.schema.json` to the byte-equality set (Link 1).

- [x] **Task 3 — Engine service `/rederive` endpoint (AC: 1, 2)**
  - [x] `engine/engine_service/models.py` (**edit**): add `ReDeriveRequest` (`run_id`, `triangle: Triangle`, `stored_result_set: ResultSet`; `_non_empty_run_id` validator mirroring `RunRequest`).
  - [x] `engine/engine_service/app.py` (**edit**): `@app.post("/rederive", dependencies=[auth])` → `report = rederive(request.triangle, request.stored_result_set, run_id=request.run_id)` → `JSONResponse(report.model_dump(mode="json", by_alias=True))`.
  - [x] `engine/tests/test_engine_service.py` (**edit**): add `/rederive` to the auth parametrize lists (401 without/ wrong / non-bearer secret). Happy path: build a stored ResultSet via `run_methods`, POST `{run_id, triangle, stored_result_set}` with the good secret → 200 + `reproduced True`. Tampered stored ResultSet → 200 + `reproduced False` + discrepancies. Hash mismatch → 200 + `triangleHashVerified False`.

- [x] **Task 4 — Export schema + Convex contract + drift (AC: 6)**
  - [x] `engine/scripts/export_schema.py` (**edit**): add `ReDerivationReport` to `_TARGETS`; run `cd engine && uv run python scripts/export_schema.py`; commit `schemas/rederivation-report.schema.json`.
  - [x] `convex/lib/engineContract.ts` (**edit**): add `reDerivationReportValidator` + `discrepancyValidator` (`v.object`s matching the emitted schema — camelCase keys, `tier` a `v.union(v.literal("exact"), v.literal("epsilon"))`) + `export type ReDerivationReport = Infer<...>`.
  - [x] `tests/engine-contract.test.ts` (**edit**): add the `ReDerivationReport` validator ⇔ committed-schema drift assertion (mirror the four existing blocks). Confirm `jsonSchemaToCanonical`/`validatorToCanonical`/`diffCanonical` handle the new shape (literal-union `tier` — check `schemaContract.ts` already supports string-literal unions; the `Method` union is the precedent).

- [x] **Task 5 — Convex action + internal query + audit mutation (AC: 1, 2, 4, 5, 7)**
  - [x] `convex/runs.ts` (**edit**): `getRunForRederive` internalQuery (returns `{triangle, storedResultSet, triangleHash}` for a `complete` run; `RUN_NOT_REDERIVABLE` if no stored ResultSet).
  - [x] `rederiveRun` public action: `requireMember` first → tenancy re-check → `getRunForRederive` → assert `storedResultSet.lineage.triangleHash === triangleHash` (else `RESULT_HASH_MISMATCH`, before the engine call) → `callEngine<ReDerivationReport>("/rederive", { runId, triangle, storedResultSet })` → `runMutation(internal.runs.recordRederivation, {...})` → return the report. Type-annotate the return to break `internal.*` cycles (see `executeEngineRun`).
  - [x] `recordRederivation` internalMutation: re-read run (no-op if gone / wrong workspace), `appendAuditEntryInTransaction` `run.rederived` with lean payload `{ runId, reproduced, tier, discrepancyCount: report.discrepancies.length, triangleHashVerified }`. **No** run-row patch (immutability).
  - [x] `npx convex codegen` (new public function).

- [x] **Task 6 — Convex tests + auth-guard enumeration (AC: 3, 4, 7)**
  - [x] `convex/authGuard.test.ts` (**edit**): add `runs:rederiveRun` to `publicFunctionArgs` (`{ workspaceId, runId }`) and to the run-id-seeding branch (it needs a real `v.id("runs")` like `getRun`/`retryRun`).
  - [x] `convex/runs.test.ts` (**edit**): stub the engine boundary (the `/rederive` `callEngine`/`fetch`) as the existing suite stubs `/runs`. Tests: (a) happy path on a complete run with a matching stubbed `reproduced=true` report → `run.rederived` audit entry present, lean payload, run row **unchanged** (status still `complete`, resultSet identical); (b) stubbed `reproduced=false` report (discrepancies) → still audit-logged, still no mutation; (c) `rederiveRun` on a queued/running/failed run → `RUN_NOT_REDERIVABLE`; (d) cross-tenant (org_B run via org_A) → rejected, existence not leaked; (e) `RESULT_HASH_MISMATCH` when the seeded run's `triangleHash` ≠ its stored `resultSet.lineage.triangleHash`.
  - [x] `tests/audit-append-only.test.ts` / `convex/auditLogs.test.ts` — confirm **unmodified**-green (no new audit writer; `appendAuditEntry` is reused).

- [x] **Task 7 — Run-detail UI: trigger + outcome panel (AC: 1, 5)**
  - [x] `components/RunDetail.tsx` (**edit**): add an `onRederive?: () => Promise<ReDerivationReport>` prop and a "Re-derive" `<button>` visible only when `run.status === "complete"`. Pending state while awaiting; render the returned report inline: **reproduced** → green confirmation naming the tier ("Reproduced exactly on the pinned platform" / "Reproduced within 1e-8"); **discrepancies** → a `numeric` table (method · field · key · stored · re-derived · delta) with a destructive header; **`triangleHashVerified === false`** → a distinct chain-of-custody warning ("The stored Triangle no longer matches its Lineage hash"). All values `format*()` from the report — **no arithmetic** (AC5). Optionally factor into `components/RederivationPanel.tsx`.
  - [x] `app/(app)/runs/[runId]/page.tsx` (**edit**): `useAction(api.runs.rederiveRun)`; `onRederive` calls it with `{ workspaceId: orgId, runId }`, stores the report/error in state, passes it down. Mirror `onRetry` error handling (`errorMessage`).
  - [x] `tests/run-detail.test.tsx` (**edit**): complete run shows "Re-derive"; click with mocked `onRederive` → confirmation (reproduced) and, in a second case, the discrepancy table (not reproduced); non-complete run → no button. `afterEach` reset. Keep 4.3–4.6 assertions green.

- [x] **Task 8 — Docs + full gates (AC: 8)**
  - [x] `_bmad-output/implementation-artifacts/deferred-work.md` (**edit**): append §4.7 — diagnostics re-derivation deferred (point estimates only); the `requireMember`-vs-`requireRole(senior_actuary)` guard decision; audit-log-as-record (no `rederivations` table); no "last verified" badge yet; cross-platform epsilon tier is documented, not a silent widen (AD-11).
  - [x] Run all gates green: `cd engine && uv run pytest`; `npm test`; `npx tsc --noEmit` (root) + `npx tsc -p convex/tsconfig.json --noEmit`; `npm run lint`; `npm run build`; `npx convex codegen` committed. Leave the Playwright smoke as-is.

## Dev Notes

### The engine already re-derives — this story productizes the existing proof (FR-6, AD-11)

`engine/tests/test_rederivation.py` is the blueprint: it loads a stored golden ResultSet, asserts `stored.lineage.triangle_hash == triangle_hash(TAYLOR_ASHE)`, re-runs `run_methods(TAYLOR_ASHE, stored.lineage.parameters)`, and compares — **exact `==` on the pinned platform** (`sys.platform == "linux" and platform.machine() == "x86_64"`), **`math.isclose(..., rel_tol=1e-8, abs_tol=1e-8)` elsewhere** (AD-11's two tiers). Task 1 **lifts** `ON_PINNED_PLATFORM` and `_isclose_optional` and that comparison loop out of the test and into `reserving_engine/rederivation.py` as product code, then has the test import them back (single source of truth). The re-run entry point (`run_methods`) and the hash function (`triangle_hash`) already exist and are already exported from `reserving_engine`. This story adds **no new numeric method** — it adds a *comparison* and the plumbing to invoke it live.

### Why the comparison MUST be in `reserving_engine` (AD-1, load-bearing)

`delta = stored − rederived` is arithmetic on reserve figures. `project-context.md` anti-patterns: "❌ Arithmetic on reserve figures anywhere outside `reserving_engine` — including 'harmless' totals or deltas in the UI." So the engine takes the **stored ResultSet as input** (plain data in — AD-2 pure core is fine with that), re-computes the authoritative ResultSet, subtracts, and returns a `ReDerivationReport` with every delta **pre-computed**. This exactly mirrors how the diagnostics deltas (A−E in `ave`, CL−BF in `clBfDivergence`) are engine-computed and the UI only prints them (Story 2.4 / 4.5). Convex's `callEngine` carries the report; React `format*()`s it. Neither subtracts anything.

### Re-derive *from Lineage* — parameters come from `resultSet.lineage.parameters`, not the run row (FR-6 semantics)

The point of FR-6/NFR-6 is that a **stored ResultSet is self-describing**: its Lineage (engine semver, chainladder version, triangle hash, **all parameters including a-prioris**) is the complete recipe. So `rederive` reads parameters from `stored_result_set.lineage.parameters` — **not** from `run.parameters`. (They are equal today by construction, but re-deriving from Lineage is what proves the *Lineage* is sufficient — the auditor's guarantee.) The Triangle is the run's stored `acceptedTriangle`; the `triangle_hash` check (AC2) proves *that* Triangle is the one Lineage recorded. If the two ever diverged, re-derivation would surface it — which is the whole value.

### Two distinct failure modes — keep them distinct (AC2 vs AC3)

1. **Chain-of-custody break** (`triangleHashVerified=false`): the Triangle handed to the engine doesn't hash to `lineage.triangleHash`. The engine does **not** re-run (comparing against a different triangle is meaningless) — it returns immediately with `reproduced=false, triangleHashVerified=false`. Surface as a *warning* ("stored Triangle no longer matches its Lineage").
2. **Figure discrepancy** (`triangleHashVerified=true`, `discrepancies` non-empty): the Triangle is authentic but the stored *figures* were altered (the tampered-fixture case, AC3). Re-run succeeds; the authoritative figures ≠ the tampered stored ones → per-figure discrepancy report. Surface as a *discrepancy table*.
Both set `reproduced=false`; the UI reads `triangleHashVerified` to pick the message. Convex adds a **belt-and-braces** `resultSet.lineage.triangleHash === run.triangleHash` check before the engine call (mirrors `storeResultSet`'s AD-11 guard, runs.ts:307-316) so a Convex-side tamper is caught even before dispatch.

### Guard: `requireMember`, not `requireRole` — and why (AD-4, flagged)

AD-4: "Approve/publish/**override** paths call `requireRole(ctx, workspaceId, "senior_actuary")`." Re-derivation is **none of those** — it writes no product state, only an audit entry (which every actor writes). It is a *read-only proof*. So `rederiveRun`'s guard is `requireMember` (any member may verify reproducibility), consistent with `getResultSet`/`getRun`. The **story persona** is the Senior Actuary because UJ-3 is Priya-the-auditor's-host, not because the *action* is privileged. **This is a genuine decision** — see the question at the end. Flipping to `requireRole` later is one line + one `authGuard.test.ts` fixture change.

### `rederiveRun` is an action; audit is written by a mutation it calls (AD-6, existing pattern)

`rederiveRun` must `fetch` the engine → it is an `action` (like `executeEngineRun`). Actions can't write the DB directly, and `auditLogs` has exactly one writer — `appendAuditEntry` (an `internalMutation`, auditLogs.ts:43) delegating to `appendAuditEntryInTransaction` (auditLogs.ts:68). So the action, after receiving the report, calls a **new** `internal.runs.recordRederivation` mutation that appends via `appendAuditEntryInTransaction` — the sole-writer invariant (AD-6) holds. `requireMember` runs at the **top of the action** (actions have `ctx.auth`), before the fetch, so unauthenticated calls never reach the engine (AC7). The action returns the report straight to the page (not persisted — the UI holds it in state; a re-run re-fetches).

### No run-row mutation — re-derivation is immutable-by-design (AC1)

`recordRederivation` **does not** patch the `runs` row. The stored ResultSet is immutable (Story 4.2's `storeResultSet` is a one-time write guarded on `status === "running"`); re-derivation must not overwrite it or touch status. The audit log is the *only* durable trace (AC4). This keeps NFR-4 idempotency intact and means a run can be re-derived any number of times with no state drift. If a "last re-derived at / verdict" badge is ever wanted, it reads the audit log (deferred).

### `ReDerivationReport` joins the AD-10 drift chain (AC6) — mirror the four existing models

The report crosses the Convex↔engine boundary, so it earns full AD-10 rigor (unlike `CanonicalizeResponse`, which is a trivial one-field engine_service response with "no meaningful drift surface" and stayed off `schemas/`). Add it to `_TARGETS` in `export_schema.py` (→ `schemas/rederivation-report.schema.json`), author the matching Convex validator, and extend both drift links (`test_schema_contract.py` byte-equality Link 1; `engine-contract.test.ts` validator⇔schema Link 2). The `tier` literal-union follows the `Method` union precedent — confirm `schemaContract.ts` canonicalizes string-literal unions (it must, for `methodValidator`). camelCase wire keys via `_MODEL_CONFIG` (`schemaVersion`, `runId`, `triangleHashVerified`, `rederived`), byte-matching the schema.

### Reuse, do not reinvent (existing patterns)

- **Engine call:** `convex/lib/engineClient.ts` `callEngine<T>(path, body)` — generic, no per-endpoint logic; `/rederive` reuses it verbatim (its `ConvexError` envelope mapping + `ENGINE_UNAVAILABLE` fail-closed already handle a down engine, feeding AC4's "not recorded as a verdict" — the audit mutation is only reached on a successful report).
- **Internal-query-then-action shape:** `getRunForEngine` + `executeEngineRun` (runs.ts:205-258) is the exact template for `getRunForRederive` + `rederiveRun`.
- **Audit append:** `appendAuditEntryInTransaction` (auditLogs.ts:68) + the lean-payload convention (`markRunning`/`storeResultSet` pass `{ runId, ... }`, never figures).
- **Hash chain-of-custody check:** `storeResultSet` runs.ts:307-316 (the `resultSet.lineage.triangleHash !== run.triangleHash` guard) — reuse the idiom in `rederiveRun`.
- **Auth guard + enumeration:** `requireMember` (guards.ts) + the `publicFunctionArgs` fixture (authGuard.test.ts:70-82) — add one entry.
- **Tolerance semantics:** `test_rederivation.py:26-64` (`ON_PINNED_PLATFORM`, `_isclose_optional`, the field-wise loop) — **lift into product code**, don't duplicate.
- **Formatters + provenance idioms (UI):** `lib/formatNumber.ts` (`formatFigure`/`formatSignedFigure`/`formatFactor`), `components/CopyableHash.tsx`, `components/ProvenancePopover.tsx` (Lineage display + provenance-violet-only-on-chrome, DESIGN.md:89). The re-derivation panel is a display surface — add no formatter, no token.
- **Engine_service auth test parametrize:** `test_engine_service.py:74-100` lists `["/validate", "/runs", "/canonicalize"]` — add `/rederive`.
- **jsdom spec conventions:** `tests/run-detail.test.tsx` harness (`makeRun`/`makeResultSet`, `next/link` mock) — extend; mock `onRederive` (don't hit Convex).

### Project Structure Notes

- **New:** `engine/reserving_engine/rederivation.py`, `schemas/rederivation-report.schema.json` (generated), optionally `components/RederivationPanel.tsx`.
- **Edit (engine):** `reserving_engine/__init__.py` (exports), `engine_service/models.py` (`ReDeriveRequest`), `engine_service/app.py` (`/rederive`), `scripts/export_schema.py` (`_TARGETS`), `tests/test_rederivation.py` (import from product module + new cases), `tests/test_engine_service.py` (`/rederive` auth + happy/tamper/hash), `tests/test_schema_contract.py` (new schema in byte-set).
- **Edit (Convex):** `convex/runs.ts` (`getRunForRederive`, `rederiveRun`, `recordRederivation`), `convex/lib/engineContract.ts` (`reDerivationReportValidator` + type), `convex/authGuard.test.ts` (fixture entry), `convex/runs.test.ts` (re-derive suite), `tests/engine-contract.test.ts` (drift assertion).
- **Edit (frontend):** `components/RunDetail.tsx` (button + panel), `app/(app)/runs/[runId]/page.tsx` (`useAction` wiring), `tests/run-detail.test.tsx` (extend).
- **Edit (docs):** `_bmad-output/implementation-artifacts/deferred-work.md` (§4.7).
- **No change:** `reserving_engine/methods.py` / `triangle.py` / `diagnostics.py` / `validation.py` (called, not modified), the existing `/runs`·`/validate`·`/canonicalize` endpoints, `convex/schema.ts` (**no** `runs` field, **no** new table — audit log is the record), `convex/workflow.ts`, `convex/triangles.ts`, `convex/auditLogs.ts` (reused), `tests/audit-append-only.test.ts`, golden tests (`test_golden_taylor_ashe.py`), the four existing `schemas/*.json`.
- **Codegen:** `npx convex codegen` required (one new public function).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.7] (lines 541-556) — story statement + ACs: re-execute with stored Triangle (verified by canonical hash) + parameters, exact match on the pinned platform or a discrepancy report (FR-6, AD-11); re-derivation event + outcome audit-logged; tampered-fixture mismatch detected + surfaced via convex-test/pytest; Epic 4 summary (430-432)
- [Source: _bmad-output/planning-artifacts/prds/prd-agentic-reserving-2026-07-16/prd.md] — FR-6 Reproducibility "Any historical ResultSet can be re-derived from its Lineage. Realizes UJ-3." (108-109); UJ-3 the auditor re-derives the figure (40); Lineage definition (56); NFR-6 "100% of stored ResultSets re-derivable from Lineage" (259); SM-3 (276); §4.2 FR-6 bit-for-bit reproducible w/ epsilon fallback (296)
- [Source: _bmad-output/planning-artifacts/architecture/architecture-agentic-reserving-2026-07-16/ARCHITECTURE-SPINE.md] — **AD-11** (113-117): pinned linux/amd64 exact equality for point estimates on golden + re-derivation, cross-platform documented at 1e-8 relative; Lineage records engine semver, chainladder version, triangle sha256, all parameters incl. a-prioris; **AD-1** (LLM/UI never compute — deltas belong in the engine); **AD-2** pure core; **AD-6** append-only audit, single writer; **AD-4** requireMember-first / requireRole for approve·publish·override; **AD-10** versioned cross-runtime contracts + CI drift; **AD-12** engine endpoints require the bearer secret; Hashes convention (132) canonical-triangle-JSON sha256 is *the* re-derivation hash
- [Source: engine/tests/test_rederivation.py] — the blueprint to lift into product code: `ON_PINNED_PLATFORM` (26), `_isclose_optional` (29-32), `assert_rederivation_reproduces` (35-64: hash check → `run_methods(triangle, stored.lineage.parameters)` → exact `==` pinned / field-wise 1e-8 else)
- [Source: engine/reserving_engine/methods.py:307-334] — `run_methods(triangle, parameters)` the re-run entry point + Lineage assembly (engine semver, chainladder version, `triangle_hash`, parameters); [reserving_engine/resultset.py:98-171] — `Lineage`/`RunParameters`/`ResultSet`/`OriginResult`/`MethodResult`/`DevelopmentFactor` shapes to compare field-wise; `_MODEL_CONFIG` (37, frozen + camelCase alias) to reuse on the new models; `_require_finite` (40)
- [Source: engine/reserving_engine/triangle.py] — `triangle_hash` (exported) for the AC2 canonical-hash chain-of-custody check; [reserving_engine/__init__.py:1-60] — the export surface to extend
- [Source: engine/engine_service/app.py:38-71] — the `create_app` factory + the `/runs` handler to mirror for `/rederive` (bearer `auth` dep, pure delegation, `model_dump(mode="json", by_alias=True)`); [engine_service/models.py:25-53] — `RunRequest`/`RunResponse` to mirror for `ReDeriveRequest` (incl. `_non_empty_run_id`)
- [Source: engine/engine_service/tests/test_engine_service.py:74-126] — the auth parametrize (`["/validate","/runs","/canonicalize"]` → add `/rederive`) + the `TestClient(create_app(settings=…))` happy-path style
- [Source: engine/scripts/export_schema.py:_TARGETS + _dumps] — add `ReDerivationReport → "rederivation-report.schema.json"`; generated, never hand-edited; [engine/tests/test_schema_contract.py] — Link 1 byte-equality guard to extend
- [Source: convex/runs.ts:205-258] — `getRunForEngine` internalQuery + `executeEngineRun` action = the exact template for `getRunForRederive` + `rederiveRun`; [runs.ts:292-339] `storeResultSet` — the `lineage.triangleHash !== run.triangleHash` chain-of-custody guard (307-316) + the lean audit-payload convention to reuse; [runs.ts:455-503] `getRun`/`getResultSet` — requireMember-first + tenancy-null idiom
- [Source: convex/lib/engineClient.ts:40-99] — `callEngine<T>("/rederive", body)`, generic; its `ENGINE_UNAVAILABLE`/envelope mapping is the fail-closed on a down engine
- [Source: convex/lib/engineContract.ts:24-80, 197-211] — `methodValidator` (literal-union precedent for `tier`), `resultSetValidator`/`lineageValidator` shapes, the `Infer` type pattern; add `reDerivationReportValidator` + `type ReDerivationReport` here
- [Source: convex/auditLogs.ts:43-122] — `appendAuditEntry` (sole registered writer, AD-6) + `appendAuditEntryInTransaction` for `recordRederivation`; the `run.rederived` eventType is a free-form `v.string()` (schema.ts:24), no schema change
- [Source: convex/authGuard.test.ts:70-82, 211-246] — `publicFunctionArgs` + the run-id-seeding branch to add `runs:rederiveRun` to (AC7); [convex/runs.test.ts:1-55] — `initConvexTest`/`registerWorkflow`, `ACCEPTED_TRIANGLE`/`TRIANGLE_HASH` fixtures, analyst identities — the harness to extend for the re-derive suite
- [Source: convex/schema.ts:98-138] — the `runs` table (note: `rederiveRun` adds **no** field here; the audit log is the record); the existing `triangleHash` denormalization + `resultSet` optional the query reads
- [Source: components/RunDetail.tsx:68-230] — where the "Re-derive" button + outcome panel attach (the `onRetry` prop/button at 160-178 is the wiring template; button gated on `run.status === "complete"`); [app/(app)/runs/[runId]/page.tsx:49-98] — `useMutation(retryRun)` → `useAction(rederiveRun)` wiring template + `errorMessage` reuse
- [Source: components/ProvenancePopover.tsx, components/CopyableHash.tsx, lib/formatNumber.ts] — Lineage-display + copyable-hash idioms and the display-only formatters for the outcome panel (provenance-violet only on chrome, DESIGN.md:89; no arithmetic, AC5)
- [Source: tests/engine-contract.test.ts:1-40] — the AD-10 Link-2 drift harness (`readSchema`, `jsonSchemaToCanonical`/`validatorToCanonical`/`diffCanonical`) to extend with the `ReDerivationReport` assertion; [tests/run-detail.test.tsx] — the jsdom harness for the button/panel specs
- [Source: _bmad-output/project-context.md] — AD-1 no arithmetic outside `reserving_engine` (deltas in the engine); requireMember-first; vocabulary (`ResultSet`, `Lineage`, `Run`, `Triangle` — never synonyms); "❌ Storing an unvalidated Triangle or a schema-invalid ResultSet"; two-hash rule (canonical-triangle-JSON sha256 is the re-derivation hash)
- [Source: _bmad-output/implementation-artifacts/4-2-durable-run-orchestration-and-resultset-persistence.md] — the durable orchestration + `storeResultSet` chain-of-custody the re-derivation mirrors (read for the engine-boundary + audit conventions); [_bmad-output/implementation-artifacts/deferred-work.md:51] — the pre-existing `storageId`-delete gap that could break re-derivation-from-source (context; not this story's fix)

## Dev Agent Record

### Agent Model Used

Amelia (dev agent) — claude-opus-4-8[1m].

### Debug Log References

All gates green on completion:
- `cd engine && uv run pytest` → **219 passed, 9 skipped** (+14 over 4.6's 205: 4 new `test_rederivation` cases + 4 `test_engine_service` `/rederive` cases + 4 auth-parametrize expansions across the 4 auth tests + 2 schema-contract cases auto-added by the new `_TARGETS` entry).
- `npm test` → **300 passed** (24 files; +13 over 4.6's 287: 6 new `runs.test` re-derive specs + 6 new `run-detail.test` UI specs + 1 new `engine-contract` drift assertion; the auth-guard enumeration now also covers `runs:rederiveRun`).
- `npx tsc --noEmit` (root) → clean; `npx tsc -p convex/tsconfig.json --noEmit` → clean.
- `npm run lint` → clean.
- `npm run build` → success; `/runs/[runId]` recompiled.
- `npx convex codegen` → ran (one new public function `runs:rederiveRun`).

Two first-run adjustments during authoring (both mechanical, not logic bugs):
1. `export_schema.py` run as `python scripts/export_schema.py` raised `ModuleNotFoundError` (package not on path); the committed invocation is `uv run python -m scripts.export_schema` (matching the docstring's pytest-import style). Used the `-m` form.
2. My appended convex-test helper `seedRun` collided with an existing `seedRun` in `runs.test.ts` (SyntaxError: already declared) — renamed the new one to `seedRederivableRun`.

### Completion Notes List

- **AC1 (re-derive → exact match / discrepancy report):** `rederiveRun` re-executes `run_methods` with the run's stored `acceptedTriangle` and the parameters read from `resultSet.lineage.parameters` (re-derived *from Lineage*), and the engine returns a fully-computed `ReDerivationReport` (reproduced / tier / discrepancies). The run row is never mutated — verified by a convex-test asserting `status === "complete"` and the stored `resultSet` unchanged after re-derivation (immutability).
- **AC2 (canonical-hash chain of custody):** the engine recomputes `triangle_hash(triangle)` vs `lineage.triangleHash` and short-circuits to `triangleHashVerified=false` (no re-run) on mismatch — a distinct outcome surfaced as a chain-of-custody warning in the UI. Convex adds a belt-and-braces `resultSet.lineage.triangleHash === run.triangleHash` check (`RESULT_HASH_MISMATCH`) before dispatch, covered by a convex-test that asserts no fetch happens.
- **AC3 (tampered ResultSet detected):** pytest (`test_rederivation` + `test_engine_service`) mutates one stored `ultimate` and asserts exactly one `Discrepancy` with the correct method/field/key and a `+delta`; the engine_service test drives the same through `/rederive`. The UI test renders the discrepancy table + signed delta.
- **AC4 (audit-logged):** `recordRederivation` appends one `run.rederived` entry via `appendAuditEntryInTransaction` (the sole AD-6 writer) with a lean payload `{ runId, reproduced, triangleHashVerified, tier, discrepancyCount }` — no reserve figures. convex-tests assert the entry for both reproduced and discrepancy outcomes, and assert **no** audit entry when the engine is never reached (non-complete run, hash mismatch, unauthenticated).
- **AC5 (arithmetic only in `reserving_engine`, AD-1):** every `delta = stored − rederived` is computed in `rederivation.py`; the Convex action and `RederivationPanel`/`RunDetail` only carry and `format*()` the report. No subtraction in TS/React.
- **AC6 (AD-10 drift-checked contract):** `ReDerivationReport` is a Pydantic model with `schemaVersion`, exported to `schemas/rederivation-report.schema.json` (via `_TARGETS`); a matching `reDerivationReportValidator` + `ReDerivationReport` type live in `engineContract.ts`; both drift links stay green (`test_schema_contract` byte-equality Link 1; `engine-contract.test.ts` validator⇔schema Link 2, incl. the `tier` string-literal-union → enum).
- **AC7 (guarded public function):** `rederiveRun` is a public **action** whose first statement is `requireMember` (runs before the engine fetch); tenancy re-checked inside `getRunForRederive` (same `RUN_NOT_FOUND` for wrong-workspace/absent — no leak). Added to `authGuard.test.ts`'s `publicFunctionArgs` + run-id-seeding branch; the enumeration + append-only guardrails are green and unmodified in substance.
- **AC8 (gates):** all green (see Debug Log).
- **Guard decision (flagged in the story):** shipped with `requireMember` (read-only reproducibility proof), not `requireRole(senior_actuary)`. Recorded in `deferred-work.md` §4.7 as a one-line change if the product wants it gated to seniors.
- **Reuse/scope discipline:** re-run via existing `run_methods`; hash via existing `triangle_hash`; engine call via generic `callEngine`; audit via existing `appendAuditEntryInTransaction`; formatters via existing `lib/formatNumber`. Tolerance semantics single-sourced in `rederivation.py` (the test imports them back). No `runs` schema change, no new table, no engine method change, no new dependency. Diagnostics re-derivation and the "last verified" badge are deferred (§4.7).

### File List

**New:**
- `engine/reserving_engine/rederivation.py` (pure core: `Discrepancy`, `ReDerivationReport`, `rederive`, tolerance semantics)
- `schemas/rederivation-report.schema.json` (generated)
- `components/RederivationPanel.tsx` (the outcome panel — reproduced / discrepancy table / chain-of-custody warning)

**Edited (engine):**
- `engine/reserving_engine/__init__.py` (export `Discrepancy`, `ReDerivationReport`, `rederive`)
- `engine/engine_service/models.py` (`ReDeriveRequest`)
- `engine/engine_service/app.py` (`POST /rederive`)
- `engine/scripts/export_schema.py` (`ReDerivationReport` → `_TARGETS`)
- `engine/tests/test_rederivation.py` (import tolerance from product module; +4 `rederive` cases)
- `engine/tests/test_engine_service.py` (`/rederive` auth parametrize + `TestRederive` happy/tamper/hash/empty-runId)

**Edited (Convex):**
- `convex/runs.ts` (`getRunForRederive` internalQuery, `rederiveRun` public action, `recordRederivation` internalMutation; `action` import; `ReDerivationReport` type import)
- `convex/lib/engineContract.ts` (`discrepancyValidator`, `reDerivationReportValidator`, `Discrepancy`/`ReDerivationReport` types)
- `convex/authGuard.test.ts` (`runs:rederiveRun` fixture entry + seeding branch)
- `convex/runs.test.ts` (re-derive suite: `makeRederivationReport`, `seedRederivableRun`, 6 specs)
- `convex/_generated/*` (codegen)
- `tests/engine-contract.test.ts` (`ReDerivationReport` drift assertion)

**Edited (frontend):**
- `components/RunDetail.tsx` (`onRederive` prop, Re-derive button, outcome state, `RederivationPanel` render)
- `app/(app)/runs/[runId]/page.tsx` (`useAction(api.runs.rederiveRun)` → `onRederive`)
- `tests/run-detail.test.tsx` (`waitFor` import; 6 re-derive UI specs)

**Edited (docs):**
- `_bmad-output/implementation-artifacts/deferred-work.md` (§4.7)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (4.7 → in-progress → review)

## Change Log

| Date       | Version | Description                                                                 |
| ---------- | ------- | --------------------------------------------------------------------------- |
| 2026-07-19 | 0.1     | Story 4.7 drafted: full-stack ResultSet re-derivation from Lineage (FR-6, NFR-6, AD-11). Engine `rederivation.py` (pure compare + `ReDerivationReport`), `/rederive` endpoint, `rederiveRun` Convex action (requireMember, audit-logged, no run-row mutation), Run-detail trigger + outcome panel. Comparison arithmetic lives in `reserving_engine` (AD-1). Status → ready-for-dev. |
| 2026-07-19 | 1.0     | Story 4.7 implemented: `reserving_engine.rederivation` (`rederive` + `ReDerivationReport`/`Discrepancy`, AD-11 exact/epsilon tiers single-sourced and imported back by the test); `engine_service` `POST /rederive`; `ReDerivationReport` joined the AD-10 drift chain (`schemas/rederivation-report.schema.json`, both links green); Convex `getRunForRederive`/`rederiveRun`/`recordRederivation` (requireMember-first action, chain-of-custody guard, lean `run.rederived` audit, immutable — no run-row patch); Run-detail "Re-derive" button + `RederivationPanel` (reproduced / discrepancy table / chain-of-custody warning, display-only). Two failure modes kept distinct (`triangleHashVerified`). All gates green (pytest 219/9; npm test 300; tsc root+convex; lint; build; codegen). Status → review. |
