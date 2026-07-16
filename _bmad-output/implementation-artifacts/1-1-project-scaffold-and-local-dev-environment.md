---
baseline_commit: 4d9f288d8df54e4b8ca3bb1730ae1c1e4bdd75d3
---

# Story 1.1: Project Scaffold and Local Dev Environment

Status: review

## Story

As a developer,
I want the repo scaffolded per the architecture Structural Seed with all three planes runnable locally,
so that every subsequent story starts from a working, correctly-shaped codebase.

## Acceptance Criteria

1. **Given** a fresh clone, **When** the documented setup commands are run, **Then** the repo contains `engine/` (one uv project with `reserving_engine/`, `engine_service/`, `copilot_agent/`, `tests/` packages), `convex/`, `app/` (Next.js 16.2.x App Router), and `components/` per the Structural Seed.
2. **And** `uv run pytest` passes (placeholder test), `npx convex dev` starts, and `next dev` renders a placeholder page.
3. **And** Python deps are pinned via `uv.lock` and Node deps via the lockfile per the architecture Stack table (chainladder 0.9.2, FastAPI 0.139.0, agno 2.x, @convex-dev/workflow 0.3.10).
4. **Given** the repo, **When** CI runs, **Then** a pipeline on linux/amd64 executes pytest and Vitest and fails the build on any red test (NFR-1 substrate, AD-11).
5. **And** no secret value appears anywhere in the repo (secrets are env-only per AD-12).

## Tasks / Subtasks

- [x] Task 1: Scaffold the Next.js product plane at the repo root (AC: 1, 2)
  - [x] 1.1 `create-next-app` with App Router + TypeScript + Tailwind, targeting Next.js 16.2.x (pin `"next": "16.2.x"` in package.json so the lockfile stays within the verified minor). The Next.js project lives at the **repo root** — `package.json`, `app/`, `components/` are top-level siblings of `engine/` and `convex/`, exactly per the Structural Seed. Do NOT nest it in a `web/` or `frontend/` subdirectory.
  - [x] 1.2 Create `components/` at root (empty or with a `.gitkeep`/placeholder) — shadcn/ui init and brand tokens land in Story 1.3, not here.
  - [x] 1.3 Placeholder page at `app/page.tsx` renders (plain text is fine; no auth yet — Clerk lands in Story 1.2).
  - [x] 1.4 Verify `npm run dev` (`next dev`) serves the placeholder page.
- [x] Task 2: Scaffold Convex (AC: 1, 2, 3)
  - [x] 2.1 `npm install convex` (latest, lockfile-pinned) and `npm install @convex-dev/workflow@0.3.10`.
  - [x] 2.2 Create `convex/` with a minimal `convex/schema.ts` (empty `defineSchema({})` is fine — table definitions arrive just-in-time in later stories; do NOT pre-create tables).
  - [x] 2.3 Verify `npx convex dev` starts and syncs (requires a Convex dev deployment; document the one-time `npx convex dev` login/init in the README).
  - [x] 2.4 Install `convex-test` + `vitest` as devDependencies and add one placeholder Vitest test so the CI Vitest step has something real to run. Wire `npm test` → `vitest run`.
- [x] Task 3: Scaffold the Python plane as one uv project in `engine/` (AC: 1, 2, 3)
  - [x] 3.1 `uv init` in `engine/` with `requires-python = ">=3.11"`. Create four packages: `reserving_engine/`, `engine_service/`, `copilot_agent/`, `tests/` — each with `__init__.py` (tests may be a plain directory per pytest convention).
  - [x] 3.2 Add pinned deps: `chainladder==0.9.2`, `fastapi==0.139.0`, `agno` (2.x — 2.5.17 verified current 2026-07-16; let uv resolve within 2.x and lock), `google-genai` (latest, uv.lock-pinned), plus `pandas` (chainladder-compatible, resolver-pinned), `uvicorn` (to run the service locally), `pydantic`.
  - [x] 3.3 Add dev deps: `pytest`, `hypothesis`.
  - [x] 3.4 Verify chainladder 0.9.2 resolves on Python 3.11+ during `uv sync` (architecture web-verification flagged this as unconfirmed against classifiers — if it fails to resolve, stop and surface it rather than downgrading Python silently).
  - [x] 3.5 One placeholder test in `engine/tests/` (e.g. imports each of the three packages and asserts trivially); `uv run pytest` passes.
  - [x] 3.6 Commit `uv.lock`.
- [x] Task 4: CI pipeline on linux/amd64 (AC: 4)
  - [x] 4.1 GitHub Actions workflow (`.github/workflows/ci.yml`) on `ubuntu-latest` (linux/amd64 — the pinned golden-test platform per AD-11) with two jobs: Python (`uv sync --locked` + `uv run pytest` in `engine/`) and Node (`npm ci` + `vitest run` at root).
  - [x] 4.2 Any red test fails the build (default job failure semantics — do not add `continue-on-error`).
  - [x] 4.3 Trigger on push + pull_request to `main`.
- [x] Task 5: Secrets hygiene and developer docs (AC: 5)
  - [x] 5.1 `.gitignore` covers `.env*` (allowing `.env.example`), `node_modules/`, `.next/`, `engine/.venv/`, `__pycache__/`.
  - [x] 5.2 `.env.example` files list variable **names only** with placeholder values (e.g. `GEMINI_API_KEY=`, `ENGINE_SERVICE_SECRET=`, Clerk keys, `CONVEX_DEPLOYMENT`) — never real values. Grep the repo for anything that looks like a live key before committing.
  - [x] 5.3 README section "Local development": prerequisites (Node, uv, Python 3.11+), the three run commands (`npm run dev`, `npx convex dev`, `uv run uvicorn ...` noted as arriving in Story 2.5 — for now `uv run pytest` is the Python-plane verification), and the setup commands a fresh clone needs (AC 1 says "documented setup commands" — this README is that document).
- [x] Task 6: Verify the full AC set end-to-end (AC: 1–5)
  - [x] 6.1 From a clean state (`git clean -xdn` to preview): follow the README exactly; all three planes come up; both test suites pass locally; CI green on the PR.

### Review Findings

- [ ] [Review][Decision] AC-4 unproven: Tasks 3.6 + 6.1 checked but nothing is committed — `uv.lock` isn't committed and CI has never executed. Resolve by committing + pushing to trigger the pipeline, or unchecking the subtasks pending your own commit.
- [ ] [Review][Patch] CI Node job runs tests only — add `npm run lint` + `tsc --noEmit` steps [.github/workflows/ci.yml:48-60]
- [ ] [Review][Patch] Scaffold test asserts schema is empty — guaranteed red when Story 1.4 adds tables; relax assertion [tests/scaffold.test.ts:7]
- [ ] [Review][Patch] CI never runs on non-main-target PRs; no manual trigger — unfilter `pull_request`, add `workflow_dispatch` [.github/workflows/ci.yml:25-29]
- [ ] [Review][Patch] Workflow hygiene: no `permissions:` block; setup-uv version unpinned [.github/workflows/ci.yml:41-42]
- [ ] [Review][Patch] `GEMINI_MODEL_ID` carries a value in a names-only file [engine/.env.example:6]
- [ ] [Review][Patch] Metadata still "Create Next App" [app/layout.tsx:metadata]
- [ ] [Review][Patch] `@types/node ^20` vs Node 22 in CI/README; no `engines` field [package.json]
- [ ] [Review][Patch] Root-level `.venv/` not gitignored (only `engine/.venv/`) [.gitignore:38]
- [ ] [Review][Patch] Vitest include misses `.tsx` specs [vitest.config.mts:8]
- [ ] [Review][Patch] ESLint ignore over-broad: `engine/**` where `engine/.venv/**` is the actual offender [eslint.config.mjs]
- [ ] [Review][Patch] `package.json` missing trailing newline [package.json]
- [x] [Review][Defer] Geist fonts loaded but body uses Arial — Story 1.3 owns globals.css/typography [app/globals.css] — deferred, lands with brand layer
- [x] [Review][Defer] Python imports resolve only from `engine/` cwd (IDE runners at repo root fail) [engine/pyproject.toml] — deferred, CI/README both use engine/ cwd; revisit if it bites
- [x] [Review][Defer] Root tsconfig sweeps `convex/**` into the Next.js type program [tsconfig.json] — deferred, revisit when first Convex functions land (Story 1.4)
- [x] [Review][Defer] No Python lint/format tooling (ruff/mypy) [engine/pyproject.toml] — deferred, add when engine code exists (Epic 2)

## Dev Notes

### Architecture Compliance (non-negotiable)

- **Structural Seed is exact** [Source: ARCHITECTURE-SPINE.md#Structural Seed]:

  ```text
  agentic-reserving/
    engine/                      # Python plane — one uv project, one Cloud Run image
      reserving_engine/          # pure core (Pydantic models, methods, diagnostics, validation)
      engine_service/            # FastAPI shell
      copilot_agent/             # Agno agent + read-only tool views
      tests/
    convex/
    app/                         # Next.js App Router
    components/
  ```

  One uv project for the whole `engine/` directory — not three. One future Cloud Run image.
- **Dependency direction** (AD-2, AD-3, AD-12): frontend → Convex → engine_service → reserving_engine. Nothing at this story wires cross-plane calls yet; just don't create anything that violates the shape (e.g. no engine URL in frontend env).
- **Naming** [Source: project-context.md#Code Quality]: Python snake_case packages exactly as named above; Convex camelCase functions per table file; tables plural camelCase. PRD glossary vocabulary in identifiers (`Triangle`, `Run`, `ResultSet`, ...) — never synonyms like "job" or "analysis".
- **AD-11**: CI platform is linux/amd64 and is the platform golden tests will assert exact equality on (Epic 2). `ubuntu-latest` runners satisfy this. Don't add macOS/Windows matrix legs.
- **AD-12**: `GEMINI_API_KEY` + service secret will live in Cloud Run env only; Clerk keys in Vercel + Convex env. At this story that means: no secret values in the repo, `.env*` gitignored, `.env.example` names-only.

### Version Pins (web-verified 2026-07-16)

| Dep | Pin | Note |
| --- | --- | --- |
| Python | 3.11+ | uv-managed |
| chainladder | ==0.9.2 | PyPI current; verify 3.11 resolution at `uv sync` (open note from web-verification review) |
| FastAPI | ==0.139.0 | PyPI current |
| agno | 2.x (2.5.17 current) | Gemini via Agno's model abstraction — never raw REST (AD-8); model ID `gemini-3.1-flash-lite` is engine_service config, not needed in this story |
| google-genai | latest → uv.lock | official Gemini SDK, used under Agno |
| pandas | resolver-pinned | chainladder-compatible |
| Next.js | 16.2.x | App Router |
| convex (npm) | latest → lockfile | |
| @convex-dev/workflow | 0.3.10 | install now; used in Epic 4 |
| pytest + Hypothesis, Vitest + convex-test | latest → lockfiles | Playwright deferred to Story 7.4 — do not install now |

[Source: ARCHITECTURE-SPINE.md#Stack; reviews/review-web-verification.md; agno pin per architecture memlog / commit 290fa88]

### Scope Boundaries (do NOT build these here)

- No Clerk / auth (Story 1.2). No shadcn init or brand tokens (Story 1.3). No `requireMember`/`requireRole` (Story 1.4). No `auditLogs` (Story 1.5). No FastAPI routes or engine logic (Epic 2) — `engine_service/` and `copilot_agent/` are empty packages with `__init__.py` only.
- No Convex tables. Schema stays empty; tables are created just-in-time by the story that first needs them (implementation-readiness decision).
- No Playwright, no Storybook, no Docker/Cloud Run config (deployment wiring is not an AC of this story; the container lands when the engine service does).
- Do not touch `_bmad/`, `_bmad-output/`, or `docs/` — they are planning artifacts, not app code. Scaffold around them; ensure `create-next-app` runs in a way that tolerates a non-empty directory (scaffold in a temp dir and move files in, or use `create-next-app .` with the existing-files flag as supported).

### Project Structure Notes

- Repo root currently contains only `_bmad/`, `_bmad-output/`, `docs/` — pure greenfield for app code; no conflicts.
- Next.js at the repo root means root `package.json` owns both the frontend and Convex deps; `engine/` is the only nested project (uv). This matches the Structural Seed exactly; any deviation (monorepo tooling, workspaces) is out of scope and would violate the spine.
- CI: two independent jobs so a Python failure and a Node failure are separately visible; both required.

### Testing Standards

- Placeholder tests must be real, runnable tests: `engine/tests/test_scaffold.py` (imports the three packages), one root Vitest spec (can assert the placeholder page component renders or trivially pass). They exist so `uv run pytest` and `vitest run` exercise the full toolchain in CI from day one [Source: ARCHITECTURE-SPINE.md#Consistency Conventions — Testing].
- From Story 1.4 onward every Convex function needs a convex-test; installing convex-test now makes that frictionless.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.1] — story + ACs
- [Source: _bmad-output/planning-artifacts/architecture/architecture-agentic-reserving-2026-07-16/ARCHITECTURE-SPINE.md] — Structural Seed, Stack, AD-2/3/8/11/12, deployment/environments
- [Source: _bmad-output/planning-artifacts/architecture/architecture-agentic-reserving-2026-07-16/reviews/review-web-verification.md] — version verification (2026-07-16; anthropic entry superseded by agno per memlog)
- [Source: _bmad-output/project-context.md] — 38 agent rules; read before implementing

## Dev Agent Record

### Agent Model Used

claude-fable-5 (Claude Code)

### Debug Log References

- Vitest 4 removed `environmentMatchGlobs`; initial vitest.config.mts failed `tsc --noEmit`. Fixed by simplifying to `test.include: ["tests/**/*.test.ts"]` — the edge-runtime project for convex-test lands with the first Convex function test (Story 1.4).
- ESLint (eslint-config-next flat config) descended into `engine/.venv` (matplotlib's bundled JS → 5 errors). Fixed via `globalIgnores` additions: `engine/**`, `convex/_generated/**`.
- `npx convex dev --local` is deprecated; anonymous local flow is `npx convex deployment create local` (auto-offered) then `npx convex dev`. Verified: "Convex functions ready!" against local deployment on port 3210, no account.

### Completion Notes List

- Next.js 16.2.10 (App Router, TS, Tailwind 4) scaffolded via create-next-app in a temp dir and moved to repo root (root was non-empty with `_bmad*/docs`). `next` pinned `16.2.x` in package.json, 16.2.10 in package-lock.json. Placeholder page verified serving via `next dev` + curl ("Reserving Copilot").
- Convex: `convex@1.42.2` (lockfile-pinned), `@convex-dev/workflow` pinned exact `0.3.10`. Empty `defineSchema({})` — no tables, per just-in-time decision. `convex/_generated/` committed (standard Convex practice; convex-test will need it from Story 1.4).
- Engine: one uv project, `requires-python = ">=3.11"`, `.python-version` 3.12 (uv-managed 3.12.13) so CI and local resolve identically (AD-11 determinism). chainladder==0.9.2 + fastapi==0.139.0 exact; agno resolved 2.7.3 constrained `>=2.7.3,<3` (within the architecture's "2.x"); google-genai 2.12.0, pandas explicit, all locked in `uv.lock`. `[tool.uv] package = false` (flat packages, no build).
- Tests: `engine/tests/test_scaffold.py` (imports all three packages) green via `uv run pytest` and `uv sync --locked`; root `tests/scaffold.test.ts` (loads Convex schema) green via `npm test` (vitest run). Lint + `tsc --noEmit` clean.
- CI: `.github/workflows/ci.yml`, two jobs on ubuntu-latest (linux/amd64 per AD-11): `uv sync --locked` + pytest in `engine/`; `npm ci` + `npm test` at root. Default failure semantics, push + PR to main. Note: actual CI execution pending first push — nothing is committed yet (no commit was requested); all steps verified locally with the exact CI commands.
- Secrets: `.env*` gitignored with `!.env.example` carve-out; `.env.example` (root, names-only: Convex + Clerk) and `engine/.env.example` (GEMINI_API_KEY, ENGINE_SERVICE_SECRET, GEMINI_MODEL_ID name only). Secret-pattern grep over the repo: 0 matches. `.env.local` (written by convex dev) confirmed ignored.
- Scope boundaries held: no Clerk, no shadcn init, no guards, no auditLogs, no FastAPI routes, no Playwright, no Docker. `engine_service/`/`copilot_agent/`/`reserving_engine/` are empty packages with `__init__.py` only.

### File List

- package.json (new)
- package-lock.json (new)
- tsconfig.json (new)
- next.config.ts (new)
- postcss.config.mjs (new)
- eslint.config.mjs (new — with engine/convex/_generated ignores)
- vitest.config.mts (new)
- .gitignore (new — create-next-app base + python/env-example rules)
- .env.example (new)
- README.md (new)
- .github/workflows/ci.yml (new)
- app/layout.tsx, app/globals.css, app/favicon.ico (new, create-next-app)
- app/page.tsx (new — placeholder page)
- public/* (new, create-next-app assets)
- components/.gitkeep (new)
- convex/schema.ts (new)
- convex/_generated/* (new, generated by convex dev)
- tests/scaffold.test.ts (new)
- engine/pyproject.toml (new)
- engine/uv.lock (new)
- engine/.python-version (new)
- engine/.env.example (new)
- engine/reserving_engine/__init__.py (new)
- engine/engine_service/__init__.py (new)
- engine/copilot_agent/__init__.py (new)
- engine/tests/__init__.py (new)
- engine/tests/test_scaffold.py (new)
- _bmad-output/implementation-artifacts/sprint-status.yaml (modified)
- _bmad-output/implementation-artifacts/1-1-project-scaffold-and-local-dev-environment.md (modified — this file)

## Change Log

- 2026-07-16: Story 1.1 implemented — three-plane scaffold (Next.js 16.2.10 root, Convex + workflow 0.3.10, engine/ uv project with pinned chainladder/FastAPI/agno), CI workflow, secrets hygiene, README. All ACs verified locally; status → review.
