/// <reference types="vite/client" />
import { convexTest, type TestConvex } from "convex-test";
import { ConvexError } from "convex/values";
import type { SchemaDefinition, GenericSchema } from "convex/server";
import * as XLSX from "xlsx";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob([
  "./**/*.ts",
  "!./**/*.test.ts",
  "./_generated/**/*.js",
]);

type Harness = TestConvex<SchemaDefinition<GenericSchema, boolean>>;

const analystA = {
  subject: "user_a",
  org_id: "org_A",
  org_role: "org:analyst",
};
const analystB = {
  subject: "user_b",
  org_id: "org_B",
  org_role: "org:analyst",
};

function csvBytes(text = "origin,dev,value\n2019,12,100\n"): Uint8Array {
  return new TextEncoder().encode(text);
}

/** A genuine, openable .xlsx workbook built in-process. */
function xlsxBytes(): Uint8Array {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ["origin", "dev", "value"],
    [2019, 12, 100],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
}

async function store(
  t: Harness,
  bytes: Uint8Array,
): Promise<Id<"_storage">> {
  return await t.run(async (ctx) => await ctx.storage.store(new Blob([bytes])));
}

async function storageCount(t: Harness): Promise<number> {
  return await t.run(async (ctx) => {
    const files = await ctx.db.system.query("_storage").collect();
    return files.length;
  });
}

async function triangleRows(t: Harness) {
  return await t.run((ctx) => ctx.db.query("triangles").collect());
}

async function auditRows(t: Harness) {
  return await t.run((ctx) => ctx.db.query("auditLogs").collect());
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

describe("createFromUpload — happy path (AC1)", () => {
  test("new CSV upload → one pending_validation row + triangle.uploaded audit", async () => {
    const t = convexTest(schema, modules);
    const bytes = csvBytes();
    const storageId = await store(t, bytes);

    const result = await t
      .withIdentity(analystA)
      .action(api.triangles.createFromUpload, {
        workspaceId: "org_A",
        storageId,
        label: "paid",
        filename: "motor.csv",
      });

    expect(result.status).toBe("created");

    const rows = await triangleRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0].workspaceId).toBe("org_A");
    expect(rows[0].status).toBe("pending_validation");
    expect(rows[0].label).toBe("paid");
    expect(rows[0].format).toBe("csv");
    expect(rows[0].uploadedBy).toBe("user_a");
    expect(rows[0].rawFileHash).toBe(await sha256Hex(bytes));

    const audits = await auditRows(t);
    const uploaded = audits.find((a) => a.eventType === "triangle.uploaded");
    expect(uploaded).toBeDefined();
    expect(uploaded?.payload.triangleId).toBe(rows[0]._id);
    expect(uploaded?.payload.rawFileHash).toBe(rows[0].rawFileHash);
    expect(uploaded?.actor).toBe("user_a");

    // The stored blob is retained for a created upload.
    expect(await storageCount(t)).toBe(1);
  });

  test("a genuine .xlsx workbook passes the open gate and creates the row", async () => {
    const t = convexTest(schema, modules);
    const storageId = await store(t, xlsxBytes());

    const result = await t
      .withIdentity(analystA)
      .action(api.triangles.createFromUpload, {
        workspaceId: "org_A",
        storageId,
        label: "incurred",
        filename: "motor.xlsx",
      });

    expect(result.status).toBe("created");
    const rows = await triangleRows(t);
    expect(rows).toHaveLength(1);
    expect(rows[0].format).toBe("xlsx");
    expect(rows[0].label).toBe("incurred");
  });
});

describe("createFromUpload — duplicate detection (AC2)", () => {
  test("second byte-identical upload → duplicate, one row, second blob discarded", async () => {
    const t = convexTest(schema, modules);
    const bytes = csvBytes();

    const first = await t
      .withIdentity(analystA)
      .action(api.triangles.createFromUpload, {
        workspaceId: "org_A",
        storageId: await store(t, bytes),
        label: "paid",
        filename: "motor.csv",
      });
    expect(first.status).toBe("created");

    const secondStorageId = await store(t, bytes);
    expect(await storageCount(t)).toBe(2);

    const second = await t
      .withIdentity(analystA)
      .action(api.triangles.createFromUpload, {
        workspaceId: "org_A",
        storageId: secondStorageId,
        label: "paid",
        filename: "motor.csv",
      });

    expect(second.status).toBe("duplicate");
    if (second.status === "duplicate" && first.status === "created") {
      expect(second.existingTriangleId).toBe(first.triangleId);
    }

    // Exactly one Triangle row, and the second blob was deleted.
    expect(await triangleRows(t)).toHaveLength(1);
    expect(await storageCount(t)).toBe(1);

    const audits = await auditRows(t);
    expect(
      audits.some((a) => a.eventType === "triangle.upload_duplicate"),
    ).toBe(true);
  });
});

describe("createFromUpload — parse failures (AC3)", () => {
  // NB: this edge-runtime harness THROWS on fatal-decode of invalid UTF-8,
  // but the Convex V8 action runtime returns `undefined` instead — the
  // handler guards both. Don't collapse the undefined check in triangles.ts;
  // this test alone cannot reproduce the production path.
  test("non-UTF-8 bytes labelled .csv → specific error, no row, no blob", async () => {
    const t = convexTest(schema, modules);
    const bad = new Uint8Array([0xff, 0xfe, 0x00, 0xff]);
    const storageId = await store(t, bad);

    let caught: unknown;
    try {
      await t.withIdentity(analystA).action(api.triangles.createFromUpload, {
        workspaceId: "org_A",
        storageId,
        label: "paid",
        filename: "motor.csv",
      });
      expect.unreachable("expected a parse rejection");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConvexError);
    expect((caught as ConvexError<{ code: string; message: string }>).data.code).toBe(
      "UNREADABLE_CSV",
    );

    expect(await triangleRows(t)).toHaveLength(0);
    expect(await storageCount(t)).toBe(0);
  });

  test("plain-text bytes labelled .xlsx → 'not a readable .xlsx workbook', no row, no blob", async () => {
    const t = convexTest(schema, modules);
    const storageId = await store(t, csvBytes("this is not a workbook"));

    let caught: unknown;
    try {
      await t.withIdentity(analystA).action(api.triangles.createFromUpload, {
        workspaceId: "org_A",
        storageId,
        label: "paid",
        filename: "motor.xlsx",
      });
      expect.unreachable("expected a parse rejection");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConvexError);
    const data = (caught as ConvexError<{ code: string; message: string }>).data;
    expect(data.code).toBe("UNREADABLE_XLSX");
    expect(data.message).toContain(".xlsx workbook");

    expect(await triangleRows(t)).toHaveLength(0);
    expect(await storageCount(t)).toBe(0);
  });

  test("truncated/garbage zip labelled .xlsx → 'not a readable .xlsx workbook', no row, no blob", async () => {
    const t = convexTest(schema, modules);
    // Valid ZIP local-header signature followed by garbage — passes the
    // magic-byte precheck but XLSX.read cannot open it as a workbook.
    const garbageZip = new Uint8Array([
      0x50, 0x4b, 0x03, 0x04, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06,
    ]);
    const storageId = await store(t, garbageZip);

    let caught: unknown;
    try {
      await t.withIdentity(analystA).action(api.triangles.createFromUpload, {
        workspaceId: "org_A",
        storageId,
        label: "paid",
        filename: "motor.xlsx",
      });
      expect.unreachable("expected a parse rejection");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConvexError);
    expect((caught as ConvexError<{ code: string }>).data.code).toBe(
      "UNREADABLE_XLSX",
    );
    expect(await triangleRows(t)).toHaveLength(0);
    expect(await storageCount(t)).toBe(0);
  });

  test("unsupported extension → specific error, no row, no blob", async () => {
    const t = convexTest(schema, modules);
    const storageId = await store(t, csvBytes());

    let caught: unknown;
    try {
      await t.withIdentity(analystA).action(api.triangles.createFromUpload, {
        workspaceId: "org_A",
        storageId,
        label: "paid",
        filename: "motor.txt",
      });
      expect.unreachable("expected an unsupported-format rejection");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConvexError);
    expect((caught as ConvexError<{ code: string }>).data.code).toBe(
      "UNSUPPORTED_FORMAT",
    );
    expect(await triangleRows(t)).toHaveLength(0);
    expect(await storageCount(t)).toBe(0);
  });

  test("missing storage blob → UPLOAD_NOT_FOUND", async () => {
    const t = convexTest(schema, modules);
    const storageId = await store(t, csvBytes());
    await t.run(async (ctx) => await ctx.storage.delete(storageId));

    let caught: unknown;
    try {
      await t.withIdentity(analystA).action(api.triangles.createFromUpload, {
        workspaceId: "org_A",
        storageId,
        label: "paid",
        filename: "motor.csv",
      });
      expect.unreachable("expected UPLOAD_NOT_FOUND");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConvexError);
    expect((caught as ConvexError<{ code: string }>).data.code).toBe(
      "UPLOAD_NOT_FOUND",
    );
  });
});

describe("guards + tenancy (AC4)", () => {
  test("unauthenticated generateUploadUrl / createFromUpload / listByWorkspace reject", async () => {
    const t = convexTest(schema, modules);
    const storageId = await store(t, csvBytes());

    for (const call of [
      () => t.mutation(api.triangles.generateUploadUrl, { workspaceId: "org_A" }),
      () =>
        t.action(api.triangles.createFromUpload, {
          workspaceId: "org_A",
          storageId,
          label: "paid" as const,
          filename: "motor.csv",
        }),
      () => t.query(api.triangles.listByWorkspace, { workspaceId: "org_A" }),
    ]) {
      let caught: unknown;
      try {
        await call();
        expect.unreachable("expected UNAUTHENTICATED");
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ConvexError);
      expect((caught as ConvexError<{ code: string }>).data.code).toBe(
        "UNAUTHENTICATED",
      );
    }
  });

  test("cross-Workspace invisibility: org_B cannot list org_A's Triangles", async () => {
    const t = convexTest(schema, modules);
    await t.withIdentity(analystA).action(api.triangles.createFromUpload, {
      workspaceId: "org_A",
      storageId: await store(t, csvBytes()),
      label: "paid",
      filename: "motor.csv",
    });

    // org_A member sees its own row.
    const own = await t
      .withIdentity(analystA)
      .query(api.triangles.listByWorkspace, { workspaceId: "org_A" });
    expect(own).toHaveLength(1);

    // org_B member querying org_A → FORBIDDEN.
    let caught: unknown;
    try {
      await t
        .withIdentity(analystB)
        .query(api.triangles.listByWorkspace, { workspaceId: "org_A" });
      expect.unreachable("expected FORBIDDEN");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ConvexError);
    expect((caught as ConvexError<{ code: string }>).data.code).toBe("FORBIDDEN");
  });

  test("dedupe is per-Workspace: identical file in org_B does not collide with org_A", async () => {
    const t = convexTest(schema, modules);
    const bytes = csvBytes();

    const a = await t.withIdentity(analystA).action(api.triangles.createFromUpload, {
      workspaceId: "org_A",
      storageId: await store(t, bytes),
      label: "paid",
      filename: "motor.csv",
    });
    const b = await t.withIdentity(analystB).action(api.triangles.createFromUpload, {
      workspaceId: "org_B",
      storageId: await store(t, bytes),
      label: "paid",
      filename: "motor.csv",
    });

    expect(a.status).toBe("created");
    expect(b.status).toBe("created");

    const rows = await triangleRows(t);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.workspaceId))).toEqual(
      new Set(["org_A", "org_B"]),
    );
    // Same bytes → same rawFileHash across the two Workspaces.
    expect(rows[0].rawFileHash).toBe(rows[1].rawFileHash);
  });
});
