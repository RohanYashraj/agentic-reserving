"use client";

import { useAuth } from "@clerk/nextjs";
import { useAction, useQuery } from "convex/react";
import { TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "@/convex/_generated/api";

// Story 5.6 (AC-2, AC-4, AD-9, D2/D3/D4): the workspace-global Engine-Only Mode
// banner. Self-subscribes to the SERVER-DERIVED mode (the layout is a server
// component and cannot) — never a client-side guess. Renders nothing until the
// subscription reports engineOnly. It is the topmost full-bleed caution strip of
// the app chrome, non-dismissable while the condition holds, with a "what still
// works" disclosure and a "Retry" that runs the recovery probe (D3). An
// aria-live="assertive" announcement + entry/exit toast fire ONCE per edge (D4)
// — never on the initial mount value. NO figures anywhere (AD-1).

const ENGINE_ONLY_COPY = "Engine-Only Mode — interpretation unavailable";

export function EngineOnlyBanner() {
  const { orgId } = useAuth();
  const mode = useQuery(
    api.interpretationMode.getInterpretationMode,
    orgId ? { workspaceId: orgId } : "skip",
  );
  const probe = useAction(api.interpretationMode.probeInterpretationMode);

  const engineOnly = mode?.engineOnly ?? false;

  const [toast, setToast] = useState<string | null>(null);
  const [showWhatWorks, setShowWhatWorks] = useState(false);
  const [checking, setChecking] = useState(false);

  // Edge detection (D4): fire the toast ONCE per real transition. This is the
  // React "adjust state when a value changes" pattern — the previous value is
  // stored in state and compared DURING render (not in an effect, so no
  // set-state-in-effect), and the update runs before the browser paints.
  // `undefined` is the first observation (mount), NOT an edge.
  const [prevEngineOnly, setPrevEngineOnly] = useState<boolean | undefined>(
    undefined,
  );
  if (mode !== undefined && prevEngineOnly !== engineOnly) {
    setPrevEngineOnly(engineOnly);
    if (prevEngineOnly !== undefined) {
      // A genuine flip → the ephemeral edge-cue. The banner strip's
      // aria-live="assertive" region carries the once-per-edge announcement.
      setToast(
        engineOnly
          ? "Interpretation is temporarily unavailable — Engine-Only Mode."
          : "Interpretation restored.",
      );
    }
  }

  // Auto-dismiss the toast (~5s). The timer is the external system; setState
  // happens only inside its callback / cleanup, never synchronously in the body.
  useEffect(() => {
    if (toast === null) return;
    const id = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(id);
  }, [toast]);

  async function onRetry() {
    if (!orgId) return;
    setChecking(true);
    try {
      // On success the subscription flips engineOnly false and this unmounts
      // (the exit toast fires from the edge effect). Errors are swallowed — the
      // banner simply stays; the model is still unreachable.
      await probe({ workspaceId: orgId });
    } catch {
      // Transient — leave the banner up; the user can retry again.
    } finally {
      setChecking(false);
    }
  }

  if (!engineOnly) {
    // Still render the (empty) assertive live region container is unnecessary
    // when not in the mode; the toast may linger briefly to announce the exit.
    return toast ? (
      <div
        role="status"
        className="fixed bottom-4 right-4 z-50 rounded-md border border-border bg-popover px-4 py-2 text-sm text-popover-foreground shadow-md"
      >
        {toast}
      </div>
    ) : null;
  }

  return (
    <>
      {/* Full-bleed caution strip — radius:0, zero elevation, no shadow
          (DESIGN.md:114 "a condition of the environment, not a floating
          notification"). Spans the content column. aria-live="assertive" so the
          entry is announced once (the effect above guards the single edge). */}
      <div
        aria-live="assertive"
        className="flex flex-col gap-1 border-b border-caution/30 bg-caution-subtle px-6 py-3 text-caution"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <TriangleAlert aria-hidden="true" className="size-4 shrink-0" />
          <span className="font-medium">{ENGINE_ONLY_COPY}</span>
          <button
            type="button"
            onClick={() => setShowWhatWorks((v) => !v)}
            className="underline underline-offset-2 hover:no-underline"
            aria-expanded={showWhatWorks}
          >
            what still works
          </button>
          <button
            type="button"
            onClick={() => void onRetry()}
            disabled={checking}
            className="rounded-md border border-caution/40 px-2 py-0.5 text-xs font-medium hover:bg-caution/10 disabled:opacity-50"
          >
            {checking ? "Checking…" : "Retry"}
          </button>
        </div>
        {showWhatWorks && (
          <p className="text-xs text-caution/90">
            Upload, Runs, and Diagnostics remain fully available. Report drafting
            from a manual template arrives with the report editor.
          </p>
        )}
      </div>

      {/* Ephemeral edge-cue toast (D7 — no toast library). Single-instance,
          auto-dismissing, accessible. The persistent strip above carries the
          durable message. */}
      {toast && (
        <div
          role="status"
          className="fixed bottom-4 right-4 z-50 rounded-md border border-border bg-popover px-4 py-2 text-sm text-popover-foreground shadow-md"
        >
          {toast}
        </div>
      )}
    </>
  );
}
