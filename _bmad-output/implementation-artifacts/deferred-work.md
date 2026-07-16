# Deferred Work

## Deferred from: code review of 1-1-project-scaffold-and-local-dev-environment (2026-07-16)

- ~~Geist fonts are loaded in `app/layout.tsx` but `app/globals.css` body falls back to Arial — dead font pipeline. Resolve in Story 1.3 (brand layer owns typography).~~ **Resolved in Story 1.3** — body now inherits `font-sans` (Geist) via the shadcn base layer; verified by computed-style probe.
- Python package imports resolve only when pytest runs from `engine/` cwd (`package = false`, no install). CI and README both use that cwd; revisit only if IDE test runners bite.
- Root `tsconfig.json` includes `convex/**` in the Next.js (DOM-lib) type program. Consider a `convex/tsconfig.json` when the first Convex functions land (Story 1.4).
- No Python lint/format tooling (ruff/mypy) in `engine/` dev deps or CI. Add when engine code exists (Epic 2), where correctness matters most.

## Deferred from: code review of 1-2-clerk-sign-in-and-protected-app-shell (2026-07-16)

- `/sign-in(.*)` in proxy.ts prefix-matches any path starting with `/sign-in` (e.g. `/sign-in-help` would be public). Official Clerk quickstart pattern; no sibling routes exist today. Tighten to `/sign-in(/.*)?` if such routes ever appear.
- proxy.ts matcher exempts non-API paths ending in static extensions (`.csv`, `.xlsx`, …) from auth. Official Clerk matcher; fine while downloads are API/Convex-storage routes — revisit if a page route ever serves an extension-suffixed path.
- ~~Sidebar nav has no active-route state or `aria-current` (app/(app)/layout.tsx). Land with the shadcn/brand-token pass in Story 1.3.~~ **Resolved in Story 1.3** — `components/SidebarNav.tsx` client component with `usePathname` + `aria-current="page"`.

## Deferred from: code review of 1-4-workspace-scoping-and-role-guards (2026-07-16)

- Svix-id replay/idempotency: the same signed webhook delivered twice within Svix's timestamp window re-invokes `recordEvent`, producing duplicate audit entries once Story 1.5 persists. Make 1.5's `appendAuditEntry` idempotent on the `svix-id` message id (or dedupe seen ids). [convex/http.ts]
- `convex/http.test.ts` "invalid signature → 400 and no event recorded" only asserts the 400 status, not that `recordEvent` was never invoked. Not assertable until Story 1.5 gives `recordEvent` an observable effect; add the non-invocation assertion then. [convex/http.test.ts]
- `organizationMembership.updated` is always mapped to `member.role_changed`, even for non-role membership updates (metadata/permissions). Revisit the event taxonomy when Story 1.5 builds the audit log; the full payload is preserved for disambiguation. [convex/lib/clerkWebhook.ts]
- The NFR-3 auth-guard enumeration test detects `isPublic` query/mutation/action exports only — `httpRouter` routes are invisible to it. Intentional for this story (the webhook is signature-verified, not `requireMember`-guarded). Extend coverage when a future story adds an authenticated HTTP route that reaches Convex data. [convex/authGuard.test.ts]
- A recognized `organizationMembership.*` event missing `organization.id` is silently acknowledged (200, no Svix retry) — indistinguishable from an ignored event type. Audit-completeness concern once persistence lands; decide in Story 1.5 whether such anomalies should fail loud (500 → retry) or alert. [convex/lib/clerkWebhook.ts]

## Deferred from: code review of 1-3-brand-layer-design-tokens-and-status-badge (2026-07-16)

- StatusBadge has no fallback for an out-of-union runtime `status` (`components/StatusBadge.tsx`). `statusClasses[status]` is `undefined` for an unknown value, rendering a bare `secondary` badge with no family color. Not reachable today (only typed call site is `/dev/tokens`); revisit when Run/Report status data wires up in Epic 4 — validate the status field at the Convex boundary rather than trusting untyped data reaching the component.
- `/dev/tokens` is a routable server-rendered page in production with no `NODE_ENV`/config guard (`app/(app)/dev/tokens/page.tsx`). Auth-gated and harmless (a token gallery), but a dev-only surface ideally should not ship to prod. Add an env guard or exclude from the prod build if a dev/prod split is introduced later.
- `/dashboard` post-auth target exists twice: `redirect("/dashboard")` in app/page.tsx and `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL`. Consolidate if the landing route ever changes.
