import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Doctor } from "../src/core/doctor.js";
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

describe("Doctor", () => {
  it("marks a healthy clone as ok", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-mirror-doctor-"));
    tempDirs.push(root);

    const clone = await createCloneFixture(root, "healthy");
    const launcher = {
      run: async () => 0,
      capture: () => ({ code: 0, stdout: "Logged in using ChatGPT", stderr: "" }),
    };

    const doctor = new Doctor(launcher as never);
    const result = await doctor.checkOne(clone);

    expect(result.ok).toBe(true);
    expect(result.authStatus).toBe("logged_in");
    expect(result.errors).toHaveLength(0);
  });

  it("reports errors for missing files and unknown auth", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-mirror-doctor-"));
    tempDirs.push(root);

    const clone = await createCloneFixture(root, "broken");
    await rm(clone.wrapperPath, { force: true });

    const launcher = {
      run: async () => 1,
      capture: () => ({ code: 1, stdout: "", stderr: "boom" }),
    };

    const doctor = new Doctor(launcher as never);
    const result = await doctor.checkOne(clone);

    expect(result.ok).toBe(false);
    expect(result.authStatus).toBe("unknown");
    expect(result.errors.some((error) => error.includes("Wrapper missing"))).toBe(true);
    expect(result.errors.some((error) => error.includes("auth status"))).toBe(true);
  });

  it("treats not logged in as a healthy but unauthenticated clone", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-mirror-doctor-"));
    tempDirs.push(root);

    const clone = await createCloneFixture(root, "nologin");
    const launcher = {
      run: async () => 1,
      capture: () => ({ code: 1, stdout: "", stderr: "Not logged in" }),
    };

    const doctor = new Doctor(launcher as never);
    const result = await doctor.checkOne(clone);

    expect(result.ok).toBe(true);
    expect(result.authStatus).toBe("not_logged_in");
    expect(result.errors).toHaveLength(0);
  });

  it("reports timeout as an error", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-mirror-doctor-"));
    tempDirs.push(root);

    const clone = await createCloneFixture(root, "timeout");
    const launcher = {
      run: async () => 1,
      capture: async () => ({ code: 1, stdout: "", stderr: "", timedOut: true }),
    };

    const doctor = new Doctor(launcher as never, 25);
    const result = await doctor.checkOne(clone);

    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.includes("timed out"))).toBe(true);
  });
});

async function createCloneFixture(root: string, name: string): Promise<CloneRecord> {
  const base = join(root, name, ".codex-mirror");
  const runtimeDir = join(base, "runtime", "bin");
  const homeDir = join(base, "home");
  const codexHomeDir = join(homeDir, ".codex");
  const logsDir = join(base, "logs");
  const wrapperDir = join(root, "bin");

  await ensureFile(join(runtimeDir, "codex"), "#!/usr/bin/env bash\necho test\n", 0o755);
  await ensureFile(join(wrapperDir, name), "#!/usr/bin/env bash\necho wrapper\n", 0o755);
  await ensureFile(join(codexHomeDir, "auth.json"), "{}\n", 0o600);
  await ensureFile(join(logsDir, "log.txt"), "ok\n", 0o600);

  const now = new Date().toISOString();
  return {
    id: `${name}-id`,
    name,
    rootPath: join(root, name),
    runtimePath: join(base, "runtime"),
    runtimeEntryPath: join(runtimeDir, "codex"),
    runtimeKind: "binary",
    wrapperPath: join(wrapperDir, name),
    codexVersionPinned: "0.101.0",
    createdAt: now,
    updatedAt: now,
  };
}

async function ensureFile(path: string, content: string, mode: number): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  await writeFile(path, content, { encoding: "utf8", flag: "w" });
  await chmod(path, mode);
}
