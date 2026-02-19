import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectShell, ensurePathInShellRc, getPathStatus, isDirOnPath, resolveRcFile, sourceCommandFor } from "../src/core/path-setup.js";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("path setup", () => {
  it("detects shell kind from shell path", () => {
    expect(detectShell("/bin/bash")).toBe("bash");
    expect(detectShell("/usr/bin/zsh")).toBe("zsh");
    expect(detectShell("/opt/homebrew/bin/fish")).toBe("fish");
    expect(detectShell("/bin/sh")).toBe("sh");
  });

  it("checks PATH membership with normalization", async () => {
    const home = await mkdtemp(join(tmpdir(), "codex-mirror-path-home-"));
    tempDirs.push(home);
    expect(isDirOnPath(`${home}/.local/bin`, `/usr/bin:~/.local/bin`, home)).toBe(true);
    expect(isDirOnPath(`${home}/.local/bin`, `/usr/bin:/usr/local/bin`, home)).toBe(false);
  });

  it("writes managed block idempotently", async () => {
    const home = await mkdtemp(join(tmpdir(), "codex-mirror-path-home-"));
    tempDirs.push(home);
    const binDir = join(home, ".local", "bin");
    const rcFile = join(home, ".bashrc");

    const first = await ensurePathInShellRc({ binDir, shell: "bash", rcFile, homeDir: home });
    expect(first.changed).toBe(true);
    expect(resolveRcFile("bash", home, rcFile)).toBe(rcFile);
    expect(sourceCommandFor("bash", rcFile)).toBe(`. '${rcFile}'`);

    const second = await ensurePathInShellRc({ binDir, shell: "bash", rcFile, homeDir: home });
    expect(second.changed).toBe(false);

    const rc = await readFile(rcFile, "utf8");
    expect(rc).toContain(">>> codex-mirror PATH >>>");
    expect(rc).toContain("<<< codex-mirror PATH <<<");
  });

  it("updates existing managed block when bin dir changes", async () => {
    const home = await mkdtemp(join(tmpdir(), "codex-mirror-path-home-"));
    tempDirs.push(home);
    const rcFile = join(home, ".bashrc");
    const binA = join(home, "bin-a");
    const binB = join(home, "bin-b");

    await ensurePathInShellRc({ binDir: binA, shell: "bash", rcFile, homeDir: home });
    const second = await ensurePathInShellRc({ binDir: binB, shell: "bash", rcFile, homeDir: home });
    expect(second.changed).toBe(true);

    const rc = await readFile(rcFile, "utf8");
    expect(rc).toContain("$HOME/bin-b");
    expect(rc).not.toContain("$HOME/bin-a");
  });

  it("reports status for managed block and current session PATH", async () => {
    const home = await mkdtemp(join(tmpdir(), "codex-mirror-path-home-"));
    tempDirs.push(home);
    const binDir = join(home, ".local", "bin");
    const rcFile = join(home, ".bashrc");

    await ensurePathInShellRc({ binDir, shell: "bash", rcFile, homeDir: home });
    const status = await getPathStatus({ binDir, shell: "bash", rcFile, homeDir: home });

    expect(status.hasManagedBlock).toBe(true);
    expect(status.onPath).toBe(false);
    expect(status.rcFile).toBe(rcFile);
  });

  it("rejects --rc-file overrides outside HOME", async () => {
    const home = await mkdtemp(join(tmpdir(), "codex-mirror-path-home-"));
    const outside = await mkdtemp(join(tmpdir(), "codex-mirror-path-outside-"));
    tempDirs.push(home, outside);

    const binDir = join(home, ".local", "bin");
    const rcFile = join(outside, ".bashrc");

    expect(() => resolveRcFile("bash", home, rcFile)).toThrow("outside HOME");
    await expect(ensurePathInShellRc({ binDir, shell: "bash", rcFile, homeDir: home })).rejects.toThrow("outside HOME");
    await expect(getPathStatus({ binDir, shell: "bash", rcFile, homeDir: home })).rejects.toThrow("outside HOME");
  });

  it("rejects --rc-file symlink targets", async () => {
    const home = await mkdtemp(join(tmpdir(), "codex-mirror-path-home-"));
    tempDirs.push(home);

    const binDir = join(home, ".local", "bin");
    const target = join(home, "real-rc");
    const rcFile = join(home, ".bashrc");
    await writeFile(target, "# real\n", "utf8");
    await symlink(target, rcFile);

    await expect(ensurePathInShellRc({ binDir, shell: "bash", rcFile, homeDir: home })).rejects.toThrow("symlink");
    await expect(getPathStatus({ binDir, shell: "bash", rcFile, homeDir: home })).rejects.toThrow("symlink");
  });

  it("rejects --rc-file paths that traverse symlink directories", async () => {
    const home = await mkdtemp(join(tmpdir(), "codex-mirror-path-home-"));
    tempDirs.push(home);

    const binDir = join(home, ".local", "bin");
    const realDir = join(home, "real");
    const linkedDir = join(home, "linked");
    await mkdir(realDir, { recursive: true });
    await symlink(realDir, linkedDir);

    const rcFile = join(linkedDir, ".bashrc");
    await expect(ensurePathInShellRc({ binDir, shell: "bash", rcFile, homeDir: home })).rejects.toThrow("traverses a symlink");
    await expect(getPathStatus({ binDir, shell: "bash", rcFile, homeDir: home })).rejects.toThrow("traverses a symlink");
  });
});
