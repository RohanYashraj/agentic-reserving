---
name: Reserving Copilot
description: Instrument-grade actuarial workbench. shadcn/ui on Next.js + Tailwind; this DESIGN.md specifies the brand-layer delta only.
status: final
updated: 2026-07-16
colors:
  # Brand overrides on top of shadcn defaults. All unlisted tokens inherit from
  # shadcn (background, foreground, muted, muted-foreground, card, popover,
  # border, input, ring, destructive).
  primary: '#0E5E59'
  primary-foreground: '#FFFFFF'
  primary-dark: '#4FB3AB'
  primary-foreground-dark: '#06201E'
  provenance: '#5B4B9E'
  provenance-foreground: '#FFFFFF'
  provenance-subtle: '#EEEBF7'
  provenance-dark: '#A493E0'
  provenance-foreground-dark: '#171130'
  provenance-subtle-dark: '#262040'
  caution: '#B45309'
  caution-subtle: '#FEF3E2'
  caution-dark: '#F5A94E'
  caution-subtle-dark: '#3A2A12'
  published: '#166534'
  published-subtle: '#E8F5EC'
  published-dark: '#6EC98A'
  published-subtle-dark: '#12301C'
typography:
  # Body, label, muted inherit shadcn (Geist Sans). Numeric and display are the deltas.
  numeric:
    fontFamily: 'Geist Mono'
    fontSize: 13px
    fontWeight: '450'
    letterSpacing: '0'
  numeric-lg:
    fontFamily: 'Geist Mono'
    fontSize: 16px
    fontWeight: '500'
  display:
    fontFamily: 'Geist Sans'
    fontSize: 28px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: -0.01em
rounded:
  sm: 4px
  md: 6px
  lg: 8px
spacing:
  # shadcn / Tailwind 4-based scale inherited; one named token for triangle grids.
  cell-pad: 6px
components:
  citation-chip:
    background: '{colors.provenance-subtle}'
    foreground: '{colors.provenance}'
    radius: '{rounded.full}'
    font: '{typography.numeric}'
    border: 'none'
  status-badge-published:
    background: '{colors.published-subtle}'
    foreground: '{colors.published}'
    radius: '{rounded.full}'
  engine-only-banner:
    background: '{colors.caution-subtle}'
    foreground: '{colors.caution}'
    radius: '0'
  triangle-cell-flagged:
    background: '{colors.caution-subtle}'
    foreground: '{colors.caution}'
  button-primary:
    background: '{colors.primary}'
    foreground: '{colors.primary-foreground}'
    radius: '{rounded.md}'
  button-approve:
    background: '{colors.published}'
    foreground: '#FFFFFF'
    radius: '{rounded.md}'
---

## Brand & Style

Reserving Copilot is an instrument, not an app. Its users sign their names to its output in a regulated context, so the surface must read the way a well-kept working paper reads: calm, dense where density earns its keep, and visually silent except where something demands judgment. The brand's one expressive idea is **provenance made visible** — every AI-drafted claim wears a citation chip in a color used for nothing else, so trustworthiness is a texture you can see at a glance, not a promise in the footer.

The product inherits shadcn/ui wholesale. This DESIGN.md is the brand-layer delta only: a primary teal, the provenance violet, two semantic families (caution, published), a monospace numeric role, and a handful of product-specific components. Everything else ships as shadcn defaults, and customizing beyond this layer is against the discipline. [ASSUMPTION: shadcn/ui as the UI system and this whole visual direction were set without user elicitation — confirm or redirect before build.]

## Colors

- **Primary Teal (`#0E5E59` light / `#4FB3AB` dark)** — the working color: primary buttons, active nav, focused steps in the golden path, links. Chosen to sit apart from both the provenance violet and the semantic greens/ambers so no state is ever ambiguous.
- **Provenance Violet (`#5B4B9E` / `#A493E0`, subtle fills `#EEEBF7` / `#262040`)** — the signature. Used *exclusively* for citation chips, Diagnostic ID references, and provenance-related affordances (Lineage links, Audit Log cross-references). Never for chrome, never for emphasis, never decoratively. If it's violet, it traces to the engine.
- **Caution Amber (`#B45309` / `#F5A94E`)** — validation findings on Triangles (flagged cells, monotonicity errors) and the Engine-Only Mode banner. Amber means "the system is telling you something needs your judgment," not danger.
- **Published Green (`#166534` / `#6EC98A`)** — one meaning: a Reserve Report that has passed Senior Actuary approval. The approve button and the published badge are the only green surfaces in the product.
- **Destructive** inherits shadcn's default — used for hard failures (rejected upload, failed Run) only.

Avoid: gradients, chart-junk palettes, using violet or green anywhere outside their single meanings, red/green as the only encoding in diagnostics (see Do's and Don'ts).

## Typography

Body, labels, and captions inherit shadcn's Geist Sans ramp. Two brand roles:

- **`numeric` (Geist Mono 13px, `numeric-lg` 16px)** — every number the engine produced: triangle cells, LDFs, ultimates, IBNR, standard errors, Diagnostic values, figures inside report drafts. Monospace makes columns of factors scannable and visually declares "this came from the engine." A number set in Geist Sans is prose; a number set in Geist Mono is evidence.
- **`display` (Geist Sans 600, 28px)** — page titles and the report title only. No serif moments; this product does not do lyrical.

## Layout & Spacing

Tailwind's 4-based scale inherited. Two layout postures:

- **Flow surfaces** (upload wizard, report review) — single column, `max-w-4xl`, generous whitespace; the user is making decisions, not scanning.
- **Data surfaces** (triangle view, diagnostics review, audit log) — full-width within a `max-w-screen-2xl` shell; density is the point. Triangle and diagnostic grids use `{spacing.cell-pad}` cell padding and hairline `border` dividers.

Persistent left sidebar (Workspace nav) on `lg+`; collapses to icons on `md`; sheet on `sm`. A persistent right **context rail** appears on data surfaces for the selected Diagnostic's detail (see Components).

## Elevation & Depth

Inherited from shadcn: subtle shadows on overlays only. Elevation is never hierarchy; on data surfaces, hierarchy comes from type weight and hairlines. The one addition: the Engine-Only Mode banner sits above the app chrome at zero elevation, full-bleed — a condition of the environment, not a floating notification.

## Shapes

`4 / 6 / 8px` — one notch tighter than shadcn defaults; the crispness reads "instrument." Pills (`rounded.full`) are reserved for citation chips and status badges. Triangle/diagnostic grid cells are square-cornered.

## Components

shadcn used as-is: `Button` (non-primary variants), `Card`, `Dialog`, `Sheet`, `Tabs`, `Table`, `Toast`, `Tooltip`, `DropdownMenu`, `Skeleton`, `Badge` (non-status uses), `Breadcrumb`.

Brand-layer components:

- **Citation chip** — inline pill: `{colors.provenance-subtle}` fill, `{colors.provenance}` text in `{typography.numeric}`, content is the Diagnostic ID (e.g. `D-LDF-07`). Hover: full-violet fill with white text + tooltip preview of the cited value. Click navigates to the Diagnostic. Appears wherever an Interpretation claim does; never hand-placed for decoration.
- **Status badge** — pill vocabulary for Run and Reserve Report state: `draft` (muted), `running` (primary, pulsing dot), `failed` (destructive), `approved/published` (`{colors.published-subtle}`/`{colors.published}`), `engine-only` (caution family).
- **Engine-Only Mode banner** — full-bleed strip under the top bar, `{components.engine-only-banner}`: icon + "Engine-Only Mode — interpretation unavailable" + a "what still works" link. Non-dismissable while the condition holds.
- **Triangle grid** — dense numeric grid, `{typography.numeric}`, right-aligned cells, origin rows × development columns, Latest Diagonal cells carry a 2px `{colors.primary}` left border. Flagged cells (validation) use `{components.triangle-cell-flagged}`.
- **Diagnostic heat cell** — residual heatmap cells use a diverging blue↔amber ramp (never red↔green), value always printed in the cell at `{typography.numeric}` — color is annotation, number is the datum.
- **Approve button** — `{components.button-approve}`; exists only on the report review surface for the Senior Actuary role.

## Do's and Don'ts

| Do | Don't |
|---|---|
| Violet = provenance, always and only | Use violet for nav, emphasis, or brand flourish |
| Every engine number in `{typography.numeric}` | Set data in Geist Sans or prose in Geist Mono |
| Diverging blue↔amber for heatmaps, value printed in cell | Red↔green encodings or color-only meaning |
| Green only for approved/published | Green success toasts for routine saves (use neutral) |
| Density on data surfaces, air on flow surfaces | One density everywhere |
| Inherit shadcn defaults outside the brand layer | Custom-restyle shadcn components ad hoc |
