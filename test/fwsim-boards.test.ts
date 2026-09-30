import { afterAll, describe, expect, it } from "bun:test";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { spawnTextSync } from "./helpers/bun-spawn-sync.ts";
import type { JsonObject } from "../starters/pi-built-harness/starter-pack/fwsim/src/stimulus.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";

interface PinRow {
  atUs: number | null;
  pin: number;
  level: 0 | 1 | null;
}
interface SerialRow {
  atUs: number | null;
  port: string;
  text: string;
}
interface Trace {
  board: string;
  clock: string;
  pins: PinRow[];
  serial: SerialRow[];
  exit: { reason: string; atUs: number | null; detail: string | null };
}
interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}
interface Probe {
  readonly path: string;
  readonly ready: boolean;
  readonly patched: boolean;
  readonly reason: string;
}
interface Bench {
  board: "uno" | "rp2040";
  image: string;
  inPin: number;
  outPin: number;
  beatPin: number;
  adcPin: number;
  adcValue: number;
  /** What the fixture prints for adcValue: arduino-pico's analogRead defaults to 10 bits. */
  adcText: string;
  port: string;
}

const MAIN = join(import.meta.dir, "../starters/pi-built-harness/starter-pack/fwsim/src/main.ts");
const FIXTURES = join(import.meta.dir, "fixtures/fwsim");
const MS = 1000;
const UNTIL_US = 400 * MS;
/** The fixture polls its input in loop(); a change must reach the output pin within this. */
const REACTION_US = 2 * MS;
const BENCHES: Bench[] = [
  {
    board: "uno",
    image: "uno/fwsim-fixture.ino.hex",
    inPin: 2,
    outPin: 13,
    beatPin: 8,
    adcPin: 14,
    adcValue: 512,
    adcText: "adc=512",
    port: "uart0",
  },
  {
    board: "rp2040",
    image: "rp2040/fwsim-fixture.ino.bin",
    inPin: 2,
    outPin: 25,
    beatPin: 14,
    adcPin: 26,
    adcValue: 2048,
    adcText: "adc=512",
    port: "usb",
  },
];
const ESP32_IMAGE = join(FIXTURES, "esp32/fwsim-fixture.ino.bin");
/** A qemu-system-xtensa for the output test; stock QEMU is enough. */
const QEMU = Bun.env["FWSIM_TEST_QEMU"] ?? "";
/** The stimulus-capable qemu-system-xtensa the input test needs, if it is not FWSIM_TEST_QEMU. */
const QEMU_PATCHED = Bun.env["FWSIM_TEST_QEMU_PATCHED"] ?? "";
/** Patched QEMU under -icount still varies by under a microsecond between runs; serial lines are
 *  stamped to fwsim's 50 us marker grid. Repeat runs are compared within these. */
const ESP32_PIN_TOLERANCE_US = 10;
const ESP32_SERIAL_TOLERANCE_US = 60;

afterAll(cleanupScratch);

function fwsim(args: string[], stimulus: JsonObject | null): Run {
  const dir = scratchDir("fwsim-");
  const stimulusArgs: string[] = [];
  if (stimulus !== null) {
    const path = join(dir, "stimulus.json");
    writeFileSync(path, JSON.stringify(stimulus));
    stimulusArgs.push("--stimulus", path);
  }
  const result = spawnTextSync(process.execPath, [MAIN, "run", ...args, ...stimulusArgs], {
    cwd: dir,
    timeout: 120_000,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function traceOf(run: Run): Trace {
  expect({
    status: run.status,
    stderr: run.stderr.split("\n").filter((line) => line.startsWith("fwsim:")),
  }).toEqual({
    status: 0,
    stderr: [],
  });
  return JSON.parse(run.stdout);
}

/** Input high at `atUs` with an ADC reading and two received bytes after it, low again 100 ms later. */
function inputChange(bench: Bench, atUs: number): JsonObject {
  return {
    events: [
      { atUs: 0, kind: "adc", pin: bench.adcPin, value: bench.adcValue },
      { atUs, kind: "gpio", pin: bench.inPin, level: 1 },
      { atUs: atUs + 50 * MS, kind: "uart", text: "hi" },
      { atUs: atUs + 100 * MS, kind: "gpio", pin: bench.inPin, level: 0 },
    ],
  };
}

function firstAt(rows: { atUs: number | null }[]): number {
  return rows[0]?.atUs ?? Number.NaN;
}

/** The output transitions and serial lines an input change at `atUs` must produce, and only after it. */
function expectReaction(trace: Trace, bench: Bench, atUs: number): void {
  const out = trace.pins.filter((row) => row.pin === bench.outPin);
  const high = out.filter((row) => row.level === 1);
  const low = out.filter((row) => row.level === 0 && (row.atUs ?? 0) > atUs);
  expect(firstAt(high)).toBeGreaterThan(atUs);
  expect(firstAt(high)).toBeLessThanOrEqual(atUs + REACTION_US);
  expect(firstAt(low)).toBeGreaterThan(atUs + 100 * MS);
  expect(firstAt(low)).toBeLessThanOrEqual(atUs + 100 * MS + REACTION_US);
  const lines = trace.serial.filter((row) => row.port === bench.port);
  const rise = lines.filter((row) => row.text === `in=1 ${bench.adcText}`);
  expect(lines.filter((row) => row.text.startsWith("in=") && (row.atUs ?? 0) <= atUs)).toEqual([]);
  expect(firstAt(rise)).toBeGreaterThan(atUs);
  expect(firstAt(rise)).toBeLessThanOrEqual(atUs + 5 * MS);
  const echoed = lines.filter((row) => row.text.startsWith("rx=")).map((row) => row.text);
  expect(echoed).toEqual(["rx=h", "rx=i"]);
  expect(firstAt(lines.filter((row) => row.text === "rx=h"))).toBeGreaterThan(atUs + 50 * MS);
  expect(lines.filter((row) => row.text === `in=0 ${bench.adcText}`)).toHaveLength(1);
  expect(lines.filter((row) => row.text.startsWith("beat ")).length).toBeGreaterThanOrEqual(3);
  expect(
    trace.pins.filter((row) => row.pin === bench.beatPin && row.level === 1).length,
  ).toBeGreaterThanOrEqual(2);
  expect(trace.exit).toEqual({ reason: "until", atUs: UNTIL_US, detail: null });
}

function qemuProbe(path: string, variable: string): Probe {
  if (path === "") return { path, ready: false, patched: false, reason: `${variable} is not set` };
  const probe = Bun.spawnSync([path, "-device", "esp32.gpio,help"], {
    env: Bun.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const text = `${probe.stdout.toString()}${probe.stderr.toString()}`;
  if (!text.includes("esp32.gpio")) {
    return { path, ready: false, patched: false, reason: `${path} has no ESP32 machine` };
  }
  const patched = text.includes("stimulus=");
  return { path, ready: true, patched, reason: patched ? "" : `${path} has no esp32.gpio stimulus property` };
}

/** Same rows in the same order, each time within `toleranceUs`. */
function expectSameWithin<T extends { atUs: number | null }>(a: T[], b: T[], toleranceUs: number): void {
  const untimed = (rows: T[]) => rows.map((row) => ({ ...row, atUs: null }));
  expect(untimed(b)).toEqual(untimed(a));
  const drift = a.map((row, index) => Math.abs((row.atUs ?? 0) - (b[index]?.atUs ?? 0)));
  expect(Math.max(0, ...drift)).toBeLessThanOrEqual(toleranceUs);
}

const qemu = qemuProbe(QEMU, "FWSIM_TEST_QEMU");
const patchedQemu =
  QEMU_PATCHED === "" && qemu.patched ? qemu : qemuProbe(QEMU_PATCHED, "FWSIM_TEST_QEMU_PATCHED");

for (const bench of BENCHES) {
  describe(`fwsim ${bench.board}`, () => {
    const args = [
      "--board",
      bench.board,
      "--image",
      join(FIXTURES, bench.image),
      "--until-us",
      String(UNTIL_US),
    ];

    it("turns an input change at 250 ms into the output edge and serial lines after it, twice identically", () => {
      const first = fwsim(args, inputChange(bench, 250 * MS));
      const second = fwsim(args, inputChange(bench, 250 * MS));
      const trace = traceOf(first);
      expect([trace.board, trace.clock]).toEqual([bench.board, "virtual"]);
      expectReaction(trace, bench, 250 * MS);
      expect(second.stdout).toBe(first.stdout);
    });

    it("moves the output edge with the input change when the change moves to 150 ms", () => {
      expectReaction(traceOf(fwsim(args, inputChange(bench, 150 * MS))), bench, 150 * MS);
    });
  });
}

describe("fwsim invocation", () => {
  it("exits 2 without a trace for a stimulus the board cannot apply", () => {
    const image = join(FIXTURES, "uno/fwsim-fixture.ino.hex");
    const stimulus = { events: [{ atUs: 0, kind: "adc", pin: 2, value: 1 }] };
    const run = fwsim(["--board", "uno", "--image", image, "--until-us", "10"], stimulus);
    expect([run.status, run.stdout, run.stderr.trim()]).toEqual([
      2,
      "",
      "fwsim: events[0].pin: 2 has no ADC channel on this board (ADC pins: 14, 15, 16, 17, 18, 19)",
    ]);
  });

  it("reports a firmware fault as a crash in the trace, not as a failed run", () => {
    // An ESP32 image run from RP2040 flash makes an unaligned word read within its first instructions.
    const run = fwsim(["--board", "rp2040", "--image", ESP32_IMAGE, "--until-us", "1000"], null);
    expect(traceOf(run).exit).toEqual({
      reason: "crash",
      atUs: 0.896,
      detail: "[RP2040] read from address 706968a7, which is not 32 bit aligned",
    });
  });

  it("writes the trace to --out and prints a summary", () => {
    const image = join(FIXTURES, "uno/fwsim-fixture.ino.hex");
    const run = fwsim(
      ["--board", "uno", "--image", image, "--until-us", "2000", "--out", "trace.json"],
      null,
    );
    expect(JSON.parse(run.stdout)).toEqual({
      out: "trace.json",
      pins: 2,
      serial: 1,
      exit: { reason: "until", atUs: 2000, detail: null },
    });
  });
});

/** QEMU trace-log lines for bytes the firmware wrote to UART0's FIFO. */
function uartLog(text: string): string {
  return Array.from(
    new TextEncoder().encode(text),
    (byte) =>
      `memory_region_ops_write cpu 0 mr 0x1 addr 0x3ff40000 value 0x${byte.toString(16)} size 4 name 'esp32.uart'\n`,
  ).join("");
}

/**
 * A stand-in qemu-system-xtensa that answers the probe as stock QEMU does, writes a panic to its
 * trace log and then ignores SIGTERM, as QEMU does after an ESP32 guest panics with its cache disabled.
 */
function hungQemu(): string {
  const dir = scratchDir("fwsim-qemu-");
  const log = join(dir, "panic.log");
  writeFileSync(
    log,
    uartLog("Guru Meditation Error: Core  1 panic'ed (Cache disabled but cached memory region accessed).\n"),
  );
  const script = join(dir, "qemu-system-xtensa");
  writeFileSync(
    script,
    [
      "#!/bin/sh",
      'case "$*" in *help*) echo "esp32.gpio options:"; exit 0 ;; esac',
      'while [ "$#" -gt 0 ]; do if [ "$1" = "-D" ]; then cp "' + log + '" "$2"; fi; shift; done',
      "trap '' TERM",
      "while :; do sleep 0.1; done",
      "",
    ].join("\n"),
  );
  chmodSync(script, 0o755);
  return script;
}

describe("fwsim esp32 deadline", () => {
  it("kills a QEMU that ignores SIGTERM at its own deadline and reports the crash", () => {
    const started = performance.now();
    const run = fwsim(
      [
        "--board",
        "esp32",
        "--image",
        ESP32_IMAGE,
        "--qemu",
        hungQemu(),
        "--until-us",
        "1000",
        "--wall-ms",
        "300",
      ],
      null,
    );
    const trace = traceOf(run);
    expect(trace.clock).toBe("none");
    expect(trace.exit.reason).toBe("crash");
    expect(trace.exit.detail).toStartWith("Guru Meditation Error");
    expect(performance.now() - started).toBeLessThan(30_000);
  }, 60_000);
});

describe("fwsim esp32 under QEMU", () => {
  const args = (extra: string[], path = QEMU) => [
    "--board",
    "esp32",
    "--image",
    ESP32_IMAGE,
    "--qemu",
    path,
    ...extra,
  ];

  it.skipIf(!qemu.ready)(
    `traces serial and GPIO output the same way twice${qemu.ready ? "" : ` (skipped: ${qemu.reason})`}`,
    () => {
      // Patched QEMU stops at --until-us in virtual time; stock QEMU only on the host wall budget.
      const limits = qemu.patched ? ["--until-us", "600000"] : ["--until-us", "3000000", "--wall-ms", "6000"];
      const runs = [0, 1].map(() => traceOf(fwsim(args(limits), null)));
      const [first, second] = runs;
      if (first === undefined || second === undefined) throw new Error("two runs expected");
      if (qemu.patched) {
        expect([first.clock, first.exit.reason]).toEqual(["virtual", "until"]);
        expect(first.serial.map((row) => row.text)).toContain("beat 1");
        expect(first.pins.filter((row) => row.pin === 16 && row.level === 1).length).toBeGreaterThanOrEqual(
          1,
        );
        expectSameWithin(first.pins, second.pins, ESP32_PIN_TOLERANCE_US);
        expectSameWithin(first.serial, second.serial, ESP32_SERIAL_TOLERANCE_US);
        return;
      }
      // Stock QEMU has no virtual-time stop: each run ends on the host wall budget, so how far it
      // got depends on host load. Only the untimed contract and the opening both runs reached count.
      for (const trace of runs) {
        expect([trace.clock, trace.exit.reason, trace.exit.atUs]).toEqual(["none", "wall", null]);
        expect(trace.serial[0]).toEqual({ atUs: null, port: "uart0", text: "ets Jul 29 2019 12:21:46" });
        expect([...trace.serial, ...trace.pins].filter((row) => row.atUs !== null)).toEqual([]);
      }
      const [a, b] = [first.serial.slice(0, -1), second.serial.slice(0, -1)];
      const shared = Math.min(a.length, b.length);
      expect(b.slice(0, shared)).toEqual(a.slice(0, shared));
      const sharedPins = Math.min(first.pins.length, second.pins.length);
      expect(second.pins.slice(0, sharedPins)).toEqual(first.pins.slice(0, sharedPins));
    },
    90_000,
  );

  const stock =
    qemu.ready && !qemu.patched
      ? ""
      : ` (skipped: needs a stock qemu-system-xtensa in FWSIM_TEST_QEMU; ${qemu.reason || "it is patched"})`;
  it.skipIf(stock !== "")(
    `reports the simulator unable, not a trace, when the QEMU cannot apply input${stock}`,
    () => {
      const run = fwsim(args(["--until-us", "1000"]), {
        events: [{ atUs: 0, kind: "gpio", pin: 4, level: 1 }],
      });
      expect([run.status, run.stdout]).toEqual([3, ""]);
      expect(run.stderr).toContain("no esp32.gpio stimulus property");
    },
  );

  const pending = patchedQemu.patched
    ? ""
    : ` (pending the stimulus-capable qemu-system-xtensa: ${patchedQemu.reason})`;
  it.skipIf(!patchedQemu.patched)(
    `turns a GPIO input change into the output edge and serial line, twice alike${pending}`,
    () => {
      const atUs = 700 * MS;
      const stimulus = {
        events: [
          { atUs: 0, kind: "adc", pin: 34, value: 2048 },
          { atUs, kind: "gpio", pin: 4, level: 1 },
          { atUs: atUs + 100 * MS, kind: "gpio", pin: 4, level: 0 },
        ],
      };
      const [trace, again] = [0, 1].map(() =>
        traceOf(fwsim(args(["--until-us", String(1000 * MS)], patchedQemu.path), stimulus)),
      );
      if (trace === undefined || again === undefined) throw new Error("two runs expected");
      expect([trace.clock, trace.exit.reason]).toEqual(["virtual", "until"]);
      const high = trace.pins.filter((row) => row.pin === 2 && row.level === 1);
      expect(firstAt(high)).toBeGreaterThan(atUs);
      expect(firstAt(high)).toBeLessThanOrEqual(atUs + REACTION_US);
      const rise = trace.serial.filter((row) => row.text === "in=1 adc=2048");
      expect(firstAt(rise)).toBeGreaterThan(atUs);
      expect(firstAt(rise)).toBeLessThanOrEqual(atUs + 5 * MS);
      expect(trace.serial.filter((row) => row.text === "in=0 adc=2048")).toHaveLength(1);
      expectSameWithin(trace.pins, again.pins, ESP32_PIN_TOLERANCE_US);
      expectSameWithin(trace.serial, again.serial, ESP32_SERIAL_TOLERANCE_US);
    },
    60_000,
  );
});
