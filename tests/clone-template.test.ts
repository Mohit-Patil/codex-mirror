import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MINIMAX_RECOMMENDED_CODEX_VERSION,
  applyCloneTemplate,
  ensureMiniMaxConfigCompatibility,
  parseCloneTemplate,
  resolveTemplateRuntimePin,
  templateLabel,
} from "../src/core/clone-template.js";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe("clone template", () => {
  it("parses aliases for official template", () => {
    expect(parseCloneTemplate(undefined)).toBe("official");
    expect(parseCloneTemplate("official")).toBe("official");
    expect(parseCloneTemplate("codex")).toBe("official");
    expect(parseCloneTemplate("default")).toBe("official");
  });

  it("parses minimax template", () => {
    expect(parseCloneTemplate("minimax")).toBe("minimax");
  });

  it("throws on unsupported template", () => {
    expect(() => parseCloneTemplate("unknown")).toThrow("Unsupported template");
  });

  it("returns human labels", () => {
    expect(templateLabel("official")).toBe("Official Codex");
    expect(templateLabel("minimax")).toBe("MiniMax");
  });

  it("resolves runtime pin for minimax template", () => {
    const previousDisable = process.env.CODEX_MIRROR_DISABLE_MINIMAX_RUNTIME_PIN;
    const previousVersion = process.env.CODEX_MIRROR_MINIMAX_CODEX_VERSION;
    delete process.env.CODEX_MIRROR_DISABLE_MINIMAX_RUNTIME_PIN;
    delete process.env.CODEX_MIRROR_MINIMAX_CODEX_VERSION;

    expect(resolveTemplateRuntimePin("official")).toBeUndefined();
    expect(resolveTemplateRuntimePin("minimax")).toBe(MINIMAX_RECOMMENDED_CODEX_VERSION);

    process.env.CODEX_MIRROR_MINIMAX_CODEX_VERSION = "0.55.0";
    expect(resolveTemplateRuntimePin("minimax")).toBe("0.55.0");

    process.env.CODEX_MIRROR_DISABLE_MINIMAX_RUNTIME_PIN = "1";
    expect(resolveTemplateRuntimePin("minimax")).toBeUndefined();

    if (previousDisable === undefined) {
      delete process.env.CODEX_MIRROR_DISABLE_MINIMAX_RUNTIME_PIN;
    } else {
      process.env.CODEX_MIRROR_DISABLE_MINIMAX_RUNTIME_PIN = previousDisable;
    }
    if (previousVersion === undefined) {
      delete process.env.CODEX_MIRROR_MINIMAX_CODEX_VERSION;
    } else {
      process.env.CODEX_MIRROR_MINIMAX_CODEX_VERSION = previousVersion;
    }
  });

  it("writes minimax config and default args", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-mirror-template-"));
    tempDirs.push(root);
    const codexHomeDir = join(root, ".codex");

    const applied = await applyCloneTemplate("minimax", codexHomeDir);
    expect(applied.defaultCodexArgs).toEqual(["--profile", "m21"]);

    const config = await readFile(join(codexHomeDir, "config.toml"), "utf8");
    expect(config).toContain("[model_providers.minimax]");
    expect(config).toContain("MINIMAX_API_KEY");
    expect(config).toContain('wire_api = "chat"');
    expect(config).toContain("request_max_retries = 4");
    expect(config).toContain("stream_max_retries = 10");
    expect(config).toContain("stream_idle_timeout_ms = 300000");
    expect(config).toContain("[profiles.m21]");
    expect(config).toContain("[profiles.minimax]");
    expect(config).toContain('model = "MiniMax-M2.5"');
  });

  it("official template keeps defaults empty", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-mirror-template-"));
    tempDirs.push(root);
    const codexHomeDir = join(root, ".codex");

    const applied = await applyCloneTemplate("official", codexHomeDir);
    expect(applied.defaultCodexArgs).toEqual([]);
  });

  it("migrates deprecated minimax wire_api responses to chat", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-mirror-template-"));
    tempDirs.push(root);
    const codexHomeDir = join(root, ".codex");
    await mkdir(codexHomeDir, { recursive: true });
    const configPath = join(codexHomeDir, "config.toml");
    await writeFile(configPath, `[model_providers.minimax]
wire_api = "responses"
requires_openai_auth = false

[profiles.minimax]
model = "MiniMax-M1-80k"
model_provider = "minimax"
`, "utf8");

    const changed = await ensureMiniMaxConfigCompatibility(codexHomeDir);
    expect(changed).toBe(true);
    const config = await readFile(configPath, "utf8");
    expect(config).toContain('wire_api = "chat"');
    expect(config).not.toContain('wire_api = "responses"');
    expect(config).toContain("request_max_retries = 4");
    expect(config).toContain("stream_max_retries = 10");
    expect(config).toContain("stream_idle_timeout_ms = 300000");
    expect(config).toContain('model = "MiniMax-M2.5"');
    expect(config).not.toContain('model = "MiniMax-M1-80k"');
    expect(config).toContain("[profiles.m21]");
    expect(config).toContain("[profiles.minimax]");
  });

  it("migrates previous codex profile model ids to MiniMax-M2.5", async () => {
    const root = await mkdtemp(join(tmpdir(), "codex-mirror-template-"));
    tempDirs.push(root);
    const codexHomeDir = join(root, ".codex");
    await mkdir(codexHomeDir, { recursive: true });
    const configPath = join(codexHomeDir, "config.toml");
    await writeFile(configPath, `[model_providers.minimax]
wire_api = "chat"
requires_openai_auth = false

[profiles.m21]
model = "codex-MiniMax-M2.5"
model_provider = "minimax"
`, "utf8");

    const changed = await ensureMiniMaxConfigCompatibility(codexHomeDir);
    expect(changed).toBe(true);
    const config = await readFile(configPath, "utf8");
    expect(config).toContain('model = "MiniMax-M2.5"');
    expect(config).not.toContain('model = "codex-MiniMax-M2.5"');
  });
});
