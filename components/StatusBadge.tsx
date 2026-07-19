import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// UX-DR3: fixed status vocabulary for Runs and Reserve Reports. Color family
// is always paired with the label text — never color alone — and consumers
// pass only a status: this component owns all styling, never restyle locally.
// `queued` is the pre-`running` Run status (the `runs` table's status union is
// queued|running|complete|failed): a Run that createRun has written but
// orchestration has not yet picked up. It renders muted + pulsing (in-flight,
// awaiting the engine) rather than being mapped to `running` (a queued Run has
// not started) — keeping this component the single styling authority (Story 4.3).
export type Status =
  | "draft"
  | "queued"
  | "running"
  | "complete"
  | "failed"
  | "awaiting review"
  | "published"
  | "engine-only";

// DESIGN.md badge spec: draft muted, running primary + pulsing dot, failed
// destructive, published published-green (the only green), engine-only
// caution. `complete` mirrors the step rail's primary completed treatment;
// `awaiting review` is caution — amber = "needs your judgment". `queued` is a
// muted pre-run treatment with the same pulsing dot as running (it is in-flight,
// awaiting orchestration).
const statusClasses: Record<Status, string> = {
  draft: "bg-muted text-muted-foreground",
  queued: "bg-muted text-muted-foreground",
  running: "bg-primary/10 text-primary",
  complete: "bg-primary/10 text-primary",
  failed: "bg-destructive/10 text-destructive",
  "awaiting review": "bg-caution-subtle text-caution",
  published: "bg-published-subtle text-published",
  "engine-only": "bg-caution-subtle text-caution",
};

// The in-flight statuses that carry a pulsing dot; each pairs with a dot color
// drawn from its own family so the dot never reads as a different status.
const pulsingDot: Partial<Record<Status, string>> = {
  queued: "bg-muted-foreground",
  running: "bg-primary",
};

export function StatusBadge({ status }: { status: Status }) {
  const dotColor = pulsingDot[status];
  return (
    <Badge
      variant="secondary"
      className={cn("rounded-full", statusClasses[status])}
    >
      {dotColor && (
        <span
          aria-hidden="true"
          className={cn("size-1.5 shrink-0 rounded-full animate-pulse", dotColor)}
        />
      )}
      {status}
    </Badge>
  );
}
