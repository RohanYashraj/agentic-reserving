import { describe, expect, test } from "vitest";

import {
  CITE_MARKER_RE,
  citationsFromText,
  markersAreWellFormed,
  parseCitationText,
  serializeCitationNodes,
  uncitedSentences,
  type SectionNode,
} from "@/convex/lib/citationMarker";

// Build ids from a fixture (never pin a platform value) — the marker grammar is
// the frontend contract for inline chips (the gate emits `[[cite:<dxId>]]`, its
// inner text the full `dx:{runId}:{kind}:{key}` id — AD-10, resolvable, opaque).
const RUN = "run-x";
const ID_A = `dx:${RUN}:ldf_stability:k1`;
const ID_B = `dx:${RUN}:ave:k2`;
const ID_RES = `dx:${RUN}:residual:2019:12`; // a residual id carries extra `:` segments
const mk = (id: string) => `[[cite:${id}]]`;

describe("parseCitationText", () => {
  test("splits alternating text / cite nodes in document order", () => {
    const text = `foo ${mk(ID_A)} bar ${mk(ID_B)}`;
    expect(parseCitationText(text)).toEqual<SectionNode[]>([
      { kind: "text", value: "foo " },
      { kind: "cite", dxId: ID_A },
      { kind: "text", value: " bar " },
      { kind: "cite", dxId: ID_B },
    ]);
  });

  test("adjacent markers produce no empty text node between them", () => {
    const text = `${mk(ID_A)}${mk(ID_B)}`;
    expect(parseCitationText(text)).toEqual<SectionNode[]>([
      { kind: "cite", dxId: ID_A },
      { kind: "cite", dxId: ID_B },
    ]);
  });

  test("a residual id with extra colon segments is captured whole (never split)", () => {
    expect(parseCitationText(mk(ID_RES))).toEqual<SectionNode[]>([
      { kind: "cite", dxId: ID_RES },
    ]);
  });

  test("plain text with no markers is a single text node", () => {
    expect(parseCitationText("just prose")).toEqual<SectionNode[]>([
      { kind: "text", value: "just prose" },
    ]);
  });

  test("empty string parses to no nodes", () => {
    expect(parseCitationText("")).toEqual<SectionNode[]>([]);
  });
});

describe("serializeCitationNodes / round-trips", () => {
  test("serialize inverts parse (text round-trips through nodes)", () => {
    const texts = [
      "",
      "just prose",
      `foo ${mk(ID_A)} bar ${mk(ID_B)}`,
      `${mk(ID_A)}${mk(ID_B)}`,
      `${mk(ID_A)} leading chip`,
      `trailing chip ${mk(ID_B)}`,
    ];
    for (const t of texts) {
      expect(serializeCitationNodes(parseCitationText(t))).toBe(t);
    }
  });

  test("parse ∘ serialize round-trips a normalized node array", () => {
    const nodes: SectionNode[] = [
      { kind: "text", value: "foo " },
      { kind: "cite", dxId: ID_A },
      { kind: "text", value: " bar" },
    ];
    expect(parseCitationText(serializeCitationNodes(nodes))).toEqual(nodes);
  });
});

describe("citationsFromText", () => {
  test("returns the ordered dxIds from every marker", () => {
    const text = `foo ${mk(ID_A)} bar ${mk(ID_B)}`;
    expect(citationsFromText(text)).toEqual([ID_A, ID_B]);
  });

  test("preserves duplicate ids in document order", () => {
    const text = `${mk(ID_A)} then again ${mk(ID_A)}`;
    expect(citationsFromText(text)).toEqual([ID_A, ID_A]);
  });

  test("no markers → empty list", () => {
    expect(citationsFromText("no citations here")).toEqual([]);
  });
});

describe("CITE_MARKER_RE", () => {
  test("is a global regex matching a marker and capturing the id", () => {
    expect(CITE_MARKER_RE.global).toBe(true);
    const re = new RegExp(CITE_MARKER_RE.source, CITE_MARKER_RE.flags);
    const m = re.exec(mk(ID_A));
    expect(m?.[1]).toBe(ID_A);
  });
});

describe("markersAreWellFormed", () => {
  test("ordinary prose (no opener) passes", () => {
    expect(markersAreWellFormed("just prose, no citations")).toBe(true);
  });

  test("well-formed markers (incl. a residual id) pass", () => {
    expect(markersAreWellFormed(`foo ${mk(ID_A)} ${mk(ID_RES)} bar`)).toBe(true);
  });

  test("an unterminated marker is rejected", () => {
    expect(markersAreWellFormed("foo [[cite:dx:run-x:ave:k2 bar")).toBe(false);
  });

  test("a non-dx marker id is rejected", () => {
    expect(markersAreWellFormed("foo [[cite:not-a-dx-id]] bar")).toBe(false);
  });

  test("an empty marker is rejected", () => {
    expect(markersAreWellFormed("foo [[cite:]] bar")).toBe(false);
  });
});

describe("uncitedSentences", () => {
  test("a sentence with a figure AND a marker is NOT flagged", () => {
    const text = `The reserve is 5,339,085 ${mk(ID_A)}.`;
    expect(uncitedSentences(text)).toEqual([]);
  });

  test("the SAME sentence after removing the marker IS flagged", () => {
    const text = `The reserve is 5,339,085.`;
    const flagged = uncitedSentences(text);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].sentence).toBe("The reserve is 5,339,085.");
    expect(text.slice(flagged[0].start, flagged[0].end)).toBe(flagged[0].sentence);
  });

  test("a purely qualitative sentence (no figure) is NOT flagged", () => {
    expect(uncitedSentences("Judgement was applied to the tail.")).toEqual([]);
  });

  test("a four-digit year is whitelisted (not a figure) — not flagged", () => {
    expect(uncitedSentences("The 2019 origin period developed slowly.")).toEqual(
      [],
    );
  });

  test("an ISO date is whitelisted — not flagged", () => {
    expect(uncitedSentences("Data as at 2026-07-19 was used.")).toEqual([]);
  });

  test("a heading/list ordinal at line start is whitelisted — not flagged", () => {
    expect(uncitedSentences("2. Method selection rationale follows.")).toEqual(
      [],
    );
  });

  test("flags only the uncited sentence among several", () => {
    const text = `Judgement applied. The reserve is 5,339,085. Cited now 4,371 ${mk(
      ID_B,
    )}.`;
    const flagged = uncitedSentences(text);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].sentence).toBe("The reserve is 5,339,085.");
  });

  test("a percentage figure is flagged when uncited", () => {
    const flagged = uncitedSentences("Development is 12.5% complete.");
    expect(flagged).toHaveLength(1);
  });
});
