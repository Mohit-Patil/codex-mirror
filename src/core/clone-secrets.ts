import { readFileSync } from "node:fs";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { ClonePaths } from "../types.js";
import { ensureDir, exists, removePath } from "../utils/fs.js";

const MINIMAX_API_KEY_ENV = "MINIMAX_API_KEY";

export interface CloneSecrets {
  [key: string]: string;
}

export async function writeCloneSecrets(paths: ClonePaths, secrets: CloneSecrets): Promise<void> {
  const normalized = normalizeSecrets(secrets);
  if (Object.keys(normalized).length === 0) {
    await removePath(paths.secretsPath);
    return;
  }

  await ensureDir(dirname(paths.secretsPath));
  const payload = `${JSON.stringify(normalized, null, 2)}\n`;
  await writeFile(paths.secretsPath, payload, { encoding: "utf8", mode: 0o600 });
  await chmod(paths.secretsPath, 0o600);
}

export async function readCloneSecrets(paths: ClonePaths): Promise<CloneSecrets> {
  if (!(await exists(paths.secretsPath))) {
    return {};
  }

  try {
    const raw = await readFile(paths.secretsPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return normalizeSecrets(parsed);
  } catch {
    return {};
  }
}

export function readCloneSecretsSync(paths: ClonePaths): CloneSecrets {
  if (!existsSync(paths.secretsPath)) {
    return {};
  }

  try {
    const raw = readFileSync(paths.secretsPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return normalizeSecrets(parsed);
  } catch {
    return {};
  }
}

export function buildMiniMaxSecrets(minimaxApiKey: string | undefined): CloneSecrets {
  const value = minimaxApiKey?.trim();
  if (!value) {
    return {};
  }
  return { [MINIMAX_API_KEY_ENV]: value };
}

function normalizeSecrets(input: Record<string, unknown>): CloneSecrets {
  const out: CloneSecrets = {};
  for (const [key, value] of Object.entries(input)) {
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) {
      continue;
    }
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      continue;
    }
    out[key] = trimmed;
  }
  return out;
}

function existsSync(path: string): boolean {
  try {
    readFileSync(path, "utf8");
    return true;
  } catch {
    return false;
  }
}
