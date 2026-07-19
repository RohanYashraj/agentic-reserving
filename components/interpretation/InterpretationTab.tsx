"use client";

import { useState } from "react";

import { RecommendationTable } from "@/components/interpretation/RecommendationTable";
import type { RunView } from "@/components/RunDetail";
import type {
  DiagnosticsBundle,
  Recommendations,
} from "@/convex/lib/engineContract";

// Story 5.5 (AC1/AC4, UX-DR16): the Interpretation tab state machine. The
// DURABLE state is the Convex subscription (`run.hasRecommendations` +
// `recommendations` from getRecommendations) — the accepted table survives
// reload (FR-20, no polling). The transient "Reading diagnostics…" is the local
// `useAction` pending flag; there is NO token streaming and NO fabricated
// "attempt N of M" ticker (D2 — the engine's per-attempt redraft progress never
// leaves the one synchronous HTTP call, so a faithful live counter is not
// implementable in 5.5; it is deferred with the async 202+callback transport).
//
// Fail-closed (AD-9) is Story 5.6: 5.5 surfaces engine.model_unavailable /
// transient errors as a readable inline retry message only — NOT the full-bleed
// Engine-Only banner or a client-side mode guess.

/** A soft, non-alarming loading block matching the repo's `animate-pulse` idiom
 *  (no shadcn Skeleton is installed). */
function SkeletonBar({ className }: { className?: string }) {
  return (
    <div className={`animate-pulse rounded bg-muted ${className ?? ""}`} />
  );
}

export function InterpretationTab({
  run,
  recommendations,
  diagnosticsBundle,
  onGenerateInterpretation,
}: {
  run: RunView;
  recommendations: Recommendations | null;
  diagnosticsBundle: DiagnosticsBundle | null;
  onGenerateInterpretation: () => Promise<{
    status: "accepted" | "rejected";
  }>;
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
  // survives reload. RecommendationTable carries the panel header (AC1).
  if (run.hasRecommendations && recommendations && diagnosticsBundle) {
    return (
      <RecommendationTable
        recommendations={recommendations}
        diagnosticsBundle={diagnosticsBundle}
      />
    );
  }

  // Pending — skeleton recommendation table + "Reading diagnostics…" in an
  // aria-live region. No token streaming, no attempt ticker (D2).
  if (generating) {
    return (
      <div aria-live="polite" className="space-y-4">
        <p className="text-sm text-muted-foreground">Reading diagnostics…</p>
        <div className="space-y-2">
          <SkeletonBar className="h-8 w-full" />
          <SkeletonBar className="h-8 w-full" />
          <SkeletonBar className="h-8 w-5/6" />
        </div>
      </div>
    );
  }

  // Failed provenance check (the action resolved { status: "rejected" }) — the
  // quiet, non-alarming UX-DR16 failure copy, with a retry.
  if (rejected) {
    return (
      <div className="space-y-3 rounded-md border border-border p-6">
        <p className="text-sm text-muted-foreground">
          Draft failed provenance check — the interpretation could not be
          drafted (all attempts failed the provenance check).
        </p>
        <button
          type="button"
          onClick={() => void generate()}
          className="w-fit rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted"
        >
          Try again
        </button>
      </div>
    );
  }

  // Transient / model-unavailable error — a clean inline retry message (the full
  // Engine-Only banner + disabled action is Story 5.6, not here).
  if (error) {
    return (
      <div className="space-y-3 rounded-md border border-border p-6">
        <p className="text-sm text-muted-foreground" role="alert">
          {error}
        </p>
        <button
          type="button"
          onClick={() => void generate()}
          className="w-fit rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted"
        >
          Try again
        </button>
      </div>
    );
  }

  // Ready, no interpretation yet — the primary trigger.
  return (
    <div className="space-y-3 rounded-md border border-border p-6">
      <p className="text-sm text-muted-foreground">
        Generate the per-Origin-Period Method recommendations, with every claim
        citing its diagnostics.
      </p>
      <button
        type="button"
        onClick={() => void generate()}
        className="w-fit rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        Generate interpretation
      </button>
    </div>
  );
}
