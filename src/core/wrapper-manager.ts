import { chmod, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { CloneRecord } from "../types.js";
import { ensureDir, removePath } from "../utils/fs.js";
import { assertValidCloneName } from "./clone-name.js";

export interface WrapperRunner {
  command: string;
  args: string[];
}

export class WrapperManager {
  private readonly resolvedBinDir: string;

  constructor(
    private readonly binDir: string,
    private readonly runner: WrapperRunner = { command: "codex-mirror", args: [] },
  ) {
    this.resolvedBinDir = resolve(binDir);
  }

  getPathForClone(name: string): string {
    const cloneName = assertValidCloneName(name);
    const wrapperPath = resolve(this.resolvedBinDir, cloneName);
    this.assertPathWithinBinDir(wrapperPath);
    return wrapperPath;
  }

  async installWrapper(clone: CloneRecord): Promise<string> {
    await ensureDir(this.binDir);
    const wrapperPath = this.getPathForClone(clone.name);
    const content = buildWrapperContent(clone.name, this.runner);
    await writeFile(wrapperPath, content, "utf8");
    await chmod(wrapperPath, 0o755);
    return wrapperPath;
  }

  async removeWrapper(cloneName: string): Promise<void> {
    await removePath(this.getPathForClone(cloneName));
  }

  private assertPathWithinBinDir(path: string): void {
    const rel = relative(this.resolvedBinDir, path);
    if (rel === "" || rel === "." || rel.startsWith("..") || isAbsolute(rel)) {
      throw new Error(`Unsafe wrapper path computed for clone: ${path}`);
    }
  }
}

function buildWrapperContent(cloneName: string, runner: WrapperRunner): string {
  const nameLiteral = shellSingleQuote(cloneName);
  const commandLiteral = shellSingleQuote(runner.command);
  const argsLiteral = runner.args.map(shellSingleQuote).join(" ");
  const arrayDecl = `RUNNER_ARGS=(${argsLiteral})`;

  return `#!/usr/bin/env bash
set -euo pipefail
if [[ -n \"\${CODEX_MIRROR_CLI:-}\" ]]; then
  exec \"$CODEX_MIRROR_CLI\" run ${nameLiteral} -- \"$@\"
fi
RUNNER_CMD=${commandLiteral}
${arrayDecl}
if (( \${#RUNNER_ARGS[@]} > 0 )); then
  exec \"$RUNNER_CMD\" \"\${RUNNER_ARGS[@]}\" run ${nameLiteral} -- \"$@\"
fi
exec \"$RUNNER_CMD\" run ${nameLiteral} -- \"$@\"
`;
}

function shellSingleQuote(input: string): string {
  return `'${input.replace(/'/g, `'"'"'`)}'`;
}
