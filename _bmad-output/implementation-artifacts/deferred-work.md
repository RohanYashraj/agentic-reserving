# Deferred Work

## Deferred from: code review of 1-1-project-scaffold-and-local-dev-environment (2026-07-16)

- Geist fonts are loaded in `app/layout.tsx` but `app/globals.css` body falls back to Arial — dead font pipeline. Resolve in Story 1.3 (brand layer owns typography).
- Python package imports resolve only when pytest runs from `engine/` cwd (`package = false`, no install). CI and README both use that cwd; revisit only if IDE test runners bite.
- Root `tsconfig.json` includes `convex/**` in the Next.js (DOM-lib) type program. Consider a `convex/tsconfig.json` when the first Convex functions land (Story 1.4).
- No Python lint/format tooling (ruff/mypy) in `engine/` dev deps or CI. Add when engine code exists (Epic 2), where correctness matters most.
