// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DiagnosticsPanels } from "@/components/DiagnosticsPanels";
import type { DiagnosticsBundle } from "@/convex/lib/engineContract";

afterEach(cleanup);


// Stored deviations/divergences are DELIBERATELY set distinct from the naive
// recomputation so the no-arithmetic probe is meaningful:
//   ave: actual − expected = 4213 − 4371 = −158, but stored A−E = −150
//   div: clUltimate − bfUltimate = 4213 − 4100 = 113, but stored divergence = 120
function fixture(
  overrides: Partial<DiagnosticsBundle> = {},
): DiagnosticsBundle {
  return {
    schemaVersion: "1.0.0",
    runId: "r1",
    triangleHash: "a".repeat(64),
    ldfStability: [
      {
        id: "dx:r1:ldf_stability:12",
        fromDev: "12",
        toDev: "24",
        selectedFactor: 1.52,
        linkRatios: [
          { origin: "2019", factor: 1.48 },
          { origin: "2020", factor: 1.55 },
        ],
        sigma: 0.12,
        stdErr: 0.04,
        cv: 0.08,
      },
    ],
    ave: [
      {
        id: "dx:r1:ave:2019",
        origin: "2019",
        fromDev: "12",
        toDev: "24",
        actual: 4213,
        expected: 4371,
        actualMinusExpected: -150, // NOT 4213 − 4371 (−158)
        actualToExpectedRatio: 0.9639,
      },
    ],
    clBfDivergence: [
      {
        id: "dx:r1:cl_bf_divergence:2019",
        origin: "2019",
        clUltimate: 4213,
        bfUltimate: 4100,
        divergence: 120, // NOT 4213 − 4100 (113)
        relativeDivergence: 0.0276,
      },
    ],
    residuals: [
      {
        id: "dx:r1:residual:2019:12",
        origin: "2019",
        fromDev: "12",
        toDev: "24",
        residual: 1.1,
      },
    ],
    ...overrides,
  };
}

describe("DiagnosticsPanels (Story 4.5)", () => {
  it("renders all four panel headers (AC2)", () => {
    render(<DiagnosticsPanels diagnosticsBundle={fixture()} />);
    expect(
      screen.getByText(/LDF stability by development period/i),
    ).toBeDefined();
    expect(
      screen.getByText(/Actual vs expected — latest diagonal/i),
    ).toBeDefined();
    expect(
      screen.getByText(/CL vs BF divergence by origin period/i),
    ).toBeDefined();
    expect(screen.getByText(/Residual heatmap/i)).toBeDefined();
  });

  it("every element carries its Diagnostic ID as an anchor (AC3)", () => {
    const { container } = render(
      <DiagnosticsPanels diagnosticsBundle={fixture()} />,
    );
    // Tabular panels render the ID as a visible violet chip…
    expect(screen.getByText("dx:r1:ldf_stability:12")).toBeDefined();
    expect(screen.getByText("dx:r1:ave:2019")).toBeDefined();
    // …dense visual encodings carry it as a hoverable title anchor.
    expect(
      container.querySelector('[title="dx:r1:cl_bf_divergence:2019"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[title="dx:r1:residual:2019:12"]'),
    ).not.toBeNull();
  });

  it("renders AvE deviations verbatim, never recomputed (AC5)", () => {
    render(<DiagnosticsPanels diagnosticsBundle={fixture()} />);
    expect(screen.getByText("-150")).toBeDefined(); // stored A−E
    expect(screen.getByText("96.4%")).toBeDefined(); // stored A/E ratio
    // A React recompute (actual − expected) would show −158 — must be absent.
    expect(screen.queryByText("-158")).toBeNull();
  });

  it("renders divergence verbatim, never clUltimate − bfUltimate (AC5)", () => {
    render(<DiagnosticsPanels diagnosticsBundle={fixture()} />);
    // Reveal the divergence data table (the 2nd "Show data table" toggle).
    const toggles = screen.getAllByRole("button", { name: /show data table/i });
    fireEvent.click(toggles[1]);
    // The stored divergence appears; the naive recompute (113) does not.
    expect(screen.getByText("+120")).toBeDefined();
    expect(screen.queryByText("+113")).toBeNull();
    expect(screen.queryByText("113")).toBeNull();
  });

  it("residual heatmap prints the value in the cell, in numeric type (AC2/AC4)", () => {
    const { container } = render(
      <DiagnosticsPanels diagnosticsBundle={fixture()} />,
    );
    // The residual value is printed (colour is only annotation).
    expect(screen.getByText("1.10")).toBeDefined();
    // Heat cell is a numeric table cell.
    const cell = container.querySelector('td.numeric[title="dx:r1:residual:2019:12"]');
    expect(cell).not.toBeNull();
  });

  it("graphical panels expose an accessible data-table toggle (AC4)", () => {
    render(<DiagnosticsPanels diagnosticsBundle={fixture()} />);
    // LDF + divergence each ship a "Show data table" control.
    const toggles = screen.getAllByRole("button", { name: /show data table/i });
    expect(toggles.length).toBe(2);
    // Toggling the first reveals a table with the same LDF data (selected factor).
    fireEvent.click(toggles[0]);
    expect(screen.getByText("1.52")).toBeDefined(); // selectedFactor, verbatim
  });

  it("omits the CL-vs-BF panel when clBfDivergence is null — absent, not empty (AC6)", () => {
    render(
      <DiagnosticsPanels
        diagnosticsBundle={fixture({ clBfDivergence: null })}
       
      />,
    );
    expect(screen.queryByText(/CL vs BF divergence/i)).toBeNull();
    // The other three panels still render.
    expect(
      screen.getByText(/LDF stability by development period/i),
    ).toBeDefined();
    expect(screen.getByText(/Residual heatmap/i)).toBeDefined();
  });

  it("renders honest empty states for a degenerate bundle (AC6)", () => {
    render(
      <DiagnosticsPanels
        diagnosticsBundle={fixture({
          ldfStability: [],
          ave: [],
          clBfDivergence: null,
          residuals: [],
        })}
       
      />,
    );
    expect(screen.getByText(/No LDF stability data/i)).toBeDefined();
    expect(screen.getByText(/No actual-vs-expected data/i)).toBeDefined();
    expect(screen.getByText(/No residual data/i)).toBeDefined();
  });
});
