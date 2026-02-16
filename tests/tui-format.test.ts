import { describe, expect, it } from "vitest";
import { shortenPathForDisplay } from "../src/tui/index.js";

describe("shortenPathForDisplay", () => {
  it("keeps short strings untouched", () => {
    expect(shortenPathForDisplay("/tmp/x", 20)).toBe("/tmp/x");
  });

  it("shortens long paths to include tail", () => {
    const value = "/Users/me/projects/very/long/path/with/many/segments/final-dir";
    const out = shortenPathForDisplay(value, 24);
    expect(out.length).toBeLessThanOrEqual(24);
    expect(out).toContain("final-dir");
  });
});
