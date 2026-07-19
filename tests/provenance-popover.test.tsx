// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { ProvenancePopover } from "@/components/ProvenancePopover";
import type { Id } from "@/convex/_generated/dataModel";
import type { ResultSet } from "@/convex/lib/engineContract";

// Radix Popover's positioning (floating-ui) needs a few browser APIs jsdom
// lacks. Polyfill them so the portalled content mounts.
beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

afterEach(cleanup);

const lineage: ResultSet["lineage"] = {
  engineVersion: "0.1.0",
  chainladderVersion: "0.9.2",
  triangleHash: "a".repeat(64),
  parameters: {
    methods: ["chain_ladder", "bornhuetter_ferguson"],
    aprioriLossRatios: [{ origin: "2019", lossRatio: 0.9, exposure: 5000000 }],
  },
};

const runId = "r1" as Id<"runs">;

function renderFigure() {
  return render(
    <ProvenancePopover lineage={lineage} runId={runId} label="ultimate, origin 2019: 4,213,000">
      4,213,000
    </ProvenancePopover>,
  );
}

describe("ProvenancePopover (AC2, UX-DR15)", () => {
  it("the trigger is a labelled, keyboard-reachable button", () => {
    renderFigure();
    const trigger = screen.getByRole("button", {
      name: /where did this come from\?/i,
    });
    expect(trigger).toBeDefined();
  });

  it("opens on click and shows the five Lineage items", () => {
    renderFigure();
    fireEvent.click(
      screen.getByRole("button", { name: /where did this come from\?/i }),
    );
    expect(screen.getByText("0.1.0")).toBeDefined(); // engine version
    expect(screen.getByText("0.9.2")).toBeDefined(); // chainladder version
    expect(screen.getByText("Triangle hash")).toBeDefined(); // copyable hash label
    expect(screen.getByTitle("Copy full hash")).toBeDefined(); // copyable hash button
    expect(screen.getByText(/Chain Ladder/)).toBeDefined(); // parameters (methods)
    expect(screen.getByText(/2019: 0.9/)).toBeDefined(); // a-priori loss ratio
    expect(screen.getByText(new RegExp(runId))).toBeDefined(); // audit-trail runId
  });

  it("opens on right-click (contextmenu) — the UX-DR15 gesture", () => {
    renderFigure();
    const trigger = screen.getByRole("button", {
      name: /where did this come from\?/i,
    });
    fireEvent.contextMenu(trigger);
    expect(screen.getByText("0.1.0")).toBeDefined();
  });

  it("Esc closes the popover", () => {
    renderFigure();
    fireEvent.click(
      screen.getByRole("button", { name: /where did this come from\?/i }),
    );
    expect(screen.getByText("0.1.0")).toBeDefined();
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    expect(screen.queryByText("0.1.0")).toBeNull();
  });
});
