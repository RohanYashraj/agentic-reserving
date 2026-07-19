// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InterpretationTab } from "@/components/interpretation/InterpretationTab";
import type { RunView } from "@/components/RunDetail";
import type { Id } from "@/convex/_generated/dataModel";
import type {
  DiagnosticsBundle,
  Recommendations,
} from "@/convex/lib/engineContract";

afterEach(cleanup);

function makeRun(overrides: Partial<RunView> = {}): RunView {
  return {
    _id: "r1" as Id<"runs">,
    status: "complete",
    triangleId: "t1" as Id<"triangles">,
    triangleHash: "a".repeat(64),
    methods: ["chain_ladder"],
    error: null,
    createdAt: "2026-07-19T00:00:00.000Z",
    startedAt: "2026-07-19T00:00:01.000Z",
    completedAt: "2026-07-19T00:00:02.000Z",
    failedAt: null,
    hasResults: true,
    hasDiagnostics: true,
    hasRecommendations: false,
    ...overrides,
  };
}

function makeDiagnosticsBundle(): DiagnosticsBundle {
  return {
    schemaVersion: "1.0.0",
    runId: "r1",
    triangleHash: "a".repeat(64),
    ldfStability: [],
    ave: [
      {
        id: "dx:r1:ave:2019",
        origin: "2019",
        fromDev: "12",
        toDev: "24",
        actual: 4213,
        expected: 4371,
        actualMinusExpected: -158,
        actualToExpectedRatio: 0.9639,
      },
    ],
    clBfDivergence: null,
    residuals: [],
  };
}

function makeRecommendations(): Recommendations {
  return {
    schemaVersion: "1.0.0",
    runId: "r1",
    recommendations: [
      {
        origin: "2019",
        method: "bornhuetter_ferguson",
        reasons: [
          { text: "Reason for 2019.", citations: ["dx:r1:ave:2019"] },
        ],
      },
    ],
  };
}

describe("InterpretationTab state machine (Story 5.5, AC1/AC4, UX-DR16)", () => {
  it("not interpretable (not complete) → quiet gate message, no button", () => {
    render(
      <InterpretationTab
        run={makeRun({ status: "running", hasDiagnostics: false })}
        recommendations={null}
        diagnosticsBundle={null}
        onGenerateInterpretation={vi.fn()}
      />,
    );
    expect(screen.getByText(/Interpretation unlocks once the Run completes/i)).toBeDefined();
    expect(screen.queryByRole("button", { name: /Generate interpretation/i })).toBeNull();
  });

  it("complete + no recommendations → the Generate interpretation button", () => {
    render(
      <InterpretationTab
        run={makeRun()}
        recommendations={null}
        diagnosticsBundle={makeDiagnosticsBundle()}
        onGenerateInterpretation={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /Generate interpretation/i })).toBeDefined();
  });

  it("clicking Generate calls the callback and shows the skeleton + Reading diagnostics… (aria-live)", async () => {
    let resolve!: (v: { status: "accepted" | "rejected" }) => void;
    const pending = new Promise<{ status: "accepted" | "rejected" }>((r) => {
      resolve = r;
    });
    const onGenerate = vi.fn().mockReturnValue(pending);

    const { container } = render(
      <InterpretationTab
        run={makeRun()}
        recommendations={null}
        diagnosticsBundle={makeDiagnosticsBundle()}
        onGenerateInterpretation={onGenerate}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Generate interpretation/i }));
    expect(onGenerate).toHaveBeenCalledTimes(1);

    const live = await screen.findByText(/Reading diagnostics…/i);
    expect(live).toBeDefined();
    expect(container.querySelector('[aria-live="polite"]')).not.toBeNull();
    // Skeleton shimmer present.
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);

    resolve({ status: "accepted" });
  });

  it("a rejected outcome shows the quiet failure copy", async () => {
    const onGenerate = vi.fn().mockResolvedValue({ status: "rejected" });
    render(
      <InterpretationTab
        run={makeRun()}
        recommendations={null}
        diagnosticsBundle={makeDiagnosticsBundle()}
        onGenerateInterpretation={onGenerate}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Generate interpretation/i }));
    expect(
      await screen.findByText(/Draft failed provenance check/i),
    ).toBeDefined();
  });

  it("a thrown error shows a clean inline retry message", async () => {
    const onGenerate = vi
      .fn()
      .mockRejectedValue(new Error("The interpretation engine is unavailable."));
    render(
      <InterpretationTab
        run={makeRun()}
        recommendations={null}
        diagnosticsBundle={makeDiagnosticsBundle()}
        onGenerateInterpretation={onGenerate}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Generate interpretation/i }));
    expect(
      await screen.findByText(/The interpretation engine is unavailable\./i),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: /Try again/i })).toBeDefined();
  });

  it("hasRecommendations + recommendations present → the table renders (no button/skeleton)", () => {
    const { container } = render(
      <InterpretationTab
        run={makeRun({ hasRecommendations: true })}
        recommendations={makeRecommendations()}
        diagnosticsBundle={makeDiagnosticsBundle()}
        onGenerateInterpretation={vi.fn()}
      />,
    );
    // The table header + a row render; no trigger button, no skeleton.
    expect(
      screen.getByText(
        "Drafted by the interpretation layer · every claim cites a diagnostic",
      ),
    ).toBeDefined();
    expect(screen.getByText("Reason for 2019.")).toBeDefined();
    expect(screen.queryByRole("button", { name: /Generate interpretation/i })).toBeNull();
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(0);
  });
});
