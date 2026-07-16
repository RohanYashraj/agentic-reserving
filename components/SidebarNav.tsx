"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

// Sidebar entries per UX-DR17. Active route in the primary family — teal is
// the working color for active nav (DESIGN.md Colors).
const navItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/triangles", label: "Triangles" },
  { href: "/audit-log", label: "Audit Log" },
];

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-1 px-2">
      {navItems.map((item) => {
        const isActive =
          pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "rounded-md px-2 py-1.5 text-sm",
              isActive
                ? "bg-primary/10 font-medium text-primary"
                : "hover:bg-muted",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
