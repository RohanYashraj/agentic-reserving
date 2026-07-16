import { httpRouter } from "convex/server";
import { Webhook } from "svix";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { mapMembershipEvent } from "./lib/clerkWebhook";

const http = httpRouter();

// Clerk → Convex webhook (Svix-signed). Captures organizationMembership.*
// changes — the only server-side point that observes dashboard-driven role
// changes (FR-19) — and emits them through internal.audit.recordEvent.
// Configure in the Clerk dashboard against this deployment's .convex.site
// URL; the signing secret lives only in the Convex deployment env.
http.route({
  path: "/clerk-users-webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.CLERK_WEBHOOK_SIGNING_SECRET;
    if (secret === undefined || secret === "") {
      // Deployment misconfiguration, not a bad request: fail fast and loud —
      // but log the specifics server-side only, never in the response body.
      console.error("clerk-users-webhook: CLERK_WEBHOOK_SIGNING_SECRET is not set");
      return new Response("Internal error", { status: 500 });
    }

    const svixId = request.headers.get("svix-id");
    const svixTimestamp = request.headers.get("svix-timestamp");
    const svixSignature = request.headers.get("svix-signature");
    if (svixId === null || svixTimestamp === null || svixSignature === null) {
      return new Response("Missing Svix signature headers", { status: 400 });
    }

    // Constructed outside the verify try/catch: a malformed (set-but-invalid)
    // secret is a deployment misconfiguration, not a bad request.
    let webhook: Webhook;
    try {
      webhook = new Webhook(secret);
    } catch {
      console.error(
        "clerk-users-webhook: CLERK_WEBHOOK_SIGNING_SECRET is malformed",
      );
      return new Response("Internal error", { status: 500 });
    }

    const body = await request.text();
    let event: { type: string; data: Record<string, unknown> };
    try {
      event = webhook.verify(body, {
        "svix-id": svixId,
        "svix-timestamp": svixTimestamp,
        "svix-signature": svixSignature,
      }) as { type: string; data: Record<string, unknown> };
    } catch {
      return new Response("Invalid webhook signature", { status: 400 });
    }

    const auditable = mapMembershipEvent(event);
    if (auditable === null) {
      return Response.json({ recorded: null }, { status: 200 });
    }

    await ctx.runMutation(internal.audit.recordEvent, auditable);
    return Response.json(
      {
        recorded: auditable.eventType,
        workspaceId: auditable.workspaceId,
        actor: auditable.actor,
      },
      { status: 200 },
    );
  }),
});

export default http;
