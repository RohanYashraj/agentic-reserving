---
baseline_commit: e7c46791e1844b78745017dbc636100edede35ea
---

# Story 2.1: Triangle Model and Validation Core

Status: review

## Story

As an actuary,
I want triangles validated deterministically at the boundary with cell-level findings,
so that no malformed data ever reaches a Method. (FR-2 core)

## Acceptance Criteria

1. **Given** `reserving_engine`, **When** the Triangle Pydantic model and `validate_triangle` are implemented, **Then** validation detects non-rectangular/triangular shape, decreasing cumulative paid values along an Origin Period (paid triangles only, per PRD OQ-6), and missing cells inside the observed region, returning a typed validation report with cell-level `{origin, dev, reason}` entries — never a generic failure.
2. **And** the module performs no file, network, environment, clock, or logging side effects (AD-2), verified by review and an import-linter or equivalent check.
3. **Given** the test suite, **When** Hypothesis property tests run, **Then** generated valid triangles always pass and generated violations (shape, paid monotonicity, missing cells) are always detected with correct coordinates.
4. **And** a canonical-triangle-JSON sha256 function exists and is deterministic across runs — this hash, distinct from any raw-file hash, is *the* Triangle hash for Lineage.

## Tasks / Subtasks

- [x] Task 1: Triangle Pydantic model — `engine/reserving_engine/triangle.py` (AC: 1, 4)
  - [x] 1.1 `Triangle` model (Pydantic v2, `model_config = ConfigDict(frozen=True)` — Triangles are immutable inputs per PRD glossary). Fields: `kind: Literal["paid", "incurred"]`, `origin_periods: tuple[str, ...]` (oldest first), `development_periods: tuple[str, ...]` (earliest age first), `cells: tuple[tuple[float | None, ...], ...]` (row per Origin Period, column per Development Period; `None` = no value in that cell). Use tuples, not lists, so frozen means frozen. Labels are opaque strings here — period *detection/confirmation* is Epic 3's concern (FR-3); the engine receives already-labeled data.
  - [x] 1.2 Model-level structural validators (Pydantic validators, raise `ValidationError` — these are malformed-*container* errors, distinct from the domain findings in Task 2): `origin_periods` and `development_periods` non-empty and free of duplicates; `len(cells) == len(origin_periods)`; every row `len == len(development_periods)` (the container is always a full rectangle of `float | None`). Reject NaN/±Infinity cell values (`allow_inf_nan=False` via field/validator) — they poison both comparison logic and canonical JSON.
  - [x] 1.3 Docstring: state the plain-data contract (AD-2) — this module never touches file/network/env/clock/logging, and everything is JSON-serialisable.
- [x] Task 2: `validate_triangle` — `engine/reserving_engine/validation.py` (AC: 1)
  - [x] 2.1 Typed report models in the same module: `ValidationFinding` with `origin: str`, `dev: str`, `reason: str` — exactly the `{origin, dev, reason}` cell-level shape from the spine's Consistency Conventions (labels, not indices: FR-2 says "identified by Origin/Development Period"). Add a machine-readable `code: Literal["shape", "paid_monotonicity", "missing_cell"]` alongside the human `reason`. `ValidationReport` with `valid: bool` (derived: no findings) and `findings: tuple[ValidationFinding, ...]`. All Pydantic, JSON-serialisable.
  - [x] 2.2 `validate_triangle(triangle: Triangle) -> ValidationReport` — pure function, collects ALL findings (never fail-fast on the first; FR-2 demands the user sees a cell-level error *listing*). Detection rules — **these semantics are this story's design decision, flagged for review** (see Dev Notes):
    - **Observed region** per row = the leading contiguous run of non-`None` cells. Everything after the row's first `None` is the unobserved future.
    - **`missing_cell`**: a `None` at column j while some column k>j in the same row holds a value — a hole *inside* the observed region. Report at the `None` cell's coordinates. (Hard rejection in v1 — no imputation at ingestion, PRD §11.)
    - **`shape`**: (a) a row with zero observed cells (report at that origin, first dev label); (b) observed-prefix lengths increase from an older origin row to a newer one — valid data is a full rectangle (all rows complete) or a stepped triangle (non-increasing observed lengths, oldest origin longest). Report at the first offending cell of the newer row. Compute prefix lengths ignoring interior holes (a hole is a `missing_cell` finding, not a shorter prefix — don't double-report one defect under two codes).
    - **`paid_monotonicity`**: only when `kind == "paid"` (OQ-6 — incurred can legitimately decrease via case-reserve releases; emit NO monotonicity findings for incurred). Along each row's observed values, any cell strictly less than its predecessor is a finding at the *decreasing* cell's coordinates. Adjacent-pair comparison against the actual predecessor value, skipping nothing (within the contiguous observed prefix there are no holes by construction).
  - [x] 2.3 Never a generic failure: every code path that rejects yields findings with concrete origin/dev labels. No bare `ValueError`, no summary-only report.
- [x] Task 3: Canonical Triangle hash — `engine/reserving_engine/triangle.py` (AC: 4)
  - [x] 3.1 `canonical_triangle_json(triangle: Triangle) -> str`: `json.dumps` of `{"kind", "originPeriods", "developmentPeriods", "cells"}` (camelCase keys — this JSON is a cross-runtime artifact per AD-10 conventions) with `sort_keys=True`, `separators=(",", ":")`, `ensure_ascii=True`, `allow_nan=False`. Missing cells serialize as `null`. Float determinism: CPython's `json` uses shortest round-trip `repr` — deterministic across runs and platforms for finite floats; NaN/Inf already rejected at the model (Task 1.2). Document the canonical form in the docstring: **this exact serialization is a permanent cross-runtime contract** — Lineage hashes recorded now must re-derive forever (AD-11).
  - [x] 3.2 `triangle_hash(triangle: Triangle) -> str`: lowercase-hex `hashlib.sha256` of the UTF-8 canonical JSON. Docstring must state the three-hash discipline: this is *the* Triangle hash for Lineage — distinct from the raw-file sha256 (upload duplicate detection, Epic 3) and from the audit-chain hash (convex/lib/auditChain.ts). Never conflate; share no helpers.
  - [x] 3.3 Unit tests (TDD, red first) in `engine/tests/test_triangle_hash.py`: determinism across repeated calls and across two structurally-equal model instances; sensitivity — changing any of kind / a label / a cell value / `None`↔value flips the hash; **one pinned known-answer vector** (build a small fixed triangle, compute the hex once, cross-verify with an independent `shasum -a 256` over the exact canonical string, then assert the literal — same contract-freezing pattern that protected the audit chain in Story 1.5).
- [x] Task 4: Purity enforcement — import-linter + ruff (AC: 2)
  - [x] 4.1 Add `import-linter` and `ruff` to `[dependency-groups] dev` in `engine/pyproject.toml` (`uv add --dev`); this closes the 1-1 deferred item "No Python lint/format tooling in engine/ — add when engine code exists (Epic 2)".
  - [x] 4.2 Import-linter contracts in `engine/pyproject.toml` (`[tool.importlinter]`, `root_packages = ["reserving_engine", "engine_service", "copilot_agent"]`): (a) **layers** contract enforcing the spine's downward-only rule — `engine_service` / `copilot_agent` may import `reserving_engine`, never the reverse; (b) **forbidden** contract: `reserving_engine` must not import I/O-capable stdlib/third-party modules — forbid at minimum `os`, `io`, `pathlib`, `sys`, `socket`, `http`, `urllib`, `requests`, `httpx`, `logging`, `datetime`, `time`, `random`, `subprocess`, `tempfile`. (`json`, `hashlib`, `math`, `typing`, `pydantic` stay allowed — pure.) Comment the contract with its AD-2 rationale.
  - [x] 4.3 Minimal ruff config in `engine/pyproject.toml` (default rule set + line length is enough; don't gold-plate). Run `uv run ruff check .` and `uv run lint-imports` locally.
  - [x] 4.4 CI: add two steps to the `python` job in `.github/workflows/ci.yml` after "Run pytest": `uv run ruff check .` and `uv run lint-imports` (both `working-directory: engine` via the job default). Do NOT touch the platform pinning comment or add OS matrix legs (AD-11).
- [x] Task 5: Hypothesis property tests — `engine/tests/test_triangle_validation.py` (AC: 3)
  - [x] 5.1 Strategy `valid_triangles(kind=...)`: draw dims (origins 1–8, devs 1–8 — keep small, Hypothesis shrinks better), draw per-row observed lengths as a non-increasing sequence starting at `n_dev` OR all-full rectangle, fill observed cells with finite non-negative floats — for `kind="paid"` make each row non-decreasing (cumulative sums of non-negative increments), unobserved tail = `None`. Property: `validate_triangle(t).valid is True` and `findings == ()`.
  - [x] 5.2 Violation strategies mutate a known-valid triangle and assert the *exact* coordinates come back with the right `code` (AC 3 says "correct coordinates", not merely "invalid"):
    - punch an interior hole (set an observed non-final cell to `None`) → exactly that `{origin, dev}` reported as `missing_cell`;
    - break monotonicity on a paid triangle (set an observed cell below its predecessor) → that cell as `paid_monotonicity`;
    - extend a newer row's observed prefix beyond an older row's → `shape` at the computed offending cell;
    - same monotonicity mutation on `kind="incurred"` → NO `paid_monotonicity` finding (OQ-6 negative test).
  - [x] 5.3 Multiple-defect property: inject ≥2 independent violations → all reported in one `ValidationReport` (proves collect-all, never fail-fast).
  - [x] 5.4 Example-based edge tests (plain pytest, cheaper than properties): 1×1 triangle valid; single-origin full row valid; equal adjacent paid values valid (non-*strict* decrease only is flagged); all-rows-full rectangle valid; empty-row shape finding; report is JSON-round-trippable (`model_dump_json` → `model_validate_json`).
  - [x] 5.5 Hash determinism property (AC 4): for any generated valid triangle, `triangle_hash(t) == triangle_hash(Triangle(**t.model_dump()))`.
- [x] Task 6: Package surface + docs
  - [x] 6.1 `engine/reserving_engine/__init__.py` (currently empty): export the public surface — `Triangle`, `ValidationFinding`, `ValidationReport`, `validate_triangle`, `canonical_triangle_json`, `triangle_hash`.
  - [x] 6.2 README: short "Reserving engine" subsection — purity invariant (AD-2), `validate_triangle` cell-level findings, the three-hash discipline, and the new lint commands (`uv run ruff check .`, `uv run lint-imports`).
  - [x] 6.3 `_bmad-output/implementation-artifacts/deferred-work.md`: strike through the 1-1 "No Python lint/format tooling" item with a resolution note.
- [x] Task 7: Verification (all ACs)
  - [x] 7.1 Full battery, all green, documented in Dev Agent Record: `uv run pytest` (from `engine/` — imports only resolve from that cwd, `package = false`), `uv run ruff check .`, `uv run lint-imports`, plus the Node side untouched-but-green sanity (`npm test` optional — no TS files change unless README-only).
  - [x] 7.2 Confirm CI passes on the PR (GitHub Actions is the truth; Sourcery/GitGuardian flags are triaged noise).

## Dev Notes

### Architecture compliance (non-negotiable)

- **AD-2 is this story.** `reserving_engine` is the pure functional core: plain data in, typed JSON-serialisable Pydantic models out. No file, network, environment, clock access; no logging side effects. `import json`, `import hashlib`, `import math` fine; `import os`/`datetime`/`logging` never. The import-linter contract (Task 4) makes this mechanical, not aspirational — the AC explicitly demands "import-linter or equivalent check".
- **Dependency direction is strict** (spine ¶Design Paradigm): `reserving_engine` imports nothing from `engine_service` or `copilot_agent`. The layers contract encodes it.
- **Three-hash discipline** (spine Consistency Conventions): raw-file sha256 (Epic 3, duplicate detection) ≠ canonical-triangle-JSON sha256 (THIS story — *the* Triangle hash in Lineage, AD-11) ≠ audit-chain sha256 (Story 1.5, `convex/lib/auditChain.ts`). Different names, no shared helpers, docstrings that say so.
- **The canonical JSON form is a permanent contract** — exactly like the audit chain's hashable projection in 1.5. Once a Lineage records a Triangle hash, re-derivation (FR-6, NFR-6, Story 4.7) must reproduce it forever. Freeze it with a pinned known-answer test vector (Task 3.3), cross-verified independently before pinning — do not just echo the implementation's own output.
- **Vocabulary** (PRD §3, spine conventions): `Triangle`, `Origin Period`, `Development Period` exactly — `origin_periods`/`development_periods` in snake_case Python, `originPeriods`/`developmentPeriods` in the cross-runtime JSON. No synonyms ("cohort", "age", "matrix").
- **Validation errors carry cell-level `{origin, dev, reason}`** (spine Consistency Conventions, FR-2). Labels, not indices.
- **OQ-6 boundary**: monotonicity applies to **paid only**. Incurred validation rules are an open PRD question — do NOT invent incurred-specific rules here; incurred triangles get shape + missing-cell checks only. The negative test (5.2) locks this in.
- **No `schemaVersion` on Triangle/ValidationReport yet**: AD-10's versioned cross-runtime contract names ResultSet and DiagnosticsBundle. The Triangle JSON here is a hashing canonicalization, not a transport schema. Story 2.6 owns the schema-export machinery; don't pre-build it.

### Semantics this story decides (flagged for review)

The epic AC names the three defect classes but not their precise semantics on partially-observed rectangles. This story fixes them as:

1. The Triangle *container* is always a full rectangle of `float | None` (structural, Pydantic-enforced); the *observed region* is each row's leading contiguous non-`None` prefix.
2. Interior `None` (value appears later in the row) = `missing_cell` at the hole.
3. Valid shape = full rectangle or stepped triangle: observed-prefix lengths non-increasing from oldest to newest origin, no empty rows. Prefix lengths for the shape check ignore interior holes so one defect isn't reported twice.
4. Paid monotonicity = strict decrease against the immediate predecessor within the observed prefix; equal values are fine (a quarter with zero paid movement is legitimate).
5. Container-level malformation (ragged rows, duplicate labels, NaN) raises Pydantic `ValidationError` at construction; domain defects come back as `ValidationReport` findings. Rationale: a caller can't even *have* a `Triangle` that lies about its own dimensions, while domain findings stay data (JSON-serialisable, cell-addressable) for the Epic 3 upload wizard to render. The engine_service `/validate` endpoint (Story 2.5) will map both to the error envelope.

If the reviewer disagrees with any of these, the property-test strategies encode the same rules — change both together.

### What NOT to build (scope boundaries)

- **No chainladder usage** — chainladder 0.9.2 enters in Story 2.2 (`run_methods`). Validation is hand-rolled pure Python; do not import pandas/numpy here either (keep the core dependency-light; tuples + floats suffice at this scale).
- **No CSV/Excel parsing, no period detection, no upload flow** — Epic 3. The engine receives already-parsed, already-labeled plain data.
- **No FastAPI endpoint** — Story 2.5 wraps `validate_triangle` in `POST /validate`.
- **No ResultSet, Lineage, or Method models** — Story 2.2. `triangle_hash` is the only Lineage ingredient landing now.
- **No Convex/frontend work.** Zero TypeScript changes (README + CI yaml aside).
- **No incurred monotonicity rules** (OQ-6 open), **no negative-value checks**, **no imputation** — all explicitly out of v1 ingestion scope.

### Existing files being modified — current state

- [engine/reserving_engine/__init__.py](engine/reserving_engine/__init__.py) — empty file. **Change**: public re-exports (Task 6.1). **Preserve**: nothing to preserve.
- [engine/pyproject.toml](engine/pyproject.toml) — deps pinned (pydantic>=2.13.4, hypothesis>=6.156.6, pytest>=9.1.1 already present; `[tool.uv] package = false`). **Change**: add `ruff`, `import-linter` to dev group + `[tool.importlinter]` and `[tool.ruff]` tables. **Preserve**: existing pins untouched; `uv.lock` regenerates via `uv add`/`uv sync` — never hand-edit.
- [.github/workflows/ci.yml](.github/workflows/ci.yml) — `python` job: uv 0.11.2, `uv sync --locked`, `uv run pytest`, `working-directory: engine` default; linux/amd64 pinning comment (AD-11). **Change**: append ruff + lint-imports steps to the python job. **Preserve**: the pinning comment, single-OS matrix, `--locked` sync, node job untouched.
- [engine/tests/test_scaffold.py](engine/tests/test_scaffold.py) — imports all three packages. **Preserve**: keep passing (your `__init__.py` exports must not break bare `import reserving_engine`).

### Previous story intelligence (Epic 1, esp. 1.5)

- **Pinned known-answer vector pattern** (1.5, `convex/lib/auditChain.test.ts`): compute the contract hash once, cross-verify with an independent tool (`shasum -a 256`/node crypto — 1.5's vector `60ba5352…` was independently verified before pinning), assert the literal hex. Reuse this pattern for `triangle_hash` (Task 3.3).
- **Fail loud on malformed input** — 1.4/1.5 review standard: `canonicalJSON` throws on `undefined`, guards reject empty org ids. Mirror: Pydantic rejects NaN/ragged/duplicate-label containers at construction rather than producing a hash of garbage.
- **Review-proven habits**: behavioral tests over constant-assertions; watch prototype/edge semantics (1.5 got dinged for `in`-operator prototype walks — the Python analogue: don't use truthiness where you mean `is not None`, a legitimate `0.0` cell is falsy!). **This bites triangle code specifically**: `if cell:` treats a genuine zero-paid cell as missing. Always `cell is not None`.
- **Working rhythm** (Rohan): TDD red-first per task; commit only on explicit ask; one PR per story branch — you are already on `epic_2/2_1`. CI (GitHub Actions) is the truth; Sourcery/GitGuardian flags are triaged noise.
- **Python env facts** (1-1): `engine/.python-version` = 3.12 locally, `requires-python >=3.11`; run everything from `engine/` cwd (`package = false`, imports resolve from cwd — a known 1-1 deferred quirk). pytest 9.x, hypothesis 6.156+ already in the dev group — add nothing for testing.

### Technical facts (verified 2026-07-16 against the live repo)

- Pydantic v2 (`>=2.13.4` pinned in pyproject): use `ConfigDict(frozen=True)`, `field_validator`/`model_validator(mode="after")`, `Literal` types. `model_dump_json()`/`model_validate_json()` for the round-trip test.
- CPython `json.dumps(..., sort_keys=True, separators=(",", ":"), allow_nan=False)` is deterministic for finite floats (shortest-round-trip float repr, stable since 3.1) — safe as a canonical form; NaN/Inf must be pre-rejected (Task 1.2) or `dumps` raises with `allow_nan=False`, which is the fail-loud backstop.
- `hashlib.sha256` is pure computation — no AD-2 conflict.
- import-linter runs as `lint-imports` console script, config lives in `[tool.importlinter]` in pyproject; `layers` and `forbidden` contract types cover Tasks 4.2(a) and (b). It needs `root_packages` (not `root_package`) for multiple top-level packages.
- Hypothesis: build valid triangles with `st.integers` dims + `st.lists` of non-negative increments then cumulative-sum for paid rows; use `@settings(max_examples=...)` defaults — do not crank examples up; CI time matters and the strategies are small.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.1] — story + ACs; FR-2 core; Epic 2 build-order note ("engine + golden tests first")
- [Source: _bmad-output/planning-artifacts/architecture/architecture-agentic-reserving-2026-07-16/ARCHITECTURE-SPINE.md#AD-2] — functional core purity rule; #AD-10/#AD-11 — canonical Triangle hash in Lineage; #Consistency Conventions — `{origin, dev, reason}`, two-hashes-never-conflated, vocabulary; #Structural Seed — engine layout; #Deferred — OQ-6 incurred rules deferred
- [Source: _bmad-output/planning-artifacts/prds/prd-agentic-reserving-2026-07-16/prd.md#FR-2] — boundary validation consequences (cell listing, hard-reject missing cells); #§3 Glossary — Triangle/Origin Period/Development Period exact terms; #OQ-6 + §11 — paid-only monotonicity decision
- [Source: _bmad-output/project-context.md] — testing rules (Hypothesis property tests for shape/paid-monotonicity/missing-cells), anti-patterns (no I/O/env/clock/logging in reserving_engine), hash discipline
- [Source: _bmad-output/implementation-artifacts/1-5-append-only-hash-chained-audit-log-primitive.md] — pinned known-answer pattern, fail-loud standard, working rhythm
- [Source: _bmad-output/implementation-artifacts/deferred-work.md#Deferred from: code review of 1-1] — Python lint tooling deferred to Epic 2 (closed by Task 4), cwd-sensitive imports quirk

## Dev Agent Record

### Agent Model Used

Claude Fable 5 (claude-fable-5) — BMad dev-story workflow, Amelia persona.

### Debug Log References

- TDD red confirmed per task: model tests failed on `ImportError` before `triangle.py` existed; validation tests failed on missing `validation.py` before implementation.
- import-linter first run failed: external forbidden modules (`requests`, `httpx`) require `include_external_packages = true` at the top level — added.
- Purity contract negative-proofed: temporarily appended `import os` to `triangle.py` → contract reported broken at the exact line; removed, contracts back to 2 kept / 0 broken.
- Full battery (from `engine/`): `uv run pytest` → 44 passed; `uv run ruff check .` → clean; `uv run lint-imports` → 2 contracts kept. Node sanity: `npm test` → 117 passed (no TS changes).

### Completion Notes List

- **Task 1**: Frozen `Triangle` Pydantic model (`ConfigDict(frozen=True)`, tuple fields) with structural validators: non-empty/duplicate-free/non-blank labels, full-rectangle cells, NaN/±Inf rejection. Container malformation raises `ValidationError`; domain defects are `validate_triangle`'s concern (semantics split per Dev Notes item 5).
- **Task 2**: `validate_triangle` pure function, collect-all (never fail-fast). `ValidationFinding{origin, dev, reason, code}` with labels not indices; `ValidationReport.valid` derived and consistency-enforced by a model validator (fail-loud on a hand-built inconsistent report). Semantics exactly as fixed in Dev Notes: leading-contiguous observed region, interior holes as `missing_cell` (excluded from prefix-length shape math — no double reporting), empty-row + increasing-prefix as `shape`, strict-decrease-only `paid_monotonicity` gated on `kind == "paid"`.
- **Task 3**: `canonical_triangle_json` (camelCase keys, `sort_keys`, compact separators, `ensure_ascii`, `allow_nan=False`) + `triangle_hash` (lowercase-hex sha256 of UTF-8 canonical JSON). Pinned known-answer vector `651a7c37…1a36` computed independently via `shasum -a 256` over the hand-written canonical string BEFORE asserting against the implementation (1.5 contract-freezing pattern). Docstrings state the permanent-contract and three-hash discipline.
- **Task 4**: `ruff` + `import-linter` in dev group (closes the 1-1 deferred lint item). Two contracts in `[tool.importlinter]`: layers (`engine_service | copilot_agent` above `reserving_engine`) and forbidden (15 I/O-capable modules banned from `reserving_engine`), `include_external_packages = true`. Minimal ruff config (line-length 100). CI python job gained `Ruff lint` and `Import-linter` steps after pytest; platform-pinning comment and single-OS matrix untouched.
- **Task 5**: Hypothesis suite: `valid_triangles` strategy (dims 1–8, full rectangle or non-increasing stepped prefixes, cumulative sums for paid) always passes; four mutation properties assert the exact `{origin, dev, code}` (interior hole → `missing_cell`, paid decrease → `paid_monotonicity` at the decreasing cell, extended newer prefix → `shape` at first offending cell, incurred decrease → NO finding per OQ-6); multi-defect property proves collect-all (hole + monotonicity break in one report); hash-determinism property over reconstructed instances. Example-based edges: 1×1, single row, equal adjacent paid values, full rectangle, zero-valued cells (0.0 ≠ missing), empty-row shape finding, label-not-index findings, report JSON round-trip.
- **Task 6**: Public surface exported from `reserving_engine/__init__.py` (scaffold import test still green); README "Reserving engine" subsection (purity, cell-level findings, three-hash discipline, lint commands); 1-1 deferred lint item struck through with resolution note.
- **Task 7**: Full battery green (44 pytest / ruff clean / 2 contracts kept / 117 Vitest). CI PR check pending push — GitHub Actions is the truth.
- **Design note for reviewer**: monotonicity compares adjacent non-`None` pairs only; cells immediately after an interior hole have no observed predecessor and are not compared (the hole itself is already a `missing_cell` hard rejection, so no defect escapes).

### File List

- `engine/reserving_engine/triangle.py` — new: frozen Triangle model, canonical JSON, triangle_hash
- `engine/reserving_engine/validation.py` — new: ValidationFinding/ValidationReport, validate_triangle
- `engine/reserving_engine/__init__.py` — modified (was empty): public re-exports
- `engine/tests/test_triangle_model.py` — new: structural/immutability/rejection tests (16)
- `engine/tests/test_triangle_validation.py` — new: Hypothesis properties + edge examples (15)
- `engine/tests/test_triangle_hash.py` — new: pinned vector, determinism, sensitivity (12)
- `engine/pyproject.toml` — modified: ruff + import-linter dev deps, `[tool.ruff]`, `[tool.importlinter]` contracts
- `engine/uv.lock` — regenerated by `uv add --dev ruff import-linter`
- `.github/workflows/ci.yml` — modified: ruff + lint-imports steps appended to python job
- `README.md` — modified: "Reserving engine (Story 2.1, AD-2)" subsection
- `_bmad-output/implementation-artifacts/deferred-work.md` — modified: 1-1 lint item resolved
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — modified: story status transitions

## Change Log

- 2026-07-16: Story 2.1 implemented (Amelia/dev-story) — Triangle model + validate_triangle + canonical hash + purity lint enforcement, TDD red-green per task; 43 new Python tests; pinned hash vector independently verified; status → review.
- 2026-07-16: Story created via BMad create-story (Amelia) — full context from epics Story 2.1, architecture spine AD-2/AD-10/AD-11, PRD FR-2/OQ-6/glossary, project-context testing rules, Epic 1 story intelligence (pinned-vector pattern, fail-loud standard), live engine tree + CI read. Validation semantics on partially-observed rectangles fixed and flagged for review.
