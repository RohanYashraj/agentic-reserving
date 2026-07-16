---
name: Reserving Copilot
status: final
sources:
  - "{planning_artifacts}/prds/prd-agentic-reserving-2026-07-16/prd.md"
  - "{planning_artifacts}/prds/prd-agentic-reserving-2026-07-16/addendum.md"
updated: 2026-07-16
---

# Reserving Copilot — Experience Spine

> Scope note: this run covers, in depth, (1) the upload-to-report journey, (2) the Diagnostics review screen, and (3) the Senior Actuary approve/publish flow. The full IA is sketched for coherence; surfaces outside scope (Audit Log browser, Workspace settings) are named but specified only to their contract. Vocabulary follows the PRD Glossary verbatim.

## Foundation

Responsive web, desktop-first — reserving reviews happen on large screens; `sm` viewports get read-and-approve, not data work. shadcn/ui on Next.js (App Router) + Tailwind; `DESIGN.md` is the visual identity reference and names the brand-layer override surface. All state is server-held in Convex; every surface is a live subscription — no manual refresh anywhere in the product (PRD FR-20). Tenancy: one Clerk organization = one Workspace; every surface is Workspace-scoped. Roles: Analyst, Senior Actuary (superset).

## Information Architecture

| Surface | Reached from | Purpose | This run |
|---|---|---|---|
| Dashboard | App open | Recent Runs, reports awaiting review, quarter status | contract only |
| Triangles | Sidebar | Triangle library: upload, validation results, hashes | **in scope** |
| Upload wizard | Triangles → "Upload" | CSV/Excel intake → validation → period confirmation | **in scope** |
| Run detail | Dashboard / Triangles → Run | Tabs: **Results · Diagnostics · Interpretation · Report** — the spine of the golden path | **in scope** |
| Diagnostics review | Run detail tab | The four Diagnostics, ID-addressable, with context rail | **in scope** |
| Report review | Run detail tab / review queue | Draft editing, citation verification, approve/publish | **in scope** |
| Audit Log | Sidebar | Filterable event trail (PRD FR-16) | contract only |
| Settings | Avatar menu | Profile, theme; roles are Clerk-managed (PRD §4.7) | contract only |

The golden path is linear and always visible: a **step rail** across the top of Run detail — `Upload → Triangle → Run → Diagnostics → Report → Published` — with the current step in `{colors.primary}` and completed steps checkmarked. Users can jump back to any completed step; forward jumps are disabled until the prerequisite exists.

Modal depth: one level. Anything needing more space is a surface, not a dialog.

→ Composition reference: `mockups/diagnostics-review.html`, `mockups/report-review.html`. Spine wins on conflict.

## Voice and Tone

Microcopy speaks like a careful colleague: precise, unhurried, never celebratory. This is a product whose output gets signed under professional standards — the copy must never oversell certainty.

| Do | Don't |
|---|---|
| "Validation found 3 issues in 2 columns." | "Oops! Something's wrong with your file 😕" |
| "Recommendation: BF for 2023–2025. See citations." | "AI suggests BF! ✨" |
| "Approved by Priya N., 16 Jul 2026, 14:32. Logged." | "Report approved successfully! 🎉" |
| "Interpretation unavailable. Engine features unaffected." | "AI is down, please try again later." |
| "This draft cites 41 diagnostics. 41 resolve." | "Draft looks good!" |

Numbers in copy always carry their unit and period ("IBNR £4.2m, AY 2023"). The word "recommends" is reserved for the Interpretation layer; the system itself never recommends.

## Provenance & Trust Patterns

Product-specific section — the UX expression of the PRD's calculation firewall.

- **Citation chips everywhere a claim lives.** Every sentence of Interpretation output renders its Diagnostic ID(s) as citation chips (`DESIGN.md {components.citation-chip}`). Hover previews the cited value; click navigates to that Diagnostic with the element highlighted. A claim without a chip cannot exist on screen — the Provenance Gate guarantees it upstream; the UI renders what the gate passed.
- **Engine numbers are visually distinct.** All engine-derived figures set in `{typography.numeric}`. Prose (human or AI) is sans; evidence is mono. Users learn the texture within a session.
- **Provenance popover.** Every ResultSet figure offers a right-click / long-press "Where did this come from?" → popover with Lineage: engine version, chainladder version, Triangle hash (truncated, copyable), parameters, link to the Run in the Audit Log.
- **AI content is labeled, not decorated.** Interpretation panels carry a quiet header — "Drafted by the interpretation layer · every claim cites a diagnostic" — no sparkle icons, no chat framing. The AI is a drafting colleague whose work is always reviewable, never a persona.
- **Overrides are first-class.** Where a Senior Actuary overrides a recommendation, the UI shows both: recommendation (with citations) struck-through-none, override beside it with the recorded reason and the approver's name. History is never visually erased.

## Component Patterns

Behavioral. Visual specs live in `DESIGN.md.Components`.

| Component | Use | Behavioral rules |
|---|---|---|
| Step rail | Run detail | Shows golden-path position; completed steps clickable, future steps disabled with tooltip stating the prerequisite ("Run methods to unlock Diagnostics"). |
| Triangle grid | Triangles, Run detail | Read-only always (no in-app editing, PRD §6.2). Latest Diagonal edge-marked. Validation issues: flagged cells + a findings list beneath; clicking a finding scrolls/highlights the cell. |
| Citation chip | Interpretation, Report | See Provenance & Trust. Keyboard: chips are tab-stops; `Enter` navigates, `Space` opens preview. |
| Diagnostic panel | Diagnostics review | One per Diagnostic family; every element carries its Diagnostic ID as a hoverable anchor. Deep-linkable: `/runs/{id}/diagnostics#D-LDF-07`. |
| Context rail | Diagnostics review | Right rail showing the selected element's detail: values, Diagnostic ID, "cited by N report claims" backlinks. Empty state: "Select any diagnostic element." |
| Recommendation table | Interpretation tab | One row per Origin Period: recommended Method, reasons with chips, status (accepted / overridden). Senior Actuary sees an Override action per row → dialog requiring a reason (PRD FR-10). |
| Report editor | Report review | Section-structured editor (exec summary, method rationale, movement commentary, limitations). Chips are atomic tokens — editable around, not inside; deleting a chip flags the sentence "claim now uncited" and blocks approval until resolved or the sentence is deleted. |
| Approval bar | Report review (Senior Actuary) | Sticky bottom bar: citation-resolution count, diff-since-draft link, Approve & Publish button. Analysts see the same bar with "Awaiting Senior Actuary review" and an assign control. |
| Status badge | Everywhere | Vocabulary: `draft · running · complete · failed · awaiting review · published · engine-only`. Never restyled locally. |

## State Patterns

| State | Surface | Treatment |
|---|---|---|
| Upload parsing/validating | Upload wizard | Inline progress with named stages ("Parsing… Validating shape… Checking monotonicity…"). Never a bare spinner. |
| Validation failed | Upload wizard | Findings list with cell coordinates; Triangle grid preview with flagged cells; primary action "Fix source and re-upload" — no in-app repair (PRD §6.2). |
| Duplicate upload | Upload wizard | "Identical triangle already exists (hash match)" + link to the existing Triangle; no silent dedupe. |
| Run queued/running | Run detail | Step rail pulses on Run; live status via Convex subscription; per-Method progress rows. |
| Run failed | Run detail | Destructive banner with engine error summary + "Retry run" (idempotent, PRD FR-4). |
| Interpretation drafting | Interpretation tab | Skeleton of the recommendation table + "Reading diagnostics…" — no token-streaming theater. Output appears when the Provenance Gate has passed it, complete. [ASSUMPTION: no streaming display — gated output is shown post-validation only, so partial ungated text never reaches the user.] |
| Provenance Gate retry | Interpretation tab | Quiet status: "Draft failed provenance check — redrafting (attempt 2 of N)." Visible, not alarming. |
| Engine-Only Mode | Global | Full-bleed caution banner; Interpretation/Report-draft actions disabled with tooltip; everything else untouched. Entry/exit toasts once. Manual report drafting from template offered on the Report tab (PRD FR-12). |
| Awaiting review | Report review | Analyst view read-only after submitting for review [ASSUMPTION: draft locks on submission to prevent edit-during-review races]. |
| Published | Report review | Content immutable; green badge; actions: Export to Word, View approval record, Start new version. |
| Empty Workspace | Dashboard | "No triangles yet. Upload the first one to start the quarter." Single primary action. |
| Permission denied | Any | Role-gated controls render disabled with tooltip ("Senior Actuary role required") — visible-but-disabled, because knowing the approval step exists is part of understanding the workflow. Cross-Workspace: nothing renders at all. |

## Interaction Primitives

Mouse/trackpad-first (actuaries live in Excel, not vim), with a complete keyboard path for accessibility rather than power-user chords.

- `Tab` order follows the golden path on every surface; citation chips and grid cells are focusable.
- Triangle/diagnostic grids: arrow-key cell navigation; `Enter` opens the cell/element in the context rail; `Esc` returns focus to the grid.
- `⌘K` command palette for navigation only (go to Run, Triangle, report) — no destructive actions in the palette.
- All confirmations that create audit events (submit for review, override, approve) are explicit dialogs restating what will be recorded: "This will publish v1 and log your approval. This cannot be edited afterward."
- **Banned:** drag-and-drop as the only path to anything; hover-only affordances on touch; optimistic UI for audit-generating actions (they confirm on server ack — a logged approval must never flicker back); infinite scroll (paginate the Audit Log); auto-advancing wizard steps.

## Accessibility Floor

WCAG 2.2 AA. Behavioral rules; contrast lives in DESIGN.md (brand tokens verified AA on their pairings).

- Diagnostics never encode meaning in color alone: heatmap cells print values; flagged cells carry an icon + coordinates in the findings list; status badges pair color with label text.
- Grids expose proper table semantics (row/column headers announced: "Origin 2021, Development 24 months, value 4,213,000").
- Citation chips announce as links with context: "Citation, diagnostic D-LDF-07, loss development factor stability."
- Live status (Run progress, Interpretation drafting) announced via `aria-live="polite"`; Engine-Only Mode entry via `aria-live="assertive"` once.
- Approval dialog is fully keyboard-operable; focus trapped, initial focus on the cancel action (deliberate: the consequential action requires an explicit move).
- Charts (LDF stability, A-vs-E) ship with an accessible table toggle showing the same data.

## Responsive & Platform

| Breakpoint | Behavior |
|---|---|
| `≥ lg` | Full experience. Data surfaces use the context rail; report review shows editor + citation sidebar. |
| `md` | Sidebar to icons; context rail becomes a bottom sheet; triangle grids scroll horizontally in their own container. |
| `< md` | Read-and-approve only: dashboards, report reading, approve/publish flow, audit trail. Upload and diagnostics deep-work surfaces show "Best on a larger screen" with read-only fallback. [ASSUMPTION: mobile approval is in scope — a Senior Actuary approving from a phone matches the review-queue reality; confirm.] |

## Key Flows

Protagonists mirror PRD UJ-1–UJ-3: Dana (Analyst), Priya (Senior Actuary).

### Flow 1 — Upload to report (Dana, Analyst, first morning of close) *(realizes PRD UJ-1)*

1. Dana opens the Workspace; Dashboard shows last quarter's Runs and an empty "This quarter" section. She clicks **Upload triangle**.
2. **Wizard step 1 — File.** Drops `motor_paid_2026Q2.xlsx`; picks *Paid*, cumulative. Parsing stages stream inline.
3. **Wizard step 2 — Validation.** Findings: two missing cells, one non-monotonic value at (AY 2022, dev 36). Grid preview flags the cells amber; findings list gives coordinates. Primary action: *Fix source and re-upload*. She fixes the export, re-drops; validation passes clean — "0 issues. Content hash `a3f4…` recorded."
4. **Wizard step 3 — Periods.** Detected: accident years 2016–2025, annual development to 120 months. She confirms. Triangle lands in the library, immutable.
5. **Run config.** From the Triangle: **Run methods** → checks CL, BF, Mack. BF opens the a-priori grid — one loss ratio per Origin Period, mono inputs, pasteable column. Run cannot start until all ten are filled (PRD FR-4).
6. She starts the Run. Step rail pulses; per-Method rows tick to complete live. ResultSet renders: ultimates/IBNR per Method per Origin Period in the triangle-grid texture.
7. She opens **Diagnostics**, scans stability and A-vs-E (see Flow 2), then clicks **Generate interpretation**.
8. **Climax:** the recommendation table appears — one row per accident year, each recommendation trailing violet citation chips. She hovers a chip on the 2024 row; the preview shows the CL-vs-BF divergence value it cites. The reasoning isn't a black box — it's pinned to numbers she just reviewed, in a color that can't mean anything else.
9. She clicks **Generate report**, watches the gated draft arrive complete, gives it one read, and submits for review, assigning Priya. Status: `awaiting review`. Elapsed: under an hour.

Failure: interpretation API down at step 7 → Engine-Only banner; she still has ResultSet + Diagnostics, and the Report tab offers the manual template. The quarter does not stall (PRD FR-12).

### Flow 2 — Diagnostics deep-dive (Dana, same session) *(the Diagnostics review screen)*

1. Diagnostics tab: four panels — **LDF stability** (small-multiple charts by development period), **Actual vs Expected** (latest-diagonal table, deviations mono-printed), **CL vs BF divergence** (per-Origin-Period bars), **Residual heatmap** (blue↔amber cells, values printed).
2. She spots a wobble in the 12–24 month factor chart and clicks the outlier point.
3. Context rail fills: Diagnostic `D-LDF-02`, the factor series, coefficient of variation, "cited by 3 report claims" (backlinks, populated once Interpretation exists).
4. **Climax:** every element she inspects has an identity — an ID she can cite in her own notes, deep-link to a colleague (`…/diagnostics#D-LDF-02`), and later see cited back at her from the draft report. The diagnostics screen and the report are one fabric, not two documents.
5. `Esc` returns her to the grid; arrow keys walk adjacent factors.

### Flow 3 — Approve and publish (Priya, Senior Actuary, that afternoon) *(realizes PRD UJ-2)*

1. Priya's Dashboard shows a review queue: "Motor 2026Q2 — awaiting review, submitted by Dana." She opens Report review.
2. Layout: section-structured draft left, citation sidebar right — every chip listed with its resolution state. Approval bar: "41 claims · 41 citations resolve."
3. She reads the movement commentary, clicks a chip on an emergence claim, lands on the A-vs-E Diagnostic, reads the actuals, returns via breadcrumb — context preserved.
4. On the greenest accident year she disagrees with the CL recommendation. In the recommendation table she clicks **Override** → dialog: choose BF, reason required. She writes it; the row now shows recommendation and override side by side, both attributed.
5. She tightens two sentences in the exec summary. Chips travel intact with the edited prose.
6. She clicks **Approve & Publish**. Dialog restates the record: report version, 41/41 citations, her override, "This will be logged and the published version cannot be edited." Focus starts on Cancel; she tabs to confirm.
7. **Climax:** the badge flips to `published` green — the only green in the product — and the approval record renders inline: "Approved by Priya N., 16 Jul 2026, 14:32 · Logged." The sign-off moment *feels* like a sign-off: singular, recorded, hers.
8. She clicks **Export to Word**; the `.docx` downloads with citations rendered as readable references. The export lands in the Audit Log like everything else.

Failure: if any citation fails to resolve at step 6 (e.g., her edits orphaned a claim), Approve is disabled with the failing sentence linked — she fixes or deletes it; the gate is a door, not an alarm.
