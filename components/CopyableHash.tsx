"use client";

import { useState } from "react";

// A truncated, click-to-copy hash (Story 4.4, extracted from the Triangle
// detail page's HashRow). Used by the Triangle detail page and the provenance
// popover so there is one copy-to-clipboard implementation. The full hash is
// copied; the label + short form are shown. `numeric` (Geist Mono) — a hash is
// engine-derived evidence.

export function CopyableHash({ label, hash }: { label?: string; hash: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    // clipboard is unavailable in insecure contexts and can reject on
    // permission-deny — never let the promise reject unhandled.
    try {
      await navigator.clipboard.writeText(hash);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* no-op: copy unsupported/denied; the hash is still visible to select */
    }
  }
  return (
    <div className="flex flex-col gap-0.5">
      {label && <span className="text-xs text-muted-foreground">{label}</span>}
      <button
        type="button"
        onClick={() => void copy()}
        title="Copy full hash"
        className="numeric w-fit text-left text-sm text-foreground hover:text-primary"
      >
        {copied ? "Copied" : `${hash.slice(0, 16)}…`}
      </button>
    </div>
  );
}
