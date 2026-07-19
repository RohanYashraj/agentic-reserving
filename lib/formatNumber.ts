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
