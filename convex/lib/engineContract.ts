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

// --- ReDerivationReport (the /rederive response, Story 4.7) ---------------

/**
 * One figure that did not reproduce on re-derivation (AD-11): where it is and
 * by how much. `delta` (`stored − rederived`) is engine-computed (AD-1) — Convex
 * and React carry it, they never subtract. Matches `Discrepancy` in
 * `reserving_engine/rederivation.py`.
 */
const discrepancyValidator = v.object({
  method: v.string(),
  field: v.string(),
  key: v.string(),
  stored: v.number(),
  rederived: v.number(),
  delta: v.number(),
});

/**
 * The outcome of replaying a stored ResultSet from its Lineage (FR-6). Wire
 * shape of the engine `/rederive` response — a full AD-10 drift-checked contract
 * (`schemas/rederivation-report.schema.json`). `triangleHashVerified` separates
 * the two failure modes (broken chain of custody vs altered figures); `tier`
 * records which AD-11 comparison ran (exact on the pinned platform, else 1e-8).
 */
export const reDerivationReportValidator = v.object({
  schemaVersion: v.string(),
  runId: v.string(),
  reproduced: v.boolean(),
  triangleHashVerified: v.boolean(),
  tier: v.union(v.literal("exact"), v.literal("epsilon")),
  discrepancies: v.array(discrepancyValidator),
});

// --- Recommendations (the accepted /recommendations document, Story 5.3) --

/**
 * One reason a Method was recommended, post-Provenance-Gate. `text` is the
 * RENDERED reason string (figures already rendered from `{{rs:...}}`
 * placeholders, citations rendered from `{{dx:...}}`); `citations` is the
 * resolved Diagnostic-ID list from the gate — the machine-readable pin the
 * 5.5 CitationChip renders (FR-10). Matches `RecommendationReason` in
 * `reserving_engine/recommendations.py`.
 */
const recommendationReasonValidator = v.object({
  text: v.string(),
  citations: v.array(v.string()),
});

/**
 * The recommended Method for one Origin Period, with ≥1 cited reason.
 * `method` reuses `methodValidator` (the same three literals as the Run's
 * methods — no separate enum). Matches `MethodRecommendation`.
 */
const methodRecommendationValidator = v.object({
  origin: v.string(),
  method: methodValidator,
  reasons: v.array(recommendationReasonValidator),
});

/**
 * The accepted recommendations document persisted on the `runs` row (FR-10,
 * AD-10) — the /recommendations response's `accepted` arm. THE schema gate:
 * `storeRecommendations`'s typed arg rejects a schema-invalid document at the
 * boundary, so it is never stored. Drift-checked in `tests/engine-contract.test.ts`
 * against `schemas/recommendations.schema.json`.
 */
export const recommendationsValidator = v.object({
  schemaVersion: v.string(),
  runId: v.string(),
  recommendations: v.array(methodRecommendationValidator),
});

// --- ReserveReport (the accepted /reports document, Story 5.4) ------------

/**
 * One section of the drafted Reserve Report, post-Provenance-Gate. `text` is
 * the RENDERED section prose (figures already rendered from `{{rs:...}}`
 * placeholders, citations from `{{dx:...}}`); `citations` is the resolved
 * Diagnostic-ID list from the gate — the machine-readable pin the Epic-6
 * CitationChip renders (FR-11). `citations` MAY be empty (a purely-qualitative
 * caveat with no figure). Matches `ReserveReportSection` in
 * `reserving_engine/reserve_report.py`.
 */
export const reserveReportSectionValidator = v.object({
  text: v.string(),
  citations: v.array(v.string()),
});

/**
 * The accepted Reserve Report document persisted in the `reserveReports` table
 * (FR-11, AD-10) — the /reports response's `accepted` arm. THE schema gate:
 * `storeReserveReport`'s typed arg rejects a schema-invalid document at the
 * boundary, so it is never stored. The four sections are NAMED fields (exactly
 * the four, all present, structural-by-construction). Drift-checked in
 * `tests/engine-contract.test.ts` against `schemas/reserve-report.schema.json`.
 */
export const reserveReportValidator = v.object({
  schemaVersion: v.string(),
  runId: v.string(),
  machineDrafted: v.boolean(),
  executiveSummary: reserveReportSectionValidator,
  methodSelectionRationale: reserveReportSectionValidator,
  movementCommentary: reserveReportSectionValidator,
  limitations: reserveReportSectionValidator,
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
export type Discrepancy = Infer<typeof discrepancyValidator>;
export type ReDerivationReport = Infer<typeof reDerivationReportValidator>;
// Run parameters (camelCase wire shape — same as `Lineage.parameters`, and the
// `/runs` request `parameters` body). Story 4.1 stores a `RunParameters` on the
// `runs` row; Story 4.2 sends it to the engine verbatim. Not the snake_case
// `Triangle` shape — do not conflate.
export type Method = Infer<typeof methodValidator>;
export type Recommendations = Infer<typeof recommendationsValidator>;
export type MethodRecommendation = Infer<typeof methodRecommendationValidator>;
export type RecommendationReason = Infer<typeof recommendationReasonValidator>;
export type ReserveReport = Infer<typeof reserveReportValidator>;
export type ReserveReportSection = Infer<typeof reserveReportSectionValidator>;
export type AprioriLossRatio = Infer<typeof aprioriLossRatioValidator>;
export type RunParameters = Infer<typeof runParametersValidator>;
export type Triangle = Infer<typeof triangleValidator>;
export type ValidationReport = Infer<typeof validationReportValidator>;
export type ValidationFinding = Infer<typeof validationFindingValidator>;
export type CanonicalizeResponse = Infer<typeof canonicalizeResponseValidator>;
