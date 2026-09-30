// The trace a run writes: pin transitions, serial lines and I2C transfers stamped in virtual time.

import type { Board } from "./stimulus.ts";

/** 1 or 0 while the firmware drives the pin, null while it does not (input or peripheral-routed). */
export type Level = 0 | 1 | null;

export interface PinRecord {
  readonly atUs: number | null;
  readonly pin: number;
  readonly level: Level;
}
export interface SerialRecord {
  readonly atUs: number | null;
  readonly port: string;
  readonly text: string;
}
export interface I2cRecord {
  readonly atUs: number;
  readonly address: number;
  readonly op: "write" | "read";
  readonly bytes: readonly number[];
}
export interface TraceExit {
  readonly reason: "until" | "crash" | "wall";
  readonly atUs: number | null;
  readonly detail: string | null;
}
export interface Trace {
  readonly board: Board;
  readonly untilUs: number;
  /** "virtual": every atUs is virtual time; "none": the simulator gave no clock, atUs is null. */
  readonly clock: "virtual" | "none";
  readonly pins: readonly PinRecord[];
  readonly serial: readonly SerialRecord[];
  readonly i2c: readonly I2cRecord[];
  readonly exit: TraceExit;
}

interface PendingLine {
  readonly bytes: number[];
  atNs: number | null;
}

const NEWLINE = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const UTF8 = new TextDecoder("utf-8", { fatal: true });

/** Virtual nanoseconds as microseconds, kept to whole nanoseconds. */
export function microsFromNanos(atNs: number | null): number | null {
  return atNs === null ? null : Math.round(atNs) / 1000;
}

/** UTF-8 when the bytes are valid UTF-8, else one character per byte (Latin-1). */
export function decodeLine(bytes: readonly number[]): string {
  const data = Uint8Array.from(bytes);
  try {
    return UTF8.decode(data);
  } catch {
    // Not UTF-8: fall through to the byte-per-character reading.
  }
  let text = "";
  for (const byte of data) text += String.fromCodePoint(byte);
  return text;
}

function byTime<T extends { readonly atUs: number | null }>(a: T, b: T): number {
  return (a.atUs ?? 0) - (b.atUs ?? 0);
}

/** Collects what one run observes; each board backend feeds it and `finish` returns the trace. */
export class TraceRecorder {
  private readonly pins: PinRecord[] = [];
  private readonly levels = new Map<number, Level>();
  private readonly serial: SerialRecord[] = [];
  private readonly lines = new Map<string, PendingLine>();
  private readonly transfers: I2cRecord[] = [];
  private readonly pinFilter: ReadonlySet<number> | null;
  /** Called with each serial line as it completes, before `finish`. */
  onLine: ((record: SerialRecord) => void) | null = null;

  constructor(pinFilter: ReadonlySet<number> | null) {
    this.pinFilter = pinFilter;
  }

  /** Record `level` on `pin` if it differs from the last level recorded; every pin starts undriven. */
  pin(atNs: number | null, pin: number, level: Level): void {
    if (this.pinFilter !== null && !this.pinFilter.has(pin)) return;
    if ((this.levels.get(pin) ?? null) === level) return;
    this.levels.set(pin, level);
    this.pins.push({ atUs: microsFromNanos(atNs), pin, level });
  }

  /** One byte the firmware sent on `port`; a line ends at "\n", and a "\r" just before it is dropped. */
  serialByte(atNs: number | null, port: string, byte: number): void {
    const line = this.lines.get(port) ?? { bytes: [], atNs };
    this.lines.set(port, line);
    line.atNs = atNs;
    if (byte !== NEWLINE) {
      line.bytes.push(byte);
      return;
    }
    if (line.bytes.at(-1) === CARRIAGE_RETURN) line.bytes.pop();
    this.flushLine(port, line);
  }

  i2c(atNs: number, address: number, op: I2cRecord["op"], bytes: readonly number[]): void {
    this.transfers.push({ atUs: Math.round(atNs) / 1000, address, op, bytes: [...bytes] });
  }

  finish(header: Pick<Trace, "board" | "untilUs" | "clock">, exit: TraceExit): Trace {
    for (const [port, line] of this.lines) {
      if (line.bytes.length > 0) this.flushLine(port, line);
    }
    const timed = header.clock === "virtual";
    return {
      ...header,
      pins: timed ? this.pins.toSorted((a, b) => byTime(a, b) || a.pin - b.pin) : this.pins,
      serial: timed ? this.serial.toSorted(byTime) : this.serial,
      i2c: this.transfers,
      exit,
    };
  }

  private flushLine(port: string, line: PendingLine): void {
    const record = { atUs: microsFromNanos(line.atNs), port, text: decodeLine(line.bytes) };
    this.serial.push(record);
    line.bytes.length = 0;
    this.onLine?.(record);
  }
}
