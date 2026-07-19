---
baseline_commit: 2eba35e4c45aec0119deea2438d0c039b2ee8a71
---

# Story 4.3: Run Detail with Step Rail and Live Status

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an Analyst,
I want a Run detail surface with the golden-path step rail and live status,
so that I always know where the quarter stands without refreshing. (FR-20, UX-DR7, UX-DR9)

## Acceptance Criteria

**AC1 — Run detail page renders the golden-path step rail (UX-DR7)**
Given a Run (any status) reached at `/runs/{runId}`,
When its detail page renders,
Then a step rail shows `Upload → Triangle → Run → Diagnostics → Report → Published` with **Run** as the current step in the primary (teal) treatment; **Upload** and **Triangle** are completed — checkmarked and clickable (Upload → `/triangles`, Triangle → `/triangles/{triangleId}`); **Diagnostics** is enabled (clickable → the Diagnostics tab) **only** when the Run is `complete` with a stored DiagnosticsBundle, else disabled with a prerequisite tooltip ("Run completes to unlock Diagnostics"); **Report** and **Published** are always disabled here with a prerequisite tooltip (they unlock in Epic 6). (UX-DR7)

**AC2 — The four tabs exist with locked/empty states (UX-DR9)**
Given the Run detail page,
When it renders,
Then a tab strip **Results · Diagnostics · Interpretation · Report** is present with proper tab semantics (roving focus, `aria-selected`); **Results** is the default active tab. Each tab shows a lightweight placeholder for now — Results/Diagnostics show a "lands in a later story" empty state when the Run isn't `complete` (or a neutral "available after the Run completes" state), and **Interpretation** and **Report** render explicit **locked** states (they belong to Epics 5–6). No tab renders reserve figures in this story (AD-1 — the ResultSet/Diagnostics rendering is Stories 4.4–4.6). (UX-DR9)

**AC3 — Live status via Convex subscription, no polling, announced politely (FR-20)**
Given a `queued` or `running` Run,
When status changes server-side,
Then the status badge and per-Method progress rows (one row per selected Method from `run.parameters.methods`) update **reactively via the `useQuery` Convex subscription** — there is **no polling** anywhere in application code (no `setInterval`/`setTimeout` refetch, no manual refetch loop, FR-20 / anti-pattern). The live-status region is wrapped in `aria-live="polite"` so screen readers hear transitions. (FR-20)

**AC4 — Failed Run shows a destructive banner with an idempotent "Retry run" (UX-DR9)**
Given a `failed` Run,
When the detail page renders,
Then a destructive banner shows the engine error summary (`run.error.message`) and a **"Retry run"** action; clicking it calls a new `runs.retryRun` mutation that re-enters the **same** Story 4.2 orchestration (resets `failed → queued`, clears the prior error/lifecycle timestamps, kicks off a fresh `runWorkflow`, audit-logs the re-entry). Retry is **idempotent**: `retryRun` is guarded to only act on a `failed` Run, so a double-click (or retrying an already-requeued/running/complete Run) is rejected/no-op with no duplicate work and no divergent numbers (the engine is deterministic + stateless, NFR-4). (UX-DR9, FR-4 idempotent retry)

**AC5 — Leaving and returning mid-Run resumes exact server-held state (FR-20)**
Given a `running` Run,
When the user navigates away and returns to `/runs/{runId}` (or reloads),
Then the page reflects the exact current server-held status with no client-persisted/stale state — the `useQuery` subscription re-reads live state on mount (this is inherent to the Convex subscription; do **not** add local status caching, optimistic status, or effect-driven refetch). (FR-20)

**AC6 — Read surface + retry are guarded, tenancy-safe, audited, and tested (AD-4, AD-6, AD-7)**
Given the two new public functions,
When they are exercised,
Then `runs.getRun` (public **query** — the reactive read surface Story 4.2 deferred) calls `requireMember` first and returns `null` for a run outside the caller's Workspace (existence never leaks); it returns a **lean** projection (status, `parameters.methods`, `error`, `triangleId`, `triangleHash`, lifecycle timestamps, and `hasResults`/`hasDiagnostics` booleans) — **never** the `resultSet`/`diagnosticsBundle` figures (those are 4.4–4.6). `runs.retryRun` (public **mutation**) calls `requireMember`, re-checks tenancy, only re-enters a `failed` Run, appends a `run.retried` audit entry via `appendAuditEntryInTransaction` (the single AD-6 writer — no new `auditLogs` insert site), and keeps the per-Workspace hash chain `verifyChain`-valid. The auth-guard enumeration (`convex/authGuard.test.ts`) registers both new functions and stays green; `tests/audit-append-only.test.ts` stays green **unmodified**.

## Scope Boundary (read first)

This story is the **live Run-detail surface** — the read half of Epic 4's runs slice. Story 4.1 built the inert job record; Story 4.2 made it run and owns every `queued → running → complete | failed` transition but exposed **no public read query** ("The run's reactive status surface is 4.3's; 4.2 only writes the state 4.3 will read"). Story 4.3 opens the window onto that state and adds the one legitimate new status writer 4.2 explicitly anticipated: the idempotent "Retry run".

**In scope:**
- **`convex/runs.ts` — `getRun` public query** (the reactive read surface). `requireMember` → tenancy re-check → lean projection (see AC6). Reuses the exact guard/tenancy/`null`-on-miss shape of `triangles.getById`.
- **`convex/runs.ts` — `retryRun` public mutation** (idempotent "Retry run"). `requireMember` → tenancy re-check → guard on `status === "failed"` → reset to `queued` (clear `error`/`startedAt`/`completedAt`/`failedAt`) → `appendAuditEntryInTransaction("run.retried")` → `workflow.start(internal.runs.runWorkflow, …)` (same kickoff as `createRun`'s tail) → patch new `workflowId`. Re-enters the **unchanged** 4.2 orchestration.
- **`app/(app)/runs/[runId]/page.tsx`** (**new**) — the Run detail surface. `useQuery(api.runs.getRun, orgId ? {…} : "skip")`; loading/`null`/loaded states like `triangles/[triangleId]/page.tsx`.
- **`components/StepRail.tsx`** (**new**) — the golden-path rail (AC1). Derive step states from `{ runStatus, hasDiagnostics, triangleId }` via a **pure exported helper** (`deriveStepStates`) so the logic is unit-testable without a DOM.
- **`components/RunDetail.tsx`** (**new**) — status badge + per-Method progress rows + `aria-live` live region + tab strip (locked/empty tab bodies) + failed banner with "Retry run". (Or compose these inside the page + a `components/ui/tabs.tsx`; keep the page thin and the pieces testable.)
- **`components/ui/tabs.tsx`** (**new**) — the shadcn/Radix Tabs primitive (the repo uses `radix-ui` unified pkg — import `Tabs` from `"radix-ui"`). Gives roving-tabindex + `aria-selected` for free (UX-DR9 tab semantics, WCAG floor). Style with the brand tokens; do not restyle beyond the DESIGN.md delta.
- **`components/RunConfig.tsx`** (**edit**) — replace the "run detail view lands in a later story" placeholder: on a successful `createRun`, **navigate** to `/runs/{runId}` via `useRouter().push` (from `next/navigation`). This is the 4.1→4.3 handoff.
- **`components/StatusBadge.tsx`** (**edit**) — add `"queued"` to the `Status` vocabulary (a muted, pulsing pre-run badge). See Dev Notes §"The `queued` badge gap" — `queued` is a real run status the UX-DR3 list omitted (it enumerated `running`); adding it keeps the badge the single styling authority rather than mapping `queued` to a misleading `running`.
- **Tests:** convex-test for `getRun` (projection + tenancy `null`) and `retryRun` (failed→queued re-entry, guard idempotency, audit + chain); extend `convex/authGuard.test.ts` (register + inject a seeded `runId`); jsdom component specs (`tests/*.test.tsx`) for `StepRail`/`deriveStepStates` and the failed-banner/retry + per-Method rows; keep `tests/audit-append-only.test.ts` and `tests/run-config.test.tsx` green (the latter may need a `next/navigation` mock now that RunConfig navigates).
- **Docs:** `deferred-work.md` 4.3 section.

**Explicitly OUT of scope (do NOT build — later stories own them):**
- **Rendering ResultSet figures / provenance popover** → Story 4.4. `getRun` returns **no** reserve figures; the Results tab is an empty/placeholder state here.
- **Diagnostics panels / context rail / `#<diagnosticId>` deep-linking** → Stories 4.5–4.6. The Diagnostics tab is an empty/placeholder state; the step rail's Diagnostics step just switches to that (empty) tab when the Run is complete.
- **Interpretation / Report tab content** → Epics 5–6. Those two tabs render **locked** states only.
- **ResultSet re-derivation from Lineage** → Story 4.7.
- **Any change to the 4.2 orchestration** (`runWorkflow`, `markRunning`, `executeEngineRun`, `storeResultSet`, `markRunFailed`, `onRunComplete`) or to `engine_service`/`reserving_engine`. `retryRun` *re-enters* the orchestration unchanged; it adds exactly one new guarded status writer (`failed → queued`) plus one audit event (`run.retried`). `uv run pytest` must stay green untouched.
- **Manual/UI cancel of a running Run**, dashboard/review-queue surfaces, `⌘K` palette, promoting tabs to nested routes — all later.
- **Per-Method *streaming* progress.** The engine `/runs` returns all Method results in **one** synchronous response (Story 4.2), so per-Method rows tick together off the run-level status — there is no independent per-Method server progress to subscribe to. Render one row per selected Method reflecting the Run status (see Dev Notes).

## Tasks / Subtasks

- [x] **Task 1 — `getRun` public query: the reactive read surface (AC: 1, 2, 3, 5, 6)**
  - [x] `convex/runs.ts` → add `export const getRun = query({ args: { workspaceId: v.string(), runId: v.id("runs") }, … })`. **First statement `await requireMember(ctx, workspaceId)`** (AD-4). Then `const run = await ctx.db.get(runId); if (run === null || run.workspaceId !== workspaceId) return null;` (tenancy — existence never leaks, exactly like `triangles.getById`).
  - [x] Return a **lean** projection — **no `resultSet`/`diagnosticsBundle`** (AD-1 leanness; those figures are 4.4–4.6):
    ```ts
    return {
      _id: run._id,
      status: run.status,                     // queued | running | complete | failed
      triangleId: run.triangleId,
      triangleHash: run.triangleHash,
      methods: run.parameters.methods,        // per-Method rows
      error: run.error ?? null,               // { code, message } | null
      createdAt: run.createdAt,
      startedAt: run.startedAt ?? null,
      completedAt: run.completedAt ?? null,
      failedAt: run.failedAt ?? null,
      hasResults: run.resultSet !== undefined,        // Results tab / step-rail gating (boolean, no figures)
      hasDiagnostics: run.diagnosticsBundle !== undefined, // Diagnostics step/tab gating
    };
    ```
  - [x] Import `query` from `./_generated/server` (alongside the existing `mutation`/`internal*` imports). `npx convex codegen` after adding (publishes `api.runs.getRun`).

- [x] **Task 2 — `retryRun` public mutation: idempotent re-entry (AC: 4, 6)**
  - [x] `convex/runs.ts` → add `export const retryRun = mutation({ args: { workspaceId: v.string(), runId: v.id("runs") }, … })`:
    - `const { identity } = await requireMember(ctx, workspaceId); const actor = identity.subject;` (member-level, matching `createRun`).
    - `const run = await ctx.db.get(runId); if (run === null || run.workspaceId !== workspaceId) throw new ConvexError({ code: "RUN_NOT_FOUND", message: "That Run does not exist in this Workspace." });` (same tenancy posture as `createRun`'s triangle check).
    - **Idempotency guard:** `if (run.status !== "failed") throw new ConvexError({ code: "RUN_NOT_RETRYABLE", message: "Only a failed Run can be retried." });` — a double-click (2nd click sees `queued`/`running`) or a retry of a `complete`/`queued`/`running` run is rejected; no duplicate workflow, no divergent numbers.
    - **Reset (this is the ONE new status writer beyond 4.2, `failed → queued`):** `await ctx.db.patch(runId, { status: "queued", error: undefined, startedAt: undefined, completedAt: undefined, failedAt: undefined });` (clear the stale lifecycle fields; `resultSet`/`diagnosticsBundle` are already absent on a failed run).
    - **Atomic audit (AD-6):** `await appendAuditEntryInTransaction(ctx, { workspaceId, actor, eventType: "run.retried", runId, payload: { runId, retriedFrom: run.error?.code ?? "unknown" } })` — lean, no figures. Append **only** via this helper (never an inline `auditLogs` insert).
    - **Kick off orchestration (identical to `createRun`'s tail):**
      ```ts
      const workflowId = await workflow.start(
        ctx,
        internal.runs.runWorkflow,
        { runId, workspaceId, actor },
        { onComplete: internal.runs.onRunComplete, context: { runId, actor } },
      );
      await ctx.db.patch(runId, { workflowId });
      return { runId, status: "queued" as const };
      ```
    - **Job-record-first preserved:** the run row already exists; reset + audit commit before `workflow.start` (which schedules transactionally within the mutation). The prior (failed) workflow is terminal — starting a fresh one is correct; the new `workflowId` overwrites the stale one.
  - [x] `npx convex codegen` (publishes `api.runs.retryRun`).

- [x] **Task 3 — Run detail page + StepRail (AC: 1, 2, 5)**
  - [x] `app/(app)/runs/[runId]/page.tsx` (**new**, `"use client"`): mirror `triangles/[triangleId]/page.tsx` — `const { orgId } = useAuth(); const params = useParams<{ runId: string }>(); const runId = params.runId as Id<"runs">; const run = useQuery(api.runs.getRun, orgId ? { workspaceId: orgId, runId } : "skip");`. Render loading (`run === undefined`), not-found (`run === null` → "This Run does not exist in your Workspace."), else the detail (`StepRail` + `RunDetail`). Data surface width (`max-w-screen-2xl`) like the triangle detail; a back-link to `/triangles/{run.triangleId}`.
  - [x] `components/StepRail.tsx` (**new**): props `{ runStatus, hasDiagnostics, triangleId, activeTab?, onSelectDiagnostics? }`. Steps in order: `Upload`, `Triangle`, `Run`, `Diagnostics`, `Report`, `Published`.
    - Export a **pure** helper `deriveStepStates({ runStatus, hasDiagnostics })` returning per-step `{ key, label, state: "complete" | "current" | "disabled", tooltip? }`: `Upload`/`Triangle` → `complete` (a Run cannot exist without an accepted Triangle — `createRun` gates on `validated`); `Run` → `current`; `Diagnostics` → `complete`-clickable when `runStatus === "complete" && hasDiagnostics`, else `disabled` with tooltip "Run completes to unlock Diagnostics"; `Report`/`Published` → `disabled` with tooltip "Available after diagnostics review" / "Available after publication".
    - Render: completed steps as links/buttons with a checkmark (`lucide-react` `Check`), the current step in `text-primary`/`bg-primary/10`, disabled steps muted with `title={tooltip}` + `aria-disabled`. Upload → `Link href="/triangles"`, Triangle → `Link href={`/triangles/${triangleId}`}`, Diagnostics (when enabled) → button calling `onSelectDiagnostics` (switches the tab). Horizontal, scrolls in its own container on `md` (no body h-scroll).
  - [x] Keep the step rail semantics accessible: it is a navigation/progress element — use a `<nav aria-label="Run progress">` with the current step marked `aria-current="step"`.

- [x] **Task 4 — RunDetail: badge, per-Method rows, tabs, failed banner + Retry (AC: 2, 3, 4)**
  - [x] `components/ui/tabs.tsx` (**new**): the shadcn Tabs wrapper over `radix-ui`'s `Tabs` (`Tabs.Root`/`List`/`Trigger`/`Content`). Minimal brand styling (active trigger in the primary family). This is the sanctioned accessible primitive — do not hand-roll tab keyboard handling.
  - [x] `components/RunDetail.tsx` (**new**), props the loaded `run` projection + a retry callback:
    - **Status badge:** `<StatusBadge status={run.status} />` — `run.status` is now a valid `Status` after Task 6 (`queued|running|complete|failed` all covered).
    - **Live-status region** wrapped in `<div aria-live="polite">`: for `queued`/`running`, per-Method progress rows — one row per `run.methods` value (map the snake_case enum to a friendly label: `chain_ladder → Chain Ladder`, `bornhuetter_ferguson → Bornhuetter-Ferguson`, `mack → Mack`; reuse/extract the `METHOD_OPTIONS` label map from `RunConfig.tsx` so labels don't drift). Each row shows the Method + a state derived from `run.status` (`queued`/`running` → "running…" with the pulsing dot; `complete` → "complete" ✓; `failed` → "failed"). **No per-Method server progress exists** — the rows reflect run-level status (see Dev Notes). On `complete`, a short "Run complete — see Results and Diagnostics" line; the figures live in 4.4+.
    - **Failed banner (AC4):** when `run.status === "failed"`, a `bg-destructive/10 text-destructive` banner with `run.error?.message` (fallback "The Run failed.") + a "Retry run" `<button>` calling the retry mutation. Disable the button while the retry mutation is pending; on success the subscription flips the run to `queued`/`running` and the banner disappears reactively (do not optimistically hide it — audit-generating/status actions confirm on server ack, UX-DR primitive).
    - **Tabs (AC2):** `Results · Diagnostics · Interpretation · Report`, Results default. Bodies:
      - Results → placeholder: when `run.hasResults`, "Results render in a later story (4.4)."; else "Results appear once the Run completes."
      - Diagnostics → placeholder: when `run.hasDiagnostics`, "Diagnostics render in a later story (4.5)."; else "Diagnostics appear once the Run completes." (the step rail's Diagnostics step switches here.)
      - Interpretation → **locked** state: "Interpretation unlocks after Diagnostics review (Epic 5)."
      - Report → **locked** state: "Report unlocks after Interpretation (Epic 6)."
    - No reserve figures anywhere in this component (AD-1).
  - [x] Wire the retry mutation in the page (or RunDetail): `const retryRun = useMutation(api.runs.retryRun);` → `await retryRun({ workspaceId: orgId, runId })` inside a `try/catch` surfacing the `ConvexError` message (reuse `RunConfig`'s `errorMessage` helper pattern; consider extracting it to `lib/` if it's now used twice — optional).

- [x] **Task 5 — RunConfig handoff → navigate to the Run detail (AC: 1)**
  - [x] `components/RunConfig.tsx`: import `useRouter` from `next/navigation`. In `start()`, after `const result = await createRun(...)`, replace the `setQueuedRunId(result.runId)` placeholder path with `router.push(`/runs/${result.runId}`)`. Remove the now-dead "run detail view lands in a later story" queued panel (or keep a brief "Starting…" state until navigation). Keep the gating logic, paste handling, and `aria-live` intact.
  - [x] Update `tests/run-config.test.tsx` if needed: it stubs `convex/react` (`useMutation`). Add a `next/navigation` mock (`useRouter: () => ({ push: vi.fn() })`) so the component renders under jsdom. The existing gating assertions must stay green.

- [x] **Task 6 — StatusBadge: add the `queued` status (AC: 3)**
  - [x] `components/StatusBadge.tsx`: add `"queued"` to the `Status` union and a `queued` entry to `statusClasses` — a muted pre-run treatment, e.g. `bg-muted text-muted-foreground` with the same pulsing dot as `running` (it is in-flight, awaiting orchestration). Keep the component the single styling authority (UX-DR3 "never restyle locally"). Update the top-of-file comment to note `queued` is the pre-`running` Run status.
  - [x] Extend `tests/status-badge.test.tsx` with a `queued` case (renders the label + the pulsing dot, muted family).

- [x] **Task 7 — Convex tests: `getRun` + `retryRun` (AC: 6)**
  - [x] `convex/runs.test.ts` (extend): reuse the existing seeding (a `validated` triangle + a run row via `createRun` or a direct `t.run` insert; the file already builds valid ResultSet/DiagnosticsBundle fixtures for 4.2).
    - **`getRun`:** with `t.withIdentity` for a member of `org_test`, a `queued`/`running`/`complete`/`failed` run returns the lean projection with the right `status`, `methods`, `error`, `hasResults`/`hasDiagnostics` (true only for the `complete` fixture). A run in another Workspace (or a bogus id of a foreign row) returns `null` (tenancy — no leak). Assert the projection contains **no** `resultSet`/`diagnosticsBundle` keys.
    - **`retryRun` happy path:** seed a `failed` run (set `status:"failed"`, an `error`, `failedAt`), call `retryRun` as a member → run flips to `queued`, `error`/`failedAt`/`startedAt`/`completedAt` cleared, a new `workflowId` set, and a `run.retried` audit entry appended; `verifyChain` → `{ valid: true }`. Do **not** finish scheduled functions (the workflow kickoff schedules but need not be driven — same posture as 4.1/4.2 tests).
    - **`retryRun` idempotency guard:** calling `retryRun` on a `queued`/`running`/`complete` run throws `RUN_NOT_RETRYABLE` and appends no audit entry; a second immediate `retryRun` after a first (now `queued`) also throws (double-click safe).
    - **`retryRun` tenancy:** a member of Workspace B retrying Workspace A's run throws `RUN_NOT_FOUND` (no leak).
  - [x] `convex/authGuard.test.ts`: add `"runs:getRun": { workspaceId: "org_test" }` and `"runs:retryRun": { workspaceId: "org_test" }` to `publicFunctionArgs`, and add both paths to the `argsFor` `runId`-injection branch (seed a real `runs` row in the unauth test — extend the existing triangle-seed block to also insert a minimal `queued` run and inject its id, mirroring how `triangleId` is injected). Both are public → the enumeration will fail the build until registered (by design).
  - [x] `tests/audit-append-only.test.ts`: **stays green unmodified** — `retryRun` appends via `appendAuditEntryInTransaction`; the single `.insert("auditLogs")` call-site remains in `auditLogs.ts`. Add **zero** `auditLogs` inserts in `runs.ts`.

- [x] **Task 8 — Component tests + full gates (AC: 1, 3, 4)**
  - [x] `tests/step-rail.test.tsx` (**new**, `// @vitest-environment jsdom`): unit-test the pure `deriveStepStates` (Run = current; Diagnostics disabled with tooltip when not complete, enabled when `complete && hasDiagnostics`; Report/Published always disabled) and a render smoke (checkmarks on Upload/Triangle, `aria-current="step"` on Run, disabled steps carry `title`/`aria-disabled`). No Convex/Clerk needed if `StepRail` takes plain props.
  - [x] `tests/run-detail.test.tsx` (**new**, `// @vitest-environment jsdom`): mock `convex/react` (`useMutation: () => vi.fn()`) and render `RunDetail` with plain-prop run fixtures: a `failed` run shows the destructive banner + "Retry run" button (clicking calls the retry callback); a `running` run shows per-Method rows (one per method, pulsing) inside an `aria-live="polite"` region and the `running` badge; a `complete` run shows the complete state and the Diagnostics tab reachable. Assert **no polling primitive** — the component has no `setInterval`/`setTimeout`-based refetch (structural: it takes `run` as a prop / reads it via `useQuery` only).
  - [x] **Full gates green before → review:** `npm test` (both projects — unit + convex), root `npx tsc --noEmit` + `npx tsc -p convex/tsconfig.json --noEmit`, `npm run lint`, `npm run build` (compiles the new `/runs/[runId]` route), and `cd engine && uv run pytest` (**unchanged** — no engine edits; keep green). Leave the single Playwright smoke as-is (a live browser run needs the Clerk test-user password + a live engine — same headless posture as 4.1/4.2; note it in the Dev Agent Record).

## Dev Notes

### This story is the read surface 4.2 deferred — plus the one retry writer it anticipated (AD-7)

Story 4.2's scope note is explicit: *"4.2 exposes no new public query/mutation (no `getRun`, no status query). The run's reactive status surface is 4.3's; 4.2 only writes the state 4.3 will read."* And on retry: *"There is deliberately no other path (no public 'retry' mutation yet — that's 4.3's idempotent 'Retry run' UI, which will re-enter this same orchestration)."* So 4.3 adds exactly two public functions — `getRun` (read) and `retryRun` (the anticipated `failed → queued` re-entry) — and **zero** changes to the 4.2 orchestration internals. The `runs` record stays the sole authority on status (AD-7); `retryRun` is a new, tightly-guarded status writer (`failed → queued` only) that hands back to the unchanged `runWorkflow`.

### Live status is `useQuery`, full stop — no polling (FR-20, anti-pattern)

Convex `useQuery` **is** a live subscription: when `markRunning`/`storeResultSet`/`markRunFailed` patch the `runs` row server-side, every subscribed `getRun` re-renders automatically. This satisfies FR-20 ("live status without refreshing"), the `aria-live` announcement (AC3), and AC5 ("leaving and returning resumes exact server-held state") **for free** — on remount the query re-reads current state. The projamt-context anti-pattern is unambiguous: *"❌ Polling in application code — live status comes from Convex subscriptions (FR-20)."* Do not add `setInterval`, effect-driven refetch, optimistic status, or any local status cache. The only client state is UI-local (active tab, retry-pending) — never a shadow of server status.

### Per-Method rows tick together (the engine is one synchronous call)

Story 4.2's `/runs` is a single synchronous `200` returning **all** Method results at once — there is no per-Method server-side progress stream to subscribe to. So the "per-Method progress rows" (UX-DR9) are a presentation of the **run-level** status against the selected Methods list: while `queued`/`running` every row reads "running…"; on `complete` every row reads "complete"; on `failed` every row reads "failed". This is honest (the voice rules forbid overselling) — do **not** fake staggered per-Method completion. One row per `run.parameters.methods` entry. (If a future async-`202` engine upgrade — a documented 4.2 deferral — ever lands, real per-Method progress can replace this; not now.)

### The `queued` badge gap (UX-DR3)

`StatusBadge`'s fixed vocabulary (`draft·running·complete·failed·awaiting review·published·engine-only`) omitted `queued`, but the `runs` table's status union includes it (`queued|running|complete|failed`). Rather than map `queued → "running"` in the page (a small lie — a queued run has not started), add `queued` as a first-class badge status (muted, pulsing). This keeps `StatusBadge` the single styling authority (UX-DR3 "never restyle locally") and stays honest. `queued` is a sub-second internal state (`createRun` returns `queued`, `markRunning` flips it almost immediately) — the badge is mostly seen as `running`/`complete`/`failed`, but the queued case must render truthfully during the window and if orchestration is slow to pick up. **[Question for Rohan — see end.]**

### Reuse, do not reinvent (existing patterns)

- **Public query guard + tenancy + `null`-on-miss:** `convex/triangles.ts` `getById` (lines 626–646) — copy the shape exactly for `getRun` (`requireMember` first, `row.workspaceId !== workspaceId → null`, lean projection). Do not invent a new guard posture.
- **Mutation guard + tenancy + audit + `workflow.start`:** `convex/runs.ts` `createRun` (lines 50–192) — `retryRun` mirrors its tail (`requireMember` → tenancy → `appendAuditEntryInTransaction` → `workflow.start` → patch `workflowId`). Same `actor = identity.subject`, same `ConvexError({code,message})` envelope.
- **`ConvexError` message extraction in the UI:** `RunConfig.tsx` `errorMessage` (lines 36–41) — reuse for the retry error surface.
- **Method-label map:** `RunConfig.tsx` `METHOD_OPTIONS` (lines 30–34) — extract to a shared module (e.g. `components/methods.ts` or `lib/`) if both `RunConfig` and `RunDetail` need it, so the friendly labels never drift.
- **Page skeleton (loading/`null`/loaded, back-link, `useAuth().orgId` → `"skip"`):** `app/(app)/triangles/[triangleId]/page.tsx` — the run detail page follows it 1:1.
- **jsdom component spec conventions:** `tests/run-config.test.tsx` / `tests/status-badge.test.tsx` / `tests/triangle-grid.test.tsx` — `// @vitest-environment jsdom`, `vi.mock("convex/react", …)`, `@testing-library/react` `render`/`screen`/`fireEvent`, `afterEach(cleanup)`. Copy this for the new specs.
- **StatusBadge:** already handles `running`/`complete`/`failed` with the pulsing-dot pattern — extend, don't replace.

### Tabs: shadcn/Radix, in-page state (forward-compat note)

Use `radix-ui`'s `Tabs` (the repo's unified `radix-ui@1.6.2`) via a new `components/ui/tabs.tsx` — it gives roving-tabindex, `aria-selected`, arrow-key nav, and `aria-controls` wiring (UX-DR9 tab semantics + WCAG floor) without hand-rolling keyboard handling. Tab state is **client-local** in this story (Results default). Story 4.6 introduces `/runs/{id}/diagnostics#<diagnosticId>` deep-linking; when it does, the tab may be promoted to a route or a `?tab=`/hash param. Keep the tab keys stable (`results|diagnostics|interpretation|report`) so that promotion is mechanical. Do **not** build the routing now (out of scope) — but don't hard-code assumptions that block it (e.g. keep the Diagnostics tab addressable by a key the step rail can select).

### AD-1 — zero figures on this surface

`getRun` returns **no** `resultSet`/`diagnosticsBundle` (only the `hasResults`/`hasDiagnostics` booleans + status/methods/timestamps). The Results/Diagnostics tabs are placeholders. There is **no arithmetic** anywhere in the page/components — no totals, no counts of figures, no deltas. The only numbers on screen are identifiers/timestamps (ISO strings) and the Method labels. Reserve-figure rendering is 4.4–4.6.

### Retry idempotency — why the status guard is the whole story (NFR-4)

`retryRun`'s `status === "failed"` guard makes retry idempotent by construction: the first click flips `failed → queued` and starts a workflow; any second click (or a retry of a non-failed run) sees a non-`failed` status and throws `RUN_NOT_RETRYABLE`. Combined with the engine's determinism + statelessness (a re-run recomputes byte-identically, Story 4.2), a retried Run cannot produce duplicate work or divergent numbers (NFR-4, FR-4 "idempotent Retry run"). The UI additionally disables the button while the mutation is pending and lets the subscription (not optimism) confirm the transition — audit-generating status actions confirm on server ack (UX interaction primitive: no optimistic UI for audit-generating actions).

### Project Structure Notes

- **New:** `app/(app)/runs/[runId]/page.tsx`, `components/StepRail.tsx`, `components/RunDetail.tsx`, `components/ui/tabs.tsx`, `tests/step-rail.test.tsx`, `tests/run-detail.test.tsx`. Optional shared: `components/methods.ts` (extracted Method labels).
- **Edit:** `convex/runs.ts` (`getRun` query + `retryRun` mutation), `convex/runs.test.ts` (getRun/retryRun tests), `convex/authGuard.test.ts` (register both + seed a run id), `components/RunConfig.tsx` (navigate to `/runs/{runId}`), `components/StatusBadge.tsx` (+`queued`), `tests/run-config.test.tsx` (mock `next/navigation`), `tests/status-badge.test.tsx` (+queued case).
- **Regen:** `npx convex codegen` after the `runs.ts` additions (publishes `api.runs.getRun`, `api.runs.retryRun`).
- **No change:** the 4.2 orchestration internals (`runWorkflow`/`markRunning`/`executeEngineRun`/`storeResultSet`/`markRunFailed`/`onRunComplete`), `convex/schema.ts` (the `runs` fields 4.2 added are exactly what `getRun` reads and `retryRun` clears — no schema change), `convex/auditLogs.ts` (single insert call-site preserved; `run.retried` is a new event *type* string, not a new writer), any `engine/` file (`pytest` stays green), `SidebarNav.tsx` (runs aren't top-level nav yet).
- **Doc:** append a 4.3 section to `deferred-work.md` (tabs-as-routes promotion deferred to 4.6; per-Method streaming deferred pending the async-`202` engine upgrade; live-engine browser smoke folded into Story 7.4; whether `run.retried` payload should carry a retry counter once the Audit Log browser lands in Epic 7).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.3] — story statement + ACs (lines 470–487); Epic 4 summary (430–432); Story 4.4–4.6 scope that this story defers to (489–539)
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-agentic-reserving-2026-07-16/EXPERIENCE.md] — step rail golden path + jump-back/forward-disabled rule (31), Run detail tabs "spine of the golden path" (25), Step rail component behavioral rules + prerequisite tooltip (67), Status badge fixed vocabulary "never restyled locally" (75), Run queued/running + Run failed state patterns (84–85), live status `aria-live="polite"` (111), no-optimistic-UI-for-audit-actions + banned polling posture (102), responsive context-rail/grid rules (117–121)
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-agentic-reserving-2026-07-16/DESIGN.md] — `numeric` (Geist Mono) role for engine figures (100), StatusBadge spec (draft muted / running primary+pulse / failed destructive) (59, 126–131)
- [Source: _bmad-output/planning-artifacts/architecture/architecture-agentic-reserving-2026-07-16/ARCHITECTURE-SPINE.md] — AD-7 runs record sole status authority + job-record-first (89–93), AD-4 requireMember-first / no anonymous access (71–75), AD-6 append-only single-writer audit (83–87), AD-1 numbers only in the engine / no arithmetic in React (53–57), AD-3 Convex sole system of record (65–69), FR-20 live status via subscription (no polling)
- [Source: convex/runs.ts:50-192] — `createRun` (the guard/tenancy/audit/`workflow.start` tail `retryRun` mirrors); [convex/runs.ts:204-435] — the 4.2 orchestration internals `retryRun` re-enters **unchanged** (`runWorkflow`, `onRunComplete`, the three status mutations)
- [Source: convex/schema.ts:98-141] — the `runs` table (`status` union incl. `queued`; the optional `resultSet`/`diagnosticsBundle`/`error`/`workflowId`/timestamp fields `getRun` reads and `retryRun` clears)
- [Source: convex/triangles.ts:626-646] — `getById` (the exact public-query guard + tenancy + lean-projection shape to copy for `getRun`)
- [Source: convex/auditLogs.ts] — `appendAuditEntryInTransaction` (the atomic-audit helper `retryRun` calls) + `verifyChain`; single `.insert("auditLogs")` call-site stays here
- [Source: convex/authGuard.test.ts:45-76, 204-221] — `publicFunctionArgs` registry + the `runId`/`triangleId` injection block to extend for `getRun`/`retryRun`
- [Source: components/RunConfig.tsx:30-41, 173-215] — `METHOD_OPTIONS` label map + `errorMessage` helper to reuse; the queued placeholder (lines 197–215) this story replaces with navigation to `/runs/{runId}`
- [Source: components/StatusBadge.tsx:1-45] — the `Status` vocabulary + pulsing-dot pattern to extend with `queued`
- [Source: app/(app)/triangles/[triangleId]/page.tsx] — the `useAuth().orgId → useQuery(… "skip")` page skeleton (loading/`null`/loaded, back-link) the run detail page follows
- [Source: tests/run-config.test.tsx, tests/status-badge.test.tsx] — jsdom component-spec conventions (`// @vitest-environment jsdom`, `vi.mock("convex/react")`, RTL); [vitest.config.mts] — the `unit` (jsdom-opt-in) + `convex` (edge-runtime) test projects
- [Source: _bmad-output/implementation-artifacts/4-2-durable-run-orchestration-and-resultset-persistence.md:68-73, 211] — 4.2's explicit deferral of the read query + "Retry run" UI to 4.3, and "re-enter this same orchestration"
- [Source: _bmad-output/project-context.md] — Constitution (AD-1 no figures outside the engine), auth (requireMember first), audit single-writer, "❌ Polling in application code — live status via subscription (FR-20)", vocabulary (Run, ResultSet, Diagnostic — never synonyms)

## Dev Agent Record

### Agent Model Used

Amelia (dev agent) — claude-opus-4-8[1m].

### Debug Log References

All gates green on completion:
- `npm test` → **247 passed** (21 files; unit + convex projects).
- `npx tsc --noEmit` (root) → clean; `npx tsc -p convex/tsconfig.json --noEmit` → clean.
- `npm run lint` → clean.
- `npm run build` → success; the new `/runs/[runId]` route compiled (dynamic).
- `cd engine && uv run pytest` → **205 passed, 9 skipped** (unchanged — no engine edits).

Three first-run failures were all in the newly-authored specs (not implementation bugs), fixed:
1. `tests/step-rail.test.tsx` — `getByText("Report").closest("span")` resolved to the inner content wrapper span. Removed the `StepContent` wrapper element (now a fragment) so the outer step `<span>` directly carries the label text + `aria-disabled`/`title`; moved `gap-1.5` onto the step `base` class.
2. `tests/run-detail.test.tsx` no-polling probe — a render dependency calls `setInterval`, so a global spy was the wrong probe. Replaced with a source scan asserting `components/RunDetail.tsx` contains no `setInterval`/`setTimeout` (the real structural guarantee); switched the file read to a `process.cwd()`-relative path (`import.meta.url` isn't a `file:` URL under jsdom).
3. `convex/runs.test.ts` retry happy-path — pinned an exact `verifyChain` length of 4, but the harness-driven workflow kickoff adds its own lifecycle entry. Relaxed to assert `verification.valid === true` (chain integrity) + `run.retried` appears exactly once; status/field-clearing/`workflowId` invariants unchanged.

### Completion Notes List

- **AC1 (step rail):** `components/StepRail.tsx` with a pure, DOM-free `deriveStepStates` helper — Upload/Triangle complete + clickable jump-backs, Run current (`aria-current="step"`), Diagnostics enabled only when `complete && hasDiagnostics`, Report/Published disabled with prerequisite tooltips. Rendered inside a `<nav aria-label="Run progress">` that scrolls in its own container.
- **AC2 (four tabs):** `components/ui/tabs.tsx` (shadcn wrapper over `radix-ui` `Tabs` → roving focus + `aria-selected` for free). Results default; Results/Diagnostics show empty/placeholder states, Interpretation/Report render explicit locked states. No reserve figures anywhere (AD-1).
- **AC3 (live status, no polling):** live-status region wrapped in `aria-live="polite"`; per-Method rows (one per `run.methods`) reflect run-level status (rows tick together — the engine is one synchronous call). Live updates come solely from the `useQuery(api.runs.getRun)` subscription; a source-scan test guards against `setInterval`/`setTimeout` refetch.
- **AC4 (failed banner + idempotent retry):** destructive `role="alert"` banner with `run.error.message` + a Retry button (disabled while pending; no optimistic hide — confirms on the subscription). `runs.retryRun` guards on `status === "failed"` → double-click / non-failed retry throws `RUN_NOT_RETRYABLE`.
- **AC5 (resume on return):** inherent to the Convex subscription — the page re-reads exact server state on mount; no local status cache / optimistic status / effect-driven refetch.
- **AC6 (guarded read + retry):** `getRun` (public query) — `requireMember` first, tenancy `null`-on-miss, **lean** projection (no `resultSet`/`diagnosticsBundle`; `hasResults`/`hasDiagnostics` booleans only). `retryRun` (public mutation) — `requireMember` → tenancy → `failed→queued` reset → `appendAuditEntryInTransaction("run.retried")` (single AD-6 writer) → re-enters the unchanged 4.2 `runWorkflow`. Both registered in `convex/authGuard.test.ts`; `tests/audit-append-only.test.ts` stays green **unmodified** (no new `auditLogs` insert site).
- **Handoff:** `RunConfig` now `router.push(\`/runs/${runId}\`)` on a successful `createRun` (the 4.1→4.3 handoff); the old "lands in a later story" queued panel removed.
- **`queued` badge:** added to `StatusBadge` as a first-class muted + pulsing status (confirmed with Rohan) — keeps the badge the single styling authority rather than mapping `queued → running`.
- **Method labels:** `METHOD_OPTIONS` extracted to `components/methods.ts` (+ `methodLabel`) and shared by `RunConfig` and `RunDetail` so labels never drift.
- **Out of scope, untouched:** the 4.2 orchestration internals, `convex/schema.ts`, `convex/auditLogs.ts` single insert site, and every `engine/` file. The live-engine browser smoke remains folded into Story 7.4 (needs the Clerk test-user password + a live engine).

### File List

**New:**
- `app/(app)/runs/[runId]/page.tsx`
- `components/StepRail.tsx`
- `components/RunDetail.tsx`
- `components/ui/tabs.tsx`
- `components/methods.ts`
- `tests/step-rail.test.tsx`
- `tests/run-detail.test.tsx`

**Edited:**
- `convex/runs.ts` (`getRun` query + `retryRun` mutation; `query` import)
- `convex/runs.test.ts` (`getRun`/`retryRun` tests)
- `convex/authGuard.test.ts` (register both + seed a `runs` row / inject `runId`)
- `components/RunConfig.tsx` (navigate to `/runs/{runId}`; use shared `METHOD_OPTIONS`)
- `components/StatusBadge.tsx` (+`queued` status)
- `tests/run-config.test.tsx` (mock `next/navigation`)
- `tests/status-badge.test.tsx` (+`queued` case; in-flight pulsing set)
- `_bmad-output/implementation-artifacts/deferred-work.md` (4.3 section)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (4.3 → in-progress → review)

**Regenerated:** `convex/_generated/*` (`npx convex codegen` — publishes `api.runs.getRun`, `api.runs.retryRun`).

## Change Log

| Date       | Version | Description                                                                 |
| ---------- | ------- | --------------------------------------------------------------------------- |
| 2026-07-19 | 0.1     | Story 4.3 implemented: `getRun` reactive read surface + idempotent `retryRun`; Run-detail page with golden-path step rail, four tabs (locked/empty), `aria-live` per-Method rows (no polling), failed banner + Retry; `RunConfig` navigation handoff; `queued` StatusBadge; shared method labels. All gates green. Status → review. |

### Review Findings (code review 2026-07-19)

- [x] [Review][Defer] `StepRail` renders a diagnostics-complete step as an inert `<span>` if `onSelectDiagnostics` is not passed — deferred, requires a missing prop
