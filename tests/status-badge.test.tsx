// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatusBadge, type Status } from "@/components/StatusBadge";

// UX-DR3: fixed vocabulary, color family always paired with label text,
// running gets a pulsing dot, published is the published-green family.
const families: Record<Status, string> = {
  draft: "bg-muted",
  running: "bg-primary/10",
  complete: "bg-primary/10",
  failed: "bg-destructive/10",
  "awaiting review": "bg-caution-subtle",
  published: "bg-published-subtle",
  "engine-only": "bg-caution-subtle",
};

const statuses = Object.keys(families) as Status[];

describe("StatusBadge", () => {
  for (const status of statuses) {
    it(`renders "${status}" with its label text and ${families[status]} family`, () => {
      const { container } = render(<StatusBadge status={status} />);
      expect(screen.getByText(status)).toBeDefined();
      const badge = container.querySelector('[data-slot="badge"]');
      expect(badge?.className).toContain(families[status]);
    });
  }

  it("renders a pulsing dot for running, and for no other status", () => {
    for (const status of statuses) {
      const { container, unmount } = render(<StatusBadge status={status} />);
      const dot = container.querySelector(".animate-pulse");
      if (status === "running") {
        expect(dot, "running must show a pulsing dot").not.toBeNull();
        expect(
          dot?.getAttribute("aria-hidden"),
          "dot is decorative — label carries the meaning",
        ).toBe("true");
      } else {
        expect(dot, `${status} must not show a dot`).toBeNull();
      }
      unmount();
    }
  });

  it("is a pill (rounded-full), per DESIGN.md Shapes", () => {
    const { container } = render(<StatusBadge status="draft" />);
    const badge = container.querySelector('[data-slot="badge"]');
    expect(badge?.className).toContain("rounded-full");
  });
});
