import { WorkflowManager } from "@convex-dev/workflow";
import { components } from "./_generated/api";

// The one WorkflowManager for the app (first use of @convex-dev/workflow in
// this repo — Story 4.2, AD-7). It backs runs.runWorkflow, the durable
// orchestration that drives a queued Run through engine_service /runs.
//
// retryActionsByDefault + a bounded exponential backoff give NFR-4's idempotent
// retries for the transient engine step (executeEngineRun): a network/5xx
// failure is retried, and because /runs is deterministic + stateless the retry
// recomputes byte-identically. Mutations (the status transitions) are
// exactly-once by Convex OCC, so no retry policy is needed there.
export const workflow = new WorkflowManager(components.workflow, {
  workpoolOptions: {
    retryActionsByDefault: true,
    defaultRetryBehavior: { maxAttempts: 4, initialBackoffMs: 500, base: 2 },
  },
});
