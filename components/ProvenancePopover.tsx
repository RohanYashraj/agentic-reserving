"use client";

import { useState, type ReactNode } from "react";

import { CopyableHash } from "@/components/CopyableHash";
import { methodLabel } from "@/components/methods";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { Id } from "@/convex/_generated/dataModel";
import type { ResultSet } from "@/convex/lib/engineContract";

// Story 4.4 (AC2, UX-DR15): "Where did this come from?" — every ResultSet figure
// offers a provenance popover carrying the run Lineage (engine version,
// chainladder version, truncated+copyable Triangle hash, parameters, a link
// toward the Run's audit trail). The Lineage is run-level (identical for every
// figure), so this one component wraps every cell; only `label` differs.
//
// Trigger gestures reconciled with the WCAG 2.2 AA floor (UX-DR18): a real
// <button> opens on click + Enter/Space (accessible default) AND right-click
// (onContextMenu, the UX-DR15 desktop gesture) AND touch tap/long-press. A
// right-click/long-press-ONLY affordance would fail the keyboard floor.
//
// Provenance violet (DESIGN.md:89) is used ONLY on the popover chrome / audit
// link — never on the figure itself (that would flood the grid with violet).

type Lineage = ResultSet["lineage"];

export function ProvenancePopover({
  lineage,
  runId,
  label,
  children,
}: {
  lineage: Lineage;
  runId: Id<"runs">;
  label: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const { engineVersion, chainladderVersion, triangleHash, parameters } =
    lineage;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Where did this come from? ${label}`}
          onContextMenu={(e) => {
            // UX-DR15 right-click gesture: suppress the browser menu, open the
            // Lineage instead.
            e.preventDefault();
            setOpen(true);
          }}
          className="cursor-help rounded-sm underline decoration-dotted decoration-muted-foreground/40 underline-offset-4 outline-none hover:decoration-provenance focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end">
        <div className="space-y-3 text-sm">
          <p className="text-xs font-medium text-provenance">
            Where did this come from?
          </p>
          <dl className="space-y-2">
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs text-muted-foreground">Engine version</dt>
              <dd className="numeric text-foreground">{engineVersion}</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs text-muted-foreground">
                chainladder version
              </dt>
              <dd className="numeric text-foreground">{chainladderVersion}</dd>
            </div>
            <div>
              <CopyableHash label="Triangle hash" hash={triangleHash} />
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-xs text-muted-foreground">Methods</dt>
              <dd className="text-foreground">
                {parameters.methods.map((m) => methodLabel(m)).join(", ")}
              </dd>
            </div>
            {parameters.aprioriLossRatios.length > 0 && (
              <div className="flex flex-col gap-0.5">
                <dt className="text-xs text-muted-foreground">
                  A-priori loss ratios
                </dt>
                <dd>
                  <ul className="space-y-0.5">
                    {parameters.aprioriLossRatios.map((a) => (
                      <li
                        key={a.origin}
                        className="numeric text-xs text-foreground"
                      >
                        {a.origin}: {a.lossRatio} · exposure {a.exposure}
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            )}
          </dl>
          {/* Audit-trail forward reference (UX-DR15). The Audit Log browser is
              Epic 7 (7.1); until it lands, surface the runId (the audit
              correlation key) as a provenance affordance rather than a dead
              link — an auditor can find the trail by this id today. */}
          <div className="border-t border-border pt-2">
            <p className="text-xs text-muted-foreground">Audit trail</p>
            <p className="numeric mt-0.5 break-all text-xs text-provenance">
              run {runId}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Browse in the Audit Log (arrives in Epic 7).
            </p>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
