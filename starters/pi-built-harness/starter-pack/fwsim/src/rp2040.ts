// Raspberry Pi RP2040 (core 0) under rp2040js, on a virtual clock this file owns.

import { GPIOPinState, I2CMode, RP2040, USBCDC } from "rp2040js";
import type { Logger, RPPIO } from "rp2040js";
import { I2cBus } from "./i2c.ts";
import {
  type RunOutcome,
  type RunRequest,
  type SerialFeed,
  SimulatorError,
  UsageError,
  crashExit,
  parentDir,
  serialFeeds,
  untilExit,
} from "./run.ts";
import type { StimulusEvent } from "./stimulus.ts";
import type { Level } from "./trace.ts";

interface Pico {
  readonly mcu: RP2040;
  readonly clock: VirtualClock;
  readonly cdc: USBCDC;
  readonly bus: I2cBus;
  readonly driven: Set<number>;
  /** PIO blocks, run by fwsim in lockstep with the CPU rather than on rp2040js's host timers. */
  readonly lanes: readonly PioLane[];
  crash: string | null;
}

/** A PIO block stepped in lockstep with the CPU, with each state machine's owed PIO cycles. */
interface PioLane {
  readonly pio: RPPIO;
  readonly owed: number[];
}

/** The component name rp2040js's core logs under, as opposed to its peripherals. */
const CORE_LOG_NAME = "RP2040";
const FLASH_BASE = 0x1000_0000;
const FLASH_BYTES = 16 * 1024 * 1024;
const SRAM_BASE = 0x2000_0000;
const SRAM_END = 0x2004_2000;
const BOOTROM_BYTES = 0x4000;
const BOOTROM_FILE = "rp2040-bootrom-b1.bin";
const UF2_MAGIC_START0 = 0x0a32_4655;
const UF2_MAGIC_START1 = 0x9e5d_5157;
const UF2_BLOCK = 512;
/** While a PIO block runs, a sleeping core advances in slices this long so PIO edges keep their times. */
const PIO_SLICE_NS = 1000;
const HARD_FAULT = 3;

/** Alarms on virtual nanoseconds, the clock rp2040js peripherals schedule on. */
class VirtualClock {
  nanos = 0;
  private queue: VirtualAlarm[] = [];

  createAlarm(callback: () => void): VirtualAlarm {
    return new VirtualAlarm(this, callback);
  }

  link(alarm: VirtualAlarm): void {
    this.unlink(alarm);
    const at = this.queue.findLastIndex((other) => other.nanos <= alarm.nanos);
    this.queue.splice(at + 1, 0, alarm);
  }

  unlink(alarm: VirtualAlarm): void {
    this.queue = this.queue.filter((other) => other !== alarm);
  }

  get nextAlarmNanos(): number {
    return this.queue[0]?.nanos ?? Number.POSITIVE_INFINITY;
  }

  /** Move time forward by `deltaNanos`, firing each alarm due on the way at its own time. */
  advance(deltaNanos: number): void {
    const target = this.nanos + deltaNanos;
    for (let alarm = this.queue[0]; alarm !== undefined && alarm.nanos <= target; alarm = this.queue[0]) {
      this.queue.shift();
      this.nanos = alarm.nanos;
      alarm.callback();
    }
    this.nanos = target;
  }
}

class VirtualAlarm {
  nanos = 0;
  readonly callback: () => void;
  private readonly clock: VirtualClock;

  constructor(clock: VirtualClock, callback: () => void) {
    this.clock = clock;
    this.callback = callback;
  }

  schedule(deltaNanos: number): void {
    this.nanos = this.clock.nanos + deltaNanos;
    this.clock.link(this);
  }

  cancel(): void {
    this.clock.unlink(this);
  }
}

/** The B1 bootrom, shipped beside the bundle (installed) or beside `src/` (source checkout). */
async function readBootrom(): Promise<Uint32Array> {
  for (const dir of [import.meta.dir, parentDir(import.meta.dir)]) {
    const file = Bun.file(`${dir}/${BOOTROM_FILE}`);
    const bytes = (await file.exists()) ? await file.bytes() : null;
    if (bytes?.length === BOOTROM_BYTES) {
      return new Uint32Array(bytes.buffer, bytes.byteOffset, BOOTROM_BYTES / 4);
    }
  }
  throw new SimulatorError(`${BOOTROM_FILE} is missing beside fwsim; reinstall it`);
}

/** A raw flash image (.bin) or a UF2 file, as flash bytes from 0x10000000. */
export function loadFlashImage(image: Uint8Array): Uint8Array {
  const view = new DataView(image.buffer, image.byteOffset, image.byteLength);
  const isUf2 = image.length >= UF2_BLOCK && view.getUint32(0, true) === UF2_MAGIC_START0;
  if (!isUf2) {
    if (image.length > FLASH_BYTES) throw new UsageError("image: larger than the 16 MiB flash");
    return image;
  }
  const flash = new Uint8Array(FLASH_BYTES).fill(0xff);
  let end = 0;
  for (let at = 0; at + UF2_BLOCK <= image.length; at += UF2_BLOCK) {
    if (view.getUint32(at, true) !== UF2_MAGIC_START0 || view.getUint32(at + 4, true) !== UF2_MAGIC_START1) {
      throw new UsageError(`image: UF2 block at byte ${at} has no UF2 magic`);
    }
    const offset = view.getUint32(at + 12, true) - FLASH_BASE;
    const size = view.getUint32(at + 16, true);
    if (offset < 0 || size > 476 || offset + size > FLASH_BYTES) {
      throw new UsageError(`image: UF2 block at byte ${at} targets memory outside flash`);
    }
    flash.set(image.subarray(at + 32, at + 32 + size), offset);
    end = Math.max(end, offset + size);
  }
  return flash.subarray(0, end);
}

function levelOf(state: GPIOPinState): Level {
  if (state === GPIOPinState.High) return 1;
  return state === GPIOPinState.Low ? 0 : null;
}

function isExecutable(pc: number): boolean {
  return (
    pc < BOOTROM_BYTES ||
    (pc >= FLASH_BASE && pc < FLASH_BASE + FLASH_BYTES) ||
    (pc >= SRAM_BASE && pc < SRAM_END)
  );
}

function ignore(): void {
  // rp2040js's debug, info and warn messages describe the model, not the firmware.
}

/**
 * rp2040js's core reports an access the chip faults on (an unaligned word read) as an error, and
 * the first one ends the run as a crash. A peripheral's error (PIO, for one) names something
 * rp2040js does not model, so the run stops as a simulator failure, not a verdict on the firmware.
 */
function faultLogger(pico: Pico): Logger {
  return {
    debug: ignore,
    info: ignore,
    warn: ignore,
    error: (component, message) => {
      if (component !== CORE_LOG_NAME) {
        throw new SimulatorError(`rp2040js cannot simulate this: [${component}] ${message}`);
      }
      pico.crash ??= `[${component}] ${message}`;
    },
  };
}

function wireI2c(pico: Pico): void {
  for (const i2c of pico.mcu.i2c) {
    i2c.onStart = () => {
      pico.bus.start();
      i2c.completeStart();
    };
    i2c.onConnect = (address, mode) =>
      i2c.completeConnect(pico.bus.connect(address, mode === I2CMode.Write ? "write" : "read"));
    i2c.onWriteByte = (value) => i2c.completeWrite(pico.bus.writeByte(value));
    i2c.onReadByte = () => i2c.completeRead(pico.bus.readByte());
    i2c.onStop = () => {
      pico.bus.stop();
      i2c.completeStop();
    };
  }
}

function buildPico(request: RunRequest, bootrom: Uint32Array): Pico {
  const clock = new VirtualClock();
  const mcu = new RP2040(clock);
  mcu.loadBootrom(bootrom);
  mcu.flash.set(loadFlashImage(request.image));
  mcu.core.PC = FLASH_BASE;
  const now = (): number => clock.nanos;
  const { recorder } = request;
  const pico: Pico = {
    mcu,
    clock,
    cdc: new USBCDC(mcu.usbCtrl),
    bus: new I2cBus(request.stimulus.devices, recorder, now),
    driven: new Set(),
    lanes: mcu.pio.map((pio) => {
      pio.run = () => undefined;
      return { pio, owed: [0, 0, 0, 0] };
    }),
    crash: null,
  };
  pico.cdc.onSerialData = (buffer) => {
    for (const byte of buffer) recorder.serialByte(now(), "usb", byte);
  };
  for (const [index, uart] of mcu.uart.entries()) {
    uart.onByte = (byte) => recorder.serialByte(now(), `uart${index}`, byte);
  }
  for (const [pin, gpio] of mcu.gpio.entries()) {
    gpio.addListener((state) => {
      recorder.pin(now(), pin, levelOf(state));
      if (!pico.driven.has(pin)) gpio.setInputValue(state === GPIOPinState.InputPullUp);
    });
  }
  mcu.logger = faultLogger(pico);
  mcu.onBreak = (code) => {
    pico.crash = `breakpoint instruction (code ${code}) at 0x${mcu.core.PC.toString(16)}`;
  };
  wireI2c(pico);
  return pico;
}

function applyEvent(pico: Pico, event: StimulusEvent): void {
  switch (event.kind) {
    case "gpio":
      pico.driven.add(event.pin);
      pico.mcu.gpio[event.pin]?.setInputValue(event.level === 1);
      return;
    case "adc":
      pico.mcu.adc.channelValues[event.channel] = event.value;
      return;
    case "i2c":
      pico.bus.setRegister(event.address, event.register, event.value);
      return;
    case "uart":
      return;
  }
}

/** The stimulus events and serial bytes still to deliver to a Pico, in time order. */
class PicoInput {
  private readonly pico: Pico;
  private readonly events: readonly StimulusEvent[];
  private readonly feeds: ReadonlyMap<string, SerialFeed>;
  private next = 0;

  constructor(pico: Pico, request: RunRequest) {
    this.pico = pico;
    this.events = request.stimulus.events;
    this.feeds = serialFeeds(request.stimulus);
  }

  /** Apply everything due at `nowNs`; returns when input is next due. */
  deliver(nowNs: number): number {
    const { events, pico } = this;
    for (; this.next < events.length && (events[this.next]?.atNs ?? 0) <= nowNs; this.next++) {
      const event = events[this.next];
      if (event !== undefined) applyEvent(pico, event);
    }
    for (const [port, feed] of this.feeds) {
      if (feed.nextNs > nowNs) continue;
      const byte = feed.take(nowNs);
      if (port === "usb") pico.cdc.sendSerialByte(byte);
      else pico.mcu.uart[port === "uart0" ? 0 : 1]?.feedByte(byte);
    }
    const feedsDue = this.feeds.values().map((feed) => feed.nextNs);
    return Math.min(events[this.next]?.atNs ?? Number.POSITIVE_INFINITY, ...feedsDue);
  }
}

/**
 * Step each running PIO state machine for `sysCycles` system clock cycles at its clock divider.
 * rp2040js would run PIO from host timers; here it runs in virtual time, one instruction per
 * 1 + delay PIO cycles, so a program's timing follows the CPU's.
 */
function stepPio(lanes: readonly PioLane[], sysCycles: number): void {
  for (const { pio, owed } of lanes) {
    if (pio.stopped) continue;
    for (const [index, machine] of pio.machines.entries()) {
      if (!machine.enabled) {
        owed[index] = 0;
        continue;
      }
      const divider = (machine.clockDivInt || 65_536) + machine.clockDivFrac / 256;
      let credit = (owed[index] ?? 0) + sysCycles / divider;
      while (credit >= 1) {
        const before = machine.cycles;
        machine.step();
        credit -= Math.max(1, machine.cycles - before);
      }
      owed[index] = credit;
    }
    pio.checkChangedPins();
  }
}

/** Run an RP2040 image on core 0 until `untilNs` of virtual time, a breakpoint or a HardFault. */
export async function runRp2040(request: RunRequest): Promise<RunOutcome> {
  const pico = buildPico(request, await readBootrom());
  const { mcu, clock } = pico;
  const { core } = mcu;
  const { lanes } = pico;
  const input = new PicoInput(pico, request);
  const { untilNs } = request;
  let dueNs = 0;
  while (clock.nanos < untilNs) {
    if (clock.nanos >= dueNs) dueNs = input.deliver(clock.nanos);
    const nsPerCycle = 1e9 / mcu.clkSys;
    if (core.waiting) {
      const pioRunning = lanes.some((lane) => !lane.pio.stopped);
      const sliceEnd = pioRunning ? clock.nanos + PIO_SLICE_NS : Infinity;
      const target = Math.min(clock.nextAlarmNanos, dueNs, untilNs, sliceEnd);
      const delta = Math.max(target - clock.nanos, 0);
      stepPio(lanes, delta / nsPerCycle);
      clock.advance(delta);
      continue;
    }
    const cycles = core.executeInstruction();
    stepPio(lanes, cycles);
    clock.advance(cycles * nsPerCycle);
    if (pico.crash === null && core.IPSR === HARD_FAULT) pico.crash = "HardFault exception";
    if (pico.crash === null && !isExecutable(core.PC)) {
      pico.crash = `program counter 0x${core.PC.toString(16)} left executable memory`;
    }
    if (pico.crash !== null) return { clock: "virtual", exit: crashExit(clock.nanos, pico.crash) };
  }
  return { clock: "virtual", exit: untilExit(untilNs) };
}
