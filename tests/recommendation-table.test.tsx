// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RecommendationTable,
  type RecommendationOverride,
} from "@/components/interpretation/RecommendationTable";
import type {
  DiagnosticsBundle,
  Recommendations,
} from "@/convex/lib/engineContract";

afterEach(cleanup);

function makeOverride(
  overrides: Partial<RecommendationOverride> = {},
): RecommendationOverride {
  return {
    origin: "2018",
    overridingMethod: "chain_ladder",
    reason: "immature year; a priori is better grounded",
    overriddenBy: "user_senior",
    overriddenAt: "2026-07-19T10:00:00.000Z",
    ...overrides,
  };
}

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

describe("RecommendationTable — Senior-Actuary override (Story 6.3, AC1/AC2)", () => {
  it("canOverride: a live Override button per row opens the audit-confirmation dialog", () => {
    render(
      <RecommendationTable
        recommendations={makeRecommendations(["2018", "2019"])}
        diagnosticsBundle={makeDiagnosticsBundle()}
        overrides={[]}
        canOverride={true}
        onOverride={vi.fn()}
      />,
    );
    const buttons = screen.getAllByRole("button", { name: "Override" });
    expect(buttons).toHaveLength(2);
    expect(buttons.every((b) => !(b as HTMLButtonElement).disabled)).toBe(true);

    // No dialog until a row's Override is clicked.
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(buttons[0]);

    const dialog = screen.getByRole("dialog");
    // Restated copy names the Origin Period + the recommended method (UX-DR14).
    expect(dialog.textContent).toContain(
      "Override recommendation — 2018",
    );
    expect(dialog.textContent).toContain("Bornhuetter-Ferguson (BF)");
    expect(dialog.textContent).toContain("will be logged");

    // The Method picker offers the two NON-recommended methods (D4).
    expect(screen.getByRole("radio", { name: "Chain Ladder (CL)" })).toBeDefined();
    expect(screen.getByRole("radio", { name: "Mack" })).toBeDefined();
    expect(
      screen.queryByRole("radio", { name: "Bornhuetter-Ferguson (BF)" }),
    ).toBeNull();
  });

  it("canOverride: confirm is disabled until a method + non-empty reason are entered; initial focus is Cancel", async () => {
    render(
      <RecommendationTable
        recommendations={makeRecommendations(["2018"])}
        diagnosticsBundle={makeDiagnosticsBundle()}
        overrides={[]}
        canOverride={true}
        onOverride={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Override" }));

    const confirm = screen.getByRole("button", { name: "Confirm override" });
    const cancel = screen.getByRole("button", { name: "Cancel" });
    // Initial focus is Cancel — the safety posture for audit dialogs (D6).
    await waitFor(() => expect(document.activeElement).toBe(cancel));

    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    // A method alone is not enough.
    fireEvent.click(screen.getByRole("radio", { name: "Mack" }));
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    // A method + a non-empty reason enables it.
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "immature year" },
    });
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
  });

  it("canOverride: Confirm calls onOverride(origin, method, reason); Cancel does not", async () => {
    const onOverride = vi.fn().mockResolvedValue(undefined);
    render(
      <RecommendationTable
        recommendations={makeRecommendations(["2018"])}
        diagnosticsBundle={makeDiagnosticsBundle()}
        overrides={[]}
        canOverride={true}
        onOverride={onOverride}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Override" }));
    fireEvent.click(screen.getByRole("radio", { name: "Chain Ladder (CL)" }));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "a priori better grounded" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm override" }));
    await waitFor(() =>
      expect(onOverride).toHaveBeenCalledWith(
        "2018",
        "chain_ladder",
        "a priori better grounded",
      ),
    );

    // Cancel on a fresh dialog never fires the action.
    onOverride.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Override" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onOverride).not.toHaveBeenCalled();
  });

  it("Analyst (canOverride false): the Override control is disabled and does not open a dialog (UX-DR18)", () => {
    render(
      <RecommendationTable
        recommendations={makeRecommendations(["2018"])}
        diagnosticsBundle={makeDiagnosticsBundle()}
        overrides={[]}
        canOverride={false}
        onOverride={vi.fn()}
      />,
    );
    const button = screen.getByRole("button", { name: "Override" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("side-by-side: an overridden row shows the tag, transition, quoted reason, attribution — and keeps its recommendation chips (AC-2)", () => {
    render(
      <RecommendationTable
        recommendations={makeRecommendations(["2018", "2019"])}
        diagnosticsBundle={makeDiagnosticsBundle()}
        overrides={[makeOverride({ origin: "2018" })]}
        canOverride={false}
      />,
    );
    // Status tags: 2018 overridden, 2019 accepted.
    expect(screen.getByText("overridden")).toBeDefined();
    expect(screen.getByText("accepted")).toBeDefined();

    // The override card: method → overridingMethod transition + quoted reason +
    // the attribution line.
    const transition = screen.getByText(
      (_content, node) =>
        node?.textContent ===
        "Override — Bornhuetter-Ferguson (BF) → Chain Ladder (CL)",
    );
    expect(transition).toBeDefined();
    expect(
      screen.getByText(/immature year; a priori is better grounded/),
    ).toBeDefined();
    expect(
      screen.getByText(/user_senior · Senior Actuary · 2026-07-19T10:00:00/),
    ).toBeDefined();

    // Citations intact: the 2018 recommendation's chip is still a role="link".
    const chips = screen.getAllByRole("link");
    expect(chips.map((c) => c.textContent)).toContain("dx:r1:ave:2018");
  });
});
