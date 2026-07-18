---
baseline_commit: b8d094f
---

# Story 2.4: Diagnostics Computation with Diagnostic IDs

Status: done

## Story

As an actuary,
I want the four Diagnostics computed by the pure engine with stable, addressable IDs,
so that every later interpretation claim has something citable to point at. (FR-7)

## Acceptance Criteria

1. **Given** a completed Method computation, **When** diagnostics are derived in `reserving_engine.diagnostics`, **Then** the DiagnosticsBundle (Pydantic, `schemaVersion`) contains: LDF stability by Development Period, actual-vs-expected on the Latest Diagonal, CL-vs-BF divergence by Origin Period (only when both Methods ran), and residual heatmap data.
2. **And** every element carries a Diagnostic ID `dx:{runId}:{kind}:{key}` with `kind ∈ {ldf_stability, ave, cl_bf_divergence, residual}` and `key` the origin/development coordinate, generated only here (AD-10).
3. **And** each Diagnostic ID resolves back to its underlying values via a lookup function.
4. **Given** the test suite, **When** it runs, **Then** diagnostics for the Taylor-Ashe run match golden fixtures, IDs are unique and stable across identical runs, and CL-vs-BF divergence is absent (not empty-but-present) when BF did not run.

## Tasks / Subtasks

- [x] Task 1: DiagnosticsBundle models — new module `engine/reserving_engine/diagnostics.py` (AC: 1, 2)
  - [x] 1.1 New module `diagnostics.py` holding both the Pydantic models and the computation (spine Structural Seed: "methods, diagnostics, validation, schemas" — one module, mirroring how `resultset.py` holds the ResultSet contract). Import `_MODEL_CONFIG`, `_require_finite`, `_require_finite_or_none` from `reserving_engine.resultset` (same-package private reuse — do NOT re-declare them; drift between two copies is how contracts rot). All models frozen, camelCase wire via the shared config.
  - [x] 1.2 Element models — every element's FIRST field is `id: str` (the Diagnostic ID):
    - `LinkRatio`: `origin: str`, `factor: float` (finite). Not ID-carrying — it is a child value of an LdfStability element, not a citable Diagnostic on its own.
    - `LdfStabilityElement`: `id`, `from_dev: str`, `to_dev: str`, `selected_factor: float`, `link_ratios: tuple[LinkRatio, ...]` (only origins whose ratio is observed), `sigma: float | None`, `std_err: float | None`, `cv: float | None`. Finite-or-None on the three optionals, finite on `selected_factor`.
    - `AveElement`: `id`, `origin: str`, `from_dev: str`, `to_dev: str`, `actual: float`, `expected: float`, `actual_minus_expected: float`, `actual_to_expected_ratio: float | None` (None when `expected == 0.0` — never divide by zero, never emit non-finite).
    - `ClBfDivergenceElement`: `id`, `origin: str`, `cl_ultimate: float`, `bf_ultimate: float`, `divergence: float` (= cl − bf), `relative_divergence: float | None` (= divergence / bf_ultimate; None when `bf_ultimate == 0.0`).
    - `ResidualElement`: `id`, `origin: str`, `from_dev: str`, `to_dev: str`, `residual: float` (finite; standardized development residual).
  - [x] 1.3 `DiagnosticsBundle`: `schema_version: str = "1.0.0"`, `run_id: str`, `triangle_hash: str`, `ldf_stability: tuple[LdfStabilityElement, ...]`, `ave: tuple[AveElement, ...]`, `cl_bf_divergence: tuple[ClBfDivergenceElement, ...] | None = None`, `residuals: tuple[ResidualElement, ...]`. `cl_bf_divergence` is `None` (wire `null`) when CL and BF did not both run — the AC's "absent, not empty-but-present" distinction: `None` means "not applicable", `()` would falsely claim "computed, nothing found". `triangle_hash` ties the bundle to its Triangle the same way Lineage does (canonical-triangle-JSON sha256, never the raw-file hash). Design decision #1.
  - [x] 1.4 Module docstring: pure-core contract (AD-2), AD-10 cross-runtime contract note (2.6 exports this schema — every field is permanent contract surface), `schema_version` stays "1.0.0" (versioning governance is 2.6's).
- [x] Task 2: Diagnostic ID scheme + lookup (AC: 2, 3)
  - [x] 2.1 `def diagnostic_id(run_id: str, kind: str, key: str) -> str` returning `f"dx:{run_id}:{kind}:{key}"`. Keys per kind: `ldf_stability` → `{from_dev}` label; `ave` → `{origin}` label; `cl_bf_divergence` → `{origin}` label; `residual` → `{origin}:{from_dev}` (both coordinates of the heatmap cell). Labels used verbatim — they are opaque strings (2.2's label-bridge rule; never parsed, never normalized).
  - [x] 2.2 **IDs are opaque — resolution is dict-based, never string-parsed.** Origin/dev labels and the runId are caller-supplied opaque strings that may themselves contain `:`; parsing an ID by splitting on colons is therefore ambiguous and forbidden. Design decision #2.
  - [x] 2.3 `class UnknownDiagnosticIdError(KeyError)` carrying `.diagnostic_id`, message naming the ID (fail-loud standard from 1.4/1.5/2.1 reviews).
  - [x] 2.4 `def resolve_diagnostic(bundle: DiagnosticsBundle, diagnostic_id: str) -> LdfStabilityElement | AveElement | ClBfDivergenceElement | ResidualElement`: builds (or walks) a mapping over every element in the bundle by its `id` field and returns the element; raises `UnknownDiagnosticIdError` on a miss. This is the AC-3 lookup function and the seam both the Convex diagnostics query and the agent read tool will mirror (AD-10).
- [x] Task 3: `compute_diagnostics` (AC: 1, 2)
  - [x] 3.1 Signature: `def compute_diagnostics(triangle: Triangle, result_set: ResultSet, run_id: str) -> DiagnosticsBundle`. `run_id` is plain data passed in by the caller (engine_service hands down the Convex run ID in 2.5) — the pure core takes it as input, never generates or fetches it (AD-2). Fail loud (`ValueError`) on empty `run_id`. Verify `result_set.lineage.triangle_hash == triangle_hash(triangle)` and fail loud (`ValueError`) on mismatch — a bundle computed from a Triangle/ResultSet pair that don't belong together is garbage. Design decision #3.
  - [x] 3.2 Shared fit: reuse `_build_cl_triangle(triangle)` from `methods.py` (import it — do not duplicate the long-frame bridge), then `dev = cl.Development().fit(cl_triangle)` — **default `sigma_interpolation`, NOT "mack"**. Verified live: the selected `ldf_` from default `cl.Development()` is bit-identical to what `cl.Chainladder().fit()` reports (i.e. to every MethodResult's `development_factors`), while `std_residuals_` DIFFERS between default and "mack" in the single-observation last column (−1.183e-14 vs −1.125e-14). Diagnostics describe the development fit the Methods actually used for point estimates — default it is. Design decision #4.
  - [x] 3.3 LDF stability (one element per development transition, `n_dev − 1` of them):
    - `link_ratios`: from `cl_triangle.link_ratio.to_frame(origin_as_datetime=False)` — an `(n_origins − 1) × (n_dev − 1)` grid, NaN outside the observed region; include only non-NaN cells as `LinkRatio(origin=<label by row index>, factor=...)`.
    - `selected_factor`: from `dev.ldf_` (slice `n_dev − 1`, same as `_extract_development_factors`).
    - `sigma` / `std_err`: from `dev.sigma_` / `dev.std_err_` (one row, `n_dev − 1` columns). NaN → `None` (chainladder can't always extrapolate the last sigma — e.g. a 2×2 triangle gives NaN; "unknown" must serialize as absent, never as a fake 0.0). Design decision #5.
    - `cv`: `std_err / selected_factor` when `std_err` is not None, else `None` — the scalar stability signal, engine-computed (AD-1; the UI and the agent may never derive it).
    - `float(...)` every numpy scalar (2.2 discipline).
  - [x] 3.4 Actual-vs-expected on the Latest Diagonal (one element per Origin Period that HAS a prior cell):
    - For origin row `i`, the latest observed cell is the last non-`None` prefix cell (validation guarantees the observed region is a clean prefix — reuse the `cell is not None` prefix walk, never truthiness). Let it sit at dev index `j`.
    - If `j == 0` (the newest origin, or any single-cell row): NO element — there is no prior cell to project from. Absent, not zero. Design decision #6.
    - Else: `actual = cells[i][j]`, `expected = cells[i][j-1] × selected_factor[j-1]` (the same volume-weighted factor from 3.3 — verified live that `prior × ldf` reproduces chainladder's expectation), `actual_minus_expected = actual − expected`, `actual_to_expected_ratio = actual / expected` (None when `expected == 0.0`). `from_dev = development_periods[j-1]`, `to_dev = development_periods[j]`.
  - [x] 3.5 CL-vs-BF divergence (only when the ResultSet contains BOTH a `"chain_ladder"` and a `"bornhuetter_ferguson"` MethodResult; otherwise the field stays `None`):
    - One element per Origin Period: `cl_ultimate` / `bf_ultimate` read from the two MethodResults' `origin_results` (match by origin label — do NOT recompute; the ResultSet is the number authority, AD-1), `divergence = cl_ultimate − bf_ultimate`, `relative_divergence = divergence / bf_ultimate` (None when `bf_ultimate == 0.0`).
  - [x] 3.6 Residual heatmap data: from `dev.std_residuals_.to_frame(origin_as_datetime=False)` — same `(n_origins − 1) × (n_dev − 1)` shape as link ratios, NaN outside the observed region; one `ResidualElement` per non-NaN cell with `from_dev`/`to_dev` the transition labels. Verified closed form (independent anchor for Task 5): `residual_ij = (link_ratio_ij − ldf_j) × sqrt(C_ij) / sigma_j` matches chainladder to 1.7e-14 on Taylor-Ashe. A single-observation column yields a legitimate ≈0.0 residual (−1.18e-14 on Taylor-Ashe) — keep it verbatim, it is finite.
  - [x] 3.7 `n_dev == 1` degenerate branch (chainladder cannot fit — same guard as every method runner): `ldf_stability = ()`, `residuals = ()`, `ave = ()` (every origin's latest cell is at dev 0 — no prior cell), `cl_bf_divergence` still computed from the ResultSet when both Methods present (it needs no development fit).
  - [x] 3.8 Do NOT validate the Triangle again inside `compute_diagnostics` beyond the hash check — the ResultSet can only exist for a Triangle that passed `run_methods`' boundary validation, and the hash equality in 3.1 proves it's the same Triangle.
- [x] Task 4: Behavior tests — new file `engine/tests/test_diagnostics.py` (AC: 2, 3, 4)
  - [x] 4.1 TDD red first, per task. Small hand-checkable triangles (the 2×2 / 3×3 style used in `test_run_methods.py`) plus `TAYLOR_ASHE` where scale matters.
  - [x] 4.2 ID scheme: every element's `id` equals `dx:{run_id}:{kind}:{key}` with the documented key per kind; all IDs in a bundle are unique (collect into a set, compare lengths); IDs are bit-identical across two identical `compute_diagnostics` calls (stability), and differ when `run_id` differs (the runId is part of the address).
  - [x] 4.3 Lookup: `resolve_diagnostic` returns the exact element (identity/equality) for one sampled ID of each kind; unknown ID raises `UnknownDiagnosticIdError` carrying the ID; every ID in the bundle resolves (walk all four sections).
  - [x] 4.4 Divergence presence: CL-only ResultSet → `cl_bf_divergence is None`; CL+BF → tuple with one element per Origin Period and `divergence == cl_ultimate − bf_ultimate` field-wise; BF-only (no CL) → `None`. Mack presence must not affect it.
  - [x] 4.5 A-vs-E shape: newest origin has NO element; a fully-developed first origin HAS one (its prior cell exists); element count == origins-with-a-prior-cell. Hand-check one element's `expected` against `prior_cell × pinned_ldf` on a 3×3.
  - [x] 4.6 Purity/determinism: two identical calls produce bit-identical `model_dump_json()`; guard checks — empty `run_id` raises `ValueError`; mismatched `triangle_hash` (ResultSet from a different Triangle) raises `ValueError`.
  - [x] 4.7 Degenerate: 1-development-period triangle → empty stability/ave/residuals, divergence still present when CL+BF ran.
  - [x] 4.8 Wire shape: `model_dump(by_alias=True)` spot-check — `schemaVersion`, `runId`, `triangleHash`, `ldfStability`, `clBfDivergence`, `linkRatios`, `selectedFactor`, `stdErr`, `actualMinusExpected`, `actualToExpectedRatio`, `relativeDivergence`, `fromDev`/`toDev` (extends 2.2/2.3's camelCase test discipline; 2.6 freezes this).
- [x] Task 5: Taylor-Ashe diagnostics golden — extend `engine/tests/test_golden_taylor_ashe.py` + committed fixture (AC: 4)
  - [x] 5.1 Fixed golden runId: `GOLDEN_RUN_ID = "golden-taylor-ashe"` (IDs embed the runId, so the fixture pins it too).
  - [x] 5.2 Independent anchors (everywhere tier, `math.isclose(rel_tol=1e-8)` — plus `abs_tol=1e-9` where the target is ≈0, residuals cross zero):
    - LDF stability `selected_factor`s equal the already-pinned `PINNED_LDFS` (same factors, verified bit-identical live).
    - A-vs-E identity: for each origin with a prior cell, `expected == prior_diagonal_cell × PINNED_LDFS[j-1]` computed by hand from `TAYLOR_ASHE` cells (probe cross-check: origin 2002 actual 5,339,085 vs expected 5,290,234.13; origin 2008 actual 2,864,498 vs expected 2,483,183.34; newest origin 2010 absent).
    - Residual identity: `residual == (link_ratio − ldf) × sqrt(cell) / sigma` recomputed from the bundle's own link ratios + sigmas for a sample of cells (closed form verified to 1.7e-14).
    - Divergence identity: run CL+BF with 2.3's canonical test prior (`loss_ratio=0.9`, `exposure=5_000_000.0` per origin) and assert `divergence == cl_ultimate − bf_ultimate` field-wise from the ResultSet.
  - [x] 5.3 Pin full-precision literals from a local run for a representative sample (exact tier, platform-gated `ON_PINNED_PLATFORM` only): first/last LDF-stability sigma+std_err+cv, the origin-2002 and origin-2008 AveElements, four residual corners, and the origin-2010 divergence element. Expected sigma row from the macOS probe (re-pin from CI if linux/amd64 bits differ — pinned platform is the truth, AD-11): `sigma ≈ 400.3503, 194.2598, 204.8541, 123.2189, 117.1807, 90.4753, 21.1333, 33.8728, 20.0982` (4dp roundings; pin full precision when writing the test).
  - [x] 5.4 Committed fixture `engine/tests/fixtures/taylor_ashe_diagnostics.json`: `model_dump_json(by_alias=True)` of the CL+BF+Mack Taylor-Ashe bundle under `GOLDEN_RUN_ID` (generate once, commit — 2.6 drift-check material). Golden test: load fixture → `DiagnosticsBundle.model_validate_json` → recompute → exact `model_dump()` equality on the pinned platform, field-wise 1e-8 (abs_tol for residuals) elsewhere. Mirrors `test_rederivation.py`'s two-tier replay pattern.
  - [x] 5.5 No skip/xfail on blocking tests; the platform guard gates only the exact tier (2.2/2.3 rule).
- [x] Task 6: Package surface + docs
  - [x] 6.1 `engine/reserving_engine/__init__.py`: add `DiagnosticsBundle`, `LdfStabilityElement`, `AveElement`, `ClBfDivergenceElement`, `ResidualElement`, `LinkRatio`, `compute_diagnostics`, `resolve_diagnostic`, `diagnostic_id`, `UnknownDiagnosticIdError` to imports and `__all__` (keep all 17 existing exports — `test_scaffold.py` must stay green).
  - [x] 6.2 README engine subsection: one short paragraph — four Diagnostics from `compute_diagnostics(triangle, result_set, run_id)`, ID format `dx:{runId}:{kind}:{key}`, dict-based resolution via `resolve_diagnostic`.
- [x] Task 7: Verification (all ACs)
  - [x] 7.1 Full battery from `engine/` cwd: `uv run pytest` (2.3's 125 + new, all green; platform-gated skips expected on macOS), `uv run ruff check .`, `uv run lint-imports` (2 contracts kept — `diagnostics.py` imports nothing from the forbidden list; `math` is fine, it's not on it). No TS changes — Node side untouched.
  - [ ] 7.2 Confirm CI green on the PR: exact tiers must pass on linux/amd64. If CI bits differ from macOS-pinned literals, re-pin from CI output and document (AD-11). (Pending commit/push — deferred per working rhythm, same as Story 2.3's 8.2.)

## Dev Notes

### Architecture compliance (non-negotiable)

- **AD-2 (purity)**: diagnostics computation lives in `reserving_engine` because it produces numbers — `engine_service`'s future diagnostics surface (2.5) is only the HTTP view. No I/O, no clock, no logging. `run_id` is an input parameter, never generated (no `uuid`, no randomness — `random` is import-linter-forbidden anyway).
- **AD-1 (engine-side arithmetic)**: `expected = prior × LDF`, `actual − expected`, A/E ratio, `cl − bf`, relative divergence, and `cv` are all reserve-figure arithmetic — they MUST be bundle fields, because nothing downstream (Convex, React, prompts, export) may compute them. If a UI chart will ever need a derived number, it must be here.
- **AD-10 (contract)**: DiagnosticsBundle is the second half of the cross-runtime contract (2.6 exports both schemas). Every field added is permanent surface — the element models above are exactly the contract; add nothing speculative. Diagnostic ID format `dx:{runId}:{kind}:{key}`, `kind ∈ {ldf_stability, ave, cl_bf_divergence, residual}`, generated ONLY here — Convex and the agent tool resolve, never mint.
- **AD-11 (golden discipline)**: exact equality on linux/amd64, 1e-8 relative cross-platform (abs_tol only where targets are ≈0 by construction — residuals), never silently widened.
- **Vocabulary (PRD §3)**: `Diagnostic`, `DiagnosticsBundle`, `Origin Period`, `Development Period`, `Latest Diagonal`, `Run` — exact terms. Kind strings exactly `ldf_stability`, `ave`, `cl_bf_divergence`, `residual` (spine AD-10 fixes them; not negotiable, they appear in stored IDs forever).

### Design decisions this story fixes (flagged for review)

1. **Bundle carries `run_id` + `triangle_hash`** — the bundle is stored alongside the ResultSet (FR-7) and must be self-describing for audit walks (claim → Diagnostic → ResultSet → Lineage, Epic 7). Hash equality with the ResultSet's Lineage is checked at construction.
2. **IDs are opaque; resolution is dict-based** — `key` may contain `:` (labels are opaque strings), so string-parsing an ID is ambiguous by construction. `resolve_diagnostic` walks the bundle's elements by their `id` field. Downstream resolvers (Convex query, agent tool) must copy this posture.
3. **`compute_diagnostics(triangle, result_set, run_id)` is a separate entry point**, not a `run_methods` flag — the epic AC names `reserving_engine.diagnostics`, and 2.5's service composes the two calls. `run_methods` is untouched this story.
4. **Development fit uses default `cl.Development()`** (volume-weighted, default sigma interpolation) — its `ldf_` is bit-identical to the factors every MethodResult already reports; `sigma_interpolation="mack"` is a Mack-SE concern only (2.3 decision #4) and produces different last-column residuals. One fit, one truth for diagnostics.
5. **NaN policy differs by meaning**: unobserved link-ratio/residual cells are OMITTED (absent elements); un-extrapolatable sigma/std_err are `None` ("unknown"); nothing is mapped to 0.0 here — unlike the IBNR/SE NaNs of 2.2/2.3, where 0.0 was the mathematically correct value, a zero sigma would be a false claim of certainty.
6. **A-vs-E covers only origins with a prior cell** — the newest origin has no expectation to compare against; absent, not zero (same "absent ≠ empty" logic as the divergence AC).
7. **`cl_bf_divergence: ... | None`** — `None`/`null` when both Methods didn't run ("not applicable"), never `()` (which would read as "computed, no findings"). Consistent with 2.3's precedent that Pydantic serializes None fields as `null` on the wire; 2.6 freezes this shape.

If the reviewer disagrees, the golden fixture (Task 5.4) encodes the same decisions — change both together.

### What NOT to build (scope boundaries)

- **No FastAPI endpoint, no idempotency, no runId plumbing from Convex** — Story 2.5 composes `run_methods` + `compute_diagnostics` behind `/runs`.
- **No JSON Schema export / Convex validators / TS types** — Story 2.6; `schema_version` stays `"1.0.0"`.
- **No storage, no UI** — diagnostics review panels are 4.5, context rail/deep-linking 4.6.
- **No interpretation/citation logic** — the Provenance Gate (5.2) consumes these IDs; this story only mints them.
- **No changes to `run_methods`, `resultset.py` models, or existing fixtures** — the 2.2/2.3 golden fixtures and tests must pass untouched.
- **No extra diagnostics** (no tail diagnostics, no incurred-vs-paid, no trend tests) — exactly the four FR-7 kinds.

### Existing files being modified — current state

- [engine/reserving_engine/__init__.py](engine/reserving_engine/__init__.py) — 17 exports after 2.3. **Change**: +10 exports. **Preserve**: all existing.
- [engine/tests/test_golden_taylor_ashe.py](engine/tests/test_golden_taylor_ashe.py) — two-tier pattern (`ON_PINNED_PLATFORM` guard, `PINNED_LDFS` et al.), no skip/xfail on blocking tests. **Change**: add diagnostics golden tests reusing `PINNED_LDFS` and the 2.3 canonical prior. **Preserve**: every existing assertion untouched.
- README.md — engine subsection gains one paragraph.
- New files: `engine/reserving_engine/diagnostics.py`, `engine/tests/test_diagnostics.py`, `engine/tests/fixtures/taylor_ashe_diagnostics.json`.
- Untouched: `methods.py` (import `_build_cl_triangle` from it — no edits), `resultset.py` (import the private helpers — no edits), `triangle.py`, `validation.py`, `version.py` (`ENGINE_VERSION` stays `0.1.0`), `fixtures.py`, both existing JSON fixtures, `.github/workflows/ci.yml`, all TS.

### Verified chainladder facts (probed live against engine/.venv, 2026-07-17)

- chainladder 0.9.2, pandas 2.3.3, numpy 2.4.6 (uv.lock-pinned), same as 2.2/2.3.
- **`tri.link_ratio`**: individual age-to-age factors, frame shape `(n_origins − 1) × (n_dev − 1)`, NaN outside the observed region. Taylor-Ashe row 2001: 3.1432, 1.5428, 1.2783, 1.2377, 1.2092, 1.0441, 1.0404, 1.0630, 1.0177.
- **`cl.Development().fit(tri)`** exposes `ldf_`, `sigma_`, `std_err_`, `std_residuals_`. Its `ldf_` (9 columns) is **bit-identical** to the first 9 columns of `cl.Chainladder().fit(tri).ldf_` (11 columns — tail padding; the engine already slices to `n_dev − 1`).
- **`std_residuals_`**: same shape/NaN layout as `link_ratio`; deterministic across fits; closed form `(link_ratio − ldf) × sqrt(C) / sigma` matches to ≤1.7e-14 on Taylor-Ashe. Default vs `sigma_interpolation="mack"` differ ONLY in the single-observation last column (−1.183e-14 vs −1.125e-14) — pick default deliberately (decision #4), pin the fixture accordingly.
- **Sigma extrapolation limits**: Taylor-Ashe last-column `sigma_ ≈ 20.0982` (log-linear extrapolated); a 2×2 triangle gives `sigma_ = NaN` and `std_residuals_ = 0.0` — hence the NaN→None mapping for sigma/std_err and keeping 0.0 residuals verbatim.
- **A-vs-E identity verified**: `actual / (prior × ldf)` on Taylor-Ashe latest diagonal — e.g. origin 2002: 5,339,085 / 5,290,234.13 = 1.009234; origin 2008: 2,864,498 / 2,483,183.34 = 1.153559; origin 2010 (newest) has no prior cell. Oldest origin's A/E is exactly 1.0 only when its last factor comes from a single ratio (as on Taylor-Ashe) — don't assert 1.0 generically.
- `sigma_`/`std_err_` Taylor-Ashe 4dp roundings: sigma 400.3503, 194.2598, 204.8541, 123.2189, 117.1807, 90.4753, 21.1333, 33.8728, 20.0982; std_err 0.2195, 0.0607, 0.0528, 0.0287, 0.0276, 0.0227, 0.0059, 0.0116, 0.0103. Pin full precision at implementation time.
- `to_frame(origin_as_datetime=False)` columns come back as **ints** (12, 24, …) not strings — index positionally (`.iloc`), never by string label (a `KeyError: '108'` probe confirmed).

### Previous story intelligence (2.1–2.3, all in review)

- **Branch**: you are on `epic_2/2_4` at b8d094f (2.3 complete, CI exact tiers green on linux/amd64). 2.1/2.2/2.3 are status `review`; if their reviews land changes, rebase before finalizing.
- **Reuse, don't rebuild**: `_build_cl_triangle` (methods.py), the `cell is not None` prefix walk, `float(...)` on every numpy scalar, the two-tier golden pattern with `ON_PINNED_PLATFORM`, `TAYLOR_ASHE`, 2.3's canonical BF prior (0.9 / 5,000,000), the re-derivation replay pattern — all exist and are proven.
- **Pinned known-answer discipline** (1.5 → 2.3): never pin a literal you haven't independently cross-verified. This story's independent anchors: `PINNED_LDFS` (stability factors), the A-vs-E hand identity, the residual closed form, the divergence subtraction from ResultSet fields.
- **Fail-loud standard** (1.4/1.5/2.1 reviews): empty runId, hash mismatch, unknown Diagnostic ID — typed errors naming the offender.
- **Working rhythm** (Rohan): TDD red-first per task; commit only on explicit ask; run everything from `engine/` cwd (`package = false` — imports only resolve there); CI is the truth, Sourcery/GitGuardian are triaged noise.

### Project Structure Notes

- Spine Structural Seed: `reserving_engine/` = "pure core: methods, diagnostics, validation, schemas (Pydantic)" — `diagnostics.py` is the one new module, named exactly as the seed anticipates.
- Tests stay flat in `engine/tests/`; the new JSON fixture joins the two existing ones in `engine/tests/fixtures/`.
- Naming: snake_case identifiers, camelCase only on the JSON wire via the shared `to_camel` alias config.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.4] — story + ACs; Epic 2 boundaries (2.5 service, 2.6 schema export)
- [Source: _bmad-output/planning-artifacts/prds/prd-agentic-reserving-2026-07-16/prd.md#FR-7/#FR-8/#§3 Glossary] — the four Diagnostics, ID resolvability, "stored as typed JSON alongside the ResultSet", review-UI consumers
- [Source: _bmad-output/planning-artifacts/architecture/architecture-agentic-reserving-2026-07-16/ARCHITECTURE-SPINE.md#AD-2/#AD-10] — diagnostics computation lives in the pure core; fixed ID format and kind set; both resolvers (Convex query, agent tool) resolve IDs minted only here
- [Source: _bmad-output/project-context.md] — AD-1 no-arithmetic-outside-engine, Diagnostic ID rule, golden-master gate, anti-patterns
- [Source: _bmad-output/implementation-artifacts/2-3-bornhuetter-ferguson-and-mack-methods.md] — canonical test prior, sigma_interpolation finding, two-tier goldens, working rhythm
- [Source: live probe of engine/.venv chainladder 0.9.2, 2026-07-17] — link_ratio/std_residuals_ shapes, residual closed form, default-vs-mack residual delta, sigma NaN behavior, LDF bit-identity, int column labels

## Dev Agent Record

### Agent Model Used

Claude (claude-opus-4-8) via BMad dev-story (Amelia)

### Debug Log References

- TDD: `test_diagnostics.py` written before `diagnostics.py` existed (RED = ImportError), then implemented to green.
- One design refinement surfaced by a test: a 2×2 triangle's single-observation transition gives chainladder `sigma = NaN` **but** a false-zero `std_err = 0.0` (not NaN). Decision #5 says un-extrapolatable stability signals must be `None` (not a false certainty), so `std_err`/`cv` are now gated on `sigma` being present, not only on their own NaN. Locked by `TestNaNPolicy.test_single_observation_column_yields_none_sigma`.
- Full-precision literals (stability triple, A-vs-E, residual corners, divergence) pinned from the local macOS run; the committed fixture was generated once from the same run.

### Completion Notes List

- Task 1: New `diagnostics.py` holding both models and computation (spine Structural Seed). Reuses `_MODEL_CONFIG`/`_require_finite`/`_require_finite_or_none` from `resultset.py` (no re-declaration). Six frozen camelCase-wire models: `LinkRatio` (child value, not ID-carrying), `LdfStabilityElement`, `AveElement`, `ClBfDivergenceElement`, `ResidualElement`, `DiagnosticsBundle` (with `cl_bf_divergence: ... | None` for absent-not-empty). `schema_version` stays "1.0.0".
- Task 2: `diagnostic_id(run_id, kind, key)` → `dx:{runId}:{kind}:{key}` (keys: from_dev for stability, origin for ave/divergence, `origin:from_dev` for residual). `resolve_diagnostic` walks the bundle by `id` field (opaque IDs, never string-parsed). `UnknownDiagnosticIdError(KeyError)` carries `.diagnostic_id`.
- Task 3: `compute_diagnostics(triangle, result_set, run_id)` — pure, `run_id` is input data (never generated). Fails loud on empty `run_id` and on Triangle/ResultSet hash mismatch. Single `cl.Development().fit()` (default sigma, NOT "mack" — its `ldf_` is bit-identical to the MethodResults' factors). Stability from `link_ratio`/`ldf_`/`sigma_`/`std_err_`; A-vs-E only for origins with a prior cell (newest absent); divergence read from the two MethodResults' ultimates (never recomputed) only when both ran; residuals from `std_residuals_`. `n_dev == 1` degenerate branch keeps divergence, empties the rest.
- Task 4: 30 behavior tests (`test_diagnostics.py`) — ID scheme, uniqueness/stability, runId embedding, lookup + unknown-ID error, divergence presence (CL-only/CL+BF/BF-only/CL+Mack), A-vs-E shape + hand-checked expected, NaN policy (2×2 → None triple), guards (empty runId, hash mismatch), determinism, degenerate, full camelCase wire shape + JSON round-trip.
- Task 5: Golden tests extend `test_golden_taylor_ashe.py` with independent anchors (selected_factors == `PINNED_LDFS`; A-vs-E `expected == prior × pinned LDF`; all 45 residuals against the closed form `(link_ratio − ldf)·√C / sigma`; divergence against ResultSet ultimates), a platform-gated exact tier (pinned stability triple, two AveElements, four residual corners, origin-2010 divergence), and a two-tier fixture replay mirroring `test_rederivation.py`. Committed `taylor_ashe_diagnostics.json` (CL+BF+Mack under `golden-taylor-ashe`).
- Task 6: +10 exports to `__init__.py` (all 17 prior exports intact — `test_scaffold.py` green); README engine paragraph.
- Task 7.1: from `engine/` cwd — `uv run pytest`: **162 passed, 9 skipped** (skips = exact tier, linux-only), `uv run ruff check .` clean, `uv run lint-imports` 2 contracts kept (`diagnostics.py` imports nothing forbidden). No TS changes.
- Task 7.2: open — CI exact-tier confirmation awaits commit+push (explicit ask per working rhythm).

### File List

- engine/reserving_engine/diagnostics.py (new — models, ID scheme, compute_diagnostics, resolve_diagnostic)
- engine/reserving_engine/__init__.py (modified — +10 exports)
- engine/tests/test_diagnostics.py (new — 30 behavior tests)
- engine/tests/test_golden_taylor_ashe.py (modified — diagnostics golden tiers + fixture replay)
- engine/tests/fixtures/taylor_ashe_diagnostics.json (new — committed golden fixture)
- README.md (modified — engine subsection paragraph)
- _bmad-output/implementation-artifacts/sprint-status.yaml (modified — story status)
- _bmad-output/implementation-artifacts/2-4-diagnostics-computation-with-diagnostic-ids.md (modified — this record)

### Review Findings (Code Review 2026-07-18)

- [x] [Review][Patch] (fixed with 2.3) Non-finite LDF from a zero cumulative cell also crashes diagnostics. Resolved with 2.3 by rejecting such triangles in `validate_triangle` (422) — once validation rejects them, diagnostics never sees the non-finite factor. No separate diagnostics change needed. [engine/reserving_engine/diagnostics.py:285]
- [x] [Review][Defer] Diagnostics recompute `expected` and `selected_factor` from a fresh default `cl.Development().fit()` rather than reading the authoritative LDFs from the ResultSet. Bit-identical today (CL uses default Development), but a silent divergence if a Run's CL ever uses non-default development settings. Prefer reading factors from `result_set.method_results`. — deferred, latent coupling [engine/reserving_engine/diagnostics.py:274]

## Change Log

- 2026-07-17: Implementation complete (Amelia/dev-story) — `reserving_engine.diagnostics` with the four FR-7 Diagnostics, `dx:{runId}:{kind}:{key}` IDs minted only in the core, dict-based `resolve_diagnostic`, and Taylor-Ashe golden tests (independent identities + platform-gated exact tier + committed fixture replay). One decision refined under test (std_err/cv gated on sigma presence, not just own-NaN). 162 passed / 9 platform-gated skips locally; ruff + import-linter green. CI exact-tier confirmation pending commit/push.
- 2026-07-17: Story created via BMad create-story (Amelia) — full context from epics Story 2.4, PRD FR-7/FR-8, spine AD-2/AD-10, 2.1–2.3 story intelligence, and live chainladder 0.9.2 probes (link_ratio/std_residuals_ mechanics, residual closed form, default-vs-mack sigma delta, LDF bit-identity, A-vs-E identity). Seven design decisions fixed and flagged.
