/// <reference types="vite/client" />
import { register as registerWorkflow } from "@convex-dev/workflow/test";
import { convexTest, type TestConvex } from "convex-test";
import { ConvexError } from "convex/values";
import type { GenericSchema, SchemaDefinition } from "convex/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

// Story 5.6 (AD-9, D2/D4): the workspace-global Engine-Only Mode state.
// transitionEngineOnlyMode is edge-triggered + idempotent (writes + audits ONLY
// on a real flip); getInterpretationMode is the reactive read (requireMember
// first); probeInterpretationMode is the recovery path (health probe → derive).

const modules = import.meta.glob([
  "./**/*.ts",
  "!./**/*.test.ts",
  "!./convex.config.ts",
  "./_generated/**/*.js",
]);

type Harness = TestConvex<SchemaDefinition<GenericSchema, boolean>>;

function initConvexTest(): Harness {
  const t = convexTest(schema, modules);
  registerWorkflow(t);
  return t;
}

const analystA = { subject: "user_a", org_id: "org_A", org_role: "org:analyst" };
const analystB = { subject: "user_b", org_id: "org_B", org_role: "org:analyst" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function auditRows(t: Harness) {
  return await t.run((ctx) => ctx.db.query("auditLogs").collect());
}
async function modeRow(t: Harness, workspaceId = "org_A") {
  const rows = await t.run((ctx) =>
    ctx.db.query("interpretationModes").collect(),
  );
  return rows.find((r) => r.workspaceId === workspaceId) ?? null;
}

describe("transitionEngineOnlyMode — edge-triggered + idempotent (D4)", () => {
  test("false→true upserts the row and audits mode.engineOnlyEntered once", async () => {
    const t = initConvexTest();
    const res = await t.mutation(internal.interpretationMode.transitionEngineOnlyMode, {
      workspaceId: "org_A",
      engineOnly: true,
      actor: "user_a",
      reason: "model_unavailable",
    });
    expect(res).toEqual({ changed: true });

    const row = await modeRow(t);
    expect(row?.engineOnly).toBe(true);
    expect(row?.reason).toBe("model_unavailable");

    const entered = (await auditRows(t)).filter(
      (a) => a.eventType === "mode.engineOnlyEntered",
    );
    expect(entered).toHaveLength(1);
    expect(entered[0].payload).toMatchObject({ reason: "model_unavailable" });
  });

  test("true→true is a no-op: changed:false, NO duplicate audit", async () => {
    const t = initConvexTest();
    await t.mutation(internal.interpretationMode.transitionEngineOnlyMode, {
      workspaceId: "org_A",
      engineOnly: true,
      actor: "user_a",
      reason: "model_unavailable",
    });
    const res = await t.mutation(internal.interpretationMode.transitionEngineOnlyMode, {
      workspaceId: "org_A",
      engineOnly: true,
      actor: "user_a",
      reason: "model_unavailable",
    });
    expect(res).toEqual({ changed: false });
    expect(
      (await auditRows(t)).filter((a) => a.eventType === "mode.engineOnlyEntered"),
    ).toHaveLength(1);
  });

  test("true→false audits mode.engineOnlyExited and clears the flag", async () => {
    const t = initConvexTest();
    await t.mutation(internal.interpretationMode.transitionEngineOnlyMode, {
      workspaceId: "org_A",
      engineOnly: true,
      actor: "user_a",
      reason: "model_unavailable",
    });
    const res = await t.mutation(internal.interpretationMode.transitionEngineOnlyMode, {
      workspaceId: "org_A",
      engineOnly: false,
      actor: "user_a",
    });
    expect(res).toEqual({ changed: true });
    expect((await modeRow(t))?.engineOnly).toBe(false);
    expect(
      (await auditRows(t)).filter((a) => a.eventType === "mode.engineOnlyExited"),
    ).toHaveLength(1);
  });

  test("false→false on a fresh workspace is a no-op (no row, no audit)", async () => {
    const t = initConvexTest();
    const res = await t.mutation(internal.interpretationMode.transitionEngineOnlyMode, {
      workspaceId: "org_A",
      engineOnly: false,
      actor: "user_a",
    });
    expect(res).toEqual({ changed: false });
    expect(await modeRow(t)).toBeNull();
    expect(await auditRows(t)).toHaveLength(0);
  });
});

describe("getInterpretationMode — reactive read (AD-4)", () => {
  test("returns the honest default for a workspace that never entered the mode", async () => {
    const t = initConvexTest();
    const got = await t
      .withIdentity(analystA)
      .query(api.interpretationMode.getInterpretationMode, { workspaceId: "org_A" });
    expect(got).toEqual({ engineOnly: false, since: null, reason: null });
  });

  test("returns the projected row once the mode is entered", async () => {
    const t = initConvexTest();
    await t.mutation(internal.interpretationMode.transitionEngineOnlyMode, {
      workspaceId: "org_A",
      engineOnly: true,
      actor: "user_a",
      reason: "model_unavailable",
    });
    const got = await t
      .withIdentity(analystA)
      .query(api.interpretationMode.getInterpretationMode, { workspaceId: "org_A" });
    expect(got.engineOnly).toBe(true);
    expect(got.reason).toBe("model_unavailable");
    expect(typeof got.since).toBe("number");
  });

  test("rejects unauthenticated (requireMember first)", async () => {
    const t = initConvexTest();
    let code: string | undefined;
    try {
      await t.query(api.interpretationMode.getInterpretationMode, { workspaceId: "org_A" });
    } catch (error) {
      code = (error as ConvexError<{ code: string }>).data.code;
    }
    expect(code).toBe("UNAUTHENTICATED");
  });

  test("rejects a cross-tenant member (FORBIDDEN)", async () => {
    const t = initConvexTest();
    let code: string | undefined;
    try {
      await t
        .withIdentity(analystB)
        .query(api.interpretationMode.getInterpretationMode, { workspaceId: "org_A" });
    } catch (error) {
      code = (error as ConvexError<{ code: string }>).data.code;
    }
    expect(code).toBe("FORBIDDEN");
  });
});

describe("probeInterpretationMode — recovery via health probe (D3)", () => {
  beforeEach(() => {
    vi.stubEnv("ENGINE_SERVICE_URL", "http://engine.test");
    vi.stubEnv("ENGINE_SERVICE_SECRET", "test-secret");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  test("200 ok → clears the mode (exit audit) and returns engineOnly:false", async () => {
    const t = initConvexTest();
    // Start in Engine-Only Mode.
    await t.mutation(internal.interpretationMode.transitionEngineOnlyMode, {
      workspaceId: "org_A",
      engineOnly: true,
      actor: "user_a",
      reason: "model_unavailable",
    });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const out = await t
      .withIdentity(analystA)
      .action(api.interpretationMode.probeInterpretationMode, { workspaceId: "org_A" });

    expect(out).toEqual({ engineOnly: false });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://engine.test/interpretation/health");
    expect((init as RequestInit).method).toBe("GET");
    expect((await modeRow(t))?.engineOnly).toBe(false);
    expect(
      (await auditRows(t)).filter((a) => a.eventType === "mode.engineOnlyExited"),
    ).toHaveLength(1);
  });

  test("model_unavailable → (re-)enters the mode and returns engineOnly:true", async () => {
    const t = initConvexTest();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ code: "model_unavailable", message: "not configured" }, 503),
      ),
    );

    const out = await t
      .withIdentity(analystA)
      .action(api.interpretationMode.probeInterpretationMode, { workspaceId: "org_A" });

    expect(out).toEqual({ engineOnly: true });
    expect((await modeRow(t))?.engineOnly).toBe(true);
    expect(
      (await auditRows(t)).filter((a) => a.eventType === "mode.engineOnlyEntered"),
    ).toHaveLength(1);
  });

  test("a transient engine error re-throws and leaves the mode untouched", async () => {
    const t = initConvexTest();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    let threw = false;
    try {
      await t
        .withIdentity(analystA)
        .action(api.interpretationMode.probeInterpretationMode, { workspaceId: "org_A" });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    expect(await modeRow(t)).toBeNull(); // no transition recorded
  });

  test("unauthenticated is rejected before the engine call (AD-4)", async () => {
    const t = initConvexTest();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    let code: string | undefined;
    try {
      await t.action(api.interpretationMode.probeInterpretationMode, {
        workspaceId: "org_A",
      });
    } catch (error) {
      code = (error as ConvexError<{ code: string }>).data.code;
    }
    expect(code).toBe("UNAUTHENTICATED");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
