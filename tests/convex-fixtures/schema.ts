import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Test-only schema for exercising the guards against real table access.
// Never deployed: the real convex/schema.ts stays defineSchema({}).
export const fixtureSchema = defineSchema({
  guardFixtures: defineTable({
    workspaceId: v.string(),
    value: v.string(),
  }),
});
