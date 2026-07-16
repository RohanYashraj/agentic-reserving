import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// convex-test (used from Story 1.4 onward) needs an edge-runtime test
// environment for convex/** specs; add a vitest project for that when the
// first Convex function test lands.
//
// Component specs opt into jsdom per file via `// @vitest-environment jsdom`;
// everything else stays in the default node environment.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": new URL(".", import.meta.url).pathname,
    },
  },
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
