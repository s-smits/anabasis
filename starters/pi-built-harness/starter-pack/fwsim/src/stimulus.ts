// The stimulus file: scripted inputs at virtual times, read from JSON and checked against one board.

export type Board = "esp32" | "rp2040" | "uno";

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | JsonObject;
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export interface GpioEvent {
  readonly atNs: number;
  readonly kind: "gpio";
  readonly pin: number;
  readonly level: 0 | 1;
}
export interface AdcEvent {
  readonly atNs: number;
  readonly kind: "adc";
  readonly channel: number;
  readonly value: number;
}
export interface UartEvent {
  readonly atNs: number;
  readonly kind: "uart";
  readonly port: string;
  readonly bytes: Uint8Array;
  readonly baud: number;
}
export interface I2cEvent {
  readonly atNs: number;
  readonly kind: "i2c";
  readonly address: number;
  readonly register: number;
  readonly value: number;
}
export type StimulusEvent = GpioEvent | AdcEvent | UartEvent | I2cEvent;

/** A register-map I2C target: a write sets the register pointer, then bytes go to or come from it. */
export interface I2cDevice {
  readonly address: number;
  readonly registers: Uint8Array;
}

export interface Stimulus {
  readonly events: readonly StimulusEvent[];
  readonly devices: readonly I2cDevice[];
}

interface BoardProfile {
  /** GPIO numbers 0..gpioPins-1 accept a gpio event (Uno: Arduino pin numbers, A0..A5 = 14..19). */
  readonly gpioPins: number;
  readonly adcMax: number;
  /** The pin behind each ADC channel, by channel number; null for an internal channel. */
  readonly adcPins: readonly (number | null)[];
  /** Ports that take uart input; the first is the default. */
  readonly uartPorts: readonly string[];
  readonly i2cDevices: boolean;
}

export const BOARD_PROFILES = {
  uno: {
    gpioPins: 20,
    adcMax: 1023,
    adcPins: [14, 15, 16, 17, 18, 19],
    uartPorts: ["uart0"],
    i2cDevices: true,
  },
  rp2040: {
    gpioPins: 30,
    adcMax: 4095,
    adcPins: [26, 27, 28, 29, null],
    uartPorts: ["usb", "uart0", "uart1"],
    i2cDevices: true,
  },
  esp32: {
    gpioPins: 40,
    adcMax: 4095,
    adcPins: [36, 37, 38, 39, 32, 33, 34, 35],
    uartPorts: [],
    i2cDevices: false,
  },
} as const satisfies Record<Board, BoardProfile>;

const EVENT_KEYS = {
  gpio: ["atUs", "kind", "pin", "level"],
  adc: ["atUs", "kind", "channel", "pin", "value"],
  uart: ["atUs", "kind", "text", "port", "baud"],
  i2c: ["atUs", "kind", "address", "register", "value"],
} as const;
const DEFAULT_BAUD = 115_200;

/** A stimulus the board cannot apply; the run stops before any simulation. */
export class StimulusError extends Error {}

function isNumber(value: JsonValue | undefined): value is number {
  return Number.isFinite(value);
}

/** Strings are the one JSON value left once null, booleans, numbers, arrays and objects are out. */
function isText(value: JsonValue | undefined): value is string {
  return (
    value !== undefined &&
    value !== null &&
    value !== true &&
    value !== false &&
    !isNumber(value) &&
    !(value instanceof Object)
  );
}

function isJsonArray(value: JsonValue | undefined): value is readonly JsonValue[] {
  return Array.isArray(value);
}

/** JSON objects and arrays are the JSON values that are objects; an array is not a JSON object. */
function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return value instanceof Object && !isJsonArray(value);
}

function checkKeys(record: JsonObject, allowed: readonly string[], where: string): void {
  const extra = Object.keys(record).filter((key) => !allowed.includes(key));
  if (extra.length > 0) {
    throw new StimulusError(`${where}: unknown key ${extra.join(", ")} (allowed: ${allowed.join(", ")})`);
  }
}

function integerIn(record: JsonObject, key: string, range: readonly [number, number], where: string): number {
  const value = record[key];
  if (!isNumber(value) || !Number.isInteger(value) || value < range[0] || value > range[1]) {
    throw new StimulusError(`${where}.${key}: must be an integer from ${range[0]} to ${range[1]}`);
  }
  return value;
}

function optionalInteger(
  record: JsonObject,
  key: string,
  range: readonly [number, number],
  where: string,
): number | null {
  return record[key] === undefined ? null : integerIn(record, key, range, where);
}

/** Microseconds from the start of the run, to whole nanoseconds. */
export function nanosFromMicros(atUs: JsonValue | undefined, where: string): number {
  if (!isNumber(atUs) || atUs < 0) {
    throw new StimulusError(`${where}: must be a finite number of microseconds >= 0`);
  }
  return Math.round(atUs * 1000);
}

function adcChannel(record: JsonObject, profile: BoardProfile, where: string): number {
  const channel = optionalInteger(record, "channel", [0, profile.adcPins.length - 1], where);
  const pin = optionalInteger(record, "pin", [0, profile.gpioPins - 1], where);
  if ((channel === null) === (pin === null)) {
    throw new StimulusError(`${where}: give exactly one of channel or pin`);
  }
  if (channel !== null) return channel;
  const byPin = profile.adcPins.indexOf(pin);
  if (byPin < 0) {
    const pins = profile.adcPins.filter((entry) => entry !== null).join(", ");
    throw new StimulusError(
      `${where}.pin: ${String(pin)} has no ADC channel on this board (ADC pins: ${pins})`,
    );
  }
  return byPin;
}

function uartEvent(record: JsonObject, atNs: number, profile: BoardProfile, where: string): UartEvent {
  const { text, port = profile.uartPorts[0] ?? "" } = record;
  if (profile.uartPorts.length === 0) throw new StimulusError(`${where}: this board takes no uart input`);
  if (!isText(text)) throw new StimulusError(`${where}.text: must be a string`);
  if (!isText(port) || !profile.uartPorts.includes(port)) {
    throw new StimulusError(`${where}.port: must be one of ${profile.uartPorts.join(", ")}`);
  }
  const baud = optionalInteger(record, "baud", [300, 4_000_000], where) ?? DEFAULT_BAUD;
  return { atNs, kind: "uart", port, bytes: new TextEncoder().encode(text), baud };
}

function parseEvent(entry: JsonValue, profile: BoardProfile, where: string): StimulusEvent {
  if (!isJsonObject(entry)) throw new StimulusError(`${where}: must be an object`);
  const { kind } = entry;
  if (kind !== "gpio" && kind !== "adc" && kind !== "uart" && kind !== "i2c") {
    throw new StimulusError(`${where}.kind: must be gpio, adc, uart or i2c`);
  }
  checkKeys(entry, EVENT_KEYS[kind], where);
  const atNs = nanosFromMicros(entry["atUs"], `${where}.atUs`);
  switch (kind) {
    case "gpio": {
      const pin = integerIn(entry, "pin", [0, profile.gpioPins - 1], where);
      const level = integerIn(entry, "level", [0, 1], where) === 1 ? 1 : 0;
      return { atNs, kind, pin, level };
    }
    case "adc": {
      const channel = adcChannel(entry, profile, where);
      return { atNs, kind, channel, value: integerIn(entry, "value", [0, profile.adcMax], where) };
    }
    case "uart":
      return uartEvent(entry, atNs, profile, where);
    case "i2c":
      return {
        atNs,
        kind,
        address: integerIn(entry, "address", [0x08, 0x77], where),
        register: integerIn(entry, "register", [0, 255], where),
        value: integerIn(entry, "value", [0, 255], where),
      };
  }
}

function parseDevice(entry: JsonValue, where: string): I2cDevice {
  if (!isJsonObject(entry)) throw new StimulusError(`${where}: must be an object`);
  checkKeys(entry, ["kind", "address", "registers"], where);
  if (entry["kind"] !== "i2c") throw new StimulusError(`${where}.kind: must be i2c`);
  const address = integerIn(entry, "address", [0x08, 0x77], where);
  const registers = new Uint8Array(256);
  const listed = entry["registers"] ?? [];
  if (!isJsonArray(listed) || listed.length > 256) {
    throw new StimulusError(`${where}.registers: must be an array of at most 256 bytes`);
  }
  for (const [index, value] of listed.entries()) {
    if (!isNumber(value) || !Number.isInteger(value) || value < 0 || value > 255) {
      throw new StimulusError(`${where}.registers[${index}]: must be an integer from 0 to 255`);
    }
    registers[index] = value;
  }
  return { address, registers };
}

function checkI2c(events: readonly StimulusEvent[], devices: readonly I2cDevice[], board: Board): void {
  const addresses = devices.map((device) => device.address);
  if (new Set(addresses).size !== addresses.length) {
    throw new StimulusError("devices: two devices share an address");
  }
  if (devices.length > 0 && !BOARD_PROFILES[board].i2cDevices) {
    throw new StimulusError(`devices: the ${board} board models no I2C devices`);
  }
  for (const [index, event] of events.entries()) {
    if (event.kind === "i2c" && !addresses.includes(event.address)) {
      throw new StimulusError(`events[${index}].address: no device declared at ${event.address}`);
    }
  }
}

/** Parse stimulus JSON for `board`; events come back stably sorted by time. */
export function parseStimulus(text: string, board: Board): Stimulus {
  let root: JsonValue;
  try {
    // SAFETY: JSON.parse yields only JSON values, which is what JsonValue lists.
    root = JSON.parse(text) as JsonValue;
  } catch (error) {
    throw new StimulusError(`stimulus is not JSON: ${String(error)}`, { cause: error });
  }
  if (!isJsonObject(root)) throw new StimulusError("stimulus: must be an object");
  checkKeys(root, ["events", "devices"], "stimulus");
  const rawEvents = root["events"] ?? [];
  const rawDevices = root["devices"] ?? [];
  if (!isJsonArray(rawEvents)) throw new StimulusError("events: must be an array");
  if (!isJsonArray(rawDevices)) throw new StimulusError("devices: must be an array");
  const profile = BOARD_PROFILES[board];
  const events = rawEvents.map((entry, index) => parseEvent(entry, profile, `events[${index}]`));
  const devices = rawDevices.map((entry, index) => parseDevice(entry, `devices[${index}]`));
  checkI2c(events, devices, board);
  return { events: events.toSorted((a, b) => a.atNs - b.atNs), devices };
}
