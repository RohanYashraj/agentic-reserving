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

const realModules = import.meta.glob([
  "./**/*.ts",
  "!./**/*.test.ts",
  "./_generated/**/*.js",
]);
const realModulesEager: Record<string, Record<string, unknown>> =
  import.meta.glob(["./**/*.ts", "!./**/*.test.ts", "!./_generated/**"], {
    eager: true,
  });

/**
 * Convex validates args BEFORE the handler (and therefore before the guard)
 * runs, so every enumerated function needs minimally-valid args to reach
 * requireMember. Every public function MUST have an entry here.
 */
const publicFunctionArgs: Record<string, Record<string, unknown>> = {
  // "module:functionName": { ...minimally valid args }
};

type PublicFunction = {
  path: string;
  kind: "query" | "mutation" | "action";
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
        const kind = fn.isQuery
          ? "query"
          : fn.isMutation
            ? "mutation"
            : fn.isAction
              ? "action"
              : null;
        if (kind === null) {
          throw new Error(
            `${modulePath}:${exportName} is public but neither query, mutation, nor action — extend the enumeration`,
          );
        }
        found.push({ path: `${modulePath}:${exportName}`, kind });
      }
    }
  }
  return found.sort((a, b) => a.path.localeCompare(b.path));
}

async function assertRejectsUnauthenticated(
  t: TestConvex<SchemaDefinition<GenericSchema, boolean>>,
  fn: PublicFunction,
  args: Record<string, unknown>,
) {
  const call =
    fn.kind === "query"
      ? t.query(makeFunctionReference<"query">(fn.path), args)
      : fn.kind === "mutation"
        ? t.mutation(makeFunctionReference<"mutation">(fn.path), args)
        : t.action(makeFunctionReference<"action">(fn.path), args);
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
    for (const fn of publicFunctions) {
      await assertRejectsUnauthenticated(t, fn, publicFunctionArgs[fn.path]);
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
      expect(found).toEqual([
        { path: "fixtures:approveScoped", kind: "mutation" },
        { path: "fixtures:readScoped", kind: "query" },
        { path: "fixtures:writeScoped", kind: "mutation" },
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
