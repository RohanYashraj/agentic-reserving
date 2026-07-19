// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { RecommendationTable } from "@/components/interpretation/RecommendationTable";
import type {
  DiagnosticsBundle,
  Recommendations,
} from "@/convex/lib/engineContract";

afterEach(cleanup);

function makeDiagnosticsBundle(): DiagnosticsBundle {
  return {
    schemaVersion: "1.0.0",
    runId: "r1",
    triangleHash: "a".repeat(64),
    ldfStability: [],
    ave: ["2018", "2019"].map((origin) => ({
      id: `dx:r1:ave:${origin}`,
      origin,
      fromDev: "12",
      toDev: "24",
      actual: 4213,
      expected: 4371,
      actualMinusExpected: -158,
      actualToExpectedRatio: 0.9639,
    })),
    clBfDivergence: null,
    residuals: [],
  };
}

function makeRecommendations(origins: string[] = ["2018", "2019"]): Recommendations {
  return {
    schemaVersion: "1.0.0",
    runId: "r1",
    // Use bornhuetter_ferguson — unambiguous label, avoids the mack ⊂ mackStdErr
    // substring trap.
    recommendations: origins.map((origin) => ({
      origin,
      method: "bornhuetter_ferguson" as const,
      reasons: [
        {
          text: `Reason for ${origin}.`,
          citations: [`dx:r1:ave:${origin}`],
        },
      ],
    })),
  };
}

describe("RecommendationTable (Story 5.5, AC1/AC2)", () => {
  it("does not render the panel header itself (lifted to InterpretationTab, F13)", () => {
    // The AC1 header now lives in InterpretationTab so it accompanies the panel
    // across the drafting and accepted states; the table renders only the table.
    render(
      <RecommendationTable
        recommendations={makeRecommendations()}
        diagnosticsBundle={makeDiagnosticsBundle()}
      />,
    );
    expect(
      screen.queryByText(
        "Drafted by the interpretation layer · every claim cites a diagnostic",
      ),
    ).toBeNull();
  });

  it("renders one row per Origin Period with the methodLabel", () => {
    render(
      <RecommendationTable
        recommendations={makeRecommendations()}
        diagnosticsBundle={makeDiagnosticsBundle()}
      />,
    );
    // Two data rows (one per origin).
    expect(screen.getByRole("rowheader", { name: "2018" })).toBeDefined();
    expect(screen.getByRole("rowheader", { name: "2019" })).toBeDefined();
    // methodLabel via the shared map (never re-mapped inline).
    expect(
      screen.getAllByText("Bornhuetter-Ferguson (BF)"),
    ).toHaveLength(2);
  });

  it("renders each reason's text with a trailing CitationChip carrying the dx: id", () => {
    render(
      <RecommendationTable
        recommendations={makeRecommendations(["2019"])}
        diagnosticsBundle={makeDiagnosticsBundle()}
      />,
    );
    expect(screen.getByText("Reason for 2019.")).toBeDefined();
    // ≥1 chip trailing the reason, rendering the correct dx: id.
    const chip = screen.getByRole("link");
    expect(chip.textContent).toBe("dx:r1:ave:2019");
  });

  it("renders a chip for every citation on a reason", () => {
    const recs = makeRecommendations(["2019"]);
    recs.recommendations[0].reasons[0].citations = [
      "dx:r1:ave:2019",
      "dx:r1:ave:2018",
    ];
    render(
      <RecommendationTable
        recommendations={recs}
        diagnosticsBundle={makeDiagnosticsBundle()}
      />,
    );
    const chips = screen.getAllByRole("link");
    expect(chips).toHaveLength(2);
    expect(chips.map((c) => c.textContent)).toEqual([
      "dx:r1:ave:2019",
      "dx:r1:ave:2018",
    ]);
  });
});
