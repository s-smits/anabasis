// What every board backend takes and returns, and the input pacing the in-process backends share.

import type { Board, Stimulus, UartEvent } from "./stimulus.ts";
import type { TraceExit, TraceRecorder } from "./trace.ts";

export interface RunRequest {
  readonly board: Board;
  readonly imagePath: string;
  readonly image: Uint8Array;
  readonly stimulus: Stimulus;
  readonly untilNs: number;
  readonly recorder: TraceRecorder;
}

export interface RunOutcome {
  readonly clock: "virtual" | "none";
  readonly exit: TraceExit;
}

interface QueuedByte {
  readonly atNs: number;
  readonly byte: number;
  readonly charNs: number;
}

/** Exit status 2: the invocation or an input file is wrong. No trace is written. */
export class UsageError extends Error {}

/** Exit status 3: the simulator is missing or failed to run. No trace is written. */
export class SimulatorError extends Error {}

/** The directory holding `path`, for the POSIX paths fwsim is given. */
export function parentDir(path: string): string {
  const slash = path.replace(/\/+$/, "").lastIndexOf("/");
  if (slash < 0) return ".";
  return slash === 0 ? "/" : path.slice(0, slash);
}

export function untilExit(untilNs: number): TraceExit {
  return { reason: "until", atUs: untilNs / 1000, detail: null };
}

export function crashExit(atNs: number, detail: string): TraceExit {
  return { reason: "crash", atUs: Math.round(atNs) / 1000, detail };
}

/**
 * The bytes of one port's uart events, released in order and no faster than one character time
 * (10 bits at the event's baud) apart, never before their event's time.
 */
export class SerialFeed {
  private readonly queue: QueuedByte[];
  private index = 0;
  private earliestNs = 0;

  constructor(events: readonly UartEvent[]) {
    this.queue = events.flatMap((event) =>
      Array.from(event.bytes, (byte) => ({ atNs: event.atNs, byte, charNs: 10e9 / event.baud })),
    );
  }

  /** When the next byte may go, or Infinity once every byte has gone. */
  get nextNs(): number {
    const head = this.queue[this.index];
    return head === undefined ? Number.POSITIVE_INFINITY : Math.max(head.atNs, this.earliestNs);
  }

  /** Hand over the next byte at `nowNs`. */
  take(nowNs: number): number {
    const head = this.queue[this.index];
    if (head === undefined) throw new Error("SerialFeed.take past the last byte");
    this.index += 1;
    this.earliestNs = nowNs + head.charNs;
    return head.byte;
  }
}

/** One feed per port named in the stimulus's uart events. */
export function serialFeeds(stimulus: Stimulus): Map<string, SerialFeed> {
  const byPort = Map.groupBy(
    stimulus.events.filter((event): event is UartEvent => event.kind === "uart"),
    (event) => event.port,
  );
  return new Map(byPort.entries().map(([port, events]) => [port, new SerialFeed(events)]));
}
