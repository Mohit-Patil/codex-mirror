import { CloneRecord } from "../types.js";
import { CaptureResult, runCapture, runInteractive } from "../utils/process.js";
import { join } from "node:path";
import { deriveClonePaths } from "./clone-manager.js";
import { readCloneSecretsSync } from "./clone-secrets.js";
import { ensureMiniMaxConfigCompatibility } from "./clone-template.js";

export class Launcher {
  async run(clone: CloneRecord, args: string[], cwd = process.cwd()): Promise<number> {
    await ensureTemplateCompatibility(clone);
    const { command, commandArgs } = resolveRuntimeInvocation(clone, args);
    const result = await runInteractive(command, commandArgs, buildEnv(clone), cwd);
    return result.code;
  }

  async capture(clone: CloneRecord, args: string[], cwd = process.cwd(), timeoutMs = 8_000): Promise<CaptureResult> {
    await ensureTemplateCompatibility(clone);
    const { command, commandArgs } = resolveRuntimeInvocation(clone, args);
    return runCapture(command, commandArgs, buildEnv(clone), cwd, timeoutMs);
  }
}

function resolveRuntimeInvocation(clone: CloneRecord, args: string[]): { command: string; commandArgs: string[] } {
  const effectiveArgs = resolveLaunchArgs(clone, args);

  if (clone.runtimeKind === "npm-package") {
    return {
      command: process.execPath,
      commandArgs: [clone.runtimeEntryPath, ...effectiveArgs],
    };
  }

  return {
    command: clone.runtimeEntryPath,
    commandArgs: effectiveArgs,
  };
}

function resolveEffectiveArgs(clone: CloneRecord, args: string[]): string[] {
  const defaults = clone.defaultCodexArgs ?? [];
  if (defaults.length === 0) {
    return args;
  }

  if (args.length > 0) {
    if (hasExplicitProfileArgs(args) || isControlCommand(args[0])) {
      return args;
    }
    const firstArg = args[0]?.trim().toLowerCase();
    if (firstArg && DEFAULTS_AFTER_SUBCOMMAND.has(firstArg)) {
      return [args[0] as string, ...defaults, ...args.slice(1)];
    }
    return [...defaults, ...args];
  }

  return defaults.slice();
}

function hasExplicitProfileArgs(args: string[]): boolean {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg) {
      continue;
    }
    if (arg === "-p" || arg === "--profile") {
      return true;
    }
    if (arg.startsWith("--profile=")) {
      return true;
    }
  }
  return false;
}

function isControlCommand(firstArg: string | undefined): boolean {
  if (!firstArg) {
    return false;
  }

  const normalized = firstArg.trim().toLowerCase();
  return CONTROL_COMMANDS.has(normalized);
}

const CONTROL_COMMANDS = new Set([
  "login",
  "logout",
  "completion",
  "sandbox",
  "debug",
  "apply",
  "resume",
  "fork",
  "cloud",
  "features",
  "help",
  "mcp",
  "mcp-server",
  "app-server",
  "app",
]);

const DEFAULTS_AFTER_SUBCOMMAND = new Set(["exec", "review"]);

export function resolveLaunchArgs(clone: CloneRecord, args: string[]): string[] {
  return resolveEffectiveArgs(clone, args);
}

async function ensureTemplateCompatibility(clone: CloneRecord): Promise<void> {
  if ((clone.template ?? "official") !== "minimax") {
    return;
  }

  const paths = deriveClonePaths(clone.rootPath);
  await ensureMiniMaxConfigCompatibility(paths.codexHomeDir);
}

export function buildEnv(clone: CloneRecord): NodeJS.ProcessEnv {
  const home = join(clone.rootPath, ".codex-mirror", "home");
  const secrets = readCloneSecretsSync(deriveClonePaths(clone.rootPath));
  return {
    ...process.env,
    ...secrets,
    HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    XDG_CACHE_HOME: join(home, ".cache"),
  };
}
