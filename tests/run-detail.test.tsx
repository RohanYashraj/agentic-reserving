// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
import type {
  DiagnosticsBundle,
  ResultSet,
} from "@/convex/lib/engineContract";

afterEach(cleanup);
// Story 4.6: the deep-link tests set window.location.hash — reset it so it
// never leaks into other cases.
afterEach(() => {
  window.location.hash = "";
});

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
    hasRecommendations: false,
    hasReserveReport: false,
    interpretationFailure: null,
    ...overrides,
  };
}

// Story 5.5: minimal accepted Recommendations doc — one row per origin, each
// reason pinned to a `dx:` id present in makeDiagnosticsBundle.
function makeRecommendations(): import("@/convex/lib/engineContract").Recommendations {
  return {
    schemaVersion: "1.0.0",
    runId: "r1",
    recommendations: [
      {
        origin: "2019",
        method: "bornhuetter_ferguson",
        reasons: [
          {
            text: "Stable development supports BF.",
            citations: ["dx:r1:ave:2019"],
          },
        ],
      },
    ],
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

function makeDiagnosticsBundle(): DiagnosticsBundle {
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
        linkRatios: [{ origin: "2019", factor: 1.48 }],
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
        actualMinusExpected: -158,
        actualToExpectedRatio: 0.9639,
      },
    ],
    clBfDivergence: [
      {
        id: "dx:r1:cl_bf_divergence:2019",
        origin: "2019",
        clUltimate: 4213,
        bfUltimate: 4100,
        divergence: 113,
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
    // With the bundle not yet fetched it shows the brief loading state (not the
    // obsolete "later story" text).
    expect(screen.getByText(/Loading diagnostics/i)).toBeDefined();
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

  it("complete run with a DiagnosticsBundle renders the panels (Story 4.5, AC2)", () => {
    render(
      <RunDetail
        run={makeRun({
          status: "complete",
          hasResults: true,
          hasDiagnostics: true,
          completedAt: "2026-07-19T00:00:02.000Z",
        })}
        diagnosticsBundle={makeDiagnosticsBundle()}
        onRetry={vi.fn()}
      />,
    );

    // Switch to the Diagnostics tab; the panels render (a residual value + a
    // Diagnostic ID present) with no Interpretation involvement.
    fireEvent.click(screen.getByRole("button", { name: "Diagnostics" }));
    expect(
      screen.getByText(/Actual vs expected — latest diagonal/i),
    ).toBeDefined();
    expect(screen.getByText("1.10")).toBeDefined(); // residual, verbatim
  });

  it("hasDiagnostics but no bundle yet → loading placeholder, no panels", () => {
    render(
      <RunDetail
        run={makeRun({ status: "complete", hasDiagnostics: true })}
        diagnosticsBundle={null}
        onRetry={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Diagnostics" }));
    expect(screen.getByText(/Loading diagnostics/i)).toBeDefined();
  });

  it("Engine-Only Mode (simulated): Diagnostics render with no Interpretation props (AC7)", () => {
    // Diagnostics depend ONLY on the engine-produced bundle — there are no
    // interpretation/agent props to omit — so rendering the panels is proof
    // they remain fully viewable when Interpretation is unavailable (NFR-2).
    render(
      <RunDetail
        run={makeRun({ status: "complete", hasDiagnostics: true })}
        diagnosticsBundle={makeDiagnosticsBundle()}
        onRetry={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Diagnostics" }));
    expect(
      screen.getByText(/LDF stability by development period/i),
    ).toBeDefined();
    expect(screen.getByText(/Residual heatmap/i)).toBeDefined();
  });

  it("Engine-Only Mode (engineOnly=true): Diagnostics stay fully viewable, Interpretation trigger disabled (Story 5.6, AC-3/NFR-2)", () => {
    render(
      <RunDetail
        run={makeRun({ status: "complete", hasResults: true, hasDiagnostics: true })}
        diagnosticsBundle={makeDiagnosticsBundle()}
        resultSet={undefined}
        onRetry={vi.fn()}
        onGenerateInterpretation={vi
          .fn<() => Promise<{ status: "accepted" | "rejected" }>>()
          .mockResolvedValue({ status: "accepted" })}
        engineOnly
      />,
    );
    // NFR-2 invariant: Diagnostics render fully while in Engine-Only Mode.
    fireEvent.click(screen.getByRole("button", { name: "Diagnostics" }));
    expect(
      screen.getByText(/LDF stability by development period/i),
    ).toBeDefined();
    expect(screen.getByText(/Residual heatmap/i)).toBeDefined();
    // The Interpretation trigger is disabled (AC-3).
    fireEvent.focus(screen.getByRole("tab", { name: "Interpretation" }));
    const button = screen.getByRole("button", { name: /Generate interpretation/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it("deep link: a #<diagnosticId> hash opens the Diagnostics tab + selects it (Story 4.6, AC4)", () => {
    window.location.hash = "#dx:r1:residual:2019:12";
    const { container } = render(
      <RunDetail
        run={makeRun({ status: "complete", hasDiagnostics: true })}
        diagnosticsBundle={makeDiagnosticsBundle()}
        onRetry={vi.fn()}
      />,
    );
    // No tab click needed — the hash switched the active tab to Diagnostics…
    expect(screen.getByText(/Residual heatmap/i)).toBeDefined();
    // …and the addressed residual is selected into the context rail.
    const rail = within(
      container.querySelector(
        'aside[aria-label="Selected diagnostic detail"]',
      ) as HTMLElement,
    );
    expect(rail.getByText("Residual 2019 · 12→24")).toBeDefined();
  });

  it("citation chip click switches to the Diagnostics tab + selects the id (Story 5.5, D6)", () => {
    const onGenerateInterpretation = vi
      .fn<() => Promise<{ status: "accepted" | "rejected" }>>()
      .mockResolvedValue({ status: "accepted" });
    const { container } = render(
      <RunDetail
        run={makeRun({
          status: "complete",
          hasResults: true,
          hasDiagnostics: true,
          hasRecommendations: true,
          completedAt: "2026-07-19T00:00:02.000Z",
        })}
        diagnosticsBundle={makeDiagnosticsBundle()}
        recommendations={makeRecommendations()}
        onRetry={vi.fn()}
        onGenerateInterpretation={onGenerateInterpretation}
      />,
    );

    // Switch to the Interpretation tab; the accepted table renders with a chip.
    // Radix Tabs activate on focus (automatic mode), not a bare click in jsdom.
    fireEvent.focus(screen.getByRole("tab", { name: "Interpretation" }));
    const chip = screen.getByRole("link", {
      name: /Citation, diagnostic Actual vs expected, 2019/i,
    });
    // Clicking the chip sets the raw dx: hash…
    fireEvent.click(chip);
    expect(window.location.hash).toBe("#dx:r1:ave:2019");
    // The hashchange listener does not auto-fire in jsdom on assignment, so
    // dispatch it explicitly to exercise RunDetail's D6 effect.
    fireEvent(window, new HashChangeEvent("hashchange"));

    // …which flips to the Diagnostics tab and selects the AvE element into the rail.
    expect(screen.getByText(/Residual heatmap/i)).toBeDefined();
    const rail = within(
      container.querySelector(
        'aside[aria-label="Selected diagnostic detail"]',
      ) as HTMLElement,
    );
    expect(rail.getByText(/Actual vs expected — 2019/i)).toBeDefined();
  });

  it("Story 6.3: threads overrides/canOverride/onOverride to the accepted Interpretation table", () => {
    render(
      <RunDetail
        run={makeRun({
          status: "complete",
          hasResults: true,
          hasDiagnostics: true,
          hasRecommendations: true,
          completedAt: "2026-07-19T00:00:02.000Z",
        })}
        diagnosticsBundle={makeDiagnosticsBundle()}
        recommendations={makeRecommendations()}
        onRetry={vi.fn()}
        onGenerateInterpretation={vi
          .fn<() => Promise<{ status: "accepted" | "rejected" }>>()
          .mockResolvedValue({ status: "accepted" })}
        canOverride={true}
        overrides={[
          {
            origin: "2019",
            overridingMethod: "chain_ladder",
            reason: "a priori better grounded",
            overriddenBy: "user_senior",
            overriddenAt: "2026-07-19T10:00:00.000Z",
          },
        ]}
        onOverride={vi.fn()}
      />,
    );
    fireEvent.focus(screen.getByRole("tab", { name: "Interpretation" }));
    // The threaded props reach RecommendationTable: the live control + the card.
    expect(
      (screen.getByRole("button", {
        name: "Change override",
      }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(screen.getByText("overridden")).toBeDefined();
    expect(screen.getByText(/a priori better grounded/)).toBeDefined();
  });

  it("Story 6.3: unwired (overrides omitted) degrades to no override capability", () => {
    render(
      <RunDetail
        run={makeRun({
          status: "complete",
          hasResults: true,
          hasDiagnostics: true,
          hasRecommendations: true,
          completedAt: "2026-07-19T00:00:02.000Z",
        })}
        diagnosticsBundle={makeDiagnosticsBundle()}
        recommendations={makeRecommendations()}
        onRetry={vi.fn()}
        onGenerateInterpretation={vi
          .fn<() => Promise<{ status: "accepted" | "rejected" }>>()
          .mockResolvedValue({ status: "accepted" })}
      />,
    );
    fireEvent.focus(screen.getByRole("tab", { name: "Interpretation" }));
    // No overrides → the row is "accepted"; canOverride defaults false → the
    // Override control is disabled (Analyst-style), no override card.
    expect(screen.getByText("accepted")).toBeDefined();
    expect(screen.queryByText("overridden")).toBeNull();
    expect(
      (screen.getByRole("button", {
        name: "Override",
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
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

// --- Story 4.7: re-derive trigger + outcome panel (AC1, AC5) -----------------

function makeReport(
  overrides: Partial<import("@/convex/lib/engineContract").ReDerivationReport> = {},
): import("@/convex/lib/engineContract").ReDerivationReport {
  return {
    schemaVersion: "1.0.0",
    runId: "r1",
    reproduced: true,
    triangleHashVerified: true,
    tier: "exact",
    discrepancies: [],
    ...overrides,
  };
}

const completeRun = () =>
  makeRun({
    status: "complete",
    hasResults: true,
    hasDiagnostics: true,
    completedAt: "2026-07-19T00:00:02.000Z",
  });

describe("RunDetail — re-derivation (Story 4.7, AC1/AC5)", () => {
  it("a completed run with onRederive shows the Re-derive button", () => {
    render(<RunDetail run={completeRun()} onRetry={vi.fn()} onRederive={vi.fn()} />);
    expect(screen.getByRole("button", { name: /re-derive/i })).toBeDefined();
  });

  it("a non-complete run shows no Re-derive button", () => {
    render(
      <RunDetail
        run={makeRun({ status: "running" })}
        onRetry={vi.fn()}
        onRederive={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /re-derive/i })).toBeNull();
  });

  it("a completed run without onRederive shows no button (degrades cleanly)", () => {
    render(<RunDetail run={completeRun()} onRetry={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /re-derive/i })).toBeNull();
  });

  it("reproduced → clicking renders the green confirmation naming the tier", async () => {
    const onRederive = vi.fn().mockResolvedValue(makeReport({ tier: "exact" }));
    render(<RunDetail run={completeRun()} onRetry={vi.fn()} onRederive={onRederive} />);

    fireEvent.click(screen.getByRole("button", { name: /^re-derive$/i }));
    expect(onRederive).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Reproduced ✓/)).toBeDefined();
    expect(screen.getByText(/pinned platform/i)).toBeDefined();
  });

  it("discrepancy → clicking renders the discrepancy table with the delta", async () => {
    const onRederive = vi.fn().mockResolvedValue(
      makeReport({
        reproduced: false,
        tier: "exact",
        discrepancies: [
          {
            method: "chain_ladder",
            field: "ultimate",
            key: "2019",
            stored: 5201,
            rederived: 5200,
            delta: 1,
          },
        ],
      }),
    );
    render(<RunDetail run={completeRun()} onRetry={vi.fn()} onRederive={onRederive} />);

    fireEvent.click(screen.getByRole("button", { name: /^re-derive$/i }));
    expect(await screen.findByText(/did not reproduce/i)).toBeDefined();
    // The per-figure row + engine-computed signed delta (display only, AD-1).
    expect(screen.getByText("ultimate")).toBeDefined();
    expect(screen.getByText("+1")).toBeDefined();
  });

  it("a re-derivation error is surfaced in an alert", async () => {
    const onRederive = vi.fn().mockRejectedValue(new Error("The engine is down."));
    render(<RunDetail run={completeRun()} onRetry={vi.fn()} onRederive={onRederive} />);

    fireEvent.click(screen.getByRole("button", { name: /^re-derive$/i }));
    await waitFor(() =>
      expect(screen.getByText("The engine is down.")).toBeDefined(),
    );
  });
});

describe("RunDetail — Report tab (Story 6.1)", () => {
  const reportHandlers = () => ({
    onEditReport: vi.fn().mockResolvedValue({ contentVersion: 2 }),
    onCreateManual: vi.fn().mockResolvedValue("rep1"),
    onGenerateDraft: vi.fn().mockResolvedValue({ status: "accepted" as const }),
  });

  it("degrades to the Epic-6 placeholder when the report callbacks are unwired", () => {
    render(<RunDetail run={completeRun()} onRetry={vi.fn()} />);
    fireEvent.focus(screen.getByRole("tab", { name: "Report" }));
    expect(
      screen.getByText(/Report unlocks after Interpretation/i),
    ).toBeDefined();
    // The other tabs are unaffected — Results/Diagnostics/Interpretation triggers persist.
    expect(screen.getByRole("tab", { name: "Results" })).toBeDefined();
    expect(screen.getByRole("tab", { name: "Diagnostics" })).toBeDefined();
    expect(screen.getByRole("tab", { name: "Interpretation" })).toBeDefined();
  });

  it("wired + no report + hasRecommendations → the ReportTab creation view (Generate + manual)", () => {
    render(
      <RunDetail
        run={{ ...completeRun(), hasRecommendations: true }}
        report={null}
        onRetry={vi.fn()}
        {...reportHandlers()}
      />,
    );
    fireEvent.focus(screen.getByRole("tab", { name: "Report" }));
    expect(
      screen.getByRole("button", { name: "Generate report draft" }),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Start from a blank template" }),
    ).toBeDefined();
  });
});
