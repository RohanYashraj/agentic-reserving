import { describe, expect, it } from "vitest";

import { detectPeriods } from "./periodDetection";

// Story 3.3 (FR-3): period detection is a heuristic over OPAQUE label strings —
// it infers display metadata (granularity/interval), never computes on reserve
// figures (AD-1). When it cannot read a label cleanly it flags `ambiguous` with a
// reason, so the wizard can prompt the user rather than silently guess (AC2).

describe("detectPeriods — origin granularity", () => {
  it("detects annual origins (4-digit years)", () => {
    const d = detectPeriods(["2016", "2017", "2018"], ["12", "24", "36"]);
    expect(d.originGranularity).toBe("annual");
    expect(d.ambiguous).toBe(false);
  });

  it("detects quarterly origins (YYYYQn / YYYY-Qn)", () => {
    expect(detectPeriods(["2020Q1", "2020Q2"], ["3", "6"]).originGranularity).toBe(
      "quarterly",
    );
    expect(detectPeriods(["2020-Q1", "2020-Q2"], ["3", "6"]).originGranularity).toBe(
      "quarterly",
    );
  });

  it("detects monthly origins (YYYY-MM)", () => {
    expect(detectPeriods(["2021-01", "2021-02"], ["1", "2"]).originGranularity).toBe(
      "monthly",
    );
  });

  it("flags unknown origin granularity as ambiguous with a reason", () => {
    const d = detectPeriods(["alpha", "beta"], ["12", "24"]);
    expect(d.originGranularity).toBe("unknown");
    expect(d.ambiguous).toBe(true);
    expect(d.reason).toMatch(/origin/i);
  });
});

describe("detectPeriods — development interval", () => {
  it("detects months (step 12)", () => {
    expect(
      detectPeriods(["2016", "2017"], ["12", "24", "36"]).developmentInterval,
    ).toBe("months");
  });

  it("detects quarters (step 3)", () => {
    expect(detectPeriods(["2016", "2017"], ["3", "6", "9"]).developmentInterval).toBe(
      "quarters",
    );
  });

  it("detects years (step 1)", () => {
    expect(detectPeriods(["2016", "2017"], ["1", "2", "3"]).developmentInterval).toBe(
      "years",
    );
  });

  it("flags non-numeric / irregular development labels as ambiguous", () => {
    const nonNumeric = detectPeriods(["2016", "2017"], ["age-a", "age-b"]);
    expect(nonNumeric.developmentInterval).toBe("unknown");
    expect(nonNumeric.ambiguous).toBe(true);
    expect(nonNumeric.reason).toMatch(/development/i);

    // Inconsistent step (12 then 5) → cannot infer an interval → ambiguous.
    const irregular = detectPeriods(["2016", "2017"], ["12", "24", "29"]);
    expect(irregular.developmentInterval).toBe("unknown");
    expect(irregular.ambiguous).toBe(true);
  });
});

describe("detectPeriods — clean vs ambiguous", () => {
  it("a fully clean triangle is not ambiguous and carries no reason", () => {
    const d = detectPeriods(["2016", "2017", "2018"], ["12", "24", "36"]);
    expect(d).toEqual({
      originGranularity: "annual",
      developmentInterval: "months",
      ambiguous: false,
    });
  });

  it("both axes unknown → ambiguous, reason mentions both", () => {
    const d = detectPeriods(["x", "y"], ["p", "q"]);
    expect(d.ambiguous).toBe(true);
    expect(d.reason).toMatch(/origin/i);
    expect(d.reason).toMatch(/development/i);
  });

  it("empty axes → ambiguous (nothing to read)", () => {
    expect(detectPeriods([], []).ambiguous).toBe(true);
  });
});
