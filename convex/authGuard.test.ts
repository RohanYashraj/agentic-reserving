/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import {
  makeFunctionReference,
  type GenericSchema,
  type SchemaDefinition,
} from "convex/server";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import {
  fixtureModules,
  fixtureModulesEager,
} from "../tests/convex-fixtures/modules";
import { fixtureSchema } from "../tests/convex-fixtures/schema";
import schema from "./schema";

// NFR-3 / AD-4 enforcement: enumerate every public Convex function and assert
// it rejects unauthenticated calls. This suite is the permanent guardrail —
// adding a public function without registering minimally-valid args below
// fails the build, on purpose.

// convex.config.ts is the component-definition build artifact (app.use of the
// workflow component, Story 4.2). It uses defineApp/`.use`, which only load
// inside the Convex runtime — importing it under vitest throws. It defines no
// public functions, so exclude it from enumeration (both globs).
const realModules = import.meta.glob([
  "./**/*.ts",
  "!./**/*.test.ts",
  "!./convex.config.ts",
  "./_generated/**/*.js",
]);
const realModulesEager: Record<string, Record<string, unknown>> =
  import.meta.glob(
    ["./**/*.ts", "!./**/*.test.ts", "!./convex.config.ts", "!./_generated/**"],
    {
      eager: true,
    },
  );

/**
 * Convex validates args BEFORE the handler (and therefore before the guard)
 * runs, so every enumerated function needs minimally-valid args to reach
 * requireMember. Every public function MUST have an entry here.
 */
const publicFunctionArgs: Record<string, Record<string, unknown>> = {
  // "module:functionName": { ...minimally valid args }
  "auditLogs:verifyChain": { workspaceId: "org_test" },
  "triangles:generateUploadUrl": { workspaceId: "org_test" },
  // storageId is injected at call time from a real ctx.storage.store below —
  // Convex validates v.id("_storage") before the guard runs, so a fake id
  // string would fail validation instead of reaching requireMember.
  "triangles:createFromUpload": {
    workspaceId: "org_test",
    label: "paid",
    filename: "triangle.csv",
  },
  "triangles:listByWorkspace": { workspaceId: "org_test" },
  // triangleId is a v.id("triangles") validated before the guard runs — a real
  // row id is injected at call time (like createFromUpload's storageId).
  "triangles:validateTriangle": { workspaceId: "org_test" },
  // acceptTriangle validates its confirmed-period/periodMeta args before the
  // guard runs; supply minimal label arrays here, triangleId injected.
  "triangles:acceptTriangle": {
    workspaceId: "org_test",
    confirmedOriginPeriods: ["2019"],
    confirmedDevelopmentPeriods: ["12"],
    periodMeta: { originGranularity: "annual", developmentInterval: "months" },
  },
  "triangles:getById": { workspaceId: "org_test" },
  // createRun validates parameters (runParametersValidator) before the guard
  // runs; supply a minimal valid set. triangleId injected at call time.
  "runs:createRun": {
    workspaceId: "org_test",
    parameters: { methods: ["chain_ladder"], aprioriLossRatios: [] },
  },
  // getRun/getResultSet/getDiagnosticsBundle/retryRun take a v.id("runs")
  // validated before the guard runs — a real run row id is injected at call time
  // (like createRun's triangleId).
  "runs:getRun": { workspaceId: "org_test" },
  "runs:getResultSet": { workspaceId: "org_test" },
  "runs:getDiagnosticsBundle": { workspaceId: "org_test" },
  "runs:getRecommendations": { workspaceId: "org_test" },
  // Story 6.3 — the two new public override functions, both taking a v.id("runs")
  // (real runId injected below). overrideRecommendation also validates origin +
  // overridingMethod (methodValidator) + reason before the guard, so supply them.
  // It is requireRole(senior_actuary), but requireRole calls requireMember first,
  // so an unauthenticated caller is still rejected with UNAUTHENTICATED (the role
  // rejection is proven separately in convex/runs.test.ts). getRecommendationOverrides
  // is a requireMember query (workspaceId + runId).
  "runs:overrideRecommendation": {
    workspaceId: "org_test",
    origin: "2020",
    overridingMethod: "bornhuetter_ferguson",
    reason: "test",
  },
  "runs:getRecommendationOverrides": { workspaceId: "org_test" },
  "runs:getReserveReport": { workspaceId: "org_test" },
  "runs:retryRun": { workspaceId: "org_test" },
  // rederiveRun (Story 4.7) is a public ACTION; requireMember is its first
  // statement, so an unauthenticated call is rejected before the engine fetch.
  "runs:rederiveRun": { workspaceId: "org_test" },
  // generateRecommendations (Story 5.3) is a public ACTION; requireMember is its
  // first statement, so an unauthenticated call is rejected before the engine call.
  "runs:generateRecommendations": { workspaceId: "org_test" },
  // generateReserveReport (Story 5.4) is a public ACTION; requireMember is its
  // first statement, so an unauthenticated call is rejected before the engine call.
  "runs:generateReserveReport": { workspaceId: "org_test" },
  // Story 6.1 — the two new public report mutations. Both take a v.id("runs")
  // validated before the guard runs (real runId injected below); editReserveReport
  // also validates its `sections` object before the guard, so supply the four
  // empty section texts here. requireMember is the first statement of each (AD-4).
  "runs:editReserveReport": {
    workspaceId: "org_test",
    sections: {
      executiveSummary: "",
      methodSelectionRationale: "",
      movementCommentary: "",
      limitations: "",
    },
  },
  "runs:createManualReport": { workspaceId: "org_test" },
  // Story 6.2 — the two new public functions. submitReportForReview is a
  // mutation taking a v.id("runs") (real runId injected below); `assignee` is
  // optional so omit it. listReportsAwaitingReview is a query (workspaceId
  // only). requireMember is the first statement of each (AD-4).
  "runs:submitReportForReview": { workspaceId: "org_test" },
  "runs:listReportsAwaitingReview": { workspaceId: "org_test" },
  // Story 5.6 — the two new public Engine-Only Mode functions. getInterpretationMode
  // is a query, probeInterpretationMode is an ACTION; each has requireMember as its
  // first statement (AD-4). Neither takes a v.id("runs"), so no runId injection.
  "interpretationMode:getInterpretationMode": { workspaceId: "org_test" },
  "interpretationMode:probeInterpretationMode": { workspaceId: "org_test" },
};

type Harness = TestConvex<SchemaDefinition<GenericSchema, boolean>>;

type PublicFunction = {
  path: string;
  call: (t: Harness, args: Record<string, unknown>) => Promise<unknown>;
};

function collectPublicFunctions(
  modules: Record<string, Record<string, unknown>>,
): PublicFunction[] {
  const found: PublicFunction[] = [];
  for (const [file, mod] of Object.entries(modules)) {
    if (file.includes("_generated")) {
      continue;
    }
    const modulePath = file.replace(/^\.\//, "").replace(/\.[^.]+$/, "");
    for (const [exportName, value] of Object.entries(mod)) {
      if (
        (typeof value === "function" || typeof value === "object") &&
        value !== null &&
        (value as { isPublic?: boolean }).isPublic === true
      ) {
        const fn = value as {
          isQuery?: boolean;
          isMutation?: boolean;
          isAction?: boolean;
        };
        const path = `${modulePath}:${exportName}`;
        if (fn.isQuery) {
          found.push({
            path,
            call: (t, args) =>
              t.query(makeFunctionReference<"query">(path), args),
          });
        } else if (fn.isMutation) {
          found.push({
            path,
            call: (t, args) =>
              t.mutation(makeFunctionReference<"mutation">(path), args),
          });
        } else if (fn.isAction) {
          found.push({
            path,
            call: (t, args) =>
              t.action(makeFunctionReference<"action">(path), args),
          });
        } else {
          throw new Error(
            `${path} is public but neither query, mutation, nor action — extend the enumeration`,
          );
        }
      }
    }
  }
  return found.sort((a, b) => a.path.localeCompare(b.path));
}

async function assertRejectsUnauthenticated(
  t: Harness,
  fn: PublicFunction,
  args: Record<string, unknown>,
) {
  const call = fn.call(t, args);
  let caught: unknown;
  try {
    await call;
    expect.unreachable(`${fn.path} accepted an unauthenticated call`);
  } catch (error) {
    caught = error;
  }
  expect(caught, `${fn.path} must throw ConvexError`).toBeInstanceOf(
    ConvexError,
  );
  expect(
    (caught as ConvexError<{ code: string }>).data.code,
    `${fn.path} must reject unauthenticated calls with UNAUTHENTICATED`,
  ).toBe("UNAUTHENTICATED");
}

describe("auth-guard enumeration (NFR-3)", () => {
  const publicFunctions = collectPublicFunctions(realModulesEager);

  test("every public function has registered args (registry is exhaustive)", () => {
    const unregistered = publicFunctions
      .map((fn) => fn.path)
      .filter((path) => !(path in publicFunctionArgs));
    expect(
      unregistered,
      `Public function(s) missing from publicFunctionArgs in convex/authGuard.test.ts: ` +
        `${unregistered.join(", ")}. Every public function must be registered ` +
        `with minimally-valid args so this suite can prove it rejects ` +
        `unauthenticated calls (AD-4).`,
    ).toEqual([]);

    const stale = Object.keys(publicFunctionArgs).filter(
      (path) => !publicFunctions.some((fn) => fn.path === path),
    );
    expect(
      stale,
      `Registry entries with no matching public function: ${stale.join(", ")}`,
    ).toEqual([]);
  });

  test("every public function rejects unauthenticated calls", async () => {
    const t = convexTest(schema, realModules);
    // Some functions (triangles:createFromUpload) take a v.id("_storage")
    // that must be a genuine stored id to pass arg validation before the
    // guard runs. Seed one real blob and inject its id per call.
    const storageId = await t.run(
      async (ctx) => await ctx.storage.store(new Blob(["seed"])),
    );
    // validateTriangle needs a real v.id("triangles"); seed a minimal row.
    const triangleId = await t.run(
      async (ctx) =>
        await ctx.db.insert("triangles", {
          workspaceId: "org_test",
          label: "paid",
          status: "pending_validation",
          format: "csv",
          storageId,
          rawFileHash: "seedhash",
          filename: "triangle.csv",
          uploadedBy: "user_seed",
          uploadedAt: "2026-07-18T00:00:00.000Z",
        }),
    );
    // getRun/retryRun need a real v.id("runs"); seed a minimal queued run.
    const runId = await t.run(
      async (ctx) =>
        await ctx.db.insert("runs", {
          workspaceId: "org_test",
          triangleId,
          triangleHash: "seedhash",
          status: "queued",
          parameters: { methods: ["chain_ladder"], aprioriLossRatios: [] },
          createdBy: "user_seed",
          createdAt: "2026-07-19T00:00:00.000Z",
        }),
    );
    const argsFor = (path: string): Record<string, unknown> => {
      if (path === "triangles:createFromUpload") {
        return { ...publicFunctionArgs[path], storageId };
      }
      if (
        path === "triangles:validateTriangle" ||
        path === "triangles:acceptTriangle" ||
        path === "triangles:getById" ||
        path === "runs:createRun"
      ) {
        return { ...publicFunctionArgs[path], triangleId };
      }
      if (
        path === "runs:getRun" ||
        path === "runs:getResultSet" ||
        path === "runs:getDiagnosticsBundle" ||
        path === "runs:getRecommendations" ||
        path === "runs:overrideRecommendation" ||
        path === "runs:getRecommendationOverrides" ||
        path === "runs:getReserveReport" ||
        path === "runs:retryRun" ||
        path === "runs:rederiveRun" ||
        path === "runs:generateRecommendations" ||
        path === "runs:generateReserveReport" ||
        path === "runs:editReserveReport" ||
        path === "runs:createManualReport" ||
        path === "runs:submitReportForReview"
      ) {
        return { ...publicFunctionArgs[path], runId };
      }
      return publicFunctionArgs[path];
    };
    for (const fn of publicFunctions) {
      await assertRejectsUnauthenticated(t, fn, argsFor(fn.path));
    }
  });

  // Guard the guard: prove the enumeration actually detects public functions
  // by pointing it at the test fixtures. An empty-glob or broken-marker bug
  // cannot silently green this suite.
  describe("self-check against fixtures", () => {
    const fixtureArgs: Record<string, Record<string, unknown>> = {
      "fixtures:readScoped": { workspaceId: "org_A" },
      "fixtures:writeScoped": { workspaceId: "org_A", value: "x" },
      "fixtures:approveScoped": { workspaceId: "org_A" },
    };

    test("enumeration finds the fixture public functions", () => {
      const found = collectPublicFunctions(fixtureModulesEager);
      expect(found.map((fn) => fn.path)).toEqual([
        "fixtures:approveScoped",
        "fixtures:readScoped",
        "fixtures:writeScoped",
      ]);
    });

    test("enumerated fixture functions reject unauthenticated calls", async () => {
      const t = convexTest(fixtureSchema, fixtureModules);
      for (const fn of collectPublicFunctions(fixtureModulesEager)) {
        await assertRejectsUnauthenticated(t, fn, fixtureArgs[fn.path]);
      }
    });
  });
});
