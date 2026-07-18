// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TriangleGrid, cellKey } from "@/components/TriangleGrid";

afterEach(cleanup);

// UX-DR5: right-aligned numeric cells, flagged cells in the caution treatment
// (never color-only), announced row/column headers, click-a-cell callback,
// Latest-Diagonal edge-marking support.

const base = {
  kind: "paid" as const,
  originPeriods: ["2019", "2020"],
  developmentPeriods: ["12", "24"],
  cells: [
    [100, 150],
    [120, null],
  ] as (number | null)[][],
};

const cell = (name: string) => screen.getByRole("cell", { name });

describe("TriangleGrid", () => {
  it("renders development-period column headers and origin row headers", () => {
    render(<TriangleGrid {...base} />);
    expect(screen.getByRole("columnheader", { name: "12" })).toBeDefined();
    expect(screen.getByRole("rowheader", { name: "2019" })).toBeDefined();
  });

  it("announces each cell's origin, development, and value (or no value)", () => {
    render(<TriangleGrid {...base} />);
    expect(cell("Origin 2019, development 12, value 100")).toBeDefined();
    // A null cell announces "no value" (the unobserved future).
    expect(cell("Origin 2020, development 24, no value")).toBeDefined();
  });

  it("applies the caution treatment (not color-only) to flagged cells", () => {
    const flaggedCells = new Set([cellKey("2020", "12")]);
    render(<TriangleGrid {...base} flaggedCells={flaggedCells} />);
    const flagged = cell("Origin 2020, development 12, value 120");
    expect(flagged.className).toContain("bg-caution-subtle");
    expect(flagged.className).toContain("text-caution");
    // A non-color glyph accompanies the amber fill.
    expect(flagged.textContent).toContain("⚠");
  });

  it("invokes onCellFocus with the cell key when a cell is clicked", () => {
    const onCellFocus = vi.fn();
    render(<TriangleGrid {...base} onCellFocus={onCellFocus} />);
    fireEvent.click(cell("Origin 2019, development 24, value 150"));
    expect(onCellFocus).toHaveBeenCalledWith(cellKey("2019", "24"));
  });

  it("edge-marks the last observed cell of each row when showLatestDiagonal", () => {
    render(<TriangleGrid {...base} showLatestDiagonal />);
    // 2019's last observed cell is dev 24; 2020's is dev 12 (dev 24 is null).
    expect(cell("Origin 2019, development 24, value 150").className).toContain(
      "border-l-primary",
    );
    expect(cell("Origin 2020, development 12, value 120").className).toContain(
      "border-l-primary",
    );
  });
});
