# agentic-reserving — Reserving Copilot

Layered three-plane system: Next.js frontend → Convex (sole system of record) → `engine_service` (FastAPI) → `reserving_engine` (pure core). See `_bmad-output/planning-artifacts/architecture/` for the architecture spine and `_bmad-output/project-context.md` for the rules AI agents must follow.

## Repository layout

```text
engine/                      # Python plane — one uv project, one future Cloud Run image
  reserving_engine/          # pure core: methods, diagnostics, validation (Pydantic)
  engine_service/            # FastAPI shell: routes, service auth, provenance gate
  copilot_agent/             # Agno agent (google-genai) + read-only tool views
  tests/
convex/                      # schema.ts, auth guards, per-table functions
app/                         # Next.js App Router
components/                  # shadcn/ui + brand layer (Story 1.3)
```

## Local development

### Prerequisites

- Node.js 22+ and npm
- [uv](https://docs.astral.sh/uv/) (manages Python 3.11+ automatically)

### Setup (fresh clone)

```bash
# Product plane
npm ci

# Python plane
cd engine && uv sync && cd ..
```

### Convex (one-time init)

`npx convex dev` needs a deployment. Either log in (`npx convex login`) for a cloud dev deployment, or develop anonymously against a local deployment:

```bash
npx convex deployment create local   # once, if developing without an account
```

Convex writes its connection info to `.env.local` (gitignored).

### Run

```bash
npm run dev        # Next.js at http://localhost:3000
npx convex dev     # Convex function sync (separate terminal)
```

The engine service (`uv run uvicorn ...`) arrives in Story 2.5; until then the Python plane is verified by its tests.

### Tests

```bash
npm test                     # Vitest (root)
cd engine && uv run pytest   # pytest (Python plane)
```

CI (`.github/workflows/ci.yml`) runs both suites on linux/amd64 and fails the build on any red test.

## Secrets

Never commit secret values. `.env*` is gitignored; `.env.example` files list variable names only. `GEMINI_API_KEY` and the service secret exist only in Cloud Run env; Clerk keys in Vercel + Convex env (AD-12).
