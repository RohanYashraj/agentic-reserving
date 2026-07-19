"use client";

import { useRef, useState } from "react";

import { useDiagnosticSelection } from "@/components/diagnostics/selection";
import type { DiagnosticsBundle } from "@/convex/lib/engineContract";
import { cn } from "@/lib/utils";
import { formatResidual } from "@/lib/formatNumber";

// Story 4.5 (AC2/3/4/5): residual heatmap over Origin × Development. Diverging
// blue↔amber ramp (NEVER red↔green — DESIGN.md:130,139); the residual VALUE is
// always printed in the cell (colour is annotation, the number is the datum —
// EXPERIENCE.md:108). Real table semantics + per-cell Diagnostic-ID anchor make
// it self-accessible (no chart toggle needed — AC4). Axis bucketing is string/
// display work only; no printed number is computed (AD-1).
//
// Story 4.6 (AC1/3/4): the heatmap is the canonical 2-D diagnostic GRID. Each
// populated cell is a selection control + `#<diagnosticId>` scroll target
// (`id={e.id}`); the grid uses a roving tabIndex (one Tab stop) with arrow-key
// cell navigation (←→ within a row, ↑↓ across rows, clamped, skipping empty
// cells), Enter/Space opens the focused cell in the context rail, and Esc keeps
// focus on the active grid cell (return-to-grid). Announced <th scope> headers
// are preserved (WCAG 2.2 AA).

type ResidualElement = DiagnosticsBundle["residuals"][number];

// Diverging blue (negative) ↔ neutral ↔ amber (positive). Buckets are a display
// annotation of the STORED residual — not a computed datum.
function rampColor(r: number): { background: string; color?: string } {
  // A non-finite residual is never colour-ramped (it would otherwise fall
  // through to the strong-negative blue bucket and mis-signal); stay neutral and
  // let the value text inherit the theme foreground.
  if (!Number.isFinite(r)) return { background: "transparent" };
  // Dark value text on the light cell tints so the printed residual stays
  // legible in BOTH light and dark themes — the cell otherwise inherits the
  // theme foreground (near-white in dark mode) on a near-white tint = invisible
  // (WCAG 2.2 AA).
  const ink = "#1F2937";
  if (r >= 1.0) return { background: "#FDBA5B", color: "#7A3E00" };
  if (r >= 0.5) return { background: "#FDE8C8", color: ink };
  if (r >= 0.15) return { background: "#FEF3E2", color: ink };
  if (r > -0.15) return { background: "#F9FAFB", color: ink };
  if (r > -0.35) return { background: "#EFF6FF", color: ink };
  return { background: "#DBEAFE", color: ink };
}

function devLabel(e: ResidualElement): string {
  return `${e.fromDev}→${e.toDev}`;
}

export function ResidualHeatmap({
  elements,
}: {
  elements: DiagnosticsBundle["residuals"];
}) {
  const { selectedId, select } = useDiagnosticSelection();

  // Derive axes by collecting distinct labels in first-seen order (string
  // bucketing, not arithmetic — AD-1).
  const origins: string[] = [];
  const devs: string[] = [];
  const byCell = new Map<string, ResidualElement>();
  for (const e of elements) {
    if (!origins.includes(e.origin)) origins.push(e.origin);
    const d = devLabel(e);
    if (!devs.includes(d)) devs.push(d);
    byCell.set(`${e.origin}|${d}`, e);
  }

  const cellAt = (r: number, c: number): ResidualElement | undefined =>
    byCell.get(`${origins[r]}|${devs[c]}`);

  // Roving-tabIndex active cell: the first populated cell row-major by default.
  const firstPopulated = (): { r: number; c: number } => {
    for (let r = 0; r < origins.length; r++) {
      for (let c = 0; c < devs.length; c++) {
        if (cellAt(r, c)) return { r, c };
      }
    }
    return { r: 0, c: 0 };
  };
  const [active, setActive] = useState(firstPopulated);
  const cellRefs = useRef(new Map<string, HTMLTableCellElement>());

  const focusCell = (r: number, c: number) => {
    setActive({ r, c });
    cellRefs.current.get(`${r}:${c}`)?.focus();
  };

  // Move to the nearest populated cell in a direction; stay put if none.
  const move = (r: number, c: number, dr: number, dc: number) => {
    let nr = r + dr;
    let nc = c + dc;
    while (nr >= 0 && nr < origins.length && nc >= 0 && nc < devs.length) {
      if (cellAt(nr, nc)) {
        focusCell(nr, nc);
        return;
      }
      nr += dr;
      nc += dc;
    }
  };

  const onCellKeyDown = (
    e: React.KeyboardEvent<HTMLTableCellElement>,
    r: number,
    c: number,
  ) => {
    switch (e.key) {
      case "ArrowRight":
        e.preventDefault();
        move(r, c, 0, 1);
        break;
      case "ArrowLeft":
        e.preventDefault();
        move(r, c, 0, -1);
        break;
      case "ArrowDown":
        e.preventDefault();
        move(r, c, 1, 0);
        break;
      case "ArrowUp":
        e.preventDefault();
        move(r, c, -1, 0);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        select(cellAt(r, c)!.id);
        break;
      case "Escape":
        // Return-to-grid: keep keyboard focus on the active grid cell.
        e.preventDefault();
        cellRefs.current.get(`${r}:${c}`)?.focus();
        break;
    }
  };

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-semibold">Residual heatmap</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Blue ↔ amber; value printed in each cell.
      </p>
      {elements.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No residual data for this Run.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="border-collapse text-sm">
            <caption className="sr-only">
              Standardized residuals by origin period (rows) and development
              transition (columns); each cell prints its residual value. Use
              arrow keys to move between cells and Enter to open a cell in the
              context rail.
            </caption>
            <thead>
              <tr>
                <th
                  scope="col"
                  className="border border-border p-cell-pad text-left font-medium text-muted-foreground"
                >
                  Origin
                </th>
                {devs.map((d) => (
                  <th
                    key={d}
                    scope="col"
                    className="numeric border border-border p-cell-pad text-right font-medium text-muted-foreground"
                  >
                    {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {origins.map((origin, r) => (
                <tr key={origin}>
                  <th
                    scope="row"
                    className="numeric border border-border p-cell-pad text-left font-medium text-muted-foreground"
                  >
                    {origin}
                  </th>
                  {devs.map((d, c) => {
                    const el = cellAt(r, c);
                    if (!el) {
                      // Empty cell: kept in the a11y tree (NOT aria-hidden) so
                      // it still occupies its column and the <th scope> row/col
                      // association stays intact; an sr-only label announces it.
                      return (
                        <td
                          key={d}
                          className="border border-border p-cell-pad"
                        >
                          <span className="sr-only">No residual</span>
                        </td>
                      );
                    }
                    const { background, color } = rampColor(el.residual);
                    const isActive = active.r === r && active.c === c;
                    const isSelected = selectedId === el.id;
                    return (
                      <td
                        key={d}
                        id={el.id}
                        ref={(node) => {
                          if (node) cellRefs.current.set(`${r}:${c}`, node);
                          else cellRefs.current.delete(`${r}:${c}`);
                        }}
                        tabIndex={isActive ? 0 : -1}
                        aria-current={isSelected ? "true" : undefined}
                        title={el.id}
                        aria-label={`Origin ${origin}, ${d}, residual ${formatResidual(el.residual)}, ${el.id}`}
                        onClick={() => {
                          setActive({ r, c });
                          select(el.id);
                        }}
                        onKeyDown={(e) => onCellKeyDown(e, r, c)}
                        style={{ background, color }}
                        className={cn(
                          "numeric cursor-pointer border border-border p-cell-pad text-right tabular-nums",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset",
                          isSelected && "ring-2 ring-primary ring-inset",
                        )}
                      >
                        {formatResidual(el.residual)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
