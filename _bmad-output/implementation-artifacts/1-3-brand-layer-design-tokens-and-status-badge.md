---
baseline_commit: c78ce590daadd771d61dd4ed6e4555cffe30eec9
---

# Story 1.3: Brand-Layer Design Tokens and Status Badge

Status: done

## Story

As a developer,
I want the DESIGN.md brand layer implemented as tokens over shadcn/ui,
so that every later surface uses the same visual vocabulary instead of ad-hoc styles. (UX-DR1, UX-DR3)

## Acceptance Criteria

1. **Given** the Tailwind/shadcn theme configuration, **When** tokens are inspected, **Then** primary teal, provenance violet (+subtle), caution amber (+subtle), published green (+subtle) exist with light and dark values exactly per DESIGN.md, radius is 4/6/8px, and `numeric`/`numeric-lg` (Geist Mono) and `display` (Geist Sans 600 28px) type roles are available as utilities (UX-DR1).
2. **Given** the StatusBadge component, **When** rendered with each vocabulary value (`draft`, `running`, `complete`, `failed`, `awaiting review`, `published`, `engine-only`), **Then** each shows its specified color family paired with label text (never color alone), `running` shows a pulsing dot, and `published` uses the published-green family (UX-DR3).
3. **And** a Storybook page or `/dev/tokens` route demonstrates all tokens and badge states in light and dark for review.

## Tasks / Subtasks

- [x] Task 1: Initialize shadcn/ui on the existing Tailwind v4 setup (AC: 1)
  - [x] 1.1 `npx shadcn@latest init` — Tailwind v4 + React 19 are fully supported; it creates `components.json`, `lib/utils.ts` (`cn` helper), and rewrites `app/globals.css` with the shadcn token block (`:root` / `.dark` CSS variables + `@theme inline` + `@custom-variant dark`). Choose the default/neutral base color; brand values are overridden in Task 2. Keep the components directory at `components/` and alias `@/*` (already in tsconfig).
  - [x] 1.2 `npx shadcn@latest add badge` — the base for StatusBadge. Add nothing else; shadcn components are pulled per-story as surfaces need them (DESIGN.md: inherit shadcn wholesale, customize only the brand layer).
  - [x] 1.3 Verify the init preserved: `@import "tailwindcss"`, the `--font-sans: var(--font-geist-sans)` / `--font-mono: var(--font-geist-mono)` mappings in `@theme inline` (re-add if clobbered), and that `app/layout.tsx` font variables still flow. Delete the dead `body { font-family: Arial... }` rule — body must use `var(--font-sans)` (fixes the dead-font-pipeline item deferred from Story 1.1).
- [x] Task 2: Brand token layer in `app/globals.css` (AC: 1)
  - [x] 2.1 Override shadcn `--primary` / `--primary-foreground`: light `#0E5E59` / `#FFFFFF`, dark (`.dark`) `#4FB3AB` / `#06201E`. Leave all unlisted shadcn tokens (background, foreground, muted, card, border, ring, destructive, …) at their defaults — DESIGN.md is a delta, not a theme rewrite.
  - [x] 2.2 Add brand families as new variables in `:root` / `.dark` and expose via `@theme inline` as colors (`--color-provenance`, etc.) so `bg-provenance`, `text-caution`, `bg-published-subtle` utilities exist:
    - provenance `#5B4B9E` / fg `#FFFFFF` / subtle `#EEEBF7`; dark `#A493E0` / fg `#171130` / subtle `#262040`
    - caution `#B45309` / subtle `#FEF3E2`; dark `#F5A94E` / subtle `#3A2A12`
    - published `#166534` / subtle `#E8F5EC`; dark `#6EC98A` / subtle `#12301C`
  - [x] 2.3 Radius: set `--radius: 0.5rem` (8px). shadcn v4 derives `--radius-sm: calc(var(--radius) - 4px)` = 4px, `--radius-md: calc(var(--radius) - 2px)` = 6px, `--radius-lg: var(--radius)` = 8px — exactly the DESIGN.md 4/6/8 scale. Verify those calc lines exist in the init output; add them if not.
  - [x] 2.4 Type-role utilities via Tailwind v4 `@utility`: `numeric` (Geist Mono 13px, weight 450, letter-spacing 0), `numeric-lg` (Geist Mono 16px, weight 500), `display` (Geist Sans 600 28px, line-height 1.2, letter-spacing -0.01em). Use `font-family: var(--font-mono)` / `var(--font-sans)` — never hardcode font names. Geist Mono via `next/font` is a variable font, so weight 450 renders correctly. Also add `--spacing-cell-pad: 6px` (DESIGN.md `spacing.cell-pad`) as a theme variable for later triangle grids — cheap now, prevents ad-hoc padding in Epic 3/4.
  - [x] 2.5 Dark mode strategy: shadcn's `.dark` class + `@custom-variant dark (&:is(.dark *))`. Remove the old `prefers-color-scheme` media block from globals.css (the app renders light by default; a real app-wide theme switcher is out of scope — the `/dev/tokens` page gets a local toggle in Task 4).
- [x] Task 3: StatusBadge component (AC: 2)
  - [x] 3.1 `components/StatusBadge.tsx` — typed on the closed vocabulary: `type Status = "draft" | "running" | "complete" | "failed" | "awaiting review" | "published" | "engine-only"`. Export the type. Build on the shadcn Badge primitive with a pill shape (`rounded-full` — pills are reserved for chips and badges per DESIGN.md Shapes) and a per-status class map; consumers pass only `status` — never restyle locally (UX-DR3).
  - [x] 3.2 Color families (label text always rendered — color is never the only encoding):
    - `draft` → muted (`bg-muted text-muted-foreground`)
    - `running` → primary family with pulsing dot: a `size-1.5 rounded-full bg-primary animate-pulse` dot before the label; badge surface `bg-primary/10 text-primary`
    - `complete` → primary family, no dot (`bg-primary/10 text-primary`) — mirrors the step rail's primary "completed" treatment
    - `failed` → destructive family (`bg-destructive/10 text-destructive`)
    - `awaiting review` → caution family (`bg-caution-subtle text-caution`) — amber = "needs your judgment" (EXPERIENCE.md), which is precisely this state
    - `published` → published family (`bg-published-subtle text-published`) — with the approve button, the only green in the product
    - `engine-only` → caution family (`bg-caution-subtle text-caution`), per DESIGN.md components table
  - [x] 3.3 The pulsing dot is decorative (label carries meaning): mark it `aria-hidden`. Labels render exactly the vocabulary strings (lowercase, as specified) — the badge does not invent display casing.
- [x] Task 4: `/dev/tokens` review page (AC: 3)
  - [x] 4.1 `app/(app)/dev/tokens/page.tsx` — inside the `(app)` group so it is auth-protected by proxy.ts (nothing new is public). Client component. No Storybook: it isn't in the architecture Stack table and a route satisfies the AC with zero new dependencies.
  - [x] 4.2 Show: all brand color swatches (each family + subtle, with hex label), the three radius steps, the three type roles rendered with sample content (numeric role sample should be a factor column like `1.4936 / 1.0778 / 1.0102` — right-aligned, demonstrating the "evidence" texture), and all seven StatusBadge states.
  - [x] 4.3 Local light/dark toggle that flips the `dark` class on `document.documentElement`, so both value sets are reviewable side-by-side on one page (AC 3's "in light and dark").
- [x] Task 5: Sidebar polish deferred from 1.2 (housekeeping, same file the token pass touches)
  - [x] 5.1 `app/(app)/layout.tsx`: give sidebar nav links active-route state (`usePathname` — extract a small client `components/SidebarNav.tsx` since the layout is a server component) with `aria-current="page"` and active styling in the primary family (teal = active nav per DESIGN.md Colors). This closes the deferred-work item "Sidebar lacks active-route state/aria-current — land with shadcn in Story 1.3".
  - [x] 5.2 Do not otherwise redesign the shell — full responsive treatment (icons on md, sheet on sm) still waits for its own story.
- [x] Task 6: Tests and verification (AC: 1–3)
  - [x] 6.1 Add React test tooling (first component test in the repo): `npm i -D @testing-library/react @testing-library/jest-dom jsdom @vitejs/plugin-react`. Extend `vitest.config.mts` with the react plugin and `environment: "jsdom"` (per-file `// @vitest-environment jsdom` pragma is fine too; keep existing node-env tests untouched).
  - [x] 6.2 `tests/status-badge.test.tsx`: render all seven statuses; assert each renders its exact label text, the expected family class (e.g. published → `bg-published-subtle`), `running` renders the pulsing-dot element and no other status does, and the dot is `aria-hidden`.
  - [x] 6.3 `tests/tokens.test.ts` (node env): read `app/globals.css` and assert every DESIGN.md hex value (all 18 brand values), `--radius` derivation lines, and the `numeric`/`numeric-lg`/`display` utilities are present. Cheap regression guard for AC 1 — a lost token fails CI, not a review.
  - [x] 6.4 Manual verification (document in Dev Agent Record): `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build` green; dev server → sign in → `/dev/tokens` renders all swatches/roles/badges, toggle flips dark values, sidebar shows active state on the current route.

### Review Findings

- [x] [Review][Patch] `/dev/tokens` dark toggle mutated `document.documentElement` and leaked `.dark` across the whole app. **Fixed** — toggle now flips local state only; `.dark` is applied to the page's own wrapper via `cn(..., dark && "dark")`, so it can never reach `<html>`. [app/(app)/dev/tokens/page.tsx] (blind+edge)
- [x] [Review][Patch] `app/globals.css` had no trailing newline. **Fixed** — appended `\n`. [app/globals.css] (blind)
- [x] [Review][Defer] StatusBadge has no fallback for an out-of-union runtime status — `statusClasses[status]` is `undefined` for an unknown value, rendering a bare `secondary` badge with no family color. Not reachable today (only typed call site is `/dev/tokens`); revisit when Run/Report status data wires up in Epic 4, validating the status field at the Convex boundary. [components/StatusBadge.tsx:36] — deferred (edge)
- [x] [Review][Defer] `/dev/tokens` is a routable server-rendered page in production with no `NODE_ENV`/config guard — auth-gated and harmless (a token gallery), but a dev-only surface should not ship to prod. Optional hardening. [app/(app)/dev/tokens/page.tsx:47] — deferred (blind)

## Dev Notes

### Architecture & design compliance (non-negotiable)

- **DESIGN.md is the single source of token values** — every hex, size, and weight above is transcribed from its frontmatter; if any value here ever disagrees with DESIGN.md, DESIGN.md wins. It is a *delta* over shadcn: do not restyle unlisted tokens or components (Do's and Don'ts: "Inherit shadcn defaults outside the brand layer").
- **Color meaning is exclusive**: violet = provenance only (nothing in this story should use it except the `/dev/tokens` swatch); green = published/approve only; amber = judgment-needed. Never use these for chrome or emphasis.
- **UX-DR3**: StatusBadge vocabulary is fixed and never restyled locally. The component owns all styling; call sites pass a status value only.
- **Vocabulary rule** (project-context.md): PRD glossary terms in identifiers. `StatusBadge`, `Status` — no synonyms like `Chip`, `Tag`, `StateBadge`.
- **No Convex work, no engine work** — this story is entirely in the product plane's presentation layer. `convex/schema.ts` stays untouched.
- No arithmetic on anything: there are no reserve figures here, but the `/dev/tokens` numeric sample must be static literal strings (display formatting only — AD-1 discipline starts now).

### Existing files being modified — current state

- [app/globals.css](app/globals.css) — 26 lines: `@import "tailwindcss"`, `:root` with `--background`/`--foreground`, `@theme inline` mapping those plus `--font-sans`/`--font-mono` to the Geist next/font variables, a `prefers-color-scheme: dark` media block, and a `body` rule with an **Arial fallback font stack (dead font pipeline — this story fixes it)**. **Change**: replaced by shadcn init output + brand layer. **Preserve**: the `@import`, the font-variable mappings (`--font-sans: var(--font-geist-sans)`, `--font-mono: var(--font-geist-mono)`).
- [app/layout.tsx](app/layout.tsx) — loads `Geist`/`Geist_Mono` via `next/font/google` exposing `--font-geist-sans`/`--font-geist-mono` on `<html>`, wraps children in `ClerkProvider` → `ConvexClientProvider`. **Change**: none expected (fonts and providers stay). Only touch if shadcn init demands it — and preserve the provider nesting and `h-full antialiased` classes if so.
- [app/(app)/layout.tsx](app/(app)/layout.tsx) — server component: `auth()` guard with redirect, "Select a Workspace" state, sidebar (Dashboard/Triangles/Audit Log links, plain Tailwind), top bar with `OrganizationSwitcher hidePersonal` + `UserButton`. **Change**: sidebar links move into a client `SidebarNav` with active state (Task 5). **Preserve**: the `userId` defense-in-depth check, the no-active-org branch, OrganizationSwitcher/UserButton wiring — these carry review patches from 1.2; do not regress them.
- [vitest.config.mts](vitest.config.mts) — `include: tests/**/*.test.{ts,tsx}`, node env, comment reserving an edge-runtime project for convex-test (Story 1.4 — leave the comment). **Change**: react plugin + jsdom for component tests.
- [package.json](package.json) — Tailwind v4 via `@tailwindcss/postcss` (no tailwind.config.js — v4 is CSS-first; do NOT create one). New deps land lockfile-pinned as usual.

### shadcn/ui on Tailwind v4 — how theming works here (verified 2026-07-16)

- No `tailwind.config.ts` involved. Tokens are CSS variables in `:root` / `.dark`, exposed to utilities through `@theme inline` (`--color-provenance: var(--provenance)` ⇒ `bg-provenance`, `text-provenance`, `border-provenance` all exist). [Source: ui.shadcn.com/docs/tailwind-v4, /docs/theming]
- Dark mode = `.dark` class via `@custom-variant dark (&:is(.dark *))` — that line comes with the init. The old media-query block conflicts with class-driven dark and must go.
- `@utility` is the Tailwind v4 way to add the type-role utilities so they participate in variants (`md:display` etc.).
- shadcn Badge ships with `variant` props — StatusBadge should wrap it (or reuse its base classes) with the status map rather than reimplementing a pill from scratch. Don't fight the primitive.

### Design decisions this story makes (flagged for review)

DESIGN.md's badge list specifies draft/running/failed/published/engine-only but is silent on `complete` and `awaiting review` (which UX-DR3 and EXPERIENCE.md include in the vocabulary). This story maps: **complete → primary family** (mirrors step-rail completed-step treatment), **awaiting review → caution family** (amber = "the system is telling you something needs your judgment" — DESIGN.md Colors — which is exactly a report awaiting Senior Actuary judgment). If Rohan disagrees, the change is one line in the StatusBadge class map.

`running`/`complete`/`failed` use alpha tints (`bg-primary/10`, `bg-destructive/10`) because DESIGN.md defines no `primary-subtle`/`destructive-subtle` tokens — tinting the defined family color is the least inventive option and keeps the delta discipline.

### Previous story intelligence (1.1 + 1.2)

- CI runs lint + `tsc --noEmit` + Vitest on every PR; a type error in a new `.tsx` fails the build. ESLint flat config lints everything outside `engine/.venv` and `convex/_generated` — new `components/*.tsx` and `lib/utils.ts` ARE linted (watch `import/no-anonymous-default-export`).
- Root tsconfig sweeps `convex/**` into the DOM type program — irrelevant here but don't "fix" it in passing (deferred to 1.4).
- Sourcery bot PR noise (license flags) is triaged noise; GitHub Actions is the truth.
- Working rhythm: commit only on explicit ask; PR per story branch — you are already on `epic_1/1_3`.
- Review-patch pattern from 1.2: fail fast on missing env/config rather than `!` assertions; behavioral tests over constant-assertions — apply the same standards (hence tests that render the badge rather than snapshot class strings only).

### Scope boundaries (do NOT build here)

- No Citation chip (UX-DR2 — lands with Interpretation surfaces, Epic 5), no Engine-Only banner (UX-DR4/Epic 5), no Triangle grid (UX-DR5/Epic 3), no heat cell (Epic 4), no step rail (Epic 4), no approve button (Epic 6). Their *tokens* exist after this story; the components do not.
- No app-wide theme switcher / next-themes; the dark toggle lives on `/dev/tokens` only.
- No Storybook. No extra shadcn components beyond `badge`. No `requireMember`/`requireRole`/auditLogs (Stories 1.4/1.5).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.3] — story + ACs; UX-DR1, UX-DR3
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-agentic-reserving-2026-07-16/DESIGN.md] — all token values (frontmatter), color meanings, shapes, badge spec
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-agentic-reserving-2026-07-16/EXPERIENCE.md#Component Contracts] — badge vocabulary line 75; caution semantics
- [Source: _bmad-output/planning-artifacts/architecture/architecture-agentic-reserving-2026-07-16/ARCHITECTURE-SPINE.md#Stack] — "shadcn/ui + Tailwind per UX DESIGN.md"; `components/` seed
- [Source: _bmad-output/project-context.md] — vocabulary, testing, anti-pattern rules
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] — dead font pipeline + sidebar aria-current items closed here
- [Source: ui.shadcn.com/docs/tailwind-v4 + /docs/theming] — Tailwind v4 CSS-variable theming, verified 2026-07-16

## Dev Agent Record

### Agent Model Used

claude-fable-5 (Claude Code)

### Debug Log References

- Red→green: `tests/tokens.test.ts` written first (26 failing), brand layer applied, 40/40 green; `tests/status-badge.test.tsx` written first (module missing = red), component implemented, 49/49 green.
- `npm test` (49 tests, 4 files), `npm run lint`, `npx tsc --noEmit`, `npm run build` — all green. Build lists `ƒ /dev/tokens` as a protected dynamic route.
- Live verification (dev server, browser): unauthenticated `/dev/tokens` → redirected to sign-in (no app data). Computed-style probe on the live page: light `--primary #0e5e59`, `--provenance #5b4b9e`, `--caution-subtle #fef3e2`, `--published #166534`, `--radius .5rem`; `.numeric` resolves to Geist Mono 13px weight 450; body font is Geist (Arial dead-pipeline fixed). `.dark` toggle probe: `#4fb3ab / #06201e / #a493e0 / #262040 / #f5a94e / #6ec98a / #12301c` — all DESIGN.md dark values exact.

### Completion Notes List

- shadcn CLI is now v4.13 — flags changed from the story's assumptions: no `--base-color`; init is `npx shadcn init -b radix -p nova -y` (radix = classic shadcn primitives; nova preset = Lucide/Geist, matching our font stack). `components.json` records style `radix-nova`, baseColor neutral. Init added its own runtime deps (radix-ui, class-variance-authority, clsx, tailwind-merge, lucide-react, tw-animate-css, shadcn) — all lockfile-pinned; `app/layout.tsx` untouched (fonts + Clerk/Convex providers preserved).
- Init wrote a circular `--font-sans: var(--font-sans)` mapping — fixed to `var(--font-geist-sans)`; `body` Arial rule replaced by shadcn's `@apply` base (deferred-work item closed).
- Nova preset derives radius multiplicatively (`* 0.6 / * 0.8`) — replaced sm/md/lg with the story's offset derivation (`-4px`/`-2px`/base) on `--radius: 0.5rem` ⇒ exactly 4/6/8px. xl+ left multiplicative (not in DESIGN scope).
- Brand families land as `:root`/`.dark` variables + `@theme inline` color mappings (`bg-provenance`, `text-caution`, `bg-published-subtle`… all live), `--spacing-cell-pad: 6px`, and `@utility numeric / numeric-lg / display`. `prefers-color-scheme` block gone; dark = `.dark` class only.
- `StatusBadge` (components/StatusBadge.tsx): closed `Status` union exported; wraps shadcn `Badge` with `rounded-full` + per-status class map; `running` dot is `aria-hidden`. Mapping decisions per story: complete → primary tint, awaiting review → caution family.
- `/dev/tokens` (app/(app)/dev/tokens/page.tsx): auth-protected client page — 9 swatches with per-mode hex labels, radius trio, three type roles (numeric sample is a right-aligned factor column of static literals), all 7 badge states, local light/dark toggle flipping `document.documentElement.classList`.
- SidebarNav extracted to a client component with `usePathname` active state (`aria-current="page"`, primary-family styling); shell borders moved from `border-gray-200` to `border-border` (second deferred-work item closed). Layout's `userId` guard, no-org branch, and Clerk widgets untouched.
- Test tooling: `@vitejs/plugin-react` pinned to `^5` (v6 requires Babel 8, conflicting with the tree); jsdom opt-in per file via `// @vitest-environment jsdom` so existing node-env tests are untouched; `@` alias added to vitest config.
- `.claude/launch.json` gained `"autoPort": true` (port 3000 was held by another session's dev server; nothing binds to 3000 specifically).
- **Remaining for human verification (AC 3 visual pass)**: sign in and eyeball `/dev/tokens` in both modes — I don't enter credentials. Computed-style evidence above covers the values themselves.

### File List

- app/globals.css (modified)
- components.json (new)
- lib/utils.ts (new)
- components/ui/badge.tsx (new)
- components/StatusBadge.tsx (new)
- components/SidebarNav.tsx (new)
- app/(app)/layout.tsx (modified)
- app/(app)/dev/tokens/page.tsx (new)
- tests/tokens.test.ts (new)
- tests/status-badge.test.tsx (new)
- vitest.config.mts (modified)
- package.json (modified)
- package-lock.json (modified)
- .claude/launch.json (modified)
- _bmad-output/implementation-artifacts/deferred-work.md (modified — two items marked resolved)

## Change Log

- 2026-07-16: Code review (Blind Hunter + Edge Case Hunter + Acceptance Auditor, Opus 4.8). 2 patches applied (scoped `/dev/tokens` dark toggle to a local wrapper to stop the global `.dark` leak; added globals.css trailing newline), 2 deferred to deferred-work.md (StatusBadge out-of-union fallback → Epic 4 when Run status wires up; `/dev/tokens` prod-route guard), 7 dismissed. Notable dismissals verified empirically: `rounded-4xl`→`rounded-full` collapses correctly (twMerge probe) and `usePathname` is non-nullable in Next 16 — both false positives. Auditor: zero AC violations. 49 tests green; lint/tsc/build clean. Status → done.
- 2026-07-16: Story 1.3 implemented — shadcn/ui (radix-nova) initialized on Tailwind v4, DESIGN.md brand layer (colors light+dark, 4/6/8 radius, numeric/numeric-lg/display utilities, cell-pad), StatusBadge with fixed 7-state vocabulary, auth-protected /dev/tokens review page with dark toggle, SidebarNav active-route state (aria-current). Dead Arial font pipeline and sidebar-active deferred items closed. 49 tests green; lint/tsc/build clean. Status → review.
