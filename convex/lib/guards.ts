import type { Auth } from "convex/server";
import { ConvexError } from "convex/values";

// AD-4: every public Convex function's first statement is
// requireMember(ctx, workspaceId); approve/publish/override paths use
// requireRole(ctx, workspaceId, "senior_actuary"). The Clerk JWT is the sole
// source of membership and role truth — never duplicated into Convex tables.
//
// workspaceId IS the Clerk organization ID string (org_…). There is no
// workspaces table. The `convex` JWT template must emit the custom claims
// org_id ({{org.id}}) and org_role ({{org.role}}); see README.

export type Role = "analyst" | "senior_actuary";

// Plain helpers (not registered functions) only need ctx.auth, so the guards
// work identically in queries, mutations, and actions.
type GuardCtx = { auth: Auth };

/**
 * Clerk emits custom org roles as prefixed keys ("org:analyst") through the
 * {{org.role}} shortcode. Normalize to the bare slug; non-string, empty, or
 * prefix-only claims (no active org / malformed emission) normalize to null.
 */
export function normalizeRole(claim: unknown): string | null {
  if (typeof claim !== "string") {
    return null;
  }
  const bare = claim.startsWith("org:") ? claim.slice("org:".length) : claim;
  return bare === "" ? null : bare;
}

/**
 * Verifies a signed-in Clerk identity whose active organization is the
 * Workspace. Throws ConvexError {code: "UNAUTHENTICATED"} when signed out and
 * {code: "FORBIDDEN"} otherwise — the same FORBIDDEN for "wrong workspace"
 * and "no such workspace" so tenancy existence never leaks.
 */
export async function requireMember(ctx: GuardCtx, workspaceId: string) {
  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) {
    throw new ConvexError({
      code: "UNAUTHENTICATED",
      message: "Sign in to access this Workspace.",
    });
  }
  const role = normalizeRole(identity.org_role);
  if (
    typeof identity.org_id !== "string" ||
    identity.org_id === "" ||
    identity.org_id !== workspaceId ||
    role === null
  ) {
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "You are not a member of this Workspace.",
    });
  }
  return { identity, role };
}

/**
 * requireMember plus an exact role check against the closed slug vocabulary.
 */
export async function requireRole(
  ctx: GuardCtx,
  workspaceId: string,
  role: Role,
) {
  const member = await requireMember(ctx, workspaceId);
  if (member.role !== role) {
    throw new ConvexError({
      code: "FORBIDDEN",
      message: `This action requires the ${role} role.`,
    });
  }
  return member;
}
