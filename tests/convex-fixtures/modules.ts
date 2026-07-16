/// <reference types="vite/client" />

// Module map for convexTest(fixtureSchema, fixtureModules). Glob keys are
// relative to this file, so function references resolve as "fixtures:name".
// convex-test locates the modules root by finding a "_generated" key, so a
// stub entry (never loaded) anchors the root at "./".
export const fixtureModules = {
  ...import.meta.glob(["./**/*.ts", "!./modules.ts"]),
  "./_generated/server.ts": async () => ({}),
};

// Eager variant for introspection (the auth-guard enumeration self-check).
export const fixtureModulesEager: Record<string, Record<string, unknown>> =
  import.meta.glob(["./**/*.ts", "!./modules.ts"], { eager: true });
