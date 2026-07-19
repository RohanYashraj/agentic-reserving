/// <reference types="vite/client" />
import { register as registerWorkflow } from "@convex-dev/workflow/test";
import type { WorkflowId } from "@convex-dev/workflow";
import { convexTest, type TestConvex } from "convex-test";
import { ConvexError } from "convex/values";
import type { GenericSchema, SchemaDefinition } from "convex/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

// Story 4.1 — createRun (FR-4, AD-7, AD-6, AD-4): job record + atomic
// run.created audit, no fetch. Story 4.2 — durable orchestration (AD-7, AD-10,
// NFR-4): createRun now kicks off runWorkflow, and the step functions
// (markRunning / executeEngineRun / storeResultSet / markRunFailed /
// onRunComplete) drive the queued run through /runs. The orchestration is
// tested by invoking those internal functions directly (they carry all the
// logic) — robust without depending on the workpool scheduler simulation.

const modules = import.meta.glob([
  "./**/*.ts",
  "!./**/*.test.ts",
  "!./convex.config.ts",
  "./_generated/**/*.js",
]);

type Harness = TestConvex<SchemaDefinition<GenericSchema, boolean>>;

/**
 * A convex-test instance with the @convex-dev/workflow component registered
 * (Story 4.2 — createRun calls workflow.start, which resolves components.workflow
 * at runtime). The register helper wires both the workflow component and its
 * workpool sub-component.
 */
function initConvexTest(): Harness {
  const t = convexTest(schema, modules);
  registerWorkflow(t);
  return t;
}

const analystA = { subject: "user_a", org_id: "org_A", org_role: "org:analyst" };
const analystB = { subject: "user_b", org_id: "org_B", org_role: "org:analyst" };

const ACCEPTED_TRIANGLE = {
  kind: "paid" as const,
  origin_periods: ["2019", "2020", "2021"],
  development_periods: ["12", "24", "36"],
  cells: [
    [100, 150, 175],
    [120, 180, null],
    [130, null, null],
  ],
};
const TRIANGLE_HASH = "a".repeat(64);

/** Seed an accepted (validated) Triangle row directly (no engine round-trip). */
async function seedValidatedTriangle(
  t: Harness,
  workspaceId = "org_A",
): Promise<Id<"triangles">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("triangles", {
      workspaceId,
      label: "paid",
      status: "validated",
      format: "csv",
      storageId: await ctx.storage.store(new Blob(["seed"])),
      rawFileHash: "rawhash",
      filename: "triangle.csv",
      uploadedBy: "user_seed",
      uploadedAt: "2026-07-18T00:00:00.000Z",
      triangleHash: TRIANGLE_HASH,
      acceptedTriangle: ACCEPTED_TRIANGLE,
      periodMeta: { originGranularity: "annual", developmentInterval: "months" },
      acceptedBy: "user_seed",
      acceptedAt: "2026-07-18T01:00:00.000Z",
    }),
  );
}

/** Seed a non-accepted Triangle row with the given status. */
async function seedTriangleWithStatus(
  t: Harness,
  status: "pending_validation" | "validation_failed",
): Promise<Id<"triangles">> {
  return await t.run(async (ctx) =>
    ctx.db.insert("triangles", {
      workspaceId: "org_A",
      label: "paid",
      status,
      format: "csv",
      storageId: await ctx.storage.store(new Blob(["seed"])),
      rawFileHash: "rawhash",
      filename: "triangle.csv",
      uploadedBy: "user_seed",
      uploadedAt: "2026-07-18T00:00:00.000Z",
    }),
  );
}

async function runRows(t: Harness) {
  return await t.run((ctx) => ctx.db.query("runs").collect());
}
async function auditRows(t: Harness) {
  return await t.run((ctx) => ctx.db.query("auditLogs").collect());
}

const fullAprioris = ACCEPTED_TRIANGLE.origin_periods.map((origin) => ({
  origin,
  lossRatio: 0.9,
  exposure: 5_000_000,
}));

// onRunComplete's workflowId arg is the branded WorkflowId (vWorkflowId); the
// value is irrelevant to the handler (it keys on `result`/`context`), so a
// cast placeholder suffices in tests.
const TEST_WORKFLOW_ID = "wf_test" as unknown as WorkflowId;

describe("createRun — happy paths (AC2, AC4)", () => {
  test("CL-only → one queued run + one run.created audit (atomic)", async () => {
    const t = initConvexTest();
    const triangleId = await seedValidatedTriangle(t);

    const result = await t
      .withIdentity(analystA)
      .mutation(api.runs.createRun, {
        workspaceId: "org_A",
        triangleId,
        parameters: { methods: ["chain_ladder"], aprioriLossRatios: [] },
      });

    expect(result.status).toBe("queued");

    const runs = await runRows(t);
    expect(runs).toHaveLength(1);
    const run = runs[0];
    expect(run.status).toBe("queued");
    expect(run.triangleId).toBe(triangleId);
    expect(run.triangleHash).toBe(TRIANGLE_HASH);
    expect(run.parameters).toEqual({
      methods: ["chain_ladder"],
      aprioriLossRatios: [],
    });
    expect(run.createdBy).toBe("user_a");
    expect(typeof run.createdAt).toBe("string");

    const audits = await auditRows(t);
    expect(audits).toHaveLength(1);
    expect(audits[0].eventType).toBe("run.created");
    expect(audits[0].runId).toBe(run._id);
    expect(audits[0].payload).toMatchObject({
      runId: run._id,
      triangleId,
      methods: ["chain_ladder"],
      originCount: 3,
      aprioriCount: 0,
    });
  });

  test("CL+BF+Mack with a complete grid → queued run carrying the a-prioris", async () => {
    const t = initConvexTest();
    const triangleId = await seedValidatedTriangle(t);

    await t.withIdentity(analystA).mutation(api.runs.createRun, {
      workspaceId: "org_A",
      triangleId,
      parameters: {
        methods: ["chain_ladder", "bornhuetter_ferguson", "mack"],
        aprioriLossRatios: fullAprioris,
      },
    });

    const runs = await runRows(t);
    expect(runs).toHaveLength(1);
    expect(runs[0].parameters.aprioriLossRatios).toHaveLength(3);
    expect(runs[0].parameters.aprioriLossRatios).toEqual(fullAprioris);

    const audits = await auditRows(t);
    expect(audits[0].payload).toMatchObject({ aprioriCount: 3 });
  });

  test("run.created keeps the audit chain valid (verifyChain)", async () => {
    const t = initConvexTest();
    const triangleId = await seedValidatedTriangle(t);
    await t.withIdentity(analystA).mutation(api.runs.createRun, {
      workspaceId: "org_A",
      triangleId,
      parameters: { methods: ["chain_ladder"], aprioriLossRatios: [] },
    });

    const verification = await t
      .withIdentity(analystA)
      .query(api.auditLogs.verifyChain, { workspaceId: "org_A" });
    expect(verification).toEqual({ valid: true, length: 1 });
  });

  test("BF not selected → stray a-prioris are dropped (not persisted)", async () => {
    const t = initConvexTest();
    const triangleId = await seedValidatedTriangle(t);

    await t.withIdentity(analystA).mutation(api.runs.createRun, {
      workspaceId: "org_A",
      triangleId,
      parameters: {
        methods: ["chain_ladder", "mack"],
        aprioriLossRatios: fullAprioris,
      },
    });

    const runs = await runRows(t);
    expect(runs[0].parameters.aprioriLossRatios).toEqual([]);
    const audits = await auditRows(t);
    expect(audits[0].payload).toMatchObject({ aprioriCount: 0 });
  });
});

describe("createRun — gating rejections (AC3, AC5)", () => {
  async function reject(
    t: Harness,
    identity: typeof analystA,
    parameters: {
      methods: string[];
      aprioriLossRatios: { origin: string; lossRatio: number; exposure: number }[];
    },
    triangleId: Id<"triangles">,
    workspaceId = "org_A",
  ): Promise<string> {
    let caught: unknown;
    try {
      await t.withIdentity(identity).mutation(api.runs.createRun, {
        workspaceId,
        triangleId,
        // Cast: the helper takes plain string[]/number tuples so tests can feed
        // deliberately-bad values; the validator's literal-union arg type is
        // narrower. Convex still validates the shape at the boundary.
        parameters: parameters as unknown as {
          methods: ("chain_ladder" | "bornhuetter_ferguson" | "mack")[];
          aprioriLossRatios: {
            origin: string;
            lossRatio: number;
            exposure: number;
          }[];
        },
      });
      throw new Error("createRun unexpectedly succeeded");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConvexError);
    // Nothing written on any rejection (fail-closed, atomic).
    expect(await runRows(t)).toHaveLength(0);
    expect(await auditRows(t)).toHaveLength(0);
    return (caught as ConvexError<{ code: string }>).data.code;
  }

  test("zero methods → RUN_NO_METHODS", async () => {
    const t = initConvexTest();
    const triangleId = await seedValidatedTriangle(t);
    expect(
      await reject(t, analystA, { methods: [], aprioriLossRatios: [] }, triangleId),
    ).toBe("RUN_NO_METHODS");
  });

  test("BF + missing an origin → RUN_MISSING_APRIORI", async () => {
    const t = initConvexTest();
    const triangleId = await seedValidatedTriangle(t);
    expect(
      await reject(
        t,
        analystA,
        {
          methods: ["bornhuetter_ferguson"],
          aprioriLossRatios: fullAprioris.slice(0, 2),
        },
        triangleId,
      ),
    ).toBe("RUN_MISSING_APRIORI");
  });

  test("BF + duplicate origin → RUN_DUPLICATE_APRIORI", async () => {
    const t = initConvexTest();
    const triangleId = await seedValidatedTriangle(t);
    expect(
      await reject(
        t,
        analystA,
        {
          methods: ["bornhuetter_ferguson"],
          aprioriLossRatios: [
            fullAprioris[0],
            fullAprioris[0],
            fullAprioris[1],
          ],
        },
        triangleId,
      ),
    ).toBe("RUN_DUPLICATE_APRIORI");
  });

  test("BF + unknown origin → RUN_UNKNOWN_APRIORI", async () => {
    const t = initConvexTest();
    const triangleId = await seedValidatedTriangle(t);
    expect(
      await reject(
        t,
        analystA,
        {
          methods: ["bornhuetter_ferguson"],
          aprioriLossRatios: [
            ...fullAprioris,
            { origin: "1999", lossRatio: 0.9, exposure: 5_000_000 },
          ],
        },
        triangleId,
      ),
    ).toBe("RUN_UNKNOWN_APRIORI");
  });

  test("BF + exposure 0 → RUN_INVALID_APRIORI", async () => {
    const t = initConvexTest();
    const triangleId = await seedValidatedTriangle(t);
    const bad = fullAprioris.map((a, i) => (i === 0 ? { ...a, exposure: 0 } : a));
    expect(
      await reject(
        t,
        analystA,
        { methods: ["bornhuetter_ferguson"], aprioriLossRatios: bad },
        triangleId,
      ),
    ).toBe("RUN_INVALID_APRIORI");
  });

  test("BF + negative loss ratio → RUN_INVALID_APRIORI", async () => {
    const t = initConvexTest();
    const triangleId = await seedValidatedTriangle(t);
    const bad = fullAprioris.map((a, i) => (i === 1 ? { ...a, lossRatio: -0.1 } : a));
    expect(
      await reject(
        t,
        analystA,
        { methods: ["bornhuetter_ferguson"], aprioriLossRatios: bad },
        triangleId,
      ),
    ).toBe("RUN_INVALID_APRIORI");
  });

  test("BF + non-finite exposure → RUN_INVALID_APRIORI", async () => {
    const t = initConvexTest();
    const triangleId = await seedValidatedTriangle(t);
    const bad = fullAprioris.map((a, i) =>
      i === 2 ? { ...a, exposure: Number.POSITIVE_INFINITY } : a,
    );
    expect(
      await reject(
        t,
        analystA,
        { methods: ["bornhuetter_ferguson"], aprioriLossRatios: bad },
        triangleId,
      ),
    ).toBe("RUN_INVALID_APRIORI");
  });

  test("pending_validation triangle → TRIANGLE_NOT_RUNNABLE", async () => {
    const t = initConvexTest();
    const triangleId = await seedTriangleWithStatus(t, "pending_validation");
    expect(
      await reject(
        t,
        analystA,
        { methods: ["chain_ladder"], aprioriLossRatios: [] },
        triangleId,
      ),
    ).toBe("TRIANGLE_NOT_RUNNABLE");
  });

  test("validation_failed triangle → TRIANGLE_NOT_RUNNABLE", async () => {
    const t = initConvexTest();
    const triangleId = await seedTriangleWithStatus(t, "validation_failed");
    expect(
      await reject(
        t,
        analystA,
        { methods: ["chain_ladder"], aprioriLossRatios: [] },
        triangleId,
      ),
    ).toBe("TRIANGLE_NOT_RUNNABLE");
  });
});

describe("createRun — guards + tenancy (AC5, AD-4)", () => {
  test("unauthenticated → UNAUTHENTICATED, no write", async () => {
    const t = initConvexTest();
    const triangleId = await seedValidatedTriangle(t);
    let caught: unknown;
    try {
      await t.mutation(api.runs.createRun, {
        workspaceId: "org_A",
        triangleId,
        parameters: { methods: ["chain_ladder"], aprioriLossRatios: [] },
      });
      throw new Error("unexpected success");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConvexError);
    expect((caught as ConvexError<{ code: string }>).data.code).toBe(
      "UNAUTHENTICATED",
    );
    expect(await runRows(t)).toHaveLength(0);
    expect(await auditRows(t)).toHaveLength(0);
  });

  test("org B cannot create a Run against org A's Triangle → TRIANGLE_NOT_FOUND", async () => {
    const t = initConvexTest();
    const triangleId = await seedValidatedTriangle(t, "org_A");
    let caught: unknown;
    try {
      await t.withIdentity(analystB).mutation(api.runs.createRun, {
        workspaceId: "org_B",
        triangleId,
        parameters: { methods: ["chain_ladder"], aprioriLossRatios: [] },
      });
      throw new Error("unexpected success");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConvexError);
    expect((caught as ConvexError<{ code: string }>).data.code).toBe(
      "TRIANGLE_NOT_FOUND",
    );
    expect(await runRows(t)).toHaveLength(0);
    expect(await auditRows(t)).toHaveLength(0);
  });
});

// --- Story 4.2: durable orchestration --------------------------------------

/** Build a JSON Response the way callEngine consumes it (mirrors triangles.test). */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A schema-valid ResultSet stamped with the given Triangle hash. */
function makeResultSet(
  triangleHash: string,
  methods: ("chain_ladder" | "bornhuetter_ferguson" | "mack")[] = ["chain_ladder"],
) {
  return {
    schemaVersion: "1.0.0",
    lineage: {
      engineVersion: "0.1.0",
      chainladderVersion: "0.9.2",
      triangleHash,
      parameters: { methods, aprioriLossRatios: [] },
    },
    methodResults: methods.map((method) => ({
      method,
      developmentFactors: [{ fromDev: "12", toDev: "24", factor: 1.5 }],
      originResults: [
        {
          origin: "2019",
          ultimate: 200,
          ibnr: 25,
          mackStdErr: method === "mack" ? 3.2 : null,
          reserveLow: method === "mack" ? 190 : null,
          reserveHigh: method === "mack" ? 210 : null,
        },
      ],
      totalMackStdErr: method === "mack" ? 5.1 : null,
    })),
  };
}

/** A schema-valid DiagnosticsBundle for the given run + Triangle hash. */
function makeDiagnosticsBundle(runId: string, triangleHash: string) {
  return {
    schemaVersion: "1.0.0",
    runId,
    triangleHash,
    ldfStability: [],
    ave: [],
    clBfDivergence: null,
    residuals: [],
  };
}

/** Seed a `runs` row directly in the given status (no workflow kickoff). */
async function seedRun(
  t: Harness,
  triangleId: Id<"triangles">,
  status: "queued" | "running" | "complete" | "failed" = "queued",
  parameters: {
    methods: ("chain_ladder" | "bornhuetter_ferguson" | "mack")[];
    aprioriLossRatios: { origin: string; lossRatio: number; exposure: number }[];
  } = { methods: ["chain_ladder"], aprioriLossRatios: [] },
): Promise<Id<"runs">> {
  return await t.run((ctx) =>
    ctx.db.insert("runs", {
      workspaceId: "org_A",
      triangleId,
      triangleHash: TRIANGLE_HASH,
      status,
      parameters,
      createdBy: "user_a",
      createdAt: "2026-07-19T00:00:00.000Z",
    }),
  );
}

async function getRun(t: Harness, runId: Id<"runs">) {
  return await t.run((ctx) => ctx.db.get(runId));
}

describe("orchestration — markRunning (AC1, AC4)", () => {
  test("queued → running, one run.started, startedAt set", async () => {
    const t = initConvexTest();
    const triangleId = await seedValidatedTriangle(t);
    const runId = await seedRun(t, triangleId);

    await t.mutation(internal.runs.markRunning, { runId, actor: "user_a" });

    const run = await getRun(t, runId);
    expect(run?.status).toBe("running");
    expect(typeof run?.startedAt).toBe("string");
    const started = (await auditRows(t)).filter((a) => a.eventType === "run.started");
    expect(started).toHaveLength(1);
    expect(started[0].runId).toBe(runId);
  });

  test("idempotent: a second markRunning on a running run no-ops", async () => {
    const t = initConvexTest();
    const triangleId = await seedValidatedTriangle(t);
    const runId = await seedRun(t, triangleId);

    await t.mutation(internal.runs.markRunning, { runId, actor: "user_a" });
    await t.mutation(internal.runs.markRunning, { runId, actor: "user_a" });

    expect((await getRun(t, runId))?.status).toBe("running");
    expect(
      (await auditRows(t)).filter((a) => a.eventType === "run.started"),
    ).toHaveLength(1);
  });
});

describe("orchestration — executeEngineRun (/runs wire contract) (AC1, AC2)", () => {
  beforeEach(() => {
    vi.stubEnv("ENGINE_SERVICE_URL", "http://engine.test");
    vi.stubEnv("ENGINE_SERVICE_SECRET", "test-secret");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  test("CL-only: posts { runId (stringified), snake triangle, camel parameters } and returns engine output", async () => {
    const t = initConvexTest();
    const triangleId = await seedValidatedTriangle(t);
    const runId = await seedRun(t, triangleId);

    const engineOut = {
      runId,
      resultSet: makeResultSet(TRIANGLE_HASH),
      diagnosticsBundle: makeDiagnosticsBundle(runId, TRIANGLE_HASH),
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(engineOut));
    vi.stubGlobal("fetch", fetchMock);

    const out = await t.action(internal.runs.executeEngineRun, { runId });
    expect(out.resultSet.lineage.triangleHash).toBe(TRIANGLE_HASH);
    expect(out.diagnosticsBundle.runId).toBe(runId);

    // AC5: exactly one /runs call, no polling.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://engine.test/runs");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.runId).toBe(runId); // stringified Convex _id, top-level field
    expect(body.triangle).toEqual(ACCEPTED_TRIANGLE); // snake_case, verbatim
    expect(body.parameters).toEqual({
      methods: ["chain_ladder"],
      aprioriLossRatios: [],
    }); // camelCase, verbatim
  });

  test("CL+BF+Mack: sends the stored camelCase a-prioris", async () => {
    const t = initConvexTest();
    const triangleId = await seedValidatedTriangle(t);
    const params = {
      methods: ["chain_ladder", "bornhuetter_ferguson", "mack"] as (
        | "chain_ladder"
        | "bornhuetter_ferguson"
        | "mack"
      )[],
      aprioriLossRatios: fullAprioris,
    };
    const runId = await seedRun(t, triangleId, "queued", params);

    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        runId,
        resultSet: makeResultSet(TRIANGLE_HASH, params.methods),
        diagnosticsBundle: makeDiagnosticsBundle(runId, TRIANGLE_HASH),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await t.action(internal.runs.executeEngineRun, { runId });
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.parameters.methods).toEqual(params.methods);
    expect(body.parameters.aprioriLossRatios).toEqual(fullAprioris);
  });
});

describe("orchestration — storeResultSet (schema gate + persistence) (AC2, AC4, NFR-4)", () => {
  test("running → complete, persists ResultSet + DiagnosticsBundle, one run.completed", async () => {
    const t = initConvexTest();
    const triangleId = await seedValidatedTriangle(t);
    const runId = await seedRun(t, triangleId, "running");
    const resultSet = makeResultSet(TRIANGLE_HASH);
    const diagnosticsBundle = makeDiagnosticsBundle(runId, TRIANGLE_HASH);

    await t.mutation(internal.runs.storeResultSet, {
      runId,
      actor: "user_a",
      resultSet,
      diagnosticsBundle,
    });

    const run = await getRun(t, runId);
    expect(run?.status).toBe("complete");
    expect(run?.resultSet).toEqual(resultSet);
    expect(run?.diagnosticsBundle).toEqual(diagnosticsBundle);
    expect(typeof run?.completedAt).toBe("string");
    const completed = (await auditRows(t)).filter(
      (a) => a.eventType === "run.completed",
    );
    expect(completed).toHaveLength(1);
    expect(completed[0].payload).toMatchObject({ runId, methodCount: 1 });
  });

  test("idempotent: a second store on a complete run no-ops (NFR-4)", async () => {
    const t = initConvexTest();
    const triangleId = await seedValidatedTriangle(t);
    const runId = await seedRun(t, triangleId, "running");
    const resultSet = makeResultSet(TRIANGLE_HASH);
    const diagnosticsBundle = makeDiagnosticsBundle(runId, TRIANGLE_HASH);

    await t.mutation(internal.runs.storeResultSet, {
      runId,
      actor: "user_a",
      resultSet,
      diagnosticsBundle,
    });
    // A second identical store (as a retry might attempt) must not double-write.
    await t.mutation(internal.runs.storeResultSet, {
      runId,
      actor: "user_a",
      resultSet,
      diagnosticsBundle,
    });

    expect((await getRun(t, runId))?.status).toBe("complete");
    expect(
      (await auditRows(t)).filter((a) => a.eventType === "run.completed"),
    ).toHaveLength(1);
  });

  test("schema-invalid ResultSet → rejected at the arg boundary, nothing stored (AD-10)", async () => {
    const t = initConvexTest();
    const triangleId = await seedValidatedTriangle(t);
    const runId = await seedRun(t, triangleId, "running");

    let threw = false;
    try {
      await t.mutation(internal.runs.storeResultSet, {
        runId,
        actor: "user_a",
        // Missing lineage/methodResults — fails resultSetValidator before the handler.
        resultSet: { schemaVersion: "1.0.0" } as never,
        diagnosticsBundle: makeDiagnosticsBundle(runId, TRIANGLE_HASH),
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    const run = await getRun(t, runId);
    expect(run?.status).toBe("running"); // untouched
    expect(run?.resultSet).toBeUndefined();
    expect(
      (await auditRows(t)).filter((a) => a.eventType === "run.completed"),
    ).toHaveLength(0);
  });

  test("lineage.triangleHash mismatch → RESULT_HASH_MISMATCH, nothing stored (AD-11)", async () => {
    const t = initConvexTest();
    const triangleId = await seedValidatedTriangle(t);
    const runId = await seedRun(t, triangleId, "running");

    let code: string | undefined;
    try {
      await t.mutation(internal.runs.storeResultSet, {
        runId,
        actor: "user_a",
        resultSet: makeResultSet("b".repeat(64)), // wrong hash
        diagnosticsBundle: makeDiagnosticsBundle(runId, "b".repeat(64)),
      });
    } catch (error) {
      code = (error as ConvexError<{ code: string }>).data.code;
    }
    expect(code).toBe("RESULT_HASH_MISMATCH");
    const run = await getRun(t, runId);
    expect(run?.status).toBe("running");
    expect(run?.resultSet).toBeUndefined();
  });
});

describe("orchestration — markRunFailed + onRunComplete (AC2, AC3, AC4)", () => {
  test("markRunFailed: running → failed with error + failedAt + one run.failed", async () => {
    const t = initConvexTest();
    const triangleId = await seedValidatedTriangle(t);
    const runId = await seedRun(t, triangleId, "running");

    await t.mutation(internal.runs.markRunFailed, {
      runId,
      actor: "user_a",
      error: { code: "ENGINE_UNAVAILABLE", message: "down" },
    });

    const run = await getRun(t, runId);
    expect(run?.status).toBe("failed");
    expect(run?.error).toEqual({ code: "ENGINE_UNAVAILABLE", message: "down" });
    expect(typeof run?.failedAt).toBe("string");
    expect(
      (await auditRows(t)).filter((a) => a.eventType === "run.failed"),
    ).toHaveLength(1);
  });

  test("markRunFailed guard: never clobbers a complete run", async () => {
    const t = initConvexTest();
    const triangleId = await seedValidatedTriangle(t);
    const runId = await seedRun(t, triangleId, "complete");

    await t.mutation(internal.runs.markRunFailed, {
      runId,
      actor: "user_a",
      error: { code: "RUN_FAILED", message: "late error" },
    });

    expect((await getRun(t, runId))?.status).toBe("complete");
    expect(
      (await auditRows(t)).filter((a) => a.eventType === "run.failed"),
    ).toHaveLength(0);
  });

  test("onRunComplete failed → run failed carrying the error message", async () => {
    const t = initConvexTest();
    const triangleId = await seedValidatedTriangle(t);
    const runId = await seedRun(t, triangleId, "running");

    await t.mutation(internal.runs.onRunComplete, {
      workflowId: TEST_WORKFLOW_ID,
      result: { kind: "failed", error: "engine.triangle_invalid: bad" },
      context: { runId, actor: "user_a" },
    });

    const run = await getRun(t, runId);
    expect(run?.status).toBe("failed");
    expect(run?.error).toEqual({
      code: "RUN_FAILED",
      message: "engine.triangle_invalid: bad",
    });
  });

  test("onRunComplete canceled → run failed (RUN_CANCELED)", async () => {
    const t = initConvexTest();
    const triangleId = await seedValidatedTriangle(t);
    const runId = await seedRun(t, triangleId, "running");

    await t.mutation(internal.runs.onRunComplete, {
      workflowId: TEST_WORKFLOW_ID,
      result: { kind: "canceled" },
      context: { runId, actor: "user_a" },
    });

    expect((await getRun(t, runId))?.error?.code).toBe("RUN_CANCELED");
    expect((await getRun(t, runId))?.status).toBe("failed");
  });

  test("onRunComplete success → no-op on an already-complete run", async () => {
    const t = initConvexTest();
    const triangleId = await seedValidatedTriangle(t);
    const runId = await seedRun(t, triangleId, "complete");

    await t.mutation(internal.runs.onRunComplete, {
      workflowId: TEST_WORKFLOW_ID,
      result: { kind: "success", returnValue: null },
      context: { runId, actor: "user_a" },
    });

    expect((await getRun(t, runId))?.status).toBe("complete");
    expect(
      (await auditRows(t)).filter((a) => a.eventType === "run.failed"),
    ).toHaveLength(0);
  });
});

describe("orchestration — audit chain integrity across the lifecycle (AC4, AC6)", () => {
  test("created → started → completed keeps the chain valid (length 3)", async () => {
    const t = initConvexTest();
    const triangleId = await seedValidatedTriangle(t);
    // Real run.created (seq 0) via createRun; the scheduled workflow stays
    // pending (never finished) so only these manual transitions run.
    const { runId } = await t.withIdentity(analystA).mutation(api.runs.createRun, {
      workspaceId: "org_A",
      triangleId,
      parameters: { methods: ["chain_ladder"], aprioriLossRatios: [] },
    });

    await t.mutation(internal.runs.markRunning, { runId, actor: "user_a" });
    await t.mutation(internal.runs.storeResultSet, {
      runId,
      actor: "user_a",
      resultSet: makeResultSet(TRIANGLE_HASH),
      diagnosticsBundle: makeDiagnosticsBundle(runId, TRIANGLE_HASH),
    });

    const events = (await auditRows(t)).map((a) => a.eventType);
    expect(events).toEqual(["run.created", "run.started", "run.completed"]);
    const verification = await t
      .withIdentity(analystA)
      .query(api.auditLogs.verifyChain, { workspaceId: "org_A" });
    expect(verification).toEqual({ valid: true, length: 3 });
  });

  test("created → started → failed keeps the chain valid (length 3)", async () => {
    const t = initConvexTest();
    const triangleId = await seedValidatedTriangle(t);
    const { runId } = await t.withIdentity(analystA).mutation(api.runs.createRun, {
      workspaceId: "org_A",
      triangleId,
      parameters: { methods: ["chain_ladder"], aprioriLossRatios: [] },
    });

    await t.mutation(internal.runs.markRunning, { runId, actor: "user_a" });
    await t.mutation(internal.runs.markRunFailed, {
      runId,
      actor: "user_a",
      error: { code: "ENGINE_UNAVAILABLE", message: "down" },
    });

    const events = (await auditRows(t)).map((a) => a.eventType);
    expect(events).toEqual(["run.created", "run.started", "run.failed"]);
    const verification = await t
      .withIdentity(analystA)
      .query(api.auditLogs.verifyChain, { workspaceId: "org_A" });
    expect(verification).toEqual({ valid: true, length: 3 });
  });
});

// --- Story 4.3: getRun (reactive read surface) + retryRun --------------------

/** Seed a `complete` run carrying a ResultSet + DiagnosticsBundle. */
async function seedCompleteRun(
  t: Harness,
  triangleId: Id<"triangles">,
): Promise<Id<"runs">> {
  return await t.run((ctx) =>
    ctx.db.insert("runs", {
      workspaceId: "org_A",
      triangleId,
      triangleHash: TRIANGLE_HASH,
      status: "complete",
      parameters: { methods: ["chain_ladder", "mack"], aprioriLossRatios: [] },
      createdBy: "user_a",
      createdAt: "2026-07-19T00:00:00.000Z",
      resultSet: makeResultSet(TRIANGLE_HASH, ["chain_ladder", "mack"]),
      diagnosticsBundle: makeDiagnosticsBundle("placeholder", TRIANGLE_HASH),
      startedAt: "2026-07-19T00:00:01.000Z",
      completedAt: "2026-07-19T00:00:02.000Z",
    }),
  );
}

/** Seed a `failed` run carrying an error + failedAt. */
async function seedFailedRun(
  t: Harness,
  triangleId: Id<"triangles">,
): Promise<Id<"runs">> {
  return await t.run((ctx) =>
    ctx.db.insert("runs", {
      workspaceId: "org_A",
      triangleId,
      triangleHash: TRIANGLE_HASH,
      status: "failed",
      parameters: { methods: ["chain_ladder"], aprioriLossRatios: [] },
      createdBy: "user_a",
      createdAt: "2026-07-19T00:00:00.000Z",
      error: { code: "ENGINE_UNAVAILABLE", message: "down" },
      startedAt: "2026-07-19T00:00:01.000Z",
      failedAt: "2026-07-19T00:00:02.000Z",
    }),
  );
}

describe("getRun — lean projection + tenancy (AC6)", () => {
  test("queued run → lean projection, no figures, hasResults/hasDiagnostics false", async () => {
    const t = initConvexTest();
    const triangleId = await seedValidatedTriangle(t);
    const runId = await seedRun(t, triangleId, "queued");

    const view = await t
      .withIdentity(analystA)
      .query(api.runs.getRun, { workspaceId: "org_A", runId });

    expect(view).not.toBeNull();
    expect(view?.status).toBe("queued");
    expect(view?.methods).toEqual(["chain_ladder"]);
    expect(view?.error).toBeNull();
    expect(view?.triangleHash).toBe(TRIANGLE_HASH);
    expect(view?.hasResults).toBe(false);
    expect(view?.hasDiagnostics).toBe(false);
    // AD-1: the projection never carries the figures.
    expect(view).not.toHaveProperty("resultSet");
    expect(view).not.toHaveProperty("diagnosticsBundle");
  });

  test("complete run → hasResults/hasDiagnostics true, still no figures", async () => {
    const t = initConvexTest();
    const triangleId = await seedValidatedTriangle(t);
    const runId = await seedCompleteRun(t, triangleId);

    const view = await t
      .withIdentity(analystA)
      .query(api.runs.getRun, { workspaceId: "org_A", runId });

    expect(view?.status).toBe("complete");
    expect(view?.methods).toEqual(["chain_ladder", "mack"]);
    expect(view?.hasResults).toBe(true);
    expect(view?.hasDiagnostics).toBe(true);
    expect(view?.completedAt).toBe("2026-07-19T00:00:02.000Z");
    expect(view).not.toHaveProperty("resultSet");
    expect(view).not.toHaveProperty("diagnosticsBundle");
  });

  test("failed run → carries the error message", async () => {
    const t = initConvexTest();
    const triangleId = await seedValidatedTriangle(t);
    const runId = await seedFailedRun(t, triangleId);

    const view = await t
      .withIdentity(analystA)
      .query(api.runs.getRun, { workspaceId: "org_A", runId });

    expect(view?.status).toBe("failed");
    expect(view?.error).toEqual({ code: "ENGINE_UNAVAILABLE", message: "down" });
    expect(view?.failedAt).toBe("2026-07-19T00:00:02.000Z");
  });

  test("a run in another Workspace → null (existence never leaks)", async () => {
    const t = initConvexTest();
    const triangleId = await seedValidatedTriangle(t, "org_A");
    const runId = await seedRun(t, triangleId, "queued");

    const view = await t
      .withIdentity(analystB)
      .query(api.runs.getRun, { workspaceId: "org_B", runId });

    expect(view).toBeNull();
  });
});

describe("getResultSet — verbatim figure read surface (AC4, AC5)", () => {
  test("complete run → the stored ResultSet returned verbatim (no re-shaping)", async () => {
    const t = initConvexTest();
    const triangleId = await seedValidatedTriangle(t);
    const runId = await seedCompleteRun(t, triangleId);

    const resultSet = await t
      .withIdentity(analystA)
      .query(api.runs.getResultSet, { workspaceId: "org_A", runId });

    // Deep-equal the exact fixture seedCompleteRun stored — nothing dropped or
    // re-keyed (AC3 verbatim: the query cannot introduce a derived number).
    expect(resultSet).toEqual(makeResultSet(TRIANGLE_HASH, ["chain_ladder", "mack"]));
    // Spot-check the Mack figures survive (present, not stripped).
    const mack = resultSet?.methodResults.find((m) => m.method === "mack");
    expect(mack?.originResults[0].mackStdErr).toBe(3.2);
    expect(mack?.originResults[0].reserveLow).toBe(190);
    expect(mack?.originResults[0].reserveHigh).toBe(210);
    expect(mack?.totalMackStdErr).toBe(5.1);
    // Full lineage present for the provenance popover.
    expect(resultSet?.lineage.engineVersion).toBe("0.1.0");
    expect(resultSet?.lineage.chainladderVersion).toBe("0.9.2");
    expect(resultSet?.lineage.triangleHash).toBe(TRIANGLE_HASH);
  });

  test("queued / running / failed run → null (no resultSet stored)", async () => {
    const t = initConvexTest();
    const triangleId = await seedValidatedTriangle(t);
    for (const status of ["queued", "running", "failed"] as const) {
      const runId = await seedRun(t, triangleId, status);
      const resultSet = await t
        .withIdentity(analystA)
        .query(api.runs.getResultSet, { workspaceId: "org_A", runId });
      expect(resultSet).toBeNull();
    }
  });

  test("a complete run in another Workspace → null (existence never leaks)", async () => {
    const t = initConvexTest();
    const triangleId = await seedValidatedTriangle(t, "org_A");
    const runId = await seedCompleteRun(t, triangleId);

    const resultSet = await t
      .withIdentity(analystB)
      .query(api.runs.getResultSet, { workspaceId: "org_B", runId });

    expect(resultSet).toBeNull();
  });
});

describe("retryRun — idempotent re-entry (AC4, AC6)", () => {
  test("failed → queued, fields cleared, run.retried appended, chain valid", async () => {
    const t = initConvexTest();
    const triangleId = await seedValidatedTriangle(t);
    // Real run.created (seq 0) so the chain has a genesis to extend.
    const { runId } = await t
      .withIdentity(analystA)
      .mutation(api.runs.createRun, {
        workspaceId: "org_A",
        triangleId,
        parameters: { methods: ["chain_ladder"], aprioriLossRatios: [] },
      });
    // Drive it to failed (created → started → failed).
    await t.mutation(internal.runs.markRunning, { runId, actor: "user_a" });
    await t.mutation(internal.runs.markRunFailed, {
      runId,
      actor: "user_a",
      error: { code: "ENGINE_UNAVAILABLE", message: "down" },
    });

    const result = await t
      .withIdentity(analystA)
      .mutation(api.runs.retryRun, { workspaceId: "org_A", runId });
    expect(result.status).toBe("queued");

    const run = await getRun(t, runId);
    expect(run?.status).toBe("queued");
    expect(run?.error).toBeUndefined();
    expect(run?.failedAt).toBeUndefined();
    expect(run?.startedAt).toBeUndefined();
    expect(run?.completedAt).toBeUndefined();
    expect(typeof run?.workflowId).toBe("string");

    const retried = (await auditRows(t)).filter(
      (a) => a.eventType === "run.retried",
    );
    expect(retried).toHaveLength(1);
    expect(retried[0].payload).toMatchObject({
      runId,
      retriedFrom: "ENGINE_UNAVAILABLE",
    });

    const verification = await t
      .withIdentity(analystA)
      .query(api.auditLogs.verifyChain, { workspaceId: "org_A" });
    // AC6: the retry re-entry keeps the per-Workspace hash chain valid. (Exact
    // length is left unpinned — the workflow kickoff the harness drives can add
    // its own lifecycle entries; run.retried appearing exactly once above is the
    // assertion that matters.)
    expect(verification.valid).toBe(true);
  });

  test("idempotency guard: retrying a non-failed run → RUN_NOT_RETRYABLE, no audit", async () => {
    const t = initConvexTest();
    const triangleId = await seedValidatedTriangle(t);
    for (const status of ["queued", "running", "complete"] as const) {
      const runId =
        status === "complete"
          ? await seedCompleteRun(t, triangleId)
          : await seedRun(t, triangleId, status);
      let code: string | undefined;
      try {
        await t
          .withIdentity(analystA)
          .mutation(api.runs.retryRun, { workspaceId: "org_A", runId });
      } catch (error) {
        code = (error as ConvexError<{ code: string }>).data.code;
      }
      expect(code).toBe("RUN_NOT_RETRYABLE");
    }
    expect(
      (await auditRows(t)).filter((a) => a.eventType === "run.retried"),
    ).toHaveLength(0);
  });

  test("double-click safe: a second retry (now queued) throws RUN_NOT_RETRYABLE", async () => {
    const t = initConvexTest();
    const triangleId = await seedValidatedTriangle(t);
    const runId = await seedFailedRun(t, triangleId);

    await t
      .withIdentity(analystA)
      .mutation(api.runs.retryRun, { workspaceId: "org_A", runId });

    let code: string | undefined;
    try {
      await t
        .withIdentity(analystA)
        .mutation(api.runs.retryRun, { workspaceId: "org_A", runId });
    } catch (error) {
      code = (error as ConvexError<{ code: string }>).data.code;
    }
    expect(code).toBe("RUN_NOT_RETRYABLE");
    // Exactly one re-entry — no duplicate work.
    expect(
      (await auditRows(t)).filter((a) => a.eventType === "run.retried"),
    ).toHaveLength(1);
  });

  test("tenancy: org B retrying org A's failed run → RUN_NOT_FOUND", async () => {
    const t = initConvexTest();
    const triangleId = await seedValidatedTriangle(t, "org_A");
    const runId = await seedFailedRun(t, triangleId);

    let code: string | undefined;
    try {
      await t
        .withIdentity(analystB)
        .mutation(api.runs.retryRun, { workspaceId: "org_B", runId });
    } catch (error) {
      code = (error as ConvexError<{ code: string }>).data.code;
    }
    expect(code).toBe("RUN_NOT_FOUND");
    expect((await getRun(t, runId))?.status).toBe("failed"); // untouched
  });
});
