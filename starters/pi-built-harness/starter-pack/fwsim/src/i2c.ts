// Register-map I2C targets on the simulated bus, shared by the Uno and RP2040 backends.

import type { I2cDevice } from "./stimulus.ts";
import type { TraceRecorder } from "./trace.ts";

interface Target {
  readonly registers: Uint8Array;
  pointer: number;
}

interface Transfer {
  readonly address: number;
  readonly target: Target;
  readonly op: "write" | "read";
  readonly bytes: number[];
}

/**
 * Each declared device acknowledges its address. In a write transfer the first byte sets the
 * register pointer and later bytes store at it; a read transfer returns bytes from it. The pointer
 * steps by one after each data byte and wraps at 256. Addresses with no device do not acknowledge.
 */
export class I2cBus {
  private readonly targets = new Map<number, Target>();
  private readonly recorder: TraceRecorder;
  private readonly now: () => number;
  private transfer: Transfer | null = null;

  constructor(devices: readonly I2cDevice[], recorder: TraceRecorder, now: () => number) {
    for (const device of devices) {
      this.targets.set(device.address, { registers: device.registers.slice(), pointer: 0 });
    }
    this.recorder = recorder;
    this.now = now;
  }

  get empty(): boolean {
    return this.targets.size === 0;
  }

  setRegister(address: number, register: number, value: number): void {
    const target = this.targets.get(address);
    if (target !== undefined) target.registers[register] = value;
  }

  /** A start or repeated start: whatever transfer was open ends here. */
  start(): void {
    this.close();
  }

  connect(address: number, op: Transfer["op"]): boolean {
    this.close();
    const target = this.targets.get(address);
    if (target === undefined) return false;
    this.transfer = { address, target, op, bytes: [] };
    return true;
  }

  writeByte(value: number): boolean {
    const { transfer } = this;
    if (transfer?.op !== "write") return false;
    const { target } = transfer;
    if (transfer.bytes.length === 0) {
      target.pointer = value;
    } else {
      target.registers[target.pointer] = value;
      target.pointer = (target.pointer + 1) & 0xff;
    }
    transfer.bytes.push(value);
    return true;
  }

  readByte(): number {
    const { transfer } = this;
    if (transfer?.op !== "read") return 0xff;
    const { target } = transfer;
    const value = target.registers[target.pointer] ?? 0xff;
    target.pointer = (target.pointer + 1) & 0xff;
    transfer.bytes.push(value);
    return value;
  }

  stop(): void {
    this.close();
  }

  private close(): void {
    const { transfer } = this;
    this.transfer = null;
    if (transfer === null || transfer.bytes.length === 0) return;
    this.recorder.i2c(this.now(), transfer.address, transfer.op, transfer.bytes);
  }
}
