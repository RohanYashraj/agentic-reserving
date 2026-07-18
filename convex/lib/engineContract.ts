/**
 * AD-10 Convex-side contract: `v` validators + inferred TS types for the
 * ResultSet and DiagnosticsBundle shapes the engine emits.
 *
 * Single source of truth is the Pydantic models in `reserving_engine`;
 * their JSON Schema is exported to `schemas/*.json` and these validators
 * are drift-checked against it in CI (`tests/engine-contract.test.ts`).
 * They are hand-authored (reviewable product code), not generated — the
 * drift check is what makes that safe: drift cannot be merged, only fixed.
 *
 * This is real product-plane code: Epic 4 uses these validators to
 * `v`-validate a ResultSet before persisting it (AD-10 — "a ResultSet
 * failing schema validation is never stored"). No functions, no server
 * imports; just validators + types, so it deploys cleanly.
 *
 * Wire discipline (2.2–2.5): keys are camelCase, byte-matching the JSON
 * Schema property names. Nullable fields are `v.union(T, v.null())`
 * (present-but-maybe-null), NOT `v.optional` — `engine_service` dumps
 * every field, so each key is always on the wire (decision #3).
 */

import { Infer, v } from "convex/values";

/** The v1 Methods (matches `Literal["chain_ladder", ...]` in the engine). */
export const methodValidator = v.union(
  v.literal("chain_ladder"),
  v.literal("bornhuetter_ferguson"),
  v.literal("mack"),
);

/** A nullable float field — present on the wire, possibly `null`. */
const nullableNumber = v.union(v.number(), v.null());

// --- ResultSet shapes -----------------------------------------------------

export const aprioriLossRatioValidator = v.object({
  origin: v.string(),
  lossRatio: v.number(),
  exposure: v.number(),
});

export const runParametersValidator = v.object({
  methods: v.array(methodValidator),
  aprioriLossRatios: v.array(aprioriLossRatioValidator),
});

const lineageValidator = v.object({
  engineVersion: v.string(),
  chainladderVersion: v.string(),
  triangleHash: v.string(),
  parameters: runParametersValidator,
});

const developmentFactorValidator = v.object({
  fromDev: v.string(),
  toDev: v.string(),
  factor: v.number(),
});

const originResultValidator = v.object({
  origin: v.string(),
  ultimate: v.number(),
  ibnr: v.number(),
  mackStdErr: nullableNumber,
  reserveLow: nullableNumber,
  reserveHigh: nullableNumber,
});

const methodResultValidator = v.object({
  method: methodValidator,
  developmentFactors: v.array(developmentFactorValidator),
  originResults: v.array(originResultValidator),
  totalMackStdErr: nullableNumber,
});

export const resultSetValidator = v.object({
  schemaVersion: v.string(),
  lineage: lineageValidator,
  methodResults: v.array(methodResultValidator),
});

// --- DiagnosticsBundle shapes --------------------------------------------

const linkRatioValidator = v.object({
  origin: v.string(),
  factor: v.number(),
});

const ldfStabilityElementValidator = v.object({
  id: v.string(),
  fromDev: v.string(),
  toDev: v.string(),
  selectedFactor: v.number(),
  linkRatios: v.array(linkRatioValidator),
  sigma: nullableNumber,
  stdErr: nullableNumber,
  cv: nullableNumber,
});

const aveElementValidator = v.object({
  id: v.string(),
  origin: v.string(),
  fromDev: v.string(),
  toDev: v.string(),
  actual: v.number(),
  expected: v.number(),
  actualMinusExpected: v.number(),
  actualToExpectedRatio: nullableNumber,
});

const clBfDivergenceElementValidator = v.object({
  id: v.string(),
  origin: v.string(),
  clUltimate: v.number(),
  bfUltimate: v.number(),
  divergence: v.number(),
  relativeDivergence: nullableNumber,
});

const residualElementValidator = v.object({
  id: v.string(),
  origin: v.string(),
  fromDev: v.string(),
  toDev: v.string(),
  residual: v.number(),
});

export const diagnosticsBundleValidator = v.object({
  schemaVersion: v.string(),
  runId: v.string(),
  triangleHash: v.string(),
  ldfStability: v.array(ldfStabilityElementValidator),
  ave: v.array(aveElementValidator),
  // Nullable array: `null` when CL and BF did not both run.
  clBfDivergence: v.union(v.array(clBfDivergenceElementValidator), v.null()),
  residuals: v.array(residualElementValidator),
});

// --- Triangle (the /validate + /runs request body) -----------------------

/**
 * Wire shape of the engine `Triangle`. Story 3.2 constructs this from an
 * uploaded CSV/XLSX (see `triangleParse.ts`) and POSTs it to `/validate`.
 *
 * ⚠️ Keys here are **snake_case** (`origin_periods`/`development_periods`) —
 * unlike ResultSet/DiagnosticsBundle above. The engine `Triangle` model
 * (`reserving_engine/triangle.py`) uses `ConfigDict(frozen=True)` with **no**
 * camelCase alias generator, so its JSON Schema — and therefore the wire
 * `/validate` accepts — is snake_case. The drift check (`engine-contract.test.ts`)
 * confirms this against the committed `triangle.schema.json`. The camelCase
 * inconsistency vs the rest of the contract is tracked in deferred-work.
 */
export const triangleValidator = v.object({
  kind: v.union(v.literal("paid"), v.literal("incurred")),
  origin_periods: v.array(v.string()),
  development_periods: v.array(v.string()),
  // A cell is a number or `null` (the unobserved future / a hole).
  cells: v.array(v.array(v.union(v.number(), v.null()))),
});

// --- ValidationReport (the /validate response) ---------------------------

/** The four cell-level finding codes — matches `validation.py` `FindingCode`. */
const findingCodeValidator = v.union(
  v.literal("shape"),
  v.literal("paid_monotonicity"),
  v.literal("missing_cell"),
  v.literal("degenerate_factor"),
);

const validationFindingValidator = v.object({
  origin: v.string(),
  dev: v.string(),
  reason: v.string(),
  code: findingCodeValidator,
});

export const validationReportValidator = v.object({
  valid: v.boolean(),
  findings: v.array(validationFindingValidator),
});

// --- CanonicalizeResponse (the /canonicalize response, Story 3.3) ---------

/**
 * The canonical-triangle-JSON sha256 — *the* Lineage Triangle hash (AD-11),
 * ENGINE-computed (`reserving_engine.triangle_hash`) and returned by
 * `POST /canonicalize`. camelCase `triangleHash`, matching `Lineage.triangleHash`.
 * A one-field wire model (an `engine_service` response, not a `reserving_engine`
 * core model), so it is validated Convex-side without a `schemas/*.json` entry —
 * there is no meaningful drift surface on `{ triangleHash: string }`.
 */
export const canonicalizeResponseValidator = v.object({
  triangleHash: v.string(),
});

// --- Inferred TS types (derived from the validators, drift-checked) ------

export type ResultSet = Infer<typeof resultSetValidator>;
export type DiagnosticsBundle = Infer<typeof diagnosticsBundleValidator>;
// Run parameters (camelCase wire shape — same as `Lineage.parameters`, and the
// `/runs` request `parameters` body). Story 4.1 stores a `RunParameters` on the
// `runs` row; Story 4.2 sends it to the engine verbatim. Not the snake_case
// `Triangle` shape — do not conflate.
export type Method = Infer<typeof methodValidator>;
export type AprioriLossRatio = Infer<typeof aprioriLossRatioValidator>;
export type RunParameters = Infer<typeof runParametersValidator>;
export type Triangle = Infer<typeof triangleValidator>;
export type ValidationReport = Infer<typeof validationReportValidator>;
export type ValidationFinding = Infer<typeof validationFindingValidator>;
export type CanonicalizeResponse = Infer<typeof canonicalizeResponseValidator>;
