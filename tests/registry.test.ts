import { lstat, mkdtemp, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RegistryStore } from "../src/core/registry.js";
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

describe("RegistryStore", () => {
  it("upserts and removes clones", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-mirror-registry-"));
    tempDirs.push(root);

    const store = new RegistryStore(join(root, "registry.json"));
    const clone = sampleClone("work", root);

    await store.upsert(clone);
    const listed = await store.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.name).toBe("work");

    const removed = await store.removeByName("work");
    expect(removed?.name).toBe("work");

    const afterRemove = await store.list();
    expect(afterRemove).toHaveLength(0);
  });

  it("replaces existing clone on upsert", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-mirror-registry-"));
    tempDirs.push(root);

    const store = new RegistryStore(join(root, "registry.json"));
    await store.upsert(sampleClone("work", root));

    const updated = sampleClone("work", root);
    updated.codexVersionPinned = "9.9.9";
    await store.upsert(updated);

    const listed = await store.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.codexVersionPinned).toBe("9.9.9");
  });

  it("preserves all writes under concurrent upserts", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-mirror-registry-"));
    tempDirs.push(root);

    const store = new RegistryStore(join(root, "registry.json"));
    await Promise.all(
      Array.from({ length: 40 }, async (_, index) => {
        await store.upsert(sampleClone(`clone-${index}`, root));
      }),
    );

    const listed = await store.list();
    expect(listed).toHaveLength(40);
    expect(new Set(listed.map((item) => item.name)).size).toBe(40);
  });

  it("reclaims stale regular lock files before acquiring lock", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-mirror-registry-"));
    tempDirs.push(root);

    const registryPath = join(root, "registry.json");
    const lockPath = `${registryPath}.lock`;
    await writeFile(lockPath, "1234\n0\n", "utf8");
    const staleTime = new Date(Date.now() - 5_000);
    await utimes(lockPath, staleTime, staleTime);

    const store = new RegistryStore(registryPath, 40, 5);
    await store.upsert(sampleClone("stale-lock", root));

    const listed = await store.list();
    expect(listed.map((item) => item.name)).toContain("stale-lock");
    await expect(lstat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not unlink symlink lock paths while waiting", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-mirror-registry-"));
    tempDirs.push(root);

    const registryPath = join(root, "registry.json");
    const lockPath = `${registryPath}.lock`;
    const lockTarget = join(root, "foreign-lock");
    await writeFile(lockTarget, "foreign\n", "utf8");
    await symlink(lockTarget, lockPath);

    const store = new RegistryStore(registryPath, 15, 5);
    await expect(store.upsert(sampleClone("blocked", root))).rejects.toThrow();

    const lockDetails = await lstat(lockPath);
    expect(lockDetails.isSymbolicLink()).toBe(true);
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
    codexVersionPinned: "1.0.0",
    createdAt: now,
    updatedAt: now,
  };
}
