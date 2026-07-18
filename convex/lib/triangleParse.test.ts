import { ConvexError } from "convex/values";
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";

import { parseTriangleGrid } from "./triangleParse";

function csvBytes(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer;
}

/** Build a genuine .xlsx from an array-of-arrays grid. */
function xlsxBytes(grid: (string | number | null)[][]): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(grid);
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as
    | ArrayBuffer
    | Uint8Array;
  return out instanceof Uint8Array
    ? (out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer)
    : out;
}

/** Assert a thrown ConvexError carries the expected `code`. */
function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(ConvexError);
    expect((e as ConvexError<{ code: string }>).data.code).toBe(code);
    return;
  }
  throw new Error(`expected a ConvexError with code ${code}, but none was thrown`);
}

describe("parseTriangleGrid", () => {
  it("parses a clean CSV into the snake_case Triangle wire shape", () => {
    const csv = "origin,12,24,36\n2020,100,150,175\n2021,120,180\n2022,130";
    const t = parseTriangleGrid(csvBytes(csv), "csv", "paid");
    expect(t).toEqual({
      kind: "paid",
      origin_periods: ["2020", "2021", "2022"],
      development_periods: ["12", "24", "36"],
      cells: [
        [100, 150, 175],
        [120, 180, null], // short row padded with null
        [130, null, null],
      ],
    });
  });

  it("parses a genuine .xlsx workbook identically", () => {
    const grid: (string | number | null)[][] = [
      ["origin", "12", "24", "36"],
      ["2020", 100, 150, 175],
      ["2021", 120, 180, null],
      ["2022", 130, null, null],
    ];
    const t = parseTriangleGrid(xlsxBytes(grid), "xlsx", "incurred");
    expect(t.kind).toBe("incurred");
    expect(t.origin_periods).toEqual(["2020", "2021", "2022"]);
    expect(t.development_periods).toEqual(["12", "24", "36"]);
    expect(t.cells[1]).toEqual([120, 180, null]);
  });

  it("treats blank and whitespace cells as null (unobserved)", () => {
    const csv = "origin,12,24\n2020, ,150\n2021,120,";
    const t = parseTriangleGrid(csvBytes(csv), "csv", "paid");
    expect(t.cells).toEqual([
      [null, 150],
      [120, null],
    ]);
  });

  it("strips trivial thousands separators and currency", () => {
    const csv = 'origin,12\n2020,"1,234"';
    const t = parseTriangleGrid(csvBytes(csv), "csv", "paid");
    expect(t.cells[0][0]).toBe(1234);
  });

  it("rejects a non-numeric cell with UNPARSEABLE_CELL", () => {
    const csv = "origin,12,24\n2020,100,oops";
    expectCode(() => parseTriangleGrid(csvBytes(csv), "csv", "paid"), "UNPARSEABLE_CELL");
  });

  it("rejects duplicate origin labels with MALFORMED_TRIANGLE", () => {
    const csv = "origin,12\n2020,100\n2020,120";
    expectCode(() => parseTriangleGrid(csvBytes(csv), "csv", "paid"), "MALFORMED_TRIANGLE");
  });

  it("rejects duplicate development labels with MALFORMED_TRIANGLE", () => {
    const csv = "origin,12,12\n2020,100,150";
    expectCode(() => parseTriangleGrid(csvBytes(csv), "csv", "paid"), "MALFORMED_TRIANGLE");
  });

  it("rejects a header with no development columns", () => {
    const csv = "origin\n2020";
    expectCode(() => parseTriangleGrid(csvBytes(csv), "csv", "paid"), "MALFORMED_TRIANGLE");
  });

  it("rejects a file with no origin rows", () => {
    const csv = "origin,12,24";
    expectCode(() => parseTriangleGrid(csvBytes(csv), "csv", "paid"), "MALFORMED_TRIANGLE");
  });

  it("rejects a row missing its origin label", () => {
    const csv = "origin,12,24\n,100,150";
    expectCode(() => parseTriangleGrid(csvBytes(csv), "csv", "paid"), "MALFORMED_TRIANGLE");
  });

  // Pins the TextDecoder V8 dual-guard (see triangleParse.ts). This harness
  // (edge-runtime) reproduces only the THROW path; the Convex V8 action runtime
  // instead returns `undefined` from a fatal decode, which the guard also
  // treats as UNREADABLE_CSV. Do not remove the undefined branch — it is
  // unreachable here but load-bearing in production.
  it("rejects invalid UTF-8 CSV bytes with UNREADABLE_CSV", () => {
    const invalid = new Uint8Array([0xff, 0xfe, 0x41, 0x42]).buffer;
    expectCode(() => parseTriangleGrid(invalid, "csv", "paid"), "UNREADABLE_CSV");
  });
});
