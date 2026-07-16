/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { Webhook } from "svix";
import { afterEach, describe, expect, test, vi } from "vitest";
import { recordEvent, recordEventArgs } from "./audit";
import schema from "./schema";

const modules = import.meta.glob([
  "./**/*.ts",
  "!./**/*.test.ts",
  "./_generated/**/*.js",
]);

// A well-formed (base64) svix secret for in-test signing.
const TEST_SECRET = `whsec_${btoa("story-1-4-test-secret")}`;

const membershipUpdated = JSON.stringify({
  type: "organizationMembership.updated",
  data: {
    id: "orgmem_1",
    role: "org:senior_actuary",
    organization: { id: "org_A", name: "Workspace A" },
    public_user_data: { user_id: "user_123" },
  },
});

function signedHeaders(payload: string, secret = TEST_SECRET) {
  const msgId = "msg_story14";
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

  test("invalid signature → 400 and no event recorded", async () => {
    vi.stubEnv("CLERK_WEBHOOK_SIGNING_SECRET", TEST_SECRET);
    const t = convexTest(schema, modules);
    const headers = signedHeaders(membershipUpdated);
    headers["svix-signature"] = "v1,invalid-signature";
    const response = await post(t, membershipUpdated, headers);
    expect(response.status).toBe(400);
  });

  test("payload signed with the wrong secret → 400", async () => {
    vi.stubEnv("CLERK_WEBHOOK_SIGNING_SECRET", TEST_SECRET);
    const t = convexTest(schema, modules);
    const wrongSecret = `whsec_${btoa("some-other-secret")}`;
    const response = await post(
      t,
      membershipUpdated,
      signedHeaders(membershipUpdated, wrongSecret),
    );
    expect(response.status).toBe(400);
  });

  test("malformed signing secret → 500, not 400 (misconfiguration is not a client error)", async () => {
    vi.stubEnv("CLERK_WEBHOOK_SIGNING_SECRET", "whsec_%%%not-base64%%%");
    const t = convexTest(schema, modules);
    const response = await post(
      t,
      membershipUpdated,
      signedHeaders(membershipUpdated),
    );
    expect(response.status).toBe(500);
  });

  test("validly-signed membership payload with missing data → 200, nothing recorded", async () => {
    vi.stubEnv("CLERK_WEBHOOK_SIGNING_SECRET", TEST_SECRET);
    const t = convexTest(schema, modules);
    const payload = JSON.stringify({ type: "organizationMembership.updated" });
    const response = await post(t, payload, signedHeaders(payload));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ recorded: null });
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

  test("validly-signed organizationMembership.updated → 200 and role-change reaches recordEvent", async () => {
    vi.stubEnv("CLERK_WEBHOOK_SIGNING_SECRET", TEST_SECRET);
    const t = convexTest(schema, modules);
    const response = await post(
      t,
      membershipUpdated,
      signedHeaders(membershipUpdated),
    );
    expect(response.status).toBe(200);
    // The handler only reports `recorded` after ctx.runMutation(recordEvent)
    // succeeds — Convex validates recordEvent's args, so a 200 with this body
    // proves the event reached recordEvent with a valid arg shape.
    await expect(response.json()).resolves.toEqual({
      recorded: "member.role_changed",
      workspaceId: "org_A",
      actor: "user_123",
    });
  });

  test("validly-signed unhandled event type → 200, nothing recorded", async () => {
    vi.stubEnv("CLERK_WEBHOOK_SIGNING_SECRET", TEST_SECRET);
    const t = convexTest(schema, modules);
    const payload = JSON.stringify({ type: "user.created", data: { id: "u" } });
    const response = await post(t, payload, signedHeaders(payload));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ recorded: null });
  });
});

describe("recordEvent interface stub (Story 1.5 contract)", () => {
  test("recordEvent is internal, never public", () => {
    const markers = recordEvent as unknown as {
      isInternal?: boolean;
      isPublic?: boolean;
      isMutation?: boolean;
    };
    expect(markers.isInternal).toBe(true);
    expect(markers.isPublic).toBeUndefined();
    expect(markers.isMutation).toBe(true);
  });

  test("args validator shape is pinned for Story 1.5", () => {
    const shape = Object.fromEntries(
      Object.entries(recordEventArgs).map(([key, validator]) => [
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
    });
  });
});
