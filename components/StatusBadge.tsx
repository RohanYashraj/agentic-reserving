import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// UX-DR3: fixed status vocabulary for Runs and Reserve Reports. Color family
// is always paired with the label text — never color alone — and consumers
// pass only a status: this component owns all styling, never restyle locally.
export type Status =
  | "draft"
  | "running"
  | "complete"
  | "failed"
  | "awaiting review"
  | "published"
  | "engine-only";

// DESIGN.md badge spec: draft muted, running primary + pulsing dot, failed
// destructive, published published-green (the only green), engine-only
// caution. `complete` mirrors the step rail's primary completed treatment;
// `awaiting review` is caution — amber = "needs your judgment".
const statusClasses: Record<Status, string> = {
  draft: "bg-muted text-muted-foreground",
  running: "bg-primary/10 text-primary",
  complete: "bg-primary/10 text-primary",
  failed: "bg-destructive/10 text-destructive",
  "awaiting review": "bg-caution-subtle text-caution",
  published: "bg-published-subtle text-published",
  "engine-only": "bg-caution-subtle text-caution",
};

export function StatusBadge({ status }: { status: Status }) {
  return (
    <Badge
      variant="secondary"
      className={cn("rounded-full", statusClasses[status])}
    >
      {status === "running" && (
        <span
          aria-hidden="true"
          className="size-1.5 shrink-0 rounded-full bg-primary animate-pulse"
        />
      )}
      {status}
    </Badge>
  );
}
