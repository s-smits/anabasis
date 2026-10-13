// The Harness Builder's controller over a fixture pack, with a script in each model seat: a
// campaign run from set-up to an ending on one command (`tools/d2/harness-builder.ts`). The exam's
// reading, the task sets, each Builder session's wall and freeze, each solve's wall and the
// comparison are the real ones; the seats are scripts, which are paid nothing.

import { afterAll, describe, expect, it, setDefaultTimeout, spyOn } from "bun:test";
import { examine } from "../src/examiner/session.ts";
import { append, LOG_FILE, type LogEvent, read } from "../src/kernel/log.ts";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import { isString, type JsonObject } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join, resolve } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import type { Seats } from "../tools/d2/campaign-terms.ts";
import { closeCommand } from "../tools/d2/close.ts";
import { harnessBuilder as command } from "../tools/d2/harness-builder.ts";
import { HOST } from "../tools/d2/host.ts";
import { importCommand } from "../tools/d2/import.ts";
import { packetOf, settleCommand } from "../tools/d2/settle.ts";
import { wordCommand } from "../tools/d2/word.ts";
import { scriptedSeats } from "../tools/runs/rehearse.ts";
import { FORMAT, fixtureTasks, gradedOf, layOutPack, scriptedModel } from "./helpers/fixture-pack.ts";

const REPO = resolve(import.meta.dir, "..");
const FIXTURE = join(REPO, "test", "fixtures", "harness-min");
const STEM = `test-hb-${String(runtimeProcess.pid)}`;
const OPENED = "campaign.opened";
/** The project every campaign here is opened under. */
const PROJECT = "fixture-products";
const MOVED = "campaign.move";
/** What a scripted Examiner says as it finishes having written nothing. */
const NOTHING = "Nothing to add.";
// Fourteen held once two are released: a comparison's seven and its repeat's, which a campaign holds
// before its first comparison (12 October). At the default level, 0.02 since 12 October, a step
// takes six tasks all won (`sweepOf`), and seven still read one after a pass labelled wrong.
const TASKS = fixtureTasks(16);
const scripted = scriptedModel;
const GRADED = gradedOf(TASKS);
const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-hb-")));
const bundle = join(root, "bundle");
const names: string[] = [];

setDefaultTimeout(600_000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  for (const name of names) rmSync(join(REPO, ".ana", "d2", name), { recursive: true, force: true });
});

/** A campaign's folder marked as a seed, which is where a scripted solve may be written, and the
 *  flags that name it. */
function seeded(name: string, under = root): string[] {
  names.push(name);
  const folder = join(REPO, ".ana", "d2", name);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "seed.json"), `${JSON.stringify({ from: null, events: 0 })}\n`);
  // The fixture's one check is its author's own arithmetic, which stands on the operator's word.
  const admitted = ["--admit", "check-product"];
  const pack = ["--root", under, "--sweep", "s", "--cycle", "c01", "--bundle", join(under, "bundle")];
  return [...pack, "--name", name, "--project", PROJECT, ...admitted];
}

/** What a campaign's log holds of one kind, in order. */
const of = (name: string, kind: string): JsonObject[] =>
  read(join(REPO, ".ana", "d2", name, LOG_FILE)).flatMap((event: LogEvent) =>
    event.kind === kind ? [event.data] : [],
  );

/** The campaign command with the host making every move the table names: a campaign that opens
 *  now is led by its Builder unless its command says otherwise (`test/builder-led.test.ts`). */
const harnessBuilder = (args: readonly string[], seats?: Seats) =>
  command([...args, "--no-builder-led"], seats);

describe("a campaign run by its log", () => {
  it("asks the Examiner for what the campaign is short of, before the first session, and tells it the campaign's wall", async () => {
    layOutPack(root, bundle, TASKS, FIXTURE);
    const name = `${STEM}-short`;
    // Sixteen tasks in the pack, two released: fourteen held of the twenty a comparison at a target
    // of twenty scores, and two practice tasks of the three the campaign names, which the release
    // draws from the held ones. The session is asked for seven, and the Examiner is told nothing of
    // the number. The wall is the campaign's term, and until 11 October the Examiner was told the
    // default of two hours whatever the term said.
    const flags = [
      ...seeded(name),
      "--patience",
      "1",
      "--target",
      "20",
      "--practice",
      "3",
      "--solve-minutes",
      "7",
    ];
    const asked: { tasks: number; minutes: number | undefined }[] = [];
    const seats: Seats = {
      seated: scriptedSeats({ held: { old: "none", fresh: "pass" }, starter: "none" }, GRADED, []),
      examine: (request) => {
        asked.push({ tasks: request.wanted, minutes: request.budget?.minutes });
        return examine({
          ...request,
          ...scripted([
            ["finish", { note: NOTHING }],
            ["finish", { note: NOTHING }],
          ]),
        });
      },
    };
    const ending = await harnessBuilder(flags, seats);
    expect(of(name, MOVED).map(({ move, session }) => [move, session ?? null])).toEqual([
      ["accept", null],
      ["prepare", null],
      ["examine", "x-1"],
    ]);
    expect(asked).toEqual([{ tasks: 7, minutes: 7 }]);
    expect(of(name, "exam.started")).toMatchObject([{ limits: { tasks: 7 } }]);
    expect(ending).toMatchObject({ move: "end", ending: "exam" });
  });

  it("waits out a provider limit that names its reset, on record, and makes the move again", async () => {
    layOutPack(root, bundle, TASKS, FIXTURE);
    const name = `${STEM}-limit`;
    const flags = [...seeded(name), "--patience", "1", "--target", "20", "--practice", "3"];
    // The first Examiner session is refused on a limit the provider says lifts in a minute.
    const reset = Math.floor(Date.now() / 1000) + 60;
    let refused = false;
    const seats: Seats = {
      seated: scriptedSeats({ held: { old: "none", fresh: "pass" }, starter: "none" }, GRADED, []),
      examine: (request) => {
        if (!refused) {
          refused = true;
          throw new Error(`Claude Code: usage limit (limit reached|${String(reset)})`);
        }
        return examine({
          ...request,
          ...scripted([
            ["finish", { note: NOTHING }],
            ["finish", { note: NOTHING }],
          ]),
        });
      },
    };
    const slept: number[] = [];
    const host = {
      ...HOST,
      sleep: async (ms: number) => {
        slept.push(ms);
      },
    };
    // The move the limit ended is one of the run's moves: of three, it was the third, and the run
    // stops at the move it would make again.
    expect(await harnessBuilder([...flags, "--moves", "3"], { ...seats, host })).toMatchObject({
      move: "examine",
    });
    expect(of(name, MOVED).map(({ session }) => session ?? null)).toEqual([null, null, "x-1"]);
    const ending = await harnessBuilder(flags, { ...seats, host });
    // Slept to a minute past the named reset, and the session asked again went on to the ending.
    expect(slept).toHaveLength(1);
    expect(of(name, "campaign.waited")).toEqual([
      { for: "provider", until: new Date(reset * 1000).toISOString(), ms: slept[0] ?? 0 },
    ]);
    expect(of(name, "campaign.ended")).toEqual([expect.objectContaining({ ending: "exam" })]);
    expect(ending).toMatchObject({ move: "end", ending: "exam" });
    // Each move is on record from its start with the row that chose it by its code, the one that threw too.
    expect(of(name, MOVED).map(({ move, session, code }) => [move, session ?? null, code])).toEqual([
      ["accept", null, "exam"],
      ["prepare", null, "tasks"],
      ["examine", "x-1", "tasks"],
      // The id the move that threw had is not used again.
      ["examine", "x-2", "tasks"],
    ]);
  });

  it("ends as killed, before its first move, each session a stopped run left open, and none that ended", async () => {
    layOutPack(root, bundle, TASKS, FIXTURE);
    const name = `${STEM}-cut`;
    const flags = [...seeded(name), "--patience", "1", "--target", "10", "--practice", "3"];
    const seats: Seats = {
      seated: scriptedSeats({ held: { old: "none", fresh: "pass" }, starter: "none" }, GRADED, []),
      examine: (request) =>
        examine({
          ...request,
          ...scripted([
            ["finish", { note: NOTHING }],
            ["finish", { note: NOTHING }],
          ]),
        }),
    };
    await harnessBuilder([...flags, "--moves", "2"], seats);
    // A run stopped from outside mid-session: an Examiner's and a Builder's start, a turn each.
    const log = join(REPO, ".ana", "d2", name, LOG_FILE);
    const usage = { cost: { total: 0.25 } };
    append(log, "exam.started", { session: "x-1" });
    append(log, "exam.turn", { session: "x-1", usage });
    append(log, "build.started", { session: "b-1" });
    append(log, "build.turn", { session: "b-1", usage });
    const before = read(log).length;
    await harnessBuilder([...flags, "--moves", "1"], seats);
    const after = read(log).slice(before);
    const cut = { ended: "killed", crash: null, turns: 1, billed: 0.25 };
    expect(after.slice(0, 2)).toMatchObject([
      { kind: "build.finished", data: { session: "b-1", ...cut } },
      { kind: "exam.finished", data: { session: "x-1", ...cut } },
    ]);
    expect(after.findIndex(({ kind }) => kind === MOVED)).toBeGreaterThan(1);
    // Reopened once more, with every session ended: nothing more is ended.
    const ends = () => read(log).filter(({ data }) => data.ended === "killed").length;
    await harnessBuilder(flags, seats);
    expect(ends()).toBe(2);
  });

  it("runs from set-up to an ending on one command, with every move on record: a session with nothing to work on sends it to the Examiner", async () => {
    layOutPack(root, bundle, TASKS, FIXTURE);
    const name = `${STEM}-idle`;
    // A patience of two, so that the ending is reached in two idle Examiner sessions; a target of
    // five, which the pack's held-out tasks hold twice, so that the first move builds: a campaign
    // short of its target and a repeat's has tasks written before the first session (11 and 12 October).
    const flags = [...seeded(name), "--patience", "2", "--target", "5"];
    const strayed: string[] = [];
    const solves = scriptedSeats({ held: { old: "none", fresh: "pass" }, starter: "none" }, GRADED, strayed);
    // A Builder that finishes with the harness as it was, having practised on nothing: it had
    // nothing to work on, which counts nothing towards the stop and sends the table to the
    // Examiner for tasks that leave room. An Examiner that holds out none, as many times as the
    // campaign's patience, ends it on its room.
    const seats: Seats = {
      seated: (campaign, given) => ({
        ...solves(campaign, given),
        builder: scripted([["finish", { note: "Nothing to change." }]]),
      }),
      examine: (request) =>
        examine({
          ...request,
          // Twice: a first finish while the host has not the tasks it needs is declined once.
          ...scripted([
            ["finish", { note: NOTHING }],
            ["finish", { note: NOTHING }],
          ]),
        }),
    };
    // The host is loaded throughout: a solve would wait, and a move waits for nothing.
    const looks: number[] = [];
    const host = {
      load: () => {
        looks.push(looks.length);
        return 99;
      },
      cores: 4,
      waitMs: 1,
    };
    // A dry run names the first move and writes nothing.
    expect(await harnessBuilder([...flags, "--dry-run"], seats)).toMatchObject({ move: "accept" });
    expect(of(name, OPENED)).toEqual([]);

    const ending = await harnessBuilder([...flags, "--practice", "2"], { ...seats, host });
    // Reading the exam and setting the tasks apart asked the host nothing. The one session looked
    // once, for its record, and solved nothing, so nothing waited at the gate: until 12 October
    // the session waited at its start for a host it would never solve on. An Examiner session
    // solves nothing and looks not at all.
    expect(looks).toHaveLength(1);
    expect(of(name, "campaign.waited")).toEqual([]);
    expect(ending).toEqual({
      move: "end",
      ending: "no-room",
      code: "unshown",
      why: "2 Examiner sessions in a row held out no task (Builder session b-1 left its harness as it was, and no practice solve of its failed: it had nothing to work on, so the tasks have to change before another session is paid for): the tasks could not be made to leave room",
    });
    // Each move records when it began, and a move that solves the load the host had then; the moves
    // that solve nothing read the host not at all.
    const moves = of(name, MOVED);
    expect(moves.every(({ began }) => isString(began))).toBe(true);
    expect(moves.map(({ move, load, cores }) => [move, load ?? null, cores ?? null])).toEqual([
      ["accept", null, null],
      ["prepare", null, null],
      ["build", 99, 4],
      ["examine", null, null],
      ["examine", null, null],
    ]);
    expect(of(name, MOVED).map(({ move, session }) => [move, session ?? null])).toEqual([
      ["accept", null],
      ["prepare", null],
      ["build", "b-1"],
      ["examine", "x-1"],
      ["examine", "x-2"],
    ]);
    expect(of(name, "checker.read")).toHaveLength(1);
    expect(of(name, "build.finished").map(({ changed }) => changed)).toEqual([false]);
    expect(of(name, "solve.started")).toEqual([]);
    // It runs by what it was opened with: no budget under a rehearsal's seats, no limit named, and
    // the patience it was given.
    expect(of(name, OPENED)).toEqual([
      {
        project: PROJECT,
        budget: null,
        limit: null,
        sessions: 2,
        patience: 2,
        seats: { builder: null, examiner: null, reviewer: null },
        // The level is pinned whether or not a command named it: this tree's default.
        terms: { level: "0.02", practice: "2", target: "5", trigger: "0.25" },
      },
    ]);
    // The ending is the log's last event, and run again the command says it and adds nothing.
    const log = read(join(REPO, ".ana", "d2", name, LOG_FILE));
    expect(log.at(-1)).toMatchObject({
      kind: "campaign.ended",
      data: { ending: "no-room", reference: "starter" },
    });
    expect(await harnessBuilder(flags, seats)).toMatchObject({ move: "end", ending: "no-room" });
    expect(read(join(REPO, ".ana", "d2", name, LOG_FILE))).toHaveLength(log.length);
    expect(strayed).toEqual([]);
  });

  it("holds a campaign whose comparisons ran at a level its opening never named to that level, and not to the tree's default", async () => {
    // Until 10 October the level was read at each comparison from the tree's default, so a
    // campaign opened on a tree at 0.10 and run on from one at 0.20 changed its test (#175).
    const name = `${STEM}-level`;
    const flags = seeded(name);
    const log = join(REPO, ".ana", "d2", name, LOG_FILE);
    append(log, OPENED, {
      budget: null,
      limit: null,
      sessions: 1,
      // One attempt: at 24 tasks a longer patience passes the bound an opening may risk (`openingLines`).
      patience: 1,
      seats: { builder: null, examiner: null, reviewer: null },
      terms: { practice: "2" },
    });
    append(log, "comparison.started", { session: "g-1", level: 0.1, old: "a", fresh: "b", tasks: [] });
    const seats: Seats = {
      seated: scriptedSeats({ held: { old: "none", fresh: "pass" }, starter: "none" }, GRADED, []),
    };
    // Its comparisons began under the rule of one reading at a time, so the two-stage rule's
    // trigger is not defaulted for it: the operator names both terms once.
    expect(harnessBuilder([...flags, "--moves", "0"], seats)).rejects.toThrow(
      "name --level and --trigger once for it (the plan's are --level 0.02 --trigger 0.25)",
    );
    // Naming the trigger alone would pin the level to the start's, under the summed rule.
    expect(harnessBuilder([...flags, "--trigger", "0.25", "--moves", "0"], seats)).rejects.toThrow(
      "name --level and --trigger once",
    );
    expect(of(name, OPENED)).toHaveLength(1);
    await harnessBuilder([...flags, "--level", "0.1", "--trigger", "0.25", "--moves", "0"], seats);
    expect(of(name, OPENED).at(-1)).toMatchObject({
      terms: { level: "0.1", practice: "2", trigger: "0.25" },
    });
    // A later command on the same tree writes no new record, and one that names the level does.
    await harnessBuilder([...flags, "--moves", "0"], seats);
    expect(of(name, OPENED)).toHaveLength(2);
    await harnessBuilder([...flags, "--level", "0.2", "--moves", "0"], seats);
    expect(of(name, OPENED).at(-1)).toMatchObject({
      terms: { level: "0.2", practice: "2", trigger: "0.25" },
    });
  });

  it("ends on an exam whose checks wait for the operator's word, and prints the command that gives it with the pack's flags", async () => {
    const name = `${STEM}-admit`;
    const flags = seeded(name).slice(0, -2);
    const seats: Seats = {
      seated: scriptedSeats({ held: { old: "none", fresh: "pass" }, starter: "none" }, GRADED, []),
    };
    const said = spyOn(console, "log");
    // One attempt: at 24 tasks a longer patience passes the bound an opening may risk (`openingLines`),
    // and the opening keeps it for the command it prints.
    const ending = await harnessBuilder([...flags, "--patience", "1"], seats);
    const lines = said.mock.calls.map(([line]) => (isString(line) ? line : ""));
    said.mockRestore();
    expect(ending).toMatchObject({ move: "end", ending: "exam" });
    // Run as printed, the command opens the campaign's pack: on 9 October the line named the
    // campaign alone, and over a stored pack that run threw for want of the four flags.
    const printed = lines
      .find((line) => line.startsWith("to admit"))
      ?.split(": bun tools/d2/harness-builder.ts ")[1];
    // The campaign keeps its project, so the line names the pack and the campaign alone.
    expect(printed).toBe(`${flags.slice(0, -2).join(" ")} --admit check-product`);
    const next = await harnessBuilder([...(printed ?? "").split(" "), "--dry-run"], seats);
    expect(next).toMatchObject({ move: "accept" });
  });

  it("compares a step again, waits under --attended to promote it, still waits when reopened without the flag, promotes it given the word back, and then has tasks written", async () => {
    const name = `${STEM}-climb`;
    // The seed holds fourteen tasks to score once two are released, and a comparison scores seven:
    // the row that writes tasks up to the target is tested in `test/decide.test.ts`.
    // At a trigger of its own, so that the comparisons are seen to run under the campaign's and
    // not the command's default (found by review, 11 October: the flag was not passed on).
    const flags = [
      ...seeded(name),
      "--practice",
      "2",
      "--solves",
      "1",
      "--sessions",
      "1",
      "--target",
      "7",
      "--trigger",
      "0.5",
      // The patience the opening's bound holds at these terms (`openingLines`).
      "--patience",
      "1",
    ];
    const strayed: string[] = [];
    // Under the new harness every held-out task is answered, and under the reference none.
    const seats: Seats = {
      seated: scriptedSeats({ held: { old: "none", fresh: "pass" }, starter: "none" }, GRADED, strayed),
      examine: (request) => {
        const tasks = [41, 42, 43].map((base) => ({
          family: "fixture",
          public_input: { base },
          hidden: null,
        }));
        const script = scripted([
          ["propose_tasks", { tasks }],
          ["finish", { note: "Three more." }],
          ["finish", { note: "Three more." }],
        ]);
        return examine({ ...request, ...script });
      },
    };
    // The host is loaded once, at the first look after the first comparison began: its first solve
    // waits at the gate until the load falls, and every move's start read a quiet host.
    let loaded = true;
    const host = {
      load: () => {
        const once = loaded && of(name, "comparison.started").length > 0;
        loaded &&= !once;
        return once ? 99 : 0;
      },
      cores: 4,
      waitMs: 1,
    };
    // Set-up, one session, the comparison and its repeat: under `--attended` the promotion is then
    // the operator's.
    const waits = await harnessBuilder([...flags, "--attended"], { ...seats, host });
    expect(waits).toMatchObject({ move: "promote" });
    // The wait is on record, with the load it read, before the solve that waited began; the solves
    // beside it read a quiet host and waited for nothing.
    const kept = read(join(REPO, ".ana", "d2", name, LOG_FILE));
    const waited = kept.findIndex(({ kind }) => kind === "campaign.waited");
    expect(of(name, "campaign.waited")).toEqual([
      expect.objectContaining({ comparison: "g-1", load: 99, cores: 4, ms: expect.any(Number) }),
    ]);
    const held = kept[waited]?.data.task;
    const began = kept.findIndex(({ kind, data }) => kind === "solve.started" && data.task === held);
    expect(waited).toBeLessThan(began);
    expect(of(name, MOVED).flatMap(({ load }) => (load === undefined ? [] : [load]))).toEqual([0, 0, 0]);
    // Each comparison was made under the campaign's trigger, and the move records the command.
    for (const made of of(name, MOVED).filter(({ move }) => move === "compare")) {
      expect(made.args).toEqual(expect.arrayContaining(["--trigger", "0.5", "--level", "0.02"]));
    }
    expect(of(name, MOVED).map(({ move, session }) => [move, session ?? null])).toEqual([
      ["accept", null],
      ["prepare", null],
      ["build", "b-1"],
      ["compare", "g-1"],
      ["compare", "g-2"],
    ]);
    // Each report carries `unsettled` until a person answers its packet, and the promotion below
    // does not wait for it (the operator, 12 October).
    const [first, repeat] = of(name, "comparison.reported");
    expect(first).toMatchObject({
      reading: "step",
      scored: { wins: 7, losses: 0, ties: 0 },
      settled: "unsettled",
    });
    expect(repeat).toMatchObject({
      reading: "step",
      old: first?.old,
      fresh: first?.fresh,
      settled: "unsettled",
    });
    // The repeat scored the seven tasks its first stage did not. Until 12 October a campaign held one
    // target before its first comparison, and buffer-141-m3's g-2 scored g-1's versions again.
    const [once = [], again = []] = of(name, "comparison.started").map(({ tasks }) =>
      Array.isArray(tasks) ? tasks : [],
    );
    expect([once.length, again.length]).toEqual([7, 7]);
    expect(again.filter((task) => once.includes(task))).toEqual([]);
    expect(of(name, "harness.promoted")).toEqual([]);
    // Reopened by its name alone, it still waits: the opening keeps the word. Until 12 October it
    // was the running command's flag, and a reopen that left it off promoted without the operator.
    expect(await harnessBuilder(flags, seats)).toMatchObject({ move: "promote" });
    expect(of(name, "harness.promoted")).toEqual([]);
    expect(of(name, OPENED).at(-1)).toMatchObject({ attended: true });

    // Given the word back, the harness is promoted. No budget leaves the promoted harness
    // failing half its solves, so the tasks have to change: an Examiner session.
    const next = await harnessBuilder([...flags, "--no-attended", "--moves", "2"], seats);
    expect(of(name, OPENED).at(-1)).not.toHaveProperty("attended");
    expect(of(name, "harness.promoted")).toMatchObject([{ harness: first?.fresh }]);
    expect(of(name, "comparison.reported").map(({ settled }) => settled)).toEqual(["unsettled", "unsettled"]);
    expect(of(name, MOVED).slice(5)).toMatchObject([
      { move: "promote", harness: first?.fresh },
      { move: "examine", session: "x-1" },
    ]);
    expect(of(name, "exam.finished")).toMatchObject([{ session: "x-1", proposed: 3 }]);
    // The tasks written are read by a control before a Builder session is paid for: the starter
    // against the promoted harness. Until 10 October the Builder built here, three times, on
    // practice the promoted harness passed (t-4, t-9, t-10).
    expect(next).toMatchObject({ move: "compare", fresh: "starter", reference: "promoted" });
    const after = await harnessBuilder([...flags, "--moves", "1"], seats);
    expect(of(name, "comparison.started").at(-1)).toMatchObject({
      session: "g-3",
      fresh: first?.starter,
      old: first?.fresh,
    });
    // The script answers nothing under the reference nor the starter, so the control reads the new
    // tasks as beyond both, and the table has other tasks written rather than a harness built.
    expect(of(name, "comparison.reported").at(-1)).toMatchObject({ session: "g-3", reading: "no-step" });
    expect(after).toMatchObject({ move: "examine" });
    expect(after.why).toContain("neither harness gave a valid answer");
    expect(strayed).toEqual([]);

    // A person answers g-1's packet, drawn by the comparison's id, so asked again it is the same:
    // its rejected answers, and it has none, since the reference answered nothing, and three of
    // the seven answers that passed, the new harness's. The labels are recorded once a
    // label stands on each, and once only.
    const pack = ["--root", root, "--sweep", "s", "--cycle", "c01", "--bundle", bundle, "--name", name];
    const folder = join(REPO, ".ana", "d2", name, "settle-g-1");
    const file = join(folder, "labels.json");
    const packet = () =>
      parseJsonAs<{ rejections: JsonObject; passes: JsonObject }>(readFileSync(file, "utf8"));
    const lastOf = () => of(name, "comparison.reported").findLast(({ session }) => session === "g-1");
    await settleCommand([...pack, "--session", "g-1"]);
    expect(Object.keys(packet().rejections)).toEqual([]);
    const drawn = Object.keys(packet().passes);
    expect(drawn).toHaveLength(3);
    rmSync(file);
    await settleCommand([...pack, "--session", "g-1"]);
    expect(Object.keys(packet().passes)).toEqual(drawn);
    // Blind: a packet holds the rules and the answer, and names no harness and no ruling.
    const opened = readFileSync(join(folder, `${drawn[0]}.json`), "utf8");
    expect(opened).toContain('"rules"');
    expect(opened).not.toContain(first?.fresh ?? "");
    const [a = "", b = "", c = ""] = drawn;
    const answer = (labels: JsonObject) =>
      writeFileSync(file, JSON.stringify({ rejections: {}, passes: labels }));
    answer({ [a]: "sound", [b]: "wrng", [c]: "sound" });
    expect(settleCommand([...pack, "--session", "g-1"])).rejects.toThrow(
      "holds what is no label (sound, wrong, unclear) for 1 answer",
    );
    answer({ [a]: "sound", [b]: "", [c]: "sound" });
    await settleCommand([...pack, "--session", "g-1"]);
    expect(lastOf()).toMatchObject({ settled: "unsettled" });
    answer({ [a]: "sound", [b]: "wrong", [c]: "sound" });
    const said = spyOn(console, "log");
    await settleCommand([...pack, "--session", "g-1"]);
    const lines = said.mock.calls.map(([line]) => (isString(line) ? line : ""));
    said.mockRestore();
    // It prints the Referee's agreement, here on no labelled rejection, and g-1 read again with the
    // wrong pass a fail: one task fewer won, and a decision that holds.
    expect(lines).toContain(
      "the Referee against 0 labelled rejections, 0 of them unruled: agreement of each kind earned none, check-defect none, unclear none; over all three none, PABAK none beside kappa none",
    );
    expect(lines.find((line) => line.startsWith("g-1: "))).toMatch(
      /^g-1: decided step, and step at 6-0-1 .*: it holds$/,
    );
    await settleCommand([...pack, "--session", "g-1"]);
    // A pass's label moves no tally: g-1 reads as it did.
    expect(lastOf()).toMatchObject({
      reading: "step",
      scored: first?.scored,
      settled: { labelled: 0, passes: { [a]: "sound", [b]: "wrong", [c]: "sound" } },
    });
    expect(of(name, "comparison.reported").filter(({ session }) => session === "g-1")).toHaveLength(2);

    // Until 2026-10-11 a person read a Diagnoser's accounts the same way (`--diagnoses`); the seat
    // went, and the flag with it (`docs/simplify.md`, E1).
    await expect(settleCommand([...pack, "--diagnoses", "5"])).rejects.toThrow("--diagnoses");

    // What the campaign hands over: the promoted harness as a folder that stands by itself, the
    // public rules, and the closing report. It is written outside the repository and once.
    const to = join(root, "handover");
    expect(closeCommand([...pack, "--to", join(REPO, ".ana", "handover")])).rejects.toThrow(
      "lies inside the repository",
    );
    const handed = await closeCommand([...pack, "--to", to]);
    expect(handed.to).toBe(to);
    expect(of(name, "harness.promoted")).toMatchObject([{ harness: handed.harness }]);
    expect(closeCommand([...pack, "--to", to])).rejects.toThrow("holds something already");
    const closing = readFileSync(join(to, "REPORT.md"), "utf8");
    expect(closing).toContain(
      "a person read 3 in 1 comparison, drawn uniformly by each comparison's id: 2 sound, 1 wrong, 0 unclear",
    );
    expect(closing).toContain("settled 1 comparison, and 2 comparisons are unsettled");
    // It holds no link: a kept harness names its programs by one, into a tree beside it, and what
    // is handed over is the tree itself.
    const links = readdirSync(join(to, "harness"), { recursive: true }).filter((entry) =>
      lstatSync(join(to, "harness", String(entry))).isSymbolicLink(),
    );
    expect(links).toEqual([]);
    expect(readFileSync(join(to, "harness", "agent", "BUILT_AGENTS.md"), "utf8")).toContain(
      "A rehearsal added this line.",
    );
    expect(readFileSync(join(to, "RULES.md"), "utf8")).toContain("- R1: The answer is the base times six.");
    const report = readFileSync(join(to, "REPORT.md"), "utf8");
    // The step is named with the comparisons that read it and its last tally beside it.
    expect(report).toContain(
      `harness ${handed.harness.slice(0, 8)}, set-up (epoch 0), read by g-1 and g-2. In g-2 it won 7, lost 0 and tied 0`,
    );
    // Its cost beside it, read against the bar and gating nothing (the plan's W), and no ladder.
    expect(report).toMatch(
      /tied 0\. Its cost, gating nothing: 1 promotion attempt this epoch \(bar 3 after set-up\): met/,
    );
    expect(report).toContain("## The ladder\n\nNo reading:");
    // What each measured thing cost, and how many comparisons that began bought a report.
    expect(report).toMatch(
      /- Comparisons: \$\d+\.\d\d a task scored \(\d+\); 3 of the 3 comparisons that began reported\./,
    );
    expect(report).toContain("- The ladder: no reading, so no point is priced.");
    expect(report).toContain("| g-1 |");
    expect(report).not.toContain("Diagnos");
    expect(report).toContain("The campaign has not ended");
    // No task is named in it, and no check.
    expect(report).not.toContain("t-1");
    expect(report).not.toContain("check-product");

    // The harness solves a task from where it was handed over, outside the campaign's folder: the
    // solve is recorded in a log of its own under the campaign, and the campaign's log is as it was.
    const before = read(join(REPO, ".ana", "d2", name, LOG_FILE)).length;
    const trial = join(root, "handover-solved");
    expect(closeCommand([...pack, "--to", trial, "--solve", "no-such-task"])).rejects.toThrow(
      "--solve no-such-task: the campaign holds no task by that id",
    );
    rmSync(trial, { recursive: true, force: true });
    const solved = await closeCommand(
      [...pack, "--to", trial, "--solve", "t-1"],
      scriptedSeats({ held: { old: "none", fresh: "pass" }, starter: "none" }, GRADED, strayed),
    );
    expect(solved).toMatchObject({ harness: handed.harness, solved: "pass" });
    const trialled = read(join(REPO, ".ana", "d2", name, "handover", LOG_FILE));
    expect(trialled.filter(({ kind }) => kind === "solve.finished")).toMatchObject([
      { data: { ending: { outcome: "pass" }, harness: handed.harness } },
    ]);
    expect(read(join(REPO, ".ana", "d2", name, LOG_FILE))).toHaveLength(before);
    expect(strayed).toEqual([]);
  });

  it("reads a word the operator left during a comparison at the next move, and changes nothing in the comparison", async () => {
    const name = `${STEM}-word`;
    // The seed holds fourteen tasks to score once two are released, and a comparison scores six:
    // the row that writes tasks up to the target is tested in `test/decide.test.ts`.
    const terms = ["--practice", "2", "--solves", "1", "--sessions", "1", "--target", "6", "--patience", "2"];
    const flags = [...seeded(name), ...terms];
    const strayed: string[] = [];
    const scriptedSolves = scriptedSeats(
      { held: { old: "none", fresh: "pass" }, starter: "none" },
      GRADED,
      strayed,
    );
    // The operator leaves a stop while the first comparison's first solve runs.
    let left = false;
    const seats: Seats = {
      seated: (campaign, given) => {
        const seat = scriptedSolves(campaign, given);
        return {
          ...seat,
          solve: (task, harness, kill, comparison) => {
            if (comparison !== undefined && !left) {
              left = true;
              wordCommand(["--name", name, "--stop", "enough for today"]);
            }
            return seat.solve(task, harness, kill, comparison);
          },
        };
      },
    };
    const stopped = await harnessBuilder(flags, seats);
    // The comparison ran whole and read what it would have read, and the campaign stopped after it.
    expect(of(name, "comparison.reported")).toMatchObject([
      { session: "g-1", reading: "step", scored: { wins: 6, losses: 0, ties: 0 } },
    ]);
    expect(stopped).toMatchObject({
      move: "end",
      ending: "operator",
      why: "the operator's word: enough for today",
    });
    const log = read(join(REPO, ".ana", "d2", name, LOG_FILE));
    const at = log.findIndex(({ kind }) => kind === "campaign.word");
    expect(log.at(-1)).toMatchObject({ kind: "campaign.ended", data: { ending: "operator", answers: [at] } });
    expect(of(name, MOVED).map(({ move }) => move)).toEqual(["accept", "prepare", "build", "compare"]);

    // Run again, the campaign goes on: the word was heard once. A word for other tasks and one
    // for another total are each acted on at the next move, and named by what acted on them.
    expect(await harnessBuilder([...flags, "--moves", "0"], seats)).toMatchObject({ move: "compare" });
    wordCommand(["--name", name, "--budget", "50"]);
    wordCommand(["--name", name, "--tasks", "the step was too easy"]);
    expect(await harnessBuilder([...flags, "--moves", "0"], seats)).toMatchObject({
      move: "examine",
      why: "the operator asked for other tasks: the step was too easy",
    });
    expect(of(name, OPENED).at(-1)).toMatchObject({ budget: { dollars: 50 } });
    // Two totals left before one boundary: the newest stands there and at the next, and the record
    // answers both, so the older is never applied after it.
    wordCommand(["--name", name, "--budget", "10"]);
    wordCommand(["--name", name, "--budget", "100"]);
    await harnessBuilder([...flags, "--moves", "0"], seats);
    expect(of(name, OPENED).at(-1)).toMatchObject({ budget: { dollars: 100 } });
    await harnessBuilder([...flags, "--moves", "0"], seats);
    expect(of(name, OPENED).at(-1)).toMatchObject({ budget: { dollars: 100 } });
    // No word is left for a campaign that has no opening, and none that names two things.
    expect(() => wordCommand(["--name", `${name}-none`, "--stop", "x"])).toThrow("has no opening on record");
    expect(() => wordCommand(["--name", name, "--stop", "x", "--budget", "5"])).toThrow("one word");
    // The cause of an A/A that read a step is a word too, read where it stands (`decide.ts`).
    expect(wordCommand(["--name", name, "--cause", " the host was loaded "])).toBe("cause");
    expect(of(name, "campaign.word").at(-1)).toEqual({ word: "cause", why: "the host was loaded" });
    expect(strayed).toEqual([]);
  });

  it("goes on with a comparison that began at another margin than the default, under the margin it began with", async () => {
    // A pack whose check program declares an objective, so that the comparison fixes its margin.
    const under = join(root, "objective");
    layOutPack(under, join(under, "bundle"), TASKS, FIXTURE);
    const model = join(under, "bundle", "correctness-model");
    const brief = parseJsonAs<JsonObject>(readFileSync(join(model, "brief.json"), "utf8"));
    const objective = { quantity: "the answer", direction: "lower" };
    writeFileSync(join(model, "brief.json"), JSON.stringify({ ...brief, objective }));
    const evaluator = readFileSync(join(model, "evaluator.ts"), "utf8");
    writeFileSync(
      join(model, "evaluator.ts"),
      `${evaluator}export const objective = (req) => Number(req.artifact.answer);\n`,
    );
    const name = `${STEM}-margin`;
    const flags = [
      ...seeded(name, under).slice(0, -2),
      "--admit",
      "check-product,objective",
      "--practice",
      "2",
      "--solves",
      "1",
      "--sessions",
      "1",
      "--target",
      "6",
      "--margin",
      "0.2",
      "--patience",
      "2",
    ];
    const strayed: string[] = [];
    const scriptedSolves = scriptedSeats(
      { held: { old: "none", fresh: "pass" }, starter: "none" },
      GRADED,
      strayed,
    );
    // The comparison's first solve throws, as a host that failed under it would: the comparison
    // has begun, and the campaign ends on its environment.
    let failed = false;
    const seats: Seats = {
      seated: (campaign, given) => {
        const seat = scriptedSolves(campaign, given);
        return {
          ...seat,
          solve: (task, harness, kill, comparison) => {
            if (comparison !== undefined && !failed) {
              failed = true;
              throw new Error("the host failed under the solve");
            }
            return seat.solve(task, harness, kill, comparison);
          },
        };
      },
    };
    await expect(harnessBuilder(flags, seats)).rejects.toThrow("the host failed under the solve");
    expect(of(name, "comparison.started")).toMatchObject([
      { session: "g-1", objective: { direction: "lower", margin: 0.2 } },
    ]);
    expect(of(name, "campaign.ended")).toMatchObject([{ ending: "environment", move: "compare" }]);
    // Run again, it goes on under the margin it began with, and reads its step.
    await harnessBuilder([...flags, "--moves", "1"], seats);
    expect(of(name, MOVED).at(-1)?.args).toEqual(expect.arrayContaining(["--margin", "0.2"]));
    expect(of(name, "comparison.reported")).toMatchObject([
      { session: "g-1", reading: "step", scored: { wins: 6, losses: 0, ties: 0 } },
    ]);
    // The solves in flight when the host failed were killed, and solved again: no other strayed.
    expect(strayed.filter((line) => !line.includes('"kind":"killed"'))).toEqual([]);
  });

  it("has the tasks changed where the reference left no room, and ends once the Examiner's patience is spent", async () => {
    const name = `${STEM}-budget`;
    const flags = [
      ...seeded(name),
      "--practice",
      "2",
      "--solves",
      "1",
      "--sessions",
      "1",
      "--target",
      "5",
      "--patience",
      "2",
      "--solve-model-turns",
      "8",
    ];
    const strayed: string[] = [];
    // Every harness answers every task, in two of the model's turns: no room at eight. The
    // Examiner holds out nothing, twice, which is the campaign's patience (`spent`, `decide.ts`).
    // Until 11 October the campaign then walked a ladder of shorter budgets (`--ladder`), three
    // more moves here.
    const seats: Seats = {
      seated: scriptedSeats({ held: { old: "pass", fresh: "pass" }, starter: "pass" }, GRADED, strayed),
      examine: (request) =>
        examine({
          ...request,
          // Twice: a first finish while the host has not the tasks it needs is declined once.
          ...scripted([
            ["finish", { note: NOTHING }],
            ["finish", { note: NOTHING }],
          ]),
        }),
    };
    const next = await harnessBuilder([...flags, "--moves", "10"], seats);
    expect(of(name, MOVED).map(({ move, session }) => [move, session ?? null])).toEqual([
      ["accept", null],
      ["prepare", null],
      ["build", "b-1"],
      ["compare", "g-1"],
      ["examine", "x-1"],
      ["examine", "x-2"],
    ]);
    const [first] = of(name, "comparison.reported");
    expect(first).toMatchObject({ reading: "no-step", valid: { old: [0, 5] } });
    expect(first).not.toHaveProperty("budgets");
    expect(of(name, "campaign.setting").map(({ modelTurns }) => modelTurns)).toEqual([8]);
    expect(next).toMatchObject({ move: "end", ending: "no-room" });
    // Another number of the model's turns is another setting, and is refused as every command
    // refuses it: until 11 October the record's stood in for the flag, and it ran at the record's.
    await expect(
      harnessBuilder([...flags.slice(0, -2), "--solve-model-turns", "5", "--moves", "0"], seats),
    ).rejects.toThrow(
      "--solve-model-turns 5 names another setting than the campaign's, which was recorded as --solve-model-turns 8",
    );
    expect(strayed).toEqual([]);
    // `--ladder` is no flag of the campaign's since 11 October.
    await expect(harnessBuilder([...flags, "--ladder", "4,1", "--moves", "0"], seats)).rejects.toThrow(
      "--ladder",
    );
  });
  it("opens from a prompt: drafts its exam, waits for the operator's word on its checks, and reaches a comparison with no file written by hand", async () => {
    const name = `${STEM}-prompt`;
    names.push(name);
    const folder = join(REPO, ".ana", "d2", name);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "seed.json"), `${JSON.stringify({ from: null, events: 0 })}\n`);
    const prompt = "Multiplying a base by six, as a fixture.";
    const solver = ["--solver", "claude/claude-opus-5-5"];
    const terms = ["--practice", "2", "--solves", "1", "--solve-minutes", "8", "--practice-solves", "5"];
    const size = ["--target", "6", "--patience", "2"];
    const flags = ["--name", name, "--project", PROJECT, ...solver, ...terms, ...size];
    const exam = {
      domain: "Fixture products",
      scope: "A task gives a base and asks for six times it.",
      conventions: "The answer is a decimal string without a sign.",
      rules: [
        {
          id: "R1",
          statement: "The answer is the base times six.",
          source: "A fixture: no field states it.",
        },
      ],
      answer_format: FORMAT,
      checks: [{ id: "check-product", rule: "R1", assertion: "The answer is six times the base." }],
      evaluator: `export const checks = {\n  "check-product": (req) => req.artifact.answer === String(req.publicTask.publicInput.base * 6),\n};\n`,
      tasks: TASKS.map(({ family, publicInput, hidden }) => ({ family, public_input: publicInput, hidden })),
      accept_controls: TASKS.map(({ publicInput }, task) => ({
        task,
        answer: { answer: String(publicInput.base * 6) },
      })),
      reject_controls: [{ task: 0, answer: { answer: "13" }, check: "check-product" }],
    };
    // The first draft's reject control is the right answer, which no check refuses.
    const wrong = {
      ...exam,
      reject_controls: [{ task: 0, answer: { answer: "12" }, check: "check-product" }],
    };
    const strayed: string[] = [];
    const examples = TASKS.map(({ publicInput }, index) => ({
      taskId: `ex-${String(index + 1).padStart(3, "0")}`,
      answer: { answer: String(publicInput.base * 6) },
      refusedBy: null,
    }));
    const seats: Seats = {
      seated: scriptedSeats({ held: { old: "none", fresh: "pass" }, starter: "none" }, examples, strayed),
      draft: (request) =>
        examine({
          ...request,
          ...scripted([
            ["draft_exam", wrong],
            ["draft_exam", exam],
          ]),
        }),
    };
    // With no prompt and no pack there is nothing to open, and nothing is written.
    expect(harnessBuilder(["--name", name], seats)).rejects.toThrow("give the prompt it opens from");
    expect(await harnessBuilder([...flags, "--prompt", prompt, "--dry-run"], seats)).toMatchObject({
      move: "draft",
    });
    expect(existsSync(join(folder, LOG_FILE))).toBe(false);

    // A campaign that opens from a prompt has no folder before its opening, which makes one.
    const fresh = `${STEM}-fresh`;
    names.push(fresh);
    expect(existsSync(join(REPO, ".ana", "d2", fresh))).toBe(false);
    const opened = [
      "--name",
      fresh,
      "--project",
      PROJECT,
      "--solver",
      "claude/claude-opus-5-5",
      "--prompt",
      prompt,
      "--patience",
      "1",
      "--moves",
      "0",
    ];
    expect(await harnessBuilder(opened, seats)).toMatchObject({ move: "draft" });
    expect(of(fresh, OPENED)).toMatchObject([{ prompt, project: PROJECT }]);

    // The Examiner drafts, the host reads each draft without a model, and the second stands. Its
    // one check is its author's own computation, so the campaign waits for the operator's word.
    const waits = await harnessBuilder([...flags, "--prompt", prompt], seats);
    expect(waits).toMatchObject({ move: "end", ending: "exam" });
    expect(of(name, OPENED)).toMatchObject([
      {
        prompt,
        solver: { model: "claude/claude-opus-5-5", effort: "high" },
        terms: { practice: "2", solves: "1", "solve-minutes": "8", "practice-solves": "5" },
      },
    ]);
    expect(of(name, "draft.call").map(({ text }) => (isString(text) ? text : "").split("\n")[0])).toEqual([
      "The draft does not stand. 2 faults:",
      "The draft stands: it is the campaign's exam. The session ends here.",
    ]);
    expect(of(name, "draft.finished")).toMatchObject([{ session: "d-1", stands: true, tries: 2 }]);
    expect(of(name, "exam.drafted")).toHaveLength(1);
    expect(of(name, "checker.read").at(-1)?.faults).toEqual([
      "check-product is decided by its author's own computation and no installed instrument: it stands on the operator's word alone (--admit check-product)",
    ]);
    expect(of(name, MOVED).map(({ move, session }) => [move, session ?? null])).toEqual([
      ["draft", "d-1"],
      ["accept", null],
    ]);

    // With that word, by its name alone: the exam is read again, its tasks are set apart, a
    // Builder builds, and the two harnesses are compared on the tasks the draft gave. Every move
    // runs by the terms the campaign was opened with, which this command does not name: the
    // second campaign from a prompt, continued so, ran each by its default (2026-10-09).
    const next = await harnessBuilder(["--name", name, "--admit", "check-product", "--moves", "4"], seats);
    expect(of(name, OPENED)).toHaveLength(1);
    // The Builder session recorded the setting, with the scored tasks the campaign opened with:
    // t-2 (10 October) opened with --target 6 and its first session recorded the default 12.
    expect(of(name, "campaign.setting")).toMatchObject([{ minutes: 8, target: 6 }]);
    expect(of(name, "task.state").filter(({ state }) => state === "released")).toHaveLength(2);
    expect(of(name, "comparison.started")).toMatchObject([{ solves: 1 }]);
    expect(of(name, "comparison.started")[0]?.tasks).toHaveLength(6);
    expect(
      of(name, MOVED)
        .slice(2)
        .map(({ move, session }) => [move, session ?? null]),
    ).toEqual([
      ["accept", null],
      ["prepare", null],
      ["build", "b-1"],
      ["compare", "g-1"],
    ]);
    expect(of(name, "checker.read").at(-1)).toMatchObject({ faults: [], admitted: ["check-product"] });
    expect(of(name, "comparison.reported")).toMatchObject([
      { reading: "step", scored: { wins: 6, losses: 0, ties: 0 } },
    ]);
    expect(next).toMatchObject({ move: "compare" });
    expect(strayed).toEqual([]);

    // A term named again is recorded again, and a flag that names another setting than the
    // campaign's is refused with both.
    await harnessBuilder(["--name", name, "--practice-solves", "3", "--moves", "0"], seats);
    expect(of(name, OPENED).at(-1)).toMatchObject({
      terms: { practice: "2", solves: "1", "solve-minutes": "8", "practice-solves": "3" },
    });
    expect(harnessBuilder(["--name", name, "--solve-minutes", "30", "--moves", "0"], seats)).rejects.toThrow(
      "--solve-minutes 30 names another setting than the campaign's, which was recorded as --solve-minutes 8",
    );
    expect(of(name, OPENED)).toHaveLength(2);
  });

  it("opens a campaign under the project its first command names, keeps it, and refuses another", async () => {
    const name = `${STEM}-project`;
    names.push(name);
    const opening = ["--name", name, "--solver", "claude/claude-opus-5-5", "--prompt", "Six times a base."];
    const seats: Seats = {
      seated: scriptedSeats({ held: { old: "none", fresh: "pass" }, starter: "none" }, [], []),
    };
    // No opening is written without a project, nor under one that is no id.
    await expect(harnessBuilder([...opening, "--moves", "0"], seats)).rejects.toThrow("name --project");
    await expect(harnessBuilder([...opening, "--project", "a/b", "--moves", "0"], seats)).rejects.toThrow(
      "--project a/b: a project is named as v1's were",
    );
    expect(existsSync(join(REPO, ".ana", "d2", name, LOG_FILE))).toBe(false);
    await harnessBuilder([...opening, "--project", PROJECT, "--moves", "0"], seats);
    expect(of(name, OPENED)).toMatchObject([{ project: PROJECT }]);
    // A later run names none and keeps it; one that names another is refused, and writes nothing.
    await harnessBuilder(["--name", name, "--patience", "3", "--moves", "0"], seats);
    expect(of(name, OPENED).map(({ project }) => project)).toEqual([PROJECT, PROJECT]);
    await expect(
      harnessBuilder(["--name", name, "--project", "elsewhere", "--moves", "0"], seats),
    ).rejects.toThrow(`this campaign belongs to project ${PROJECT}, and keeps it`);
    expect(of(name, OPENED)).toHaveLength(2);
  });

  it("hands over a harness's links as links, and leaves nothing where the copy is not the harness", async () => {
    // Until 11 October the handover was copied with every link followed: a link among a kept
    // harness's programs to a host file came out as that file's bytes, in a folder written to leave
    // the host, and a copy that then did not open as the harness stayed where it was written.
    layOutPack(root, bundle, TASKS, FIXTURE);
    const name = `${STEM}-links`;
    // The pack and the campaign's name, which is what the handover takes: no project, no admission.
    const pack = seeded(name).slice(0, -4);
    const host = join(root, "host-file.txt");
    writeFileSync(host, "HOST-FILE-CANARY\n");
    const built = join(root, "linked", "harness");
    cpSync(FIXTURE, built, { recursive: true });
    mkdirSync(join(built, ".toolchain", "bin"), { recursive: true });
    symlinkSync(host, join(built, ".toolchain", "bin", "leak"));
    const kept = await importCommand(["--name", name, "--harness", built]);
    append(join(REPO, ".ana", "d2", name, LOG_FILE), "harness.promoted", { harness: kept.digest });
    const to = join(root, "handover-linked");
    expect(await closeCommand([...pack, "--to", to])).toMatchObject({ harness: kept.digest });
    expect(lstatSync(join(to, "harness", ".toolchain")).isDirectory()).toBe(true);
    expect(readlinkSync(join(to, "harness", ".toolchain", "bin", "leak"))).toBe(host);
    // A guide linked by the kept state's own path opens where it is kept, and not where it is
    // copied to: the copy is refused, and nothing of it stays.
    const guide = join(kept.dir, "agent", "BUILT_AGENTS.md");
    renameSync(guide, join(kept.dir, "agent", "guide.md"));
    symlinkSync(join(kept.dir, "agent", "guide.md"), guide);
    const refused = join(root, "handover-refused");
    await expect(closeCommand([...pack, "--to", refused])).rejects.toThrow(
      "agent/BUILT_AGENTS.md links outside the harness",
    );
    expect(readdirSync(refused)).toEqual([]);
  });
});

describe("a comparison's packet for a person", () => {
  it("holds every rejection that set a task aside, and three earned rejections and three passes drawn by the comparison's id", () => {
    const named = (prefix: string, count: number) =>
      Array.from({ length: count }, (_, index) => `${prefix}-${String(index)}`);
    // Ruled a check defect or unclear, or not ruled: each sets its task aside, so each is read.
    const aside = named("aside", 12);
    const [earned, passed] = [named("earned", 9), named("pass", 9)];
    const packet = packetOf({ aside, others: earned }, passed, "g-1");
    expect(packet.rejections.slice(0, 12)).toEqual(aside);
    const sampled = packet.rejections.slice(12);
    expect(sampled).toHaveLength(3);
    expect(sampled.every((solve) => earned.includes(solve))).toBe(true);
    expect(packet.passes).toHaveLength(3);
    expect(packet.passes.every((solve) => passed.includes(solve))).toBe(true);
    // The same comparison draws the same, whatever order its pools come in; another draws apart.
    expect(packetOf({ aside, others: earned.toReversed() }, passed.toReversed(), "g-1")).toEqual(packet);
    expect(packetOf({ aside, others: earned }, passed, "g-2")).not.toEqual(packet);
    // Fewer than three of a side: all of it.
    expect(packetOf({ aside: [], others: ["e"] }, ["p", "q"], "g-1")).toEqual({
      rejections: ["e"],
      passes: expect.arrayContaining(["p", "q"]),
    });
  });
});
