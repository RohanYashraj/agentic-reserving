import { cn } from "@/lib/utils";

// Triangle statuses are deliberately NOT part of the fixed StatusBadge
// vocabulary (UX-DR3, closed to Runs + Reserve Reports). This is a small,
// local indicator owned by the triangles UI. `pending_validation` uses the
// caution family (amber = "awaiting a step"); `validation_failed` uses the
// destructive family (a hard failure — fix the source and re-upload);
// `validated` (Story 3.3, an accepted + immutable Triangle) uses the published
// family (green = a positive terminal state). The stored status literal is
// `validated`, but we show "Accepted" — the word the acceptance flow uses.
export type TriangleStatus =
  | "pending_validation"
  | "validation_failed"
  | "validated";

const statusLabels: Record<TriangleStatus, string> = {
  pending_validation: "Pending validation",
  validation_failed: "Validation failed",
  validated: "Accepted",
};

const statusClasses: Record<TriangleStatus, string> = {
  pending_validation: "bg-caution-subtle text-caution",
  validation_failed: "bg-destructive/10 text-destructive",
  validated: "bg-published/10 text-published",
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
