// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// next/link needs no router for a plain anchor render — stub it to a bare <a>.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import {
  StepRail,
  deriveStepStates,
  type RunStatus,
} from "@/components/StepRail";
import type { Id } from "@/convex/_generated/dataModel";

afterEach(cleanup);

const triangleId = "t1" as Id<"triangles">;

describe("deriveStepStates (pure, AC1)", () => {
  it("Upload/Triangle complete, Run current, forward steps disabled with tooltips", () => {
    const steps = deriveStepStates({
      runStatus: "running",
      hasDiagnostics: false,
    });
    const byKey = Object.fromEntries(steps.map((s) => [s.key, s]));

    expect(byKey.upload.state).toBe("complete");
    expect(byKey.triangle.state).toBe("complete");
    expect(byKey.run.state).toBe("current");
    expect(byKey.diagnostics.state).toBe("disabled");
    expect(byKey.diagnostics.tooltip).toBe("Run completes to unlock Diagnostics");
    expect(byKey.report.state).toBe("disabled");
    expect(byKey.published.state).toBe("disabled");
  });

  it("Diagnostics unlocks only when complete AND a bundle is stored", () => {
    for (const [status, hasDiagnostics, expected] of [
      ["complete", true, "complete"],
      ["complete", false, "disabled"],
      ["running", true, "disabled"],
      ["failed", true, "disabled"],
    ] as [RunStatus, boolean, string][]) {
      const steps = deriveStepStates({ runStatus: status, hasDiagnostics });
      const diag = steps.find((s) => s.key === "diagnostics");
      expect(diag?.state, `${status}/${hasDiagnostics}`).toBe(expected);
    }
  });
});

describe("StepRail render (AC1)", () => {
  it("marks Run as aria-current step, checkmarks completed steps, disables forward steps", () => {
    const { container } = render(
      <StepRail runStatus="running" hasDiagnostics={false} triangleId={triangleId} />,
    );

    // Run is the current step.
    const current = container.querySelector('[aria-current="step"]');
    expect(current?.textContent).toContain("Run");

    // Completed steps jump back to their surfaces.
    expect(
      screen.getByText("Upload").closest("a")?.getAttribute("href"),
    ).toBe("/triangles");
    expect(
      screen.getByText("Triangle").closest("a")?.getAttribute("href"),
    ).toBe(`/triangles/${triangleId}`);

    // A disabled forward step carries its prerequisite tooltip + aria-disabled.
    const report = screen.getByText("Report").closest("span");
    expect(report?.getAttribute("aria-disabled")).toBe("true");
    expect(report?.getAttribute("title")).toBe(
      "Available after diagnostics review",
    );

    // The rail is a labelled navigation region.
    expect(
      container.querySelector('nav[aria-label="Run progress"]'),
    ).not.toBeNull();
  });

  it("a complete run with diagnostics makes Diagnostics an actionable button", () => {
    const onSelectDiagnostics = vi.fn();
    render(
      <StepRail
        runStatus="complete"
        hasDiagnostics
        triangleId={triangleId}
        onSelectDiagnostics={onSelectDiagnostics}
      />,
    );
    const diag = screen.getByText("Diagnostics").closest("button");
    expect(diag).not.toBeNull();
    diag?.click();
    expect(onSelectDiagnostics).toHaveBeenCalledTimes(1);
  });
});
