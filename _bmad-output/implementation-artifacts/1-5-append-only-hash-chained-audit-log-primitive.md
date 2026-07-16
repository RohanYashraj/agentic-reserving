---
baseline_commit: 8cce62653fdaf518bc69e957898ed16c8876a093
---

# Story 1.5: Append-Only Hash-Chained Audit Log Primitive

Status: done

## Story

As a reviewing actuary,
I want every consequential event recorded in an append-only, tamper-evident log,
so that the audit trail is trustworthy from the first event onward. (FR-15 foundation, NFR-5)

## Acceptance Criteria

1. **Given** the Convex schema, **When** `auditLogs` is defined, **Then** exactly one internal mutation `appendAuditEntry` writes to it, entries carry `workspaceId`, optional `runId`, actor, event type, ISO-8601 UTC timestamp, and payload, and each entry's `hash = sha256(canonicalJSON(entry) + prevHash)` chains per Workspace (AD-6).
2. **And** concurrent appends serialize correctly under Convex OCC (retry on conflict, verified by test).
3. **Given** the test suite, **When** it runs, **Then** a convex-test asserts no code path updates or deletes an audit row (append-only, FR-15).
4. **And** a verification query re-walks a Workspace's chain and returns valid for an intact chain and the first broken link for a tampered fixture.
5. **And** sign-in-driven events available at this point (e.g. member role change) are appended through `appendAuditEntry`.

## Tasks / Subtasks

- [x] Task 1: Pure chain helpers — `convex/lib/auditChain.ts` (AC: 1, 4)
  - [x] 1.1 `canonicalJSON(value): string` — deterministic serialization: recursively sort object keys (lexicographic), arrays keep order, primitives via `JSON.stringify`. Throw on `undefined`, functions, or non-JSON values (fail loud — a non-canonicalizable payload must never silently produce a divergent hash). This is the project-wide canonical-JSON definition for the audit chain; document that in the module docstring.
  - [x] 1.2 `computeEntryHash(entry, prevHash): Promise<string>` — `sha256(canonicalJSON(entry) + prevHash)` as lowercase hex, via `crypto.subtle.digest("SHA-256", new TextEncoder().encode(...))`. `SubtleCrypto` is supported in the Convex default runtime (verified against docs.convex.dev/functions/runtimes 2026-07-16) and in vitest edge-runtime. `entry` is the hashable projection — exactly `{ workspaceId, runId?, actor, eventType, timestamp, payload, seq }`, where `runId` is OMITTED from the object when the event has no Run (not set to `undefined`/`null` — canonicalJSON rejects `undefined`, and this omission is part of the frozen contract; wording amended at code review 2026-07-16 to match) (NO `hash`, NO `prevHash` inside the object; prevHash is concatenated per the AD-6 formula). Export the projection type so append and verify share one definition.
  - [x] 1.3 Export `GENESIS_PREV_HASH = ""` (first entry of a Workspace chains from the empty string). Constant, documented — the verification walk and any future external verifier depend on this exact convention.
  - [x] 1.4 Unit tests (TDD, red first) in `convex/lib/auditChain.test.ts`: key-order invariance (`{a,b}` ≡ `{b,a}`), nested objects/arrays, throw on `undefined`, determinism across calls, and one pinned known-answer hash vector (compute once, assert literal hex — protects the canonicalization contract against accidental change).
- [x] Task 2: Schema — `auditLogs` table (AC: 1)
  - [x] 2.1 `convex/schema.ts`: first real table. Fields: `workspaceId: v.string()`, `runId: v.optional(v.string())`, `actor: v.string()`, `eventType: v.string()`, `timestamp: v.string()` (ISO-8601 UTC), `payload: v.any()`, `seq: v.number()` (per-Workspace, 0-based, contiguous), `prevHash: v.string()`, `hash: v.string()`, `dedupeId: v.optional(v.string())`.
  - [x] 2.2 Indexes: `by_workspace_seq` on `["workspaceId", "seq"]` (chain walk + latest-entry lookup); `by_workspace_dedupe` on `["workspaceId", "dedupeId"]` (webhook idempotency, Task 4).
- [x] Task 3: The single writer — `convex/auditLogs.ts` `appendAuditEntry` (AC: 1, 2)
  - [x] 3.1 `internalMutation` `appendAuditEntry` with args = the pinned `recordEventArgs` shape from `convex/audit.ts` (`workspaceId`, `actor`, `eventType`, `payload`, optional `runId`) **plus** `dedupeId: v.optional(v.string())`. Export the args object (tests pin it, same pattern as 1.4). `internalMutation` by design: never public, exempt from `requireMember` (AD-4 governs public functions).
  - [x] 3.2 Handler: (a) if `dedupeId` present, look up `by_workspace_dedupe`; on hit return the existing entry's `{ seq, hash }` without inserting (idempotent replay — closes the 1.4 svix-id deferred item); (b) read the Workspace's latest entry via `by_workspace_seq` descending `.first()`; (c) `seq = latest ? latest.seq + 1 : 0`, `prevHash = latest?.hash ?? GENESIS_PREV_HASH`; (d) `timestamp = new Date(Date.now()).toISOString()` (Convex freezes `Date.now()` per mutation execution — deterministic, allowed); (e) compute hash via `computeEntryHash`; (f) `ctx.db.insert("auditLogs", ...)`; return `{ seq, hash }`.
  - [x] 3.3 Concurrency note to encode in a comment: the latest-entry read puts the chain head in the mutation's read set, so two concurrent appends to the same Workspace conflict under Convex OCC and the runtime retries one automatically — serialization is by construction, no manual retry code. Convex mutations are automatically retried on OCC conflict (docs.convex.dev, OCC & atomicity).
  - [x] 3.4 Delete the `convex/audit.ts` stub. Move/re-export nothing — `appendAuditEntry` in `convex/auditLogs.ts` is the one writer with a distinct name (1.4 chose the names deliberately). Update `convex/http.ts` to call `internal.auditLogs.appendAuditEntry`, passing the webhook's `svix-id` header as `dedupeId`. Run `npx convex codegen` after (stale `_generated/api` bit 1.4).
  - [x] 3.5 Tests (TDD) in `convex/auditLogs.test.ts` via `convexTest(schema, modules)` + `t.mutation(internal.auditLogs.appendAuditEntry, ...)`: first entry has `seq 0` + `prevHash === GENESIS_PREV_HASH`; second chains (`prevHash === first.hash`, `seq 1`); chains are per-Workspace independent (append to org_A and org_B, each starts at seq 0); `runId` stored when given; same `dedupeId` twice → one row, identical return; `Promise.all` of ~10 parallel appends to one Workspace → seq values are exactly 0..9, no gaps or duplicates, chain verifies end-to-end (AC 2; see Dev Notes on convex-test OCC fidelity).
- [x] Task 4: Verification query — `verifyChain` (AC: 4)
  - [x] 4.1 Public query `verifyChain` in `convex/auditLogs.ts`, args `{ workspaceId: v.string() }`, **first statement `requireMember(ctx, workspaceId)`** (AD-4 — this is the story's first public function; the enumeration test has teeth, see 4.3). Walks the Workspace's entries in `seq` order re-computing each hash with `computeEntryHash`; returns `{ valid: true, length }` for an intact chain, or `{ valid: false, brokenAtSeq, reason }` for the FIRST broken link — where `reason` distinguishes hash mismatch, prevHash-linkage mismatch, and seq gap. Empty chain is valid with `length: 0`.
  - [x] 4.2 v1 walks the full chain in one query (fine at this volume). Leave a comment: pagination/cursor is Epic 7's concern when the Audit Log browser lands (FR-16 surface).
  - [x] 4.3 Register `verifyChain` in `publicFunctionArgs` in `convex/authGuard.test.ts` (the registry fails the suite on unregistered public functions — this is by design from 1.4; give it `{ workspaceId: "org_test" }`).
  - [x] 4.4 Tests (TDD): unauthenticated → rejects (enumeration also covers it); member of org_A verifying org_A with an intact multi-entry chain → valid; **tampered fixture**: build a chain, then mutate one row directly via `t.run(ctx => ctx.db.patch(...))` — the test harness's raw db handle, NOT an app code path — altering (a) a payload field → `brokenAtSeq` = that entry, (b) a `hash` → detected at that entry or the successor's linkage, (c) delete a middle row via `t.run` → seq-gap detected; member of org_A verifying org_B → FORBIDDEN.
- [x] Task 5: Append-only enforcement test (AC: 3)
  - [x] 5.1 `tests/audit-append-only.test.ts` — lives in the "unit" vitest project (node env) because it needs `fs` to read source, and everything matching `convex/**/*.test.ts` runs under edge-runtime (no `fs`): scan all deployed `convex/**/*.ts` sources (exclude `_generated`, `*.test.ts`), assert (a) exactly one `db.insert("auditLogs"` call site, and it is inside `appendAuditEntry` in `convex/auditLogs.ts`; (b) zero occurrences of `patch`/`replace`/`delete` in `convex/auditLogs.ts` outside test files (the only module that handles auditLogs docs). This is a convention guard, not a proof — a `db.patch(id)` elsewhere is invisible to table-name grep. State that limitation in a comment; the runtime complement is that no other module ever queries auditLogs ids today, and code review owns the residual (AD-6 is also verified by review, per the spine).
  - [x] 5.2 Runtime side: assert `appendAuditEntry` is the module's only registered writer — enumerate `convex/auditLogs.ts` exports and assert no other mutation exists there; `verifyChain` is a query (queries cannot write by construction).
- [x] Task 6: Webhook events flow through the chain (AC: 5)
  - [x] 6.1 `convex/http.test.ts` updates: a validly-signed `organizationMembership.updated` delivery now lands a real `auditLogs` row — assert via `t.run` that the row exists with `eventType "member.role_changed"`, correct `workspaceId`/`actor`, `seq 0`, valid hash; redelivering the SAME signed payload with the same `svix-id` → still exactly one row (closes deferred item: replay idempotency).
  - [x] 6.2 Now assertable (deferred from 1.4): invalid-signature request → 400 AND zero `auditLogs` rows (`t.run` count).
  - [x] 6.3 Deferred-item decision — recognized `organizationMembership.*` event missing `organization.id`: change `convex/http.ts` to return **500** (so Svix retries) instead of silently acking 200, distinguishing it from genuinely ignored event types (`mapMembershipEvent` returns a discriminated result or http.ts checks event.type against the known map before calling it). Rationale: NFR-5 demands audit completeness; a membership change we recognize but cannot attribute to a Workspace must fail loud, not vanish. Test both paths (unknown type → 200 null; known type + missing org id → 500). **Flag this behavior change for review.**
  - [x] 6.4 Event taxonomy deferred item (`updated` → always `member.role_changed`): keep as-is; payload preserves the full Clerk event for disambiguation. Document the decision in `convex/lib/clerkWebhook.ts`'s existing comment block; do not build taxonomy machinery this story.
- [x] Task 7: Docs + deferred-work bookkeeping
  - [x] 7.1 README: short "Audit Log" subsection — AD-6 invariant (one writer, hash chain, genesis convention), `verifyChain` exists, webhook events audit-persisted.
  - [x] 7.2 `_bmad-output/implementation-artifacts/deferred-work.md`: strike through the three 1.4 items this story closes (svix-id replay, invalid-signature non-invocation assertion, missing-org-id decision) with resolution notes; annotate the taxonomy item as decided-kept.
- [x] Task 8: Verification (all ACs)
  - [x] 8.1 Full battery, all green, documented in Dev Agent Record: `npm run lint`, `npx tsc --noEmit`, `npx tsc --noEmit -p convex`, `npm test` (both vitest projects), `npm run build`, `npx convex dev --once` (schema + functions deploy clean; test files stay excluded via `.convexignore`).
  - [x] 8.2 Live check (dev deployment `benevolent-clam-376`): flip the test user's role in the Clerk dashboard (Rohan drives dashboard actions), then confirm via `npx convex logs --success` (webhook → `auditLogs:appendAuditEntry`) and the Convex dashboard data view that a chained row landed; run `verifyChain` from the dashboard function runner → valid.

### Review Findings

- [x] [Review][Decision] 500-on-unattributable membership events can become a poison-message retry loop — a recognized event permanently missing `organization.id` will 500 on every Svix redelivery forever; sustained failures can lead Svix/Clerk to disable the endpoint, silently stopping ALL audit capture. The 500 was this story's deliberate NFR-5 decision (Task 6.3, flagged for review). **Resolved 2026-07-16: keep the 500.** Rationale: fail loud per NFR-5; Clerk always sends `organization.id` on membership events, so the retry loop only fires on genuinely anomalous deliveries and retry exhaustion is itself a visible signal. Revisit alerting/dead-letter handling in Epic 7 if it ever fires.
- [x] [Review][Patch] Prototype-unsafe event-type checks: `event.type in MEMBERSHIP_EVENT_TYPES` walks the prototype chain (a signed event with `type: "toString"` is treated as recognized → 500 loop), and `MEMBERSHIP_EVENT_TYPES[event.type]` in the mapper returns inherited functions that survive the `=== undefined` guard. Use `Object.hasOwn` / typeof guard + regression test [convex/http.ts:64, convex/lib/clerkWebhook.ts:44]
- [x] [Review][Patch] `canonicalJSON` silently serializes non-plain objects (Date, Map, Set, class instances) as `{}` via `Object.keys`, contradicting its fail-loud doc contract — reject values whose prototype is neither `Object.prototype` nor `null` [convex/lib/auditChain.ts:57]
- [x] [Review][Patch] Webhook flow-through test asserts hash *format* only (`/^[0-9a-f]{64}$/`), not hash *validity* — Task 6.1 says "valid hash"; recompute via `computeEntryHash` so a wrong-projection regression on the webhook path (e.g. hashing `dedupeId`) fails [convex/http.test.ts:145]
- [x] [Review][Patch] Dedupe replay silently swallows divergent content — a repeated `dedupeId` with *different* event content returns the original `{seq, hash}` with no detection; log a warning when the replayed projection differs from the stored row [convex/auditLogs.ts:31]
- [x] [Review][Patch] Comment claims `Date.now()` is "deterministic across OCC retries" — Convex freezes it per execution, and a retry is a fresh execution; correctness doesn't need cross-retry determinism, so fix the comment before someone builds on the false invariant [convex/auditLogs.ts:58]
- [x] [Review][Patch] Hashable-projection literal is copy-pasted in writer, verifier, and twice in tests (already drifting: one test omits the runId spread) — extract a shared projection helper in `auditChain.ts` [convex/auditLogs.ts:66]
- [x] [Review][Patch] 500-path error log always says "missing organization.id" even when `event.data` is null/non-object — broaden the message to "unattributable (missing/invalid data or organization.id)" [convex/http.ts:70]
- [x] [Review][Patch] Task 1.2 wording says the hashable projection is "exactly `{ workspaceId, runId, ... }`" but the frozen contract (and spec-mandated `canonicalJSON` throw on `undefined`) omits `runId` when absent — amend the story wording so spec and pinned contract agree [story file Task 1.2]
- [x] [Review][Defer] Tail truncation is undetectable: deleting the last N rows (or the whole chain) verifies `{valid: true}` — hash chains without an anchored head/length are only tamper-evident for interior mutation. Address with an external anchor or persisted chain-head expectation in Epic 7 (story 7-2 chain verification) [convex/auditLogs.ts:100] — deferred to Epic 7
- [x] [Review][Defer] `verifyChain` does an unbounded `.collect()` — hits Convex read limits (~16k docs / 8 MiB) on large chains and throws instead of degrading; pagination already deferred to Epic 7 in the code comment [convex/auditLogs.ts:109] — deferred to Epic 7
- [x] [Review][Defer] `appendAuditEntry` accepts any `eventType` string and unbounded payload — fine while the 3-value mapper is the only caller; add a vocabulary/validator and payload-size stance when new event producers land [convex/auditLogs.ts:20] — deferred, revisit with next event producer
- [x] [Review][Defer] Duplicate `(workspaceId, seq)` rows (indexes are non-unique) are reported by `verifyChain` as `seq_gap` — misleading forensic label; extend the reason taxonomy if Epic 7 forensics need the distinction [convex/auditLogs.ts:113] — deferred to Epic 7

## Dev Notes

### Architecture compliance (non-negotiable)

- **AD-6 is this story.** Exactly one internal mutation `appendAuditEntry` writes `auditLogs`; no code path patches or deletes rows; per-Workspace chain `hash = sha256(canonicalJSON(entry) + prevHash)`; OCC serializes concurrent appends; a verification query re-walks the chain. Every later epic writes through this primitive — the interface you ship here is the one FR-15's full event stream (LLM transcripts, gate rejections, approvals, exports, mode transitions) will flow through.
- **Hashable-entry definition is a permanent contract.** What goes into `canonicalJSON(entry)` (field set, key ordering, genesis constant, hex encoding) can never change without breaking verification of pre-existing chains. Get it reviewed via the pinned known-answer test vector (Task 1.4). Include `seq` in the hashed projection so reordering is tamper-evident, exclude `hash`/`prevHash` from the object (prevHash enters via concatenation, exactly as AD-6 writes the formula).
- **This hash is neither of the two Triangle hashes.** Raw-file sha256 and canonical-triangle-JSON sha256 (Epic 2/3) are distinct concerns — don't share helpers or names beyond the generic sha256 primitive (Consistency Conventions: "two distinct hashes, never conflated" — this chain hash is a third, audit-only concept).
- **AD-4 still applies**: `verifyChain` is public → `requireMember(ctx, workspaceId)` first statement, and it MUST be registered in `publicFunctionArgs` (the 1.4 enumeration test fails loudly otherwise — that friction is intentional). `appendAuditEntry` is `internalMutation` → exempt, same reasoning as the 1.4 stub.
- **Vocabulary/naming**: table `auditLogs` (plural camelCase), functions in per-table file `convex/auditLogs.ts`, `Workspace` == Clerk org ID string (`workspaceId: v.string()` — still no `workspaces` table, no role/membership state in Convex). Timestamps ISO-8601 UTC. Errors via `ConvexError` `{ code, message }`.
- **Operational logs are not the audit trail** (Consistency Conventions) — `console.error` in http.ts stays operational; only `appendAuditEntry` rows are the record.

### Existing files being modified — current state

- [convex/schema.ts](convex/schema.ts) — `defineSchema({})` with a just-in-time comment. **Change**: add `auditLogs` (Task 2). First real table in the project.
- [convex/audit.ts](convex/audit.ts) — `recordEvent` internalMutation stub with exported `recordEventArgs`, handler `async () => {}`. **Change: delete** (Task 3.4). Its args shape is the contract `appendAuditEntry` adopts (plus `dedupeId`); the interface-pin test in http.test.ts moves to pin `appendAuditEntry`'s args instead.
- [convex/http.ts](convex/http.ts) — Svix-verified `POST /clerk-users-webhook`; calls `internal.audit.recordEvent(auditable)` at line 62; returns 200 `{recorded: null}` for unmapped events (including the missing-org-id case — being changed to 500 by Task 6.3). **Change**: call `internal.auditLogs.appendAuditEntry` with `dedupeId: svixId`; split "unknown event type" (200) from "recognized but unattributable" (500). **Preserve**: 500 on missing/malformed secret, 400 on missing/invalid signature, response body shape on success.
- [convex/lib/clerkWebhook.ts](convex/lib/clerkWebhook.ts) — pure mapper, returns `AuditableEvent | null`; null currently conflates "ignore" and "recognized-but-broken". **Change**: let http.ts distinguish those two cases (either a discriminated return or an exported `MEMBERSHIP_EVENT_TYPES` check in http.ts — keep the mapper pure). **Preserve**: actor-is-the-subject semantics (documented review decision — Clerk's payload doesn't carry the acting admin; the audit taxonomy treats webhook `actor` as the affected member).
- [convex/http.test.ts](convex/http.test.ts) — signs payloads in-test with svix (edge-runtime, `btoa` not Buffer); pins `recordEventArgs` shape. **Change**: re-point the interface pin, add Task 6 assertions.
- [convex/authGuard.test.ts](convex/authGuard.test.ts) — registry `publicFunctionArgs` currently empty; suite fails if a public function is unregistered. **Change**: add `"auditLogs:verifyChain"` entry.
- [convex/_generated/*](convex/_generated) — regenerate (`npx convex codegen`) after adding/removing modules.

### Technical facts (verified 2026-07-16)

- **`crypto.subtle.digest("SHA-256", ...)` is available in the Convex default runtime** (docs.convex.dev/functions/runtimes lists crypto, CryptoKey, SubtleCrypto) and in the vitest `edge-runtime` environment the convex test project uses. Async is fine inside mutations. No sha256 npm dependency needed — add none.
- **`Date.now()` inside a Convex mutation is deterministic** (frozen at execution start, consistent across OCC retries of the same execution) — safe for `timestamp`.
- **Convex OCC**: mutations run as serializable transactions; on conflict the runtime retries automatically. Reading the chain head (`by_workspace_seq` desc, `.first()`) makes concurrent same-Workspace appends conflict and serialize. Do not write manual retry loops.
- **convex-test OCC fidelity caveat**: convex-test is a local mock, not the production OCC scheduler; a `Promise.all` race test proves the invariant (contiguous seq, valid chain) under the mock's interleaving but is not a distributed-systems proof. Keep the test (AC 2 demands it), assert the invariant not the mechanism, and note the caveat in the test comment. The live check (Task 8.2) plus Convex's documented mutation semantics carry the rest.
- **convex-test recap from 1.4**: `convexTest(schema, modules)` with modules from explicit-array `import.meta.glob` patterns (the `!(*.*.*)`extglob does NOT work under Vitest 4/tinyglobby — see 1.4 debug log); `t.mutation`/`t.query` accept internal function references; `t.run(ctx => ...)` gives raw db access (use it for tamper fixtures and row-count assertions — it bypasses the single-writer rule by design, test-only); `t.fetch` drives http routes; env stubs via the vitest convex project's `test.env` (CLERK_JWT_ISSUER_DOMAIN is already stubbed there).

### Previous story intelligence (1.4)

- 83/83 tests green at baseline; vitest `test.projects` split: "unit" (node) and "convex" (edge-runtime, `server.deps.inline: ["convex-test"]`). New convex tests go in `convex/**/*.test.ts` and are auto-excluded from deploy by `.convexignore`.
- Review-patch standards to apply from the start: fail fast/loud on misconfiguration; behavioral tests over constant-assertions; fail closed on malformed input (guards reject empty `org_id` — mirror that spirit: reject non-canonicalizable payloads).
- `npx convex logs` shows console output only — pass `--success` to see execution records (bit us in 1.4's live check).
- Webhook URL is region-qualified: `https://benevolent-clam-376.eu-west-1.convex.site/clerk-users-webhook`. Signing secret already set on the deployment; webhook subscribed to the three organizationMembership events. Live role-flips were observed end-to-end in 1.4 — the pipe works, this story just makes it persist.
- Working rhythm: commit only on explicit ask; PR per story branch — you are on `epic_1/1_5` (already created from post-1.4 main).
- Sourcery/GitGuardian PR flags are triaged noise; GitHub Actions is the truth.

### Design decisions this story makes (flagged for review)

- **`seq` column + genesis `""`**: explicit per-Workspace sequence makes gap detection trivial and gives verifyChain a total order independent of `_creationTime` ties. Hashing `seq` inside the entry makes reordering tamper-evident.
- **Dedupe via optional `dedupeId` (svix-id)** rather than making every append idempotent: only at-least-once sources (webhooks) need it; internal callers pass none. Replay returns the original `{seq, hash}` — indistinguishable from the first call.
- **Missing-org-id webhook → 500** (Svix retries) instead of silent 200: audit completeness (NFR-5) outranks webhook-endpoint politeness. Behavior change from 1.4 — reviewer should confirm.
- **Append-only enforcement = source-scan test + single-module convention + review**: a runtime proof that "no code path patches auditLogs" is not expressible in convex-test; the spine itself says "verified by test" for the single-writer rule and review owns the rest. The scan is deliberately strict (fails on any new `insert("auditLogs"` call site).

### Scope boundaries (do NOT build here)

- No Audit Log browser UI, no filters, no chain-verification surface (Epic 7 / FR-16). `verifyChain` is the query primitive only.
- No LLM/run/report event emitters — later epics call `appendAuditEntry` when their events exist. Do not pre-build event-type enums beyond what the webhook emits today (`member.role_changed|added|removed`); `eventType` stays `v.string()`.
- No `runs` table, no `runId` validation beyond `v.optional(v.string())` (the `runs` table is Epic 4; `v.id("runs")` migration happens when the table exists).
- No pagination/cursor on `verifyChain` (Epic 7), no export/archival, no cross-Workspace admin verification.
- No engine work, no frontend work beyond nothing (this story has no UI surface).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.5] — story + ACs; FR-15, NFR-5
- [Source: _bmad-output/planning-artifacts/architecture/architecture-agentic-reserving-2026-07-16/ARCHITECTURE-SPINE.md#AD-6] — single writer, chain formula, OCC, verification; #AD-4 — guard rule for verifyChain; #Consistency Conventions — naming, hashes-never-conflated, "operational logs are not the audit trail"
- [Source: _bmad-output/planning-artifacts/prds/prd-agentic-reserving-2026-07-16/prd.md#FR-15] — append-only acceptance ("table admits inserts only, verified by test"); #NFR-5 — continuously verifiable chain
- [Source: _bmad-output/project-context.md] — anti-patterns (single writer, no updates/deletes), testing rules (convex-test for every function, append-only test)
- [Source: _bmad-output/implementation-artifacts/1-4-workspace-scoping-and-role-guards.md] — recordEvent stub contract, enumeration-registry mechanism, convex-test facts, live env facts, review deferrals inherited here
- [Source: _bmad-output/implementation-artifacts/deferred-work.md#Deferred from: code review of 1-4] — the three items this story closes + taxonomy decision
- [Source: docs.convex.dev/functions/runtimes] — SubtleCrypto in default runtime, verified 2026-07-16

## Dev Agent Record

### Agent Model Used

claude-fable-5 (Amelia, BMad dev-story)

### Debug Log References

- Task 1 red→green: module-missing failure, then 10/11 with a deliberate `KNOWN_ANSWER_PLACEHOLDER`; the pinned vector `60ba5352…8cdc` was cross-verified with an independent node:crypto sha256 over the exact canonical string before pinning (not just echoed from the implementation).
- Task 5 first run: 2 failures — `indexOf("export const appendAuditEntry")` matched `appendAuditEntryArgs` first (fixed by anchoring on `= internalMutation`), and registered Convex functions are functions, not objects (filter now accepts both, same as authGuard.test.ts).
- Full battery (Task 8.1): `npm run lint` clean; `npx tsc --noEmit` and `npx tsc --noEmit -p convex` clean; `npm test` 114/114 across both vitest projects (11 files); `npm run build` clean; `npx convex dev --once` deployed schema + functions to benevolent-clam-376 (2.8s, no errors).

### Completion Notes List

- **Implementation plan followed the story task order exactly**: pure helpers → schema → single writer → verifyChain → append-only scan → webhook flow-through → docs. TDD red-first for Tasks 1, 3, 5 (Task 4's tamper fixtures were authored immediately after the query, all behavioral).
- Hashable projection, canonicalization, genesis `""`, and lowercase-hex encoding are frozen by the pinned known-answer vector in `convex/lib/auditChain.test.ts` — the permanent-contract guard the Dev Notes demanded.
- `appendAuditEntry` omits `runId`/`dedupeId` keys (never stores `undefined`); `canonicalJSON` throws on `undefined` — fail-loud on non-canonicalizable payloads, mirroring 1.4's fail-closed review standard.
- ✅ Resolved review finding [1.4 deferral]: svix-id replay idempotency — optional `dedupeId` + `by_workspace_dedupe` index; replay returns the original `{seq, hash}`; redelivery test proves one row.
- ✅ Resolved review finding [1.4 deferral]: invalid-signature non-invocation — test now asserts 400 AND zero auditLogs rows.
- ✅ Resolved review finding [1.4 deferral]: recognized `organizationMembership.*` event missing `organization.id` now returns **500** (Svix retries) instead of silently acking 200; unknown event types still 200. **Behavior change flagged for review** (NFR-5 rationale in convex/http.ts comment + test).
- Taxonomy deferral decided-kept: `updated` → `member.role_changed` always; decision documented on `MEMBERSHIP_EVENT_TYPES` in convex/lib/clerkWebhook.ts (now exported so http.ts can distinguish ignore vs. broken).
- convex-test OCC caveat encoded in the race test's comment: it proves the invariant (contiguous seq 0..9, intact chain) under the mock, not the distributed retry mechanism; live check covers the rest.
- Live check (8.2) complete: Rohan flipped the test user's role in the Clerk dashboard; two chained rows landed on benevolent-clam-376 (seq 0 genesis `prevHash ""`, seq 1 `prevHash` == seq 0's hash, `eventType member.role_changed`, correct workspaceId/actor, svix-id dedupeIds). Live `verifyChain` (CLI `--identity` mock member) returned `{ valid: true, length: 2 }`. Final regression: 114/114.

### File List

- convex/lib/auditChain.ts (new)
- convex/lib/auditChain.test.ts (new)
- convex/auditLogs.ts (new)
- convex/auditLogs.test.ts (new)
- convex/schema.ts (modified — auditLogs table + indexes)
- convex/audit.ts (deleted — stub replaced by auditLogs.appendAuditEntry)
- convex/http.ts (modified — appendAuditEntry + dedupeId, 500 on unattributable membership events)
- convex/http.test.ts (modified — flow-through, replay, non-invocation, 500-path tests; stub pin removed)
- convex/lib/clerkWebhook.ts (modified — MEMBERSHIP_EVENT_TYPES exported, taxonomy decision documented)
- convex/authGuard.test.ts (modified — auditLogs:verifyChain registered)
- convex/_generated/api.d.ts (regenerated)
- tests/audit-append-only.test.ts (new)
- README.md (modified — Audit Log subsection)
- _bmad-output/implementation-artifacts/deferred-work.md (modified — three 1.4 items struck with resolutions, taxonomy annotated)

## Change Log

- 2026-07-16: Story created via BMad create-story (Amelia) — full context from epics, architecture spine AD-6/AD-4, PRD FR-15/NFR-5, story 1.4 intelligence, live codebase read (audit stub, webhook, guards, test registry), and runtime-capability verification (SubtleCrypto in Convex default runtime).
- 2026-07-16: Story implemented (Amelia) — auditLogs hash-chain primitive (AD-6): canonical-JSON + sha256 helpers with pinned known-answer vector, auditLogs schema + indexes, single-writer appendAuditEntry (OCC-serialized, dedupeId-idempotent), public verifyChain (requireMember-guarded, registered in the enumeration registry), append-only source-scan test, webhook persistence with svix-id dedupe. Addressed code review findings — 3 deferred 1.4 items resolved, 1 decided-kept. 114/114 tests, lint/tsc/build clean, deployed to benevolent-clam-376. Live check (8.2) confirmed: two chained rows on benevolent-clam-376, live verifyChain valid. Status → review.
- 2026-07-16: Code review (adversarial, 3 parallel layers) — 1 decision resolved (keep 500 on unattributable membership events, NFR-5), 8 patches applied (Object.hasOwn prototype-chain fixes in http.ts/clerkWebhook.ts, canonicalJSON rejects non-plain objects, webhook flow-through test recomputes the hash, divergent dedupe-replay warning, Date.now comment corrected, shared `toHashableEntry` projection helper, broadened 500-path log message, Task 1.2 wording aligned), 4 items deferred to deferred-work.md (tail truncation, verifyChain pagination, eventType vocabulary, duplicate-seq label), 4 dismissed. 117/117 tests, lint/tsc/build clean, redeployed to benevolent-clam-376. Status → done.
