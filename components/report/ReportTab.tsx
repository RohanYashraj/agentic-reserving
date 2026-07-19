"use client";

import { useMemo, useState } from "react";

import { ReportApprovalBar, type SeniorActuary } from "@/components/report/ReportApprovalBar";
import { ReportSectionEditor } from "@/components/report/ReportSectionEditor";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { RunView } from "@/components/RunDetail";
import type { Doc } from "@/convex/_generated/dataModel";
import { uncitedSentences } from "@/convex/lib/citationMarker";
import type { DiagnosticsBundle } from "@/convex/lib/engineContract";

// Story 6.1 (AC-1, AC-2, D6/D7): the Report tab state machine. Presentational —
// data + actions arrive via props (no Convex hooks here, matching
// InterpretationTab; AD-1 display-only). Three states:
//   • No report, interpretation available, NOT engineOnly → "Generate report
//     draft" (D6, the 5.4 action) + "Start from a blank template" (manual, D7).
//   • No report, engineOnly OR no recommendations → generate DISABLED with a
//     tooltip + "Start from a blank template" primary (the Engine-Only shell).
//   • Report exists → the section-structured editor (four ReportSectionEditors)
//     + a "Draft v{n}" sub-line + an explicit Save (no optimistic UI — the state
//     flips on server ack, EXPERIENCE.md:101-102).

export type ReportSections = {
  executiveSummary: string;
  methodSelectionRationale: string;
  movementCommentary: string;
  limitations: string;
};

/** The four canonical sections in editor order (FR-11). */
const SECTION_META: { key: keyof ReportSections; label: string }[] = [
  { key: "executiveSummary", label: "Executive summary" },
  { key: "methodSelectionRationale", label: "Method selection rationale" },
  { key: "movementCommentary", label: "Movement commentary" },
  { key: "limitations", label: "Limitations" },
];

const ENGINE_ONLY_GENERATE_TOOLTIP =
  "Interpretation is unavailable — start from a blank template.";

function sectionsFromReport(report: Doc<"reserveReports">): ReportSections {
  return {
    executiveSummary: report.report.executiveSummary.text,
    methodSelectionRationale: report.report.methodSelectionRationale.text,
    movementCommentary: report.report.movementCommentary.text,
    limitations: report.report.limitations.text,
  };
}

export function ReportTab({
  run,
  report,
  diagnosticsBundle,
  engineOnly = false,
  seniorActuaries = [],
  onEditReport,
  onCreateManual,
  onGenerateDraft,
  onSubmitForReview,
  canApprove = false,
  overrideCount = 0,
  onApprove,
  onStartNewVersion,
}: {
  run: RunView;
  report: Doc<"reserveReports"> | null;
  diagnosticsBundle: DiagnosticsBundle | null;
  engineOnly?: boolean;
  // Story 6.2: the Senior-Actuary picker source (client-side Clerk, D4) and the
  // submit handler. Defaulted so pre-6.2 call sites / tests still render.
  seniorActuaries?: SeniorActuary[];
  onEditReport: (sections: ReportSections) => Promise<{ contentVersion: number }>;
  onCreateManual: () => Promise<unknown>;
  onGenerateDraft: () => Promise<{ status: "accepted" | "rejected" }>;
  onSubmitForReview?: (assignee: string | null) => Promise<void>;
  // Story 6.4 (D7): the Senior-Actuary approve surface. All defaulted so pre-6.4
  // call sites degrade to the read-only analyst view (canApprove=false).
  canApprove?: boolean;
  overrideCount?: number;
  onApprove?: () => Promise<void>;
  onStartNewVersion?: () => Promise<void>;
}) {
  if (report) {
    return (
      <div className="space-y-4">
        <ReportEditorView
          // Remount on a new server version (this actor's save acked, or another
          // actor edited) so the local edit buffer re-initialises from the
          // canonical stored text — no optimistic UI (EXPERIENCE.md:101-102, AD-3),
          // and no setState-in-effect (the idiomatic React "reset via key").
          key={`${report._id}:${report.contentVersion}`}
          report={report}
          diagnosticsBundle={diagnosticsBundle}
          onEditReport={onEditReport}
        />
        {/* Story 6.2/6.4 (D7): the approval bar below the editor. When unwired
            (pre-6.2 call sites) it degrades to nothing. */}
        {onSubmitForReview && (
          <ReportApprovalBar
            report={report}
            seniorActuaries={seniorActuaries}
            onSubmitForReview={onSubmitForReview}
            canApprove={canApprove}
            diagnosticsBundle={diagnosticsBundle}
            overrideCount={overrideCount}
            onApprove={onApprove}
            onStartNewVersion={onStartNewVersion}
          />
        )}
      </div>
    );
  }

  if (run.status !== "complete") {
    return (
      <div className="rounded-md border border-border p-6">
        <p className="text-sm text-muted-foreground">
          The Reserve Report unlocks once the Run completes.
        </p>
      </div>
    );
  }

  return (
    <ReportCreationView
      canGenerate={!engineOnly && run.hasRecommendations}
      onCreateManual={onCreateManual}
      onGenerateDraft={onGenerateDraft}
    />
  );
}

// --- Creation view (no report yet) -----------------------------------------

function ReportCreationView({
  canGenerate,
  onCreateManual,
  onGenerateDraft,
}: {
  canGenerate: boolean;
  onCreateManual: () => Promise<unknown>;
  onGenerateDraft: () => Promise<{ status: "accepted" | "rejected" }>;
}) {
  const [generating, setGenerating] = useState(false);
  const [creating, setCreating] = useState(false);
  const [rejected, setRejected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const busy = generating || creating;

  async function generate() {
    setGenerating(true);
    setRejected(false);
    setError(null);
    try {
      const res = await onGenerateDraft();
      if (res.status === "rejected") setRejected(true);
      // On "accepted" the report subscription flips and this view unmounts.
    } catch (err) {
      setError(
        (err as Error).message ?? "The report draft could not be generated.",
      );
    } finally {
      setGenerating(false);
    }
  }

  async function createManual() {
    setCreating(true);
    setError(null);
    try {
      await onCreateManual();
      // On success the report subscription flips and this view unmounts.
    } catch (err) {
      setError(
        (err as Error).message ?? "The manual template could not be created.",
      );
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-4 rounded-md border border-border p-6">
      <div className="space-y-1">
        <h2 className="text-sm font-medium text-foreground">Reserve Report</h2>
        <p className="text-sm text-muted-foreground">
          {canGenerate
            ? "Draft a Reserve Report through the Provenance Gate, or start from a blank template."
            : "Interpretation is unavailable — start from a blank template to hand-draft the report."}
        </p>
      </div>

      {generating && (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          Drafting…
        </p>
      )}

      {rejected && !generating && (
        <p className="text-sm text-muted-foreground" role="status">
          Draft failed the provenance check — the report could not be drafted.
          Try again, or start from a blank template.
        </p>
      )}

      {error && !busy && (
        <p className="text-sm text-caution" role="alert">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {canGenerate ? (
          <>
            <GenerateButton
              disabled={busy}
              onClick={generate}
              variant="primary"
            />
            <ManualButton
              disabled={busy}
              onClick={createManual}
              variant="secondary"
            />
          </>
        ) : (
          <>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  {/* A disabled button swallows pointer events; the focusable
                      span is the tooltip trigger (the 5.6 idiom). */}
                  <span tabIndex={0} className="inline-block w-fit">
                    <GenerateButton disabled onClick={generate} variant="primary" />
                  </span>
                </TooltipTrigger>
                <TooltipContent>{ENGINE_ONLY_GENERATE_TOOLTIP}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <ManualButton
              disabled={busy}
              onClick={createManual}
              variant="primary"
            />
          </>
        )}
      </div>
    </div>
  );
}

function GenerateButton({
  disabled,
  onClick,
  variant,
}: {
  disabled: boolean;
  onClick: () => void;
  variant: "primary" | "secondary";
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={buttonClass(variant)}
    >
      Generate report draft
    </button>
  );
}

function ManualButton({
  disabled,
  onClick,
  variant,
}: {
  disabled: boolean;
  onClick: () => void;
  variant: "primary" | "secondary";
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={buttonClass(variant)}
    >
      Start from a blank template
    </button>
  );
}

function buttonClass(variant: "primary" | "secondary"): string {
  return variant === "primary"
    ? "w-fit rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
    : "w-fit rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50";
}

// --- Editor view (report exists) -------------------------------------------

function ReportEditorView({
  report,
  diagnosticsBundle,
  onEditReport,
}: {
  report: Doc<"reserveReports">;
  diagnosticsBundle: DiagnosticsBundle | null;
  onEditReport: (sections: ReportSections) => Promise<{ contentVersion: number }>;
}) {
  const editable = report.status === "draft";
  // Initialised from the stored text; this view is remounted (keyed on
  // contentVersion) whenever a new server version arrives, so the buffer always
  // re-seeds from the canonical text — no optimistic UI (AD-3).
  const [sections, setSections] = useState<ReportSections>(() =>
    sectionsFromReport(report),
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const uncitedCount = useMemo(
    () =>
      SECTION_META.reduce(
        (n, { key }) => n + uncitedSentences(sections[key]).length,
        0,
      ),
    [sections],
  );

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      await onEditReport(sections);
      // contentVersion bumps → the effect above re-syncs from the server ack.
    } catch (err) {
      setSaveError((err as Error).message ?? "The edit could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  const provenanceLine = report.machineDrafted
    ? "Drafted by the interpretation layer — every claim cites a diagnostic"
    : `Edited by ${report.updatedBy}`;
  // Story 6.2 (D9): on submission the sub-line records the submitter (mockup
  // report-review.html:56). Display-only string formatting — the id is shown
  // where a name isn't trivially at hand (raw id acceptable, deferred to 7.3).
  const submittedLine =
    report.status === "awaiting_review" && report.submittedBy
      ? ` · submitted by ${report.submittedBy}`
      : "";

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-sm font-medium text-foreground">Reserve Report</h2>
        <p className="text-xs text-muted-foreground">
          Draft v{report.contentVersion} · {provenanceLine}
          {submittedLine}
        </p>
      </div>

      <div className="space-y-3">
        {SECTION_META.map(({ key, label }) => (
          // Story 6.4 (D6): the anchor the approval bar's failing-sentence links
          // scroll to (`scrollToSection` in ReportApprovalBar).
          <div key={key} id={`report-section-${key}`}>
            <ReportSectionEditor
              label={label}
              text={sections[key]}
              diagnosticsBundle={diagnosticsBundle}
              editable={editable}
              onChange={(nextText) =>
                setSections((prev) => ({ ...prev, [key]: nextText }))
              }
            />
          </div>
        ))}
      </div>

      {editable && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={saving}
            onClick={save}
            className={buttonClass("primary")}
          >
            Save
          </button>
          <p
            className={
              uncitedCount > 0
                ? "text-xs text-caution"
                : "text-xs text-muted-foreground"
            }
            aria-live="polite"
          >
            {uncitedCount > 0
              ? `${uncitedCount} claim${uncitedCount === 1 ? "" : "s"} now uncited`
              : "Every claim cites a diagnostic"}
          </p>
          {saveError && (
            <p className="text-xs text-caution" role="alert">
              {saveError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
