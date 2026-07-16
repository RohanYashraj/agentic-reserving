// Audit-chain primitives (AD-6). This module defines the PROJECT-WIDE
// canonical-JSON serialization and hash formula for the auditLogs chain:
//
//   hash = sha256(canonicalJSON(entry) + prevHash)   — lowercase hex
//
// The hashable entry projection, key ordering, genesis constant, and hex
// encoding are a PERMANENT contract: changing any of them breaks verification
// of every pre-existing per-Workspace chain. The pinned known-answer vector
// in auditChain.test.ts guards this contract — never update that vector
// without an explicit, reviewed migration story.
//
// This hash is NEITHER of the two Triangle hashes (raw-file sha256 and
// canonical-triangle-JSON sha256, Epics 2/3). Three distinct concepts,
// never conflated (Consistency Conventions).

/**
 * The exact projection that gets hashed for an audit entry. `hash` and
 * `prevHash` are deliberately NOT part of the object — prevHash enters the
 * digest via concatenation, exactly as AD-6 writes the formula. `seq` IS
 * hashed so reordering entries is tamper-evident. `runId` is omitted (not
 * null) when the event has no Run.
 */
export type HashableAuditEntry = {
  workspaceId: string;
  runId?: string;
  actor: string;
  eventType: string;
  timestamp: string;
  payload: unknown;
  seq: number;
};

/** The first entry of a Workspace's chain hashes against the empty string. */
export const GENESIS_PREV_HASH = "";

/**
 * Builds the hashable projection from any source carrying the audit fields
 * (writer args, a stored row, a test fixture). The single owner of the
 * projection literal — writer, verifier, and tests all go through here so
 * the contract cannot drift between them. `runId` is OMITTED (not set to
 * undefined) when absent, because canonicalJSON rejects undefined.
 */
export function toHashableEntry(source: {
  workspaceId: string;
  runId?: string | undefined;
  actor: string;
  eventType: string;
  timestamp: string;
  payload: unknown;
  seq: number;
}): HashableAuditEntry {
  return {
    workspaceId: source.workspaceId,
    ...(source.runId !== undefined ? { runId: source.runId } : {}),
    actor: source.actor,
    eventType: source.eventType,
    timestamp: source.timestamp,
    payload: source.payload,
    seq: source.seq,
  };
}

/**
 * Deterministic JSON serialization: object keys sorted lexicographically at
 * every depth, arrays keep their order, primitives via JSON.stringify.
 * Throws on undefined, functions, bigints, symbols, non-finite numbers, and
 * non-plain objects (Date, Map, Set, class instances) — a payload that
 * cannot be canonicalized must fail loud, never silently produce a divergent
 * hash (e.g. JSON.stringify would drop undefined properties, and Object.keys
 * would flatten a Date or Map to "{}").
 */
export function canonicalJSON(value: unknown): string {
  if (value === null) {
    return "null";
  }
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) {
        throw new Error(
          `canonicalJSON: non-finite number ${value} is not JSON-serializable`,
        );
      }
      return JSON.stringify(value);
    case "object": {
      if (Array.isArray(value)) {
        return `[${value.map((item) => canonicalJSON(item)).join(",")}]`;
      }
      const proto = Object.getPrototypeOf(value);
      if (proto !== Object.prototype && proto !== null) {
        throw new Error(
          "canonicalJSON: non-plain object (Date, Map, Set, class instance, ...) is not JSON-serializable",
        );
      }
      const record = value as Record<string, unknown>;
      const parts = Object.keys(record)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonicalJSON(record[key])}`);
      return `{${parts.join(",")}}`;
    }
    default:
      throw new Error(
        `canonicalJSON: value of type ${typeof value} is not JSON-serializable`,
      );
  }
}

/**
 * sha256(canonicalJSON(entry) + prevHash) as lowercase hex. Uses
 * SubtleCrypto, available in the Convex default runtime and the vitest
 * edge-runtime environment — no npm hash dependency.
 */
export async function computeEntryHash(
  entry: HashableAuditEntry,
  prevHash: string,
): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJSON(entry) + prevHash);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
