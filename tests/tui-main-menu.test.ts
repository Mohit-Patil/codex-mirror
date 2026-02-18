import { beforeEach, describe, expect, it, vi } from "vitest";
import { CloneRecord, DoctorResult } from "../src/types.js";

const menuMocks = vi.hoisted(() => ({
  promptMenu: vi.fn(),
  promptConfirm: vi.fn(),
  promptText: vi.fn(),
  renderPanel: vi.fn(),
}));

const pathSetupMocks = vi.hoisted(() => ({
  detectShell: vi.fn(),
  ensurePathInShellRc: vi.fn(),
  getPathStatus: vi.fn(),
  isDirOnPath: vi.fn(),
  resolveRcFile: vi.fn(),
  sourceCommandFor: vi.fn(),
}));

const processMocks = vi.hoisted(() => ({
  openUrl: vi.fn(),
}));

vi.mock("../src/tui/menu.js", () => ({
  promptMenu: menuMocks.promptMenu,
  promptConfirm: menuMocks.promptConfirm,
  promptText: menuMocks.promptText,
  renderPanel: menuMocks.renderPanel,
}));

vi.mock("../src/core/path-setup.js", () => ({
  detectShell: pathSetupMocks.detectShell,
  ensurePathInShellRc: pathSetupMocks.ensurePathInShellRc,
  getPathStatus: pathSetupMocks.getPathStatus,
  isDirOnPath: pathSetupMocks.isDirOnPath,
  resolveRcFile: pathSetupMocks.resolveRcFile,
  sourceCommandFor: pathSetupMocks.sourceCommandFor,
}));

vi.mock("../src/utils/process.js", () => ({
  openUrl: processMocks.openUrl,
}));

import { runTui } from "../src/tui/index.js";

type MainAction = "quick" | "manage" | "update-all" | "doctor" | "path-setup" | "star" | "about" | "exit";

interface MenuCall<T = unknown> {
  title: string;
  subtitle?: string;
  statusLines?: string[];
  items: Array<{ label: string; value: T; description?: string }>;
  cancelValue?: T;
}

describe("runTui main menu actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    menuMocks.promptText.mockResolvedValue("demo");
    menuMocks.promptConfirm.mockResolvedValue(false);

    pathSetupMocks.detectShell.mockReturnValue("zsh");
    pathSetupMocks.resolveRcFile.mockReturnValue("/tmp/.zshrc");
    pathSetupMocks.sourceCommandFor.mockReturnValue("source /tmp/.zshrc");
    pathSetupMocks.isDirOnPath.mockReturnValue(true);
    pathSetupMocks.getPathStatus.mockResolvedValue({
      onPath: true,
      normalizedBinDir: "/tmp/bin",
      shell: "zsh",
      rcFile: "/tmp/.zshrc",
      hasManagedBlock: true,
    });
    pathSetupMocks.ensurePathInShellRc.mockResolvedValue({
      changed: false,
      shell: "zsh",
      rcFile: "/tmp/.zshrc",
      sourceCommand: "source /tmp/.zshrc",
    });
    processMocks.openUrl.mockResolvedValue(undefined);
  });

  it("defines all main menu items with descriptions (except Exit)", async () => {
    const deps = createDeps([]);
    menuMocks.promptMenu.mockImplementation(async (options: MenuCall) => {
      if (options.title === "CODEX MIRROR") {
        return "exit";
      }
      return fallbackSelection(options);
    });

    await runTui(deps);

    const firstCall = getMenuCalls()[0];
    expect(firstCall?.title).toBe("CODEX MIRROR");
    expect(firstCall?.items.map((item) => item.label)).toEqual([
      "Quick Clone",
      "Manage Clones",
      "Update All Clones",
      "Diagnostics",
      "Shell PATH Setup",
      "Star on GitHub",
      "About",
      "Exit",
    ]);

    const described = firstCall?.items.slice(0, 7) ?? [];
    expect(described.every((item) => typeof item.description === "string" && item.description.trim().length > 0)).toBe(
      true,
    );
  });

  it("opens repository from Star on GitHub (option 6)", async () => {
    const deps = createDeps([]);
    await runWithMainActions(["star", "exit"], deps);

    expect(processMocks.openUrl).toHaveBeenCalledOnce();
    const starCall = getMenuCalls().find((call) => call.title === "Star on GitHub");
    expect(starCall?.subtitle).toBe("Repository opened");
    expect(allLinesNonEmpty(starCall?.statusLines)).toBe(true);
  });

  it("shows About content (option 7) with non-empty details", async () => {
    const deps = createDeps([]);
    await runWithMainActions(["about", "exit"], deps);

    const aboutCall = getMenuCalls().find((call) => call.title === "About Codex Mirror");
    expect(aboutCall).toBeDefined();
    expect(aboutCall?.statusLines?.length).toBeGreaterThan(0);
    expect(aboutCall?.statusLines?.some((line) => line.includes("isolated Codex clones"))).toBe(true);
    expect(allLinesNonEmpty(aboutCall?.statusLines)).toBe(true);
  });

  it("handles Quick Clone (option 1) cancel path with visible status", async () => {
    const deps = createDeps([]);
    menuMocks.promptConfirm.mockResolvedValue(false);
    await runWithMainActions(["quick", "exit"], deps);

    expect(deps.cloneManager.createClone).not.toHaveBeenCalled();
    const quickCancelled = getMenuCalls().find((call) => call.title === "Quick Clone" && call.subtitle === "Cancelled");
    expect(quickCancelled?.statusLines).toEqual(["No clone was created."]);
  });

  it("shows no-clone guidance in Manage Clones (option 2)", async () => {
    const deps = createDeps([]);
    await runWithMainActions(["manage", "exit"], deps);

    const manageEmpty = getMenuCalls().find((call) => call.title === "Manage Clones" && call.subtitle === "No clones found");
    expect(manageEmpty).toBeDefined();
    expect(manageEmpty?.statusLines).toEqual(["No clones yet. Create one first."]);
  });

  it("shows no-clone guidance in Update All Clones (option 3)", async () => {
    const deps = createDeps([]);
    await runWithMainActions(["update-all", "exit"], deps);

    const updateAllEmpty = getMenuCalls().find(
      (call) => call.title === "Update All Clones" && call.subtitle === "No clones found",
    );
    expect(updateAllEmpty?.statusLines).toEqual(["Create at least one clone first."]);
  });

  it("shows no-clone guidance in Diagnostics (option 4)", async () => {
    const deps = createDeps([]);
    await runWithMainActions(["doctor", "exit"], deps);

    const diagnosticsEmpty = getMenuCalls().find((call) => call.title === "Diagnostics" && call.subtitle === "No clones found");
    expect(diagnosticsEmpty?.statusLines).toEqual(["Create at least one clone to run diagnostics."]);
  });

  it("shows status details in Shell PATH Setup (option 5) when already active", async () => {
    const deps = createDeps([]);
    await runWithMainActions(["path-setup", "exit"], deps);

    const pathSetup = getMenuCalls().find((call) => call.title === "Shell PATH Setup" && call.subtitle === "Already active");
    expect(pathSetup).toBeDefined();
    expect(allLinesNonEmpty(pathSetup?.statusLines)).toBe(true);
  });

  it("supports star-and-exit path from Exit (option 8)", async () => {
    const deps = createDeps([]);
    const queue: MainAction[] = ["exit"];
    menuMocks.promptMenu.mockImplementation(async (options: MenuCall) => {
      if (options.title === "CODEX MIRROR") {
        return queue.shift() ?? "exit";
      }
      if (options.title === "Exit Codex Mirror") {
        return "star-exit";
      }
      return fallbackSelection(options);
    });

    await runTui(deps);

    expect(processMocks.openUrl).toHaveBeenCalledOnce();
  });

  it("exits cleanly from Exit (option 8)", async () => {
    const deps = createDeps([]);
    await runWithMainActions(["exit"], deps);

    const codeMirrorCalls = getMenuCalls().filter((call) => call.title === "CODEX MIRROR");
    expect(codeMirrorCalls).toHaveLength(1);
  });
});

function createDeps(clones: CloneRecord[]) {
  const cloneManager = {
    listClones: vi.fn(async () => clones),
    createClone: vi.fn(async ({ name, rootPath }: { name: string; rootPath: string }) => buildClone(name, rootPath)),
    updateClone: vi.fn(async (name: string) => buildClone(name, `/tmp/clones/${name}`)),
    updateAll: vi.fn(async () => clones.map((clone) => buildClone(clone.name, clone.rootPath))),
    removeClone: vi.fn(async (name: string) => buildClone(name, `/tmp/clones/${name}`)),
  };

  const launcher = {
    run: vi.fn(async () => 0),
  };

  const doctor = {
    checkOne: vi.fn(async (clone: CloneRecord) => buildDoctorResult(clone)),
    checkMany: vi.fn(async (input: CloneRecord[]) => input.map((clone) => buildDoctorResult(clone))),
  };

  return {
    cloneManager,
    launcher,
    doctor,
    defaultCloneBaseDir: "/tmp/clones",
    defaultBinDir: "/tmp/bin",
  };
}

async function runWithMainActions(actions: MainAction[], deps: ReturnType<typeof createDeps>): Promise<void> {
  const queue = [...actions];

  menuMocks.promptMenu.mockImplementation(async (options: MenuCall) => {
    if (options.title === "CODEX MIRROR") {
      return queue.shift() ?? "exit";
    }
    return fallbackSelection(options);
  });

  await runTui(deps);
}

function fallbackSelection(options: MenuCall): unknown {
  if (options.title === "Exit Codex Mirror") {
    return "exit";
  }

  const continueItem = options.items.find((item) => item.value === "continue");
  if (continueItem) {
    return continueItem.value;
  }

  const backItem = options.items.find((item) => item.value === "back" || item.value === "__back");
  if (backItem) {
    return backItem.value;
  }

  if (options.cancelValue !== undefined) {
    return options.cancelValue;
  }

  return options.items[0]?.value;
}

function getMenuCalls(): MenuCall[] {
  return menuMocks.promptMenu.mock.calls.map(([options]) => options as MenuCall);
}

function buildClone(name: string, rootPath: string): CloneRecord {
  return {
    id: `id-${name}`,
    name,
    rootPath,
    runtimePath: `${rootPath}/runtime`,
    runtimeEntryPath: `${rootPath}/runtime/bin/codex`,
    runtimeKind: "binary",
    wrapperPath: `/tmp/bin/${name}`,
    codexVersionPinned: "0.0.0",
    createdAt: "2026-02-18T00:00:00.000Z",
    updatedAt: "2026-02-18T00:00:00.000Z",
  };
}

function buildDoctorResult(clone: CloneRecord): DoctorResult {
  return {
    name: clone.name,
    ok: true,
    runtimePath: clone.runtimePath,
    wrapperPath: clone.wrapperPath,
    authStatus: "unknown",
    writable: true,
    errors: [],
  };
}

function allLinesNonEmpty(lines: string[] | undefined): boolean {
  if (!lines || lines.length === 0) {
    return false;
  }
  return lines.every((line) => line.trim().length > 0);
}
