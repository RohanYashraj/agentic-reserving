---
baseline_commit: 07b46b8
---

# Story 2.5: engine_service FastAPI Shell with Service Auth

Status: done

## Story

As the Convex backend,
I want authenticated HTTP endpoints for validation and runs, idempotent by run ID,
so that the product plane can drive the engine without ever touching engine internals. (FR-4 consequence, AD-7, AD-12)

## Acceptance Criteria

1. **Given** engine_service, **When** any endpoint is called without the shared service bearer secret, **Then** it returns 401 with error envelope `{code, message, details?}` — engine_service performs no user auth and trusts the caller's authorized context (AD-12).
2. **Given** authenticated calls, **When** `POST /validate` and `POST /runs` are invoked with plain JSON, **Then** they delegate to `reserving_engine` and return the typed validation report or `{resultSet, diagnosticsBundle}` as JSON, with the Convex run ID accepted as idempotency key so an identical retried request returns an identical response without recomputation side effects (AD-7).
3. **And** the service holds no state between requests (AD-3), and the response contract is shaped so a future async `202 + HMAC callback` upgrade is additive.
4. **And** FastAPI tests cover auth rejection, happy path, validation failure passthrough (cell-level errors intact), and idempotent retry.

## Tasks / Subtasks

- [x] Task 1: Config + service-auth dependency — `engine_service/config.py`, `engine_service/auth.py` (AC: 1)
  - [x] 1.1 `config.py`: `class Settings` (frozen dataclass or plain object) holding `service_secret: str`. `def load_settings() -> Settings` reads `ENGINE_SERVICE_SECRET` from `os.environ` and **fails loud** (`RuntimeError` naming the missing var) if unset/empty. `engine_service` is the imperative shell (AD-2/AD-12) — env reads live HERE, never in `reserving_engine` (import-linter forbids `os` there). Do NOT log the secret's value ever. Only `ENGINE_SERVICE_SECRET` is in scope this story; `GEMINI_API_KEY`/`GEMINI_MODEL_ID`/token-ceiling are 5.x config (already named in `.env.example`, leave them).
  - [x] 1.2 `auth.py`: `require_service_auth` FastAPI dependency. Reads `Authorization: Bearer <secret>`, compares to `Settings.service_secret` using `secrets.compare_digest` (constant-time — no timing oracle on the shared secret). Missing header, non-`Bearer` scheme, or mismatch → raise the domain auth error (Task 3), NOT FastAPI's `HTTPException` with a `WWW-Authenticate` challenge (this is a service secret, not a browser realm). Attach the dependency to every route so no endpoint can ship unauthenticated (mirror of AD-4's "first statement" discipline for the engine boundary).
  - [x] 1.3 The settings object is created once at app construction and closed over by the dependency (constant per process) — never re-read per request, never mutated. This is the only "state" and it is immutable config, not request state (AD-3 intact).
- [x] Task 2: Wire models — `engine_service/models.py` (AC: 2, 3)
  - [x] 2.1 Reuse `_MODEL_CONFIG` from `reserving_engine.resultset` (same camelCase alias + `populate_by_name` config the engine models use — do NOT declare a second config; wire drift is how contracts rot). Import it: `from reserving_engine.resultset import _MODEL_CONFIG` (same-package-family private reuse, as `diagnostics.py` did in 2.4).
  - [x] 2.2 `class ValidateRequest`: `triangle: Triangle`. (No runId — validation mints no IDs and is naturally idempotent; keep the surface minimal.)
  - [x] 2.3 `class RunRequest`: `run_id: str` (wire `runId`), `triangle: Triangle`, `parameters: RunParameters | None = None`. `run_id` is REQUIRED here — it is both the AD-7 idempotency key and the value handed to `compute_diagnostics` to mint Diagnostic IDs (2.4). Fail loud (empty `run_id` is already rejected downstream by `compute_diagnostics`, but reject empty at the request model too for a clean 422).
  - [x] 2.4 `class RunResponse`: `run_id: str` (wire `runId`, echoed back — the async-upgrade seam: a future `202` variant returns the same `runId` in its ack, a callback later posts `{runId, resultSet, diagnosticsBundle}`; the shape is additive, decision #5), `result_set: ResultSet` (wire `resultSet`), `diagnostics_bundle: DiagnosticsBundle` (wire `diagnosticsBundle`).
  - [x] 2.5 `POST /validate` returns the engine's `ValidationReport` directly (already a wire model). Do NOT wrap it — the AC says "the typed validation report".
- [x] Task 3: Error envelope + exception handlers — `engine_service/errors.py` (AC: 1, 2, 4)
  - [x] 3.1 `class ErrorEnvelope(BaseModel)`: `code: str`, `message: str`, `details: <json> | None = None` (`details` optional, per the spine's `{code, message, details?}`). This is the ONLY error shape any endpoint returns — 401, domain-validation, missing-apriori, malformed-body all serialize to it.
  - [x] 3.2 `class ServiceAuthError(Exception)` (raised by `require_service_auth`) → handler returns **401** `{code: "unauthorized", message, details: null}`. Message is generic ("missing or invalid service credentials") — never echo the presented token or say which part failed (no auth oracle).
  - [x] 3.3 Handler for `reserving_engine.InvalidTriangleError` → **422** `{code: "triangle_invalid", message, details: <the report's findings as cell-level {origin, dev, reason, code} objects>}`. The cell-level findings pass through INTACT (AC-4) — dump `err.report.findings` via `model_dump(by_alias=True)`. This is the "validation failure passthrough" path for `/runs`.
  - [x] 3.4 Handler for `reserving_engine.MissingAprioriError` → **422** `{code: "missing_apriori", message (naming the missing Origin Periods), details: {missingOrigins: [...]}}` from `err.missing_origins`.
  - [x] 3.5 Handler for FastAPI's `RequestValidationError` (malformed/mis-shaped JSON body) → **422** `{code: "bad_request", message, details: <exc.errors() summary>}`. Without this, FastAPI emits its own non-envelope shape — the AC requires the envelope on the auth path, and a consistent error surface is the spine convention; register it so EVERY error is the envelope.
  - [x] 3.6 Register all handlers on the app in Task 4. Do not add a broad `Exception` handler that would mask a 500 into a fake 200 — unexpected errors may surface as FastAPI's default 500 (they are bugs, not part of the contract); optionally a `code: "internal"` envelope on 500 WITHOUT leaking the traceback/message details. Decision #6.
- [x] Task 4: App factory + routes — `engine_service/app.py` (AC: 1, 2, 3)
  - [x] 4.1 `def create_app(settings: Settings | None = None) -> FastAPI`: if `settings is None`, call `load_settings()` (env). Accepting an explicit `settings` is the test seam (inject a known secret without touching `os.environ`). Register the Task 3 exception handlers. NO module-level mutable state, NO cache, NO global request store — statelessness is structural (AD-3).
  - [x] 4.2 `POST /validate` (dep: `require_service_auth`): body `ValidateRequest` → `report = validate_triangle(req.triangle)` → return `report` (200, even when `report.valid is False` — a validation that FOUND defects is a successful call; the invalid-triangle *error* path is `/runs`). `validate_triangle` never raises on domain defects, so no try/except needed here.
  - [x] 4.3 `POST /runs` (dep: `require_service_auth`): body `RunRequest` → `result_set = run_methods(req.triangle, req.parameters)` → `bundle = compute_diagnostics(req.triangle, result_set, req.run_id)` → return `RunResponse(run_id=req.run_id, result_set=result_set, diagnostics_bundle=bundle)` (200). `run_methods` may raise `InvalidTriangleError`/`MissingAprioriError` — let them propagate to the Task 3 handlers (do NOT catch-and-reshape inline; one mapping, one place). `compute_diagnostics` re-checks the triangle hash and empty runId — those `ValueError`s are internal invariants that can't fire here (same triangle object, request model rejects empty runId), so no special handling.
  - [x] 4.4 Serialize responses with `by_alias=True` so the wire is camelCase and **byte-identical to the engine's own `model_dump(by_alias=True)`** (2.6 drift-checks these exact shapes). Set `response_model_by_alias=True` on the routes (FastAPI's default is True, but pin it explicitly), OR return `JSONResponse(content=model.model_dump(mode="json", by_alias=True))`. Prefer the explicit dump to guarantee parity with the committed 2.2/2.4 fixtures.
  - [x] 4.5 Module-level `app = create_app()` for the uvicorn entrypoint (`uv run uvicorn engine_service.app:app`) — reads env at import, which is correct for the deployed shell. The factory stays the test seam. NO health/readiness endpoint, NO CORS, NO middleware this story (browser never calls engine_service — AD-12; add nothing speculative).
  - [x] 4.6 Idempotency is **determinism + statelessness, not a cache** (AD-7: "stateless and deterministic, so retries are safe by construction"). Do NOT build a runId→response store — that would be the exact server-side state AD-3 forbids. An identical retried `/runs` recomputes and returns a byte-identical response *because the core is pure*; "without recomputation side effects" is satisfied by there being NO side effects at all. Decision #4.
- [x] Task 5: Package surface + entrypoint wiring — `engine_service/__init__.py` (AC: 2, 3)
  - [x] 5.1 `engine_service/__init__.py`: module docstring (imperative-shell contract AD-2/AD-3/AD-12: all I/O and HTTP live here; stateless between requests; no Convex/Clerk calls; only Convex may call it via the shared secret). Export `create_app`, `Settings`, `load_settings`, `ErrorEnvelope` in `__all__`.
  - [x] 5.2 Confirm `engine_service` imports ONLY from `reserving_engine` (public API via `from reserving_engine import ...`) + stdlib + fastapi/pydantic — never `copilot_agent`, never Convex/Clerk anything. The existing import-linter layering contract (`engine_service | copilot_agent` → `reserving_engine`) must stay green; the forbidden-modules contract applies to `reserving_engine` only, so `os`/`secrets` in `engine_service` are fine.
- [x] Task 6: Tests — new file `engine/tests/test_engine_service.py` (AC: 1, 2, 3, 4)
  - [x] 6.1 TDD red first. Use `fastapi.testclient.TestClient` on `create_app(settings=Settings(service_secret=TEST_SECRET))` — inject a known secret, never touch `os.environ`. Helper: `client_with_auth()` returns `(TestClient, headers={"Authorization": f"Bearer {TEST_SECRET}"})`.
  - [x] 6.2 **Auth (AC-1)**: `/validate` and `/runs` with (a) no `Authorization` header, (b) wrong secret, (c) non-`Bearer` scheme → all **401** with envelope `{code: "unauthorized", ...}`; body never echoes the presented token. Correct secret → not 401.
  - [x] 6.3 **Happy `/validate` (AC-2)**: valid Triangle → 200, body equals `validate_triangle(triangle).model_dump(by_alias=True)` (`valid: true`, `findings: []`).
  - [x] 6.4 **Happy `/runs` (AC-2)**: CL-only and CL+BF+Mack (2.3 canonical prior 0.9 / 5,000,000) on `TAYLOR_ASHE` → 200; assert `resultSet` == direct `run_methods(...)` dump and `diagnosticsBundle` == direct `compute_diagnostics(..., runId)` dump (**the HTTP layer changes nothing** — delegation proof; do NOT re-pin golden literals, those live in `test_golden_taylor_ashe.py`). Assert every Diagnostic ID in the response embeds the request's `runId`.
  - [x] 6.5 **Validation-failure passthrough (AC-4)**: a paid Triangle with a monotonicity break → `/validate` returns **200** `valid: false` with the cell-level finding intact (`origin`, `dev`, `reason`, `code`); the SAME bad Triangle to `/runs` returns **422** `{code: "triangle_invalid", details: [<same cell-level findings>]}` — assert the findings survive the boundary byte-for-byte.
  - [x] 6.6 **Missing apriori (AC-2/AC-4)**: `/runs` with `methods=["bornhuetter_ferguson"]` and no/partial `apriori_loss_ratios` → **422** `{code: "missing_apriori"}` whose message/details name the uncovered Origin Periods.
  - [x] 6.7 **Idempotent retry (AC-2, AC-4)**: POST the identical `/runs` request twice → **byte-identical** response bodies (`resp1.content == resp2.content`). Different `runId`, same triangle → responses differ ONLY in the runId-derived Diagnostic IDs and echoed `runId` (statelessness: no cross-request bleed).
  - [x] 6.8 **Malformed body**: `/runs` missing `runId`, or `/validate` with a ragged Triangle → **422** envelope `{code: "bad_request", ...}` (NOT FastAPI's default error shape). Confirms every error path wears the envelope.
  - [x] 6.9 **Wire shape**: spot-check `/runs` response top-level keys are `runId`, `resultSet`, `diagnosticsBundle` (camelCase); nested `schemaVersion`, `lineage`, `ldfStability` present (extends 2.2/2.4 camelCase discipline; 2.6 freezes it).
- [x] Task 7: Deps, README, verification (all ACs)
  - [x] 7.1 Add `httpx` to the `[dependency-groups] dev` list in `engine/pyproject.toml` (TestClient's HTTP driver). It is already resolved transitively in `uv.lock`, but the test now depends on it directly — make that explicit so `uv sync` can't drop it. Run `uv lock` if the lock needs the dev-group edge recorded; keep the change minimal (no version churn on other pins).
  - [x] 7.2 `starlette` 1.3.1 emits `StarletteDeprecationWarning: Using httpx with starlette.testclient is deprecated` — it is a warning only; TestClient works on the pinned `httpx 0.28.1`. If it makes the run noisy, add a scoped `filterwarnings` for that single warning in `[tool.pytest.ini_options]` (do NOT globally silence warnings). Note it in Debug Log either way.
  - [x] 7.3 README: replace the line "The engine service (`uv run uvicorn ...`) arrives in Story 2.5; until then the Python plane is verified by its tests." with a short paragraph: the two endpoints (`POST /validate`, `POST /runs`), bearer service-auth (AD-12), stateless + idempotent-by-runId (AD-7/AD-3), run locally with `uv run uvicorn engine_service.app:app` (secret via `ENGINE_SERVICE_SECRET`). Keep the engine subsection factual and lean.
  - [x] 7.4 Full battery from `engine/` cwd: `uv run pytest` (2.4's 162+ passing, all green — new service tests added; platform-gated exact-tier skips still expected on macOS), `uv run ruff check .`, `uv run lint-imports` (2 contracts kept — engine_service imports only reserving_engine + fastapi/pydantic/stdlib). No TS changes (Convex driver for these endpoints is Epic 4).
  - [x] 7.5 Confirm CI green on the PR (linux/amd64). No golden literals are pinned in this story, so no re-pin risk; the service tests assert delegation equality against the live engine, platform-agnostic. (Pending commit/push — deferred per working rhythm, same as prior stories.)

## Dev Notes

### Architecture compliance (non-negotiable)

- **AD-12 (service-boundary auth)**: every endpoint requires the shared bearer secret (`ENGINE_SERVICE_SECRET`), held only in Convex + Cloud Run env. engine_service performs NO user auth (no Clerk, no identity), trusts the caller's already-authorized context, and never holds the URL/secret in any frontend-reachable place. Constant-time secret compare; generic 401 (no auth oracle).
- **AD-3 (statelessness / sole system of record)**: engine_service holds NO state between requests — no runId→result cache, no session store, no files. The only process-lifetime value is the immutable `Settings` (config, not request state). Anything worth keeping is *returned to the Convex caller* to persist; this story returns `{resultSet, diagnosticsBundle}` and stops there.
- **AD-7 (job-record-first, idempotent by runId)**: the `runId` is the idempotency key, accepted in the `/runs` body. Idempotency is *determinism + statelessness* ("safe by construction"), NOT a cache — an identical retried request recomputes to a byte-identical response because `reserving_engine` is pure. The response contract (`runId` echoed; `{resultSet, diagnosticsBundle}` payload) is shaped so a future `202 + HMAC callback` variant is purely additive.
- **AD-2 (layering)**: engine_service is the imperative shell — I/O, HTTP, env reads live here and ONLY here; `reserving_engine` stays pure (import-linter forbids `os`/`http`/… there). engine_service imports the core via its public API and never the reverse; never imports `copilot_agent` (that's a sibling shell, 5.x).
- **AD-10 (contract)**: the `/runs` response serializes `ResultSet`/`DiagnosticsBundle` with `by_alias=True` — byte-identical to the engine models' own dump, which 2.6 exports to JSON Schema and drift-checks against Convex validators/TS types. Do not reshape or wrap the engine models; pass them through.
- **Error convention (spine)**: `{code, message, details?}` on every engine_service error; validation errors carry cell-level `{origin, dev, reason}`. One envelope model, registered exception handlers, no ad-hoc error dicts.
- **Vocabulary (PRD §3)**: `Triangle`, `Run`/`runId`, `ResultSet`, `DiagnosticsBundle`, `Lineage`, `Diagnostic`, `Origin Period` — exact terms in identifiers and wire keys. No "job", "analysis", "payload wrapper" synonyms.

### Design decisions this story fixes (flagged for review)

1. **App factory `create_app(settings=None)`** — module-level `app = create_app()` for uvicorn (`--factory` not needed); the factory + injectable `Settings` is the test seam so tests never touch `os.environ`. Statelessness is structural: no module-level mutable state.
2. **Auth is a per-route FastAPI dependency**, attached to every endpoint — the engine-boundary echo of AD-4's "first statement is the guard". A raised `ServiceAuthError` → 401 envelope (not FastAPI's `HTTPException` with a `WWW-Authenticate` realm challenge; this is a machine caller, not a browser).
3. **One error envelope, registered handlers** — `ServiceAuthError`→401, `InvalidTriangleError`→422 (cell-level findings intact), `MissingAprioriError`→422 (origins named), `RequestValidationError`→422 `bad_request`. No inline try/except-and-reshape in routes; mapping lives in `errors.py`.
4. **Idempotency = determinism, NOT a cache** — building a runId→response store is the precise server-side state AD-3 forbids and buys nothing (the core is pure). "Without recomputation side effects" holds because there are zero side effects. The test proves it by asserting two identical POSTs return byte-identical bodies.
5. **`runId` echoed in `RunResponse`** — the async-upgrade seam. A later `202 + HMAC callback` returns the same `runId` in its synchronous ack and posts `{runId, resultSet, diagnosticsBundle}` on the callback; today's sync shape is the callback payload minus the transport. Additive, not a rewrite.
6. **No broad `Exception`→200/masked handler** — unexpected errors are bugs, surfaced as 500 (optionally a `code:"internal"` envelope with NO leaked message/traceback). Never coerce an internal failure into a success or leak internals.
7. **`/validate` returns 200 even when `valid:false`** — a validation that found defects is a *successful* validation call; the invalid-triangle *error* (422 `triangle_invalid`) is the `/runs` path where a defect blocks computation. Two different meanings, two different status codes.
8. **`httpx` promoted to an explicit dev dependency** — TestClient's HTTP driver; already transitive in the lock, but the test now depends on it directly, so pin the edge (don't rely on a transitive that a future resolve could drop).

If the reviewer disagrees on any of these, note it — none are golden-pinned, so they change freely, but keep `errors.py` the single mapping site.

### What NOT to build (scope boundaries)

- **No Convex, no Clerk, no user auth, no `requireMember`** — engine_service trusts the service secret and the caller's context (AD-12). The Convex action + `runs` record + `@convex-dev/workflow` orchestration that CALLS these endpoints is Epic 4 (4.2).
- **No async `202 + HMAC callback`** — only the sync contract, *shaped* to make that upgrade additive (decision #5). No callback endpoint, no HMAC signing this story.
- **No provenance gate, no placeholder rendering, no numeric checker** — that's `engine_service` too but Story 5.2; this is the transport shell only. No `copilot_agent` hosting (5.x).
- **No runId cache / result store / persistence** — AD-3; the payload is returned to the (future) Convex caller, full stop.
- **No changes to `reserving_engine`** — `run_methods`, `validate_triangle`, `compute_diagnostics`, all models and fixtures are consumed as-is. If a genuine gap in the core surfaces, STOP and flag it — do not edit the pure core from the shell story.
- **No health/readiness/metrics endpoint, no CORS, no middleware, no rate limiting** — nothing speculative; the browser never reaches engine_service.
- **No JSON Schema export / Convex validators / TS types** — Story 2.6.
- **No Dockerfile / Cloud Run config** — deployment hardening is Epic 7; this story is the app + tests, runnable via uvicorn locally.

### Existing files — current state (read before writing)

- [engine/engine_service/__init__.py](engine/engine_service/__init__.py) — **empty**. Becomes the package surface (docstring + `__all__`). New sibling modules: `config.py`, `auth.py`, `errors.py`, `models.py`, `app.py`.
- [engine/reserving_engine/__init__.py](engine/reserving_engine/__init__.py) — public API (27 exports after 2.4). engine_service imports from here: `validate_triangle`, `run_methods`, `compute_diagnostics`, `Triangle`, `RunParameters`, `ResultSet`, `DiagnosticsBundle`, `ValidationReport`, `InvalidTriangleError`, `MissingAprioriError`. **No edits** to this file.
- [engine/reserving_engine/resultset.py](engine/reserving_engine/resultset.py) — `_MODEL_CONFIG` (camelCase alias + `populate_by_name`) is the shared wire config to import for the request/response models. `RunParameters`/`AprioriLossRatio` shapes are the `/runs` request's `parameters`. **No edits**.
- [engine/pyproject.toml](engine/pyproject.toml) — `package = false` (imports resolve only from `engine/` cwd); import-linter contracts (layering + `reserving_engine` forbidden-modules). **Change**: add `httpx` to `dev`; optional scoped `filterwarnings`. **Preserve**: every contract, the `line-length=100` ruff setting, all pins.
- [engine/.env.example](engine/.env.example) — already lists `ENGINE_SERVICE_SECRET` (+ the 5.x Gemini vars). No change needed.
- [README.md](README.md) — line ~110 says the service "arrives in Story 2.5". **Change**: replace with the endpoints + run command paragraph. **Preserve**: the rest of the engine subsection.
- Untouched: `methods.py`, `validation.py`, `triangle.py`, `diagnostics.py`, `version.py` (`ENGINE_VERSION` stays `0.1.0`), all existing tests and fixtures, `.github/workflows/ci.yml` (the existing `uv run pytest` step already runs the new service tests — no new CI job), all TS/Convex.

### FastAPI / TestClient facts (verified live against engine/.venv, 2026-07-18)

- Pins: `fastapi 0.139.0`, `starlette 1.3.1`, `httpx 0.28.1`, `pydantic 2.13.4` (uv.lock).
- `httpx` and `pydantic-settings 2.14.2` are already installed **transitively** — this story pins only `httpx` into `dev` (config uses plain `os.environ`, not pydantic-settings; adding a second settings lib is out of scope — decision keeps deps lean).
- `from fastapi.testclient import TestClient` works but starlette 1.3.1 warns `StarletteDeprecationWarning: Using httpx with starlette.testclient is deprecated; install httpx2 instead` — a warning, not a failure; TestClient functions on httpx 0.28.1 (Task 7.2).
- FastAPI serializes `response_model` with `by_alias=True` by default; pin it explicitly OR dump via `model.model_dump(mode="json", by_alias=True)` into a `JSONResponse` for guaranteed parity with the committed engine fixtures.
- Reading `Authorization` in a dependency: `Header(None)` or the `Request` object; parse `"Bearer "` prefix yourself, then `secrets.compare_digest`. FastAPI's `HTTPBearer` security helper returns 403 (not 401) on a missing header by default and adds OpenAPI security scheme noise — prefer a plain dependency that raises `ServiceAuthError` for a clean 401 envelope.

### Previous story intelligence (2.1–2.4)

- **Branch**: on `epic_2/2_5` at `07b46b8` (2.4 complete). 2.1–2.4 are status `review`; if their reviews land changes, rebase before finalizing. This is the FIRST engine_service story — no prior shell code to preserve, `engine_service/__init__.py` is empty.
- **Reuse, don't rebuild**: the engine's public API (`validate_triangle`, `run_methods`, `compute_diagnostics`), `_MODEL_CONFIG` for camelCase wire, `TAYLOR_ASHE` + 2.3's canonical BF prior (0.9 / 5,000,000) for the happy-path test, `model_dump(by_alias=True)` as the delegation-equality oracle. Don't duplicate golden literals — assert the HTTP output equals the direct engine call.
- **Fail-loud standard** (1.4/1.5/2.1/2.4 reviews): missing env var, missing auth, invalid triangle, missing apriori — typed errors naming the offender; generic message only where an oracle would leak (auth).
- **camelCase wire discipline** (2.2/2.3/2.4): every boundary object serializes via the shared alias config; the service response must match the engine's own bytes (2.6 drift-checks it).
- **Working rhythm** (Rohan): TDD red-first per task; run everything from `engine/` cwd (`package = false`); commit only on explicit ask; CI (linux/amd64) is the truth, Sourcery/GitGuardian are triaged noise.

### Project Structure Notes

- Spine Structural Seed: `engine_service/` = "FastAPI shell: routes, service auth, provenance gate". This story fills routes + service auth; the provenance gate is 5.2. Splitting by concern (`config`/`auth`/`errors`/`models`/`app`) mirrors how `reserving_engine` is split — one responsibility per module.
- Naming: snake_case modules/identifiers; camelCase only on the JSON wire via the shared alias config. Endpoint paths `/validate`, `/runs` (plural, matching the `runs` table vocabulary).
- Tests stay flat in `engine/tests/`; new `test_engine_service.py` joins the suite the existing CI `uv run pytest` step already runs — no CI edits.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.5] — story + ACs; Epic 2 boundaries (2.6 schema export next)
- [Source: _bmad-output/planning-artifacts/architecture/architecture-agentic-reserving-2026-07-16/ARCHITECTURE-SPINE.md#AD-3/#AD-7/#AD-10/#AD-12] — statelessness, idempotent-by-runId + async-headroom, cross-runtime contract, service-boundary auth; error-envelope + auth conventions table
- [Source: _bmad-output/project-context.md] — imperative-shell rules, no-anonymous-Convex (context for why the engine trusts the caller), error envelope, anti-patterns (engine_service never calls Convex/Clerk; browser never calls engine_service)
- [Source: _bmad-output/implementation-artifacts/2-4-diagnostics-computation-with-diagnostic-ids.md] — `compute_diagnostics(triangle, result_set, run_id)` signature + runId→Diagnostic-ID minting; `_MODEL_CONFIG` reuse pattern; camelCase wire discipline
- [Source: _bmad-output/implementation-artifacts/2-3-bornhuetter-ferguson-and-mack-methods.md] — canonical BF prior (0.9 / 5,000,000) for the CL+BF+Mack happy-path test; `MissingAprioriError` shape
- [Source: engine/reserving_engine/methods.py, resultset.py, validation.py] — `run_methods`/`validate_triangle` signatures, `InvalidTriangleError.report`/`MissingAprioriError.missing_origins`, `RunParameters`/`AprioriLossRatio`, `_MODEL_CONFIG`
- [Source: live probe of engine/.venv fastapi 0.139.0 / starlette 1.3.1 / httpx 0.28.1, 2026-07-18] — TestClient availability + deprecation warning, transitive httpx/pydantic-settings, response alias serialization

## Dev Agent Record

### Agent Model Used

Claude (claude-opus-4-8) via BMad create-story + dev-story (Amelia)

### Debug Log References

- TDD: `test_engine_service.py` written first (RED = `ImportError: cannot import name 'Settings' from 'engine_service'`), then modules implemented to green.
- **One refinement to task 4.5 (flagged)**: implemented uvicorn **factory mode** (`uv run uvicorn engine_service.app:create_app --factory`) instead of a module-level `app = create_app()`. Reason: a module-level `app` calls `load_settings()` at *import*, which fails loud when `ENGINE_SERVICE_SECRET` is unset — that would make `engine_service.app` un-importable in the test suite (which injects `Settings` via the factory and never sets the env var). Factory mode keeps the module import side-effect-free (also more faithful to AD-3: no env read at import) while preserving the "factory is the test seam" intent (decision #1). README + `__init__` docstring document the `--factory` command. No module-level `app` object exists.
- `filterwarnings` fix: the `StarletteDeprecationWarning` (starlette 1.3.1 TestClient over httpx) is NOT a `DeprecationWarning` subclass, so the category-qualified filter didn't match; dropped the category so the message-only `ignore` matches. Run is now warning-clean.
- Verified live: `load_settings()` raises `RuntimeError` naming `ENGINE_SERVICE_SECRET` when unset; `create_app()` with the env set exposes exactly `POST /validate` and `POST /runs`.

### Completion Notes List

- Task 1: `config.py` (`Settings` frozen dataclass + `load_settings()` fail-loud on missing `ENGINE_SERVICE_SECRET`, secret never logged) and `auth.py` (`make_service_auth(settings)` → `require_service_auth` dependency; parses `Bearer ` prefix, `secrets.compare_digest` constant-time compare; missing/non-Bearer/mismatch → `ServiceAuthError`). Settings created once at app construction, closed over (immutable config, AD-3 intact).
- Task 2: `models.py` — `ValidateRequest{triangle}`, `RunRequest{run_id, triangle, parameters?}` (empty `run_id` rejected via validator → clean 422), `RunResponse{run_id, result_set, diagnostics_bundle}`, all reusing `_MODEL_CONFIG` from `reserving_engine.resultset` (no second wire config). `/validate` returns the engine `ValidationReport` directly.
- Task 3: `errors.py` — single `ErrorEnvelope{code, message, details?}` + `register_exception_handlers`: `ServiceAuthError`→401 `unauthorized` (generic, no token echo), `InvalidTriangleError`→422 `triangle_invalid` (cell-level findings intact via `model_dump(by_alias=True)`), `MissingAprioriError`→422 `missing_apriori` (`{missingOrigins}`), `RequestValidationError`→422 `bad_request` (`jsonable_encoder(exc.errors())`). No broad `Exception` handler (decision #6).
- Task 4: `app.py` — `create_app(settings=None)` factory; both routes carry `Depends(make_service_auth(...))`; `/runs` composes `run_methods` + `compute_diagnostics(triangle, result_set, run_id)`; responses serialized via `model_dump(mode="json", by_alias=True)` into `JSONResponse` for byte-parity with the engine fixtures. No cache/store — idempotency is determinism + statelessness (AD-7). No health/CORS/middleware.
- Task 5: `engine_service/__init__.py` — imperative-shell docstring (AD-2/AD-3/AD-12) + `__all__ = [ErrorEnvelope, Settings, create_app, load_settings]`. `lint-imports` confirms engine_service imports only `reserving_engine` + fastapi/pydantic/stdlib (layering contract KEPT).
- Task 6: `test_engine_service.py` — 21 tests: auth rejection (missing/wrong/non-Bearer, no token echo), happy `/validate` + `/runs` (CL-only and CL+BF+Mack) asserted equal to direct engine calls, runId embedded in Diagnostic IDs, validation passthrough (`/validate` 200 `valid:false` + `/runs` 422 findings intact), missing-apriori naming origins, idempotent byte-identical retry, statelessness (distinct runIds differ only in runId-derived IDs), malformed/empty runId + ragged triangle → `bad_request` envelope, camelCase wire shape.
- Task 7: `httpx` added to `dev` deps (+ `uv lock`); scoped `filterwarnings` for the starlette warning. README engine subsection updated (endpoints, auth, stateless/idempotent, `--factory` run command). Full battery from `engine/`: `uv run pytest` → **183 passed, 9 skipped** (platform-gated exact tiers, linux-only), `uv run ruff check .` clean, `uv run lint-imports` 2 contracts KEPT. No TS/Convex changes. CI (linux/amd64) confirmation pending commit/push (working rhythm).

### File List

- engine/engine_service/__init__.py (modified — was empty; package surface + docstring + `__all__`)
- engine/engine_service/config.py (new — `Settings`, `load_settings`)
- engine/engine_service/auth.py (new — `make_service_auth` bearer dependency)
- engine/engine_service/errors.py (new — `ErrorEnvelope`, `ServiceAuthError`, `register_exception_handlers`)
- engine/engine_service/models.py (new — `ValidateRequest`, `RunRequest`, `RunResponse`)
- engine/engine_service/app.py (new — `create_app` factory + `/validate` and `/runs` routes)
- engine/tests/test_engine_service.py (new — 21 FastAPI tests)
- engine/pyproject.toml (modified — `httpx` dev dep, scoped `filterwarnings`)
- engine/uv.lock (modified — httpx dev-group edge recorded)
- README.md (modified — engine_service subsection + run command)
- _bmad-output/implementation-artifacts/sprint-status.yaml (modified — story status)
- _bmad-output/implementation-artifacts/2-5-engine-service-fastapi-shell-with-service-auth.md (modified — this record)

### Review Findings (Code Review 2026-07-18)

- [x] [Review][Patch] (fixed) Non-ASCII bearer token crashes auth: `secrets.compare_digest` requires ASCII-only `str` and raises `TypeError` on a latin-1-decoded header byte 0x80–0xFF → unhandled → 500 instead of the intended generic 401. Compare on `bytes` (encode both operands) or guard the exception. [engine/engine_service/auth.py:29]
- [x] [Review][Patch] (fixed) Bearer scheme is matched case-sensitively (`startswith("Bearer ")`); RFC 7235 defines the auth scheme as case-insensitive, so a conformant `bearer <secret>` caller is rejected. Internal-only caller and fails closed, but brittle for a cross-runtime contract. [engine/engine_service/auth.py:26]
- [x] [Review][Defer] `run_id` is only checked non-empty; it is joined verbatim into `dx:{runId}:{kind}:{key}`, so a `run_id` containing `:` yields structurally ambiguous Diagnostic IDs. Safe today (IDs resolve by dict lookup, never split), but the ID format is an AD-10 wire contract. — deferred, latent [engine/engine_service/models.py:35]

## Change Log

- 2026-07-18: Implementation complete (Amelia/dev-story) — `engine_service` FastAPI shell: `POST /validate` + `POST /runs` over the pure core, bearer service-auth (AD-12, constant-time compare, generic 401), single `{code, message, details?}` error envelope with cell-level passthrough, stateless + idempotent-by-runId (AD-3/AD-7, determinism not a cache), camelCase wire byte-parity with the engine models (AD-10). One refinement: uvicorn factory mode (`--factory`) instead of a module-level `app` to keep the module import-safe without the env secret. 183 passed / 9 platform-gated skips; ruff + import-linter green. CI confirmation pending commit/push.
- 2026-07-18: Story created via BMad create-story (Amelia) — full context from epics Story 2.5, spine AD-3/AD-7/AD-10/AD-12, 2.1–2.4 story intelligence, and live FastAPI/TestClient probes. Eight design decisions fixed and flagged.
