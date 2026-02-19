import { constants } from "node:fs";
import { access, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const BLOCK_START = "# >>> codex-mirror PATH >>>";
const BLOCK_END = "# <<< codex-mirror PATH <<<";

export type ShellKind = "bash" | "zsh" | "fish" | "sh";

export interface PathStatus {
  binDir: string;
  normalizedBinDir: string;
  shell: ShellKind;
  rcFile: string;
  onPath: boolean;
  hasManagedBlock: boolean;
}

export interface EnsurePathOptions {
  binDir: string;
  shell?: ShellKind;
  rcFile?: string;
  homeDir?: string;
}

export interface EnsurePathResult {
  changed: boolean;
  shell: ShellKind;
  rcFile: string;
  sourceCommand: string;
}

export async function getPathStatus(options: EnsurePathOptions): Promise<PathStatus> {
  const homeDir = options.homeDir ?? homedir();
  const shell = options.shell ?? detectShell(process.env.SHELL);
  const rcFile = resolveRcFile(shell, homeDir, options.rcFile);
  await validateRcFileSafety(rcFile, homeDir, options.rcFile);
  const normalizedBinDir = normalizeDir(options.binDir, homeDir);
  const onPath = isDirOnPath(options.binDir, process.env.PATH, homeDir);
  const hasManagedBlock = await fileContainsManagedBlock(rcFile);

  return {
    binDir: options.binDir,
    normalizedBinDir,
    shell,
    rcFile,
    onPath,
    hasManagedBlock,
  };
}

export async function ensurePathInShellRc(options: EnsurePathOptions): Promise<EnsurePathResult> {
  const homeDir = options.homeDir ?? homedir();
  const shell = options.shell ?? detectShell(process.env.SHELL);
  const rcFile = resolveRcFile(shell, homeDir, options.rcFile);
  await validateRcFileSafety(rcFile, homeDir, options.rcFile);
  const existing = await readFileIfExists(rcFile);
  const block = buildManagedBlock(shell, options.binDir, homeDir);
  const next = upsertManagedBlock(existing, block);
  const changed = next !== existing;

  if (changed) {
    await mkdir(dirname(rcFile), { recursive: true });
    await writeFile(rcFile, next, "utf8");
  }

  return {
    changed,
    shell,
    rcFile,
    sourceCommand: sourceCommandFor(shell, rcFile),
  };
}

export function isDirOnPath(binDir: string, pathValue = process.env.PATH ?? "", homeDir = homedir()): boolean {
  const target = normalizeDir(binDir, homeDir);
  const entries = pathValue
    .split(":")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => normalizeDir(entry, homeDir));

  return entries.includes(target);
}

export function detectShell(shellPath: string | undefined): ShellKind {
  const shellBase = basename(shellPath ?? "").toLowerCase();
  if (shellBase.includes("bash")) {
    return "bash";
  }
  if (shellBase.includes("zsh")) {
    return "zsh";
  }
  if (shellBase.includes("fish")) {
    return "fish";
  }
  if (shellBase.includes("sh")) {
    return "sh";
  }
  return "bash";
}

export function resolveRcFile(shell: ShellKind, homeDir: string, override?: string): string {
  if (override !== undefined) {
    const trimmedOverride = override.trim();
    if (trimmedOverride.length === 0) {
      throw new Error("Refusing empty --rc-file override");
    }
    const resolvedHome = normalizeDir(homeDir, homeDir);
    const expandedOverride = expandHome(trimmedOverride, homeDir);
    const resolvedOverride = resolve(expandedOverride);
    const rel = relative(resolvedHome, resolvedOverride);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error(`Refusing --rc-file outside HOME: ${resolvedOverride} (HOME: ${resolvedHome})`);
    }
    return resolvedOverride;
  }

  if (shell === "zsh") {
    return join(homeDir, ".zshrc");
  }
  if (shell === "fish") {
    return join(homeDir, ".config", "fish", "config.fish");
  }
  if (shell === "sh") {
    return join(homeDir, ".profile");
  }
  return join(homeDir, ".bashrc");
}

export function sourceCommandFor(shell: ShellKind, rcFile: string): string {
  if (shell === "fish") {
    return `source ${shellSingleQuote(rcFile)}`;
  }
  return `. ${shellSingleQuote(rcFile)}`;
}

function buildManagedBlock(shell: ShellKind, binDir: string, homeDir: string): string {
  const binExpr = toShellBinExpr(binDir, homeDir);

  if (shell === "fish") {
    return `${BLOCK_START}
if not contains -- ${shellDoubleQuote(binExpr)} $PATH
  set -gx PATH ${shellDoubleQuote(binExpr)} $PATH
end
${BLOCK_END}
`;
  }

  return `${BLOCK_START}
export PATH=${shellDoubleQuote(`${binExpr}:$PATH`)}
${BLOCK_END}
`;
}

function upsertManagedBlock(content: string, block: string): string {
  const start = content.indexOf(BLOCK_START);
  const end = content.indexOf(BLOCK_END);

  if (start !== -1 && end !== -1 && end > start) {
    const before = content.slice(0, start);
    const after = content.slice(end + BLOCK_END.length);
    const normalizedBefore = trimTrailingNewline(before);
    const normalizedAfter = trimLeadingNewline(after);
    const beforePart = normalizedBefore.length > 0 ? `${normalizedBefore}\n` : "";
    return `${beforePart}${block}${normalizedAfter}`;
  }

  const prefix = content.length === 0 ? "" : `${trimTrailingNewline(content)}\n\n`;
  return `${prefix}${block}`;
}

function toShellBinExpr(binDir: string, homeDir: string): string {
  const normalizedHome = normalizeDir(homeDir, homeDir);
  const normalizedBin = normalizeDir(binDir, homeDir);
  if (normalizedBin === normalizedHome) {
    return "$HOME";
  }

  const homePrefix = `${normalizedHome}/`;
  if (normalizedBin.startsWith(homePrefix)) {
    const suffix = normalizedBin.slice(homePrefix.length);
    return `$HOME/${suffix}`;
  }

  return normalizedBin;
}

function normalizeDir(value: string, homeDir: string): string {
  const expanded = expandHome(value.trim(), homeDir);
  return resolve(expanded);
}

function expandHome(value: string, homeDir: string): string {
  if (value === "~") {
    return homeDir;
  }
  if (value.startsWith("~/")) {
    return join(homeDir, value.slice(2));
  }
  return value;
}

async function readFileIfExists(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

async function fileContainsManagedBlock(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return false;
    }
    throw error;
  }

  const content = await readFile(path, "utf8");
  return content.includes(BLOCK_START) && content.includes(BLOCK_END);
}

function trimTrailingNewline(value: string): string {
  return value.replace(/\n+$/g, "");
}

function trimLeadingNewline(value: string): string {
  return value.replace(/^\n+/g, "");
}

function shellSingleQuote(input: string): string {
  return `'${input.replace(/'/g, `'"'"'`)}'`;
}

function shellDoubleQuote(input: string): string {
  return `"${input.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

async function validateRcFileSafety(rcFile: string, homeDir: string, override?: string): Promise<void> {
  if (!override) {
    return;
  }

  await assertPathDoesNotTraverseSymlinks(rcFile, normalizeDir(homeDir, homeDir));
  await assertRcFileTargetIsRegular(rcFile);
}

async function assertPathDoesNotTraverseSymlinks(path: string, homeDir: string): Promise<void> {
  const rel = relative(homeDir, path);
  if (rel.length === 0) {
    return;
  }

  const parts = rel.split(sep).filter((part) => part.length > 0);
  let cursor = homeDir;
  for (const part of parts) {
    cursor = join(cursor, part);
    try {
      const details = await lstat(cursor);
      if (details.isSymbolicLink()) {
        throw new Error(`Refusing --rc-file path that traverses a symlink: ${cursor}`);
      }
    } catch (error) {
      if (isNotFoundError(error)) {
        return;
      }
      throw error;
    }
  }
}

async function assertRcFileTargetIsRegular(path: string): Promise<void> {
  try {
    const details = await lstat(path);
    if (details.isSymbolicLink()) {
      throw new Error(`Refusing --rc-file symlink target: ${path}`);
    }
    if (!details.isFile()) {
      throw new Error(`Refusing --rc-file target that is not a regular file: ${path}`);
    }
  } catch (error) {
    if (isNotFoundError(error)) {
      return;
    }
    throw error;
  }
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT";
}
