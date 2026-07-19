// Display formatting for engine figures (AD-1: formatting only — never
// arithmetic). One `Intl.NumberFormat` instance shared by every numeric grid
// (TriangleGrid, ResultsGrid) so the engine-figure texture never drifts.

const groupFormat = new Intl.NumberFormat("en-US");

// LDFs / age-to-age factors carry fractional precision (e.g. 1.4523) that the
// integer-grouping format would collapse — keep up to 4 fraction digits.
const factorFormat = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

// A ratio (Actual/Expected, relative divergence) rendered as a percentage.
// `style: "percent"` multiplies by 100 and appends "%" — display formatting
// only (0.9639 → "96.4%"), NOT arithmetic (AD-1).
const percentFormat = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

// A signed reserve figure (Actual−Expected, CL−BF divergence) with the sign
// always shown so direction is never colour-only (WCAG). `signDisplay:
// "exceptZero"` prefixes "+"/"−"; grouping matches `formatFigure`.
const signedGroupFormat = new Intl.NumberFormat("en-US", {
  signDisplay: "exceptZero",
});

// A standardized residual — small magnitude, fixed 2 fraction digits so the
// heatmap cells read as a stable column (−0.40, +1.10). Display only.
const residualFormat = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * A reserve figure (ultimate, IBNR, std err, reserve bound) with thousands
 * grouping. `null` renders as `nullText` — "—" for a genuinely absent value
 * (e.g. a Mack field on a CL result), or "" for a triangle hole (pass "").
 */
export function formatFigure(value: number | null, nullText = "—"): string {
  return value === null ? nullText : groupFormat.format(value);
}

/** An age-to-age development factor (LDF), 2–4 fraction digits. */
export function formatFactor(value: number | null, nullText = "—"): string {
  return value === null ? nullText : factorFormat.format(value);
}

/**
 * A ratio rendered as a percentage (`actualToExpectedRatio`,
 * `relativeDivergence`). Display formatting only — the engine stored the ratio;
 * `Intl` scales it to a percent (AD-1: never `ratio − 1` arithmetic here).
 */
export function formatPercent(value: number | null, nullText = "—"): string {
  return value === null ? nullText : percentFormat.format(value);
}

/**
 * A signed engine figure (`actualMinusExpected`, `divergence`) with an explicit
 * "+"/"−" so direction is announced textually, not by colour alone.
 */
export function formatSignedFigure(
  value: number | null,
  nullText = "—",
): string {
  return value === null ? nullText : signedGroupFormat.format(value);
}

/** A standardized residual (fixed 2 d.p.) for the residual heatmap cells. */
export function formatResidual(value: number | null, nullText = "—"): string {
  return value === null ? nullText : residualFormat.format(value);
}
