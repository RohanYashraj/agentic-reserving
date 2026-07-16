# PRD Quality Review — Reserving Copilot

Run inline (non-interactive session; no subagents dispatched). Reviewed: prd.md + addendum.md against the PRD quality rubric, stakes = portfolio build with a real-team Stage-2 bar (between internal and launch rigor).

## Overall verdict

The PRD has a real thesis — the calculation firewall as product — and every feature group serves it; done-ness is strong, with testable consequences on all 20 FRs and quantified NFRs. The main risks are external, not documentary: the unresolved model-provider question (OQ-1) and the missing design partner (OQ-2) are honestly surfaced but will gate the agent layer and Stage 2 respectively. Safe to hand to UX/architecture/epics now.

## Decision-readiness — strong

Decisions are stated as decisions (two-role model mandatory; hard-reject validation; Word-only export) with rejected alternatives recorded in the addendum. Open Questions are genuinely open, each with owner and revisit condition. No findings.

## Substance over theater — strong

No persona theater (three user classes, each driving decisions: the tertiary auditor class motivates FR-15/16 directly). NFRs carry product-specific thresholds (Taylor-Ashe golden tests, 99.9% job reliability, 100% audit coverage) rather than boilerplate. Counter-metrics (SM-C1 override-rate, SM-C2 time-to-report) are unusually substantive — they encode a real product philosophy, not furniture.

## Strategic coherence — strong

Thesis: deterministic core + provenance-verified narrative shell is the only defensible AI shape for regulated reserving. MVP scope is problem-solving kind; scope cuts (no in-app triangle editing, Word-only export) follow the "honest validation boundary" logic rather than effort minimization. SM-2 validates the thesis directly.

## Done-ness clarity — strong

Every FR has ≥1 testable consequence; the softest is FR-20's "clear state at each step" but its consequences (reactive propagation, server-held resume state) are concrete.

### Findings
- **low** Interpretation latency bound is soft (§7 NFR-7) — "single-digit minutes" tagged as assumption; acceptable for v1 but architecture must set the budget. *Fix:* already flagged via assumption; no PRD change needed.

## Scope honesty — strong

Non-Goals does real work (permanent LLM-calculation ban stated as constitution). 11 indexed assumptions + 6 OQs is proportionate to stakes; none are phase-blockers for UX/architecture. OQ-1 is a soft blocker for the agent-layer build specifically — sequenced correctly since the agent layer is last in build order.

### Findings
- **medium** OQ-6 (incurred monotonicity) touches FR-2's validation contract (§4.1) — if incurred rules differ materially, the ingestion FR consequences change. *Fix:* resolve with actuarial input before ingestion epic is written, not before architecture.

## Downstream usability — strong

Glossary is complete and used verbatim; FR-1..20, UJ-1..3, SM/NFR/OQ IDs contiguous; cross-references resolve. Chain-top PRD, treated as such.

## Shape fit — strong

Multi-stakeholder B2B with meaningful UX → named-protagonist UJs (Dana, Priya) are load-bearing and present; regulated-domain clusters (Constraints/Guardrails, audit posture) pulled in appropriately.

## Mechanical notes

- Assumptions Index roundtrip: one bare inline `[ASSUMPTION]` tag (§8 Privacy, data residency) lacked descriptive text while its index entry carried it — fixed during review.
- No glossary drift detected ("Origin Period" used consistently over "accident year" except where the brief's language is quoted; UJ prose uses "accident year" once in UJ-2 — acceptable as persona-voice, but noted).
