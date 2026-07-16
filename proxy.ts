import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Public surface is exactly the marketing root and the sign-in flow;
// every other route requires a Clerk session (FR-17). Exported for the
// Vitest regression guard in tests/proxy.test.ts.
export const publicRoutes = ["/", "/sign-in(.*)"];

const isPublicRoute = createRouteMatcher(publicRoutes);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) await auth.protect();
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
