import { describe, expect, it } from "vitest";
import { sanitizeTerminalOutput, sanitizeTerminalValue } from "../src/utils/terminal.js";

describe("sanitizeTerminalOutput", () => {
  it("removes ANSI control sequences", () => {
    const raw = "name:\u001b[31mbad\u001b[0m link:\u001b]8;;https://example.com\u0007go\u001b]8;;\u0007";
    expect(sanitizeTerminalOutput(raw)).toBe("name:bad link:go");
  });

  it("escapes remaining control characters", () => {
    const raw = "line1\nline2\tbell:\u0007";
    expect(sanitizeTerminalOutput(raw)).toBe("line1\\nline2\\tbell:\\x07");
  });
});

describe("sanitizeTerminalValue", () => {
  it("handles non-string input values", () => {
    expect(sanitizeTerminalValue(42)).toBe("42");
    expect(sanitizeTerminalValue(new Error("bad\u001b[2K"))).toContain("Error: bad");
  });
});
