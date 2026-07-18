// Pure helpers for the BF a-priori grid's pasteable columns (Story 4.1, AC1).
// No React, no DOM — unit-testable in isolation. Actuaries live in Excel, so a
// column (or a two-column block) copied from a spreadsheet must paste cleanly.
// Forgiving by design: a cell that does not parse becomes null (left empty, so
// the Start gate stays disabled) — a bad paste never throws.

/** Parse one raw cell to a finite number, or null when empty/unparseable. */
export function parseNumberCell(raw: string): number | null {
  const trimmed = raw.trim().replace(/,/g, ""); // tolerate "5,000,000"
  if (trimmed === "") {
    return null;
  }
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/**
 * Split pasted clipboard text into rows of raw cells. Normalizes CRLF, drops a
 * single trailing newline (spreadsheets append one), and splits each row on
 * tabs (a multi-column selection).
 */
export function splitPastedRows(text: string): string[][] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const body = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
  if (body === "") {
    return [];
  }
  return body.split("\n").map((line) => line.split("\t"));
}

/** A single pasted column → parsed numbers (first cell of each row). */
export function splitPastedColumn(text: string): (number | null)[] {
  return splitPastedRows(text).map((row) => parseNumberCell(row[0] ?? ""));
}

/** True when the paste spans more than one column (has tabs). */
export function isMultiColumnPaste(text: string): boolean {
  return splitPastedRows(text).some((row) => row.length > 1);
}
