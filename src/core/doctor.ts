import { CloneRecord, DoctorResult } from "../types.js";
import { exists, isFile, isWritable } from "../utils/fs.js";
import { readCloneSecrets } from "./clone-secrets.js";
import { deriveClonePaths } from "./clone-manager.js";
import { MINIMAX_RECOMMENDED_CODEX_VERSION } from "./clone-template.js";
import { Launcher } from "./launcher.js";

export class Doctor {
  constructor(
    private readonly launcher: Launcher,
    private readonly authTimeoutMs = 5_000,
    private readonly concurrency = 4,
  ) {}

  async checkOne(clone: CloneRecord): Promise<DoctorResult> {
    const errors: string[] = [];
    const paths = deriveClonePaths(clone.rootPath);

    if (!(await isFile(clone.runtimeEntryPath))) {
      errors.push(`Runtime entry missing: ${clone.runtimeEntryPath}`);
    }

    if (!(await isFile(clone.wrapperPath))) {
      errors.push(`Wrapper missing: ${clone.wrapperPath}`);
    }

    const writablePaths = [paths.cloneBaseDir, paths.homeDir, paths.codexHomeDir, paths.logsDir];
    const writableChecks = await Promise.all(
      writablePaths.map(async (path) => ({
        path,
        exists: await exists(path),
        writable: await isWritable(path),
      })),
    );

    for (const check of writableChecks) {
      if (!check.exists) {
        errors.push(`Missing directory: ${check.path}`);
      } else if (!check.writable) {
        errors.push(`Directory is not writable: ${check.path}`);
      }
    }

    let authStatus: DoctorResult["authStatus"] = "unknown";
    const auth = await this.launcher.capture(clone, ["login", "status"], process.cwd(), this.authTimeoutMs);
    const authOutput = `${auth.stdout}\n${auth.stderr}`;

    if (auth.timedOut) {
      errors.push(`Auth check timed out after ${this.authTimeoutMs}ms`);
    }

    if (/Not logged in/i.test(authOutput)) {
      authStatus = "not_logged_in";
    } else if (/Logged in/i.test(authOutput)) {
      authStatus = "logged_in";
    }

    if (authStatus === "unknown") {
      if ((clone.template ?? "official") !== "minimax") {
        errors.push("Could not determine auth status");
      }
    }

    if ((clone.template ?? "official") === "minimax") {
      const secrets = await readCloneSecrets(paths);
      if (!secrets.MINIMAX_API_KEY && !process.env.MINIMAX_API_KEY) {
        errors.push("MiniMax API key is missing. Set MINIMAX_API_KEY in clone setup or shell.");
      }
      if (clone.codexVersionPinned !== MINIMAX_RECOMMENDED_CODEX_VERSION) {
        errors.push(
          `MiniMax template expects Codex ${MINIMAX_RECOMMENDED_CODEX_VERSION}; run 'codex-mirror update ${clone.name}'`,
        );
      }
    }

    const writable = writableChecks.every((check) => check.exists && check.writable);

    return {
      name: clone.name,
      ok: errors.length === 0,
      runtimePath: clone.runtimeEntryPath,
      wrapperPath: clone.wrapperPath,
      authStatus,
      writable,
      errors,
    };
  }

  async checkMany(clones: CloneRecord[]): Promise<DoctorResult[]> {
    if (clones.length === 0) {
      return [];
    }

    const results = new Array<DoctorResult>(clones.length);
    const workers = Math.min(Math.max(1, this.concurrency), clones.length);
    let index = 0;

    await Promise.all(
      Array.from({ length: workers }, async () => {
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const current = index;
          index += 1;
          if (current >= clones.length) {
            break;
          }
          const clone = clones[current];
          if (!clone) {
            continue;
          }
          try {
            results[current] = await this.checkOne(clone);
          } catch (error) {
            results[current] = {
              name: clone.name,
              ok: false,
              runtimePath: clone.runtimeEntryPath,
              wrapperPath: clone.wrapperPath,
              authStatus: "unknown",
              writable: false,
              errors: [`Unexpected doctor error: ${toErrorMessage(error)}`],
            };
          }
        }
      }),
    );

    return results;
  }
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
