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
  ReportApprovalBar,
  type SeniorActuary,
} from "@/components/report/ReportApprovalBar";
import type { Doc, Id } from "@/convex/_generated/dataModel";

afterEach(cleanup);

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

const SENIOR_ACTUARIES: SeniorActuary[] = [
  { id: "user_priya", name: "Priya N." },
  { id: "user_dana", name: "Dana K." },
];

describe("ReportApprovalBar (Story 6.2, AC-1)", () => {
  it("a draft → the assign picker + a 'Submit for review' button", () => {
    render(
      <ReportApprovalBar
        report={makeReportRow()}
        seniorActuaries={SENIOR_ACTUARIES}
        onSubmitForReview={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.disabled).toBe(false);
    expect(screen.getByRole("option", { name: "Priya N." })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Submit for review" }),
    ).toBeTruthy();
  });

  it("opening the dialog restates Draft v{n} + the assignee; initial focus is Cancel", async () => {
    render(
      <ReportApprovalBar
        report={makeReportRow({ contentVersion: 3 })}
        seniorActuaries={SENIOR_ACTUARIES}
        onSubmitForReview={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "user_priya" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("Draft v3");
    expect(dialog.textContent).toContain("Priya N.");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Cancel" })).toBe(
        document.activeElement,
      ),
    );
  });

  it("clicking Submit calls onSubmitForReview with the selected assignee id", async () => {
    const onSubmitForReview = vi.fn().mockResolvedValue(undefined);
    render(
      <ReportApprovalBar
        report={makeReportRow()}
        seniorActuaries={SENIOR_ACTUARIES}
        onSubmitForReview={onSubmitForReview}
      />,
    );
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "user_dana" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() =>
      expect(onSubmitForReview).toHaveBeenCalledWith("user_dana"),
    );
  });

  it("Cancel closes WITHOUT calling onSubmitForReview", () => {
    const onSubmitForReview = vi.fn().mockResolvedValue(undefined);
    render(
      <ReportApprovalBar
        report={makeReportRow()}
        seniorActuaries={SENIOR_ACTUARIES}
        onSubmitForReview={onSubmitForReview}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onSubmitForReview).not.toHaveBeenCalled();
  });

  it("Esc closes WITHOUT calling onSubmitForReview", () => {
    const onSubmitForReview = vi.fn().mockResolvedValue(undefined);
    render(
      <ReportApprovalBar
        report={makeReportRow()}
        seniorActuaries={SENIOR_ACTUARIES}
        onSubmitForReview={onSubmitForReview}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
    fireEvent.keyDown(screen.getByRole("dialog"), {
      key: "Escape",
      code: "Escape",
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onSubmitForReview).not.toHaveBeenCalled();
  });

  it("an awaiting_review report → 'Awaiting Senior Actuary review' + assignee name, NO submit control", () => {
    render(
      <ReportApprovalBar
        report={makeReportRow({
          status: "awaiting_review",
          machineDrafted: false,
          submittedBy: "user_a",
          assignee: "user_priya",
        })}
        seniorActuaries={SENIOR_ACTUARIES}
        onSubmitForReview={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(screen.getByText("Awaiting Senior Actuary review")).toBeTruthy();
    expect(screen.getByText(/Priya N\./)).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Submit for review" }),
    ).toBeNull();
  });

  it("empty seniorActuaries on a draft → picker disabled + note, submit still callable with assignee null", async () => {
    const onSubmitForReview = vi.fn().mockResolvedValue(undefined);
    render(
      <ReportApprovalBar
        report={makeReportRow()}
        seniorActuaries={[]}
        onSubmitForReview={onSubmitForReview}
      />,
    );
    expect((screen.getByRole("combobox") as HTMLSelectElement).disabled).toBe(
      true,
    );
    expect(screen.getByText(/No Senior Actuaries/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(onSubmitForReview).toHaveBeenCalledWith(null));
  });
});
