import { spawn } from "node:child_process";
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WrapperManager } from "../src/core/wrapper-manager.js";
import { CloneRecord } from "../src/types.js";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("WrapperManager", () => {
  it("writes wrapper with explicit runner command and args", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-mirror-wrapper-"));
    tempDirs.push(root);

    const manager = new WrapperManager(join(root, "bin"), {
      command: "/usr/local/bin/node",
      args: ["/repo/dist/cli.js"],
    });

    const clone = sampleClone("alpha", root);
    const wrapperPath = await manager.installWrapper(clone);
    const content = await readFile(wrapperPath, "utf8");

    expect(content).toContain("RUNNER_CMD='/usr/local/bin/node'");
    expect(content).toContain("RUNNER_ARGS=('/repo/dist/cli.js')");
    expect(content).toContain("run 'alpha' --");
  });

  it("rejects unsafe clone names for path traversal", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-mirror-wrapper-"));
    tempDirs.push(root);
    const manager = new WrapperManager(join(root, "bin"));

    expect(() => manager.getPathForClone("../evil")).toThrow("path separators");
    await expect(manager.removeWrapper("../evil")).rejects.toThrow("path separators");
  });

  it("runs wrapper with no runner args under nounset mode", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-mirror-wrapper-"));
    tempDirs.push(root);

    const runnerPath = join(root, "runner.sh");
    await installFakeRunner(runnerPath);

    const manager = new WrapperManager(join(root, "bin"), {
      command: runnerPath,
      args: [],
    });

    const clone = sampleClone("beta", root);
    const wrapperPath = await manager.installWrapper(clone);
    const argsOutputPath = join(root, "runner-args.txt");

    const result = await runExecutable(wrapperPath, ["--model", "o3"], {
      ...process.env,
      RUNNER_OUT: argsOutputPath,
    });

    expect(result.code).toBe(0);
    expect(result.stderr).not.toContain("unbound variable");

    const receivedArgs = (await readFile(argsOutputPath, "utf8")).trim().split("\n");
    expect(receivedArgs).toEqual(["run", "beta", "--", "--model", "o3"]);
  });

  it("replaces an existing regular wrapper file", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-mirror-wrapper-"));
    tempDirs.push(root);

    const binDir = join(root, "bin");
    await mkdir(binDir, { recursive: true });
    await writeFile(join(binDir, "alpha"), "#!/usr/bin/env bash\necho old\n", "utf8");

    const manager = new WrapperManager(binDir);
    await manager.installWrapper(sampleClone("alpha", root));

    const content = await readFile(join(binDir, "alpha"), "utf8");
    expect(content).toContain("run 'alpha' --");
    expect(content).not.toContain("echo old");
  });

  it("refuses to overwrite wrapper symlink targets", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-mirror-wrapper-"));
    tempDirs.push(root);

    const binDir = join(root, "bin");
    await mkdir(binDir, { recursive: true });

    const trapPath = join(root, "trap.txt");
    await writeFile(trapPath, "do-not-touch\n", "utf8");
    const wrapperPath = join(binDir, "alpha");
    await symlink(trapPath, wrapperPath);

    const manager = new WrapperManager(binDir);
    await expect(manager.installWrapper(sampleClone("alpha", root))).rejects.toThrow("wrapper symlink");

    const stat = await lstat(wrapperPath);
    expect(stat.isSymbolicLink()).toBe(true);
    expect(await readFile(trapPath, "utf8")).toBe("do-not-touch\n");
  });

  it("refuses to overwrite non-regular wrapper targets", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-mirror-wrapper-"));
    tempDirs.push(root);

    const binDir = join(root, "bin");
    await mkdir(join(binDir, "alpha"), { recursive: true });

    const manager = new WrapperManager(binDir);
    await expect(manager.installWrapper(sampleClone("alpha", root))).rejects.toThrow("non-regular wrapper target");
  });
});

function sampleClone(name: string, root: string): CloneRecord {
  const now = new Date().toISOString();
  return {
    id: `${name}-id`,
    name,
    rootPath: join(root, name),
    runtimePath: join(root, name, "runtime"),
    runtimeEntryPath: join(root, name, "runtime", "bin", "codex"),
    runtimeKind: "binary",
    wrapperPath: join(root, "bin", name),
    codexVersionPinned: "0.101.0",
    createdAt: now,
    updatedAt: now,
  };
}

async function installFakeRunner(path: string): Promise<void> {
  const script = `#!/usr/bin/env bash
set -euo pipefail
out="\${RUNNER_OUT:?}"
: > "$out"
for arg in "$@"; do
  printf "%s\\n" "$arg" >> "$out"
done
`;
  await writeFile(path, script, "utf8");
  await chmod(path, 0o755);
}

async function runExecutable(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, {
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
