import { describe, expect, it } from "vitest";
import { buildEnv } from "../src/core/launcher.js";
import { CloneRecord } from "../src/types.js";

const clone: CloneRecord = {
  id: "id",
  name: "demo",
  rootPath: "/tmp/demo-project",
  runtimePath: "/tmp/demo-project/.codex-mirror/runtime",
  runtimeEntryPath: "/tmp/demo-project/.codex-mirror/runtime/bin/codex",
  runtimeKind: "binary",
  wrapperPath: "/tmp/bin/demo",
  codexVersionPinned: "0.1.0",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("buildEnv", () => {
  it("sets clone-isolated home and xdg paths", () => {
    const env = buildEnv(clone);
    expect(env.HOME).toBe("/tmp/demo-project/.codex-mirror/home");
    expect(env.XDG_CONFIG_HOME).toBe("/tmp/demo-project/.codex-mirror/home/.config");
    expect(env.XDG_DATA_HOME).toBe("/tmp/demo-project/.codex-mirror/home/.local/share");
    expect(env.XDG_CACHE_HOME).toBe("/tmp/demo-project/.codex-mirror/home/.cache");
  });
});
