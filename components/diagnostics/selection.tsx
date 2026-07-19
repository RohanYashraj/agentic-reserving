"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

// Story 4.6 (AC1/2/5): the single source of truth for "which Diagnostic is
// selected". A dependency-free React context so the four heterogeneous panels
// (AvE rows, LDF small-multiples, divergence bars, heat cells) and the context
// rail all read/write the same `selectedId` without prop-drilling an
// onSelect/selectedId pair through every panel and compact encoding. Selection
// is pure UI state — it adds no data and touches no figure (AD-1).

export type DiagnosticSelection = {
  /** The stored `element.id` (`dx:{runId}:{kind}:{key}`) currently selected, or null. */
  selectedId: string | null;
  /** Select an element by its Diagnostic ID (idempotent — reselecting keeps it). */
  select: (id: string) => void;
  /** Clear the selection (e.g. dismissing the md bottom sheet). */
  clear: () => void;
};

const DiagnosticSelectionContext = createContext<DiagnosticSelection | null>(
  null,
);

export function DiagnosticSelectionProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Stable identities (setState is stable) so a consumer that lists `select`/
  // `clear` in an effect's deps — the deep-link driver in DiagnosticsPanels —
  // does NOT re-fire on every selection change. Without this the effect would
  // re-select the hash target on each click, trapping selection on the
  // deep-linked element and defeating Clear.
  const select = useCallback((id: string) => setSelectedId(id), []);
  const clear = useCallback(() => setSelectedId(null), []);
  const value = useMemo<DiagnosticSelection>(
    () => ({ selectedId, select, clear }),
    [selectedId, select, clear],
  );
  return (
    <DiagnosticSelectionContext.Provider value={value}>
      {children}
    </DiagnosticSelectionContext.Provider>
  );
}

/**
 * Read the diagnostic selection. Guarded: using it outside the provider is a
 * programming error (every selectable element and the rail render inside
 * `DiagnosticsPanels`, which owns the provider) — fail loud rather than
 * silently no-op.
 */
export function useDiagnosticSelection(): DiagnosticSelection {
  const ctx = useContext(DiagnosticSelectionContext);
  if (ctx === null) {
    throw new Error(
      "useDiagnosticSelection must be used within a DiagnosticSelectionProvider",
    );
  }
  return ctx;
}
