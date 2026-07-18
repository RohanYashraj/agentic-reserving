import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Two test projects:
// - "unit": app/component specs. Component specs opt into jsdom per file via
//   `// @vitest-environment jsdom`; everything else stays in node.
// - "convex": convex-test specs, which require the edge-runtime environment
//   and convex-test inlined so its dynamic module loading works.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": new URL(".", import.meta.url).pathname,
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["tests/**/*.test.{ts,tsx}"],
        },
      },
      {
        extends: true,
        test: {
          name: "convex",
          include: ["convex/**/*.test.ts"],
          environment: "edge-runtime",
          // auth.config.ts fail-fasts on this env var at import time; the
          // enumeration test imports every convex module, so stub it here.
          env: {
            CLERK_JWT_ISSUER_DOMAIN: "https://stub.clerk.accounts.dev",
          },
          server: {
            deps: {
              // convex-test inlined so its dynamic module loading works. The
              // workflow/workpool component test helpers (@convex-dev/*/test)
              // use import.meta.glob over their own src, so they must be
              // inlined too or vite externalizes them and registration breaks
              // (Story 4.2 — durable Run orchestration).
              inline: [
                "convex-test",
                "@convex-dev/workflow",
                "@convex-dev/workpool",
              ],
            },
          },
        },
      },
    ],
  },
});
