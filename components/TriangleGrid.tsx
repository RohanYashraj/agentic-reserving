"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { formatFigure } from "@/lib/formatNumber";
import { cn } from "@/lib/utils";

// UX-DR5 Triangle grid: dense read-only numeric grid, Geist Mono right-aligned
// cells, Latest Diagonal 2px primary left border, flagged cells in the caution
// treatment (never color-only — a caution glyph + the findings list carry the
// same signal), proper table semantics with announced headers, arrow-key cell
// navigation. Read-only always (no in-app editing, PRD §6.2). Reused by the
// upload wizard (3.2), the Triangle detail page (3.3), and Run detail (Epic 4).

/** A cell is addressed by its period labels: `${origin}|${dev}`. */
export function cellKey(origin: string, dev: string): string {
  return `${origin}|${dev}`;
}

export interface TriangleGridProps {
  kind: "paid" | "incurred";
  originPeriods: readonly string[];
  developmentPeriods: readonly string[];
  cells: readonly (readonly (number | null)[])[];
  /** Cells to flag in the caution treatment, keyed by `${origin}|${dev}`. */
  flaggedCells?: ReadonlySet<string>;
  /** A cell to scroll to, highlight, and focus (e.g. a clicked finding). */
  highlightedCell?: string | null;
  /** Edge-mark the last observed cell of each origin row (Latest Diagonal). */
  showLatestDiagonal?: boolean;
  /** Invoked when a cell is activated (Enter). No context rail on this surface. */
  onCellFocus?: (key: string) => void;
}

// Triangle holes render blank (not "—"): pass "" as the null text.
function formatValue(value: number | null): string {
  return formatFigure(value, "");
}

/** Index of the last observed (non-null) cell in a row, or -1 if none. */
function lastObservedIndex(row: readonly (number | null)[]): number {
  for (let c = row.length - 1; c >= 0; c--) {
    if (row[c] !== null) return c;
  }
  return -1;
}

export function TriangleGrid({
  kind,
  originPeriods,
  developmentPeriods,
  cells,
  flaggedCells,
  highlightedCell,
  showLatestDiagonal = false,
  onCellFocus,
}: TriangleGridProps) {
  const cellRefs = useRef<Map<string, HTMLTableCellElement>>(new Map());
  // Roving tabindex: exactly one cell is tab-focusable at a time.
  const [active, setActive] = useState<[number, number]>([0, 0]);

  const setCellRef = useCallback(
    (key: string, el: HTMLTableCellElement | null) => {
      if (el) cellRefs.current.set(key, el);
      else cellRefs.current.delete(key);
    },
    [],
  );

  // Scroll to, focus, and briefly emphasise a clicked-finding cell.
  useEffect(() => {
    if (!highlightedCell) return;
    const el = cellRefs.current.get(highlightedCell);
    if (!el) return;
    el.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
    el.focus();
  }, [highlightedCell]);

  const nRows = originPeriods.length;
  const nCols = developmentPeriods.length;

  function focusCell(r: number, c: number) {
    const clampedR = Math.max(0, Math.min(nRows - 1, r));
    const clampedC = Math.max(0, Math.min(nCols - 1, c));
    setActive([clampedR, clampedC]);
    const key = cellKey(originPeriods[clampedR], developmentPeriods[clampedC]);
    cellRefs.current.get(key)?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent, r: number, c: number, key: string) {
    switch (e.key) {
      case "ArrowRight":
        e.preventDefault();
        focusCell(r, c + 1);
        break;
      case "ArrowLeft":
        e.preventDefault();
        focusCell(r, c - 1);
        break;
      case "ArrowDown":
        e.preventDefault();
        focusCell(r + 1, c);
        break;
      case "ArrowUp":
        e.preventDefault();
        focusCell(r - 1, c);
        break;
      case "Enter":
        e.preventDefault();
        onCellFocus?.(key);
        break;
    }
  }

  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-sm">
        <caption className="sr-only">
          {kind === "paid" ? "Paid" : "Incurred"} triangle: origin periods by
          development period, cumulative values.
        </caption>
        <thead>
          <tr>
            <th scope="col" className="border border-border p-cell-pad text-left font-medium text-muted-foreground">
              Origin
            </th>
            {developmentPeriods.map((dev) => (
              <th
                key={dev}
                scope="col"
                className="border border-border p-cell-pad text-right font-medium text-muted-foreground"
              >
                {dev}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {originPeriods.map((origin, r) => {
            const row = cells[r] ?? [];
            const latest = showLatestDiagonal ? lastObservedIndex(row) : -1;
            return (
              <tr key={origin}>
                <th
                  scope="row"
                  className="border border-border p-cell-pad text-left font-medium text-muted-foreground"
                >
                  {origin}
                </th>
                {developmentPeriods.map((dev, c) => {
                  const key = cellKey(origin, dev);
                  const value = row[c] ?? null;
                  const flagged = flaggedCells?.has(key) ?? false;
                  const isActive = active[0] === r && active[1] === c;
                  const isHighlighted = highlightedCell === key;
                  const label =
                    value === null
                      ? `Origin ${origin}, development ${dev}, no value`
                      : `Origin ${origin}, development ${dev}, value ${formatValue(value)}`;
                  return (
                    <td
                      key={dev}
                      ref={(el) => setCellRef(key, el)}
                      tabIndex={isActive ? 0 : -1}
                      aria-label={label}
                      onFocus={() => setActive([r, c])}
                      onKeyDown={(e) => onKeyDown(e, r, c, key)}
                      onClick={() => onCellFocus?.(key)}
                      className={cn(
                        "numeric border border-border p-cell-pad text-right tabular-nums outline-none",
                        showLatestDiagonal && c === latest && "border-l-2 border-l-primary",
                        flagged && "bg-caution-subtle text-caution",
                        isHighlighted && "ring-2 ring-primary ring-inset",
                        "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset",
                      )}
                    >
                      <span className="inline-flex items-center justify-end gap-1">
                        {flagged && (
                          // Non-color signal (WCAG): an icon accompanies the amber fill.
                          <span aria-hidden="true" className="text-caution">
                            ⚠
                          </span>
                        )}
                        {formatValue(value)}
                      </span>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
