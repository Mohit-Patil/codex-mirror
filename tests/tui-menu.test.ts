import { describe, expect, it } from "vitest";
import { __menuTestUtils, promptMenu } from "../src/tui/menu.js";

describe("promptMenu fallback", () => {
  it("is defined for import sanity", () => {
    expect(typeof promptMenu).toBe("function");
  });

  it("parses arrow keys and partial escape sequences safely", () => {
    const parsed = __menuTestUtils.parseKeys("\u001b[A\u001b[B\r");
    expect(parsed.keys.map((item) => item.kind)).toEqual(["up", "down", "enter"]);
    expect(parsed.rest).toBe("");

    const partial = __menuTestUtils.parseKeys("\u001b[");
    expect(partial.keys).toHaveLength(0);
    expect(partial.rest).toBe("\u001b[");
  });
});
