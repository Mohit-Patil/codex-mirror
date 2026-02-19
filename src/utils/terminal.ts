const ANSI_ESCAPE_SEQUENCE = /\u001B(?:\][^\u0007\u001B]*(?:\u0007|\u001B\\)|[PX^_][^\u001B]*(?:\u001B\\)|\[[0-?]*[ -/]*[@-~]|[@-Z\\-_])/g;
const CONTROL_CHARACTER = /[\u0000-\u001F\u007F-\u009F]/g;

export function sanitizeTerminalOutput(value: string): string {
  const withoutAnsi = value.replace(ANSI_ESCAPE_SEQUENCE, "");
  return withoutAnsi.replace(CONTROL_CHARACTER, escapeControlCharacter);
}

export function sanitizeTerminalValue(value: unknown): string {
  return sanitizeTerminalOutput(String(value));
}

function escapeControlCharacter(char: string): string {
  if (char === "\n") {
    return "\\n";
  }
  if (char === "\r") {
    return "\\r";
  }
  if (char === "\t") {
    return "\\t";
  }
  return `\\x${char.charCodeAt(0).toString(16).padStart(2, "0")}`;
}
