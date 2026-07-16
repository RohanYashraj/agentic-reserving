---
baseline_commit: c2a13f54ca92dcc0ec9f7721ab2eb31c2fb7c476
---

# Story 2.2: Chain Ladder with ResultSet, Lineage, and Golden Test

Status: review

## Story

As an actuary,
I want Chain Ladder computed with a typed ResultSet and full Lineage, proven against Taylor-Ashe,
so that the engine's numbers are demonstrably correct and reproducible. (FR-5, FR-6, NFR-1)

## Acceptance Criteria

1. **Given** a validated Triangle, **When** `run_methods` executes Chain Ladder via chainladder 0.9.2, **Then** it returns a ResultSet Pydantic model with `schemaVersion`, LDFs, ultimates, and IBNR per Origin Period, plus Lineage (engine semver, chainladder version, canonical Triangle hash, all parameters) (FR-5, AD-10, AD-11).
2. **And** the function is pure: identical inputs produce identical outputs, no I/O (AD-2).
3. **Given** the Taylor-Ashe dataset, **When** the pytest golden test runs on the pinned CI platform (linux/amd64), **Then** CL ultimates match published values with exact equality for point estimates, and the golden test is wired to block release when red (NFR-1).
4. **And** a re-derivation test replays a stored Lineage and reproduces the ResultSet exactly (FR-6, NFR-6).

## Tasks / Subtasks

- [x] Task 1: ResultSet + Lineage Pydantic models — `engine/reserving_engine/resultset.py` (AC: 1)
  - [x] 1.1 `ENGINE_VERSION = "0.1.0"` constant in `engine/reserving_engine/version.py`. The pure core cannot read `pyproject.toml` (AD-2 — no file access), so the semver lives as a constant with a docstring stating it must be bumped in lockstep with `engine/pyproject.toml` `[project] version`. Add a cheap sync test in `engine/tests/` (tests may do I/O): parse pyproject with `tomllib` and assert equality — makes the lockstep mechanical.
  - [x] 1.2 Models, all `ConfigDict(frozen=True, alias_generator=to_camel, populate_by_name=True)` (`from pydantic.alias_generators import to_camel`) — this is the AD-10 cross-runtime shape, so JSON serialization is camelCase (`schemaVersion`, `engineVersion`, `triangleHash`, `originPeriod`, `developmentFactors`…) while Python code stays snake_case. Serialize with `model_dump_json(by_alias=True)` in tests to prove the wire shape:
    - `RunParameters`: `methods: tuple[Literal["chain_ladder"], ...]` (the Literal union widens in Story 2.3 with `"bornhuetter_ferguson"`, `"mack"`; a-priori loss ratios field also arrives in 2.3 — do NOT pre-build it).
    - `Lineage`: `engine_version: str`, `chainladder_version: str`, `triangle_hash: str` (the canonical-triangle-JSON sha256 from `triangle_hash()` — *the* Triangle hash, never the raw-file hash), `parameters: RunParameters`. Exactly the four ingredients AD-11 names.
    - `DevelopmentFactor`: `from_dev: str`, `to_dev: str`, `factor: float` — LDFs keyed by Development Period **labels**, not indices (Consistency Conventions: labels everywhere; same rule as 2.1's findings).
    - `OriginResult`: `origin: str`, `ultimate: float`, `ibnr: float`.
    - `MethodResult`: `method: Literal["chain_ladder"]`, `development_factors: tuple[DevelopmentFactor, ...]`, `origin_results: tuple[OriginResult, ...]` (one per Origin Period, triangle row order).
    - `ResultSet`: `schema_version: str` (serializes as `schemaVersion`; fix the value `"1.0.0"` — Story 2.6 owns schema export/versioning governance, this story just carries the field per AD-10), `lineage: Lineage`, `method_results: tuple[MethodResult, ...]`.
  - [x] 1.3 Reject non-finite floats on every float field (mirror Triangle's NaN/±Inf rejection — a model validator or `field_validator` with `math.isfinite`). A ResultSet that fails validation is never stored (AD-10); NaN leaking from numpy must fail loud at construction, not serialize as `NaN` and break JSON.
  - [x] 1.4 Module docstring: AD-2 purity contract + "this shape is the AD-10 cross-runtime contract; Story 2.6 exports its JSON Schema and CI-diffs Convex validators against it — field changes are contract changes."
- [x] Task 2: `run_methods` — `engine/reserving_engine/methods.py` (AC: 1, 2)
  - [x] 2.1 Typed boundary error in the same module: `class InvalidTriangleError(ValueError)` carrying the `ValidationReport` (`.report` attribute). `run_methods` first calls `validate_triangle(triangle)`; findings → raise. Engine-boundary enforcement mirrors 2.3's explicit AC ("enforced at the engine boundary too") — a Method must never see a malformed Triangle regardless of caller discipline. **Design decision flagged for review.**
  - [x] 2.2 `run_methods(triangle: Triangle, parameters: RunParameters | None = None) -> ResultSet` (default = CL only). Signature is the one engine entry point Story 2.5's `POST /runs` will wrap and 2.3 will extend — keep it method-list-driven, not one-function-per-method.
  - [x] 2.3 chainladder bridge (verified against the live venv: chainladder 0.9.2, pandas 2.3.3, numpy 2.4.6 — see Dev Notes "Verified chainladder facts"):
    - Build a long-format `pd.DataFrame` from **observed cells only** (leading non-`None` prefix per row; validation guarantees no interior holes) with **synthetic positional periods**: `origin = 2000 + i`, `development = 2000 + i + j`, `values = cell`. Labels are opaque strings the engine must not parse (2.1 decision); synthetic years are an internal device mapped back to labels by index on the way out. Rows/columns of *our* Triangle are the only label authority.
    - `cl.Triangle(df, origin="origin", development="development", columns=["values"], cumulative=True)` → `cl.Chainladder().fit(tri)`.
    - Extract with `origin_as_datetime=False`: `model.ultimate_.to_frame(...)` (one column, rows in origin order), `model.ibnr_.to_frame(...)`, `model.ldf_.to_frame(...)`.
    - **IBNR NaN mapping**: chainladder returns `NaN` IBNR for a fully-developed origin (latest diagonal at ultimate — verified: genins origin 1). Map `NaN → 0.0`; every other NaN anywhere in extracted output is an error (fail loud via Task 1.3). **Design decision flagged for review.**
    - **LDF slicing**: `ldf_` appends tail columns of `1.0` beyond the triangle horizon (verified: 11 columns for a 10-dev triangle). Take exactly the first `n_dev - 1` factors; `from_dev`/`to_dev` = adjacent `development_periods` labels. A 1-dev triangle yields an empty `development_factors` tuple.
    - Convert every numpy scalar via `float(...)` — ResultSet holds plain Python floats (JSON-serialisable, AD-2).
  - [x] 2.4 Assemble `Lineage` with `ENGINE_VERSION`, `chainladder.__version__` (pure attribute access), `triangle_hash(triangle)`, and the exact `parameters` used (after defaulting). Return `ResultSet`.
  - [x] 2.5 Purity guardrails: NO `cl.load_sample` in `reserving_engine` (it reads package CSV files — tests only); no clock use — verified that `cl.Triangle` valuation_date is data-derived, not `datetime.now()`-derived, so identical inputs give identical outputs across days (AC 2, FR-6's eight-months-later re-derivation in UJ-3). `import chainladder`/`pandas` inside the core is fine: neither is on the import-linter forbidden list, and `include_external_packages = true` squashes externals so their internal `os` imports are not walked. Confirm `uv run lint-imports` stays green (2 contracts kept).
- [x] Task 3: Taylor-Ashe fixture + golden test — `engine/tests/fixtures.py`, `engine/tests/test_golden_taylor_ashe.py` (AC: 3)
  - [x] 3.1 Check in the Taylor-Ashe paid triangle as a plain Python constant (`TAYLOR_ASHE = Triangle(kind="paid", origin_periods=("2001",…,"2010"), development_periods=("12",…,"120"), cells=…)`) in `engine/tests/fixtures.py`. Source of values: `cl.load_sample("genins")` (the GenIns/Taylor-Ashe dataset). Add a one-time cross-check test: fixture cells equal `cl.load_sample("genins")` values (load_sample is fine in tests) — proves the checked-in constant wasn't fat-fingered.
  - [x] 3.2 TDD red first: golden test asserting published CL ultimates. Two assertion tiers per AD-11:
    - **Everywhere** (macOS dev machine included): `math.isclose(rel_tol=1e-8)` against pinned full-precision literals, AND `round(ultimate) == published integer` from Mack (1993) — `3_901_463, 5_433_719, 5_378_826, 5_297_906, 4_858_200, 5_111_171, 5_660_771, 6_784_799, 5_642_266, 4_969_825` (cross-verified against the live chainladder run during story prep; these are the independently published values, the same contract-freezing discipline as 1.5/2.1's pinned vectors).
    - **Pinned platform only** (guard: `sys.platform == "linux" and platform.machine() == "x86_64"` — tests may import `sys`/`platform`): exact `==` on full-precision literals. Pin the literals from a local run (e.g. `3901463.0`, `5433718.8145487895`, `5378826.290064239`, …); if CI's linux/amd64 bits ever differ from macOS-pinned literals, re-pin from CI output and document — the *pinned platform* is the truth (AD-11).
    - Also pin the 9 age-to-age LDFs (published: 3.490607, 1.747333, 1.457413, 1.173852, 1.103824, 1.086269, 1.053874, 1.076555, 1.017725 at 6dp; exact literals on the pinned platform) and total IBNR (published rounded 18,680,856) with the fully-developed origin's IBNR asserted `== 0.0` (locks the NaN→0.0 mapping).
  - [x] 3.3 "Wired to block release": no new CI work — the existing `python` job runs `uv run pytest` and a red test fails the build (Story 1.1). Assert this stays true: do not add skip markers, `xfail`, or a separate non-blocking job for golden tests.
- [x] Task 4: Re-derivation test + determinism (AC: 2, 4)
  - [x] 4.1 Check in a golden ResultSet fixture `engine/tests/fixtures/taylor_ashe_resultset.json` — the full `model_dump_json(by_alias=True)` of the Taylor-Ashe CL run, generated once and committed (also becomes 2.6's schema-drift fixture). Re-derivation test: load fixture → `ResultSet.model_validate_json` → rebuild the Triangle from `fixtures.TAYLOR_ASHE` → assert `triangle_hash(triangle) == stored.lineage.triangle_hash` (proves the stored Lineage points at this Triangle) → `run_methods(triangle, stored.lineage.parameters)` → assert re-derived equals stored **exactly** on the pinned platform (`model_dump()` equality), rel 1e-8 field-wise elsewhere. This is FR-6's replay path executed literally.
  - [x] 4.2 Determinism test (AC 2): two `run_methods` calls on the same Triangle produce bit-identical `model_dump_json()` output (verified achievable — probe runs were bit-identical).
  - [x] 4.3 Boundary tests for Task 2.1: `run_methods` on a Triangle with findings raises `InvalidTriangleError` whose `.report` carries the cell-level findings; incurred Triangle runs fine (CL is kind-agnostic; only validation differs per OQ-6).
- [x] Task 5: Package surface + docs
  - [x] 5.1 `engine/reserving_engine/__init__.py`: add `ResultSet`, `Lineage`, `MethodResult`, `OriginResult`, `DevelopmentFactor`, `RunParameters`, `run_methods`, `InvalidTriangleError`, `ENGINE_VERSION` to the existing re-exports (keep 2.1's exports intact — `test_scaffold.py` and existing tests must stay green).
  - [x] 5.2 README "Reserving engine" subsection: add one short paragraph — `run_methods` → ResultSet with Lineage, Taylor-Ashe golden tests, exact-on-pinned-platform / 1e-8 cross-platform rule (AD-11).
- [x] Task 6: Verification (all ACs)
  - [x] 6.1 Full battery from `engine/` cwd (`package = false` — imports only resolve there): `uv run pytest` (2.1's 44 tests + new, all green), `uv run ruff check .`, `uv run lint-imports` (2 contracts kept). Node side untouched — no TS changes this story.
  - [ ] 6.2 Confirm CI green on the PR: golden tests must run and pass on linux/amd64 with **exact** equality. GitHub Actions is the truth; Sourcery/GitGuardian flags are triaged noise. *(Awaits commit + push — Rohan commits on explicit ask only. Exact-tier literals were pinned on macOS arm64 and verified byte-identical to the fixture; if CI's linux/amd64 bits differ, re-pin from CI output per Task 3.2.)*

## Dev Notes

### Architecture compliance (non-negotiable)

- **AD-2**: `run_methods` is pure — plain data in, typed JSON-serialisable Pydantic out. No file/network/env/clock/logging. chainladder is invoked as a pure computation library: in-memory DataFrame in, arrays out. Never `cl.load_sample` in the core (reads CSV from package data). The import-linter forbidden contract stays untouched — chainladder/pandas are allowed imports; externals are squashed (`include_external_packages = true`) so their internals aren't walked.
- **AD-10**: ResultSet is *the* cross-runtime contract, camelCase on the wire (`schemaVersion`), carrying `schemaVersion` from day one. Story 2.6 exports the JSON Schema and drift-checks it; don't build export machinery now, but every field you add is permanent contract surface — be minimal.
- **AD-11**: Lineage records exactly engine semver, chainladder version, canonical Triangle hash, all parameters. Golden + re-derivation tests assert **exact** equality on linux/amd64 (the CI-pinned platform) and 1e-8 relative cross-platform — documented, never silently widened.
- **AD-1 clarification**: `reserving_engine` IS the engine — arithmetic here is the whole point. The "no arithmetic" anti-pattern binds everything *outside* this package.
- **Three-hash discipline**: `lineage.triangle_hash` is the canonical-triangle-JSON sha256 from `triangle_hash()` (2.1) — never the raw-file hash (Epic 3), never the audit-chain hash (1.5). Docstring must say which one it holds.
- **Vocabulary** (PRD §3): `ResultSet`, `Lineage`, `Origin Period`, `Development Period`, `Method` — exact terms in identifiers. No "job", "analysis", "output_set".

### Design decisions this story fixes (flagged for review)

1. **Synthetic positional periods** bridge opaque labels to chainladder: `origin = 2000 + i`, `development = 2000 + i + j` (annual grain), results mapped back to labels by index. The engine never parses label strings (2.1 decision: labels are opaque; period semantics are Epic 3's concern). Verified to reproduce genins results bit-identically vs. native loading.
2. **IBNR NaN → 0.0** for fully-developed origins (chainladder emits NaN when the latest diagonal is at ultimate). Any other non-finite value in extracted output fails ResultSet construction loud.
3. **LDFs are method-level** (one factor per adjacent Development Period pair, `n_dev - 1` of them), keyed by labels via `DevelopmentFactor{from_dev, to_dev, factor}` — chainladder's appended tail-of-1.0 columns are sliced off.
4. **`run_methods` validates at the boundary** and raises `InvalidTriangleError` (carrying the `ValidationReport`) rather than trusting callers — consistent with 2.3's "enforced at the engine boundary too".
5. **`schema_version = "1.0.0"`** as a plain string; versioning governance (when to bump, export format) is Story 2.6's.
6. **`ENGINE_VERSION` constant** in the core (can't read pyproject — AD-2), lockstep-tested against `pyproject.toml` from the test suite.

If the reviewer disagrees, the golden ResultSet fixture (Task 4.1) encodes the same decisions — change both together.

### What NOT to build (scope boundaries)

- **No BF, no Mack, no a-priori loss ratios** — Story 2.3. Keep `RunParameters.methods` a one-member Literal for now; 2.3 widens it.
- **No Diagnostics, no Diagnostic IDs, no `runId`** — Story 2.4 computes diagnostics; `runId` is a product-plane correlation key that enters with 2.4/2.5. ResultSet/Lineage this story carry no runId (nothing in FR-5/AD-11's Lineage list includes it).
- **No FastAPI endpoint, no idempotency machinery** — Story 2.5 wraps `run_methods` in `POST /runs`.
- **No JSON Schema export, no Convex validators/TS types** — Story 2.6. The camelCase-aliased Pydantic models are enough contract for now.
- **No Convex/frontend work.** Zero TypeScript changes.
- **No tail estimation, no method knobs** (development-period selection, averaging windows) — v1 CL is the vanilla `cl.Chainladder` estimator; parameters beyond the method list arrive when a story demands them.

### Existing files being modified — current state

- [engine/reserving_engine/__init__.py](engine/reserving_engine/__init__.py) — exports `Triangle`, `ValidationFinding`, `ValidationReport`, `validate_triangle`, `canonical_triangle_json`, `triangle_hash`. **Change**: append new exports (Task 5.1). **Preserve**: all existing exports; `test_scaffold.py` must keep passing.
- [engine/pyproject.toml](engine/pyproject.toml) — chainladder==0.9.2, pandas, pydantic already pinned; `[tool.importlinter]` 2 contracts; `[tool.ruff]` line-length 100; `[tool.uv] package = false`; `[project] version = "0.1.0"`. **Change**: none expected (all deps present). **Preserve**: contracts, pins, version (Task 1.1's sync test reads it).
- [README.md](README.md) — has "Reserving engine (Story 2.1, AD-2)" subsection. **Change**: extend with run_methods/golden-test paragraph. **Preserve**: existing content.
- New files: `engine/reserving_engine/resultset.py`, `engine/reserving_engine/methods.py`, `engine/reserving_engine/version.py`, `engine/tests/fixtures.py`, `engine/tests/fixtures/taylor_ashe_resultset.json`, `engine/tests/test_golden_taylor_ashe.py`, `engine/tests/test_run_methods.py` (+ version-sync test wherever fits).
- Untouched: `triangle.py`, `validation.py` (consume, don't modify), `.github/workflows/ci.yml` (pytest already blocks on red — Task 3.3), all TS.

### Verified chainladder facts (probed live against engine/.venv, 2026-07-16)

- chainladder 0.9.2, pandas 2.3.3, numpy 2.4.6 (uv.lock-pinned).
- `cl.Triangle(long_df, origin=, development=, columns=, cumulative=True)` accepts integer synthetic years; grain resolves to `Y`/`Y`; `valuation_date` is **data-derived** (max development in the data), not clock-derived — cross-day determinism holds.
- `cl.Chainladder().fit(tri)` exposes `ultimate_`, `ibnr_`, `latest_diagonal`, `ldf_`; `.to_frame(origin_as_datetime=False)` gives plain frames in origin order.
- genins (= Taylor-Ashe) via synthetic rebuild reproduces native-load results **bit-identically**; repeated runs are bit-identical.
- `ibnr_` holds `NaN` for the fully-developed first origin; `ldf_` frame has `n_dev + 1` columns (appended 1.0 tails) for an `n_dev`-column triangle — slice to `n_dev - 1`.
- Published Mack (1993) check: ultimates round to 3,901,463 / 5,433,719 / 5,378,826 / 5,297,906 / 4,858,200 / 5,111,171 / 5,660,771 / 6,784,799 / 5,642,266 / 4,969,825; LDFs 3.490607, 1.747333, 1.457413, 1.173852, 1.103824, 1.086269, 1.053874, 1.076555, 1.017725; total IBNR 18,680,856. Live run matches all.
- Pydantic v2: `from pydantic.alias_generators import to_camel`; `ConfigDict(alias_generator=to_camel, populate_by_name=True, frozen=True)`; `model_dump_json(by_alias=True)`.

### Previous story intelligence (2.1, currently in review on this branch)

- **You are building directly on 2.1's code** (branch `epic_2/2_1`, commit c2a13f5, status `review`). Branch `epic_2/2_2` off it per Rohan's one-PR-per-story rhythm; if 2.1 review lands changes, rebase.
- **Pinned known-answer discipline** (1.5 → 2.1): never pin a literal you haven't independently cross-verified. Here the independent source is Mack (1993) published values; full-precision literals get the platform-gated exact tier.
- **`cell is not None`, never truthiness** — a legitimate `0.0` cell is falsy. Bites again when building the long DataFrame from observed prefixes.
- **Validation semantics you can rely on**: a `valid=True` Triangle has leading-contiguous observed prefixes, no interior holes, non-increasing prefix lengths, no empty rows (2.1 fixed these). So the long-DataFrame builder may simply take each row's leading non-`None` run.
- **Working rhythm** (Rohan): TDD red-first per task; commit only on explicit ask; run everything from `engine/` cwd; CI is the truth, Sourcery/GitGuardian are triaged noise.
- **Fail-loud standard** (1.4/1.5/2.1 reviews): reject garbage at construction (Task 1.3's finite-float validators) rather than emitting a hash/JSON of garbage.

### Project Structure Notes

- Spine Structural Seed: `reserving_engine/` = "methods, diagnostics, validation, schemas (Pydantic)" — `methods.py` and `resultset.py` fit the seed exactly; `diagnostics.py` waits for 2.4.
- Naming: snake_case modules, PRD-glossary identifiers; camelCase only on the JSON wire (aliases).
- Tests stay flat in `engine/tests/` (2.1 pattern); the JSON fixture goes in `engine/tests/fixtures/` (new dir).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.2] — story + ACs; Epic 2 build-order ("engine + golden tests first"); Story 2.3/2.5/2.6 boundaries
- [Source: _bmad-output/planning-artifacts/architecture/architecture-agentic-reserving-2026-07-16/ARCHITECTURE-SPINE.md#AD-2/#AD-10/#AD-11] — purity, versioned cross-runtime contract, pinned-platform-exact reproducibility; #Consistency Conventions — vocabulary, hashes, JSON/formats; #Structural Seed — module layout; #Stack — chainladder 0.9.2 pin
- [Source: _bmad-output/planning-artifacts/prds/prd-agentic-reserving-2026-07-16/prd.md#FR-5/#FR-6/#NFR-1/#NFR-6] — ResultSet contents, Lineage ingredients, bit-for-bit re-derivation with documented-epsilon fallback, Taylor-Ashe golden mandate; #§3 Glossary — ResultSet/Lineage exact definitions
- [Source: _bmad-output/project-context.md] — golden-master release gate, 1e-8 cross-platform tolerance, anti-patterns
- [Source: _bmad-output/implementation-artifacts/2-1-triangle-model-and-validation-core.md] — Triangle/validation semantics, pinned-vector pattern, working rhythm, cwd quirk
- [Source: live probe of engine/.venv chainladder 0.9.2, 2026-07-16] — API shapes, NaN/tail behaviors, determinism, published-value match (recorded under "Verified chainladder facts")

## Dev Agent Record

### Agent Model Used

Claude Fable 5 (claude-fable-5) via BMad dev-story (Amelia)

### Debug Log References

- Red→green per task: model tests failed on ImportError before `resultset.py`/`version.py` existed; `run_methods` tests failed before `methods.py` existed.
- One unplanned finding: chainladder 0.9.2 raises `IndexError` (core/base.py:540) fitting a triangle with a single development column. Handled with an explicit `n_dev == 1` degenerate branch in `_run_chain_ladder` (no factors, ultimate = the observed value, IBNR 0.0) — mathematically what CL degenerates to. **Additional design decision for review.**
- Full-precision golden literals extracted from the live venv run and cross-checked against Mack (1993) published values before pinning (ultimates, IBNR, 9 LDFs, total IBNR 18,680,856).

### Completion Notes List

- Task 1: `ResultSet`/`Lineage`/`MethodResult`/`OriginResult`/`DevelopmentFactor`/`RunParameters` in `resultset.py`, all frozen + `to_camel` aliases + `populate_by_name`; finite-float `field_validator` on every float field; `ENGINE_VERSION = "0.1.0"` in `version.py` with tomllib lockstep test.
- Task 2: `run_methods` in `methods.py` — boundary validation raising `InvalidTriangleError` (`.report` carries the `ValidationReport`), synthetic positional period bridge (`2000+i` / `2000+i+j`), observed-prefix long DataFrame (`cell is not None`), IBNR NaN→0.0, LDF slice to `n_dev - 1`, `float()` conversions, no `load_sample`/clock in core.
- Task 3: `TAYLOR_ASHE` constant in `tests/fixtures.py` cross-checked cell-by-cell against `cl.load_sample("genins")`; golden test with everywhere-tier (rel 1e-8 + published Mack roundings) and pinned-platform exact tier (`sys.platform == "linux" and platform.machine() == "x86_64"`); no xfail/skip on the blocking tests — the platform `skipif` gates only the exact tier as the story specifies.
- Task 4: golden ResultSet fixture `tests/fixtures/taylor_ashe_resultset.json` (generated once, committed); re-derivation test proves `lineage.triangle_hash` points at the fixture Triangle then replays `run_methods(triangle, stored.lineage.parameters)` — exact `model_dump()` equality on the pinned platform, field-wise 1e-8 elsewhere; determinism test asserts bit-identical `model_dump_json()` across runs; boundary tests (findings → `InvalidTriangleError` with cell-level report; incurred triangle runs fine).
- Task 5: 9 new re-exports appended to `__init__.py` (2.1 exports intact); README engine subsection extended with run_methods/golden-test paragraph.
- Task 6.1: from `engine/` cwd — `uv run pytest`: **78 passed, 3 skipped** (skips = exact tier, linux-only; 2.1's 44 tests all green), `uv run ruff check .` clean, `uv run lint-imports` 2 contracts kept.
- Task 6.2 open: CI confirmation awaits commit+push (explicit ask per working rhythm).

### File List

- engine/reserving_engine/resultset.py (new)
- engine/reserving_engine/methods.py (new)
- engine/reserving_engine/version.py (new)
- engine/reserving_engine/__init__.py (modified — new re-exports)
- engine/tests/fixtures.py (new)
- engine/tests/fixtures/taylor_ashe_resultset.json (new)
- engine/tests/test_resultset_models.py (new)
- engine/tests/test_version_sync.py (new)
- engine/tests/test_run_methods.py (new)
- engine/tests/test_golden_taylor_ashe.py (new)
- engine/tests/test_rederivation.py (new)
- README.md (modified — engine subsection paragraph)
- _bmad-output/implementation-artifacts/sprint-status.yaml (modified — story status)
- _bmad-output/implementation-artifacts/2-2-chain-ladder-with-resultset-lineage-and-golden-test.md (modified — this record)

## Change Log

- 2026-07-16: Implementation complete (Amelia/dev-story) — ResultSet+Lineage models, run_methods with boundary validation and chainladder bridge, Taylor-Ashe golden tests (two AD-11 tiers), re-derivation + determinism tests, exports + README. 78 passed / 3 platform-gated skips locally; ruff + import-linter green. Added n_dev==1 degenerate-CL branch (chainladder IndexError) as a seventh design decision for review. CI exact-tier confirmation pending commit/push.
- 2026-07-16: Story created via BMad create-story (Amelia) — full context from epics Story 2.2, spine AD-2/AD-10/AD-11, PRD FR-5/FR-6/NFR-1/NFR-6, 2.1 story intelligence, and live chainladder 0.9.2 probes (synthetic-period bridge, IBNR-NaN and LDF-tail behaviors, bit-identical determinism, Mack 1993 published-value match). Six design decisions fixed and flagged for review.
