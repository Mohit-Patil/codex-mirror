import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { delimiter } from "node:path";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const cliEntry = resolve(process.cwd(), "src", "cli.ts");
const packageVersion = (JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as { version: string }).version;
const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("CLI smoke flow", () => {
  it(
    "supports create/list/login/doctor/remove with isolated state",
    async () => {
      const sandbox = await mkdtemp(join(tmpdir(), "codex-mirror-cli-"));
      tempDirs.push(sandbox);

      const fakeBin = join(sandbox, "fake-bin");
      await mkdir(fakeBin, { recursive: true });
      await installFakeCodex(join(fakeBin, "codex"));

      const env: NodeJS.ProcessEnv = {
        ...process.env,
        PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ""}`,
        HOME: join(sandbox, "user-home"),
        CODEX_MIRROR_HOME: join(sandbox, "mirror-home"),
        CODEX_MIRROR_BIN_DIR: join(sandbox, "wrapper-bin"),
      };

      const create = await runCli(["create", "--name", "smoke"], env);
      expect(create.code).toBe(0);
      expect(create.stdout).toContain("Created clone 'smoke'");

      const version = await runCli(["--version"], env);
      expect(version.code).toBe(0);
      expect(version.stdout.trim()).toBe(packageVersion);

      const listJson = await runCli(["list", "--json"], env);
      expect(listJson.code).toBe(0);
      const listed = JSON.parse(listJson.stdout) as Array<{ name: string }>;
      expect(listed).toHaveLength(1);
      expect(listed[0]?.name).toBe("smoke");

      const rcFile = join(sandbox, ".bashrc");
      const pathStatus = await runCli(
        ["path", "status", "--bin-dir", env.CODEX_MIRROR_BIN_DIR!, "--shell", "bash", "--rc-file", rcFile],
        env,
      );
      expect(pathStatus.code).toBe(0);
      expect(pathStatus.stdout).toContain("On PATH (current session): no");

      const pathSetup = await runCli(
        ["path", "setup", "--bin-dir", env.CODEX_MIRROR_BIN_DIR!, "--shell", "bash", "--rc-file", rcFile],
        env,
      );
      expect(pathSetup.code).toBe(0);
      expect(pathSetup.stdout).toContain("Updated:");
      const rcContent = await readFile(rcFile, "utf8");
      expect(rcContent).toContain("codex-mirror PATH");

      const doctorBefore = await runCli(["doctor", "smoke", "--json"], env);
      expect(doctorBefore.code).toBe(0);
      const beforeResults = JSON.parse(doctorBefore.stdout) as Array<{ authStatus: string }>;
      expect(beforeResults[0]?.authStatus).toBe("not_logged_in");

      const login = await runCli(["login", "smoke"], env);
      expect(login.code).toBe(0);

      const doctorAfter = await runCli(["doctor", "smoke", "--json"], env);
      expect(doctorAfter.code).toBe(0);
      const afterResults = JSON.parse(doctorAfter.stdout) as Array<{ authStatus: string }>;
      expect(afterResults[0]?.authStatus).toBe("logged_in");

      const remove = await runCli(["remove", "smoke"], env);
      expect(remove.code).toBe(0);
      expect(remove.stdout).toContain("Removed clone 'smoke'");

      const listAfter = await runCli(["list"], env);
      expect(listAfter.code).toBe(0);
      expect(listAfter.stdout).toContain("No clones found.");
    },
    20_000,
  );
});

async function installFakeCodex(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const script = `#!/usr/bin/env bash
set -euo pipefail
cmd="\${1:-}"
sub="\${2:-}"

if [[ "$cmd" == "-V" || "$cmd" == "--version" ]]; then
  echo "codex-cli 0.999.0"
  exit 0
fi

if [[ "$cmd" == "login" && "$sub" == "status" ]]; then
  if [[ -f "$HOME/.codex/auth.ok" ]]; then
    echo "Logged in using ChatGPT"
  else
    echo "Not logged in"
  fi
  exit 0
fi

if [[ "$cmd" == "login" ]]; then
  mkdir -p "$HOME/.codex"
  touch "$HOME/.codex/auth.ok"
  echo "Logged in"
  exit 0
fi

if [[ "$cmd" == "logout" ]]; then
  rm -f "$HOME/.codex/auth.ok"
  echo "Logged out"
  exit 0
fi

echo "Fake codex run: $*"
exit 0
`;
  await writeFile(path, script, "utf8");
  await chmod(path, 0o755);
}

async function runCli(args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", cliEntry, ...args], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    });

    child.on("error", reject);
    child.on("close", (code) => {
      resolveResult({
        code: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}
