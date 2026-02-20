import { confirm, input, select } from "@inquirer/prompts";
import { sanitizeTerminalOutput } from "../utils/terminal.js";

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

    session.render((now) => {
      const lines = buildMenuLines(options, selected, now, mountedAt);
      return renderFrame(lines, process.stdout.columns ?? 100, now);
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
      message: safeText(options.label),
      default: options.initialValue ? safeText(options.initialValue) : undefined,
      validate: options.validate ? sanitizeValidationResult(options.validate) : undefined,
    });
  }

  return runRawSession<string>((session) => {
    let value = options.initialValue ?? "";
    let errorLine: string | undefined;
    const mountedAt = Date.now();

    session.render((now) => {
      const lines = buildTextPromptLines(options, value, errorLine, now, mountedAt);
      return renderFrame(lines, process.stdout.columns ?? 100, now);
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
      message: safeText(options.lines?.[0] ?? "Confirm?"),
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
  const now = Date.now();
  // Static panels do not have a render loop. Instantly reveal typing text 
  // by setting mountedAt to 0 so elapsed is overwhelmingly large.
  const mountedAt = 0; 
  const lines = buildPanelLines(options, now, mountedAt);
  const frame = renderFrame(lines, process.stdout.columns ?? 100, now);
  process.stdout.write("\x1b[H");
  process.stdout.write(frame);
  process.stdout.write("\x1b[0J\n");
}

async function promptMenuFallback<T>(options: MenuOptions<T>): Promise<T> {
  try {
    return await select({
      message: safeText(options.subtitle ?? options.title),
      choices: options.items.map((item) => ({
        name: item.description
          ? `${safeText(item.label)} - ${safeText(item.description)}`
          : safeText(item.label),
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
  render: (renderer: (now: number) => string) => void;
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
  let renderer: ((now: number) => string) | undefined;
  let renderTimer: NodeJS.Timeout | undefined;

  const cleanup = (): void => {
    if (cleaned) {
      return;
    }
    cleaned = true;
    if (renderTimer) {
      clearInterval(renderTimer);
      renderTimer = undefined;
    }
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
    // Flicker-free clear: move home, print frame, clear anything left below.
    output.write("\x1b[H");
    output.write(renderer(Date.now()));
    output.write("\x1b[0J\n");
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
        if (!renderTimer) {
          // 20 FPS battery-smooth animation loop (~50ms)
          renderTimer = setInterval(() => {
            if (!cleaned) {
              repaint();
            }
          }, 50);
        }
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

function buildMenuLines<T>(options: MenuOptions<T>, selected: number, now: number, mountedAt: number): string[] {
  const lines: string[] = [];
  const summaryTitle = safeText(options.summaryTitle ?? "[ Summary ]");
  const actionsTitle = safeText(options.actionsTitle ?? "[ Actions ]");

  lines.push(getAnimatedBrand(safeText(options.title), now));
  if (options.subtitle) {
    const subtitle = getTypingEffect(safeText(options.subtitle), now, mountedAt);
    lines.push(styleMuted(`  ${subtitle}`));
  }

  lines.push("─");
  lines.push(styleSection(summaryTitle));
  if (options.statusLines && options.statusLines.length > 0) {
    for (const line of options.statusLines) {
      lines.push(`  ${safeText(line)}`);
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
    const label = `${index}. ${safeText(item.label)}`;
    lines.push(isSelected ? `${getAnimatedPointer(now)} ${styleSelected(label)}` : `  ${label}`);
    if (item.description) {
      lines.push(`      ${styleMuted(safeText(item.description))}`);
    }
  }

  lines.push("─");
  lines.push(getPulsingFooter(safeText(options.footer ?? "Up/Down navigate | Enter select | Esc back"), now));
  return lines;
}

function buildTextPromptLines(options: TextPromptOptions, value: string, errorLine: string | undefined, now: number, mountedAt: number): string[] {
  const lines: string[] = [];

  lines.push(getAnimatedBrand(safeText(options.title), now));
  if (options.subtitle) {
    const subtitle = getTypingEffect(safeText(options.subtitle), now, mountedAt);
    lines.push(styleMuted(`  ${subtitle}`));
  }

  lines.push("─");
  if (options.sectionTitle) {
    lines.push(styleSection(`[ ${safeText(options.sectionTitle)} ]`));
  }
  if (options.lines && options.lines.length > 0) {
    for (const line of options.lines) {
      lines.push(`  ${safeText(line)}`);
    }
  }

  lines.push("─");
  lines.push(styleSection(`[ ${safeText(options.label)} ]`));
  lines.push(`  ${safeText(value)}${styleMuted("_")}`);
  if (errorLine) {
    lines.push(styleError(`  ${safeText(errorLine)}`));
  }

  lines.push("─");
  lines.push(getPulsingFooter(safeText(options.footer ?? "Type to edit | Enter continue | Esc cancel"), now));
  return lines;
}

function buildPanelLines(options: PanelOptions, now: number, mountedAt: number): string[] {
  const lines: string[] = [];

  lines.push(getAnimatedBrand(safeText(options.title), now));
  if (options.subtitle) {
    const subtitle = getTypingEffect(safeText(options.subtitle), now, mountedAt);
    lines.push(styleMuted(`  ${subtitle}`));
  }

  lines.push("─");
  if (options.sectionTitle) {
    lines.push(styleSection(`[ ${safeText(options.sectionTitle)} ]`));
  }
  if (options.lines && options.lines.length > 0) {
    for (const line of options.lines) {
      lines.push(`  ${safeText(line)}`);
    }
  }

  lines.push("─");
  lines.push(getPulsingFooter(safeText(options.footer ?? "Follow the prompt below"), now));
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

function renderFrame(lines: string[], columns: number, now: number): string {
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
  
  // Append \x1b[K (Clear to End of Line) to each line so that
  // if a previous frame was wider, the leftover characters are erased.
  return out.join("\x1b[K\n") + "\x1b[K";
}

function getAnimatedPointer(now: number): string {
  // Elegant pulsing vertical bar with color cycling
  const colorTick = Math.floor(now / 400) % 4;
  const colors = ["\x1b[36m", "\x1b[34m", "\x1b[35m", "\x1b[96m"];
  const color = colors[colorTick];
  
  const reset = "\x1b[0m";

  // Pulse intensity
  const wave = (Math.sin(now / 200) + 1) / 2;
  const boldPrefix = wave > 0.5 ? "\x1b[1m" : "";

  return `${boldPrefix}${color} │  ${reset}`;
}

function getPulsingFooter(text: string, now: number): string {
  // Sine wave pulsing on the footer
  const wave = (Math.sin(now / 300) + 1) / 2; // 0.0 to 1.0
  if (wave > 0.8) return `\x1b[1;97m${text}\x1b[0m`; // bright white
  if (wave > 0.3) return `\x1b[37m${text}\x1b[0m`;   // normal
  return `\x1b[90m${text}\x1b[0m`;                   // dark gray
}

function getTypingEffect(text: string, now: number, mountedAt: number): string {
  const elapsed = Math.max(0, now - mountedAt);
  // ~40 characters per second = 1 char every 25ms
  const charsToShow = Math.floor(elapsed / 25);
  
  if (charsToShow >= text.length) {
    return text;
  }
  
  const visible = text.slice(0, charsToShow);
  // Flash a block cursor at the end while typing
  const cursor = (Math.floor(now / 100) % 2 === 0) ? "\x1b[7m \x1b[0m" : " ";
  return visible + cursor;
}

function getAnimatedBrand(title: string, now: number): string {
  // A moving sine wave color effect across the text or standard pulsing
  const tick = Math.floor(now / 100) % 10;
  const spinners = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const brandIcon = spinners[tick];
  
  // Pulse the brand
  const pulse = Math.floor(now / 500) % 2 === 0 ? "\x1b[1;36m" : "\x1b[1;96m";
  return `${pulse}${brandIcon} ${title}\x1b[0m`;
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

function safeText(value: string): string {
  return sanitizeTerminalOutput(value);
}

function sanitizeValidationResult(validate: (value: string) => true | string): (value: string) => true | string {
  return (value: string): true | string => {
    const result = validate(value);
    return result === true ? true : safeText(result);
  };
}

export const __menuTestUtils = {
  parseKeys,
};
