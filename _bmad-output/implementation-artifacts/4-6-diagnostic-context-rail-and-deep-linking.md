---
baseline_commit: 80e1dc6c3b19a76edd339a11791ac983a8b5de29
---

# Story 4.6: Diagnostic Context Rail and Deep Linking

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an Analyst,
I want to select any diagnostic element into a context rail and share deep links to it,
so that diagnostics have identities I can cite and send to colleagues. (FR-8, UX-DR10)

## Acceptance Criteria

**AC1 — Selecting any diagnostic element fills a right context rail with its detail (UX-DR10, EXPERIENCE.md:71,145)**
Given the Diagnostics tab with a rendered `DiagnosticsBundle`,
When any diagnostic element is activated — clicking it, or focusing it and pressing `Enter`/`Space` — 
Then the right **context rail** fills with that element's detail: a heading naming the element, its **Diagnostic ID** (`element.id`, the `provenance`-violet chip), the element's **stored values** (per kind — see AC5), a **"Cited by"** backlink section, and the **deep-link string** `/runs/{runId}/diagnostics#{element.id}`. Only one element is selected at a time; selecting another replaces the rail content. The selected element shows a visible **selected state** (a `ring`/highlight) so the rail↔grid correspondence is unambiguous. (UX-DR10)

**AC2 — Empty state until something is selected (EXPERIENCE.md:71)**
Given the Diagnostics tab is rendered but **no** element is selected,
When the rail renders,
Then it shows the empty state **"Select any diagnostic element"** (verbatim) and no element detail — exactly matching UX-DR10 / EXPERIENCE.md:71. (This is the initial state on every fresh page load with no URL hash.)

**AC3 — Keyboard: arrow-key grid navigation, `Enter` opens, `Esc` returns focus to the grid (EXPERIENCE.md:99, WCAG 2.2 AA)**
Given the residual heatmap (the canonical 2-D diagnostic **grid**, real `<table>` semantics),
When the user Tabs into it and uses **arrow keys**,
Then focus moves cell-to-cell via a **roving `tabIndex`** (one grid stop in the Tab order; ←→ move within a row, ↑↓ across rows; movement is clamped at the grid edges), **`Enter`/`Space`** opens the focused cell in the context rail (AC1), and **`Esc`** returns focus to the grid (the last-focused cell) — the rail content persists but keyboard focus goes back to the grid. Every selectable element in the other three panels is reachable by **`Tab`** and activates on **`Enter`/`Space`** (they are already focusable — Story 4.5). Grids keep proper table semantics with announced `<th scope>` headers (already built in 4.5). (EXPERIENCE.md:99)

**AC4 — Deep link `/runs/{id}/diagnostics#<diagnosticId>` opens, selects, scrolls-to and highlights the element (FR-8, EXPERIENCE.md:70,146)**
Given a URL `/runs/{runId}/diagnostics#{diagnosticId}` (the fragment is a canonical `dx:{runId}:{kind}:{key}` id, verbatim — Story 4.5 renders `element.id` as the addressable identity),
When the page is opened (or the hash changes in-app, e.g. a future citation chip sets `location.hash`),
Then the Run detail **switches to the Diagnostics tab**, the addressed element is **selected** (rail populated per AC1), the page **scrolls the element into view** and applies a transient **highlight** so the eye lands on it. This is **the navigation target that citation chips will use product-wide** (FR-8) — the mechanism must be the single reusable "select by id" path, not a one-off. An **unknown/stale** fragment (no matching element in this Run's bundle) is a **no-op**: the tab still opens, the rail shows its empty state, nothing throws. Colon-bearing ids are resolved by `document.getElementById` / element refs and a `Map` lookup — **never** a CSS `querySelector('#…')` (a `:` breaks the selector). (FR-8, EXPERIENCE.md:70)

**AC5 — The rail renders the selected element's stored values verbatim, per kind — zero arithmetic (AD-1)**
Given a selected element,
When the rail renders its values,
Then it shows **only stored fields**, formatted via the existing `lib/formatNumber` helpers — **no arithmetic** (AD-1), mirroring the panels:
- **`ldf_stability`** → selected factor, σ / std err / **CV**, and the **factor series** (`linkRatios[].factor`, mono, in order) — matching the mockup rail (`LDF 12–24m, coefficient of variation 0.184`, factor series).
- **`ave`** → actual, expected, **A−E** (stored `actualMinusExpected`, signed), **A/E** (stored `actualToExpectedRatio`, %).
- **`cl_bf_divergence`** → CL ultimate, BF ultimate, **divergence** (stored, signed), **relative** (%).
- **`residual`** → the stored `residual` value, plus its origin / dev-transition labels.
Every printed figure is a single `format*()` of exactly one stored field read from the same `DiagnosticsBundle` the panels render — the rail resolves the element **by `id`** from the bundle (a `Map`), it does **not** recompute or re-fetch. (AD-1)

**AC6 — "Cited by N report claims" backlink section, honest-empty until Interpretation exists (EXPERIENCE.md:71,145; Epic 5)**
Given a selected element,
When the rail's **"Cited by"** section renders,
Then — because **no Interpretation/report claims exist yet** (Epic 5 builds them) — it shows an honest **zero/empty** state (e.g. "No report claims cite this yet" / "Cited by 0 report claims"), **not** a fabricated count and **not** a dead link. There is **no** new Convex query or citation data source in this story; the section is the **contract shell** the Interpretation stories (5.x) and the Report editor (6.1) will populate. Wire it so that lighting it up later is mechanical (a clearly-marked "0 / none yet" region), and note the forward reference in `deferred-work.md`. (EXPERIENCE.md:71 — "backlinks, populated once Interpretation exists")

**AC7 — On `md` viewports the context rail becomes a bottom sheet; below `md` stays read-and-approve friendly (UX-DR17, EXPERIENCE.md:119,120)**
Given a `≥ lg` viewport,
When the Diagnostics tab renders,
Then the rail is a **persistent right column** beside the panels (two-column data-surface layout, `max-w-screen-2xl` — the page already sets this). Given a **`md`** viewport, the rail becomes a **bottom sheet** (a fixed/anchored bottom panel that appears when an element is selected, dismissable, not a blocking modal) rather than a side column. The panels remain fully usable at `md`. No new Radix Sheet/Dialog dependency is added — the responsive rail is CSS/Tailwind-driven (hand-rolled, matching the "no new deps" posture of Story 4.5's charts). (UX-DR17, EXPERIENCE.md:120)

**AC8 — Purely presentational: no engine, schema, Convex-query, or figure changes (AD-1, AD-3)**
Given this story is UI-only,
When it is implemented,
Then it adds **no** Convex query/mutation, **no** schema change, **no** engine/`reserving_engine`/`engine_service` edit, and touches **no** figure computation. It reuses the existing `getDiagnosticsBundle` subscription (Story 4.5) verbatim; `getRun`/`getResultSet`/`retryRun` are untouched. `npm run build`, `npx tsc`, `npm run lint`, `npm test`, and `cd engine && uv run pytest` all stay green; the auth-guard enumeration and audit append-only tests are **unmodified** (no new public function). (AD-1, AD-3)

## Scope Boundary (read first)

This story is the **interaction + navigation layer** over Story 4.5's already-rendered panels — the **third and final** of Epic 4's three review surfaces (4.4 Results, 4.5 Diagnostics panels, **4.6 context rail + deep-linking**). Story 4.5 built the four panels and the **hoverable, keyboard-focusable, semantically addressable** `DiagnosticId` anchors **specifically so 4.6 can attach selection + a DOM scroll-target `id` to them mechanically** (see 4.5 Dev Notes "built addressable for exactly this", and `deferred-work.md` §4.5 bullet 3: *"Story 4.6 will re-add `runId` and attach selection + a DOM scroll-target `id` to the existing `DiagnosticId` anchors"*). 4.6 adds **no figures and no data** — it adds *selection state, a context rail, keyboard grid-nav, and `#<diagnosticId>` deep-linking*.

**In scope:**
- **`components/diagnostics/selection.ts(x)`** (**new**) — a tiny React **selection context** (`DiagnosticSelectionProvider` + `useDiagnosticSelection()`) exposing `{ selectedId: string | null; select(id: string): void; clear(): void }`. Avoids prop-drilling an `onSelect`/`selectedId` pair through all four panels + the compact bar/cell encodings. This is the shared seam every selectable element and the rail read from.
- **`components/diagnostics/SelectableElement.tsx`** (**new**, or fold into existing anchors) — the wrapper/behaviour that makes a diagnostic element selectable: sets the DOM **`id={element.id}`** (scroll target), `onClick`/`onKeyDown(Enter,Space)` → `select(id)`, `aria-current`/`aria-pressed` + a visible **selected ring** when `selectedId === id`, and a transient **highlight** when deep-link-targeted. Applied to the `DiagnosticId` chips (AvE rows, LDF small-multiples/table rows) and the compact anchors (divergence **bars**, heat **cells** — which are the anchor themselves).
- **`components/diagnostics/DiagnosticContextRail.tsx`** (**new**) — the rail. Props `{ diagnosticsBundle: DiagnosticsBundle; runId: string }` (reads `selectedId` from context). Resolves `selectedId` → element via an id→element **`Map`** built from the bundle (all four kinds), renders the per-kind detail (AC5), the ID chip, the **"Cited by"** honest-empty section (AC6), and the **deep-link string** (AC1). Empty state "Select any diagnostic element" when `selectedId === null` (AC2). Responsive: right column on `lg`, bottom sheet on `md` (AC7).
- **`components/DiagnosticsPanels.tsx`** (**edit**) — becomes `"use client"`; **re-add the `runId` prop** (4.5 dropped it — `deferred-work.md` §4.5). Wraps the panels + rail in `DiagnosticSelectionProvider`; lays out **panels + rail** responsively (`lg:` grid `[1fr,20rem]` two-column with the rail as an `aside`; `md` rail as bottom sheet). Accepts an optional `initialSelectedId` (the deep-link target) and drives the select-scroll-highlight effect. The four panel components stay prop-driven; they gain selection via the **context** (through the `DiagnosticId`/anchor wrappers), not new props.
- **Panel edits (behavioural only, no figure change):**
  - `components/diagnostics/DiagnosticId.tsx` — the violet chip becomes an actual **selection control** (a `<button>`-semantic element that calls `select(id)` on click/Enter/Space, `aria-current` when selected, carries `id={id}` scroll target). Keep the hover `title` (full id).
  - `components/diagnostics/ClBfDivergencePanel.tsx` — each **bar** already `tabIndex={0}` with `title`/`aria-label`; make it selectable (`onClick`/Enter/Space → `select(id)`, `id={e.id}`, selected ring). 
  - `components/diagnostics/ResidualHeatmap.tsx` — each **cell** already `tabIndex={0}`; make cells selectable AND add **roving-`tabIndex` arrow-key grid navigation** (AC3) — the canonical grid. `id={e.id}` scroll target, selected ring.
  - `components/diagnostics/LdfStabilityPanel.tsx` — the small-multiple `figure` / table row selectable via its `DiagnosticId` (already carries it); add `id={e.id}` scroll target on the small-multiple wrapper. `AccessibleChart` (table toggle) unchanged.
  - `components/diagnostics/ActualVsExpectedPanel.tsx` — the per-row `DiagnosticId` becomes the row's selection control; `id={e.id}` on the row (`<tr>` or the row-header cell).
- **`components/RunDetail.tsx`** (**edit**) — **deep-link → tab**: on mount (and on `hashchange`), if `window.location.hash` is non-empty, `setTab("diagnostics")` and pass the decoded fragment down as `initialSelectedId` to `DiagnosticsPanels`. Pass `runId={run._id}` to `DiagnosticsPanels`. Keep the existing tab `useState` (deferred-work §4.3 blessed keeping stable tab keys + adding hash handling here). No route change.
- **`app/(app)/runs/[runId]/page.tsx`** (**edit, minimal or none**) — the page already owns `getDiagnosticsBundle` and passes it in; `runId` is already available. Only touch if the hash needs to be surfaced from the page (prefer handling hash inside the client `RunDetail`, which is already `"use client"`).
- **Tests:**
  - `tests/diagnostics-panels.test.tsx` (**extend**): selecting an element (click + keyboard Enter) fills the rail with the correct **stored** values per kind (AC1/AC5); rail empty state "Select any diagnostic element" before selection (AC2); selecting a second element replaces content; deep-link via `initialSelectedId` selects + shows the element's rail detail (AC4); unknown `initialSelectedId` → empty rail, no throw (AC4); "Cited by" shows the zero/empty state (AC6); the selected element carries a selected marker (`aria-current`/ring) (AC1); heatmap arrow-key roving + Enter-selects + Esc behaviour (AC3) as far as jsdom allows (assert roving `tabIndex`/focus + Enter selection; note any jsdom scroll limitation).
  - `tests/run-detail.test.tsx` (**extend**): a mounted `RunDetail` with `window.location.hash = "#dx:…"` opens the **Diagnostics tab** and the rail shows that element (AC4). Keep all 4.3/4.4/4.5 assertions green.
- **Docs:** append a **4.6** section to `deferred-work.md`.

**Explicitly OUT of scope (do NOT build):**
- **Any Diagnostic figure/panel change.** The four panels' figures, formatters, colours, ramp, and IDs are Story 4.5 — frozen. 4.6 only adds selection/rail/nav/deep-link behaviour on top.
- **Citation chips** (the Interpretation claim→Diagnostic affordance) and **real "cited by N" data** → **Epic 5** (5.x) / the Report editor (6.1). 4.6 ships the **empty backlink shell** only; **no** citation query, **no** count, **no** live backlink. (EXPERIENCE.md:55 citation chips are Epic 5.)
- **Any new Convex query/mutation, schema field, or engine edit** (AC8). Reuse `getDiagnosticsBundle`. `pytest`/auth-guard/audit tests stay untouched-green.
- **Promoting the tab to a real nested route** (`/runs/{id}/diagnostics` as a route segment) or a `?tab=` param → left as deferred-work §4.3 headroom. 4.6 satisfies the deep-link by reading the **hash** and switching the client tab; the URL path is the existing `/runs/{id}` page. (If a reviewer expects a real route segment, that is a larger routing change explicitly deferred — the hash-anchor contract `…/diagnostics#<id>` is what citation chips need and is delivered.)
- **A friendly short Diagnostic-ID label** (`D-LDF-02` vs canonical `dx:…`) → deferred-work §4.5 open question; the deep-link fragment and rail chip both use the canonical `element.id` verbatim so the mechanism stays mechanical. Do not introduce a label map here.
- **Report-draft "view in draft" link** (mockup rail) → Epic 6 (the draft doesn't exist yet). The "Cited by" section names the forward reference in copy; no live link.
- **`getRun`/`getResultSet`/orchestration/`engine_service`/`reserving_engine`/schemas** — untouched.

## Tasks / Subtasks

- [x] **Task 1 — Selection context: the shared select seam (AC: 1, 2, 5)**
  - [x] `components/diagnostics/selection.tsx` (**new**, `"use client"`): a React context `DiagnosticSelectionProvider` holding `selectedId: string | null` in `useState`, exposing `{ selectedId, select(id), clear() }` via `useDiagnosticSelection()`. `select(id)` sets the id; selecting the same id again may keep it selected (idempotent). Throw a clear error if `useDiagnosticSelection` is used outside the provider (standard context guard) — or return a null-safe default; pick one and document it.
  - [x] Keep it dependency-free (no external state lib). This is the single source of truth for "which Diagnostic is selected", read by every selectable element and by the rail.

- [x] **Task 2 — Make every diagnostic element selectable + a scroll target (AC: 1, 3, 4)**
  - [x] `components/diagnostics/DiagnosticId.tsx` (**edit**): render the violet id chip as a **selection control** — a real `<button type="button">` (or a `role`-correct focusable element) that calls `select(id)` on click and Enter/Space (a native `<button>` gives Enter/Space for free), sets `id={id}` (the `#<diagnosticId>` scroll target — **canonical `dx:` id verbatim**), `aria-current={selectedId === id ? "true" : undefined}` (or `aria-pressed`), and a visible **selected ring** (`ring-2 ring-primary` / offset) when selected. Preserve `title={id}` (hover full id) and the `numeric`/violet styling. It reads `selectedId`/`select` from `useDiagnosticSelection()`.
  - [x] `components/diagnostics/ClBfDivergencePanel.tsx` (**edit**): the bar div (already `tabIndex={0}`, `title`, `aria-label`) → add `id={e.id}`, `onClick`/`onKeyDown(Enter,Space)` → `select(e.id)`, selected ring when `selectedId===e.id`, `aria-current`. No figure change.
  - [x] `components/diagnostics/ResidualHeatmap.tsx` (**edit**): each populated cell `<td>` (already `tabIndex`, `title`, `aria-label`) → `id={e.id}`, selectable (click/Enter/Space → `select(e.id)`), selected ring, `aria-current`. Empty cells stay non-interactive.
  - [x] `components/diagnostics/LdfStabilityPanel.tsx` (**edit**): add `id={e.id}` to the small-multiple `<figure>` (scroll target); selection flows through its `DiagnosticId` chip. Table-view rows likewise select through their `DiagnosticId`.
  - [x] `components/diagnostics/ActualVsExpectedPanel.tsx` (**edit**): add `id={e.id}` to the row (row-header cell), selection through its `DiagnosticId` chip.
  - [x] **Guardrail:** resolve/scroll to targets by `document.getElementById(id)` or refs — **never** `querySelector('#'+id)` (canonical ids contain `:`). Document this once.

- [x] **Task 3 — Residual heatmap: arrow-key roving grid navigation (AC: 3)**
  - [x] `components/diagnostics/ResidualHeatmap.tsx` (**edit**): make the heatmap a proper **grid widget** — one Tab stop (roving `tabIndex`: the "active" cell is `tabIndex={0}`, all others `tabIndex={-1}`), track `{row,col}` active-cell state, handle `onKeyDown`: ArrowLeft/Right move col, ArrowUp/Down move row (clamped to populated cells / grid bounds), `Enter`/`Space` → `select(activeCellId)`, `Esc` → keep focus in the grid on the active cell (return-to-grid). `focus()` the newly-active cell after arrow moves. Keep the real `<table>` + `<th scope>` semantics (already present); consider `role="grid"`/`gridcell` only if it doesn't fight the existing table semantics — prefer native table + roving tabindex + arrow handlers (announced headers already satisfied). Skip empty/`aria-hidden` cells during navigation.
  - [x] The other three panels: elements are **Tab-reachable + Enter/Space-activatable** (Task 2) — that satisfies "reached by arrow keys and Enter" for the AC's grid requirement at the canonical grid; note in Dev Notes that full 2-D arrow-nav on the small-multiples/bars is not required (they are not 2-D cell grids) and, if wanted later, is deferred.

- [x] **Task 4 — The context rail (AC: 1, 2, 5, 6)**
  - [x] `components/diagnostics/DiagnosticContextRail.tsx` (**new**, `"use client"`): props `{ diagnosticsBundle: DiagnosticsBundle; runId: string }`; reads `selectedId` from `useDiagnosticSelection()`.
  - [x] Build an **id→element `Map`** from the bundle across all four kinds (`ldfStability`, `ave`, `clBfDivergence ?? []`, `residuals`), tagging each with its `kind` so the rail can branch. Resolve `selectedId` → `{kind, element}`.
  - [x] `selectedId === null` → render the **empty state "Select any diagnostic element"** (AC2), styled muted.
  - [x] Selected → render: heading (kind-appropriate, e.g. "LDF 12→24m", "Actual vs expected — 2019", "CL vs BF — 2019", "Residual 2019 · 12→24m"); the **`<DiagnosticId id={element.id} />`** chip; the **per-kind stored values** via `lib/formatNumber` (AC5 list — reuse `formatFactor`/`formatFigure`/`formatPercent`/`formatSignedFigure`/`formatResidual`; for `ldf_stability` print the `linkRatios[].factor` series mono, in order, like the mockup); the **"Cited by"** section (AC6 honest-empty — "No report claims cite this yet" / "Cited by 0 report claims", forward-ref copy to Epic 5, **no** link, **no** query); the **deep-link string** `/runs/{runId}/diagnostics#{element.id}` in `numeric` (optionally a copy affordance — reuse the `CopyableHash` idiom if trivial; a plain mono string is acceptable).
  - [x] **AD-1:** every value is a `format*()` of one stored field resolved from the Map — no arithmetic, no recompute, no re-fetch.

- [x] **Task 5 — DiagnosticsPanels: provider, responsive layout, deep-link driver (AC: 1, 4, 7)**
  - [x] `components/DiagnosticsPanels.tsx` (**edit → `"use client"`**): **re-add `runId: string` prop**. Wrap content in `<DiagnosticSelectionProvider>`. Layout: on `lg+` a two-column grid `grid-cols-1 lg:grid-cols-[minmax(0,1fr)_20rem]` (or similar) — panels in the main column (keep the existing internal `lg:grid-cols-2` panel grid), the `<DiagnosticContextRail>` as a sticky `aside` in the right column. On `md`/below, the rail renders as a **bottom sheet** (Task 6). Pass `diagnosticsBundle`+`runId` into the rail.
  - [x] Accept optional `initialSelectedId?: string | null`. On mount / when it changes (and on in-app `hashchange`, if handled here), if it names an element present in the bundle: `select(id)`, then in a `useEffect` **scroll it into view** (`getElementById(id)?.scrollIntoView({ block: "center" })`) and apply a **transient highlight** (e.g. toggle a `data-highlight`/class for ~1.5s). Unknown id → do nothing (rail stays empty — AC4 no-op). Use `getElementById`, never a `:`-bearing CSS selector.
  - [x] Decide where `hashchange`/mount-hash is read: simplest is `RunDetail` (Task 7) converts the hash → `initialSelectedId` prop; `DiagnosticsPanels` only consumes it. Keep one owner of `window.location.hash`.

- [x] **Task 6 — Responsive bottom sheet on `md` (AC: 7)**
  - [x] Implement the `md` bottom-sheet purely with Tailwind/CSS (no Radix Sheet/Dialog dep): the rail container is a right `aside` at `lg+` (`hidden lg:block` or grid column) and, at `md` and below, a **fixed bottom panel** (`fixed inset-x-0 bottom-0 lg:static`, elevated, max-height with internal scroll) that is **visible when an element is selected** and **dismissable** (a close control → `clear()`), non-blocking (panels stay interactive behind it). Below `md`, keep it read-friendly (EXPERIENCE.md "read-and-approve"); a bottom sheet is acceptable at `sm` too, or collapse gracefully. Render **one** rail instance controlled by CSS breakpoints if feasible (avoid duplicate DOM/ids — duplicate `id={element.id}` scroll targets must not appear twice; the scroll targets live on the **panel elements**, not the rail, so the rail can duplicate safely, but prefer a single rail).
  - [x] Verify no horizontal page scroll at `md` (EXPERIENCE.md:120 — grids scroll in their own container, already handled by 4.5's `overflow-x-auto`).

- [x] **Task 7 — Deep-link → Diagnostics tab wiring in RunDetail (AC: 4, 8)**
  - [x] `components/RunDetail.tsx` (**edit**): add a mount `useEffect` reading `window.location.hash`; if non-empty, `setTab("diagnostics")` and set an `initialSelectedId` state = decoded `hash.slice(1)`. Add a `hashchange` listener (cleanup on unmount) so in-app hash updates (future citation chips) re-target. Pass `runId={run._id}` and `initialSelectedId` into `<DiagnosticsPanels>`. Keep the existing tab `useState`, the step-rail `onSelectDiagnostics`, and all 4.3/4.4/4.5 wiring unchanged.
  - [x] Guard SSR: `window` access only inside `useEffect` (RunDetail is already `"use client"`, but the effect keeps it safe). Decode with care but note canonical ids are already URL-fragment-safe (colons are legal fragment chars) — `hash.slice(1)` is the id verbatim; only `decodeURIComponent` if you also encode when *writing* links (be consistent — recommend NOT percent-encoding since `getElementById` needs the raw `:` id).
  - [x] Confirm no new public Convex function → `convex/authGuard.test.ts` and `tests/audit-append-only.test.ts` stay **unmodified**-green (AC8).

- [x] **Task 8 — Tests + full gates (AC: 1, 2, 3, 4, 5, 6, 7, 8)**
  - [x] `tests/diagnostics-panels.test.tsx` (**extend**, reuse the existing `fixture()` bundle — it already has one populated element per kind incl. non-null `clBfDivergence`; render `DiagnosticsPanels` with a `runId`):
    - Rail **empty state** "Select any diagnostic element" present before any selection (AC2).
    - **Click-to-select** an AvE row's `DiagnosticId` → rail shows heading + the stored `actualMinusExpected`/`actualToExpectedRatio` (the **distinct** fixture values, not the naive recompute) + the id chip (AC1/AC5); the row carries `aria-current`/selected marker.
    - **Keyboard select**: focus a selectable element, press Enter → rail populates (AC3).
    - **Per-kind values**: select an `ldf_stability` element → rail shows CV + the `linkRatios` factor series; a `residual` → the residual value; a `cl_bf_divergence` → stored `divergence`/`relativeDivergence` (never `clUltimate−bfUltimate`) (AC5).
    - **Replace on reselect**: selecting a second element swaps rail content (AC1).
    - **Deep-link**: render with `initialSelectedId="dx:r1:ave:2019"` → rail shows that element on mount (AC4); render with `initialSelectedId="dx:r1:nope:0"` → rail empty, no throw (AC4 no-op).
    - **Cited by**: the zero/empty backlink state is present; assert no fabricated count and no link (AC6).
    - **Heatmap grid**: roving `tabIndex` (exactly one cell `tabIndex=0` initially), ArrowRight moves active cell, Enter selects the active cell (AC3). (Assert focus/tabIndex + selection; if jsdom can't drive `scrollIntoView`, stub/ignore it and assert selection state.)
  - [x] `tests/run-detail.test.tsx` (**extend**): set `window.location.hash = "#dx:r1:residual:2019:12"` before rendering `RunDetail` (pass a matching `diagnosticsBundle` + `runId`) → the Diagnostics tab is active and the rail shows that residual (AC4). Reset `window.location.hash` in `afterEach`. Keep all prior assertions green.
  - [x] **Full gates green before → review:** `npm test` (unit + convex projects — the convex project count is **unchanged**, no new query), root `npx tsc --noEmit` + `npx tsc -p convex/tsconfig.json --noEmit`, `npm run lint`, `npm run build` (recompiles `/runs/[runId]`), and `cd engine && uv run pytest` (**unchanged** — no engine edits). Leave the single Playwright smoke as-is.

## Dev Notes

### This is the interaction layer 4.5 was explicitly built to receive (AD-1 stays; no data added)

Story 4.5 shipped the four panels and made every `DiagnosticId` anchor **hoverable, keyboard-focusable, and semantically addressable** with the stored `element.id` (`dx:{runId}:{kind}:{key}`) rendered verbatim, *precisely* so this story can attach selection + a DOM `id` scroll-target mechanically (4.5 Dev Notes; `deferred-work.md` §4.5 bullet 3, which also flags that **`DiagnosticsPanels` dropped its `runId` prop — 4.6 reintroduces it**). 4.6 adds **no figures and no data**: it adds a selection context, a context rail that resolves the selected id against the *same* `DiagnosticsBundle` the panels render, keyboard grid-nav, the `md` bottom-sheet, and `#<diagnosticId>` deep-linking. AD-1 is honoured for free — the rail formats stored fields, computes nothing (AC5).

### The `#<diagnosticId>` fragment is the canonical id, verbatim — this is a product-wide contract (FR-8)

The deep-link fragment equals `element.id` (canonical `dx:{runId}:{kind}:{key}`) — **not** a friendly `D-LDF-02` label (that label map is deferred-work §4.5 open question; do not introduce it). This keeps deep-linking mechanical: the DOM scroll-target `id`, the selection key, and the URL fragment are one string. EXPERIENCE.md:70 shows the shorthand `…#D-LDF-07` illustratively; the *real* addressable identity is the stored `dx:` id (2.4 "in stored IDs forever"). **Critical guardrail:** canonical ids contain `:`, which is legal in a URL fragment and a valid HTML5 `id`, but **breaks CSS selectors** — resolve targets with `document.getElementById(id)` / element refs and the id→element `Map`, **never** `querySelector('#'+id)`. This deep-link path is what **citation chips will reuse product-wide** (FR-8, EXPERIENCE.md:55/146): build "select + scroll + highlight by id" as one reusable function, not a one-off.

### Tab is client-local state — deep-link switches it via the hash (deferred-work §4.3, blessed)

`RunDetail` holds the active tab in `useState` (Results default; the step rail switches to Diagnostics). Deferred-work §4.3 explicitly anticipated this story: *"Story 4.6 introduces `/runs/{id}/diagnostics#<diagnosticId>` deep-linking — at which point the tab may be promoted to a nested route or a `?tab=`/hash param. The tab keys are kept stable so that promotion is mechanical."* 4.6 takes the **hash** path (not a route promotion — that larger routing change stays deferred): on mount / `hashchange`, a non-empty hash sets `tab="diagnostics"` and the `initialSelectedId`. The `…/diagnostics#<id>` **contract** (what a colleague pastes, what a future citation chip navigates to) is delivered; the URL *path* remains the existing `/runs/{id}` page. Keep the tab keys (`results|diagnostics|interpretation|report`) stable.

### Selection state: a context, not prop-drilling (four panels + compact encodings)

The selected id must be read by every selectable element (AvE rows, LDF small-multiples, divergence **bars**, heat **cells**) and by the rail. Threading `selectedId`+`onSelect` through `DiagnosticsPanels` → each panel → each element is noisy across four heterogeneous panels. A tiny `DiagnosticSelectionProvider`/`useDiagnosticSelection()` context (dependency-free `useState`) is the clean seam — the panels stay otherwise prop-driven (they still take `elements`), and only the leaf anchors + the rail consume the context. This keeps the jsdom specs fixture-driven (render `DiagnosticsPanels` with a bundle + `runId`; the provider is internal).

### The context rail resolves by id from the SAME bundle (AC5 — no re-fetch, no arithmetic)

The rail does not take a "selected element" prop or fire a query — it builds an **id→element `Map`** from the `diagnosticsBundle` prop (across all four kinds, tagging kind) and looks up `selectedId`. This guarantees "every value is a stored field verbatim" by construction (same source the panels render) and means the rail and panels can never disagree. Per-kind detail mirrors the mockup rail (LDF: CV + factor series; the mockup shows `coefficient of variation 0.184` + `1.482 · 1.495 · …`). Reuse the five existing `lib/formatNumber` helpers; add **none**.

### "Cited by N report claims" is an empty contract shell today (AC6, EXPERIENCE.md:71)

There are **no** report claims/citations until Epic 5 (Interpretation) creates them and Epic 6 (Report editor) renders them. EXPERIENCE.md:71/145 explicitly say the backlinks are "populated once Interpretation exists". So the rail's "Cited by" section is an **honest zero/empty state** — no fabricated count, no dead "view in draft" link (that link is Epic 6, mockup notwithstanding). Ship it as a clearly-marked region a 5.x/6.x story can light up mechanically (resolve `selectedId` → count of claims citing it, once a citations source exists). Record the forward reference in `deferred-work.md`. Do **not** add a Convex query here (AC8).

### `md` bottom-sheet: hand-rolled CSS, no new dependency (AC7, EXPERIENCE.md:119,120)

The repo's `components/ui/` has only `badge`, `popover`, `tabs` — **no Sheet/Drawer/Dialog**. Story 4.5 set the precedent of hand-rolling (inline SVG charts) rather than adding a dependency. Do the same: the rail is a persistent right `aside` at `lg+` (grid column) and a **fixed bottom sheet** at `md`/below (`fixed inset-x-0 bottom-0 lg:static …`, appears when selected, dismissable via `clear()`, non-blocking). Don't add `@radix-ui/react-dialog`. Keep the page's `max-w-screen-2xl` (already set by the page) and 4.5's per-grid `overflow-x-auto` so `md` never horizontally scrolls the page.

### Keyboard model (AC3, EXPERIENCE.md:99) — canonical grid = the heatmap

EXPERIENCE.md:99: "Triangle/diagnostic grids: arrow-key cell navigation; `Enter` opens the cell/element in the context rail; `Esc` returns focus to the grid." Implement the full 2-D arrow model on the **residual heatmap** (the real 2-D cell grid) via a **roving `tabIndex`** (one Tab stop; ←→↑↓ move the active cell, clamped; `Enter`/`Space` selects; `Esc` keeps focus on the active grid cell). The other three panels are not 2-D cell grids (small-multiples, a 1-D AvE table, a bar row) — their elements are **Tab-reachable and Enter/Space-activatable**, which satisfies "reached by arrow keys and Enter" at the element level. If a reviewer wants uniform arrow-nav everywhere, that is a deferred enhancement (note it). Preserve the existing `<th scope>` announced headers (4.5).

### Reuse, do not reinvent (existing patterns)

- **Selectable/focusable anchors:** `components/diagnostics/DiagnosticId.tsx`, the divergence **bars** (`ClBfDivergencePanel.tsx`), and heat **cells** (`ResidualHeatmap.tsx`) are **already `tabIndex={0}` with `title`/`aria-label`** — add `id`+`onClick`/`onKeyDown`+selected-ring, don't rebuild them.
- **Formatters:** `lib/formatNumber.ts` (`formatFigure`/`formatFactor`/`formatPercent`/`formatSignedFigure`/`formatResidual`) — the rail reuses these; **add none**.
- **Copyable mono affordance (optional deep-link copy):** the `CopyableHash` idiom from Story 4.4 (`components/` provenance popover) if you want a copy button on the deep-link string; a plain mono string is fine.
- **Provenance token family:** `app/globals.css` `--color-provenance*` + `numeric` utilities — reuse for the id chip; **add no tokens**. Selected ring uses `--color-primary` (teal), the working colour (DESIGN.md:88) — distinct from provenance violet, so "selected" and "id reference" never read ambiguously.
- **jsdom spec conventions:** `tests/diagnostics-panels.test.tsx` (existing `fixture()`), `tests/run-detail.test.tsx` — `// @vitest-environment jsdom`, `@testing-library/react`, `afterEach(cleanup)`, `fireEvent`. Extend both; don't create a new harness. `next/link` is already mocked in `run-detail.test.tsx`.
- **Prop-driven components, page owns data (4.3/4.4/4.5 architecture):** keep it — the page still owns `getDiagnosticsBundle`; `DiagnosticsPanels`/rail take plain props (`diagnosticsBundle`, `runId`, `initialSelectedId`) + the internal selection context. No `convex/react` mocking in the specs.

### Project Structure Notes

- **New:** `components/diagnostics/selection.tsx` (selection context), `components/diagnostics/DiagnosticContextRail.tsx` (the rail), optionally `components/diagnostics/SelectableElement.tsx` (shared selectable behaviour, if not folded into `DiagnosticId`).
- **Edit:** `components/DiagnosticsPanels.tsx` (`"use client"`, re-add `runId`, provider + responsive panels/rail layout + deep-link select-scroll-highlight), `components/diagnostics/DiagnosticId.tsx` (selection control + `id` + selected ring), `components/diagnostics/ClBfDivergencePanel.tsx` + `components/diagnostics/ResidualHeatmap.tsx` (selectable bars/cells + heatmap roving arrow-nav), `components/diagnostics/LdfStabilityPanel.tsx` + `components/diagnostics/ActualVsExpectedPanel.tsx` (`id` scroll targets, selection through `DiagnosticId`), `components/RunDetail.tsx` (hash → tab + `runId`/`initialSelectedId` to `DiagnosticsPanels`), `tests/diagnostics-panels.test.tsx` + `tests/run-detail.test.tsx` (extend).
- **Possibly edit (minimal):** `app/(app)/runs/[runId]/page.tsx` — only if the hash is read at the page level; prefer reading it in `RunDetail` (already `"use client"`). The page already passes `diagnosticsBundle` and has `runId`.
- **No change (AC8):** `convex/**` (no new query — reuse `getDiagnosticsBundle`; `getRun`/`getResultSet`/`retryRun`/orchestration untouched), `convex/schema.ts`, `convex/lib/engineContract.ts`, `convex/authGuard.test.ts`, `tests/audit-append-only.test.ts`, `lib/formatNumber.ts` (reuse only), any `engine/` file (`pytest` unchanged), `package.json` (no new dependency).
- **No codegen** (`npx convex codegen` not needed — no new Convex function).
- **Doc:** append a **4.6** section to `deferred-work.md` — the "Cited by" backlink is an empty shell awaiting Epic 5/6; tab-hash vs real-route-segment decision (route promotion still deferred); friendly-label vs canonical `dx:` id still deferred (§4.5); whether the non-heatmap panels should gain full 2-D arrow-nav; bottom-sheet is hand-rolled CSS (revisit if a shared Sheet primitive lands); any single-rail-vs-duplicate-DOM decision at `md`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.6] — story statement + ACs (lines 523-539): context rail fill on click/arrow+Enter, empty state "Select any diagnostic element", `Esc` returns focus to grid, announced table headers, `/runs/{id}/diagnostics#<diagnosticId>` scroll-to+highlight as the product-wide citation navigation target (FR-8), `md` bottom-sheet (UX-DR17); Epic 4 summary (430-432)
- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.5] — the panels + `DiagnosticId` anchors this story attaches to (506-521); [#Story 4.7] the "cited by N backlinks now populate" completion note (line 648) is Epic 5's job, not 4.6/4.7
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-agentic-reserving-2026-07-16/EXPERIENCE.md] — context rail = selected element detail: values, Diagnostic ID, "cited by N report claims" backlinks, empty state "Select any diagnostic element" (71); backlinks populated once Interpretation exists (145 climax, 146); citation chips product-wide navigate to a Diagnostic highlighted (55 — Epic 5); arrow-key cell nav / `Enter` opens in rail / `Esc` returns to grid (99); deep-linkable `…/diagnostics#D-LDF-07` (70, illustrative shorthand); `≥ lg` full experience uses the context rail (119); `md` sidebar→icons, **context rail becomes a bottom sheet**, grids scroll in their own container (120); WCAG 2.2 AA floor + focus order follows golden path, cells focusable (98, 106)
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-agentic-reserving-2026-07-16/mockups/diagnostics-review.html] — the `<aside class="rail">` (lines 108-121): "Selected diagnostic" + id chip, kind detail heading + value (`0.184`), factor series (`1.482 · 1.495 · 1.371 · 1.503 · 1.618`), "Cited by 3 report claims → view in draft" (the count + "view in draft" are Epic 5/6 — render the **empty** shell), the deep-link string `/runs/2026Q2-014/diagnostics#D-LDF-02`. Spine wins on conflict.
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-agentic-reserving-2026-07-16/DESIGN.md] — provenance violet exclusive to Diagnostic-ID references / citation chips / Lineage links (89, 126) — keep the id chip violet; primary **teal** is the working/selected/active colour (88) — use it for the selected ring so "selected" ≠ "id reference"; persistent right context rail on data surfaces, collapses per breakpoint (110)
- [Source: _bmad-output/planning-artifacts/architecture/architecture-agentic-reserving-2026-07-16/ARCHITECTURE-SPINE.md] — AD-1 numbers only from the engine / no arithmetic in React (the rail formats stored fields only); AD-3 Convex sole system of record (this story adds no query/data); FR-8 diagnostics deep-linkable + ID-addressable, the citation navigation target; NFR-2 diagnostics viewable without interpretation (the rail's "cited by" is empty, panels/rail still fully work)
- [Source: components/DiagnosticsPanels.tsx] — the 4.5 container to make `"use client"`, re-add `runId`, wrap in the provider, add the panels+rail responsive layout + deep-link driver (currently a pure 2-col panel grid, no rail, no `runId`)
- [Source: components/diagnostics/DiagnosticId.tsx] — the violet, `tabIndex={0}`, `title`-bearing id chip to upgrade into a selection control (`<button>` + `id={id}` + `select(id)` + selected ring); comment already says it was "kept keyboard-focusable and semantically addressable so Story 4.6 can attach selection + a DOM scroll-target `id`"
- [Source: components/diagnostics/ClBfDivergencePanel.tsx:16-42] — the bar div (already `tabIndex={0}`, `title={e.id}`, `aria-label`) to make selectable; [components/diagnostics/ResidualHeatmap.tsx:90-114] — the cell `<td>` (already `tabIndex={0}`, `title={e.id}`, `aria-label`) to make selectable + add roving arrow-nav
- [Source: components/diagnostics/ActualVsExpectedPanel.tsx:54-77, components/diagnostics/LdfStabilityPanel.tsx:37-80] — per-row / per-figure `DiagnosticId` anchors to hang selection + `id={e.id}` scroll targets on
- [Source: components/RunDetail.tsx:79, 159-189] — the tab `useState` + the Diagnostics `TabsContent` rendering `<DiagnosticsPanels diagnosticsBundle=… />` (add `runId`+`initialSelectedId`; add the mount/`hashchange` → `setTab("diagnostics")` effect)
- [Source: app/(app)/runs/[runId]/page.tsx:45-48, 91-98] — the page already owns the `getDiagnosticsBundle` subscription and has `runId`; passes `diagnosticsBundle` into `RunDetail` (minimal/no change)
- [Source: lib/formatNumber.ts:42-76] — the five display-only formatters the rail reuses (`formatFigure`/`formatFactor`/`formatPercent`/`formatSignedFigure`/`formatResidual`) — add none
- [Source: convex/lib/engineContract.ts:82-137, 200] — `DiagnosticsBundle` type + the four element shapes (field names, `id`, nullability, `clBfDivergence` null-union) the rail's id→element `Map` iterates
- [Source: tests/diagnostics-panels.test.tsx:1-70] — the existing `fixture()` (one populated element per kind, `clBfDivergence` non-null, deviations set **distinct** from the naive recompute) to reuse for the rail/selection specs; [tests/run-detail.test.tsx:1-48] — the `makeRun`/`makeResultSet`/`next/link`-mock harness + `DiagnosticsBundle` fixture to extend for the hash → tab test
- [Source: _bmad-output/implementation-artifacts/4-5-diagnostics-review-panels.md] — the sibling story: panels + `DiagnosticId` built addressable for 4.6; the three flagged decisions (friendly label, ramp thresholds, uniformly-visible id on compact encodings)
- [Source: _bmad-output/implementation-artifacts/deferred-work.md §4.5, §4.3] — §4.5 bullet 3 (4.6 re-adds `runId` + attaches selection + DOM `id` to the anchors), §4.5 bullet 1 (canonical `dx:` id vs friendly label — keep canonical for the fragment), §4.5 bullet 5 (compact encodings carry id via `title`/`aria-label`), §4.3 (tab is client-local state; 4.6 introduces hash deep-linking; tab keys kept stable for mechanical promotion)
- [Source: _bmad-output/project-context.md] — AD-1 no arithmetic outside the engine (rail formats only), requireMember-first (N/A — no new query), vocabulary (Diagnostic, DiagnosticsBundle, Diagnostic ID `dx:{runId}:{kind}:{key}`, Origin/Development Period — never synonyms), "❌ Polling in application code" (reuse the existing subscription; no new fetch)

## Dev Agent Record

### Agent Model Used

Amelia (dev agent) — claude-opus-4-8[1m].

### Debug Log References

All gates green on completion:
- `npm test` → **287 passed** (24 files; +11 over 4.5's 276 — 10 new Story-4.6 diagnostics-panels specs + 1 new run-detail hash spec).
- `npx tsc --noEmit` (root) → clean; `npx tsc -p convex/tsconfig.json --noEmit` → clean.
- `npm run lint` → clean.
- `npm run build` → success; `/runs/[runId]` recompiled.
- `cd engine && uv run pytest` → **205 passed, 9 skipped** (unchanged — no engine edits, AC8).

Three first-run failures, all in the newly-authored Story-4.6 specs (test expectation typos, not implementation bugs), fixed:
1. Rail headings were asserted as `"LDF 12→24m"` / `"Residual 2019 · 24→36m"` (mockup shorthand carries a trailing "m"); the component renders `"LDF 12→24"` / `"Residual 2019 · 24→36"` (no "m", matching the panels' own `fromDev → toDev` idiom). Corrected the expectations.
2. (folded into 1) same trailing-"m" typo in the reselect spec.
3. (folded into 1) same in the heatmap Enter-select spec — the Enter did select (rail rendered the deep-link), only the asserted heading string was wrong.

Also fixed a duplicate-DOM-`id` bug caught during authoring: the rail initially reused the interactive `<DiagnosticId>` (which emits `id={id}`), duplicating the panel element's `id={element.id}` scroll target — replaced with a plain non-interactive violet display `<span>` (no `id`, no button).

### Completion Notes List

- **AC1 (select → rail):** a dependency-free `DiagnosticSelectionProvider`/`useDiagnosticSelection()` context holds `selectedId`; every diagnostic element (AvE/LDF `DiagnosticId` chips as `<button>`s, divergence bars, heat cells) selects on click/Enter/Space and shows a primary-teal selected ring + `aria-current`. The rail fills with a kind heading, the id chip, per-kind stored values, the "Cited by" section, and the deep-link string; reselecting replaces content.
- **AC2 (empty state):** the rail shows "Select any diagnostic element" verbatim until something is selected (and for an unknown/stale deep-link id).
- **AC3 (keyboard):** the residual heatmap is a roving-`tabIndex` 2-D grid (one Tab stop; ←→↑↓ move the active cell clamped + skipping empty cells; Enter/Space opens it in the rail; Esc keeps focus on the active grid cell). The other panels' elements are Tab-reachable native `<button>`s (Enter/Space for free). `<th scope>` headers preserved.
- **AC4 (deep link):** `RunDetail` reads `window.location.hash` on mount + `hashchange` → switches to the Diagnostics tab and passes `initialSelectedId`; `DiagnosticsPanels` selects it, `getElementById`-scrolls it into view, and flashes a transient inline `outline`. Unknown id → no-op (rail empty, no throw). Ids resolved by `getElementById`/`Map` only — never a `:`-breaking CSS selector. This is the single reusable "select by id" path citation chips will reuse (FR-8).
- **AC5 (verbatim, zero arithmetic — AD-1):** the rail builds an id→element `Map` from the same `DiagnosticsBundle` the panels render and formats stored fields only via the five existing `lib/formatNumber` helpers (added none). No recompute of A−E/divergence; a no-arithmetic probe (`-150` shown, `-158` absent; `+120` shown, `+113` absent) guards it.
- **AC6 (Cited by shell):** honest-empty "Cited by 0 report claims. Backlinks appear once Interpretation exists." — no fabricated count, no link, no citations query (Epic 5/6 own the data).
- **AC7 (responsive):** one rail instance — persistent right column on `lg` (`grid-cols-[minmax(0,1fr)_20rem]`), a fixed bottom sheet below `lg` (`max-lg:fixed inset-x-0 bottom-0`, visible only when selected, dismissable via Clear), hand-rolled Tailwind, no new Sheet/Dialog dependency.
- **AC8 (purely presentational):** no Convex query/mutation, no schema change, no engine edit. `getRun`/`getResultSet`/`getDiagnosticsBundle`/`retryRun` untouched; `convex/authGuard.test.ts` + `tests/audit-append-only.test.ts` unmodified-green; pytest unchanged; no new dependency; no `npx convex codegen`.
- **Reuse/scope discipline:** attached selection to the already-focusable 4.5 anchors (didn't rebuild them); AvE + LDF panels needed no edit (their `DiagnosticId` chips now own selection + the `id` target). Citation chips, real "cited by N" data, a friendly `D-LDF-02` label, the "view in draft" link, and a real route-segment promotion are all left deferred (see `deferred-work.md` §4.6).

### File List

**New:**
- `components/diagnostics/selection.tsx` (selection context)
- `components/diagnostics/DiagnosticContextRail.tsx` (the context rail)

**Edited:**
- `components/DiagnosticsPanels.tsx` (`"use client"`, re-added `runId`, provider + responsive panels/rail layout + deep-link select-scroll-highlight driver)
- `components/diagnostics/DiagnosticId.tsx` (chip → selection control: `<button>`, `id={id}`, `select`, selected ring, `aria-current`)
- `components/diagnostics/ClBfDivergencePanel.tsx` (bars selectable + `id` + selected ring)
- `components/diagnostics/ResidualHeatmap.tsx` (`"use client"`, cells selectable + `id`, roving-`tabIndex` arrow-key grid nav + Enter/Space/Esc)
- `components/RunDetail.tsx` (hash → Diagnostics tab, pass `runId`/`initialSelectedId` to `DiagnosticsPanels`)
- `tests/diagnostics-panels.test.tsx` (added `runId`; new Story-4.6 rail/selection/deep-link/keyboard suite — 10 specs)
- `tests/run-detail.test.tsx` (new hash → Diagnostics-tab deep-link spec + hash reset; added `within` import)
- `_bmad-output/implementation-artifacts/deferred-work.md` (§4.6 section)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (4.6 → in-progress → review)

**Unchanged (AC8):** `components/diagnostics/LdfStabilityPanel.tsx` + `ActualVsExpectedPanel.tsx` (their `DiagnosticId` chips gained selection + `id` for free via the upgraded `DiagnosticId`), `components/diagnostics/AccessibleChart.tsx`, `app/(app)/runs/[runId]/page.tsx` (already had `runId`/`diagnosticsBundle`; hash handled in `RunDetail`), `convex/**`, `lib/formatNumber.ts`, all `engine/` files.

## Change Log

| Date       | Version | Description                                                                 |
| ---------- | ------- | --------------------------------------------------------------------------- |
| 2026-07-19 | 0.1     | Story 4.6 drafted: Diagnostic context rail + `#<diagnosticId>` deep-linking layered onto Story 4.5's panels. Selection context makes every diagnostic element selectable (click / Enter-Space; heatmap roving arrow-nav + Esc-to-grid); the rail resolves the selected id against the same `DiagnosticsBundle` and renders per-kind stored values verbatim (AD-1), an id chip, an honest-empty "Cited by" shell (Epic 5), and the deep-link string; `md` bottom-sheet, `lg` right column (hand-rolled CSS, no new dep); `RunDetail` reads `window.location.hash` → Diagnostics tab + `initialSelectedId` → select-scroll-highlight (the product-wide citation nav target, FR-8). No new Convex query/schema/engine edit (AC8). Status → ready-for-dev. |
| 2026-07-19 | 1.0     | Story 4.6 implemented: `DiagnosticSelectionProvider` context + `DiagnosticContextRail`; `DiagnosticId` upgraded to a selection-control `<button>` (owns the `id` scroll target); divergence bars + heat cells selectable; residual heatmap is a roving-`tabIndex` 2-D grid (arrow nav + Enter/Space/Esc); `DiagnosticsPanels` now `"use client"` with the provider, the responsive rail (lg right column / md bottom sheet, no new dep), and the `initialSelectedId` deep-link driver (select + `getElementById` scroll + transient outline); `RunDetail` maps `window.location.hash` → Diagnostics tab + `initialSelectedId`. Rail values are stored fields verbatim (AD-1, no arithmetic); "Cited by" is an honest-empty shell. No Convex/schema/engine edits (AC8). All gates green (npm test 287; tsc root+convex; lint; build; pytest 205/9 unchanged). Status → review. |

### Review Findings (code review 2026-07-19)

- [x] [Review][Patch] HIGH — Deep-linked Diagnostics selection trap: `select`/`clear` get fresh identities on every `selectedId` change (selection.tsx memo keyed on `[selectedId]`), so the deep-link effect (dep `select`) re-fires on every subsequent click and snaps selection back to the hash target; "Clear" is defeated the same way. Fix: `useCallback` select/clear, or a once-applied ref guard [components/diagnostics/selection.tsx:31-38, components/DiagnosticsPanels.tsx:51-73]
- [x] [Review][Patch] `RunDetail` sets `initialSelectedId` on hashchange but never clears it back to null on an empty hash, latching the old selection [components/RunDetail.tsx]
- [x] [Review][Defer] `buildIndex` + origin/dev axis arrays rebuilt on every render (no `useMemo`) — deferred, harmless perf on immutable bundles
- [x] [Review][Defer] A deep-link hash on a queued/running run forces the empty Diagnostics tab — deferred, unknown ids already no-op
- [x] [Review][Defer] Glossary "Run" is lowercased in some user-facing copy ("Start run", "Run methods") — deferred, cosmetic vocabulary drift
