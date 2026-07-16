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

### Clerk (one-time init)

Authentication is Clerk-hosted (Story 1.2); accounts, Workspaces (Clerk organizations), and roles are managed in the Clerk dashboard — there is no in-app admin UI or public sign-up.

1. Create a Clerk application; copy `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` into `.env.local` (see `.env.example` for all names).
2. Disable public sign-ups (Clerk dashboard → Restrictions) — users are invited via the dashboard only.
3. Enable **Organizations** with membership required. Create org roles `analyst` and `senior_actuary` (consumed by role guards from Story 1.4) and a test organization with at least one member.
4. Create a JWT template named exactly `convex` from Clerk's Convex preset, then add two custom claims (Story 1.4 — the preset does not include them, and the role guards read them from `ctx.auth.getUserIdentity()`):

   ```json
   {
     "org_id": "{{org.id}}",
     "org_role": "{{org.role}}"
   }
   ```

   `{{org.role}}` emits the prefixed role key (e.g. `org:analyst`); `convex/lib/guards.ts` normalizes it to the bare slug. The roles `analyst` and `senior_actuary` from step 3 must exist or every guarded call is FORBIDDEN.
5. Point Convex at the Clerk issuer (a Convex deployment env var, not `.env.local`):

   ```bash
   npx convex env set CLERK_JWT_ISSUER_DOMAIN https://<your-app>.clerk.accounts.dev
   npx convex env get CLERK_JWT_ISSUER_DOMAIN   # verify before deploying
   ```

6. Run `npx convex dev` once so `convex/auth.config.ts` deploys (it fails fast with a clear error if the issuer env var is missing).

7. Clerk webhook → Convex (Story 1.4, role/membership audit events):

   1. In the Clerk dashboard (Configure → Webhooks) add an endpoint pointing at the Convex deployment's **HTTP Actions** URL — the `.convex.site` domain, not `.convex.cloud`, and region-qualified exactly like the deployment's cloud URL (check `npx convex dashboard` or `.env.local`): e.g. `https://<deployment>.eu-west-1.convex.site/clerk-users-webhook`. The unqualified `<deployment>.convex.site` form 404s on regional deployments.
   2. Subscribe it to `organizationMembership.created`, `organizationMembership.updated`, and `organizationMembership.deleted`.
   3. Copy the endpoint's signing secret (`whsec_…`) into the Convex deployment env — never into the repo or any `.env` file:

      ```bash
      npx convex env set CLERK_WEBHOOK_SIGNING_SECRET whsec_...
      ```

   Dashboard-driven role changes reach the cloud dev deployment directly — no tunnel needed for local development.

SSO-ready by design: enabling SAML/OIDC for an enterprise customer is a Clerk dashboard configuration change (per-connection); `<SignIn />` renders enabled strategies automatically — no code change.

### Audit Log (Story 1.5, AD-6)

The `auditLogs` table is append-only and per-Workspace hash-chained: exactly one internal mutation — `appendAuditEntry` in `convex/auditLogs.ts` — writes rows, and no code path updates or deletes them (enforced by `tests/audit-append-only.test.ts` plus review). Each entry's `hash = sha256(canonicalJSON(entry) + prevHash)` (lowercase hex; the first entry of a Workspace chains from the empty string); the canonicalization contract lives in `convex/lib/auditChain.ts` and is frozen by a pinned known-answer test vector. The public query `auditLogs.verifyChain` re-walks a Workspace's chain and reports the first broken link. Clerk membership webhook events are persisted through this chain, with the `svix-id` as an idempotency key so redeliveries never duplicate entries.

### Reserving engine (Story 2.1, AD-2)

`engine/reserving_engine/` is the pure functional core: plain data in, typed JSON-serialisable Pydantic models out — no file, network, environment, clock, or logging side effects. Purity and the downward-only layering (`engine_service`/`copilot_agent` → `reserving_engine`, never the reverse) are enforced mechanically by import-linter contracts in `engine/pyproject.toml`. `validate_triangle` returns cell-level `{origin, dev, reason}` findings (shape, paid-only monotonicity per PRD OQ-6, missing cells) — never a generic failure. `triangle_hash` — sha256 of the canonical Triangle JSON, frozen by a pinned known-answer test — is *the* Triangle hash for Lineage; it is distinct from the raw-file sha256 (upload dedupe, Epic 3) and the audit-chain hash (`convex/lib/auditChain.ts`), which never share helpers. Lint locally with:

```bash
cd engine && uv run ruff check . && uv run lint-imports
```

`run_methods` (Story 2.2) is the engine's single computation entry point: it validates the Triangle at the boundary, runs Chain Ladder via chainladder 0.9.2, and returns a `ResultSet` — camelCase-on-the-wire Pydantic contract (AD-10) carrying LDFs, ultimates, and IBNR per Origin Period plus a `Lineage` (engine semver, chainladder version, canonical Triangle hash, all parameters) sufficient to reproduce the run (AD-11). Correctness is gated by Taylor-Ashe golden tests: exact equality on the pinned CI platform (linux/amd64), 1e-8 relative tolerance cross-platform, cross-checked against published Mack (1993) values, with a re-derivation test that replays a stored Lineage.

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
