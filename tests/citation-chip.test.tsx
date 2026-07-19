// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CitationChip } from "@/components/interpretation/CitationChip";
import type { DiagnosticsBundle } from "@/convex/lib/engineContract";

afterEach(cleanup);
// The chip navigates by setting window.location.hash — reset between cases.
afterEach(() => {
  window.location.hash = "";
});

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

describe("CitationChip (Story 5.5, AC2, UX-DR2)", () => {
  const bundle = makeDiagnosticsBundle();
  const dxId = bundle.ave[0].id; // read from the fixture, not hard-coded

  it("renders the canonical dx: id in provenance-violet numeric styling", () => {
    render(<CitationChip dxId={dxId} diagnosticsBundle={bundle} />);
    const chip = screen.getByRole("link");
    expect(chip.textContent).toBe(dxId);
    expect(chip.className).toContain("numeric");
    expect(chip.className).toContain("bg-provenance-subtle");
    expect(chip.className).toContain("text-provenance");
  });

  it("is announced as a link with a context-bearing aria-label", () => {
    render(<CitationChip dxId={dxId} diagnosticsBundle={bundle} />);
    const chip = screen.getByRole("link");
    expect(chip.getAttribute("aria-label")).toBe(
      "Citation, diagnostic Actual vs expected, 2019",
    );
  });

  it("click navigates: sets window.location.hash to the raw dx: id", () => {
    render(<CitationChip dxId={dxId} diagnosticsBundle={bundle} />);
    fireEvent.click(screen.getByRole("link"));
    expect(window.location.hash).toBe(`#${dxId}`);
  });

  it("Enter navigates (hash set)", () => {
    render(<CitationChip dxId={dxId} diagnosticsBundle={bundle} />);
    fireEvent.keyDown(screen.getByRole("link"), { key: "Enter" });
    expect(window.location.hash).toBe(`#${dxId}`);
  });

  it("Space previews without navigating (hash unchanged, preview shown)", () => {
    render(<CitationChip dxId={dxId} diagnosticsBundle={bundle} />);
    fireEvent.keyDown(screen.getByRole("link"), { key: " " });
    expect(window.location.hash).toBe("");
    const tip = screen.getByRole("tooltip");
    expect(tip.textContent).toContain("A/E 2019");
  });

  it("hover shows the preview of the cited value", () => {
    render(<CitationChip dxId={dxId} diagnosticsBundle={bundle} />);
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.mouseEnter(screen.getByRole("link"));
    expect(screen.getByRole("tooltip").textContent).toContain("A/E 2019");
    fireEvent.mouseLeave(screen.getByRole("link"));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("focus shows the preview of the cited value", () => {
    render(<CitationChip dxId={dxId} diagnosticsBundle={bundle} />);
    fireEvent.focus(screen.getByRole("link"));
    expect(screen.getByRole("tooltip").textContent).toContain("A/E 2019");
  });
});
