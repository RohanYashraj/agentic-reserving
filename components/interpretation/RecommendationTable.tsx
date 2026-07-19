"use client";

import { useRef, useState } from "react";

import { CitationChip } from "@/components/interpretation/CitationChip";
import { METHOD_OPTIONS, methodLabel } from "@/components/methods";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type {
  DiagnosticsBundle,
  Method,
  MethodRecommendation,
  Recommendations,
} from "@/convex/lib/engineContract";
import { cn } from "@/lib/utils";

// Story 5.5 (AC1/AC2): the per-Origin-Period recommendation table — the visible
// deliverable of Interpretation. One row per Origin Period (the 5.3 validator
// guarantees exactly one MethodRecommendation per origin, so no dedupe/sort
// invention — render in the given order). Each row: Origin Period, the
// recommended Method (via the shared `methodLabel` — never re-mapped inline),
// the reasons, and (Story 6.3) a Status tag + Override control.
//
// Story 6.3 (AC1/AC2, FR-10, UX-DR11): the Senior-Actuary override layer. A
// fourth "Status" column carries a lightweight inline accepted/overridden pill
// (NOT StatusBadge — a different axis, D5) plus the Override control. A Senior
// Actuary (`canOverride`) gets a live button opening the D6 audit-confirmation
// dialog (choose a Method ≠ the recommendation + a required reason); an Analyst
// gets the SAME control visible-but-disabled with a Tooltip (UX-DR18/D7) — the
// server `requireRole` is the real gate, this is display only. An overridden row
// renders the machine recommendation AND the override side by side (D8/AC-2):
// the recommendation's atomic CitationChips stay intact (same dxId/bundle, never
// re-parsed); the override renders as an attributed teal-accent card (the
// method → method transition, the quoted reason, the attribution line — NO chips,
// a human reason cites no Diagnostic). No optimistic UI (D9): the confirm awaits
// the mutation and the getRecommendationOverrides subscription re-renders the row
// on server ack. No arithmetic (AD-1) — a Method is a categorical label; the
// reason is human prose.
//
// Pure presentational: props in, no data fetching, no Convex hooks. The panel
// header (AC1) is lifted to InterpretationTab so it accompanies the panel across
// BOTH the drafting/skeleton and accepted states.

/** The query projection of one override row (getRecommendationOverrides). */
export type RecommendationOverride = {
  origin: string;
  overridingMethod: Method;
  reason: string;
  overriddenBy: string;
  overriddenAt: string;
};

/** The latest override per origin (D4): the query already sorts newest-first, but
 *  reduce defensively on `overriddenAt` so the display is order-independent. */
function latestByOrigin(
  overrides: RecommendationOverride[],
): Map<string, RecommendationOverride> {
  const map = new Map<string, RecommendationOverride>();
  for (const o of overrides) {
    const current = map.get(o.origin);
    if (current === undefined || o.overriddenAt > current.overriddenAt) {
      map.set(o.origin, o);
    }
  }
  return map;
}

const OVERRIDE_BUTTON_CLASS =
  "w-fit rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50";

export function RecommendationTable({
  recommendations,
  diagnosticsBundle,
  overrides = [],
  canOverride = false,
  onOverride,
}: {
  recommendations: Recommendations;
  diagnosticsBundle: DiagnosticsBundle;
  // Story 6.3: the override rows (append-only history); the latest-per-origin is
  // derived here. Optional/defaulted so pre-6.3 call sites still render.
  overrides?: RecommendationOverride[];
  // Story 6.3 (D7): is the current user a Senior Actuary (display gating only —
  // the server `requireRole` is the authority). Optional/defaulted.
  canOverride?: boolean;
  // Story 6.3: record an override. Optional — when unwired the control degrades
  // to the disabled-with-tooltip idiom (no live override path).
  onOverride?: (
    origin: string,
    overridingMethod: Method,
    reason: string,
  ) => Promise<void>;
}) {
  const latest = latestByOrigin(overrides);

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">
            Recommended Method and reasons per Origin Period, each reason citing
            its diagnostics, with the per-row override status.
          </caption>
          <thead>
            <tr>
              <th
                scope="col"
                className="border border-border p-cell-pad text-left font-medium text-muted-foreground"
              >
                Origin Period
              </th>
              <th
                scope="col"
                className="border border-border p-cell-pad text-left font-medium text-muted-foreground"
              >
                Recommended Method
              </th>
              <th
                scope="col"
                className="border border-border p-cell-pad text-left font-medium text-muted-foreground"
              >
                Reasons
              </th>
              <th
                scope="col"
                className="border border-border p-cell-pad text-left font-medium text-muted-foreground"
              >
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {recommendations.recommendations.map((rec) => (
              <OverrideRow
                key={rec.origin}
                rec={rec}
                diagnosticsBundle={diagnosticsBundle}
                override={latest.get(rec.origin) ?? null}
                canOverride={canOverride}
                onOverride={onOverride}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** One table row: the machine recommendation, its Status pill + Override control,
 *  and (when overridden) the side-by-side override card. Holds its own dialog
 *  state (mirroring ReportApprovalBar's DraftBar, D6). */
function OverrideRow({
  rec,
  diagnosticsBundle,
  override,
  canOverride,
  onOverride,
}: {
  rec: MethodRecommendation;
  diagnosticsBundle: DiagnosticsBundle;
  override: RecommendationOverride | null;
  canOverride: boolean;
  onOverride?: (
    origin: string,
    overridingMethod: Method,
    reason: string,
  ) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState<Method | "">("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const isOverridden = override !== null;
  // D4: the picker offers the methods OTHER than the recommendation's own.
  const options = METHOD_OPTIONS.filter((m) => m.value !== rec.method);
  const canConfirm = selectedMethod !== "" && reason.trim().length > 0;
  const buttonLabel = isOverridden ? "Change override" : "Override";

  function reset() {
    setSelectedMethod("");
    setReason("");
    setError(null);
  }

  async function confirm() {
    if (!onOverride || selectedMethod === "") return;
    setPending(true);
    setError(null);
    try {
      await onOverride(rec.origin, selectedMethod, reason);
      // Server ack: the getRecommendationOverrides subscription re-emits and the
      // row re-renders with the override — close the dialog, flip NOTHING locally
      // (no optimistic UI, D6/D9).
      setOpen(false);
      reset();
    } catch (err) {
      setError((err as Error).message ?? "The override could not be recorded.");
    } finally {
      setPending(false);
    }
  }

  return (
    <tr>
      <th
        scope="row"
        className="border border-border p-cell-pad text-left align-top font-medium"
      >
        {rec.origin}
      </th>
      <td className="border border-border p-cell-pad align-top">
        {methodLabel(rec.method)}
      </td>
      <td className="border border-border p-cell-pad align-top">
        <ul className="space-y-2">
          {rec.reasons.map((reasonItem, i) => (
            <li key={i} className="space-y-1">
              {/* Prose rendered verbatim from the gate — no client formatting of
                  its numbers (AD-1). */}
              <span>{reasonItem.text}</span>{" "}
              {reasonItem.citations.map((dxId) => (
                <CitationChip
                  key={dxId}
                  dxId={dxId}
                  diagnosticsBundle={diagnosticsBundle}
                />
              ))}
            </li>
          ))}
        </ul>
        {/* D8/AC-2: the override renders BESIDE the untouched recommendation —
            history side by side, never erased. */}
        {override && <OverrideCard rec={rec} override={override} />}
      </td>
      <td className="border border-border p-cell-pad align-top">
        <div className="flex flex-col items-start gap-2">
          <StatusPill overridden={isOverridden} />
          {canOverride && onOverride ? (
            <Dialog
              open={open}
              onOpenChange={(next) => {
                // Esc / overlay-click / Cancel all route here — clear the inline
                // error and never fire the action on dismiss (D6).
                setOpen(next);
                if (!next) setError(null);
              }}
            >
              <button
                type="button"
                onClick={() => setOpen(true)}
                className={OVERRIDE_BUTTON_CLASS}
              >
                {buttonLabel}
              </button>

              <DialogContent
                // Initial focus on Cancel — the safety posture for audit-
                // generating dialogs (UX-DR14/D6).
                onOpenAutoFocus={(e) => {
                  e.preventDefault();
                  cancelRef.current?.focus();
                }}
              >
                <DialogHeader>
                  <DialogTitle>
                    Override recommendation — {rec.origin}
                  </DialogTitle>
                  <DialogDescription>
                    This records an override of the {methodLabel(rec.method)}{" "}
                    recommendation for Origin Period {rec.origin}. Your override
                    and reason will be logged.
                  </DialogDescription>
                </DialogHeader>

                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">
                    Overriding Method
                  </legend>
                  {options.map((m) => (
                    <label
                      key={m.value}
                      className="flex items-center gap-2 text-sm"
                    >
                      <input
                        type="radio"
                        name={`override-method-${rec.origin}`}
                        value={m.value}
                        checked={selectedMethod === m.value}
                        onChange={() => setSelectedMethod(m.value)}
                      />
                      {m.label}
                    </label>
                  ))}
                </fieldset>

                <label className="block space-y-1 text-sm">
                  <span className="font-medium">Reason</span>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={3}
                    className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
                  />
                </label>

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
                      disabled={pending}
                      className="w-fit rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </DialogClose>
                  <button
                    type="button"
                    disabled={pending || !canConfirm}
                    onClick={() => void confirm()}
                    className="w-fit rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {pending ? "Overriding…" : "Confirm override"}
                  </button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          ) : (
            // UX-DR18/D7: the Analyst sees the control visible-but-disabled with a
            // tooltip — never hidden. A disabled <button> swallows pointer events,
            // so the focusable <span> is the tooltip trigger (the 5.6/6.1 idiom).
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0} className="inline-block w-fit">
                    <button
                      type="button"
                      disabled
                      className={OVERRIDE_BUTTON_CLASS}
                    >
                      {buttonLabel}
                    </button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>Senior Actuary role required</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </td>
    </tr>
  );
}

/** The inline accepted/overridden status tag (D5). NOT StatusBadge (a different
 *  axis) — a small pill in the shared token families, no hard-coded hex. */
function StatusPill({ overridden }: { overridden: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center rounded-full px-2 py-0.5 text-xs font-medium",
        overridden
          ? "bg-caution-subtle text-caution"
          : "bg-muted text-muted-foreground",
      )}
    >
      {overridden ? "overridden" : "accepted"}
    </span>
  );
}

/** The side-by-side override card (D8), mirroring mockup report-review.html:64-68:
 *  a teal `border-l` accent (NOT provenance-violet — violet is chip-exclusive,
 *  DESIGN.md:89), the method → method transition, the quoted reason, and the
 *  attribution line. Display formatting only (AD-1). */
function OverrideCard({
  rec,
  override,
}: {
  rec: MethodRecommendation;
  override: RecommendationOverride;
}) {
  return (
    <div className="mt-3 border-l-2 border-primary pl-3 text-sm">
      <p className="font-medium">
        Override — {methodLabel(rec.method)} →{" "}
        {methodLabel(override.overridingMethod)}
      </p>
      <p className="mt-1 text-muted-foreground">“{override.reason}”</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {override.overriddenBy} · Senior Actuary · {override.overriddenAt}
      </p>
    </div>
  );
}
