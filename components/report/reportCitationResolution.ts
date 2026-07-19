import {
  buildDiagnosticIndex,
  resolveDiagnostic,
} from "@/components/diagnostics/resolveDiagnostic";
import { citationsFromText, figureSentences } from "@/convex/lib/citationMarker";
import type { DiagnosticsBundle, ReserveReport } from "@/convex/lib/engineContract";

// Story 6.4 (AC-1, D6): the client "N claims · N citations resolve" count + the
// failing-sentence blocker for the Approve & Publish bar (UX-DR13). The display
// + Approve-disable layer over the SAME `figureSentences`/`uncitedSentences`
// helper the SERVER blocker enforces (D2), plus the chip `resolveDiagnostic`
// check for dangling-marker honesty. Because the client uses the server's
// helper, the button state matches the server gate exactly — no client/server
// divergence; the server re-checks so the gate is never client-trusted.
//
// A "claim" is a figure-bearing sentence (`figureSentences`). A claim FAILS if:
//   • it carries NO `[[cite:...]]` marker (uncited — the reachable case: humans
//     delete chips but cannot forge them, 6.1 D2), OR
//   • it carries a marker whose `dxId` does not resolve against the
//     DiagnosticsBundle (dangling — near-unreachable through the editor, checked
//     for display honesty; flagged as a residual in deferred-work §6.4).
// `resolvedClaims = totalClaims − failingSentences.length`. Pure string/metadata
// over already-loaded text — NO arithmetic on reserve figures (AD-1).

export type ReportSectionKey =
  | "executiveSummary"
  | "methodSelectionRationale"
  | "movementCommentary"
  | "limitations";

const SECTION_KEYS: ReportSectionKey[] = [
  "executiveSummary",
  "methodSelectionRationale",
  "movementCommentary",
  "limitations",
];

export type FailingSentence = {
  sectionKey: ReportSectionKey;
  sentence: string;
};

export type ReportCitationResolution = {
  totalClaims: number;
  resolvedClaims: number;
  failingSentences: FailingSentence[];
};

/**
 * Aggregate the citation-resolution state across the four Reserve Report
 * sections. When `bundle` is null (the manual / Engine-Only path — no bundle,
 * typically no chips) dangling-resolution is UNKNOWN, so only uncited claims are
 * counted as failures; the display stays honest without asserting a resolution
 * it cannot verify.
 */
export function reportCitationResolution(
  sections: ReserveReport,
  bundle: DiagnosticsBundle | null,
): ReportCitationResolution {
  // Build the id→element index once (chip resolver, D6). Null bundle → no
  // dangling check (unknown), only uncited failures counted.
  const index = bundle ? buildDiagnosticIndex(bundle) : null;

  let totalClaims = 0;
  const failingSentences: FailingSentence[] = [];

  for (const key of SECTION_KEYS) {
    for (const { sentence } of figureSentences(sections[key].text)) {
      totalClaims += 1;
      const markers = citationsFromText(sentence);
      const uncited = markers.length === 0;
      const dangling =
        index !== null &&
        markers.some((id) => resolveDiagnostic(index, id) === null);
      if (uncited || dangling) {
        failingSentences.push({ sectionKey: key, sentence });
      }
    }
  }

  return {
    totalClaims,
    resolvedClaims: totalClaims - failingSentences.length,
    failingSentences,
  };
}
