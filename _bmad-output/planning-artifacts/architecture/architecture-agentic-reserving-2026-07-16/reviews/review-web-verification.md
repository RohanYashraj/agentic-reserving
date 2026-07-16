# Review — Web-verification lens

**Verdict: PASS with one note.**

Checked every named technology against the web on 2026-07-16:

- chainladder 0.9.2 — verified current (PyPI, released 2026-05-11). Sources: https://pypi.org/project/chainladder/
- anthropic 0.116.0 — verified current (PyPI, released 2026-07-02). Sources: https://pypi.org/project/anthropic/
- FastAPI 0.139.0 — verified current (PyPI, released 2026-07-01). Sources: https://pypi.org/project/fastapi/
- Next.js 16.2.10 — verified current stable (July 2026). Sources: https://nextjs.org/blog, https://endoflife.date/nextjs
- @convex-dev/workflow 0.3.10 — verified current (npm). Sources: https://www.npmjs.com/package/@convex-dev/workflow
- Clerk ↔ Convex JWT template — verified still the documented integration path (Convex docs, Clerk docs, official template repo). Sources: https://docs.convex.dev/auth/clerk, https://clerk.com/docs/guides/development/integrations/databases/convex
- convex-test + Vitest — verified current and documented (Convex docs, npm). Sources: https://docs.convex.dev/testing/convex-test

Delegated intentionally, acceptable: pandas (lockfile-pinned at scaffold, chainladder-compatible), Clerk/convex npm exact versions (lockfile at scaffold), shadcn/Tailwind (owned by UX DESIGN.md), Hypothesis/pytest/Vitest/Playwright (stable, lockfile at scaffold).

**Note (low):** chainladder 0.9.2 × Python 3.11+ compatibility was not explicitly confirmed against the package's classifiers. Risk is low (actively maintained package); verify at `uv init` and record the resolved pin in uv.lock.
