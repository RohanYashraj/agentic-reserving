// Clerk ↔ Convex identity bridge (AD-4). CLERK_JWT_ISSUER_DOMAIN is a
// Convex deployment env var (set via dashboard or `npx convex env set`),
// not a .env.local entry. applicationID must match the Clerk JWT template
// name, which is `convex`.
const issuerDomain = process.env.CLERK_JWT_ISSUER_DOMAIN;
if (!issuerDomain) {
  throw new Error(
    "CLERK_JWT_ISSUER_DOMAIN is not set on this Convex deployment — run: npx convex env set CLERK_JWT_ISSUER_DOMAIN https://<your-app>.clerk.accounts.dev",
  );
}

const authConfig = {
  providers: [
    {
      domain: issuerDomain,
      applicationID: "convex",
    },
  ],
};

export default authConfig;
