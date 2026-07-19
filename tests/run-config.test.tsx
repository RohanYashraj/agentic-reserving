// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// createRun is not exercised here (gating only) — stub useMutation.
vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(),
}));

// RunConfig now navigates to /runs/{runId} on a successful start — stub the
// App Router so the component renders under jsdom.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

import { RunConfig } from "@/components/RunConfig";
import type { Id } from "@/convex/_generated/dataModel";

afterEach(cleanup);

const triangle = {
  kind: "paid" as const,
  origin_periods: ["2019", "2020"],
  development_periods: ["12", "24"],
  cells: [
    [100, 150],
    [120, null],
  ] as (number | null)[][],
};

function renderRunConfig() {
  return render(
    <RunConfig
      workspaceId="org_A"
      triangleId={"t1" as Id<"triangles">}
      triangle={triangle}
    />,
  );
}

const startButton = () =>
  screen.getByRole("button", { name: /start run/i }) as HTMLButtonElement;

describe("RunConfig gating (AC1)", () => {
  it("CL selected, BF off → Start enabled, no a-priori grid", () => {
    renderRunConfig();
    expect(startButton().disabled).toBe(false);
    expect(
      screen.queryByLabelText("Loss ratio for 2019"),
    ).toBeNull();
  });

  it("no method selected → Start disabled", () => {
    renderRunConfig();
    fireEvent.click(screen.getByLabelText(/Chain Ladder/));
    expect(startButton().disabled).toBe(true);
    expect(screen.getByText(/at least one method/i)).toBeDefined();
  });

  it("BF selected with an empty premium → Start disabled until every origin has both", () => {
    renderRunConfig();
    fireEvent.click(screen.getByLabelText(/Bornhuetter-Ferguson/));

    // Grid appears; Start disabled while values are missing.
    expect(startButton().disabled).toBe(true);
    expect(screen.getByLabelText("Loss ratio for 2019")).toBeDefined();

    fireEvent.change(screen.getByLabelText("Loss ratio for 2019"), {
      target: { value: "0.7" },
    });
    fireEvent.change(screen.getByLabelText("Premium for 2019"), {
      target: { value: "5000000" },
    });
    fireEvent.change(screen.getByLabelText("Loss ratio for 2020"), {
      target: { value: "0.72" },
    });
    // Still missing 2020 premium → disabled.
    expect(startButton().disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Premium for 2020"), {
      target: { value: "5200000" },
    });
    // Every origin now has both → enabled.
    expect(startButton().disabled).toBe(false);
  });

  it("BF selected with a zero premium keeps Start disabled (exposure > 0)", () => {
    renderRunConfig();
    fireEvent.click(screen.getByLabelText(/Bornhuetter-Ferguson/));
    for (const origin of triangle.origin_periods) {
      fireEvent.change(screen.getByLabelText(`Loss ratio for ${origin}`), {
        target: { value: "0.7" },
      });
      fireEvent.change(screen.getByLabelText(`Premium for ${origin}`), {
        target: { value: origin === "2020" ? "0" : "5000000" },
      });
    }
    expect(startButton().disabled).toBe(true);
  });
});
