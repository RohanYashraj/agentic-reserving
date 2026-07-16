import { describe, expect, test } from "vitest";
import {
  GENESIS_PREV_HASH,
  canonicalJSON,
  computeEntryHash,
  type HashableAuditEntry,
} from "./auditChain";

describe("canonicalJSON", () => {
  test("object key order does not affect the output", () => {
    expect(canonicalJSON({ a: 1, b: 2 })).toBe(canonicalJSON({ b: 2, a: 1 }));
    expect(canonicalJSON({ a: 1, b: 2 })).toBe('{"a":1,"b":2}');
  });

  test("nested objects are sorted recursively; arrays keep their order", () => {
    expect(
      canonicalJSON({ z: { b: [2, 1], a: "x" }, a: [{ d: 4, c: 3 }] }),
    ).toBe('{"a":[{"c":3,"d":4}],"z":{"a":"x","b":[2,1]}}');
  });

  test("primitives serialize as JSON", () => {
    expect(canonicalJSON("str")).toBe('"str"');
    expect(canonicalJSON(42)).toBe("42");
    expect(canonicalJSON(true)).toBe("true");
    expect(canonicalJSON(null)).toBe("null");
  });

  test("throws on undefined — top-level and inside objects/arrays", () => {
    expect(() => canonicalJSON(undefined)).toThrow();
    expect(() => canonicalJSON({ a: undefined })).toThrow();
    expect(() => canonicalJSON([1, undefined])).toThrow();
  });

  test("throws on functions and other non-JSON values", () => {
    expect(() => canonicalJSON(() => 1)).toThrow();
    expect(() => canonicalJSON({ f: () => 1 })).toThrow();
    expect(() => canonicalJSON(Number.NaN)).toThrow();
    expect(() => canonicalJSON(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => canonicalJSON(BigInt(1))).toThrow();
    expect(() => canonicalJSON(Symbol("s"))).toThrow();
  });

  // Regression (code review 2026-07-16): these fell into the generic object
  // branch and silently serialized as "{}" via Object.keys — the exact
  // divergent-hash failure the fail-loud contract exists to prevent.
  test("throws on non-plain objects instead of flattening them to {}", () => {
    expect(() => canonicalJSON(new Date(0))).toThrow();
    expect(() => canonicalJSON(new Map([["a", 1]]))).toThrow();
    expect(() => canonicalJSON(new Set([1]))).toThrow();
    expect(() => canonicalJSON({ nested: new Date(0) })).toThrow();
    // Null-prototype objects are plain data — still fine.
    expect(canonicalJSON(Object.create(null))).toBe("{}");
  });

  test("deterministic across repeated calls", () => {
    const value = { nested: { deep: [1, "two", { three: 3 }] }, flag: false };
    expect(canonicalJSON(value)).toBe(canonicalJSON(value));
  });
});

describe("computeEntryHash", () => {
  const entry: HashableAuditEntry = {
    workspaceId: "org_A",
    actor: "user_123",
    eventType: "member.role_changed",
    timestamp: "2026-07-16T00:00:00.000Z",
    payload: { role: "org:senior_actuary" },
    seq: 0,
  };

  test("returns lowercase hex sha256", async () => {
    const hash = await computeEntryHash(entry, GENESIS_PREV_HASH);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("prevHash participates in the hash", async () => {
    const genesis = await computeEntryHash(entry, GENESIS_PREV_HASH);
    const chained = await computeEntryHash(entry, genesis);
    expect(chained).not.toBe(genesis);
  });

  test("key order of the entry projection does not matter", async () => {
    const reordered = {
      seq: 0,
      payload: { role: "org:senior_actuary" },
      timestamp: "2026-07-16T00:00:00.000Z",
      eventType: "member.role_changed",
      actor: "user_123",
      workspaceId: "org_A",
    } as HashableAuditEntry;
    expect(await computeEntryHash(reordered, GENESIS_PREV_HASH)).toBe(
      await computeEntryHash(entry, GENESIS_PREV_HASH),
    );
  });

  // Pinned known-answer vector: freezes the canonicalization + hashing
  // contract. If this test breaks, the chain format changed — existing
  // per-Workspace chains would no longer verify. That is NEVER acceptable
  // silently; see convex/lib/auditChain.ts module docs (AD-6).
  test("known-answer vector is pinned", async () => {
    expect(canonicalJSON(entry)).toBe(
      '{"actor":"user_123","eventType":"member.role_changed",' +
        '"payload":{"role":"org:senior_actuary"},"seq":0,' +
        '"timestamp":"2026-07-16T00:00:00.000Z","workspaceId":"org_A"}',
    );
    expect(await computeEntryHash(entry, GENESIS_PREV_HASH)).toBe(
      "60ba5352e40d6f133af193d2fc67a44f698e38d655ab2031881fa233512f8cdc",
    );
  });
});

describe("GENESIS_PREV_HASH", () => {
  test("is the empty string (first entry of a Workspace chains from it)", () => {
    expect(GENESIS_PREV_HASH).toBe("");
  });
});
