import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Regression guard for the DESIGN.md brand layer (UX-DR1). Every value here
// is transcribed from _bmad-output/planning-artifacts/ux-designs/
// ux-agentic-reserving-2026-07-16/DESIGN.md — DESIGN.md wins on conflict.
const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

const lightBlock = css.match(/:root\s*\{[^}]*\}/)?.[0] ?? "";
const darkBlock = css.match(/\.dark\s*\{[^}]*\}/)?.[0] ?? "";

describe("brand color tokens (DESIGN.md)", () => {
  const light: Record<string, string> = {
    "--primary": "#0E5E59",
    "--primary-foreground": "#FFFFFF",
    "--provenance": "#5B4B9E",
    "--provenance-foreground": "#FFFFFF",
    "--provenance-subtle": "#EEEBF7",
    "--caution": "#B45309",
    "--caution-subtle": "#FEF3E2",
    "--published": "#166534",
    "--published-subtle": "#E8F5EC",
  };
  const dark: Record<string, string> = {
    "--primary": "#4FB3AB",
    "--primary-foreground": "#06201E",
    "--provenance": "#A493E0",
    "--provenance-foreground": "#171130",
    "--provenance-subtle": "#262040",
    "--caution": "#F5A94E",
    "--caution-subtle": "#3A2A12",
    "--published": "#6EC98A",
    "--published-subtle": "#12301C",
  };

  for (const [name, hex] of Object.entries(light)) {
    it(`light ${name} is ${hex}`, () => {
      expect(lightBlock).toContain(`${name}: ${hex}`);
    });
  }
  for (const [name, hex] of Object.entries(dark)) {
    it(`dark ${name} is ${hex}`, () => {
      expect(darkBlock).toContain(`${name}: ${hex}`);
    });
  }

  it("exposes brand families as Tailwind color utilities via @theme inline", () => {
    for (const family of [
      "provenance",
      "provenance-foreground",
      "provenance-subtle",
      "caution",
      "caution-subtle",
      "published",
      "published-subtle",
    ]) {
      expect(css).toContain(`--color-${family}: var(--${family})`);
    }
  });
});

describe("radius scale 4/6/8px (DESIGN.md rounded)", () => {
  it("bases the scale on --radius: 0.5rem (8px)", () => {
    expect(lightBlock).toContain("--radius: 0.5rem");
  });
  it("derives sm=4px, md=6px, lg=8px", () => {
    expect(css).toContain("--radius-sm: calc(var(--radius) - 4px)");
    expect(css).toContain("--radius-md: calc(var(--radius) - 2px)");
    expect(css).toContain("--radius-lg: var(--radius)");
  });
});

describe("type-role utilities (DESIGN.md typography)", () => {
  it("defines numeric (Geist Mono 13px / 450)", () => {
    const block = css.match(/@utility numeric\s*\{[^}]*\}/)?.[0] ?? "";
    expect(block).toContain("font-family: var(--font-mono)");
    expect(block).toContain("font-size: 13px");
    expect(block).toContain("font-weight: 450");
    expect(block).toContain("letter-spacing: 0");
  });
  it("defines numeric-lg (Geist Mono 16px / 500)", () => {
    const block = css.match(/@utility numeric-lg\s*\{[^}]*\}/)?.[0] ?? "";
    expect(block).toContain("font-family: var(--font-mono)");
    expect(block).toContain("font-size: 16px");
    expect(block).toContain("font-weight: 500");
  });
  it("defines display (Geist Sans 600 28px)", () => {
    const block = css.match(/@utility display\s*\{[^}]*\}/)?.[0] ?? "";
    expect(block).toContain("font-family: var(--font-sans)");
    expect(block).toContain("font-size: 28px");
    expect(block).toContain("font-weight: 600");
    expect(block).toContain("line-height: 1.2");
    expect(block).toContain("letter-spacing: -0.01em");
  });
});

describe("font pipeline", () => {
  it("maps --font-sans/--font-mono to the next/font Geist variables (no dead Arial stack)", () => {
    expect(css).toContain("--font-sans: var(--font-geist-sans)");
    expect(css).toContain("--font-mono: var(--font-geist-mono)");
    expect(css).not.toMatch(/Arial/);
  });
});

describe("dark mode strategy", () => {
  it("uses the .dark class custom variant, not prefers-color-scheme", () => {
    expect(css).toContain("@custom-variant dark");
    expect(css).not.toContain("prefers-color-scheme");
  });
});

describe("spacing", () => {
  it("defines the cell-pad token for triangle grids", () => {
    expect(css).toContain("--spacing-cell-pad: 6px");
  });
});
