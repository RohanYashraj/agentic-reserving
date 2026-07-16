---
stepsCompleted: [1, 2, 3, 4]
inputDocuments: []
workflowType: 'research'
lastStep: 1
research_type: 'technical'
research_topic: 'Agentic insurance reserving app — chainladder/FastAPI engine, Next.js + Clerk + Convex, Gemini LLM interpretation layer'
research_goals: '(1) Clerk + Convex + Next.js App Router integration pattern; (2) Convex actions orchestrating a long-running external Python service (job status, retries); (3) wrapping a deterministic actuarial engine with an LLM interpretation layer (Gemini API, model gemini-3.1-flash-lite, function calling) keeping the LLM away from arithmetic, with audit logging for regulated workflows'
user_name: 'Rohan'
date: '2026-07-16'
web_research_enabled: true
source_verification: true
---

# Research Report: technical

**Date:** 2026-07-16
**Author:** Rohan
**Research Type:** technical

---

## Research Overview

[Research overview and methodology will be appended here]

---

<!-- Content will be appended sequentially through research workflow steps -->

## Technical Research Scope Confirmation

**Research Topic:** Agentic insurance reserving app — chainladder/FastAPI engine, Next.js + Clerk + Convex, Gemini LLM interpretation layer
**Research Goals:** (1) Clerk + Convex + Next.js App Router integration pattern; (2) Convex actions orchestrating a long-running external Python service (job status, retries); (3) wrapping a deterministic actuarial engine with an LLM interpretation layer (Gemini API, model gemini-3.1-flash-lite, function calling) keeping the LLM away from arithmetic, with audit logging for regulated workflows

**Scope Amendment (2026-07-16):** LLM interpretation layer changed from Claude API to Google Gemini API, target model `gemini-3.1-flash-lite`.

**Scope Amendment 2 (2026-07-16):** Any agent construction must use the **Agno** framework (Python multi-agent framework) as the agent orchestration layer.

**Technical Research Scope:**

- Architecture Analysis - design patterns, frameworks, system architecture
- Implementation Approaches - development methodologies, coding patterns
- Technology Stack - languages, frameworks, tools, platforms
- Integration Patterns - APIs, protocols, interoperability
- Performance Considerations - scalability, optimization, patterns

**Research Methodology:**

- Current web data with rigorous source verification
- Multi-source validation for critical technical claims
- Confidence level framework for uncertain information
- Comprehensive technical coverage with architecture-specific insights

**Scope Confirmed:** 2026-07-16

## Technology Stack Analysis

### Programming Languages

The stack is deliberately bilingual: **Python** for the actuarial calculation engine (the `chainladder` ecosystem is Python-native and has no serious TypeScript equivalent) and **TypeScript** end-to-end for the product surface (Next.js frontend, Convex backend functions, Clerk SDKs). This split matches the dominant 2026 pattern for "deterministic scientific core + reactive product shell" applications.

_Popular Languages: Python 3.11+ (engine), TypeScript (frontend + Convex)_
_Language Evolution: Convex functions are TypeScript-first; chainladder remains the reference Python reserving library_
_Performance Characteristics: chainladder is numpy/pandas-backed; heavy triangle computation belongs in the Python service, never in Convex functions_
_Source: https://github.com/casact/chainladder-python, https://docs.convex.dev/functions/actions_

### Development Frameworks and Libraries

- **chainladder-python** (casact): actuarial reserving with deterministic and stochastic methods — Chain Ladder, Mack, Bornhuetter-Ferguson, Cape Cod. API mimics pandas (data manipulation) and scikit-learn (estimator/fit pattern), so methods compose as estimators. The CAS E-Forum "Practitioners' Guide to Building Actuarial Reserving Workflows Using Chain-Ladder Python" is the authoritative workflow reference.
- **FastAPI**: the standard Python web framework for exposing the engine; async-native, Pydantic-validated request/response models (which doubles as an audit-friendly contract).
- **Next.js (App Router)**: React Server Components model; Clerk's `@clerk/nextjs` SDK now functions as both client and server context provider (Next.js 15+).
- **Convex**: reactive database + serverless functions (queries/mutations/actions) + file storage; first-class components for background work (`@convex-dev/workpool`, `@convex-dev/workflow`).

_Major Frameworks: chainladder, FastAPI, Next.js App Router, Convex_
_Ecosystem Maturity: all four actively maintained with current docs (verified 2026-07-16)_
_Source: https://chainladder-python.readthedocs.io/en/latest/intro.html, https://eforum.casact.org/article/123379-practitioners-guide-to-building-actuarial-reserving-workflows-using-chain-ladder-python, https://docs.convex.dev/client/react/nextjs/_

### LLM Layer: Gemini API

Target model: **`gemini-3.1-flash-lite`** — Google's GA high-efficiency multimodal model optimized for low-latency, high-volume workloads. Verified capabilities and pricing:

- **Pricing:** $0.25 / 1M input tokens, $1.50 / 1M output tokens (half the cost of Gemini 3 Flash) — well-suited to a high-volume interpretation layer.
- **Context/output:** 1.0M-token context window, up to 66K output tokens per request.
- **Function calling:** supported (standard custom tools, combinable with built-in tools; multimodal function responses supported). This is the mechanism for keeping the LLM away from arithmetic — the model calls tools that return engine-computed numbers.
- **Structured output:** full JSON Schema support across actively supported Gemini models — Pydantic/Zod schemas work out of the box; `responseSchema` + `propertyOrdering[]` give schema-conformant, deterministically-ordered output, which matters for audit log stability.
- Positioned by Google for "lightweight agentic workflows, simple data extraction" — appropriate for narration/interpretation; complex multi-step agentic reasoning may warrant a larger Gemini model as a config-swappable option (confidence: medium — depends on prompt complexity discovered during build).

_Source: https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite, https://ai.google.dev/gemini-api/docs/pricing, https://ai.google.dev/gemini-api/docs/structured-output, https://blog.google/innovation-and-ai/technology/developers-tools/gemini-api-structured-outputs/_

### Database and Storage Technologies

**Convex is the system of record for the product layer**: reserving jobs, run metadata, LLM interpretation transcripts, audit log entries, and uploaded triangle files (Convex file storage). Convex queries are reactive by default — job status written by a mutation streams live to every subscribed client with no polling code. The Python engine should remain **stateless** (triangle in, results out), keeping all durable state in Convex — this makes the audit story single-sourced.

_Relational/NoSQL: Convex document store with relational-style indexes; no second database needed at this scale_
_File Storage: Convex file storage for uploaded loss triangles and generated artifacts_
_Confidence: high for the pattern; revisit if triangle datasets grow beyond document-size norms_
_Source: https://docs.convex.dev/, https://stack.convex.dev/background-job-management_

### Cloud Infrastructure and Deployment

- **Convex**: fully managed (no infra decisions).
- **Next.js**: Vercel is the default pairing.
- **FastAPI engine**: **Google Cloud Run** is the consensus 2026 deployment target for a containerized FastAPI service — serverless, scale-to-zero, single-worker-per-instance model (Cloud Run scales by instances, not workers). Key practices: slim Python base image, non-root user, minimize cold-start time, do **not** run long background jobs inside the API process without a queue plan. Using Google for both Cloud Run and Gemini consolidates billing/IAM (observation, not a hard requirement — Fly.io/Railway/Render are viable alternates).
- Long-running reserving computations: chainladder runs on realistic triangles are typically seconds-not-hours, but the orchestration pattern (researched in the next section) should assume minutes-scale jobs for safety.

_Container Technologies: Docker (slim image) on Cloud Run_
_Serverless: Convex functions + Cloud Run; both scale to zero_
_Source: https://docs.cloud.google.com/run/docs/quickstarts/build-and-deploy/deploy-python-fastapi-service, https://davidmuraya.com/blog/fastapi-performance-tuning-on-google-cloud-run/, https://www.zestminds.com/blog/fastapi-deployment-guide/_

### Technology Adoption Trends

- The Clerk + Convex + Next.js trio is a well-trodden 2025–2026 indie/startup stack with official docs on both the Clerk and Convex sides, demo repos, and a Convex-authored best-practices guide — low integration risk.
- Convex has productized exactly the orchestration primitives this app needs (`workpool` for retries/parallelism limits, `workflow` for durable multi-step jobs), reflecting the broader industry shift toward durable-execution patterns for agentic apps.
- Function-calling-first LLM integration (schema as contract, model never free-generates numbers) has become the standard reliability pattern, displacing prompt-engineered JSON.

_Migration Patterns: prompt-engineered JSON → schema-enforced function calling; hand-rolled job tables → durable workflow components_
_Source: https://stack.convex.dev/authentication-best-practices-convex-clerk-and-nextjs, https://stack.convex.dev/durable-workflows-and-strong-guarantees, https://medium.com/@Tal-Hason/enforcing-structured-ai-output-a-function-calling-approach-with-gemini-3-c15719d7e427_

## Integration Patterns Analysis

### Seam 1: Clerk + Convex + Next.js (App Router) Auth Integration

**Canonical pattern** (documented officially on both vendor sides):

1. In the Clerk dashboard: **Configure → Session Management → JWT Templates → create the "Convex" template**. This mints JWTs Convex can validate.
2. In `convex/auth.config.ts`: register Clerk as an identity provider using the Clerk Frontend API URL via a `CLERK_JWT_ISSUER_DOMAIN` environment variable (set in the Convex deployment, not just `.env.local`).
3. Provider nesting in the App Router: `app/layout.tsx` (Server Component) renders `<ClerkProvider>` wrapping a **client-component wrapper** (`ConvexClientProvider`) that renders `<ConvexProviderWithClerk>`. The order is load-bearing — ClerkProvider must be outermost because Convex reads the Clerk context. `ConvexProviderWithClerk` cannot appear directly in a Server Component. With Next.js 15+, `@clerk/nextjs`'s ClerkProvider works as both server and client context provider.
4. In Convex functions: `ctx.auth.getUserIdentity()` returns the validated identity (or `null`). Guaranteed fields: `tokenIdentifier`, `subject`, `issuer`; the Clerk integration adds email, names, etc. **Never trust client-provided user IDs** — always derive the acting user from `ctx.auth`.
5. Client-side gating: use Convex's `useConvexAuth()` rather than Clerk's `useAuth()` to know when authenticated Convex calls are safe — it confirms the token was fetched *and* validated by the Convex backend.
6. Persisting users: sync Clerk users into a Convex `users` table either lazily on first authenticated call or via **Clerk webhooks → Convex HTTP action** (with Svix signature verification) for reliable create/update/delete propagation.

_Auth flow: Clerk JWT → ConvexProviderWithClerk → Convex validates issuer → ctx.auth.getUserIdentity()_
_Confidence: high — official docs on both sides agree_
_Source: https://docs.convex.dev/auth/clerk, https://clerk.com/docs/guides/development/integrations/databases/convex, https://stack.convex.dev/authentication-best-practices-convex-clerk-and-nextjs, https://docs.convex.dev/auth/functions-auth, https://clerk.com/blog/webhooks-data-sync-convex_

### Seam 2: Convex Actions Orchestrating the FastAPI Reserving Engine

**Recommended architecture — job record + durable execution + callback/poll:**

1. **Job record first**: a mutation creates a `reservingJobs` document (status `queued`, input file ref, method params, requesting user). Because Convex queries are reactive, the frontend subscribes to this record and gets live status with zero polling code.
2. **Durable execution**: use the **`@convex-dev/workpool`** component (retries with exponential backoff + jitter, bounded parallelism — backoff runs on the scheduler, not by sleeping in a serverless function) or **`@convex-dev/workflow`** (multi-step durable workflows that survive function timeouts; each step retried per policy; exactly-once mutations; guaranteed `onComplete`). For "call engine → store results → trigger interpretation → write audit entry" chains, `workflow` is the better fit; for simple fire-with-retry, `workpool` suffices.
3. **Calling the engine**: the Convex action `fetch`es the FastAPI service. Two completion patterns:
   - **Synchronous within the action** — viable when chainladder runs complete in seconds (typical for standard triangles); the action awaits the HTTP response and writes results via `runMutation`. Simplest; bounded by Convex action time limits.
   - **Async job + callback** — FastAPI returns `202 Accepted` + engine job ID immediately; on completion the engine POSTs results to a **Convex HTTP action** (exposed at `https://<deployment>.convex.site`), which verifies a shared-secret/HMAC signature and writes results via mutation. Add a scheduled reconciliation poll as a safety net for lost callbacks. This is the pattern to design for, even if v1 runs synchronously.
4. **Idempotency and retries**: every step touching the third-party (FastAPI) boundary must be an **idempotent action** — pass the Convex job ID to the engine and have the engine dedupe on it, so a retry after a network failure doesn't double-compute (or worse, double-record). Retry policies handle transient failures and avoid stampeding herds during outages.
5. **Engine-side auth**: FastAPI endpoints protected by a service-to-service secret (bearer token held in Convex environment variables); Convex HTTP action callbacks verified by signature — never trust unauthenticated callbacks.

_Job status: reactive Convex query on the job document — many users can watch simultaneously_
_Retries: workpool/workflow-managed backoff, idempotent steps keyed by job ID_
_Confidence: high — Convex-official components and guides_
_Source: https://docs.convex.dev/functions/actions, https://github.com/get-convex/workpool, https://github.com/get-convex/workflow, https://stack.convex.dev/retry-actions, https://stack.convex.dev/background-job-management, https://docs.convex.dev/functions/http-actions, https://stack.convex.dev/durable-workflows-and-strong-guarantees_

### Seam 3: Gemini Interpretation Layer over the Deterministic Engine

**Principle: the LLM narrates; the engine computes.** Enforcement patterns:

1. **Function calling as the arithmetic firewall**: expose engine capabilities to `gemini-3.1-flash-lite` as declared tools (`getTriangleSummary`, `getReserveEstimates`, `compareMethodResults`, `getMackStandardErrors`...). Each tool resolves to engine-computed or Convex-stored values. The model composes narrative *around* tool results; every number in the output should be traceable to a tool response, never model-generated.
2. **The tool loop (Gemini 3.x specifics)**: model returns `functionCall` parts → app executes → app returns `functionResponse` parts. **Critical:** Gemini 3 models with thinking emit **thought signatures** (encrypted reasoning state) on function calls; the first `functionCall` part in each step must have its `thought_signature` returned with the function result or the API fails with a 400. Official SDKs (`google-genai`) handle this automatically — a strong argument for using the SDK rather than raw REST, and for keeping the loop server-side in a Convex action or the FastAPI layer. Parallel calls must be returned as all-calls-then-all-responses, not interleaved.
3. **Structured output for the narrative itself**: constrain the interpretation response with `responseSchema` (JSON Schema; Pydantic/Zod supported) — e.g. `{summary, methodComparison[], caveats[], numbersUsed[]}` — so the "numbers used" can be programmatically diffed against actual tool responses as a post-hoc verification gate (reject/flag any number lacking a tool provenance).
4. **Audit logging for regulated workflows**: the regulatory backdrop is real — the **NAIC AI Model Bulletin** (adopted by 25+ states and D.C.) requires insurers to document AI governance, data provenance, and model validation across the insurance lifecycle; the EU AI Act treats insurance pricing as high-risk with logging and human-oversight obligations. Practical requirements synthesized from current guidance:
   - Log **every** LLM interaction: full prompt, model ID + version, tool calls and tool responses, final output, timestamps, acting user, and the engine job ID it interprets — chronological, tamper-evident, context-rich.
   - Logs must be **immutable and timestamped** with regulator-appropriate retention. In Convex: an append-only `auditLog` table (no update/delete mutations exposed), optionally hash-chained (each entry stores the previous entry's hash) for tamper evidence.
   - Record the **deterministic lineage separately**: engine version, chainladder version, input triangle file hash, method parameters — so any interpretation can be re-derived against the exact computation it described.
   - Keep a **human-in-the-loop gate** for anything that feeds a filed reserve figure: the LLM output is a draft interpretation an actuary reviews; log the review decision too.

_LLM boundary: tools return engine numbers; schema-constrained output; provenance check on every figure_
_Confidence: high on mechanics (official Gemini docs); medium on regulatory specifics — counsel/appointed-actuary review advised for the compliance posture_
_Source: https://ai.google.dev/gemini-api/docs/function-calling, https://ai.google.dev/gemini-api/docs/thought-signatures, https://ai.google.dev/gemini-api/docs/structured-output, https://latitude.so/blog/frameworks-ai-audit-trails-comparative-guide, https://kinro.ai/blog/ai-audit-trails-insurance-compliance-quality-guide, https://www.getmaxim.ai/articles/llm-guardrails-for-fintech-compliance-hallucination-prevention-and-audit-trails/_

### Data Formats and Protocol Summary

- **Frontend ↔ Convex**: Convex client protocol (WebSocket, reactive) — no REST layer to design.
- **Convex ↔ FastAPI**: HTTPS + JSON; Pydantic models define the engine contract (triangle payload, method params, results with per-method estimates and Mack std errors). Version the API (`/v1/`) from day one — the contract is an audit artifact.
- **Engine → Convex callbacks**: HTTPS POST to a Convex HTTP action with HMAC signature.
- **Convex/FastAPI ↔ Gemini**: official `google-genai` SDK; JSON Schema for tools and response schemas.
- **Triangles**: CSV upload → Convex file storage → passed to engine as JSON (cells + origin/development axes) rather than raw CSV, so validation happens once at the boundary.

_Source: https://docs.convex.dev/functions/http-actions, https://ai.google.dev/gemini-api/docs/function-calling_

## Architectural Patterns and Design

### System Architecture Patterns

**Recommended shape: three planes with a deterministic core.**

1. **Product plane (TypeScript)** — Next.js + Clerk + Convex. Owns identity, job lifecycle, reactive UI state, file storage, and the audit log. System of record.
2. **Computation & agent plane (Python)** — one deployable service (Cloud Run) hosting both the chainladder engine endpoints and the **Agno** agent runtime. Agno's **AgentOS is a pre-built FastAPI app**, so the agent layer and the engine share a framework and can share a container — agent tools call engine functions **in-process** (direct Python calls, not HTTP hops), which is faster and removes a network failure mode. Split into two services later only if scaling profiles diverge (confidence: high for starting unified; standard microservices guidance says don't split prematurely).
3. **Model plane** — Gemini API (`gemini-3.1-flash-lite`) reached only through Agno's model abstraction; Agno is model-agnostic across 30+ providers, so the model ID stays a config value, preserving the swap-up path if flash-lite proves too light.

This matches the dominant 2026 enterprise finding: ~80% of process steps belong in deterministic execution, ~20% in agent reasoning — reserving arithmetic is emphatically in the deterministic 80%, and the agent layer is a thin interpretive shell around it. For regulated processes, current guidance is explicit: use deterministic nodes/sequenced workflows, not high-autonomy agents.

_Source: https://www.agno.com/agentos, https://github.com/agno-agi/agent-api, https://vdf.ai/blog/agentic-design-patterns-practical-guide/, https://internative.net/insights/blog/agentic-ai-architecture-2026_

### Agno as the Agent Framework (mandated)

Verified current state (2026-07): open-source Python framework (formerly Phidata), 39k+ GitHub stars, active releases (v2.5.13, 2026-03-31). Capabilities relevant to this system:

- **Model-agnostic** with first-class Google Gemini support.
- **Structured I/O**: `input_schema`/`output_schema` (Pydantic) — agents can call tools to fetch data and still emit schema-conforming final output. This directly implements the "numbersUsed[] provenance" pattern from the integration analysis.
- **Tool calling lifecycle** managed by the framework (parallel execution, result handling) — and Agno's Gemini integration sits on the official SDK, absorbing the thought-signature handling.
- **Sessions & memory**: built-in session management and memory primitives. **Architectural decision:** keep Convex as the system of record for job/audit state; use Agno sessions (Postgres-backed in the standard agent-api setup) only for transient agent run state, or persist Agno state and mirror the audit-relevant slice to Convex. Do not let two databases both claim to be the audit source (confidence: medium — needs a deliberate ADR during architecture phase).
- **Human-in-the-loop**: native User Confirmation / User Input / External Tool Execution flows with `Agent.continue_run()` — a clean primitive for the actuary-review gate before any interpretation attaches to a filed figure.
- **Guardrails, observability, retries** built in; AgentOS runs containerized (Docker/K8s/Cloud Run) and scales to thousands of concurrent sessions.

_Trade-off note: 2026 surveys report LangGraph/AutoGen as the most common enterprise orchestrators; Agno is a credible, fast-growing alternative whose FastAPI-native runtime is an unusually good fit for this particular stack. The mandate is architecturally sound here._
_Source: https://www.agno.com/agent-framework, https://github.com/agno-agi/agno, https://docs.agno.com/basics/agents/running-agents, https://deepwiki.com/agno-agi/agno/3.6-tool-calling-and-function-execution, https://www.digitalocean.com/community/conceptual-articles/agno-fast-scalable-multi-agent-framework_

### Design Principles and Best Practices

- **Deterministic core, narrative shell**: every number originates in chainladder; the agent's tools are read-only views over engine output; the agent never receives a "compute" capability.
- **Tools are the largest failure surface** (2026 consensus): keep the agent's toolset small, typed (Pydantic), read-only, and individually risk-rated; layered guardrails = input validation → schema-constrained output → provenance check → human gate.
- **Simplest router that works**: method selection (CL vs BF vs Mack presentation) is UI/config logic, not agent reasoning.
- **Contract-first seams**: Pydantic models define engine and agent I/O; version them; contracts double as audit artifacts.
- **Job-record-first orchestration** (from integration analysis): all long-running work is a Convex document with reactive status.

_Source: https://www.augmentcode.com/guides/agentic-design-patterns, https://www.vellum.ai/blog/agentic-workflows-emerging-architectures-and-design-patterns_

### Scalability and Performance Patterns

- Convex and Cloud Run both scale to zero / scale horizontally; the Python service is stateless so instances are fungible.
- Cloud Run: single worker per instance, scale by instances; keep the container slim to minimize cold starts; chainladder runs on standard triangles are CPU-light (seconds), so the practical bottleneck is Gemini latency, not the engine — flash-lite is specifically optimized for low latency/high volume.
- Workpool bounds parallelism so a batch of reserving jobs can't stampede the engine or the Gemini quota.

_Source: https://davidmuraya.com/blog/fastapi-performance-tuning-on-google-cloud-run/, https://github.com/get-convex/workpool_

### Security Architecture Patterns

- **Identity**: Clerk JWTs validated by Convex (`ctx.auth`); user identity never client-asserted.
- **Service-to-service**: Convex → Python via bearer secret; Python → Convex callbacks via HMAC-signed HTTP actions; Gemini API key held only in the Python plane; all secrets in platform env stores.
- **Least-capability agent**: read-only tools; no tool can mutate reserves or the audit log; human-intervention triggers on flagged outputs (layered-guardrail pattern).
- **Tenancy/authorization**: every Convex query/mutation filters by the authenticated user/organization (Clerk organizations map naturally to insurer teams).

_Source: https://docs.convex.dev/auth/functions-auth, https://vdf.ai/blog/agentic-design-patterns-practical-guide/_

### Data Architecture Patterns

- Convex tables: `users`, `triangles` (file refs + metadata + content hash), `reservingJobs` (status machine), `results` (per-method estimates, Mack std errors), `interpretations` (agent output + provenance), `auditLog` (append-only, hash-chained).
- Deterministic lineage on every result: engine version, chainladder version, triangle hash, parameters — interpretation records reference the exact result they narrate.
- Agno session store (Postgres in the reference agent-api setup) holds only transient conversational state; audit-relevant events are mirrored into Convex `auditLog`.

_Source: https://github.com/agno-agi/agent-api, https://stack.convex.dev/background-job-management_

### Deployment and Operations Architecture

- **Frontend**: Vercel. **Convex**: managed. **Python (engine + Agno/AgentOS)**: one Docker image on Cloud Run; agent-api reference repo shows the FastAPI + Postgres layout.
- Environments: Convex dev/prod deployments pair with Clerk dev/prod instances and separate Cloud Run services; Gemini keys per environment.
- Observability: Agno built-in tracing/monitoring for agent runs; Cloud Run logging for the engine; Convex function logs for the product plane — correlate via the job ID carried through every layer.

_Source: https://www.agno.com/agentos, https://docs.cloud.google.com/run/docs/quickstarts/build-and-deploy/deploy-python-fastapi-service_

## Implementation Approaches and Technology Adoption

### Technology Adoption Strategies

Greenfield build — no migration burden. The adoption risk is sequencing, not legacy. Recommended incremental path:

1. **Engine first**: chainladder + FastAPI with golden-triangle tests (published triangles with known CL/BF/Mack answers, e.g. from the CAS literature). The deterministic core must be provably correct before anything narrates it.
2. **Product spine second**: Next.js + Clerk + Convex auth loop, file upload, job records, reactive status — end-to-end with a synchronous engine call.
3. **Durability third**: introduce workpool/workflow, callback pattern, idempotency keys.
4. **Agent layer last**: Agno agent with read-only tools over stored results, schema-constrained output, provenance check, human gate, audit logging. The LLM layer lands on a stable, tested substrate.

_Source: https://eforum.casact.org/article/123379-practitioners-guide-to-building-actuarial-reserving-workflows-using-chain-ladder-python_

### Development Workflows and Tooling

- **Monorepo** with `apps/web` (Next.js), `convex/`, and `services/engine` (Python: FastAPI + chainladder + Agno) keeps the cross-language contract visible in one PR.
- **Convex preview deployments**: temporary backend per feature branch (auto-created via `npx convex deploy` with a preview deploy key from Vercel/GitHub Actions; auto-cleaned after 5–14 days), pairable with Vercel preview URLs — reviewers exercise real backend changes without local checkout. Seed scripts populate preview data.
- **Python side**: uv/ruff/pytest as the 2026-standard toolchain; Pydantic models exported as JSON Schema so the TypeScript side can codegen types — one contract, two languages.

_Source: https://docs.convex.dev/production/hosting/preview-deployments, https://stack.convex.dev/seeding-data-for-preview-deployments, https://docs.convex.dev/production/hosting/vercel_

### Testing and Quality Assurance

- **Engine**: golden-triangle regression tests are the compliance anchor — assert exact reproduction of known published results per chainladder version; pin the chainladder version and re-run goldens on every bump.
- **Convex**: `convex-test` mocks the backend for fast unit tests of queries/mutations/actions in CI; Convex's own guidance — test core value-proposition logic, security, and "accounting" first, which for this app means job state machine, tenancy filters, and audit-log append-only invariants.
- **Agent**: Agno's built-in **Evaluation Framework** (accuracy/reliability/performance classes for Agents, Teams, Workflows) runs locally and in CI/CD to prevent regressions. Industry guidance: generic benchmarks mislead for agent apps — build evals from your own scenarios (real triangles + expected interpretation properties), and specifically assert the provenance invariant: *every numeral in output ∈ tool-response values*.
- **E2E**: Playwright against a preview deployment with a stubbed Gemini key for deterministic runs.

_Source: https://docs.convex.dev/testing, https://stack.convex.dev/testing-patterns, https://deepwiki.com/agno-agi/agno/8-evaluation-and-observability, https://www.braintrust.dev/articles/evaluate-agents-new-models-gemini-3_

### Deployment and Operations Practices

- One `npx convex deploy` command serves both preview and production paths; Vercel/GitHub Actions integration is documented and standard.
- Cloud Run deploys from source or Dockerfile; keep dev/prod Clerk instances, Convex deployments, Cloud Run services, and Gemini keys strictly paired per environment.
- Observability: correlate Convex function logs, Cloud Run logs, and Agno traces via the job ID; Agno ships native tracing plus third-party observability integrations.

_Source: https://docs.convex.dev/production, https://deepwiki.com/agno-agi/agno/8-evaluation-and-observability_

### Cost Optimization and Resource Management

Gemini economics for the interpretation layer (verified July 2026):

- `gemini-3.1-flash-lite`: $0.25/$1.50 per 1M tokens; free tier gives Flash-Lite 15 RPM / 1,000 RPD for development.
- **Batch API: 50% discount** with dedicated (separate) rate limits and up-to-24h turnaround — a natural fit for non-interactive bulk interpretation (e.g. quarterly re-runs across many triangles).
- **Context caching: up to ~90% off cached input** (with an hourly cache-storage charge) — worth it for a long, stable system prompt (actuarial glossary, interpretation instructions, output schema) reused across every interpretation; evaluate against actual prompt size since storage is billed hourly.
- Rate limits are tier-based and rise automatically with account tier; batch limits are separate from interactive limits.
- Infra costs are near-zero at low volume: Convex free/pro tier, Cloud Run scale-to-zero, Vercel hobby/pro.

_Source: https://ai.google.dev/gemini-api/docs/rate-limits, https://ai.google.dev/gemini-api/docs/pricing, https://findskill.ai/blog/gemini-api-pricing-guide/_

### Risk Assessment and Mitigation

| Risk | Severity | Mitigation |
|---|---|---|
| LLM emits an unsourced number despite tool constraints | High (regulatory) | Schema-forced `numbersUsed[]` + programmatic post-hoc provenance check + human gate; reject/flag violations |
| Thought-signature mishandling breaks tool loop | Medium | Use official `google-genai` SDK via Agno; integration test the multi-tool loop |
| Retry double-computes or double-records a job | Medium | Idempotent actions keyed by Convex job ID; engine dedupes |
| Two sources of truth (Agno sessions vs Convex) corrupt audit story | High (regulatory) | ADR: Convex is sole audit record; Agno state transient; mirror audit events |
| flash-lite too weak for nuanced actuarial narrative | Medium | Model ID as config; Agno model-agnostic — eval-driven upgrade path to Flash/Pro |
| chainladder version drift changes historical results | High (actuarial) | Pin versions; golden tests; store engine+package version in every result's lineage |
| Vendor lock-in (Convex proprietary) | Low-Medium | Accepted trade-off for reactivity + components; contracts at seams keep engine/agent portable |

## Technical Research Recommendations

### Implementation Roadmap

1. **Phase 1 — Deterministic engine** (chainladder + FastAPI + golden tests)
2. **Phase 2 — Product spine** (Clerk/Convex/Next.js auth, upload, jobs, reactive status; synchronous engine call)
3. **Phase 3 — Durable orchestration** (workflow/workpool, callbacks, idempotency, reconciliation)
4. **Phase 4 — Agno interpretation layer** (read-only tools, structured output, provenance gate, HITL review, audit log)
5. **Phase 5 — Hardening** (evals in CI, batch/caching cost optimization, compliance review of the audit posture)

### Technology Stack Recommendations (final)

| Layer | Choice | Confidence |
|---|---|---|
| Engine | Python 3.11+, chainladder, FastAPI, Pydantic | High |
| Agents | **Agno** (mandated; independently validated as fit) + AgentOS FastAPI runtime, same service as engine | High |
| LLM | Gemini `gemini-3.1-flash-lite` via `google-genai` under Agno; model ID configurable | High (medium on capability ceiling) |
| Frontend | Next.js App Router on Vercel | High |
| Auth | Clerk (JWT template → Convex) | High |
| Backend/data | Convex (DB, functions, file storage, workpool/workflow components) — system of record incl. audit log | High |
| Engine hosting | Docker on Google Cloud Run | High |

### Skill Development Requirements

- Convex mental model (reactivity, actions-vs-mutations, components) — the largest novelty for most teams
- Agno agent patterns (tools, output schemas, HITL, evals)
- chainladder/actuarial validation discipline (golden triangles, method assumptions)
- Gemini function-calling specifics (thought signatures, structured output)

### Success Metrics and KPIs

- 100% of engine results reproducible from stored lineage (version + hash + params)
- 0 interpretation numbers without tool provenance (hard gate)
- Agent eval suite green in CI; regression-blocked merges
- Job completion reliability ≥ 99.9% (retries included); p95 interpretation latency within UX budget
- Audit log passes append-only/hash-chain verification continuously

_Source: synthesis of all cited sources above_
