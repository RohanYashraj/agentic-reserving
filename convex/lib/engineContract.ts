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
const methodValidator = v.union(
  v.literal("chain_ladder"),
  v.literal("bornhuetter_ferguson"),
  v.literal("mack"),
);

/** A nullable float field — present on the wire, possibly `null`. */
const nullableNumber = v.union(v.number(), v.null());

// --- ResultSet shapes -----------------------------------------------------

const aprioriLossRatioValidator = v.object({
  origin: v.string(),
  lossRatio: v.number(),
  exposure: v.number(),
});

const runParametersValidator = v.object({
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

// --- Inferred TS types (derived from the validators, drift-checked) ------

export type ResultSet = Infer<typeof resultSetValidator>;
export type DiagnosticsBundle = Infer<typeof diagnosticsBundleValidator>;
