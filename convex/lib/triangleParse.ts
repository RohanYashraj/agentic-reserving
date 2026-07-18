/**
 * Grid parse: uploaded CSV/XLSX bytes → the engine `Triangle` wire shape
 * (Story 3.2, FR-2). `engine_service /validate` takes a fully-parsed Triangle
 * JSON body — it never parses files — so the Convex action parses here first,
 * then POSTs the result. This is reshaping/coercion only, NOT computation: no
 * arithmetic on cell values (AD-1), they are passed through as parsed.
 *
 * Fixed layout assumption for 3.2 (Dev Notes → "Grid parse contract"): row 0
 * is the header (corner cell + development-age labels); column 0 of each
 * following row is the origin label; the body is cumulative values, blanks are
 * the unobserved future. Orientation/period detection and user confirmation
 * are Story 3.3 — this parser does not guess; a malformed grid throws a precise
 * ConvexError so the wizard shows "Fix source and re-upload".
 *
 * Pure module: no `ctx`, no server context, no I/O — safe to unit-test and to
 * import into the Convex action (default V8 runtime; `xlsx` runs there per 3.1).
 */

import { ConvexError } from "convex/values";
import * as XLSX from "xlsx";
import type { Triangle } from "./engineContract";

/** A raw grid cell before coercion (SheetJS returns numbers or strings). */
type RawCell = string | number | boolean | null | undefined;

function fail(code: string, message: string): never {
  throw new ConvexError({ code, message });
}

/**
 * Decode CSV bytes as UTF-8 and let SheetJS parse the grid (it handles quoting
 * and embedded commas robustly — do not hand-roll a CSV splitter).
 *
 * CRITICAL — the TextDecoder V8 divergence (do not "simplify" away): a fatal
 * `TextDecoder` rejects invalid UTF-8 by THROWING in the vitest/edge runtime
 * but by RETURNING `undefined` in the Convex V8 action runtime. Treat BOTH a
 * throw and a falsy/undefined result as invalid UTF-8. The convex-test /
 * edge-runtime harness can only reproduce the throw path, never the V8
 * `undefined` path — this guard is load-bearing in production even though a
 * test cannot exercise its second half.
 */
function rowsFromCsv(bytes: ArrayBuffer): RawCell[][] {
  let text: string | undefined;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    text = undefined;
  }
  if (!text) {
    fail("UNREADABLE_CSV", "File is not valid UTF-8 text.");
  }
  const wb = XLSX.read(text, { type: "string" });
  return sheetToRows(wb);
}

/** Open the workbook and extract the first sheet as a raw grid. */
function rowsFromXlsx(bytes: ArrayBuffer): RawCell[][] {
  let wb: XLSX.WorkBook | undefined;
  try {
    wb = XLSX.read(new Uint8Array(bytes), { type: "array" });
  } catch {
    wb = undefined;
  }
  if (!wb || wb.SheetNames.length === 0 || wb.Sheets[wb.SheetNames[0]] === undefined) {
    fail("UNREADABLE_XLSX", "File is not a readable .xlsx workbook.");
  }
  return sheetToRows(wb);
}

function sheetToRows(wb: XLSX.WorkBook): RawCell[][] {
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json<RawCell[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false,
  });
}

/** A cell is "blank" (→ null) when it is null/undefined or an all-whitespace string. */
function isBlank(cell: RawCell): boolean {
  return cell === null || cell === undefined || (typeof cell === "string" && cell.trim() === "");
}

/** Coerce a raw grid value into a finite number or `null`; reject anything else. */
function coerceCell(cell: RawCell, origin: string, dev: string): number | null {
  if (isBlank(cell)) return null;
  if (typeof cell === "number") {
    if (!Number.isFinite(cell)) {
      fail(
        "UNPARSEABLE_CELL",
        `Cell at origin ${origin}, development ${dev} is not a finite number.`,
      );
    }
    return cell;
  }
  if (typeof cell === "string") {
    // Trim only trivially-present thousands separators / currency; anything
    // ambiguous stays non-numeric and is rejected rather than silently coerced.
    const cleaned = cell.trim().replace(/^\$/, "").replace(/,/g, "");
    const n = Number(cleaned);
    if (cleaned !== "" && Number.isFinite(n)) return n;
  }
  return fail(
    "UNPARSEABLE_CELL",
    `Cell at origin ${origin}, development ${dev} is not numeric ("${String(cell)}").`,
  );
}

/** Coerce a raw label (header/origin) into a trimmed non-empty string. */
function coerceLabel(cell: RawCell): string | null {
  if (cell === null || cell === undefined) return null;
  const s = String(cell).trim();
  return s === "" ? null : s;
}

function assertUniqueNonEmpty(labels: (string | null)[], axis: string): string[] {
  const out: string[] = [];
  for (const label of labels) {
    if (label === null) {
      fail("MALFORMED_TRIANGLE", `A ${axis} label is empty. Every ${axis} needs a label.`);
    }
    out.push(label);
  }
  if (new Set(out).size !== out.length) {
    fail("MALFORMED_TRIANGLE", `Duplicate ${axis} labels found. Each ${axis} must be unique.`);
  }
  return out;
}

/**
 * Parse stored file bytes into the engine `Triangle` (snake_case wire shape).
 * `kind` comes from the Triangle's stored paid/incurred label (not re-derived).
 */
export function parseTriangleGrid(
  bytes: ArrayBuffer,
  format: "csv" | "xlsx",
  kind: "paid" | "incurred",
): Triangle {
  const rows = format === "csv" ? rowsFromCsv(bytes) : rowsFromXlsx(bytes);

  if (rows.length < 2) {
    fail(
      "MALFORMED_TRIANGLE",
      "Expected a header row of development periods plus at least one origin row.",
    );
  }

  const header = rows[0];
  if (header.length < 2) {
    fail("MALFORMED_TRIANGLE", "No development-period columns found in the header row.");
  }
  // Header: cell[0] is the ignored corner label; the rest are development ages.
  const development_periods = assertUniqueNonEmpty(
    header.slice(1).map(coerceLabel),
    "development period",
  );
  const nDev = development_periods.length;

  const origin_periods: string[] = [];
  const cells: (number | null)[][] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const origin = coerceLabel(row[0]);
    if (origin === null) {
      fail("MALFORMED_TRIANGLE", `Row ${r + 1} has no origin-period label in the first column.`);
    }
    origin_periods.push(origin);

    const values = row.slice(1);
    if (values.length > nDev) {
      fail(
        "MALFORMED_TRIANGLE",
        `Origin ${origin} has more value columns than the ${nDev} development periods in the header.`,
      );
    }
    const coerced: (number | null)[] = [];
    for (let c = 0; c < nDev; c++) {
      coerced.push(coerceCell(values[c] ?? null, origin, development_periods[c]));
    }
    cells.push(coerced);
  }

  assertUniqueNonEmpty(origin_periods, "origin period");

  return { kind, origin_periods, development_periods, cells };
}
