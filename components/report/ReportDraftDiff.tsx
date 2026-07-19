"use client";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ReserveReport } from "@/convex/lib/engineContract";

// Story 6.4 (AC-1, D9): the diff-since-draft view. A read-only per-section
// comparison of the machine-drafted baseline (what the interpretation layer
// produced, captured at first human edit) against the current content. Simple
// word-level string diff — display-only (AD-1), dependency-free (no diff
// library; a rich inline diff is a deferrable nicety, deferred-work §6.4).
// Figures render verbatim from the two stored `report` copies. Presented inside
// the shared Dialog primitive so it is focus-trapped and Esc-dismissable.

const SECTION_META: { key: SectionKey; label: string }[] = [
  { key: "executiveSummary", label: "Executive summary" },
  { key: "methodSelectionRationale", label: "Method selection rationale" },
  { key: "movementCommentary", label: "Movement commentary" },
  { key: "limitations", label: "Limitations" },
];

type SectionKey =
  | "executiveSummary"
  | "methodSelectionRationale"
  | "movementCommentary"
  | "limitations";

type DiffToken = { value: string; kind: "same" | "added" | "removed" };

/**
 * A minimal word-level diff via an LCS over whitespace-split tokens. Returns the
 * merged token stream (removed baseline runs + added current runs, shared runs
 * once). Pure string comparison — no arithmetic (AD-1).
 */
function wordDiff(baseline: string, current: string): DiffToken[] {
  const a = baseline.length ? baseline.split(/(\s+)/) : [];
  const b = current.length ? current.split(/(\s+)/) : [];
  // LCS table.
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] =
        a[i] === b[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: DiffToken[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ value: a[i], kind: "same" });
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ value: a[i], kind: "removed" });
      i += 1;
    } else {
      out.push({ value: b[j], kind: "added" });
      j += 1;
    }
  }
  while (i < a.length) out.push({ value: a[i++], kind: "removed" });
  while (j < b.length) out.push({ value: b[j++], kind: "added" });
  return out;
}

function SectionDiff({
  label,
  baseline,
  current,
}: {
  label: string;
  baseline: string;
  current: string;
}) {
  const unchanged = baseline === current;
  const tokens = unchanged ? [] : wordDiff(baseline, current);
  return (
    <div className="space-y-1">
      <h3 className="text-xs font-medium text-foreground">{label}</h3>
      {unchanged ? (
        <p className="text-sm text-muted-foreground">
          No analyst edits in this section.
        </p>
      ) : (
        <p className="whitespace-pre-wrap text-sm text-foreground">
          {tokens.map((t, idx) =>
            t.kind === "same" ? (
              <span key={idx}>{t.value}</span>
            ) : t.kind === "added" ? (
              <span
                key={idx}
                className="rounded-sm bg-published-subtle text-published"
              >
                {t.value}
              </span>
            ) : (
              <span
                key={idx}
                className="rounded-sm bg-caution-subtle text-caution line-through"
              >
                {t.value}
              </span>
            ),
          )}
        </p>
      )}
    </div>
  );
}

export function ReportDraftDiff({
  current,
  baseline,
  onClose,
}: {
  current: ReserveReport;
  baseline: ReserveReport;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Changes since the drafted version</DialogTitle>
          <DialogDescription>
            Compared against the version the interpretation layer drafted.
            Removed text is struck through; added text is highlighted.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto">
          {SECTION_META.map(({ key, label }) => (
            <SectionDiff
              key={key}
              label={label}
              baseline={baseline[key].text}
              current={current[key].text}
            />
          ))}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <button
              type="button"
              className="w-fit rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted"
            >
              Close
            </button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
