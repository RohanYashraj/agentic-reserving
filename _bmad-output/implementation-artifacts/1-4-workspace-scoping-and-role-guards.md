---
baseline_commit: 5b8c513d0f803a6ccd2f1e990e2f9c6d487f52cc
---

# Story 1.4: Workspace Scoping and Role Guards

Status: done

## Story

As a Workspace member,
I want every Convex function to enforce my Workspace membership and role server-side,
so that cross-tenant access and role bypass are impossible regardless of UI state. (FR-18, FR-19, NFR-3)

## Acceptance Criteria

1. **Given** the Convex codebase, **When** any public query/mutation/action is defined, **Then** its first statement is `requireMember(ctx, workspaceId)` verifying Clerk identity plus membership in the Clerk org that is the Workspace (AD-4), **And** `requireRole(ctx, workspaceId, "senior_actuary")` exists for approve/publish/override paths, reading role slugs `analyst`/`senior_actuary` from Clerk org roles in the JWT with no role state duplicated into Convex tables.
2. **Given** the test suite, **When** it runs, **Then** an automated convex-test enumerates all public functions and asserts each rejects unauthenticated calls (NFR-3).
3. **And** a test proves a member of Workspace A cannot read or write Workspace B data at the function layer (FR-18).
4. **And** a member's role change (simulated via Clerk webhook/JWT change) is recorded to the Audit Log once Story 1.5 lands — until then, the event emission point exists with a TODO-free interface stub (FR-19).

## Tasks / Subtasks

- [x] Task 1: Guard module `convex/lib/guards.ts` (AC: 1)
  - [x] 1.1 `requireMember(ctx, workspaceId)`: `const identity = await ctx.auth.getUserIdentity()`; if `null` throw `ConvexError({ code: "UNAUTHENTICATED", message: ... })`. Then verify the JWT's active-org claim equals `workspaceId`; mismatch (or absent org claim) throws `ConvexError({ code: "FORBIDDEN", ... })` — same error for "wrong workspace" and "workspace doesn't exist" so nothing leaks tenancy existence. Return `{ identity, role }` so call sites never re-read claims.
  - [x] 1.2 `requireRole(ctx, workspaceId, role: "senior_actuary" | "analyst")`: calls `requireMember` first, then compares the normalized role slug; failure throws `ConvexError({ code: "FORBIDDEN", ... })`. Type the slugs as a closed union `Role = "analyst" | "senior_actuary"` and export it (vocabulary rule — these exact slugs, no synonyms).
  - [x] 1.3 Normalize Clerk's role claim: Clerk custom org roles are keyed `org:analyst` / `org:senior_actuary` and the `{{org.role}}` shortcode emits that prefixed key — strip a leading `org:` before comparing. **Verify the actual emitted format against the live JWT during Task 2 and adjust the normalizer + its test to match reality** (this is the one externally-owned fact in this story).
  - [x] 1.4 `workspaceId` at this stage IS the Clerk organization ID string (`org_…`) — there is no Convex `workspaces` table and none may be created (roles/membership never duplicated into Convex, AD-4). Validate it as `v.string()` in function args. Guards live in `convex/lib/` (plain helpers, not registered functions — nothing in `lib/` is client-callable).
- [x] Task 2: Clerk JWT template `convex` — org claims (AC: 1)
  - [x] 2.1 The default Convex JWT template does NOT include org claims. In the Clerk dashboard, edit the `convex` template and add claims: `"org_id": "{{org.id}}"`, `"org_role": "{{org.role}}"` (add `"org_slug": "{{org.slug}}"` only if a later display need is already known — otherwise skip). These arrive on `ctx.auth.getUserIdentity()` as custom fields with exactly those key names.
  - [x] 2.2 Verify in the running app (dev server, signed-in test user with an active org) that `getUserIdentity()` actually carries `org_id`/`org_role` — a temporary logged query or the Convex dashboard function runner is fine; remove any scratch code after. Record the observed `org_role` format in the Dev Agent Record (feeds 1.3's normalizer).
  - [x] 2.3 README: extend the Clerk one-time-init section with the two template claims and note that roles `analyst`/`senior_actuary` must exist as custom org roles (the 1.2 README already tells the reader to create them — verify they exist, flag if not).
- [x] Task 3: Role-change event emission point (AC: 4)
  - [x] 3.1 `convex/audit.ts`: internal mutation `recordEvent` — the TODO-free interface stub Story 1.5 replaces. Typed args now, exactly what 1.5's `appendAuditEntry` will need: `{ workspaceId: v.string(), actor: v.string(), eventType: v.string(), payload: v.any(), runId: v.optional(v.string()) }`. Body: a no-op documented as "persistence lands in Story 1.5 (auditLogs, AD-6); interface is stable" — a comment describing the contract is documentation, not a TODO. `internalMutation` — never public, so it is exempt from `requireMember` by design (AD-4 governs public functions).
  - [x] 3.2 `convex/http.ts`: Clerk webhook endpoint `POST /clerk-users-webhook` via `httpRouter` + `httpAction`. Verify the Svix signature (`npm i svix`, lockfile-pinned) using `CLERK_WEBHOOK_SIGNING_SECRET` read from the Convex deployment env (fail the request with 400 on missing/invalid signature — fail-fast pattern from 1.2 review). Handle `organizationMembership.updated` (role change) and `organizationMembership.created`/`.deleted` (membership change) by calling `internal.audit.recordEvent` with `eventType` like `"member.role_changed"`, actor = the webhook's acting user, workspaceId = the org ID from the payload. Unhandled event types return 200 and do nothing.
  - [x] 3.3 Configure the webhook in the Clerk dashboard pointing at the Convex deployment's `.convex.site` HTTP Actions URL, subscribe to the three organizationMembership events, and set `CLERK_WEBHOOK_SIGNING_SECRET` via `npx convex env set` (document both in README; secret never in the repo). Local note: dashboard-driven role changes reach the cloud dev deployment directly — no tunnel needed.
- [x] Task 4: Test infrastructure — convex-test on edge-runtime (AC: 2, 3)
  - [x] 4.1 `vitest.config.mts`: convert to `test.projects` — project "unit" keeps the current include `tests/**/*.test.{ts,tsx}` (node env, per-file jsdom pragmas untouched); project "convex" includes `convex/**/*.test.ts`, `environment: "edge-runtime"`, `server: { deps: { inline: ["convex-test"] } }`. `convex-test` `^0.0.54` and `@edge-runtime/vm` `^5.0.0` are **already in devDependencies** (scaffolded in 1.1) — install nothing for this. Delete the now-satisfied reservation comment in the config.
  - [x] 4.2 Add `convex/tsconfig.json` per Convex's recommended config (moduleResolution bundler, no DOM libs) so `convex/**` stops type-checking under the Next.js DOM program — closes the 1.1 deferred-work item "Root tsconfig.json includes convex/** in the Next.js (DOM-lib) type program". Exclude `convex/**` from the root tsconfig; ensure BOTH programs run in CI (`tsc --noEmit` twice or a composite) — a type error in convex/ must still fail the build.
  - [x] 4.3 Ensure `*.test.ts` files inside `convex/` are not pushed as functions: add `convex/**/*.test.ts` to the ignore mechanism (`.convexignore` if supported by the current convex CLI, else verify `npx convex dev --once` tolerates them; test files must never deploy).
- [x] Task 5: Guard behavior tests — fixture-based (AC: 1, 3)
  - [x] 5.1 Test fixtures OUTSIDE the deployed `convex/` function set: `convex/lib/guards.test.ts` builds its harness with `convexTest(fixtureSchema, fixtureModules)` where `fixtureSchema` is a test-only `defineSchema` with one scratch table (e.g. `guardFixtures: { workspaceId: v.string(), value: v.string() }`) and `fixtureModules` come from `import.meta.glob` over a `tests/convex-fixtures/` directory containing a guarded query + mutation that call `requireMember` first, plus one `requireRole("senior_actuary")` mutation. Fixtures exercise the real guards; nothing fixture-shaped ever deploys.
  - [x] 5.2 Red first, then green (TDD): unauthenticated call → rejects with UNAUTHENTICATED; `t.withIdentity({ subject: "user_a", org_id: "org_A", org_role: "org:analyst" })` reading/writing `org_A` data → succeeds; same identity against `workspaceId: "org_B"` → FORBIDDEN on both read and write, and the B-scoped row provably unread (AC 3, FR-18); identity with NO org claims → FORBIDDEN; `analyst` calling the senior-actuary mutation → FORBIDDEN; `org_role: "org:senior_actuary"` → succeeds; normalizer accepts the verified live format from Task 2.2.
- [x] Task 6: Auth-guard enumeration test (AC: 2)
  - [x] 6.1 `convex/authGuard.test.ts`: enumerate the REAL deployed function surface — `import.meta.glob("./**/!(*.*.*)*.*s", { eager: true })` over `convex/` (excluding `_generated` and test files), collect exports where the registered-function marker `isPublic === true` (internal functions and plain helpers don't carry it). For each, call it unauthenticated via `convexTest(schema, modules)` + `makeFunctionReference` and assert rejection (NFR-3).
  - [x] 6.2 Args before auth: Convex validates args before the handler runs, so each enumerated function needs minimally-valid args. Maintain an explicit registry `{ "module:functionName": argsObject }` in the test; the test FAILS (with a clear message) when a public function is missing from the registry — every future story that adds a public function must register it here. Today the registry is empty (zero public functions exist — `http.ts` actions and `internalMutation`s are out of scope for the enumeration by definition); the harness must still pass with a non-trivial self-check.
  - [x] 6.3 Self-check the harness (guard the guard): point the same enumeration logic at the Task 5 fixture modules and assert it (a) finds the fixtures' public functions and (b) confirms they reject unauthenticated calls. This proves the enumeration actually detects functions — an empty-glob bug can't silently green the suite.
- [x] Task 7: Webhook + stub tests (AC: 4)
  - [x] 7.1 `convex/http.test.ts` (convex-test supports `t.fetch` for HTTP actions): invalid/missing Svix signature → 400 and `recordEvent` not invoked; a validly-signed `organizationMembership.updated` payload (svix lib can sign in-test with a fake secret set via env stub) → 200 and the role-change event reaches `recordEvent` with the right `workspaceId`/`eventType`/actor (spy or fixture-visible effect). If in-test signing proves brittle, factor signature verification behind a small function and unit-test handler logic separately — but keep at least one end-to-end 400 (bad signature) case through `t.fetch`.
  - [x] 7.2 A test pins the `recordEvent` interface shape (args validator fields) so Story 1.5 swaps the body without breaking callers.
- [x] Task 8: Verification (all ACs)
  - [x] 8.1 `npm run lint`, `npx tsc --noEmit` (both type programs), `npm test` (both vitest projects), `npm run build`, `npx convex dev --once` (functions + http router deploy clean, test files excluded) — all green; document in Dev Agent Record.
  - [x] 8.2 Live check: with the dev server and a signed-in test user, confirm the JWT org claims flow (Task 2.2) and — if the webhook is configured on the dev deployment — flip the test user's role in the Clerk dashboard and observe the webhook hit in the Convex logs. Credential entry is Rohan's; prepare the steps and ask.

### Review Findings

_Code review 2026-07-16 (Amelia, opus-4-8; 3 parallel adversarial layers). Core auth logic verified sound — no bypass, signature gap, or type unsoundness; all 4 ACs and scope boundaries genuinely satisfied. Findings are robustness/error-classification refinements._

- [x] [Review][Decision] Webhook `actor` records the affected member, not the acting admin — **Resolved 2026-07-16 (option 1: accept the Clerk payload limitation)**: `actor` is documented as the SUBJECT of the change in clerkWebhook.ts; Story 1.5's audit taxonomy must treat webhook-sourced `actor` accordingly. [convex/lib/clerkWebhook.ts:44]
- [x] [Review][Patch] Harden guards to fail closed on malformed role claims — `normalizeRole("org:")` now returns `null`; `requireMember` rejects empty `org_id`. Tests added. [convex/lib/guards.ts:28]
- [x] [Review][Patch] Construct `new Webhook(secret)` outside the verify try/catch — malformed secret now returns 500 (deployment misconfiguration), verified by test. [convex/http.ts:36]
- [x] [Review][Patch] Null-safe `event.data` in `mapMembershipEvent` — missing/null `data` on a signed membership event now maps to `null` (→200) instead of crashing. Tests added. [convex/lib/clerkWebhook.ts:34]
- [x] [Review][Defer] Svix-id replay/idempotency — same signed delivery twice within the timestamp window re-invokes `recordEvent` → duplicate audit rows once Story 1.5 persists. Deferred to 1.5 (make `appendAuditEntry` idempotent on message id). [convex/http.ts:36]
- [x] [Review][Defer] "invalid signature → no event recorded" test asserts only status 400, not non-invocation of `recordEvent` — untestable until 1.5 gives `recordEvent` an observable effect. Deferred to 1.5. [convex/http.test.ts:61]
- [x] [Review][Defer] `organizationMembership.updated` is labeled `member.role_changed` even for non-role membership updates — revisit event taxonomy when 1.5 builds the audit log (payload is preserved for disambiguation). [convex/lib/clerkWebhook.ts:13]
- [x] [Review][Defer] NFR-3 enumeration covers `isPublic` query/mutation/action only, not `httpRouter` routes — explicitly out of this story's scope; extend when a future story adds an authenticated HTTP route that reaches data. [convex/authGuard.test.ts]
- [x] [Review][Defer] A recognized membership event missing `organization.id` is silently acked (200, no retry) — audit-completeness concern once persistence lands; revisit in 1.5. [convex/lib/clerkWebhook.ts:38]

## Dev Notes

### Architecture compliance (non-negotiable)

- **AD-4 is this story.** Every FUTURE public query/mutation/action starts with `requireMember`; approve/publish/override paths use `requireRole(ctx, workspaceId, "senior_actuary")`. The enumeration test is the permanent enforcement mechanism — it must be impossible to add a public function without registering it (Task 6.2's failing-by-default registry is the teeth).
- **No role/membership state in Convex tables — ever.** The JWT is the single source of truth (project-context anti-pattern list). This story adds NO tables to `convex/schema.ts` (it stays `defineSchema({})`; the fixture schema in tests is test-only and never deploys).
- **`auditLogs` belongs to Story 1.5** (AD-6). Do not create the table or a real `appendAuditEntry` here — only the `recordEvent` stub interface that 1.5 will back with the hash chain. Naming stays distinct: the stub is `recordEvent` in `convex/audit.ts`; 1.5's single writer is `appendAuditEntry` in the auditLogs module.
- **Guards are helpers, not middleware magic.** Plain async functions in `convex/lib/guards.ts` called as the first statement — matching the AC's literal wording. Do not introduce `convex-helpers` custom-function wrappers in this story; if the team later prefers `customQuery`, that's a refactor with the enumeration test as the safety net.
- **Vocabulary**: `Workspace` (== Clerk organization) in identifiers and copy; role slugs exactly `analyst` / `senior_actuary`; `requireMember` / `requireRole` exactly (AD-4 names them).
- **Error envelope**: `ConvexError` with `{ code, message }` (`UNAUTHENTICATED` / `FORBIDDEN`) — mirrors the `{code, message, details?}` convention; clients can switch on `code`.

### Existing files being modified — current state

- [convex/schema.ts](convex/schema.ts) — `defineSchema({})` with a just-in-time comment. **Change: none.** Preserve as-is.
- [convex/auth.config.ts](convex/auth.config.ts) — issuer-domain bridge with fail-fast env guard (1.2 review patch). **Change: none.** The JWT template edit (Task 2) is dashboard config; `applicationID: "convex"` already matches.
- [vitest.config.mts](vitest.config.mts) — react plugin, `@` alias, include `tests/**/*.test.{ts,tsx}`, comment reserving the edge-runtime project *for this story*. **Change**: introduce `test.projects` (Task 4.1). **Preserve**: the alias, plugin, and existing test behavior — `tests/proxy.test.ts`, `scaffold`, `tokens`, `status-badge` must keep passing unmodified.
- [tsconfig.json](tsconfig.json) (root) — currently sweeps `convex/**` into the DOM-lib program. **Change**: exclude `convex/**` once `convex/tsconfig.json` exists (Task 4.2). CI must type-check both.
- [.github/workflows/ci.yml](.github/workflows/ci.yml) — Node job runs lint + `tsc --noEmit` + Vitest. **Change**: only if Task 4.2 needs the second type-check invocation added.
- [README.md](README.md) — has the Clerk one-time-init section from 1.2. **Change**: extend with JWT template claims + webhook setup (Tasks 2.3, 3.3).
- [.env.example](.env.example) — names-only file. **Change**: document `CLERK_WEBHOOK_SIGNING_SECRET` as a Convex-deployment env var in a comment (value never in any .env file in the repo).

### Live environment facts (2026-07-16)

- Convex cloud dev deployment `benevolent-clam-376`; `CLERK_JWT_ISSUER_DOMAIN=https://striking-drum-71.clerk.accounts.dev` already set there. Clerk app has Organizations enabled with required membership; 1.2's README instructs creating roles `analyst`/`senior_actuary` — **verify they exist in the dashboard before Task 5 locks the normalizer**.
- Test sign-in user: rohanyashraj@gmail.com (Rohan enters credentials — never ask for or store the password).
- Webhook target URL is the deployment's `.convex.site` domain (HTTP Actions), not `.convex.cloud`.

### convex-test facts (verified 2026-07-16)

- `convexTest(schema, modules)` — `modules` from `import.meta.glob`; for the enumeration test glob the real `convex/` dir; for fixtures glob `tests/convex-fixtures/`. Requires `environment: "edge-runtime"` (or the `@vitest-environment` pragma) + `server.deps.inline: ["convex-test"]`.
- `t.withIdentity({...})` accepts arbitrary custom claims — pass `org_id` / `org_role` exactly as the JWT template emits them. Plain `t.query/mutation(...)` without `withIdentity` is the unauthenticated case.
- `t.fetch(path, init)` exercises `convex/http.ts` routes in-test.
- Registered public functions carry `isPublic === true`; internal ones carry `isInternal` — the enumeration filter key. `makeFunctionReference` (from `convex/server`) turns `"module:fn"` strings into callable references.

### Previous story intelligence (1.1–1.3)

- Review-patch standards to apply from the start: fail fast on missing env/config (no `!` assertions); behavioral tests over constant-assertions (test what the guard *does*, not what the file *contains*).
- CI: lint + `tsc --noEmit` + Vitest on every PR; ESLint flat config lints everything outside `engine/.venv` and `convex/_generated` — new `convex/*.ts` IS linted (watch `import/no-anonymous-default-export`, bitten in 1.2's auth.config).
- Sourcery bot license flags on PRs are triaged noise; GitHub Actions is the truth.
- Working rhythm: commit only on explicit ask; PR per story branch — create `epic_1/1_4` from current `main`-merged state (you are on `epic_1/1_3`).
- 1.3 deferred StatusBadge out-of-union validation "at the Convex boundary" to Epic 4 — not this story's concern, but it's the same boundary-validation philosophy the guards embody.

### Design decisions this story makes (flagged for review)

- **`workspaceId` = Clerk org ID string** passed as an explicit arg and checked against the JWT's active-org claim — not read implicitly from the JWT alone. Explicit args keep every function's tenancy auditable at the call site and survive a future multi-org-session world.
- **Role-change capture via Clerk webhook** (`organizationMembership.*` → Svix-verified HTTP action → `recordEvent` stub). The AC's "webhook/JWT change" allows either; the webhook is the only server-side point that observes dashboard-driven role changes (JWT diffing would miss members who never sign in again).
- **Enumeration args registry** (explicit map, fails when incomplete) over reflection tricks — deliberate friction: adding a public function forces the author to look the auth test in the eye.

### Scope boundaries (do NOT build here)

- No `auditLogs` table, no hash chain, no `appendAuditEntry` (Story 1.5). No data tables of any kind. No engine work. No role-management UI (Clerk-dashboard-managed, FR-19). No `convex-helpers` dependency. No changes to proxy.ts route protection (1.2 owns it; its deferred items stay deferred). No Playwright.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.4] — story + ACs; FR-18, FR-19, NFR-3
- [Source: _bmad-output/planning-artifacts/architecture/architecture-agentic-reserving-2026-07-16/ARCHITECTURE-SPINE.md#AD-4] — guard rule, role slugs, enumeration test; #Consistency Conventions — naming, error envelope
- [Source: _bmad-output/project-context.md] — anti-patterns (no role duplication, requireMember-first), testing rules
- [Source: _bmad-output/implementation-artifacts/1-2-clerk-sign-in-and-protected-app-shell.md] — Clerk/Convex bridge state, live env facts, review-patch standards
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] — convex/tsconfig.json item closed here
- [Source: docs.convex.dev/testing/convex-test + docs.convex.dev/auth/clerk + clerk.com/docs/guides/sessions/jwt-templates] — withIdentity/t.fetch, JWT template custom claims + org shortcodes, verified 2026-07-16

## Dev Agent Record

### Agent Model Used

Claude Fable 5 (claude-fable-5) via Claude Code — BMad dev-story workflow, 2026-07-16.

### Implementation Plan

- Task 4 (test infra) first so every subsequent task could run red/green; then Task 1+5 (guards, TDD), Task 6 (enumeration), Task 3+7 (webhook + stub, TDD), docs, verification.
- Guards implemented as plain helpers over `{ auth: Auth }` so they work identically in queries, mutations, and actions; fixtures use `queryGeneric`/`mutationGeneric` so test-only functions type-check against the fixture schema without touching `_generated`.

### Debug Log References

- convex-test locates its modules root by finding a `_generated` key in the module map. Fixture modules (outside `convex/`) get a stub entry `"./_generated/server.ts": async () => ({})` — never loaded, only anchors the root (tests/convex-fixtures/modules.ts).
- The README's `!(*.*.*)` extglob from convex-test docs did not match `_generated/*.js` under Vitest 4/tinyglobby; replaced with explicit array patterns (`./**/*.ts`, `!./**/*.test.ts`, `./_generated/**/*.js`).
- The enumeration test's eager glob imports every convex module, which tripped auth.config.ts's fail-fast issuer guard at import time → stubbed `CLERK_JWT_ISSUER_DOMAIN` at the vitest convex-project level (`test.env`).
- Edge runtime has no `Buffer`; http.test.ts uses `btoa` for the test signing secret. svix 1.97.0 signs and verifies fine in the edge-runtime environment.
- `internal.audit.recordEvent` typing required `npx convex codegen` after adding audit.ts (stale `_generated/api`).

### Completion Notes List

- **All code tasks complete; 77/77 tests green** (49 unit + 28 convex). Verification battery: `npm run lint` ✅, `npx tsc --noEmit` ✅, `npx tsc --noEmit -p convex` ✅, `npm test` ✅, `npm run build` ✅, `npx convex dev --once` ✅ (deploys clean; `.convexignore` keeps `**/*.test.ts` out of the push).
- **AC 1**: `requireMember`/`requireRole` in convex/lib/guards.ts; closed `Role` union; `normalizeRole` strips `org:` and accepts bare slugs (defensive until Task 2.2's live verification); same FORBIDDEN for wrong-workspace and no-such-workspace.
- **AC 2**: convex/authGuard.test.ts enumerates `isPublic === true` exports (verified against convex 1.x source: public query/mutation/action carry `isPublic` + kind flag; httpActions carry only `isHttp`, internal functions only `isInternal`). Registry `publicFunctionArgs` fails loudly on unregistered public functions and on stale entries; self-check proves the enumeration detects the three fixture functions and that they reject unauthenticated calls.
- **AC 3**: guards.test.ts seeds a B-scoped row, proves user A's read/write of org_B both throw FORBIDDEN, and re-reads the row to prove it untouched.
- **AC 4**: `recordEvent` internalMutation stub with exported `recordEventArgs` (shape pinned by test for 1.5); Svix-verified webhook at POST /clerk-users-webhook maps organizationMembership.created/updated/deleted → member.added/role_changed/removed. "recordEvent invoked" is proven end-to-end: the handler only returns the `{recorded, workspaceId, actor}` body after `ctx.runMutation(internal.audit.recordEvent, …)` succeeds (Convex validates args), and the pure mapper is unit-tested separately (clerkWebhook.test.ts).
- **Actor caveat**: Clerk's organizationMembership payload does not identify the admin who made the change; `actor` is the affected member (`public_user_data.user_id`, fallback "unknown"). Documented in convex/lib/clerkWebhook.ts.
- **Missing signing secret returns 500** (deployment misconfiguration), missing/invalid signature returns 400 — deliberate distinction from the story's blanket 400; flagged for review.
- svix ^1.97.0 added (story-specified, lockfile-pinned). `npm audit` flags are a pre-existing Next.js→postcss transitive advisory, unrelated.
- **Live verification (2026-07-16)**: Rohan completed the dashboard setup. Verified without credential entry via the Clerk Backend API (CLERK_SECRET_KEY from .env.local, values never printed): org `org_3Ga5Uq5FYhXX6T6lhpIIUIVLjta` exists with roles `org:analyst`/`org:senior_actuary`; a JWT minted from the live `convex` template for the test user's active session carries `"org_id": "org_3Ga5…"` and `"org_role": "org:analyst"` — the **prefixed** format, exactly what `normalizeRole` and the tests assume (Task 2.2 ✅, no code change). `CLERK_WEBHOOK_SIGNING_SECRET` is set on the deployment.
- **HTTP Actions URL is region-qualified**: `https://benevolent-clam-376.eu-west-1.convex.site/clerk-users-webhook` answers 400 to unsigned POSTs (route + signature check live); the unqualified `benevolent-clam-376.convex.site` form 404s. README corrected; the Clerk endpoint URL must use the `eu-west-1` form.
- **8.2 closed (2026-07-16)**: Rohan corrected the Clerk endpoint URL to the region-qualified form and flipped the test user's role several times in the dashboard. `npx convex logs --success` shows each delivery as `H(POST /clerk-users-webhook)` immediately followed by `M(audit:recordEvent)` (six deliveries observed 18:34–18:38); the earlier unsigned probe executed without invoking recordEvent, as designed. Test user's role restored to `org:analyst`. Note for future debugging: `npx convex logs` shows console output only — pass `--success` to see execution records for functions that don't log.
- Final regression after live checks: lint ✅, both tsc programs ✅, 77/77 tests ✅.

### File List

- convex/lib/guards.ts (new)
- convex/lib/guards.test.ts (new)
- convex/lib/clerkWebhook.ts (new)
- convex/lib/clerkWebhook.test.ts (new)
- convex/audit.ts (new)
- convex/http.ts (new)
- convex/http.test.ts (new)
- convex/authGuard.test.ts (new)
- convex/tsconfig.json (new)
- convex/_generated/api.d.ts (regenerated)
- convex/_generated/api.js (regenerated)
- convex/_generated/server.d.ts (regenerated)
- convex/_generated/server.js (regenerated)
- convex/_generated/dataModel.d.ts (regenerated)
- tests/convex-fixtures/schema.ts (new)
- tests/convex-fixtures/fixtures.ts (new)
- tests/convex-fixtures/modules.ts (new)
- .convexignore (new)
- vitest.config.mts (modified — test.projects: unit + convex/edge-runtime)
- tsconfig.json (modified — exclude convex/**)
- .github/workflows/ci.yml (modified — second typecheck step for convex program)
- README.md (modified — JWT template claims, webhook setup)
- .env.example (modified — CLERK_WEBHOOK_SIGNING_SECRET note)
- package.json / package-lock.json (modified — svix ^1.97.0)

## Change Log

- 2026-07-16: Story 1.4 implementation — workspace/role guards, auth-guard enumeration test, Clerk webhook → recordEvent stub, convex test infrastructure (vitest projects, convex tsconfig, .convexignore). All local verification green; dashboard-side steps pending Rohan.
- 2026-07-16: Live verification complete — JWT org claims confirmed on the live `convex` template (prefixed `org:` format), webhook deliveries observed end-to-end (`POST /clerk-users-webhook` → `audit:recordEvent`) after Rohan fixed the endpoint to the region-qualified `.convex.site` URL. Status → review.
- 2026-07-16: Code review (3 adversarial layers) — core auth logic verified sound, all ACs satisfied. Applied 4 patches (guard fail-closed hardening, malformed-secret 500, null-safe webhook data, actor-semantics documentation per review decision); 5 items deferred to Story 1.5 / future scope in deferred-work.md; 6 tests added (83 total). Status → done.
