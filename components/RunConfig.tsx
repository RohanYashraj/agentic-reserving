"use client";

import { ConvexError } from "convex/values";
import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { useState, type ClipboardEvent } from "react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { Method } from "@/convex/lib/engineContract";
import { METHOD_OPTIONS } from "@/components/methods";
import {
  isMultiColumnPaste,
  parseNumberCell,
  splitPastedColumn,
  splitPastedRows,
} from "@/components/runConfigPaste";

// Story 4.1 (AC1): Run configuration. Method selection + a two-column BF
// a-priori grid (loss ratio + premium per Origin Period, pasteable). Gated
// Start creates a `queued` run (createRun mutation). Flow surface (max-w-4xl).
// No arithmetic here (AD-1) — loss ratios/premiums are user inputs; the engine
// does the loss_ratio × exposure math.

type AcceptedTriangle = {
  kind: "paid" | "incurred";
  origin_periods: string[];
  development_periods: string[];
  cells: (number | null)[][];
};

function errorMessage(error: unknown): string {
  return error instanceof ConvexError &&
    typeof (error.data as { message?: unknown })?.message === "string"
    ? (error.data as { message: string }).message
    : "Something went wrong. Please try again.";
}

/** Loss ratio: finite ≥ 0. Premium: finite > 0. Mirrors the server gate. */
function lossRatioValid(raw: string): boolean {
  const n = parseNumberCell(raw);
  return n !== null && n >= 0;
}
function premiumValid(raw: string): boolean {
  const n = parseNumberCell(raw);
  return n !== null && n > 0;
}

export function RunConfig({
  workspaceId,
  triangleId,
  triangle,
}: {
  workspaceId: string;
  triangleId: Id<"triangles">;
  triangle: AcceptedTriangle;
}) {
  const createRun = useMutation(api.runs.createRun);
  const router = useRouter();
  const origins = triangle.origin_periods;

  const [selected, setSelected] = useState<Record<Method, boolean>>({
    chain_ladder: true,
    bornhuetter_ferguson: false,
    mack: false,
  });
  const [lossRatios, setLossRatios] = useState<string[]>(() =>
    origins.map(() => ""),
  );
  const [premiums, setPremiums] = useState<string[]>(() =>
    origins.map(() => ""),
  );

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const methods = METHOD_OPTIONS.filter((m) => selected[m.value]).map(
    (m) => m.value,
  );
  const bfSelected = selected.bornhuetter_ferguson;

  // Gating computed during render (no set-state-in-effect).
  const everyOriginComplete = origins.every(
    (_, i) => lossRatioValid(lossRatios[i]) && premiumValid(premiums[i]),
  );
  const canStart =
    !pending && methods.length >= 1 && (!bfSelected || everyOriginComplete);

  function toggleMethod(value: Method) {
    setSelected((prev) => ({ ...prev, [value]: !prev[value] }));
    setError(null);
  }

  function setColumnCell(
    column: "lr" | "premium",
    index: number,
    value: string,
  ) {
    const setter = column === "lr" ? setLossRatios : setPremiums;
    setter((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
    setError(null);
  }

  /** Paste a column (or a two-column block) starting at `rowIndex`. */
  function handlePaste(
    column: "lr" | "premium",
    rowIndex: number,
    event: ClipboardEvent<HTMLInputElement>,
  ) {
    const text = event.clipboardData.getData("text");
    if (text === "") {
      return;
    }
    event.preventDefault();

    if (isMultiColumnPaste(text)) {
      // A two-column spreadsheet block → fill loss ratio + premium together,
      // regardless of which input received the paste.
      const rows = splitPastedRows(text);
      setLossRatios((prev) => {
        const next = [...prev];
        rows.forEach((row, r) => {
          const target = rowIndex + r;
          if (target < next.length && row[0] !== undefined) {
            const n = parseNumberCell(row[0]);
            next[target] = n === null ? "" : String(n);
          }
        });
        return next;
      });
      setPremiums((prev) => {
        const next = [...prev];
        rows.forEach((row, r) => {
          const target = rowIndex + r;
          if (target < next.length && row[1] !== undefined) {
            const n = parseNumberCell(row[1]);
            next[target] = n === null ? "" : String(n);
          }
        });
        return next;
      });
    } else {
      const values = splitPastedColumn(text);
      const setter = column === "lr" ? setLossRatios : setPremiums;
      setter((prev) => {
        const next = [...prev];
        values.forEach((n, r) => {
          const target = rowIndex + r;
          if (target < next.length) {
            next[target] = n === null ? "" : String(n);
          }
        });
        return next;
      });
    }
    setError(null);
  }

  async function start() {
    setPending(true);
    setError(null);
    try {
      const aprioriLossRatios = bfSelected
        ? origins.map((origin, i) => ({
            origin,
            lossRatio: Number(parseNumberCell(lossRatios[i])),
            exposure: Number(parseNumberCell(premiums[i])),
          }))
        : [];
      const result = await createRun({
        workspaceId,
        triangleId,
        parameters: { methods, aprioriLossRatios },
      });
      // 4.1 → 4.3 handoff: navigate to the live Run detail surface. Leave
      // `pending` true — we are navigating away and the detail page takes over
      // (do not re-enable Start under the departing view).
      router.push(`/runs/${result.runId}`);
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6">
      <section>
        <h2 className="text-sm font-medium">Methods</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Select the methods to run against this Triangle.
        </p>
        <div className="mt-3 space-y-2">
          {METHOD_OPTIONS.map((m) => (
            <label key={m.value} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selected[m.value]}
                onChange={() => toggleMethod(m.value)}
              />
              {m.label}
            </label>
          ))}
        </div>
      </section>

      {bfSelected && (
        <section aria-label="Bornhuetter-Ferguson a priori inputs">
          <h2 className="text-sm font-medium">A priori inputs</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Bornhuetter-Ferguson needs a loss ratio and a premium for every
            Origin Period. Paste a column from your spreadsheet.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1 pr-4 font-medium">Origin Period</th>
                  <th className="py-1 pr-4 font-medium">Loss ratio</th>
                  <th className="py-1 font-medium">Premium</th>
                </tr>
              </thead>
              <tbody>
                {origins.map((origin, i) => (
                  <tr key={origin}>
                    <td className="py-1 pr-4 numeric">{origin}</td>
                    <td className="py-1 pr-4">
                      <input
                        type="text"
                        inputMode="decimal"
                        aria-label={`Loss ratio for ${origin}`}
                        value={lossRatios[i]}
                        onChange={(e) => setColumnCell("lr", i, e.target.value)}
                        onPaste={(e) => handlePaste("lr", i, e)}
                        className={`numeric w-28 rounded-md border bg-background px-2 py-1 ${
                          lossRatios[i] !== "" && !lossRatioValid(lossRatios[i])
                            ? "border-destructive"
                            : "border-border"
                        }`}
                      />
                    </td>
                    <td className="py-1">
                      <input
                        type="text"
                        inputMode="decimal"
                        aria-label={`Premium for ${origin}`}
                        value={premiums[i]}
                        onChange={(e) =>
                          setColumnCell("premium", i, e.target.value)
                        }
                        onPaste={(e) => handlePaste("premium", i, e)}
                        className={`numeric w-36 rounded-md border bg-background px-2 py-1 ${
                          premiums[i] !== "" && !premiumValid(premiums[i])
                            ? "border-destructive"
                            : "border-border"
                        }`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {error && (
        <p
          className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
          aria-live="polite"
        >
          {error}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <button
          type="button"
          disabled={!canStart}
          onClick={() => void start()}
          aria-live="polite"
          className="w-fit rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {pending ? "Queuing run…" : "Start run"}
        </button>
        {!canStart && !pending && (
          <p className="text-xs text-muted-foreground">
            {methods.length < 1
              ? "Select at least one method."
              : "Enter a loss ratio and premium for every Origin Period."}
          </p>
        )}
      </div>
    </div>
  );
}
