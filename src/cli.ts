#!/usr/bin/env node
import { Command } from "commander";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CloneManager } from "./core/clone-manager.js";
import { assertValidCloneName, sanitizeCloneName } from "./core/clone-name.js";
import { resolveContext } from "./core/context.js";
import { Doctor } from "./core/doctor.js";
import { Launcher } from "./core/launcher.js";
import { RegistryStore } from "./core/registry.js";
import { WrapperManager, WrapperRunner } from "./core/wrapper-manager.js";
import { runTui } from "./tui/index.js";
import { DoctorResult } from "./types.js";

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
      console.log(`Created clone '${clone.name}' at ${clone.rootPath}`);
      console.log(`Wrapper: ${clone.wrapperPath}`);
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
          console.log(`${clone.name}`);
          console.log(`  root: ${clone.rootPath}`);
          console.log(`  version: ${clone.codexVersionPinned}`);
          console.log(`  runtime: ${clone.runtimeEntryPath}`);
          console.log(`  wrapper: ${clone.wrapperPath}`);
          console.log(`  created: ${clone.createdAt}`);
          console.log(`  updated: ${clone.updatedAt}`);
          console.log("");
        }
        return;
      }

      for (const clone of clones) {
        console.log(`${clone.name}\t${clone.codexVersionPinned}\t${clone.rootPath}`);
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
      console.log(`Updated clone '${updated.name}' to Codex ${updated.codexVersionPinned}`);
    });

  program
    .command("remove")
    .description("Remove a clone")
    .argument("<name>", "Clone name")
    .action(async (name: string) => {
      const removed = await cloneManager.removeClone(name);
      console.log(`Removed clone '${removed.name}' from ${removed.rootPath}`);
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
      console.log(`Installed ${clones.length} wrapper(s) in ${targetDir}`);
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
    console.log(`${result.ok ? "OK" : "FAIL"} ${result.name}`);
    console.log(`  runtime: ${result.runtimePath}`);
    console.log(`  wrapper: ${result.wrapperPath}`);
    console.log(`  auth: ${result.authStatus}`);
    console.log(`  writable: ${result.writable ? "yes" : "no"}`);
    if (result.errors.length > 0) {
      for (const error of result.errors) {
        console.log(`  error: ${error}`);
      }
    }
    console.log("");
  }
}

async function resolveCliVersion(): Promise<string> {
  const envVersion = process.env.npm_package_version;
  if (envVersion && envVersion.trim().length > 0) {
    return envVersion.trim();
  }

  try {
    const packageJsonPath = new URL("../package.json", import.meta.url);
    const raw = await readFile(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    if (parsed.version && parsed.version.trim().length > 0) {
      return parsed.version.trim();
    }
  } catch {
    // Fallback below if package metadata cannot be read.
  }

  return "0.0.0";
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Error: ${message}`);
  process.exitCode = 1;
});
