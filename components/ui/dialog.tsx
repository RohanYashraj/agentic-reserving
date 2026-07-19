"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

// shadcn/Radix Dialog (Story 6.2, D6) — the shared AUDIT-CONFIRMATION primitive
// for UX-DR14's explicit "restate what will be recorded" dialogs (submit here;
// override 6.3; approve/publish 6.4 reuse it). The unified `radix-ui` package
// already ships Dialog — the SAME idiom `components/ui/tooltip.tsx` +
// `popover.tsx` use — so this adds ZERO new dependency. Radix gives a
// focus-trap, `Esc`-to-dismiss, initial-focus control (onOpenAutoFocus), and
// `aria-modal` for free; never hand-roll modal behaviour.
//
// Presentational / reusable only — no submit-specific copy lives here (that is
// the approval bar's dialog instance, ReportApprovalBar). Styled with existing
// tokens (bg-background/border-border/text-foreground), never hard-coded hex
// (DESIGN.md); overlays get a subtle shadow, never elevation-as-hierarchy.

function Dialog(props: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger(
  props: React.ComponentProps<typeof DialogPrimitive.Trigger>,
) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogClose(
  props: React.ComponentProps<typeof DialogPrimitive.Close>,
) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        data-slot="dialog-overlay"
        className="fixed inset-0 z-50 bg-black/40"
      />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        // Radix defaults give the focus-trap + aria-modal; onEscapeKeyDown /
        // overlay click both close (verified in tests/dialog.test.tsx).
        className={cn(
          "fixed left-1/2 top-1/2 z-50 grid w-full max-w-md -translate-x-1/2 -translate-y-1/2 gap-4",
          "rounded-md border border-border bg-background p-6 text-foreground shadow-md outline-none",
          "max-h-[calc(100vh-2rem)] overflow-y-auto",
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("space-y-1.5", className)}
      {...props}
    />
  );
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    />
  );
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-sm font-medium text-foreground", className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
};
