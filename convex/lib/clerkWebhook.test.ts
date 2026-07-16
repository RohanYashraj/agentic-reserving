import { describe, expect, test } from "vitest";
import { mapMembershipEvent } from "./clerkWebhook";

function membershipData(overrides: Record<string, unknown> = {}) {
  return {
    id: "orgmem_1",
    role: "org:senior_actuary",
    organization: { id: "org_A", name: "Workspace A" },
    public_user_data: { user_id: "user_123", identifier: "user@example.com" },
    ...overrides,
  };
}

describe("mapMembershipEvent", () => {
  test("organizationMembership.updated maps to member.role_changed", () => {
    const mapped = mapMembershipEvent({
      type: "organizationMembership.updated",
      data: membershipData(),
    });
    expect(mapped).toMatchObject({
      eventType: "member.role_changed",
      workspaceId: "org_A",
      actor: "user_123",
    });
    expect(mapped?.payload).toMatchObject({ role: "org:senior_actuary" });
  });

  test("organizationMembership.created maps to member.added", () => {
    const mapped = mapMembershipEvent({
      type: "organizationMembership.created",
      data: membershipData(),
    });
    expect(mapped?.eventType).toBe("member.added");
  });

  test("organizationMembership.deleted maps to member.removed", () => {
    const mapped = mapMembershipEvent({
      type: "organizationMembership.deleted",
      data: membershipData(),
    });
    expect(mapped?.eventType).toBe("member.removed");
  });

  test("unhandled event types map to null", () => {
    expect(
      mapMembershipEvent({ type: "user.created", data: { id: "user_1" } }),
    ).toBeNull();
  });

  test("membership events with missing or non-object data map to null", () => {
    expect(
      mapMembershipEvent({
        type: "organizationMembership.updated",
        data: undefined as unknown as Record<string, unknown>,
      }),
    ).toBeNull();
    expect(
      mapMembershipEvent({
        type: "organizationMembership.updated",
        data: null as unknown as Record<string, unknown>,
      }),
    ).toBeNull();
  });

  test("membership events without an organization id map to null", () => {
    expect(
      mapMembershipEvent({
        type: "organizationMembership.updated",
        data: membershipData({ organization: {} }),
      }),
    ).toBeNull();
  });

  test("missing public_user_data falls back to unknown actor", () => {
    const mapped = mapMembershipEvent({
      type: "organizationMembership.updated",
      data: membershipData({ public_user_data: undefined }),
    });
    expect(mapped?.actor).toBe("unknown");
  });
});
