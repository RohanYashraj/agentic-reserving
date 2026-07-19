/**
 * Link 2 of the AD-10 contract chain: committed JSON Schema ⇔ Convex
 * validators / TS types. Drift here fails CI.
 *
 * Runs in the vitest "unit" (node) project — `node:fs` reads the
 * committed `schemas/*.json`; the convex/edge-runtime project cannot.
 * Imports the pure extractors and the hand-authored validators (both
 * plain modules, no server context).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { v } from "convex/values";

import {
  diagnosticsBundleValidator,
  reDerivationReportValidator,
  recommendationsValidator,
  resultSetValidator,
  triangleValidator,
  validationReportValidator,
} from "../convex/lib/engineContract";
import {
  CanonicalType,
  diffCanonical,
  jsonSchemaToCanonical,
  validatorToCanonical,
} from "../convex/lib/schemaContract";

function readSchema(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(__dirname, "..", "schemas", file), "utf8"));
}

const resultSetSchema = readSchema("resultset.schema.json");
const diagnosticsBundleSchema = readSchema("diagnostics-bundle.schema.json");
const triangleSchema = readSchema("triangle.schema.json");
const validationReportSchema = readSchema("validation-report.schema.json");
const reDerivationReportSchema = readSchema("rederivation-report.schema.json");
const recommendationsSchema = readSchema("recommendations.schema.json");

describe("AD-10 cross-runtime drift check", () => {
  it("ResultSet: committed JSON Schema matches the Convex validator", () => {
    const fromSchema = jsonSchemaToCanonical(resultSetSchema, resultSetSchema);
    const fromValidator = validatorToCanonical(resultSetValidator);
    expect(diffCanonical(fromSchema, fromValidator)).toEqual([]);
  });

  it("DiagnosticsBundle: committed JSON Schema matches the Convex validator", () => {
    const fromSchema = jsonSchemaToCanonical(
      diagnosticsBundleSchema,
      diagnosticsBundleSchema,
    );
    const fromValidator = validatorToCanonical(diagnosticsBundleValidator);
    expect(diffCanonical(fromSchema, fromValidator)).toEqual([]);
  });

  it("Triangle: committed JSON Schema matches the Convex validator", () => {
    // Triangle's wire keys are snake_case (no camelCase alias generator on
    // the engine model); the validator matches that exactly.
    const fromSchema = jsonSchemaToCanonical(triangleSchema, triangleSchema);
    const fromValidator = validatorToCanonical(triangleValidator);
    expect(diffCanonical(fromSchema, fromValidator)).toEqual([]);
  });

  it("ValidationReport: committed JSON Schema matches the Convex validator", () => {
    const fromSchema = jsonSchemaToCanonical(
      validationReportSchema,
      validationReportSchema,
    );
    const fromValidator = validatorToCanonical(validationReportValidator);
    expect(diffCanonical(fromSchema, fromValidator)).toEqual([]);
  });

  it("ReDerivationReport: committed JSON Schema matches the Convex validator", () => {
    // Story 4.7: the /rederive response. `tier` is a string-literal union
    // (exact | epsilon) — canonicalizes to an enum on both sides.
    const fromSchema = jsonSchemaToCanonical(
      reDerivationReportSchema,
      reDerivationReportSchema,
    );
    const fromValidator = validatorToCanonical(reDerivationReportValidator);
    expect(diffCanonical(fromSchema, fromValidator)).toEqual([]);
  });

  it("Recommendations: committed JSON Schema matches the Convex validator", () => {
    // Story 5.3: the accepted /recommendations document persisted on the run
    // row. `method` is a string-literal union (the same three methods) —
    // canonicalizes to an enum on both sides.
    const fromSchema = jsonSchemaToCanonical(
      recommendationsSchema,
      recommendationsSchema,
    );
    const fromValidator = validatorToCanonical(recommendationsValidator);
    expect(diffCanonical(fromSchema, fromValidator)).toEqual([]);
  });
});

describe("the drift checker actually catches drift (deliberate mismatch)", () => {
  const good = jsonSchemaToCanonical(resultSetSchema, resultSetSchema);

  it("detects a dropped field", () => {
    // Clone and drop OriginResult.ibnr (methodResults[].originResults[].ibnr).
    const mutated = structuredClone(good) as CanonicalType;
    if (mutated.kind === "object") {
      const mr = mutated.fields.methodResults;
      if (mr.kind === "array" && mr.element.kind === "object") {
        const or = mr.element.fields.originResults;
        if (or.kind === "array" && or.element.kind === "object") {
          delete or.element.fields.ibnr;
        }
      }
    }
    const diffs = diffCanonical(good, mutated);
    expect(diffs.length).toBeGreaterThan(0);
    expect(diffs.join("\n")).toContain("ibnr");
  });

  it("detects a renamed top-level field", () => {
    const mutated = structuredClone(good) as CanonicalType;
    if (mutated.kind === "object") {
      mutated.fields.methods = mutated.fields.methodResults;
      delete mutated.fields.methodResults;
    }
    const diffs = diffCanonical(good, mutated);
    expect(diffs.join("\n")).toContain("methodResults");
  });

  it("detects a changed enum value set", () => {
    const mutated = structuredClone(good) as CanonicalType;
    if (mutated.kind === "object") {
      const mr = mutated.fields.methodResults;
      if (mr.kind === "array" && mr.element.kind === "object") {
        mr.element.fields.method = { kind: "enum", values: ["chain_ladder"] };
      }
    }
    const diffs = diffCanonical(good, mutated);
    expect(diffs.join("\n")).toContain("enum");
  });
});

describe("extractor axes (the diff engine must be trustworthy)", () => {
  it("nullable: anyOf[T,null] equals v.union(T, v.null())", () => {
    const fromSchema = jsonSchemaToCanonical(
      { anyOf: [{ type: "number" }, { type: "null" }] },
      {},
    );
    const fromValidator = validatorToCanonical(v.union(v.number(), v.null()));
    expect(fromSchema).toEqual({ kind: "nullable", inner: { kind: "number" } });
    expect(diffCanonical(fromSchema, fromValidator)).toEqual([]);
  });

  it("enum: JSON enum equals a literal union (order-insensitive)", () => {
    const fromSchema = jsonSchemaToCanonical({ enum: ["b", "a"], type: "string" }, {});
    const fromValidator = validatorToCanonical(v.union(v.literal("a"), v.literal("b")));
    expect(fromSchema).toEqual({ kind: "enum", values: ["a", "b"] });
    expect(diffCanonical(fromSchema, fromValidator)).toEqual([]);
  });

  it("array: items equal element", () => {
    const fromSchema = jsonSchemaToCanonical(
      { type: "array", items: { type: "string" } },
      {},
    );
    const fromValidator = validatorToCanonical(v.array(v.string()));
    expect(diffCanonical(fromSchema, fromValidator)).toEqual([]);
  });

  it("nested object via $ref resolves", () => {
    const root = {
      $defs: { Inner: { type: "object", properties: { x: { type: "number" } } } },
      type: "object",
      properties: { inner: { $ref: "#/$defs/Inner" } },
    };
    const canonical = jsonSchemaToCanonical(root, root);
    expect(canonical).toEqual({
      kind: "object",
      fields: { inner: { kind: "object", fields: { x: { kind: "number" } } } },
    });
  });

  it("integer coerces to number (Convex has no integer)", () => {
    expect(jsonSchemaToCanonical({ type: "integer" }, {})).toEqual({
      kind: "number",
    });
  });
});
