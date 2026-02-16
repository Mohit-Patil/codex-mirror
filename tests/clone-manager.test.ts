import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloneManager, deriveClonePaths } from "../src/core/clone-manager.js";
import { RegistryStore } from "../src/core/registry.js";
import { WrapperManager } from "../src/core/wrapper-manager.js";
import { exists } from "../src/utils/fs.js";

const { runtimeVersionQueue, installRuntimeMock } = vi.hoisted(() => {
  const versions: string[] = [];
  const runtimeMock = vi.fn(async (runtimeDir: string) => {
    const entryPath = join(runtimeDir, "bin", "codex");
    await mkdir(dirname(entryPath), { recursive: true });
    await writeFile(entryPath, "#!/usr/bin/env bash\necho codex\n", "utf8");

    return {
      kind: "binary" as const,
      entryPath,
      sourcePath: "/tmp/mock-codex",
      version: versions.shift() ?? "0.0.0",
      sourceCodexPath: "/usr/local/bin/codex",
    };
  });
  return { runtimeVersionQueue: versions, installRuntimeMock: runtimeMock };
});

vi.mock("../src/core/runtime-cloner.js", () => ({
  installRuntime: installRuntimeMock,
}));

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

beforeEach(() => {
  runtimeVersionQueue.length = 0;
  installRuntimeMock.mockClear();
});

describe("CloneManager transactional behavior", () => {
  it("rolls back create when wrapper installation fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-mirror-clone-manager-"));
    tempDirs.push(root);

    const registry = new RegistryStore(join(root, "registry.json"));
    const wrappers = new FakeWrapperManager(join(root, "bin"));
    wrappers.failNextInstall = true;

    runtimeVersionQueue.push("1.0.0");
    const manager = new CloneManager(registry, wrappers as unknown as WrapperManager);
    const rootPath = join(root, "clones", "alpha");

    await expect(manager.createClone({ name: "alpha", rootPath })).rejects.toThrow("Failed to create clone");
    expect(await registry.findByName("alpha")).toBeUndefined();
    expect(await exists(deriveClonePaths(rootPath).cloneBaseDir)).toBe(false);
  });

  it("restores registry entry when remove fails after registry deletion", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-mirror-clone-manager-"));
    tempDirs.push(root);

    const registry = new RegistryStore(join(root, "registry.json"));
    const wrappers = new FakeWrapperManager(join(root, "bin"));
    const manager = new CloneManager(registry, wrappers as unknown as WrapperManager);

    runtimeVersionQueue.push("1.0.0");
    await manager.createClone({ name: "alpha", rootPath: join(root, "clones", "alpha") });

    wrappers.failRemove = true;
    await expect(manager.removeClone("alpha")).rejects.toThrow("Failed to remove clone");
    expect(await registry.findByName("alpha")).toBeDefined();
  });

  it("rolls back update metadata and registry when wrapper update fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-mirror-clone-manager-"));
    tempDirs.push(root);

    const registry = new RegistryStore(join(root, "registry.json"));
    const wrappers = new FakeWrapperManager(join(root, "bin"));
    const manager = new CloneManager(registry, wrappers as unknown as WrapperManager);

    runtimeVersionQueue.push("1.0.0");
    const clone = await manager.createClone({ name: "alpha", rootPath: join(root, "clones", "alpha") });

    runtimeVersionQueue.push("2.0.0");
    wrappers.failNextInstall = true;
    await expect(manager.updateClone("alpha")).rejects.toThrow("Failed to update clone");

    const stillStored = await registry.findByName("alpha");
    expect(stillStored?.codexVersionPinned).toBe("1.0.0");

    const metadataRaw = await readFile(deriveClonePaths(clone.rootPath).metadataPath, "utf8");
    expect(metadataRaw).toContain("\"codexVersionPinned\": \"1.0.0\"");
  });
});

class FakeWrapperManager {
  public failNextInstall = false;
  public failRemove = false;

  constructor(private readonly binDir: string) {}

  getPathForClone(name: string): string {
    return join(this.binDir, name);
  }

  async installWrapper(clone: { name: string }): Promise<string> {
    if (this.failNextInstall) {
      this.failNextInstall = false;
      throw new Error("wrapper install failed");
    }

    const wrapperPath = this.getPathForClone(clone.name);
    await mkdir(dirname(wrapperPath), { recursive: true });
    await writeFile(wrapperPath, "#!/usr/bin/env bash\nexit 0\n", "utf8");
    return wrapperPath;
  }

  async removeWrapper(name: string): Promise<void> {
    if (this.failRemove) {
      throw new Error("wrapper remove failed");
    }
    await rm(this.getPathForClone(name), { force: true });
  }
}
