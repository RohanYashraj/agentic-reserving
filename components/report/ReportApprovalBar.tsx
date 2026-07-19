"use client";

import { useRef, useState } from "react";

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

// Story 6.2 (AC-1, D6/D7): the sticky analyst-side approval bar (UX-DR13,
// EXPERIENCE.md:74, mockup report-review.html). Presentational — data +
// callbacks arrive via props (no Convex hooks here, matching ReportTab's
// posture, AD-1). Rendered below the editor whenever a report exists. Variant
// by `report.status`:
//   • draft           → the assign control (Senior-Actuary picker) + a "Submit
//                        for review" primary opening the D6 audit dialog.
//   • awaiting_review → "Awaiting Senior Actuary review" + the assignee name,
//                        read-only (the editor is already locked, D2). The
//                        Senior-Actuary Approve region is 6.4 (seam below).
//   • published       → a minimal read-only placeholder (6.4 owns publish).
//
// NO optimistic UI (AC-2/AD-3): the submit dialog awaits the mutation and lets
// the getReserveReport subscription re-render the locked state on server ack —
// nothing flips locally. The bar uses neutral/primary/caution tokens only;
// provenance-violet stays chip-exclusive (DESIGN.md:89).

export type SeniorActuary = { id: string; name: string };

export function ReportApprovalBar({
  report,
  seniorActuaries,
  onSubmitForReview,
}: {
  report: Doc<"reserveReports">;
  seniorActuaries: SeniorActuary[];
  onSubmitForReview: (assignee: string | null) => Promise<void>;
}) {
  if (report.status === "awaiting_review") {
    return <AwaitingReviewBar report={report} seniorActuaries={seniorActuaries} />;
  }
  if (report.status === "published") {
    return (
      <BarShell>
        <StatusBadge status="published" />
        <span className="text-sm text-muted-foreground">
          This Reserve Report is published.
        </span>
        {/* 6.4: the published composition (immutable record, export) renders here. */}
      </BarShell>
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

// --- awaiting_review: read-only hand-off state -----------------------------

function AwaitingReviewBar({
  report,
  seniorActuaries,
}: {
  report: Doc<"reserveReports">;
  seniorActuaries: SeniorActuary[];
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
      {/* 6.4: Senior-Actuary Approve & Publish, the "N claims · N citations
          resolve" count, and the diff-since-draft link render here (UX-DR13). */}
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
