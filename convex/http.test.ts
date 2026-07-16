/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { Webhook } from "svix";
import { afterEach, describe, expect, test, vi } from "vitest";
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

// Fake svix secrets for in-test signing, assembled at runtime so secret
// scanners don't pattern-match the whsec_ prefix (these are NOT credentials).
const WHSEC = ["wh", "sec_"].join("");
const TEST_SECRET = `${WHSEC}${btoa("story-1-4-test-secret")}`;

const membershipUpdated = JSON.stringify({
  type: "organizationMembership.updated",
  data: {
    id: "orgmem_1",
    role: "org:senior_actuary",
    organization: { id: "org_A", name: "Workspace A" },
    public_user_data: { user_id: "user_123" },
  },
});

function signedHeaders(
  payload: string,
  secret = TEST_SECRET,
  msgId = "msg_story14",
) {
  const timestamp = new Date();
  const signature = new Webhook(secret).sign(msgId, timestamp, payload);
  return {
    "content-type": "application/json",
    "svix-id": msgId,
    "svix-timestamp": Math.floor(timestamp.getTime() / 1000).toString(),
    "svix-signature": signature,
  };
}

function post(
  t: ReturnType<typeof convexTest>,
  body: string,
  headers: Record<string, string>,
) {
  return t.fetch("/clerk-users-webhook", { method: "POST", body, headers });
}

describe("POST /clerk-users-webhook", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("missing svix headers → 400", async () => {
    vi.stubEnv("CLERK_WEBHOOK_SIGNING_SECRET", TEST_SECRET);
    const t = convexTest(schema, modules);
    const response = await post(t, membershipUpdated, {
      "content-type": "application/json",
    });
    expect(response.status).toBe(400);
  });

  test("invalid signature → 400 and zero auditLogs rows", async () => {
    vi.stubEnv("CLERK_WEBHOOK_SIGNING_SECRET", TEST_SECRET);
    const t = convexTest(schema, modules);
    const headers = signedHeaders(membershipUpdated);
    headers["svix-signature"] = "v1,invalid-signature";
    const response = await post(t, membershipUpdated, headers);
    expect(response.status).toBe(400);
    const rows = await t.run((ctx) => ctx.db.query("auditLogs").collect());
    expect(rows).toHaveLength(0);
  });

  test("payload signed with the wrong secret → 400", async () => {
    vi.stubEnv("CLERK_WEBHOOK_SIGNING_SECRET", TEST_SECRET);
    const t = convexTest(schema, modules);
    const wrongSecret = `${WHSEC}${btoa("some-other-secret")}`;
    const response = await post(
      t,
      membershipUpdated,
      signedHeaders(membershipUpdated, wrongSecret),
    );
    expect(response.status).toBe(400);
  });

  test("malformed signing secret → 500, not 400 (misconfiguration is not a client error)", async () => {
    vi.stubEnv("CLERK_WEBHOOK_SIGNING_SECRET", `${WHSEC}%%%not-base64%%%`);
    const t = convexTest(schema, modules);
    const response = await post(
      t,
      membershipUpdated,
      signedHeaders(membershipUpdated),
    );
    expect(response.status).toBe(500);
  });

  // Story 1.5 decision (changed from 1.4's silent 200): a membership event
  // we recognize but cannot attribute to a Workspace fails loud so Svix
  // retries — audit completeness (NFR-5) outranks endpoint politeness.
  test("recognized membership event missing organization.id → 500, nothing recorded", async () => {
    vi.stubEnv("CLERK_WEBHOOK_SIGNING_SECRET", TEST_SECRET);
    const t = convexTest(schema, modules);
    const payload = JSON.stringify({ type: "organizationMembership.updated" });
    const response = await post(t, payload, signedHeaders(payload));
    expect(response.status).toBe(500);
    const rows = await t.run((ctx) => ctx.db.query("auditLogs").collect());
    expect(rows).toHaveLength(0);
  });

  test("missing signing secret → 500 (misconfigured deployment fails fast)", async () => {
    const t = convexTest(schema, modules);
    const response = await post(
      t,
      membershipUpdated,
      signedHeaders(membershipUpdated),
    );
    expect(response.status).toBe(500);
  });

  test("validly-signed organizationMembership.updated → 200 and a chained auditLogs row lands", async () => {
    vi.stubEnv("CLERK_WEBHOOK_SIGNING_SECRET", TEST_SECRET);
    const t = convexTest(schema, modules);
    const response = await post(
      t,
      membershipUpdated,
      signedHeaders(membershipUpdated),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      recorded: "member.role_changed",
      workspaceId: "org_A",
      actor: "user_123",
    });
    const rows = await t.run((ctx) => ctx.db.query("auditLogs").collect());
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.eventType).toBe("member.role_changed");
    expect(row.workspaceId).toBe("org_A");
    expect(row.actor).toBe("user_123");
    expect(row.seq).toBe(0);
    expect(row.prevHash).toBe(GENESIS_PREV_HASH);
    // Recompute, don't just format-check: pins that the webhook path hashes
    // exactly the canonical projection (e.g. dedupeId must NOT be hashed).
    expect(row.hash).toBe(
      await computeEntryHash(toHashableEntry(row), row.prevHash),
    );
    expect(row.dedupeId).toBe("msg_story14");
  });

  test("redelivering the same svix-id → still exactly one auditLogs row (replay idempotency)", async () => {
    vi.stubEnv("CLERK_WEBHOOK_SIGNING_SECRET", TEST_SECRET);
    const t = convexTest(schema, modules);
    const first = await post(
      t,
      membershipUpdated,
      signedHeaders(membershipUpdated),
    );
    expect(first.status).toBe(200);
    const replay = await post(
      t,
      membershipUpdated,
      signedHeaders(membershipUpdated),
    );
    expect(replay.status).toBe(200);
    const rows = await t.run((ctx) => ctx.db.query("auditLogs").collect());
    expect(rows).toHaveLength(1);
  });

  test("distinct svix-ids append distinct chained rows", async () => {
    vi.stubEnv("CLERK_WEBHOOK_SIGNING_SECRET", TEST_SECRET);
    const t = convexTest(schema, modules);
    await post(t, membershipUpdated, signedHeaders(membershipUpdated));
    await post(
      t,
      membershipUpdated,
      signedHeaders(membershipUpdated, TEST_SECRET, "msg_story15"),
    );
    const rows = await t.run((ctx) =>
      ctx.db
        .query("auditLogs")
        .withIndex("by_workspace_seq", (q) => q.eq("workspaceId", "org_A"))
        .order("asc")
        .collect(),
    );
    expect(rows.map((row) => row.seq)).toEqual([0, 1]);
    expect(rows[1].prevHash).toBe(rows[0].hash);
  });

  test("validly-signed unhandled event type → 200, nothing recorded", async () => {
    vi.stubEnv("CLERK_WEBHOOK_SIGNING_SECRET", TEST_SECRET);
    const t = convexTest(schema, modules);
    const payload = JSON.stringify({ type: "user.created", data: { id: "u" } });
    const response = await post(t, payload, signedHeaders(payload));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ recorded: null });
  });

  // Regression (code review 2026-07-16): `in` / bare indexing on the event
  // map walked the prototype chain, so a type like "toString" masqueraded
  // as a recognized membership event and 500-looped.
  test("validly-signed event with a prototype-key type (toString) → 200, nothing recorded", async () => {
    vi.stubEnv("CLERK_WEBHOOK_SIGNING_SECRET", TEST_SECRET);
    const t = convexTest(schema, modules);
    const payload = JSON.stringify({ type: "toString", data: { id: "x" } });
    const response = await post(t, payload, signedHeaders(payload));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ recorded: null });
    const rows = await t.run((ctx) => ctx.db.query("auditLogs").collect());
    expect(rows).toHaveLength(0);
  });
});

// The interface pin for the writer (formerly the recordEvent stub contract)
// lives in convex/auditLogs.test.ts alongside appendAuditEntry itself.
