---
stepsCompleted: [1, 2, 3, 4]
status: complete
generated: 2026-07-16
inputDocuments:
  - _bmad-output/planning-artifacts/prds/prd-agentic-reserving-2026-07-16/prd.md
  - _bmad-output/planning-artifacts/architecture/architecture-agentic-reserving-2026-07-16/ARCHITECTURE-SPINE.md
  - _bmad-output/planning-artifacts/ux-designs/ux-agentic-reserving-2026-07-16/DESIGN.md
  - _bmad-output/planning-artifacts/ux-designs/ux-agentic-reserving-2026-07-16/EXPERIENCE.md
  - _bmad-output/project-context.md
---

# agentic-reserving - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for agentic-reserving (Reserving Copilot), decomposing the requirements from the PRD, UX Design, and Architecture requirements into implementable stories.

## Requirements Inventory

### Functional Requirements

FR1: An Analyst can upload a Triangle as CSV or Excel (.xlsx) into their Workspace, labeled paid or incurred; parseable files are stored with a content hash, byte-identical re-uploads are surfaced as duplicates, unparseable files are rejected with a specific error.
FR2: The system validates every uploaded Triangle for rectangular/triangular shape, monotonically non-decreasing cumulative paid values per Origin Period (paid only), and missing cells — with cell-level error listings; no unvalidated Triangle can be referenced by a Run.
FR3: The system detects Origin/Development Period labels and granularity from the file and presents them for explicit user confirmation before acceptance; ambiguous layouts produce a guided prompt, never a silent guess.
FR4: An Analyst can start a Run selecting one or more Methods (CL, BF, Mack) against a validated Triangle; BF requires a complete set of A Priori Loss Ratios; Run status (queued/running/complete/failed) is visible live; retries are idempotent keyed by the Run's job ID.
FR5: Every completed Run produces a typed ResultSet (LDFs, ultimates, IBNR per Method per Origin Period, Mack standard errors and ranges) validated against a versioned schema before storage, carrying full Lineage (engine version, chainladder version, Triangle hash, all parameters).
FR6: Any historical ResultSet can be re-derived from its Lineage — exact equality for point estimates on the pinned platform, documented 1e-8 relative tolerance cross-platform.
FR7: The system computes for every completed Run: LDF stability by Development Period, actual-vs-expected on the Latest Diagonal, CL-vs-BF divergence by Origin Period (when both ran), and residual heatmap data — each element carrying a unique, stable, resolvable Diagnostic ID, stored as typed JSON.
FR8: An Analyst or Senior Actuary can review Diagnostics visually (stability charts, A-vs-E table, divergence bars, residual heatmap) before and independent of any Interpretation; all Diagnostics viewable in Engine-Only Mode; clicking a Diagnostic ID citation anywhere navigates to that Diagnostic's view.
FR9: The interpretation model accesses Run data exclusively through read-only tools returning the validated ResultSet and Diagnostics JSON; no write operations, no data beyond the Run; every tool call and result is audit-logged.
FR10: The interpretation layer produces exactly one per-Origin-Period Method recommendation with reasons, each citing ≥1 resolvable Diagnostic ID; a Senior Actuary can override any recommendation with a recorded reason landing in the Audit Log.
FR11: The interpretation layer drafts a Reserve Report (executive summary, method selection rationale, movement commentary, limitations) where every claim cites a Diagnostic ID; the Provenance Gate rejects drafts with unsourced or mismatched numbers; rejected drafts are never shown as reviewable.
FR12: When the interpretation model API is unavailable or errors persistently, the system degrades to Engine-Only Mode: all ingestion/engine/Diagnostics features remain functional, Interpretation features are disabled with clear signaling, a manual report template shell remains available, and mode transitions are audit-logged.
FR13: An Analyst can edit a draft Reserve Report; only a Senior Actuary can approve and publish; approval records approver identity, timestamp, and content version in the Audit Log; published reports are immutable (changes create a new version).
FR14: A user can export a published (or draft) Reserve Report to Word (.docx) preserving structure and Diagnostic ID citations as readable references; export events are audit-logged.
FR15: Every LLM interaction (full prompt, tool calls/results, response) and every consequential user/system event is persisted to the append-only, per-Workspace hash-chained `auditLogs` table, linked to Run and user; a verification routine detects tampering or gaps.
FR16: A Workspace member can view the Audit Log filtered by Run, user, event type, and time range, and follow links from any report claim to its Diagnostic, ResultSet, and originating Run — reaching Lineage in a bounded number of clicks.
FR17: Users authenticate via Clerk with email/password, SSO-ready; no application surface beyond sign-in/marketing renders without an authenticated session.
FR18: All data belongs to exactly one Workspace (Clerk organization); every Convex query/mutation enforces membership server-side; no cross-Workspace access, verified by test at the function layer.
FR19: Workspace members hold a role — Analyst or Senior Actuary — enforced server-side in Convex functions; role changes are audit-logged; role assignment is Clerk-managed (no in-app admin UI in v1).
FR20: The app guides users through the golden path (upload → Triangle → Run → Diagnostics → Report → Published) with clear state at each step; Run/Interpretation status propagates reactively via Convex subscriptions with no polling; state is server-held so users can leave and resume.

### NonFunctional Requirements

NFR1: Determinism + golden tests — the engine is deterministic and unit-tested against the Taylor-Ashe dataset (published CL ultimates, Mack standard errors, BF results); golden tests run in CI and a red golden test blocks release.
NFR2: Graceful degradation — interpretation-model unavailability never blocks the engine workflow; 100% of engine features functional during a model-API outage.
NFR3: No anonymous access — no Convex query or mutation is callable without a verified Clerk identity; enforced by a shared auth guard and verified by an automated test enumerating public functions.
NFR4: Reliability — job completion ≥ 99.9% including retries; retries are idempotent.
NFR5: Auditability — 100% of LLM interactions, tool calls, and human review decisions present in the Audit Log; append-only and hash-chain properties continuously verifiable.
NFR6: Reproducibility — 100% of stored ResultSets re-derivable from Lineage.
NFR7: Latency posture — engine Run ≤ 60s end-to-end p95 for Triangles ≤ 30 Origin Periods; Interpretation ≤ 10 min, hard-bounded by the per-Run token/cost ceiling (breach fails Interpretation cleanly, never queues silently).

### Additional Requirements

- No starter template specified; Epic 1 Story 1 must scaffold the repo per the architecture Structural Seed: `engine/` (one uv project: `reserving_engine/`, `engine_service/`, `copilot_agent/`, `tests/`), `convex/`, `app/`, `components/`.
- Layered three-plane system with strict downward dependencies: frontend → Convex → engine_service → reserving_engine; browser never calls engine_service; engine_service never calls Convex/Clerk (AD-2, AD-3, AD-12).
- `reserving_engine` is a pure functional core: no I/O, network, env, clock, or logging; plain data in, typed Pydantic models out; diagnostics computation lives here (AD-2).
- Convex is the sole system of record; engine_service is stateless between requests; agent state is transient (AD-3).
- Every public Convex function's first statement is `requireMember(ctx, workspaceId)`; approve/publish/override paths use `requireRole(ctx, workspaceId, "senior_actuary")`; roles from Clerk org roles in JWT (template `convex`), never duplicated in Convex tables (AD-4).
- Provenance Gate mechanics: agent drafts carry placeholders (`{{rs:<runId>:<method>:<origin>:<field>}}`, `{{dx:<diagnosticId>}}`), never figures; engine_service renders then runs the numeric-token checker under a canonicalization rule; failing drafts never persisted as reviewable; rejections audit-logged; gate governs machine-drafted content only, not human edits (AD-5).
- Exactly one internal mutation `appendAuditEntry` writes `auditLogs`; per-Workspace hash chain `hash = sha256(canonicalJSON(entry) + prevHash)`; verification query re-walks the chain (AD-6).
- Job-record-first orchestration: Convex `runs` record created before calling the engine; sole authority on status; Convex run ID is the idempotency key; `@convex-dev/workflow` for durability/retries; HTTP contract shaped for a future async 202+HMAC-callback upgrade (AD-7).
- Agent tools are read-only typed views over the current Run's ResultSet/DiagnosticsBundle in engine_service memory; provider-neutral JSON Schema; Gemini reached only through Agno over the official google-genai SDK (thought-signature handling) — never raw REST (AD-8).
- Engine-Only Mode is a derived server-side status; model outage or per-Run cost-ceiling breach fails Interpretation cleanly with an audit-logged mode transition (AD-9).
- ResultSet/DiagnosticsBundle are Pydantic models with `schemaVersion` exporting JSON Schema; CI check diffs Convex validators/TS types against it; Diagnostic ID format `dx:{runId}:{kind}:{key}`, kind ∈ {ldf_stability, ave, cl_bf_divergence, residual}, generated only by reserving_engine (AD-10).
- Dependencies pinned via uv.lock; CI and Cloud Run share linux/amd64; golden tests assert exact equality on the pinned platform (AD-11).
- Every engine_service endpoint requires the shared service bearer secret (Convex + Cloud Run env only); engine_service performs no user auth (AD-12).
- Two hashes never conflated: raw-file sha256 for duplicate detection; canonical-triangle-JSON sha256 as the Triangle hash in Lineage.
- Error envelope `{code, message, details?}`; validation errors carry cell-level `{origin, dev, reason}`; JSON boundaries; ISO-8601 UTC dates.
- Vocabulary: PRD §3 Glossary terms exactly, in code identifiers too; Python snake_case packages; Convex camelCase functions per table file; tables plural camelCase.
- Testing standards: pytest + Taylor-Ashe golden masters + Hypothesis property tests (triangle validation) in reserving_engine; convex-test + Vitest for every Convex function incl. auth-guard enumeration and append-only tests; one Playwright smoke of the authenticated golden path.
- Deployment: Vercel (Next.js), Convex cloud, one Cloud Run container for `engine/`; secrets GEMINI_API_KEY + service secret in Cloud Run only; Clerk keys in Vercel + Convex env.
- Build sequencing fixed by architecture: engine + golden tests first → product spine → durable orchestration → agent layer last → hardening.
- .docx export library choice deferred to the report epic (python-docx in engine_service vs TS lib in Convex action); either satisfies AD-1.
- Incurred-triangle validation rules pending actuarial confirmation (PRD OQ-6): monotonicity applies to paid only until resolved.

### UX Design Requirements

UX-DR1: Brand-layer theme on shadcn/ui + Tailwind: primary teal, provenance violet (exclusive to citations/provenance affordances), caution amber, published green, destructive default; light + dark values; radius 4/6/8px; `numeric`/`numeric-lg` Geist Mono roles for all engine figures and `display` role for page titles — implemented as design tokens, not ad-hoc styles.
UX-DR2: Citation chip component — provenance-subtle pill, Diagnostic ID content in numeric type; hover = full-violet fill + tooltip preview of cited value; click navigates to the Diagnostic; keyboard: tab-stop, Enter navigates, Space opens preview; announces as link with context.
UX-DR3: Status badge component with fixed vocabulary — draft, running (pulsing dot), complete, failed, awaiting review, published, engine-only — never restyled locally; color always paired with label text.
UX-DR4: Engine-Only Mode banner — full-bleed caution strip under the top bar, zero elevation, non-dismissable while the condition holds, with "what still works" link; entry announced via aria-live="assertive" once; entry/exit toasts once.
UX-DR5: Triangle grid component — dense read-only numeric grid, Geist Mono right-aligned cells, Latest Diagonal 2px primary left border, flagged cells in caution treatment with a findings list beneath (click finding → scroll/highlight cell); arrow-key navigation, Enter opens cell in context rail, proper table semantics with announced headers.
UX-DR6: Diagnostic heat cell — diverging blue↔amber ramp (never red↔green), value always printed in the cell; charts ship with an accessible table toggle.
UX-DR7: Step rail component — golden path `Upload → Triangle → Run → Diagnostics → Report → Published` across Run detail; current step primary, completed checkmarked and clickable, future steps disabled with prerequisite tooltip.
UX-DR8: Upload wizard (3 steps: File → Validation → Periods) with named-stage inline progress (never a bare spinner), cell-coordinate findings list with flagged grid preview, "Fix source and re-upload" as primary action on failure, and duplicate-hash surfacing with link to the existing Triangle.
UX-DR9: Run detail surface with tabs Results · Diagnostics · Interpretation · Report; live per-Method progress rows; failed Runs show destructive banner with engine error summary + idempotent "Retry run".
UX-DR10: Diagnostics review screen — four Diagnostic panels (LDF stability small multiples, A-vs-E table, CL-vs-BF divergence bars, residual heatmap), every element carrying its Diagnostic ID as hoverable anchor, deep-linkable (`/runs/{id}/diagnostics#<dxId>`); right context rail with selected element detail, values, "cited by N report claims" backlinks, and empty state.
UX-DR11: Recommendation table — one row per Origin Period: recommended Method, reasons with citation chips, status (accepted/overridden); Senior Actuary sees per-row Override action → dialog requiring a reason; recommendation and override render side by side, both attributed, history never erased.
UX-DR12: Report editor — section-structured (exec summary, method rationale, movement commentary, limitations); citation chips are atomic tokens (editable around, not inside); deleting a chip flags "claim now uncited" and blocks approval until resolved; draft locks read-only for the Analyst on submission for review.
UX-DR13: Approval bar — sticky bottom bar with citation-resolution count ("41 claims · 41 citations resolve"), diff-since-draft link, Approve & Publish (Senior Actuary only; green button is the only green action surface); Analysts see "Awaiting Senior Actuary review" + assign control; unresolved citations disable Approve with the failing sentence linked.
UX-DR14: Audit-generating confirmations (submit for review, override, approve) are explicit dialogs restating what will be recorded; no optimistic UI for audit-generating actions (confirm on server ack); approval dialog keyboard-operable, focus trapped, initial focus on Cancel.
UX-DR15: Provenance popover — every ResultSet figure offers "Where did this come from?" → Lineage popover (engine version, chainladder version, truncated copyable Triangle hash, parameters, link to the Run in the Audit Log).
UX-DR16: Interpretation drafting states — skeleton recommendation table + "Reading diagnostics…", no token streaming (gated-complete display only); quiet gate-retry status ("Draft failed provenance check — redrafting, attempt 2 of N"); AI panels carry the quiet header "Drafted by the interpretation layer · every claim cites a diagnostic".
UX-DR17: App shell + IA — persistent left sidebar (Dashboard, Triangles, Audit Log; icons on md, sheet on sm), avatar-menu Settings, ⌘K command palette for navigation only; flow surfaces single-column max-w-4xl, data surfaces max-w-screen-2xl; responsive: full experience ≥lg, context rail becomes bottom sheet on md, <md is read-and-approve only with "Best on a larger screen" fallbacks.
UX-DR18: State & permission patterns — role-gated controls render visible-but-disabled with tooltip ("Senior Actuary role required"); cross-Workspace renders nothing; empty Workspace dashboard CTA; published reports show Export to Word / View approval record / Start new version; Audit Log paginates (no infinite scroll); WCAG 2.2 AA floor with aria-live="polite" for live status.
UX-DR19: Voice & microcopy — precise, unhurried, never celebratory; numbers always carry unit and period; "recommends" reserved for the Interpretation layer; approval copy pattern "Approved by <name>, <date>, <time>. Logged."

### FR Coverage Map

FR1: Epic 3 — Triangle upload with content hash and duplicate detection
FR2: Epic 3 — Boundary validation (shape, paid monotonicity, missing cells) via engine validation core (built in Epic 2)
FR3: Epic 3 — Origin/Development Period detection and confirmation
FR4: Epic 4 — Run execution with Method selection, BF a prioris, live status, idempotent retries
FR5: Epic 2 (engine produces typed ResultSet + Lineage) / Epic 4 (schema-validated storage in Convex)
FR6: Epic 2 (deterministic re-derivation, golden tests) / Epic 4 (re-derive from stored Lineage)
FR7: Epic 2 (diagnostics computation + Diagnostic IDs) / Epic 4 (storage alongside ResultSet)
FR8: Epic 4 — Diagnostics review UI with deep-linkable Diagnostic IDs and context rail
FR9: Epic 5 — Read-only agent tool surface over ResultSet/DiagnosticsBundle
FR10: Epic 5 — Per-Origin-Period Method recommendation (override lands in Epic 6 with the review surface)
FR11: Epic 5 — Reserve Report drafting through the Provenance Gate
FR12: Epic 5 — Engine-Only Mode degradation (manual template shell completed in Epic 6)
FR13: Epic 6 — Report edit / approve / publish workflow with roles
FR14: Epic 6 — Word (.docx) export with citations as readable references
FR15: Epic 1 (auditLogs table, appendAuditEntry, hash chain, append-only tests) / all epics append their events / Epic 7 (chain verification surfaced)
FR16: Epic 7 — Audit Log browser with filters and claim → Diagnostic → Lineage navigation
FR17: Epic 1 — Clerk authentication, SSO-ready, no unauthenticated surfaces
FR18: Epic 1 — Workspace scoping with requireMember guard on every function
FR19: Epic 1 — Analyst / Senior Actuary roles via Clerk org roles, requireRole guard
FR20: Epic 4 (step rail, live status, resume) / Epic 7 (dashboard + golden-path smoke test)

NFR1: Epic 2 — Taylor-Ashe golden tests in CI, release-blocking
NFR2: Epic 5 — Engine-Only Mode; engine features unaffected by model outage
NFR3: Epic 1 — auth-guard enumeration test
NFR4: Epic 4 — @convex-dev/workflow durability, idempotent retries
NFR5: Epic 1 foundation / Epic 5 LLM transcript logging / Epic 7 verification
NFR6: Epic 2 / Epic 4 — reproducibility from Lineage
NFR7: Epic 4 (run latency budget) / Epic 5 (interpretation ceiling)

## Epic List

### Epic 1: Authenticated Workspace Foundation
A user can sign in via Clerk, land in their Workspace, and see the themed app shell — with the full security and audit substrate underneath: repo scaffold, Convex schema spine, `requireMember`/`requireRole` guards on every function, and the append-only hash-chained `auditLogs` primitive that every later epic writes to.
**FRs covered:** FR17, FR18, FR19, FR15 (foundation); NFR3, NFR5 (foundation)

### Epic 2: Deterministic Reserving Engine
The team (and any auditor) can trust every number: the pure `reserving_engine` computes CL, BF, and Mack with Diagnostics and full Lineage, golden-tested against Taylor-Ashe, exposed through the service-authenticated `engine_service`. Independently verifiable via CLI/tests before any UI exists.
**FRs covered:** FR5, FR6, FR7 (computation side); FR2 (validation core); NFR1, NFR6

### Epic 3: Triangle Ingestion
An Analyst can upload a paid or incurred Triangle through the wizard, get cell-level validation findings, confirm detected periods, and see it land immutable and content-hashed in the Triangle library.
**FRs covered:** FR1, FR2, FR3

### Epic 4: Runs, Results & Diagnostics Review
An Analyst can start a Run (CL/BF/Mack with a prioris), watch live status on the step rail, and review the ResultSet and all four Diagnostics — deep-linkable, ID-addressable, with Lineage provenance popovers — entirely without any AI involvement.
**FRs covered:** FR4, FR5, FR6, FR7 (storage/UI side), FR8, FR20 (core); NFR4, NFR7

### Epic 5: Agentic Interpretation
An Analyst can trigger Interpretation and receive a per-Origin-Period Method recommendation table and a drafted Reserve Report — every claim wearing a resolvable citation chip, every number rendered by the engine through the Provenance Gate, every LLM interaction audit-logged, and the whole layer failing closed into Engine-Only Mode.
**FRs covered:** FR9, FR10, FR11, FR12; NFR2, NFR5 (LLM logging), NFR7 (interpretation bound)

### Epic 6: Report Review, Approval & Export
An Analyst can edit the draft report (citations intact), a Senior Actuary can override recommendations with reasons, approve and publish (immutable, logged), and anyone can export to Word — the sign-off moment that the whole product exists for.
**FRs covered:** FR13, FR14, FR10 (override), FR12 (manual template shell)

### Epic 7: Audit Trail & Golden-Path Hardening
A reviewing actuary or auditor can walk the full trail — filterable Audit Log, claim → Diagnostic → ResultSet → Lineage in bounded clicks, hash-chain verification on demand — and the team gets the dashboard, review queue, and the Playwright golden-path smoke that proves the system end to end.
**FRs covered:** FR15 (verification), FR16, FR20 (dashboard/resume); NFR5 (verifiability)

## Epic 1: Authenticated Workspace Foundation

A user can sign in via Clerk, land in their Workspace, and see the themed app shell — with the full security and audit substrate underneath. Every later epic assumes these guards and the audit primitive exist.

### Story 1.1: Project Scaffold and Local Dev Environment

As a developer,
I want the repo scaffolded per the architecture Structural Seed with all three planes runnable locally,
So that every subsequent story starts from a working, correctly-shaped codebase.

**Acceptance Criteria:**

**Given** a fresh clone,
**When** the documented setup commands are run,
**Then** the repo contains `engine/` (one uv project with `reserving_engine/`, `engine_service/`, `copilot_agent/`, `tests/` packages), `convex/`, `app/` (Next.js 16.2.x App Router), and `components/` per the Structural Seed,
**And** `uv run pytest` passes (placeholder test), `npx convex dev` starts, and `next dev` renders a placeholder page,
**And** Python deps are pinned via `uv.lock` and Node deps via the lockfile per the architecture Stack table (chainladder 0.9.2, FastAPI 0.139.0, agno 2.x, @convex-dev/workflow 0.3.10).

**Given** the repo,
**When** CI runs,
**Then** a pipeline on linux/amd64 executes pytest and Vitest and fails the build on any red test (NFR-1 substrate, AD-11),
**And** no secret value appears anywhere in the repo (secrets are env-only per AD-12).

### Story 1.2: Clerk Sign-In and Protected App Shell

As an Analyst,
I want to sign in with email/password and land in an authenticated app shell,
So that no reserving surface is ever reachable anonymously. (FR-17)

**Acceptance Criteria:**

**Given** an unauthenticated visitor,
**When** they request any application route beyond sign-in/marketing,
**Then** they are redirected to the Clerk sign-in page and no application data renders (FR-17).

**Given** a user with valid credentials,
**When** they sign in,
**Then** they land in the app shell with a persistent left sidebar (Dashboard, Triangles, Audit Log entries as placeholders), avatar menu, and their active Workspace (Clerk organization) name visible (UX-DR17),
**And** the Clerk JWT template named `convex` is configured so Convex receives verified identity (AD-4),
**And** the integration is SSO-ready: enabling SAML/OIDC is a Clerk configuration change requiring no code rearchitecture.

### Story 1.3: Brand-Layer Design Tokens and Status Badge

As a developer,
I want the DESIGN.md brand layer implemented as tokens over shadcn/ui,
So that every later surface uses the same visual vocabulary instead of ad-hoc styles. (UX-DR1, UX-DR3)

**Acceptance Criteria:**

**Given** the Tailwind/shadcn theme configuration,
**When** tokens are inspected,
**Then** primary teal, provenance violet (+subtle), caution amber (+subtle), published green (+subtle) exist with light and dark values exactly per DESIGN.md, radius is 4/6/8px, and `numeric`/`numeric-lg` (Geist Mono) and `display` (Geist Sans 600 28px) type roles are available as utilities (UX-DR1).

**Given** the StatusBadge component,
**When** rendered with each vocabulary value (`draft`, `running`, `complete`, `failed`, `awaiting review`, `published`, `engine-only`),
**Then** each shows its specified color family paired with label text (never color alone), `running` shows a pulsing dot, and `published` uses the published-green family (UX-DR3),
**And** a Storybook page or `/dev/tokens` route demonstrates all tokens and badge states in light and dark for review.

### Story 1.4: Workspace Scoping and Role Guards

As a Workspace member,
I want every Convex function to enforce my Workspace membership and role server-side,
So that cross-tenant access and role bypass are impossible regardless of UI state. (FR-18, FR-19, NFR-3)

**Acceptance Criteria:**

**Given** the Convex codebase,
**When** any public query/mutation/action is defined,
**Then** its first statement is `requireMember(ctx, workspaceId)` verifying Clerk identity plus membership in the Clerk org that is the Workspace (AD-4),
**And** `requireRole(ctx, workspaceId, "senior_actuary")` exists for approve/publish/override paths, reading role slugs `analyst`/`senior_actuary` from Clerk org roles in the JWT with no role state duplicated into Convex tables.

**Given** the test suite,
**When** it runs,
**Then** an automated convex-test enumerates all public functions and asserts each rejects unauthenticated calls (NFR-3),
**And** a test proves a member of Workspace A cannot read or write Workspace B data at the function layer (FR-18),
**And** a member's role change (simulated via Clerk webhook/JWT change) is recorded to the Audit Log once Story 1.5 lands — until then, the event emission point exists with a TODO-free interface stub (FR-19).

### Story 1.5: Append-Only Hash-Chained Audit Log Primitive

As a reviewing actuary,
I want every consequential event recorded in an append-only, tamper-evident log,
So that the audit trail is trustworthy from the first event onward. (FR-15 foundation, NFR-5)

**Acceptance Criteria:**

**Given** the Convex schema,
**When** `auditLogs` is defined,
**Then** exactly one internal mutation `appendAuditEntry` writes to it, entries carry `workspaceId`, optional `runId`, actor, event type, ISO-8601 UTC timestamp, and payload, and each entry's `hash = sha256(canonicalJSON(entry) + prevHash)` chains per Workspace (AD-6),
**And** concurrent appends serialize correctly under Convex OCC (retry on conflict, verified by test).

**Given** the test suite,
**When** it runs,
**Then** a convex-test asserts no code path updates or deletes an audit row (append-only, FR-15),
**And** a verification query re-walks a Workspace's chain and returns valid for an intact chain and the first broken link for a tampered fixture,
**And** sign-in-driven events available at this point (e.g. member role change) are appended through `appendAuditEntry`.

## Epic 2: Deterministic Reserving Engine

The pure `reserving_engine` computes CL, BF, and Mack with Diagnostics and full Lineage, golden-tested against Taylor-Ashe, exposed through the service-authenticated `engine_service`. Verifiable via tests before any UI exists. Build order per architecture: engine + golden tests first.

### Story 2.1: Triangle Model and Validation Core

As an actuary,
I want triangles validated deterministically at the boundary with cell-level findings,
So that no malformed data ever reaches a Method. (FR-2 core)

**Acceptance Criteria:**

**Given** `reserving_engine`,
**When** the Triangle Pydantic model and `validate_triangle` are implemented,
**Then** validation detects non-rectangular/triangular shape, decreasing cumulative paid values along an Origin Period (paid triangles only, per PRD OQ-6), and missing cells inside the observed region, returning a typed validation report with cell-level `{origin, dev, reason}` entries — never a generic failure,
**And** the module performs no file, network, environment, clock, or logging side effects (AD-2), verified by review and an import-linter or equivalent check.

**Given** the test suite,
**When** Hypothesis property tests run,
**Then** generated valid triangles always pass and generated violations (shape, paid monotonicity, missing cells) are always detected with correct coordinates,
**And** a canonical-triangle-JSON sha256 function exists and is deterministic across runs — this hash, distinct from any raw-file hash, is *the* Triangle hash for Lineage.

### Story 2.2: Chain Ladder with ResultSet, Lineage, and Golden Test

As an actuary,
I want Chain Ladder computed with a typed ResultSet and full Lineage, proven against Taylor-Ashe,
So that the engine's numbers are demonstrably correct and reproducible. (FR-5, FR-6, NFR-1)

**Acceptance Criteria:**

**Given** a validated Triangle,
**When** `run_methods` executes Chain Ladder via chainladder 0.9.2,
**Then** it returns a ResultSet Pydantic model with `schemaVersion`, LDFs, ultimates, and IBNR per Origin Period, plus Lineage (engine semver, chainladder version, canonical Triangle hash, all parameters) (FR-5, AD-10, AD-11),
**And** the function is pure: identical inputs produce identical outputs, no I/O (AD-2).

**Given** the Taylor-Ashe dataset,
**When** the pytest golden test runs on the pinned CI platform (linux/amd64),
**Then** CL ultimates match published values with exact equality for point estimates, and the golden test is wired to block release when red (NFR-1),
**And** a re-derivation test replays a stored Lineage and reproduces the ResultSet exactly (FR-6, NFR-6).

### Story 2.3: Bornhuetter-Ferguson and Mack Methods

As an actuary,
I want BF (with per-Origin-Period A Priori Loss Ratios) and Mack (with standard errors) alongside CL,
So that all three v1 Methods are available from one engine call. (FR-5, NFR-1)

**Acceptance Criteria:**

**Given** a validated Triangle and a complete set of A Priori Loss Ratios,
**When** BF runs,
**Then** the ResultSet includes BF ultimates and IBNR per Origin Period with the a prioris recorded in Lineage,
**And** BF invocation without a complete a-priori set raises a typed error naming the missing Origin Periods (FR-4 consequence, enforced at the engine boundary too).

**Given** the same Triangle,
**When** Mack runs,
**Then** the ResultSet includes Mack standard errors and reserve ranges per Origin Period,
**And** Taylor-Ashe golden tests assert published Mack standard errors and BF results at exact equality on the pinned platform (NFR-1),
**And** any Method combination (subset of {CL, BF, Mack}) runs in one call producing one ResultSet.

### Story 2.4: Diagnostics Computation with Diagnostic IDs

As an actuary,
I want the four Diagnostics computed by the pure engine with stable, addressable IDs,
So that every later interpretation claim has something citable to point at. (FR-7)

**Acceptance Criteria:**

**Given** a completed Method computation,
**When** diagnostics are derived in `reserving_engine.diagnostics`,
**Then** the DiagnosticsBundle (Pydantic, `schemaVersion`) contains: LDF stability by Development Period, actual-vs-expected on the Latest Diagonal, CL-vs-BF divergence by Origin Period (only when both Methods ran), and residual heatmap data,
**And** every element carries a Diagnostic ID `dx:{runId}:{kind}:{key}` with `kind ∈ {ldf_stability, ave, cl_bf_divergence, residual}` and `key` the origin/development coordinate, generated only here (AD-10),
**And** each Diagnostic ID resolves back to its underlying values via a lookup function.

**Given** the test suite,
**When** it runs,
**Then** diagnostics for the Taylor-Ashe run match golden fixtures, IDs are unique and stable across identical runs, and CL-vs-BF divergence is absent (not empty-but-present) when BF did not run.

### Story 2.5: engine_service FastAPI Shell with Service Auth

As the Convex backend,
I want authenticated HTTP endpoints for validation and runs, idempotent by run ID,
So that the product plane can drive the engine without ever touching engine internals. (FR-4 consequence, AD-7, AD-12)

**Acceptance Criteria:**

**Given** engine_service,
**When** any endpoint is called without the shared service bearer secret,
**Then** it returns 401 with error envelope `{code, message, details?}` — engine_service performs no user auth and trusts the caller's authorized context (AD-12).

**Given** authenticated calls,
**When** `POST /validate` and `POST /runs` are invoked with plain JSON,
**Then** they delegate to `reserving_engine` and return the typed validation report or `{resultSet, diagnosticsBundle}` as JSON, with the Convex run ID accepted as idempotency key so an identical retried request returns an identical response without recomputation side effects (AD-7),
**And** the service holds no state between requests (AD-3), and the response contract is shaped so a future async `202 + HMAC callback` upgrade is additive,
**And** FastAPI tests cover auth rejection, happy path, validation failure passthrough (cell-level errors intact), and idempotent retry.

### Story 2.6: Cross-Runtime Schema Contract and CI Drift Check

As a developer on either runtime,
I want the ResultSet/DiagnosticsBundle JSON Schema single-sourced from Pydantic and drift-checked in CI,
So that Python and TypeScript can never silently disagree on the shapes both parse. (AD-10)

**Acceptance Criteria:**

**Given** the Pydantic models,
**When** the schema export script runs,
**Then** versioned JSON Schema files for ResultSet and DiagnosticsBundle are emitted to a checked-in location,
**And** Convex validators and TS types for these shapes exist (or are generated) from that schema.

**Given** CI,
**When** the contract check runs,
**Then** it diffs the exported JSON Schema against the Convex validators/TS types and fails on mismatch (AD-10),
**And** a deliberate fixture mismatch demonstrably fails the check.

## Epic 3: Triangle Ingestion

An Analyst uploads a paid or incurred Triangle through the wizard, gets cell-level validation findings, confirms detected periods, and sees it land immutable and content-hashed in the Triangle library.

### Story 3.1: Triangle Upload with Duplicate Detection

As an Analyst,
I want to upload a CSV or Excel Triangle into my Workspace, labeled paid or incurred,
So that the quarter's data enters the system exactly once. (FR-1)

**Acceptance Criteria:**

**Given** an authenticated Analyst,
**When** they upload a `.csv` or `.xlsx` file labeled paid or incurred,
**Then** the file is stored via Convex file storage under a new `triangles` document scoped to the Workspace with status `pending_validation`, its raw-file sha256 recorded, and the upload appended to the Audit Log (FR-1, FR-15),
**And** the Triangles library page lists the Workspace's Triangles with label, status badge, and hash.

**Given** a byte-identical file already in the Workspace,
**When** it is uploaded again,
**Then** the UI shows "Identical triangle already exists (hash match)" with a link to the existing Triangle — no silent dedupe, no second stored copy (UX-DR8),
**And** an unparseable file is rejected with a specific error naming the failure, not a generic message,
**And** convex-test covers the mutation paths including guard enforcement and cross-Workspace invisibility.

### Story 3.2: Upload Wizard Validation with Flagged Grid Preview

As an Analyst,
I want validation findings shown per cell on a grid preview with named progress stages,
So that I can fix the source file precisely and re-upload clean. (FR-2, UX-DR5, UX-DR8)

**Acceptance Criteria:**

**Given** an uploaded file,
**When** the wizard's validation step runs (Convex action → engine_service `/validate`),
**Then** inline progress shows named stages ("Parsing… Validating shape… Checking monotonicity…") — never a bare spinner (UX-DR8),
**And** the read-only Triangle grid preview renders in `numeric` type, right-aligned, with flagged cells in the caution treatment and a findings list beneath giving Origin/Development coordinates and reasons; clicking a finding scrolls to and highlights the cell (UX-DR5).

**Given** validation failures,
**When** findings render,
**Then** the primary action is "Fix source and re-upload" — no in-app repair exists (PRD §6.2), the Triangle stays unaccepted and unreferencable by any Run (FR-2), and the validation result is audit-logged,
**And** monotonicity findings appear for paid triangles only,
**And** a clean pass shows "0 issues" with the content hash and advances to the periods step.

### Story 3.3: Period Confirmation and Triangle Acceptance

As an Analyst,
I want detected Origin/Development Periods presented for my explicit confirmation,
So that the system never silently guesses my triangle's structure. (FR-3)

**Acceptance Criteria:**

**Given** a triangle that passed validation,
**When** the periods step renders,
**Then** detected Origin Period labels/granularity and Development Period ages are shown and editable, and acceptance requires explicit confirmation (FR-3),
**And** an ambiguous layout (e.g. undetectable orientation) produces a guided prompt asking the user to resolve it — never a silent guess.

**Given** confirmation,
**When** the Analyst accepts,
**Then** the Triangle becomes immutable with status `validated`, its canonical-triangle-JSON sha256 recorded as the Lineage Triangle hash (distinct from the raw-file hash), acceptance is audit-logged, and the Triangle detail page shows the grid with Latest Diagonal edge-marking (UX-DR5),
**And** convex-test verifies no mutation can alter an accepted Triangle's content.

## Epic 4: Runs, Results & Diagnostics Review

An Analyst starts a Run, watches live status on the step rail, and reviews the ResultSet and all four Diagnostics — deep-linkable, ID-addressable, with Lineage provenance popovers — entirely without any AI involvement.

### Story 4.1: Run Configuration with A Priori Grid

As an Analyst,
I want to configure a Run selecting Methods and entering BF a prioris,
So that I can start exactly the computation the review needs. (FR-4)

**Acceptance Criteria:**

**Given** a validated Triangle,
**When** the Analyst opens "Run methods",
**Then** they can select any subset of {CL, BF, Mack}; selecting BF opens an a-priori grid with one Geist-Mono input per Origin Period supporting pasted columns,
**And** the start button stays disabled until every Origin Period has an A Priori Loss Ratio when BF is selected (FR-4).

**Given** a start,
**When** the mutation executes,
**Then** a `runs` document is created first with status `queued`, carrying Triangle reference, selected Methods, and parameters — the record is the sole authority on status (AD-7),
**And** run creation is audit-logged, and convex-test covers guard enforcement, BF gating, and job-record-first ordering.

### Story 4.2: Durable Run Orchestration and ResultSet Persistence

As an Analyst,
I want Runs executed durably with idempotent retries and schema-validated results,
So that a transient failure never costs me the quarter or produces divergent numbers. (FR-4, FR-5, NFR-4)

**Acceptance Criteria:**

**Given** a queued Run,
**When** the `@convex-dev/workflow` orchestration executes,
**Then** it calls engine_service with the Convex run ID as idempotency key, transitions status `queued → running → complete|failed` on the runs record only via this path (AD-7),
**And** the returned ResultSet and DiagnosticsBundle are validated against the shared schema before storage; a schema-invalid ResultSet is never stored and the Run is marked `failed` with the validation error (FR-5, AD-10).

**Given** a retry after transient failure,
**When** the workflow re-invokes the engine,
**Then** the stored outcome is identical with no duplicate work or second ResultSet (NFR-4),
**And** run lifecycle events land in the Audit Log, and a p95 end-to-end budget of ≤ 60s for Triangles ≤ 30 Origin Periods is asserted in a test or documented measurement (NFR-7).

### Story 4.3: Run Detail with Step Rail and Live Status

As an Analyst,
I want a Run detail surface with the golden-path step rail and live status,
So that I always know where the quarter stands without refreshing. (FR-20, UX-DR7, UX-DR9)

**Acceptance Criteria:**

**Given** a Run,
**When** its detail page renders,
**Then** the step rail `Upload → Triangle → Run → Diagnostics → Report → Published` shows current step in primary, completed steps checkmarked and clickable, and future steps disabled with a prerequisite tooltip (UX-DR7),
**And** tabs Results · Diagnostics · Interpretation · Report exist (later tabs may show locked/empty states) (UX-DR9).

**Given** a running Run,
**When** status changes server-side,
**Then** per-Method progress rows and the status badge update via Convex subscription with no polling in application code (FR-20), announced via `aria-live="polite"`,
**And** a failed Run shows a destructive banner with the engine error summary and an idempotent "Retry run" action (UX-DR9),
**And** leaving and returning mid-Run resumes the exact server-held state (FR-20).

### Story 4.4: Results Tab with Provenance Popover

As an Analyst,
I want the ResultSet rendered in the triangle-grid texture with lineage on every figure,
So that every number on screen declares where it came from. (FR-5 display, UX-DR15)

**Acceptance Criteria:**

**Given** a complete Run,
**When** the Results tab renders,
**Then** ultimates, IBNR, and LDFs per Method per Origin Period (and Mack standard errors/ranges) display in `numeric` type with display-formatting only — no arithmetic in React (AD-1),
**And** every figure offers a "Where did this come from?" provenance popover showing engine version, chainladder version, truncated copyable Triangle hash, parameters, and a link toward the Run's audit trail (UX-DR15).

**Given** the rendered tab,
**When** inspected,
**Then** all figures are values from the stored ResultSet verbatim (no client-side totals or deltas), and numbers in copy carry unit and period per the voice rules (UX-DR19).

### Story 4.5: Diagnostics Review Panels

As an Analyst,
I want the four Diagnostics rendered visually with values printed and accessible alternatives,
So that I can form my own view before any Interpretation exists. (FR-8, UX-DR6, UX-DR10)

**Acceptance Criteria:**

**Given** a complete Run,
**When** the Diagnostics tab renders,
**Then** four panels appear: LDF stability small-multiple charts by Development Period, actual-vs-expected latest-diagonal table with mono-printed deviations, CL-vs-BF divergence bars per Origin Period (only when both ran), and the residual heatmap using a diverging blue↔amber ramp with the value always printed in each cell (UX-DR6),
**And** every element carries its Diagnostic ID as a hoverable anchor, and charts offer an accessible table toggle showing the same data (UX-DR10, WCAG floor).

**Given** Engine-Only Mode (simulated),
**When** the tab renders,
**Then** all Diagnostics remain fully viewable (FR-8, NFR-2).

### Story 4.6: Diagnostic Context Rail and Deep Linking

As an Analyst,
I want to select any diagnostic element into a context rail and share deep links to it,
So that diagnostics have identities I can cite and send to colleagues. (FR-8, UX-DR10)

**Acceptance Criteria:**

**Given** the Diagnostics tab,
**When** an element is clicked (or reached by arrow keys and Enter),
**Then** the right context rail fills with its values, Diagnostic ID, and a "cited by N report claims" backlink section (empty until Interpretation exists); empty state reads "Select any diagnostic element" (UX-DR10),
**And** `Esc` returns focus to the grid, and grids expose proper table semantics with announced headers.

**Given** a URL `/runs/{id}/diagnostics#<diagnosticId>`,
**When** opened,
**Then** the page scrolls to and highlights that element with the context rail populated — the navigation target that citation chips will use product-wide (FR-8),
**And** on `md` viewports the context rail becomes a bottom sheet (UX-DR17).

### Story 4.7: ResultSet Re-Derivation from Lineage

As a Senior Actuary,
I want to re-derive any stored ResultSet from its Lineage on demand,
So that I can prove reproducibility to an auditor months later. (FR-6, NFR-6)

**Acceptance Criteria:**

**Given** a stored ResultSet,
**When** "Re-derive" is triggered from the Run detail,
**Then** the engine re-executes with the stored Triangle (verified by canonical hash) and parameters, and the app reports exact match for point estimates on the pinned platform — or a discrepancy report if not (FR-6, AD-11),
**And** the re-derivation event and outcome are audit-logged.

**Given** a tampered fixture (altered stored ResultSet in test),
**When** re-derivation runs,
**Then** the mismatch is detected and surfaced, verified by convex-test/pytest at the appropriate layers.

## Epic 5: Agentic Interpretation

An Analyst triggers Interpretation and receives a recommendation table and drafted Reserve Report — every claim citing a resolvable Diagnostic ID, every number rendered by the engine through the Provenance Gate, every LLM interaction audit-logged, and the layer failing closed into Engine-Only Mode.

### Story 5.1: copilot_agent with Read-Only Tools

As the product,
I want an Agno-hosted Gemini agent whose only data access is read-only typed views over the current Run,
So that the interpretation layer is structurally incapable of touching anything else. (FR-9)

**Acceptance Criteria:**

**Given** `copilot_agent`,
**When** it is constructed for an interpretation request,
**Then** it uses Agno's model abstraction over the official `google-genai` SDK with model ID `gemini-3.1-flash-lite` read from engine_service config — never raw REST (AD-8, thought-signature handling),
**And** its tool surface exposes only read-only, provider-neutral JSON Schema views over the request's in-memory ResultSet and DiagnosticsBundle (list diagnostics, get diagnostic by ID, get result fields, get run metadata) — no filesystem, network, Convex, or write operations (FR-9).

**Given** an agent session,
**When** it completes,
**Then** the full transcript (prompt, every tool call and result, response) is captured and returned to the caller for audit logging — no durable state remains in Agno sessions (AD-3),
**And** pytest verifies tool read-onlyness (no mutating call exists) and transcript completeness on a stubbed model.

### Story 5.2: Provenance Gate — Placeholder Rendering and Numeric Checker

As a Senior Actuary,
I want a programmatic gate that renders engine values into drafts and rejects any unsourced number,
So that no machine-drafted figure can ever reach a reviewer unverified. (FR-11 gate, AD-5)

**Acceptance Criteria:**

**Given** a machine draft containing placeholders,
**When** the gate renders it,
**Then** `{{rs:<runId>:<method>:<origin>:<field>}}` tokens resolve from the ResultSet and `{{dx:<diagnosticId>}}` tokens resolve to citation references; any unresolvable placeholder fails the gate,
**And** the numeric-token checker verifies every numeric token in the rendered output matches a source value under a documented canonicalization rule (rounding/formatting), with a whitelist for structural numerals (headings, dates) (AD-5).

**Given** a failing draft,
**When** the gate rejects it,
**Then** the draft is never persisted as reviewable, the rejection with reasons is audit-logged, and the caller receives a typed rejection enabling a bounded redraft loop (FR-11),
**And** pytest covers: clean pass, literal-number smuggling (LLM emitting a figure directly), placeholder pointing at the wrong field, mismatched rounding, uncited quantitative claim, and whitelist correctness.

### Story 5.3: Method Recommendations Through the Gate

As an Analyst,
I want a per-Origin-Period Method recommendation with reasons citing Diagnostic IDs,
So that the layer's judgment is pinned to evidence I can inspect. (FR-10)

**Acceptance Criteria:**

**Given** a complete Run with Diagnostics,
**When** the agent generates recommendations,
**Then** every Origin Period in the Run receives exactly one recommended Method with ≥1 reason, each reason citing ≥1 Diagnostic ID resolvable against this Run, validated programmatically before output is accepted (FR-10),
**And** an output missing an Origin Period, doubling one, or citing an unresolvable ID is rejected and retried within the bounded loop; persistent failure surfaces as a failed Interpretation, never partial output.

**Given** the accepted output,
**When** it is returned to Convex,
**Then** it persists as a typed recommendations document linked to the Run, with the full LLM transcript appended to the Audit Log (FR-9, FR-15).

### Story 5.4: Reserve Report Drafting Through the Gate

As an Analyst,
I want a drafted Reserve Report whose every claim is cited and every figure engine-rendered,
So that my starting draft is already audit-grade. (FR-11)

**Acceptance Criteria:**

**Given** accepted recommendations,
**When** the agent drafts the report,
**Then** the draft contains the four sections — executive summary, method selection rationale, movement commentary, limitations — with figures only as `{{rs:...}}` placeholders and claims citing `{{dx:...}}` chips, rendered and verified by the gate before persistence (FR-11, AD-5),
**And** a draft failing the gate is redrafted within the bounded attempt limit; exhaustion fails the Interpretation cleanly.

**Given** a gated-passing draft,
**When** persisted,
**Then** it is stored as a Reserve Report draft linked to the Run with machine-drafted provenance marked, the drafting transcript audit-logged, and Interpretation completion within the ≤10-minute bound (NFR-7) or a clean failure — never a silent queue.

### Story 5.5: Interpretation Tab with Recommendation Table and Citation Chips

As an Analyst,
I want to trigger Interpretation and review the recommendation table with working citation chips,
So that the reasoning is transparent and navigable, not a black box. (FR-10 UI, UX-DR2, UX-DR11, UX-DR16)

**Acceptance Criteria:**

**Given** a complete Run,
**When** the Analyst clicks "Generate interpretation",
**Then** the Interpretation tab shows a skeleton recommendation table with "Reading diagnostics…" (no token streaming; output appears complete after the gate passes), and gate retries show the quiet status "Draft failed provenance check — redrafting (attempt N of M)" (UX-DR16),
**And** the panel carries the header "Drafted by the interpretation layer · every claim cites a diagnostic".

**Given** accepted output,
**When** the table renders,
**Then** each Origin Period row shows the recommended Method and reasons trailing CitationChip components — provenance-subtle pill, Diagnostic ID in numeric type; hover fills violet with a tooltip preview of the cited value; click navigates to `/runs/{id}/diagnostics#<dxId>`; chips are tab-stops where Enter navigates and Space previews, announced as links with context (UX-DR2),
**And** the Diagnostics context rail "cited by N report claims" backlinks now populate (completing Story 4.6's contract),
**And** interpretation status updates arrive via subscription, and triggering/completion/failure events are audit-logged.

### Story 5.6: Engine-Only Mode Fail-Closed Degradation

As an Analyst,
I want the app to degrade cleanly when the model is unavailable or the cost ceiling is hit,
So that an AI outage never blocks the quarter. (FR-12, NFR-2)

**Acceptance Criteria:**

**Given** persistent model-API failure or a per-Run token/cost ceiling breach (ceiling values from engine_service config),
**When** an Interpretation attempt fails,
**Then** the Interpretation is marked failed cleanly on the run record, Engine-Only Mode is derived server-side (never a client-side guess), and the mode transition is audit-logged (AD-9, FR-12).

**Given** Engine-Only Mode,
**When** any surface renders,
**Then** the full-bleed caution banner shows "Engine-Only Mode — interpretation unavailable" with a "what still works" link, non-dismissable while the condition holds, announced `aria-live="assertive"` once with entry/exit toasts once (UX-DR4),
**And** Interpretation actions are disabled with tooltips while upload → Run → Diagnostics remain fully functional (verified by test) (NFR-2),
**And** exiting the condition restores Interpretation and audit-logs the exit.

## Epic 6: Report Review, Approval & Export

An Analyst edits the draft report with citations intact, a Senior Actuary overrides recommendations with reasons, approves and publishes (immutable, logged), and anyone can export to Word.

### Story 6.1: Report Editor with Atomic Citation Chips and Manual Template

As an Analyst,
I want to edit the draft report with citations as atomic tokens — or start from a manual template when Interpretation is down,
So that human judgment shapes the report without breaking its evidence trail. (FR-13 edit, FR-12, UX-DR12)

**Acceptance Criteria:**

**Given** a draft Reserve Report,
**When** the Analyst edits in the section-structured editor (exec summary, method rationale, movement commentary, limitations),
**Then** citation chips are atomic — editable around, never inside — and deleting a chip flags the sentence "claim now uncited", tracked as a blocker for approval (UX-DR12),
**And** edits save via Convex mutations, are audit-logged with actor and content version, and human edits are not re-run through the Provenance Gate (AD-5 scope boundary).

**Given** Engine-Only Mode (or no Interpretation),
**When** the Analyst opens the Report tab,
**Then** they can create a Reserve Report shell from the manual template with the same four sections for hand drafting (FR-12),
**And** convex-test covers edit permissions (Analyst can edit drafts, no one edits published) and audit entries.

### Story 6.2: Submit for Review with Draft Lock

As an Analyst,
I want to submit a draft for review and assign a Senior Actuary,
So that the hand-off moment is explicit and race-free. (FR-13, UX-DR13)

**Acceptance Criteria:**

**Given** a draft report,
**When** the Analyst submits for review via an explicit dialog restating what will be recorded,
**Then** status becomes `awaiting review`, the draft locks read-only for the Analyst, the assignment appears in the assignee's review queue, and the submission is audit-logged (UX-DR14),
**And** the Analyst's approval bar shows "Awaiting Senior Actuary review" with the assign control (UX-DR13).

**Given** the submission action,
**When** the server processes it,
**Then** no optimistic UI is used — the state flips only on server acknowledgment,
**And** convex-test verifies the lock (Analyst edit attempts rejected server-side) and queue visibility rules.

### Story 6.3: Recommendation Override by Senior Actuary

As a Senior Actuary,
I want to override any Method recommendation with a recorded reason,
So that my professional judgment is first-class and traceable. (FR-10 override, UX-DR11)

**Acceptance Criteria:**

**Given** the recommendation table,
**When** a Senior Actuary clicks Override on a row,
**Then** a dialog requires choosing the overriding Method and entering a reason before confirming, restating that the override will be logged (UX-DR14),
**And** the server enforces `requireRole(..., "senior_actuary")` — an Analyst's override attempt is rejected server-side and the control renders visible-but-disabled with tooltip for Analysts (UX-DR18).

**Given** a confirmed override,
**When** the table re-renders,
**Then** recommendation and override display side by side, both attributed, citations intact, history never erased (UX-DR11),
**And** the override with reason, actor, and timestamp lands in the Audit Log (FR-10).

### Story 6.4: Approve and Publish

As a Senior Actuary,
I want to approve and publish a report through an explicit, fully-logged sign-off,
So that the approval moment carries the weight my signature does. (FR-13, UX-DR13, UX-DR14)

**Acceptance Criteria:**

**Given** a report awaiting review,
**When** the approval bar renders for a Senior Actuary,
**Then** it shows the citation-resolution count ("41 claims · 41 citations resolve"), a diff-since-draft link, and Approve & Publish — disabled with the failing sentence linked if any citation fails to resolve (UX-DR13),
**And** the approval dialog restates version, citation count, any overrides, and "This will be logged and the published version cannot be edited", keyboard-operable with focus trapped and initial focus on Cancel (UX-DR14).

**Given** confirmation,
**When** publish executes,
**Then** approver identity, timestamp, and the exact approved content version are audit-logged, the report becomes immutable with the `published` badge, and post-publication changes require "Start new version" creating a new draft superseding record (FR-13),
**And** confirmation is on server ack only, and convex-test verifies: Analyst publish rejection, immutability of published content, unresolved-citation blocking, and the approval audit entry.

### Story 6.5: Word Export

As a user,
I want to export a report to Word with citations as readable references,
So that the appointed actuary's file gets a standard, traceable document. (FR-14)

**Acceptance Criteria:**

**Given** a published or draft report,
**When** "Export to Word" is triggered,
**Then** a `.docx` downloads containing the full report structure (all four sections, headings, figures) with Diagnostic ID citations rendered as readable references (footnotes or inline tags) (FR-14),
**And** the export renders from stored, gated content with no arithmetic in export code (AD-1) — library choice (python-docx in engine_service vs TS lib in a Convex action) is made and documented in this story per the architecture's deferred decision.

**Given** an export,
**When** it completes,
**Then** the export event (who, when, which report version) is audit-logged (FR-14),
**And** a test opens the generated document and asserts structure and citation rendering.

## Epic 7: Audit Trail & Golden-Path Hardening

A reviewing actuary or auditor can walk the full trail — filterable Audit Log, claim-to-Lineage navigation, chain verification — and the team gets the dashboard, review queue, and the Playwright smoke that proves the system end to end.

### Story 7.1: Audit Log Browser

As a Workspace member,
I want to browse the Audit Log filtered by Run, user, event type, and time range,
So that any question about "who did what, when" is answerable in the app. (FR-16)

**Acceptance Criteria:**

**Given** the Audit Log surface,
**When** a member opens it from the sidebar,
**Then** entries render newest-first with pagination (no infinite scroll), filterable by Run, user, event type, and time range, all Workspace-scoped through `requireMember` (FR-16, UX-DR18),
**And** LLM interaction entries expand to show the full conversation including tool traffic for any completed Interpretation (FR-15 consequence).

**Given** an entry linked to a Run,
**When** clicked,
**Then** navigation lands on the Run detail with context preserved,
**And** convex-test covers filter correctness and cross-Workspace invisibility.

### Story 7.2: Chain Verification and Claim-to-Lineage Navigation

As an auditor,
I want on-demand hash-chain verification and bounded-click navigation from any claim to its Lineage,
So that the trail is provably intact and every figure traces to its origin. (FR-15, FR-16, NFR-5)

**Acceptance Criteria:**

**Given** the Audit Log surface,
**When** "Verify chain" is triggered,
**Then** the per-Workspace hash chain is re-walked server-side and the result (intact, or first broken link with position) displays and is itself audit-logged (FR-15).

**Given** any published report claim,
**When** a user follows its citation chip → Diagnostic → Run → Lineage,
**Then** they reach engine version, chainladder version, Triangle hash, and parameters in a bounded number of clicks without leaving the app (FR-16),
**And** Lineage links and Audit Log cross-references use the provenance-violet affordance family exclusively (UX-DR1 discipline).

### Story 7.3: Dashboard, Review Queue, and Command Palette

As a Workspace member,
I want a dashboard showing quarter status and my review queue, with fast navigation,
So that every session starts oriented on what needs doing. (FR-20, UX-DR17)

**Acceptance Criteria:**

**Given** the Dashboard,
**When** it renders,
**Then** it shows recent Runs with status badges, reports awaiting review (the Senior Actuary's queue with submitter and date), and the empty-Workspace state "No triangles yet. Upload the first one to start the quarter." with a single primary action (UX-DR18),
**And** all content updates via Convex subscriptions.

**Given** `⌘K`,
**When** the command palette opens,
**Then** it navigates to Runs, Triangles, and reports only — no destructive actions in the palette (UX-DR17),
**And** responsive behavior holds: sidebar icons on `md`, sheet on `sm`, and `<md` viewports get read-and-approve with "Best on a larger screen" fallbacks on deep-work surfaces.

### Story 7.4: Golden-Path Smoke and Release Hardening

As the team,
I want one Playwright smoke proving the authenticated golden path and a final NFR verification pass,
So that release readiness is demonstrated by execution, not assertion. (FR-20, NFR-1..7)

**Acceptance Criteria:**

**Given** the deployed test environment,
**When** the Playwright smoke runs,
**Then** it completes sign-in → upload → validate → confirm periods → Run (CL+BF+Mack) → Diagnostics review → Interpretation (stubbed or live per environment) → report submit → approve → export, in one authenticated session — a single smoke, not a full E2E suite (testing standards),
**And** it runs in CI and blocks release when red.

**Given** the hardening checklist,
**When** executed,
**Then** documented verification exists for: golden tests green (NFR-1), Engine-Only Mode leaves 100% of engine features working (NFR-2), auth enumeration green (NFR-3), idempotent retries (NFR-4), audit completeness and chain verification (NFR-5), re-derivation (NFR-6), and latency budgets (NFR-7),
**And** WCAG 2.2 AA spot-checks pass on the diagnostics review and approval surfaces (accessibility floor).
