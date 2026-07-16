/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import { ConvexError } from "convex/values";
import { api, internal } from "./_generated/api";
import { appendAuditEntry, appendAuditEntryArgs } from "./auditLogs";
import {
  GENESIS_PREV_HASH,
  computeEntryHash,
  toHashableEntry,
} from "./lib/auditChain";
import schema from "./schema";

const modules = import.meta.glob([
  "./**/*.ts",
  "!./**/*.test.ts",
  "./_generated/**/*.js",
]);

function baseArgs(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: "org_A",
    actor: "user_123",
    eventType: "member.role_changed",
    payload: { role: "org:senior_actuary" },
    ...overrides,
  };
}

describe("appendAuditEntry (AD-6 single writer)", () => {
  test("first entry: seq 0, prevHash is the genesis constant, hash verifies", async () => {
    const t = convexTest(schema, modules);
    const result = await t.mutation(
      internal.auditLogs.appendAuditEntry,
      baseArgs(),
    );
    expect(result.seq).toBe(0);
    expect(result.hash).toMatch(/^[0-9a-f]{64}$/);

    const rows = await t.run((ctx) => ctx.db.query("auditLogs").collect());
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.seq).toBe(0);
    expect(row.prevHash).toBe(GENESIS_PREV_HASH);
    expect(row.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    const recomputed = await computeEntryHash(
      toHashableEntry(row),
      row.prevHash,
    );
    expect(row.hash).toBe(recomputed);
  });

  test("second entry chains: prevHash === first.hash, seq 1", async () => {
    const t = convexTest(schema, modules);
    const first = await t.mutation(
      internal.auditLogs.appendAuditEntry,
      baseArgs(),
    );
    const second = await t.mutation(
      internal.auditLogs.appendAuditEntry,
      baseArgs({ eventType: "member.added" }),
    );
    expect(second.seq).toBe(1);
    const rows = await t.run((ctx) =>
      ctx.db
        .query("auditLogs")
        .withIndex("by_workspace_seq", (q) => q.eq("workspaceId", "org_A"))
        .order("asc")
        .collect(),
    );
    expect(rows[1].prevHash).toBe(first.hash);
  });

  test("chains are per-Workspace independent: each starts at seq 0 from genesis", async () => {
    const t = convexTest(schema, modules);
    const a = await t.mutation(
      internal.auditLogs.appendAuditEntry,
      baseArgs({ workspaceId: "org_A" }),
    );
    const b = await t.mutation(
      internal.auditLogs.appendAuditEntry,
      baseArgs({ workspaceId: "org_B" }),
    );
    expect(a.seq).toBe(0);
    expect(b.seq).toBe(0);
    const rows = await t.run((ctx) => ctx.db.query("auditLogs").collect());
    expect(rows.every((row) => row.prevHash === GENESIS_PREV_HASH)).toBe(true);
  });

  test("runId is stored when given, absent otherwise", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(
      internal.auditLogs.appendAuditEntry,
      baseArgs({ runId: "run_1" }),
    );
    await t.mutation(internal.auditLogs.appendAuditEntry, baseArgs());
    const rows = await t.run((ctx) =>
      ctx.db
        .query("auditLogs")
        .withIndex("by_workspace_seq", (q) => q.eq("workspaceId", "org_A"))
        .order("asc")
        .collect(),
    );
    expect(rows[0].runId).toBe("run_1");
    expect(rows[1].runId).toBeUndefined();
  });

  test("same dedupeId twice → one row, identical return (idempotent replay)", async () => {
    const t = convexTest(schema, modules);
    const first = await t.mutation(
      internal.auditLogs.appendAuditEntry,
      baseArgs({ dedupeId: "msg_1" }),
    );
    const replay = await t.mutation(
      internal.auditLogs.appendAuditEntry,
      baseArgs({ dedupeId: "msg_1" }),
    );
    expect(replay).toEqual(first);
    const rows = await t.run((ctx) => ctx.db.query("auditLogs").collect());
    expect(rows).toHaveLength(1);
  });

  // Code review 2026-07-16: a replay is expected to be byte-identical. A
  // divergent replay still returns the original entry (the chain is
  // immutable) but must be flagged, not silently swallowed.
  test("same dedupeId with divergent content → original kept, warning logged", async () => {
    const t = convexTest(schema, modules);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const first = await t.mutation(
        internal.auditLogs.appendAuditEntry,
        baseArgs({ dedupeId: "msg_1" }),
      );
      const divergent = await t.mutation(
        internal.auditLogs.appendAuditEntry,
        baseArgs({ dedupeId: "msg_1", payload: { role: "org:analyst" } }),
      );
      expect(divergent).toEqual(first);
      const rows = await t.run((ctx) => ctx.db.query("auditLogs").collect());
      expect(rows).toHaveLength(1);
      expect(rows[0].payload).toEqual({ role: "org:senior_actuary" });
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("divergent content"),
      );
    } finally {
      warn.mockRestore();
    }
  });

  // AC 2 caveat: convex-test is a local mock, not the production OCC
  // scheduler. This test asserts the INVARIANT (contiguous seq, intact
  // chain) under the mock's interleaving, not the distributed retry
  // mechanism itself — that is Convex's documented mutation semantics
  // (serializable transactions, automatic retry on conflict), exercised
  // for real in the Task 8.2 live check.
  test("10 parallel appends to one Workspace → seq exactly 0..9, chain intact", async () => {
    const t = convexTest(schema, modules);
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        t.mutation(
          internal.auditLogs.appendAuditEntry,
          baseArgs({ payload: { i } }),
        ),
      ),
    );
    const rows = await t.run((ctx) =>
      ctx.db
        .query("auditLogs")
        .withIndex("by_workspace_seq", (q) => q.eq("workspaceId", "org_A"))
        .order("asc")
        .collect(),
    );
    expect(rows.map((row) => row.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    let prevHash = GENESIS_PREV_HASH;
    for (const row of rows) {
      expect(row.prevHash).toBe(prevHash);
      const recomputed = await computeEntryHash(
        toHashableEntry(row),
        row.prevHash,
      );
      expect(row.hash).toBe(recomputed);
      prevHash = row.hash;
    }
  });

  test("appendAuditEntry is internal, never public", () => {
    const markers = appendAuditEntry as unknown as {
      isInternal?: boolean;
      isPublic?: boolean;
      isMutation?: boolean;
    };
    expect(markers.isInternal).toBe(true);
    expect(markers.isPublic).toBeUndefined();
    expect(markers.isMutation).toBe(true);
  });

  test("args validator shape is pinned (recordEventArgs contract + dedupeId)", () => {
    const shape = Object.fromEntries(
      Object.entries(appendAuditEntryArgs).map(([key, validator]) => [
        key,
        { kind: validator.kind, isOptional: validator.isOptional },
      ]),
    );
    expect(shape).toEqual({
      workspaceId: { kind: "string", isOptional: "required" },
      actor: { kind: "string", isOptional: "required" },
      eventType: { kind: "string", isOptional: "required" },
      payload: { kind: "any", isOptional: "required" },
      runId: { kind: "string", isOptional: "optional" },
      dedupeId: { kind: "string", isOptional: "optional" },
    });
  });
});

describe("verifyChain (AC 4)", () => {
  const memberA = {
    subject: "user_a",
    org_id: "org_A",
    org_role: "org:analyst",
  };

  async function seedChain(t: ReturnType<typeof convexTest>, count: number) {
    for (let i = 0; i < count; i++) {
      await t.mutation(
        internal.auditLogs.appendAuditEntry,
        baseArgs({ payload: { i } }),
      );
    }
  }

  test("unauthenticated call rejects (AD-4)", async () => {
    const t = convexTest(schema, modules);
    let caught: unknown;
    try {
      await t.query(api.auditLogs.verifyChain, { workspaceId: "org_A" });
      expect.unreachable("verifyChain accepted an unauthenticated call");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConvexError);
    expect((caught as ConvexError<{ code: string }>).data.code).toBe(
      "UNAUTHENTICATED",
    );
  });

  test("member of org_A verifying org_B → FORBIDDEN", async () => {
    const t = convexTest(schema, modules);
    let caught: unknown;
    try {
      await t
        .withIdentity(memberA)
        .query(api.auditLogs.verifyChain, { workspaceId: "org_B" });
      expect.unreachable("verifyChain allowed cross-Workspace verification");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConvexError);
    expect((caught as ConvexError<{ code: string }>).data.code).toBe(
      "FORBIDDEN",
    );
  });

  test("empty chain is valid with length 0", async () => {
    const t = convexTest(schema, modules);
    const result = await t
      .withIdentity(memberA)
      .query(api.auditLogs.verifyChain, { workspaceId: "org_A" });
    expect(result).toEqual({ valid: true, length: 0 });
  });

  test("intact multi-entry chain → valid", async () => {
    const t = convexTest(schema, modules);
    await seedChain(t, 4);
    const result = await t
      .withIdentity(memberA)
      .query(api.auditLogs.verifyChain, { workspaceId: "org_A" });
    expect(result).toEqual({ valid: true, length: 4 });
  });

  // Tamper fixtures mutate rows via t.run — the test harness's raw db
  // handle, NOT an app code path. The single-writer rule stands.
  test("tampered payload → broken at that entry (hash mismatch)", async () => {
    const t = convexTest(schema, modules);
    await seedChain(t, 4);
    await t.run(async (ctx) => {
      const rows = await ctx.db.query("auditLogs").collect();
      const target = rows.find((row) => row.seq === 2);
      if (target === undefined) throw new Error("fixture: seq 2 missing");
      await ctx.db.patch(target._id, { payload: { i: 999 } });
    });
    const result = await t
      .withIdentity(memberA)
      .query(api.auditLogs.verifyChain, { workspaceId: "org_A" });
    expect(result).toEqual({
      valid: false,
      brokenAtSeq: 2,
      reason: "hash_mismatch",
    });
  });

  test("tampered hash → detected at that entry or the successor linkage", async () => {
    const t = convexTest(schema, modules);
    await seedChain(t, 4);
    await t.run(async (ctx) => {
      const rows = await ctx.db.query("auditLogs").collect();
      const target = rows.find((row) => row.seq === 1);
      if (target === undefined) throw new Error("fixture: seq 1 missing");
      await ctx.db.patch(target._id, { hash: "0".repeat(64) });
    });
    const result = await t
      .withIdentity(memberA)
      .query(api.auditLogs.verifyChain, { workspaceId: "org_A" });
    expect(result.valid).toBe(false);
    if (result.valid === false) {
      expect([1, 2]).toContain(result.brokenAtSeq);
      expect(["hash_mismatch", "prev_hash_mismatch"]).toContain(result.reason);
    }
  });

  test("deleted middle row → seq gap detected", async () => {
    const t = convexTest(schema, modules);
    await seedChain(t, 4);
    await t.run(async (ctx) => {
      const rows = await ctx.db.query("auditLogs").collect();
      const target = rows.find((row) => row.seq === 1);
      if (target === undefined) throw new Error("fixture: seq 1 missing");
      await ctx.db.delete(target._id);
    });
    const result = await t
      .withIdentity(memberA)
      .query(api.auditLogs.verifyChain, { workspaceId: "org_A" });
    expect(result).toEqual({
      valid: false,
      brokenAtSeq: 2,
      reason: "seq_gap",
    });
  });

  test("tampering in org_B does not invalidate org_A's chain (per-Workspace)", async () => {
    const t = convexTest(schema, modules);
    await seedChain(t, 2);
    await t.mutation(
      internal.auditLogs.appendAuditEntry,
      baseArgs({ workspaceId: "org_B" }),
    );
    await t.run(async (ctx) => {
      const rows = await ctx.db.query("auditLogs").collect();
      const target = rows.find((row) => row.workspaceId === "org_B");
      if (target === undefined) throw new Error("fixture: org_B row missing");
      await ctx.db.patch(target._id, { payload: { tampered: true } });
    });
    const result = await t
      .withIdentity(memberA)
      .query(api.auditLogs.verifyChain, { workspaceId: "org_A" });
    expect(result).toEqual({ valid: true, length: 2 });
  });
});
