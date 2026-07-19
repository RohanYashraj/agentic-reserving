import workflow from "@convex-dev/workflow/convex.config.js";
import { defineApp } from "convex/server";

// Durable Run orchestration (AD-7, Story 4.2). The @convex-dev/workflow
// component (which pulls in @convex-dev/workpool for retries/parallelism)
// backs runs.runWorkflow — the only durable orchestration in the app. Its
// generated handle is `components.workflow`, instantiated once in
// convex/workflow.ts.
const app = defineApp();
app.use(workflow);
export default app;
