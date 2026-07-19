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
import type { ResultSet } from "@/convex/lib/engineContract";

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

function makeResultSet(): ResultSet {
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
            ibnr: 25000,
            mackStdErr: null,
            reserveLow: null,
            reserveHigh: null,
          },
        ],
        totalMackStdErr: null,
      },
    ],
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

    // Results is the default tab; with figures not yet fetched it shows the
    // brief loading state (not the obsolete "later story" text).
    expect(screen.getByText(/Loading results/i)).toBeDefined();

    // The step rail's Diagnostics step (a button on a complete run) switches tabs.
    fireEvent.click(screen.getByRole("button", { name: "Diagnostics" }));
    expect(
      screen.getByText(/Diagnostics render in a later story/i),
    ).toBeDefined();
  });

  it("complete run with a ResultSet renders the Results grid (AC1)", () => {
    render(
      <RunDetail
        run={makeRun({
          status: "complete",
          hasResults: true,
          hasDiagnostics: true,
          completedAt: "2026-07-19T00:00:02.000Z",
        })}
        resultSet={makeResultSet()}
        onRetry={vi.fn()}
      />,
    );

    // The Results tab is default; the stored ultimate renders verbatim,
    // display-formatted (4,213,000) — no arithmetic.
    expect(screen.getByText("4,213,000")).toBeDefined();
    expect(screen.getByText("25,000")).toBeDefined();
    // No synthesized total row.
    expect(screen.queryByText(/total ibnr/i)).toBeNull();
  });

  it("hasResults but no resultSet yet → loading placeholder, no figures", () => {
    render(
      <RunDetail
        run={makeRun({ status: "complete", hasResults: true })}
        resultSet={null}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText(/Loading results/i)).toBeDefined();
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
