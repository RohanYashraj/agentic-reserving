import type { Method } from "@/convex/lib/engineContract";

// Single source of the friendly Method labels, shared by RunConfig (selection)
// and RunDetail (per-Method progress rows) so the labels never drift (Story
// 4.3). Keyed by the snake_case engine Method literal.
export const METHOD_OPTIONS: { value: Method; label: string }[] = [
  { value: "chain_ladder", label: "Chain Ladder (CL)" },
  { value: "bornhuetter_ferguson", label: "Bornhuetter-Ferguson (BF)" },
  { value: "mack", label: "Mack" },
];

const METHOD_LABELS: Record<Method, string> = Object.fromEntries(
  METHOD_OPTIONS.map((m) => [m.value, m.label]),
) as Record<Method, string>;

/** Friendly label for a Method; falls back to the raw key if ever unknown. */
export function methodLabel(method: Method): string {
  return METHOD_LABELS[method] ?? method;
}
