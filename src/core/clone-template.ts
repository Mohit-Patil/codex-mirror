import { readFile, writeFile } from "node:fs/promises";
import { CloneTemplate } from "../types.js";
import { ensureDir } from "../utils/fs.js";

const MINIMAX_PROFILE_MODEL = "MiniMax-M2.5";
export const MINIMAX_RECOMMENDED_CODEX_VERSION = "0.57.0";
const MINIMAX_PRIMARY_PROFILE = "m21";
const MINIMAX_COMPAT_PROFILE = "minimax";

export interface TemplateApplyResult {
  template: CloneTemplate;
  defaultCodexArgs: string[];
  notes: string[];
}

export function parseCloneTemplate(value: string | undefined): CloneTemplate {
  if (!value || value.trim().length === 0) {
    return "official";
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "official" || normalized === "codex" || normalized === "default") {
    return "official";
  }
  if (normalized === "minimax") {
    return "minimax";
  }
  throw new Error(`Unsupported template '${value}'. Use one of: official, minimax`);
}

export function templateLabel(template: CloneTemplate): string {
  if (template === "minimax") {
    return "MiniMax";
  }
  return "Official Codex";
}

export function resolveTemplateRuntimePin(template: CloneTemplate): string | undefined {
  if (template !== "minimax") {
    return undefined;
  }
  if (process.env.CODEX_MIRROR_DISABLE_MINIMAX_RUNTIME_PIN === "1") {
    return undefined;
  }

  const override = process.env.CODEX_MIRROR_MINIMAX_CODEX_VERSION?.trim();
  if (override) {
    return override;
  }
  return MINIMAX_RECOMMENDED_CODEX_VERSION;
}

export async function applyCloneTemplate(template: CloneTemplate, codexHomeDir: string): Promise<TemplateApplyResult> {
  if (template === "minimax") {
    await ensureDir(codexHomeDir);
    const configPath = minimaxConfigPath(codexHomeDir);
    await writeFile(configPath, buildMiniMaxConfigToml(), "utf8");
    return {
      template,
      defaultCodexArgs: ["--profile", MINIMAX_PRIMARY_PROFILE],
      notes: [
        "Configured ~/.codex/config.toml for MiniMax provider.",
        `Set default launch args to '--profile ${MINIMAX_PRIMARY_PROFILE}'.`,
        `Pinned runtime to Codex ${MINIMAX_RECOMMENDED_CODEX_VERSION} by default.`,
        "Set MINIMAX_API_KEY in clone setup or shell.",
      ],
    };
  }

  return {
    template: "official",
    defaultCodexArgs: [],
    notes: [],
  };
}

export async function ensureMiniMaxConfigCompatibility(codexHomeDir: string): Promise<boolean> {
  const path = minimaxConfigPath(codexHomeDir);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return false;
    }
    throw error;
  }

  let replaced = raw.replace(/wire_api\s*=\s*"responses"/g, 'wire_api = "chat"');
  replaced = migrateLegacyModelIds(replaced);
  replaced = ensureRetrySettings(replaced);
  replaced = ensureProfileBlock(replaced, MINIMAX_PRIMARY_PROFILE);
  replaced = ensureProfileBlock(replaced, MINIMAX_COMPAT_PROFILE);
  if (replaced === raw) {
    return false;
  }

  await writeFile(path, replaced, "utf8");
  return true;
}

function buildMiniMaxConfigToml(): string {
  return `# Managed by codex-mirror (template: minimax)
# You can edit this file anytime for custom models/profiles.

[model_providers.minimax]
name = "MiniMax Chat Completions API"
base_url = "https://api.minimax.io/v1"
env_key = "MINIMAX_API_KEY"
wire_api = "chat"
requires_openai_auth = false
request_max_retries = 4
stream_max_retries = 10
stream_idle_timeout_ms = 300000

[profiles.${MINIMAX_PRIMARY_PROFILE}]
model = "${MINIMAX_PROFILE_MODEL}"
model_provider = "minimax"

[profiles.${MINIMAX_COMPAT_PROFILE}]
model = "${MINIMAX_PROFILE_MODEL}"
model_provider = "minimax"
`;
}

function minimaxConfigPath(codexHomeDir: string): string {
  return `${codexHomeDir}/config.toml`;
}

function ensureRetrySettings(raw: string): string {
  if (
    raw.includes("request_max_retries") &&
    raw.includes("stream_max_retries") &&
    raw.includes("stream_idle_timeout_ms")
  ) {
    return raw;
  }

  return raw.replace(
    /requires_openai_auth\s*=\s*(true|false)/,
    (match) => `${match}\nrequest_max_retries = 4\nstream_max_retries = 10\nstream_idle_timeout_ms = 300000`,
  );
}

function ensureProfileBlock(raw: string, profileName: string): string {
  if (raw.includes(`[profiles.${profileName}]`)) {
    return raw;
  }

  const suffix = raw.endsWith("\n") ? "" : "\n";
  return `${raw}${suffix}\n[profiles.${profileName}]\nmodel = "${MINIMAX_PROFILE_MODEL}"\nmodel_provider = "minimax"\n`;
}

function migrateLegacyModelIds(raw: string): string {
  return raw.replace(
    /model\s*=\s*"(?:MiniMax-M1-80k|codex-MiniMax-M2\.5|codex-minimax-m2\.5|codex-MiniMax-M2\.1|MiniMax-M2\.1)"/g,
    `model = "${MINIMAX_PROFILE_MODEL}"`,
  );
}
