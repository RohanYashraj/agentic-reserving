/**
 * The only Convex→engine_service HTTP client (AD-12: only Convex may call the
 * engine service; the browser never does). Story 3.2 is the first consumer
 * (`/validate`); Epic 4 reuses it for `/runs`, so this stays generic — no
 * endpoint-specific logic lives here.
 *
 * Runs in the Convex default (V8) action runtime: `fetch` is available, no
 * `"use node"` directive. Reads the base URL and shared bearer secret from
 * deployment env (set via `npx convex env set`); the secret mirrors the engine
 * Cloud Run env and is never logged or returned.
 */

import { ConvexError, type Value } from "convex/values";

/** The engine error envelope (`engine_service/errors.py` ErrorEnvelope). */
interface EngineErrorEnvelope {
  code: string;
  message: string;
  // Arbitrary JSON from the engine (e.g. the cell-level findings array); it is
  // a valid Convex Value, carried through to the ConvexError data verbatim.
  details?: Value;
}

function isEnvelope(body: unknown): body is EngineErrorEnvelope {
  return (
    typeof body === "object" &&
    body !== null &&
    typeof (body as Record<string, unknown>).code === "string" &&
    typeof (body as Record<string, unknown>).message === "string"
  );
}

/**
 * POST `body` as JSON to `path` on the engine service and return the parsed
 * response. On a non-2xx with the standard `{code, message, details?}`
 * envelope, throws `ConvexError` with code `engine.<code>` and the message
 * preserved. On an unparseable/unexpected failure (5xx HTML, network), throws
 * `ENGINE_UNAVAILABLE`. Missing config throws `ENGINE_UNCONFIGURED`.
 */
export async function callEngine<T>(path: string, body: unknown): Promise<T> {
  const base = process.env.ENGINE_SERVICE_URL;
  const secret = process.env.ENGINE_SERVICE_SECRET;
  if (!base || !secret) {
    throw new ConvexError({
      code: "ENGINE_UNCONFIGURED",
      message: "The engine service is not configured for this deployment.",
    });
  }

  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    // Network-level failure — never leak the URL or secret.
    throw new ConvexError({
      code: "ENGINE_UNAVAILABLE",
      message: "The engine service could not be reached.",
    });
  }

  if (res.ok) {
    return (await res.json()) as T;
  }

  // Map the engine's structured error envelope; fall back for anything else.
  let parsed: unknown = undefined;
  try {
    parsed = await res.json();
  } catch {
    parsed = undefined;
  }
  if (isEnvelope(parsed)) {
    throw new ConvexError({
      code: `engine.${parsed.code}`,
      message: parsed.message,
      details: parsed.details,
    });
  }
  throw new ConvexError({
    code: "ENGINE_UNAVAILABLE",
    message: `The engine service returned an unexpected ${res.status} response.`,
  });
}
