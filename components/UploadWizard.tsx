"use client";

import { useAction, useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { TriangleGrid, cellKey } from "@/components/TriangleGrid";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { ValidationReport } from "@/convex/lib/engineContract";
import {
  detectPeriods,
  type DevelopmentInterval,
  type OriginGranularity,
} from "@/convex/lib/periodDetection";
import { cn } from "@/lib/utils";

// UX-DR8 upload wizard: File → Validation → Periods. Named-stage inline
// progress (never a bare spinner), flagged grid preview + cell-coordinate
// findings, "Fix source and re-upload" on failure (no in-app repair, PRD §6.2).
// Steps never auto-advance — the user confirms each transition. Step 3 (Periods)
// is a Story 3.3 stub here.

type Label = "paid" | "incurred";
type Step = "file" | "validation" | "periods";

type ValidateResult = {
  triangle: {
    kind: Label;
    origin_periods: string[];
    development_periods: string[];
    cells: (number | null)[][];
  };
  report: ValidationReport;
  rawFileHash: string;
};

// A Convex action call can't stream sub-progress mid-flight, so these named
// stages are a client-choreographed sequence describing the pipeline while the
// single validate call is pending. They are labels, not a bare spinner.
const STAGES = ["Parsing…", "Validating shape…", "Checking monotonicity…"];

function shortHash(hash: string): string {
  return `${hash.slice(0, 12)}…`;
}

function errorMessage(error: unknown): string {
  return error instanceof ConvexError &&
    typeof (error.data as { message?: unknown })?.message === "string"
    ? (error.data as { message: string }).message
    : "Something went wrong. Please try again.";
}

/**
 * Whether a thrown ConvexError is an engine-AVAILABILITY problem (unreachable /
 * unconfigured) — those warrant a "service unavailable" panel with Retry. Engine
 * DOMAIN errors (`engine.bad_request`, `engine.triangle_invalid`, …) are data
 * problems, not availability, so they are deliberately excluded — retrying them
 * just loops on a deterministic failure; they surface as a fix-the-data message.
 */
function isEngineError(error: unknown): boolean {
  const code =
    error instanceof ConvexError
      ? (error.data as { code?: unknown })?.code
      : undefined;
  return code === "ENGINE_UNAVAILABLE" || code === "ENGINE_UNCONFIGURED";
}

export function UploadWizard({ workspaceId }: { workspaceId: string }) {
  const generateUploadUrl = useMutation(api.triangles.generateUploadUrl);
  const createFromUpload = useAction(api.triangles.createFromUpload);
  const validateTriangle = useAction(api.triangles.validateTriangle);
  const acceptTriangle = useAction(api.triangles.acceptTriangle);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>("file");
  const [label, setLabel] = useState<Label>("paid");

  // File step
  const [uploading, setUploading] = useState(false);
  const [duplicateId, setDuplicateId] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [triangleId, setTriangleId] = useState<Id<"triangles"> | null>(null);

  // Validation step
  const [validating, setValidating] = useState(false);
  const [stage, setStage] = useState(0);
  const [result, setResult] = useState<ValidateResult | null>(null);
  const [validationError, setValidationError] = useState<
    { message: string; engine: boolean } | null
  >(null);
  const [highlightedCell, setHighlightedCell] = useState<string | null>(null);
  const stageTimer = useRef<number | null>(null);
  const runToken = useRef(0);

  const stopStageTimer = useCallback(() => {
    if (stageTimer.current !== null) {
      window.clearInterval(stageTimer.current);
      stageTimer.current = null;
    }
  }, []);

  // Clear the stage timer if we unmount mid-validation.
  useEffect(() => stopStageTimer, [stopStageTimer]);

  // Validation runs from an event (successful upload / explicit retry), not an
  // effect — it is triggered by user action, not by rendering. The named stages
  // are choreographed here while the single validate call is pending.
  const runValidation = useCallback(
    async (id: Id<"triangles">) => {
      const token = ++runToken.current;
      setValidating(true);
      setResult(null);
      setValidationError(null);
      setHighlightedCell(null);
      setStage(0);
      stopStageTimer();
      stageTimer.current = window.setInterval(
        () => setStage((s) => Math.min(s + 1, STAGES.length - 1)),
        650,
      );
      try {
        const res = await validateTriangle({ workspaceId, triangleId: id });
        if (token === runToken.current) setResult(res as ValidateResult);
      } catch (error) {
        if (token === runToken.current) {
          setValidationError({ message: errorMessage(error), engine: isEngineError(error) });
        }
      } finally {
        if (token === runToken.current) {
          stopStageTimer();
          setValidating(false);
        }
      }
    },
    [validateTriangle, workspaceId, stopStageTimer],
  );

  function resetToFile() {
    runToken.current++;
    stopStageTimer();
    setStep("file");
    setTriangleId(null);
    setResult(null);
    setValidationError(null);
    setValidating(false);
    setDuplicateId(null);
    setFileError(null);
    setHighlightedCell(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function retryValidation() {
    if (triangleId !== null) void runValidation(triangleId);
  }

  async function handleFile(file: File) {
    setUploading(true);
    setDuplicateId(null);
    setFileError(null);
    try {
      const uploadUrl = await generateUploadUrl({ workspaceId });
      const posted = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!posted.ok) throw new Error("The file could not be uploaded to storage.");
      const { storageId } = (await posted.json()) as { storageId: string };

      const created = await createFromUpload({
        workspaceId,
        storageId: storageId as Id<"_storage">,
        label,
        filename: file.name,
      });

      if (created.status === "duplicate") {
        setDuplicateId(created.existingTriangleId);
      } else {
        const id = created.triangleId as Id<"triangles">;
        setTriangleId(id);
        setStep("validation");
        void runValidation(id);
      }
    } catch (error) {
      setFileError(errorMessage(error));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  return (
    <section className="mx-auto w-full max-w-4xl" aria-label="Upload a triangle">
      <WizardSteps step={step} />

      {step === "file" && (
        <FileStep
          label={label}
          setLabel={setLabel}
          uploading={uploading}
          duplicateId={duplicateId}
          fileError={fileError}
          fileInputRef={fileInputRef}
          onFile={handleFile}
        />
      )}

      {step === "validation" && (
        <div className="mt-6">
          {validating && <NamedStageProgress stage={stage} />}

          {!validating && validationError && (
            <FailurePanel
              title={
                validationError.engine
                  ? "The engine service is unavailable"
                  : "This file could not be read"
              }
              message={validationError.message}
              primaryLabel={validationError.engine ? "Retry" : "Fix source and re-upload"}
              onPrimary={validationError.engine ? retryValidation : resetToFile}
            />
          )}

          {!validating && result && !result.report.valid && (
            <FindingsPanel
              result={result}
              highlightedCell={highlightedCell}
              onSelectFinding={setHighlightedCell}
              onFix={resetToFile}
            />
          )}

          {!validating && result && result.report.valid && (
            <CleanPassPanel
              rawFileHash={result.rawFileHash}
              onContinue={() => setStep("periods")}
            />
          )}
        </div>
      )}

      {step === "periods" && result && triangleId && (
        <PeriodsStep
          workspaceId={workspaceId}
          triangleId={triangleId}
          triangle={result.triangle}
          onAccept={acceptTriangle}
          onReset={resetToFile}
        />
      )}
    </section>
  );
}

// --- Periods step (FR-3): detect → confirm → accept -------------------------

const ORIGIN_OPTIONS: { value: OriginGranularity; label: string }[] = [
  { value: "annual", label: "Annual" },
  { value: "quarterly", label: "Quarterly" },
  { value: "monthly", label: "Monthly" },
];
const DEV_OPTIONS: { value: DevelopmentInterval; label: string }[] = [
  { value: "months", label: "Months" },
  { value: "quarters", label: "Quarters" },
  { value: "years", label: "Years" },
];

function labelsInvalidReason(labels: string[], axis: string): string | null {
  const trimmed = labels.map((l) => l.trim());
  if (trimmed.some((l) => l === "")) return `Every ${axis} needs a label.`;
  if (new Set(trimmed).size !== trimmed.length)
    return `Each ${axis} label must be unique.`;
  return null;
}

function PeriodsStep({
  workspaceId,
  triangleId,
  triangle,
  onAccept,
  onReset,
}: {
  workspaceId: string;
  triangleId: Id<"triangles">;
  triangle: ValidateResult["triangle"];
  onAccept: (args: {
    workspaceId: string;
    triangleId: Id<"triangles">;
    confirmedOriginPeriods: string[];
    confirmedDevelopmentPeriods: string[];
    periodMeta: { originGranularity: string; developmentInterval: string };
  }) => Promise<{ status: "accepted"; triangleId: string; triangleHash: string }>;
  onReset: () => void;
}) {
  const detection = useMemo(
    () => detectPeriods(triangle.origin_periods, triangle.development_periods),
    [triangle.origin_periods, triangle.development_periods],
  );

  const [originLabels, setOriginLabels] = useState<string[]>(triangle.origin_periods);
  const [devLabels, setDevLabels] = useState<string[]>(triangle.development_periods);
  const [originGranularity, setOriginGranularity] = useState<OriginGranularity>(
    detection.originGranularity,
  );
  const [developmentInterval, setDevelopmentInterval] = useState<DevelopmentInterval>(
    detection.developmentInterval,
  );

  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<{ message: string; engine: boolean } | null>(
    null,
  );
  const [accepted, setAccepted] = useState<{ triangleId: string } | null>(null);

  const originReason = labelsInvalidReason(originLabels, "origin period");
  const devReason = labelsInvalidReason(devLabels, "development period");
  const granularityChosen =
    (ORIGIN_OPTIONS.some((o) => o.value === originGranularity) &&
      DEV_OPTIONS.some((o) => o.value === developmentInterval)) as boolean;
  const canAccept =
    !originReason && !devReason && granularityChosen && !accepting && !accepted;

  async function handleAccept() {
    setAccepting(true);
    setAcceptError(null);
    try {
      // Send only the confirmed LABELS + granularity — never cell values. The
      // server re-parses the stored file for the numbers (chain of custody).
      const res = await onAccept({
        workspaceId,
        triangleId,
        confirmedOriginPeriods: originLabels.map((l) => l.trim()),
        confirmedDevelopmentPeriods: devLabels.map((l) => l.trim()),
        periodMeta: { originGranularity, developmentInterval },
      });
      setAccepted({ triangleId: res.triangleId });
    } catch (error) {
      setAcceptError({ message: errorMessage(error), engine: isEngineError(error) });
    } finally {
      setAccepting(false);
    }
  }

  if (accepted) {
    return (
      <div className="mt-6 rounded-md border border-border p-6" aria-live="polite">
        <p className="text-sm font-medium text-published">Triangle accepted.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          It is now immutable and ready to run methods against.
        </p>
        <div className="mt-4 flex gap-4 text-sm">
          <Link
            href={`/triangles/${accepted.triangleId}`}
            className="font-medium text-primary hover:underline"
          >
            View the Triangle
          </Link>
          <Link href="/triangles" className="text-muted-foreground hover:text-foreground">
            Back to the library
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-6">
      <div>
        <h2 className="text-base font-semibold">Confirm the periods</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Detected structure below. Edit anything that looks wrong, then accept —
          the Triangle becomes immutable once accepted.
        </p>
      </div>

      {detection.ambiguous && (
        <p className="rounded-md bg-caution-subtle px-3 py-2 text-sm text-caution">
          {detection.reason ?? "Confirm the periods before accepting."}
        </p>
      )}

      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <label className="text-sm font-medium" htmlFor="origin-granularity">
            Origin-period granularity
          </label>
          <select
            id="origin-granularity"
            value={ORIGIN_OPTIONS.some((o) => o.value === originGranularity) ? originGranularity : ""}
            onChange={(e) => setOriginGranularity(e.target.value as OriginGranularity)}
            className="mt-1 block w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          >
            <option value="" disabled>
              Select…
            </option>
            {ORIGIN_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-sm font-medium" htmlFor="dev-interval">
            Development-age interval
          </label>
          <select
            id="dev-interval"
            value={DEV_OPTIONS.some((o) => o.value === developmentInterval) ? developmentInterval : ""}
            onChange={(e) => setDevelopmentInterval(e.target.value as DevelopmentInterval)}
            className="mt-1 block w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          >
            <option value="" disabled>
              Select…
            </option>
            {DEV_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <fieldset>
        <legend className="text-sm font-medium">Origin period labels</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {originLabels.map((label, i) => (
            <input
              key={i}
              aria-label={`Origin period ${i + 1}`}
              value={label}
              onChange={(e) =>
                setOriginLabels((prev) => prev.map((l, j) => (j === i ? e.target.value : l)))
              }
              className="numeric w-24 rounded-md border border-border bg-background px-2 py-1 text-sm"
            />
          ))}
        </div>
        {originReason && <p className="mt-1 text-sm text-destructive">{originReason}</p>}
      </fieldset>

      <fieldset>
        <legend className="text-sm font-medium">Development period ages</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {devLabels.map((label, i) => (
            <input
              key={i}
              aria-label={`Development period ${i + 1}`}
              value={label}
              onChange={(e) =>
                setDevLabels((prev) => prev.map((l, j) => (j === i ? e.target.value : l)))
              }
              className="numeric w-20 rounded-md border border-border bg-background px-2 py-1 text-sm"
            />
          ))}
        </div>
        {devReason && <p className="mt-1 text-sm text-destructive">{devReason}</p>}
      </fieldset>

      <TriangleGrid
        kind={triangle.kind}
        originPeriods={originLabels.map((l) => l.trim())}
        developmentPeriods={devLabels.map((l) => l.trim())}
        cells={triangle.cells}
        showLatestDiagonal
      />

      {acceptError && (
        <div
          className={cn(
            "rounded-md px-3 py-2 text-sm",
            acceptError.engine
              ? "border border-destructive/30 bg-destructive/5 text-destructive"
              : "bg-destructive/10 text-destructive",
          )}
          aria-live="polite"
        >
          <p>{acceptError.message}</p>
          {/* A data problem (not an engine outage) has no in-place fix — the only
              path forward is to fix the source and re-upload (PRD §6.2). */}
          {!acceptError.engine && (
            <button
              type="button"
              onClick={onReset}
              className="mt-2 font-medium underline hover:no-underline"
            >
              Fix source and re-upload
            </button>
          )}
        </div>
      )}

      <button
        type="button"
        disabled={!canAccept}
        onClick={handleAccept}
        className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {accepting ? "Accepting…" : "Accept triangle"}
      </button>
    </div>
  );
}

// --- Step indicator ---------------------------------------------------------

const STEP_ORDER: Step[] = ["file", "validation", "periods"];
const STEP_LABELS: Record<Step, string> = {
  file: "File",
  validation: "Validation",
  periods: "Periods",
};

function WizardSteps({ step }: { step: Step }) {
  const currentIndex = STEP_ORDER.indexOf(step);
  return (
    <ol className="flex items-center gap-3 text-sm" aria-label="Upload progress">
      {STEP_ORDER.map((s, i) => {
        const state = i < currentIndex ? "done" : i === currentIndex ? "current" : "upcoming";
        return (
          <li key={s} className="flex items-center gap-2">
            <span
              aria-current={state === "current" ? "step" : undefined}
              className={cn(
                "inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium",
                state === "current" && "bg-primary text-primary-foreground",
                state === "done" && "bg-primary/15 text-primary",
                state === "upcoming" && "bg-muted text-muted-foreground",
              )}
            >
              {state === "done" ? "✓" : i + 1}
            </span>
            <span
              className={cn(
                state === "current" ? "font-medium text-foreground" : "text-muted-foreground",
              )}
            >
              {STEP_LABELS[s]}
            </span>
            {i < STEP_ORDER.length - 1 && <span className="text-border">—</span>}
          </li>
        );
      })}
    </ol>
  );
}

// --- File step --------------------------------------------------------------

function FileStep({
  label,
  setLabel,
  uploading,
  duplicateId,
  fileError,
  fileInputRef,
  onFile,
}: {
  label: Label;
  setLabel: (l: Label) => void;
  uploading: boolean;
  duplicateId: string | null;
  fileError: string | null;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFile: (file: File) => void;
}) {
  return (
    <div className="mt-6 rounded-md border border-border p-6">
      <h2 className="text-base font-semibold">Upload a triangle</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Choose whether the triangle is paid or incurred, then select a .csv or
        .xlsx file.
      </p>

      <div className="mt-4 flex items-center gap-2">
        <label className="sr-only" htmlFor="triangle-label">
          Label
        </label>
        <select
          id="triangle-label"
          value={label}
          onChange={(e) => setLabel(e.target.value as Label)}
          disabled={uploading}
          className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
        >
          <option value="paid">Paid</option>
          <option value="incurred">Incurred</option>
        </select>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.xlsx"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFile(file);
          }}
        />
        <button
          type="button"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {uploading ? "Uploading…" : "Select file"}
        </button>
      </div>

      {duplicateId && (
        <p className="mt-4 rounded-md bg-caution-subtle px-3 py-2 text-sm text-caution">
          Identical triangle already exists (hash match).{" "}
          <a href={`#triangle-${duplicateId}`} className="font-medium underline">
            View the existing Triangle
          </a>
          .
        </p>
      )}
      {fileError && (
        <p className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {fileError}
        </p>
      )}
    </div>
  );
}

// --- Validation step panels -------------------------------------------------

function NamedStageProgress({ stage }: { stage: number }) {
  return (
    <div className="rounded-md border border-border p-6" aria-live="polite">
      <p className="text-sm font-medium">Validating your triangle…</p>
      <ol className="mt-3 space-y-1.5 text-sm">
        {STAGES.map((s, i) => (
          <li key={s} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={cn(
                i < stage && "text-published",
                i === stage && "text-primary",
                i > stage && "text-muted-foreground",
              )}
            >
              {i < stage ? "✓" : i === stage ? "●" : "○"}
            </span>
            <span className={cn(i <= stage ? "text-foreground" : "text-muted-foreground")}>
              {s}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function FindingsPanel({
  result,
  highlightedCell,
  onSelectFinding,
  onFix,
}: {
  result: ValidateResult;
  highlightedCell: string | null;
  onSelectFinding: (key: string) => void;
  onFix: () => void;
}) {
  const { triangle, report } = result;
  const flaggedCells = new Set(report.findings.map((f) => cellKey(f.origin, f.dev)));
  const columnCount = new Set(report.findings.map((f) => f.dev)).size;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-destructive">
          Validation found {report.findings.length}{" "}
          {report.findings.length === 1 ? "issue" : "issues"} in {columnCount}{" "}
          {columnCount === 1 ? "column" : "columns"}.
        </p>
        <button
          type="button"
          onClick={onFix}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Fix source and re-upload
        </button>
      </div>

      <TriangleGrid
        kind={triangle.kind}
        originPeriods={triangle.origin_periods}
        developmentPeriods={triangle.development_periods}
        cells={triangle.cells}
        flaggedCells={flaggedCells}
        highlightedCell={highlightedCell}
        onCellFocus={onSelectFinding}
      />

      <div>
        <h3 className="text-sm font-medium">Findings</h3>
        <ul className="mt-2 divide-y divide-border rounded-md border border-border">
          {report.findings.map((f, i) => {
            const key = cellKey(f.origin, f.dev);
            return (
              <li key={`${key}-${i}`}>
                <button
                  type="button"
                  onClick={() => onSelectFinding(key)}
                  className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-muted"
                >
                  <span className="numeric text-caution">
                    Origin {f.origin}, development {f.dev}
                  </span>
                  <span className="text-muted-foreground">{f.reason}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function CleanPassPanel({
  rawFileHash,
  onContinue,
}: {
  rawFileHash: string;
  onContinue: () => void;
}) {
  return (
    <div className="rounded-md border border-border p-6">
      <p className="text-sm font-medium text-published">0 issues.</p>
      <p className="mt-1 text-sm text-muted-foreground">
        This triangle passed validation. Content hash{" "}
        <span className="numeric text-foreground">{shortHash(rawFileHash)}</span>.
      </p>
      <button
        type="button"
        onClick={onContinue}
        className="mt-4 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        Continue to periods
      </button>
    </div>
  );
}

function FailurePanel({
  title,
  message,
  primaryLabel,
  onPrimary,
}: {
  title: string;
  message: string;
  primaryLabel: string;
  onPrimary: () => void;
}) {
  return (
    <div className="rounded-md border border-destructive/30 bg-destructive/5 p-6">
      <p className="text-sm font-medium text-destructive">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{message}</p>
      <button
        type="button"
        onClick={onPrimary}
        className="mt-4 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        {primaryLabel}
      </button>
    </div>
  );
}
