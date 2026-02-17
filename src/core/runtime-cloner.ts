import { chmod, realpath } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { RuntimeInfo } from "../types.js";
import { copyDir, copyFile, ensureDir, exists, removePath } from "../utils/fs.js";
import { findCommand, runCaptureSync } from "../utils/process.js";

const CODEX_NPM_PACKAGE = "@openai/codex";

interface InstalledCodex {
  codexPath: string;
  version: string;
  kind: "npm-package" | "binary";
  sourcePath: string;
}

export interface InstallRuntimeOptions {
  pinnedVersion?: string;
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

export async function installRuntime(runtimeDir: string, options: InstallRuntimeOptions = {}): Promise<RuntimeInfo> {
  if (options.pinnedVersion && options.pinnedVersion.trim().length > 0) {
    return installRuntimeFromPinnedVersion(runtimeDir, options.pinnedVersion.trim());
  }

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

async function installRuntimeFromPinnedVersion(runtimeDir: string, version: string): Promise<RuntimeInfo> {
  await removePath(runtimeDir);
  await ensureDir(runtimeDir);

  const packageRoot = join(runtimeDir, "package");
  await ensureDir(packageRoot);

  const installResult = runCaptureSync(
    "npm",
    [
      "install",
      "--prefix",
      packageRoot,
      "--no-package-lock",
      "--omit=dev",
      "--no-audit",
      "--no-fund",
      `${CODEX_NPM_PACKAGE}@${version}`,
    ],
    process.env,
  );

  if (installResult.code !== 0) {
    const tail = `${installResult.stdout}\n${installResult.stderr}`.trim().split(/\r?\n/).slice(-20).join("\n");
    throw new Error(`Failed to install pinned Codex ${version} from npm.\n${tail}`);
  }

  const packageDir = resolveInstalledPackageDir(packageRoot, CODEX_NPM_PACKAGE);
  const entryPath = join(packageDir, "bin", "codex.js");
  if (!(await exists(entryPath))) {
    throw new Error(`Pinned Codex install is missing entry script: ${entryPath}`);
  }

  return {
    kind: "npm-package",
    entryPath,
    sourcePath: packageDir,
    version,
    sourceCodexPath: `npm:${CODEX_NPM_PACKAGE}@${version}`,
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

function resolveInstalledPackageDir(packageRoot: string, packageName: string): string {
  const parts = packageName.split("/").filter((part) => part.length > 0);
  return join(packageRoot, "node_modules", ...parts);
}
