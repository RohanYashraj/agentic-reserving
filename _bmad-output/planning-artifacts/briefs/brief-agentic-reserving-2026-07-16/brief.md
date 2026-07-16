---
title: "Product Brief: Reserving Copilot"
status: final
created: 2026-07-16
updated: 2026-07-16
---

# Product Brief: Reserving Copilot

## Executive Summary

Reserving Copilot turns the quarterly P&C reserving review from a days-long spreadsheet exercise into an hours-long, fully auditable workflow. An actuary uploads paid and incurred claims triangles; a deterministic Python engine (built on the `chainladder` package) computes development factors, ultimates, IBNR and Mack reserve ranges across Chain Ladder, Bornhuetter-Ferguson and Mack; and an agentic LLM layer then does the work that consumes most of the actuary's time today — interpreting the diagnostics, recommending a method per accident year with stated reasons, and drafting the reserve report with actuarial commentary.

The defining commitment is a hard architectural rule: **the LLM never performs a calculation.** Every number originates in the deterministic engine; the AI layer only reads validated outputs through typed, read-only tools, and every sentence it drafts is traceable to a specific diagnostic. Combined with an append-only audit log and full computational lineage (engine version, triangle hash, parameters), this makes the tool defensible in exactly the regulated context — NAIC AI governance expectations, appointed-actuary sign-off — where generic AI tooling fails.

Why now: the reserving methods are decades-old and commoditized; the bottleneck is interpretation and documentation, which is precisely what LLMs became good at. Incumbent platforms (WTW ResQ, Milliman Arius) automate the arithmetic but leave the narrative work manual. Reserving Copilot is built AI-native from the start, with the guardrails regulated actuarial work demands.

## The Problem

A quarterly reserving review at a P&C insurer or consultancy typically runs three to five days per portfolio segment. The calculation itself is minutes of that. The days go to: eyeballing link-ratio stability across hundreds of development factors, reconciling actual-vs-expected emergence, judging when Chain Ladder should give way to Bornhuetter-Ferguson for green accident years, cross-checking method divergence, and then writing it all up in a report a reviewing actuary and regulator will accept.

Today's coping mechanisms each fail differently:

- **Excel workflows** (still the modal reality) are flexible but irreproducible — link formulas break, judgment lives in someone's head, and the audit trail is an email thread.
- **Incumbent platforms** (ResQ, Arius, Axis) compute reliably but stop at the numbers. The diagnostic interpretation and report drafting — the majority of the elapsed time — remain manual. They are also expensive, desktop-era tools whose workflow remains single-analyst even when licensed enterprise-wide.
- **Generic LLM use** (pasting outputs into a chatbot) is fast but indefensible: no provenance, no reproducibility, hallucinated numbers, nothing an appointed actuary can sign.

The cost of the status quo is not just elapsed time. It is review cycles compressed against filing deadlines, judgment applied inconsistently across quarters, and documentation written under pressure — the exact conditions under which reserving errors and regulatory findings occur.

## The Solution

A web application where a reserving team:

1. **Uploads** paid and incurred triangles (CSV/Excel) into a shared team workspace. Validation happens once at the boundary; every triangle is content-hashed.
2. **Runs** the deterministic engine: development triangles, LDFs, Chain Ladder, Bornhuetter-Ferguson and Mack via the `chainladder` package — ultimates, IBNR, and Mack standard-error reserve ranges per method, per accident year. Results carry full lineage (engine version, package version, triangle hash, parameters) so any number is reproducible indefinitely.
3. **Reviews the AI interpretation**: an agentic layer reads the validated diagnostics — LDF stability, actual-vs-expected, residual patterns, method divergence — through read-only, schema-typed tools, recommends a method per accident year with explicit reasons, and drafts the reserve report with actuarial commentary. A programmatic provenance gate rejects any drafted number that lacks a tool-response source.
4. **Signs off**: the actuary reviews, edits, and approves the draft. The review decision is logged. Everything — every run, every LLM interaction, every approval — lands in an append-only, hash-chained audit log.

The experience compresses the review from days to hours while *strengthening* rather than weakening the audit posture: the tool's output is more traceable than the manual process it replaces.

**Technical shape** (validated in the accompanying [technical research report](../../research/technical-agentic-insurance-reserving-stack-research-2026-07-16.md)): Next.js web app with Clerk authentication and team workspaces; Convex as reactive backend and single system of record (triangles, runs, results, audit log); a stateless Python service (FastAPI + `chainladder` + the Agno agent framework, one Cloud Run container) as the computation and agent plane; Gemini (`gemini-3.1-flash-lite`, config-swappable) as the interpretation model.

## What Makes This Different

- **The calculation firewall is the product.** Incumbents compute without interpreting; chatbots interpret without computing trustworthily. The architectural separation — deterministic core, narrative shell, provenance-verified seam — is the differentiator, and it is honest: it exists because regulated actuarial work demands it, not as marketing.
- **AI-native where incumbents are AI-retrofitted.** ResQ and Arius are mature desktop-era platforms; adding a defensible LLM layer to them means retrofitting audit and provenance into architectures that predate the requirement. Building the guardrails first is a genuine structural advantage — though incumbents' distribution, actuarial credibility, and breadth of methods are real moats this product does not yet have. [ASSUMPTION: incumbents have not yet shipped provenance-gated LLM interpretation; verify current ResQ/Arius AI roadmaps before external positioning.]
- **Collaborative by default.** Team workspaces, shared runs, live status, and a common audit trail replace the file-passing workflow of desktop tools.
- **Reproducibility as a feature, not a burden.** Version-pinned engine with golden-triangle regression tests against published CAS results; every historical figure re-derivable from stored lineage.

What this is *not*: it does not compete on breadth of stochastic methods, on integration with policy/claims systems, or on decades of actuarial-firm trust. In v1 the honest claim is a narrower, deeper one — the fastest defensible path from triangle to signed reserve report.

## Who This Serves

**Primary: the reserving actuary** at a P&C insurer or consultancy who owns the quarterly review. They need the diagnostics interpreted consistently, the method-selection reasoning made explicit, and the report drafted — without surrendering judgment or signability. Success for them: a quarter closed in hours, a report they were proud to sign, and an answer for any auditor who asks "where did this number come from."

**Secondary: the actuarial analyst** who prepares triangles and runs the mechanics today. The tool absorbs their most tedious work (data wrangling, factor eyeballing, first-draft commentary) and makes their output reviewable rather than opaque.

**Tertiary: the reviewing/appointed actuary and auditors**, who consume the audit trail. They never touch the upload flow, but the product wins or dies on whether they accept its output.

## Success Criteria

Staged, honestly reflecting that this begins as a portfolio-grade build with real-team ambition:

**Stage 1 — Credible demo (build milestone):** full pipeline runs on published/realistic triangles; engine reproduces known CAS benchmark results exactly (golden tests green); zero interpretation numbers without tool provenance (hard gate, continuously verified); audit log passes append-only/hash-chain verification.

**Stage 2 — v1 success (the bar):** one real reserving team completes an actual quarterly review end-to-end in the tool — upload through signed report — in hours rather than days, and the report is accepted by their reviewing actuary without a parallel Excel re-run.

**Measurable throughout:** 100% of results reproducible from stored lineage; job completion reliability ≥ 99.9% including retries; every LLM interaction, tool call, and human review decision present in the audit log.

## Scope

**In for v1:**
- CSV/Excel triangle upload with boundary validation; paid and incurred
- Chain Ladder, Bornhuetter-Ferguson, Mack (ultimates, IBNR, Mack ranges) via `chainladder`
- Diagnostics: LDF stability, actual-vs-expected, residual patterns, method divergence
- Agentic interpretation: per-accident-year method recommendation with reasons; drafted reserve report with commentary; provenance gate; human review-and-approve step
- Multi-user team workspaces (Clerk organizations): shared triangles, runs, reports
- Append-only audit logging and full computational lineage

**Explicitly out of v1:**
- Stochastic reserving beyond Mack (no bootstrap/ODP, no GLM reserving)
- ORSA and IFRS 17 reporting outputs
- On-premise deployment
- Integration with policy admin / claims systems
- The LLM performing, adjusting, or overriding any calculation — permanently out, not just v1

## Vision

If v1 proves that a provenance-gated AI layer can carry real reserving reviews, the trajectory is: broaden the method set (bootstrap, Cape Cod, GLM) behind the same firewall; add cross-quarter memory so the copilot flags emergence trends and assumption drift over time; grow report outputs toward regulatory formats (ORSA, IFRS 17); and position as the AI-native challenger in a category whose incumbents must retrofit what this product was born with. In three years, the ambition is that "traceable AI commentary" is table stakes in reserving software — and this product defined the standard.
