import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { ClonePaths, CloneRecord, CloneTemplate } from "../types.js";
import { copyDir, ensureDir, exists, removePath, writeJsonFile } from "../utils/fs.js";
import { assertValidCloneName } from "./clone-name.js";
import { buildMiniMaxSecrets, writeCloneSecrets } from "./clone-secrets.js";
import {
  applyCloneTemplate,
  ensureMiniMaxConfigCompatibility,
  parseCloneTemplate,
  resolveTemplateRuntimePin,
} from "./clone-template.js";
import { installRuntime } from "./runtime-cloner.js";
import { RegistryStore } from "./registry.js";
import { WrapperManager } from "./wrapper-manager.js";

export interface CreateCloneOptions {
  name: string;
  rootPath: string;
  template?: CloneTemplate;
  minimaxApiKey?: string;
}

export class CloneManager {
  constructor(
    private readonly registry: RegistryStore,
    private readonly wrappers: WrapperManager,
  ) {}

  async listClones(): Promise<CloneRecord[]> {
    const clones = await this.registry.list();
    return clones.slice().sort((a, b) => a.name.localeCompare(b.name));
  }

  async getClone(name: string): Promise<CloneRecord> {
    const cloneName = assertValidCloneName(name);
    const clone = await this.registry.findByName(cloneName);
    if (!clone) {
      throw new Error(`Clone '${cloneName}' was not found`);
    }
    return clone;
  }

  async createClone(options: CreateCloneOptions): Promise<CloneRecord> {
    const name = assertValidCloneName(options.name);
    const template = parseCloneTemplate(options.template);

    const existing = await this.registry.findByName(name);
    if (existing) {
      throw new Error(`Clone '${name}' already exists`);
    }

    const rootPath = resolve(options.rootPath);
    const paths = deriveClonePaths(rootPath);

    if (await exists(paths.metadataPath)) {
      throw new Error(`Root path already contains a clone: ${rootPath}`);
    }

    let clone: CloneRecord | undefined;
    let rollbackCloneBase = false;
    let wrapperInstalled = false;
    let metadataWritten = false;
    let registryWritten = false;

    try {
      await ensureDir(paths.homeDir);
      await ensureDir(paths.codexHomeDir);
      await ensureDir(paths.logsDir);
      const templateSetup = await applyCloneTemplate(template, paths.codexHomeDir);
      rollbackCloneBase = true;

      const runtime = await installRuntime(paths.runtimeDir, {
        pinnedVersion: resolveTemplateRuntimePin(template),
      });
      const now = new Date().toISOString();

      clone = {
        id: randomUUID(),
        name,
        template,
        rootPath,
        runtimePath: paths.runtimeDir,
        runtimeEntryPath: runtime.entryPath,
        runtimeKind: runtime.kind,
        wrapperPath: this.wrappers.getPathForClone(name),
        codexVersionPinned: runtime.version,
        defaultCodexArgs: templateSetup.defaultCodexArgs,
        createdAt: now,
        updatedAt: now,
      };

      clone.wrapperPath = await this.wrappers.installWrapper(clone);
      wrapperInstalled = true;

      if (template === "minimax") {
        const secrets = buildMiniMaxSecrets(options.minimaxApiKey);
        await writeCloneSecrets(paths, secrets);
      }

      await this.writeCloneMetadata(clone);
      metadataWritten = true;

      await this.registry.upsert(clone);
      registryWritten = true;

      rollbackCloneBase = false;
      return clone;
    } catch (error) {
      const rollbackErrors: string[] = [];

      if (registryWritten) {
        try {
          await this.registry.removeByName(name);
        } catch (rollbackError) {
          rollbackErrors.push(`registry rollback failed: ${toErrorMessage(rollbackError)}`);
        }
      }

      if (wrapperInstalled) {
        try {
          await this.wrappers.removeWrapper(name);
        } catch (rollbackError) {
          rollbackErrors.push(`wrapper rollback failed: ${toErrorMessage(rollbackError)}`);
        }
      }

      if (rollbackCloneBase || metadataWritten) {
        try {
          await removePath(paths.cloneBaseDir);
        } catch (rollbackError) {
          rollbackErrors.push(`clone directory rollback failed: ${toErrorMessage(rollbackError)}`);
        }
      }

      throw buildTransactionError("create", name, error, rollbackErrors);
    }
  }

  async updateClone(name: string): Promise<CloneRecord> {
    const cloneName = assertValidCloneName(name);
    const current = await this.getClone(cloneName);
    const previous: CloneRecord = { ...current };
    const backupRuntimePath = `${current.runtimePath}.backup-${Date.now()}-${randomUUID().slice(0, 8)}`;
    let backupExists = false;

    try {
      if (await exists(current.runtimePath)) {
        await copyDir(current.runtimePath, backupRuntimePath);
        backupExists = true;
      }

      const runtime = await installRuntime(current.runtimePath, {
        pinnedVersion: resolveTemplateRuntimePin(current.template ?? "official"),
      });
      const updated: CloneRecord = {
        ...current,
        runtimeEntryPath: runtime.entryPath,
        runtimeKind: runtime.kind,
        codexVersionPinned: runtime.version,
        updatedAt: new Date().toISOString(),
      };

      if ((current.template ?? "official") === "minimax") {
        const paths = deriveClonePaths(current.rootPath);
        await ensureMiniMaxConfigCompatibility(paths.codexHomeDir);
      }

      updated.wrapperPath = await this.wrappers.installWrapper(updated);

      await this.writeCloneMetadata(updated);
      await this.registry.upsert(updated);

      if (backupExists) {
        await removePath(backupRuntimePath);
      }

      return updated;
    } catch (error) {
      const rollbackErrors: string[] = [];

      if (backupExists) {
        try {
          await removePath(current.runtimePath);
          await copyDir(backupRuntimePath, current.runtimePath);
        } catch (rollbackError) {
          rollbackErrors.push(`runtime rollback failed: ${toErrorMessage(rollbackError)}`);
        }
      }

      try {
        await this.wrappers.installWrapper(previous);
      } catch (rollbackError) {
        rollbackErrors.push(`wrapper rollback failed: ${toErrorMessage(rollbackError)}`);
      }

      try {
        await this.writeCloneMetadata(previous);
      } catch (rollbackError) {
        rollbackErrors.push(`metadata rollback failed: ${toErrorMessage(rollbackError)}`);
      }

      try {
        await this.registry.upsert(previous);
      } catch (rollbackError) {
        rollbackErrors.push(`registry rollback failed: ${toErrorMessage(rollbackError)}`);
      }

      if (backupExists) {
        try {
          await removePath(backupRuntimePath);
        } catch {
          // Ignore backup cleanup failure after rollback.
        }
      }

      throw buildTransactionError("update", cloneName, error, rollbackErrors);
    }
  }

  async updateAll(): Promise<CloneRecord[]> {
    const clones = await this.listClones();
    const updated: CloneRecord[] = [];
    for (const clone of clones) {
      updated.push(await this.updateClone(clone.name));
    }
    return updated;
  }

  async removeClone(name: string): Promise<CloneRecord> {
    const cloneName = assertValidCloneName(name);
    const clone = await this.getClone(cloneName);
    const paths = deriveClonePaths(clone.rootPath);

    await this.registry.removeByName(cloneName);

    try {
      await removePath(paths.cloneBaseDir);
      await this.wrappers.removeWrapper(cloneName);
      return clone;
    } catch (error) {
      const rollbackErrors: string[] = [];
      try {
        await this.registry.upsert(clone);
      } catch (rollbackError) {
        rollbackErrors.push(`registry rollback failed: ${toErrorMessage(rollbackError)}`);
      }
      throw buildTransactionError("remove", cloneName, error, rollbackErrors);
    }
  }

  async saveClone(clone: CloneRecord): Promise<void> {
    assertValidCloneName(clone.name);
    await this.writeCloneMetadata(clone);
    await this.registry.upsert(clone);
  }

  async setMiniMaxApiKey(name: string, apiKey: string): Promise<CloneRecord> {
    const clone = await this.getClone(name);
    if ((clone.template ?? "official") !== "minimax") {
      throw new Error(`Clone '${name}' is not a MiniMax template clone`);
    }

    const paths = deriveClonePaths(clone.rootPath);
    await writeCloneSecrets(paths, buildMiniMaxSecrets(apiKey));
    const updated: CloneRecord = {
      ...clone,
      updatedAt: new Date().toISOString(),
    };
    await this.saveClone(updated);
    return updated;
  }

  private async writeCloneMetadata(clone: CloneRecord): Promise<void> {
    const paths = deriveClonePaths(clone.rootPath);
    await writeJsonFile(paths.metadataPath, clone);
  }
}

function buildTransactionError(
  operation: "create" | "update" | "remove",
  cloneName: string,
  rootError: unknown,
  rollbackErrors: string[],
): Error {
  const message = [`Failed to ${operation} clone '${cloneName}': ${toErrorMessage(rootError)}`];
  if (rollbackErrors.length > 0) {
    message.push(`Rollback issues: ${rollbackErrors.join("; ")}`);
  }
  return new Error(message.join(". "));
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function deriveClonePaths(rootPath: string): ClonePaths {
  const cloneBaseDir = resolve(rootPath, ".codex-mirror");
  const runtimeDir = resolve(cloneBaseDir, "runtime");
  const homeDir = resolve(cloneBaseDir, "home");
  const codexHomeDir = resolve(homeDir, ".codex");

  return {
    cloneBaseDir,
    metadataPath: resolve(cloneBaseDir, "clone.json"),
    secretsPath: resolve(cloneBaseDir, "secrets.json"),
    runtimeDir,
    runtimeEntryPath: resolve(runtimeDir, "bin", "codex"),
    homeDir,
    codexHomeDir,
    logsDir: resolve(cloneBaseDir, "logs"),
  };
}
