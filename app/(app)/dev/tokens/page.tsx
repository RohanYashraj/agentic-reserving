"use client";

import { useState } from "react";

import { StatusBadge, type Status } from "@/components/StatusBadge";
import { cn } from "@/lib/utils";

// Brand-layer review surface (Story 1.3 AC 3): every DESIGN.md token and
// StatusBadge state, reviewable in light and dark. Dev-facing only.

const swatches: { name: string; className: string; light: string; dark: string }[] = [
  { name: "primary", className: "bg-primary", light: "#0E5E59", dark: "#4FB3AB" },
  { name: "primary-foreground", className: "bg-primary-foreground", light: "#FFFFFF", dark: "#06201E" },
  { name: "provenance", className: "bg-provenance", light: "#5B4B9E", dark: "#A493E0" },
  { name: "provenance-foreground", className: "bg-provenance-foreground", light: "#FFFFFF", dark: "#171130" },
  { name: "provenance-subtle", className: "bg-provenance-subtle", light: "#EEEBF7", dark: "#262040" },
  { name: "caution", className: "bg-caution", light: "#B45309", dark: "#F5A94E" },
  { name: "caution-subtle", className: "bg-caution-subtle", light: "#FEF3E2", dark: "#3A2A12" },
  { name: "published", className: "bg-published", light: "#166534", dark: "#6EC98A" },
  { name: "published-subtle", className: "bg-published-subtle", light: "#E8F5EC", dark: "#12301C" },
];

const radii = [
  { name: "rounded-sm", className: "rounded-sm", px: "4px" },
  { name: "rounded-md", className: "rounded-md", px: "6px" },
  { name: "rounded-lg", className: "rounded-lg", px: "8px" },
];

const statuses: Status[] = [
  "draft",
  "running",
  "complete",
  "failed",
  "awaiting review",
  "published",
  "engine-only",
];

export default function TokensPage() {
  const [dark, setDark] = useState(false);

  // Scope `.dark` to this page's own wrapper — the `@custom-variant dark`
  // selector flips every descendant token here without leaking the class onto
  // <html> (which would darken the whole app until reload). Dev-only surface.
  return (
    <div
      className={cn(
        "mx-auto flex max-w-4xl flex-col gap-10 rounded-lg bg-background p-6 text-foreground",
        dark && "dark",
      )}
    >
      <header className="flex items-center justify-between">
        <h1 className="display">Design tokens</h1>
        <button
          type="button"
          onClick={() => setDark((d) => !d)}
          className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted"
        >
          {dark ? "Light" : "Dark"} mode
        </button>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">
          Colors — brand families (DESIGN.md)
        </h2>
        <div className="grid grid-cols-3 gap-3">
          {swatches.map((s) => (
            <div key={s.name} className="flex flex-col gap-1">
              <div className={`h-14 rounded-md border border-border ${s.className}`} />
              <div className="text-xs font-medium">{s.name}</div>
              <div className="numeric text-muted-foreground">
                {dark ? s.dark : s.light}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">
          Radius — 4 / 6 / 8px
        </h2>
        <div className="flex gap-6">
          {radii.map((r) => (
            <div key={r.name} className="flex flex-col items-center gap-1">
              <div className={`h-16 w-24 border-2 border-primary ${r.className}`} />
              <div className="text-xs">
                {r.name} · <span className="numeric">{r.px}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">
          Type roles
        </h2>
        <div className="flex flex-col gap-4">
          <div>
            <div className="text-xs text-muted-foreground">display — Geist Sans 600 · 28px</div>
            <div className="display">Motor 2026Q2 reserve review</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">numeric — Geist Mono 450 · 13px</div>
            <div className="numeric flex w-40 flex-col text-right">
              <span>1.4936</span>
              <span>1.0778</span>
              <span>1.0102</span>
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">numeric-lg — Geist Mono 500 · 16px</div>
            <div className="numeric-lg">18,834,329</div>
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-muted-foreground">
          StatusBadge — fixed vocabulary (UX-DR3)
        </h2>
        <div className="flex flex-wrap gap-3">
          {statuses.map((status) => (
            <StatusBadge key={status} status={status} />
          ))}
        </div>
      </section>
    </div>
  );
}
