import { homedir } from "node:os";
import { join } from "node:path";

export interface MirrorContext {
  globalRoot: string;
  registryPath: string;
  defaultBinDir: string;
}

export function resolveContext(): MirrorContext {
  const globalRoot = process.env.CODEX_MIRROR_HOME ?? join(homedir(), ".codex-mirror");
  const defaultBinDir = process.env.CODEX_MIRROR_BIN_DIR ?? join(homedir(), ".local", "bin");
  return {
    globalRoot,
    registryPath: join(globalRoot, "registry.json"),
    defaultBinDir,
  };
}
