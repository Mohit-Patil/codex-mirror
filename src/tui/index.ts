import { basename, resolve } from "node:path";
import { CloneManager } from "../core/clone-manager.js";
import { sanitizeCloneName, validateCloneName } from "../core/clone-name.js";
import { Doctor } from "../core/doctor.js";
import { Launcher } from "../core/launcher.js";
import { CloneRecord, DoctorResult } from "../types.js";
import { promptConfirm, promptMenu, promptText, renderPanel } from "./menu.js";

interface TuiDeps {
  cloneManager: CloneManager;
  launcher: Launcher;
  doctor: Doctor;
  defaultCloneBaseDir: string;
}

interface DashboardSummary {
  total: number;
  healthy: number;
  issues: number;
  loggedIn: number;
  notLoggedIn: number;
  unknownAuth: number;
}

type MainAction = "quick" | "create" | "manage" | "update-all" | "doctor" | "about" | "exit";

export async function runTui(deps: TuiDeps): Promise<void> {
  const healthCache = new Map<string, DoctorResult>();

  while (true) {
    try {
      const clones = await deps.cloneManager.listClones();
      const action = await promptMenu<MainAction>({
        title: "CODEX MIRROR",
        subtitle: "Multi-account Codex clone manager",
        statusLines: buildDashboardStatusLines(clones, healthCache),
        items: [
          { label: "Quick Clone", value: "quick", description: "Name only, ready in seconds" },
          { label: "New Clone Wizard", value: "create", description: "Guided clone creation" },
          { label: "Manage Clones", value: "manage", description: "Run, login, logout, update, remove" },
          { label: "Update All Clones", value: "update-all", description: "Re-pin all clones to current Codex" },
          { label: "Diagnostics", value: "doctor", description: "Health check one or all clones" },
          { label: "About", value: "about", description: "Project behavior and notes" },
          { label: "Exit", value: "exit" },
        ],
        footer: "Up/Down navigate | Enter select | q exit",
        cancelValue: "exit",
      });

      if (action === "quick") {
        await quickClone(deps);
        continue;
      }
      if (action === "create") {
        await createCloneWizard(deps);
        continue;
      }
      if (action === "manage") {
        await manageClones(deps, healthCache);
        continue;
      }
      if (action === "update-all") {
        await updateAllClones(deps);
        continue;
      }
      if (action === "doctor") {
        await diagnostics(deps, healthCache);
        continue;
      }
      if (action === "about") {
        printAbout();
        await waitContinue("About Codex Mirror", "Return to main menu", []);
        continue;
      }
      if (action === "exit") {
        return;
      }
    } catch (error) {
      if (isUserAbort(error)) {
        continue;
      }
      await waitContinue("TUI Error", "An unexpected error occurred", [toErrorMessage(error)]);
    }
  }
}

async function quickClone(deps: TuiDeps): Promise<void> {
  const name = await promptText({
    title: "Quick Clone",
    subtitle: "Name only, ready in seconds",
    sectionTitle: "Step 1 of 2",
    lines: ["Provide a clone name.", "Each clone gets isolated runtime and auth state."],
    label: "Clone name",
    footer: "Type name | Enter continue | Esc cancel",
    validate: validateCloneNameForPrompt,
  });

  const normalized = name.trim();
  const suggestedRoot = resolve(deps.defaultCloneBaseDir, sanitizeCloneName(normalized));

  const shouldCreate = await promptConfirm({
    title: "Quick Clone",
    subtitle: "Name only, ready in seconds",
    sectionTitle: "Step 2 of 2",
    lines: [`Name: ${normalized}`, `Storage: ${suggestedRoot}`, "Create this clone now?"],
    footer: "Up/Down navigate | Enter select | Esc cancel",
    defaultValue: true,
  });

  if (!shouldCreate) {
    await waitContinue("Quick Clone", "Cancelled", []);
    return;
  }

  renderPanel({
    title: "Quick Clone",
    subtitle: "Working",
    lines: ["Creating isolated runtime + wrapper...", "This can take a few seconds."],
    footer: "Please wait",
  });

  const clone = await deps.cloneManager.createClone({ name: normalized, rootPath: suggestedRoot });

  const doLogin = await promptConfirm({
    title: "Quick Clone",
    subtitle: "Optional login",
    lines: ["Run 'codex login' for this clone now?"],
    defaultValue: false,
    confirmLabel: "Login now",
    cancelLabel: "Skip",
  });

  if (doLogin) {
    await deps.launcher.run(clone, ["login"]);
  }

  await waitContinue("Clone Created", "Quick clone complete", [
    `Name: ${clone.name}`,
    `Path: ${clone.rootPath}`,
    `Wrapper: ${clone.wrapperPath}`,
  ]);
}

async function createCloneWizard(deps: TuiDeps): Promise<void> {
  const name = await promptText({
    title: "New Clone Wizard",
    subtitle: "Guided clone creation",
    sectionTitle: "Step 1 of 3",
    lines: ["Choose a clone name.", "Name must be filesystem-safe and unique."],
    label: "Clone name",
    footer: "Type name | Enter continue | Esc cancel",
    validate: validateCloneNameForPrompt,
  });

  const normalized = name.trim();
  const suggestedRoot = resolve(deps.defaultCloneBaseDir, sanitizeCloneName(normalized));

  const shouldCreate = await promptConfirm({
    title: "New Clone Wizard",
    subtitle: "Guided clone creation",
    sectionTitle: "Step 2 of 3",
    lines: [`Name: ${normalized}`, `Storage: ${suggestedRoot}`, "Create this clone now?"],
    footer: "Up/Down navigate | Enter select | Esc cancel",
    defaultValue: true,
  });

  if (!shouldCreate) {
    await waitContinue("New Clone Wizard", "Cancelled", []);
    return;
  }

  renderPanel({
    title: "New Clone Wizard",
    subtitle: "Guided clone creation",
    sectionTitle: "Step 3 of 3",
    lines: ["Creating isolated runtime + state folders...", "This can take a few seconds."],
    footer: "Please wait",
  });

  const clone = await deps.cloneManager.createClone({ name: normalized, rootPath: suggestedRoot });

  const doLogin = await promptConfirm({
    title: "New Clone Wizard",
    subtitle: "Optional login",
    lines: ["Run 'codex login' for this clone now?"],
    defaultValue: false,
    confirmLabel: "Login now",
    cancelLabel: "Skip",
  });

  if (doLogin) {
    await deps.launcher.run(clone, ["login"]);
  }

  await waitContinue("Clone Created", "Wizard complete", [
    `Name: ${clone.name}`,
    `Path: ${clone.rootPath}`,
    `Wrapper: ${clone.wrapperPath}`,
  ]);
}

async function manageClones(deps: TuiDeps, healthCache: Map<string, DoctorResult>): Promise<void> {
  while (true) {
    const clones = await deps.cloneManager.listClones();
    if (clones.length === 0) {
      const action = await promptMenu<"create" | "back">({
        title: "Manage Clones",
        subtitle: "No clones found",
        statusLines: ["No clones yet. Create one first."],
        items: [
          { label: "Create Clone", value: "create", description: "Open New Clone Wizard" },
          { label: "Back", value: "back" },
        ],
        initialIndex: 0,
        cancelValue: "back",
      });

      if (action === "create") {
        await createCloneWizard(deps);
        continue;
      }
      return;
    }

    const selected = await promptMenu<string>({
      title: "Manage Clones",
      subtitle: "Select a clone",
      statusLines: ["Choose clone, then run/login/logout/update/remove actions."],
      items: [
        ...clones.map((clone) => {
          const cached = healthCache.get(clone.name);
          const health = cached ? (cached.ok ? "OK" : "ISSUE") : "UNKNOWN";
          const auth = cached?.authStatus ?? "unknown";
          return {
            label: `${clone.name} [${health}] [${auth}]`,
            value: clone.name,
            description: `${clone.codexVersionPinned} · ${shortenPathForDisplay(clone.rootPath, 34)}`,
          };
        }),
        { label: "Back", value: "__back" },
      ],
      cancelValue: "__back",
    });

    if (selected === "__back") {
      return;
    }

    const clone = clones.find((item) => item.name === selected);
    if (!clone) {
      continue;
    }

    await manageCloneActions(deps, clone, healthCache);
  }
}

async function manageCloneActions(
  deps: TuiDeps,
  clone: CloneRecord,
  healthCache: Map<string, DoctorResult>,
): Promise<void> {
  while (true) {
    const action = await promptMenu<string>({
      title: `Clone: ${clone.name}`,
      subtitle: `${shortenPathForDisplay(clone.rootPath, 68)} · Codex ${clone.codexVersionPinned}`,
      statusLines: [`Wrapper: ${shortenPathForDisplay(clone.wrapperPath, 68)}`],
      items: [
        { label: "Run (interactive)", value: "run" },
        { label: "Run with args", value: "run-args" },
        { label: "Login", value: "login" },
        { label: "Logout", value: "logout" },
        { label: "Doctor", value: "doctor" },
        { label: "Update runtime", value: "update" },
        { label: "Remove clone", value: "remove" },
        { label: "Back", value: "back" },
      ],
      cancelValue: "back",
    });

    if (action === "run") {
      await deps.launcher.run(clone, []);
      continue;
    }

    if (action === "run-args") {
      const rawArgs = await promptText({
        title: `Clone: ${clone.name}`,
        subtitle: "Run with args",
        lines: ['Example: `exec "hello"` or `--model o3`'],
        label: "Arguments",
        footer: "Type args | Enter run | Esc cancel",
      });
      const args = splitArgs(rawArgs);
      await deps.launcher.run(clone, args);
      continue;
    }

    if (action === "login") {
      await deps.launcher.run(clone, ["login"]);
      continue;
    }

    if (action === "logout") {
      await deps.launcher.run(clone, ["logout"]);
      continue;
    }

    if (action === "doctor") {
      const result = await deps.doctor.checkOne(clone);
      healthCache.set(clone.name, result);
      await showDoctorResults([result]);
      continue;
    }

    if (action === "update") {
      const updated = await deps.cloneManager.updateClone(clone.name);
      clone.codexVersionPinned = updated.codexVersionPinned;
      clone.updatedAt = updated.updatedAt;
      clone.runtimeEntryPath = updated.runtimeEntryPath;
      clone.runtimeKind = updated.runtimeKind;
      clone.wrapperPath = updated.wrapperPath;
      await waitContinue("Clone Updated", clone.name, [`Pinned Codex version: ${clone.codexVersionPinned}`]);
      continue;
    }

    if (action === "remove") {
      const shouldRemove = await promptConfirm({
        title: `Clone: ${clone.name}`,
        subtitle: "Remove clone",
        lines: [`Delete clone '${clone.name}'? This removes runtime + local state.`],
        defaultValue: false,
        confirmLabel: "Remove",
        cancelLabel: "Cancel",
      });
      if (!shouldRemove) {
        continue;
      }
      await deps.cloneManager.removeClone(clone.name);
      healthCache.delete(clone.name);
      await waitContinue("Clone Removed", clone.name, []);
      return;
    }

    if (action === "back") {
      return;
    }
  }
}

async function updateAllClones(deps: TuiDeps): Promise<void> {
  const clones = await deps.cloneManager.listClones();
  if (clones.length === 0) {
    await waitContinue("Update All Clones", "No clones found", ["Create at least one clone first."]);
    return;
  }

  const shouldUpdate = await promptConfirm({
    title: "Update All Clones",
    subtitle: "Bulk runtime update",
    lines: [`Update all ${clones.length} clone(s) to current Codex version?`],
    defaultValue: true,
  });

  if (!shouldUpdate) {
    return;
  }

  const updated = await deps.cloneManager.updateAll();
  await waitContinue("Update All Clones", "Completed", [`Updated ${updated.length} clone(s).`]);
}

async function diagnostics(deps: TuiDeps, healthCache: Map<string, DoctorResult>): Promise<void> {
  const clones = await deps.cloneManager.listClones();
  if (clones.length === 0) {
    await waitContinue("Diagnostics", "No clones found", ["Create at least one clone to run diagnostics."]);
    return;
  }

  const scope = await promptMenu<"all" | "one" | "back">({
    title: "Diagnostics",
    subtitle: "Health check scope",
    statusLines: ["Run detailed health checks with auth status detection."],
    items: [
      { label: "All clones", value: "all" },
      { label: "Single clone", value: "one" },
      { label: "Back", value: "back" },
    ],
    cancelValue: "back",
  });

  if (scope === "back") {
    return;
  }

  if (scope === "all") {
    renderPanel({
      title: "Diagnostics",
      subtitle: "Running checks",
      lines: [`Checking ${clones.length} clone(s)...`],
      footer: "Please wait",
    });
    const results = await deps.doctor.checkMany(clones);
    for (const result of results) {
      healthCache.set(result.name, result);
    }
    await showDoctorResults(results);
    return;
  }

  const selected = await promptMenu<string>({
    title: "Diagnostics",
    subtitle: "Select clone",
    statusLines: ["Run deep health check for one clone."],
    items: [...clones.map((clone) => ({ label: clone.name, value: clone.name })), { label: "Back", value: "__back" }],
    cancelValue: "__back",
  });

  if (selected === "__back") {
    return;
  }

  const clone = clones.find((item) => item.name === selected);
  if (!clone) {
    return;
  }

  renderPanel({
    title: "Diagnostics",
    subtitle: clone.name,
    lines: ["Running health check..."],
    footer: "Please wait",
  });

  const result = await deps.doctor.checkOne(clone);
  healthCache.set(result.name, result);
  await showDoctorResults([result]);
}

function buildDashboardStatusLines(clones: CloneRecord[], healthCache: Map<string, DoctorResult>): string[] {
  const lines: string[] = [];
  const cachedResults = clones
    .map((clone) => healthCache.get(clone.name))
    .filter((result): result is DoctorResult => result !== undefined);

  const summary = summarize(cachedResults);
  lines.push(`Clones: ${clones.length}`);

  if (cachedResults.length === 0) {
    lines.push("Health: unknown (run Diagnostics to populate)");
    lines.push("Auth: unknown");
  } else {
    lines.push(`Health: ${summary.healthy} healthy / ${summary.issues} issues`);
    lines.push(
      `Auth: logged_in ${summary.loggedIn} | not_logged_in ${summary.notLoggedIn} | unknown ${summary.unknownAuth}`,
    );
    if (cachedResults.length < clones.length) {
      lines.push(`Cached health for ${cachedResults.length}/${clones.length} clone(s).`);
    }
  }

  if (clones.length === 0) {
    lines.push("No clones yet. Create one from Quick Clone.");
    return lines;
  }

  lines.push("Recent clones:");
  for (const clone of clones.slice(0, 5)) {
    const result = healthCache.get(clone.name);
    const health = result ? (result.ok ? "OK" : "ISSUE") : "UNKNOWN";
    const auth = result?.authStatus ?? "unknown";
    lines.push(`- ${clone.name} [${health}] [${auth}] ${shortenPathForDisplay(clone.rootPath, 34)}`);
  }

  return lines;
}

function summarize(results: DoctorResult[]): DashboardSummary {
  const summary: DashboardSummary = {
    total: results.length,
    healthy: 0,
    issues: 0,
    loggedIn: 0,
    notLoggedIn: 0,
    unknownAuth: 0,
  };

  for (const result of results) {
    if (result.ok) {
      summary.healthy += 1;
    } else {
      summary.issues += 1;
    }

    if (result.authStatus === "logged_in") {
      summary.loggedIn += 1;
    } else if (result.authStatus === "not_logged_in") {
      summary.notLoggedIn += 1;
    } else {
      summary.unknownAuth += 1;
    }
  }

  return summary;
}

function printAbout(): void {
  renderPanel({
    title: "About Codex Mirror",
    subtitle: "Project behavior and notes",
    lines: [
      "Creates centrally-managed isolated Codex clones.",
      "Each clone has its own auth/session/config state.",
      "Runtime is pinned per clone and updated on demand.",
      "Diagnostics checks runtime, wrapper, writable paths, and auth status.",
      "Use Quick Clone for fastest flow, Wizard for guided setup.",
    ],
    footer: "Open source utility for multi-account local workflows",
  });
}

async function waitContinue(title: string, subtitle: string, lines: string[]): Promise<void> {
  await promptMenu<"continue">({
    title,
    subtitle,
    statusLines: lines.length > 0 ? lines : [" "],
    summaryTitle: "[ Details ]",
    items: [{ label: "Continue", value: "continue" }],
    actionsTitle: "[ Continue ]",
    footer: "Enter to continue | Esc back",
    cancelValue: "continue",
  });
}

async function showDoctorResults(results: DoctorResult[]): Promise<void> {
  const lines: string[] = [];
  if (results.length === 0) {
    lines.push("No diagnostics results.");
  } else {
    for (const result of results) {
      lines.push(`${result.ok ? "OK" : "FAIL"} ${result.name}`);
      lines.push(`  auth: ${result.authStatus} | writable: ${result.writable ? "yes" : "no"}`);
      lines.push(`  runtime: ${shortenPathForDisplay(result.runtimePath, 74)}`);
      lines.push(`  wrapper: ${shortenPathForDisplay(result.wrapperPath, 74)}`);
      if (result.errors.length > 0) {
        for (const error of result.errors) {
          lines.push(`  - ${error}`);
        }
      }
    }
  }

  await promptMenu<"back">({
    title: "Diagnostics Results",
    subtitle: "Health checks",
    statusLines: lines,
    summaryTitle: "[ Results ]",
    items: [{ label: "Back", value: "back" }],
    actionsTitle: "[ Next ]",
    footer: "Enter to return | Esc back",
    cancelValue: "back",
  });
}

function splitArgs(value: string): string[] {
  if (!value.trim()) {
    return [];
  }

  const matches = value.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g);
  if (!matches) {
    return [];
  }

  return matches.map((part) => part.replace(/^"|"$/g, "").replace(/^'|'$/g, ""));
}

function validateCloneNameForPrompt(value: string): true | string {
  const result = validateCloneName(value);
  return result.ok ? true : result.error ?? "Invalid clone name";
}

export function shortenPathForDisplay(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  const suffix = basename(value);
  const headBudget = Math.max(0, maxLength - suffix.length - 4);
  const head = value.slice(0, headBudget);
  return `${head}.../${suffix}`.slice(0, maxLength);
}

function isUserAbort(error: unknown): boolean {
  const message = toErrorMessage(error).toLowerCase();
  return (
    message.includes("aborted by user") ||
    message.includes("user force closed") ||
    message.includes("sigint") ||
    message.includes("cancelled")
  );
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
