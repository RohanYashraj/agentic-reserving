"use client";

import { useRef, useState } from "react";

import { ReportDraftDiff } from "@/components/report/ReportDraftDiff";
import {
  reportCitationResolution,
  type FailingSentence,
  type ReportSectionKey,
} from "@/components/report/reportCitationResolution";
import { StatusBadge } from "@/components/StatusBadge";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Doc } from "@/convex/_generated/dataModel";
import type { DiagnosticsBundle } from "@/convex/lib/engineContract";

// Story 6.2/6.4 (AC-1, D6/D7): the sticky approval bar (UX-DR13, EXPERIENCE.md
// Flow 3, mockup report-review.html). Presentational — data + callbacks arrive
// via props (no Convex hooks here, matching ReportTab's posture, AD-1). Rendered
// below the editor whenever a report exists. Variant by `report.status`:
//   • draft           → the assign control (Senior-Actuary picker) + a "Submit
//                        for review" primary opening the 6.2 audit dialog.
//   • awaiting_review → "Awaiting Senior Actuary review" + the assignee name for
//                        ALL viewers; a Senior Actuary (canApprove) ALSO sees the
//                        "N claims · N citations resolve" count, the diff-since-
//                        draft link, and the green Approve & Publish action (6.4).
//   • published       → the published composition: the `published` badge, the
//                        inline "Approved by … · Logged" record, and Start new
//                        version (6.4). Word export renders here in 6.5.
//
// NO optimistic UI (AC-2/AD-3): every audit-generating dialog awaits the mutation
// and lets the getReserveReport subscription re-render on server ack — nothing
// flips locally. The Approve & Publish button is the ONLY green action surface
// (DESIGN.md published-green); provenance-violet stays chip-exclusive.

export type SeniorActuary = { id: string; name: string };

export function ReportApprovalBar({
  report,
  seniorActuaries,
  onSubmitForReview,
  canApprove = false,
  diagnosticsBundle = null,
  overrideCount = 0,
  onApprove,
  onStartNewVersion,
}: {
  report: Doc<"reserveReports">;
  seniorActuaries: SeniorActuary[];
  onSubmitForReview: (assignee: string | null) => Promise<void>;
  // Story 6.4 (D7): the current user is a Senior Actuary (display gating only —
  // the server `requireRole` is the authority, AD-4). Defaulted so pre-6.4 call
  // sites degrade to the read-only analyst view.
  canApprove?: boolean;
  diagnosticsBundle?: DiagnosticsBundle | null;
  overrideCount?: number;
  onApprove?: () => Promise<void>;
  onStartNewVersion?: () => Promise<void>;
}) {
  if (report.status === "awaiting_review") {
    return (
      <AwaitingReviewBar
        report={report}
        seniorActuaries={seniorActuaries}
        canApprove={canApprove}
        diagnosticsBundle={diagnosticsBundle}
        overrideCount={overrideCount}
        onApprove={onApprove}
      />
    );
  }
  if (report.status === "published") {
    return (
      <PublishedBar report={report} onStartNewVersion={onStartNewVersion} />
    );
  }
  return (
    <DraftBar
      report={report}
      seniorActuaries={seniorActuaries}
      onSubmitForReview={onSubmitForReview}
    />
  );
}

// --- draft: assign + submit ------------------------------------------------

function DraftBar({
  report,
  seniorActuaries,
  onSubmitForReview,
}: {
  report: Doc<"reserveReports">;
  seniorActuaries: SeniorActuary[];
  onSubmitForReview: (assignee: string | null) => Promise<void>;
}) {
  const [selectedAssignee, setSelectedAssignee] = useState<string>("");
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const noActuaries = seniorActuaries.length === 0;
  const assignee = selectedAssignee || null;
  const assigneeName =
    seniorActuaries.find((sa) => sa.id === selectedAssignee)?.name ?? null;

  async function confirmSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      await onSubmitForReview(assignee);
      // Server ack: the getReserveReport subscription flips status →
      // awaiting_review and this bar + the editor re-render locked. Close the
      // dialog; do NOT flip any local status optimistically (AC-2/D6).
      setOpen(false);
    } catch (err) {
      setError((err as Error).message ?? "The report could not be submitted.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <BarShell>
      <div className="flex flex-1 flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>Assign a Senior Actuary</span>
          <select
            value={selectedAssignee}
            disabled={noActuaries}
            onChange={(e) => setSelectedAssignee(e.target.value)}
            className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground disabled:opacity-50"
          >
            <option value="">Unassigned</option>
            {seniorActuaries.map((sa) => (
              <option key={sa.id} value={sa.id}>
                {sa.name}
              </option>
            ))}
          </select>
        </label>
        {noActuaries && (
          <span className="text-xs text-muted-foreground">
            No Senior Actuaries in this Workspace
          </span>
        )}
      </div>

      <span className="text-xs text-muted-foreground">
        Submitting sends this to a Senior Actuary for approval.
      </span>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          // Esc / overlay-click / Cancel all route here — clear any error and
          // never fire the action on dismiss.
          setOpen(next);
          if (!next) setError(null);
        }}
      >
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-fit rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          Submit for review
        </button>

        <DialogContent
          // Initial focus on Cancel — the safety posture for audit-generating
          // dialogs (UX-DR14; the 6.4 approval dialog does the same).
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            cancelRef.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>Submit for review</DialogTitle>
            <DialogDescription>
              This submits Draft v{report.contentVersion} for review
              {assigneeName ? ` and assigns ${assigneeName}` : ""}. Your
              submission will be logged, and the draft will lock read-only while
              it is under review.
            </DialogDescription>
          </DialogHeader>

          {error && (
            <p className="text-sm text-caution" role="alert">
              {error}
            </p>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <button
                ref={cancelRef}
                type="button"
                disabled={submitting}
                className="w-fit rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
              >
                Cancel
              </button>
            </DialogClose>
            <button
              type="button"
              disabled={submitting}
              onClick={() => void confirmSubmit()}
              className="w-fit rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {submitting ? "Submitting…" : "Submit"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </BarShell>
  );
}

// --- awaiting_review: read-only hand-off state (+ SA approve region) --------

function AwaitingReviewBar({
  report,
  seniorActuaries,
  canApprove,
  diagnosticsBundle,
  overrideCount,
  onApprove,
}: {
  report: Doc<"reserveReports">;
  seniorActuaries: SeniorActuary[];
  canApprove: boolean;
  diagnosticsBundle: DiagnosticsBundle | null;
  overrideCount: number;
  onApprove?: () => Promise<void>;
}) {
  const assigneeName = report.assignee
    ? (seniorActuaries.find((sa) => sa.id === report.assignee)?.name ??
      report.assignee)
    : "unassigned";

  return (
    <BarShell>
      <StatusBadge status="awaiting review" />
      <span className="text-sm text-foreground">
        Awaiting Senior Actuary review
      </span>
      <span className="text-sm text-muted-foreground">· {assigneeName}</span>

      {/* Story 6.4 (D7): the Senior-Actuary approve region. Analysts see the
          state above only; the SERVER requireRole is the authority (AD-4). */}
      {canApprove && (
        <ApproveRegion
          report={report}
          diagnosticsBundle={diagnosticsBundle}
          overrideCount={overrideCount}
          onApprove={onApprove}
        />
      )}
    </BarShell>
  );
}

/** Scroll to a Reserve Report section (the failing-sentence link target, D6). */
function scrollToSection(sectionKey: ReportSectionKey) {
  if (typeof document === "undefined") return;
  document
    .getElementById(`report-section-${sectionKey}`)
    ?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function ApproveRegion({
  report,
  diagnosticsBundle,
  overrideCount,
  onApprove,
}: {
  report: Doc<"reserveReports">;
  diagnosticsBundle: DiagnosticsBundle | null;
  overrideCount: number;
  onApprove?: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  // The resolution count + the failing-sentence blocker (D6). Same helper the
  // server enforces (D2), so the button state and the server gate never disagree.
  const resolution = reportCitationResolution(report.report, diagnosticsBundle);
  const blocked = resolution.failingSentences.length > 0;
  const hasBaseline = report.draftBaseline !== undefined;

  async function confirmApprove() {
    if (!onApprove) return;
    setPublishing(true);
    setError(null);
    try {
      await onApprove();
      // Server ack: the getReserveReport subscription flips status → published
      // and this bar re-renders the published composition. No optimistic UI (D9).
      setOpen(false);
    } catch (err) {
      setError((err as Error).message ?? "The report could not be published.");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="flex flex-1 flex-wrap items-center justify-end gap-3">
      {/* The citation-resolution count (UX-DR13). */}
      <span className="text-sm text-muted-foreground">
        {resolution.totalClaims} claims · {resolution.resolvedClaims} citations
        resolve
      </span>

      {/* Diff since draft (D9): disabled with a quiet note when there is no
          machine-drafted baseline (a manual / never-edited report). */}
      <button
        type="button"
        disabled={!hasBaseline}
        onClick={() => setDiffOpen(true)}
        className="w-fit rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
      >
        Diff since draft
      </button>
      {!hasBaseline && (
        <span className="text-xs text-muted-foreground">
          No analyst edits to compare
        </span>
      )}

      {blocked ? (
        // The gate is a door, not an alarm: Approve is DISABLED and each failing
        // sentence links to its section (UX-DR13 "the failing sentence linked").
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled
            className="w-fit rounded-md bg-published px-3 py-1.5 text-sm font-medium text-published-foreground opacity-50"
          >
            Approve &amp; publish
          </button>
          <ul className="flex flex-wrap items-center gap-2">
            {resolution.failingSentences.map((f: FailingSentence, i) => (
              <li key={`${f.sectionKey}:${i}`}>
                <button
                  type="button"
                  onClick={() => scrollToSection(f.sectionKey)}
                  className="max-w-[16rem] truncate rounded-sm text-left text-xs text-caution underline underline-offset-2 hover:text-caution/80"
                  title={f.sentence}
                >
                  {f.sentence}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <Dialog
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) setError(null);
          }}
        >
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="w-fit rounded-md bg-published px-3 py-1.5 text-sm font-medium text-published-foreground hover:bg-published/90 disabled:opacity-50"
          >
            Approve &amp; publish
          </button>

          <DialogContent
            // Initial focus on Cancel — the safety posture for audit-generating
            // dialogs (UX-DR14).
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              cancelRef.current?.focus();
            }}
          >
            <DialogHeader>
              <DialogTitle>Approve &amp; publish</DialogTitle>
              <DialogDescription>
                This publishes Draft v{report.contentVersion} with{" "}
                {resolution.resolvedClaims}/{resolution.totalClaims} citations
                resolving
                {overrideCount > 0
                  ? `, including ${overrideCount} recommendation override${
                      overrideCount === 1 ? "" : "s"
                    }`
                  : ""}
                . This will be logged and the published version cannot be edited.
              </DialogDescription>
            </DialogHeader>

            {error && (
              <p className="text-sm text-caution" role="alert">
                {error}
              </p>
            )}

            <DialogFooter>
              <DialogClose asChild>
                <button
                  ref={cancelRef}
                  type="button"
                  disabled={publishing}
                  className="w-fit rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
                >
                  Cancel
                </button>
              </DialogClose>
              <button
                type="button"
                disabled={publishing}
                onClick={() => void confirmApprove()}
                className="w-fit rounded-md bg-published px-3 py-1.5 text-sm font-medium text-published-foreground hover:bg-published/90 disabled:opacity-50"
              >
                {publishing ? "Publishing…" : "Approve & publish"}
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {diffOpen && report.draftBaseline && (
        <ReportDraftDiff
          current={report.report}
          baseline={report.draftBaseline}
          onClose={() => setDiffOpen(false)}
        />
      )}
    </div>
  );
}

// --- published: the immutable record + start new version --------------------

function PublishedBar({
  report,
  onStartNewVersion,
}: {
  report: Doc<"reserveReports">;
  onStartNewVersion?: () => Promise<void>;
}) {
  const [starting, setStarting] = useState(false);

  const approvedRecord = (() => {
    if (!report.approvedBy) return null;
    if (!report.approvedAt) return `Approved by ${report.approvedBy} · Logged`;
    const at = new Date(report.approvedAt);
    const date = at.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    const time = at.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
    return `Approved by ${report.approvedBy}, ${date}, ${time} · Logged`;
  })();

  async function startNewVersion() {
    if (!onStartNewVersion) return;
    setStarting(true);
    try {
      await onStartNewVersion();
      // Server ack: the getReserveReport subscription flips status → draft and
      // the editor re-opens. No optimistic UI (D9).
    } finally {
      setStarting(false);
    }
  }

  return (
    <BarShell>
      <StatusBadge status="published" />
      {approvedRecord && (
        <span className="text-sm text-muted-foreground">{approvedRecord}</span>
      )}
      {onStartNewVersion && (
        <button
          type="button"
          disabled={starting}
          onClick={() => void startNewVersion()}
          className="w-fit rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
        >
          {starting ? "Starting…" : "Start new version"}
        </button>
      )}
      {/* 6.5: Export to Word renders here. */}
    </BarShell>
  );
}

// --- shared sticky shell ----------------------------------------------------

function BarShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky bottom-0 z-10 mt-4 flex flex-wrap items-center gap-3 border-t border-border bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      {children}
    </div>
  );
}
