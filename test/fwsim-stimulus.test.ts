import { describe, expect, it } from "bun:test";

import { loadAvrImage } from "../starters/pi-built-harness/starter-pack/fwsim/src/avr.ts";
import { readTraceLog, stimulusFile } from "../starters/pi-built-harness/starter-pack/fwsim/src/esp32.ts";
import { I2cBus } from "../starters/pi-built-harness/starter-pack/fwsim/src/i2c.ts";
import { loadFlashImage } from "../starters/pi-built-harness/starter-pack/fwsim/src/rp2040.ts";
import {
  type RunRequest,
  SerialFeed,
  UsageError,
} from "../starters/pi-built-harness/starter-pack/fwsim/src/run.ts";
import {
  type Board,
  type JsonObject,
  StimulusError,
  parseStimulus,
} from "../starters/pi-built-harness/starter-pack/fwsim/src/stimulus.ts";
import { TraceRecorder, decodeLine } from "../starters/pi-built-harness/starter-pack/fwsim/src/trace.ts";

const HEADER = { board: "uno", untilUs: 1000, clock: "virtual" } as const;
const UNTIL = { reason: "until", atUs: 1000, detail: null } as const;
const UNTIL_AT_200 = { reason: "until", atUs: 200, detail: null } as const;

function parse(board: Board, stimulus: JsonObject): ReturnType<typeof parseStimulus> {
  return parseStimulus(JSON.stringify(stimulus), board);
}

function rejection(board: Board, stimulus: JsonObject): string {
  try {
    parse(board, stimulus);
  } catch (error) {
    if (error instanceof StimulusError) return error.message;
    throw error;
  }
  throw new Error("the stimulus was accepted");
}

function mmio(address: number, value: number): string {
  const name = address === 0x3ff40000 ? "esp_soc.uart" : "esp32.gpio";
  return `memory_region_ops_write cpu 0 mr 0x1 addr 0x${address.toString(16)} value 0x${value.toString(16)} size 4 name '${name}'`;
}

function uartBytes(text: string): string[] {
  return Array.from(new TextEncoder().encode(text), (byte) => mmio(0x3ff40000, byte));
}

describe("fwsim stimulus", () => {
  it("sorts events by time and keeps the file order of events at the same time", () => {
    const { events } = parse("uno", {
      events: [
        { atUs: 20, kind: "gpio", pin: 3, level: 1 },
        { atUs: 5, kind: "gpio", pin: 2, level: 1 },
        { atUs: 5, kind: "gpio", pin: 2, level: 0 },
        { atUs: 0.0004, kind: "adc", channel: 1, value: 7 },
      ],
    });
    expect(events.map((event) => [event.atNs, event.kind, "level" in event ? event.level : null])).toEqual([
      [0, "adc", null],
      [5000, "gpio", 1],
      [5000, "gpio", 0],
      [20_000, "gpio", 1],
    ]);
  });

  it("maps an ADC pin to its channel on each board", () => {
    const channelOf = (board: Board, pin: number) => {
      const [event] = parse(board, { events: [{ atUs: 0, kind: "adc", pin, value: 1 }] }).events;
      return event?.kind === "adc" ? event.channel : null;
    };
    expect([
      channelOf("uno", 14),
      channelOf("uno", 19),
      channelOf("rp2040", 28),
      channelOf("esp32", 34),
    ]).toEqual([0, 5, 2, 6]);
  });

  it("encodes uart text as UTF-8 on the board's default port at 115200 baud", () => {
    const [event] = parse("rp2040", { events: [{ atUs: 1, kind: "uart", text: "é\n" }] }).events;
    expect(event?.kind === "uart" ? [event.port, event.baud, [...event.bytes]] : null).toEqual([
      "usb",
      115_200,
      [0xc3, 0xa9, 0x0a],
    ]);
  });

  it("refuses what the board cannot apply, naming the field", () => {
    expect(rejection("uno", { events: [{ atUs: 0, kind: "gpio", pin: 2, level: 2 }] })).toBe(
      "events[0].level: must be an integer from 0 to 1",
    );
    expect(rejection("uno", { events: [{ atUs: 0, kind: "gpio", pin: 20, level: 1 }] })).toContain(
      "events[0].pin",
    );
    expect(rejection("uno", { events: [{ atUs: -1, kind: "gpio", pin: 2, level: 1 }] })).toContain(
      "events[0].atUs",
    );
    expect(rejection("uno", { events: [{ atUs: 0, kind: "gpio", pin: 2, lvl: 1 }] })).toContain(
      "unknown key lvl",
    );
    expect(rejection("uno", { events: [{ atUs: 0, kind: "adc", pin: 2, value: 1 }] })).toContain(
      "has no ADC channel",
    );
    expect(rejection("uno", { events: [{ atUs: 0, kind: "adc", pin: 14, channel: 0, value: 1 }] })).toContain(
      "exactly one of channel or pin",
    );
    expect(rejection("uno", { events: [{ atUs: 0, kind: "adc", channel: 0, value: 1024 }] })).toContain(
      "from 0 to 1023",
    );
    expect(rejection("rp2040", { events: [{ atUs: 0, kind: "uart", text: "x", port: "uart2" }] })).toContain(
      "must be one of usb, uart0, uart1",
    );
    expect(rejection("esp32", { events: [{ atUs: 0, kind: "uart", text: "x" }] })).toContain(
      "takes no uart input",
    );
    expect(rejection("esp32", { devices: [{ kind: "i2c", address: 0x48 }] })).toContain(
      "models no I2C devices",
    );
    expect(
      rejection("uno", { events: [{ atUs: 0, kind: "i2c", address: 0x48, register: 0, value: 1 }] }),
    ).toContain("no device declared at 72");
    expect(
      rejection("uno", {
        devices: [
          { kind: "i2c", address: 0x48 },
          { kind: "i2c", address: 0x48 },
        ],
      }),
    ).toContain("share an address");
    expect(() => parseStimulus("{", "uno")).toThrow(StimulusError);
  });
});

describe("fwsim trace", () => {
  it("records only pin changes, sorted by time and then pin, to whole nanoseconds", () => {
    const recorder = new TraceRecorder(null);
    recorder.pin(2000.4, 13, 1);
    recorder.pin(2500, 13, 1);
    recorder.pin(1000, 8, 0);
    recorder.pin(1000, 7, null);
    recorder.pin(1000, 3, 0);
    recorder.pin(3000, 13, null);
    expect(recorder.finish(HEADER, UNTIL).pins).toEqual([
      { atUs: 1, pin: 3, level: 0 },
      { atUs: 1, pin: 8, level: 0 },
      { atUs: 2, pin: 13, level: 1 },
      { atUs: 3, pin: 13, level: null },
    ]);
  });

  it("keeps only the pins a filter names", () => {
    const recorder = new TraceRecorder(new Set([13]));
    recorder.pin(1, 12, 1);
    recorder.pin(1, 13, 1);
    expect(recorder.finish(HEADER, UNTIL).pins.map((row) => row.pin)).toEqual([13]);
  });

  it("splits serial into lines at their last byte, drops one CR before LF and flushes a partial line", () => {
    const recorder = new TraceRecorder(null);
    const send = (atNs: number, port: string, text: string) => {
      for (const byte of new TextEncoder().encode(text)) recorder.serialByte(atNs, port, byte);
    };
    send(1000, "uart0", "rea");
    send(2000, "uart0", "dy\r\n\r\r\n");
    send(1500, "usb", "x\n");
    send(4000, "uart0", "tail");
    expect(recorder.finish(HEADER, UNTIL).serial).toEqual([
      { atUs: 1.5, port: "usb", text: "x" },
      { atUs: 2, port: "uart0", text: "ready" },
      { atUs: 2, port: "uart0", text: "\r" },
      { atUs: 4, port: "uart0", text: "tail" },
    ]);
  });

  it("decodes UTF-8 lines and falls back to one character per byte", () => {
    expect([decodeLine([0xc3, 0xa9]), decodeLine([0x41, 0xff, 0x42])]).toEqual(["é", "AÿB"]);
  });

  it("paces uart input one character time apart at the event's baud", () => {
    const feed = new SerialFeed([
      { atNs: 1000, kind: "uart", port: "uart0", bytes: Uint8Array.of(1, 2), baud: 10_000 },
    ]);
    expect(feed.nextNs).toBe(1000);
    expect(feed.take(5000)).toBe(1);
    expect(feed.nextNs).toBe(5000 + 1_000_000);
    expect(feed.take(2_000_000)).toBe(2);
    expect(feed.nextNs).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("fwsim images and devices", () => {
  it("loads Intel HEX and refuses a record with a bad checksum", () => {
    const image = new TextEncoder().encode(":0400100001020304E2\n:00000001FF\n");
    const { flash, end } = loadAvrImage(image);
    expect([[...flash.subarray(0x10, 0x14)], end, flash[0]]).toEqual([[1, 2, 3, 4], 0x14, 0xff]);
    expect(() => loadAvrImage(new TextEncoder().encode(":0400100001020304E3\n"))).toThrow(UsageError);
  });

  it("lays UF2 blocks out at their flash addresses", () => {
    const block = new Uint8Array(512);
    const view = new DataView(block.buffer);
    view.setUint32(0, 0x0a324655, true);
    view.setUint32(4, 0x9e5d5157, true);
    view.setUint32(12, 0x10000100, true);
    view.setUint32(16, 4, true);
    block.set([9, 8, 7, 6], 32);
    const flash = loadFlashImage(block);
    expect([flash.length, [...flash.subarray(0x100, 0x104)], flash[0]]).toEqual([0x104, [9, 8, 7, 6], 0xff]);
  });

  it("serves a register map over I2C: the first written byte is the pointer, reads continue from it", () => {
    let now = 0;
    const recorder = new TraceRecorder(null);
    const bus = new I2cBus([{ address: 0x48, registers: Uint8Array.of(10, 11, 12) }], recorder, () => now);
    expect(bus.connect(0x49, "write")).toBe(false);
    expect(bus.connect(0x48, "write")).toBe(true);
    bus.writeByte(1);
    bus.writeByte(0x55);
    bus.stop();
    now = 1000;
    bus.connect(0x48, "write");
    bus.writeByte(0);
    bus.start();
    bus.connect(0x48, "read");
    const read = [bus.readByte(), bus.readByte()];
    bus.stop();
    bus.setRegister(0x48, 2, 99);
    bus.connect(0x48, "write");
    bus.writeByte(2);
    bus.connect(0x48, "read");
    expect([read, bus.readByte()]).toEqual([[10, 0x55], 99]);
    expect(recorder.finish(HEADER, UNTIL).i2c.slice(0, 3)).toEqual([
      { atUs: 0, address: 0x48, op: "write", bytes: [1, 0x55] },
      { atUs: 1, address: 0x48, op: "write", bytes: [0] },
      { atUs: 1, address: 0x48, op: "read", bytes: [10, 0x55] },
    ]);
  });
});

describe("fwsim ESP32 adapter", () => {
  const request = (events: JsonObject[], untilUs: number): RunRequest => ({
    board: "esp32",
    imagePath: "unused.bin",
    image: new Uint8Array(),
    stimulus: parse("esp32", { events }),
    untilNs: untilUs * 1000,
    recorder: new TraceRecorder(null),
  });

  it("writes events between time markers and quits at the end of the run", () => {
    const text = stimulusFile(
      request(
        [
          { atUs: 60, kind: "gpio", pin: 4, level: 1 },
          { atUs: 100, kind: "adc", pin: 35, value: 4000 },
          { atUs: 500, kind: "gpio", pin: 4, level: 0 },
        ],
        160,
      ),
    );
    expect(text.split("\n").slice(1)).toEqual([
      "50000 adc1 7 0",
      "60000 gpio 4 1",
      "100000 adc1 7 4000",
      "100000 adc1 7 4000",
      "150000 adc1 7 4000",
      "160000 quit",
      "",
    ]);
  });

  it("reads a stock log in order with no clock, tracking output enable and the output matrix", () => {
    const recorder = new TraceRecorder(null);
    const log = [
      ...uartBytes("ready\r\n"),
      mmio(0x3ff44008, 1 << 2),
      mmio(0x3ff44024, 1 << 2),
      mmio(0x3ff44030, 1 << 1),
      mmio(0x3ff44014, 1 << 1),
      mmio(0x3ff4400c, 1 << 2),
      mmio(0x3ff44530 + 4 * 33, 0x0e),
      ...uartBytes("half"),
    ];
    expect(readTraceLog(`${log.join("\n")}\nmemory_region_ops_write cpu 0 mr`, recorder, null)).toBeNull();
    const trace = recorder.finish({ board: "esp32", untilUs: 1, clock: "none" }, UNTIL);
    expect(trace.pins).toEqual([
      { atUs: null, pin: 2, level: 1 },
      { atUs: null, pin: 33, level: 0 },
      { atUs: null, pin: 33, level: 1 },
      { atUs: null, pin: 2, level: 0 },
      { atUs: null, pin: 33, level: null },
    ]);
    expect(trace.serial).toEqual([
      { atUs: null, port: "uart0", text: "ready" },
      { atUs: null, port: "uart0", text: "half" },
    ]);
  });

  it("stamps a patched log from its markers and GPIO output events, and stops at the quit", () => {
    const recorder = new TraceRecorder(null);
    const log = [
      "esp32_gpio_stimulus ns=50000 a 7 0",
      ...uartBytes("in=1\n"),
      mmio(0x3ff44024, 1 << 2),
      "esp32_gpio_stimulus ns=100000 a 7 0",
      mmio(0x3ff44008, 1 << 2),
      "esp32_gpio_out ns=123456 out=0x00000004 out1=0x00",
      "esp32_gpio_stimulus ns=200000 q 0 0",
      ...uartBytes("after\n"),
    ];
    expect(readTraceLog(`${log.join("\n")}\n`, recorder, 200_000)).toEqual(UNTIL_AT_200);
    const trace = recorder.finish({ board: "esp32", untilUs: 200, clock: "virtual" }, UNTIL);
    expect([trace.pins, trace.serial]).toEqual([
      [
        { atUs: 50, pin: 2, level: 0 },
        { atUs: 123.456, pin: 2, level: 1 },
      ],
      [{ atUs: 50, port: "uart0", text: "in=1" }],
    ]);
  });

  it("ends at the first crash line, noting a QIO flash image", () => {
    const recorder = new TraceRecorder(null);
    const log = [
      "esp32_gpio_stimulus ns=50000 a 7 0",
      ...uartBytes("E (1) qio_mode: Failed to set QIE bit, not enabling QIO mode\n"),
      ...uartBytes("assert failed: init_flash startup_funcs.c:92\n"),
      ...uartBytes("more\n"),
    ];
    const exit = readTraceLog(`${log.join("\n")}\n`, recorder, 1_000_000);
    expect([
      exit?.reason,
      exit?.atUs,
      exit?.detail?.startsWith("assert failed:"),
      exit?.detail?.includes("dio"),
    ]).toEqual(["crash", 50, true, true]);
  });
});
