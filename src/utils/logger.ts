export type LogLevel = "debug" | "info" | "error";

export class Logger {
  constructor(private readonly debugEnabled: boolean) {}

  debug(message: string): void {
    if (!this.debugEnabled) {
      return;
    }
    console.error(`[debug] ${message}`);
  }

  info(message: string): void {
    console.log(message);
  }

  error(message: string): void {
    console.error(message);
  }
}

export function createLogger(debugEnabled = false): Logger {
  return new Logger(debugEnabled);
}
