import { describe, expect, it } from "vitest";
import { deriveClonePaths } from "../src/core/clone-manager.js";

describe("deriveClonePaths", () => {
  it("builds expected paths from root", () => {
    const paths = deriveClonePaths("/tmp/project-x");
    expect(paths.cloneBaseDir).toBe("/tmp/project-x/.codex-mirror");
    expect(paths.runtimeDir).toBe("/tmp/project-x/.codex-mirror/runtime");
    expect(paths.homeDir).toBe("/tmp/project-x/.codex-mirror/home");
    expect(paths.codexHomeDir).toBe("/tmp/project-x/.codex-mirror/home/.codex");
    expect(paths.metadataPath).toBe("/tmp/project-x/.codex-mirror/clone.json");
  });
});
