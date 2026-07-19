---
baseline_commit: 0c07aa4cad2c85d5c751e326e4ca86754adadb1d
---

# Story 4.4: Results Tab with Provenance Popover

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an Analyst,
I want the ResultSet rendered in the triangle-grid texture with lineage on every figure,
so that every number on screen declares where it came from. (FR-5 display, UX-DR15)

## Acceptance Criteria

**AC1 — The Results tab renders every stored figure per Method per Origin Period, verbatim, in `numeric` type (FR-5 display, AD-1, UX-DR5)**
Given a `complete` Run (a stored `resultSet`),
When the Results tab renders,
Then for each Method in `resultSet.methodResults` it shows: per Origin Period the **ultimate** and **IBNR** (`originResults[].ultimate`, `.ibnr`); the **age-to-age LDFs** (`developmentFactors[]` as `fromDev → toDev : factor`); and for **Mack** additionally the per-Origin **standard error** and **reserve range** (`originResults[].mackStdErr`, `.reserveLow`, `.reserveHigh`) plus the method-level **total standard error** (`totalMackStdErr`). Every figure is set in the `numeric` (Geist Mono) utility, right-aligned with `tabular-nums`; all figures are **display-formatted only** (`Intl.NumberFormat("en-US")` grouping, `null → "—"`) — there is **no arithmetic on reserve figures in React** (no sums, totals, deltas, or `ibnr ± mackStdErr` recomputation; `reserveLow`/`reserveHigh` are read from the engine, never computed). (AD-1)

**AC2 — Every figure offers a "Where did this come from?" provenance popover carrying the run Lineage (UX-DR15)**
Given the rendered Results tab,
When a figure is activated (click / Enter or Space when focused / right-click / touch long-press),
Then a provenance popover opens showing all five Lineage items: **engine version** (`resultSet.lineage.engineVersion`), **chainladder version** (`resultSet.lineage.chainladderVersion`), the **canonical Triangle hash truncated and copyable** (`resultSet.lineage.triangleHash`, reusing the HashRow copy pattern), the **parameters** (`resultSet.lineage.parameters` — selected Methods and, when BF ran, the per-Origin a-priori loss ratios/exposures), and a **link toward the Run's audit trail** (keyed by `runId`). The popover chrome and the audit-trail link use the `provenance` (violet) token family — provenance is that colour's *only* licensed use (DESIGN.md:89). `Esc` closes it and returns focus to the triggering figure. (UX-DR15)

**AC3 — All figures are values from the stored ResultSet verbatim; no synthesized numbers; period-labelled per the voice rules (AD-1, UX-DR19)**
Given the rendered tab,
When inspected,
Then every number on screen is a field read directly from the stored `resultSet` (no client-side totals, no summed reserve, no cross-Method deltas, no percentage divergences) — the app renders exactly what the engine stored and nothing derived. **No "Total" row is synthesized** (the ResultSet has no total-ultimate/total-IBNR field; do not sum them). Each figure is period-labelled by its Origin-Period row header (LDFs by their development transition), and cell `aria-label`s announce origin/development + value in the TriangleGrid idiom ("Origin 2021, ultimate 4,213,000"). (AD-1, UX-DR19)

**AC4 — Results are exposed via a new guarded, tenancy-safe query returning the stored ResultSet verbatim; `getRun` stays lean (AD-4, AD-1)**
Given a new public query `runs.getResultSet`,
When it is exercised,
Then its **first statement is `await requireMember(ctx, workspaceId)`** (AD-4); it then re-checks tenancy (`run === null || run.workspaceId !== workspaceId → return null`, existence never leaks) and returns `run.resultSet ?? null` **verbatim** — the full stored ResultSet for a `complete` Run, `null` for a Run without one (queued/running/failed) or outside the Workspace. `runs.getRun` is **unchanged** — it stays the lean live-status projection (no figures), and the `resultSet` is fetched only by the Results tab, only when `hasResults`. The auth-guard enumeration (`convex/authGuard.test.ts`) registers `runs:getResultSet` and stays green. (AD-4)

**AC5 — The Results tab shows an honest empty state until the Run is complete; no figures render early (AD-1)**
Given a Run that is `queued`, `running`, or `failed` (no stored `resultSet`),
When the Results tab is viewed,
Then it shows the neutral empty state ("Results appear once the Run completes.") and renders **zero** reserve figures — the `getResultSet` subscription is `"skip"`ped (or returns `null`) until `hasResults`, so no figure leaks before completion. Once the Run flips to `complete`, the figures appear reactively via the Convex subscription with no polling and no reload (FR-20). (AD-1, FR-20)

**AC6 — Grid and popover meet the WCAG 2.2 AA floor (UX-DR18, UX-DR10)**
Given the Results tab,
When navigated by keyboard and screen reader,
Then the figures are laid out as real tables with announced row/column headers (`<th scope>`); the provenance trigger on each figure is keyboard-reachable and labelled ("Where did this come from? …"); the popover traps/returns focus correctly and closes on `Esc`; and on `md` viewports the popover follows the context-rail responsive precedent (bottom sheet or width-safe positioning — never a horizontally-overflowing body). Colour is never the sole signal. (UX-DR18, UX-DR10, WCAG 2.2 AA)

## Scope Boundary (read first)

This story is the **read-only rendering of the stored ResultSet** — the first of Epic 4's three review surfaces (4.4 Results, 4.5 Diagnostics, 4.6 context rail). Story 4.2 computed and stored the `resultSet` on the `runs` row; Story 4.3 built the Run-detail page, step rail, live status, and the four-tab strip with a **placeholder** Results body ("Results render in a later story (4.4)"). Story 4.4 replaces that placeholder with the real grid and adds the one new read query the figures need.

**In scope:**
- **`convex/runs.ts` — `getResultSet` public query** (the figure read surface). `requireMember` → tenancy `null`-on-miss → `return run.resultSet ?? null`. Mirrors `getRun`'s guard/tenancy shape exactly; returns the **stored ResultSet verbatim** (no projection, no re-shaping — AD-1 "verbatim"). `getRun` is **not** touched.
- **`components/ui/popover.tsx`** (**new**) — the shadcn/Radix Popover primitive (`import { Popover as PopoverPrimitive } from "radix-ui"`, matching `components/ui/tabs.tsx`). Gives focus management, `Esc`-to-close, outside-click dismissal, and collision-aware positioning for free. Style chrome with the `provenance` token family.
- **`components/ProvenancePopover.tsx`** (**new**) — wraps a figure as the "Where did this come from?" trigger and renders the run Lineage (AC2). Opens on click / keyboard (Radix default) **and** on right-click (`onContextMenu`, `preventDefault`) and touch long-press. Content: engine version, chainladder version, copyable truncated `triangleHash`, parameters (methods + BF a-prioris), audit-trail link (keyed by `runId`). The Lineage is **run-level** (identical for every figure), so one `ProvenancePopover` component is reused across all cells.
- **`components/ResultsGrid.tsx`** (**new**) — the per-Method grid (AC1/AC3). Pure, prop-driven: takes the `ResultSet` + `runId`. Per Method: an Origin-indexed table (Ultimate, IBNR, and for Mack: Std Err, Reserve Low, Reserve High) + a development-indexed LDF strip (`fromDev → toDev : factor`). Every figure wrapped in `ProvenancePopover`. Real `<table>` semantics reused from the `TriangleGrid` idiom; `numeric tabular-nums text-right` cells. **No arithmetic** (AC1/AC3).
- **`components/CopyableHash.tsx`** (**new**) — extract the duplicated `HashRow` copy pattern (currently inline in `app/(app)/triangles/[triangleId]/page.tsx:22-48` and `app/(app)/triangles/page.tsx`) into one component; the ProvenancePopover consumes it. Refactor the two triangle call-sites to use it (small, keeps one copy-clipboard implementation).
- **`lib/formatNumber.ts`** (**new**) — extract `TriangleGrid`'s module-scope `Intl.NumberFormat("en-US")` formatter (`formatFigure(n: number | null): string`, `null → "—"`) into a shared module used by **both** `TriangleGrid` and `ResultsGrid` so the engine-figure format never drifts. Refactor `TriangleGrid.tsx` to import it.
- **`components/RunDetail.tsx`** (**edit**) — the Results `TabsContent` renders `<ResultsGrid resultSet={resultSet} runId={run._id} />` when a `resultSet` prop is present, else the existing neutral placeholder (AC5). Extend the component props to accept `resultSet: ResultSet | null` (keeps RunDetail prop-driven and testable, per 4.3's architecture).
- **`app/(app)/runs/[runId]/page.tsx`** (**edit**) — add `const resultSet = useQuery(api.runs.getResultSet, orgId && run?.hasResults ? { workspaceId: orgId, runId } : "skip")`; pass `resultSet ?? null` into `RunDetail`. The page owns both queries (matching 4.3: page fetches, components are prop-driven).
- **Tests:** convex-test for `getResultSet` (verbatim return + tenancy `null` + `null` when no resultSet); extend `convex/authGuard.test.ts`; jsdom specs for `ResultsGrid` (verbatim figures incl. Mack SE/range, `null → "—"` for CL/BF, **no Total row / no summed value**, `numeric` class) and `ProvenancePopover` (opens on click + contextmenu, shows the five Lineage items, copyable hash, `Esc` closes); extend `tests/run-detail.test.tsx` (pass a `resultSet` fixture / `null`).
- **Docs:** `deferred-work.md` 4.4 section.

**Explicitly OUT of scope (do NOT build — later stories own them):**
- **Diagnostics panels** (LDF stability, AvE, CL-vs-BF divergence, residual heatmap) → Story 4.5. `getResultSet` returns the ResultSet only; the DiagnosticsBundle is 4.5's read surface.
- **Diagnostic context rail + `#<diagnosticId>` deep-linking** → Story 4.6. No context rail here.
- **ResultSet re-derivation from Lineage** → Story 4.7. The provenance popover *displays* Lineage; it does not re-execute the engine.
- **The Audit Log browser itself** → Epic 7 (Stories 7.1–7.2). The popover's audit-trail link is a **forward reference** keyed by `runId`; the destination surface lands in Epic 7 (see Dev Notes "The audit-trail link target").
- **Interpretation / Report tab content** → Epics 5–6 (those tabs keep their 4.3 locked states).
- **Any change to `getRun`**, the 4.2 orchestration, `engine_service`, or `reserving_engine`. `uv run pytest` stays green untouched — **no engine edits**.
- **Currency units on figures** — the Triangle/ResultSet model carries no currency; figures render unitless in v1 (period comes from the row header). See Dev Notes "UX-DR19 unit-and-period — the currency gap" + the question at the end.

## Tasks / Subtasks

- [x] **Task 1 — `getResultSet` public query: the verbatim figure read surface (AC: 4, 5)**
  - [x] `convex/runs.ts` → add `export const getResultSet = query({ args: { workspaceId: v.string(), runId: v.id("runs") }, … })`. **First statement `await requireMember(ctx, workspaceId)`** (AD-4). Then `const run = await ctx.db.get(runId); if (run === null || run.workspaceId !== workspaceId) return null;` (tenancy — existence never leaks, exact shape of `getRun`/`triangles.getById`).
  - [x] `return run.resultSet ?? null;` — the **stored ResultSet verbatim** (typed `ResultSet | null`). Do **not** re-project, re-key, or omit fields: AC3 requires the figures be the stored values exactly. A `queued`/`running`/`failed` run has `run.resultSet === undefined` → returns `null`.
  - [x] Add a doc comment: this is the figure surface `getRun` deferred (getRun stays lean; this returns figures only for the Results tab, subscribed only when `hasResults`). Cite AD-1 (figures live here, not in `getRun`).
  - [x] `npx convex codegen` (publishes `api.runs.getResultSet`).

- [x] **Task 2 — Popover primitive + shared formatter + copyable hash (AC: 1, 2)**
  - [x] `components/ui/popover.tsx` (**new**): shadcn wrapper over `radix-ui`'s `Popover` (`Popover.Root`/`Trigger`/`Portal`/`Content`/`Anchor`). Follow `components/ui/tabs.tsx` conventions exactly (`import { Popover as PopoverPrimitive } from "radix-ui"`, `cn` from `@/lib/utils`, `forwardRef` content with `sideOffset`, brand-token surface — `bg-popover`/`border`/subtle shadow per DESIGN.md "shadows on overlays only"). This is the sanctioned accessible primitive — do **not** hand-roll popover positioning/focus/`Esc`.
  - [x] `lib/formatNumber.ts` (**new**): `export function formatFigure(value: number | null): string` — a module-scope `Intl.NumberFormat("en-US")` (thousands grouping), `null → "—"`. Extract the existing formatter from `TriangleGrid.tsx:34-38` and refactor `TriangleGrid` to import it (one formatter, no drift). LDF factors keep more precision than integer reserves — accept an optional second arg or a sibling `formatFactor(n)` (e.g. up to 4 fraction digits) so age-to-age factors like `1.4523` aren't rounded to `1`. Decide the factor precision and document it in the module.
  - [x] `components/CopyableHash.tsx` (**new**): extract `HashRow` from `app/(app)/triangles/[triangleId]/page.tsx:22-48` verbatim (local `copied` state, `navigator.clipboard.writeText` in try/catch — clipboard rejects in insecure contexts, 1500ms reset, `numeric` class, `hash.slice(0,16)+"…"`). Props `{ label?: string; hash: string }`. Refactor both triangle pages to import it (removes the duplication flagged by the primitives sweep).

- [x] **Task 3 — ProvenancePopover: the "Where did this come from?" Lineage popover (AC: 2, 6)**
  - [x] `components/ProvenancePopover.tsx` (**new**), props `{ lineage: ResultSet["lineage"]; runId: Id<"runs">; children: ReactNode; label: string }` where `children` is the figure element and `label` describes the figure for the a11y name.
  - [x] Use `Popover.Root` (controlled or uncontrolled) with `Popover.Trigger asChild` wrapping the figure as a `<button type="button">` — this gives click + Enter/Space + focus for free (WCAG). Add `onContextMenu={(e) => { e.preventDefault(); setOpen(true); }}` for the UX-DR15 **right-click** gesture, and rely on the trigger button's default tap for **touch long-press**/tap. `aria-label={`Where did this come from? ${label}`}`.
  - [x] `Popover.Content` (via `components/ui/popover`): a small labelled definition list rendering the **five Lineage items** (AC2):
    - **Engine version** → `lineage.engineVersion` (`numeric`).
    - **chainladder version** → `lineage.chainladderVersion` (`numeric`).
    - **Triangle hash** → `<CopyableHash label="Triangle hash" hash={lineage.triangleHash} />` (truncated + copyable).
    - **Parameters** → the selected Methods (`lineage.parameters.methods`, via `methodLabel`); when `lineage.parameters.aprioriLossRatios.length > 0`, list the per-Origin a-priori loss ratios/exposures (`origin`, `lossRatio`, `exposure` — `numeric`). These are stored params, not computed — render verbatim.
    - **Audit trail** → a `provenance`-styled link/affordance keyed by `runId` (see Dev Notes "The audit-trail link target" for the exact target/placeholder decision).
  - [x] Chrome uses the `provenance` token family (`text-provenance`, `bg-provenance-subtle` accents, the audit link in `text-provenance`) — provenance violet's **only** licensed use (DESIGN.md:89). `Esc` closes (Radix default) and returns focus to the figure (Radix default). Keep the content width-bounded so it never forces body h-scroll on `md` (AC6).

- [x] **Task 4 — ResultsGrid: per-Method ultimates / IBNR / LDFs / Mack ranges, verbatim (AC: 1, 3, 6)**
  - [x] `components/ResultsGrid.tsx` (**new**), props `{ resultSet: ResultSet; runId: Id<"runs"> }`. Pure/prop-driven (no hooks/data-fetching — the page fetches). Data surface width already provided by the page (`max-w-screen-2xl`).
  - [x] For **each** `resultSet.methodResults[i]` render a titled section (`methodLabel(mr.method)`):
    - **Origin table** — real `<table>` with a `<caption class="sr-only">`, `<th scope="col">` headers `Origin · Ultimate · IBNR` (and, **only when `mr.method === "mack"`**, add `Std Err · Reserve Low · Reserve High`), and one `<tr>` per `mr.originResults[k]` with `<th scope="row">{origin}</th>` then `numeric tabular-nums text-right` `<td>`s: `formatFigure(ultimate)`, `formatFigure(ibnr)`, and for Mack `formatFigure(mackStdErr)`, `formatFigure(reserveLow)`, `formatFigure(reserveHigh)`. `null` figures (CL/BF Mack columns never appear because those columns are Mack-only; any genuine `null` → `formatFigure` yields `"—"`). Each `<td>`'s figure is wrapped in `ProvenancePopover` with a descriptive `label` (e.g. `` `${methodLabel} ultimate, origin ${origin}` ``) and an `aria-label` in the TriangleGrid idiom.
    - **LDF strip** — the age-to-age factors `mr.developmentFactors[]` rendered as `fromDev → toDev : formatFactor(factor)` (a small mono row/table on the development axis — these are **not** origin-indexed). Each factor wrapped in `ProvenancePopover` (label `` `${methodLabel} LDF ${fromDev}→${toDev}` ``).
    - **Total Mack std err** — when `mr.totalMackStdErr !== null`, print it once (labelled, `numeric`), wrapped in `ProvenancePopover`. This is a stored field — **not** a client sum.
  - [x] **AD-1 hard guardrail:** no arithmetic anywhere in this component. No `Array.reduce`/`+`/`*` on any figure, no "Total reserve" row (the ResultSet has no total-ultimate/total-IBNR field — do not synthesize one), no CL-vs-BF deltas, no percentage divergences (those are Diagnostics, Story 4.5). Every rendered number is a single `formatFigure`/`formatFactor` of one stored field.
  - [x] Method-ordering: render in `resultSet.methodResults` order (engine order); do not re-sort. Mack-only columns/fields appear only for the Mack section.

- [x] **Task 5 — Wire the Results tab + page query (AC: 1, 5)**
  - [x] `components/RunDetail.tsx`: extend the component props with `resultSet?: ResultSet | null`. In the Results `TabsContent`, render `resultSet ? <ResultsGrid resultSet={resultSet} runId={run._id} /> : <TabPlaceholder>{run.hasResults ? "Loading results…" : "Results appear once the Run completes."}</TabPlaceholder>`. (When `hasResults` is true but the second query hasn't resolved yet, show a brief loading line — not the "later story" text, which is now obsolete.) Remove the "Results render in a later story (4.4)." string. Import `ResultsGrid` and the `ResultSet` type (`@/convex/lib/engineContract`).
  - [x] `app/(app)/runs/[runId]/page.tsx`: add `const resultSet = useQuery(api.runs.getResultSet, orgId && run?.hasResults ? { workspaceId: orgId, runId } : "skip");` (gate on `run?.hasResults` so it only fires once figures exist — AC5). Pass `resultSet={resultSet ?? null}` into `<RunDetail …>`. This is a second live subscription; the ResultSet is immutable once stored so it settles immediately and never churns. Keep the existing `getRun` subscription and retry wiring unchanged.
  - [x] Confirm no reserve figures render before `complete`: with `hasResults` false the query is `"skip"`ped and `resultSet` is `undefined → null`, so the placeholder shows (AC5).

- [x] **Task 6 — Convex tests: `getResultSet` (AC: 4, 5)**
  - [x] `convex/runs.test.ts` (extend): reuse the existing valid ResultSet fixture the 4.2 tests already build.
    - **Verbatim return:** with `t.withIdentity` for a member of `org_test`, a `complete` run returns the **exact** stored `resultSet` — assert deep-equality of `methodResults` (ultimate/ibnr/LDFs), the Mack fields (`mackStdErr`/`reserveLow`/`reserveHigh`/`totalMackStdErr`) present for the Mack method result, and the full `lineage` (`engineVersion`/`chainladderVersion`/`triangleHash`/`parameters`). Nothing dropped or re-shaped.
    - **`null` when no resultSet:** a `queued`/`running`/`failed` run returns `null`.
    - **Tenancy:** a member of Workspace B reading Workspace A's run returns `null` (no leak).
  - [x] `convex/authGuard.test.ts`: add `"runs:getResultSet": { workspaceId: "org_test" }` to `publicFunctionArgs` and add the path to the `runId`-injection branch (reuse the seeded `runs` row from the 4.3 additions). Public → the enumeration fails the build until registered (by design).
  - [x] `tests/audit-append-only.test.ts` stays green **unmodified** — `getResultSet` is a **read** query, writes nothing, adds no `auditLogs` insert site.

- [x] **Task 7 — Component tests + full gates (AC: 1, 2, 3, 6)**
  - [x] `tests/results-grid.test.tsx` (**new**, `// @vitest-environment jsdom`): render `ResultsGrid` with a fixture ResultSet containing CL + BF + Mack method results.
    - Assert the CL/BF sections show Ultimate + IBNR columns **only** (no Mack columns) and the Mack section adds Std Err / Reserve Low / Reserve High.
    - Assert figures render **verbatim** via `formatFigure` (e.g. a fixture `ultimate: 4213000` → `"4,213,000"`; a Mack `reserveLow`/`reserveHigh` printed from the fixture, **not** recomputed).
    - Assert LDFs render `fromDev → toDev : factor` for `developmentFactors`.
    - **No-arithmetic probe:** assert there is **no** "Total" row and no element whose text equals the sum of the fixture's IBNRs / ultimates (guards AD-1 — pick fixture values whose sum is a recognisable number not otherwise present, and assert that string is absent).
    - Assert cells carry the `numeric` class.
  - [x] `tests/provenance-popover.test.tsx` (**new**, `// @vitest-environment jsdom`): render a figure wrapped in `ProvenancePopover` with a lineage fixture. Opening via click **and** via `contextmenu` reveals the popover; assert it shows engine version, chainladder version, the truncated hash (copyable button) and the parameters; `Esc` closes it. (Mock `navigator.clipboard` if asserting copy.) Radix Popover renders content in a portal — query via `screen`/`document.body`.
  - [x] `tests/run-detail.test.tsx` (**extend**): the existing `makeRun` fixture path stays green; add a case passing a `resultSet` fixture → the Results tab shows the grid (an ultimate figure present); a `null` resultSet with `hasResults:false` → the "appear once complete" placeholder. Keep all 4.3 assertions green.
  - [x] **Full gates green before → review:** `npm test` (unit + convex projects), root `npx tsc --noEmit` + `npx tsc -p convex/tsconfig.json --noEmit`, `npm run lint`, `npm run build` (compiles the updated `/runs/[runId]` route), and `cd engine && uv run pytest` (**unchanged** — no engine edits; keep green). Leave the single Playwright smoke as-is (folded into Story 7.4; needs the Clerk test-user password + a live engine).

## Dev Notes

### This story fills 4.3's Results placeholder — figures via a *second, lean* query (AD-1, AD-3)

Story 4.3 built the Run-detail page with a four-tab strip and a Results **placeholder**, and kept `getRun` deliberately figure-free ("the figures arrive in 4.4–4.6", `runs.ts:472-473`). 4.4 adds exactly one new **read** query — `getResultSet` — that returns the stored ResultSet verbatim, and the Results tab subscribes to it **only when `hasResults`**. Two reasons this is a separate query rather than fattening `getRun`:
1. **Leanness / separation (AD-1, AD-3):** `getRun` is the hot live-status subscription (re-renders on every `queued→running→complete|failed` patch); it stays a small projection. The ResultSet is large and immutable-once-stored — fetched once, when complete, by the surface that needs it. No churn to 4.3's tested `getRun` projection.
2. **Verbatim contract (AC3):** `getResultSet` returns `run.resultSet` with **no** re-projection, so "all figures are values from the stored ResultSet verbatim" is guaranteed by construction — the query cannot introduce a derived number.

Convex `useQuery` is a live subscription, so when a running Run flips to `complete` and `storeResultSet` patches the row, the gated `getResultSet` (previously `"skip"`ped) activates and the grid appears reactively — no polling, no reload (FR-20, AC5).

### The exact ResultSet shape to render (camelCase; enums stay snake_case)

Source of truth: `reserving_engine/resultset.py`, mirrored 1:1 by the Convex validators in `convex/lib/engineContract.ts` (drift-checked in CI). The whole ResultSet is **camelCase** (`ConfigDict(alias_generator=to_camel)`); only the Method **enum values** stay snake_case. The Triangle's snake_case quirk (`origin_periods`) does **not** touch the ResultSet — you render only `triangleHash` (a string), never the Triangle body.

```
ResultSet {
  schemaVersion: string
  lineage: {
    engineVersion: string
    chainladderVersion: string
    triangleHash: string                          // canonical-triangle-JSON sha256 (NOT the raw-file dedupe hash)
    parameters: {
      methods: ("chain_ladder"|"bornhuetter_ferguson"|"mack")[]
      aprioriLossRatios: { origin: string; lossRatio: number; exposure: number }[]   // [] when no BF
    }
  }
  methodResults: {
    method: "chain_ladder"|"bornhuetter_ferguson"|"mack"
    developmentFactors: { fromDev: string; toDev: string; factor: number }[]   // age-to-age LDFs (n_dev-1), development-axis
    originResults: {
      origin: string
      ultimate: number
      ibnr: number
      mackStdErr: number | null      // Mack only; null (present-with-null) for CL/BF
      reserveLow: number | null      // Mack only; = engine's ibnr - mackStdErr — DO NOT recompute in React
      reserveHigh: number | null     // Mack only; = engine's ibnr + mackStdErr — DO NOT recompute in React
    }[]
    totalMackStdErr: number | null   // Mack only; method-level
  }[]
}
```

**Nullability:** the engine dumps every field (no `exclude_none`), so `mackStdErr`/`reserveLow`/`reserveHigh`/`totalMackStdErr` are **present with value `null`** on CL/BF results, not absent. Render Mack columns only for the Mack section (cleanest), and let `formatFigure(null) → "—"` cover any genuine null. Type the prop as `ResultSet = Infer<typeof resultSetValidator>` (exported at `engineContract.ts:199`).

### AD-1 is the whole story — display-formatting only, zero arithmetic

The Constitution: *"Every number originates in `reserving_engine`. … No arithmetic on reserve figures in Convex functions, React components (display formatting only), prompts, or export code."* This surface renders hundreds of engine figures — it is the single most arithmetic-tempting screen in the app. The bright lines:
- **No totals.** The ResultSet has **no** total-ultimate/total-IBNR field. Do **not** `reduce(+)` the origins into a "Total" row — if a total is ever wanted it must come from the engine (a future ResultSet field), never from React. (`totalMackStdErr` *is* a stored engine field — print it; do not compute it.)
- **No ranges from std err.** `reserveLow`/`reserveHigh` are **engine-computed** (`ibnr ∓ mackStdErr`, and *not* floored at zero). Read them; never compute `ibnr - mackStdErr` in the component.
- **No deltas / divergences.** CL-vs-BF differences and % divergences are **Diagnostics** (Story 4.5, a separate `dx:cl_bf_divergence` figure) — not synthesized here.
- **Formatting is display-only:** `Intl.NumberFormat("en-US")` grouping via the shared `formatFigure`. This is presentation, not arithmetic (allowed by AD-1's "display formatting only").
The `tests/results-grid.test.tsx` no-arithmetic probe (assert the sum-of-IBNRs string is **absent**) is the structural guard — keep it.

### The provenance popover: Lineage is run-level, reused across every figure (UX-DR15)

UX-DR15 requires *every* figure to offer the popover, but the Lineage (engine version, chainladder version, triangle hash, parameters) is **run-level** — identical for every cell. So one `ProvenancePopover` component is reused across all figures; only the `label`/`aria-label` differs per figure. Radix `Popover` mounts its content **only when open**, so wrapping every figure in a `Popover.Root` is cheap (at most one content in the DOM at a time); v1 triangles are bounded (≤30 origins, NFR-7) so the trigger count is modest. If grids ever grow far larger, a single shared controlled popover with a moving anchor is the optimization — noted in deferred-work, not needed now.

**Trigger gestures (UX-DR15 says "right-click / long-press"), reconciled with WCAG:** a right-click/long-press-**only** affordance is not keyboard-accessible and fails the WCAG 2.2 AA floor (UX-DR18). So the trigger is a real `<button>` (Radix `Trigger asChild`) that opens on **click + Enter/Space** (accessible default) **and** on **right-click** (`onContextMenu` + `preventDefault`, the UX-DR15 desktop gesture) and **touch tap/long-press**. This honours UX-DR15's gestures while clearing the a11y floor. *(Whether plain left-click should open the popover — vs reserving it for right-click only to avoid "clicking a number" surprise — is a genuine UX ambiguity; see the question at the end.)*

### The audit-trail link target (Epic 7 forward reference)

UX-DR15's fifth item is a "link to the Run in the Audit Log". The **Audit Log browser is Epic 7** (Stories 7.1 *Audit Log Browser* and 7.2 *Chain Verification and Claim-to-Lineage Navigation*) — it does **not** exist yet. Do **not** invent a broken primary-nav link. Render the audit reference as a `provenance`-styled affordance keyed by `runId` (the audit correlation key — every `run.*` audit entry carries this `runId`), and make it forward-compatible:
- Recommended: a `provenance` link/text "Audit trail — run `{runId}`" with a tooltip/subtext noting the Audit Log browser arrives in Epic 7, so it is honest today and becomes a live link when 7.1 lands (at which point flip it to the real route, e.g. `/audit?runId={runId}`).
- Do **not** point `<Link>` at a route that 404s. Keep the `runId` copyable so an auditor can find the trail even before the browser ships.
This keeps the "link toward the Run's audit trail" promise (UX-DR15 wording is "toward") without shipping a dead link. *(Confirm the exact affordance with Rohan — see question.)*

### UX-DR19 unit-and-period — the currency gap

UX-DR19: *"numbers in copy always carry unit and period"* (e.g. "IBNR £4.2m, AY 2023"). Two halves:
- **Period** — satisfied structurally: every figure sits in a row whose `<th scope="row">` is its Origin Period, and LDFs are labelled by their development transition; cell `aria-label`s announce the period + value (TriangleGrid idiom, `EXPERIENCE.md:109`). Any prose/caption naming a figure names its origin period.
- **Unit** — the **Triangle/ResultSet model carries no currency** (reserves are unitless numbers). So v1 cannot render a currency unit from data; figures are unitless with the period from the row header. This is a real gap, not an omission to paper over: do not hardcode "£" (the app is currency-agnostic). Flagged as a question (capture currency at upload / per-workspace config) and recorded in deferred-work. UX-DR19's "recommends is reserved for Interpretation" rule is trivially satisfied — this surface is pure engine figures, no prose recommendations.

### The `numeric` texture is the Results tab's whole visual identity (UX-DR5, DESIGN.md:100)

*"A number set in Geist Sans is prose; a number set in Geist Mono is evidence."* Every figure here is evidence → `numeric` (Geist Mono 13px) or `numeric-lg` (16px) utility, `tabular-nums`, right-aligned, in real `<table>`s with hairline borders and `spacing.cell-pad` (6px) density — the same texture as the Triangle grid (`DESIGN.md:129`, `EXPERIENCE.md:134` "ultimates/IBNR per Method per Origin Period in the triangle-grid texture"). The `numeric`/`numeric-lg` utilities and the `provenance` token family are **already wired** in `app/globals.css` (utilities at `globals.css:163-174`; `--color-provenance`/`-subtle`/`-foreground`, light + dark, at `globals.css:15-17,73-75,116-118`) — reuse them; add no new tokens.

### Reuse, do not reinvent (existing patterns)

- **Public query guard + tenancy + `null`-on-miss:** `convex/runs.ts` `getRun` (lines 455-478) and `triangles.getById` — copy the shape exactly for `getResultSet`. `requireMember` first; `run.workspaceId !== workspaceId → null`.
- **Engine-figure formatter:** `TriangleGrid.tsx:34-38` `Intl.NumberFormat("en-US")` — **extract to `lib/formatNumber.ts`** and share (Task 2), don't duplicate.
- **Copy-to-clipboard hash:** `app/(app)/triangles/[triangleId]/page.tsx:22-48` `HashRow` — **extract to `components/CopyableHash.tsx`** (Task 2); the popover and both triangle pages consume it.
- **Real-`<table>` numeric grid semantics:** `components/TriangleGrid.tsx:115-195` — `<caption class="sr-only">`, `<th scope="col"/scope="row">`, `numeric tabular-nums text-right` cells, per-cell `aria-label`. Mirror this idiom for the Origin tables (the Results grid is a Method×Origin *matrix* of values, a different shape from the paid/incurred triangle, so build a purpose-fit grid using the same cell/table idiom — don't force the `kind: "paid"|"incurred"` `TriangleGrid` component onto it).
- **Radix wrapper convention:** `components/ui/tabs.tsx` — `import { X as XPrimitive } from "radix-ui"`, `forwardRef`, `cn`. Copy for `components/ui/popover.tsx`.
- **Method labels:** `components/methods.ts` `methodLabel(method)` — reuse for section titles and provenance parameters.
- **Page skeleton + second query gating:** `app/(app)/runs/[runId]/page.tsx` already does `useQuery(getRun, orgId ? … : "skip")`; add `getResultSet` gated on `orgId && run?.hasResults`.
- **jsdom component-spec conventions:** `tests/run-detail.test.tsx` / `tests/triangle-grid.test.tsx` — `// @vitest-environment jsdom`, plain-prop fixtures (`makeRun`), `@testing-library/react`, `afterEach(cleanup)`. Copy for the new specs; Radix Popover content lands in a portal — query via `screen`/`document.body`.

### Prop-driven components, page owns data (4.3's architecture, keep it)

4.3 established: the **page** owns the Convex subscriptions and passes plain props into `RunDetail`; `RunDetail` and its children are prop-driven and jsdom-testable without mocking `convex/react`. Preserve this — `ResultsGrid` and `ProvenancePopover` take plain props (`resultSet`, `lineage`, `runId`); the page adds the `getResultSet` subscription and passes `resultSet` down. This keeps the new specs fixture-driven and `tests/run-detail.test.tsx` from needing new hook mocks.

### Project Structure Notes

- **New:** `convex/runs.ts` `getResultSet` (edit), `components/ui/popover.tsx`, `components/ProvenancePopover.tsx`, `components/ResultsGrid.tsx`, `components/CopyableHash.tsx`, `lib/formatNumber.ts`, `tests/results-grid.test.tsx`, `tests/provenance-popover.test.tsx`.
- **Edit:** `convex/runs.ts` (`getResultSet` query), `convex/runs.test.ts` (getResultSet tests), `convex/authGuard.test.ts` (register `runs:getResultSet` + inject runId), `components/RunDetail.tsx` (Results tab → `ResultsGrid`; `resultSet` prop), `app/(app)/runs/[runId]/page.tsx` (add `getResultSet` query, pass `resultSet`), `components/TriangleGrid.tsx` (import shared `formatFigure`), `app/(app)/triangles/[triangleId]/page.tsx` + `app/(app)/triangles/page.tsx` (import `CopyableHash`), `tests/run-detail.test.tsx` (resultSet fixture case), `tests/triangle-grid.test.tsx` (still green after formatter extraction).
- **Regen:** `npx convex codegen` after the `runs.ts` addition (publishes `api.runs.getResultSet`).
- **No change:** `convex/runs.ts` `getRun`/`retryRun`/orchestration internals, `convex/schema.ts` (the `resultSet` field 4.2 added is exactly what `getResultSet` returns — no schema change), `convex/auditLogs.ts` (no new writer — `getResultSet` is a read), `convex/lib/engineContract.ts` (the validators/types already model the ResultSet — import them), any `engine/` file (`pytest` stays green).
- **Doc:** append a 4.4 section to `deferred-work.md` (currency-unit gap; audit-link target pending Epic 7; single-shared-popover optimization if grids grow; whether the Results grid should later share more with `TriangleGrid`).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.4] — story statement + ACs (lines 489-504); Epic 4 summary (430-432); UX-DR15 provenance popover (94), UX-DR19 voice/unit-period (98), UX-DR5 mono right-aligned grid (84), two-hashes rule (69)
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-agentic-reserving-2026-07-16/EXPERIENCE.md] — provenance popover right-click/long-press + five Lineage contents (57), engine numbers visually distinct / mono = evidence (56), voice "numbers carry unit and period" (49), Results in the triangle-grid texture (134), grid table-semantics a11y announcement (109), banned hover-only-on-touch (102), WCAG 2.2 AA floor (106), context-rail bottom-sheet on md precedent (120), modal depth one level (33)
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-agentic-reserving-2026-07-16/DESIGN.md] — `numeric`/`numeric-lg` Geist Mono tokens (30-37, 100), triangle-grid spec dense/right-aligned/cell-pad (129, 108, 51), provenance violet exclusive to citation chips/Diagnostic IDs/Lineage links (89), provenance token values (14-19), shadcn Popover/Tooltip/Sheet used as-is (122), overlays-get-shadows (114)
- [Source: _bmad-output/planning-artifacts/architecture/architecture-agentic-reserving-2026-07-16/ARCHITECTURE-SPINE.md] — AD-1 numbers only from the engine / no arithmetic in React (the Constitution), AD-4 requireMember-first, AD-3 Convex sole system of record, AD-10 ResultSet schema is the cross-runtime contract, FR-20 live status via subscription (no polling)
- [Source: engine/reserving_engine/resultset.py] — the ResultSet/Lineage/MethodResult/OriginResult/DevelopmentFactor/AprioriLossRatio models (field names, nullability, camelCase alias, snake_case enums); [engine/reserving_engine/methods.py:248-249,257-265,331] — how reserveLow/High/mackStdErr/totalMackStdErr/lineage are populated
- [Source: convex/lib/engineContract.ts:25-80, 199] — `resultSetValidator`/`methodResultValidator`/nullable fields + the `ResultSet`/`Method` types to import; [convex/schema.ts:130] — `runs.resultSet: v.optional(resultSetValidator)` (what `getResultSet` returns)
- [Source: convex/runs.ts:455-478] — `getRun` (the guard/tenancy/`null`-on-miss shape to copy for `getResultSet`; stays unchanged)
- [Source: components/RunDetail.tsx:19-32, 157-163] — the `RunView` type + the Results `TabsContent` placeholder this story replaces; [app/(app)/runs/[runId]/page.tsx:26-84] — the page skeleton + `getRun` subscription to add `getResultSet` alongside
- [Source: components/TriangleGrid.tsx:34-38, 115-195] — the `Intl.NumberFormat` formatter to extract + the real-`<table>`/`numeric` grid idiom to mirror; [components/methods.ts] — `methodLabel`
- [Source: app/(app)/triangles/[triangleId]/page.tsx:22-48] — the `HashRow` copy-to-clipboard pattern to extract into `CopyableHash`
- [Source: components/ui/tabs.tsx] — the `radix-ui` wrapper convention to copy for `components/ui/popover.tsx`
- [Source: app/globals.css:15-17,73-75,116-118,163-174] — the `provenance` token family + `numeric`/`numeric-lg` utilities (already wired — reuse, add no tokens)
- [Source: convex/authGuard.test.ts] — `publicFunctionArgs` registry + `runId` injection to extend for `getResultSet`
- [Source: _bmad-output/implementation-artifacts/4-3-run-detail-with-step-rail-and-live-status.md] — the prop-driven-components/page-owns-data architecture, the four-tab strip, and the Results-placeholder this story replaces
- [Source: _bmad-output/project-context.md] — Constitution (AD-1 no arithmetic outside the engine), requireMember-first, vocabulary (ResultSet, Lineage, Run, Diagnostic — never synonyms), "❌ Polling in application code"

## Dev Agent Record

### Agent Model Used

Amelia (dev agent) — claude-opus-4-8[1m].

### Debug Log References

All gates green on completion:
- `npm test` → **262 passed** (23 files; unit + convex projects — +15 over 4.3's 247).
- `npx tsc --noEmit` (root) → clean; `npx tsc -p convex/tsconfig.json --noEmit` → clean.
- `npm run lint` → clean.
- `npm run build` → success; `/runs/[runId]` recompiled.
- `cd engine && uv run pytest` → **205 passed, 9 skipped** (unchanged — no engine edits).

Two first-run failures, both in the newly-authored specs (not implementation bugs), fixed:
1. `tests/provenance-popover.test.tsx` — queried the copy button by `getByRole("button", { name: /copy full hash/i })`, but a button's accessible name comes from its text content (the truncated hash), not its `title`. Switched to `getByTitle("Copy full hash")`.
2. `tests/provenance-popover.test.tsx` — root `tsc` flagged the `@ts-expect-error` on the jsdom `ResizeObserver` stub as unused (the assignment isn't a type error). Replaced the directive with an `as unknown as typeof ResizeObserver` cast.

### Completion Notes List

- **AC1 (figures verbatim, numeric):** `components/ResultsGrid.tsx` renders, per Method, an origin table (Ultimate · IBNR, + Std Err · Reserve Low · Reserve High for Mack) and an age-to-age LDF strip, all in `numeric tabular-nums` right-aligned cells via the shared `formatFigure`/`formatFactor`. Mack `totalMackStdErr` printed as a stored field.
- **AC2 (provenance popover):** `components/ProvenancePopover.tsx` over a new `components/ui/popover.tsx` (radix wrapper). Shows all five Lineage items — engine version, chainladder version, copyable truncated Triangle hash (`CopyableHash`), parameters (methods + BF a-prioris), audit-trail forward reference (runId). Opens on click + Enter/Space (Radix default) **and** right-click (`onContextMenu` + `preventDefault`) **and** touch; `Esc` closes. Chrome uses the `provenance` violet token family only.
- **AC3 (verbatim, no arithmetic):** every figure is a single `formatFigure`/`formatFactor` of one stored field — no sums, no "Total" row, no `ibnr ± mackStdErr` (reserveLow/High read from the engine), no CL-vs-BF deltas. A `results-grid` test probe asserts the sum-of-IBNRs string (`230,000`) and the recomputed range (`190,000`/`210,000`) are **absent**.
- **AC4 (guarded read query):** `runs.getResultSet` — `requireMember` first, tenancy `null`-on-miss, `return run.resultSet ?? null` **verbatim** (no projection). `getRun` left **unchanged** (still figure-free). Registered in `convex/authGuard.test.ts`; `tests/audit-append-only.test.ts` stays green unmodified (read query, no writer).
- **AC5 (honest empty state, no early figures):** the page gates `getResultSet` on `run?.hasResults` (`"skip"` otherwise); the Results tab shows "Results appear once the Run completes." until complete, then "Loading results…" until the second subscription resolves, then the grid — all reactive, no polling.
- **AC6 (WCAG floor):** real `<table>`s with `<caption class="sr-only">` + `<th scope>`; each figure's provenance trigger is a keyboard-reachable button whose accessible name carries the description **and** the value; popover focus/`Esc`/dismissal via Radix; content width-bounded (`max-w-[calc(100vw-2rem)]`).
- **Reuse/refactor:** extracted `lib/formatNumber.ts` (shared by `TriangleGrid` + `ResultsGrid`; `TriangleGrid` passes `""` for holes to keep its blank-cell behaviour) and `components/CopyableHash.tsx` (from the Triangle detail page's `HashRow`; the detail page + popover consume it). The Triangles *list* page keeps its own table-cell copy idiom (different shape) — noted in deferred-work.
- **Out of scope, untouched:** `getRun`/`retryRun`/the 4.2 orchestration, `convex/schema.ts`, `convex/auditLogs.ts`, every `engine/` file (pytest unchanged). Diagnostics (4.5), context rail/deep-linking (4.6), re-derivation (4.7), and the real Audit Log browser (Epic 7) remain out of scope; the popover's audit link is a forward reference.
- **Three UX questions flagged for Rohan** (in Dev Notes + deferred-work): the currency-unit gap (UX-DR19), the audit-link target (Epic 7 route vs runId affordance), and whether plain left-click should open the popover.

### File List

**New:**
- `convex/runs.ts` → `getResultSet` query (edit — see Edited)
- `components/ui/popover.tsx`
- `components/ProvenancePopover.tsx`
- `components/ResultsGrid.tsx`
- `components/CopyableHash.tsx`
- `lib/formatNumber.ts`
- `tests/results-grid.test.tsx`
- `tests/provenance-popover.test.tsx`

**Edited:**
- `convex/runs.ts` (`getResultSet` public query)
- `convex/runs.test.ts` (`getResultSet` verbatim/null/tenancy tests)
- `convex/authGuard.test.ts` (register `runs:getResultSet` + inject `runId`)
- `components/RunDetail.tsx` (Results tab → `ResultsGrid`; `resultSet` prop)
- `app/(app)/runs/[runId]/page.tsx` (add `getResultSet` subscription gated on `hasResults`; pass `resultSet`)
- `components/TriangleGrid.tsx` (import shared `formatFigure`)
- `app/(app)/triangles/[triangleId]/page.tsx` (use `CopyableHash` in place of inline `HashRow`)
- `tests/run-detail.test.tsx` (resultSet grid + loading cases; updated the obsolete "later story" assertion)
- `_bmad-output/implementation-artifacts/deferred-work.md` (4.4 section)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (4.4 → in-progress → review)

**Regenerated:** `convex/_generated/*` (`npx convex codegen` — publishes `api.runs.getResultSet`).

## Change Log

| Date       | Version | Description                                                                 |
| ---------- | ------- | --------------------------------------------------------------------------- |
| 2026-07-19 | 0.1     | Story 4.4 drafted: Results tab renders the stored ResultSet verbatim (ultimates/IBNR/LDFs per Method per Origin Period + Mack SE/ranges) in `numeric` texture with zero arithmetic (AD-1); new lean `getResultSet` read query (getRun unchanged); per-figure provenance popover (engine/chainladder version, copyable truncated Triangle hash, parameters, audit-trail forward-reference) via a new radix Popover primitive; shared `formatFigure` + `CopyableHash` extractions. Status → ready-for-dev. |
| 2026-07-19 | 1.0     | Story 4.4 implemented: `getResultSet` verbatim read query + `ResultsGrid` (per-Method ultimates/IBNR/LDFs + Mack SE/range, no arithmetic) + `ProvenancePopover` (five Lineage items, click/right-click/keyboard, `Esc`) over new `components/ui/popover.tsx`; extracted `lib/formatNumber.ts` + `components/CopyableHash.tsx`; page wires the gated second subscription. All gates green (npm test 262; tsc root+convex; lint; build; pytest 205/9 unchanged). Status → review. |

### Review Findings (code review 2026-07-19)

- [x] [Review][Patch] Figures render literal "NaN"/"∞" — `formatFigure`/`formatFactor`/`formatPercent`/`formatSignedFigure`/`formatResidual` special-case only `null`, not non-finite values [lib/formatNumber.ts:42-74]
- [x] [Review][Patch] `CopyableHash` schedules a 1.5s `setTimeout(setCopied)` with no cleanup — setState after unmount if the row/popover closes within 1.5s [components/CopyableHash.tsx]
