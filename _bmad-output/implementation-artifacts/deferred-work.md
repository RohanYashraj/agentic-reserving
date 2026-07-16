# Deferred Work

## Deferred from: code review of 1-1-project-scaffold-and-local-dev-environment (2026-07-16)

- Geist fonts are loaded in `app/layout.tsx` but `app/globals.css` body falls back to Arial — dead font pipeline. Resolve in Story 1.3 (brand layer owns typography).
- Python package imports resolve only when pytest runs from `engine/` cwd (`package = false`, no install). CI and README both use that cwd; revisit only if IDE test runners bite.
- Root `tsconfig.json` includes `convex/**` in the Next.js (DOM-lib) type program. Consider a `convex/tsconfig.json` when the first Convex functions land (Story 1.4).
- No Python lint/format tooling (ruff/mypy) in `engine/` dev deps or CI. Add when engine code exists (Epic 2), where correctness matters most.

## Deferred from: code review of 1-2-clerk-sign-in-and-protected-app-shell (2026-07-16)

- `/sign-in(.*)` in proxy.ts prefix-matches any path starting with `/sign-in` (e.g. `/sign-in-help` would be public). Official Clerk quickstart pattern; no sibling routes exist today. Tighten to `/sign-in(/.*)?` if such routes ever appear.
- proxy.ts matcher exempts non-API paths ending in static extensions (`.csv`, `.xlsx`, …) from auth. Official Clerk matcher; fine while downloads are API/Convex-storage routes — revisit if a page route ever serves an extension-suffixed path.
- Sidebar nav has no active-route state or `aria-current` (app/(app)/layout.tsx). Land with the shadcn/brand-token pass in Story 1.3.
- `/dashboard` post-auth target exists twice: `redirect("/dashboard")` in app/page.tsx and `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL`. Consolidate if the landing route ever changes.
