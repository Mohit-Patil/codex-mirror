import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { __menuTestUtils, promptMenu } from "../src/tui/menu.js";

describe("promptMenu fallback", () => {
  let restoreProcessStreams: (() => void) | undefined;

  afterEach(() => {
    restoreProcessStreams?.();
    restoreProcessStreams = undefined;
    vi.useRealTimers();
  });

  it("is defined for import sanity", () => {
    expect(typeof promptMenu).toBe("function");
  });

  it("parses arrow keys and partial escape sequences safely", () => {
    const parsed = __menuTestUtils.parseKeys("\u001b[A\u001b[B\r");
    expect(parsed.keys.map((item) => item.kind)).toEqual(["up", "down", "enter"]);
    expect(parsed.rest).toBe("");

    const partial = __menuTestUtils.parseKeys("\u001b[");
    expect(partial.keys).toHaveLength(0);
    expect(partial.rest).toBe("\u001b[");
  });

  it("pauses stdin after raw menu resolves so the process can exit", async () => {
    vi.useFakeTimers();

    const input = new MockRawInput();
    const output = new MockRawOutput();
    restoreProcessStreams = replaceProcessStreams(
      input as unknown as NodeJS.ReadStream,
      output as unknown as NodeJS.WriteStream,
    );

    const selectedPromise = promptMenu({
      title: "Main",
      items: [{ label: "Exit", value: "exit" }],
      cancelValue: "exit",
    });

    vi.advanceTimersByTime(200);
    input.emit("data", Buffer.from("\r"));

    await expect(selectedPromise).resolves.toBe("exit");
    expect(input.resumeCalls).toBe(1);
    expect(input.pauseCalls).toBe(1);
    expect(input.rawModeCalls).toEqual([true, false]);
  });
});

class MockRawInput extends EventEmitter {
  public isTTY = true;

  public isRaw = false;

  public resumeCalls = 0;

  public pauseCalls = 0;

  public rawModeCalls: boolean[] = [];

  read(): null {
    return null;
  }

  resume(): this {
    this.resumeCalls += 1;
    return this;
  }

  pause(): this {
    this.pauseCalls += 1;
    return this;
  }

  setRawMode(value: boolean): this {
    this.isRaw = value;
    this.rawModeCalls.push(value);
    return this;
  }
}

class MockRawOutput {
  public isTTY = true;

  public columns = 100;

  write(): boolean {
    return true;
  }
}

function replaceProcessStreams(input: NodeJS.ReadStream, output: NodeJS.WriteStream): () => void {
  const stdinDescriptor = Object.getOwnPropertyDescriptor(process, "stdin");
  const stdoutDescriptor = Object.getOwnPropertyDescriptor(process, "stdout");
  if (!stdinDescriptor || !stdoutDescriptor) {
    throw new Error("Unable to capture process stream descriptors");
  }

  Object.defineProperty(process, "stdin", {
    value: input,
    configurable: true,
  });
  Object.defineProperty(process, "stdout", {
    value: output,
    configurable: true,
  });

  return () => {
    Object.defineProperty(process, "stdin", stdinDescriptor);
    Object.defineProperty(process, "stdout", stdoutDescriptor);
  };
}
