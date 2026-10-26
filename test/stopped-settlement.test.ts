// Stopped comparisons retain their observed coverage and blind review packets without acquiring
// a test when labels arrive. Scripted prefixes include both defect and cap stops with winning
// completed tasks; later solves cannot enlarge the original experiment.
import { afterAll, expect, it, spyOn } from "bun:test";
import * as comparison from "../src/campaign/comparison.ts";
import { epochsOf } from "../src/campaign/climb.ts";
import { checkpoint, settleReading, type CheckpointRequest } from "../src/campaign/round.ts";
import { recordCondition, settingId } from "../src/kernel/condition.ts";
import { append, read } from "../src/kernel/log.ts";
import { stopRule } from "../src/kernel/reports.ts";
import type { Ending } from "../src/kernel/solve.ts";
import { taskStates } from "../src/kernel/task.ts";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import type { JsonObject, JsonValue } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join, resolve } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { agreement, clears } from "../src/referee/agreement.ts";
import type { Ruling } from "../src/referee/referee.ts";
import { settleCommand } from "../tools/d2/settle.ts";
import { conditionOf } from "./helpers/logged-round.ts";
import { fixtureTasks, layOutPack } from "./helpers/fixture-pack.ts";

type Outcomes = Readonly<Record<string, readonly [string, string]>>;
const STOPPED = "check-defects";
const ID = "g-1";
const ENDINGS = new Map<string, Ending>(
  Object.entries({
    P: { outcome: "pass" },
    L: { outcome: "fail", kind: "turns-ended" },
    D: { outcome: "fail", kind: "rejected" },
    R: { outcome: "fail", kind: "rejected" },
  } satisfies Record<string, Ending>),
);
const PREFIX = {
  "t-1": ["PPLL", "PPPP"],
  "t-2": ["PPPL", "PPPP"],
  "t-3": ["PPPL", "PPPP"],
  "t-4": ["DDRL", "DDDD"],
  "t-5": ["DDRL", "DDDD"],
  "t-6": ["PLL", "PPP"],
  "t-7": ["RLL", "DP"],
  "t-8": ["", ""],
  "t-9": ["L", ""],
  "t-10": ["", "D"],
} satisfies Outcomes;
const REPO = resolve(import.meta.dir, "..");
const scratches: string[] = [];

afterAll(() => {
  for (const dir of scratches) rmSync(dir, { recursive: true, force: true });
});

/** Script the recorded prefix through the same condition and ending events as a live solve. */
function fixture(outcomes: Outcomes = PREFIX, stop: "defect" | "cap" = "defect") {
  const root = mkdtempSync(join(tmpdir(), "ana-stopped-"));
  scratches.push(root);
  const log = join(root, "log.jsonl");
  const tasks = Object.keys(outcomes);
  const setting = settingId(conditionOf("any", "any"));
  const cap = stop === "cap" ? { dollars: 1, reserve: 1 } : undefined;
  const request: CheckpointRequest = {
    log,
    id: ID,
    old: { dir: root, digest: "old" },
    fresh: { dir: root, digest: "fresh" },
    starter: { dir: root, digest: "old" },
    setting,
    tasks,
    retained: [],
    solves: 4,
    level: 0.02,
    concurrency: 1,
    defects: stop === "cap" ? 100 : 0,
    cap,
    solve: () => {
      throw new Error("a reported comparison must start no further solve");
    },
  };
  for (const task of tasks) {
    append(log, "task.proposed", { version: task, family: "fixture" });
    append(log, "task.gate", { version: task, gate: 1, outcome: "passed" });
  }
  append(log, comparison.STARTED, {
    session: ID,
    old: "old",
    fresh: "fresh",
    starter: "old",
    setting,
    tasks,
    retained: [],
    solves: 4,
    level: 0.02,
    cap: cap ?? null,
  });
  const labels = new Map<string, Ruling>();
  let count = 0;
  const slots = Object.entries(outcomes).flatMap(([task, sides]) =>
    sides.flatMap((letters, side) => letters.split("").map((letter) => ({ task, side, letter }))),
  );
  for (const { task, side, letter } of slots) {
    count += 1;
    const solve = `solve-${String(count)}`;
    const ending = ENDINGS.get(letter);
    if (ending === undefined) throw new Error(`unknown outcome ${letter}`);
    const condition = recordCondition(log, conditionOf(task, side === 0 ? "old" : "fresh"));
    append(log, "solve.started", { solve, condition, comparison: ID });
    if (letter === "P" || letter === "D" || letter === "R") {
      append(log, "verdict", {
        solve,
        task,
        kind: letter === "P" ? "pass" : "fail",
        answer: { answer: "42" },
        blocking: letter === "P" ? [] : ["check-a"],
      });
    }
    append(log, "solve.finished", { solve, ending, billed: 1 });
    if (letter === "D" || letter === "R") {
      const ruling = letter === "D" ? "check-defect" : "earned";
      labels.set(solve, ruling);
      append(log, "referee.finding", { solve, ruling });
    }
  }
  return { root, log, request, labels };
}

function unscored(report: comparison.Report, reading = STOPPED, capped = false) {
  expect(report).toMatchObject({
    reading,
    capped,
    versions: [],
    scored: null,
    frontier: null,
    retained: null,
    families: null,
    valid: null,
    billed: null,
    noise: null,
    counted: null,
    points: null,
    turns: null,
    worth: null,
  });
}

it("reviews a stopped draw with five short tasks and seventeen rejected answers without scoring its prefix", async () => {
  const s = fixture();
  const report = await checkpoint(s.request);
  unscored(report);
  expect(report.short).toEqual(["t-6", "t-7", "t-8", "t-9", "t-10"]);
  expect(report.aside).toEqual(["t-4", "t-5", "t-7", "t-10"]);
  expect(report.short.filter((task) => report.aside.includes(task))).toHaveLength(2);
  expect(report).toMatchObject({ settled: comparison.UNSETTLED, disputed: [], withdrawn: [] });
  const events = read(s.log);
  const fixed = comparison.fixedIn(events, ID)!;
  const covered = comparison.coverageOf(events, fixed);
  expect(fixed.tasks).toHaveLength(10);
  expect(covered.pairs.map(({ task }) => task)).toEqual(["t-1", "t-2", "t-3", "t-4", "t-5"]);
  const observed = comparison.solvesUnder(events, fixed);
  expect(observed).toHaveLength(53);
  expect(observed.every(({ counts }) => counts)).toBe(true);
  const reference = Map.groupBy(
    observed.filter(({ under }) => under.harness === "old"),
    ({ under }) => under.task,
  );
  const mixed = [...reference.values()].filter(
    (solves) =>
      solves.some(({ ending }) => ending?.outcome === "pass") &&
      solves.some(({ ending }) => ending?.outcome === "fail"),
  );
  expect(mixed).toHaveLength(4);
  expect(mixed.flat().filter(({ ending }) => ending?.outcome === "pass")).toHaveLength(9);
  expect(mixed.flat().filter(({ ending }) => ending?.outcome === "fail")).toHaveLength(6);
  const pool = comparison.toLabel(events, ID);
  expect(pool.aside).toHaveLength(14);
  expect(pool.others).toHaveLength(3);
  const passes = new Map(
    comparison
      .passesIn(events, ID)
      .slice(0, 3)
      .map((id) => [id, "sound"] as const),
  );
  expect(comparison.passesIn(events, ID)).toHaveLength(25);
  const settled = settleReading(s.log, ID, s.labels, passes);
  unscored(settled);
  expect(settled.short).toEqual(report.short);
  expect(settled.settled).toMatchObject({
    labelled: 17,
    defects: 14,
    restored: [],
    passes: Object.fromEntries(passes),
  });
  expect(taskStates(read(s.log)).get("t-7")).toBe("disputed");
  const labels = comparison.settledLabels(read(s.log));
  expect(labels.size).toBe(17);
  const measured = agreement(read(s.log), labels);
  expect(measured.table["check-defect"]["check-defect"]).toBe(14);
  expect(measured.table.earned.earned).toBe(3);
  expect(clears(measured, { caught: 0.75, voided: 0.1 })).toBe(false);
  expect(comparison.swapped(read(s.log), ID)).toBeNull();
  const length = read(s.log).length;
  expect(settleReading(s.log, ID, s.labels, passes)).toEqual(settled);
  expect(read(s.log)).toHaveLength(length);
  expect(() => settleReading(s.log, ID, new Map(), passes)).toThrow("settled already");
  expect(await checkpoint(s.request)).toEqual(settled);
  expect(read(s.log)).toHaveLength(length);
  // Another comparison's solves cannot change the first report's coverage.
  append(s.log, "solve.started", {
    solve: "later",
    condition: recordCondition(s.log, conditionOf("t-8", "old")),
    comparison: "g-2",
  });
  append(s.log, "solve.finished", { solve: "later", ending: { outcome: "pass" } });
  expect(comparison.coverageOf(read(s.log), fixed)).toEqual(covered);
});

it("refuses labels outside the stopped comparison and keeps unreported and unfixed comparisons ineligible", async () => {
  const s = fixture();
  expect(comparison.toLabel(read(s.log), ID)).toEqual({ aside: [], others: [] });
  expect(() => settleReading(s.log, ID, s.labels)).toThrow("no report");
  await checkpoint(s.request);
  const before = read(s.log).length;
  expect(() => settleReading(s.log, ID, new Map([["stray", "earned"]]))).toThrow("no rejected answer");
  expect(() => settleReading(s.log, ID, s.labels, new Map([["stray", "sound"]]))).toThrow(
    "no answer that passed",
  );
  expect(read(s.log)).toHaveLength(before);
  append(s.log, comparison.REPORTED, { session: "unchanged", ...comparison.NOTHING, reading: "no-change" });
  expect(comparison.toLabel(read(s.log), "unchanged")).toEqual({ aside: [], others: [] });
  expect(() => settleReading(s.log, "unchanged", new Map())).toThrow("nothing to settle");
});

it("recovers completion omitted by an older stopped report at its original cutoff", () => {
  const s = fixture();
  append(s.log, comparison.REPORTED, {
    session: ID,
    old: "old",
    fresh: "fresh",
    starter: "old",
    ...comparison.NOTHING,
    aside: ["t-4", "t-5", "t-7", "t-10"],
    reading: STOPPED,
  });
  const fixed = comparison.fixedIn(read(s.log), ID)!;
  const original = comparison.coverageOf(read(s.log), fixed);
  expect(original.short).toHaveLength(5);
  const condition = recordCondition(s.log, conditionOf("t-8", "old"));
  append(s.log, "solve.started", { solve: "after-report", condition, comparison: ID });
  append(s.log, "solve.finished", { solve: "after-report", ending: ENDINGS.get("D")! });
  expect(comparison.toLabel(read(s.log), ID).aside).toHaveLength(14);
  const settled = settleReading(
    s.log,
    ID,
    new Map([...s.labels.keys()].map((solve) => [solve, "earned"] as const)),
  );
  unscored(settled);
  expect(settled.short).toEqual(original.short);
  expect(settled.settled).toMatchObject({ restored: [] });
  expect(comparison.coverageOf(read(s.log), fixed)).toEqual(original);
});

it("keeps a winning completed prefix unscored after earned labels for both defect and cap stops", async () => {
  const wins = Object.fromEntries(
    Array.from({ length: 6 }, (_, n) => [`win-${String(n)}`, ["LLLL", "PPPP"] as const]),
  );
  for (const stop of ["defect", "cap"] as const) {
    const s = fixture({ ...wins, broken: ["D", ""] }, stop);
    const first = await checkpoint(s.request);
    const fixed = comparison.fixedIn(read(s.log), ID)!;
    const labels = new Map([...s.labels.keys()].map((solve) => [solve, "earned"] as const));
    // This is the dangerous counterfactual: the selected prefix would clear the fixed level.
    expect(comparison.compared(read(s.log), fixed, labels).reading).toBe("step");
    const settled = settleReading(s.log, ID, labels);
    unscored(settled, stop === "cap" ? "not-scored" : STOPPED, stop === "cap");
    expect(settled.short).toEqual(first.short);
    expect(settled.aside).toEqual([]);
    expect(settled.settled).toMatchObject({ restored: [] });
    expect(comparison.swapped(read(s.log), ID)).toBeNull();
    expect(stopRule(read(s.log))).toMatchObject({ checkpoints: 0, sinceStep: 0 });
    expect(epochsOf(read(s.log))[0]?.falsePromotion.attempts).toBe(0);
    expect(await checkpoint(s.request)).toEqual(settled);
  }
});

it("keeps ordinary settlement and swapped readings for a completed scored comparison", async () => {
  const s = fixture({ complete: ["PPPR", "PPPP"] });
  const report = await checkpoint(s.request);
  expect(report.scored).not.toBeNull();
  expect(report.versions).toEqual(["complete"]);
  const settled = settleReading(s.log, ID, s.labels);
  expect(settled.scored).toEqual(report.scored);
  expect(comparison.swapped(read(s.log), ID)?.decided).toBe(report.reading);
});

it("reads a settled flip against this tree's unlabelled reading, apart from the reading on record", async () => {
  const s = fixture({ complete: ["PPPR", "PPPP"] });
  const report = await checkpoint(s.request);
  settleReading(s.log, ID, s.labels);
  // The first report as an older rule would have recorded it: another reading of the same solves.
  const other = report.reading === "step" ? "no-step" : "step";
  let first = true;
  const older = read(s.log).map((event) => {
    if (event.kind !== "comparison.reported" || !first) return event;
    first = false;
    return { ...event, data: { ...event.data, reading: other } };
  });
  expect(comparison.swapped(older, ID)).toMatchObject({ decided: other, unlabelled: report.reading });
});

it("draws and settles the stopped comparison through the blind packet command", async () => {
  const s = fixture();
  await checkpoint(s.request);
  const root = mkdtempSync(join(tmpdir(), "ana-stopped-settle-"));
  const name = `test-stopped-settle-${String(runtimeProcess.pid)}`;
  const folder = join(REPO, ".ana", "d2", name);
  scratches.push(root, folder);
  mkdirSync(folder, { recursive: true });
  const bundle = join(root, "bundle");
  layOutPack(root, bundle, fixtureTasks(10), join(REPO, "test", "fixtures", "harness-min"));
  cpSync(s.log, join(folder, "log.jsonl"));
  const args = [
    "--name",
    name,
    "--root",
    root,
    "--sweep",
    "s",
    "--cycle",
    "c01",
    "--bundle",
    bundle,
    "--session",
    ID,
  ];
  const said = spyOn(console, "log");
  const run = async () => {
    said.mockClear();
    await settleCommand(args);
    return said.mock.calls.flat().join("\n");
  };
  await run();
  const dir = join(folder, `settle-${ID}`);
  const file = join(dir, "labels.json");
  const packet = parseJsonAs<{ rejections: Record<string, string>; passes: Record<string, string> }>(
    readFileSync(file, "utf8"),
  );
  expect(Object.keys(packet.rejections)).toHaveLength(17);
  expect(Object.keys(packet.passes)).toHaveLength(3);
  for (const solve of [...Object.keys(packet.rejections), ...Object.keys(packet.passes)]) {
    const evidence = parseJsonAs<{
      task: { publicInput: { base: number } };
      contract: JsonObject;
      answer: JsonValue;
      refusedBy: string[] | null;
      solve: string;
    }>(readFileSync(join(dir, `${solve}.json`), "utf8"));
    expect(Object.keys(evidence).toSorted()).toEqual(["answer", "contract", "refusedBy", "solve", "task"]);
    expect(evidence.task.publicInput.base).toBeGreaterThan(0);
    expect(Object.keys(evidence.contract)).toEqual(
      expect.arrayContaining(["scope", "conventions", "rules", "answerFormat"]),
    );
    expect(evidence.answer).toEqual({ answer: "42" });
    expect(evidence.refusedBy).toEqual(s.labels.has(solve) ? ["check-a"] : []);
  }
  expect(await run()).toContain("answers still to read");
  const [one = ""] = Object.keys(packet.rejections);
  packet.rejections[one] = "ernd";
  writeFileSync(file, JSON.stringify(packet));
  await expect(run()).rejects.toThrow("holds what is no label");
  writeFileSync(
    file,
    JSON.stringify({
      rejections: Object.fromEntries(Object.keys(packet.rejections).map((solve) => [solve, "earned"])),
      passes: Object.fromEntries(Object.keys(packet.passes).map((solve) => [solve, "sound"])),
    }),
  );
  expect(await run()).toContain("17 labelled rejections");
  said.mockRestore();
  const settled = comparison.reported(read(join(folder, "log.jsonl")), ID)!;
  unscored(settled);
  expect(settled.settled).toMatchObject({ labelled: 17, restored: [] });
});
