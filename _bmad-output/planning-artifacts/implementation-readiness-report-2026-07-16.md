---
stepsCompleted: ['step-01-document-discovery', 'step-02-prd-analysis', 'step-03-epic-coverage-validation', 'step-04-ux-alignment', 'step-05-epic-quality-review', 'step-06-final-assessment']
documentsIncluded:
  prd: 'prds/prd-agentic-reserving-2026-07-16/prd.md (+ addendum.md)'
  architecture: 'architecture/architecture-agentic-reserving-2026-07-16/ARCHITECTURE-SPINE.md'
  epics: 'epics.md'
  ux: 'ux-designs/ux-agentic-reserving-2026-07-16/DESIGN.md + EXPERIENCE.md'
---

# Implementation Readiness Assessment Report

**Date:** 2026-07-16
**Project:** agentic-reserving

## Document Inventory

| Type | Document(s) | Status |
| --- | --- | --- |
| PRD | `prds/prd-agentic-reserving-2026-07-16/prd.md` + `addendum.md` | ✅ single canonical version |
| Architecture | `architecture/architecture-agentic-reserving-2026-07-16/ARCHITECTURE-SPINE.md` | ✅ single canonical version |
| Epics & Stories | `epics.md` | ✅ single canonical version |
| UX Design | `ux-designs/ux-agentic-reserving-2026-07-16/DESIGN.md` + `EXPERIENCE.md` | ✅ single canonical version |

No duplicates (whole vs sharded) found. No missing document types. Review records (PRD review-rubric, architecture `reviews/`) and the brief/research are treated as reference context, not assessed artifacts.

## PRD Analysis

### Functional Requirements

- **FR-1: Triangle upload** — An Analyst can upload a Triangle as CSV or Excel (.xlsx) into their Workspace, labeled paid or incurred. Parsed files stored with content hash; byte-identical re-upload surfaced as duplicate; unparseable files rejected with a specific error.
- **FR-2: Boundary validation** — Every uploaded Triangle validated for rectangular/triangular shape, monotonically non-decreasing cumulative paid values per Origin Period, and missing cells. Decreasing paid values rejected with offending cell(s) identified; missing cells reported individually (cell-level errors); no unvalidated Triangle referenceable by a Run. Monotonicity applies to paid only (OQ-6).
- **FR-3: Origin/Development Period detection** — System detects Origin/Development Period labels and granularity, presents for user confirmation before acceptance; detected periods editable; ambiguous layouts produce a guided prompt, never a silent guess.
- **FR-4: Run execution** — Analyst starts a Run selecting one or more Methods against a validated Triangle; BF requires a complete A Priori Loss Ratio set per Origin Period. Run status (queued/running/complete/failed) visible live; retried Runs idempotent, keyed by the Run's job ID.
- **FR-5: Typed ResultSet** — Every completed Run produces a ResultSet (LDFs, ultimates, IBNR per Method per Origin Period, Mack standard errors and reserve ranges) validated against a versioned schema before storage; failing validation → Run marked failed, nothing stored. Each ResultSet carries Lineage (engine version, chainladder version, Triangle hash, all parameters).
- **FR-6: Reproducibility** — Any historical ResultSet re-derivable from its Lineage; pinned engine + stored Triangle + parameters reproduce point estimates bit-for-bit (epsilon fallback is an architecture decision).
- **FR-7: Diagnostic computation** — For every completed Run: (a) LDF stability by Development Period, (b) actual-vs-expected on Latest Diagonal, (c) CL-vs-BF divergence by Origin Period (when both ran), (d) residual heatmap data. Each element has a unique, stable, resolvable Diagnostic ID; stored as typed JSON alongside the ResultSet.
- **FR-8: Diagnostic review UI** — Diagnostics reviewable visually (stability charts, A-vs-E table, divergence, residual heatmap) before and independent of any Interpretation; all viewable in Engine-Only Mode; clicking any Diagnostic ID citation navigates to that Diagnostic's view.
- **FR-9: Read-only tool access** — Interpretation model accesses Run data exclusively through read-only tools returning validated ResultSet + Diagnostics JSON; no write operations, no other data; every tool call/result audit-logged.
- **FR-10: Method recommendation** — Per-Origin-Period Method recommendation with stated reasons, each citing ≥1 resolvable Diagnostic ID; exactly one recommendation per Origin Period; Senior Actuary can override with recorded reason, audit-logged.
- **FR-11: Reserve Report drafting** — Drafted report contains executive summary, method selection rationale, movement commentary, limitations; every claim cites a Diagnostic ID. Provenance Gate rejects any quantitative claim without a resolvable citation; drafted numbers must match cited source values exactly; rejected drafts never shown as reviewable.
- **FR-12: Engine-Only Mode degradation** — Model unavailability degrades gracefully: ingestion, engine, Diagnostics fully functional; Interpretation disabled with clear indicator; manual report shell available; mode transitions audit-logged.
- **FR-13: Report review and approval workflow** — Analyst edits drafts; only Senior Actuary approves/publishes (role denial for Analyst publish attempts); approval records approver identity, timestamp, approved content version; published reports immutable (changes create a new version).
- **FR-14: Word export** — Export published (or draft) report to .docx preserving structure and citation references as readable references; export events audit-logged.
- **FR-15: Append-only audit logging** — Every LLM interaction (full prompt, each tool call/result, full response) and every consequential event persisted to append-only `auditLogs`, linked to Run and user; insert-only verified by test; full LLM conversation reconstructable; entries hash-chained with tamper/gap verification routine.
- **FR-16: Audit trail navigation** — Audit Log filterable by Run, user, event type, time range; links from any report claim to its Diagnostic, ResultSet, originating Run; Lineage reachable in a bounded number of clicks in-app.
- **FR-17: Authentication** — Clerk email/password, SSO-ready (SAML/OIDC enableable without rearchitecture); no application surface beyond sign-in/marketing renders unauthenticated.
- **FR-18: Workspace scoping** — All data belongs to exactly one Workspace; every query/mutation enforces membership; cross-Workspace access impossible, verified by test at the Convex function layer; no function callable without verified Clerk identity.
- **FR-19: Role-based capabilities** — Analyst (upload, run, interpret, draft/edit) vs Senior Actuary (+ approve/publish, override); server-side enforcement in Convex functions; role changes audit-logged; role assignment via Clerk org roles (no in-app admin UI).
- **FR-20: Golden-path workflow UI** — Guided sequence upload → review → run → Diagnostics → report → export with clear state; live status via Convex subscriptions, no polling; leave-and-resume with server-held state.

**Total FRs: 20**

### Non-Functional Requirements

- **NFR-1 (Determinism + golden tests):** Engine deterministic, unit-tested against known textbook triangles (minimum Taylor-Ashe) reproducing published CL ultimates, Mack standard errors, BF results within documented tolerance; golden tests in CI; red golden test blocks release.
- **NFR-2 (Graceful degradation):** Model unavailability never blocks the engine workflow; target 100% of engine features functional during a model-API outage.
- **NFR-3 (No anonymous access):** No Convex query/mutation callable without verified Clerk identity; shared auth guard in every public function; automated test enumerates public functions and asserts unauthenticated rejection.
- **NFR-4 (Reliability):** Job completion reliability ≥ 99.9% including retries; retries idempotent.
- **NFR-5 (Auditability):** 100% of LLM interactions, tool calls, and human review decisions in the Audit Log; append-only and hash-chain properties continuously verifiable.
- **NFR-6 (Reproducibility):** 100% of stored ResultSets re-derivable from Lineage.
- **NFR-7 (Latency posture):** Run on typical Triangle (≤ 30 Origin Periods) completes within minutes; Interpretation drafting within single-digit minutes; no hard SLA in v1.

**Total NFRs: 7**

### Additional Requirements

- **Constitution (Non-Goal #1):** The LLM never performs, adjusts, or overrides any calculation — permanent, not v1 scope.
- **Guardrails (§8):** Provenance Gate is a hard, continuously verified release criterion; NAIC/EU-AI-Act-informed compliance posture; Workspace isolation as the privacy control; per-Run model-spend ceiling failing cleanly into Engine-Only Mode.
- **Addendum:** job-record-first orchestration via `@convex-dev/workflow`; idempotency keyed by Convex job ID; Gemini thought-signature trap (official SDK only); Convex as sole audit source; build sequencing engine-first → agent-last; gate mechanics (bounded retry, prose numeric scan); .docx generation path an architecture decision.
- **11 indexed assumptions** (§11) including hard-reject missing cells, published-report immutability, hash-chaining in v1, Clerk-managed roles.
- **Open questions:** OQ-1 resolved (Gemini + Agno); OQ-2 design partner (non-technical); OQ-3 regulatory review (non-technical); OQ-4 market research; OQ-5 BF a-priori CSV import unknown; OQ-6 incurred validation rules pending actuarial confirmation.

### PRD Completeness Assessment

Strong. FRs are globally numbered with testable consequences; NFRs are measurable; assumptions are inline-tagged and indexed; open questions carry owners and revisit triggers. The two open items with implementation impact are OQ-5 (BF a-priori bulk import — explicitly out of v1) and OQ-6 (incurred validation rules — PRD scopes monotonicity to paid, so v1 behavior is defined even while the actuarial question stays open). No FR is blocked by an unresolved question.

## Epic Coverage Validation

The epics document contains its own Requirements Inventory (FR1–FR20, NFR1–NFR7) and an explicit FR Coverage Map. Epic-level FR restatements match the PRD's requirements in substance; the epics restate several architecture-resolved details (e.g. FR6's 1e-8 cross-platform tolerance, NFR7's ≤60s p95 / ≤10-min bounds) that sharpen, not contradict, the PRD.

### Coverage Matrix

| FR | PRD Requirement (abbrev.) | Epic Coverage | Status |
| --- | --- | --- | --- |
| FR-1 | Triangle upload w/ hash + duplicate detection | Epic 3, Story 3.1 | ✓ Covered |
| FR-2 | Boundary validation, cell-level errors | Epic 2 Story 2.1 (core) / Epic 3 Story 3.2 (UI) | ✓ Covered |
| FR-3 | Period detection + explicit confirmation | Epic 3, Story 3.3 | ✓ Covered |
| FR-4 | Run execution, BF a prioris, live status, idempotent retries | Epic 4, Stories 4.1–4.2 (+ engine boundary in 2.3, 2.5) | ✓ Covered |
| FR-5 | Typed ResultSet + Lineage, schema-gated storage | Epic 2 Stories 2.2–2.3, 2.6 / Epic 4 Stories 4.2, 4.4 | ✓ Covered |
| FR-6 | Reproducibility from Lineage | Epic 2 Story 2.2 / Epic 4 Story 4.7 | ✓ Covered |
| FR-7 | Four Diagnostics w/ stable Diagnostic IDs | Epic 2 Story 2.4 / Epic 4 Story 4.2 (storage) | ✓ Covered |
| FR-8 | Diagnostics review UI, deep-linkable | Epic 4, Stories 4.5–4.6 | ✓ Covered |
| FR-9 | Read-only tool access, audit-logged | Epic 5, Story 5.1 | ✓ Covered |
| FR-10 | Method recommendations + override | Epic 5 Stories 5.3, 5.5 / Epic 6 Story 6.3 (override) | ✓ Covered |
| FR-11 | Report drafting through Provenance Gate | Epic 5, Stories 5.2, 5.4 | ✓ Covered |
| FR-12 | Engine-Only Mode degradation | Epic 5 Story 5.6 / Epic 6 Story 6.1 (manual template shell) | ✓ Covered |
| FR-13 | Review/approve/publish workflow, immutability | Epic 6, Stories 6.1, 6.2, 6.4 | ✓ Covered |
| FR-14 | Word export w/ citations | Epic 6, Story 6.5 | ✓ Covered |
| FR-15 | Append-only hash-chained audit logging | Epic 1 Story 1.5 (primitive) / all epics append / Epic 7 Story 7.2 (verification) | ✓ Covered |
| FR-16 | Audit trail navigation + Lineage in bounded clicks | Epic 7, Stories 7.1–7.2 | ✓ Covered |
| FR-17 | Clerk authentication, SSO-ready | Epic 1, Story 1.2 | ✓ Covered |
| FR-18 | Workspace scoping, server-side membership | Epic 1, Story 1.4 | ✓ Covered |
| FR-19 | Role-based capabilities | Epic 1 Story 1.4 / enforced in 6.3, 6.4 | ✓ Covered |
| FR-20 | Golden-path UI, live status, resume | Epic 4 Story 4.3 / Epic 7 Stories 7.3–7.4 | ✓ Covered |

NFR coverage: NFR-1 → 2.2/2.3 + CI (1.1); NFR-2 → 5.6 (+4.5); NFR-3 → 1.4; NFR-4 → 4.2; NFR-5 → 1.5 / 5.1–5.4 / 7.2; NFR-6 → 2.2 / 4.7; NFR-7 → 4.2 (run budget) / 5.4, 5.6 (interpretation bound). All verified in the 7.4 hardening checklist.

### Missing Requirements

None. Every PRD FR and NFR maps to at least one specific story with matching acceptance criteria. No epic claims an FR that does not exist in the PRD.

### Coverage Statistics

- Total PRD FRs: 20
- FRs covered in epics: 20
- Coverage percentage: **100%** (NFRs: 7/7, also 100%)

## UX Alignment Assessment

### UX Document Status

**Found** — `DESIGN.md` (brand-layer visual spec, status: final) and `EXPERIENCE.md` (experience spine with IA, flows, state/interaction/accessibility patterns, status: final).

### UX ↔ PRD Alignment

- EXPERIENCE.md's three key flows map one-to-one onto PRD user journeys (Flow 1 → UJ-1 Dana, Flow 3 → UJ-2 Priya; Flow 2 covers the Diagnostics screen UJ-1/UJ-2 hinge). Failure paths (Engine-Only Mode, unresolved-citation blocking) mirror FR-12 and FR-11/FR-13 consequences.
- Vocabulary follows the PRD §3 Glossary verbatim, as the PRD demands.
- UX behavior traces to explicit FRs throughout (live subscriptions FR-20, no in-app repair PRD §6.2, override FR-10, idempotent retry FR-4, manual template FR-12).
- UX ASSUMPTION tags were subsequently ratified: draft-lock-on-submission and no-streaming both appear in the epics (Stories 6.2, 5.5); gated-complete display is recorded in the architecture's Deferred list.

### UX ↔ Architecture Alignment

- Architecture lists DESIGN.md as a source and pins shadcn/ui + Tailwind "per UX DESIGN.md" in the Stack table; the reactive-view paradigm (Convex subscriptions) directly supports EXPERIENCE.md's "no manual refresh anywhere" rule.
- Latency posture aligns: UX shows named-stage progress and skeleton states consistent with the ≤60s run / ≤10-min interpretation budgets (NFR-7 as sharpened by the spine).
- Provenance UX (citation chips, popover, Engine-Only banner) is architecturally backed by AD-5 (gate), AD-9 (derived server-side mode), and AD-11 (Lineage contents).

### Alignment Issues

1. **Diagnostic ID surface format (minor, cosmetic).** EXPERIENCE.md illustrates Diagnostic IDs as `D-LDF-07` / deep link `#D-LDF-02`, while architecture AD-10 fixes the canonical format `dx:{runId}:{kind}:{key}`. The epics resolve in favor of AD-10 (Stories 2.4, 4.6, 5.5 all use `dx:` and `#<diagnosticId>`), so implementation is unambiguous — but the chip's *display* form (full `dx:` ID vs a shortened label) is an unstated UI decision the dev will face in Story 5.5. Recommendation: treat EXPERIENCE.md's `D-LDF-07` as illustrative shorthand and display the canonical ID (possibly truncated), decided at Story 5.5.
2. **UX visual-direction confirmation.** DESIGN.md carries `[ASSUMPTION: shadcn/ui as the UI system and this whole visual direction were set without user elicitation — confirm or redirect before build]`. Architecture and epics have since committed to shadcn/ui, which operationally ratifies it, but the explicit product-owner confirmation the assumption asks for is not recorded. Low risk; one-line sign-off recommended before Story 1.3.
3. **Mobile approval scope.** EXPERIENCE.md flags `[ASSUMPTION: mobile approval is in scope — confirm]`. Epics carry `<md` read-and-approve (UX-DR17, Story 7.3) so it is in scope de facto; same one-line confirmation applies.

### Warnings

None blocking. All three issues above are clarifications/confirmations, not misalignments that would send implementation in a wrong direction.

## Epic Quality Review

Standards applied: user-value epics (no technical milestones), epic independence (Epic N never needs Epic N+1), no forward story dependencies, just-in-time table creation, Given/When/Then acceptance criteria that are testable and cover error paths, FR traceability.

### Epic Structure

| Epic | User value | Independent of later epics | Notes |
| --- | --- | --- | --- |
| 1 Authenticated Workspace Foundation | ✓ (sign in, land in Workspace, themed shell) | ✓ stands alone | Carries the audit primitive every later epic writes to — correct placement |
| 2 Deterministic Reserving Engine | ✓ with caveat (value = trustworthy, auditor-verifiable numbers; no UI) | ✓ verifiable via tests/CLI using only Epic 1's CI substrate | Sequenced engine-first by explicit architecture mandate |
| 3 Triangle Ingestion | ✓ | ✓ uses Epic 2's validation core (backward) | |
| 4 Runs, Results & Diagnostics Review | ✓ | ✓ uses Epics 1–3 only | Interpretation/Report tabs render as locked/empty states — no forward need |
| 5 Agentic Interpretation | ✓ | ✓ uses Epics 1–4 | |
| 6 Report Review, Approval & Export | ✓ | ✓ manual-template path (6.1) works even without Epic 5 output | |
| 7 Audit Trail & Golden-Path Hardening | ✓ | ✓ terminal epic | |

No technical-milestone epics. Epic 2 is the closest call (no user-facing surface), but its outcome is a user-verifiable guarantee (golden-tested numbers), the PRD's entire premise, and the architecture fixes the build order engine-first — accepted as correctly shaped, not a violation.

### Dependency Analysis

- **No forward dependencies at epic level.** The chain is strictly 1 → 7.
- **Story-level:** Story 4.6 ships its "cited by N report claims" backlinks with a defined empty state, and Story 5.5 explicitly "completes Story 4.6's contract" — a clean deferred-fulfillment pattern, not a forward dependency. Story 1.4 references Story 1.5 ("recorded to the Audit Log once Story 1.5 lands — until then … interface stub") — see Minor Concerns.
- **Database/entity timing: correct.** Tables are created when first needed: `auditLogs` in 1.5, `triangles` in 3.1, `runs` in 4.1, recommendations/reports documents in 5.3/5.4. No big-bang schema story.
- **Starter template:** none specified by architecture; Story 1.1 is the required greenfield scaffold story (Structural Seed, lockfiles, CI on linux/amd64) — compliant, including early CI per greenfield indicators.

### Acceptance Criteria Quality

All 33 stories use Given/When/Then. Criteria are specific and testable (named guards, exact hash formula, exact placeholder syntax, named test layers), and error paths are consistently covered: auth rejection (1.4, 2.5), tampered-chain fixture (1.5), duplicate/unparseable upload (3.1), ambiguous layout (3.3), schema-invalid ResultSet (4.2), gate failure taxonomy incl. literal-number smuggling (5.2), ceiling breach (5.6), Analyst publish rejection (6.4). Exemplary.

### Findings by Severity

#### 🔴 Critical Violations

None.

#### 🟠 Major Issues

None.

#### 🟡 Minor Concerns

1. **Story 1.4 → 1.5 intra-epic forward reference.** 1.4's role-change audit AC is deferred behind an "interface stub" until 1.5 lands. The stub keeps 1.4 independently completable, but the cleaner fix is swapping the order (audit primitive 1.5 before guards 1.4) or moving the role-change-audit AC wholly into 1.5. Remediation: accept as-is with the stub, or reorder — either is a 5-minute decision at sprint planning.
2. **Developer/system personas.** Stories 1.1, 1.3, 2.5, 2.6, 5.1 use "As a developer / As the Convex backend / As the product." Acceptable for infrastructure and contract stories in a greenfield build, but they are not user stories in the strict sense. No action required.
3. **Story 7.4 size.** One story bundles the Playwright golden-path smoke plus documented verification of all seven NFRs plus WCAG spot-checks. Completable in one session if the checklist is evidence-gathering (everything it verifies was built earlier), but it is the story most likely to spill. Remediation: keep, with the option to split "smoke" from "hardening checklist" if it drags.
4. **Story 4.2 latency AC softness.** "asserted in a test or documented measurement" gives the implementer an escape hatch on NFR-7's ≤60s p95. Acceptable for v1 given NFR-7's explicit no-hard-SLA posture; note it so the choice is conscious.

### Best Practices Compliance

- [x] Epics deliver user value
- [x] Epics function independently (no Epic N → N+1)
- [x] Stories appropriately sized (one flagged watch item: 7.4)
- [x] No forward dependencies (one stub-mitigated intra-epic reference: 1.4)
- [x] Tables created when needed
- [x] Clear, testable, error-covering acceptance criteria
- [x] FR traceability maintained (explicit FR/NFR/UX-DR tags on every story)

## Summary and Recommendations

### Overall Readiness Status

**READY** — proceed to Phase 4 implementation.

All four artifact sets are present, final, mutually consistent, and internally traceable. FR/NFR coverage is 100% with story-level mapping. Epic sequencing matches the architecture's fixed build order. No critical or major issues were found; the seven findings below are minor and none blocks starting Epic 1.

### Critical Issues Requiring Immediate Action

None.

### Minor Issues (address opportunistically)

1. **Diagnostic ID display form** — EXPERIENCE.md's `D-LDF-07` shorthand vs canonical `dx:{runId}:{kind}:{key}` (AD-10). Implementation follows AD-10 (epics already do); decide the chip's display treatment in Story 5.5.
2. **Two unconfirmed UX assumptions** — shadcn/ui visual direction (DESIGN.md) and mobile approval scope (EXPERIENCE.md). Both are de facto ratified by architecture and epics; record a one-line product-owner confirmation before Stories 1.3 and 7.3 respectively.
3. **Story 1.4 → 1.5 stub reference** — accept the interface stub or reorder the two stories at sprint planning.
4. **Story 7.4 breadth** — watch for spill; split smoke from hardening checklist if needed.
5. **Story 4.2 latency AC** — "test or documented measurement" is deliberately soft per NFR-7's posture; make the choice consciously.
6. **OQ-6 (incurred validation rules)** — get actuarial confirmation before Epic 3 hardens; v1 behavior (paid-only monotonicity) is defined meanwhile.
7. **OQ-2 (design partner)** — non-technical, but the PRD's own trigger is "before agent-layer build completes" (Epic 5); start now.

### Recommended Next Steps

1. Run sprint planning (`bmad-sprint-planning`) to generate the sprint status tracker from epics.md, resolving the 1.4/1.5 ordering choice there.
2. Record the two one-line UX confirmations (visual direction, mobile approval) — a note in the UX memlog suffices.
3. Begin Epic 1 Story 1.1 (project scaffold); in parallel, Rohan pursues OQ-2 (design partner) and OQ-6 (incurred rules) on their PRD-stated timelines.

### Final Note

This assessment identified 7 minor issues across 3 categories (UX alignment: 3, epic quality: 4 including overlaps) and 0 critical or major issues. The planning corpus is unusually tight — every FR and NFR traces to specific stories with testable Given/When/Then criteria, and architecture invariants (AD-1..12) are consistently restated where stories need them. Proceed to implementation.

---
*Assessed by Winston (System Architect) via bmad-check-implementation-readiness, 2026-07-16.*
