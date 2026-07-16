# Addendum — Reserving Copilot PRD

Depth that belongs in downstream documents (architecture, solution design, UX spec) but not in the PRD body. The brief's own addendum and the technical research report remain authoritative for their content; this file carries only what surfaced or was decided during PRD creation.

## Technology commitments (constraints inherited from the brief — architecture ratifies, does not relitigate)

- **Product plane:** Next.js (App Router) + Clerk (auth, organizations = Workspaces) + Convex (reactive backend, sole system of record including `auditLogs`).
- **Computation + agent plane:** stateless Python service — FastAPI + `chainladder` + Agno AgentOS — one Cloud Run container. Agno sessions hold transient state only.
- **Model plane:** Gemini `gemini-3.1-flash-lite` behind Agno's abstraction; model ID is config. The PRD invocation named "Claude" — logged as OQ-1; a provider swap is an eval-driven config change, not a rearchitecture.
- **Orchestration:** job-record-first; `@convex-dev/workflow`/`workpool` for durable execution; design for async 202 + HMAC-signed callback even if v1 awaits synchronously; idempotency keyed by Convex job ID (surfaces in FR-4's idempotency consequence).
- **Known traps (pre-identified):** Gemini 3.x thought signatures in tool loops (use official `google-genai` SDK); retry double-computation (idempotency); dual audit sources (Convex-as-sole-record ADR to be ratified before agent layer).
- **Build sequencing:** engine + golden tests first → product spine → durable orchestration → agent layer last → hardening.

## Engine and validation detail

- **Golden test corpus:** Taylor-Ashe (named in the PRD invocation as the minimum) plus published CAS benchmark triangles per the brief. Expected values: CL ultimates, Mack standard errors, BF with fixed a prioris. Tolerance policy (bit-for-bit vs documented epsilon) is an architecture decision — see PRD Assumptions Index.
- **ResultSet schema:** versioned; schema validation is a storage gate (FR-5). The schema itself is an architecture deliverable; the PRD only requires that it exists, is versioned, and gates storage.
- **Incurred monotonicity:** incurred triangles can legitimately decrease (case reserve releases), so the PRD scopes the monotonicity rule to cumulative paids and raises OQ-6 for actuarial confirmation of incurred rules.

## Provenance Gate mechanics (implementation sketch, not contract)

The gate operates on the structured Interpretation output: every quantitative claim node must carry ≥1 Diagnostic ID; the gate resolves each ID against the Run's Diagnostics and compares cited values to drafted values exactly. Failure modes: unresolvable ID, value mismatch, uncited number detected by pattern scan of the prose. Rejected drafts are logged (Audit Log) and retried up to a bounded count before failing into Engine-Only-style manual drafting. Retry bound and prose-scan strictness are architecture decisions.

## Word export

`.docx` generation happens in the Python plane or a dedicated export path — architecture to decide. Citation rendering choice (footnotes vs inline tags) deferred to UX. Only structural requirement in the PRD: full report content + readable citation references + audit-logged export events (FR-14).

## Rejected/alternative framings recorded during PRD creation

- **Single "user" role** rejected: the approval moment (senior actuary sign-off) is the product's credibility hinge, so the two-role model is v1-mandatory, not an enterprise nicety.
- **Warning-level validation** (accept triangle with missing cells, impute later) rejected for v1: imputation is a calculation, calculations belong to the engine, and a dirty boundary undermines the content-hash lineage story.
- **PDF export** considered and deferred: Word is what reserving teams actually edit and file; PDF adds a rendering pipeline without changing the v1 bar.
