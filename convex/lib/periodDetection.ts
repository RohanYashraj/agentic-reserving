/**
 * Period detection (Story 3.3, FR-3): infer Origin-Period granularity and
 * Development-age interval from the parsed triangle's OPAQUE label strings, and
 * flag when the layout is ambiguous so the wizard prompts the user instead of
 * silently guessing (AC2).
 *
 * This is metadata inference on label shapes — NOT arithmetic on reserve figures
 * (AD-1). Pure module: no `ctx`, no I/O; runs client-side on `validateTriangle`'s
 * returned labels and is unit-testable in isolation. Detection output is a
 * suggestion only — nothing is persisted until the user explicitly confirms
 * (Story 3.3 acceptance).
 */

export type OriginGranularity = "annual" | "quarterly" | "monthly" | "unknown";
export type DevelopmentInterval = "months" | "quarters" | "years" | "unknown";

export interface PeriodDetection {
  originGranularity: OriginGranularity;
  developmentInterval: DevelopmentInterval;
  ambiguous: boolean;
  /** Human-readable ask, present only when `ambiguous` is true. */
  reason?: string;
}

const YEAR = /^\d{4}$/;
const QUARTER = /^\d{4}[-\s]?Q[1-4]$/i;
const MONTH = /^\d{4}-\d{2}$/;

/** The interval implied by a consistent numeric step between development ages. */
const STEP_TO_INTERVAL: Record<number, DevelopmentInterval> = {
  1: "years",
  3: "quarters",
  12: "months",
};

function detectOriginGranularity(labels: readonly string[]): OriginGranularity {
  if (labels.length === 0) return "unknown";
  const trimmed = labels.map((l) => l.trim());
  if (trimmed.every((l) => YEAR.test(l))) return "annual";
  if (trimmed.every((l) => QUARTER.test(l))) return "quarterly";
  if (trimmed.every((l) => MONTH.test(l))) return "monthly";
  return "unknown";
}

function detectDevelopmentInterval(labels: readonly string[]): DevelopmentInterval {
  // Need at least two ages to infer a step; a single/absent column is
  // undeterminable → unknown (and therefore ambiguous).
  if (labels.length < 2) return "unknown";
  const ages = labels.map((l) => Number(l.trim()));
  if (ages.some((n) => !Number.isFinite(n))) return "unknown";

  const step = ages[1] - ages[0];
  if (step <= 0) return "unknown";
  // Every consecutive pair must share the same positive step.
  for (let i = 1; i < ages.length; i++) {
    if (ages[i] - ages[i - 1] !== step) return "unknown";
  }
  return STEP_TO_INTERVAL[step] ?? "unknown";
}

export function detectPeriods(
  originLabels: readonly string[],
  developmentLabels: readonly string[],
): PeriodDetection {
  const originGranularity = detectOriginGranularity(originLabels);
  const developmentInterval = detectDevelopmentInterval(developmentLabels);

  const originUnknown = originGranularity === "unknown";
  const developmentUnknown = developmentInterval === "unknown";

  if (!originUnknown && !developmentUnknown) {
    return { originGranularity, developmentInterval, ambiguous: false };
  }

  // Build a specific ask naming the axis (or axes) that could not be read —
  // never a generic message (EXPERIENCE.md copy tone; FR-3 "never a silent guess").
  const parts: string[] = [];
  if (originUnknown) {
    parts.push("the origin-period granularity (annual, quarterly, or monthly)");
  }
  if (developmentUnknown) {
    parts.push("the development-age interval (months, quarters, or years)");
  }
  const reason = `Could not read ${parts.join(" or ")} from the labels — please confirm it before accepting.`;

  return { originGranularity, developmentInterval, ambiguous: true, reason };
}
