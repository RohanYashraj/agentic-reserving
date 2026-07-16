// Pure mapping from a verified Clerk webhook event to the audit event shape
// consumed by internal.auditLogs.appendAuditEntry. Signature verification
// lives in convex/http.ts; this module never touches I/O so it is
// unit-testable.

export type AuditableEvent = {
  eventType: "member.role_changed" | "member.added" | "member.removed";
  workspaceId: string;
  actor: string;
  payload: Record<string, unknown>;
};

// Exported so http.ts can distinguish "unknown event type" (ack 200) from
// "recognized membership event we could not map" (500 → Svix retries; audit
// completeness, NFR-5). Taxonomy decision (Story 1.5, kept as-is):
// organizationMembership.updated always maps to member.role_changed — role
// changes are the only membership updates we act on today, and the full
// Clerk payload is preserved verbatim for later disambiguation. Do not
// build finer taxonomy machinery until an epic needs it.
export const MEMBERSHIP_EVENT_TYPES: Record<
  string,
  AuditableEvent["eventType"]
> = {
  "organizationMembership.updated": "member.role_changed",
  "organizationMembership.created": "member.added",
  "organizationMembership.deleted": "member.removed",
};

/**
 * Returns the audit event for an organizationMembership.* webhook, or null
 * for anything that should be acknowledged (200) but not recorded.
 *
 * Attribution (accepted limitation, review decision 2026-07-16): Clerk's
 * membership payload does not identify the admin who performed the change,
 * so `actor` is the SUBJECT of the change — the affected member's
 * public_user_data.user_id — not the acting principal. Story 1.5's audit
 * taxonomy must treat webhook-sourced `actor` values accordingly; the full
 * payload is preserved so nothing is lost.
 */
export function mapMembershipEvent(event: {
  type: string;
  data: Record<string, unknown>;
}): AuditableEvent | null {
  // Object.hasOwn guards the lookup: bare indexing with event.type
  // "toString" would return the inherited Object.prototype method — a
  // function, not undefined — and slip past the unknown-type gate.
  const eventType = Object.hasOwn(MEMBERSHIP_EVENT_TYPES, event.type)
    ? MEMBERSHIP_EVENT_TYPES[event.type]
    : undefined;
  if (eventType === undefined) {
    return null;
  }
  if (event.data === null || typeof event.data !== "object") {
    return null;
  }
  const organization = event.data.organization as
    | { id?: unknown }
    | undefined;
  const workspaceId = organization?.id;
  if (typeof workspaceId !== "string" || workspaceId === "") {
    return null;
  }
  const publicUserData = event.data.public_user_data as
    | { user_id?: unknown }
    | undefined;
  const actor =
    typeof publicUserData?.user_id === "string"
      ? publicUserData.user_id
      : "unknown";
  return { eventType, workspaceId, actor, payload: event.data };
}
