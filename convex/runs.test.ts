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

/**
 * A POPULATED DiagnosticsBundle (≥1 element per kind, non-null clBfDivergence)
 * so the getDiagnosticsBundle verbatim assertion actually exercises the nested
 * arrays (linkRatios, residuals) rather than empty ones.
 */
function makePopulatedDiagnosticsBundle(runId: string, triangleHash: string) {
  return {
    schemaVersion: "1.0.0",
    runId,
    triangleHash,
    ldfStability: [
      {
        id: `dx:${runId}:ldf_stability:12`,
        fromDev: "12",
        toDev: "24",
        selectedFactor: 1.52,
        linkRatios: [
          { origin: "2019", factor: 1.48 },
          { origin: "2020", factor: 1.55 },
        ],
        sigma: 0.12,
        stdErr: 0.04,
        cv: 0.08,
      },
    ],
    ave: [
      {
        id: `dx:${runId}:ave:2019`,
        origin: "2019",
        fromDev: "12",
        toDev: "24",
        actual: 4213,
        expected: 4371,
        actualMinusExpected: -158,
        actualToExpectedRatio: 0.9639,
      },
    ],
    clBfDivergence: [
      {
        id: `dx:${runId}:cl_bf_divergence:2019`,
        origin: "2019",
        clUltimate: 4213,
        bfUltimate: 4100,
        divergence: 113,
        relativeDivergence: 0.0276,
      },
    ],
    residuals: [
      {
        id: `dx:${runId}:residual:2019:12`,
        origin: "2019",
        fromDev: "12",
        toDev: "24",
        residual: 1.1,
      },
    ],
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
      // A started run always carries the id of its current workflow; onRunComplete
      // fences on it (a callback whose workflowId != run.workflowId is ignored).
      workflowId: TEST_WORKFLOW_ID as unknown as string,
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

  test("onRunComplete fences a stale workflow: mismatched workflowId is a no-op", async () => {
    const t = initConvexTest();
    const triangleId = await seedValidatedTriangle(t);
    // Simulate a retry: the run was re-queued under a NEW workflow, so its
    // workflowId no longer matches the superseded callback's TEST_WORKFLOW_ID.
    const runId = await seedRun(t, triangleId, "running");
    await t.run((ctx) =>
      ctx.db.patch(runId, { workflowId: "wf_new" as unknown as string }),
    );

    await t.mutation(internal.runs.onRunComplete, {
      workflowId: TEST_WORKFLOW_ID,
      result: { kind: "failed", error: "stale engine failure" },
      context: { runId, actor: "user_a" },
    });

    // The freshly re-queued run is untouched — not clobbered to failed.
    const run = await getRun(t, runId);
    expect(run?.status).toBe("running");
    expect(run?.error ?? null).toBeNull();
    expect(
      (await auditRows(t)).filter((a) => a.eventType === "run.failed"),
    ).toHaveLength(0);
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

describe("getDiagnosticsBundle — verbatim diagnostics read surface (AC1, AC7)", () => {
  test("complete run → the stored DiagnosticsBundle returned verbatim (no re-shaping)", async () => {
    const t = initConvexTest();
    const triangleId = await seedValidatedTriangle(t);
    const bundle = makePopulatedDiagnosticsBundle("run_4_5", TRIANGLE_HASH);
    // Seed a complete run carrying the POPULATED bundle (seedCompleteRun stores
    // the empty placeholder one — this test needs the nested arrays present).
    const runId = await t.run((ctx) =>
      ctx.db.insert("runs", {
        workspaceId: "org_A",
        triangleId,
        triangleHash: TRIANGLE_HASH,
        status: "complete",
        parameters: {
          methods: ["chain_ladder", "bornhuetter_ferguson", "mack"],
          aprioriLossRatios: [],
        },
        createdBy: "user_a",
        createdAt: "2026-07-19T00:00:00.000Z",
        resultSet: makeResultSet(TRIANGLE_HASH, ["chain_ladder", "mack"]),
        diagnosticsBundle: bundle,
        startedAt: "2026-07-19T00:00:01.000Z",
        completedAt: "2026-07-19T00:00:02.000Z",
      }),
    );

    const out = await t
      .withIdentity(analystA)
      .query(api.runs.getDiagnosticsBundle, { workspaceId: "org_A", runId });

    // Deep-equal the exact stored bundle — nothing dropped or re-keyed (AC5
    // verbatim: the query cannot introduce a derived number).
    expect(out).toEqual(bundle);
    // Spot-check the nested arrays survive (present, not stripped).
    expect(out?.ldfStability[0].linkRatios).toHaveLength(2);
    expect(out?.ave[0].actualMinusExpected).toBe(-158);
    expect(out?.clBfDivergence?.[0].divergence).toBe(113);
    expect(out?.residuals[0].residual).toBe(1.1);
  });

  test("queued / running / failed run → null (no diagnosticsBundle stored)", async () => {
    const t = initConvexTest();
    const triangleId = await seedValidatedTriangle(t);
    for (const status of ["queued", "running", "failed"] as const) {
      const runId = await seedRun(t, triangleId, status);
      const out = await t
        .withIdentity(analystA)
        .query(api.runs.getDiagnosticsBundle, { workspaceId: "org_A", runId });
      expect(out).toBeNull();
    }
  });

  test("a complete run in another Workspace → null (existence never leaks)", async () => {
    const t = initConvexTest();
    const triangleId = await seedValidatedTriangle(t, "org_A");
    const runId = await seedCompleteRun(t, triangleId);

    const out = await t
      .withIdentity(analystB)
      .query(api.runs.getDiagnosticsBundle, { workspaceId: "org_B", runId });

    expect(out).toBeNull();
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

// --- Story 4.7: ResultSet re-derivation (rederiveRun) (AC1–AC4, AC7) ---------

/** A `run.rederived` engine report the stubbed /rederive endpoint returns. */
function makeRederivationReport(
  overrides: Partial<{
    reproduced: boolean;
    triangleHashVerified: boolean;
    tier: "exact" | "epsilon";
    discrepancies: unknown[];
  }> = {},
) {
  return {
    schemaVersion: "1.0.0",
    runId: "run",
    reproduced: overrides.reproduced ?? true,
    triangleHashVerified: overrides.triangleHashVerified ?? true,
    tier: overrides.tier ?? "epsilon",
    discrepancies: overrides.discrepancies ?? [],
  };
}

/** Seed a run row directly with the given status/hashes (no orchestration). */
async function seedRederivableRun(
  t: Harness,
  {
    workspaceId = "org_A",
    status = "complete" as "queued" | "running" | "complete" | "failed",
    runHash = TRIANGLE_HASH,
    resultHash = TRIANGLE_HASH,
    withResult = true,
  } = {},
): Promise<Id<"runs">> {
  const triangleId = await seedValidatedTriangle(t, workspaceId);
  return await t.run((ctx) =>
    ctx.db.insert("runs", {
      workspaceId,
      triangleId,
      triangleHash: runHash,
      status,
      parameters: { methods: ["chain_ladder"], aprioriLossRatios: [] },
      createdBy: "user_seed",
      createdAt: "2026-07-18T00:00:00.000Z",
      ...(withResult && status === "complete"
        ? { resultSet: makeResultSet(resultHash), completedAt: "2026-07-18T02:00:00.000Z" }
        : {}),
    }),
  );
}

describe("rederiveRun — re-derivation from Lineage (AC1–AC4, AC7)", () => {
  beforeEach(() => {
    vi.stubEnv("ENGINE_SERVICE_URL", "http://engine.test");
    vi.stubEnv("ENGINE_SERVICE_SECRET", "test-secret");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  test("reproduced → returns the report, audits run.rederived (lean), run row unchanged", async () => {
    const t = initConvexTest();
    const runId = await seedRederivableRun(t);
    const report = makeRederivationReport({ reproduced: true, tier: "epsilon" });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(report));
    vi.stubGlobal("fetch", fetchMock);

    const out = await t
      .withIdentity(analystA)
      .action(api.runs.rederiveRun, { workspaceId: "org_A", runId });

    expect(out.reproduced).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // The wire body re-derives from the stored ResultSet (not the run params).
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://engine.test/rederive");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.runId).toBe(runId);
    expect(body.storedResultSet.lineage.triangleHash).toBe(TRIANGLE_HASH);

    // Audit: exactly one run.rederived, lean payload, no reserve figures.
    const audits = await auditRows(t);
    const rederived = audits.filter((a) => a.eventType === "run.rederived");
    expect(rederived).toHaveLength(1);
    expect(rederived[0].runId).toBe(runId);
    expect(rederived[0].payload).toMatchObject({
      runId,
      reproduced: true,
      triangleHashVerified: true,
      tier: "epsilon",
      discrepancyCount: 0,
    });

    // Immutability: the run row is untouched (status + stored ResultSet).
    const run = (await runRows(t))[0];
    expect(run.status).toBe("complete");
    expect(run.resultSet).toEqual(makeResultSet(TRIANGLE_HASH));
  });

  test("discrepancy report → still audited (reproduced=false), run row unchanged", async () => {
    const t = initConvexTest();
    const runId = await seedRederivableRun(t);
    const report = makeRederivationReport({
      reproduced: false,
      discrepancies: [
        { method: "chain_ladder", field: "ultimate", key: "2019", stored: 201, rederived: 200, delta: 1 },
      ],
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(report)));

    const out = await t
      .withIdentity(analystA)
      .action(api.runs.rederiveRun, { workspaceId: "org_A", runId });

    expect(out.reproduced).toBe(false);
    expect(out.discrepancies).toHaveLength(1);

    const rederived = (await auditRows(t)).filter((a) => a.eventType === "run.rederived");
    expect(rederived).toHaveLength(1);
    expect(rederived[0].payload).toMatchObject({ reproduced: false, discrepancyCount: 1 });

    const run = (await runRows(t))[0];
    expect(run.status).toBe("complete");
    expect(run.resultSet).toEqual(makeResultSet(TRIANGLE_HASH));
  });

  test("a non-complete Run is RUN_NOT_REDERIVABLE (no engine call, no audit)", async () => {
    const t = initConvexTest();
    const runId = await seedRederivableRun(t, { status: "queued", withResult: false });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    let code: string | undefined;
    try {
      await t
        .withIdentity(analystA)
        .action(api.runs.rederiveRun, { workspaceId: "org_A", runId });
    } catch (error) {
      code = (error as ConvexError<{ code: string }>).data.code;
    }
    expect(code).toBe("RUN_NOT_REDERIVABLE");
    expect(fetchMock).not.toHaveBeenCalled();
    expect((await auditRows(t)).filter((a) => a.eventType === "run.rederived")).toHaveLength(0);
  });

  test("cross-tenant re-derivation is rejected (existence not leaked)", async () => {
    const t = initConvexTest();
    const runId = await seedRederivableRun(t, { workspaceId: "org_A" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    // analystB is a member of org_B; reaching org_A's run via their own
    // workspace throws RUN_NOT_FOUND (same code as absent — no leak).
    let code: string | undefined;
    try {
      await t
        .withIdentity(analystB)
        .action(api.runs.rederiveRun, { workspaceId: "org_B", runId });
    } catch (error) {
      code = (error as ConvexError<{ code: string }>).data.code;
    }
    expect(code).toBe("RUN_NOT_FOUND");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("a stored ResultSet whose Lineage hash ≠ run hash is RESULT_HASH_MISMATCH (before dispatch)", async () => {
    const t = initConvexTest();
    // run.triangleHash is TRIANGLE_HASH; stamp the stored ResultSet with a
    // different Lineage hash → chain break caught Convex-side before the fetch.
    const runId = await seedRederivableRun(t, { runHash: TRIANGLE_HASH, resultHash: "b".repeat(64) });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    let code: string | undefined;
    try {
      await t
        .withIdentity(analystA)
        .action(api.runs.rederiveRun, { workspaceId: "org_A", runId });
    } catch (error) {
      code = (error as ConvexError<{ code: string }>).data.code;
    }
    expect(code).toBe("RESULT_HASH_MISMATCH");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("unauthenticated re-derivation is rejected before the engine call (AD-4)", async () => {
    const t = initConvexTest();
    const runId = await seedRederivableRun(t);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    let code: string | undefined;
    try {
      await t.action(api.runs.rederiveRun, { workspaceId: "org_A", runId });
    } catch (error) {
      code = (error as ConvexError<{ code: string }>).data.code;
    }
    expect(code).toBe("UNAUTHENTICATED");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// --- Story 5.3: Method Recommendations (persistence + audit + action) --------

/** A schema-valid Recommendations document whose runId matches the given run. */
function makeRecommendations(runId: string, origins: string[] = ["2019"]) {
  return {
    schemaVersion: "1.0.0",
    runId,
    recommendations: origins.map((origin) => ({
      origin,
      method: "chain_ladder" as const,
      reasons: [
        { text: `Recommended for ${origin}.`, citations: [`dx:${runId}:ave:${origin}`] },
      ],
    })),
  };
}

/** Seed a `complete` run carrying a ResultSet + DiagnosticsBundle (interpretable). */
async function seedInterpretableRun(
  t: Harness,
  { workspaceId = "org_A" } = {},
): Promise<Id<"runs">> {
  const triangleId = await seedValidatedTriangle(t, workspaceId);
  return await t.run((ctx) =>
    ctx.db.insert("runs", {
      workspaceId,
      triangleId,
      triangleHash: TRIANGLE_HASH,
      status: "complete",
      parameters: { methods: ["chain_ladder"], aprioriLossRatios: [] },
      createdBy: "user_seed",
      createdAt: "2026-07-18T00:00:00.000Z",
      resultSet: makeResultSet(TRIANGLE_HASH),
      diagnosticsBundle: makeDiagnosticsBundle("seed", TRIANGLE_HASH),
      completedAt: "2026-07-18T02:00:00.000Z",
    }),
  );
}

const SAMPLE_ATTEMPTS = [
  { transcript: { messages: [{ role: "user", content: "go" }], toolCalls: [] }, rejections: [] },
];

describe("storeRecommendations — persistence + audit (AC-2, AC-3)", () => {
  test("persists on a complete run + appends run.recommended with the transcript", async () => {
    const t = initConvexTest();
    const runId = await seedInterpretableRun(t);
    const recommendations = makeRecommendations(runId);

    await t.mutation(internal.runs.storeRecommendations, {
      runId,
      workspaceId: "org_A",
      actor: "user_a",
      recommendations,
      transcript: SAMPLE_ATTEMPTS,
    });

    const run = await getRun(t, runId);
    expect(run?.recommendations).toEqual(recommendations);
    const audits = (await auditRows(t)).filter((a) => a.eventType === "run.recommended");
    expect(audits).toHaveLength(1);
    expect(audits[0].runId).toBe(runId);
    expect(audits[0].payload).toMatchObject({ runId, originCount: 1 });
    expect(audits[0].payload.transcript).toEqual(SAMPLE_ATTEMPTS);
  });

  test("no-op on a non-complete run (guarded)", async () => {
    const t = initConvexTest();
    const triangleId = await seedValidatedTriangle(t);
    const runId = await seedRun(t, triangleId, "running");

    await t.mutation(internal.runs.storeRecommendations, {
      runId,
      workspaceId: "org_A",
      actor: "user_a",
      recommendations: makeRecommendations(runId),
      transcript: SAMPLE_ATTEMPTS,
    });

    const run = await getRun(t, runId);
    expect(run?.recommendations).toBeUndefined();
    expect((await auditRows(t)).filter((a) => a.eventType === "run.recommended")).toHaveLength(0);
  });

  test("no-op on a cross-tenant workspace mismatch", async () => {
    const t = initConvexTest();
    const runId = await seedInterpretableRun(t, { workspaceId: "org_A" });
    await t.mutation(internal.runs.storeRecommendations, {
      runId,
      workspaceId: "org_B",
      actor: "user_b",
      recommendations: makeRecommendations(runId),
      transcript: SAMPLE_ATTEMPTS,
    });
    expect((await getRun(t, runId))?.recommendations).toBeUndefined();
  });

  test("a runId mismatch throws RECOMMENDATIONS_RUN_MISMATCH (never stored)", async () => {
    const t = initConvexTest();
    const runId = await seedInterpretableRun(t);
    let code: string | undefined;
    try {
      await t.mutation(internal.runs.storeRecommendations, {
        runId,
        workspaceId: "org_A",
        actor: "user_a",
        recommendations: makeRecommendations("some-other-run"),
        transcript: SAMPLE_ATTEMPTS,
      });
    } catch (error) {
      code = (error as ConvexError<{ code: string }>).data.code;
    }
    expect(code).toBe("RECOMMENDATIONS_RUN_MISMATCH");
    expect((await getRun(t, runId))?.recommendations).toBeUndefined();
  });

  test("a schema-invalid document throws at the arg boundary (AD-10 gate)", async () => {
    const t = initConvexTest();
    const runId = await seedInterpretableRun(t);
    // `method` is not one of the three literals → arg validation rejects it.
    const invalid = {
      schemaVersion: "1.0.0",
      runId,
      recommendations: [{ origin: "2019", method: "not_a_method", reasons: [] }],
    };
    await expect(
      t.mutation(internal.runs.storeRecommendations, {
        runId,
        workspaceId: "org_A",
        actor: "user_a",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        recommendations: invalid as any,
        transcript: SAMPLE_ATTEMPTS,
      }),
    ).rejects.toThrow();
    expect((await getRun(t, runId))?.recommendations).toBeUndefined();
  });
});

describe("recordInterpretationRejection — failed interpretation audit (AC-2)", () => {
  test("appends run.interpretationRejected and persists NO recommendations", async () => {
    const t = initConvexTest();
    const runId = await seedInterpretableRun(t);

    await t.mutation(internal.runs.recordInterpretationRejection, {
      runId,
      workspaceId: "org_A",
      actor: "user_a",
      transcript: SAMPLE_ATTEMPTS,
      rejections: "interpretation failed after 3 attempts",
    });

    const audits = (await auditRows(t)).filter(
      (a) => a.eventType === "run.interpretationRejected",
    );
    expect(audits).toHaveLength(1);
    expect(audits[0].payload).toMatchObject({ runId });
    expect((await getRun(t, runId))?.recommendations).toBeUndefined();
  });
});

describe("getRecommendations + getRun.hasRecommendations (AC-3)", () => {
  test("returns the stored document for a member; getRun exposes hasRecommendations", async () => {
    const t = initConvexTest();
    const runId = await seedInterpretableRun(t);
    const recommendations = makeRecommendations(runId);
    await t.mutation(internal.runs.storeRecommendations, {
      runId,
      workspaceId: "org_A",
      actor: "user_a",
      recommendations,
      transcript: SAMPLE_ATTEMPTS,
    });

    const got = await t
      .withIdentity(analystA)
      .query(api.runs.getRecommendations, { workspaceId: "org_A", runId });
    expect(got).toEqual(recommendations);

    const lean = await t
      .withIdentity(analystA)
      .query(api.runs.getRun, { workspaceId: "org_A", runId });
    expect(lean?.hasRecommendations).toBe(true);
  });

  test("cross-tenant read returns null (existence not leaked)", async () => {
    const t = initConvexTest();
    const runId = await seedInterpretableRun(t, { workspaceId: "org_A" });
    const got = await t
      .withIdentity(analystB)
      .query(api.runs.getRecommendations, { workspaceId: "org_B", runId });
    expect(got).toBeNull();
  });

  test("hasRecommendations is false before any interpretation", async () => {
    const t = initConvexTest();
    const runId = await seedInterpretableRun(t);
    const lean = await t
      .withIdentity(analystA)
      .query(api.runs.getRun, { workspaceId: "org_A", runId });
    expect(lean?.hasRecommendations).toBe(false);
  });
});

describe("generateRecommendations action — persist / audit / fail-closed (AC-2, AC-3, AD-9)", () => {
  beforeEach(() => {
    vi.stubEnv("ENGINE_SERVICE_URL", "http://engine.test");
    vi.stubEnv("ENGINE_SERVICE_SECRET", "test-secret");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  test("accepted → persists the document + audits the transcript", async () => {
    const t = initConvexTest();
    const runId = await seedInterpretableRun(t);
    const engineResponse = {
      status: "accepted",
      recommendations: makeRecommendations(runId),
      attempts: SAMPLE_ATTEMPTS,
      rejectionSummary: null,
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(engineResponse));
    vi.stubGlobal("fetch", fetchMock);

    const out = await t
      .withIdentity(analystA)
      .action(api.runs.generateRecommendations, { workspaceId: "org_A", runId });

    expect(out).toEqual({ status: "accepted" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://engine.test/recommendations");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.runId).toBe(runId);
    expect(body.resultSet).toBeDefined();
    expect(body.diagnosticsBundle).toBeDefined();

    expect((await getRun(t, runId))?.recommendations).toEqual(makeRecommendations(runId));
    const audits = (await auditRows(t)).filter((a) => a.eventType === "run.recommended");
    expect(audits).toHaveLength(1);
  });

  test("rejected → audits run.interpretationRejected, persists no recommendations", async () => {
    const t = initConvexTest();
    const runId = await seedInterpretableRun(t);
    const engineResponse = {
      status: "rejected",
      recommendations: null,
      attempts: SAMPLE_ATTEMPTS,
      rejectionSummary: "interpretation failed after 3 attempts",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(engineResponse)));

    const out = await t
      .withIdentity(analystA)
      .action(api.runs.generateRecommendations, { workspaceId: "org_A", runId });

    expect(out).toEqual({ status: "rejected" });
    expect((await getRun(t, runId))?.recommendations).toBeUndefined();
    const audits = (await auditRows(t)).filter(
      (a) => a.eventType === "run.interpretationRejected",
    );
    expect(audits).toHaveLength(1);
  });

  test("engine model_unavailable propagates as engine.model_unavailable (AD-9)", async () => {
    const t = initConvexTest();
    const runId = await seedInterpretableRun(t);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          { code: "model_unavailable", message: "not configured" },
          503,
        ),
      ),
    );

    let code: string | undefined;
    try {
      await t
        .withIdentity(analystA)
        .action(api.runs.generateRecommendations, { workspaceId: "org_A", runId });
    } catch (error) {
      code = (error as ConvexError<{ code: string }>).data.code;
    }
    expect(code).toBe("engine.model_unavailable");
    expect((await getRun(t, runId))?.recommendations).toBeUndefined();
  });

  test("a non-interpretable run is RUN_NOT_INTERPRETABLE (no engine call)", async () => {
    const t = initConvexTest();
    const triangleId = await seedValidatedTriangle(t);
    const runId = await seedRun(t, triangleId, "running");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    let code: string | undefined;
    try {
      await t
        .withIdentity(analystA)
        .action(api.runs.generateRecommendations, { workspaceId: "org_A", runId });
    } catch (error) {
      code = (error as ConvexError<{ code: string }>).data.code;
    }
    expect(code).toBe("RUN_NOT_INTERPRETABLE");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("unauthenticated is rejected before the engine call (AD-4)", async () => {
    const t = initConvexTest();
    const runId = await seedInterpretableRun(t);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    let code: string | undefined;
    try {
      await t.action(api.runs.generateRecommendations, { workspaceId: "org_A", runId });
    } catch (error) {
      code = (error as ConvexError<{ code: string }>).data.code;
    }
    expect(code).toBe("UNAUTHENTICATED");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// --- Story 5.4: Reserve Report drafting (persistence + audit + action) -------

/** A schema-valid ReserveReport document whose runId matches the given run. */
function makeReserveReport(runId: string) {
  const cite = `dx:${runId}:ave:2019`;
  const section = (text: string, citations: string[] = [cite]) => ({ text, citations });
  return {
    schemaVersion: "1.0.0",
    runId,
    machineDrafted: true,
    executiveSummary: section("The overall position is stable."),
    methodSelectionRationale: section("Chain ladder was chosen."),
    movementCommentary: section("No notable movements."),
    // A purely-qualitative caveat with no citation — legitimate (§Section minima).
    limitations: section("Estimates carry uncertainty.", []),
  };
}

/**
 * Seed a `complete` run carrying a ResultSet + DiagnosticsBundle + accepted
 * Recommendations (report-drafting-ready — AC-1 precondition).
 */
async function seedReportReadyRun(
  t: Harness,
  { workspaceId = "org_A" } = {},
): Promise<Id<"runs">> {
  const triangleId = await seedValidatedTriangle(t, workspaceId);
  const runId = await t.run((ctx) =>
    ctx.db.insert("runs", {
      workspaceId,
      triangleId,
      triangleHash: TRIANGLE_HASH,
      status: "complete",
      parameters: { methods: ["chain_ladder"], aprioriLossRatios: [] },
      createdBy: "user_seed",
      createdAt: "2026-07-18T00:00:00.000Z",
      resultSet: makeResultSet(TRIANGLE_HASH),
      diagnosticsBundle: makeDiagnosticsBundle("seed", TRIANGLE_HASH),
      completedAt: "2026-07-18T02:00:00.000Z",
    }),
  );
  await t.run((ctx) =>
    ctx.db.patch(runId, { recommendations: makeRecommendations(runId as string) }),
  );
  return runId;
}

async function reserveReportRows(t: Harness) {
  return await t.run((ctx) => ctx.db.query("reserveReports").collect());
}

describe("storeReserveReport — persistence + audit + upsert (AC-2, AC-3)", () => {
  test("inserts a draft row + appends report.drafted with the transcript", async () => {
    const t = initConvexTest();
    const runId = await seedInterpretableRun(t);
    const report = makeReserveReport(runId);

    await t.mutation(internal.runs.storeReserveReport, {
      runId,
      workspaceId: "org_A",
      actor: "user_a",
      report,
      transcript: SAMPLE_ATTEMPTS,
    });

    const rows = await reserveReportRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("draft");
    expect(rows[0].machineDrafted).toBe(true);
    expect(rows[0].runId).toBe(runId);
    expect(rows[0].report).toEqual(report);
    expect(rows[0].createdBy).toBe("user_a");

    const audits = (await auditRows(t)).filter((a) => a.eventType === "report.drafted");
    expect(audits).toHaveLength(1);
    expect(audits[0].runId).toBe(runId);
    expect(audits[0].payload).toMatchObject({ runId });
    expect(audits[0].payload.transcript).toEqual(SAMPLE_ATTEMPTS);
  });

  test("a second call upserts (patches the same row, no duplicate)", async () => {
    const t = initConvexTest();
    const runId = await seedInterpretableRun(t);

    await t.mutation(internal.runs.storeReserveReport, {
      runId,
      workspaceId: "org_A",
      actor: "user_a",
      report: makeReserveReport(runId),
      transcript: SAMPLE_ATTEMPTS,
    });
    // Re-draft: a different section text overwrites in place.
    const redrafted = makeReserveReport(runId);
    redrafted.executiveSummary = {
      text: "A revised position.",
      citations: [`dx:${runId}:ave:2019`],
    };
    await t.mutation(internal.runs.storeReserveReport, {
      runId,
      workspaceId: "org_A",
      actor: "user_b",
      report: redrafted,
      transcript: SAMPLE_ATTEMPTS,
    });

    const rows = await reserveReportRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0].report.executiveSummary.text).toBe("A revised position.");
    expect(rows[0].createdBy).toBe("user_b");
    // Two drafting events audited (both attempts are on the chain).
    expect((await auditRows(t)).filter((a) => a.eventType === "report.drafted")).toHaveLength(2);
  });

  test("no-op on a non-complete run (guarded)", async () => {
    const t = initConvexTest();
    const triangleId = await seedValidatedTriangle(t);
    const runId = await seedRun(t, triangleId, "running");

    await t.mutation(internal.runs.storeReserveReport, {
      runId,
      workspaceId: "org_A",
      actor: "user_a",
      report: makeReserveReport(runId),
      transcript: SAMPLE_ATTEMPTS,
    });

    expect(await reserveReportRows(t)).toHaveLength(0);
    expect((await auditRows(t)).filter((a) => a.eventType === "report.drafted")).toHaveLength(0);
  });

  test("no-op on a cross-tenant workspace mismatch", async () => {
    const t = initConvexTest();
    const runId = await seedInterpretableRun(t, { workspaceId: "org_A" });
    await t.mutation(internal.runs.storeReserveReport, {
      runId,
      workspaceId: "org_B",
      actor: "user_b",
      report: makeReserveReport(runId),
      transcript: SAMPLE_ATTEMPTS,
    });
    expect(await reserveReportRows(t)).toHaveLength(0);
  });

  test("a runId mismatch throws REPORT_RUN_MISMATCH (never stored)", async () => {
    const t = initConvexTest();
    const runId = await seedInterpretableRun(t);
    let code: string | undefined;
    try {
      await t.mutation(internal.runs.storeReserveReport, {
        runId,
        workspaceId: "org_A",
        actor: "user_a",
        report: makeReserveReport("some-other-run"),
        transcript: SAMPLE_ATTEMPTS,
      });
    } catch (error) {
      code = (error as ConvexError<{ code: string }>).data.code;
    }
    expect(code).toBe("REPORT_RUN_MISMATCH");
    expect(await reserveReportRows(t)).toHaveLength(0);
  });

  test("a schema-invalid document throws at the arg boundary (AD-10 gate)", async () => {
    const t = initConvexTest();
    const runId = await seedInterpretableRun(t);
    // Missing a section (limitations) → arg validation rejects it.
    const invalid = {
      schemaVersion: "1.0.0",
      runId,
      machineDrafted: true,
      executiveSummary: { text: "x", citations: [] },
      methodSelectionRationale: { text: "y", citations: [] },
      movementCommentary: { text: "z", citations: [] },
    };
    await expect(
      t.mutation(internal.runs.storeReserveReport, {
        runId,
        workspaceId: "org_A",
        actor: "user_a",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        report: invalid as any,
        transcript: SAMPLE_ATTEMPTS,
      }),
    ).rejects.toThrow();
    expect(await reserveReportRows(t)).toHaveLength(0);
  });
});

describe("recordReportDraftRejection — failed drafting audit (AC-2)", () => {
  test("appends report.draftRejected and persists NO report", async () => {
    const t = initConvexTest();
    const runId = await seedInterpretableRun(t);

    await t.mutation(internal.runs.recordReportDraftRejection, {
      runId,
      workspaceId: "org_A",
      actor: "user_a",
      transcript: SAMPLE_ATTEMPTS,
      rejections: "reserve report drafting failed after 3 attempts",
    });

    const audits = (await auditRows(t)).filter(
      (a) => a.eventType === "report.draftRejected",
    );
    expect(audits).toHaveLength(1);
    expect(audits[0].payload).toMatchObject({ runId });
    expect(await reserveReportRows(t)).toHaveLength(0);
  });
});

describe("getReserveReport + getRun.hasReserveReport (AC-3)", () => {
  test("returns the stored row for a member; getRun exposes hasReserveReport", async () => {
    const t = initConvexTest();
    const runId = await seedInterpretableRun(t);
    const report = makeReserveReport(runId);
    await t.mutation(internal.runs.storeReserveReport, {
      runId,
      workspaceId: "org_A",
      actor: "user_a",
      report,
      transcript: SAMPLE_ATTEMPTS,
    });

    const got = await t
      .withIdentity(analystA)
      .query(api.runs.getReserveReport, { workspaceId: "org_A", runId });
    expect(got?.report).toEqual(report);
    expect(got?.status).toBe("draft");

    const lean = await t
      .withIdentity(analystA)
      .query(api.runs.getRun, { workspaceId: "org_A", runId });
    expect(lean?.hasReserveReport).toBe(true);
  });

  test("cross-tenant read returns null (existence not leaked)", async () => {
    const t = initConvexTest();
    const runId = await seedInterpretableRun(t, { workspaceId: "org_A" });
    const got = await t
      .withIdentity(analystB)
      .query(api.runs.getReserveReport, { workspaceId: "org_B", runId });
    expect(got).toBeNull();
  });

  test("null + hasReserveReport false before any drafting", async () => {
    const t = initConvexTest();
    const runId = await seedInterpretableRun(t);
    const got = await t
      .withIdentity(analystA)
      .query(api.runs.getReserveReport, { workspaceId: "org_A", runId });
    expect(got).toBeNull();
    const lean = await t
      .withIdentity(analystA)
      .query(api.runs.getRun, { workspaceId: "org_A", runId });
    expect(lean?.hasReserveReport).toBe(false);
  });
});

describe("generateReserveReport action — persist / audit / fail-closed (AC-2, AC-3, AC-4, AD-9)", () => {
  beforeEach(() => {
    vi.stubEnv("ENGINE_SERVICE_URL", "http://engine.test");
    vi.stubEnv("ENGINE_SERVICE_SECRET", "test-secret");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  test("accepted → persists the document + audits the transcript", async () => {
    const t = initConvexTest();
    const runId = await seedReportReadyRun(t);
    const engineResponse = {
      status: "accepted",
      report: makeReserveReport(runId),
      attempts: SAMPLE_ATTEMPTS,
      rejectionSummary: null,
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(engineResponse));
    vi.stubGlobal("fetch", fetchMock);

    const out = await t
      .withIdentity(analystA)
      .action(api.runs.generateReserveReport, { workspaceId: "org_A", runId });

    expect(out).toEqual({ status: "accepted" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://engine.test/reports");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.runId).toBe(runId);
    expect(body.resultSet).toBeDefined();
    expect(body.diagnosticsBundle).toBeDefined();
    expect(body.recommendations).toBeDefined();

    const rows = await reserveReportRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0].report).toEqual(makeReserveReport(runId));
    const audits = (await auditRows(t)).filter((a) => a.eventType === "report.drafted");
    expect(audits).toHaveLength(1);
  });

  test("rejected → audits report.draftRejected, persists no report", async () => {
    const t = initConvexTest();
    const runId = await seedReportReadyRun(t);
    const engineResponse = {
      status: "rejected",
      report: null,
      attempts: SAMPLE_ATTEMPTS,
      rejectionSummary: "reserve report drafting failed after 3 attempts",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(engineResponse)));

    const out = await t
      .withIdentity(analystA)
      .action(api.runs.generateReserveReport, { workspaceId: "org_A", runId });

    expect(out).toEqual({ status: "rejected" });
    expect(await reserveReportRows(t)).toHaveLength(0);
    const audits = (await auditRows(t)).filter(
      (a) => a.eventType === "report.draftRejected",
    );
    expect(audits).toHaveLength(1);
  });

  test("engine model_unavailable propagates as engine.model_unavailable (AD-9)", async () => {
    const t = initConvexTest();
    const runId = await seedReportReadyRun(t);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ code: "model_unavailable", message: "not configured" }, 503),
      ),
    );

    let code: string | undefined;
    try {
      await t
        .withIdentity(analystA)
        .action(api.runs.generateReserveReport, { workspaceId: "org_A", runId });
    } catch (error) {
      code = (error as ConvexError<{ code: string }>).data.code;
    }
    expect(code).toBe("engine.model_unavailable");
    expect(await reserveReportRows(t)).toHaveLength(0);
  });

  test("a run without accepted recommendations is RUN_NOT_INTERPRETABLE (no engine call)", async () => {
    const t = initConvexTest();
    // A complete run WITH results + diagnostics but NO recommendations.
    const runId = await seedInterpretableRun(t);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    let code: string | undefined;
    try {
      await t
        .withIdentity(analystA)
        .action(api.runs.generateReserveReport, { workspaceId: "org_A", runId });
    } catch (error) {
      code = (error as ConvexError<{ code: string }>).data.code;
    }
    expect(code).toBe("RUN_NOT_INTERPRETABLE");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("unauthenticated is rejected before the engine call (AD-4)", async () => {
    const t = initConvexTest();
    const runId = await seedReportReadyRun(t);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    let code: string | undefined;
    try {
      await t.action(api.runs.generateReserveReport, { workspaceId: "org_A", runId });
    } catch (error) {
      code = (error as ConvexError<{ code: string }>).data.code;
    }
    expect(code).toBe("UNAUTHENTICATED");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
