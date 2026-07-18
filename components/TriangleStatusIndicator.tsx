import { cn } from "@/lib/utils";

// Triangle statuses are deliberately NOT part of the fixed StatusBadge
// vocabulary (UX-DR3, closed to Runs + Reserve Reports). This is a small,
// local indicator owned by the triangles UI. The set widens per story (3.3
// adds the accepted `validated`). `pending_validation` uses the caution family
// (amber = "awaiting a step"); `validation_failed` uses the destructive family
// (a hard failure — the source must be fixed and re-uploaded).
export type TriangleStatus = "pending_validation" | "validation_failed";

const statusLabels: Record<TriangleStatus, string> = {
  pending_validation: "Pending validation",
  validation_failed: "Validation failed",
};

const statusClasses: Record<TriangleStatus, string> = {
  pending_validation: "bg-caution-subtle text-caution",
  validation_failed: "bg-destructive/10 text-destructive",
};

export function TriangleStatusIndicator({
  status,
}: {
  status: TriangleStatus;
}) {
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center rounded-full px-2 py-0.5 text-xs font-medium",
        statusClasses[status],
      )}
    >
      {statusLabels[status]}
    </span>
  );
}
