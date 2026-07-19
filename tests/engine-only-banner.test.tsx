// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Story 5.6 (AC-2, AC-4, D4): the global Engine-Only Mode banner. The mode value
// is a mutable module-level variable the mocked useQuery reads, so re-rendering
// with a new value simulates the reactive subscription flipping.
let modeValue:
  | { engineOnly: boolean; since: number | null; reason: string | null }
  | undefined = { engineOnly: false, since: null, reason: null };

const probeMock = vi.fn().mockResolvedValue({ engineOnly: false });

vi.mock("convex/react", () => ({
  useQuery: () => modeValue,
  useAction: () => probeMock,
}));
vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ orgId: "org_A" }),
}));

import { EngineOnlyBanner } from "@/components/EngineOnlyBanner";

afterEach(() => {
  cleanup();
  modeValue = { engineOnly: false, since: null, reason: null };
  probeMock.mockClear();
});

const COPY = "Engine-Only Mode — interpretation unavailable";

describe("EngineOnlyBanner (Story 5.6, AC-2/AC-4)", () => {
  it("renders nothing when engineOnly is false", () => {
    modeValue = { engineOnly: false, since: null, reason: null };
    const { container } = render(<EngineOnlyBanner />);
    expect(container.textContent).toBe("");
  });

  it("engineOnly true → exact copy, what-still-works, Retry, no dismiss, aria-live assertive", () => {
    modeValue = { engineOnly: true, since: 1, reason: "model_unavailable" };
    const { container } = render(<EngineOnlyBanner />);

    expect(screen.getByText(COPY)).toBeDefined();
    expect(screen.getByRole("button", { name: /what still works/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /^Retry$/i })).toBeDefined();
    // Non-dismissable: no close/dismiss control.
    expect(screen.queryByRole("button", { name: /dismiss|close/i })).toBeNull();
    // The assertive announcement region is present (asserted by DOM attribute).
    expect(container.querySelector('[aria-live="assertive"]')).not.toBeNull();
  });

  it("'what still works' toggles the factual disclosure", () => {
    modeValue = { engineOnly: true, since: 1, reason: "model_unavailable" };
    render(<EngineOnlyBanner />);
    expect(screen.queryByText(/Upload, Runs, and Diagnostics remain/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /what still works/i }));
    expect(screen.getByText(/Upload, Runs, and Diagnostics remain/i)).toBeDefined();
  });

  it("Retry runs the recovery probe", () => {
    modeValue = { engineOnly: true, since: 1, reason: "model_unavailable" };
    render(<EngineOnlyBanner />);
    fireEvent.click(screen.getByRole("button", { name: /^Retry$/i }));
    expect(probeMock).toHaveBeenCalledWith({ workspaceId: "org_A" });
  });

  it("false→true edge fires the entry toast ONCE; a second true→true does not re-fire", () => {
    modeValue = { engineOnly: false, since: null, reason: null };
    const { rerender } = render(<EngineOnlyBanner />);
    // Mount observation is not an edge — no toast.
    expect(screen.queryByRole("status")).toBeNull();

    // false → true: entry toast appears.
    modeValue = { engineOnly: true, since: 1, reason: "model_unavailable" };
    rerender(<EngineOnlyBanner />);
    expect(screen.getByText(/temporarily unavailable/i)).toBeDefined();
    expect(screen.getAllByRole("status")).toHaveLength(1);

    // true → true: no new edge — still exactly one toast (the same entry one).
    modeValue = { engineOnly: true, since: 1, reason: "model_unavailable" };
    rerender(<EngineOnlyBanner />);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByText(/temporarily unavailable/i)).toBeDefined();
  });

  it("true→false edge fires the exit toast and unmounts the banner", () => {
    modeValue = { engineOnly: true, since: 1, reason: "model_unavailable" };
    const { rerender } = render(<EngineOnlyBanner />);
    expect(screen.getByText(COPY)).toBeDefined();

    modeValue = { engineOnly: false, since: null, reason: null };
    rerender(<EngineOnlyBanner />);
    // The banner strip is gone…
    expect(screen.queryByText(COPY)).toBeNull();
    // …and the exit toast announces the restore.
    expect(screen.getByText(/Interpretation restored\./i)).toBeDefined();
  });
});
