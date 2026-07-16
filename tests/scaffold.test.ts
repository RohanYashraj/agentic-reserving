import { describe, expect, it } from "vitest";
import schema from "../convex/schema";

describe("scaffold", () => {
  it("loads the Convex schema", () => {
    expect(schema).toBeDefined();
  });
});
