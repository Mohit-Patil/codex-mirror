import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WrapperManager } from "../src/core/wrapper-manager.js";
import { CloneRecord } from "../src/types.js";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("WrapperManager", () => {
  it("writes wrapper with explicit runner command and args", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-mirror-wrapper-"));
    tempDirs.push(root);

    const manager = new WrapperManager(join(root, "bin"), {
      command: "/usr/local/bin/node",
      args: ["/repo/dist/cli.js"],
    });

    const clone = sampleClone("alpha", root);
    const wrapperPath = await manager.installWrapper(clone);
    const content = await readFile(wrapperPath, "utf8");

    expect(content).toContain("RUNNER_CMD='/usr/local/bin/node'");
    expect(content).toContain("RUNNER_ARGS=('/repo/dist/cli.js')");
    expect(content).toContain("run 'alpha' --");
  });

  it("rejects unsafe clone names for path traversal", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-mirror-wrapper-"));
    tempDirs.push(root);
    const manager = new WrapperManager(join(root, "bin"));

    expect(() => manager.getPathForClone("../evil")).toThrow("path separators");
    await expect(manager.removeWrapper("../evil")).rejects.toThrow("path separators");
  });
});

function sampleClone(name: string, root: string): CloneRecord {
  const now = new Date().toISOString();
  return {
    id: `${name}-id`,
    name,
    rootPath: join(root, name),
    runtimePath: join(root, name, "runtime"),
    runtimeEntryPath: join(root, name, "runtime", "bin", "codex"),
    runtimeKind: "binary",
    wrapperPath: join(root, "bin", name),
    codexVersionPinned: "0.101.0",
    createdAt: now,
    updatedAt: now,
  };
}
