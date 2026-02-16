import { randomUUID } from "node:crypto";
import { open, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { CloneRecord, Registry } from "../types.js";
import { ensureDir, exists, readJsonFile } from "../utils/fs.js";

const EMPTY_REGISTRY: Registry = {
  version: 1,
  clones: [],
};

export class RegistryStore {
  private readonly lockPath: string;
  private readonly staleLockMs: number;

  constructor(
    private readonly registryPath: string,
    private readonly lockTimeoutMs = 10_000,
    private readonly lockPollIntervalMs = 40,
  ) {
    this.lockPath = `${registryPath}.lock`;
    this.staleLockMs = this.lockTimeoutMs * 6;
  }

  async load(): Promise<Registry> {
    if (!(await exists(this.registryPath))) {
      return structuredClone(EMPTY_REGISTRY);
    }

    const parsed = await readJsonFile<Registry>(this.registryPath);
    if (parsed.version !== 1 || !Array.isArray(parsed.clones)) {
      throw new Error(`Unsupported registry schema at ${this.registryPath}`);
    }
    return parsed;
  }

  async save(registry: Registry): Promise<void> {
    await this.withLock(async () => {
      await this.saveUnlocked(registry);
    });
  }

  async list(): Promise<CloneRecord[]> {
    const registry = await this.load();
    return registry.clones;
  }

  async findByName(name: string): Promise<CloneRecord | undefined> {
    const clones = await this.list();
    return clones.find((clone) => clone.name === name);
  }

  async upsert(clone: CloneRecord): Promise<void> {
    await this.withLock(async () => {
      const registry = await this.load();
      const index = registry.clones.findIndex((entry) => entry.name === clone.name);
      if (index === -1) {
        registry.clones.push(clone);
      } else {
        registry.clones[index] = clone;
      }
      await this.saveUnlocked(registry);
    });
  }

  async removeByName(name: string): Promise<CloneRecord | undefined> {
    return this.withLock(async () => {
      const registry = await this.load();
      const index = registry.clones.findIndex((clone) => clone.name === name);
      if (index === -1) {
        return undefined;
      }
      const [removed] = registry.clones.splice(index, 1);
      await this.saveUnlocked(registry);
      return removed;
    });
  }

  private async saveUnlocked(registry: Registry): Promise<void> {
    await ensureDir(dirname(this.registryPath));
    const raw = `${JSON.stringify(registry, null, 2)}\n`;
    const tempPath = `${this.registryPath}.tmp-${process.pid}-${randomUUID()}`;

    try {
      await writeFile(tempPath, raw, { encoding: "utf8", mode: 0o600 });
      await rename(tempPath, this.registryPath);
    } catch (error) {
      await rm(tempPath, { force: true });
      throw error;
    }
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const handle = await this.acquireLock();
    try {
      return await operation();
    } finally {
      await handle.close().catch(() => undefined);
      await rm(this.lockPath, { force: true }).catch(() => undefined);
    }
  }

  private async acquireLock() {
    await ensureDir(dirname(this.lockPath));
    const deadline = Date.now() + this.lockTimeoutMs;

    while (true) {
      try {
        const handle = await open(this.lockPath, "wx");
        await handle.writeFile(`${process.pid}\n${Date.now()}\n`, { encoding: "utf8" });
        return handle;
      } catch (error) {
        if (!isAlreadyExistsError(error)) {
          throw error;
        }
      }

      if (Date.now() > deadline) {
        await this.maybeBreakStaleLock();
      }

      if (Date.now() > deadline + this.staleLockMs) {
        throw new Error(`Timed out waiting for registry lock at ${this.lockPath}`);
      }

      await sleep(this.lockPollIntervalMs);
    }
  }

  private async maybeBreakStaleLock(): Promise<void> {
    try {
      const lockStat = await stat(this.lockPath);
      if (Date.now() - lockStat.mtimeMs > this.staleLockMs) {
        await rm(this.lockPath, { force: true });
      }
    } catch {
      // Ignore stale lock checks if the file disappears concurrently.
    }
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "EEXIST";
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
