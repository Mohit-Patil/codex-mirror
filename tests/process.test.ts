import { describe, expect, it } from "vitest";
import { findCommand, runCapture } from "../src/utils/process.js";

describe("process utils", () => {
  it("times out long-running capture commands", async () => {
    const result = await runCapture(
      process.execPath,
      ["-e", "setTimeout(() => {}, 1000)"],
      process.env,
      process.cwd(),
      25,
    );
    expect(result.timedOut).toBe(true);
  });

  it("finds executable command paths", () => {
    expect(findCommand("node")?.length).toBeGreaterThan(0);
  });
});
