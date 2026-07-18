---
baseline_commit: e90d439
---

# Story 3.2: Upload Wizard Validation with Flagged Grid Preview

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an Analyst,
I want validation findings shown per cell on a grid preview with named progress stages,
so that I can fix the source file precisely and re-upload clean. (FR-2, UX-DR5, UX-DR8)

## Acceptance Criteria

**AC1 — Named-stage progress, never a bare spinner (UX-DR8)**
Given an uploaded file (a `triangles` doc from Story 3.1, `status: pending_validation`),
When the wizard's Validation step runs (Convex **action** → `engine_service` `POST /validate`),
Then inline progress shows **named stages** ("Parsing… Validating shape… Checking monotonicity…") — never a bare spinner — and the step never auto-advances (the user confirms the transition).

**AC2 — Flagged grid preview + findings list with click-to-cell (UX-DR5)**
Given the validation returns findings,
When the result renders,
Then the read-only Triangle grid preview renders in `numeric` type, **right-aligned**, with flagged cells in the caution (amber) treatment, **and** a findings list beneath giving Origin/Development coordinates and the reason for each finding; **clicking a finding scrolls to and highlights the corresponding cell**. Meaning is never encoded in color alone (each flagged cell also carries the coordinate in the findings list; the grid exposes proper table semantics with announced row/column headers).

**AC3 — Validation failure: fix-and-re-upload, unaccepted, audited (FR-2, PRD §6.2)**
Given validation failures,
When findings render,
Then the primary action is **"Fix source and re-upload"** — no in-app repair exists — the Triangle stays **unaccepted and unreferencable by any Run**, and the validation result is **audit-logged** (`appendAuditEntry`, AD-6). Monotonicity findings appear for **paid** triangles only.

**AC4 — Clean pass advances to Periods (UX-DR8)**
Given a triangle that passes validation (`valid: true`, zero findings),
When the result renders,
Then it shows **"0 issues"** with the content hash (the raw-file sha256 recorded in 3.1) and offers advancing to the **Periods** step. (The Periods step content — detection, confirmation, acceptance, immutability, and the canonical-triangle-JSON Lineage hash — is **Story 3.3**; 3.2 renders a minimal placeholder for step 3 and wires the "proceed" affordance.)

**AC5 — Cross-runtime contract + guard + tenancy tests (AD-10, FR-18, NFR-3)**
The `Triangle` (request) and `ValidationReport` (response) wire shapes are added to the AD-10 drift-checked contract (both now cross the Convex↔engine boundary). convex-test covers the `validateTriangle` action: guard enforcement (unauthenticated rejection), cross-Workspace invisibility (a member of Workspace A cannot validate Workspace B's Triangle), engine-error-envelope mapping, and the parse/findings/clean-pass paths (engine `fetch` stubbed — no live engine in tests).

## Scope Boundary (read first)

This story delivers **the 3-step upload wizard shell + the File and Validation steps**: parse the stored raw file into a Triangle grid, call `engine_service /validate`, and render the flagged grid preview + findings with named-stage progress. Nothing more.

**In scope:**
- The `UploadWizard` component (File → Validation → Periods shell) replacing 3.1's minimal upload control on `app/(app)/triangles/page.tsx`.
- Parsing the stored CSV/XLSX bytes into the engine `Triangle` JSON (grid extraction) — in a Convex action.
- The **first** Convex→engine_service HTTP call: a reusable engine client + env wiring.
- The reusable `TriangleGrid` component (UX-DR5).
- Widening the `triangles.status` union with `validation_failed`; audit-logging the validation result.

**Explicitly OUT of scope (do NOT build — later stories own them):**
- **Period detection / confirmation / editing, Triangle acceptance, immutability, and the canonical-triangle-JSON Lineage hash** → **Story 3.3**. Step 3 (Periods) is a **stub** here: a placeholder panel that acknowledges the clean pass. Do **not** compute or store a canonical/Lineage hash, and do **not** set a `validated`/accepted status.
- **The ambiguous-orientation guided prompt** (undetectable layout) → **Story 3.3**. 3.2 parses with a **fixed canonical layout assumption** (see Dev Notes → "Grid parse contract").
- **Latest-Diagonal edge-marking as a user-facing feature** is primarily the accepted-Triangle detail view (Story 3.3). The `TriangleGrid` component built here must **support** rendering it (a prop), but 3.2's preview does not require it lit up.
- **Enter-opens-cell-in-context-rail** (UX-DR5) — no context rail exists on this surface (that pattern lands in Epic 4 Diagnostics). 3.2 implements arrow-key grid navigation + focusable cells + the findings-click→scroll/highlight behavior; a full context rail is out of scope.

## Tasks / Subtasks

- [x] **Task 1 — Engine `Triangle` + `ValidationReport` join the AD-10 drift-checked contract (AC: 5)**
  - [x] `engine/scripts/export_schema.py` → added `Triangle` and `ValidationReport` to `_TARGETS`. Emitted via `uv run python -m scripts.export_schema` (the `-m` form — `python scripts/…` fails the `reserving_engine` import since `package = false`).
  - [x] `engine/tests/test_schema_contract.py` → byte-compare (Link 1) auto-covers the two new files via `build_schemas()`; guarded `test_committed_schema_is_versioned_json` to only assert `schemaVersion` where the field exists (Triangle/ValidationReport carry none).
  - [x] `convex/lib/engineContract.ts` → added `triangleValidator` + `validationReportValidator` (+ types). **Correction:** Triangle wire keys are **snake_case** (`origin_periods`/`development_periods`), not camelCase — the engine `Triangle` model has no alias generator (verified: `/validate` accepts snake, rejects camel). `cells` = `v.array(v.array(v.union(v.number(), v.null())))`; `code` is the 4-value union.
  - [x] `tests/engine-contract.test.ts` → added two drift-check cases diffing the new validators against the committed schemas.
  - [x] Verified: `uv run pytest tests/test_schema_contract.py` (8 passed) and `npx vitest run tests/engine-contract.test.ts` (12 passed). The existing deliberate-mismatch test proves the checker catches drift.

- [x] **Task 2 — Triangle grid-parse helper (pure) (AC: 1, 2)**
  - [x] `convex/lib/triangleParse.ts` (new, pure module). `parseTriangleGrid(bytes, format, kind): Triangle` — returns the **snake_case** wire shape (`origin_periods`/`development_periods`), matching the engine model + Task 1 validator.
  - [x] Fixed layout contract: row 0 header (corner + dev labels), col 0 origin labels, full rectangle with short rows null-padded to `nDev`; a row longer than the header is a `MALFORMED_TRIANGLE` reject (does not guess).
  - [x] Cell coercion: blank/whitespace → `null`; numeric (number or string, with trivial `$`/thousands-comma stripping) → number; non-numeric / non-finite → `UNPARSEABLE_CELL` naming the cell.
  - [x] CSV via fatal `TextDecoder` **dual-guard** (throw OR `undefined` → `UNREADABLE_CSV`), then SheetJS `XLSX.read(text, {type:"string"})` for robust quoting (chose SheetJS over a hand-rolled splitter — handles embedded commas like `"1,234"`). XLSX via `XLSX.read(view, {type:"array"})`. Both share `sheet_to_json({header:1, raw:true, defval:null, blankrows:false})`.
  - [x] Structural rejects (`MALFORMED_TRIANGLE`): <2 rows, no dev columns, empty/duplicate origin or dev labels, missing origin label, over-wide row.
  - [x] `convex/lib/triangleParse.test.ts` (11 tests, convex/edge-runtime project). Covers all above incl. the UTF-8 dual-guard (throw path; the `undefined` path is pinned by comment, unreachable in-harness).

- [x] **Task 3 — Reusable engine_service client + env wiring (AC: 1, 3, 5)**
  - [x] `convex/lib/engineClient.ts` (new). `callEngine<T>(path, body)` reads `ENGINE_SERVICE_URL`/`ENGINE_SERVICE_SECRET` (→ `ENGINE_UNCONFIGURED` if unset, never logs the secret), POSTs JSON with the `Bearer` header.
  - [x] Response handling: `res.ok` → parsed JSON; non-2xx envelope `{code,message,details?}` → `ConvexError("engine.<code>")`; non-envelope / network failure → `ENGINE_UNAVAILABLE`. Generic (no `/validate` specifics) for Epic 4 `/runs` reuse.
  - [x] Env: added `ENGINE_SERVICE_URL` (+ secret-mirroring note) to the root `.env.example`, documenting both are Convex deployment env vars set via `npx convex env set`.

- [x] **Task 4 — `validateTriangle` Convex action + status/audit (AC: 1, 3, 4, 5)**
  - [x] `convex/schema.ts` → widened `triangles.status` to `pending_validation | validation_failed` (not `validated` — 3.3 owns that).
  - [x] `convex/triangles.ts` → `getForValidation` internalQuery (returns `{workspaceId, storageId, label, format, rawFileHash}` or null), `markValidationFailed` internalMutation.
  - [x] `convex/triangles.ts` → `validateTriangle` public action: `requireMember` → tenancy re-check (`t.workspaceId === workspaceId` else `TRIANGLE_NOT_FOUND`) → read bytes (`UPLOAD_NOT_FOUND` if gone) → `parseTriangleGrid` (parse error propagates, no engine call) → `callEngine("/validate", {triangle})` → audit `triangle.validated` (via `appendAuditEntry`, never inlined) → `markValidationFailed` if invalid → return `{triangle, report}` (transient grid, not persisted).
  - [x] Registered `triangles:validateTriangle` in `convex/authGuard.test.ts` with an injected real triangle id (seeded row) — enumeration + unauthenticated-rejection green.

- [x] **Task 5 — `TriangleGrid` component (UX-DR5) (AC: 2)**
  - [x] `components/TriangleGrid.tsx` (new, `"use client"`, reusable). Props as specified (`flaggedCells`, `highlightedCell`, `showLatestDiagonal`, `onCellFocus`; cell key `${origin}|${dev}` via exported `cellKey`).
  - [x] Real `<table>` semantics (column/row headers), `numeric` right-aligned mono cells, `p-cell-pad`, hairline borders, square corners, empty null cells; per-cell accessible name ("Origin … development … value …" / "no value").
  - [x] Flagged cells `bg-caution-subtle text-caution` + a ⚠ glyph (not color-only); highlighted cell rings + `scrollIntoView` + focus; Latest-Diagonal `border-l-2 border-l-primary` on the last observed cell per row (prop-gated); roving-tabindex arrow-key nav, `Enter` → `onCellFocus`.
  - [x] `tests/triangle-grid.test.tsx` (5 jsdom tests): headers, accessible names, flagged treatment + glyph, click callback, latest-diagonal.

- [x] **Task 6 — `UploadWizard` (File → Validation → Periods) (AC: 1, 2, 3, 4)**
  - [x] `components/UploadWizard.tsx` (new, `"use client"`). Owns `step` state; local hand-built step indicator (not `StatusBadge`/`StepRail`); workspaceId passed in from `useAuth().orgId`. Steps never auto-advance to Periods — clean pass requires the "Continue to periods" click.
  - [x] File step: lifted 3.1's `generateUploadUrl → fetch → createFromUpload` flow verbatim incl. duplicate surfacing (`#triangle-{id}` link) and verbatim `ConvexError.data.message` on parse/format failure. On `created` → Validation step + run validation.
  - [x] Validation step: `validateTriangle` run from the event (not an effect — avoids `react-hooks/set-state-in-effect`); named-stage progress ("Parsing… Validating shape… Checking monotonicity…") choreographed over the pending call, `aria-live="polite"`, never a bare spinner.
    - [x] Findings → `TriangleGrid` with `flaggedCells` from findings + findings list ("Validation found N issues in M columns."); click a finding → `highlightedCell`; primary "Fix source and re-upload" resets to File.
    - [x] Clean pass → "0 issues." + content hash (`rawFileHash`, returned by the action) + "Continue to periods".
    - [x] Errors → verbatim `.data.message`; engine-availability codes (`engine.*`/`ENGINE_*`) get an "engine unavailable" panel with Retry.
  - [x] Periods step: Story 3.3 stub panel.
  - [x] `app/(app)/triangles/page.tsx`: replaced the minimal upload control with `<UploadWizard workspaceId={orgId} />`; kept the library list + `TriangleStatusIndicator`.
  - [x] `components/TriangleStatusIndicator.tsx`: widened with `validation_failed` (destructive family); `pending_validation` stays caution.
  - [x] **Deviation:** kept the existing inline-Tailwind button idiom (matches 3.1 / `page.tsx`) instead of pulling `shadcn add button card` — the repo has no shadcn button yet; introducing it would be less consistent than the established inline pattern. Flagged in Completion Notes.

- [x] **Task 7 — Tests (AC: 1, 2, 3, 4, 5)**
  - [x] `convex/triangles.test.ts` extended (7 new tests, engine `fetch` stubbed via `vi.stubGlobal`, env via `vi.stubEnv`): clean pass (status stays `pending_validation`, audit `valid:true`), findings (status `validation_failed`, audit `valid:false` + `findingCodes`), request-shape assertion (**snake_case** `origin_periods` body + `Bearer` header), engine envelope → `engine.bad_request`, non-envelope 5xx → `ENGINE_UNAVAILABLE`, parse error (no fetch, no audit), guards + tenancy (`TRIANGLE_NOT_FOUND`).
  - [x] `convex/authGuard.test.ts`: `triangles:validateTriangle` registered (real injected id).
  - [x] `convex/lib/triangleParse.test.ts` (11) and `tests/triangle-grid.test.tsx` (5).
  - [x] `tests/engine-contract.test.ts` + `engine/tests/test_schema_contract.py` (Task 1).
  - [x] Full gates green: `npm test` **163 passed / 15 files**; root `tsc --noEmit` + `tsc -p convex/tsconfig.json` clean; `npm run lint` clean; `npm run build` compiles `/triangles`; `uv run pytest` **198 passed, 9 skipped**. (Playwright smoke not extended — kept to the single existing smoke.)

## Dev Notes

### The critical architecture fact — `engine_service /validate` takes parsed JSON, not a file

**`engine_service` never parses files.** `POST /validate` accepts a fully-parsed `Triangle` JSON body `{ triangle: { kind, originPeriods, developmentPeriods, cells } }` and returns a `ValidationReport`. Therefore **the Convex action must parse the stored CSV/XLSX bytes into the Triangle grid before calling `/validate`** (Task 2). Story 3.1's dev note speculating that "Python/pandas does the grid parse for validation" was an incorrect assumption about a not-yet-built contract — the built `/validate` (Story 2.5) is JSON-in. Do not add a file-upload endpoint to `engine_service`; the epic AC fixes the flow as "Convex action → engine_service `/validate`".

- **Dependency direction (AD-2/AD-12):** frontend → Convex → engine_service → reserving_engine. The browser **never** calls `engine_service`; only the Convex action does, over the shared bearer secret. This is the **first** such call in the codebase — the client (`engineClient.ts`) and env wiring are net-new (Task 3), built generic for Epic 4's `/runs` reuse.
- **No arithmetic on reserve figures (AD-1):** grid parsing is reshaping/coercion, not computation — it is allowed in Convex. Do not compute, sum, or adjust any cell value; pass them through as parsed.

### Grid parse contract (the fixed 3.2 layout assumption)

3.2 assumes the **canonical triangle layout**: first row = header (corner cell + development-age labels), first column = origin-period labels, body = cumulative values, blanks = unobserved. Rows are origins as they appear (oldest-first by convention); columns are development ages earliest-first. This is deliberately a **fixed assumption**, not detection — **orientation/period detection, the ambiguous-layout guided prompt, and user confirmation/override are Story 3.3**. 3.2 needs *a* grid to validate and preview; 3.3 layers detection/confirmation on top of the same parse. If the fixed assumption produces a malformed grid (ragged, duplicate labels, non-numeric cells), 3.2 surfaces a precise parse error → "Fix source and re-upload"; it does not guess.

- `kind` comes from the triangle's `label` (paid/incurred) recorded in 3.1 — **not** re-derived. `paid_monotonicity` findings only arise for `kind === "paid"` (the engine enforces this; matches AC3).
- The engine `Triangle` model rejects ragged rows, empty/duplicate labels, and NaN/Infinity with `422 bad_request`. Catch these in the parser for a better message, but the engine is the backstop.

### The CSV `TextDecoder` V8 divergence — do not regress it

A fatal `TextDecoder("utf-8", { fatal: true })` **throws** on invalid UTF-8 in the vitest/edge runtime but **returns `undefined`** in the Convex V8 action runtime (memory: [[convex-textdecoder-fatal-divergence]]; fixed live in 3.1). The parser must treat **both** a throw and a falsy/`undefined` decode result as invalid UTF-8. convex-test cannot reproduce the `undefined` path (it throws), so pin the guard with a comment. This bit 3.1 during manual testing — do not "simplify" it away.

### Constitution & layering recap (project-context.md, AD-1/2/3/4/6/10/12)

- **AD-4:** every public Convex function's first statement is `requireMember(ctx, workspaceId)` (from `convex/lib/guards.ts`, returns `{ identity, role }`; actor = `identity.subject`). 3.2 is Analyst-level — no `requireRole`. **Also re-check tenancy** on the fetched triangle (`t.workspaceId === workspaceId`): `requireMember` proves the caller belongs to `workspaceId`, but the `triangleId` arg is attacker-controllable, so verify the row actually belongs to that Workspace.
- **AD-6:** `auditLogs` has exactly one writer, `appendAuditEntry`, reached only via `ctx.runMutation(internal.auditLogs.appendAuditEntry, …)` from the action. Never inline an insert. (An action can `runMutation`/`runQuery`; a mutation cannot `runMutation` — that's why validation is an action, same as 3.1's `createFromUpload`.)
- **AD-3:** Convex is the sole system of record. The parsed grid returned to the client is **transient/re-derivable** (re-run `validateTriangle`, it's idempotent) — do not persist it; 3.3 persists the canonical form at acceptance.
- **AD-10:** ResultSet/DiagnosticsBundle/**now Triangle + ValidationReport** are single-sourced from the Pydantic models; the drift check (Task 1) makes hand-authored Convex validators safe. `schemas/*.json` are **generated** — run `export_schema.py`, never hand-edit.

### Two hashes — 3.2 shows only the raw-file hash

The "content hash" shown on clean pass (AC4) is the **raw-file sha256** (`rawFileHash`, recorded in 3.1) — the byte-for-byte dedupe hash. The **canonical-triangle-JSON sha256** (the Lineage/Triangle hash used for re-derivation) is a **different hash computed at acceptance in Story 3.3**. Do not compute or store it here; do not name anything `triangleHash`/`lineageHash` in 3.2.

### Status model & the indicator (project-context.md "Status display")

- Widen `triangles.status` to `pending_validation | validation_failed` (3.3 adds `validated`). Clean pass **stays** `pending_validation` (the triangle is pending the user's period confirmation) — honest, and avoids overloading status with a transient wizard state.
- `components/TriangleStatusIndicator.tsx` is the **local** Triangle status indicator (deliberately separate from the fixed `StatusBadge` vocabulary — do **not** add Triangle statuses to `StatusBadge`). Widen its map: `pending_validation` → caution amber (existing), `validation_failed` → destructive family. Its own comment invites this ("3.2/3.3 widen the Triangle status set").

### UX specifics (UX-DR5, UX-DR8, DESIGN.md, EXPERIENCE.md)

- **Never a bare spinner** — named stages ("Parsing… Validating shape… Checking monotonicity…"), `aria-live="polite"`. **Steps never auto-advance** (banned pattern) — the user confirms each transition.
- **Findings list beneath the grid**, cell coordinates + reason; click a finding → scroll to + highlight the cell. **Meaning never in color alone** (icon + coordinate always accompany the amber cell).
- Flagged cell tokens: `bg-caution-subtle text-caution` ("the system needs your judgment," not danger). Hard failures (rejected upload, `validation_failed`) use the **destructive** family. Grid cells are **square-cornered**, `numeric` (Geist Mono), **right-aligned**, `p-cell-pad`.
- Wizard is a **flow surface** (single column, `max-w-4xl`, generous whitespace per DESIGN.md); the embedded grid preview is a data element within it. The Triangles page keeps its `max-w-screen-2xl` library list.
- WCAG 2.2 AA: table semantics with announced row/column headers ("Origin 2021, Development 24 months, value 4,213,000"); arrow-key cell navigation; a complete keyboard path (no drag-only / hover-only).
- Copy tone (EXPERIENCE.md): "Validation found 3 issues in 2 columns." — precise, unit/period-carrying, never "Oops 😕".

### Existing patterns to reuse (do not reinvent)

- **Upload control:** lift 3.1's `generateUploadUrl → fetch → createFromUpload` flow and its duplicate/parse-error handling out of `app/(app)/triangles/page.tsx` into the wizard's File step **verbatim** (including `useAuth().orgId`, the `#triangle-{id}` anchor link, and the `.data.message` verbatim rendering). Don't re-derive it.
- **Action → internal query/mutation composition:** `createFromUpload → insertIfNew`/`appendAuditEntry` (3.1) is the template for `validateTriangle → getForValidation`/`markValidationFailed`/`appendAuditEntry`.
- **Contract file + drift check:** `convex/lib/engineContract.ts` + `tests/engine-contract.test.ts` + `engine/scripts/export_schema.py` + `engine/tests/test_schema_contract.py` — extend all four in lockstep (Task 1). Read the top-of-file wire-discipline comment in `engineContract.ts`.
- **Guard tests:** `convex/authGuard.test.ts` (enumeration — register the new public function) and `convex/triangles.test.ts` (per-function convex-test with `t.withIdentity`, cross-Workspace assertions, `ctx.storage.store` seeding).
- **Status indicator:** `components/TriangleStatusIndicator.tsx` (widen, don't replace); token pairs from `app/globals.css` (`bg-caution-subtle`, `text-caution`, `bg-destructive/10`, `numeric`, `p-cell-pad`).

### Project Structure Notes

- **New:** `convex/lib/triangleParse.ts` (+ `.test.ts`), `convex/lib/engineClient.ts`, `components/TriangleGrid.tsx`, `components/UploadWizard.tsx`, `schemas/triangle.schema.json`, `schemas/validation-report.schema.json` (generated), `components/ui/button.tsx` + `components/ui/card.tsx` (via `npx shadcn add`).
- **Edit:** `convex/schema.ts` (status union), `convex/triangles.ts` (action + internal query/mutation), `convex/lib/engineContract.ts` (Triangle + ValidationReport validators), `convex/authGuard.test.ts`, `convex/triangles.test.ts`, `components/TriangleStatusIndicator.tsx`, `app/(app)/triangles/page.tsx` (mount wizard), `engine/scripts/export_schema.py`, `engine/tests/test_schema_contract.py`, `tests/engine-contract.test.ts`, root `.env.example`.
- **Regen:** `npx convex codegen` after adding `validateTriangle`/internal functions (updates `convex/_generated/api.d.ts`). `xlsx` (SheetJS) already a dependency (3.1) — no new npm dep for parsing. `crypto.subtle`/`TextDecoder`/`fetch` are available in the Convex default (V8) action runtime — **no `"use node"` directive**, so the action keeps `ctx.runMutation`/`ctx.runQuery` alongside `fetch`.
- **No `reserving_engine`/`engine_service` behavior changes** — the only engine touch is adding two models to the schema export (Task 1). `/validate` already exists (Story 2.5) and is unchanged.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.2] — story statement + ACs (lines 393–410)
- [Source: _bmad-output/planning-artifacts/epics.md] — FR2 (line 24), UX-DR5 (line 84), UX-DR8 (line 87)
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-agentic-reserving-2026-07-16/DESIGN.md] — triangle-cell-flagged (67–69), grid spec (129), caution semantics (90), flow vs data surface (107–108)
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-agentic-reserving-2026-07-16/EXPERIENCE.md] — wizard states (81–83), grid behavior (68), a11y (104–113), Flow 1 walkthrough (127–133)
- [Source: _bmad-output/implementation-artifacts/3-1-triangle-upload-with-duplicate-detection.md] — upload flow, duplicate handling, TextDecoder V8 divergence, SheetJS dependency, status-indicator convention
- [Source: _bmad-output/implementation-artifacts/2-5-engine-service-fastapi-shell-with-service-auth.md] — service auth (Bearer, `ENGINE_SERVICE_SECRET`), error envelope
- [Source: engine/engine_service/app.py] — `POST /validate` route (36–39); [engine/engine_service/models.py] — `ValidateRequest` (16–22); [engine/engine_service/errors.py] — `ErrorEnvelope`, handler mapping
- [Source: engine/reserving_engine/validation.py] — `ValidationReport`/`ValidationFinding`, `FindingCode` (4 codes), `validate_triangle` semantics
- [Source: engine/reserving_engine/triangle.py] — `Triangle` wire shape (kind/originPeriods/developmentPeriods/cells)
- [Source: convex/lib/engineContract.ts] — validator wire discipline (camelCase, `v.union(T, v.null())`); [engine/scripts/export_schema.py], [tests/engine-contract.test.ts], [engine/tests/test_schema_contract.py] — the AD-10 two-link drift chain
- [Source: convex/triangles.ts] — 3.1 action/mutation/query patterns; [convex/lib/guards.ts] — `requireMember`; [convex/auditLogs.ts] — `appendAuditEntry` single-writer
- [Source: _bmad-output/project-context.md] — Constitution, layering, auth, audit, two-hash, vocabulary rules
- [Source: _bmad-output/planning-artifacts/architecture/architecture-agentic-reserving-2026-07-16/ARCHITECTURE-SPINE.md] — AD-1/2/3/4/6/10/12; Capability map FR-1..3 (line 191); OQ-6 incurred-monotonicity deferral (207)

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Claude Code, bmad-dev-story workflow)

### Debug Log References

- `uv run python -m scripts.export_schema` (engine cwd) — emitted `schemas/triangle.schema.json` + `schemas/validation-report.schema.json`. The `-m` form is required; `python scripts/export_schema.py` fails the `reserving_engine` import (`package = false`).
- `npx convex codegen` — regenerated `convex/_generated/api.d.ts` for `internal.triangles.getForValidation`/`markValidationFailed` and `api.triangles.validateTriangle`.
- Full gates: `npm test` → 163 passed (15 files); `npx tsc --noEmit` + `npx tsc -p convex/tsconfig.json --noEmit` clean; `npm run lint` clean; `npm run build` compiles `/triangles`; `cd engine && uv run pytest` → 198 passed, 9 skipped.

### Completion Notes List

- **Corrected a load-bearing story assumption: the `/validate` Triangle body is snake_case, not camelCase.** The engine `Triangle` model uses `ConfigDict(frozen=True)` with no `alias_generator` (unlike ResultSet/DiagnosticsBundle), so its JSON Schema and the wire `/validate` accepts are `origin_periods`/`development_periods`. Verified empirically (snake parses, camel 422s). Implemented snake_case throughout (`triangleParse.ts`, `triangleValidator`, the drift check) and left the engine untouched per the story's "no engine behavior changes" boundary. The camelCase inconsistency vs the rest of the AD-10 contract is logged in deferred-work for a future consistency pass (matters for Epic 4 `/runs`, which also sends Triangle).
- **First Convex→engine_service call in the codebase.** New reusable `convex/lib/engineClient.ts` (`callEngine`) reads `ENGINE_SERVICE_URL`/`ENGINE_SERVICE_SECRET`, sends the `Bearer` header, and maps the `{code,message,details?}` envelope → `ConvexError("engine.<code>")` (non-envelope/network → `ENGINE_UNAVAILABLE`, unset config → `ENGINE_UNCONFIGURED`). Kept generic for Epic 4 `/runs` reuse. Both env vars documented in the root `.env.example` as `npx convex env set` deployment vars (secret mirrors the engine Cloud Run value).
- **Parse layer chose SheetJS for CSV too.** `triangleParse.ts` decodes CSV via the fatal-`TextDecoder` dual-guard (throw OR `undefined` → `UNREADABLE_CSV`, the V8 divergence from 3.1) then hands the text to `XLSX.read(text, {type:"string"})` — robust quoting (`"1,234"`) without a hand-rolled splitter. Non-numeric/non-finite cells → `UNPARSEABLE_CELL`; structural problems → `MALFORMED_TRIANGLE`. The engine `Triangle` model is the backstop for anything that slips through.
- **AD-6 honored:** the sole `auditLogs` write (`triangle.validated`, payload `{triangleId, valid, findingCount, findingCodes}`) goes through `internal.auditLogs.appendAuditEntry`. **Tenancy:** the action re-checks `t.workspaceId === workspaceId` after `requireMember` (the `triangleId` arg is attacker-controllable) → `TRIANGLE_NOT_FOUND`. **AD-3:** the parsed grid is returned to the client (transient/re-derivable), never persisted; 3.3 persists the canonical form at acceptance.
- **Status model:** widened `triangles.status` to add `validation_failed` (patched on findings); a clean pass stays `pending_validation` (awaiting 3.3 period confirmation). `validated` is deliberately NOT added — 3.3 owns it.
- **UI deviation (flagged):** kept the inline-Tailwind button idiom rather than pulling `shadcn add button card` — the repo has only `badge` and `page.tsx` builds buttons inline; introducing shadcn button here would be less consistent than the established pattern. Named-stage progress is a client-choreographed timer over the single pending action (a Convex action can't stream sub-progress) — honest "never a bare spinner", noted in deferred-work.
- **Verification scope:** all ACs proven by automated tests — convex-test with a stubbed engine `fetch` (request shape, findings/clean/error paths, audit, guards, tenancy), the pure parser suite, and the `TriangleGrid` jsdom suite; the drift chain (pytest Link 1 + vitest Link 2); production build compiles the wizard. A full interactive browser run (sign-in → upload → validate) was **not** executed — it needs the Clerk test-user password (not stored) and a live/dev engine service. Same posture as 3.1.

### File List

- `engine/scripts/export_schema.py` (modified) — added `Triangle` + `ValidationReport` to `_TARGETS`.
- `engine/tests/test_schema_contract.py` (modified) — versioned-json test guards on `schemaVersion` presence.
- `schemas/triangle.schema.json`, `schemas/validation-report.schema.json` (new, generated).
- `convex/lib/engineContract.ts` (modified) — `triangleValidator`, `validationReportValidator` (+ `Triangle`/`ValidationReport`/`ValidationFinding` types).
- `tests/engine-contract.test.ts` (modified) — drift checks for the two new validators.
- `convex/lib/triangleParse.ts` (new) — CSV/XLSX bytes → `Triangle` (snake_case), with the TextDecoder dual-guard.
- `convex/lib/triangleParse.test.ts` (new) — 11 parser tests.
- `convex/lib/engineClient.ts` (new) — the Convex→engine `callEngine` client.
- `convex/schema.ts` (modified) — `triangles.status` union widened with `validation_failed`.
- `convex/triangles.ts` (modified) — `getForValidation` (internalQuery), `markValidationFailed` (internalMutation), `validateTriangle` (public action).
- `convex/triangles.test.ts` (modified) — 7 `validateTriangle` action tests (stubbed engine).
- `convex/authGuard.test.ts` (modified) — registered `triangles:validateTriangle` with an injected real triangle id.
- `convex/_generated/api.d.ts`, `convex/_generated/api.js` (regenerated).
- `components/TriangleGrid.tsx` (new) — UX-DR5 grid.
- `tests/triangle-grid.test.tsx` (new) — 5 grid component tests.
- `components/UploadWizard.tsx` (new) — UX-DR8 three-step wizard.
- `components/TriangleStatusIndicator.tsx` (modified) — added `validation_failed`.
- `app/(app)/triangles/page.tsx` (modified) — mounted `<UploadWizard>`, kept the library list.
- `.env.example` (modified) — documented `ENGINE_SERVICE_URL` + `ENGINE_SERVICE_SECRET` as Convex deployment vars.
- `_bmad-output/implementation-artifacts/deferred-work.md` (modified) — 3.2 deferral notes.

### Change Log

- 2026-07-18 — Story 3.2 created (ready-for-dev): upload wizard File+Validation steps, Convex grid parse → first engine_service `/validate` call, flagged `TriangleGrid` preview + findings, Triangle/ValidationReport added to the AD-10 drift check.
- 2026-07-18 — Story 3.2 implemented (→ review): all 7 tasks complete. First Convex→engine `/validate` integration via a reusable client; snake_case Triangle wire correction (empirically verified); 3-step `UploadWizard` + reusable `TriangleGrid`; `validation_failed` status + audit. Gates green (npm test 163, pytest 198/9-skip, tsc×2, lint, build).
