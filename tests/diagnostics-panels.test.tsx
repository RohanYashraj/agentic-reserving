// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DiagnosticsPanels } from "@/components/DiagnosticsPanels";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import type {
  DiagnosticsBundle,
  Recommendations,
} from "@/convex/lib/engineContract";

afterEach(cleanup);

/** The context rail (Story 4.6) — the aside carrying the selected-element detail. */
function railOf(container: HTMLElement) {
  const aside = container.querySelector(
    'aside[aria-label="Selected diagnostic detail"]',
  ) as HTMLElement;
  return within(aside);
}


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
    render(<DiagnosticsPanels diagnosticsBundle={fixture()} runId="r1" />);
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
      <DiagnosticsPanels diagnosticsBundle={fixture()} runId="r1" />,
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
    render(<DiagnosticsPanels diagnosticsBundle={fixture()} runId="r1" />);
    expect(screen.getByText("-150")).toBeDefined(); // stored A−E
    expect(screen.getByText("96.4%")).toBeDefined(); // stored A/E ratio
    // A React recompute (actual − expected) would show −158 — must be absent.
    expect(screen.queryByText("-158")).toBeNull();
  });

  it("renders divergence verbatim, never clUltimate − bfUltimate (AC5)", () => {
    render(<DiagnosticsPanels diagnosticsBundle={fixture()} runId="r1" />);
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
      <DiagnosticsPanels diagnosticsBundle={fixture()} runId="r1" />,
    );
    // The residual value is printed (colour is only annotation).
    expect(screen.getByText("1.10")).toBeDefined();
    // Heat cell is a numeric table cell.
    const cell = container.querySelector('td.numeric[title="dx:r1:residual:2019:12"]');
    expect(cell).not.toBeNull();
  });

  it("graphical panels expose an accessible data-table toggle (AC4)", () => {
    render(<DiagnosticsPanels diagnosticsBundle={fixture()} runId="r1" />);
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
        runId="r1"
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
        runId="r1"
      />,
    );
    expect(screen.getByText(/No LDF stability data/i)).toBeDefined();
    expect(screen.getByText(/No actual-vs-expected data/i)).toBeDefined();
    expect(screen.getByText(/No residual data/i)).toBeDefined();
  });
});

describe("DiagnosticContextRail + selection (Story 4.6)", () => {
  it("shows the empty state before anything is selected (AC2)", () => {
    const { container } = render(
      <DiagnosticsPanels diagnosticsBundle={fixture()} runId="r1" />,
    );
    expect(
      railOf(container).getByText("Select any diagnostic element"),
    ).toBeDefined();
  });

  it("click-selects an AvE row and fills the rail with STORED values (AC1/AC5)", () => {
    const { container } = render(
      <DiagnosticsPanels diagnosticsBundle={fixture()} runId="r1" />,
    );
    const chip = screen.getByRole("button", { name: "dx:r1:ave:2019" });
    fireEvent.click(chip);
    // The selected chip is marked.
    expect(chip.getAttribute("aria-current")).toBe("true");
    const rail = railOf(container);
    expect(rail.getByText("Actual vs expected — 2019")).toBeDefined();
    // Stored A−E (-150), NOT the naive recompute (-158).
    expect(rail.getByText("-150")).toBeDefined();
    expect(rail.getByText("96.4%")).toBeDefined();
    expect(rail.queryByText("-158")).toBeNull();
  });

  it("shows per-kind detail — LDF factor series + CV (AC5)", () => {
    const { container } = render(
      <DiagnosticsPanels diagnosticsBundle={fixture()} runId="r1" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "dx:r1:ldf_stability:12" }));
    const rail = railOf(container);
    expect(rail.getByText("LDF 12→24")).toBeDefined();
    expect(rail.getByText("0.08")).toBeDefined(); // CV, verbatim
    expect(rail.getByText("1.48 · 1.55")).toBeDefined(); // factor series
  });

  it("shows divergence detail verbatim, never clUltimate − bfUltimate (AC5)", () => {
    const { container } = render(
      <DiagnosticsPanels diagnosticsBundle={fixture()} runId="r1" />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /dx:r1:cl_bf_divergence:2019/ }),
    );
    const rail = railOf(container);
    expect(rail.getByText("CL vs BF — 2019")).toBeDefined();
    expect(rail.getByText("+120")).toBeDefined(); // stored divergence
    expect(rail.queryByText("+113")).toBeNull(); // naive recompute absent
  });

  it("replaces rail content when a second element is selected (AC1)", () => {
    const { container } = render(
      <DiagnosticsPanels diagnosticsBundle={fixture()} runId="r1" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "dx:r1:ave:2019" }));
    expect(railOf(container).getByText("Actual vs expected — 2019")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "dx:r1:ldf_stability:12" }));
    expect(railOf(container).getByText("LDF 12→24")).toBeDefined();
    expect(railOf(container).queryByText("Actual vs expected — 2019")).toBeNull();
  });

  it("shows the honest-empty 'Cited by' shell — no count, no link (AC6)", () => {
    const { container } = render(
      <DiagnosticsPanels diagnosticsBundle={fixture()} runId="r1" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "dx:r1:ave:2019" }));
    const rail = railOf(container);
    expect(rail.getByText(/Cited by 0 report claims/i)).toBeDefined();
    expect(rail.queryByRole("link")).toBeNull();
  });

  it("renders the deep-link string for the selected element (AC1)", () => {
    const { container } = render(
      <DiagnosticsPanels diagnosticsBundle={fixture()} runId="r1" />,
    );
    fireEvent.click(screen.getByRole("button", { name: "dx:r1:ave:2019" }));
    expect(
      railOf(container).getByText(/\/runs\/r1\/diagnostics#dx:r1:ave:2019/),
    ).toBeDefined();
  });

  it("deep-link: initialSelectedId selects the element on mount (AC4)", () => {
    const { container } = render(
      <DiagnosticsPanels
        diagnosticsBundle={fixture()}
        runId="r1"
        initialSelectedId="dx:r1:ave:2019"
      />,
    );
    expect(railOf(container).getByText("Actual vs expected — 2019")).toBeDefined();
  });

  it("deep-link: an unknown/stale id is a no-op — rail stays empty, no throw (AC4)", () => {
    const { container } = render(
      <DiagnosticsPanels
        diagnosticsBundle={fixture()}
        runId="r1"
        initialSelectedId="dx:r1:nope:0"
      />,
    );
    expect(
      railOf(container).getByText("Select any diagnostic element"),
    ).toBeDefined();
  });

  // Story 5.5 (AC3): the "cited by N report claims" backlink lights up from the
  // recommendations citation source (D4 — citation-metadata aggregation, AD-1).
  describe('"cited by N report claims" backlink', () => {
    function makeRecommendations(citations: string[][]): Recommendations {
      return {
        schemaVersion: "1.0.0",
        runId: "r1",
        recommendations: [
          {
            origin: "2019",
            method: "chain_ladder",
            reasons: citations.map((c) => ({ text: "reason", citations: c })),
          },
        ],
      };
    }

    it("N === 1 → singular 'Cited by 1 report claim.'", () => {
      const { container } = render(
        <DiagnosticsPanels
          diagnosticsBundle={fixture()}
          runId="r1"
          recommendations={makeRecommendations([["dx:r1:ave:2019"]])}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "dx:r1:ave:2019" }));
      expect(railOf(container).getByText("Cited by 1 report claim.")).toBeDefined();
    });

    it("N >= 2 → plural 'Cited by N report claims.'", () => {
      const { container } = render(
        <DiagnosticsPanels
          diagnosticsBundle={fixture()}
          runId="r1"
          recommendations={makeRecommendations([
            ["dx:r1:ave:2019"],
            ["dx:r1:ave:2019", "dx:r1:ldf_stability:12"],
          ])}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "dx:r1:ave:2019" }));
      expect(railOf(container).getByText("Cited by 2 report claims.")).toBeDefined();
    });

    it("a diagnostic no reason cites → honest 'Cited by 0 report claims.'", () => {
      const { container } = render(
        <DiagnosticsPanels
          diagnosticsBundle={fixture()}
          runId="r1"
          recommendations={makeRecommendations([["dx:r1:ave:2019"]])}
        />,
      );
      // ldf_stability:12 is cited by no reason.
      fireEvent.click(
        screen.getByRole("button", { name: "dx:r1:ldf_stability:12" }),
      );
      expect(
        railOf(container).getByText("Cited by 0 report claims."),
      ).toBeDefined();
    });

    it("recommendations={null} → the honest-empty shell (no interpretation yet)", () => {
      const { container } = render(
        <DiagnosticsPanels
          diagnosticsBundle={fixture()}
          runId="r1"
          recommendations={null}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "dx:r1:ave:2019" }));
      expect(
        railOf(container).getByText(
          /Cited by 0 report claims\. Backlinks appear once Interpretation exists\./i,
        ),
      ).toBeDefined();
    });
  });

  // Story 6.1 (D9): the tally unions the Reserve Report's section citations.
  describe('"cited by" unions report-section citations', () => {
    function makeRecommendations(citations: string[][]): Recommendations {
      return {
        schemaVersion: "1.0.0",
        runId: "r1",
        recommendations: [
          {
            origin: "2019",
            method: "chain_ladder",
            reasons: citations.map((c) => ({ text: "reason", citations: c })),
          },
        ],
      };
    }

    function makeReportRow(sectionCitations: string[]): Doc<"reserveReports"> {
      const section = (citations: string[] = []) => ({ text: "prose", citations });
      return {
        _id: "rep1" as Id<"reserveReports">,
        _creationTime: 0,
        workspaceId: "org_A",
        runId: "r1" as Id<"runs">,
        status: "draft",
        machineDrafted: false,
        contentVersion: 1,
        createdBy: "u",
        createdAt: "2026-07-19T00:00:00.000Z",
        updatedBy: "u",
        updatedAt: "2026-07-19T00:00:00.000Z",
        report: {
          schemaVersion: "1.0.0",
          runId: "r1",
          machineDrafted: false,
          executiveSummary: section(sectionCitations),
          methodSelectionRationale: section(),
          movementCommentary: section(),
          limitations: section(),
        },
      };
    }

    it("a report section citing the id (no recommendation) → 'Cited by 1 report claim.'", () => {
      const { container } = render(
        <DiagnosticsPanels
          diagnosticsBundle={fixture()}
          runId="r1"
          recommendations={null}
          report={makeReportRow(["dx:r1:ave:2019"])}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "dx:r1:ave:2019" }));
      expect(
        railOf(container).getByText("Cited by 1 report claim."),
      ).toBeDefined();
    });

    it("a diagnostic cited by BOTH a recommendation and a report section counts both", () => {
      const { container } = render(
        <DiagnosticsPanels
          diagnosticsBundle={fixture()}
          runId="r1"
          recommendations={makeRecommendations([["dx:r1:ave:2019"]])}
          report={makeReportRow(["dx:r1:ave:2019"])}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "dx:r1:ave:2019" }));
      expect(
        railOf(container).getByText("Cited by 2 report claims."),
      ).toBeDefined();
    });

    it("report={null} falls back to the recommendation-only count (unchanged 5.5)", () => {
      const { container } = render(
        <DiagnosticsPanels
          diagnosticsBundle={fixture()}
          runId="r1"
          recommendations={makeRecommendations([["dx:r1:ave:2019"]])}
          report={null}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "dx:r1:ave:2019" }));
      expect(
        railOf(container).getByText("Cited by 1 report claim."),
      ).toBeDefined();
    });
  });

  it("heatmap is a roving-tabindex grid: arrows move, Enter selects (AC3)", () => {
    // A two-cell heatmap row so arrow movement is observable.
    const bundle = fixture({
      residuals: [
        {
          id: "dx:r1:residual:2019:12",
          origin: "2019",
          fromDev: "12",
          toDev: "24",
          residual: 0.1,
        },
        {
          id: "dx:r1:residual:2019:24",
          origin: "2019",
          fromDev: "24",
          toDev: "36",
          residual: 0.2,
        },
      ],
    });
    const { container } = render(
      <DiagnosticsPanels diagnosticsBundle={bundle} runId="r1" />,
    );
    const cellA = container.querySelector(
      'td[id="dx:r1:residual:2019:12"]',
    ) as HTMLTableCellElement;
    const cellB = container.querySelector(
      'td[id="dx:r1:residual:2019:24"]',
    ) as HTMLTableCellElement;
    // Exactly one grid stop: the first populated cell is tabbable, the rest are not.
    expect(cellA.tabIndex).toBe(0);
    expect(cellB.tabIndex).toBe(-1);
    // ArrowRight moves the active cell.
    fireEvent.keyDown(cellA, { key: "ArrowRight" });
    expect(cellB.tabIndex).toBe(0);
    expect(cellA.tabIndex).toBe(-1);
    // Enter opens the active cell in the rail.
    fireEvent.keyDown(cellB, { key: "Enter" });
    expect(railOf(container).getByText("Residual 2019 · 24→36")).toBeDefined();
  });
});
