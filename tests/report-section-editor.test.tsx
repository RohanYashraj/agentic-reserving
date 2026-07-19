// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReportSectionEditor } from "@/components/report/ReportSectionEditor";
import type { DiagnosticsBundle } from "@/convex/lib/engineContract";

afterEach(cleanup);
// CitationChip navigates by setting window.location.hash — reset between cases.
afterEach(() => {
  window.location.hash = "";
});

function makeDiagnosticsBundle(): DiagnosticsBundle {
  const ave = (origin: string) => ({
    id: `dx:r1:ave:${origin}`,
    origin,
    fromDev: "12",
    toDev: "24",
    actual: 4213,
    expected: 4371,
    actualMinusExpected: -158,
    actualToExpectedRatio: 0.9639,
  });
  return {
    schemaVersion: "1.0.0",
    runId: "r1",
    triangleHash: "a".repeat(64),
    ldfStability: [],
    ave: [ave("2018"), ave("2019")],
    clBfDivergence: null,
    residuals: [],
  };
}

const BUNDLE = makeDiagnosticsBundle();
const ID_A = BUNDLE.ave[0].id; // dx:r1:ave:2018 — read from the fixture
const ID_B = BUNDLE.ave[1].id; // dx:r1:ave:2019

/** A controlled wrapper so onChange edits reflect back into the editor. */
function ControlledEditor({
  initial,
  editable = true,
  onChangeSpy = () => {},
  bundle = BUNDLE,
}: {
  initial: string;
  editable?: boolean;
  onChangeSpy?: (t: string) => void;
  bundle?: DiagnosticsBundle | null;
}) {
  const [text, setText] = useState(initial);
  return (
    <ReportSectionEditor
      label="Executive summary"
      text={text}
      diagnosticsBundle={bundle}
      editable={editable}
      onChange={(t) => {
        onChangeSpy(t);
        setText(t);
      }}
    />
  );
}

const TWO_CHIPS = `The reserve is 5,339,085 [[cite:${ID_A}]]. Development is stable [[cite:${ID_B}]].`;

describe("ReportSectionEditor (Story 6.1, AC-1, UX-DR12)", () => {
  it("renders one atomic CitationChip per marker, inline between text runs", () => {
    render(<ControlledEditor initial={TWO_CHIPS} />);
    const chips = screen.getAllByRole("link");
    expect(chips).toHaveLength(2);
    expect(chips[0].textContent).toBe(ID_A);
    expect(chips[1].textContent).toBe(ID_B);
  });

  it("a chip is an atomic widget — not editable text inside an input", () => {
    render(<ControlledEditor initial={TWO_CHIPS} />);
    // The chips are role=link buttons, never inside a textarea.
    expect(screen.getAllByRole("link")).toHaveLength(2);
    // No editable text surface carries a raw marker (chips are widgets, D1).
    const textareas = screen.getAllByRole("textbox") as HTMLTextAreaElement[];
    for (const ta of textareas) {
      expect(ta.value).not.toContain("[[cite:");
    }
  });

  it("the × control deletes the chip; onChange emits the serialized text minus that marker", () => {
    const onChangeSpy = vi.fn();
    render(<ControlledEditor initial={TWO_CHIPS} onChangeSpy={onChangeSpy} />);
    const removes = screen.getAllByRole("button", { name: /^Remove citation/ });
    expect(removes).toHaveLength(2);

    fireEvent.click(removes[0]); // remove ID_A
    const emitted = onChangeSpy.mock.calls.at(-1)?.[0] as string;
    expect(emitted).not.toContain(`[[cite:${ID_A}]]`);
    expect(emitted).toContain(`[[cite:${ID_B}]]`);
    // The other chip remains after the controlled re-render.
    const chips = screen.getAllByRole("link");
    expect(chips).toHaveLength(1);
    expect(chips[0].textContent).toBe(ID_B);
  });

  it("after removing a chip the now-uncited sentence shows the 'claim now uncited' flag", () => {
    render(<ControlledEditor initial={TWO_CHIPS} />);
    // Initially no uncited flag (both figures are cited).
    expect(screen.queryByText(/Claim now uncited/i)).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: /^Remove citation/ })[0]);
    // The first sentence ("The reserve is 5,339,085 .") now has a figure but no
    // marker → flagged.
    expect(screen.getByText(/Claim now uncited/i)).toBeTruthy();
  });

  it("editing a text run preserves the neighbouring chips (both markers survive)", () => {
    const onChangeSpy = vi.fn();
    render(<ControlledEditor initial={TWO_CHIPS} onChangeSpy={onChangeSpy} />);
    const firstRun = screen.getAllByRole("textbox")[0] as HTMLTextAreaElement;
    fireEvent.change(firstRun, { target: { value: "Updated wording " } });
    const emitted = onChangeSpy.mock.calls.at(-1)?.[0] as string;
    expect(emitted).toContain("Updated wording");
    expect(emitted).toContain(`[[cite:${ID_A}]]`);
    expect(emitted).toContain(`[[cite:${ID_B}]]`);
  });

  it("in editable={false} the × controls are absent and chips render read-only", () => {
    render(<ControlledEditor initial={TWO_CHIPS} editable={false} />);
    expect(
      screen.queryAllByRole("button", { name: /^Remove citation/ }),
    ).toHaveLength(0);
    // No editable text surfaces.
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    // Chips still present and navigable.
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });

  it("an empty section renders one editable text surface (manual template shell)", () => {
    render(<ControlledEditor initial="" />);
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});
