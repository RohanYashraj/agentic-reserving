import { cn } from "@/lib/utils";

// Triangle statuses are deliberately NOT part of the fixed StatusBadge
// vocabulary (UX-DR3, closed to Runs + Reserve Reports). This is a small,
// local indicator owned by the triangles UI. Story 3.1 only ever produces
// `pending_validation`; 3.2/3.3 widen the Triangle status set and this map
// grows with them. `pending` uses the caution family — amber = "awaiting a
// step" — never the destructive family (reserved for rejected/failed).
export type TriangleStatus = "pending_validation";

const statusLabels: Record<TriangleStatus, string> = {
  pending_validation: "Pending validation",
};

const statusClasses: Record<TriangleStatus, string> = {
  pending_validation: "bg-caution-subtle text-caution",
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
