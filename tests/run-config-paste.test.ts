import { describe, expect, it } from "vitest";
import {
  isMultiColumnPaste,
  parseNumberCell,
  splitPastedColumn,
  splitPastedRows,
} from "@/components/runConfigPaste";

describe("parseNumberCell", () => {
  it("parses plain and grouped numbers, tolerates whitespace/commas", () => {
    expect(parseNumberCell("0.72")).toBe(0.72);
    expect(parseNumberCell(" 5000000 ")).toBe(5_000_000);
    expect(parseNumberCell("5,000,000")).toBe(5_000_000);
  });
  it("returns null for empty and unparseable cells", () => {
    expect(parseNumberCell("")).toBeNull();
    expect(parseNumberCell("   ")).toBeNull();
    expect(parseNumberCell("abc")).toBeNull();
    expect(parseNumberCell("1.2.3")).toBeNull();
  });
});

describe("splitPastedColumn", () => {
  it("splits newline-separated values, dropping one trailing newline", () => {
    expect(splitPastedColumn("0.7\n0.72\n0.75\n")).toEqual([0.7, 0.72, 0.75]);
  });
  it("handles CRLF line endings", () => {
    expect(splitPastedColumn("0.7\r\n0.72")).toEqual([0.7, 0.72]);
  });
  it("maps blank/garbage lines to null (forgiving, never throws)", () => {
    expect(splitPastedColumn("0.7\n\nabc\n0.75")).toEqual([0.7, null, null, 0.75]);
  });
  it("takes the first column when tabs are present", () => {
    expect(splitPastedColumn("0.7\t5000000\n0.72\t5200000")).toEqual([0.7, 0.72]);
  });
});

describe("splitPastedRows / isMultiColumnPaste", () => {
  it("detects a two-column block", () => {
    expect(isMultiColumnPaste("0.7\t5000000\n0.72\t5200000")).toBe(true);
    expect(isMultiColumnPaste("0.7\n0.72")).toBe(false);
  });
  it("splits rows into per-column cells", () => {
    expect(splitPastedRows("0.7\t5000000\n0.72\t5200000")).toEqual([
      ["0.7", "5000000"],
      ["0.72", "5200000"],
    ]);
  });
  it("returns [] for empty text", () => {
    expect(splitPastedRows("")).toEqual([]);
    expect(splitPastedRows("\n")).toEqual([]);
  });
});
