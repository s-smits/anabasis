// fwsim: run a firmware image on a simulated board against a stimulus file and print the trace.

import { runUno } from "./avr.ts";
import { runEsp32 } from "./esp32.ts";
import { runRp2040 } from "./rp2040.ts";
import { type RunOutcome, type RunRequest, SimulatorError, UsageError } from "./run.ts";
import { type Board, type Stimulus, StimulusError, parseStimulus } from "./stimulus.ts";
import { TraceRecorder } from "./trace.ts";

interface Options {
  readonly board: Board;
  readonly image: string;
  readonly stimulus: string | null;
  readonly untilUs: number;
  readonly out: string | null;
  readonly pins: ReadonlySet<number> | null;
  readonly qemu: string | null;
  readonly wallMs: number | null;
}

const USAGE = `usage: fwsim run --board esp32|rp2040|uno --image <file> [--stimulus <stimulus.json>]
                --until-us <n> [--out <trace.json>] [--pins <n,n,...>]
                [--qemu <qemu-system-xtensa>] [--wall-ms <n>]

Runs the image in virtual time from reset to --until-us microseconds and prints the trace as JSON
on stdout, or writes it to --out and prints a one-line summary. Exit 0 with a trace, whatever the
firmware did; 2 for a bad invocation, image or stimulus; 3 when the simulator is missing or fails.`;
const BOARDS: ReadonlySet<string> = new Set(["esp32", "rp2040", "uno"]);
const FLAGS: ReadonlySet<string> = new Set([
  "board",
  "image",
  "stimulus",
  "until-us",
  "out",
  "pins",
  "qemu",
  "wall-ms",
]);
const MAX_UNTIL_US = 3_600_000_000;

function isBoard(value: string): value is Board {
  return BOARDS.has(value);
}

function positiveInteger(text: string, flag: string, max: number): number {
  const value = Number(text);
  if (!/^\d+$/.test(text) || value < 1 || value > max) {
    throw new UsageError(`${flag}: must be a whole number from 1 to ${max}`);
  }
  return value;
}

function pinList(text: string): ReadonlySet<number> {
  return new Set(
    text.split(",").map((entry) => {
      if (!/^\d{1,2}$/.test(entry)) throw new UsageError("--pins: must be pin numbers separated by commas");
      return Number(entry);
    }),
  );
}

/** `run` followed by `--flag value` or `--flag=value` pairs, each flag at most once. */
function flagValues(argv: readonly string[]): Map<string, string> {
  const [command, ...rest] = argv;
  if (command !== "run") throw new UsageError(USAGE);
  const values = new Map<string, string>();
  for (let index = 0; index < rest.length; index++) {
    const match = /^--([a-z-]+)(?:=(.*))?$/s.exec(rest[index] ?? "");
    const flag = match?.[1] ?? "";
    if (!FLAGS.has(flag)) throw new UsageError(`${rest[index] ?? ""}: not an option\n${USAGE}`);
    if (values.has(flag)) throw new UsageError(`--${flag}: given twice`);
    const value = match?.[2] ?? rest[++index];
    if (value === undefined) throw new UsageError(`--${flag}: needs a value`);
    values.set(flag, value);
  }
  return values;
}

function readOptions(argv: readonly string[]): Options {
  const flags = flagValues(argv);
  const board = flags.get("board");
  if (board === undefined || !isBoard(board)) throw new UsageError("--board: must be esp32, rp2040 or uno");
  const image = flags.get("image");
  if (image === undefined) throw new UsageError("--image: required");
  const until = flags.get("until-us");
  if (until === undefined) throw new UsageError("--until-us: required");
  const pins = flags.get("pins");
  const wall = flags.get("wall-ms");
  return {
    board,
    image,
    stimulus: flags.get("stimulus") ?? null,
    untilUs: positiveInteger(until, "--until-us", MAX_UNTIL_US),
    out: flags.get("out") ?? null,
    pins: pins === undefined ? null : pinList(pins),
    qemu: flags.get("qemu") ?? null,
    wallMs: wall === undefined ? null : positiveInteger(wall, "--wall-ms", 86_400_000),
  };
}

async function readInput(path: string, what: string): Promise<Uint8Array> {
  const file = Bun.file(path);
  if (!(await file.exists())) throw new UsageError(`${what}: no file at ${path}`);
  return file.bytes();
}

async function loadStimulus(options: Options): Promise<Stimulus> {
  if (options.stimulus === null) return { events: [], devices: [] };
  const bytes = await readInput(options.stimulus, "--stimulus");
  return parseStimulus(new TextDecoder().decode(bytes), options.board);
}

async function run(argv: readonly string[]): Promise<void> {
  const options = readOptions(argv);
  const recorder = new TraceRecorder(options.pins);
  const request: RunRequest = {
    board: options.board,
    imagePath: options.image,
    image: await readInput(options.image, "--image"),
    stimulus: await loadStimulus(options),
    untilNs: options.untilUs * 1000,
    recorder,
  };
  const outcome: RunOutcome =
    options.board === "esp32"
      ? await runEsp32(request, { qemu: options.qemu, wallMs: options.wallMs })
      : options.board === "rp2040"
        ? await runRp2040(request)
        : runUno(request);
  const trace = recorder.finish(
    { board: options.board, untilUs: options.untilUs, clock: outcome.clock },
    outcome.exit,
  );
  const text = `${JSON.stringify(trace)}\n`;
  if (options.out === null) {
    await Bun.write(Bun.stdout, text);
    return;
  }
  await Bun.write(options.out, text);
  const summary = {
    out: options.out,
    pins: trace.pins.length,
    serial: trace.serial.length,
    exit: trace.exit,
  };
  await Bun.write(Bun.stdout, `${JSON.stringify(summary)}\n`);
}

function exitStatus(error: Error): number {
  if (error instanceof UsageError || error instanceof StimulusError) return 2;
  return error instanceof SimulatorError ? 3 : 1;
}

try {
  await run(Bun.argv.slice(2));
} catch (error) {
  const failure = error instanceof Error ? error : new Error(String(error));
  const status = exitStatus(failure);
  process.stderr.write(`fwsim: ${status === 1 ? (failure.stack ?? failure.message) : failure.message}\n`);
  process.exitCode = status;
}
