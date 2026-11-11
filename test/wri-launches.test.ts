// Each launch beside its stretch of the log (`tools/wri/launches.ts`), on invented logs and receipts
// in a temporary folder: which launch an event belongs to, what a stop left open, and that no login,
// path or line of a launch's output is printed.
import { afterAll, describe, expect, it } from "bun:test";
import type { EventKind } from "../src/kernel/log.ts";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { launchLines } from "../tools/wri/launches.ts";
import { logEvents } from "../tools/runs/registry.ts";

interface Launch {
  readonly run: number;
  readonly seconds: number;
  readonly login?: string;
  readonly out?: string;
}

const LOGIN = "login-canary-55120";
const OUTPUT = "output-canary-90431";
const ENV_FILE = "/secret/env-canary-31207";
const folders: string[] = [];
afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

const time = (seconds: number) => new Date(Date.UTC(2026, 10, 1, 0, 0, seconds)).toISOString();

/** A campaign folder holding `events` (each at its second) and a receipt and `.out` a launch. */
function campaign(events: readonly [number, EventKind, JsonObject][], launches: readonly Launch[]) {
  const folder = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-launches-")));
  folders.push(folder);
  const log = join(folder, "log.jsonl");
  writeFileSync(
    log,
    events.map(([at, kind, data]) => `${JSON.stringify({ at: time(at), kind, data })}\n`).join(""),
  );
  for (const { run, seconds, login, out } of launches) {
    const receipt = {
      at: time(seconds),
      pid: 1,
      flags: [],
      envFile: ENV_FILE,
      commit: "abcdef0123456789",
      dirty: false,
      load: 1,
      cores: 8,
      ...keyIfDefined("login", login),
    };
    writeFileSync(join(folder, `launch-run-${String(run)}.json`), JSON.stringify(receipt));
    if (out !== undefined) writeFileSync(join(folder, `launch-run-${String(run)}.out`), out);
  }
  return launchLines(log, logEvents(log));
}

/** The block of lines from the row of `run` to the next launch's row. */
function blockOf(lines: readonly string[], run: number): string {
  const start = lines.findIndex((line) => line.startsWith(`run-${String(run)} `));
  const end = lines.findIndex((line, index) => index > start && line.startsWith("run-"));
  return lines.slice(start, end === -1 ? undefined : end).join("\n");
}

describe("launches", () => {
  it("gives each launch the opening it wrote just before its receipt, and splits launches a minute apart", () => {
    const lines = campaign(
      [
        [0, "campaign.opened", { project: "p" }],
        [10, "build.started", { session: "b-1" }],
        [59.9, "campaign.opened", { project: "p" }],
        [61, "build.finished", { session: "b-1", ended: "killed", changed: false }],
      ],
      [
        { run: 1, seconds: 0.002 },
        { run: 2, seconds: 60 },
      ],
    );
    // The first opening, 2 ms before the first receipt, is that launch's too.
    expect(lines).toContain("before the first receipt: 0 events");
    expect(blockOf(lines, 1)).toContain("2 events, lines 1 to 2");
    expect(blockOf(lines, 1)).toContain("open where the stretch ends: b-1");
    // The second opening, 0.1 s before the second receipt, is that launch's.
    expect(blockOf(lines, 2)).toContain("2 events, lines 3 to 4");
    expect(blockOf(lines, 2)).toContain("ended killed: 1 session (b-1)");
  });

  it("lists a comparison a stop left open, even once it was resumed, and its solves with no end", () => {
    const solve = (id: string) => ({ solve: id, condition: "k-1" });
    const lines = campaign(
      [
        [1, "comparison.started", { session: "g-1" }],
        [2, "solve.started", solve("s-1")],
        [3, "solve.started", solve("s-2")],
        [4, "solve.finished", { solve: "s-1", ending: { kind: "killed" } }],
        [100, "comparison.started", { session: "g-1" }],
      ],
      [
        { run: 1, seconds: 0 },
        { run: 2, seconds: 99 },
      ],
    );
    expect(blockOf(lines, 1)).toContain("open where the stretch ends: g-1");
    expect(blockOf(lines, 1)).toContain("1 solve of 2 begun; 1 begun with no end in it");
    expect(blockOf(lines, 2)).toContain("open where the stretch ends: g-1");
  });

  it("prints a launch that wrote nothing as its own row and never says who ended a run", () => {
    const lines = campaign(
      [[1, "build.started", { session: "b-1" }]],
      [
        { run: 1, seconds: 0 },
        { run: 2, seconds: 50 },
        { run: 3, seconds: 70 },
      ],
    );
    expect(blockOf(lines, 2)).toContain("no event in its stretch");
    expect(lines.filter((line) => line.startsWith("run-"))).toHaveLength(3);
    expect(lines.join("\n")).not.toMatch(/stopped/i);
  });

  it("names whether the login changed and prints no login, env file or output line", () => {
    const lines = campaign(
      [[1, "build.started", { session: "b-1" }]],
      [
        { run: 1, seconds: 0, login: LOGIN, out: `${OUTPUT}\nsecond\n` },
        { run: 2, seconds: 50, login: LOGIN },
        { run: 3, seconds: 70, login: `${LOGIN}-other` },
      ],
    );
    const text = lines.join("\n");
    expect(blockOf(lines, 1)).toContain(".out 2 lines, no .err");
    expect(blockOf(lines, 2)).toContain("login same");
    expect(blockOf(lines, 3)).toContain("login changed");
    for (const canary of [LOGIN, OUTPUT, ENV_FILE]) expect(text).not.toContain(canary);
  });
});
