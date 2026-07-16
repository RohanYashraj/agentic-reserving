import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ReactNode } from "react";

// Sidebar entries per UX-DR17. Plain Tailwind only — shadcn/brand tokens
// land in Story 1.3.
const navItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/triangles", label: "Triangles" },
  { href: "/audit-log", label: "Audit Log" },
];

export default async function AppLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const { userId, orgId } = await auth();

  // Defense-in-depth: proxy.ts already protects this group, but the shell
  // must never render for an anonymous request even if middleware is
  // bypassed (matcher edit, framework bug).
  if (!userId) redirect("/sign-in");

  // Membership is required in this Clerk app, but a fresh user may not have
  // an active Workspace selected yet — offer the switcher, not a broken shell.
  if (!orgId) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4">
        <h1 className="text-lg font-semibold">Select a Workspace</h1>
        <p className="text-sm text-gray-600">
          Choose a Workspace to continue, or sign out from the avatar menu.
        </p>
        <OrganizationSwitcher hidePersonal />
        <UserButton />
      </main>
    );
  }

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 flex-col border-r border-gray-200">
        <div className="px-4 py-4 text-sm font-semibold">
          Reserving Copilot
        </div>
        <nav className="flex flex-col gap-1 px-2">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded px-2 py-1.5 text-sm hover:bg-gray-100"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-gray-200 px-6 py-3">
          <OrganizationSwitcher hidePersonal />
          <UserButton />
        </header>
        <main className="flex-1 px-6 py-6">{children}</main>
      </div>
    </div>
  );
}
