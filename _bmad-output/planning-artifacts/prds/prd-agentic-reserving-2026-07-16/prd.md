---
title: "PRD: Reserving Copilot"
status: final
created: 2026-07-16
updated: 2026-07-16
---

# PRD: Reserving Copilot

## 0. Document Purpose

This PRD is for the downstream BMad workflow owners — UX design, architecture, and epics/stories — and for Rohan as product owner. It builds on the finalized [Product Brief](../../briefs/brief-agentic-reserving-2026-07-16/brief.md) and its [addendum](../../briefs/brief-agentic-reserving-2026-07-16/addendum.md), and on the [technical research report](../../research/technical-agentic-insurance-reserving-stack-research-2026-07-16.md); it does not restate their content. Vocabulary is anchored in §3 Glossary; features are grouped in §4 with globally numbered FRs; inferred points carry inline `[ASSUMPTION]` tags indexed in §10. Technology commitments (Next.js, Convex, Clerk, chainladder, Agno, Gemini) are constraints inherited from the brief; the *how* stays in the addendum and the architecture phase.

## 1. Vision

Reserving Copilot turns the quarterly P&C reserving review from a days-long spreadsheet exercise into an hours-long, fully auditable workflow. An actuary uploads claims Triangles; a deterministic engine computes Chain Ladder, Bornhuetter-Ferguson, and Mack results; and an agentic interpretation layer does the work that consumes most of the elapsed time today — reading the Diagnostics, recommending a Method per Origin Period with stated reasons, and drafting the Reserve Report.

The defining commitment is a hard architectural rule: **the LLM never performs a calculation.** Every number originates in the deterministic engine. The interpretation layer reads only validated engine output through typed, read-only tools, and every claim it drafts must cite a Diagnostic ID — enforced programmatically, not by prompt. Combined with an append-only Audit Log and full computational Lineage, the tool's output is *more* traceable than the manual process it replaces — defensible in exactly the regulated context (NAIC AI governance, appointed-actuary sign-off) where generic AI tooling fails.

Why now: the reserving methods are decades-old and commoditized; the bottleneck is interpretation and documentation, which is precisely what LLMs became good at. Incumbents (WTW ResQ, Milliman Arius) automate the arithmetic but leave the narrative manual and would have to retrofit provenance into desktop-era architectures. Reserving Copilot is built AI-native, guardrails first.

## 2. Target User

### 2.1 Jobs To Be Done

- **Reserving actuary (primary):** close the quarter in hours, not days; get Diagnostics interpreted consistently; make Method-selection reasoning explicit; produce a report they are proud to sign; answer any auditor who asks "where did this number come from."
- **Actuarial analyst (secondary):** shed the tedious mechanics — data wrangling, factor eyeballing, first-draft commentary — and produce output that is reviewable rather than opaque.
- **Reviewing/appointed actuary and auditors (tertiary):** consume the Audit Log and Lineage; never touch the upload flow, but the product wins or dies on whether they accept its output.

### 2.2 Non-Users (v1)

- Life and health reserving teams (P&C triangles only).
- Teams requiring on-premise deployment.
- Regulators as direct users — they consume exported artifacts, not the app.

### 2.3 Key User Journeys

- **UJ-1. Dana runs the quarter.** Dana, an actuarial analyst at a mid-size P&C carrier, opens the Workspace on the first morning of close, already signed in via her company SSO through Clerk. She uploads the paid and incurred CSVs for the motor book. Validation flags two missing cells and one non-monotonic paid value; she fixes the source file and re-uploads clean. She confirms the detected Origin/Development Periods, then starts a Run: Chain Ladder, BF (entering the planning a priori loss ratios), and Mack. Status updates live as the engine works. Minutes later the ResultSet and Diagnostics are on screen. **Climax:** she triggers interpretation and watches a per-Origin-Period Method recommendation table appear, each row with reasons citing Diagnostic IDs. **Resolution:** she generates the draft Reserve Report and assigns it to Priya for review. **Edge case:** if the interpretation model API is down, the app tells her it is in Engine-Only Mode; she still has every number and diagnostic, and drafts commentary manually.
- **UJ-2. Priya signs off.** Priya, the senior actuary, opens the draft Reserve Report from her review queue. Every claim in the movement commentary carries a citation chip; clicking one opens the underlying Diagnostic. She edits the executive summary wording, overrides the recommended Method for the greenest accident year from CL to BF, records her reason, and approves. **Climax:** the report status flips to published, and the approval — who, when, what changed — lands in the Audit Log. **Resolution:** she exports the Word document for the appointed actuary's file.
- **UJ-3. The auditor traces a number.** Eight months later an external auditor questions the motor IBNR. Priya opens the published Run, shows the Lineage (engine version, triangle hash, parameters), re-derives the figure, and walks the Audit Log from upload through LLM interaction to her approval. Nothing is reconstructed from memory; everything is on record.

## 3. Glossary

Downstream documents must use these terms exactly.

- **Triangle** — a claims development array (paid or incurred, cumulative) indexed by Origin Period × Development Period. Uploaded as CSV/Excel; content-hashed on ingestion. A Workspace holds many Triangles.
- **Origin Period** — the accident (or underwriting) period a row of the Triangle belongs to.
- **Development Period** — the age dimension of the Triangle (columns).
- **Latest Diagonal** — the most recent observed value per Origin Period.
- **LDF (Loss Development Factor)** — link ratio between successive Development Periods, produced by the engine.
- **Method** — one of Chain Ladder (CL), Bornhuetter-Ferguson (BF), or Mack in v1.
- **A Priori Loss Ratio** — user-supplied expected loss ratio per Origin Period, required input to BF.
- **Run** — a single execution of one or more Methods against a validated Triangle with recorded parameters. Runs are immutable once complete.
- **ResultSet** — the typed, schema-validated output of a Run: LDFs, ultimates, IBNR, and Mack standard errors per Method per Origin Period, plus Lineage.
- **Diagnostic** — a derived analytical artifact of a Run (LDF stability, actual-vs-expected, CL/BF divergence, residuals), each element addressable by a **Diagnostic ID**.
- **Lineage** — the reproducibility record on every ResultSet: engine version, chainladder package version, Triangle hash, and all parameters.
- **Interpretation** — the agentic layer's output for a Run: per-Origin-Period Method recommendation with reasons, and the draft Reserve Report. Produced by the interpretation model reading the ResultSet and Diagnostics through read-only tools.
- **Provenance Gate** — the programmatic check that rejects any Interpretation claim lacking a Diagnostic ID citation resolvable against the Run.
- **Reserve Report** — the drafted document (executive summary, method selection rationale, movement commentary, limitations) that an Analyst edits and a Senior Actuary approves and publishes.
- **Engine-Only Mode** — degraded operating mode when the interpretation model is unavailable: all engine and diagnostic features work; Interpretation features are disabled with clear signaling.
- **Workspace** — a Clerk organization; the tenancy boundary. All data — Triangles, Runs, reports, Audit Log — is scoped to exactly one Workspace.
- **Analyst** — Workspace role that can upload Triangles, start Runs, trigger Interpretation, and draft/edit reports.
- **Senior Actuary** — Workspace role with all Analyst capabilities plus approve/publish authority over Reserve Reports.
- **Audit Log** — the append-only record in Convex of every consequential event: uploads, Runs, every LLM call (prompt, tool calls, tool results, response), report edits, approvals. Entries link to the Run and the acting user.

## 4. Features

### 4.1 Triangle Ingestion and Validation

**Description:** An Analyst uploads a paid or incurred Triangle as CSV or Excel into the Workspace (realizes UJ-1). Validation happens once, at the boundary: shape, monotonicity of cumulative paids, missing cells. The app auto-detects Origin and Development Periods and asks the user to confirm before the Triangle is accepted. Accepted Triangles are content-hashed and become immutable inputs to Runs.

#### FR-1: Triangle upload
An Analyst can upload a Triangle as CSV or Excel (.xlsx) into their Workspace, labeled paid or incurred. Realizes UJ-1.
**Consequences (testable):**
- Files that parse to a valid Triangle are stored with a content hash; re-uploading byte-identical content is detected and surfaced as a duplicate.
- Upload is rejected with a specific error when the file is not parseable as tabular data.

#### FR-2: Boundary validation
The system validates every uploaded Triangle for: rectangular/triangular shape, monotonically non-decreasing cumulative paid values along each Origin Period, and missing cells. Realizes UJ-1.
**Consequences (testable):**
- A Triangle with a decreasing cumulative paid value is rejected with the offending cell(s) identified by Origin/Development Period.
- Missing cells inside the observed region are reported individually; the user sees a cell-level error listing, not a generic failure. [ASSUMPTION: missing cells inside the observed triangle are hard rejections in v1, not warnings with imputation — imputation is a calculation and belongs to the engine, not ingestion.]
- No unvalidated Triangle can be referenced by a Run.

#### FR-3: Origin/Development Period detection
The system detects Origin and Development Period labels and granularity (e.g. accident years, annual development) from the file and presents them for user confirmation before acceptance. Realizes UJ-1.
**Consequences (testable):**
- Detected periods are shown and editable; acceptance requires explicit confirmation.
- Ambiguous layouts (e.g. undetectable orientation) produce a guided prompt rather than a silent guess.

### 4.2 Deterministic Methods Engine

**Description:** The engine — the `chainladder` package wrapped in a stateless Python service — computes Chain Ladder, Bornhuetter-Ferguson (with user-supplied A Priori Loss Ratios), and Mack (including standard errors) for a validated Triangle. Output is a typed ResultSet carrying full Lineage. The engine is the *only* origin of numbers anywhere in the product.

#### FR-4: Run execution
An Analyst can start a Run selecting one or more Methods against a validated Triangle; for BF, the Analyst supplies an A Priori Loss Ratio per Origin Period. Realizes UJ-1.
**Consequences (testable):**
- A BF Run cannot start without a complete set of A Priori Loss Ratios.
- Run status (queued, running, complete, failed) is visible live in the UI.
- Retried Runs are idempotent: a retry never produces a second billing of work or a divergent ResultSet (idempotency keyed by the Run's job ID).

#### FR-5: Typed ResultSet
Every completed Run produces a ResultSet: LDFs, ultimates, IBNR per Method per Origin Period, Mack standard errors and reserve ranges, validated against a versioned schema before storage. Realizes UJ-1, UJ-3.
**Consequences (testable):**
- A ResultSet failing schema validation is never stored; the Run is marked failed with the validation error.
- Each ResultSet carries Lineage: engine version, chainladder version, Triangle hash, all parameters (including A Priori Loss Ratios).

#### FR-6: Reproducibility
Any historical ResultSet can be re-derived from its Lineage. Realizes UJ-3.
**Consequences (testable):**
- Re-running the pinned engine version with the stored Triangle and parameters reproduces the stored ResultSet bit-for-bit for point estimates. [ASSUMPTION: bit-for-bit is achievable given a deterministic engine and pinned dependencies; if floating-point non-determinism surfaces across platforms, tolerance is a documented, tested epsilon — an architecture-phase decision.]

### 4.3 Diagnostics

**Description:** After every Run, the engine derives the Diagnostics the interpretation layer and the human reviewer both consume: LDF stability by Development Period, actual-vs-expected on the Latest Diagonal, CL-vs-BF divergence by Origin Period, and residual heatmap data. Every Diagnostic element carries a stable Diagnostic ID so it can be cited.

#### FR-7: Diagnostic computation
The system computes, for every completed Run: (a) LDF stability by Development Period, (b) actual vs expected emergence on the Latest Diagonal, (c) CL vs BF divergence by Origin Period (when both Methods ran), (d) residual heatmap data. Realizes UJ-1, UJ-2.
**Consequences (testable):**
- Each Diagnostic element has a unique, stable Diagnostic ID resolvable to its underlying values.
- Diagnostics are stored as typed JSON alongside the ResultSet and rendered in the review UI.

#### FR-8: Diagnostic review UI
An Analyst or Senior Actuary can review Diagnostics visually (stability charts, A-vs-E table, divergence by Origin Period, residual heatmap) before and independent of any Interpretation. Realizes UJ-1.
**Consequences (testable):**
- All Diagnostics are viewable in Engine-Only Mode.
- Clicking a Diagnostic ID citation anywhere in the product navigates to that Diagnostic's view (realizes UJ-2).

### 4.4 Agentic Interpretation Layer

**Description:** The interpretation model reads **only** the validated ResultSet and Diagnostics JSON, through read-only, schema-typed tool calls — never raw files, never free numbers. It recommends a Method per Origin Period with explicit reasons and drafts the Reserve Report. The Provenance Gate programmatically rejects any claim that does not cite a resolvable Diagnostic ID. The layer degrades to Engine-Only Mode when the model API is unavailable. [ASSUMPTION: "the interpretation model" is Gemini `gemini-3.1-flash-lite` behind Agno per the finalized brief; the user's requirement list said "Claude". The model is a config value either way — see Open Question OQ-1.]

#### FR-9: Read-only tool access
The interpretation model can access Run data exclusively through read-only tools returning the validated ResultSet and Diagnostics JSON; no other data path exists. Realizes UJ-1.
**Consequences (testable):**
- The tool surface exposes no write operations and no data beyond the Run's ResultSet, Diagnostics, and their metadata.
- Every tool call and tool result is captured in the Audit Log (FR-14).

#### FR-10: Method recommendation
The interpretation layer produces a per-Origin-Period Method recommendation with stated reasons, each reason citing at least one Diagnostic ID. Realizes UJ-1, UJ-2.
**Consequences (testable):**
- Every Origin Period in the Run receives exactly one recommendation with ≥1 resolvable Diagnostic ID citation.
- A Senior Actuary can override any recommendation; the override and its recorded reason land in the Audit Log (realizes UJ-2).

#### FR-11: Reserve Report drafting
The interpretation layer drafts a Reserve Report containing: executive summary, method selection rationale, movement commentary, and limitations. Every claim cites a Diagnostic ID. Realizes UJ-1, UJ-2.
**Consequences (testable):**
- The Provenance Gate rejects a draft containing any quantitative claim without a resolvable Diagnostic ID citation; rejected drafts are never shown as reviewable output.
- Numbers appearing in the draft must match the cited source values exactly; a mismatch fails the gate.

#### FR-12: Engine-Only Mode degradation
When the interpretation model API is unavailable or errors persistently, the system degrades gracefully: all ingestion, engine, and Diagnostics features remain fully functional; Interpretation features are disabled with a clear status indicator. Realizes UJ-1 (edge case).
**Consequences (testable):**
- With the model API unreachable, an Analyst can still complete upload → Run → Diagnostics review, and can create a Reserve Report shell for manual drafting. [ASSUMPTION: manual report drafting from a template is available in Engine-Only Mode, so an outage never blocks the quarter.]
- Entering and exiting Engine-Only Mode is recorded in the Audit Log.

### 4.5 Reserve Report Review, Approval, and Export

**Description:** The draft Reserve Report is a human-owned artifact from the moment it exists: an Analyst edits it, a Senior Actuary approves and publishes it, and the published version exports to Word. Citations survive editing; approval is the formal, logged sign-off moment (realizes UJ-2).

#### FR-13: Report review and approval workflow
An Analyst can edit a draft Reserve Report; only a Senior Actuary can approve and publish it. Realizes UJ-2.
**Consequences (testable):**
- An Analyst attempting to publish receives a role-based denial.
- Approval records approver identity, timestamp, and the approved content version in the Audit Log; published reports are immutable (subsequent changes require a new version). [ASSUMPTION: post-publication changes create a new draft version rather than mutating the published one.]

#### FR-14: Word export
A user can export a published (or draft) Reserve Report to a Word (.docx) document preserving structure and citation references. Realizes UJ-2, UJ-3.
**Consequences (testable):**
- The exported document contains the full report with Diagnostic ID citations rendered as readable references (e.g. footnotes or inline tags).
- Export events are recorded in the Audit Log.

### 4.6 Audit Log and Lineage

**Description:** Everything consequential lands in an append-only `auditLogs` table in Convex, linked to the Run and the acting user: uploads, validations, Runs, every LLM call (prompt, tool calls, tool results, response), gate rejections, report edits, overrides, approvals, exports, mode transitions. This is the artifact the tertiary users (reviewing actuaries, auditors) actually consume (realizes UJ-3).

#### FR-15: Append-only audit logging
Every LLM interaction (full prompt, each tool call and result, full response) and every consequential user/system event is persisted to the append-only `auditLogs` table, linked to Run and user. Realizes UJ-3.
**Consequences (testable):**
- No code path updates or deletes an audit entry; the table admits inserts only, verified by test.
- For any completed Interpretation, the Audit Log reconstructs the full LLM conversation including tool traffic.
- Audit entries are hash-chained; a verification routine detects any tampering or gap. [ASSUMPTION: hash-chaining carried from the brief's success criteria into v1 scope, not deferred.]

#### FR-16: Audit trail navigation
A Workspace member can view the Audit Log filtered by Run, user, event type, and time range, and follow links from any report claim to its Diagnostic, ResultSet, and originating Run. Realizes UJ-3.
**Consequences (testable):**
- Given a published figure, a user can reach its Lineage (engine version, Triangle hash, parameters) in a bounded number of clicks without leaving the app.

### 4.7 Authentication, Workspaces, and Roles

**Description:** Clerk provides authentication (email/password now, SSO-ready) and organizations provide Workspaces. Every Convex document is scoped to a Workspace; every Convex function requires a Clerk identity. Two roles in v1: Analyst and Senior Actuary.

#### FR-17: Authentication
Users authenticate via Clerk with email/password; the integration is SSO-ready (SAML/OIDC enableable without rearchitecture). Realizes UJ-1.
**Consequences (testable):**
- No application surface beyond the sign-in/marketing pages renders without an authenticated session.

#### FR-18: Workspace scoping
All data — Triangles, Runs, ResultSets, Diagnostics, Reserve Reports, Audit Log — belongs to exactly one Workspace, and every query/mutation enforces membership. Realizes UJ-1, UJ-2, UJ-3.
**Consequences (testable):**
- A member of Workspace A can never read or write Workspace B data, verified by test at the Convex function layer (not only the UI).
- No Convex query or mutation is callable without a verified Clerk identity (see NFR-3).

#### FR-19: Role-based capabilities
Workspace members hold a role: Analyst (upload, run, interpret, draft/edit) or Senior Actuary (all Analyst capabilities plus approve/publish and recommendation override). Realizes UJ-2.
**Consequences (testable):**
- Role checks are enforced server-side in Convex functions; UI hiding alone is insufficient.
- Role changes are recorded in the Audit Log. [ASSUMPTION: role assignment is managed via Clerk organization roles by an organization admin; no in-app role admin UI in v1.]

### 4.8 Web Application Workflow

**Description:** A Next.js (App Router) app carries the single golden path: upload → review Triangles → run Methods → review Diagnostics → generate report → export to Word, with live status throughout via Convex reactivity (realizes UJ-1, UJ-2).

#### FR-20: Golden-path workflow UI
The app guides a user through the full sequence with clear state at each step, and any in-progress Run or Interpretation shows live status without manual refresh. Realizes UJ-1.
**Consequences (testable):**
- Run and Interpretation status changes propagate to all viewing clients reactively (Convex subscriptions), with no polling in application code.
- A user can leave mid-flow and resume; state is server-held, not browser-held.

## 5. Non-Goals (Explicit)

- **The LLM never performs, adjusts, or overrides any calculation — permanently, not just v1.** This is the product's constitution, not a scope deferral.
- No stochastic reserving beyond Mack: no bootstrap/ODP, no GLM reserving in v1.
- No ORSA or IFRS 17 reporting outputs.
- No on-premise deployment.
- No integration with policy admin or claims systems.
- No autonomous publication: a Reserve Report is never finalized without a logged human approval.
- Not competing on breadth of methods or decades of actuarial-firm trust; the v1 claim is narrow and deep — the fastest defensible path from triangle to signed reserve report.

## 6. MVP Scope

### 6.1 In Scope

- CSV/Excel Triangle upload with boundary validation (shape, monotonic cumulative paids, missing cells) and Origin/Development Period detection; paid and incurred.
- Chain Ladder, BF (user-supplied A Priori Loss Ratios), Mack with standard errors — via `chainladder`; typed ResultSet with full Lineage.
- Diagnostics: LDF stability, actual-vs-expected on the Latest Diagonal, CL-vs-BF divergence, residual heatmap data — each element Diagnostic-ID addressable.
- Agentic Interpretation through read-only tools; per-Origin-Period Method recommendation; drafted Reserve Report; Provenance Gate; Engine-Only Mode.
- Report review/approve/publish workflow with roles; Word export.
- Append-only, hash-chained Audit Log of every LLM call and consequential event.
- Clerk auth (email, SSO-ready), organization Workspaces, Analyst/Senior Actuary roles, full Workspace scoping.
- Next.js golden-path UI with live status via Convex reactivity.

### 6.2 Out of Scope for MVP

- Bootstrap/ODP, Cape Cod, GLM methods — v2 candidates behind the same firewall.
- Cross-quarter memory (emergence trends, assumption drift over time) — v2. `[NOTE FOR PM]` emotionally load-bearing for the "copilot" framing; revisit as soon as one team has two quarters of data in the tool.
- Regulatory report formats (ORSA, IFRS 17) — v3 direction.
- In-app triangle editing/correction — fix at source and re-upload in v1; keeps the validation boundary honest.
- PDF export, report templates/branding — Word export only in v1.
- In-app role administration UI — Clerk-managed in v1.

## 7. Cross-Cutting NFRs

- **NFR-1 (Determinism + golden tests):** The engine is deterministic and unit-tested against known textbook triangles — at minimum the Taylor-Ashe dataset — reproducing published CL ultimates, Mack standard errors, and BF results within documented tolerance. Golden tests run in CI; a red golden test blocks release.
- **NFR-2 (Graceful degradation):** Interpretation-model unavailability never blocks the engine workflow (see FR-12). Target: 100% of engine features functional during a model-API outage.
- **NFR-3 (No anonymous access):** No Convex query or mutation is callable without a verified Clerk identity. Enforced by a shared auth guard in every public function and verified by an automated test that enumerates public functions and asserts rejection of unauthenticated calls.
- **NFR-4 (Reliability):** Job completion reliability ≥ 99.9% including retries; retries are idempotent (FR-4).
- **NFR-5 (Auditability):** 100% of LLM interactions, tool calls, and human review decisions present in the Audit Log; append-only and hash-chain properties continuously verifiable (FR-15).
- **NFR-6 (Reproducibility):** 100% of stored ResultSets re-derivable from Lineage (FR-6).
- **NFR-7 (Latency posture):** A Run on a typical Triangle (≤ 30 Origin Periods) completes within minutes, not hours; Interpretation drafting completes within single-digit minutes. [ASSUMPTION: no hard latency SLA in v1 — "hours not days" is the product bar; precise budgets set in architecture.]

## 8. Constraints and Guardrails

- **Safety/Integrity:** The Provenance Gate is a hard gate, continuously verified — zero Interpretation numbers without tool provenance is a release criterion, not a metric to trend. Prompt-level instructions are not a substitute for the programmatic gate.
- **Compliance posture:** Designed against NAIC AI Model Bulletin expectations (documented governance, provenance, model validation) and EU AI Act logging/human-oversight obligations. `[NOTE FOR PM]` Regulatory *sufficiency* of the audit posture has not been professionally reviewed — counsel/appointed-actuary review is an open item (OQ-3), medium confidence per the brief addendum.
- **Privacy/Data governance:** Triangles are aggregate loss data, not personal data, but customer contracts may still classify them as confidential; Workspace isolation (FR-18) is the governing control. [ASSUMPTION: no data-residency commitments in v1.]
- **Cost:** Interpretation-model spend is bounded per Run (config ceiling on tokens/calls); a Run that hits the ceiling fails Interpretation cleanly into Engine-Only Mode rather than degrading output quality silently. [ASSUMPTION: ceiling values set during architecture/eval.]

## 9. Success Metrics

**Primary**
- **SM-1 (Stage 1 — credible demo):** Full pipeline runs on published/realistic triangles; golden tests green (NFR-1); zero Interpretation numbers without provenance (FR-11); Audit Log passes append-only/hash-chain verification (FR-15).
- **SM-2 (Stage 2 — the v1 bar):** One real reserving team completes an actual quarterly review end-to-end — upload through signed report — in hours rather than days, and the report is accepted by their reviewing actuary without a parallel Excel re-run. Validates FR-1–FR-20 as a system.

**Secondary**
- **SM-3:** 100% of results reproducible from stored Lineage (NFR-6, FR-6).
- **SM-4:** Job completion reliability ≥ 99.9% including retries (NFR-4).
- **SM-5:** 100% of LLM interactions, tool calls, and review decisions present in the Audit Log (NFR-5, FR-15).

**Counter-metrics (do not optimize)**
- **SM-C1: Interpretation acceptance rate.** Do not chase a high "recommendations accepted without override" rate — a reviewing actuary who never overrides is a rubber stamp, and optimizing for it pressures the layer toward blandness or sycophancy. Overrides are the system working. Counterbalances SM-2.
- **SM-C2: Time-to-report.** Do not compress review time by making the draft *look* more finished than its evidence supports; speed must come from the engine and drafting, never from discouraging scrutiny. Counterbalances SM-2.

## 10. Open Questions

1. **OQ-1 — Interpretation model provider.** The finalized brief commits to Gemini (`gemini-3.1-flash-lite`) + Agno; the PRD invocation said "Claude." Model ID is a config value and Agno is provider-agnostic, so this is an eval-driven config choice, not architecture — but it should be settled explicitly before the agent layer is built. Owner: Rohan. Revisit: at agent-layer eval.
2. **OQ-2 — Design partner.** Stage 2 (SM-2) requires a real reserving team not yet identified — the largest non-technical risk. Owner: Rohan. Revisit: before agent-layer build completes.
3. **OQ-3 — Regulatory sufficiency review.** Counsel/appointed-actuary review of the audit posture. Owner: Rohan. Revisit: before any external positioning or design-partner pilot.
4. **OQ-4 — Incumbent AI roadmaps.** ResQ/Arius provenance-gated-LLM status unverified; run `bmad-market-research` before external positioning.
5. **OQ-5 — BF a priori source.** v1 takes user-entered A Priori Loss Ratios; whether teams also need CSV import of a prioris (bulk, many segments) is unknown.
6. **OQ-6 — Incurred-triangle validation rules.** Monotonicity is specified for cumulative paids; incurred triangles can legitimately decrease (case reserve releases). Validation rules for incurred need actuarial confirmation. [ASSUMPTION in FR-2 applies monotonicity to paid only.]

## 11. Assumptions Index

- §4.1 FR-2 — Missing cells inside the observed region are hard rejections in v1 (no imputation at ingestion).
- §4.2 FR-6 — Bit-for-bit reproducibility achievable; epsilon-tolerance fallback is an architecture decision.
- §4.4 (description) — Interpretation model is Gemini + Agno per brief; "Claude" in the invocation treated as generic. → OQ-1.
- §4.4 FR-12 — Manual report drafting from a template is available in Engine-Only Mode.
- §4.5 FR-13 — Published reports are immutable; changes create a new version.
- §4.6 FR-15 — Hash-chaining is v1 scope (carried from brief success criteria).
- §4.7 FR-19 — Role assignment via Clerk org roles; no in-app role admin UI in v1.
- §7 NFR-7 — No hard latency SLA in v1; budgets set in architecture.
- §8 Privacy — No data-residency commitments in v1.
- §8 Cost — Per-Run model-spend ceiling; values set at architecture/eval.
- §10 OQ-6 — Monotonicity validation applies to paid triangles only.
