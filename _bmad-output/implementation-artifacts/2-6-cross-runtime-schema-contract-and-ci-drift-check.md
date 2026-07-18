---
baseline_commit: a23cbdc
---

# Story 2.6: Cross-Runtime Schema Contract and CI Drift Check

Status: done

## Story

As a developer on either runtime,
I want the ResultSet/DiagnosticsBundle JSON Schema single-sourced from Pydantic and drift-checked in CI,
so that Python and TypeScript can never silently disagree on the shapes both parse. (AD-10)

## Acceptance Criteria

1. **Given** the Pydantic models, **When** the schema export script runs, **Then** versioned JSON Schema files for ResultSet and DiagnosticsBundle are emitted to a checked-in location, **And** Convex validators and TS types for these shapes exist (or are generated) from that schema.
2. **Given** CI, **When** the contract check runs, **Then** it diffs the exported JSON Schema against the Convex validators/TS types and fails on mismatch (AD-10), **And** a deliberate fixture mismatch demonstrably fails the check.

## Tasks / Subtasks

- [x] Task 1: Schema export script (single source = Pydantic) — `engine/scripts/export_schema.py` + `engine/scripts/__init__.py` (AC: 1)
  - [x] 1.1 `engine/scripts/__init__.py`: empty package marker so `tests/` can `from scripts.export_schema import ...` (cwd is `engine/`, `package = false`, rootdir on `sys.path`). This is a build-time tool package — NOT a `reserving_engine` submodule, so the AD-2 forbidden-modules contract (which scopes `source_modules = ["reserving_engine"]`) does not touch it. `scripts` is not a root package in the import-linter config; do not add it.
  - [x] 1.2 `export_schema.py`: `build_schemas() -> dict[str, str]` returns `{ "resultset.schema.json": <json str>, "diagnostics-bundle.schema.json": <json str> }`. For each model call `Model.model_json_schema(by_alias=True)` — **`by_alias=True` is mandatory**: the wire is camelCase (`schemaVersion`, `methodResults`, `ldfStability`, `clBfDivergence`, …), and the Convex validators use camelCase keys; a snake_case export would false-fail the drift check against real Convex shapes.
  - [x] 1.3 Serialize deterministically: `json.dumps(schema, indent=2, sort_keys=True) + "\n"`. Deterministic bytes are the whole point — the pytest guard (Task 3) asserts byte-equality, so `sort_keys=True` + fixed indent + trailing newline must match exactly what is written to disk. Do this once in a shared `_dumps(schema)` helper used by both the writer and `build_schemas()`.
  - [x] 1.4 `SCHEMAS_DIR = Path(__file__).resolve().parents[2] / "schemas"` (repo root, NOT under `engine/`). `parents[2]` = `engine/scripts/export_schema.py` → repo root. The `schemas/` dir is the neutral cross-runtime home both planes read (Python writes, the Node drift test reads). Create it if missing (`mkdir(parents=True, exist_ok=True)`) — this script is a build tool, file I/O is fine here (it is NOT `reserving_engine`).
  - [x] 1.5 `def main() -> None`: write each `build_schemas()` entry to `SCHEMAS_DIR / filename`; print the paths written. `if __name__ == "__main__": main()`. Runnable as `uv run python scripts/export_schema.py` from `engine/`.
  - [x] 1.6 Import the models from the engine's public API: `from reserving_engine import ResultSet, DiagnosticsBundle`. Downward import (`scripts` → `reserving_engine`) is allowed; never import `engine_service`/`copilot_agent` here.
- [x] Task 2: Emit the checked-in JSON Schema contract files — `schemas/resultset.schema.json`, `schemas/diagnostics-bundle.schema.json` (AC: 1)
  - [x] 2.1 Run `uv run python scripts/export_schema.py` from `engine/` and commit the two generated files under repo-root `schemas/`. These ARE the "versioned JSON Schema files emitted to a checked-in location" — the version travels inside each schema as the `schemaVersion` property (`default: "1.0.0"`); do not encode the version in the path this story (single 1.0.0 line; a `2.0.0` migration is future governance, not now).
  - [x] 2.2 Confirm the emitted schemas contain the expected top-level shape: ResultSet → `properties {schemaVersion, lineage, methodResults}` + `$defs {AprioriLossRatio, DevelopmentFactor, Lineage, MethodResult, OriginResult, RunParameters}`; DiagnosticsBundle → `properties {schemaVersion, runId, triangleHash, ldfStability, ave, clBfDivergence, residuals}` + `$defs` for each element. `clBfDivergence` renders as `anyOf: [{array}, {null}]` (nullable); `mackStdErr`/`sigma`/`cv`/etc. render as `anyOf: [{number}, {null}]`; `method` renders as `enum: [chain_ladder, bornhuetter_ferguson, mack]`. (Verified live 2026-07-18.)
  - [x] 2.3 Do NOT hand-edit the committed JSON Schema files ever — they are generated artifacts. The pytest guard (Task 3) enforces this by regenerating and byte-comparing.
- [x] Task 3: Python-side drift guard — `engine/tests/test_schema_contract.py` (AC: 1, 2)
  - [x] 3.1 TDD: write this first (RED = files not yet committed / mismatch). Import `build_schemas` from `scripts.export_schema` and `SCHEMAS_DIR`. For each `(filename, content)` in `build_schemas().items()`, read `SCHEMAS_DIR / filename` and assert it equals `content` **byte-for-byte**. This is the exact analogue of `test_version_sync.py`: it makes "the committed schema matches the Pydantic models" mechanical — change a model field without re-exporting and the suite goes red. Tests may do I/O (unlike the core).
  - [x] 3.2 Add a sanity assertion that both files exist and parse as JSON with a `schemaVersion` property whose `default == "1.0.0"` — a cheap guard that the export wasn't silently emptied.
  - [x] 3.3 This test runs in the existing CI `uv run pytest` step (Python job) — no CI yml edit. It is the first link of the contract chain: Pydantic ⇒ (this byte-eq guard) ⇒ committed JSON Schema.
- [x] Task 4: Canonical shape extractor (the diff vocabulary) — `convex/lib/schemaContract.ts` (AC: 2)
  - [x] 4.1 Define a `CanonicalType` union that both a JSON Schema and a Convex validator normalize into, so drift is a single deep-equality: `{ kind: "object", fields: Record<string, CanonicalType> }` | `{ kind: "array", element: CanonicalType }` | `{ kind: "enum", values: string[] }` (sorted) | `{ kind: "nullable", inner: CanonicalType }` | `{ kind: "string" | "number" | "boolean" | "null" }`.
  - [x] 4.2 `jsonSchemaToCanonical(schema, root)`: walk a Pydantic-exported JSON Schema. Resolve `$ref: "#/$defs/Name"` against `root.$defs`. Map `{type:"object"}` → recurse `properties`; `{type:"array", items}` → `array(items)`; `{enum:[...]}` → `enum(sorted values)`; `{type:"string"|"number"|"integer"|"boolean"|"null"}` → scalar (`integer`→`number`); `{anyOf:[X, {type:null}]}` → `nullable(X)` (unwrap the non-null branch, recurse). **Ignore** `default`, `title`, `description`, and the top-level `required` array (see decision #3: the wire always emits every declared key, so presence is "all declared properties", and optionality is NOT a contract axis — nullability is).
  - [x] 4.3 `convexValidatorToCanonical(validatorJson)`: walk a Convex validator's `.json` (shape confirmed live: `{type:"object", value:{field:{fieldType, optional}}}`, `{type:"array", value:<vjson>}`, `{type:"union", value:[...]}`, `{type:"literal", value}`, `{type:"string"|"number"|"boolean"|"null"}`). Map object→recurse `value[*].fieldType`; array→`array(value)`; a `union` whose members are all `{type:"literal"}` (or literal-unions) → `enum(sorted literal values)`; a `union` of exactly `[T, {type:"null"}]` (in any order) → `nullable(T)`; scalar types → scalar. Ignore the `optional` flag (decision #3, symmetric with 4.2). Convex has no `integer` — numbers are `number`.
  - [x] 4.4 Keep this module PURE and server-free: it imports nothing from `convex/_generated` or `convex/server`, only types. It must be importable from a plain Node vitest test AND type-check under both the root and convex tsconfig programs. No file I/O in this module (the test does the reading).
  - [x] 4.5 Export a `diffCanonical(a: CanonicalType, b: CanonicalType, path?): string[]` returning a list of human-readable mismatch descriptions (empty = identical). Deep-equal would suffice, but a path-annotated diff makes a red CI actionable ("methodResults.element.method: enum values differ" beats a boolean). This is the reusable engine of the drift check AND the thing the deliberate-mismatch test asserts is non-empty.
- [x] Task 5: Hand-authored Convex validators + TS types — `convex/lib/engineContract.ts` (AC: 1)
  - [x] 5.1 Author `resultSetValidator` and `diagnosticsBundleValidator` as Convex `v.object({...})` with **camelCase keys byte-matching the JSON Schema property names**. Nested models become nested `v.object` (or shared local validators, e.g. `originResultValidator`, `methodResultValidator`, `lineageValidator`, `runParametersValidator`, `aprioriLossRatioValidator`, `developmentFactorValidator`, and the four diagnostic element validators + `linkRatioValidator`). Model each field per decision #3:
    - required non-null scalar (`origin`, `ultimate`, `schemaVersion`, `runId`, `triangleHash`, factors) → `v.string()` / `v.number()`.
    - nullable field (`mackStdErr`, `reserveLow`, `reserveHigh`, `totalMackStdErr`, `sigma`, `stdErr`, `cv`, `actualToExpectedRatio`, `relativeDivergence`) → `v.union(v.number(), v.null())` (present-but-maybe-null; NOT `v.optional` — the wire always emits the key).
    - `clBfDivergence` → `v.union(v.array(clBfDivergenceElementValidator), v.null())` (nullable array).
    - `method` (and `RunParameters.methods` element) → `v.union(v.literal("chain_ladder"), v.literal("bornhuetter_ferguson"), v.literal("mack"))`.
    - arrays/tuples (`methodResults`, `developmentFactors`, `originResults`, `ldfStability`, `ave`, `residuals`, `aprioriLossRatios`, `linkRatios`) → `v.array(<elementValidator>)`.
  - [x] 5.2 Export the TS types **from** the validators: `export type ResultSet = Infer<typeof resultSetValidator>;` and `export type DiagnosticsBundle = Infer<typeof diagnosticsBundleValidator>;` (`import { Infer } from "convex/values"`). This satisfies "TS types … exist from that schema": the type is derived from the validator, and the validator is drift-checked against the JSON Schema (Task 6) — so the type transitively conforms. Do NOT hand-write a parallel `interface` (that would be a third thing to drift).
  - [x] 5.3 Module docstring: this is the AD-10 Convex-side contract for the shapes Epic 4 will `v`-validate before persisting a ResultSet (AD-10: "a ResultSet failing schema validation is never stored"). It is real product-plane code, not a test fixture. No functions, no server imports — just validators + types, so it deploys cleanly (it is not a `*.test.ts`, so `.convexignore` leaves it in; that is correct, it is meant to ship).
  - [x] 5.4 Confirm `npx tsc --noEmit -p convex` stays green with the new module (camelCase keys, `Infer`, `v.union` literal unions all type-check).
- [x] Task 6: The CI drift check — `tests/engine-contract.test.ts` (AC: 2)
  - [x] 6.1 Location is deliberate: repo-root `tests/` runs in the vitest **"unit" (node)** project (`include: ["tests/**/*.test.{ts,tsx}"]`), where `node:fs` works — the convex/edge-runtime project stubs fs and cannot read `schemas/*.json`. Import validators from `../convex/lib/engineContract` and the extractors from `../convex/lib/schemaContract` (plain modules, no server context — safe to import into a node test).
  - [x] 6.2 Read the two committed schemas with `readFileSync(join(__dirname, "..", "schemas", "<file>"), "utf8")` and `JSON.parse`. For ResultSet: `expect(diffCanonical(jsonSchemaToCanonical(rsSchema, rsSchema), convexValidatorToCanonical(resultSetValidator.json))).toEqual([])`. Same for DiagnosticsBundle. Empty diff = Python and Convex agree; **any drift fails CI** (AC-2 clause 1). This is the second link: committed JSON Schema ⇒ (this canonical diff) ⇒ Convex validators/TS types.
  - [x] 6.3 **Deliberate-mismatch demonstration (AC-2 clause 2)**: prove the checker actually catches drift — a negative test of the check itself. Take the real ResultSet canonical, structurally mutate a clone (e.g. drop the `ibnr` field from `OriginResult`, OR rename `methodResults`→`methods`, OR change `method`'s enum values), and assert `diffCanonical(good, mutated)` returns a **non-empty** list naming the drifted path. Do this against a mutated CANONICAL/validator clone — do NOT commit a broken real validator. This is the demonstrable fixture mismatch the AC requires.
  - [x] 6.4 Add a focused unit test per extractor axis so the diff engine is trustworthy: nullable (`anyOf:[T,null]` ⇔ `v.union(T, v.null())`), enum (`enum` ⇔ literal-union), array, nested object/`$ref` resolution, scalar `integer`→`number` coercion. If the extractors are wrong, the whole gate is theater — pin their behavior.
  - [x] 6.5 This test runs in the existing CI `npm test` (Node job, `vitest run`) — no CI yml edit. Confirm `npm test` picks it up (unit project) and it is green.
- [x] Task 7: Docs, wiring, full verification (all ACs)
  - [x] 7.1 README: add a short "Cross-runtime schema contract (AD-10)" note to the engine/architecture section — Pydantic is the single source; `uv run python scripts/export_schema.py` (from `engine/`) regenerates `schemas/*.json`; `tests/engine-contract.test.ts` drift-checks the Convex validators (`convex/lib/engineContract.ts`) against them; both guards run in CI (pytest + vitest). Tell contributors: **change a ResultSet/DiagnosticsBundle field → re-run the export → update the Convex validator → both checks stay green.**
  - [x] 7.2 No `.github/workflows/ci.yml` edit needed: the Python guard rides the existing `uv run pytest` step; the drift check rides the existing `npm test` step. Confirm this explicitly in the completion notes (do not add redundant CI steps — mirrors 2.5's "existing steps run the new tests").
  - [x] 7.3 Python battery from `engine/`: `uv run pytest` (all green incl. `test_schema_contract.py`; platform-gated exact-tier skips still expected on macOS), `uv run ruff check .`, `uv run lint-imports` (2 contracts KEPT — `scripts` is not scanned; confirm it did not accidentally get pulled into a root package).
  - [x] 7.4 Node battery from repo root: `npm run lint`, `npx tsc --noEmit` (app/root program), `npx tsc --noEmit -p convex` (convex program), `npm test` (vitest — new `tests/engine-contract.test.ts` green). Confirm the root program type-checks the transitively-imported `convex/lib/*` modules without error (they use only `convex/values`, DOM-lib-compatible).
  - [x] 7.5 CI green on the PR (linux/amd64). No golden literals pinned here; the schema export is platform-agnostic (Pydantic schema generation is deterministic across platforms). Commit/push deferred per working rhythm.

## Dev Notes

### What this story is (and the contract chain it closes)

AD-10 says the ResultSet/DiagnosticsBundle JSON Schema is single-sourced from Pydantic and the Convex validators/TS types are drift-checked against it. This story builds a **two-link mechanical chain** so neither runtime can silently drift:

```
Pydantic models (engine/reserving_engine)
   │  export_schema.py  (by_alias=True, deterministic dump)
   ▼
schemas/*.json  ── guarded by → test_schema_contract.py (pytest, byte-equality)   ← Link 1 (Python)
   │  canonical diff (schemaContract.ts extractors)
   ▼
convex/lib/engineContract.ts validators + Infer types ── guarded by → tests/engine-contract.test.ts (vitest)  ← Link 2 (Node)
```

Link 1 fails red if a Pydantic field changes without re-exporting. Link 2 fails red if the committed schema and the Convex validators disagree. Together: Python and TS can never silently disagree (the AC).

### Architecture compliance (non-negotiable)

- **AD-10 (single-sourced, versioned, drift-checked contract)**: Pydantic is the ONLY source of truth for these shapes. The JSON Schema is generated (never hand-edited); the Convex validators are drift-checked against it in CI and fail on mismatch. `schemaVersion` ("1.0.0") travels inside each schema and each model — it is the version handle for a future migration; this story does not bump it.
- **AD-2 (purity / layering)**: `reserving_engine` stays untouched and pure — NO field changes, NO export code inside it (it cannot do file I/O). The exporter lives in `engine/scripts/` (a build tool, not the core), does the file writing, and imports the core downward only. import-linter's `source_modules = ["reserving_engine"]` never sees `scripts`; keep it that way (do not list `scripts` as a root package).
- **Dependency direction (AD-2)**: `scripts` → `reserving_engine` (allowed). The Convex validators live on the product plane (`convex/`); they do not import Python — the contract crosses the boundary as the committed JSON Schema file, exactly as the spine intends (frontend → Convex → engine_service → reserving_engine; nothing calls upward).
- **camelCase wire discipline (2.2–2.5)**: the export uses `by_alias=True`; the Convex validators use camelCase keys. The whole point is byte/shape parity with what `engine_service` actually serializes (2.5 already dumps `by_alias=True`). A snake_case slip anywhere breaks the drift check truthfully.
- **Vocabulary (PRD §3)**: `ResultSet`, `DiagnosticsBundle`, `Lineage`, `RunParameters`, `Diagnostic`, `Origin Period` — exact terms in validator names and TS type names. No "schema payload", "job result" synonyms.

### Design decisions this story fixes (flagged for review)

1. **Hand-authored Convex validators + drift check, NOT JSON-Schema→Convex codegen.** The AC explicitly allows "exist (or are generated)". Hand-authored validators are real, reviewable product code Epic 4 will use to `v`-validate ResultSets before persisting (AD-10); a codegen'd `.ts` in `convex/` would be an opaque generated blob that must type-check and deploy perfectly, and writing a correct JSON-Schema→`v.*` generator (handling `$ref`, `anyOf`-null, enums, tuples, defaults) is more brittle than a normalized structural diff. The drift check makes hand-authoring safe: humans CANNOT merge drift, they can only fix it. If the reviewer prefers true codegen, it is a clean future swap — the JSON Schema (Link 1) is already the single source; only Link 2's producer changes.
2. **Structural (canonical) diff, not textual.** JSON Schema and Convex `.json` are different serializations of the same shape; comparing them requires normalizing both into one `CanonicalType` vocabulary and deep-comparing. Two small extractors + one `diffCanonical`. The extractors are themselves unit-tested (Task 6.4) so the gate is not theater.
3. **The contract axes are: key set + type + nullability + enum values. NOT optional/required.** Rationale: `engine_service` dumps with `by_alias=True` and NO `exclude_none`, so every declared field is ALWAYS present on the wire — even `clBfDivergence` (emitted as `null` when CL+BF didn't both run) and every `mackStdErr` (emitted as `null` for CL/BF). Pydantic's JSON-Schema `required` array excludes fields that merely have a Python default (`schemaVersion`, `clBfDivergence`, the Mack fields), which does NOT reflect wire presence. So both extractors **ignore** `required`/`optional` and treat "the declared property set" as the contract, with nullability (`anyOf:[T,null]` ⇔ `v.union(T, v.null())`) as the real axis. Convex models nullable fields as `v.union(T, v.null())` (present, maybe null), never `v.optional` — this is the faithful wire model. This is the single subtlest point in the story; getting it wrong yields either false CI failures or a false pass. (Confirmed live: `clBfDivergence` and `mackStdErr` render as `anyOf:[...,{type:null}]` with `default` and are absent from `required`.)
4. **`schemas/` at repo root, not under `engine/` or `convex/`.** It is a shared cross-runtime artifact; a neutral home signals joint ownership and both planes reach it (`engine/scripts` writes `../../schemas`, `tests/` reads `../schemas`). The version lives inside the schema (`schemaVersion`), not in the path — one 1.0.0 line today.
5. **Both guards are tests in existing CI jobs — no ci.yml edit.** `test_schema_contract.py` rides `uv run pytest`; `tests/engine-contract.test.ts` rides `npm test`. Same pattern as 2.5 (existing steps run new tests). The "contract check" the AC names is these two tests; they are first-class gates because a red test blocks the PR.
6. **Deliberate-mismatch is a negative test of the checker, against a mutated clone — the real validator is never broken.** AC-2 wants proof the check catches drift; mutating a cloned canonical/validator and asserting `diffCanonical(...)` is non-empty proves it without committing a broken contract (which would just make CI permanently red).

If the reviewer disagrees on any of these, note it — none are golden-pinned. Keep decision #3 (the nullability/required rule) intact unless you change how `engine_service` serializes.

### What NOT to build (scope boundaries)

- **No changes to `reserving_engine`** — no field additions, no `schema_version` bump, no export code in the core. The models are consumed as-is via the public API. If a genuine shape gap surfaces, STOP and flag it — do not edit the pure core from a contract story.
- **No JSON-Schema→validator/type codegen tool** (decision #1) — hand-authored validators + `Infer` types, drift-checked. No `json-schema-to-typescript`, no new codegen dep.
- **No Convex schema.ts table** for ResultSet/DiagnosticsBundle — persistence (the `runs` table storing a ResultSet, `v`-validated on the way in) is Epic 4 (4.2). This story only DEFINES the validators/types in `convex/lib/engineContract.ts`; wiring them into a table + mutation is later.
- **No engine_service changes** — 2.5's serialization already emits `by_alias=True`; the schema is derived from the same models. No new endpoint, no schema endpoint.
- **No runtime JSON-Schema validation in Convex** (e.g. ajv) — the contract is a build/CI-time drift check, not a request-time validator. Epic 4 uses the Convex `v` validators at the mutation boundary; that is Convex's native mechanism, not ajv.
- **No versioned schema directories / migration tooling** — single 1.0.0 line; multi-version governance is future work when a `2.0.0` is actually needed.
- **No Dockerfile / Cloud Run / deployment** — Epic 7.

### Existing files — current state (read before writing)

- [engine/reserving_engine/resultset.py](engine/reserving_engine/resultset.py) — `ResultSet`, `Lineage`, `RunParameters`, `AprioriLossRatio`, `MethodResult`, `OriginResult`, `DevelopmentFactor`; `_MODEL_CONFIG` (frozen, `alias_generator=to_camel`, `populate_by_name`) drives the camelCase wire. `schema_version` default "1.0.0". **No edits** — read to author the Convex validator field-by-field.
- [engine/reserving_engine/diagnostics.py](engine/reserving_engine/diagnostics.py) — `DiagnosticsBundle`, `LdfStabilityElement`, `LinkRatio`, `AveElement`, `ClBfDivergenceElement`, `ResidualElement`. `cl_bf_divergence: tuple[...] | None = None` (nullable array on the wire). `schema_version` default "1.0.0". **No edits**.
- [engine/reserving_engine/__init__.py](engine/reserving_engine/__init__.py) — public API; import `ResultSet`, `DiagnosticsBundle` from here in the exporter. **No edits**.
- [engine/tests/test_version_sync.py](engine/tests/test_version_sync.py) — the pattern to mirror for `test_schema_contract.py`: a test may do I/O (`tomllib`/`Path`) to make a lockstep mechanical. Copy the shape.
- [engine/pyproject.toml](engine/pyproject.toml) — `package = false`; import-linter `root_packages = [reserving_engine, engine_service, copilot_agent]` (scripts NOT among them — keep it that way); ruff `line-length = 100`; existing `filterwarnings`. **No edits expected** (no new dep — stdlib `json`/`pathlib` only). If pytest can't import `scripts`, prefer `engine/scripts/__init__.py` over any pyproject change.
- [convex/schema.ts](convex/schema.ts) — tables defined just-in-time; `v` from `convex/values`; camelCase field convention already established (auditLogs). **No edits** — the ResultSet table is Epic 4.
- [convex/lib/](convex/lib/) — existing home for shared Convex modules (`auditChain.ts`, `guards.ts`, `clerkWebhook.ts`) with co-located `*.test.ts`. New `engineContract.ts` + `schemaContract.ts` join here (no `.test.ts` on these two — they must deploy).
- [convex/tsconfig.json](convex/tsconfig.json) — ESNext libs, strict, `noEmit`; type-checked separately in CI (`tsc -p convex`). New modules must pass it. Note: `resolveJsonModule` is NOT set — do not `import` the schema JSON into a convex module; the JSON is read by `node:fs` in the root `tests/` file only.
- [vitest.config.mts](vitest.config.mts) — two projects: "unit" (`tests/**/*.test.{ts,tsx}`, node) and "convex" (`convex/**/*.test.ts`, edge-runtime). The drift test goes in **"unit"** (node → `fs` works). `npm test` runs both.
- [tsconfig.json](tsconfig.json) — root program, `exclude: ["node_modules", "convex"]`, DOM libs. A `tests/` file importing `../convex/lib/*` pulls those two modules into the root program transitively; they use only `convex/values` (DOM-compatible), so `npx tsc --noEmit` stays green. Verify in Task 7.4.
- [.github/workflows/ci.yml](.github/workflows/ci.yml) — Python job (`uv sync --locked` → `pytest` → `ruff` → `lint-imports`) and Node job (`npm ci` → lint → `tsc` app → `tsc -p convex` → `npm test`). **No edits** — both new guards ride existing steps (decision #5).
- [.convexignore](.convexignore) — ignores `**/*.test.ts` from deploy. Confirms `engineContract.ts`/`schemaContract.ts` (no `.test`) DO deploy (intended — they are product code); the drift test (`.test.ts`) does not.
- [README.md](README.md) — engine/architecture section (updated in 2.5). **Change**: add the AD-10 contract note (Task 7.1). **Preserve** the rest.
- Untouched: all `engine_service/*`, `methods.py`, `validation.py`, `triangle.py`, `version.py`, every existing engine test/fixture, all `app/` and `components/`.

### Verified facts (live probes, 2026-07-18)

- `ResultSet.model_json_schema(by_alias=True)`: top-level keys `[$defs, description, properties, required, title, type]`; `properties` = `[schemaVersion, lineage, methodResults]`; `$defs` = `[AprioriLossRatio, DevelopmentFactor, Lineage, MethodResult, OriginResult, RunParameters]`; `required` = `[lineage, methodResults]` (note `schemaVersion` absent — it has a default; decision #3). `schemaVersion` → `{default:"1.0.0", type:"string"}`. `methodResults` → `{type:"array", items:{$ref:"#/$defs/MethodResult"}}`. `MethodResult.method` → `{enum:[chain_ladder, bornhuetter_ferguson, mack], type:"string"}`. `OriginResult.mackStdErr` → `{anyOf:[{type:number},{type:null}], default:null}`; `OriginResult.required` = `[origin, ultimate, ibnr]`.
- `DiagnosticsBundle.model_json_schema(by_alias=True)`: `properties` = `[schemaVersion, runId, triangleHash, ldfStability, ave, clBfDivergence, residuals]`; `required` = `[runId, triangleHash, ldfStability, ave, residuals]` (`schemaVersion` + `clBfDivergence` absent — defaults). `clBfDivergence` → `{anyOf:[{type:array, items:{$ref:"#/$defs/ClBfDivergenceElement"}}, {type:null}], default:null}`.
- Convex `v.object({...}).json` (convex 1.42.2): `{type:"object", value:{<field>:{fieldType:<vjson>, optional:<bool>}}}`; `v.array(T)` → `{type:"array", value:<vjson>}`; `v.union(a,b)` → `{type:"union", value:[<vjson>...]}`; `v.literal("x")` → `{type:"literal", value:"x"}`; scalars → `{type:"string"|"number"|"boolean"|"null"}`. Walkable; drives `convexValidatorToCanonical`.
- `.convexignore` = `**/*.test.ts` only → non-test `convex/lib/*.ts` deploys.
- Pydantic renders `tuple[X, ...]` as `{type:"array", items:{...}}` (homogeneous) — treat as `array`.

### Previous story intelligence (2.1–2.5)

- **Branch**: on `epic_2/2_6` at `a23cbdc` (2.5 complete, committed). 2.1–2.5 are status `review`; if their reviews land model changes, re-run the schema export and re-check before finalizing (the whole point — a model change must re-flow through both links).
- **Reuse, don't rebuild**: the engine public API for the models; `model_json_schema(by_alias=True)` for the export; `test_version_sync.py` as the byte-equality-guard template; `convex/lib/` as the module home; the existing two-project vitest layout.
- **Fail-loud / mechanical-lockstep standard** (1.4/1.5/2.1/2.4/2.5): make the contract mechanical, not aspirational — a byte-equality pytest guard + a canonical-diff vitest gate, both red-blocking. This is the schema analogue of import-linter and version_sync.
- **camelCase wire discipline** (2.2–2.5): every boundary object is camelCase via the shared alias config; 2.6 FREEZES it — the drift check is exactly what keeps it frozen.
- **Working rhythm** (Rohan): TDD red-first per task; Python from `engine/` cwd, Node from repo root; commit only on explicit ask; CI (linux/amd64) is the truth, Sourcery/GitGuardian are triaged noise.

### Project Structure Notes

- New Python: `engine/scripts/__init__.py`, `engine/scripts/export_schema.py` (build tool, outside the three root packages); `engine/tests/test_schema_contract.py`.
- New shared artifact: `schemas/resultset.schema.json`, `schemas/diagnostics-bundle.schema.json` (repo root).
- New TS: `convex/lib/schemaContract.ts` (pure extractors + `diffCanonical`), `convex/lib/engineContract.ts` (validators + `Infer` types); `tests/engine-contract.test.ts` (node/unit drift gate + extractor unit tests + deliberate-mismatch negative test).
- Naming: snake_case Python; camelCase TS + camelCase validator keys (matching the wire). File names: kebab for the schema files (`diagnostics-bundle.schema.json`) to read naturally on the product plane.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.6] — story + ACs; Epic 2 boundary (2.6 is the last, freezes the contract before Epic 3/4 consume it)
- [Source: _bmad-output/planning-artifacts/architecture/architecture-agentic-reserving-2026-07-16/ARCHITECTURE-SPINE.md#AD-10] — shared cross-runtime contracts are versioned + single-sourced; JSON Schema from Pydantic is the contract Convex validators/TS types are generated/checked against (CI diffs them); a ResultSet failing schema validation is never stored
- [Source: _bmad-output/project-context.md] — AD-10 testing rule ("ResultSet/DiagnosticsBundle schemas are the cross-runtime contract … a CI check diffs Convex validators/TS types against it"); camelCase vocabulary; imperative-shell / dependency-direction rules; anti-pattern "storing a schema-invalid ResultSet"
- [Source: _bmad-output/implementation-artifacts/2-5-engine-service-fastapi-shell-with-service-auth.md] — `by_alias=True` byte-parity discipline; `_MODEL_CONFIG` reuse; "2.6 drift-checks these exact shapes" hand-off; scripts-vs-core layering; existing-CI-steps-run-new-tests pattern
- [Source: engine/reserving_engine/resultset.py, diagnostics.py] — the exact fields, nullability, and Literals the Convex validators must mirror
- [Source: engine/tests/test_version_sync.py] — the mechanical-lockstep test template for `test_schema_contract.py`
- [Source: convex/schema.ts, convex/lib/*, vitest.config.mts, convex/tsconfig.json] — `v` validator conventions, module home, two-project vitest layout, convex type-check program
- [Source: live probes of Pydantic model_json_schema + Convex v.object().json, 2026-07-18] — the two normalization inputs the drift check consumes

## Dev Agent Record

### Agent Model Used

Claude (claude-opus-4-8) via BMad create-story + dev-story (Amelia)

### Debug Log References

- **One deviation from the task spec (flagged)**: the export script and README run it as `uv run python -m scripts.export_schema` (module form), NOT `uv run python scripts/export_schema.py` (direct-path form written in Tasks 1.5/2.1/7.1). Reason: `engine/pyproject.toml` sets `package = false`, so a direct-path run puts `engine/scripts/` (not `engine/`) on `sys.path[0]` → `ModuleNotFoundError: No module named 'reserving_engine'`. The `-m` form puts the cwd (`engine/`) on the path, resolving both `scripts` and `reserving_engine`. Confirmed live: direct-path failed, `-m` succeeded.
- Red-proof of Link 1: mutated a committed schema file (`ibnr`→`ibnrX`) → `test_schema_contract.py` went red on exactly that file; restored → green. The byte-equality guard is not a tautology.
- Red-proof of Link 2: the deliberate-mismatch tests (dropped `ibnr`, renamed `methodResults`, shrunk the `method` enum) each produce a non-empty `diffCanonical` naming the drifted path.
- Two TS-typing fixes surfaced during `tsc`/lint: (1) Convex validators expose `.json` at runtime but not in the public type — isolated the cast in `validatorToCanonical(validator: GenericValidator)` rather than at every call site; a `{ json?: unknown }` weak-type param tripped TS2559, so the param is typed `GenericValidator`. (2) eslint forbids `any` — the JSON/validator walkers use `Record<string, unknown>` with narrowing (repo pattern, matches `clerkWebhook.ts`).

### Completion Notes List

- Task 1: `engine/scripts/__init__.py` (build-tool package marker, docstring: exempt from AD-2 purity, downward-only imports) + `engine/scripts/export_schema.py` — `build_schemas()` returns `{filename: json_str}` via `model_json_schema(by_alias=True)`; deterministic `_dumps()` (`sort_keys=True`, indent 2, trailing newline); writes to repo-root `schemas/` (`parents[2]`). Imports models from the public API. Runnable as `python -m scripts.export_schema` (see Debug Log deviation).
- Task 2: `schemas/resultset.schema.json` + `schemas/diagnostics-bundle.schema.json` emitted and committed. Shape confirmed: ResultSet `{schemaVersion, lineage, methodResults}` + 6 `$defs`; DiagnosticsBundle `{schemaVersion, runId, triangleHash, ldfStability, ave, clBfDivergence, residuals}` + 6 element `$defs`; `clBfDivergence`/`mackStdErr`/… render `anyOf:[…,null]`, `method`/`methods` items render `enum`. `schemaVersion` default "1.0.0" inside each.
- Task 3: `engine/tests/test_schema_contract.py` — parametrized byte-equality guard (Link 1) mirroring `test_version_sync.py`, plus a versioned-JSON sanity assertion. 4 tests green; red-proof verified.
- Task 4: `convex/lib/schemaContract.ts` — `CanonicalType` vocabulary; `jsonSchemaToCanonical` (resolves `$ref`, `anyOf`-null→nullable, `enum`→sorted, `integer`→number, ignores `required`/`default`/`title`); `convexValidatorToCanonical` (walks `.json`: object/array/literal/union→nullable-or-enum/scalar, ignores `optional`); `validatorToCanonical` wrapper (isolates the `.json` cast); `diffCanonical` (path-annotated structural diff). Pure, server-free.
- Task 5: `convex/lib/engineContract.ts` — hand-authored `resultSetValidator` + `diagnosticsBundleValidator` with shared local validators; camelCase keys byte-matching the schema; nullable fields as `v.union(T, v.null())` (decision #3), `clBfDivergence` as nullable array, `method`/`methods` as a 3-literal union. TS types via `Infer<…>`. No functions/server imports → deploys cleanly. `tsc -p convex` green.
- Task 6: `tests/engine-contract.test.ts` (node/unit project) — the two real drift checks (Link 2, both `[]`), three deliberate-mismatch negative tests, five extractor-axis unit tests. 10 tests green.
- Task 7: README "Cross-runtime schema contract (Story 2.6, AD-10)" subsection added (single source, export command, both guards, contributor workflow). No `ci.yml` edit — the pytest guard rides `uv run pytest`, the drift check rides `npm test` (decision #5). Full battery: **Python** `uv run pytest` → 187 passed / 9 platform-gated skips, `ruff` clean, `lint-imports` 2 contracts KEPT (`scripts` not scanned); **Node** `npm run lint` clean, `tsc` (root) + `tsc -p convex` both 0, `npm test` → 127 passed (12 files). CI (linux/amd64) confirmation pending commit/push (working rhythm). No `reserving_engine` edits.

### File List

- engine/scripts/__init__.py (new — build-tool package marker)
- engine/scripts/export_schema.py (new — Pydantic → JSON Schema exporter)
- engine/tests/test_schema_contract.py (new — Link 1 byte-equality guard)
- schemas/resultset.schema.json (new — committed contract artifact)
- schemas/diagnostics-bundle.schema.json (new — committed contract artifact)
- convex/lib/schemaContract.ts (new — canonical extractors + diffCanonical)
- convex/lib/engineContract.ts (new — Convex validators + Infer types)
- tests/engine-contract.test.ts (new — Link 2 drift check + negative + axis tests)
- README.md (modified — AD-10 cross-runtime schema contract subsection)
- _bmad-output/implementation-artifacts/sprint-status.yaml (modified — story status)
- _bmad-output/implementation-artifacts/2-6-cross-runtime-schema-contract-and-ci-drift-check.md (modified — this record)

### Review Findings (Code Review 2026-07-18)

- [x] [Review][Defer] The drift checker's type extractor handles `enum` but has no branch for Pydantic v2's single-value `Literal`, which serializes as `{"const": …}`. If any contract field ever becomes a single-value `Literal`, the extractor falls through to scalar `string` while the Convex side is `v.literal(...)` → `enum`, producing a spurious (fail-closed) drift failure. Add a `const` branch. — deferred, latent fragility [convex/lib/schemaContract.ts:58]

## Change Log

- 2026-07-18: Implementation complete (Amelia/dev-story) — AD-10 cross-runtime schema contract as a two-link mechanical chain. Link 1: `scripts/export_schema.py` single-sources JSON Schema from the Pydantic models to repo-root `schemas/`, guarded by `test_schema_contract.py` byte-equality (pytest). Link 2: hand-authored Convex validators + `Infer` types in `convex/lib/engineContract.ts`, structurally drift-checked against the committed schemas by `tests/engine-contract.test.ts` (vitest) via the pure `schemaContract.ts` canonical extractors. Contract axes = keys+type+nullability+enum (decision #3); nullable fields modeled `v.union(T, v.null())`. Both guards ride existing CI steps (no `ci.yml` edit). One deviation: export runs as `python -m scripts.export_schema` (module form) because `package = false`. 187 py passed/9 skipped, ruff + import-linter (2 KEPT) green; 127 vitest passed, lint + tsc (root & convex) green. No `reserving_engine` changes. CI confirmation pending commit/push.
- 2026-07-18: Story created via BMad create-story (Amelia) — full context from epics Story 2.6, spine AD-10, project-context AD-10 testing rule, 2.1–2.5 story intelligence, and live probes of Pydantic `model_json_schema(by_alias=True)` + Convex `v.object().json`. Six design decisions fixed and flagged (hand-authored validators + structural diff over codegen; contract axes = keys+type+nullability+enum, NOT required/optional; repo-root `schemas/`; both guards ride existing CI steps; deliberate-mismatch as a negative test of the checker).
