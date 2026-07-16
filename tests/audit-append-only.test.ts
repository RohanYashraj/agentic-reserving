import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";
import * as auditLogsModule from "../convex/auditLogs";

// AC 3 / FR-15: auditLogs is append-only — exactly one internal mutation
// (appendAuditEntry in convex/auditLogs.ts) inserts rows, and no code path
// updates or deletes them.
//
// LIMITATION (stated by design): this is a source-scan convention guard,
// not a proof. A `db.patch(id)` in another module operating on an auditLogs
// document id would be invisible to a table-name grep. The runtime
// complement is that convex/auditLogs.ts is the only module that handles
// auditLogs documents today, and code review owns the residual — AD-6 is
// also verified by review, per the architecture spine. This test lives in
// tests/ (the "unit" vitest project, node env) because it needs fs;
// convex/**/*.test.ts runs under edge-runtime which has none.

const convexRoot = join(__dirname, "..", "convex");

function deployedConvexSources(dir = convexRoot): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "_generated") continue;
      files.push(...deployedConvexSources(full));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      files.push(full);
    }
  }
  return files.sort();
}

describe("auditLogs append-only enforcement (AD-6, FR-15)", () => {
  const sources = deployedConvexSources().map((path) => ({
    path: relative(join(__dirname, ".."), path),
    text: readFileSync(path, "utf8"),
  }));

  test("the scan actually sees the convex sources", () => {
    const paths = sources.map((source) => source.path);
    expect(paths).toContain("convex/auditLogs.ts");
    expect(paths).toContain("convex/schema.ts");
  });

  test('exactly one db.insert("auditLogs") call site, inside convex/auditLogs.ts', () => {
    const hits = sources.flatMap((source) => {
      const matches = source.text.match(/\.insert\(\s*"auditLogs"/g) ?? [];
      return matches.map(() => source.path);
    });
    expect(hits).toEqual(["convex/auditLogs.ts"]);

    const auditLogsSource = sources.find(
      (source) => source.path === "convex/auditLogs.ts",
    );
    expect(auditLogsSource).toBeDefined();
    // The single insert must live inside the appendAuditEntry handler: the
    // insert call site appears after the appendAuditEntry declaration and
    // before the next exported function.
    const text = auditLogsSource?.text ?? "";
    const appendStart = text.indexOf(
      "export const appendAuditEntry = internalMutation",
    );
    const insertAt = text.indexOf('.insert("auditLogs"');
    const nextExport = text.indexOf("export const", appendStart + 1);
    expect(appendStart).toBeGreaterThanOrEqual(0);
    expect(insertAt).toBeGreaterThan(appendStart);
    expect(nextExport === -1 || insertAt < nextExport).toBe(true);
  });

  test("convex/auditLogs.ts never patches, replaces, or deletes documents", () => {
    const auditLogsSource = sources.find(
      (source) => source.path === "convex/auditLogs.ts",
    );
    expect(auditLogsSource).toBeDefined();
    expect(auditLogsSource?.text).not.toMatch(/\.patch\(/);
    expect(auditLogsSource?.text).not.toMatch(/\.replace\(/);
    expect(auditLogsSource?.text).not.toMatch(/\.delete\(/);
  });

  test("appendAuditEntry is the module's only registered mutation; verifyChain is a query", () => {
    const registered = Object.entries(auditLogsModule).filter(
      ([, value]) =>
        (typeof value === "function" || typeof value === "object") &&
        value !== null &&
        ((value as { isMutation?: boolean }).isMutation === true ||
          (value as { isQuery?: boolean }).isQuery === true ||
          (value as { isAction?: boolean }).isAction === true),
    );
    const byName = Object.fromEntries(
      registered.map(([name, value]) => [
        name,
        {
          isMutation:
            (value as { isMutation?: boolean }).isMutation === true,
          isQuery: (value as { isQuery?: boolean }).isQuery === true,
        },
      ]),
    );
    expect(byName).toEqual({
      appendAuditEntry: { isMutation: true, isQuery: false },
      verifyChain: { isMutation: false, isQuery: true },
    });
  });
});
