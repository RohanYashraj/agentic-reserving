import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

// The args contract Story 1.5's appendAuditEntry (the sole auditLogs writer,
// AD-6) will consume. Exported so tests pin the shape callers rely on.
export const recordEventArgs = {
  workspaceId: v.string(),
  actor: v.string(),
  eventType: v.string(),
  payload: v.any(),
  runId: v.optional(v.string()),
};

// Audit event emission point. Persistence lands in Story 1.5 (auditLogs
// hash chain, AD-6); the interface is stable — callers pass the exact shape
// appendAuditEntry will need. internalMutation by design: never public, so
// AD-4's requireMember rule (which governs public functions) does not apply.
export const recordEvent = internalMutation({
  args: recordEventArgs,
  handler: async () => {},
});
