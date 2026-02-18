import { confirm, input, select } from "@inquirer/prompts";

export interface MenuItem<T> {
  label: string;
  value: T;
  description?: string;
}

export interface MenuOptions<T> {
  title: string;
  subtitle?: string;
  statusLines?: string[];
  summaryTitle?: string;
  items: MenuItem<T>[];
  actionsTitle?: string;
  footer?: string;
  initialIndex?: number;
  cancelValue?: T;
}

export interface PanelOptions {
  title: string;
  subtitle?: string;
  sectionTitle?: string;
  lines?: string[];
  footer?: string;
}

export interface TextPromptOptions {
  title: string;
  subtitle?: string;
  sectionTitle?: string;
  lines?: string[];
  label: string;
  footer?: string;
  initialValue?: string;
  validate?: (value: string) => true | string;
}

export interface ConfirmPromptOptions {
  title: string;
  subtitle?: string;
  sectionTitle?: string;
  lines?: string[];
  footer?: string;
  defaultValue?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
}

type ParsedKey =
  | { kind: "up" }
  | { kind: "down" }
  | { kind: "enter" }
  | { kind: "escape" }
  | { kind: "ctrl-c" }
  | { kind: "backspace" }
  | { kind: "char"; value: string };

export async function promptMenu<T>(options: MenuOptions<T>): Promise<T> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return promptMenuFallback(options);
  }

  if (options.items.length === 0) {
    throw new Error("Menu requires at least one item");
  }

  return runRawSession<T>((session) => {
    let selected = clamp(options.initialIndex ?? 0, 0, options.items.length - 1);
    const mountedAt = Date.now();

    session.render(() => {
      const lines = buildMenuLines(options, selected);
      return renderFrame(lines, process.stdout.columns ?? 100);
    });

    session.onKey((key) => {
      if (key.kind === "ctrl-c") {
        if (options.cancelValue !== undefined) {
          session.resolve(options.cancelValue);
          return;
        }
        session.reject(new Error("Aborted by user"));
        return;
      }

      // Ignore likely buffered bytes from previous prompt interactions.
      if (Date.now() - mountedAt < 140) {
        return;
      }

      if (key.kind === "escape") {
        if (options.cancelValue !== undefined) {
          session.resolve(options.cancelValue);
          return;
        }
        session.reject(new Error("Aborted by user"));
        return;
      }

      if (key.kind === "up" || (key.kind === "char" && key.value.toLowerCase() === "k")) {
        selected = wrap(selected - 1, options.items.length);
        session.repaint();
        return;
      }

      if (key.kind === "down" || (key.kind === "char" && key.value.toLowerCase() === "j")) {
        selected = wrap(selected + 1, options.items.length);
        session.repaint();
        return;
      }

      if (key.kind === "char" && key.value.toLowerCase() === "q" && options.cancelValue !== undefined) {
        session.resolve(options.cancelValue);
        return;
      }

      if (key.kind === "enter") {
        const item = options.items[selected];
        if (!item) {
          session.reject(new Error("Invalid menu selection"));
          return;
        }
        session.resolve(item.value);
      }
    });
  });
}

export async function promptText(options: TextPromptOptions): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return input({
      message: options.label,
      default: options.initialValue,
      validate: options.validate,
    });
  }

  return runRawSession<string>((session) => {
    let value = options.initialValue ?? "";
    let errorLine: string | undefined;
    const mountedAt = Date.now();

    session.render(() => {
      const lines = buildTextPromptLines(options, value, errorLine);
      return renderFrame(lines, process.stdout.columns ?? 100);
    });

    session.onKey((key) => {
      if (Date.now() - mountedAt < 140 && key.kind === "enter") {
        return;
      }

      if (key.kind === "ctrl-c" || key.kind === "escape") {
        session.reject(new Error("Aborted by user"));
        return;
      }

      if (key.kind === "backspace") {
        if (value.length > 0) {
          value = value.slice(0, -1);
          errorLine = undefined;
          session.repaint();
        }
        return;
      }

      if (key.kind === "char") {
        if (isPrintableCharacter(key.value)) {
          value += key.value;
          errorLine = undefined;
          session.repaint();
        }
        return;
      }

      if (key.kind === "enter") {
        if (options.validate) {
          const result = options.validate(value);
          if (result !== true) {
            errorLine = result;
            session.repaint();
            return;
          }
        }
        session.resolve(value);
      }
    });
  });
}

export async function promptConfirm(options: ConfirmPromptOptions): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return confirm({
      message: options.lines?.[0] ?? "Confirm?",
      default: options.defaultValue ?? true,
    });
  }

  const yesLabel = options.confirmLabel ?? "Yes";
  const noLabel = options.cancelLabel ?? "No";
  return promptMenu<boolean>({
    title: options.title,
    subtitle: options.subtitle,
    statusLines: options.lines,
    summaryTitle: "[ Question ]",
    items:
      options.defaultValue === false
        ? [
            { label: noLabel, value: false },
            { label: yesLabel, value: true },
          ]
        : [
            { label: yesLabel, value: true },
            { label: noLabel, value: false },
          ],
    actionsTitle: "[ Options ]",
    footer: options.footer ?? "Up/Down navigate | Enter select | Esc cancel",
    cancelValue: false,
  });
}

export function renderPanel(options: PanelOptions): void {
  const lines = buildPanelLines(options);
  const frame = renderFrame(lines, process.stdout.columns ?? 100);
  process.stdout.write("\x1b[2J\x1b[H");
  process.stdout.write(frame);
  process.stdout.write("\n");
}

async function promptMenuFallback<T>(options: MenuOptions<T>): Promise<T> {
  try {
    return await select({
      message: options.subtitle ?? options.title,
      choices: options.items.map((item) => ({
        name: item.description ? `${item.label} - ${item.description}` : item.label,
        value: item.value,
      })),
    });
  } catch (error) {
    if (options.cancelValue !== undefined) {
      return options.cancelValue;
    }
    throw error;
  }
}

interface RawSessionController<T> {
  render: (renderer: () => string) => void;
  onKey: (handler: (key: ParsedKey) => void) => void;
  repaint: () => void;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

async function runRawSession<T>(setup: (session: RawSessionController<T>) => void): Promise<T> {
  const input = process.stdin;
  const output = process.stdout;
  const previousRawMode = input.isTTY ? input.isRaw : false;
  let cleaned = false;
  let parserState = "";
  let keyHandler: ((key: ParsedKey) => void) | undefined;
  let renderer: (() => string) | undefined;

  const cleanup = (): void => {
    if (cleaned) {
      return;
    }
    cleaned = true;
    input.off("data", onData);
    if (input.isTTY) {
      input.setRawMode(previousRawMode);
    }
    // Return stdin to paused mode so Node can exit after the final prompt.
    input.pause();
    output.write("\x1b[?25h");
  };

  const repaint = (): void => {
    if (!renderer) {
      return;
    }
    output.write("\x1b[2J\x1b[H");
    output.write(renderer());
    output.write("\n");
  };

  const onData = (chunk: Buffer): void => {
    parserState += chunk.toString("utf8");
    const parsed = parseKeys(parserState);
    parserState = parsed.rest;
    if (!keyHandler) {
      return;
    }
    for (const key of parsed.keys) {
      if (cleaned) {
        break;
      }
      keyHandler(key);
    }
  };

  drainInputBuffer(input);
  input.resume();
  if (input.isTTY) {
    input.setRawMode(true);
  }
  output.write("\x1b[?25l");
  input.on("data", onData);

  return new Promise<T>((resolve, reject) => {
    const session: RawSessionController<T> = {
      render(nextRenderer) {
        renderer = nextRenderer;
        repaint();
      },
      onKey(handler) {
        keyHandler = handler;
      },
      repaint,
      resolve(value) {
        cleanup();
        keyHandler = undefined;
        resolve(value);
      },
      reject(error) {
        cleanup();
        keyHandler = undefined;
        reject(error);
      },
    };

    try {
      setup(session);
    } catch (error) {
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function buildMenuLines<T>(options: MenuOptions<T>, selected: number): string[] {
  const lines: string[] = [];
  const summaryTitle = options.summaryTitle ?? "[ Summary ]";
  const actionsTitle = options.actionsTitle ?? "[ Actions ]";

  lines.push(styleBrand(options.title));
  if (options.subtitle) {
    lines.push(styleMuted(`  ${options.subtitle}`));
  }

  lines.push("─");
  lines.push(styleSection(summaryTitle));
  if (options.statusLines && options.statusLines.length > 0) {
    for (const line of options.statusLines) {
      lines.push(`  ${line}`);
    }
  } else {
    lines.push("  No summary available.");
  }

  lines.push("─");
  lines.push(styleSection(actionsTitle));
  for (let i = 0; i < options.items.length; i += 1) {
    const item = options.items[i];
    if (!item) {
      continue;
    }
    const isSelected = i === selected;
    const index = String(i + 1).padStart(2, " ");
    const label = `${index}. ${item.label}`;
    lines.push(isSelected ? `${stylePointer(">")} ${styleSelected(label)}` : `  ${label}`);
    if (item.description) {
      lines.push(`      ${styleMuted(item.description)}`);
    }
  }

  lines.push("─");
  lines.push(styleMuted(options.footer ?? "Up/Down navigate | Enter select | Esc back"));
  return lines;
}

function buildTextPromptLines(options: TextPromptOptions, value: string, errorLine?: string): string[] {
  const lines: string[] = [];

  lines.push(styleBrand(options.title));
  if (options.subtitle) {
    lines.push(styleMuted(`  ${options.subtitle}`));
  }

  lines.push("─");
  if (options.sectionTitle) {
    lines.push(styleSection(`[ ${options.sectionTitle} ]`));
  }
  if (options.lines && options.lines.length > 0) {
    for (const line of options.lines) {
      lines.push(`  ${line}`);
    }
  }

  lines.push("─");
  lines.push(styleSection(`[ ${options.label} ]`));
  lines.push(`  ${value}${styleMuted("_")}`);
  if (errorLine) {
    lines.push(styleError(`  ${errorLine}`));
  }

  lines.push("─");
  lines.push(styleMuted(options.footer ?? "Type to edit | Enter continue | Esc cancel"));
  return lines;
}

function buildPanelLines(options: PanelOptions): string[] {
  const lines: string[] = [];

  lines.push(styleBrand(options.title));
  if (options.subtitle) {
    lines.push(styleMuted(`  ${options.subtitle}`));
  }

  lines.push("─");
  if (options.sectionTitle) {
    lines.push(styleSection(`[ ${options.sectionTitle} ]`));
  }
  if (options.lines && options.lines.length > 0) {
    for (const line of options.lines) {
      lines.push(`  ${line}`);
    }
  }

  lines.push("─");
  lines.push(styleMuted(options.footer ?? "Follow the prompt below"));
  return lines;
}

function parseKeys(input: string): { keys: ParsedKey[]; rest: string } {
  const keys: ParsedKey[] = [];
  let index = 0;

  while (index < input.length) {
    const remaining = input.slice(index);
    if (remaining.startsWith("\u001b[A")) {
      keys.push({ kind: "up" });
      index += 3;
      continue;
    }
    if (remaining.startsWith("\u001b[B")) {
      keys.push({ kind: "down" });
      index += 3;
      continue;
    }
    if (remaining.startsWith("\u001bOA")) {
      keys.push({ kind: "up" });
      index += 3;
      continue;
    }
    if (remaining.startsWith("\u001bOB")) {
      keys.push({ kind: "down" });
      index += 3;
      continue;
    }

    const char = input[index];
    if (!char) {
      break;
    }

    if (char === "\u0003") {
      keys.push({ kind: "ctrl-c" });
      index += 1;
      continue;
    }
    if (char === "\r" || char === "\n") {
      keys.push({ kind: "enter" });
      index += 1;
      continue;
    }
    if (char === "\u007f") {
      keys.push({ kind: "backspace" });
      index += 1;
      continue;
    }
    if (char === "\u001b") {
      // Preserve incomplete CSI sequence for the next chunk.
      if (index + 1 >= input.length) {
        break;
      }
      const next = input[index + 1];
      if (next === "[" && index + 2 >= input.length) {
        break;
      }
      keys.push({ kind: "escape" });
      index += 1;
      continue;
    }

    keys.push({ kind: "char", value: char });
    index += 1;
  }

  return {
    keys,
    rest: input.slice(index),
  };
}

function renderFrame(lines: string[], columns: number): string {
  const maxLineLength = Math.max(...lines.map((line) => visibleLength(line)), 1);
  const minWidth = 76;
  const maxWidth = Math.max(minWidth, Math.min(96, columns - 2));
  const innerWidth = clamp(maxLineLength + 2, minWidth - 2, maxWidth - 2);
  const width = innerWidth + 2;

  const out: string[] = [];
  out.push(`+${"-".repeat(width - 2)}+`);
  for (const line of lines) {
    if (line === "─") {
      out.push(`+${"-".repeat(width - 2)}+`);
      continue;
    }
    const text = truncateText(line, innerWidth);
    const pad = " ".repeat(Math.max(0, innerWidth - visibleLength(text)));
    out.push(`|${text}${pad}|`);
  }
  out.push(`+${"-".repeat(width - 2)}+`);
  return out.join("\n");
}

function truncateText(value: string, maxLength: number): string {
  if (visibleLength(value) <= maxLength) {
    return value;
  }
  if (maxLength <= 1) {
    return value.slice(0, maxLength);
  }
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function visibleLength(value: string): number {
  return value.replace(/\u001B\[[0-9;]*m/g, "").length;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function wrap(value: number, size: number): number {
  if (size <= 0) {
    return 0;
  }
  if (value < 0) {
    return size - 1;
  }
  if (value >= size) {
    return 0;
  }
  return value;
}

function drainInputBuffer(input: NodeJS.ReadStream): void {
  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const chunk = input.read();
      if (chunk === null) {
        break;
      }
    }
  } catch {
    // Ignore buffer drain failures.
  }
}

function isPrintableCharacter(value: string): boolean {
  if (!value) {
    return false;
  }
  const code = value.charCodeAt(0);
  return code >= 32 && code !== 127;
}

function styleTitle(value: string): string {
  return `\x1b[1m${value}\x1b[0m`;
}

function styleBrand(value: string): string {
  return `\x1b[1;36m${value}\x1b[0m`;
}

function styleSection(value: string): string {
  return `\x1b[36m${value}\x1b[0m`;
}

function styleMuted(value: string): string {
  return `\x1b[90m${value}\x1b[0m`;
}

function styleSelected(value: string): string {
  return `\x1b[1;97m${value}\x1b[0m`;
}

function stylePointer(value: string): string {
  return `\x1b[33m${value}\x1b[0m`;
}

function styleError(value: string): string {
  return `\x1b[31m${value}\x1b[0m`;
}

export const __menuTestUtils = {
  parseKeys,
};
