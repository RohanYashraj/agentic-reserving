import { Check } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";

// Story 4.3 (AC1, UX-DR7): the golden-path step rail. Upload → Triangle → Run →
// Diagnostics → Report → Published. `Run` is the current step; completed steps
// are clickable jump-backs; forward steps unlock in later stories with a
// prerequisite tooltip. The state logic lives in the pure `deriveStepStates`
// helper so it is unit-testable without a DOM.

export type RunStatus = "queued" | "running" | "complete" | "failed";

export type StepKey =
  | "upload"
  | "triangle"
  | "run"
  | "diagnostics"
  | "report"
  | "published";

export type StepState = "complete" | "current" | "disabled";

export type Step = {
  key: StepKey;
  label: string;
  state: StepState;
  tooltip?: string;
};

/**
 * Derive per-step states from the Run's status (pure — no DOM, no props beyond
 * the two facts that gate the rail). Upload/Triangle are always complete (a Run
 * cannot exist without an accepted Triangle — createRun gates on `validated`).
 * Run is the current step. Diagnostics unlocks only when the Run is complete
 * AND a DiagnosticsBundle is stored. Report/Published unlock in Epic 6.
 */
export function deriveStepStates({
  runStatus,
  hasDiagnostics,
}: {
  runStatus: RunStatus;
  hasDiagnostics: boolean;
}): Step[] {
  const diagnosticsUnlocked = runStatus === "complete" && hasDiagnostics;
  return [
    { key: "upload", label: "Upload", state: "complete" },
    { key: "triangle", label: "Triangle", state: "complete" },
    { key: "run", label: "Run", state: "current" },
    {
      key: "diagnostics",
      label: "Diagnostics",
      state: diagnosticsUnlocked ? "complete" : "disabled",
      tooltip: diagnosticsUnlocked
        ? undefined
        : "Run completes to unlock Diagnostics",
    },
    {
      key: "report",
      label: "Report",
      state: "disabled",
      tooltip: "Available after diagnostics review",
    },
    {
      key: "published",
      label: "Published",
      state: "disabled",
      tooltip: "Available after publication",
    },
  ];
}

function StepContent({ step }: { step: Step }) {
  // No wrapper element — the icon + label sit directly inside the step's
  // link/button/span so that element is the one carrying the label text (and
  // its aria-current/aria-disabled/title). The outer `base` provides the flex
  // layout + gap.
  return (
    <>
      {step.state === "complete" && (
        <Check aria-hidden="true" className="size-3.5" />
      )}
      {step.label}
    </>
  );
}

export function StepRail({
  runStatus,
  hasDiagnostics,
  triangleId,
  onSelectDiagnostics,
}: {
  runStatus: RunStatus;
  hasDiagnostics: boolean;
  triangleId: Id<"triangles">;
  onSelectDiagnostics?: () => void;
}) {
  const steps = deriveStepStates({ runStatus, hasDiagnostics });

  // Jump-back targets for the two completed steps (UX-DR7 jump-back rule).
  const href: Partial<Record<StepKey, string>> = {
    upload: "/triangles",
    triangle: `/triangles/${triangleId}`,
  };

  const base =
    "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm whitespace-nowrap";
  const stateClass: Record<StepState, string> = {
    complete: "text-foreground hover:text-primary",
    current: "bg-primary/10 text-primary font-medium",
    disabled: "text-muted-foreground opacity-60",
  };

  return (
    <nav aria-label="Run progress" className="w-full overflow-x-auto">
      <ol className="flex items-center gap-1">
        {steps.map((step, i) => {
          const link = step.state === "complete" ? href[step.key] : undefined;
          const canSelectDiagnostics =
            step.key === "diagnostics" &&
            step.state === "complete" &&
            onSelectDiagnostics;

          let node: ReactNode;
          if (link) {
            node = (
              <Link href={link} className={cn(base, stateClass[step.state])}>
                <StepContent step={step} />
              </Link>
            );
          } else if (canSelectDiagnostics) {
            node = (
              <button
                type="button"
                onClick={onSelectDiagnostics}
                className={cn(base, stateClass[step.state])}
              >
                <StepContent step={step} />
              </button>
            );
          } else {
            node = (
              <span
                className={cn(base, stateClass[step.state])}
                aria-current={step.state === "current" ? "step" : undefined}
                aria-disabled={step.state === "disabled" ? true : undefined}
                title={step.tooltip}
              >
                <StepContent step={step} />
              </span>
            );
          }

          return (
            <li key={step.key} className="flex items-center gap-1">
              {node}
              {i < steps.length - 1 && (
                <span aria-hidden="true" className="text-muted-foreground">
                  ›
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
