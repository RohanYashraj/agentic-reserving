"use client";

import { CitationChip } from "@/components/interpretation/CitationChip";
import { methodLabel } from "@/components/methods";
import type {
  DiagnosticsBundle,
  Recommendations,
} from "@/convex/lib/engineContract";

// Story 5.5 (AC1/AC2): the per-Origin-Period recommendation table — the visible
// deliverable of Interpretation. One row per Origin Period (the 5.3 validator
// guarantees exactly one MethodRecommendation per origin, so no dedupe/sort
// invention — render in the given order). Each row: Origin Period, the
// recommended Method (via the shared `methodLabel` — never re-mapped inline),
// and the reasons. Each RecommendationReason renders its already-gate-rendered
// `text` as prose (figures + citation markers were rendered server-side — NO
// client formatting of its numbers, AD-1) followed by one CitationChip per id in
// `reason.citations` (the machine-readable pin, NOT re-parsed from `text`).
// A reason carries ≥1 citation by the 5.3 contract → every reason trails ≥1 chip
// ("a claim without a chip cannot exist on screen", EXPERIENCE.md:55).
//
// Pure presentational: props in, no data fetching, no Convex hooks. The panel
// header (AC1) lives here — RecommendationTable IS the accepted-output panel, so
// the InterpretationTab composes header + table by rendering this component (one
// header, no duplication).

export function RecommendationTable({
  recommendations,
  diagnosticsBundle,
}: {
  recommendations: Recommendations;
  diagnosticsBundle: DiagnosticsBundle;
}) {
  return (
    <div className="space-y-4">
      {/* Quiet, labelled-not-decorated header (EXPERIENCE.md:58) — middle-dot `·`
          wins over the mockup's em-dash. No sparkle/AI-persona chrome. */}
      <p className="text-sm text-muted-foreground">
        Drafted by the interpretation layer · every claim cites a diagnostic
      </p>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">
            Recommended Method and reasons per Origin Period, each reason citing
            its diagnostics.
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
            </tr>
          </thead>
          <tbody>
            {recommendations.recommendations.map((rec) => (
              <tr key={rec.origin}>
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
                    {rec.reasons.map((reason, i) => (
                      <li key={i} className="space-y-1">
                        {/* Prose rendered verbatim from the gate — no client
                            formatting of its numbers (AD-1). */}
                        <span>{reason.text}</span>{" "}
                        {reason.citations.map((dxId) => (
                          <CitationChip
                            key={dxId}
                            dxId={dxId}
                            diagnosticsBundle={diagnosticsBundle}
                          />
                        ))}
                      </li>
                    ))}
                  </ul>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
