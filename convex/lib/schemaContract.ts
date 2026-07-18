/**
 * AD-10 drift-check vocabulary: normalize a Pydantic-exported JSON Schema
 * and a Convex validator into one `CanonicalType`, then deep-diff them.
 *
 * The two runtimes serialize the same shape differently (JSON Schema vs
 * Convex validator `.json`), so drift can only be compared after both are
 * reduced to a common structural form. This module is PURE and
 * server-free: it imports nothing from `convex/_generated` or
 * `convex/server`, does no I/O, and is safe to import into a plain Node
 * test. The test reads the committed `schemas/*.json` and the validators
 * and feeds them here.
 *
 * Contract axes (decision #3): the declared key set, the type, nullability
 * (`anyOf:[T,null]` ⇔ `v.union(T, v.null())`), and enum value sets. NOT
 * optional/required — `engine_service` dumps every field (no
 * `exclude_none`), so every declared key is always present on the wire;
 * both extractors therefore ignore JSON-Schema `required` and Convex
 * `optional`.
 */

import type { GenericValidator } from "convex/values";

export type CanonicalType =
  | { kind: "object"; fields: Record<string, CanonicalType> }
  | { kind: "array"; element: CanonicalType }
  | { kind: "enum"; values: string[] }
  | { kind: "nullable"; inner: CanonicalType }
  | { kind: "string" }
  | { kind: "number" }
  | { kind: "boolean" }
  | { kind: "null" };

type JsonNode = Record<string, unknown>;

const SCALAR_JSON_TYPES: Record<string, CanonicalType["kind"]> = {
  string: "string",
  number: "number",
  integer: "number", // Convex has no integer; numbers unify.
  boolean: "boolean",
  null: "null",
};

// --- JSON Schema (Pydantic, by_alias=True) -------------------------------

/** Resolve a `#/$defs/Name` ref against the root schema. */
function resolveRef(node: JsonNode, root: JsonNode): JsonNode {
  const ref = node.$ref;
  if (typeof ref !== "string") return node;
  const name = ref.replace("#/$defs/", "");
  const defs = root.$defs as Record<string, JsonNode> | undefined;
  const target = defs?.[name];
  if (target === undefined) {
    throw new Error(`unresolved $ref: ${ref}`);
  }
  return target;
}

export function jsonSchemaToCanonical(node: JsonNode, root: JsonNode): CanonicalType {
  const schema = resolveRef(node, root);

  // Nullable-typed unions: anyOf with a {type:"null"} branch.
  const anyOf = schema.anyOf;
  if (Array.isArray(anyOf)) {
    const branches = anyOf as JsonNode[];
    const nonNull = branches.filter((m) => m.type !== "null");
    const hasNull = branches.some((m) => m.type === "null");
    if (hasNull && nonNull.length === 1) {
      return { kind: "nullable", inner: jsonSchemaToCanonical(nonNull[0], root) };
    }
    throw new Error(`unsupported anyOf: ${JSON.stringify(schema.anyOf)}`);
  }

  const enumValues = schema.enum;
  if (Array.isArray(enumValues)) {
    return { kind: "enum", values: enumValues.map(String).sort() };
  }

  if (schema.type === "object") {
    const props = (schema.properties ?? {}) as Record<string, JsonNode>;
    const fields: Record<string, CanonicalType> = {};
    for (const [key, prop] of Object.entries(props)) {
      fields[key] = jsonSchemaToCanonical(prop, root);
    }
    return { kind: "object", fields };
  }

  if (schema.type === "array") {
    return {
      kind: "array",
      element: jsonSchemaToCanonical(schema.items as JsonNode, root),
    };
  }

  const scalar = typeof schema.type === "string" ? SCALAR_JSON_TYPES[schema.type] : undefined;
  if (scalar) return { kind: scalar } as CanonicalType;

  throw new Error(`unsupported JSON Schema node: ${JSON.stringify(schema)}`);
}

// --- Convex validator `.json` --------------------------------------------

const SCALAR_CONVEX_TYPES: Record<string, CanonicalType["kind"]> = {
  string: "string",
  number: "number",
  int64: "number",
  boolean: "boolean",
  null: "null",
};

export function convexValidatorToCanonical(node: JsonNode): CanonicalType {
  if (node.type === "object") {
    const value = (node.value ?? {}) as Record<string, { fieldType: JsonNode }>;
    const fields: Record<string, CanonicalType> = {};
    for (const [key, field] of Object.entries(value)) {
      fields[key] = convexValidatorToCanonical(field.fieldType);
    }
    return { kind: "object", fields };
  }

  if (node.type === "array") {
    return { kind: "array", element: convexValidatorToCanonical(node.value as JsonNode) };
  }

  if (node.type === "literal") {
    return { kind: "enum", values: [String(node.value)] };
  }

  if (node.type === "union") {
    const members = (node.value ?? []) as JsonNode[];
    const nonNull = members.filter((m) => m.type !== "null");
    const hasNull = members.some((m) => m.type === "null");
    if (hasNull) {
      if (nonNull.length !== 1) {
        throw new Error(
          `unsupported nullable union with ${nonNull.length} non-null branches`,
        );
      }
      return { kind: "nullable", inner: convexValidatorToCanonical(nonNull[0]) };
    }
    // All-literal union → enum (e.g. the method literals).
    if (nonNull.every((m) => m.type === "literal")) {
      return { kind: "enum", values: nonNull.map((m) => String(m.value)).sort() };
    }
    throw new Error("unsupported union: not nullable and not all-literal");
  }

  const scalar = typeof node.type === "string" ? SCALAR_CONVEX_TYPES[node.type] : undefined;
  if (scalar) return { kind: scalar } as CanonicalType;

  throw new Error(`unsupported Convex validator node: ${JSON.stringify(node)}`);
}

/**
 * Canonicalize a Convex validator via its runtime `.json` form. The `.json`
 * getter exists at runtime but is absent from the public validator type, so
 * the cast is isolated here rather than sprinkled through call sites.
 */
export function validatorToCanonical(validator: GenericValidator): CanonicalType {
  return convexValidatorToCanonical((validator as unknown as { json: JsonNode }).json);
}

// --- Structural diff ------------------------------------------------------

/**
 * Return path-annotated mismatch descriptions between two canonical shapes.
 * Empty array means the shapes are identical (no drift). A non-empty result
 * is what fails the CI drift check and what the deliberate-mismatch test
 * asserts on.
 */
export function diffCanonical(a: CanonicalType, b: CanonicalType, path = "$"): string[] {
  if (a.kind !== b.kind) {
    return [`${path}: kind ${a.kind} != ${b.kind}`];
  }

  if (a.kind === "object" && b.kind === "object") {
    const diffs: string[] = [];
    const keys = new Set([...Object.keys(a.fields), ...Object.keys(b.fields)]);
    for (const key of [...keys].sort()) {
      const childPath = `${path}.${key}`;
      const av = a.fields[key];
      const bv = b.fields[key];
      if (av === undefined) {
        diffs.push(`${childPath}: missing on left`);
      } else if (bv === undefined) {
        diffs.push(`${childPath}: missing on right`);
      } else {
        diffs.push(...diffCanonical(av, bv, childPath));
      }
    }
    return diffs;
  }

  if (a.kind === "array" && b.kind === "array") {
    return diffCanonical(a.element, b.element, `${path}[]`);
  }

  if (a.kind === "nullable" && b.kind === "nullable") {
    return diffCanonical(a.inner, b.inner, `${path}?`);
  }

  if (a.kind === "enum" && b.kind === "enum") {
    const av = a.values.join(",");
    const bv = b.values.join(",");
    return av === bv ? [] : [`${path}: enum [${av}] != [${bv}]`];
  }

  // Matching scalar kinds.
  return [];
}
