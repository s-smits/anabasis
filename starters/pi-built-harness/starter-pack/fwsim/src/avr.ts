// Arduino Uno (ATmega328P at 16 MHz) under avr8js. Virtual time is the CPU cycle count.

import {
  AVRADC,
  AVRClock,
  AVREEPROM,
  AVRIOPort,
  AVRSPI,
  AVRTimer,
  AVRTWI,
  AVRUSART,
  AVRWatchdog,
  CPU,
  EEPROMMemoryBackend,
  PinState,
  adcConfig,
  avrInstruction,
  clockConfig,
  eepromConfig,
  portBConfig,
  portCConfig,
  portDConfig,
  spiConfig,
  timer0Config,
  timer1Config,
  timer2Config,
  twiConfig,
  usart0Config,
  watchdogConfig,
} from "avr8js";
import type { AVRPortConfig } from "avr8js";
import { I2cBus } from "./i2c.ts";
import {
  type RunOutcome,
  type RunRequest,
  type SerialFeed,
  UsageError,
  crashExit,
  serialFeeds,
  untilExit,
} from "./run.ts";
import type { StimulusEvent } from "./stimulus.ts";
import type { Level } from "./trace.ts";

interface PortPins {
  readonly config: AVRPortConfig;
  /** The Arduino pin number of bit 0. */
  readonly first: number;
  readonly bits: number;
}

interface UnoPort extends PortPins {
  readonly port: AVRIOPort;
}

/** A loaded Uno flash and one past the highest byte the image filled. */
export interface AvrImage {
  readonly flash: Uint8Array;
  readonly end: number;
}

interface Uno {
  readonly cpu: CPU;
  readonly ports: readonly UnoPort[];
  readonly usart: AVRUSART;
  readonly adc: AVRADC;
  readonly bus: I2cBus;
  /** Pins a gpio event has driven; the others float and read their pull-up. */
  readonly driven: Set<number>;
}

const CPU_HZ = 16_000_000;
const NS_PER_CYCLE = 1e9 / CPU_HZ;
const FLASH_BYTES = 0x8000;
const EEPROM_BYTES = 1024;
const ADC_REFERENCE_VOLTS = 5;
/** Arduino pins D0-D7 are PORTD, D8-D13 PORTB 0-5, and A0-A5 (14-19) PORTC 0-5. */
const PORTS: readonly PortPins[] = [
  { config: portDConfig, first: 0, bits: 8 },
  { config: portBConfig, first: 8, bits: 6 },
  { config: portCConfig, first: 14, bits: 6 },
];
const UART_RETRY_NS = 1000;

/** Intel HEX as arduino-cli writes it; returns the flash and one past the highest byte loaded. */
function loadIntelHex(text: string, flash: Uint8Array): number {
  let base = 0;
  let end = 0;
  for (const [index, raw] of text.split("\n").entries()) {
    const line = raw.trim();
    if (line === "") continue;
    const where = `line ${index + 1}`;
    if (!/^:(?:[0-9A-Fa-f]{2}){5,}$/.test(line)) throw new UsageError(`image ${where}: not Intel HEX`);
    const bytes = Array.from({ length: (line.length - 1) / 2 }, (_, at) =>
      Number.parseInt(line.slice(1 + at * 2, 3 + at * 2), 16),
    );
    const [count = 0, high = 0, low = 0, type = 0] = bytes;
    if (bytes.length !== count + 5 || (bytes.reduce((sum, byte) => sum + byte, 0) & 0xff) !== 0) {
      throw new UsageError(`image ${where}: bad record length or checksum`);
    }
    const data = bytes.slice(4, 4 + count);
    if (type === 0x01) break;
    if (type === 0x02) base = ((data[0] ?? 0) * 256 + (data[1] ?? 0)) * 16;
    if (type === 0x04) base = ((data[0] ?? 0) * 256 + (data[1] ?? 0)) * 65_536;
    if (type !== 0x00) continue;
    const address = base + high * 256 + low;
    if (address + count > FLASH_BYTES) throw new UsageError(`image ${where}: data past the 32 KiB flash`);
    flash.set(data, address);
    end = Math.max(end, address + count);
  }
  return end;
}

/** The flash image and the end of what was loaded, from Intel HEX or a raw binary. */
export function loadAvrImage(image: Uint8Array): AvrImage {
  const flash = new Uint8Array(FLASH_BYTES).fill(0xff);
  if (image[0] === 0x3a) {
    return { flash, end: loadIntelHex(new TextDecoder("latin1").decode(image), flash) };
  }
  if (image.length > FLASH_BYTES) throw new UsageError("image: a raw Uno binary must fit the 32 KiB flash");
  flash.set(image);
  return { flash, end: image.length };
}

function levelOf(state: PinState): Level {
  if (state === PinState.High) return 1;
  return state === PinState.Low ? 0 : null;
}

function buildUno(request: RunRequest, flash: Uint8Array): Uno {
  const cpu = new CPU(new Uint16Array(flash.buffer));
  const now = (): number => cpu.cycles * NS_PER_CYCLE;
  const clock = new AVRClock(cpu, CPU_HZ, clockConfig);
  for (const config of [timer0Config, timer1Config, timer2Config]) new AVRTimer(cpu, config);
  new AVRWatchdog(cpu, watchdogConfig, clock);
  new AVREEPROM(cpu, new EEPROMMemoryBackend(EEPROM_BYTES), eepromConfig);
  new AVRSPI(cpu, spiConfig, CPU_HZ);
  const uno: Uno = {
    cpu,
    ports: PORTS.map((entry) => ({ ...entry, port: new AVRIOPort(cpu, entry.config) })),
    usart: new AVRUSART(cpu, usart0Config, CPU_HZ),
    adc: new AVRADC(cpu, adcConfig),
    bus: new I2cBus(request.stimulus.devices, request.recorder, now),
    driven: new Set(),
  };
  uno.usart.onByteTransmit = (byte) => request.recorder.serialByte(now(), "uart0", byte);
  const twi = new AVRTWI(cpu, twiConfig, CPU_HZ);
  twi.eventHandler = {
    start: () => {
      uno.bus.start();
      twi.completeStart();
    },
    stop: () => {
      uno.bus.stop();
      twi.completeStop();
    },
    connectToSlave: (address, write) =>
      twi.completeConnect(uno.bus.connect(address, write ? "write" : "read")),
    writeByte: (value) => twi.completeWrite(uno.bus.writeByte(value)),
    readByte: () => twi.completeRead(uno.bus.readByte()),
  };
  for (const { port, first, bits } of uno.ports) {
    port.addListener(() => {
      for (let bit = 0; bit < bits; bit++) {
        const state = port.pinState(bit);
        request.recorder.pin(now(), first + bit, levelOf(state));
        if (!uno.driven.has(first + bit)) port.setPin(bit, state === PinState.InputPullUp);
      }
    });
  }
  return uno;
}

function applyEvent(uno: Uno, event: StimulusEvent): void {
  switch (event.kind) {
    case "gpio": {
      const { pin } = event;
      const owner = uno.ports.find((entry) => pin >= entry.first && pin < entry.first + entry.bits);
      if (owner === undefined) throw new UsageError(`pin ${pin} is not an Uno pin`);
      uno.driven.add(pin);
      owner.port.setPin(pin - owner.first, event.level === 1);
      return;
    }
    case "adc":
      // The midpoint of the code's voltage band, so the 10-bit conversion returns exactly `value`.
      uno.adc.channelValues[event.channel] = ((event.value + 0.5) * ADC_REFERENCE_VOLTS) / 1024;
      return;
    case "i2c":
      uno.bus.setRegister(event.address, event.register, event.value);
      return;
    case "uart":
      return;
  }
}

/** The stimulus events and uart bytes still to deliver to an Uno, in time order. */
class UnoInput {
  private readonly uno: Uno;
  private readonly events: readonly StimulusEvent[];
  private readonly feed: SerialFeed | undefined;
  private next = 0;

  constructor(uno: Uno, request: RunRequest) {
    this.uno = uno;
    this.events = request.stimulus.events;
    this.feed = serialFeeds(request.stimulus).get("uart0");
  }

  /** Apply everything due at `nowNs`; returns when input is next due. */
  deliver(nowNs: number): number {
    const { events } = this;
    for (; this.next < events.length && (events[this.next]?.atNs ?? 0) <= nowNs; this.next++) {
      const event = events[this.next];
      if (event !== undefined) applyEvent(this.uno, event);
    }
    return Math.min(events[this.next]?.atNs ?? Number.POSITIVE_INFINITY, this.offerByte(nowNs));
  }

  /** Offer the next uart byte if it is due; returns when to offer again. */
  private offerByte(nowNs: number): number {
    const { feed } = this;
    if (feed === undefined) return Number.POSITIVE_INFINITY;
    if (feed.nextNs > nowNs) return feed.nextNs;
    // A receiver still taking the last byte is asked again shortly; one that is off loses the byte,
    // as on the wire.
    if (this.uno.usart.rxBusy) return nowNs + UART_RETRY_NS;
    this.uno.usart.writeByte(feed.take(nowNs));
    return feed.nextNs;
  }
}

/** Run an Uno image until `untilNs` of virtual time, or until the program counter leaves the image. */
export function runUno(request: RunRequest): RunOutcome {
  const { flash, end } = loadAvrImage(request.image);
  const uno = buildUno(request, flash);
  const { cpu } = uno;
  const input = new UnoInput(uno, request);
  const endWords = Math.ceil(end / 2);
  const untilCycles = Math.floor(request.untilNs / NS_PER_CYCLE);
  let dueCycle = 0;
  while (cpu.cycles < untilCycles) {
    if (cpu.cycles >= dueCycle) dueCycle = Math.ceil(input.deliver(cpu.cycles * NS_PER_CYCLE) / NS_PER_CYCLE);
    avrInstruction(cpu);
    cpu.tick();
    if (cpu.pc >= endWords) {
      const detail = `program counter 0x${(cpu.pc * 2).toString(16)} left the loaded image (0x${end.toString(16)} bytes)`;
      return { clock: "virtual", exit: crashExit(cpu.cycles * NS_PER_CYCLE, detail) };
    }
  }
  return { clock: "virtual", exit: untilExit(request.untilNs) };
}
