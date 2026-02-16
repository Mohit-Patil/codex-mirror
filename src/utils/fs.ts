import { access, cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname } from "node:path";

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function isWritable(path: string): Promise<boolean> {
  try {
    await access(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export async function removePath(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

export async function copyDir(from: string, to: string): Promise<void> {
  await cp(from, to, { recursive: true, force: true, errorOnExist: false, preserveTimestamps: true });
}

export async function copyFile(from: string, to: string): Promise<void> {
  await ensureDir(dirname(to));
  await cp(from, to, { recursive: false, force: true });
}

export async function readJsonFile<T>(path: string): Promise<T> {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as T;
}

export async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await ensureDir(dirname(path));
  const raw = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(path, raw, "utf8");
}

export async function isFile(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile();
  } catch {
    return false;
  }
}
