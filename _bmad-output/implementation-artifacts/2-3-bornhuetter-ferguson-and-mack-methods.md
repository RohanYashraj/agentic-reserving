---
baseline_commit: e86fe49565583bb47139b0b057f17130ad5e78a4
---

# Story 2.3: Bornhuetter-Ferguson and Mack Methods

Status: done

## Story

As an actuary,
I want BF (with per-Origin-Period A Priori Loss Ratios) and Mack (with standard errors) alongside CL,
so that all three v1 Methods are available from one engine call. (FR-5, NFR-1)

## Acceptance Criteria

1. **Given** a validated Triangle and a complete set of A Priori Loss Ratios, **When** BF runs, **Then** the ResultSet includes BF ultimates and IBNR per Origin Period with the a prioris recorded in Lineage.
2. **And** BF invocation without a complete a-priori set raises a typed error naming the missing Origin Periods (FR-4 consequence, enforced at the engine boundary too).
3. **Given** the same Triangle, **When** Mack runs, **Then** the ResultSet includes Mack standard errors and reserve ranges per Origin Period.
4. **And** Taylor-Ashe golden tests assert published Mack standard errors and BF results at exact equality on the pinned platform (NFR-1).
5. **And** any Method combination (subset of {CL, BF, Mack}) runs in one call producing one ResultSet.

## Tasks / Subtasks

- [x] Task 1: Widen the ResultSet contract — `engine/reserving_engine/resultset.py` (AC: 1, 3)
  - [x] 1.1 Widen `RunParameters.methods` to `tuple[Literal["chain_ladder", "bornhuetter_ferguson", "mack"], ...]` (default stays `("chain_ladder",)` — existing callers and the 2.2 fixture must keep parsing). Widen `MethodResult.method` with the same Literal.
  - [x] 1.2 New model `AprioriLossRatio` (same `_MODEL_CONFIG`): `origin: str`, `loss_ratio: float`, `exposure: float` — finite-float validators on both floats plus `> 0` on `exposure` and `>= 0` on `loss_ratio` (a zero ELR is a legal "expect nothing more" prior; a non-positive exposure is garbage). Wire shape: `lossRatio`, `exposure`. **Why exposure lives here**: BF's expected ultimate is `loss_ratio × exposure`, and AD-1 forbids that multiplication anywhere outside `reserving_engine` — the product plane may never compute it. Design decision #1, flagged for review (see Dev Notes: PRD gap).
  - [x] 1.3 `RunParameters` gains `apriori_loss_ratios: tuple[AprioriLossRatio, ...] = ()` (wire: `aprioriLossRatios`). Defaulted-empty keeps the committed 2.2 fixture `taylor_ashe_resultset.json` parsing unchanged — verify `test_rederivation.py` stays green untouched.
  - [x] 1.4 `OriginResult` gains three optional fields, `None` unless the Method is Mack: `mack_std_err: float | None = None`, `reserve_low: float | None = None`, `reserve_high: float | None = None` (finite when present; reuse `_require_finite` guarded for `None`). `MethodResult` gains `total_mack_std_err: float | None = None` — the total is NOT the sum of per-origin SEs (correlation term), so if the engine doesn't emit it the product can never show it (AD-1). Single `OriginResult` shape, not per-method subclasses — keeps 2.6's Convex validator single-sourced and simple. Design decision #2.
  - [x] 1.5 `schema_version` stays `"1.0.0"` — nothing is exported yet; versioning governance is Story 2.6's. Note in the module docstring that 2.3 widened the shape pre-export.
- [x] Task 2: BF runner — `engine/reserving_engine/methods.py` (AC: 1, 2)
  - [x] 2.1 Typed error in `methods.py`: `class MissingAprioriError(ValueError)` carrying `missing_origins: tuple[str, ...]` — message names them. Raised by `run_methods` (boundary check, before any Method runs) when `"bornhuetter_ferguson" ∈ parameters.methods` and the a-priori set does not cover every `triangle.origin_periods` label exactly. Also fail loud (`ValueError`) on duplicate origins and on a-priori entries naming origins not in the Triangle — silent extras are how mismatched grids slip through. A prioris supplied when BF is NOT requested are allowed and recorded verbatim in Lineage (parameters as given). Design decision #3.
  - [x] 2.2 Refactor `_METHOD_RUNNERS` so runners take `(triangle, parameters)` — BF needs the a prioris; CL/Mack ignore the second arg. Preserve `parameters.methods` execution order (AC 5: one call, one ResultSet, MethodResults in requested order).
  - [x] 2.3 `_run_bornhuetter_ferguson(triangle, parameters)`:
    - Reuse `_to_long_dataframe` + the same `cl.Triangle(...)` construction as CL (synthetic positional periods `origin = 2000 + i`, `development = 2000 + i + j` — 2.2's label bridge, unchanged).
    - Exposure vector: build a second long frame with one row per origin — `origin = 2000 + i`, `development = 2000 + (n_origins - 1)` (the latest valuation year, SAME for every row so all cells sit on the latest diagonal), `values = loss_ratio × exposure` for that origin's `AprioriLossRatio`. Then `cl.Triangle(..., cumulative=True).latest_diagonal`. **Verified live**: putting each origin's exposure at `development = origin` valuates only the newest origin and silently NaNs the rest — the constant-development form is load-bearing.
    - `cl.BornhuetterFerguson(apriori=1.0).fit(cl_triangle, sample_weight=exposure_diagonal)` — the ELR×exposure product is already in `sample_weight`, so the scalar `apriori` stays 1.0. Extract `ultimate_`/`ibnr_` with `.to_frame(origin_as_datetime=False)` exactly like CL.
    - NaN mapping: BF emits NaN IBNR for the fully-developed first origin (verified) — map `NaN → 0.0`, same rule as CL. Any other non-finite fails ResultSet construction loud (2.2's Task 1.3 validators).
    - `development_factors`: BF's fitted `ldf_` equals CL's volume-weighted factors (verified) — extract and slice to `n_dev - 1` exactly like CL (tail-of-1.0 columns appended).
    - `n_dev == 1` degenerate branch (chainladder IndexError, same as 2.2's CL finding): CDF = 1 ⇒ ultimate = the observed value, IBNR = 0.0, no factors.
  - [x] 2.4 Method name in `MethodResult`: `"bornhuetter_ferguson"` — PRD §3 vocabulary, snake_case like `"chain_ladder"`.
- [x] Task 3: Mack runner — `engine/reserving_engine/methods.py` (AC: 3)
  - [x] 3.1 `_run_mack(triangle, parameters)`:
    - Same `cl.Triangle` bridge, then `dev = cl.Development(sigma_interpolation="mack").fit_transform(cl_triangle)` → `model = cl.MackChainladder().fit(dev)`. **`sigma_interpolation="mack"` is load-bearing**: the default `"log-linear"` gives SEs (71,835 / 119,474 / … total 2,441,364) that do NOT match Mack (1993); `"mack"` reproduces the published values exactly at rounding (75,535 / 121,699 / … total 2,447,095) — verified live. This is Mack's own last-sigma rule from the 1993 paper. Design decision #4.
    - Point estimates: Mack ultimates/IBNR are identical to CL's (verified `equals` — Mack is distribution-around-CL); extract from `model.ultimate_`/`model.ibnr_` anyway (the estimator's own output, no cross-method copying).
    - Per-origin `mack_std_err`: from `model.summary_.to_frame(origin_as_datetime=False)["Mack Std Err"]`. NaN for the fully-developed first origin → map to `0.0` (zero remaining variance; Mack's paper prints "—").
    - `reserve_low = ibnr - mack_std_err`, `reserve_high = ibnr + mack_std_err` — a ±1-SE band, computed in the engine (AD-1), not floored at zero (a band that crosses zero is information, not an error; document in docstring). Design decision #5.
    - `total_mack_std_err`: `float(model.total_mack_std_err_.iloc[0, 0])`.
    - `development_factors`: same volume-weighted factors, slice `n_dev - 1`.
    - `n_dev == 1` degenerate branch: ultimate = observed, ibnr = 0.0, `mack_std_err = 0.0`, `reserve_low = reserve_high = 0.0`, `total_mack_std_err = 0.0`, no factors.
  - [x] 3.2 Method name: `"mack"`.
- [x] Task 4: Taylor-Ashe golden tests — `engine/tests/test_golden_taylor_ashe.py` (AC: 4)
  - [x] 4.1 TDD red first. Reuse `fixtures.TAYLOR_ASHE` and the 2.2 two-tier pattern verbatim (everywhere: `math.isclose(rel_tol=1e-8)` + published-value roundings; pinned platform `sys.platform == "linux" and platform.machine() == "x86_64"`: exact `==` on full-precision literals).
  - [x] 4.2 Mack golden: run `run_methods(TAYLOR_ASHE, RunParameters(methods=("mack",)))`.
    - Published tier (Mack 1993, independently verifiable): per-origin SEs round to `75_535, 121_699, 133_549, 261_406, 411_010, 558_317, 875_328, 971_258, 1_363_155` (origins 2002–2010), first origin `== 0.0` (locks the NaN→0.0 mapping); `round(total_mack_std_err) == 2_447_095`; Mack ultimates equal the CL published roundings from 2.2 (same point estimates).
    - Exact tier: pin full-precision literals from a local run — expected (macOS probe, re-pin from CI if linux/amd64 bits differ, pinned platform is the truth per AD-11): `75535.04075748847, 121698.56164542316, 133548.85301207818, 261406.44934268497, 411009.70388105337, 558316.8580711902, 875327.5119113588, 971257.8064699423, 1363154.9117323074`; total `2447094.860834665`.
    - Assert reserve ranges: `reserve_low == ibnr - mack_std_err` and `reserve_high == ibnr + mack_std_err` field-wise (locks decision #5 into the contract).
  - [x] 4.3 BF golden: no canonical published BF table exists for Taylor-Ashe (BF depends on the chosen prior), so the independent anchor is the **BF identity**: `ultimate_i = latest_i + (1 − 1/CDF_i) × (loss_ratio_i × exposure_i)`, hand-computable from 2.2's pinned LDFs. Use the canonical test prior: `loss_ratio = 0.9`, `exposure = 5_000_000.0` for every origin (expected ultimate 4.5M each).
    - Everywhere tier: assert each BF ultimate equals the identity computed from the pinned CDF products at `rel_tol=1e-8` (verified: chainladder matches the closed form to the last ulp, one origin differs by exactly 1 ulp — hence 1e-8, not `==`, for the identity check).
    - Exact tier: pin full-precision BF ultimates from a local run — expected: `3901463.0, 5417457.138861756, 5302114.59815617, 5191028.845834934, 4785582.871270964, 4941438.7235875055, 5214234.022437022, 5464627.277626088, 4775996.323187843, 4532521.523869674` — and the corresponding IBNRs (first origin `== 0.0`, locks BF's NaN→0.0).
  - [x] 4.4 No skip/xfail on blocking tests; platform guard gates only the exact tier (2.2 rule — "wired to block release" is already true via the existing CI pytest job).
- [x] Task 5: run_methods combination + error tests — `engine/tests/test_run_methods.py` (AC: 2, 5)
  - [x] 5.1 Missing-a-priori tests: BF requested with (a) no a prioris, (b) a partial set — `MissingAprioriError` raised, `missing_origins` names exactly the uncovered Origin Period labels, message contains them. Duplicate-origin and unknown-origin entries raise `ValueError` naming the offender.
  - [x] 5.2 Combination test: `methods=("chain_ladder", "bornhuetter_ferguson", "mack")` with a complete a-priori set returns ONE ResultSet with three MethodResults in requested order; a two-method subset works; order `("mack", "chain_ladder")` preserves request order. CL/Mack-only runs need no a prioris.
  - [x] 5.3 Lineage test: after a BF run, `resultset.lineage.parameters.apriori_loss_ratios` equals the supplied set verbatim (AC 1's "recorded in Lineage" — parameters are already embedded whole, this just asserts it).
  - [x] 5.4 Determinism: two identical three-method calls produce bit-identical `model_dump_json()` (extends 2.2's test; Mack + BF verified deterministic in live probes).
  - [x] 5.5 Mack-fields discipline: CL and BF OriginResults carry `mack_std_err is None` / range fields `None`; `total_mack_std_err is None` on non-Mack MethodResults.
- [x] Task 6: Re-derivation fixture for the full three-method run (AC: 4, 5)
  - [x] 6.1 New committed fixture `engine/tests/fixtures/taylor_ashe_all_methods_resultset.json`: `model_dump_json(by_alias=True)` of the three-method Taylor-Ashe run with the canonical test prior (0.9 / 5,000,000). Generate once, commit (also becomes 2.6 drift-check material).
  - [x] 6.2 Extend `test_rederivation.py`: load fixture → `ResultSet.model_validate_json` → assert `triangle_hash(TAYLOR_ASHE) == stored.lineage.triangle_hash` → replay `run_methods(TAYLOR_ASHE, stored.lineage.parameters)` → exact `model_dump()` equality on the pinned platform, field-wise 1e-8 elsewhere. The existing 2.2 CL-only fixture and test stay untouched and green (proves the widened `RunParameters` still parses old Lineage — backward-compat is part of the contract).
- [x] Task 7: Package surface + docs
  - [x] 7.1 `engine/reserving_engine/__init__.py`: add `AprioriLossRatio`, `MissingAprioriError` to imports and `__all__` (keep all 15 existing exports — `test_scaffold.py` must stay green).
  - [x] 7.2 README engine subsection: one short paragraph — all three v1 Methods from one `run_methods` call, BF a prioris (loss ratio × exposure, engine-side per AD-1), Mack SEs matching Mack (1993) via `sigma_interpolation="mack"`.
- [x] Task 8: Verification (all ACs)
  - [x] 8.1 Full battery from `engine/` cwd: `uv run pytest` (2.2's 78 + new, all green; 3+ platform-gated skips expected on macOS), `uv run ruff check .`, `uv run lint-imports` (2 contracts kept). No TS changes — Node side untouched.
  - [x] 8.2 Confirm CI green on the PR: exact tiers must pass on linux/amd64. If CI bits differ from macOS-pinned literals, re-pin from CI output and document (AD-11 — pinned platform is the truth). CONFIRMED: PR #8 CI green — Python (engine) job passed on linux/amd64, so the exact tiers ran and every macOS-pinned literal matched bit-for-bit; no re-pinning needed.

## Dev Notes

### Architecture compliance (non-negotiable)

- **AD-1 (engine-side arithmetic)**: `expected_ultimate = loss_ratio × exposure`, `reserve_low/high = ibnr ∓ se`, and `total_mack_std_err` are all reserve-figure arithmetic — they MUST happen inside `reserving_engine`. This is exactly why `AprioriLossRatio` carries `exposure` and why the total SE is a ResultSet field rather than something the UI sums (it can't — correlation term).
- **AD-2 (purity)**: no new I/O of any kind. `cl.Development`, `cl.MackChainladder`, `cl.BornhuetterFerguson` are in-memory estimators like `cl.Chainladder` — same import-linter posture as 2.2 (externals squashed). Never `cl.load_sample` in the core. No clock: BF/Mack valuation is data-derived like CL (verified).
- **AD-10 (contract minimalism)**: every field added this story is permanent contract surface for 2.6's schema export. The additions are exactly: `AprioriLossRatio` (3 fields), `RunParameters.apriori_loss_ratios`, `OriginResult.{mack_std_err, reserve_low, reserve_high}`, `MethodResult.total_mack_std_err`, two Literal widenings. Nothing else. camelCase on the wire via the existing `to_camel` alias config.
- **AD-11 (Lineage + golden discipline)**: a prioris enter Lineage automatically because `Lineage.parameters` embeds `RunParameters` whole — the spine names "all parameters (including a priori loss ratios)" explicitly. Exact equality on linux/amd64, 1e-8 relative cross-platform, never silently widened.
- **Vocabulary (PRD §3)**: `A Priori Loss Ratio`, `Method`, `Origin Period`, `ResultSet`, `Lineage` — exact terms. Method literals: `"chain_ladder"`, `"bornhuetter_ferguson"`, `"mack"`. No "ELR", "prior", "job".

### Design decisions this story fixes (flagged for review)

1. **`AprioriLossRatio{origin, loss_ratio, exposure}`** — the PRD (FR-4, §3 Glossary, OQ-5) specifies only a per-origin loss ratio and never mentions an exposure base, but BF is mathematically undefined without one (expected ultimate = ELR × premium), and AD-1 forces the multiplication into the engine. The engine contract therefore takes both per origin. **This is a PRD gap with product-plane consequences**: Story 4.1's a-priori grid ("one input per Origin Period") will need an exposure column too — raised as an end-of-story question for Rohan / correct-course candidate. The engine-side contract is right regardless of how the UI collects the numbers.
2. **Single `OriginResult` with optional Mack fields** (`None` for CL/BF) rather than per-method subclasses — one shape for 2.6's validators.
3. **A-priori completeness enforced at the `run_methods` boundary** (before any Method runs): missing origins → `MissingAprioriError` naming them; duplicates/unknowns → `ValueError`. Supplied-but-unused a prioris (BF not requested) are permitted and recorded verbatim.
4. **`sigma_interpolation="mack"`** for the Mack estimator — chainladder's default `log-linear` does NOT reproduce Mack (1993); `"mack"` does, exactly at rounding (verified live). Without this the golden test's published anchor is unreachable.
5. **Reserve range = IBNR ± 1 Mack SE**, engine-computed, not floored at zero.
6. **BF exposure bridge**: per-origin `loss_ratio × exposure` placed on a constant-development synthetic diagonal (`development = 2000 + n_origins − 1` for every row), `cumulative=True`, `.latest_diagonal`, fed as `sample_weight` with scalar `apriori=1.0`.
7. **NaN mappings extended**: BF IBNR NaN→0.0 and Mack SE NaN→0.0 for the fully-developed origin — same rule and rationale as 2.2's CL IBNR mapping. Everything else non-finite fails loud at ResultSet construction.

If the reviewer disagrees, the new golden fixture (Task 6.1) encodes the same decisions — change both together.

### What NOT to build (scope boundaries)

- **No Diagnostics, no Diagnostic IDs, no `runId`, no CL-vs-BF divergence** — Story 2.4 (divergence needs both methods; it lands there, not here).
- **No FastAPI endpoint, no idempotency** — Story 2.5.
- **No JSON Schema export / Convex validators** — Story 2.6; keep additions minimal, `schema_version` stays `"1.0.0"`.
- **No Convex/frontend/TS work** — the a-priori grid UI is Story 4.1.
- **No Mack knobs** (alpha, tail, drop rules) beyond `sigma_interpolation="mack"`; no `apriori_sigma`/`random_state` on BF (defaults 0.0/None are deterministic — leave them untouched).
- **No CSV a-priori import** (OQ-5 is open; v1 takes structured parameters).

### Existing files being modified — current state

- [engine/reserving_engine/resultset.py](engine/reserving_engine/resultset.py) — frozen camelCase-wire models; `RunParameters.methods` is a one-member Literal tuple; finite-float validators via `_require_finite`. **Change**: Task 1 widenings + `AprioriLossRatio`. **Preserve**: `_MODEL_CONFIG` pattern, existing field names/aliases, finite-float discipline, `schema_version = "1.0.0"`.
- [engine/reserving_engine/methods.py](engine/reserving_engine/methods.py) — `run_methods` validates at boundary (`InvalidTriangleError`), `_to_long_dataframe` builds observed-prefix long frames (`cell is not None`), `_run_chain_ladder` has the `n_dev == 1` degenerate branch and NaN→0.0 IBNR mapping, `_METHOD_RUNNERS` registry dispatches. **Change**: runner signature `(triangle, parameters)`, add BF/Mack runners + `MissingAprioriError`, a-priori boundary checks. **Preserve**: CL behavior bit-identically (2.2 golden fixture must not change), label-bridge docstring, validation-first ordering.
- [engine/reserving_engine/__init__.py](engine/reserving_engine/__init__.py) — 15 exports. **Change**: +2 exports. **Preserve**: all existing.
- [engine/tests/test_golden_taylor_ashe.py](engine/tests/test_golden_taylor_ashe.py) — two-tier pattern, platform guard, published CL values. **Change**: add Mack + BF golden tests (same file or sibling functions). **Preserve**: existing CL assertions untouched.
- [engine/tests/test_run_methods.py](engine/tests/test_run_methods.py), [engine/tests/test_rederivation.py](engine/tests/test_rederivation.py) — extend, don't rewrite; the 2.2 CL-only fixture replay must stay green.
- Untouched: `triangle.py`, `validation.py`, `version.py` (`ENGINE_VERSION` stays `0.1.0` — additive pre-release work, pyproject untouched), `fixtures.py` (`TAYLOR_ASHE` reused as-is), `.github/workflows/ci.yml`, all TS.
- New files: `engine/tests/fixtures/taylor_ashe_all_methods_resultset.json` only.

### Verified chainladder facts (probed live against engine/.venv, 2026-07-17)

- chainladder 0.9.2, pandas 2.3.3, numpy 2.4.6 (uv.lock-pinned), same as 2.2.
- **Mack**: `cl.MackChainladder().fit(cl.Development(sigma_interpolation="mack").fit_transform(tri))` on genins reproduces Mack (1993) published SEs exactly at rounding: 75,535 / 121,699 / 133,549 / 261,406 / 411,010 / 558,317 / 875,328 / 971,258 / 1,363,155; total 2,447,095 (full precision 2447094.860834665). Default `log-linear` gives 71,835 / … / total 2,441,364 — WRONG anchor, do not use. First-origin SE is NaN (fully developed). `summary_` frame has columns Latest / IBNR / Ultimate / Mack Std Err in origin order. Mack ultimates `equals` CL ultimates bit-for-bit. Deterministic across repeat fits.
- **BF**: `cl.BornhuetterFerguson(apriori=1.0, apriori_sigma=0.0, random_state=None)`; `.fit(X, sample_weight=exposure_diagonal)`. `sample_weight` must be a Triangle whose cells all sit on the SAME (latest) valuation — one row per origin with a constant development period, `cumulative=True`, then `.latest_diagonal`. Per-origin distinct values work. Output matches the closed form `latest + (1 − 1/CDF) × sample_weight` to within 1 ulp (one origin differs in the last bit — use rel 1e-8 for the identity assertion, exact `==` only against pinned literals). First-origin IBNR is NaN. Deterministic. `ldf_` equals CL's factors with the appended tail-of-1.0 (slice to `n_dev − 1`).
- **Full-precision pins from the macOS probe** (re-pin from CI if linux/amd64 differs): Mack SEs and BF ultimates/IBNR literals are listed in Tasks 4.2/4.3.
- `sigma_interpolation` does not change CL/BF point estimates (verified) — only Mack SEs.

### Previous story intelligence (2.1 + 2.2, both in review)

- **Branch**: you are on `epic_2/2_3` at e86fe49 (2.2's commit). 2.1/2.2 are status `review`; if their reviews land changes, rebase before finalizing.
- **Reuse, don't rebuild**: `_to_long_dataframe`, the synthetic-period bridge, the `n_dev == 1` degenerate pattern, NaN→0.0 mapping, `float(...)` conversion of every numpy scalar, the two-tier golden pattern with the platform guard, `TAYLOR_ASHE` fixture — all exist and are proven. BF/Mack runners are ~mirror images of `_run_chain_ladder`.
- **Pinned known-answer discipline** (1.5 → 2.1 → 2.2): never pin a literal you haven't independently cross-verified. Mack (1993) is the independent source for Mack SEs; the BF closed-form identity (from 2.2's pinned LDFs) is the independent source for BF. Full-precision literals get the platform-gated exact tier.
- **`cell is not None`, never truthiness** — a 0.0 cell is a value. Applies again in the exposure-frame builder.
- **Fail-loud standard** (1.4/1.5/2.1 reviews): reject garbage at construction — non-finite floats, non-positive exposures, duplicate/unknown a-priori origins.
- **Working rhythm** (Rohan): TDD red-first per task; commit only on explicit ask; run everything from `engine/` cwd (`package = false` — imports only resolve there); CI is the truth, Sourcery/GitGuardian are triaged noise.

### Project Structure Notes

- Spine Structural Seed: BF and Mack live in `reserving_engine/methods.py` alongside CL ("methods, diagnostics, validation, schemas") — no new modules; `diagnostics.py` waits for 2.4.
- Tests stay flat in `engine/tests/`; the new JSON fixture joins the existing one in `engine/tests/fixtures/`.
- Naming: snake_case identifiers, camelCase only on the JSON wire via aliases.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.3] — story + ACs; Epic 2 boundaries (2.4 diagnostics, 2.5 service, 2.6 schema export)
- [Source: _bmad-output/planning-artifacts/prds/prd-agentic-reserving-2026-07-16/prd.md#FR-4/#FR-5/#NFR-1/#§3 Glossary/#OQ-5] — BF a-priori requirement, ResultSet contents (Mack SEs + reserve ranges), golden mandate, A Priori Loss Ratio definition, open question on a-priori sourcing
- [Source: _bmad-output/planning-artifacts/architecture/architecture-agentic-reserving-2026-07-16/ARCHITECTURE-SPINE.md#AD-11] — Lineage records "all parameters (including a priori loss ratios)"; pinned-platform exact equality
- [Source: _bmad-output/project-context.md] — AD-1 no-arithmetic-outside-engine (forces exposure into the engine contract), golden-master gate, anti-patterns
- [Source: _bmad-output/implementation-artifacts/2-2-chain-ladder-with-resultset-lineage-and-golden-test.md] — label bridge, degenerate branch, NaN mapping, two-tier goldens, working rhythm
- [Source: live probe of engine/.venv chainladder 0.9.2, 2026-07-17] — Mack sigma_interpolation finding, BF sample_weight mechanics, closed-form match, full-precision pins, determinism
- [Source: Mack, T. (1993), "Distribution-free calculation of the standard error of chain ladder reserve estimates", ASTIN Bulletin 23(2)] — published SEs and total for the Taylor-Ashe triangle

## Dev Agent Record

### Agent Model Used

Claude Fable 5 (claude-fable-5) via BMad dev-story (Amelia)

### Debug Log References

- Red→green per task: model tests failed on `ImportError: AprioriLossRatio`; run_methods/golden tests failed on `ImportError: MissingAprioriError`; re-derivation tests failed on the missing all-methods fixture — each implemented to green in sequence.
- Two 2.2 tests were legitimately updated by the contract widening (not regressions): `test_unknown_method_rejected` now uses `"cape_cod"` as the unknown method (BF is valid since 2.3), and `test_json_keys_are_camel_case` includes the new optional wire keys (`mackStdErr`, `reserveLow`, `reserveHigh`, `totalMackStdErr`, `aprioriLossRatios` — Pydantic serializes `None` fields, so they appear as `null` on the wire; 2.6 freezes this shape).
- All full-precision pins (Mack SEs, total, BF ultimates/IBNR) matched the story's macOS probe literals bit-for-bit in the implementation run.

### Completion Notes List

- Task 1: `AprioriLossRatio{origin, loss_ratio(≥0), exposure(>0)}` with finite validators; `RunParameters.methods` widened to the three-method Literal, `apriori_loss_ratios` defaulted `()` (2.2 fixture parses unchanged — proven by untouched re-derivation test); `OriginResult` gained optional `mack_std_err`/`reserve_low`/`reserve_high`, `MethodResult` gained `total_mack_std_err` (all finite-or-None); `schema_version` stays "1.0.0"; module docstring notes the pre-export widening.
- Task 2: `MissingAprioriError(ValueError)` with `.missing_origins`; `_check_aprioris` boundary check in `run_methods` (after triangle validation, before any Method): duplicates and Triangle-unknown origins → `ValueError` naming the offender; missing coverage with BF requested → `MissingAprioriError`; unused a prioris permitted and recorded verbatim. Runners refactored to `(triangle, parameters)`, shared helpers extracted (`_build_cl_triangle`, `_extract_development_factors`, `_extract_point_estimates`, `_degenerate_method_result`) — CL behavior bit-identical (2.2 goldens and fixture untouched, green). BF runner: constant-development exposure diagonal (`development = 2000 + n_origins − 1` for every row), `cl.BornhuetterFerguson(apriori=1.0).fit(..., sample_weight=...)`, NaN IBNR→0.0, LDF slice, `n_dev == 1` degenerate branch.
- Task 3: Mack runner with `cl.Development(sigma_interpolation="mack")` (load-bearing — reproduces Mack 1993), per-origin SE with NaN→0.0 for the at-ultimate origin, ±1-SE reserve band (not floored), `total_mack_std_err` from the estimator, degenerate branch with all-zero Mack fields.
- Task 4: golden tests — Mack everywhere-tier (published roundings 75,535…1,363,155; total 2,447,095; first origin exactly 0.0; range-identity locks decision #5) + BF everywhere-tier (BF identity from 2.2's pinned CDFs at rel 1e-8; pinned full-precision literals; first-origin IBNR exactly 0.0) + pinned-platform exact tier for both (platform-gated `skipif` only on the exact tier).
- Task 5: missing/partial/duplicate/unknown a-priori tests; combination tests (three methods, two-method subset, request-order preservation, CL/Mack without a prioris); Lineage-verbatim tests; three-method bit-identical determinism; Mack-fields discipline (None on CL/BF).
- Task 6: `taylor_ashe_all_methods_resultset.json` generated once and committed; re-derivation test refactored into a shared `assert_rederivation_reproduces` covering both fixtures (2.2's CL-only fixture proves widened-`RunParameters` backward-compat; the new one replays all three methods), with optional-field-aware 1e-8 comparison off-platform and exact `model_dump()` equality on linux/amd64.
- Task 7: +2 exports (`AprioriLossRatio`, `MissingAprioriError`), all 2.2 exports intact; README engine subsection extended with the 2.3 paragraph.
- Task 8.1: from `engine/` cwd — `uv run pytest`: **125 passed, 5 skipped** (skips = exact tier, linux-only), `uv run ruff check .` clean, `uv run lint-imports` 2 contracts kept. No TS changes.
- Task 8.2 open: CI exact-tier confirmation awaits commit+push (explicit ask per working rhythm).

### File List

- engine/reserving_engine/resultset.py (modified — AprioriLossRatio, widened Literals, optional Mack fields, docstring)
- engine/reserving_engine/methods.py (modified — MissingAprioriError, _check_aprioris, runner refactor, BF + Mack runners)
- engine/reserving_engine/__init__.py (modified — +2 exports)
- engine/tests/test_resultset_models.py (modified — AprioriLossRatio/Mack-field/wire-shape tests; unknown-method test updated)
- engine/tests/test_run_methods.py (modified — combination, a-priori error, BF/Mack behavior, determinism tests)
- engine/tests/test_golden_taylor_ashe.py (modified — Mack + BF golden tiers, exact-tier additions)
- engine/tests/test_rederivation.py (modified — shared replay helper, all-methods fixture tests)
- engine/tests/fixtures/taylor_ashe_all_methods_resultset.json (new — committed golden fixture)
- README.md (modified — engine subsection paragraph)
- _bmad-output/implementation-artifacts/sprint-status.yaml (modified — story status)
- _bmad-output/implementation-artifacts/2-3-bornhuetter-ferguson-and-mack-methods.md (modified — this record)

### Review Findings (Code Review 2026-07-18)

- [x] [Review][Patch] (fixed) Numerically-degenerate-but-valid triangle → uncaught 500 (resolved: reject in validation) — A Triangle with a zero cumulative cell in early development, or an all-zero development column, passes `validate_triangle` (0.0 is treated as a value by design) but makes chainladder emit a non-finite volume-weighted LDF (`X/0=inf`, `0/0=NaN`), which reaches `_require_finite` → `ValueError` → 500. **Decision (Rohan, 2026-07-18): reject in validation.** Add a `validate_triangle` finding for any column whose volume-weighted denominator is zero (would produce a non-finite factor), yielding a cell-level `InvalidTriangleError` → clean 422 at the Triangle boundary. [engine/reserving_engine/validation.py]
- [x] [Review][Patch] (fixed) Duplicate / Triangle-unknown a-priori origin raises a bare `ValueError` (not a registered domain error) → 500 with no envelope, while the sibling missing-apriori path returns a clean 422. Raise a typed error or register a handler. [engine/reserving_engine/methods.py:264]
- [x] [Review][Patch] (fixed) Mack `total_mack_std_err` is passed to `MethodResult` without the `pd.isna → 0.0` guard applied two lines above to the per-origin `std_err`; a thin/degenerate triangle yields a NaN total → `_require_finite_or_none` raises → 500. Mirror the existing guard. [engine/reserving_engine/methods.py:243]
- [x] [Review][Patch] (fixed) `RunParameters.methods` has no minimum length; `methods=()` produces a schema-valid ResultSet carrying zero reserve figures. Enforce ≥1 method (or reject at the boundary). [engine/reserving_engine/resultset.py:90]

## Change Log

- 2026-07-17: Implementation complete (Amelia/dev-story) — contract widening (AprioriLossRatio, optional Mack fields), BF + Mack runners with boundary a-priori enforcement, Taylor-Ashe golden tests for both (published Mack 1993 anchors + BF identity + platform-gated exact tiers), all-methods re-derivation fixture. 125 passed / 5 platform-gated skips locally; ruff + import-linter green. CI exact-tier confirmation pending commit/push.
- 2026-07-17: Story created via BMad create-story (Amelia) — full context from epics Story 2.3, PRD FR-4/FR-5/NFR-1/OQ-5, spine AD-11, 2.2 story intelligence, and live chainladder 0.9.2 probes (Mack sigma_interpolation="mack" reproduces Mack 1993 exactly; BF sample_weight latest-diagonal mechanics; closed-form identity; full-precision pins). Seven design decisions fixed and flagged; PRD exposure gap raised for correct-course.
