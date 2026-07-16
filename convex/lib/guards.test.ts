import { convexTest, type TestConvex } from "convex-test";
import { anyApi } from "convex/server";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { fixtureModules } from "../../tests/convex-fixtures/modules";
import { fixtureSchema } from "../../tests/convex-fixtures/schema";
import { normalizeRole } from "./guards";

const fixtures = anyApi.fixtures;

const userA = { subject: "user_a", org_id: "org_A", org_role: "org:analyst" };
const seniorA = {
  subject: "user_s",
  org_id: "org_A",
  org_role: "org:senior_actuary",
};

function harness(): TestConvex<typeof fixtureSchema> {
  return convexTest(fixtureSchema, fixtureModules);
}

async function expectGuardError(
  promise: Promise<unknown>,
  code: "UNAUTHENTICATED" | "FORBIDDEN",
) {
  let caught: unknown;
  try {
    await promise;
    expect.unreachable("expected the guarded call to reject");
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ConvexError);
  expect((caught as ConvexError<{ code: string }>).data.code).toBe(code);
}

describe("requireMember", () => {
  test("unauthenticated call rejects with UNAUTHENTICATED", async () => {
    const t = harness();
    await expectGuardError(
      t.query(fixtures.readScoped, { workspaceId: "org_A" }),
      "UNAUTHENTICATED",
    );
    await expectGuardError(
      t.mutation(fixtures.writeScoped, { workspaceId: "org_A", value: "x" }),
      "UNAUTHENTICATED",
    );
  });

  test("member reads and writes their own Workspace", async () => {
    const t = harness();
    const asA = t.withIdentity(userA);
    await asA.mutation(fixtures.writeScoped, {
      workspaceId: "org_A",
      value: "a-data",
    });
    const rows = await asA.query(fixtures.readScoped, { workspaceId: "org_A" });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ workspaceId: "org_A", value: "a-data" });
  });

  test("member of Workspace A cannot read or write Workspace B data", async () => {
    const t = harness();
    // Seed a B-scoped row directly (no auth path) so there is real data to protect.
    await t.run(async (ctx) => {
      await ctx.db.insert("guardFixtures", {
        workspaceId: "org_B",
        value: "b-secret",
      });
    });

    const asA = t.withIdentity(userA);
    await expectGuardError(
      asA.query(fixtures.readScoped, { workspaceId: "org_B" }),
      "FORBIDDEN",
    );
    await expectGuardError(
      asA.mutation(fixtures.writeScoped, {
        workspaceId: "org_B",
        value: "a-intrusion",
      }),
      "FORBIDDEN",
    );

    // The B-scoped data is provably untouched: still exactly one row, unchanged.
    const bRows = await t.run(async (ctx) =>
      ctx.db
        .query("guardFixtures")
        .filter((q) => q.eq(q.field("workspaceId"), "org_B"))
        .collect(),
    );
    expect(bRows).toHaveLength(1);
    expect(bRows[0].value).toBe("b-secret");
  });

  test("identity with no org claims rejects with FORBIDDEN", async () => {
    const t = harness();
    const noOrg = t.withIdentity({ subject: "user_no_org" });
    await expectGuardError(
      noOrg.query(fixtures.readScoped, { workspaceId: "org_A" }),
      "FORBIDDEN",
    );
  });

  test("empty org_id claim cannot match an empty workspaceId (fail closed)", async () => {
    const t = harness();
    const emptyOrg = t.withIdentity({
      subject: "user_empty_org",
      org_id: "",
      org_role: "org:analyst",
    });
    await expectGuardError(
      emptyOrg.query(fixtures.readScoped, { workspaceId: "" }),
      "FORBIDDEN",
    );
  });

  test("malformed role claim (bare org: prefix) rejects with FORBIDDEN", async () => {
    const t = harness();
    const malformedRole = t.withIdentity({
      subject: "user_malformed_role",
      org_id: "org_A",
      org_role: "org:",
    });
    await expectGuardError(
      malformedRole.query(fixtures.readScoped, { workspaceId: "org_A" }),
      "FORBIDDEN",
    );
  });
});

describe("requireRole", () => {
  test("analyst is FORBIDDEN from a senior_actuary path", async () => {
    const t = harness();
    const asA = t.withIdentity(userA);
    await expectGuardError(
      asA.mutation(fixtures.approveScoped, { workspaceId: "org_A" }),
      "FORBIDDEN",
    );
  });

  test("senior_actuary passes the senior_actuary gate", async () => {
    const t = harness();
    const asSenior = t.withIdentity(seniorA);
    await expect(
      asSenior.mutation(fixtures.approveScoped, { workspaceId: "org_A" }),
    ).resolves.toBe("approved");
  });

  test("senior_actuary must still be a member of the target Workspace", async () => {
    const t = harness();
    const asSenior = t.withIdentity(seniorA);
    await expectGuardError(
      asSenior.mutation(fixtures.approveScoped, { workspaceId: "org_B" }),
      "FORBIDDEN",
    );
  });
});

describe("normalizeRole", () => {
  test("strips the Clerk org: prefix", () => {
    expect(normalizeRole("org:analyst")).toBe("analyst");
    expect(normalizeRole("org:senior_actuary")).toBe("senior_actuary");
  });

  test("accepts an already-bare slug", () => {
    expect(normalizeRole("senior_actuary")).toBe("senior_actuary");
  });

  test("rejects missing or non-string claims", () => {
    expect(normalizeRole(undefined)).toBeNull();
    expect(normalizeRole("")).toBeNull();
    expect(normalizeRole(42)).toBeNull();
  });

  test("a bare org: prefix with no slug normalizes to null, not empty string", () => {
    expect(normalizeRole("org:")).toBeNull();
  });
});
