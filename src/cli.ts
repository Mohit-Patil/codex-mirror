#!/usr/bin/env node
import { Command } from "commander";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { CloneManager } from "./core/clone-manager.js";
import { assertValidCloneName, sanitizeCloneName } from "./core/clone-name.js";
import { resolveContext } from "./core/context.js";
import { Doctor } from "./core/doctor.js";
import { Launcher } from "./core/launcher.js";
import { detectShell, ensurePathInShellRc, getPathStatus, isDirOnPath, resolveRcFile, ShellKind, sourceCommandFor } from "./core/path-setup.js";
import { RegistryStore } from "./core/registry.js";
import { WrapperManager, WrapperRunner } from "./core/wrapper-manager.js";
import { runTui } from "./tui/index.js";
import { DoctorResult } from "./types.js";
import { sanitizeTerminalOutput, sanitizeTerminalValue } from "./utils/terminal.js";

async function main(): Promise<void> {
  const cliVersion = await resolveCliVersion();
  const context = resolveContext();
  const wrapperRunner = resolveWrapperRunner();
  const registry = new RegistryStore(context.registryPath);
  const wrappers = new WrapperManager(context.defaultBinDir, wrapperRunner);
  const cloneManager = new CloneManager(registry, wrappers);
  const launcher = new Launcher();
  const doctor = new Doctor(launcher);

  const program = new Command();
  program
    .name("codex-mirror")
    .version(cliVersion, "-V, --version", "Output version")
    .description("Manage centrally-stored isolated Codex clones with independent auth/session state")
    .option("--debug", "Enable debug logging")
    .showHelpAfterError();

  program
    .command("create")
    .description("Create a new clone")
    .requiredOption("--name <name>", "Clone name")
    .option("--root <path>", "Advanced: custom clone storage directory (default: ~/.codex-mirror/clones/<name>)")
    .action(async (options: { name: string; root?: string }) => {
      const cloneName = assertValidCloneName(options.name);
      const rootPath = options.root
        ? options.root
        : resolve(context.globalRoot, "clones", sanitizeCloneName(cloneName));
      const clone = await cloneManager.createClone({
        name: cloneName,
        rootPath,
      });
      console.log(`Created clone '${safeText(clone.name)}' at ${safeText(clone.rootPath)}`);
      console.log(`Wrapper: ${safeText(clone.wrapperPath)}`);
      printPathHintIfNeeded(context.defaultBinDir);
    });

  program
    .command("list")
    .description("List clones")
    .option("--json", "Emit JSON output")
    .option("--full", "Show full metadata")
    .action(async (options: { json?: boolean; full?: boolean }) => {
      const clones = await cloneManager.listClones();
      if (options.json) {
        console.log(JSON.stringify(clones, null, 2));
        return;
      }

      if (clones.length === 0) {
        console.log("No clones found.");
        return;
      }

      if (options.full) {
        for (const clone of clones) {
          console.log(`${safeText(clone.name)}`);
          console.log(`  root: ${safeText(clone.rootPath)}`);
          console.log(`  version: ${safeText(clone.codexVersionPinned)}`);
          console.log(`  runtime: ${safeText(clone.runtimeEntryPath)}`);
          console.log(`  wrapper: ${safeText(clone.wrapperPath)}`);
          console.log(`  created: ${safeText(clone.createdAt)}`);
          console.log(`  updated: ${safeText(clone.updatedAt)}`);
          console.log("");
        }
        return;
      }

      for (const clone of clones) {
        console.log(`${safeText(clone.name)}\t${safeText(clone.codexVersionPinned)}\t${safeText(clone.rootPath)}`);
      }
    });

  program
    .command("run")
    .description("Run Codex inside a clone")
    .argument("<name>", "Clone name")
    .argument("[codexArgs...]", "Arguments passed to Codex")
    .allowUnknownOption(true)
    .action(async (name: string, codexArgs: string[]) => {
      const clone = await cloneManager.getClone(name);
      const forwarded = extractPassthroughArgs();
      const args = forwarded.length > 0 ? forwarded : codexArgs;
      const code = await launcher.run(clone, args, process.cwd());
      process.exitCode = code;
    });

  program
    .command("login")
    .description("Run Codex login in clone context")
    .argument("<name>", "Clone name")
    .action(async (name: string) => {
      const clone = await cloneManager.getClone(name);
      const code = await launcher.run(clone, ["login"], process.cwd());
      process.exitCode = code;
    });

  program
    .command("logout")
    .description("Run Codex logout in clone context")
    .argument("<name>", "Clone name")
    .action(async (name: string) => {
      const clone = await cloneManager.getClone(name);
      const code = await launcher.run(clone, ["logout"], process.cwd());
      process.exitCode = code;
    });

  program
    .command("doctor")
    .description("Health check one or all clones")
    .argument("[name]", "Clone name")
    .option("--json", "Emit JSON output")
    .action(async (name: string | undefined, options: { json?: boolean }) => {
      const clones = name
        ? [await cloneManager.getClone(name)]
        : await cloneManager.listClones();
      const results = await doctor.checkMany(clones);
      if (options.json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }
      printDoctor(results);
    });

  program
    .command("update")
    .description("Update one clone or all clones to current Codex version")
    .argument("[name]", "Clone name")
    .option("--all", "Update all clones")
    .action(async (name: string | undefined, options: { all?: boolean }) => {
      if (options.all) {
        const updated = await cloneManager.updateAll();
        console.log(`Updated ${updated.length} clone(s).`);
        return;
      }

      if (!name) {
        throw new Error("Provide a clone name or use --all");
      }

      const updated = await cloneManager.updateClone(name);
      console.log(`Updated clone '${safeText(updated.name)}' to Codex ${safeText(updated.codexVersionPinned)}`);
    });

  program
    .command("remove")
    .description("Remove a clone")
    .argument("<name>", "Clone name")
    .action(async (name: string) => {
      const removed = await cloneManager.removeClone(name);
      console.log(`Removed clone '${safeText(removed.name)}' from ${safeText(removed.rootPath)}`);
    });

  program
    .command("wrapper")
    .description("Install or refresh clone wrapper scripts")
    .command("install")
    .description("Install wrappers for all clones")
    .option("--bin-dir <path>", "Target wrapper directory")
    .action(async (options: { binDir?: string }) => {
      const targetDir = options.binDir ? resolve(options.binDir) : context.defaultBinDir;
      const scopedWrappers = new WrapperManager(targetDir, wrapperRunner);
      const clones = await cloneManager.listClones();
      for (const clone of clones) {
        clone.wrapperPath = await scopedWrappers.installWrapper(clone);
        clone.updatedAt = new Date().toISOString();
        await cloneManager.saveClone(clone);
      }
      console.log(`Installed ${clones.length} wrapper(s) in ${safeText(targetDir)}`);
      printPathHintIfNeeded(targetDir);
    });

  const pathCommand = program.command("path").description("Check or configure shell PATH for clone wrappers");

  pathCommand
    .command("status")
    .description("Show whether wrapper bin directory is on PATH")
    .option("--bin-dir <path>", "Wrapper bin directory to check")
    .option("--shell <kind>", "Target shell: bash|zsh|fish|sh")
    .option("--rc-file <path>", "Shell RC file path override")
    .action(async (options: { binDir?: string; shell?: string; rcFile?: string }) => {
      const shell = parseShellKind(options.shell);
      const status = await getPathStatus({
        binDir: options.binDir ?? context.defaultBinDir,
        shell,
        rcFile: options.rcFile,
      });

      console.log(`Wrapper bin dir: ${safeText(status.normalizedBinDir)}`);
      console.log(`Shell: ${safeText(status.shell)}`);
      console.log(`RC file: ${safeText(status.rcFile)}`);
      console.log(`Managed block: ${status.hasManagedBlock ? "yes" : "no"}`);
      console.log(`On PATH (current session): ${status.onPath ? "yes" : "no"}`);
      if (!status.onPath) {
        console.log("");
        console.log("Run setup to configure shell PATH:");
        console.log("  codex-mirror path setup");
        console.log(`Then reload shell: ${safeText(sourceCommandFor(status.shell, status.rcFile))}`);
      }
    });

  pathCommand
    .command("setup")
    .description("Append/update PATH setup block in your shell RC file")
    .option("--bin-dir <path>", "Wrapper bin directory to add")
    .option("--shell <kind>", "Target shell: bash|zsh|fish|sh")
    .option("--rc-file <path>", "Shell RC file path override")
    .action(async (options: { binDir?: string; shell?: string; rcFile?: string }) => {
      const shell = parseShellKind(options.shell);
      const binDir = options.binDir ?? context.defaultBinDir;
      const result = await ensurePathInShellRc({
        binDir,
        shell,
        rcFile: options.rcFile,
      });
      const status = await getPathStatus({
        binDir,
        shell: result.shell,
        rcFile: result.rcFile,
      });

      console.log(`${result.changed ? "Updated" : "Already configured"}: ${safeText(result.rcFile)}`);
      if (status.onPath) {
        console.log("PATH is already active in this session.");
      } else {
        console.log(`Reload shell now: ${safeText(result.sourceCommand)}`);
      }
    });

  const argv = process.argv.slice(2);
  const wantsMetaOutput =
    argv.includes("-h") ||
    argv.includes("--help") ||
    argv.includes("-V") ||
    argv.includes("--version");
  const hasCommand = argv.some((arg) => !arg.startsWith("-"));

  if (!hasCommand && !wantsMetaOutput) {
    await runTui({
      cloneManager,
      launcher,
      doctor,
      defaultCloneBaseDir: resolve(context.globalRoot, "clones"),
      defaultBinDir: context.defaultBinDir,
    });
    return;
  }

  await program.parseAsync(process.argv);
}

function resolveWrapperRunner(): WrapperRunner {
  const scriptPath = process.argv[1];
  if (!scriptPath) {
    return { command: "codex-mirror", args: [] };
  }

  const resolvedScriptPath = resolve(scriptPath);
  if (/\.m?js$|\.cjs$/.test(resolvedScriptPath)) {
    return { command: process.execPath, args: [resolvedScriptPath] };
  }

  return { command: resolvedScriptPath, args: [] };
}

function extractPassthroughArgs(): string[] {
  const index = process.argv.indexOf("--");
  if (index === -1) {
    return [];
  }
  return process.argv.slice(index + 1);
}

function printDoctor(results: DoctorResult[]): void {
  if (results.length === 0) {
    console.log("No clones found.");
    return;
  }

  for (const result of results) {
    console.log(`${result.ok ? "OK" : "FAIL"} ${safeText(result.name)}`);
    console.log(`  runtime: ${safeText(result.runtimePath)}`);
    console.log(`  wrapper: ${safeText(result.wrapperPath)}`);
    console.log(`  auth: ${safeText(result.authStatus)}`);
    console.log(`  writable: ${result.writable ? "yes" : "no"}`);
    if (result.errors.length > 0) {
      for (const error of result.errors) {
        console.log(`  error: ${safeText(error)}`);
      }
    }
    console.log("");
  }
}

function printPathHintIfNeeded(binDir: string): void {
  if (isDirOnPath(binDir)) {
    return;
  }
  const shell = detectShell(process.env.SHELL);
  const rcFile = resolveRcFile(shell, process.env.HOME ?? homedir());
  console.log("");
  console.log(`PATH notice: wrappers are installed in ${safeText(binDir)}`);
  console.log("That directory is not on PATH in this session.");
  console.log("Run: codex-mirror path setup");
  console.log(`Then reload shell: ${safeText(sourceCommandFor(shell, rcFile))}`);
}

function parseShellKind(value: string | undefined): ShellKind | undefined {
  if (!value) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "bash" || normalized === "zsh" || normalized === "fish" || normalized === "sh") {
    return normalized;
  }
  throw new Error(`Unsupported shell '${safeText(value)}'. Use one of: bash, zsh, fish, sh`);
}

async function resolveCliVersion(): Promise<string> {
  const envVersion = process.env.npm_package_version;
  if (envVersion && envVersion.trim().length > 0) {
    return safeText(envVersion.trim());
  }

  try {
    const packageJsonPath = new URL("../package.json", import.meta.url);
    const raw = await readFile(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    if (parsed.version && parsed.version.trim().length > 0) {
      return safeText(parsed.version.trim());
    }
  } catch {
    // Fallback below if package metadata cannot be read.
  }

  return "0.0.0";
}

function safeText(value: string): string {
  return sanitizeTerminalOutput(value);
}

main().catch((error: unknown) => {
  const message = sanitizeTerminalValue(error instanceof Error ? error.message : String(error));
  console.error(`Error: ${message}`);
  process.exitCode = 1;
});
