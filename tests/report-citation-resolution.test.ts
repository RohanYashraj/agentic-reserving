import { describe, expect, it } from "vitest";

import { reportCitationResolution } from "@/components/report/reportCitationResolution";
import type {
  DiagnosticsBundle,
  ReserveReport,
} from "@/convex/lib/engineContract";

// Story 6.4 (AC-1, D6): the client resolution count + failing-sentence blocker.
// Pure string/metadata over the four section texts (AD-1) — a "claim" is a
// figure-bearing sentence; it FAILS if uncited or if a cited dxId is dangling.

function makeDiagnosticsBundle(): DiagnosticsBundle {
  return {
    schemaVersion: "1.0.0",
    runId: "r1",
    triangleHash: "a".repeat(64),
    ldfStability: [],
    ave: [
      {
        id: "dx:r1:ave:2019",
        origin: "2019",
        fromDev: "12",
        toDev: "24",
        actual: 4213,
        expected: 4371,
        actualMinusExpected: -158,
        actualToExpectedRatio: 0.9639,
      },
    ],
    clBfDivergence: null,
    residuals: [],
  };
}

const CITE = "dx:r1:ave:2019";

function makeReport(overrides: Partial<Record<Section, string>> = {}): ReserveReport {
  const section = (text: string) => ({ text, citations: [] as string[] });
  const texts: Record<Section, string> = {
    executiveSummary: `The reserve is 4,213 [[cite:${CITE}]].`,
    methodSelectionRationale: `The factor is 1.25 [[cite:${CITE}]].`,
    movementCommentary: `Paid rose by 3,120 [[cite:${CITE}]].`,
    limitations: `Uncertainty of 2,000 remains [[cite:${CITE}]].`,
    ...overrides,
  };
  return {
    schemaVersion: "1.0.0",
    runId: "r1",
    machineDrafted: true,
    executiveSummary: section(texts.executiveSummary),
    methodSelectionRationale: section(texts.methodSelectionRationale),
    movementCommentary: section(texts.movementCommentary),
    limitations: section(texts.limitations),
  };
}

type Section =
  | "executiveSummary"
  | "methodSelectionRationale"
  | "movementCommentary"
  | "limitations";

describe("reportCitationResolution (Story 6.4, D6)", () => {
  const bundle = makeDiagnosticsBundle();

  it("all four sections figure-bearing + cited (resolving) → no failures", () => {
    const res = reportCitationResolution(makeReport(), bundle);
    expect(res.totalClaims).toBe(4);
    expect(res.resolvedClaims).toBe(4);
    expect(res.failingSentences).toHaveLength(0);
  });

  it("removing a marker flags that sentence (uncited) with its sectionKey", () => {
    const res = reportCitationResolution(
      makeReport({ movementCommentary: "Paid rose by 3,120." }),
      bundle,
    );
    expect(res.totalClaims).toBe(4);
    expect(res.resolvedClaims).toBe(3);
    expect(res.failingSentences).toHaveLength(1);
    expect(res.failingSentences[0].sectionKey).toBe("movementCommentary");
    expect(res.failingSentences[0].sentence).toContain("3,120");
  });

  it("a cited sentence whose dxId does not resolve is flagged (dangling)", () => {
    const res = reportCitationResolution(
      makeReport({
        limitations: "Uncertainty of 2,000 remains [[cite:dx:r1:ave:9999]].",
      }),
      bundle,
    );
    expect(res.totalClaims).toBe(4);
    expect(res.resolvedClaims).toBe(3);
    expect(res.failingSentences).toHaveLength(1);
    expect(res.failingSentences[0].sectionKey).toBe("limitations");
  });

  it("a purely qualitative section (no figures) contributes 0 claims", () => {
    const res = reportCitationResolution(
      makeReport({ limitations: "Estimates carry uncertainty." }),
      bundle,
    );
    expect(res.totalClaims).toBe(3);
    expect(res.resolvedClaims).toBe(3);
    expect(res.failingSentences).toHaveLength(0);
  });

  it("bundle == null → only uncited failures counted (dangling is unknown)", () => {
    const res = reportCitationResolution(
      makeReport({
        // Dangling under a bundle, but with no bundle its resolution is unknown.
        limitations: "Uncertainty of 2,000 remains [[cite:dx:r1:ave:9999]].",
        movementCommentary: "Paid rose by 3,120.", // uncited → always fails
      }),
      null,
    );
    expect(res.totalClaims).toBe(4);
    // Only the uncited movementCommentary sentence fails; the dangling one is
    // not counted (no bundle to check against).
    expect(res.failingSentences).toHaveLength(1);
    expect(res.failingSentences[0].sectionKey).toBe("movementCommentary");
    expect(res.resolvedClaims).toBe(3);
  });
});
