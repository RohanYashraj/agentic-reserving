import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";
import { requireMember, requireRole } from "../../convex/lib/guards";

// Test-only guarded functions. They exercise the REAL guards from
// convex/lib/guards.ts against the fixture schema; nothing here deploys.

export const readScoped = queryGeneric({
  args: { workspaceId: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.workspaceId);
    return await ctx.db
      .query("guardFixtures")
      .filter((q) => q.eq(q.field("workspaceId"), args.workspaceId))
      .collect();
  },
});

export const writeScoped = mutationGeneric({
  args: { workspaceId: v.string(), value: v.string() },
  handler: async (ctx, args) => {
    await requireMember(ctx, args.workspaceId);
    return await ctx.db.insert("guardFixtures", {
      workspaceId: args.workspaceId,
      value: args.value,
    });
  },
});

export const approveScoped = mutationGeneric({
  args: { workspaceId: v.string() },
  handler: async (ctx, args) => {
    await requireRole(ctx, args.workspaceId, "senior_actuary");
    return "approved";
  },
});
