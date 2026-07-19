---
baseline_commit: 9342bbef6a716aea4559b83d01d33b412c8d7e1c
---

# Story 4.5: Diagnostics Review Panels

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an Analyst,
I want the four Diagnostics rendered visually with values printed and accessible alternatives,
so that I can form my own view before any Interpretation exists. (FR-8, UX-DR6, UX-DR10)

## Acceptance Criteria

**AC1 — DiagnosticsBundle is exposed via a new guarded, tenancy-safe query returning the stored bundle verbatim; `getRun` and `getResultSet` stay untouched (AD-4, AD-1)**
Given a new public query `runs.getDiagnosticsBundle`,
When it is exercised,
Then its **first statement is `await requireMember(ctx, workspaceId)`** (AD-4); it then re-checks tenancy (`run === null || run.workspaceId !== workspaceId → return null`, existence never leaks) and returns `run.diagnosticsBundle ?? null` **verbatim** — the full stored `DiagnosticsBundle` for a `complete` Run, `null` for a Run without one (queued/running/failed) or outside the Workspace. `runs.getRun` (lean live-status projection) and `runs.getResultSet` (figures) are **unchanged**; the DiagnosticsBundle is fetched only by the Diagnostics tab, only when `hasDiagnostics`. The auth-guard enumeration (`convex/authGuard.test.ts`) registers `runs:getDiagnosticsBundle` and stays green. (AD-4, AD-1)

**AC2 — The Diagnostics tab renders the four panels from the stored bundle, verbatim, in the `numeric` texture (FR-8, UX-DR6)**
Given a `complete` Run (a stored `diagnosticsBundle`),
When the Diagnostics tab renders,
Then four panels appear:
1. **LDF stability** — small-multiple charts by Development Period from `ldfStability[]` (each element's `linkRatios[]` factor series plotted with the `selectedFactor` marked; `sigma`/`stdErr`/`cv` available in the panel's table view).
2. **Actual vs Expected** — the latest-diagonal table from `ave[]` with Origin · Actual · Expected · **A−E** (`actualMinusExpected`, signed) · **A/E** (`actualToExpectedRatio`, percent) — deviations **mono-printed** verbatim.
3. **CL vs BF divergence** — per-Origin-Period bars from `clBfDivergence[]`, rendered **only when `clBfDivergence !== null`** (both CL and BF ran); each bar's `divergence` (and `relativeDivergence`) printed.
4. **Residual heatmap** — a grid over Origin × Development from `residuals[]` using a **diverging blue↔amber ramp** (never red↔green), with each cell's `residual` **value always printed in the cell** at `numeric` (color is annotation, the number is the datum).
Every figure is set in the `numeric` (Geist Mono) utility and is **display-formatted only** — there is **no arithmetic** in React (AD-5 below). (FR-8, UX-DR6, DESIGN.md:130,139)

**AC3 — Every element carries its Diagnostic ID as a hoverable, provenance-violet anchor (UX-DR10)**
Given the rendered panels,
When any diagnostic element is inspected,
Then it carries its **Diagnostic ID** — the stored `element.id` (the canonical `dx:{runId}:{kind}:{key}`, minted only by the engine) — rendered as a **hoverable anchor** in the `provenance` (violet) token family (Diagnostic-ID references are that colour's licensed use, DESIGN.md:89,126). Hover/focus surfaces the full ID (`title` / tooltip); the anchor is keyboard-focusable. (Clicking to **select** into a context rail and `#<diagnosticId>` **deep-linking** are Story 4.6 — not built here; the anchor is the identity affordance only.) (UX-DR10)

**AC4 — Charts offer an accessible table toggle showing the same data; colour is never the sole signal (UX-DR10, WCAG 2.2 AA)**
Given the graphical panels (LDF stability small-multiples and CL-vs-BF divergence bars),
When viewed by keyboard/screen-reader,
Then each offers an **accessible table toggle** (a "Show data table" control) that swaps the chart for a real `<table>` presenting the same underlying values (`<caption class="sr-only">`, `<th scope>`), and back. The **residual heatmap prints its value in every cell** and uses real table semantics (its accessible alternative is intrinsic — no toggle needed); the **Actual-vs-Expected panel is already a table**. In every panel, colour never carries meaning alone — the heatmap prints the number, deviations carry an explicit sign, and the divergence direction is printed. (UX-DR10, EXPERIENCE.md:108,113, DESIGN.md:139, WCAG 2.2 AA)

**AC5 — All values are read from the stored bundle verbatim; zero arithmetic on any figure (AD-1)**
Given the rendered panels,
When inspected,
Then **every number on screen is a field read directly from the stored `diagnosticsBundle`** — the app renders exactly what the engine computed and nothing derived. Specifically: **no recomputed deviations** (do **not** compute `actual − expected` or `ratio − 1`; render the stored `actualMinusExpected` and `actualToExpectedRatio`), **no recomputed divergences** (render the stored `divergence`/`relativeDivergence`; never `clUltimate − bfUltimate`), **no recomputed residuals/CVs/std-errs**, and **no totals or cross-element aggregates**. Chart **geometry** (bar heights, point positions, heat-cell colour buckets) is display layout derived from the stored values for rendering only — it produces **no displayed number**; every *printed* figure is a single format of one stored field. (AD-1)

**AC6 — Absent-not-empty semantics and honest empty states (matches the engine contract)**
Given a `complete` Run whose `diagnosticsBundle.clBfDivergence` is `null` (CL and BF did not both run),
When the Diagnostics tab renders,
Then the **CL-vs-BF divergence panel is absent** (not rendered empty) — `null` means "not applicable", mirroring the engine's deliberate "absent, not empty-but-present" distinction; the other three panels render normally.
And given a degenerate bundle (e.g. `n_dev == 1` → `ldfStability`/`ave`/`residuals` are empty arrays), each affected panel renders an **honest empty state** ("No LDF stability data for this Run.") rather than crashing.

**AC7 — Diagnostics remain fully viewable in Engine-Only Mode; no figures render before completion (FR-8, NFR-2, AD-1)**
Given Engine-Only Mode (simulated — model outage / cost-ceiling breach that fails Interpretation closed, AD-9),
When the Diagnostics tab renders,
Then **all four Diagnostics remain fully viewable** — the panels depend only on the engine-produced `diagnosticsBundle` and have **no** dependency on any Interpretation/agent state, so they render unconditionally (FR-8, NFR-2).
And given a Run that is `queued`/`running`/`failed` (no stored `diagnosticsBundle`), the tab shows the neutral empty state ("Diagnostics appear once the Run completes.") and renders **zero** diagnostic figures — the `getDiagnosticsBundle` subscription is `"skip"`ped until `hasDiagnostics`; once the Run flips to `complete` the panels appear reactively via the Convex subscription with **no polling** (FR-20, AD-1).

## Scope Boundary (read first)

This story is the **read-only rendering of the stored `DiagnosticsBundle`** — the second of Epic 4's three review surfaces (4.4 Results, **4.5 Diagnostics**, 4.6 context rail + deep-linking). Story 2.4 computed the four Diagnostics in `reserving_engine` and fixed the Diagnostic-ID scheme; Story 4.2 stored the `diagnosticsBundle` on the `runs` row; Story 4.3 built the Run-detail page, step rail, live status, and the four-tab strip with a **placeholder** Diagnostics body ("Diagnostics render in a later story (4.5)"); Story 4.4 established the exact pattern this story copies — a second lean guarded read query (`getResultSet`) + a prop-driven render component + the `provenance` token family + `lib/formatNumber` + jsdom specs. Story 4.5 replaces the Diagnostics placeholder with the four real panels and adds the one new read query the panels need.

**In scope:**
- **`convex/runs.ts` — `getDiagnosticsBundle` public query** (the DiagnosticsBundle read surface). `requireMember` → tenancy `null`-on-miss → `return run.diagnosticsBundle ?? null`. **Copy `getResultSet` (`runs.ts`, added in 4.4) verbatim in shape** — only the returned field changes (`diagnosticsBundle` not `resultSet`). Returns the **stored bundle verbatim** (no projection, no re-shaping — AD-1 "verbatim"). `getRun` and `getResultSet` are **not** touched.
- **`components/DiagnosticsPanels.tsx`** (**new**) — the four-panel container. Pure, prop-driven: takes the `DiagnosticsBundle` + `runId`. Renders the four panels in the mockup's 2-column data grid; **omits the CL-vs-BF panel when `clBfDivergence === null`** (AC6). No hooks/data-fetching (the page fetches).
- **`components/diagnostics/LdfStabilityPanel.tsx`** (**new**) — small-multiple charts from `ldfStability[]` (inline SVG — there is **no** charting library; the mockup hand-rolls `<svg>`), each with a Diagnostic-ID anchor and an accessible table toggle (AC2/3/4).
- **`components/diagnostics/ActualVsExpectedPanel.tsx`** (**new**) — the latest-diagonal `<table>` from `ave[]` (Origin · Actual · Expected · A−E · A/E), deviations mono-printed verbatim, per-row Diagnostic-ID anchor (AC2/3/5).
- **`components/diagnostics/ClBfDivergencePanel.tsx`** (**new**) — per-Origin bars (inline SVG or flex `div` bars, mockup idiom) from `clBfDivergence[]`, each with a Diagnostic-ID anchor and an accessible table toggle. Rendered only when the array is non-null (AC2/6).
- **`components/diagnostics/ResidualHeatmap.tsx`** (**new**) — the Origin×Development grid from `residuals[]`, diverging blue↔amber ramp, **value printed in every cell**, real table semantics, per-cell Diagnostic-ID anchor (AC2/3/4).
- **`components/diagnostics/DiagnosticId.tsx`** (**new**) — the small reusable **provenance-violet, hoverable, keyboard-focusable** Diagnostic-ID anchor rendering one `element.id` (AC3). This is **not** the citation chip (that is Interpretation, Epic 5 — a different component). It is the "Diagnostic ID reference" licensed provenance use (DESIGN.md:89).
- **`components/diagnostics/AccessibleChart.tsx`** (**new**) — a tiny shared wrapper giving a chart a "Show data table" toggle (local `useState`), so the LDF and divergence panels don't each hand-roll the toggle (one implementation, no drift). Renders `chart` or `table` children.
- **`lib/formatNumber.ts`** (**edit**) — add the display-only formatters the Diagnostics figures need (all `Intl.NumberFormat`, display formatting only — AD-1): `formatPercent(value: number | null)` (percent style, for `actualToExpectedRatio`/`relativeDivergence`), `formatSignedFigure(value: number | null)` (`signDisplay: "exceptZero"`, for the signed `actualMinusExpected`/`divergence`), and a residual formatter (fixed 1–2 fraction digits; `formatFactor` may be reused if its 2–4 range suits). Reuse the existing `formatFigure`/`formatFactor`. Document each.
- **`components/RunDetail.tsx`** (**edit**) — the Diagnostics `TabsContent` renders `<DiagnosticsPanels diagnosticsBundle={diagnosticsBundle} runId={run._id} />` when a `diagnosticsBundle` prop is present, else the existing neutral placeholder (mirrors the 4.4 Results-tab wiring exactly). Extend the props with `diagnosticsBundle?: DiagnosticsBundle | null`. Remove the "Diagnostics render in a later story (4.5)." string.
- **`app/(app)/runs/[runId]/page.tsx`** (**edit**) — add `const diagnosticsBundle = useQuery(api.runs.getDiagnosticsBundle, orgId && run?.hasDiagnostics ? { workspaceId: orgId, runId } : "skip")` (gate on `hasDiagnostics`, exactly like the 4.4 `getResultSet` gate on `hasResults`); pass `diagnosticsBundle ?? null` into `RunDetail`. The page owns all three subscriptions (`getRun`, `getResultSet`, `getDiagnosticsBundle`); components stay prop-driven.
- **Tests:** convex-test for `getDiagnosticsBundle` (verbatim return + `null` when no bundle + tenancy `null`); extend `convex/authGuard.test.ts`; jsdom specs for the panels (verbatim figures per panel, **no-arithmetic probe**, absent-not-empty CL-vs-BF, Diagnostic-ID anchors present, accessible table toggle reveals the same data, heatmap prints cell values); extend `tests/run-detail.test.tsx` (pass a `diagnosticsBundle` fixture / `null`; Engine-Only simulation).
- **Docs:** `deferred-work.md` 4.5 section.

**Explicitly OUT of scope (do NOT build — later stories own them):**
- **The Diagnostic context rail** (right rail that fills with a selected element's values, Diagnostic ID, "cited by N report claims" backlinks; empty state "Select any diagnostic element") → **Story 4.6**. The mockup (`diagnostics-review.html`) shows this rail — **it is 4.6, not 4.5.** Build the four panels and the ID anchors only; no rail.
- **Selecting an element** (click, or arrow-key navigation + `Enter`, to populate the rail) and **`Esc`-returns-to-grid** → **Story 4.6**. In 4.5 the Diagnostic-ID anchors are hoverable/focusable identity affordances that do **not** yet drive a selection or a rail.
- **`/runs/{id}/diagnostics#<diagnosticId>` deep-linking** (scroll-to + highlight the addressed element) and the **bottom-sheet on `md`** → **Story 4.6**. Do not add URL-hash handling or DOM scroll-target `id` attributes here.
- **"Cited by N report claims" backlinks** → **Story 4.6** (populated once Interpretation exists, Epic 5).
- **Citation chips** (the Interpretation claim→Diagnostic affordance) → **Epic 5**. The `DiagnosticId` anchor here is a plain ID reference, not the interactive citation chip.
- **ResultSet/DiagnosticsBundle re-derivation from Lineage** → Story 4.7. This surface *displays* stored diagnostics; it does not re-execute the engine.
- **Any change to `getRun`, `getResultSet`, the 4.2 orchestration, `engine_service`, `reserving_engine`, or the schemas.** The `diagnosticsBundle` field, its validator, and the Diagnostic-ID scheme already exist (Stories 2.4/4.2) — **import and render them; compute nothing.** `uv run pytest` stays green untouched — **no engine edits.**

## Tasks / Subtasks

- [x] **Task 1 — `getDiagnosticsBundle` public query: the verbatim DiagnosticsBundle read surface (AC: 1, 7)**
  - [x] `convex/runs.ts` → add `export const getDiagnosticsBundle = query({ args: { workspaceId: v.string(), runId: v.id("runs") }, … })`. **First statement `await requireMember(ctx, workspaceId)`** (AD-4). Then `const run = await ctx.db.get(runId); if (run === null || run.workspaceId !== workspaceId) return null;` (tenancy — existence never leaks, exact shape of `getResultSet`/`getRun`/`triangles.getById`).
  - [x] `return run.diagnosticsBundle ?? null;` — the **stored bundle verbatim** (typed `DiagnosticsBundle | null`). Do **not** re-project, re-key, or omit fields (AC5 requires verbatim). A `queued`/`running`/`failed` run has `run.diagnosticsBundle === undefined` → returns `null`.
  - [x] Doc comment mirroring `getResultSet`'s: this is the DiagnosticsBundle surface `getRun` deferred (getRun stays lean; this returns the bundle only for the Diagnostics tab, subscribed only when `hasDiagnostics`). Cite AD-1 (figures/diagnostics live here, not in `getRun`).
  - [x] `npx convex codegen` (publishes `api.runs.getDiagnosticsBundle`).

- [x] **Task 2 — Shared formatters + Diagnostic-ID anchor + accessible-chart wrapper (AC: 2, 3, 4, 5)**
  - [x] `lib/formatNumber.ts` (**edit**): add `formatPercent(value: number | null, nullText = "—")` (`Intl.NumberFormat("en-US", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 })` — display-only; renders `actualToExpectedRatio` 0.964 → "96.4%") and `formatSignedFigure(value: number | null, nullText = "—")` (`{ signDisplay: "exceptZero" }` grouping — renders a signed `actualMinusExpected`/`divergence`). Decide residual precision (reuse `formatFactor`, or add `formatResidual` fixed 2 d.p.) and document it. **All are `Intl.NumberFormat` display formatting — no arithmetic** (AD-1). Keep the existing `formatFigure`/`formatFactor` and their `TriangleGrid`/`ResultsGrid` callers unchanged.
  - [x] `components/diagnostics/DiagnosticId.tsx` (**new**): props `{ id: string; className?: string }`. Renders the stored `id` as a small `numeric` (Geist Mono ~11px) anchor in the `provenance` token family (`text-provenance`), keyboard-focusable (`tabIndex={0}` or a `<button>`-like element), with `title={id}` (hover reveals full ID). **No** click handler that navigates/selects (4.6 owns that) — but keep the element addressable (a stable, semantic anchor 4.6 can attach selection/`id=` to). This is the licensed provenance use (DESIGN.md:89,126); do **not** use violet anywhere else in the panels.
  - [x] `components/diagnostics/AccessibleChart.tsx` (**new**): props `{ label: string; chart: ReactNode; table: ReactNode }`. Local `useState<boolean>` toggles a "Show data table" / "Show chart" button (accessible name references `label`); renders `chart` or `table`. One implementation reused by the LDF and divergence panels (AC4). Chart region gets an `aria-label`; the toggle is a real `<button>`.

- [x] **Task 3 — LDF stability small-multiples panel (AC: 2, 3, 4, 5, 6)**
  - [x] `components/diagnostics/LdfStabilityPanel.tsx` (**new**), props `{ elements: DiagnosticsBundle["ldfStability"] }`. Panel header "LDF stability by development period" + the ID range (`did` in the mockup). For each element render a **small-multiple**: an inline `<svg>` plotting the `linkRatios[].factor` series (one point per origin) with the `selectedFactor` marked (mockup lines 64-69 idiom). Min/max of the factor series set the y-scale — **display geometry only, no printed derived number** (AD-5/AC5). Each small-multiple carries its `<DiagnosticId id={element.id} />`.
  - [x] Wrap the chart in `<AccessibleChart>` whose `table` view is a real `<table>`: columns `Dev transition (fromDev→toDev) · Selected factor · σ · Std err · CV`, one row per element, values via `formatFactor`/`formatFigure` (σ/stdErr/cv are stored fields — print verbatim). Row header carries the Diagnostic ID.
  - [x] Empty `elements` → honest empty state ("No LDF stability data for this Run.") (AC6, degenerate `n_dev==1`).

- [x] **Task 4 — Actual-vs-Expected panel (AC: 2, 3, 5)**
  - [x] `components/diagnostics/ActualVsExpectedPanel.tsx` (**new**), props `{ elements: DiagnosticsBundle["ave"] }`. A real `<table>` (`<caption class="sr-only">`, `<th scope>`), columns **Origin · Actual · Expected · A−E · A/E**. Per `ave[k]`: `<th scope="row">` = origin (with a `<DiagnosticId id={element.id} />` anchor), then `numeric tabular-nums text-right` `<td>`s: `formatFigure(actual)`, `formatFigure(expected)`, `formatSignedFigure(actualMinusExpected)`, `formatPercent(actualToExpectedRatio)`.
  - [x] **AD-1:** render the **stored** `actualMinusExpected` and `actualToExpectedRatio` — do **NOT** compute `actual − expected` or `ratio − 1` in React (that is the sharpest arithmetic temptation on this surface; the mockup's "Dev %" is engine-provided, not client-derived). Deviations are **mono-printed** (UX-DR6). Colour (caution amber for adverse) may annotate the sign but the sign/number is always printed (AC4, colour never sole).
  - [x] Empty `elements` → honest empty state.

- [x] **Task 5 — CL-vs-BF divergence panel (absent-not-empty) (AC: 2, 3, 4, 5, 6)**
  - [x] `components/diagnostics/ClBfDivergencePanel.tsx` (**new**), props `{ elements: NonNullable<DiagnosticsBundle["clBfDivergence"]> }` — the container only mounts it when non-null. Per-Origin **bars** (inline SVG or flex `div` bars, mockup lines 84-95 idiom): bar height ∝ `|divergence|` normalised to the max `|divergence|` across elements — **display geometry only** (AC5; `Math.max` for the axis scale produces no printed number). Each bar carries its `<DiagnosticId id={element.id} />` and its origin label.
  - [x] Wrap in `<AccessibleChart>` whose `table` view has columns `Origin · CL ultimate · BF ultimate · Divergence · Relative`: `formatFigure(clUltimate)`, `formatFigure(bfUltimate)`, `formatSignedFigure(divergence)`, `formatPercent(relativeDivergence)` — all **stored**, never `clUltimate − bfUltimate` (AC5).
  - [x] **Container (`DiagnosticsPanels`) mounts this panel ONLY when `diagnosticsBundle.clBfDivergence !== null`** — absent, not empty (AC6). When present but empty array (shouldn't happen for a valid non-null bundle), render the honest empty state.

- [x] **Task 6 — Residual heatmap panel (value printed, blue↔amber) (AC: 2, 3, 4, 5)**
  - [x] `components/diagnostics/ResidualHeatmap.tsx` (**new**), props `{ elements: DiagnosticsBundle["residuals"] }`. Build a grid keyed by Origin (rows) × Development transition `fromDev→toDev` (columns) from `residuals[]` (derive the row/column axes by collecting the distinct `origin` and `fromDev`/`toDev` labels present — **string bucketing, not arithmetic**). Real table semantics (`<th scope>` for origin rows and dev columns).
  - [x] Each cell: background from a **diverging blue↔amber ramp** keyed by the sign/magnitude of `residual` (negative→blue `#DBEAFE`/`#EFF6FF`, ~0→neutral `#F9FAFB`, positive→amber `#FEF3E2`/`#FDE8C8`/`#FDBA5B`, mockup lines 100-104) — **colour is annotation** (bucketing the value into a ramp step is display, not a printed number); and the **`residual` value is ALWAYS printed in the cell** at `numeric` (the datum), via `formatFactor`/`formatResidual`. Cell carries its `<DiagnosticId id={element.id} />` (e.g. as the cell's `title`/anchor). **Never red↔green; never colour-only** (DESIGN.md:130,139; EXPERIENCE.md:108).
  - [x] Empty `elements` → honest empty state. No accessible-table toggle needed (values are already printed in a real table — note this in the panel; AC4).

- [x] **Task 7 — Wire the Diagnostics tab + page query (AC: 2, 7)**
  - [x] `components/RunDetail.tsx`: extend props with `diagnosticsBundle?: DiagnosticsBundle | null` (import the type from `@/convex/lib/engineContract`). In the Diagnostics `TabsContent`, render `diagnosticsBundle ? <DiagnosticsPanels diagnosticsBundle={diagnosticsBundle} runId={run._id} /> : <TabPlaceholder>{run.hasDiagnostics ? "Loading diagnostics…" : "Diagnostics appear once the Run completes."}</TabPlaceholder>`. Remove the "Diagnostics render in a later story (4.5)." string. Import `DiagnosticsPanels`. (Exact mirror of the 4.4 Results-tab edit.)
  - [x] `app/(app)/runs/[runId]/page.tsx`: add `const diagnosticsBundle = useQuery(api.runs.getDiagnosticsBundle, orgId && run?.hasDiagnostics ? { workspaceId: orgId, runId } : "skip");` (gate on `run?.hasDiagnostics` so it only fires once the bundle exists — AC7). Pass `diagnosticsBundle={diagnosticsBundle ?? null}` into `<RunDetail …>`. Keep the existing `getRun`/`getResultSet`/retry wiring unchanged.
  - [x] Confirm no diagnostic figures render before `complete`: with `hasDiagnostics` false the query is `"skip"`ped and `diagnosticsBundle` is `undefined → null`, so the placeholder shows (AC7).

- [x] **Task 8 — Convex tests: `getDiagnosticsBundle` (AC: 1, 7)**
  - [x] `convex/runs.test.ts` (extend): reuse the existing `makeDiagnosticsBundle` fixture and `seedCompleteRun`/`seedRun` helpers (already present, lines ~477-511, 867-882) — but note the current `makeDiagnosticsBundle` returns **empty arrays**; add a **populated** fixture (≥1 element per kind incl. a non-null `clBfDivergence`) so the verbatim assertion is meaningful.
    - **Verbatim return:** a member of `org_A` reading a `complete` run returns the **exact** stored `diagnosticsBundle` (deep-equal, incl. non-null `clBfDivergence`, `ldfStability[].linkRatios`, `residuals[].residual`); nothing dropped/re-shaped.
    - **`null` when no bundle:** a `queued`/`running`/`failed` run returns `null`.
    - **Tenancy:** a member of Workspace B reading Workspace A's run returns `null` (no leak).
  - [x] `convex/authGuard.test.ts`: add `"runs:getDiagnosticsBundle": { workspaceId: "org_test" }` to `publicFunctionArgs` and add the path to the `runId`-injection branch (alongside `getRun`/`getResultSet`/`retryRun`). Public → the enumeration fails the build until registered (by design).
  - [x] `tests/audit-append-only.test.ts` stays green **unmodified** — `getDiagnosticsBundle` is a **read** query (no `auditLogs` writer).

- [x] **Task 9 — Component tests + full gates (AC: 2, 3, 4, 5, 6, 7)**
  - [x] `tests/diagnostics-panels.test.tsx` (**new**, `// @vitest-environment jsdom`): render `DiagnosticsPanels` with a fixture bundle (populated `ldfStability`, `ave`, non-null `clBfDivergence`, `residuals`).
    - **All four panels present** with headers; each element's **Diagnostic ID** (`element.id`, `dx:…`) appears (anchor present).
    - **Verbatim figures:** AvE `actualMinusExpected`/`actualToExpectedRatio`, divergence `divergence`/`relativeDivergence`, and residual values render from the fixture (not recomputed).
    - **No-arithmetic probe:** pick fixture values where `actual − expected` and `clUltimate − bfUltimate` differ from the stored `actualMinusExpected`/`divergence` (i.e. put a **distinct** stored value in the fixture) and assert the **stored** value is shown and the **naive-recomputed** value string is **absent** — guards AD-1 (the component reads, never computes).
    - **Accessible table toggle:** the LDF and divergence panels expose a "Show data table" control that reveals a `<table>` with the same values.
    - **Heatmap prints values:** each residual value string is present in the heatmap cells; assert `numeric` class on cells.
    - **Absent-not-empty:** rendering with `clBfDivergence: null` → the CL-vs-BF panel is **not** in the DOM; the other three render.
    - **Degenerate:** empty arrays → honest empty-state strings, no throw.
  - [x] `tests/run-detail.test.tsx` (**extend**): add a case passing a `diagnosticsBundle` fixture → the Diagnostics tab shows the panels (a Diagnostic ID / a residual value present); a `null` bundle with `hasDiagnostics:false` → the "appear once complete" placeholder. **Engine-Only simulation:** render `RunDetail` with a `diagnosticsBundle` but **no** interpretation-related props (there are none) and assert the panels render fully — documenting that Diagnostics have no Interpretation dependency (AC7). Keep all 4.3/4.4 assertions green.
  - [x] **Full gates green before → review:** `npm test` (unit + convex projects), root `npx tsc --noEmit` + `npx tsc -p convex/tsconfig.json --noEmit`, `npm run lint`, `npm run build` (recompiles the `/runs/[runId]` route), and `cd engine && uv run pytest` (**unchanged** — no engine edits; keep green). Leave the single Playwright smoke as-is.

## Dev Notes

### This story fills 4.3's Diagnostics placeholder — a *third* lean query, exact twin of 4.4's `getResultSet` (AD-1, AD-3)

Story 4.3 built the Run-detail page with a four-tab strip and a Diagnostics **placeholder**, and kept `getRun` deliberately figure-free. Story 4.4 added `getResultSet` and the Results grid. Story 4.5 is the **structural twin**: add exactly one new **read** query — `getDiagnosticsBundle` — that returns the stored bundle verbatim, and the Diagnostics tab subscribes to it **only when `hasDiagnostics`**. The reasons a separate query (not fattening `getRun`) are identical to 4.4's:
1. **Leanness / separation (AD-1, AD-3):** `getRun` is the hot live-status subscription; it stays a small projection. The DiagnosticsBundle is large and immutable-once-stored — fetched once, when complete, by the surface that needs it.
2. **Verbatim contract (AC5):** `getDiagnosticsBundle` returns `run.diagnosticsBundle` with **no** re-projection, so "every value is from the stored bundle verbatim" is guaranteed by construction.

Convex `useQuery` is a live subscription: when a running Run flips to `complete` and `storeResultSet` patches the row (it stores **both** the ResultSet and the DiagnosticsBundle in one completion — `runs.ts` `storeResultSet`), the gated `getDiagnosticsBundle` (previously `"skip"`ped) activates and the panels appear reactively — no polling (FR-20, AC7).

### The exact DiagnosticsBundle shape to render (camelCase; kinds stay snake_case)

Source of truth: `reserving_engine/diagnostics.py`, mirrored 1:1 by `convex/lib/engineContract.ts` (`diagnosticsBundleValidator`, lines 82-137; type `DiagnosticsBundle` at line 200 — drift-checked in CI). Render only these fields; **compute nothing**.

```
DiagnosticsBundle {
  schemaVersion: string
  runId: string
  triangleHash: string
  ldfStability: {
    id: string                 // dx:{runId}:ldf_stability:{fromDev}
    fromDev: string; toDev: string
    selectedFactor: number
    linkRatios: { origin: string; factor: number }[]   // the factor series (small-multiple points)
    sigma: number | null; stdErr: number | null; cv: number | null
  }[]
  ave: {
    id: string                 // dx:{runId}:ave:{origin}
    origin: string; fromDev: string; toDev: string
    actual: number; expected: number
    actualMinusExpected: number            // signed — RENDER THIS, do not compute actual−expected
    actualToExpectedRatio: number | null   // A/E — RENDER THIS as %, do not compute ratio−1
  }[]
  clBfDivergence:                          // null when CL and BF did not BOTH run — panel absent, not empty
    | { id: string;            // dx:{runId}:cl_bf_divergence:{origin}
        origin: string; clUltimate: number; bfUltimate: number;
        divergence: number;                // signed — RENDER THIS, not clUltimate−bfUltimate
        relativeDivergence: number | null } []
    | null
  residuals: {
    id: string                 // dx:{runId}:residual:{origin}:{fromDev}
    origin: string; fromDev: string; toDev: string
    residual: number           // printed in every heat cell
  }[]
}
```

The Diagnostic **kind** strings (`ldf_stability`, `ave`, `cl_bf_divergence`, `residual`) are baked into the stored IDs forever (spine AD-10) — you never mint or parse them; you render `element.id` verbatim as the anchor.

### AD-1 is the whole story again — display-formatting + chart geometry only, zero arithmetic

The Constitution: *"Every number originates in `reserving_engine`. … No arithmetic on reserve figures in Convex functions, React components (display formatting only), prompts, or export code."* This surface is even more arithmetic-tempting than the Results grid, because diagnostics *look* like derived quantities. The bright lines:
- **No recomputed deviations.** The AvE panel renders the **stored** `actualMinusExpected` (signed) and `actualToExpectedRatio` (as %). Do **NOT** write `actual - expected` or `ratio - 1` — the engine already computed the deviation; React reads it. (The mockup's "Dev %" is illustrative of a *stored* engine figure.)
- **No recomputed divergences.** The divergence panel renders the **stored** `divergence` and `relativeDivergence`. Never `clUltimate - bfUltimate`.
- **No totals / aggregates.** No summed residuals, no average CV, no "total divergence."
- **Chart geometry is display, not arithmetic — but it must never become a printed number.** Bar heights (`|divergence| / maxAbs`), small-multiple point y-positions (from the factor series min/max), and heat-cell colour buckets are **layout** derived from stored values to place pixels/colours — the same category as `Intl.NumberFormat` grouping (AD-1's "display formatting only"). The invariant: **no number you display is computed** — every *printed* figure is a single `format*()` of exactly one stored field. `Math.max`/scaling for an axis is allowed *because its output is a pixel/colour, never shown as a figure*.
The `tests/diagnostics-panels.test.tsx` no-arithmetic probe (stored `actualMinusExpected`/`divergence` set **distinct** from the naive recomputation; assert the naive value's string is **absent**) is the structural guard — keep it.

### Diagnostic-ID anchors: the identity affordance, in provenance violet (UX-DR10, DESIGN.md:89)

UX-DR10 / EXPERIENCE.md:70: "every element carries its Diagnostic ID as a hoverable anchor." The stored `element.id` (`dx:{runId}:{kind}:{key}`) **is** that identity — render it verbatim in the `provenance` token family (violet is licensed for Diagnostic-ID references, DESIGN.md:89,126; use it for **nothing else** in these panels). Keep the anchor **hoverable** (full ID in `title`/tooltip) and **keyboard-focusable**.

**Scope discipline — this is NOT the context rail and NOT the citation chip.** The mockup (`diagnostics-review.html`) shows a right context rail (selected element → values, CV, "cited by N report claims", deep-link) — **that entire rail is Story 4.6.** In 4.5 the anchor is an identity label only: no click-to-select, no rail population, no `#<id>` scroll target, no backlinks. Build it as a stable, semantic, addressable element so 4.6 can attach selection + a DOM `id` mechanically — but wire none of that behaviour now. The `DiagnosticId` component is also **not** the interactive citation chip (`DESIGN.md {components.citation-chip}`), which is an Interpretation-claim affordance in Epic 5.

### Absent-not-empty: the CL-vs-BF panel disappears when both methods didn't run (AC6)

Story 2.4 fixed a deliberate distinction: `clBfDivergence` is `null` (not `[]`) when CL and BF did **not** both run — `null` means "not applicable", `[]` would falsely claim "computed, nothing found." Honour it in the UI: when `diagnosticsBundle.clBfDivergence === null`, **omit the panel entirely** (don't render an empty card). The container decides this; the panel component receives a `NonNullable<…>` array. Degenerate bundles (`n_dev == 1` → empty `ldfStability`/`ave`/`residuals`) still render their panels but with an honest empty state.

### Engine-Only Mode: diagnostics are pure engine output, so they render unconditionally (FR-8, NFR-2, AD-9)

Engine-Only Mode is the fail-closed state when Interpretation can't run (model outage / per-Run cost-ceiling breach, AD-9). The AC ("all Diagnostics remain fully viewable") is satisfied **structurally**: `DiagnosticsPanels` depends only on the engine-produced `diagnosticsBundle` prop and has **zero** dependency on any Interpretation/agent/model state. There is no code path in this story that could gate a panel on Interpretation availability — so "simulating Engine-Only Mode" is simply rendering the panels without any interpretation context (there is none) and asserting they're fully present. Do **not** add an Engine-Only banner here — that banner is a **global** surface (EXPERIENCE.md:88), not this story's concern; 4.5 only guarantees the panels don't break when Interpretation is absent.

### No charting library — hand-roll inline SVG (mockup idiom)

`package.json` has **no** chart dependency (only `radix-ui` + `shadcn`). The mockup builds the LDF small-multiple as a hand-rolled `<svg><polyline/><circle/></svg>` and the divergence bars as flex `div`s with `%` heights — follow that idiom. Keep charts small, dependency-free, and accessible via the `AccessibleChart` table toggle. Do **not** add a charting package for this story.

### Reuse, do not reinvent (existing patterns)

- **Public query guard + tenancy + `null`-on-miss:** `convex/runs.ts` `getResultSet` (added in 4.4) and `getRun` — **copy `getResultSet`'s shape exactly** for `getDiagnosticsBundle`; only the returned field differs.
- **Second/third-query gating on a `has*` boolean:** `app/(app)/runs/[runId]/page.tsx` already gates `getResultSet` on `run?.hasResults` — add `getDiagnosticsBundle` gated on `run?.hasDiagnostics` the same way.
- **Prop-driven render component + Tab wiring:** `components/RunDetail.tsx` Results `TabsContent` (4.4) is the exact template for the Diagnostics `TabsContent` — `bundle ? <Panels…/> : <TabPlaceholder…/>`, prop typed `DiagnosticsBundle | null`.
- **Shared engine-figure formatters:** `lib/formatNumber.ts` (`formatFigure`/`formatFactor`) — **extend it** with `formatPercent`/`formatSignedFigure`; do not scatter new `Intl.NumberFormat`s across panels.
- **Real-`<table>` numeric grid semantics:** `components/TriangleGrid.tsx` and `components/ResultsGrid.tsx` — `<caption class="sr-only">`, `<th scope="col"/scope="row">`, `numeric tabular-nums text-right`, per-cell `aria-label`. Mirror for the AvE table, the chart table-toggles, and the heatmap.
- **Provenance token family + `numeric` utilities:** already wired in `app/globals.css` (`--color-provenance*` light+dark; `numeric`/`numeric-lg`) — reuse; **add no new tokens**. The exact heat-ramp hex values are in the mockup (lines 100-104).
- **jsdom component-spec conventions:** `tests/results-grid.test.tsx` / `tests/run-detail.test.tsx` — `// @vitest-environment jsdom`, plain-prop fixtures, `@testing-library/react`, `afterEach(cleanup)`.
- **Convex fixtures/helpers:** `convex/runs.test.ts` `makeDiagnosticsBundle` / `seedCompleteRun` / `seedRun` — reuse; **populate** the bundle fixture (the current one is all-empty).

### Prop-driven components, page owns data (4.3/4.4 architecture, keep it)

The **page** owns the Convex subscriptions (`getRun`, `getResultSet`, and now `getDiagnosticsBundle`) and passes plain props into `RunDetail`; `DiagnosticsPanels` and all four panel components take plain props (`diagnosticsBundle`/`elements`, `runId`) and are jsdom-testable without mocking `convex/react`. Preserve this — it keeps the new specs fixture-driven and the existing `run-detail` specs from needing new hook mocks.

### Project Structure Notes

- **New:** `components/DiagnosticsPanels.tsx`, `components/diagnostics/LdfStabilityPanel.tsx`, `components/diagnostics/ActualVsExpectedPanel.tsx`, `components/diagnostics/ClBfDivergencePanel.tsx`, `components/diagnostics/ResidualHeatmap.tsx`, `components/diagnostics/DiagnosticId.tsx`, `components/diagnostics/AccessibleChart.tsx`, `tests/diagnostics-panels.test.tsx`. (A `components/diagnostics/` subfolder groups the four panels + shared bits; the container stays at `components/DiagnosticsPanels.tsx`. This is the first component group large enough to warrant a subfolder — flat `components/` is fine for the container. If you prefer strict flatness to match the repo, keep them flat and note it; either is acceptable.)
- **Edit:** `convex/runs.ts` (`getDiagnosticsBundle` query), `lib/formatNumber.ts` (`formatPercent`/`formatSignedFigure` [+ residual]), `components/RunDetail.tsx` (Diagnostics tab → `DiagnosticsPanels`; `diagnosticsBundle` prop), `app/(app)/runs/[runId]/page.tsx` (add `getDiagnosticsBundle` subscription gated on `hasDiagnostics`; pass `diagnosticsBundle`), `convex/runs.test.ts` (getDiagnosticsBundle tests + populated fixture), `convex/authGuard.test.ts` (register `runs:getDiagnosticsBundle` + inject `runId`), `tests/run-detail.test.tsx` (diagnosticsBundle case + Engine-Only sim).
- **Regen:** `npx convex codegen` after the `runs.ts` addition (publishes `api.runs.getDiagnosticsBundle`).
- **No change:** `convex/runs.ts` `getRun`/`getResultSet`/`retryRun`/orchestration internals, `convex/schema.ts` (the `diagnosticsBundle` field 4.2 added is exactly what `getDiagnosticsBundle` returns — no schema change), `convex/auditLogs.ts` (no new writer — read query), `convex/lib/engineContract.ts` (the `diagnosticsBundleValidator`/`DiagnosticsBundle` type already model the bundle — import them), any `engine/` file (`pytest` stays green).
- **Doc:** append a 4.5 section to `deferred-work.md` (Diagnostic-ID friendly-label vs canonical `dx:` id decision; heat-ramp threshold choice; whether the panels should later share a numeric-grid primitive with ResultsGrid/TriangleGrid; anything the context-rail (4.6) will need to attach to the anchors).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.5] — story statement + ACs (lines 506-521); Epic 4 summary (430-432)
- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.6] — the context rail, element selection, `#<diagnosticId>` deep-linking, "cited by N" backlinks, md bottom-sheet (lines 523-539) — **all OUT of scope here**
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-agentic-reserving-2026-07-16/EXPERIENCE.md] — the four panels named (143), Diagnostic panel = hoverable-ID anchor (70), context rail is a separate element (71, 145 — 4.6), charts ship with an accessible table toggle (113), diagnostics never encode meaning in colour alone / heatmap prints values (108), Engine-Only Mode is a global banner not per-panel (88), WCAG 2.2 AA floor (106), md bottom-sheet precedent (120 — 4.6), arrow-key/Enter/Esc grid nav (99 — 4.6)
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-agentic-reserving-2026-07-16/mockups/diagnostics-review.html] — composition reference: 2-col panel grid, LDF small-multiple `<svg>` idiom (64-69), AvE table with mono deviations (72-82), divergence flex bars (84-95), residual heat grid + exact blue↔amber hex ramp with value-in-cell (97-105). **The right `<aside class="rail">` (108-121) is Story 4.6 — do not build.** Spine wins on conflict.
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-agentic-reserving-2026-07-16/DESIGN.md] — provenance violet exclusive to citation chips / Diagnostic-ID references / Lineage links (89, 126); Diagnostic heat cell = diverging blue↔amber, value printed at `numeric`, colour is annotation (130); Do/Don't: diverging blue↔amber not red↔green, never colour-only (139); `numeric`/`numeric-lg` Geist Mono tokens (30-37, 100); provenance token values (14-19)
- [Source: _bmad-output/planning-artifacts/architecture/architecture-agentic-reserving-2026-07-16/ARCHITECTURE-SPINE.md] — AD-1 numbers only from the engine / no arithmetic in React (the Constitution); AD-4 requireMember-first; AD-3 Convex sole system of record; AD-9 Engine-Only Mode fail-closed (diagnostics keep working); AD-10 DiagnosticsBundle schema + Diagnostic-ID scheme is the cross-runtime contract; FR-20 live status via subscription (no polling); NFR-2 diagnostics viewable without interpretation
- [Source: convex/lib/engineContract.ts:82-137, 200] — `diagnosticsBundleValidator` + the four element validators (field names, nullability, camelCase, `clBfDivergence` null-union) and the `DiagnosticsBundle` type to import
- [Source: convex/runs.ts:480-502] — `getResultSet` (the guard/tenancy/`null`-on-miss shape to copy verbatim for `getDiagnosticsBundle`); [convex/runs.ts:455-478] — `getRun` (lean projection, `hasDiagnostics` boolean — stays unchanged)
- [Source: convex/schema.ts] — `runs.diagnosticsBundle: v.optional(diagnosticsBundleValidator)` (what `getDiagnosticsBundle` returns — no schema change)
- [Source: components/RunDetail.tsx:63-71, 172-178] — the props shape + the Diagnostics `TabsContent` placeholder this story replaces (the 4.4 Results-tab wiring at 160-170 is the exact template)
- [Source: app/(app)/runs/[runId]/page.tsx:32-44, 82-90] — the page skeleton + the `getResultSet` gate-on-`hasResults` pattern to copy for `getDiagnosticsBundle` gate-on-`hasDiagnostics`
- [Source: components/ResultsGrid.tsx, components/TriangleGrid.tsx] — the real-`<table>` / `numeric tabular-nums` grid idiom + `lib/formatNumber.ts` (`formatFigure`/`formatFactor`) to extend; [components/methods.ts] — `methodLabel`
- [Source: convex/runs.test.ts:477-511, 867-882] — `makeDiagnosticsBundle` / `seedCompleteRun` / `seedRun` fixtures to reuse (populate the bundle); [convex/authGuard.test.ts] — `publicFunctionArgs` registry + `runId` injection to extend
- [Source: _bmad-output/implementation-artifacts/2-4-diagnostics-computation-with-diagnostic-ids.md] — the Diagnostic-ID scheme `dx:{runId}:{kind}:{key}`, per-kind keys, `clBfDivergence` absent-not-empty semantics, degenerate `n_dev==1` empties
- [Source: _bmad-output/implementation-artifacts/4-4-results-tab-with-provenance-popover.md] — the sibling pattern this story mirrors (lean guarded read query + prop-driven grid + provenance tokens + shared formatters + jsdom specs)
- [Source: _bmad-output/project-context.md] — Constitution (AD-1 no arithmetic outside the engine), requireMember-first, vocabulary (Diagnostic, DiagnosticsBundle, Origin/Development Period — never synonyms), diagnostics kinds fixed, "❌ Polling in application code"

## Dev Agent Record

### Agent Model Used

Amelia (dev agent) — claude-opus-4-8[1m].

### Debug Log References

All gates green on completion:
- `npm test` → **276 passed** (24 files; unit + convex projects — +14 over 4.4's 262).
- `npx tsc --noEmit` (root) → clean; `npx tsc -p convex/tsconfig.json --noEmit` → clean.
- `npm run lint` → clean (0 warnings).
- `npm run build` → success; `/runs/[runId]` recompiled.
- `cd engine && uv run pytest` → **205 passed, 9 skipped** (unchanged — no engine edits).

Three first-run test failures, all in the newly-authored `tests/run-detail.test.tsx` (not implementation bugs), fixed:
1. Switching to the Diagnostics tab via `getByRole("tab", { name: "Diagnostics" })` didn't reveal the panel content reliably under jsdom; switched to the proven step-rail `getByRole("button", { name: "Diagnostics" })` pattern the existing 4.3/4.4 tests use (`onSelectDiagnostics` → `setTab`).
2. The residual assertion expected `"+1.10"`, but `formatResidual` (no `signDisplay`) renders `"1.10"` — corrected.
3. After removing the unused `runId` prop from `DiagnosticsPanels` (lint warning), the test JSX still passed `runId={runId}` (excess prop) — stripped it and the now-unused `Id` import/const.

### Completion Notes List

- **AC1 (guarded verbatim query):** `runs.getDiagnosticsBundle` — `requireMember` first, tenancy `null`-on-miss, `return run.diagnosticsBundle ?? null` **verbatim** (exact structural twin of `getResultSet`). `getRun`/`getResultSet` left **unchanged**. Registered in `convex/authGuard.test.ts`; `tests/audit-append-only.test.ts` stays green unmodified (read query, no writer).
- **AC2 (four panels, verbatim, numeric):** `DiagnosticsPanels` renders LDF stability small-multiples (hand-rolled inline SVG — no chart lib), the AvE latest-diagonal table, CL-vs-BF divergence bars, and the residual heatmap. Every figure is a single `format*()` of one stored field in `numeric tabular-nums` cells.
- **AC3 (Diagnostic-ID anchors):** new `DiagnosticId` renders the stored `element.id` (`dx:…`) as a hoverable, keyboard-focusable violet chip on the tabular panels; the compact encodings (divergence bars, heat cells) carry the id as a hoverable `title`/`aria-label` anchor. Provenance violet used **only** for the IDs.
- **AC4 (accessible alternatives):** the two graphical panels (LDF, divergence) share `AccessibleChart` — a "Show data table" toggle that swaps the chart for a real `<table>`. The residual heatmap prints its value in every cell in a real table (self-accessible); AvE is already a table. Colour is never the sole signal (residual value printed, deviation sign explicit).
- **AC5 (zero arithmetic — AD-1):** every printed number is a stored field. The AvE panel renders stored `actualMinusExpected`/`actualToExpectedRatio` (never `actual − expected` / `ratio − 1`); divergence renders stored `divergence`/`relativeDivergence` (never `clUltimate − bfUltimate`). Chart geometry (bar heights `|divergence|/maxAbs`, small-multiple y-scale, heat-cell colour buckets) is display layout only — no displayed number is computed. `tests/diagnostics-panels.test.tsx` probes stored deviations/divergences set **distinct** from the naive recompute and asserts the naive strings (`-158`, `+113`/`113`) are **absent**.
- **AC6 (absent-not-empty):** the container mounts the CL-vs-BF panel **only** when `clBfDivergence !== null`; a degenerate/empty bundle renders honest empty states per panel (tested).
- **AC7 (Engine-Only Mode / no early figures):** the panels depend only on the engine-produced bundle — zero Interpretation dependency — so an "Engine-Only" render (no interpretation props exist) is fully viewable (tested). The page gates `getDiagnosticsBundle` on `run?.hasDiagnostics` (`"skip"` otherwise); the tab shows "Diagnostics appear once the Run completes." → "Loading diagnostics…" → panels, all reactive, no polling.
- **Reuse/refactor:** extended `lib/formatNumber.ts` with `formatPercent`/`formatSignedFigure`/`formatResidual` (all `Intl` display-only); mirrored the `getResultSet` query, the ResultsGrid/TriangleGrid `<table>` idiom, and the 4.4 prop-driven-page-owns-data architecture.
- **Scope discipline:** built the four panels + ID anchors only. The context rail, element selection, `#<diagnosticId>` deep-linking, "cited by N" backlinks, and the md bottom-sheet are **Story 4.6** and were not built. `DiagnosticsPanels`'s draft `runId` prop was removed (unused; 4.6 reintroduces it with the rail/deep-link). No engine/schema/orchestration edits (pytest unchanged).
- **Three items flagged for Rohan** (Dev Notes + deferred-work): friendly Diagnostic-ID label vs raw `dx:` id; residual heat-ramp threshold basis; whether 4.6 wants a uniformly visible id on the compact encodings.

### File List

**New:**
- `components/DiagnosticsPanels.tsx`
- `components/diagnostics/DiagnosticId.tsx`
- `components/diagnostics/AccessibleChart.tsx`
- `components/diagnostics/LdfStabilityPanel.tsx`
- `components/diagnostics/ActualVsExpectedPanel.tsx`
- `components/diagnostics/ClBfDivergencePanel.tsx`
- `components/diagnostics/ResidualHeatmap.tsx`
- `tests/diagnostics-panels.test.tsx`

**Edited:**
- `convex/runs.ts` (`getDiagnosticsBundle` public query)
- `convex/runs.test.ts` (`getDiagnosticsBundle` verbatim/null/tenancy tests + populated fixture)
- `convex/authGuard.test.ts` (register `runs:getDiagnosticsBundle` + inject `runId`)
- `lib/formatNumber.ts` (`formatPercent`/`formatSignedFigure`/`formatResidual`)
- `components/RunDetail.tsx` (Diagnostics tab → `DiagnosticsPanels`; `diagnosticsBundle` prop)
- `app/(app)/runs/[runId]/page.tsx` (add `getDiagnosticsBundle` subscription gated on `hasDiagnostics`; pass `diagnosticsBundle`)
- `tests/run-detail.test.tsx` (Diagnostics-tab + Engine-Only cases; updated the obsolete "later story" assertion)
- `_bmad-output/implementation-artifacts/deferred-work.md` (4.5 section)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (4.5 → in-progress → review)

**Regenerated:** `convex/_generated/*` (`npx convex codegen` — publishes `api.runs.getDiagnosticsBundle`).

## Change Log

| Date       | Version | Description                                                                 |
| ---------- | ------- | --------------------------------------------------------------------------- |
| 2026-07-19 | 0.1     | Story 4.5 drafted: Diagnostics tab renders the four panels (LDF stability small-multiples, Actual-vs-Expected latest-diagonal table, CL-vs-BF divergence bars [absent when null], residual heatmap blue↔amber with value-in-cell) from the stored DiagnosticsBundle verbatim with zero arithmetic (AD-1); new lean `getDiagnosticsBundle` guarded read query (getRun/getResultSet unchanged); per-element provenance-violet hoverable Diagnostic-ID anchors; accessible table toggles for the charts; Engine-Only Mode viewability by construction. Context rail + deep-linking held for Story 4.6. Status → ready-for-dev. |
| 2026-07-19 | 1.0     | Story 4.5 implemented: `getDiagnosticsBundle` verbatim read query + the four-panel `DiagnosticsPanels` (LDF small-multiples, AvE table, CL-vs-BF bars, residual heatmap) rendered from the stored bundle with zero arithmetic; new `DiagnosticId` (violet ID anchors), `AccessibleChart` (data-table toggle), and `formatPercent`/`formatSignedFigure`/`formatResidual`; page wires the gated third subscription; CL-vs-BF absent-not-empty; Engine-Only viewability by construction. All gates green (npm test 276; tsc root+convex; lint; build; pytest 205/9 unchanged). Status → review. |

### Review Findings (code review 2026-07-19)

- [x] [Review][Decision-Resolved] AC3 compact-encoding Diagnostic IDs — ACCEPTED: `title`/`aria-label` is sufficient on the dense bars/heatmap cells (the ID stays selectable and appears in the context rail). Closed as met.
- [x] [Review][Patch] Residual heatmap is unreadable in dark mode — `rampColor` returns hardcoded light hex backgrounds while the value text inherits the near-white foreground (WCAG contrast fail) [components/diagnostics/ResidualHeatmap.tsx rampColor]
- [x] [Review][Patch] A NaN residual falls through `rampColor` and is painted as strong-negative blue [components/diagnostics/ResidualHeatmap.tsx]
- [x] [Review][Patch] Empty heatmap cells are `<td aria-hidden="true">` — hiding a grid cell desynchronizes column/`<th scope>` association for screen readers [components/diagnostics/ResidualHeatmap.tsx]
- [x] [Review][Patch] `AccessibleChart` exposes a chart/table view swap as `aria-expanded` (announces collapse/expand) instead of `aria-pressed`/distinct labelling [components/diagnostics/AccessibleChart.tsx]
- [x] [Review][Defer] Heatmap `active`-cell state is seeded once and a `cellAt(r,c)!` non-null assertion assumes populated cells — stale if the same instance is reused for a different bundle without a `key` — deferred, immutable bundles make this rare
