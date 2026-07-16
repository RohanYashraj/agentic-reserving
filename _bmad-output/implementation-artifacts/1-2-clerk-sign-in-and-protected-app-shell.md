---
baseline_commit: e67527063930cce78ec2551955a7999c17214a57
---

# Story 1.2: Clerk Sign-In and Protected App Shell

Status: done

## Story

As an Analyst,
I want to sign in with email/password and land in an authenticated app shell,
so that no reserving surface is ever reachable anonymously. (FR-17)

## Acceptance Criteria

1. **Given** an unauthenticated visitor, **When** they request any application route beyond sign-in/marketing, **Then** they are redirected to the Clerk sign-in page and no application data renders (FR-17).
2. **Given** a user with valid credentials, **When** they sign in, **Then** they land in the app shell with a persistent left sidebar (Dashboard, Triangles, Audit Log entries as placeholders), avatar menu, and their active Workspace (Clerk organization) name visible (UX-DR17).
3. **And** the Clerk JWT template named `convex` is configured so Convex receives verified identity (AD-4).
4. **And** the integration is SSO-ready: enabling SAML/OIDC is a Clerk configuration change requiring no code rearchitecture.

## Tasks / Subtasks

- [x] Task 1: Install and wire Clerk into Next.js (AC: 1, 4)
  - [x] 1.1 `npm install @clerk/nextjs convex` — `@clerk/nextjs` latest, lockfile-pinned per the Stack table. Keep `convex` at its existing pin; `convex/react-clerk` ships inside the `convex` package (no extra install).
  - [x] 1.2 Create **`proxy.ts`** at the repo root (NOT `middleware.ts` — Next.js 16 renamed the convention; a `middleware.ts` will not run). Content per Clerk's official Next 16 quickstart: `import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server"`, `export default clerkMiddleware(...)`, plus the standard `config.matcher` block that skips `_next`/static assets and always runs on `/(api|trpc)(.*)`.
  - [x] 1.3 Route protection in `proxy.ts`: `createRouteMatcher(["/", "/sign-in(.*)"])` as the **public** set; for every other route call `await auth.protect()` inside `clerkMiddleware(async (auth, req) => …)`. Unauthenticated requests to protected routes must redirect to sign-in (Clerk does this automatically from `auth.protect()`).
  - [x] 1.4 Wrap the app in `<ClerkProvider>` in `app/layout.tsx` (server component, outermost inside `<body>`).
- [x] Task 2: Convex ↔ Clerk identity bridge (AC: 3)
  - [x] 2.1 Create `convex/auth.config.ts`: `export default { providers: [{ domain: process.env.CLERK_JWT_ISSUER_DOMAIN!, applicationID: "convex" }] }`. `CLERK_JWT_ISSUER_DOMAIN` is **already set** on the dev deployment `benevolent-clam-376` to `https://striking-drum-71.clerk.accounts.dev` — do not put it in `.env.local`; it is a Convex deployment env var. Run `npx convex dev` once so the auth config deploys.
  - [x] 2.2 Clerk dashboard: confirm the JWT template named exactly `convex` exists (create from Clerk's Convex preset if missing). This is dashboard config — verify and document in README; the code only depends on `applicationID: "convex"` matching the template name.
  - [x] 2.3 Create `components/ConvexClientProvider.tsx` (`"use client"`): `ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!)` + `<ConvexProviderWithClerk client={convex} useAuth={useAuth}>` from `convex/react-clerk` with `useAuth` from `@clerk/nextjs`. Mount it inside `<ClerkProvider>` in `app/layout.tsx`.
- [x] Task 3: Sign-in surface and public root (AC: 1)
  - [x] 3.1 `app/sign-in/[[...sign-in]]/page.tsx` rendering Clerk's `<SignIn />` component, centered. No `<SignUp />` route — accounts/orgs are Clerk-dashboard-managed in v1 (no in-app admin UI, FR-19); disable public sign-ups in the Clerk dashboard if not already.
  - [x] 3.2 Repurpose `app/page.tsx` as the minimal public/marketing placeholder: product name + a "Sign in" link to `/sign-in`; if the visitor is already authenticated, redirect `/` → `/dashboard` (server-side via `auth()` from `@clerk/nextjs/server`).
- [x] Task 4: Authenticated app shell (AC: 2)
  - [x] 4.1 Route group `app/(app)/` with `app/(app)/layout.tsx` holding the shell: persistent left sidebar + top bar + `<main>` content area. All routes in this group are protected by proxy.ts (they are not in the public matcher).
  - [x] 4.2 Sidebar per UX-DR17: entries **Dashboard, Triangles, Audit Log** as links (placeholder pages); plain Tailwind styling only — shadcn/brand tokens land in Story 1.3, do NOT init shadcn here. Responsive intent (icons on md, sheet on sm) may be stubbed minimally; full treatment arrives with the component library.
  - [x] 4.3 Top bar: active Workspace (Clerk organization) name visible — use Clerk's `<OrganizationSwitcher hidePersonal />` (org == Workspace; membership is required in this Clerk app) — and avatar menu via `<UserButton />` (Settings lives in the avatar menu per UX-DR17; no custom settings page yet).
  - [x] 4.4 Placeholder pages: `app/(app)/dashboard/page.tsx`, `app/(app)/triangles/page.tsx`, `app/(app)/audit-log/page.tsx` — headings only. Dashboard may show the empty-Workspace line "No triangles yet. Upload the first one to start the quarter." (EXPERIENCE.md State Patterns) as static copy.
  - [x] 4.5 Handle the no-active-organization state: if `auth()` yields a user with no active org, render a "Select a Workspace" screen with `<OrganizationSwitcher />` rather than a broken shell (Clerk orgs are required-membership in this app; a fresh test user may still need to pick one).
- [x] Task 5: Env, docs, and hygiene (AC: 1, 4, 5-adjacent)
  - [x] 5.1 `.env.example`: Clerk keys already listed; add `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in` (and `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/dashboard` if used). Real keys go in `.env.local` only (gitignored — verified in Story 1.1). Never commit a key; grep before committing.
  - [x] 5.2 README "Local development": add Clerk setup (create app, enable Organizations with required membership, JWT template `convex`, set `CLERK_JWT_ISSUER_DOMAIN` on the Convex deployment, org roles `analyst`/`senior_actuary` created for Story 1.4). Note SSO-readiness: SAML/OIDC is a Clerk dashboard change, zero code (AC 4 evidence).
  - [x] 5.3 Confirm no polling anywhere — identity/live data flows via Clerk components and (from later stories) Convex subscriptions.
- [x] Task 6: Tests and verification (AC: 1–4)
  - [x] 6.1 Vitest: add a spec asserting `proxy.ts` exports the middleware and that its public-route matcher covers exactly `/` and `/sign-in(.*)` (import `createRouteMatcher` behavior or export the matcher list for testability). This is the cheap regression guard for AC 1 until the Playwright smoke (Story 7.4).
  - [x] 6.2 No new Convex functions in this story ⇒ no convex-test additions required (`auth.config.ts` is config, not a function). The auth-guard enumeration test is Story 1.4's.
  - [x] 6.3 Manual verification (document results in Dev Agent Record): signed-out request to `/dashboard` → redirected to `/sign-in` with no app data in the response; sign in with the test user → shell renders with sidebar entries, org name, avatar menu; `npx convex dev` shows the auth config synced; `npm run lint`, `tsc --noEmit`, `npm test` all green.

### Review Findings

- [x] [Review][Patch] Defense-in-depth: (app) layout trusts middleware alone — add `userId` check + redirect [app/(app)/layout.tsx:17]
- [x] [Review][Patch] proxy tests assert constants, not behavior — add table-driven `createRouteMatcher` assertions [tests/proxy.test.ts:14]
- [x] [Review][Patch] `NEXT_PUBLIC_CONVEX_URL!` masks misconfiguration — throw descriptive error [components/ConvexClientProvider.tsx:8]
- [x] [Review][Patch] `CLERK_JWT_ISSUER_DOMAIN!` deploys `domain: undefined` silently — fail fast [convex/auth.config.ts:9]
- [x] [Review][Patch] "Select a Workspace" screen has no sign-out; README missing "disable public sign-ups" + env verify step [app/(app)/layout.tsx:20, README.md]
- [x] [Review][Defer] `/sign-in(.*)` prefix-matches e.g. `/sign-in-help` — official Clerk pattern, no such routes exist; revisit if sibling routes appear [proxy.ts:6] — deferred
- [x] [Review][Defer] Matcher skips auth for future non-API paths ending in static extensions (.csv/.xlsx) — official Clerk matcher; exports will be API/Convex-storage routes [proxy.ts:16] — deferred
- [x] [Review][Defer] Sidebar lacks active-route state/`aria-current` — full nav treatment lands with shadcn in Story 1.3 [app/(app)/layout.tsx:34] — deferred
- [x] [Review][Defer] `/dashboard` target duplicated (redirect literal + Clerk fallback env var) — consolidate if it ever changes [app/page.tsx:8] — deferred

## Dev Notes

### Critical: Next.js 16 middleware rename

Next.js 16 replaced `middleware.ts` with **`proxy.ts`** (repo root, sibling of `app/`). Clerk's own Next 16 quickstart uses:

```ts
// proxy.ts
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isPublicRoute = createRouteMatcher(["/", "/sign-in(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) await auth.protect();
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
```

A `middleware.ts` file will be silently ignored → every route public → AC 1 fails. [Source: clerk.com Next.js quickstart + clerk/clerk-nextjs-app-quickstart proxy.ts, verified 2026-07-16]

### Architecture compliance (non-negotiable)

- **AD-4**: identity = Clerk; Convex verifies the JWT via `convex/auth.config.ts` (issuer domain + `applicationID: "convex"`, matching the Clerk JWT template named `convex`). Roles stay in Clerk org claims — create NO Convex tables for users/roles/workspaces. `requireMember`/`requireRole` are **Story 1.4** — do not write them here.
- **AD-3**: no new Convex tables at all this story. `convex/schema.ts` stays `defineSchema({})`.
- **Dependency direction**: nothing engine-related; the frontend talks to Clerk + Convex only.
- **Secrets (AD-12 posture)**: Clerk publishable + secret keys in `.env.local` / Vercel + Convex env only. `CLERK_JWT_ISSUER_DOMAIN` lives on the Convex deployment (already set on `benevolent-clam-376`).
- **Vocabulary**: it's a **Workspace** (== Clerk organization) in all copy and identifiers — never "team"/"tenant"/"org" in user-facing text.

### Live environment facts (2026-07-16)

- Convex cloud dev deployment: `benevolent-clam-376`; `.env.local` already holds `CONVEX_DEPLOYMENT` + Clerk keys (gitignored).
- `CLERK_JWT_ISSUER_DOMAIN=https://striking-drum-71.clerk.accounts.dev` already set on that deployment.
- Clerk app has **Organizations enabled with membership required**; roles `analyst`/`senior_actuary` and a test org were to be created in the dashboard — verify they exist during Task 2.2/5.2, flag if not (roles are consumed in Story 1.4, not here).

### UX guardrails (UX-DR17 scope for this story)

- Shell = persistent left sidebar (Dashboard, Triangles, Audit Log), avatar menu with Settings entry (Clerk `<UserButton />` suffices), Workspace name visible. Flow surfaces single-column `max-w-4xl`; data surfaces `max-w-screen-2xl` — placeholders can set the containers now so later stories inherit them.
- **NOT in this story**: ⌘K command palette (Story 7.3), brand tokens/StatusBadge/shadcn init (Story 1.3), Engine-Only banner (Epic 5), any real data surface.
- Voice: precise, unhurried, never celebratory (EXPERIENCE.md). No emoji, no "Welcome back! 🎉".

### Existing files being modified — current state

- [app/layout.tsx](app/layout.tsx) — Geist Sans/Mono via `next/font`, metadata "Reserving Copilot", `<html>` carries font vars + `h-full antialiased`, `<body>` is `min-h-full flex flex-col`. **Change**: wrap `children` with `<ClerkProvider>` → `<ConvexClientProvider>`. **Preserve**: fonts, metadata, class names (Story 1.3 builds on them).
- [app/page.tsx](app/page.tsx) — centered "Reserving Copilot" heading. **Change**: becomes the public marketing placeholder with sign-in link + authenticated redirect. **Preserve**: nothing sacred, but keep the copy tone.
- [.env.example](.env.example) — already lists Clerk key names (names-only file — keep it that way).
- [convex/schema.ts](convex/schema.ts) — untouched, stays empty.
- [tests/scaffold.test.ts](tests/scaffold.test.ts) + [vitest.config.mts](vitest.config.mts) — Vitest includes `tests/**/*.test.{ts,tsx}`; put the new spec in `tests/`. The edge-runtime vitest project for convex-test is Story 1.4's concern.

### Previous story intelligence (1.1)

- CI (`.github/workflows/ci.yml`) runs lint + `tsc --noEmit` + Vitest on the Node job — a `proxy.ts` type error or unused import fails CI, not just tests.
- ESLint flat config uses `globalIgnores` for `engine/**` and `convex/_generated/**`; new root-level `proxy.ts` and `components/*.tsx` ARE linted.
- Root tsconfig sweeps `convex/**` into the Next type program (deferred item) — `convex/auth.config.ts` will be type-checked by `tsc --noEmit`; keep it dependency-free and typed.
- **Sourcery bot** on the GitHub repo fails PR checks with license-policy noise (sharp/libvips LGPL, minimatch BlueOak) — triaged as noise on PR #1; a red Sourcery check is not a real failure. GitHub Actions CI is the truth.
- Working rhythm: commit only on explicit ask; PR per story branch — you are already on `epic_1/1_2`.

### Library notes (verified 2026-07-16)

| Dep | Guidance |
| --- | --- |
| `@clerk/nextjs` | latest at install, lockfile-pinned (Stack table). Uses `clerkMiddleware` from `@clerk/nextjs/server` in `proxy.ts` on Next 16. |
| `convex/react-clerk` | `ConvexProviderWithClerk` — part of the installed `convex` package. |
| Clerk↔Convex bridge | `convex/auth.config.ts` with `CLERK_JWT_ISSUER_DOMAIN` env + `applicationID: "convex"`; JWT template in Clerk dashboard must be named `convex`. [Source: docs.convex.dev/auth/clerk] |
| SSO-readiness | Clerk SAML/OIDC is dashboard-configured per connection; `<SignIn />` renders enabled strategies automatically — no code change (AC 4). |

### Scope boundaries (do NOT build here)

- No `requireMember`/`requireRole`, no convex-test auth enumeration (Story 1.4). No `auditLogs` (Story 1.5). No shadcn/brand tokens/StatusBadge (Story 1.3). No sign-up flow, no in-app role/org admin UI (Clerk-managed, FR-19). No Playwright (Story 7.4). No Convex tables, no engine work.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.2] — story + ACs; UX-DR17
- [Source: _bmad-output/planning-artifacts/architecture/architecture-agentic-reserving-2026-07-16/ARCHITECTURE-SPINE.md] — AD-3, AD-4, AD-12, Stack, Structural Seed
- [Source: _bmad-output/planning-artifacts/ux-designs/ux-agentic-reserving-2026-07-16/EXPERIENCE.md#Information Architecture, #Voice and Tone, #State Patterns] — shell IA, copy tone, empty state
- [Source: _bmad-output/project-context.md] — 38 agent rules; read before implementing
- [Source: _bmad-output/implementation-artifacts/1-1-project-scaffold-and-local-dev-environment.md] — scaffold state, CI shape, review learnings

## Dev Agent Record

### Agent Model Used

claude-fable-5 (Claude Code)

### Debug Log References

- `npx tsc --noEmit`, `npm run lint`, `npm test` (4 tests, 2 files), `npm run build` — all green. Build output shows `ƒ Proxy (Middleware)`, confirming `proxy.ts` is active.
- `npx convex dev --once` against `benevolent-clam-376` — auth config deployed, "Convex functions ready".
- Live redirect verification (dev server): signed-out `GET /dashboard` → `307 location: /sign-in?redirect_url=…` (same for `/triangles`), response contains no app data; `/` and `/sign-in` return 200 publicly; `/sign-in` renders Clerk `<SignIn />` (email/password visible).

### Completion Notes List

- `@clerk/nextjs@7.5.19` installed (lockfile-pinned); `convex` kept at existing pin — `convex/react-clerk` ships inside it.
- `proxy.ts` (Next 16 convention, NOT middleware.ts) with `createRouteMatcher(["/", "/sign-in(.*)"])` public set and `auth.protect()` for everything else; `publicRoutes` exported for the Vitest regression guard (AC 1).
- `convex/auth.config.ts` uses `CLERK_JWT_ISSUER_DOMAIN` deployment env var + `applicationID: "convex"`; deployed to `benevolent-clam-376` (AC 3). ESLint `import/no-anonymous-default-export` warning fixed by naming the config object.
- `app/layout.tsx`: `<ClerkProvider>` → `<ConvexClientProvider>` wrap inside `<body>`; fonts/metadata/classes preserved for Story 1.3.
- `app/page.tsx`: public marketing placeholder with Sign in link; authenticated visitors are server-side redirected to `/dashboard` via `auth()`.
- `app/(app)/layout.tsx`: shell with left sidebar (Dashboard, Triangles, Audit Log), top bar with `<OrganizationSwitcher hidePersonal />` (Workspace name) + `<UserButton />`; no-active-Workspace state renders "Select a Workspace" with the switcher. Plain Tailwind only — no shadcn (Story 1.3).
- Placeholder pages set `max-w-screen-2xl` data-surface containers; Dashboard carries the EXPERIENCE.md empty-state line as static copy.
- `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in` + fallback-redirect var added to `.env.example` and appended (non-secret values) to gitignored `.env.local` — without them Clerk redirected to its hosted accounts.dev page instead of the in-app `/sign-in`.
- README: Clerk one-time init section (Organizations required, roles `analyst`/`senior_actuary`, JWT template `convex`, issuer env on Convex deployment) + SSO-readiness note (AC 4 evidence).
- No polling, no new Convex tables (`schema.ts` untouched), no key-looking values in tracked files (grep-verified). No `requireMember`/`requireRole` — Story 1.4.
- **Remaining for human verification (AC 2)**: sign in as the test user in the running dev server and confirm shell + org name + avatar menu render — I don't enter credentials. Task 2.2 dashboard check (JWT template `convex` exists, roles created) also needs a dashboard look; code and README document both.
- `.claude/launch.json` added (dev-server launch config used for verification).

### File List

- proxy.ts (new)
- tests/proxy.test.ts (new)
- convex/auth.config.ts (new)
- components/ConvexClientProvider.tsx (new)
- app/layout.tsx (modified)
- app/page.tsx (modified)
- app/sign-in/[[...sign-in]]/page.tsx (new)
- app/(app)/layout.tsx (new)
- app/(app)/dashboard/page.tsx (new)
- app/(app)/triangles/page.tsx (new)
- app/(app)/audit-log/page.tsx (new)
- .env.example (modified)
- README.md (modified)
- package.json (modified)
- package-lock.json (modified)
- .claude/launch.json (new)

## Change Log

- 2026-07-16: Code review (Blind Hunter + Edge Case Hunter + Acceptance Auditor): 5 patches applied (layout userId defense-in-depth + sign-out on Select-a-Workspace, behavioral createRouteMatcher tests, fail-fast env guards in ConvexClientProvider and convex/auth.config.ts, README disable-sign-ups + env-verify steps), 4 deferred to deferred-work.md, 6 dismissed. AC 2 verified live by Rohan. 13 tests green; lint/tsc clean; auth config redeployed. Status → done.

- 2026-07-16: Story 1.2 implemented — Clerk sign-in via proxy.ts route protection, Convex↔Clerk JWT bridge deployed, public root + sign-in surface, protected app shell with sidebar/OrganizationSwitcher/UserButton, env + README docs, Vitest proxy matcher guard. Status → review.
