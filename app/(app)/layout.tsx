import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { ReactNode } from "react";

import { SidebarNav } from "@/components/SidebarNav";

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
        <p className="text-sm text-muted-foreground">
          Choose a Workspace to continue, or sign out from the avatar menu.
        </p>
        <OrganizationSwitcher hidePersonal />
        <UserButton />
      </main>
    );
  }

  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 flex-col border-r border-border">
        <div className="px-4 py-4 text-sm font-semibold">
          Reserving Copilot
        </div>
        <SidebarNav />
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-border px-6 py-3">
          <OrganizationSwitcher hidePersonal />
          <UserButton />
        </header>
        <main className="flex-1 px-6 py-6">{children}</main>
      </div>
    </div>
  );
}
