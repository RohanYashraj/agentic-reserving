// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

afterEach(cleanup);

// Story 6.2 (Task 8.4): the shared audit-dialog primitive (D6). Radix gives the
// focus-trap, aria-modal, and Esc dismissal for free — assert the contract we
// rely on (6.3/6.4 reuse this).

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button">Open</button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirm</DialogTitle>
          <DialogDescription>Restated copy.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <button type="button">Cancel</button>
          <button type="button">Proceed</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

describe("Dialog primitive (Story 6.2, D6)", () => {
  it("opens on trigger and renders a modal dialog (role=dialog + overlay) with the title/description", () => {
    const { container } = render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    // role="dialog" is Radix's modal-content role; the overlay backs the modal.
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(
      document.querySelector('[data-slot="dialog-overlay"]'),
    ).not.toBeNull();
    void container;
    expect(screen.getByText("Confirm")).toBeTruthy();
    expect(screen.getByText("Restated copy.")).toBeTruthy();
  });

  it("Esc dismisses the dialog", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.queryByRole("dialog")).not.toBeNull();
    fireEvent.keyDown(screen.getByRole("dialog"), {
      key: "Escape",
      code: "Escape",
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
