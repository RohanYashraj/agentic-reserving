// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ResultsGrid } from "@/components/ResultsGrid";
import type { Id } from "@/convex/_generated/dataModel";
import type { ResultSet } from "@/convex/lib/engineContract";

afterEach(cleanup);

// CL (2 origins) + BF (1 origin) + Mack (1 origin). Mack reserveLow/High are set
// to values that are DELIBERATELY NOT ibnr ± mackStdErr, so a recompute in React
// would produce 190,000/210,000 (absent) instead of the stored 185,000/215,000.
function fixture(): ResultSet {
  return {
    schemaVersion: "1.0.0",
    lineage: {
      engineVersion: "0.1.0",
      chainladderVersion: "0.9.2",
      triangleHash: "a".repeat(64),
      parameters: { methods: ["chain_ladder"], aprioriLossRatios: [] },
    },
    methodResults: [
      {
        method: "chain_ladder",
        developmentFactors: [{ fromDev: "12", toDev: "24", factor: 1.5 }],
        originResults: [
          {
            origin: "2019",
            ultimate: 4213000,
            ibnr: 200000,
            mackStdErr: null,
            reserveLow: null,
            reserveHigh: null,
          },
          {
            origin: "2020",
            ultimate: 5000000,
            ibnr: 30000,
            mackStdErr: null,
            reserveLow: null,
            reserveHigh: null,
          },
        ],
        totalMackStdErr: null,
      },
      {
        method: "bornhuetter_ferguson",
        developmentFactors: [{ fromDev: "12", toDev: "24", factor: 1.42 }],
        originResults: [
          {
            origin: "2019",
            ultimate: 4100000,
            ibnr: 150000,
            mackStdErr: null,
            reserveLow: null,
            reserveHigh: null,
          },
        ],
        totalMackStdErr: null,
      },
      {
        method: "mack",
        developmentFactors: [{ fromDev: "12", toDev: "24", factor: 1.51 }],
        originResults: [
          {
            origin: "2019",
            ultimate: 4200000,
            ibnr: 200000,
            mackStdErr: 10000,
            reserveLow: 185000, // NOT ibnr - mackStdErr (190,000)
            reserveHigh: 215000, // NOT ibnr + mackStdErr (210,000)
          },
        ],
        totalMackStdErr: 12345,
      },
    ],
  };
}

const runId = "r1" as Id<"runs">;

describe("ResultsGrid (AC1, AC3)", () => {
  it("renders ultimates/IBNR verbatim, display-formatted", () => {
    render(<ResultsGrid resultSet={fixture()} runId={runId} />);
    expect(screen.getByText("4,213,000")).toBeDefined(); // CL 2019 ultimate
    expect(screen.getByText("5,000,000")).toBeDefined(); // CL 2020 ultimate
    expect(screen.getByText("4,100,000")).toBeDefined(); // BF 2019 ultimate
  });

  it("shows Mack columns only for the Mack section", () => {
    render(<ResultsGrid resultSet={fixture()} runId={runId} />);
    // Exactly one Std Err / Reserve Low / Reserve High header — the Mack section.
    expect(screen.getAllByText("Std Err")).toHaveLength(1);
    expect(screen.getAllByText("Reserve Low")).toHaveLength(1);
    expect(screen.getAllByText("Reserve High")).toHaveLength(1);
  });

  it("prints Mack reserve range verbatim, never recomputed from ibnr ± stdErr", () => {
    render(<ResultsGrid resultSet={fixture()} runId={runId} />);
    expect(screen.getByText("185,000")).toBeDefined(); // stored reserveLow
    expect(screen.getByText("215,000")).toBeDefined(); // stored reserveHigh
    // A React recompute of ibnr ± mackStdErr would show these — they must NOT appear.
    expect(screen.queryByText("190,000")).toBeNull();
    expect(screen.queryByText("210,000")).toBeNull();
    expect(screen.getByText("12,345")).toBeDefined(); // totalMackStdErr, verbatim
  });

  it("renders age-to-age LDFs with fractional precision", () => {
    render(<ResultsGrid resultSet={fixture()} runId={runId} />);
    expect(screen.getByText("1.50")).toBeDefined(); // CL factor 1.5
    expect(screen.getByText("1.42")).toBeDefined(); // BF factor
    expect(screen.getByText("1.51")).toBeDefined(); // Mack factor
  });

  it("no-arithmetic (AD-1): no Total row and no summed reserve figure", () => {
    render(<ResultsGrid resultSet={fixture()} runId={runId} />);
    // Sum of the CL IBNRs (200,000 + 30,000 = 230,000) must never appear — no
    // client-side total is synthesized.
    expect(screen.queryByText("230,000")).toBeNull();
    // No "Total IBNR"/"Total ultimate" heading (only Mack's stored "Total
    // standard error" line is allowed).
    expect(screen.queryByText(/total ibnr/i)).toBeNull();
    expect(screen.queryByText(/total ultimate/i)).toBeNull();
  });

  it("figures are set in the numeric (Geist Mono) utility", () => {
    const { container } = render(
      <ResultsGrid resultSet={fixture()} runId={runId} />,
    );
    expect(container.querySelector("td.numeric")).not.toBeNull();
  });
});
