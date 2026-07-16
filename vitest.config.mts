import { defineConfig } from "vitest/config";

// convex-test (used from Story 1.4 onward) needs an edge-runtime test
// environment for convex/** specs; add a vitest project for that when the
// first Convex function test lands.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
