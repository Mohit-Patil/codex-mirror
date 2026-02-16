import { describe, expect, it } from "vitest";
import { assertValidCloneName, sanitizeCloneName, validateCloneName } from "../src/core/clone-name.js";

describe("clone-name", () => {
  it("accepts safe names", () => {
    expect(assertValidCloneName("work-1")).toBe("work-1");
    expect(assertValidCloneName("team.alpha")).toBe("team.alpha");
  });

  it("rejects traversal and separators", () => {
    expect(validateCloneName("../evil").ok).toBe(false);
    expect(validateCloneName("a/b").ok).toBe(false);
    expect(validateCloneName("a\\b").ok).toBe(false);
    expect(() => assertValidCloneName("..")).toThrow();
  });

  it("sanitizes arbitrary input to a safe fallback", () => {
    expect(sanitizeCloneName("  ../my clone  ")).toBe("my-clone");
    expect(sanitizeCloneName("$$$")).toBe("clone");
  });
});
