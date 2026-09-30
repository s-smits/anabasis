// ESP32 under Espressif's QEMU (qemu-system-xtensa). fwsim builds the flash, starts QEMU with a
// deterministic instruction counter, and reads UART and GPIO writes back from QEMU's trace log.

import { type RunOutcome, type RunRequest, SimulatorError, UsageError, parentDir, untilExit } from "./run.ts";
import type { SerialRecord, TraceExit, TraceRecorder } from "./trace.ts";

export interface QemuOptions {
  /** An explicit qemu-system-xtensa; otherwise the toolchain's, then PATH's. */
  readonly qemu: string | null;
  /** Host wall-clock budget in milliseconds. */
  readonly wallMs: number | null;
}

/** Where the first app partition starts, and where the partition table's last partition ends. */
interface PartitionLayout {
  readonly app: number;
  readonly end: number;
}

interface Watch {
  crash: string | null;
  qioHint: boolean;
  resets: number;
}

const QEMU_NAME = "qemu-system-xtensa";
const ROM_FILE = "esp32-v3-rom.bin";
const MIB = 1024 * 1024;
const FLASH_SIZES = [2 * MIB, 4 * MIB, 8 * MIB, 16 * MIB];
const ESP_IMAGE_MAGIC = 0xe9;
const BOOTLOADER_OFFSET = 0x1000;
const PARTITIONS_OFFSET = 0x8000;
const DEFAULT_APP_OFFSET = 0x10000;
/** Stimulus marker spacing: patched-QEMU serial bytes and enable changes are stamped to this grid. */
const MARKER_NS = 50_000;
/** Markers re-apply this ADC1 channel's current value, so they change nothing the firmware reads. */
const MARKER_CHANNEL = 7;
const STOCK_MIN_WALL_MS = 2000;
const PATCHED_WALL_MS = 600_000;
/** After SIGTERM at the deadline, how long QEMU gets to exit before SIGKILL. */
const KILL_GRACE_MS = 2000;
const UART_FIFOS = new Map([
  [0x3ff4_0000, "uart0"],
  [0x6000_0000, "uart0"],
  [0x3ff5_0000, "uart1"],
  [0x6001_0000, "uart1"],
  [0x3ff6_e000, "uart2"],
  [0x6002_e000, "uart2"],
]);
const GPIO_BASE = 0x3ff4_4000;
const GPIO_OUT_SEL = 0x530;
const GPIO_PINS = 40;
/** GPIO_FUNCn_OUT_SEL value that drives the pin from the GPIO_OUT and GPIO_ENABLE latches. */
const SIMPLE_OUTPUT = 0x100;
const MMIO_WRITE = / addr 0x([0-9a-f]+) value 0x([0-9a-f]+) size /;
const STIMULUS_TRACE = /^esp32_gpio_(stimulus|out) ns=(\d+)(?: (\w))?/;
const CRASH_LINES = [
  /Guru Meditation Error/,
  /abort\(\) was called/,
  /^assert failed:/,
  /^\*\*\*ERROR\*\*\* /,
  /^Brownout detector was triggered/,
];
const QIO_HINT =
  " (the image selects QIO flash mode, which this QEMU does not emulate: build with FlashMode=dio)";
const UNTIMED =
  "this qemu-system-xtensa has no esp32.gpio stimulus property, so output is untimed and the run " +
  "stopped on the host wall clock: only its opening is traced";

/**
 * GPIO_OUT, GPIO_ENABLE and the output matrix select, tracked from the firmware's register writes.
 * A pin is driven only while its GPIO_ENABLE bit is set and its output select is the GPIO latch.
 */
class GpioLatches {
  private readonly out = [0, 0];
  private readonly enable = [0, 0];
  private readonly outSel: number[] = Array.from({ length: GPIO_PINS }, () => SIMPLE_OUTPUT);

  write(offset: number, value: number): void {
    const bank = offset >= 0x10 && offset < 0x1c ? 1 : 0;
    if (offset >= 0x04 && offset < 0x1c) {
      this.out[bank] = this.store(this.out[bank] ?? 0, (offset - 4) % 12, value);
    }
    if (offset >= 0x20 && offset < 0x38) {
      const enableBank = offset >= 0x2c ? 1 : 0;
      this.enable[enableBank] = this.store(this.enable[enableBank] ?? 0, (offset - 0x20) % 12, value);
    }
    const selected = (offset - GPIO_OUT_SEL) / 4;
    if (Number.isInteger(selected) && selected >= 0 && selected < GPIO_PINS) this.outSel[selected] = value;
  }

  level(pin: number): 0 | 1 | null {
    const select = this.outSel[pin] ?? SIMPLE_OUTPUT;
    const bank = pin >> 5;
    const bit = pin & 31;
    if ((select & 0x1ff) !== SIMPLE_OUTPUT || (((this.enable[bank] ?? 0) >>> bit) & 1) === 0) return null;
    const high = (((this.out[bank] ?? 0) >>> bit) & 1) === 1;
    const inverted = (select & 0x200) !== 0;
    return high === inverted ? 0 : 1;
  }

  /** The register value after a plain write (0), a write-1-to-set (4) or a write-1-to-clear (8). */
  private store(current: number, kind: number, value: number): number {
    if (kind === 4) return (current | value) >>> 0;
    return kind === 8 ? (current & ~value) >>> 0 : value >>> 0;
  }
}

async function exists(path: string): Promise<boolean> {
  return Bun.file(path).exists();
}

async function resolveQemu(explicit: string | null): Promise<string> {
  if (explicit !== null) {
    if (await exists(explicit)) return explicit;
    throw new SimulatorError(`--qemu: no file at ${explicit}`);
  }
  const toolchain = Bun.env["FWSIM_TOOLCHAIN"] ?? "";
  const candidates =
    toolchain === ""
      ? []
      : ["qemu/bin", "qemu/libexec", "bin"].map((dir) => `${toolchain}/${dir}/${QEMU_NAME}`);
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  const onPath = Bun.which(QEMU_NAME);
  if (onPath !== null) return onPath;
  const looked = [...candidates, "PATH"].join(", ");
  throw new SimulatorError(
    `${QEMU_NAME} not found (looked in ${looked}); install Espressif's QEMU into .toolchain/qemu`,
  );
}

/** The ROM directory beside a QEMU install (share/qemu) or build tree (pc-bios), if either is there. */
async function romDir(qemu: string): Promise<string | null> {
  const dir = parentDir(qemu);
  for (const candidate of [`${parentDir(dir)}/share/qemu`, `${dir}/pc-bios`, `${dir}/share/qemu`]) {
    if (await exists(`${candidate}/${ROM_FILE}`)) return candidate;
  }
  return null;
}

/** Whether this QEMU's ESP32 GPIO model takes the `stimulus` property that timed input needs. */
function takesStimulus(qemu: string): boolean {
  const probe = Bun.spawnSync([qemu, "-device", "esp32.gpio,help"], { stdout: "pipe", stderr: "pipe" });
  const text = `${probe.stdout.toString()}${probe.stderr.toString()}`;
  if (!text.includes("esp32.gpio")) {
    throw new SimulatorError(
      `${qemu} has no ESP32 machine (probe exit ${probe.exitCode}): ${text.slice(0, 400)}`,
    );
  }
  return text.includes("stimulus=");
}

/** The first app partition's offset and the extent of the table, from a partitions image. */
function partitionLayout(table: Uint8Array): PartitionLayout {
  const view = new DataView(table.buffer, table.byteOffset, table.byteLength);
  let app = DEFAULT_APP_OFFSET;
  let end = 0;
  let seenApp = false;
  for (let at = 0; at + 32 <= table.length && view.getUint16(at, true) === 0x50aa; at += 32) {
    const offset = view.getUint32(at + 4, true);
    end = Math.max(end, offset + view.getUint32(at + 8, true));
    if (!seenApp && table[at + 2] === 0) {
      seenApp = true;
      app = offset;
    }
  }
  return { app, end };
}

function paddedFlash(size: number): Uint8Array {
  const fit = FLASH_SIZES.find((candidate) => candidate >= size);
  if (fit === undefined) throw new UsageError("image: larger than the 16 MiB flash QEMU can emulate");
  return new Uint8Array(fit).fill(0xff);
}

async function sibling(path: string, what: string): Promise<Uint8Array> {
  if (!(await exists(path))) {
    throw new UsageError(
      `image: an ESP32 app image needs its ${what} beside it at ${path}, or pass the .merged.bin`,
    );
  }
  return Bun.file(path).bytes();
}

/**
 * The flash QEMU boots: a merged image (bootloader at 0x1000) as it is, or an app image laid out
 * with the `.bootloader.bin` and `.partitions.bin` that arduino-cli writes beside it.
 */
async function flashImage(request: RunRequest): Promise<Uint8Array> {
  const { image, imagePath } = request;
  if (image[0] !== ESP_IMAGE_MAGIC) {
    if (image[BOOTLOADER_OFFSET] !== ESP_IMAGE_MAGIC) {
      throw new UsageError(
        "image: neither an ESP32 app image (.ino.bin) nor a merged flash image (.ino.merged.bin)",
      );
    }
    const flash = paddedFlash(image.length);
    flash.set(image);
    return flash;
  }
  const base = imagePath.replace(/\.bin$/, "");
  const bootloader = await sibling(`${base}.bootloader.bin`, "bootloader");
  const partitions = await sibling(`${base}.partitions.bin`, "partition table");
  const layout = partitionLayout(partitions);
  const flash = paddedFlash(Math.max(4 * MIB, layout.end, layout.app + image.length));
  flash.set(bootloader, BOOTLOADER_OFFSET);
  flash.set(partitions, PARTITIONS_OFFSET);
  flash.set(image, layout.app);
  return flash;
}

/**
 * The patched GPIO model's stimulus file: the events, a marker every MARKER_NS so the trace log
 * carries virtual time between GPIO changes, and a quit at the end of the run.
 */
export function stimulusFile(request: RunRequest): string {
  const { untilNs } = request;
  const lines = ["# fwsim stimulus: <virtual ns> gpio <pin> <level> | adc1 <channel> <raw> | quit"];
  let markerValue = 0;
  let marker = MARKER_NS;
  const markersBefore = (limitNs: number): void => {
    for (; marker < Math.min(limitNs, untilNs); marker += MARKER_NS) {
      lines.push(`${marker} adc1 ${MARKER_CHANNEL} ${markerValue}`);
    }
  };
  for (const event of request.stimulus.events) {
    markersBefore(event.atNs);
    if (event.atNs >= untilNs) break;
    if (event.kind === "gpio") lines.push(`${event.atNs} gpio ${event.pin} ${event.level}`);
    if (event.kind === "adc") {
      lines.push(`${event.atNs} adc1 ${event.channel} ${event.value}`);
      if (event.channel === MARKER_CHANNEL) markerValue = event.value;
    }
  }
  markersBefore(untilNs);
  lines.push(`${untilNs} quit`);
  return `${lines.join("\n")}\n`;
}

function watchCrashes(recorder: TraceRecorder): Watch {
  const watch: Watch = { crash: null, qioHint: false, resets: 0 };
  recorder.onLine = (record: SerialRecord) => {
    if (watch.crash !== null) return;
    if (record.text.includes("Failed to set QIE bit")) watch.qioHint = true;
    if (record.text.startsWith("rst:")) watch.resets += 1;
    const crashed = CRASH_LINES.some((pattern) => pattern.test(record.text)) || watch.resets > 1;
    if (crashed) watch.crash = `${record.text}${watch.qioHint ? QIO_HINT : ""}`;
  };
  return watch;
}

/** One trace-log line's MMIO write, if it is one: a UART FIFO byte or a GPIO register. True when GPIO was written. */
function applyWrite(line: string, recorder: TraceRecorder, gpio: GpioLatches, nowNs: number | null): boolean {
  const write = line.startsWith("memory_region_ops_write") ? MMIO_WRITE.exec(line) : null;
  if (write === null) return false;
  const address = Number.parseInt(write[1] ?? "", 16);
  const value = Number.parseInt(write[2] ?? "", 16);
  const port = UART_FIFOS.get(address);
  if (port !== undefined) recorder.serialByte(nowNs, port, value & 0xff);
  if (address < GPIO_BASE || address >= GPIO_BASE + 0x1000) return false;
  gpio.write(address - GPIO_BASE, value);
  return true;
}

/**
 * Replay QEMU's trace log into the recorder. Returns the exit when the log reaches the stimulus
 * quit at `untilNs` or a crash line, or null when it ends first. `untilNs` is null for stock QEMU,
 * whose log carries no virtual time.
 */
export function readTraceLog(
  text: string,
  recorder: TraceRecorder,
  untilNs: number | null,
): TraceExit | null {
  const gpio = new GpioLatches();
  const watch = watchCrashes(recorder);
  let nowNs: number | null = untilNs === null ? null : 0;
  let gpioWritten = false;
  const complete = text.endsWith("\n") ? text : text.slice(0, text.lastIndexOf("\n") + 1);
  for (const line of complete.split("\n")) {
    const stamp = STIMULUS_TRACE.exec(line);
    if (gpioWritten) {
      // A write that changed the output latch is followed by the patched model's own stamp for it.
      const atNs = stamp?.[1] === "out" ? Number(stamp[2]) : nowNs;
      for (let pin = 0; pin < GPIO_PINS; pin++) recorder.pin(atNs, pin, gpio.level(pin));
    }
    if (stamp !== null) nowNs = Number(stamp[2]);
    if (untilNs !== null && stamp?.[1] === "stimulus" && stamp[3] === "q") return untilExit(untilNs);
    gpioWritten = applyWrite(line, recorder, gpio, nowNs);
    if (watch.crash !== null) {
      return { reason: "crash", atUs: nowNs === null ? null : nowNs / 1000, detail: watch.crash };
    }
  }
  return null;
}

/** One run's scratch files, under TMPDIR: the working directory a check's tool run gets. */
class RunFiles {
  readonly flash: string;
  readonly stimulus: string;
  readonly log: string;

  constructor() {
    const dir = (Bun.env["TMPDIR"] ?? "/tmp").replace(/\/+$/, "");
    const stem = `${dir}/fwsim-esp32-${process.pid}-${Date.now()}`;
    this.flash = `${stem}.flash.bin`;
    this.stimulus = `${stem}.stimulus.txt`;
    this.log = `${stem}.trace.log`;
  }

  async remove(): Promise<void> {
    for (const path of [this.flash, this.stimulus, this.log]) {
      const file = Bun.file(path);
      if (await file.exists()) await file.delete();
    }
  }
}

function qemuArgs(qemu: string, rom: string | null, files: RunFiles, timed: boolean): string[] {
  const args = [qemu];
  if (rom !== null) args.push("-L", rom);
  args.push("-machine", "esp32", "-display", "none", "-nic", "none", "-monitor", "none", "-serial", "null");
  args.push("-icount", "shift=3,sleep=off", "-drive", `file=${files.flash},if=mtd,format=raw`);
  args.push("-trace", "memory_region_ops_write", "-D", files.log);
  if (timed) {
    args.push(
      "-global",
      `driver=esp32.gpio,property=stimulus,value=${files.stimulus}`,
      "-trace",
      "esp32_gpio_*",
    );
  }
  return args;
}

/**
 * Wait for QEMU, ending it at the wall deadline: SIGTERM, then SIGKILL after KILL_GRACE_MS, since a
 * guest that panics with its cache disabled leaves QEMU ignoring SIGTERM. QEMU is one process and
 * stays in fwsim's process group, so a caller that ends fwsim's group ends QEMU with it.
 */
async function awaitQemu(
  child: Bun.Subprocess<"ignore", "ignore", "pipe">,
  wallMs: number,
): Promise<{ readonly status: number; readonly stderr: string; readonly stopped: boolean }> {
  let stopped = false;
  const signal = (name: "SIGTERM" | "SIGKILL"): void => {
    stopped = true;
    try {
      process.kill(child.pid, name);
    } catch {
      // Already gone: the exit is on its way to `child.exited`.
    }
  };
  const term = setTimeout(() => signal("SIGTERM"), wallMs);
  const kill = setTimeout(() => signal("SIGKILL"), wallMs + KILL_GRACE_MS);
  try {
    const [status, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    return { status, stderr, stopped };
  } finally {
    clearTimeout(term);
    clearTimeout(kill);
  }
}

/** Run an ESP32 image under QEMU; with the stimulus-capable QEMU the run is timed and takes input. */
export async function runEsp32(request: RunRequest, options: QemuOptions): Promise<RunOutcome> {
  const qemu = await resolveQemu(options.qemu);
  const timed = takesStimulus(qemu);
  if (!timed && request.stimulus.events.length > 0) {
    throw new SimulatorError(
      `${qemu} has no esp32.gpio stimulus property, so it cannot apply gpio or adc events; ` +
        "install the stimulus-capable qemu-system-xtensa",
    );
  }
  const files = new RunFiles();
  const wallMs =
    options.wallMs ?? (timed ? PATCHED_WALL_MS : Math.max(STOCK_MIN_WALL_MS, request.untilNs / 1e6));
  try {
    await Bun.write(files.flash, await flashImage(request));
    if (timed) await Bun.write(files.stimulus, stimulusFile(request));
    const child = Bun.spawn(qemuArgs(qemu, await romDir(qemu), files, timed), {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "pipe",
    });
    const { status, stderr, stopped } = await awaitQemu(child, wallMs);
    const log = (await exists(files.log)) ? await Bun.file(files.log).text() : "";
    const exit = readTraceLog(log, request.recorder, timed ? request.untilNs : null);
    const clock = timed ? "virtual" : "none";
    if (exit !== null) return { clock, exit };
    if (!stopped) {
      throw new SimulatorError(
        `qemu exited (status ${status}) before the run ended: ${stderr.trim().slice(-800)}`,
      );
    }
    const detail = timed ? `the host wall budget of ${wallMs} ms ran out first` : UNTIMED;
    return { clock, exit: { reason: "wall", atUs: null, detail } };
  } finally {
    await files.remove();
  }
}
