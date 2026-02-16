export type RuntimeKind = "npm-package" | "binary";

export interface RuntimeInfo {
  kind: RuntimeKind;
  entryPath: string;
  sourcePath: string;
  version: string;
  sourceCodexPath: string;
}

export interface ClonePaths {
  cloneBaseDir: string;
  metadataPath: string;
  runtimeDir: string;
  runtimeEntryPath: string;
  homeDir: string;
  codexHomeDir: string;
  logsDir: string;
}

export interface CloneRecord {
  id: string;
  name: string;
  rootPath: string;
  runtimePath: string;
  runtimeEntryPath: string;
  runtimeKind: RuntimeKind;
  wrapperPath: string;
  codexVersionPinned: string;
  createdAt: string;
  updatedAt: string;
}

export interface Registry {
  version: 1;
  clones: CloneRecord[];
}

export type AuthStatus = "logged_in" | "not_logged_in" | "unknown";

export interface DoctorResult {
  name: string;
  ok: boolean;
  runtimePath: string;
  wrapperPath: string;
  authStatus: AuthStatus;
  writable: boolean;
  errors: string[];
}
