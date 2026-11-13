// A campaign ended with SIGKILL and run again by the same command (`tools/d2/harness-builder.ts`),
// which is what a killed process, an evicted host or a power cut leaves a run's keeper to do. The
// command and its seats' scripts run in a process of their own (`helpers/killed-campaign.ts`), so the
// kill is a real one: the test in `harness-builder.test.ts` that ends cut sessions writes their
// events itself, and proved the reader against a writer nobody had killed. Each case names the kill
// by what the log holds when it lands, and holds the run after it to what no kill may change: the
// log before it stands as it was, each session it cut is ended as killed, no solve of the dead
// process is taken up or left counted as open by the new one, every task of the pack is put to its
// gate, and a comparison it interrupted reports once, on the tasks it began with, with each side
// solved as often as its terms say.
//
// The kill comes from outside, some time after the log holds its point, so each case names a stretch
// wide enough to take it: with every kill 400 ms late all six pass, and 2.5 s late four fail on the
// stretch they name and none on what holds of any kill. A scripted Examiner session is the one
// stretch of milliseconds, and on a loaded runner the kill found its tasks written, so that session
// waits inside its first request until the kill.

import { afterAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { REPORTED } from "../src/campaign/comparison.ts";
import { LOG_FILE, type LogEvent, read } from "../src/kernel/log.ts";
import { admissionsOf, taskSets } from "../src/kernel/task.ts";
import { cutSessions, unfinished } from "../src/kernel/trace.ts";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { isString } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join, resolve } from "../src/meta/path.ts";
import { capturedExecPath, runtimeProcess } from "../src/meta/process.ts";
import { layOutPack } from "./helpers/fixture-pack.ts";
import { PACK_TASKS } from "./helpers/killed-campaign.ts";

/** Where the kill lands: once the log holds `count` events of `kind`. */
interface Point {
  readonly kind: LogEvent["kind"];
  readonly count: number;
}

const REPO = resolve(import.meta.dir, "..");
const STEM = `test-kill-${String(runtimeProcess.pid)}`;
const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-kill-")));
const names: string[] = [];
/** A line a kill inside a write leaves: no newline, and cut inside a multi-byte character's text. */
const TORN = `{"at":"2026-11-13T00:00:00.000Z","kind":"solve.call","data":{"text":"caf`;

setDefaultTimeout(600_000);
layOutPack(root, join(root, "bundle"), PACK_TASKS, join(REPO, "test", "fixtures", "harness-min"));

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  for (const name of names) rmSync(join(REPO, ".ana", "d2", name), { recursive: true, force: true });
});

const logOf = (name: string): string => join(REPO, ".ana", "d2", name, LOG_FILE);
const held = (log: string, { kind, count }: Point): boolean =>
  existsSync(log) && readFileSync(log, "utf8").split(`","kind":"${kind}","data"`).length > count;

/** One run of the command for `moves` moves, ended with SIGKILL at `point` where one is named. */
async function once(name: string, moves: number, point: Point | null) {
  const log = logOf(name);
  const child = Bun.spawn(
    [capturedExecPath, join(REPO, "test", "helpers", "killed-campaign.ts"), root, name, String(moves)],
    { cwd: REPO, stdout: "ignore", stderr: "pipe" },
  );
  let killed = false;
  const watch = async (at: Point) => {
    while (child.exitCode === null && !killed) {
      if (held(log, at)) {
        child.kill("SIGKILL");
        killed = true;
      } else await Bun.sleep(1);
    }
  };
  const watched = point === null ? Promise.resolve() : watch(point);
  const said = await new Response(child.stderr).text();
  const code = await child.exited;
  await watched;
  return { killed, code, said };
}

/** A campaign run until the kill at `point`, with a torn line left after it where `torn`, and then
 *  run again for `again` moves: the log as the kill left it and as the second run did. With `waits`,
 *  an Examiner session of the first run waits inside its first request, where the kill finds it. */
async function killedAt(point: Point, again: number, torn: boolean, waits = false) {
  const name = `${STEM}-${point.kind.replace(".", "-")}-${String(point.count)}`;
  names.push(name);
  const folder = join(REPO, ".ana", "d2", name);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "seed.json"), `${JSON.stringify({ from: null, events: 0 })}\n`);
  const hold = join(root, `${name}.hold`);
  if (waits) writeFileSync(hold, "");
  const first = await once(name, 12, point);
  rmSync(hold, { force: true });
  // A script that no longer reaches the point would leave the case proving nothing.
  expect({ killed: first.killed, code: first.code }).toEqual({ killed: true, code: 137 });
  const before = read(logOf(name));
  if (torn) appendFileSync(logOf(name), TORN);
  const second = await once(name, again, null);
  // The second run's own words, where it failed, say more than an exit code.
  expect({ code: second.code, said: second.code === 0 ? "" : second.said.slice(-3000) }).toEqual({
    code: 0,
    said: "",
  });
  return { before, after: read(logOf(name)) };
}

/** A field of an event that holds a word, or nothing where it holds none. */
const word = (value: unknown): string => (isString(value) ? value : "");

/** The solves a log holds a start of and no end, by id. */
const openSolves = (events: readonly LogEvent[]) =>
  unfinished(events).flatMap(({ of, id }) => (of === "solve" ? [id] : []));

/** What holds of any kill, wherever it landed. */
function expectContinued({ before, after }: Awaited<ReturnType<typeof killedAt>>): void {
  // The log is appended to and never rewritten, a torn line after it left out.
  expect(after.slice(0, before.length)).toEqual(before);
  const later = after.slice(before.length);
  // Each session the kill cut is ended as killed, once, and the second run leaves none open.
  for (const { of, session } of cutSessions(before)) {
    const ends = later.filter(({ kind, data }) => kind === `${of}.finished` && data.session === session);
    expect(ends.map(({ data }) => data.ended)).toEqual(["killed"]);
  }
  expect(cutSessions(after)).toEqual([]);
  // A solve the dead process had open stays without an end, and the new one leaves none of its own.
  expect(openSolves(after)).toEqual(openSolves(before));
  // Every task of the pack has been put to its gate.
  const sets = taskSets(after);
  expect(admissionsOf(after).size).toBeGreaterThanOrEqual(PACK_TASKS.length);
  expect(sets.held.length + sets.released.length).toBeGreaterThanOrEqual(PACK_TASKS.length);
  // Each comparison that reported did so once, on the tasks it began with, each side solved as
  // often as its terms say: a solve the kill cut is solved again, and one that ended is not.
  const reports = after.filter(({ kind }) => kind === REPORTED);
  expect(new Set(reports.map(({ data }) => data.session)).size).toBe(reports.length);
  for (const { data: report } of reports) {
    const terms = after.find(
      ({ kind, data }) => kind === "comparison.started" && data.session === report.session,
    );
    const tasks = Array.isArray(terms?.data.tasks) ? terms.data.tasks.length : -1;
    expect(report.tasks).toBe(tasks);
    const mine = new Map(
      after.flatMap(({ kind, data }) =>
        kind === "solve.started" && data.comparison === report.session
          ? [[data.solve, `${word(data.task)} ${word(data.condition)}`] as const]
          : [],
      ),
    );
    const ended = new Map<string, number>();
    for (const { kind, data } of after) {
      const pair = kind === "solve.finished" ? mine.get(data.solve) : undefined;
      if (pair !== undefined) ended.set(pair, (ended.get(pair) ?? 0) + 1);
    }
    const sides = report.old === report.fresh ? 1 : 2;
    expect([...ended.values()]).toEqual(Array.from({ length: tasks * sides }, () => Number(report.solves)));
  }
  // A harness is promoted once.
  const promoted = after.flatMap(({ kind, data }) => (kind === "harness.promoted" ? [data.harness] : []));
  expect(new Set(promoted).size).toBe(promoted.length);
}

const readings = (events: readonly LogEvent[]) =>
  events.flatMap(({ kind, data }) =>
    kind === REPORTED ? [`${word(data.session)} ${word(data.reading)}`] : [],
  );

describe("a campaign killed and run again", () => {
  it("puts to its gate every task a kill inside the pack's set-up left, torn line and all", async () => {
    const cut = await killedAt({ kind: "task.proposed", count: 9 }, 1, true);
    expectContinued(cut);
    const sets = taskSets(cut.after);
    expect([sets.held.length, sets.released.length]).toEqual([PACK_TASKS.length - 2, 2]);
  });

  it("starts a new Builder conversation after one a kill cut, and compares and promotes what it leaves", async () => {
    const cut = await killedAt({ kind: "build.started", count: 1 }, 3, false);
    expectContinued(cut);
    expect(cutSessions(cut.before).map(({ session }) => session)).toEqual(["b-1"]);
    expect(readings(cut.after)).toEqual(["g-1 step"]);
    expect(cut.after.filter(({ kind }) => kind === "harness.promoted")).toHaveLength(1);
  });

  it("goes on with a comparison a kill cut with solves in flight, under its id and its terms", async () => {
    const cut = await killedAt({ kind: "solve.finished", count: 10 }, 2, true);
    expectContinued(cut);
    expect(readings(cut.before)).toEqual([]);
    expect(cut.before.filter(({ kind }) => kind === "comparison.started")).toHaveLength(1);
    // The solves that had ended are kept: the second run starts only what the comparison still lacks.
    expect(cut.after.filter(({ kind }) => kind === "comparison.started")).toHaveLength(1);
    expect(readings(cut.after)).toEqual(["g-1 step"]);
    expect(cut.after.filter(({ kind }) => kind === "harness.promoted")).toHaveLength(1);
  });

  it("promotes once the harness whose step a kill left reported and not promoted", async () => {
    const cut = await killedAt({ kind: REPORTED, count: 1 }, 1, false);
    expectContinued(cut);
    expect(readings(cut.after).slice(0, 1)).toEqual(["g-1 step"]);
    expect(cut.after.filter(({ kind }) => kind === "harness.promoted")).toHaveLength(1);
  });

  it("ends an Examiner session a kill cut and writes the tasks in a new one", async () => {
    const cut = await killedAt({ kind: "exam.started", count: 1 }, 1, true, true);
    expectContinued(cut);
    expect(cutSessions(cut.before).map(({ session }) => session)).toContain("x-1");
    const ended = cut.after.flatMap(({ kind, data }) =>
      kind === "exam.finished" ? [`${word(data.session)} ${word(data.ended)}`] : [],
    );
    expect(ended.slice(0, 1)).toEqual(["x-1 killed"]);
    expect(ended).toHaveLength(2);
  });

  it("goes on with the starter comparison after a promotion, cut in its turn", async () => {
    const cut = await killedAt({ kind: "solve.finished", count: 44 }, 1, false);
    expectContinued(cut);
    expect(readings(cut.before)).toEqual(["g-1 step"]);
    expect(readings(cut.after)).toEqual(["g-1 step", "g-2 no-step"]);
  });
});
