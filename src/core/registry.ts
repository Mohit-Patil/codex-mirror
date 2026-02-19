import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { type FileHandle, lstat, open, rename, rm, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { CloneRecord, Registry } from "../types.js";
import { ensureDir, exists, readJsonFile } from "../utils/fs.js";

const EMPTY_REGISTRY: Registry = {
  version: 1,
  clones: [],
};

interface LockIdentity {
  dev: string;
  ino: string;
}

interface LockLease {
  handle: FileHandle;
  identity: LockIdentity;
}

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
    const lock = await this.acquireLock();
    try {
      return await operation();
    } finally {
      await lock.handle.close().catch(() => undefined);
      await this.unlinkLockIfMatches(lock.identity).catch(() => undefined);
    }
  }

  private async acquireLock(): Promise<LockLease> {
    await ensureDir(dirname(this.lockPath));
    const deadline = Date.now() + this.lockTimeoutMs;

    while (true) {
      let handle: FileHandle | undefined;
      try {
        handle = await open(this.lockPath, lockOpenFlags(), 0o600);
      } catch (error) {
        if (!isAlreadyExistsError(error)) {
          throw error;
        }
      }

      if (handle) {
        try {
          const payload = `${process.pid}\n${Date.now()}\n`;
          await handle.writeFile(payload, { encoding: "utf8" });
          const details = await handle.stat();
          if (!details.isFile()) {
            throw new Error(`Registry lock is not a regular file at ${this.lockPath}`);
          }
          return {
            handle,
            identity: lockIdentityFromStat(details),
          };
        } catch (error) {
          const details = await handle.stat().catch(() => undefined);
          await handle.close().catch(() => undefined);
          if (details?.isFile()) {
            await this.unlinkLockIfMatches(lockIdentityFromStat(details)).catch(() => undefined);
          }
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
      const details = await lstat(this.lockPath);
      if (!details.isFile()) {
        return;
      }
      if (!isOwnedByCurrentUser(details.uid)) {
        return;
      }
      if (Date.now() - details.mtimeMs > this.staleLockMs) {
        await this.unlinkLockIfMatches(lockIdentityFromStat(details));
      }
    } catch {
      // Ignore stale lock checks if the file disappears concurrently.
    }
  }

  private async unlinkLockIfMatches(identity: LockIdentity): Promise<void> {
    try {
      const current = await lstat(this.lockPath);
      if (!current.isFile()) {
        return;
      }
      const currentIdentity = lockIdentityFromStat(current);
      if (currentIdentity.dev !== identity.dev || currentIdentity.ino !== identity.ino) {
        return;
      }
      await unlink(this.lockPath);
    } catch (error) {
      if (isNotFoundError(error)) {
        return;
      }
      throw error;
    }
  }
}

function lockOpenFlags(): number {
  let flags = fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_RDWR;
  if (typeof fsConstants.O_NOFOLLOW === "number") {
    flags |= fsConstants.O_NOFOLLOW;
  }
  return flags;
}

function lockIdentityFromStat(stat: { dev: number | bigint; ino: number | bigint }): LockIdentity {
  return {
    dev: String(stat.dev),
    ino: String(stat.ino),
  };
}

function isOwnedByCurrentUser(uid: number): boolean {
  const currentUid = process.getuid?.();
  return currentUid === undefined || currentUid === uid;
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT";
}

function isAlreadyExistsError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "EEXIST";
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
