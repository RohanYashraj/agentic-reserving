// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReportTab } from "@/components/report/ReportTab";
import type { RunView } from "@/components/RunDetail";
import type { Doc, Id } from "@/convex/_generated/dataModel";

afterEach(cleanup);
afterEach(() => {
  window.location.hash = "";
});

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
    hasRecommendations: true,
    hasReserveReport: false,
    interpretationFailure: null,
    ...overrides,
  };
}

function makeReportRow(
  overrides: Partial<Doc<"reserveReports">> = {},
): Doc<"reserveReports"> {
  const section = (text: string, citations: string[] = []) => ({
    text,
    citations,
  });
  return {
    _id: "rep1" as Id<"reserveReports">,
    _creationTime: 0,
    workspaceId: "org_A",
    runId: "r1" as Id<"runs">,
    status: "draft",
    machineDrafted: true,
    contentVersion: 1,
    createdBy: "user_a",
    createdAt: "2026-07-19T00:00:00.000Z",
    updatedBy: "user_a",
    updatedAt: "2026-07-19T00:00:00.000Z",
    report: {
      schemaVersion: "1.0.0",
      runId: "r1",
      machineDrafted: true,
      executiveSummary: section("The overall position is stable."),
      methodSelectionRationale: section("Chain ladder was chosen."),
      movementCommentary: section("No notable movements."),
      limitations: section("Estimates carry uncertainty."),
    },
    ...overrides,
  };
}

function handlers() {
  return {
    onEditReport: vi.fn().mockResolvedValue({ contentVersion: 2 }),
    onCreateManual: vi.fn().mockResolvedValue("rep1"),
    onGenerateDraft: vi.fn().mockResolvedValue({ status: "accepted" as const }),
  };
}

describe("ReportTab (Story 6.1, AC-1, AC-2)", () => {
  it("no report + complete + hasRecommendations + not engineOnly → generate enabled + manual present (D6/D7)", () => {
    const h = handlers();
    render(
      <ReportTab
        run={makeRun()}
        report={null}
        diagnosticsBundle={null}
        engineOnly={false}
        {...h}
      />,
    );
    const generate = screen.getByRole("button", {
      name: "Generate report draft",
    }) as HTMLButtonElement;
    expect(generate.disabled).toBe(false);
    expect(
      screen.getByRole("button", { name: "Start from a blank template" }),
    ).toBeTruthy();
  });

  it("no report + engineOnly → generate DISABLED (tooltip trigger) + manual primary (AC-2)", () => {
    const h = handlers();
    render(
      <ReportTab
        run={makeRun()}
        report={null}
        diagnosticsBundle={null}
        engineOnly={true}
        {...h}
      />,
    );
    const generate = screen.getByRole("button", {
      name: "Generate report draft",
    }) as HTMLButtonElement;
    expect(generate.disabled).toBe(true);
    expect(
      screen.getByRole("button", { name: "Start from a blank template" }),
    ).toBeTruthy();
  });

  it("no report + no recommendations → generate DISABLED + manual primary", () => {
    const h = handlers();
    render(
      <ReportTab
        run={makeRun({ hasRecommendations: false })}
        report={null}
        diagnosticsBundle={null}
        engineOnly={false}
        {...h}
      />,
    );
    const generate = screen.getByRole("button", {
      name: "Generate report draft",
    }) as HTMLButtonElement;
    expect(generate.disabled).toBe(true);
  });

  it("report present → four section editors in order + the Draft v{n} sub-line + a Save control", () => {
    const h = handlers();
    render(
      <ReportTab
        run={makeRun({ hasReserveReport: true })}
        report={makeReportRow()}
        diagnosticsBundle={null}
        engineOnly={false}
        {...h}
      />,
    );
    const regions = screen.getAllByRole("region");
    expect(regions.map((r) => r.getAttribute("aria-label"))).toEqual([
      "Executive summary",
      "Method selection rationale",
      "Movement commentary",
      "Limitations",
    ]);
    expect(screen.getByText(/Draft v1/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  });

  it("clicking Save calls onEditReport with the four section texts", () => {
    const h = handlers();
    render(
      <ReportTab
        run={makeRun({ hasReserveReport: true })}
        report={makeReportRow()}
        diagnosticsBundle={null}
        engineOnly={false}
        {...h}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(h.onEditReport).toHaveBeenCalledWith({
      executiveSummary: "The overall position is stable.",
      methodSelectionRationale: "Chain ladder was chosen.",
      movementCommentary: "No notable movements.",
      limitations: "Estimates carry uncertainty.",
    });
  });

  it("clicking 'Start from a blank template' calls onCreateManual", () => {
    const h = handlers();
    render(
      <ReportTab
        run={makeRun()}
        report={null}
        diagnosticsBundle={null}
        engineOnly={false}
        {...h}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Start from a blank template" }),
    );
    expect(h.onCreateManual).toHaveBeenCalledTimes(1);
  });

  it("clicking 'Generate report draft' calls onGenerateDraft", () => {
    const h = handlers();
    render(
      <ReportTab
        run={makeRun()}
        report={null}
        diagnosticsBundle={null}
        engineOnly={false}
        {...h}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Generate report draft" }));
    expect(h.onGenerateDraft).toHaveBeenCalledTimes(1);
  });

  it("a non-draft (published) report renders read-only — no Save, no × controls", () => {
    const h = handlers();
    render(
      <ReportTab
        run={makeRun({ hasReserveReport: true })}
        report={makeReportRow({ status: "published", machineDrafted: false })}
        diagnosticsBundle={null}
        engineOnly={false}
        {...h}
      />,
    );
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
  });

  it("a report present + onSubmitForReview → the ReportApprovalBar renders below the editor (Story 6.2)", () => {
    const h = handlers();
    render(
      <ReportTab
        run={makeRun({ hasReserveReport: true })}
        report={makeReportRow()}
        diagnosticsBundle={null}
        engineOnly={false}
        seniorActuaries={[{ id: "user_priya", name: "Priya N." }]}
        onSubmitForReview={vi.fn().mockResolvedValue(undefined)}
        {...h}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Submit for review" }),
    ).toBeTruthy();
  });

  it("an awaiting_review report → editor read-only (no Save) + the '· submitted by' sub-line (Story 6.2, D9)", () => {
    const h = handlers();
    render(
      <ReportTab
        run={makeRun({ hasReserveReport: true })}
        report={makeReportRow({
          status: "awaiting_review",
          machineDrafted: false,
          submittedBy: "user_dana",
          assignee: "user_priya",
        })}
        diagnosticsBundle={null}
        engineOnly={false}
        seniorActuaries={[{ id: "user_priya", name: "Priya N." }]}
        onSubmitForReview={vi.fn().mockResolvedValue(undefined)}
        {...h}
      />,
    );
    // The 6.1 editable=false path: read-only, no Save.
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    // The D9 sub-line.
    expect(screen.getByText(/submitted by user_dana/)).toBeTruthy();
    // The bar's awaiting-review state.
    expect(screen.getByText("Awaiting Senior Actuary review")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Submit for review" }),
    ).toBeNull();
  });

  it("before the Run completes with no report → the unlock placeholder", () => {
    const h = handlers();
    render(
      <ReportTab
        run={makeRun({ status: "running", hasResults: false, hasDiagnostics: false, hasRecommendations: false })}
        report={null}
        diagnosticsBundle={null}
        engineOnly={false}
        {...h}
      />,
    );
    expect(
      screen.getByText(/unlocks once the Run completes/i),
    ).toBeTruthy();
  });
});
