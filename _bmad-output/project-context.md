---
project_name: 'agentic-reserving'
user_name: 'Rohan'
date: '2026-07-16'
sections_completed:
  ['technology_stack', 'language_rules', 'framework_rules', 'testing_rules', 'quality_rules', 'workflow_rules', 'anti_patterns']
status: 'complete'
rule_count: 38
optimized_for_llm: true
source: 'planning-artifacts/architecture/architecture-agentic-reserving-2026-07-16/ARCHITECTURE-SPINE.md'
---

# Project Context for AI Agents

_This file contains critical rules and patterns that AI agents must follow when implementing code in this project. Focus on unobvious details that agents might otherwise miss. The authority for all rules below is the architecture spine (AD-n references); read it for rationale._

---

## Technology Stack & Versions

- **Python plane** (`engine/`, one uv project): Python 3.11+, chainladder 0.9.2, FastAPI 0.139.0, anthropic 0.116.0, pandas + all deps pinned via `uv.lock`
- **Product plane**: Next.js 16.2.x (App Router), Convex (npm, lockfile-pinned), @convex-dev/workflow 0.3.10, `@clerk/nextjs` with Convex JWT template (template name `convex`), shadcn/ui + Tailwind
- **Testing**: pytest + Hypothesis (Python), Vitest + convex-test (Convex), Playwright (smoke)
- **Deployment**: Vercel (Next.js), Convex cloud, Cloud Run (single container for the whole `engine/` project)

## Critical Implementation Rules

### The Constitution (AD-1) — LLM never calculates

- **Every number originates in `reserving_engine`.** The LLM never computes, adjusts, or overrides a figure — permanently, not just v1. No arithmetic on reserve figures in Convex functions, React components (display formatting only), prompts, or export code.
- The agent's report drafts contain **placeholders, never figures**: `{{rs:<runId>:<method>:<origin>:<field>}}` and `{{dx:<diagnosticId>}}`. `engine_service` renders them from the ResultSet/DiagnosticsBundle, then runs the numeric-token checker (every numeric token must match a source value under the canonicalization rule; every claim cites ≥1 resolvable Diagnostic ID). Failing drafts are never persisted as reviewable; rejections are audit-logged.
- The gate governs machine-drafted content only. Human edits are human-owned and audit-logged; the approver signs the exact content version. Do not re-run the gate on human edits.
- Prompt instructions are never a substitute for the programmatic gate.

### Two-Runtime Layering (AD-2, AD-3, AD-12)

- **`reserving_engine` is a pure functional core**: plain data in, typed JSON-serialisable Pydantic models out (ResultSet, DiagnosticsBundle, validation reports). No file, network, environment, clock access, or logging side effects. Diagnostics *computation* lives here, not in the service.
- **`engine_service` (FastAPI) is the only imperative shell**: all I/O, HTTP, retries, service auth, the provenance gate, and `copilot_agent` hosting. It is stateless between requests and never calls Convex or Clerk.
- **Convex is the sole system of record.** Anything worth keeping is returned to the calling Convex action and persisted there. Agent conversation state is transient and reconstructable from the Audit Log.
- **Dependency direction is strict**: frontend → Convex → engine_service → reserving_engine. Nothing calls upward. The browser never calls `engine_service`; every engine endpoint requires the shared service bearer secret (held only in Convex + Cloud Run env).
- `copilot_agent` tools are **read-only views** over the current Run's ResultSet/DiagnosticsBundle held in memory — no filesystem, network, Convex access, or writes. Keep tool schemas and prompts provider-neutral (plain JSON Schema).

### Auth: no anonymous Convex access (AD-4)

- **Every public Convex function's first statement is `requireMember(ctx, workspaceId)`** (verified Clerk identity + membership in the Clerk org that is the Workspace). No exceptions — UI-hiding alone is never sufficient.
- Approve/publish/override paths call `requireRole(ctx, workspaceId, "senior_actuary")`. Role slugs: `analyst`, `senior_actuary`, carried as Clerk org roles in the JWT — never duplicated into Convex tables.
- An automated test enumerates public functions and asserts unauthenticated rejection; keep it green when adding functions.

### Audit & Orchestration (AD-6, AD-7)

- **`auditLogs` is append-only**: exactly one internal mutation `appendAuditEntry` writes to it; no code path patches or deletes rows. Entries are per-Workspace hash-chained: `hash = sha256(canonicalJSON(entry) + prevHash)`.
- Every LLM interaction (full prompt, each tool call/result, response), gate rejection, run event, report edit, override, approval, export, and mode transition is audit-logged with `workspaceId`, `runId`, actor.
- **Job-record-first**: create the Convex `runs` record before calling the engine; it is the sole authority on status (`queued | running | complete | failed`). The Convex run ID is the idempotency key on every engine call. Use `@convex-dev/workflow` for durability/retries.
- Interpretation **fails closed into Engine-Only Mode** (AD-9): model outage or per-Run cost-ceiling breach fails the Interpretation cleanly and audit-logs the transition; engine features must keep working.

### Testing Rules

- **Golden masters gate release**: pytest golden tests against the Taylor-Ashe triangle assert **exact** equality for point estimates on the pinned CI platform (linux/amd64); a red golden test blocks release. Cross-platform tolerance is 1e-8 relative — documented, not silently widened.
- Hypothesis **property tests for triangle validation** (shape, paid monotonicity, missing-cell detection). Monotonicity applies to paid triangles only (incurred rules pending actuarial confirmation — PRD OQ-6).
- **Every Convex function gets a convex-test + Vitest test**, including the auth-guard enumeration test and the auditLogs append-only test.
- One **Playwright smoke** covers the authenticated golden path (sign-in → upload → run → diagnostics → report). Don't grow it into a full E2E suite.
- ResultSet/DiagnosticsBundle schemas are the cross-runtime contract (AD-10): Pydantic models with `schemaVersion` export JSON Schema; a CI check diffs Convex validators/TS types against it. A ResultSet failing schema validation is never stored.

### Code Quality & Style Rules

- **Vocabulary**: use PRD §3 Glossary terms exactly, in code identifiers too — `Triangle`, `Run`, `ResultSet`, `Diagnostic`, `Lineage`, `Workspace`. Never invent synonyms (no "job", "analysis", "report_data").
- **Naming**: Python snake_case packages `reserving_engine/`, `engine_service/`, `copilot_agent/`; Convex functions camelCase grouped per table file (`convex/runs.ts`); tables plural camelCase (`auditLogs`).
- **IDs**: Convex document IDs on the product plane; `runId` is the cross-runtime correlation + idempotency key; Diagnostic IDs are `dx:{runId}:{kind}:{key}` with `kind ∈ {ldf_stability, ave, cl_bf_divergence, residual}`, generated only by `reserving_engine`.
- **Hashes — never conflate the two**: raw-file sha256 for duplicate detection at upload; canonical-triangle-JSON sha256 is *the* Triangle hash in Lineage.
- **Formats**: JSON across all boundaries; ISO-8601 UTC dates; engine_service error envelope `{code, message, details?}`; validation errors carry cell-level `{origin, dev, reason}`.
- Published reports are **immutable** — changes create a new version.

### Development Workflow Rules

- Build sequencing is fixed: engine + golden tests first → product spine → durable orchestration → agent layer last → hardening.
- Secrets: `ANTHROPIC_API_KEY` + service secret exist only in Cloud Run env; Clerk keys in Vercel + Convex env. Never in the repo or frontend bundle. Model ID and per-Run token/cost ceiling are engine_service config values.
- Environments: local (`convex dev` + uvicorn), Vercel preview + Convex preview + shared dev engine, prod.

### Critical Don't-Miss Rules (anti-patterns)

- ❌ Arithmetic on reserve figures anywhere outside `reserving_engine` — including "harmless" totals or deltas in the UI.
- ❌ A Convex function without `requireMember` as its first statement.
- ❌ Writing to `auditLogs` from anywhere but `appendAuditEntry`; updating or deleting an audit row.
- ❌ I/O, env reads, logging, or `datetime.now()` inside `reserving_engine`.
- ❌ The agent emitting literal numbers instead of `{{rs:...}}`/`{{dx:...}}` placeholders, or a new agent tool that isn't a read-only view.
- ❌ Duplicating role or run-status state outside its single source of truth (Clerk JWT / the `runs` record).
- ❌ Calling `engine_service` from the browser, or engine_service calling Convex/Clerk.
- ❌ Polling in application code — live status comes from Convex subscriptions (FR-20).
- ❌ Storing an unvalidated Triangle or a schema-invalid ResultSet.

---

## Usage Guidelines

**For AI Agents:**

- Read this file before implementing any code
- Follow ALL rules exactly as documented; when in doubt, prefer the more restrictive option
- Rationale and full rules live in the architecture spine (`_bmad-output/planning-artifacts/architecture/architecture-agentic-reserving-2026-07-16/ARCHITECTURE-SPINE.md`)

**For Humans:**

- Keep this file lean and focused on agent needs
- Update when the stack or the spine changes; remove rules that become obvious from the code

Last Updated: 2026-07-16
