import { spawn, spawnSync } from "node:child_process";

export interface RunResult {
  code: number;
  signal: NodeJS.Signals | null;
}

export interface CaptureResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export function runInteractive(
  command: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
  cwd?: string,
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env,
      cwd,
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      resolve({ code: code ?? 1, signal: signal ?? null });
    });
  });
}

interface SyncCaptureResult {
  code: number;
  stdout: string;
  stderr: string;
}

export async function runCapture(
  command: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
  cwd?: string,
  timeoutMs = 10_000,
): Promise<CaptureResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env,
      cwd,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const maxBytes = 1024 * 1024;
    const timeout =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            child.kill("SIGTERM");
            setTimeout(() => child.kill("SIGKILL"), 300).unref();
          }, timeoutMs)
        : undefined;

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout = appendWithLimit(stdout, chunk, maxBytes);
    });

    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr = appendWithLimit(stderr, chunk, maxBytes);
    });

    child.on("error", (error) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      reject(error);
    });

    child.on("close", (code) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      resolve({
        code: code ?? 1,
        stdout,
        stderr,
        timedOut,
      });
    });
  });
}

export function runCaptureSync(
  command: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
  cwd?: string,
): SyncCaptureResult {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env,
    cwd,
  });

  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

export function findCommand(command: string): string | null {
  const lookup = process.platform === "win32" ? "where" : "which";
  const result = runCaptureSync(lookup, [command], process.env);
  if (result.code !== 0) {
    return null;
  }
  const found = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  return found ?? null;
}

function appendWithLimit(existing: string, chunk: Buffer | string, limit: number): string {
  const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
  const combined = existing + text;
  if (combined.length <= limit) {
    return combined;
  }
  return combined.slice(combined.length - limit);
}
