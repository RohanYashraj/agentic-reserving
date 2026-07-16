# Addendum — Reserving Copilot Product Brief

Depth that belongs downstream (PRD, architecture) but not in the brief body.

## Rejected alternative: Claude API as the LLM layer

The original concept named the Claude API for the agentic layer. The technical research (2026-07-16) recorded two scope amendments — LLM layer changed to Google Gemini (`gemini-3.1-flash-lite`) and the Agno framework mandated for agent orchestration — and validated that combination end-to-end (pricing, function calling, structured output, thought-signature handling via the official `google-genai` SDK). Rohan confirmed on 2026-07-16 that the brief commits to Gemini + Agno. The model ID remains a config value; Agno is model-agnostic across 30+ providers, so a swap to Claude (or a heavier Gemini model, if flash-lite proves too light for nuanced actuarial narrative) is an eval-driven configuration change, not a rearchitecture.

## Technical constraints carried into the PRD/architecture phase

Source: [technical research report](../../research/technical-agentic-insurance-reserving-stack-research-2026-07-16.md) — authoritative for all items below.

- **Three-plane architecture**: TypeScript product plane (Next.js + Clerk + Convex), Python computation+agent plane (chainladder + FastAPI + Agno AgentOS, one Cloud Run container), Gemini model plane behind Agno's abstraction.
- **Convex is the sole system of record**, including the audit log; Agno sessions hold transient state only. To be ratified as an ADR before the agent layer is built.
- **Orchestration**: job-record-first; `@convex-dev/workflow`/`workpool` for durable execution; design for async 202 + HMAC-signed callback even if v1 awaits synchronously; idempotency keyed by Convex job ID.
- **Known traps identified pre-build**: Gemini 3.x thought signatures in tool loops (use official SDK); retry double-computation (idempotency); dual audit sources (ADR above).
- **Build sequencing**: engine + golden tests first → product spine → durable orchestration → agent layer last → hardening.

## Regulatory context (medium confidence — needs counsel/appointed-actuary review)

NAIC AI Model Bulletin adopted in 25+ states and D.C. requires documented AI governance, data provenance, and model validation; EU AI Act treats insurance pricing as high-risk with logging and human-oversight obligations. The audit posture (append-only hash-chained log, full LLM interaction records, logged human review decisions, deterministic lineage) was designed against this backdrop, but its regulatory *sufficiency* has not been professionally reviewed.

## Competitive positioning notes

Positioning chosen: challenger to incumbent reserving platforms (WTW ResQ, Milliman Arius, Moody's Axis) rather than an Excel-replacement play or a complement layer. Rationale: the differentiator (AI-native provenance-gated interpretation) is only legible against platforms that already compute well. Open verification item flagged in the brief: current AI roadmaps of ResQ/Arius have not been researched — a `bmad-market-research` run is recommended before any external-facing positioning.

## Stakes and sequencing tension (acknowledged, not hidden)

This is a portfolio/learning build whose v1 success bar is a real reserving team completing a real quarter. The staged success criteria (credible demo → real team) exist precisely to bridge that gap. Reaching Stage 2 requires a design-partner relationship not yet identified — the largest non-technical risk to the v1 bar.
