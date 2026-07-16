# Review — Adversarial divergence lens

Attack: construct two units one level down that obey every AD yet build incompatibly.

**Verdict: 3 holes found (2 high, 1 medium), all closable with tightened rules.**

## Finding 1 (high) — Triangle hash basis undefined
AD-11 says Lineage records "triangle sha256"; FR-1 wants byte-identical duplicate detection. Builder A hashes the raw uploaded file; Builder B hashes the canonical parsed triangle JSON. Both are compliant; re-derivation (FR-6) and duplicate detection then disagree across the codebase.
**Fix:** convention row defining both hashes: raw-file sha256 for duplicate detection at upload; canonical-triangle-JSON sha256 as *the* Triangle hash used in Lineage.

## Finding 2 (high) — Gate scope over human edits ambiguous
AD-5 gates the agent's draft. An Analyst then edits the report (FR-13) and can type new numbers. Builder A re-runs the gate on every human edit (blocking legitimate human-authored commentary); Builder B never re-checks (a typo'd figure ships). Both are AD-5-compliant.
**Fix:** state the boundary in AD-5: the gate governs machine-drafted content only; human edits are human-owned, audit-logged, and surfaced at approval (approver signs the exact content version) — consistent with PRD §4.5 "human-owned artifact".

## Finding 3 (medium) — Audit completeness under synchronous orchestration
AD-3 + AD-6 route LLM transcripts through the Convex action for audit append. If the action dies mid-interpretation (timeout, crash), the transcript held in engine_service memory is lost — violating NFR-5's "100% of LLM interactions" on exactly the failure path an auditor would probe.
**Fix:** acknowledge in Deferred with a trigger condition tied to the async-callback upgrade (incremental transcript flush per tool-turn, or engine-side spool returned on retry). Not a v1 blocker if interpretation failures are rare and logged as failures, but the gap must be a recorded decision, not silence.

## Probed and held (no finding)
- Who writes runs status: single orchestration path (AD-7) — no second writer possible.
- Engine-Only Mode derivation: server-side, single derivation point (AD-9).
- auditLogs writers: single mutation (AD-6).
- Role source of truth: Clerk org roles only, no Convex duplication (AD-4).
- Numbers in UI: display-formatting-only rule (AD-1) blocks frontend arithmetic.
