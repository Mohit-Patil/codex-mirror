import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deriveClonePaths } from "../src/core/clone-manager.js";
import { buildMiniMaxSecrets, readCloneSecrets, readCloneSecretsSync, writeCloneSecrets } from "../src/core/clone-secrets.js";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("clone secrets", () => {
  it("writes and reads secrets", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-mirror-secrets-"));
    tempDirs.push(root);
    const paths = deriveClonePaths(join(root, "clone"));

    await writeCloneSecrets(paths, { MINIMAX_API_KEY: "x-123" });
    const out = await readCloneSecrets(paths);
    expect(out.MINIMAX_API_KEY).toBe("x-123");
    const syncOut = readCloneSecretsSync(paths);
    expect(syncOut.MINIMAX_API_KEY).toBe("x-123");
  });

  it("removes secrets file when map is empty", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-mirror-secrets-"));
    tempDirs.push(root);
    const paths = deriveClonePaths(join(root, "clone"));

    await writeCloneSecrets(paths, { MINIMAX_API_KEY: "x-123" });
    await writeCloneSecrets(paths, {});
    const out = await readCloneSecrets(paths);
    expect(out.MINIMAX_API_KEY).toBeUndefined();
  });

  it("buildMiniMaxSecrets returns empty when key missing", () => {
    expect(buildMiniMaxSecrets(undefined)).toEqual({});
    expect(buildMiniMaxSecrets("   ")).toEqual({});
    expect(buildMiniMaxSecrets("abc")).toEqual({ MINIMAX_API_KEY: "abc" });
  });
});

