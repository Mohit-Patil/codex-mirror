const MAX_CLONE_NAME_LENGTH = 64;
const CLONE_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const WINDOWS_RESERVED_NAMES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
]);

export interface CloneNameValidation {
  ok: boolean;
  normalized: string;
  error?: string;
}

export function validateCloneName(input: string): CloneNameValidation {
  const normalized = input.trim();
  if (!normalized) {
    return { ok: false, normalized, error: "Clone name cannot be empty" };
  }

  if (normalized.length > MAX_CLONE_NAME_LENGTH) {
    return {
      ok: false,
      normalized,
      error: `Clone name must be ${MAX_CLONE_NAME_LENGTH} characters or fewer`,
    };
  }

  if (normalized.includes("/") || normalized.includes("\\")) {
    return {
      ok: false,
      normalized,
      error: "Clone name cannot contain path separators",
    };
  }

  if (normalized.includes("..")) {
    return {
      ok: false,
      normalized,
      error: "Clone name cannot include '..'",
    };
  }

  if (!CLONE_NAME_RE.test(normalized)) {
    return {
      ok: false,
      normalized,
      error: "Use letters, numbers, dot, underscore, and hyphen; must start with letter or number",
    };
  }

  if (WINDOWS_RESERVED_NAMES.has(normalized.toLowerCase())) {
    return {
      ok: false,
      normalized,
      error: "Clone name is reserved on Windows",
    };
  }

  return { ok: true, normalized };
}

export function assertValidCloneName(input: string): string {
  const result = validateCloneName(input);
  if (!result.ok) {
    throw new Error(result.error ?? "Invalid clone name");
  }
  return result.normalized;
}

export function sanitizeCloneName(input: string): string {
  const base = input
    .trim()
    .replace(/[\\/]/g, "-")
    .replace(/\.\.+/g, ".")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/^[^a-zA-Z0-9]+/, "")
    .replace(/-+/g, "-")
    .slice(0, MAX_CLONE_NAME_LENGTH);

  if (!base) {
    return "clone";
  }
  if (!/^[a-zA-Z0-9]/.test(base)) {
    return `c-${base}`.slice(0, MAX_CLONE_NAME_LENGTH);
  }
  return base;
}
