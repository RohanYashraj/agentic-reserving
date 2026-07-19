"use client";

import { useState } from "react";

import {
  RecommendationTable,
  type RecommendationOverride,
} from "@/components/interpretation/RecommendationTable";
import type { RunView } from "@/components/RunDetail";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  DiagnosticsBundle,
  Method,
  Recommendations,
} from "@/convex/lib/engineContract";

// Story 5.5 (AC1/AC4, UX-DR16): the Interpretation tab state machine. The
// DURABLE state is the Convex subscription (`run.hasRecommendations` +
// `recommendations` from getRecommendations) — the accepted table survives
// reload (FR-20, no polling). The transient "Reading diagnostics…" is the local
// `useAction` pending flag; there is NO token streaming and NO fabricated
// "attempt N of M" ticker (D2).
//
// Story 5.6 (AC-3, AD-9): fail-closed. The `engineOnly` prop (the run-scoped
// mirror of the workspace-global banner) DISABLES the trigger with a tooltip
// (visible-but-disabled — EXPERIENCE.md:92) while Upload → Run → Diagnostics
// stay fully functional (NFR-2). `run.interpretationFailure` is the DURABLE
// failed state that survives reload (unlike 5.5's transient error/rejected).

const ENGINE_ONLY_TOOLTIP =
  "Interpretation is unavailable while in Engine-Only Mode. Upload, Runs, and Diagnostics still work.";

/** Durable failed-state copy keyed on the fail-closed reason (Story 5.6). */
const FAILED_COPY: Record<
  "model_unavailable" | "cost_ceiling_exceeded" | "interpretation_timeout",
  string
> = {
  model_unavailable:
    "Interpretation is unavailable — the interpretation model could not be reached (Engine-Only Mode).",
  cost_ceiling_exceeded:
    "Interpretation stopped — this Run reached its interpretation cost ceiling.",
  interpretation_timeout:
    "Interpretation stopped — it exceeded the time limit for this Run.",
};

/** A soft, non-alarming loading block matching the repo's `animate-pulse` idiom
 *  (no shadcn Skeleton is installed). */
function SkeletonBar({ className }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded bg-muted ${className ?? ""}`} />
  );
}

/** The AC1 panel header — lifted here (out of RecommendationTable) so it
 *  accompanies the recommendation panel across BOTH the drafting/skeleton and
 *  accepted states. Quiet, labelled-not-decorated (EXPERIENCE.md:58) — the
 *  middle-dot `·` wins over the mockup's em-dash. No sparkle/AI-persona chrome. */
function PanelHeader() {
  return (
    <p className="text-sm text-muted-foreground">
      Drafted by the interpretation layer · every claim cites a diagnostic
    </p>
  );
}

/** The drafting/skeleton panel — the header (AC1) plus a soft shimmer and the
 *  aria-live "Reading diagnostics…" status. Shared by the local `generating`
 *  flag and the post-accept window where `hasRecommendations` has flipped but
 *  `getRecommendations` has not yet un-skipped (F14). */
function DraftingPanel() {
  return (
    <div aria-live="polite" className="space-y-4">
      <PanelHeader />
      <p className="text-sm text-muted-foreground">Reading diagnostics…</p>
      <div className="space-y-2">
        <SkeletonBar className="h-8 w-full" />
        <SkeletonBar className="h-8 w-full" />
        <SkeletonBar className="h-8 w-5/6" />
      </div>
    </div>
  );
}

/**
 * The interpretation trigger. When `engineOnly`, it renders DISABLED wrapped in a
 * tooltip (a disabled <button> swallows pointer events, so the trigger is a
 * focusable <span> per the Radix pattern) — the step stays visible so the
 * analyst knows it exists (EXPERIENCE.md:92). Otherwise it is the live primary.
 */
function TriggerButton({
  label,
  onClick,
  engineOnly,
  variant,
}: {
  label: string;
  onClick: () => void;
  engineOnly: boolean;
  variant: "primary" | "secondary";
}) {
  const className =
    variant === "primary"
      ? "w-fit rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      : "w-fit rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50";

  if (!engineOnly) {
    return (
      <button type="button" onClick={onClick} className={className}>
        {label}
      </button>
    );
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* A disabled button does not fire pointer events; the focusable span
              is the tooltip trigger so it still opens on hover/focus. */}
          <span tabIndex={0} className="inline-block w-fit">
            <button type="button" disabled className={className}>
              {label}
            </button>
          </span>
        </TooltipTrigger>
        <TooltipContent>{ENGINE_ONLY_TOOLTIP}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function InterpretationTab({
  run,
  recommendations,
  diagnosticsBundle,
  onGenerateInterpretation,
  engineOnly = false,
  overrides = [],
  canOverride = false,
  onOverride,
}: {
  run: RunView;
  recommendations: Recommendations | null;
  diagnosticsBundle: DiagnosticsBundle | null;
  onGenerateInterpretation: () => Promise<{
    status: "accepted" | "rejected";
  }>;
  // Story 5.6: the workspace-global Engine-Only Mode flag (run-scoped mirror).
  // Default false so pre-5.6 tests + the placeholder fallback still render.
  engineOnly?: boolean;
  // Story 6.3: the Senior-Actuary override surface — passed straight through to
  // RecommendationTable in the accepted branch. Optional/defaulted so pre-6.3
  // call sites render without override capability.
  overrides?: RecommendationOverride[];
  canOverride?: boolean;
  onOverride?: (
    origin: string,
    overridingMethod: Method,
    reason: string,
  ) => Promise<void>;
}) {
  // Transient UI only — the durable outcome is the subscription (see below).
  const [generating, setGenerating] = useState(false);
  const [rejected, setRejected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setGenerating(true);
    setRejected(false);
    setError(null);
    try {
      const res = await onGenerateInterpretation();
      // accepted → the getRecommendations subscription flips hasRecommendations
      // and the table renders reactively; nothing to do locally.
      if (res.status === "rejected") setRejected(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Interpretation could not be run.",
      );
    } finally {
      setGenerating(false);
    }
  }

  // Not yet interpretable — a completed Run with diagnostics is the engine
  // precondition (getRunForRecommend). Quiet gate message, mirroring the
  // Results/Diagnostics "unlocks after…" placeholders.
  if (run.status !== "complete" || !run.hasDiagnostics) {
    return (
      <div className="rounded-md border border-border p-6">
        <p className="text-sm text-muted-foreground">
          Interpretation unlocks once the Run completes and diagnostics are
          available.
        </p>
      </div>
    );
  }

  // Accepted — driven off the SUBSCRIPTION (not the local flag) so the table
  // survives reload. A later accepted supersedes any prior durable failure.
  // The panel header (AC1) is lifted here so it accompanies the table.
  if (run.hasRecommendations && recommendations && diagnosticsBundle) {
    return (
      <div className="space-y-4">
        <PanelHeader />
        <RecommendationTable
          recommendations={recommendations}
          diagnosticsBundle={diagnosticsBundle}
          overrides={overrides}
          canOverride={canOverride}
          onOverride={onOverride}
        />
      </div>
    );
  }

  // Post-accept loading window (F14): on a successful generate,
  // `hasRecommendations` flips reactively BEFORE getRecommendations un-skips and
  // loads. Show the drafting/skeleton UI (not the ready state) during that gap so
  // the "Generate interpretation" primary never flickers back (no double-trigger).
  if (run.hasRecommendations && !recommendations) {
    return <DraftingPanel />;
  }

  // Pending — skeleton recommendation table + "Reading diagnostics…" in an
  // aria-live region. No token streaming, no attempt ticker (D2).
  if (generating) {
    return <DraftingPanel />;
  }

  // Story 5.6: the DURABLE fail-closed failed state — survives reload (unlike the
  // transient error/rejected below). Keyed on the reason. Recovery for
  // model_unavailable is the GLOBAL banner's Retry (the trigger stays disabled
  // while engineOnly); the per-Run reasons allow a re-trigger once the mode is
  // clear (trigger enabled when not engineOnly).
  if (run.interpretationFailure) {
    return (
      <div className="space-y-3 rounded-md border border-border p-6">
        <p className="text-sm text-muted-foreground" role="status">
          {FAILED_COPY[run.interpretationFailure.reason]}
        </p>
        <TriggerButton
          label="Generate interpretation"
          onClick={() => void generate()}
          engineOnly={engineOnly}
          variant="primary"
        />
      </div>
    );
  }

  // Failed provenance check (the action resolved { status: "rejected" }) — the
  // quiet, non-alarming UX-DR16 failure copy, with a retry (disabled in the mode).
  if (rejected) {
    return (
      <div className="space-y-3 rounded-md border border-border p-6">
        <p className="text-sm text-muted-foreground">
          Draft failed provenance check — the interpretation could not be
          drafted (all attempts failed the provenance check).
        </p>
        <TriggerButton
          label="Try again"
          onClick={() => void generate()}
          engineOnly={engineOnly}
          variant="secondary"
        />
      </div>
    );
  }

  // Transient / model-unavailable error — a clean inline retry message. In
  // Engine-Only Mode the retry is disabled (the global banner owns recovery).
  if (error) {
    return (
      <div className="space-y-3 rounded-md border border-border p-6">
        <p className="text-sm text-muted-foreground" role="alert">
          {error}
        </p>
        <TriggerButton
          label="Try again"
          onClick={() => void generate()}
          engineOnly={engineOnly}
          variant="secondary"
        />
      </div>
    );
  }

  // Ready, no interpretation yet — the primary trigger (disabled in the mode).
  return (
    <div className="space-y-3 rounded-md border border-border p-6">
      <p className="text-sm text-muted-foreground">
        Generate the per-Origin-Period Method recommendations, with every claim
        citing its diagnostics.
      </p>
      <TriggerButton
        label="Generate interpretation"
        onClick={() => void generate()}
        engineOnly={engineOnly}
        variant="primary"
      />
    </div>
  );
}
