import { mkdtemp, rm } from "node:fs/promises";
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
