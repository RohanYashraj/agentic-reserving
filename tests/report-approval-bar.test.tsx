// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ReportApprovalBar,
  type SeniorActuary,
} from "@/components/report/ReportApprovalBar";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import type { DiagnosticsBundle } from "@/convex/lib/engineContract";

afterEach(cleanup);

const CITE = "dx:r1:ave:2019";

function makeDiagnosticsBundle(): DiagnosticsBundle {
  return {
    schemaVersion: "1.0.0",
    runId: "r1",
    triangleHash: "a".repeat(64),
    ldfStability: [],
    ave: [
      {
        id: CITE,
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

/** A report document with two cited, resolving figure claims (no failures). */
function citedReportDoc(): Doc<"reserveReports">["report"] {
  const section = (text: string, citations: string[] = []) => ({
    text,
    citations,
  });
  return {
    schemaVersion: "1.0.0",
    runId: "r1",
    machineDrafted: false,
    executiveSummary: section(`The reserve is 4,213 [[cite:${CITE}]].`, [CITE]),
    methodSelectionRationale: section(`The factor is 1.25 [[cite:${CITE}]].`, [
      CITE,
    ]),
    movementCommentary: section("No notable movements."),
    limitations: section("Estimates carry uncertainty."),
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

describe("ReportApprovalBar — approve & publish (Story 6.4, AC-1, AC-2)", () => {
  const bundle = makeDiagnosticsBundle();

  function renderApprovable(
    overrides: Partial<Doc<"reserveReports">> = {},
    props: {
      canApprove?: boolean;
      overrideCount?: number;
      onApprove?: () => Promise<void>;
      onStartNewVersion?: () => Promise<void>;
      diagnosticsBundle?: DiagnosticsBundle | null;
    } = {},
  ) {
    return render(
      <ReportApprovalBar
        report={makeReportRow({
          status: "awaiting_review",
          machineDrafted: false,
          submittedBy: "user_a",
          assignee: "user_priya",
          report: citedReportDoc(),
          draftBaseline: citedReportDoc(),
          contentVersion: 2,
          ...overrides,
        })}
        seniorActuaries={SENIOR_ACTUARIES}
        onSubmitForReview={vi.fn().mockResolvedValue(undefined)}
        canApprove={props.canApprove ?? true}
        diagnosticsBundle={
          props.diagnosticsBundle === undefined ? bundle : props.diagnosticsBundle
        }
        overrideCount={props.overrideCount ?? 0}
        onApprove={props.onApprove ?? vi.fn().mockResolvedValue(undefined)}
        onStartNewVersion={
          props.onStartNewVersion ?? vi.fn().mockResolvedValue(undefined)
        }
      />,
    );
  }

  it("Senior Actuary + no uncited claims → count, diff link, enabled Approve; dialog restates the record", async () => {
    const onApprove = vi.fn().mockResolvedValue(undefined);
    renderApprovable({}, { onApprove, overrideCount: 1 });

    expect(screen.getByText(/2 claims · 2 citations resolve/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Diff since draft" })).toBeTruthy();

    const trigger = screen.getByRole("button", { name: "Approve & publish" });
    expect((trigger as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("Draft v2");
    expect(dialog.textContent).toContain("2/2 citations");
    expect(dialog.textContent).toContain("1 recommendation override");
    expect(dialog.textContent).toContain("cannot be edited");
    await waitFor(() =>
      expect(within(dialog).getByRole("button", { name: "Cancel" })).toBe(
        document.activeElement,
      ),
    );

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Approve & publish" }),
    );
    await waitFor(() => expect(onApprove).toHaveBeenCalled());
  });

  it("Esc / Cancel close the approval dialog WITHOUT publishing", () => {
    const onApprove = vi.fn().mockResolvedValue(undefined);
    renderApprovable({}, { onApprove });
    fireEvent.click(screen.getByRole("button", { name: "Approve & publish" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onApprove).not.toHaveBeenCalled();
  });

  it("an uncited claim → Approve disabled + the failing sentence linked", () => {
    const section = (text: string, citations: string[] = []) => ({
      text,
      citations,
    });
    renderApprovable({
      report: {
        schemaVersion: "1.0.0",
        runId: "r1",
        machineDrafted: false,
        executiveSummary: section("The reserve is 4,213."), // uncited figure
        methodSelectionRationale: section("Chain ladder was chosen."),
        movementCommentary: section("No notable movements."),
        limitations: section("Estimates carry uncertainty."),
      },
    });
    const approve = screen.getByRole("button", { name: "Approve & publish" });
    expect((approve as HTMLButtonElement).disabled).toBe(true);
    // The failing sentence renders as a link (button) to its section.
    expect(screen.getByRole("button", { name: /The reserve is 4,213/ })).toBeTruthy();
  });

  it("an Analyst (canApprove=false) → awaiting-review text only, NO approve controls", () => {
    renderApprovable({}, { canApprove: false });
    expect(screen.getByText("Awaiting Senior Actuary review")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Approve & publish" }),
    ).toBeNull();
    expect(screen.queryByText(/citations resolve/)).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Diff since draft" }),
    ).toBeNull();
  });

  it("the diff link opens the diff view; with no baseline it is disabled with a note", () => {
    renderApprovable();
    fireEvent.click(screen.getByRole("button", { name: "Diff since draft" }));
    expect(
      screen.getByText("Changes since the drafted version"),
    ).toBeTruthy();
    cleanup();

    renderApprovable({ draftBaseline: undefined });
    const diff = screen.getByRole("button", { name: "Diff since draft" });
    expect((diff as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("No analyst edits to compare")).toBeTruthy();
  });

  it("a published report → the badge, the 'Approved by … · Logged' record, Start new version", async () => {
    const onStartNewVersion = vi.fn().mockResolvedValue(undefined);
    render(
      <ReportApprovalBar
        report={makeReportRow({
          status: "published",
          machineDrafted: false,
          approvedBy: "Priya N.",
          approvedAt: "2026-07-19T14:32:00.000Z",
        })}
        seniorActuaries={SENIOR_ACTUARIES}
        onSubmitForReview={vi.fn().mockResolvedValue(undefined)}
        onStartNewVersion={onStartNewVersion}
      />,
    );
    expect(screen.getByText("published")).toBeTruthy();
    expect(screen.getByText(/Approved by Priya N\./)).toBeTruthy();
    expect(screen.getByText(/· Logged/)).toBeTruthy();
    // The 6.5 export seam is present but no export control is built.
    expect(screen.queryByRole("button", { name: /export/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Start new version" }));
    await waitFor(() => expect(onStartNewVersion).toHaveBeenCalled());
  });
});
