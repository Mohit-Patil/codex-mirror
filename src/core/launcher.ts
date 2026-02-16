import { CloneRecord } from "../types.js";
import { CaptureResult, runCapture, runInteractive } from "../utils/process.js";
import { join } from "node:path";

export class Launcher {
  async run(clone: CloneRecord, args: string[], cwd = process.cwd()): Promise<number> {
    const { command, commandArgs } = resolveRuntimeInvocation(clone, args);
    const result = await runInteractive(command, commandArgs, buildEnv(clone), cwd);
    return result.code;
  }

  capture(clone: CloneRecord, args: string[], cwd = process.cwd(), timeoutMs = 8_000): Promise<CaptureResult> {
    const { command, commandArgs } = resolveRuntimeInvocation(clone, args);
    return runCapture(command, commandArgs, buildEnv(clone), cwd, timeoutMs);
  }
}

function resolveRuntimeInvocation(clone: CloneRecord, args: string[]): { command: string; commandArgs: string[] } {
  if (clone.runtimeKind === "npm-package") {
    return {
      command: process.execPath,
      commandArgs: [clone.runtimeEntryPath, ...args],
    };
  }

  return {
    command: clone.runtimeEntryPath,
    commandArgs: args,
  };
}

export function buildEnv(clone: CloneRecord): NodeJS.ProcessEnv {
  const home = join(clone.rootPath, ".codex-mirror", "home");
  return {
    ...process.env,
    HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    XDG_CACHE_HOME: join(home, ".cache"),
  };
}
