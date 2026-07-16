import { createRouteMatcher } from "@clerk/nextjs/server";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import proxy, { config, publicRoutes } from "../proxy";

const isPublic = createRouteMatcher(publicRoutes);
const req = (path: string) => new NextRequest(`http://localhost:3000${path}`);

// AC 1 regression guard until the Playwright smoke (Story 7.4): the public
// set must stay exactly `/` and `/sign-in(.*)` — everything else is
// protected by clerkMiddleware via auth.protect().
describe("proxy.ts (Next.js 16 middleware)", () => {
  it("default-exports the Clerk middleware", () => {
    expect(typeof proxy).toBe("function");
  });

  it("public routes are exactly / and /sign-in(.*)", () => {
    expect(publicRoutes).toEqual(["/", "/sign-in(.*)"]);
  });

  it("matcher skips static assets and always covers api/trpc", () => {
    expect(config.matcher).toHaveLength(2);
    expect(config.matcher[1]).toBe("/(api|trpc)(.*)");
    expect(config.matcher[0]).toContain("_next");
  });

  it.each(["/", "/sign-in", "/sign-in/factor-one", "/sign-in/sso-callback"])(
    "public matcher admits %s",
    (path) => {
      expect(isPublic(req(path))).toBe(true);
    },
  );

  it.each([
    "/dashboard",
    "/triangles",
    "/audit-log",
    "/api/anything",
    "/sign-up",
  ])("public matcher protects %s", (path) => {
    expect(isPublic(req(path))).toBe(false);
  });
});
