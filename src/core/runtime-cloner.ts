import { chmod, realpath } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { RuntimeInfo } from "../types.js";
import { copyDir, copyFile, ensureDir, exists, removePath } from "../utils/fs.js";
import { findCommand, runCaptureSync } from "../utils/process.js";

interface InstalledCodex {
  codexPath: string;
  version: string;
  kind: "npm-package" | "binary";
  sourcePath: string;
}

export async function detectInstalledCodex(): Promise<InstalledCodex> {
  const codexPath = findCommand("codex");
  if (!codexPath) {
    throw new Error("Could not find `codex` on PATH");
  }

  const resolvedPath = await resolveRealPath(codexPath);
  const version = detectCodexVersion(codexPath);

  if (basename(resolvedPath) === "codex.js" && basename(dirname(resolvedPath)) === "bin") {
    return {
      codexPath,
      version,
      kind: "npm-package",
      sourcePath: dirname(dirname(resolvedPath)),
    };
  }

  return {
    codexPath,
    version,
    kind: "binary",
    sourcePath: resolvedPath,
  };
}

export async function installRuntime(runtimeDir: string): Promise<RuntimeInfo> {
  const installed = await detectInstalledCodex();

  await removePath(runtimeDir);
  await ensureDir(runtimeDir);

  if (installed.kind === "npm-package") {
    const targetPackageRoot = join(runtimeDir, "package");
    await copyDir(installed.sourcePath, targetPackageRoot);

    const entryPath = join(targetPackageRoot, "bin", "codex.js");
    if (!(await exists(entryPath))) {
      throw new Error(`Copied Codex package is missing entry script: ${entryPath}`);
    }

    return {
      kind: "npm-package",
      entryPath,
      sourcePath: installed.sourcePath,
      version: installed.version,
      sourceCodexPath: installed.codexPath,
    };
  }

  const targetBinary = join(runtimeDir, "bin", "codex");
  await copyFile(installed.sourcePath, targetBinary);
  await chmod(targetBinary, 0o755);

  return {
    kind: "binary",
    entryPath: targetBinary,
    sourcePath: installed.sourcePath,
    version: installed.version,
    sourceCodexPath: installed.codexPath,
  };
}

function detectCodexVersion(codexPath: string): string {
  const result = runCaptureSync(codexPath, ["-V"], process.env);
  const joined = `${result.stdout}\n${result.stderr}`;
  const match = joined.match(/codex-cli\s+([^\s]+)/);
  if (match?.[1]) {
    return match[1];
  }
  return "unknown";
}

async function resolveRealPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}
