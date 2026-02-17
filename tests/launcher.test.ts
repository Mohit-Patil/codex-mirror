import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildEnv, resolveLaunchArgs } from "../src/core/launcher.js";
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

  it("injects clone-local secrets into environment", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-mirror-launcher-"));
    const cloneRoot = join(root, "mini");
    await mkdir(join(cloneRoot, ".codex-mirror"), { recursive: true });
    await writeFile(join(cloneRoot, ".codex-mirror", "secrets.json"), '{"MINIMAX_API_KEY":"mini-key"}\n', "utf8");

    const env = buildEnv({
      ...clone,
      rootPath: cloneRoot,
    });
    expect(env.MINIMAX_API_KEY).toBe("mini-key");

    await rm(root, { recursive: true, force: true });
  });
});

describe("resolveLaunchArgs", () => {
  it("prepends default profile args for regular commands", () => {
    const out = resolveLaunchArgs(
      {
        ...clone,
        defaultCodexArgs: ["--profile", "minimax"],
      },
      ["--model", "o3"],
    );
    expect(out).toEqual(["--profile", "minimax", "--model", "o3"]);
  });

  it("injects default profile args after exec subcommand", () => {
    const out = resolveLaunchArgs(
      {
        ...clone,
        defaultCodexArgs: ["--profile", "m21"],
      },
      ["exec", "hello"],
    );
    expect(out).toEqual(["exec", "--profile", "m21", "hello"]);
  });

  it("keeps explicit profile args unchanged", () => {
    const out = resolveLaunchArgs(
      {
        ...clone,
        defaultCodexArgs: ["--profile", "minimax"],
      },
      ["--profile", "custom"],
    );
    expect(out).toEqual(["--profile", "custom"]);
  });

  it("does not prepend defaults for control commands", () => {
    const out = resolveLaunchArgs(
      {
        ...clone,
        defaultCodexArgs: ["--profile", "minimax"],
      },
      ["login", "status"],
    );
    expect(out).toEqual(["login", "status"]);
  });

  it("uses default clone args when none are provided", () => {
    const out = resolveLaunchArgs(
      {
        ...clone,
        defaultCodexArgs: ["--profile", "minimax"],
      },
      [],
    );
    expect(out).toEqual(["--profile", "minimax"]);
  });
});
