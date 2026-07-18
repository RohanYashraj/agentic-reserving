// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// next/link (used by the embedded StepRail) → bare anchor under jsdom.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { RunDetail, type RunView } from "@/components/RunDetail";
import type { Id } from "@/convex/_generated/dataModel";

afterEach(cleanup);

function makeRun(overrides: Partial<RunView> = {}): RunView {
  return {
    _id: "r1" as Id<"runs">,
    status: "running",
    triangleId: "t1" as Id<"triangles">,
    triangleHash: "a".repeat(64),
    methods: ["chain_ladder"],
    error: null,
    createdAt: "2026-07-19T00:00:00.000Z",
    startedAt: "2026-07-19T00:00:01.000Z",
    completedAt: null,
    failedAt: null,
    hasResults: false,
    hasDiagnostics: false,
    ...overrides,
  };
}

describe("RunDetail (AC2, AC3, AC4)", () => {
  it("failed run shows a destructive banner + Retry that calls the callback", () => {
    const onRetry = vi.fn();
    render(
      <RunDetail
        run={makeRun({
          status: "failed",
          error: { code: "ENGINE_UNAVAILABLE", message: "The engine is down." },
        })}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByRole("alert")).toBeDefined();
    expect(screen.getByText("The engine is down.")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /retry run/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("running run renders one per-Method row per method inside an aria-live region", () => {
    const { container } = render(
      <RunDetail
        run={makeRun({
          status: "running",
          methods: ["chain_ladder", "bornhuetter_ferguson"],
        })}
        onRetry={vi.fn()}
      />,
    );

    const live = container.querySelector('[aria-live="polite"]');
    expect(live).not.toBeNull();
    expect(live?.textContent).toContain("Chain Ladder (CL)");
    expect(live?.textContent).toContain("Bornhuetter-Ferguson (BF)");
    // One pulsing dot per running Method row (two methods).
    expect(live?.querySelectorAll(".animate-pulse")).toHaveLength(2);
    // The running badge is present.
    expect(screen.getByText("running")).toBeDefined();
  });

  it("complete run: the Diagnostics tab is reachable via the step rail", () => {
    render(
      <RunDetail
        run={makeRun({
          status: "complete",
          hasResults: true,
          hasDiagnostics: true,
          completedAt: "2026-07-19T00:00:02.000Z",
        })}
        onRetry={vi.fn()}
      />,
    );

    // Results is the default tab.
    expect(screen.getByText(/Results render in a later story/i)).toBeDefined();

    // The step rail's Diagnostics step (a button on a complete run) switches tabs.
    fireEvent.click(screen.getByRole("button", { name: "Diagnostics" }));
    expect(
      screen.getByText(/Diagnostics render in a later story/i),
    ).toBeDefined();
  });

  it("no polling primitive: the component has no interval/timeout-based refetch (FR-20)", () => {
    // Structural: live status comes from the Convex subscription only — the
    // component takes `run` as a prop and never sets up its own refetch loop.
    const source = readFileSync(
      resolve(process.cwd(), "components/RunDetail.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/setInterval|setTimeout/);
  });
});
