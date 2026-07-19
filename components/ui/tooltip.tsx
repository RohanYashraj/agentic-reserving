"use client";

import * as React from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

// shadcn/Radix Tooltip (Story 5.6). Backs the disabled Interpretation-action
// tooltip (EXPERIENCE.md:92 "visible-but-disabled … knowing the step exists is
// part of understanding the workflow"). The unified `radix-ui` package already
// ships Tooltip — the SAME idiom `components/ui/popover.tsx` uses — so this adds
// ZERO new dependency (D7). Radix gives focus/hover open, Esc dismissal, and
// collision-aware positioning for free; never hand-roll tooltip behaviour.
//
// A disabled <button> swallows pointer events, so the trigger is wrapped in a
// focusable <span tabIndex={0}> at the call site (the Radix pattern for a
// disabled trigger) so the tooltip still opens on hover/focus.

function TooltipProvider({
  delayDuration = 200,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  );
}

function Tooltip(props: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger(
  props: React.ComponentProps<typeof TooltipPrimitive.Trigger>,
) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          // Repo overlay convention (popover.tsx): bordered, popover surface,
          // subtle shadow, z-50 (shadows on overlays only — DESIGN.md).
          "z-50 max-w-xs rounded-md border border-border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-md outline-none",
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
