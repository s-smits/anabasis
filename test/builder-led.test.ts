// The Harness Builder's live controller over a fixture pack. A scripted Builder chooses the
// campaign tools in the same place a paid Builder does; the command never falls back to the old
// move-by-move scheduler for a rehearsal.
// The paid run keeps a Receipt beside its log; these tests use scripted seats and inspect the log.

import { afterAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { supplyOf } from "../src/campaign/admission.ts";
import { crashedRun } from "../src/campaign/ground.ts";
import { pendingWords } from "../src/campaign/word.ts";
import { examine } from "../src/examiner/session.ts";
import { LOG_FILE, type LogEvent, read } from "../src/kernel/log.ts";
import { taskSets } from "../src/kernel/task.ts";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import { isString, type JsonObject } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join, resolve } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { flagsOf, opened, type Seats } from "../tools/d2/campaign-terms.ts";
import { harnessBuilder } from "../tools/d2/harness-builder.ts";
import { HOST } from "../tools/d2/host.ts";
import type { Seated } from "../tools/d2/round.ts";
import { settleCommand } from "../tools/d2/settle.ts";
import { wordCommand } from "../tools/d2/word.ts";
import { scriptedSeats } from "../tools/runs/rehearse.ts";
import { fixtureTasks, gradedOf, layOutPack, type Step, scriptedModel } from "./helpers/fixture-pack.ts";
import { containing } from "./helpers/matchers.ts";

const REPO = resolve(import.meta.dir, "..");
const FIXTURE = join(REPO, "test", "fixtures", "harness-min");
const STEM = `test-hb-${String(runtimeProcess.pid)}`;
const OPENED = "campaign.opened";
const PROJECT = "fixture-products";
const MOVED = "campaign.move";
const CALLED = "build.call";
const FINISHED = "build.finished";
const REPORTED = "comparison.reported";
const EXAMINED = "exam.finished";
const TASKS = fixtureTasks(7);
const GRADED = [
  ...gradedOf(TASKS),
  ...TASKS.map(({ taskId }) => ({ taskId, answer: { answer: "wrong" }, refusedBy: "check-product" })),
];
/** A pack of twelve tasks, where two steps read past the level on held-out tasks. */
const MANY = fixtureTasks(12);
const GRADED_MANY = [
  ...gradedOf(MANY),
  ...MANY.map(({ taskId }) => ({ taskId, answer: { answer: "wrong" }, refusedBy: "check-product" })),
];
const scripted = scriptedModel;
const CHANGE_GUIDE: readonly [string, JsonObject] = [
  "bash",
  { command: `printf '\\nA live Builder change.\\n' >> "$HOME/harness/agent/BUILT_AGENTS.md"` },
];
/** A second change, so that harness/ is another harness than the one a comparison froze. */
const CHANGE_AGAIN: readonly [string, JsonObject] = [
  "bash",
  { command: `printf '\\nA second live change.\\n' >> "$HOME/harness/agent/BUILT_AGENTS.md"` },
];
/** A conversation that follows a script's: it makes no campaign move, and the third such in a row
 *  ends the campaign. Its finish is said twice where finish first gives a notice. */
const FINISH_IDLE: Step = ["finish", { note: "Nothing further." }];
const IDLE: readonly Step[] = [FINISH_IDLE, FINISH_IDLE];

// A paid comparison needs a sweep plus two frontier tasks: five at 0.125, eight at the tree's
// default, 0.02. This suite is of who makes the moves, so it names the level its five tasks are
// admitted and read a step at, and a supply patience of three.
const LEVEL = ["--level", "0.125", "--patience", "3"];
const FLAGS = ["--practice", "2", "--sessions", "1", "--target", "5", ...LEVEL];
const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-hb-")));
const bundle = join(root, "bundle");
const names: string[] = [];

setDefaultTimeout(600_000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  for (const name of names) rmSync(join(REPO, ".ana", "d2", name), { recursive: true, force: true });
});

/** A campaign's folder marked as a seed, and the flags that name its stored pack. */
function seeded(name: string, under = root): string[] {
  names.push(name);
  const folder = join(REPO, ".ana", "d2", name);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "seed.json"), `${JSON.stringify({ from: null, events: 0 })}\n`);
  const pack = ["--root", under, "--sweep", "s", "--cycle", "c01", "--bundle", join(under, "bundle")];
  return [...pack, "--name", name, "--project", PROJECT, "--admit", "check-product"];
}

/** A campaign's log, every event in order. */
const logOf = (name: string): LogEvent[] => read(join(REPO, ".ana", "d2", name, LOG_FILE));

/** Where in a campaign's log each kind, or each Builder call by its tool, first stands. */
const positions = (name: string) => {
  const kinds = logOf(name).map(({ kind, data }) =>
    kind === CALLED && isString(data.tool) ? `${kind}:${data.tool}` : kind,
  );
  return (kind: string) => kinds.indexOf(kind);
};

/** Scripted solves in which the new harness answers each held-out task, and the reference and the
 *  starter none. */
const winning = (graded = GRADED) =>
  scriptedSeats({ held: { old: "none", fresh: "pass" }, starter: "none" }, graded, []);

/** What a campaign's log holds of one kind, in order; with `first`, only in its first Builder
 *  conversation, since each later one may open an Examiner session beside it (16 October). */
const of = (name: string, kind: string, first = false): JsonObject[] => {
  const events = logOf(name);
  const end = first ? events.findIndex((event) => event.kind === FINISHED) : -1;
  return events
    .slice(0, end === -1 ? undefined : end + 1)
    .flatMap((event: LogEvent) => (event.kind === kind ? [event.data] : []));
};

/** A scripted Builder with one script a conversation, in the order the conversations open, and
 *  `rest` in every conversation after them. */
function builderScripts(
  base: Seated,
  scripts: readonly (readonly Step[])[],
  rest: readonly Step[] = [],
): Seated {
  return (campaign, given) => {
    const conversations = read(campaign.log).filter(({ kind }) => kind === "build.started").length;
    return { ...base(campaign, given), builder: scripted(scripts[conversations] ?? rest) };
  };
}

/** Give a scripted Builder the campaign tools it chooses in the live path: its script in the first
 *  conversation, and none in every one after it. Three in a row that make no move end the campaign,
 *  and where the table names tasks each opens on an Examiner session (16 October). */
const builderScript = (base: Seated, calls: readonly Step[]): Seated => builderScripts(base, [calls], IDLE);

/** What the Builder read from each call of `tool`, in order. */
const said = (name: string, tool: string): string[] =>
  of(name, CALLED).flatMap((call) => (call.tool === tool && isString(call.text) ? [call.text] : []));

/** An Examiner's proposal of `count` further instances, each of which task admission holds out. */
const proposing = (count: number, from = 0): readonly [string, JsonObject] => [
  "propose_tasks",
  {
    tasks: Array.from({ length: count }, (_, n) => ({
      family: "fixture",
      public_input: { base: 2, rehearsal_copy: { of: "t-1", n: n + from } },
      hidden: null,
    })),
  },
];

/** An Examiner that holds out six further instances. */
const writer: NonNullable<Seats["examine"]> = (request) =>
  examine({ ...request, ...scripted([proposing(6)]) });

/** An Examiner that holds out nothing: where the reference is left no room, three conversations
 *  in a row without a move have the host ask for tasks (15 October), and none come. */
const unwritten: NonNullable<Seats["examine"]> = (request) =>
  examine({ ...request, ...scripted([FINISH_IDLE, FINISH_IDLE]) });

describe("a campaign run by its live Builder", () => {
  it("lets the Builder ask the Examiner, and keeps the handover filtered", async () => {
    layOutPack(root, bundle, TASKS, FIXTURE);
    const name = `${STEM}-examiner`;
    const asked: { tasks: number; minutes: number | undefined; turns: number; proposals: number }[] = [];
    const seats: Seats = {
      seated: builderScript(winning(), [
        ["examine", {}],
        ["wait", {}],
        ["finish", { note: "The campaign needs more held-out tasks." }],
      ]),
      examine: (request, wall) => {
        const { wanted: tasks, budget, limits } = request;
        asked.push({ tasks, minutes: budget?.minutes, turns: limits.turns, proposals: limits.puts });
        return unwritten(request, wall);
      },
    };
    const terms = ["--patience", "2", "--level", "0.125", "--target", "5", "--practice", "2"];
    const exam = ["--solve-minutes", "7", "--exam-tasks", "4", "--exam-turns", "17", "--exam-proposals", "9"];
    const ending = await harnessBuilder([...seeded(name), ...terms, ...exam], seats);
    // The Builder's session holds out nothing; the table then names another, which opens the next
    // conversation (16 October), and a second session that holds out nothing spends the supply patience of
    // two.
    expect(ending).toMatchObject({ move: "end", ending: "no-room", code: "unshown" });
    expect(asked).toEqual([
      { tasks: 4, minutes: 7, turns: 17, proposals: 9 },
      { tasks: 4, minutes: 7, turns: 17, proposals: 9 },
    ]);
    expect(of(name, MOVED).map(({ move, session }) => [move, session ?? null])).toEqual([
      ["accept", null],
      ["prepare", null],
      // The conversation is on record as it begins, and each move it makes after it.
      ["build", "b-1"],
      ["examine", "x-1"],
      ["build", "b-2"],
      ["examine", "x-2"],
    ]);
    expect(of(name, "exam.started")).toMatchObject([{ limits: { tasks: 4 } }, { limits: { tasks: 4 } }]);
    const events = logOf(name);
    const turn = events.findIndex(({ kind }) => kind === "build.turn");
    const examiner = events.findIndex(({ kind }) => kind === "exam.started");
    expect(turn).toBeGreaterThan(-1);
    expect(turn).toBeLessThan(examiner);
    expect(events[turn]?.data.usage).toBeDefined();
    expect(of(name, FINISHED)).toMatchObject([
      { session: "b-1", ended: "finished" },
      { session: "b-2", ended: "finished" },
    ]);
    expect(of(name, "campaign.ended")).toMatchObject([{ ending: "no-room" }]);
    const examinerCall = of(name, CALLED).find(({ tool }) => tool === "examine");
    // The session writes beside the conversation: the result says so at once, and the facts under
    // it give no move to make while it writes.
    expect(examinerCall?.text).toContain("Examiner session x-1 is writing beside this conversation");
    expect(examinerCall?.text).not.toContain("Suggested action");
    expect(examinerCall?.text).toContain("Campaign facts: 5 held-out tasks, 2 practice tasks.");
    expect(examinerCall?.text).not.toContain("check-product");
    // wait returns once the session beside it has ended, with the campaign's facts.
    const ended = events.findIndex(({ kind, data }) => kind === "exam.finished" && data.session === "x-1");
    const waited = events.findIndex(({ kind, data }) => kind === CALLED && data.tool === "wait");
    expect(ended).toBeGreaterThan(-1);
    expect(waited).toBeGreaterThan(ended);
    expect(events[waited]?.data.text).toContain("Campaign facts:");
  });

  it("keeps the table's code where the Builder compares the latest harness the table names", async () => {
    layOutPack(root, bundle, MANY, FIXTURE);
    const name = `${STEM}-tabled`;
    const tied = scriptedSeats({ held: { old: "pass", fresh: "pass" }, starter: "pass" }, GRADED, []);
    const seats: Seats = {
      seated: builderScript(tied, [
        CHANGE_GUIDE,
        ["compare", {}],
        ["examine", {}],
        ["wait", {}],
        ["compare", {}],
        ["finish", { note: "The latest harness was read on the new tasks." }],
      ]),
      examine: writer,
    };
    await harnessBuilder([...seeded(name), ...FLAGS, "--exam-tasks", "6", "--moves", "10"], seats);
    // The first comparison froze a changed working copy, which no table row names; the second read
    // that same harness, unchanged, on the tasks written since, which is the table's own move.
    // Until 28 October both were logged `asked`.
    const compares = of(name, MOVED).filter(({ move }) => move === "compare");
    expect(compares.map(({ code }) => code)).toEqual(["asked", "unread"]);
    const [first, second] = of(name, REPORTED);
    expect(second?.fresh).toBe(first?.fresh);
  });

  it("makes no second draw of a pair nothing changed in, and records no move for an action it refused", async () => {
    layOutPack(root, bundle, MANY, FIXTURE);
    const name = `${STEM}-unchanged`;
    const tied = scriptedSeats({ held: { old: "pass", fresh: "pass" }, starter: "pass" }, GRADED, []);
    const seats: Seats = {
      seated: builderScript(tied, [
        ["compare", {}],
        ["promote", {}],
        CHANGE_GUIDE,
        ["compare", {}],
        ["compare", {}],
        ["promote", {}],
        ["finish", { note: "Nothing new to compare." }],
      ]),
    };
    expect(await harnessBuilder([...seeded(name), ...FLAGS], seats)).toMatchObject({ ending: "finished" });
    const [untouched, , again] = said(name, "compare");
    expect(untouched).toContain("harness/ is the reference harness: there is nothing to compare");
    expect(again).toContain("nothing in it has changed since: there is nothing new to compare");
    expect(of(name, "comparison.started")).toHaveLength(1);
    expect(of(name, "build.checkpoint")).toHaveLength(1);
    expect(said(name, "promote")[0]).toContain("there is none to promote");
    expect(said(name, "promote")[1]).toContain("Nothing was promoted");
    expect(of(name, MOVED).map(({ move }) => move)).toEqual([
      "accept",
      "prepare",
      "build",
      "compare",
      "build",
      "build",
      "build",
    ]);
  });

  it("requires a Referee for a paid opening, keeps its recorded seat, and permits scripted openings without one", () => {
    const log = join(root, "terms", "reviewer", LOG_FILE);
    const flags = (...more: string[]) =>
      flagsOf(["--root", root, "--name", "terms", "--project", PROJECT, "--budget", "100", ...more]);
    expect(() => opened(log, flags(), "paid")).toThrow("--reviewer");
    expect(read(log)).toEqual([]);
    // A campaign that opens now is led by its Builder, on record.
    expect(opened(log, flags(), "scripted")).toMatchObject({ seats: { reviewer: null }, led: true });
    expect(read(log)[0]?.data).toMatchObject({ led: true });
    expect(() => opened(log, flags(), "paid")).toThrow("--reviewer");
    expect(read(log)).toHaveLength(1);
    const model = "claude/claude-opus-5-5";
    expect(opened(log, flags("--reviewer", model), "paid").seats.reviewer?.model).toBe(model);
    expect(opened(log, flags(), "paid").seats.reviewer?.model).toBe(model);
    expect(read(log)).toHaveLength(2);
  });

  it("starts the campaign's first Examiner session as the conversation opens, where the table names one", async () => {
    layOutPack(root, bundle, TASKS, FIXTURE);
    const name = `${STEM}-first-examiner`;
    const seats: Seats = {
      seated: builderScript(winning(), [["finish", { note: "The Examiner writes; nothing to build yet." }]]),
      examine: writer,
    };
    const args = [
      ...seeded(name),
      "--patience",
      "2",
      "--target",
      "8",
      "--practice",
      "2",
      "--exam-tasks",
      "6",
    ];
    expect(await harnessBuilder(args, seats)).toMatchObject({ move: "end", ending: "finished" });
    // The host made the table's move as the conversation opened, and the Builder asked for none.
    expect(of(name, MOVED).map(({ move, code, session }) => [move, code, session ?? null])).toEqual([
      ["accept", "exam", null],
      ["prepare", "tasks", null],
      ["build", "led", "b-1"],
      ["examine", "tasks", "x-1"],
      // Each later conversation opens on the session the table names (16 October). The script's
      // later sessions propose the same tasks again and crash, which is no move: three such
      // conversations in a row end the campaign.
      ["build", "led", "b-2"],
      ["examine", "unshown", "x-2"],
      ["build", "led", "b-3"],
      ["examine", "unshown", "x-3"],
      ["build", "led", "b-4"],
      ["examine", "unshown", "x-4"],
    ]);
    expect(said(name, "examine")).toEqual([]);
    expect(of(name, EXAMINED)).toMatchObject([
      { session: "x-1" },
      { session: "x-2", ended: "crashed" },
      { session: "x-3", ended: "crashed" },
      { session: "x-4", ended: "crashed" },
    ]);
  });

  it("lets the Builder release practice and practise while the Examiner writes, refuses a second session, and ends the Examiner's first", async () => {
    layOutPack(root, bundle, TASKS, FIXTURE);
    const name = `${STEM}-beside`;
    const log = join(REPO, ".ana", "d2", name, LOG_FILE);
    // The Examiner writes until the Builder has practised and finished.
    const practised = Promise.withResolvers<void>();
    const seats: Seats = {
      seated: builderScript(winning(), [
        ["examine", {}],
        ["examine", {}],
        ["release_practice", {}],
        { wait: async () => ["practice", { tasks: [taskSets(read(log)).released[0] ?? ""] }] },
        {
          wait: async () => {
            practised.resolve();
            return ["finish", { note: "Practised while the Examiner wrote." }];
          },
        },
      ]),
      examine: (request) =>
        examine({
          ...request,
          ...scripted([
            // It writes on past the Builder's finish, which waits for it.
            {
              wait: async () => {
                await practised.promise;
                return await new Promise((settle) => {
                  setTimeout(() => settle(["finish", { note: "Nothing to add." }]), 500);
                });
              },
            },
            ["finish", { note: "Nothing to add." }],
          ]),
        }),
    };
    // Each later conversation opens an Examiner session beside it that holds out none, until the
    // campaign's supply patience of them ends it for want of tasks.
    const ending = await harnessBuilder([...seeded(name), ...FLAGS], seats);
    expect(ending).toMatchObject({ move: "end", ending: "no-room" });
    const at = positions(name);
    // A release spends nothing and goes on beside the session: until 19 October it waited for it,
    // and each of three replicates' Builders waited 1.6 to 2.6 hours with no practice task.
    // Read by its call: a release that takes nothing is answered too, and writes no move.
    const released = at(`${CALLED}:release_practice`);
    expect(released).toBeGreaterThan(at("exam.started"));
    expect(released).toBeLessThan(at(EXAMINED));
    expect(at("exam.started")).toBeLessThan(at(`${CALLED}:practice`));
    expect(at(`${CALLED}:practice`)).toBeLessThan(at(EXAMINED));
    expect(at(EXAMINED)).toBeLessThan(at(FINISHED));
    expect(of(name, EXAMINED)).not.toMatchObject([{ ended: "killed" }]);
    const [first, second] = said(name, "examine");
    expect(first).toContain("Examiner session x-1 is writing");
    expect(second).toContain("Examiner session x-1 is still writing.");
    expect(of(name, "exam.started", true)).toHaveLength(1);
  });

  describe("releases the epoch's practice as task admission holds out tasks", () => {
    // Seven tasks held, three released for a practice of four: the epoch is owed one, which the
    // admission floor of five at 0.125 leaves room for once the frontier holds six.
    const flags = ["--practice", "4", "--sessions", "1", ...LEVEL];
    /** The releases on record between the Examiner session's start and its end. */
    const releasedWhileWriting = (name: string) => {
      const events = logOf(name);
      const started = events.findIndex(({ kind }) => kind === "exam.started");
      const ended = events.findIndex(({ kind }) => kind === EXAMINED);
      return events
        .slice(started, ended)
        .filter(({ kind, data }) => kind === "task.state" && data.state === "released").length;
    };

    it("into the workspace of a Builder in wait, which returns before the session ends", async () => {
      layOutPack(root, bundle, TASKS, FIXTURE);
      const name = `${STEM}-on-hold`;
      // The Examiner proposes once the Builder waits, and finishes once its wait has returned, or at
      // a deadline, where wait returned only with the session's end and the test then fails.
      const waiting = Promise.withResolvers<void>();
      const waited = Promise.withResolvers<void>();
      const seats: Seats = {
        seated: builderScript(winning(), [
          {
            wait: async () => {
              waiting.resolve();
              return ["wait", {}];
            },
          },
          {
            wait: async () => {
              waited.resolve();
              return ["finish", { note: "Practice arrived while the Examiner wrote." }];
            },
          },
        ]),
        examine: (request) =>
          examine({
            ...request,
            ...scripted([
              {
                wait: async () => {
                  await waiting.promise;
                  return proposing(6);
                },
              },
              {
                wait: async () => {
                  await Promise.race([waited.promise, Bun.sleep(20_000)]);
                  return ["finish", { note: "Nothing to add." }];
                },
              },
              ["finish", { note: "Nothing to add." }],
            ]),
          }),
      };
      await harnessBuilder([...seeded(name), ...flags, "--target", "5", "--exam-tasks", "7"], seats);
      const at = positions(name);
      expect(at(`${CALLED}:wait`)).toBeLessThan(at(EXAMINED));
      expect(releasedWhileWriting(name)).toBe(1);
      const [told] = said(name, "wait");
      expect(told).toContain("Campaign facts: 9 held-out tasks, 4 practice tasks.");
      expect(told).toContain("x-1");
      expect(told).not.toContain("check-product");
      expect(of(name, MOVED, true).filter(({ code }) => code === "practice")).toMatchObject([
        {
          move: "prepare",
          why: containing("Examiner session x-1 beside the conversation held a task out"),
        },
      ]);
    });

    it("but none that would leave the frontier short of a sweep at the level", async () => {
      layOutPack(root, bundle, TASKS, FIXTURE);
      const name = `${STEM}-on-hold-sweep`;
      const waiting = Promise.withResolvers<void>();
      const seats: Seats = {
        seated: builderScript(winning(), [
          {
            wait: async () => {
              waiting.resolve();
              return ["wait", {}];
            },
          },
          ["finish", { note: "Nothing was released." }],
        ]),
        // One task held leaves a frontier of five, a sweep's worth and none to spare.
        examine: (request) =>
          examine({
            ...request,
            ...scripted([
              {
                wait: async () => {
                  await waiting.promise;
                  return proposing(1);
                },
              },
              ["finish", { note: "Nothing to add." }],
              ["finish", { note: "Nothing to add." }],
            ]),
          }),
      };
      await harnessBuilder([...seeded(name), ...flags, "--target", "5", "--exam-tasks", "7"], seats);
      const at = positions(name);
      expect(at(`${CALLED}:wait`)).toBeGreaterThan(at(EXAMINED));
      expect(releasedWhileWriting(name)).toBe(0);
      expect(said(name, "wait")[0]).not.toContain("The host released");
      expect(of(name, MOVED, true).filter(({ code }) => code === "practice")).toEqual([]);
    });

    it("after a promotion with the default ask, without changing the final practice count", async () => {
      layOutPack(root, bundle, MANY, FIXTURE);
      const name = `${STEM}-on-hold-promoted`;
      const log = join(REPO, ".ana", "d2", name, LOG_FILE);
      const waiting = Promise.withResolvers<void>();
      const waited = Promise.withResolvers<void>();
      const seats: Seats = {
        seated: builderScript(winning(GRADED_MANY), [
          CHANGE_GUIDE,
          ["compare", {}],
          {
            wait: async () => {
              waiting.resolve();
              return ["wait", {}];
            },
          },
          {
            wait: async () => {
              waited.resolve();
              return ["finish", { note: "Practice arrived in the new epoch." }];
            },
          },
          FINISH_IDLE,
        ]),
        examine: (request) => {
          expect(of(name, "harness.promoted")).toHaveLength(1);
          // One comparison closes no task, so the seven g-1 scored stay on the frontier and the
          // campaign is short of nothing: the session is asked for the command's own default.
          expect(supplyOf(read(log))).toMatchObject({ held: 7, exhausted: 0, released: 2 });
          expect(request.wanted).toBe(12);
          return examine({
            ...request,
            ...scripted([
              {
                wait: async () => {
                  await waiting.promise;
                  return proposing(1);
                },
              },
              ...Array.from({ length: 10 }, (_, n) => proposing(1, n + 1)),
              {
                wait: async () => {
                  // With the old target bound wait returns only after this deadline lets the
                  // Examiner end. Six held tasks already leave room for one practice task.
                  await Promise.race([waited.promise, Bun.sleep(20_000)]);
                  return proposing(1, 11);
                },
              },
            ]),
          });
        },
      };
      await harnessBuilder([...seeded(name), ...FLAGS, "--target", "7", "--moves", "7"], seats);
      const at = positions(name);
      const events = read(log);
      const starterComparison = events.findIndex(
        ({ kind, data }) => kind === "comparison.started" && data.session === "g-2",
      );
      expect(of(name, EXAMINED)[0]?.held).toHaveLength(12);
      expect(
        supplyOf(events.slice(0, starterComparison === -1 ? undefined : starterComparison)),
      ).toMatchObject({
        held: 18,
        released: 4,
      });
      expect(at(`${CALLED}:wait`)).toBeGreaterThan(at("harness.promoted"));
      expect(at(`${CALLED}:wait`)).toBeLessThan(at(EXAMINED));
      expect(releasedWhileWriting(name)).toBeGreaterThanOrEqual(1);
      expect(said(name, "wait")[0]).toContain("4 practice tasks");
    });
  });

  it("tells a Builder finishing on a harness no comparison read so once, with the Examiner session still writing", async () => {
    layOutPack(root, bundle, TASKS, FIXTURE);
    const name = `${STEM}-unread`;
    // buffer-151-haiku, 13 October: the guide changed, an Examiner session asked for, and finish
    // called while it wrote. The Examiner writes until the Builder's second finish.
    const again = Promise.withResolvers<void>();
    const seats: Seats = {
      seated: builderScript(winning(), [
        ["examine", {}],
        CHANGE_GUIDE,
        ["finish", { note: "Changed the guide." }],
        {
          wait: async () => {
            again.resolve();
            return ["finish", { note: "Changed the guide." }];
          },
        },
      ]),
      examine: (request) =>
        examine({
          ...request,
          ...scripted([
            {
              wait: async () => {
                await again.promise;
                return ["finish", { note: "No more tasks." }];
              },
            },
            ["finish", { note: "No more tasks." }],
          ]),
        }),
    };
    expect(await harnessBuilder([...seeded(name), ...FLAGS], seats)).toMatchObject({ move: "end" });
    // The first finish is declined once, saying the harness is unmeasured and naming the Examiner
    // session still writing; the second is taken.
    const finishes = of(name, CALLED).filter(({ tool }) => tool === "finish");
    expect(finishes.slice(0, 2).map(({ isError }) => isError)).toEqual([true, false]);
    const [first, second] = said(name, "finish");
    for (const fact of ["unmeasured", "x-1"]) expect(first).toContain(fact);
    expect(second).not.toContain("unmeasured");
    // The host compares what the Builder left before another conversation opens. Until 15 October
    // three conversations that finished so ended the campaign with no comparison made.
    const [left] = of(name, FINISHED);
    expect(left).toMatchObject({ ended: "finished", changed: true });
    expect(of(name, "comparison.started")[0]).toMatchObject({ fresh: left?.harness });
  });

  it("stops the Examiner writing beside the conversation when the operator's stop halts it", async () => {
    layOutPack(root, bundle, TASKS, FIXTURE);
    const name = `${STEM}-beside-stop`;
    const stopped = Promise.withResolvers<void>();
    const seats: Seats = {
      seated: builderScript(winning(), [
        ["examine", {}],
        {
          wait: async () => {
            wordCommand(["--name", name, "--stop", "the operator stops this run"]);
            stopped.resolve();
            return ["campaign_status", {}];
          },
        },
      ]),
      examine: (request) =>
        examine({
          ...request,
          ...scripted([
            // Its next turn comes after the status read the word and halted the conversation.
            {
              wait: async () => {
                await stopped.promise;
                return await new Promise((settle) => {
                  setTimeout(() => settle(["finish", { note: "Nothing to add." }]), 500);
                });
              },
            },
            ["finish", { note: "Nothing to add." }],
          ]),
        }),
    };
    expect(await harnessBuilder([...seeded(name), ...FLAGS], seats)).toMatchObject({ ending: "operator" });
    expect(of(name, EXAMINED)).toMatchObject([{ session: "x-1", ended: "killed" }]);
    const kinds = logOf(name).map(({ kind }) => kind);
    expect(kinds.indexOf(EXAMINED)).toBeLessThan(kinds.indexOf(FINISHED));
  });

  it("honours a task word during the conversation before allowing another action", async () => {
    layOutPack(root, bundle, TASKS, FIXTURE);
    const name = `${STEM}-live-tasks`;
    let calls = 0;
    const seats: Seats = {
      seated: builderScript(winning(), [
        ["examine", {}],
        ["promote", {}],
        ["examine", {}],
        ["finish", { note: "The operator's task request was honoured." }],
      ]),
      examine: async (request, wall) => {
        const result = await unwritten(request, wall);
        calls += 1;
        if (calls === 1) wordCommand(["--name", name, "--tasks", "other tasks please"]);
        return result;
      },
    };
    const args = [...seeded(name), "--target", "5", "--practice", "2", ...LEVEL];
    expect(await harnessBuilder(args, seats)).toMatchObject({ ending: "no-room" });
    expect(of(name, "exam.started", true)).toHaveLength(2);
    expect(of(name, MOVED, true).filter(({ move }) => move === "examine")).toHaveLength(2);
    expect(of(name, MOVED).some(({ move }) => move === "promote")).toBe(false);
    // The word is the operator's and reaches no seat: the Builder reads what the campaign waits for.
    const waited = of(name, CALLED).find(({ tool }) => tool === "promote")?.text;
    expect(waited).toContain("Other tasks are to be written before another action");
    expect(waited).not.toContain("operator");
    expect(waited).not.toContain("other tasks please");
    expect(pendingWords(logOf(name))).toEqual([]);
  });

  it("uses the last permitted move and refreshes practice without following a Builder's link", async () => {
    layOutPack(root, bundle, TASKS, FIXTURE);
    const name = `${STEM}-last-move`;
    const seats: Seats = {
      seated: builderScript(winning(), [
        [
          "bash",
          {
            command:
              'mkdir -p "$HOME/fixtures/links"; printf LINK-CANARY > "$HOME/fixtures/links/kept.json"; first=$(ls "$HOME/practice" | head -1); ln -sf "$HOME/fixtures/links/kept.json" "$HOME/practice/$first"',
          },
        ],
        // A release that takes nothing is no move, and it lays the practice out again all the same.
        ["release_practice", {}],
        ["bash", { command: 'cat "$HOME/fixtures/links/kept.json"' }],
        ["examine", {}],
        ["finish", { note: "The host's move limit should stop before this call." }],
      ]),
      examine: unwritten,
    };
    await harnessBuilder(
      [...seeded(name), "--target", "5", "--practice", "2", ...LEVEL, "--moves", "3"],
      seats,
    );
    const shells = of(name, CALLED).filter(({ tool }) => tool === "bash");
    expect(shells).toHaveLength(2);
    expect(shells[1]?.text).toContain("LINK-CANARY");
    // The examine is the last permitted move; the conversation is a move that `--moves` does not count.
    expect(of(name, MOVED)).toHaveLength(4);
    expect(of(name, CALLED).some(({ tool }) => tool === "finish")).toBe(false);
  });

  it("keeps one Builder conversation from A to B and then from B to C", async () => {
    layOutPack(root, bundle, MANY, FIXTURE);
    const name = `${STEM}-promote`;
    const strayed: string[] = [];
    const seats: Seats = {
      seated: builderScript(
        scriptedSeats({ held: { old: "none", fresh: "pass" }, starter: "none" }, GRADED_MANY, strayed),
        [
          CHANGE_GUIDE,
          ["compare", {}],
          ["examine", {}],
          CHANGE_GUIDE,
          ["compare", {}],
          // On the harness it last promoted, the first finish is told the run ends there.
          ["finish", { note: "Two harnesses are promoted and measured." }],
          ["finish", { note: "Two harnesses are promoted and measured." }],
        ],
      ),
      // The Builder's session writes tasks for the second step; the second, which the host starts as
      // the second promotion returns (19 October), holds none.
      examine: (request, wall) =>
        of(name, EXAMINED).length > 0
          ? unwritten(request, wall)
          : examine({ ...request, ...scripted([proposing(8)]) }),
    };
    // Each comparison reads five tasks, every one won, which 0.125 admits and calls a step. A
    // campaign opens at 0.125 where it bears one attempt without a gain, and no more.
    const terms = ["--practice", "2", "--sessions", "1", "--target", "5", "--level", "0.125"];
    const ending = await harnessBuilder(
      [...seeded(name), ...terms, "--patience", "1", "--exam-tasks", "6"],
      seats,
    );
    // The second promotion is followed by the Examiner session the table names for the new
    // reference, started by the host in the same conversation (19 October; from 16 October the
    // next conversation opened on it), and that session holds none, which ends the campaign at its
    // patience of one.
    expect(ending).toMatchObject({ move: "end", ending: "no-room" });
    expect(of(name, MOVED).map(({ move }) => move)).toEqual([
      "accept",
      "prepare",
      "build",
      "compare",
      "promote",
      "examine",
      "prepare",
      "compare",
      "promote",
      "examine",
      "prepare",
    ]);
    // The new reference's practice is released by the host as the Examiner session beside the
    // conversation ends: until 21 October only a Builder's own call released any inside one.
    expect(of(name, MOVED).findLast(({ move }) => move === "prepare")).toMatchObject({ code: "practice" });
    const [first, second] = of(name, REPORTED);
    expect(of(name, CALLED).findLast(({ tool }) => tool === "compare")?.text).toContain(
      `Harness ${isString(second?.fresh) ? second.fresh.slice(0, 8) : ""} read a step against the reference, and the host has made it the campaign's reference.`,
    );
    expect(first).toMatchObject({ reading: "step", scored: { wins: 5, losses: 0, ties: 0 } });
    // After the promotion the first epoch's tasks are retained, and two of them are scored beside
    // the five frontier tasks the target names: until 16 October a full frontier took none.
    expect(second).toMatchObject({
      old: first?.fresh,
      reading: "step",
      frontier: { wins: 5, losses: 0, ties: 0 },
      retained: { losses: 0 },
    });
    expect(second?.fresh).not.toBe(first?.fresh);
    expect(of(name, REPORTED)).toHaveLength(2);
    expect(of(name, "harness.promoted")).toHaveLength(2);
    expect(of(name, "build.started")).toHaveLength(1);
    expect(of(name, FINISHED)).toHaveLength(1);
    expect(of(name, "campaign.ended")).toMatchObject([{ ending: "no-room", latest: second?.fresh }]);
    expect(strayed).toEqual([]);
    const campaignCalls = of(name, CALLED).filter(({ tool }) =>
      ["compare", "promote"].includes(isString(tool) ? tool : ""),
    );
    expect(campaignCalls.every(({ text }) => !isString(text) || !text.includes("check-product"))).toBe(true);
    expect(campaignCalls.every(({ text }) => !isString(text) || !text.includes("t-1"))).toBe(true);
  });

  it("resumes an interrupted comparison on its original terms before another conversation opens", async () => {
    layOutPack(root, bundle, TASKS, FIXTURE);
    const name = `${STEM}-resume`;
    const base = winning();
    let cut = true;
    const seats: Seats = {
      seated: (campaign, given) => {
        const by = base(campaign, given);
        return {
          ...by,
          // The conversation cut and the one that resumes it; the next makes no move.
          builder: scripted(
            read(campaign.log).filter(({ kind }) => kind === "build.started").length < 2
              ? [
                  CHANGE_GUIDE,
                  ["compare", {}],
                  ["finish", { note: "The comparison resumed." }],
                  ["finish", { note: "The comparison resumed." }],
                ]
              : IDLE,
          ),
          solve: async (...args) => {
            if (cut) throw new Error("PRIVATE-COMPARISON-FAULT check-product t-1");
            return by.solve(...args);
          },
        };
      },
    };
    // Under a total: a comparison begins with all that is left of it as its cap, so whatever else
    // bills before it goes on, a Builder's turn among it, leaves less than that cap. Until
    // 13 October the tool then ended the campaign on its budget, with nearly all of it left.
    const args = [...seeded(name), "--target", "5", "--practice", "2", "--budget", "20", "--reserve", "0.01"];
    expect(await harnessBuilder(args, seats)).toMatchObject({ ending: "environment" });
    const [start] = of(name, "comparison.started");
    if (start === undefined) throw new Error("the comparison did not record its original terms");
    expect(of(name, REPORTED)).toEqual([]);
    expect(of(name, CALLED).find(({ tool }) => tool === "compare")?.text).not.toContain(
      "PRIVATE-COMPARISON-FAULT",
    );
    cut = false;
    // The host goes on with it as its first move, before a conversation opens: until 15 October
    // that was the Builder's tool alone, refused three times over in main0_5_1 under other code.
    const conversations = of(name, "build.started").length;
    expect(await harnessBuilder([...args, "--moves", "1"], seats)).toMatchObject({ move: "examine" });
    expect(of(name, "build.started")).toHaveLength(conversations);
    expect(of(name, "comparison.started")).toEqual([start]);
    expect(of(name, REPORTED)).toMatchObject([
      { session: start?.session, old: start?.old, fresh: start?.fresh },
    ]);
    expect(of(name, "build.checkpoint")).toHaveLength(1);
  });

  it("keeps admission decisions in the host and leaves dry-run as an advisory reader", async () => {
    layOutPack(root, bundle, TASKS, FIXTURE);
    const name = `${STEM}-dry-run`;
    const seats: Seats = {
      seated: builderScript(winning(), [["finish", { note: "not reached" }]]),
    };
    expect(await harnessBuilder([...seeded(name), "--dry-run"], seats)).toMatchObject({ move: "accept" });
    expect(of(name, OPENED)).toEqual([]);
    expect(await harnessBuilder([...seeded(name), "--moves", "0"], seats)).toMatchObject({ move: "accept" });
    expect(of(name, "build.started")).toEqual([]);
    expect(of(name, "checker.read")).toEqual([]);
    await harnessBuilder([...seeded(name), "--moves", "2"], seats);
    const log = join(REPO, ".ana", "d2", name, LOG_FILE);
    const before = read(log);
    expect(await harnessBuilder([...seeded(name), "--dry-run"], seats)).toMatchObject({ move: "examine" });
    expect(read(log)).toEqual(before);
  });

  it("returns a filtered refusal before an Examiner action starts and lets the Builder finish", async () => {
    layOutPack(root, bundle, TASKS, FIXTURE);
    const name = `${STEM}-examiner-error`;
    const seats: Seats = {
      seated: builderScript(winning(), [
        ["examine", {}],
        ["finish", { note: "The Examiner was refused." }],
      ]),
      examine: () => {
        throw new Error("private examiner failure with check-product and t-1");
      },
    };
    const ending = await harnessBuilder([...seeded(name), "--target", "8", "--practice", "3"], seats);
    expect(ending).toMatchObject({ move: "end", ending: "finished" });
    expect(of(name, "campaign.ended")).toMatchObject([{ ending: "finished" }]);
    const call = of(name, CALLED).find(({ tool }) => tool === "examine");
    expect(call?.text).not.toContain("private examiner failure");
    expect(call?.text).not.toContain("check-product");
    expect(call?.text).not.toContain("t-1");
    // The move is on record as it began, as a host's is; nothing of a session follows it.
    expect(of(name, MOVED).find(({ move }) => move === "examine")).toMatchObject({ session: "x-1" });
    expect(of(name, "exam.started")).toEqual([]);
    expect(call?.text).toContain("choose another action");
  });

  it("waits out a provider limit that ended an action before its first event, and has the Builder ask again", async () => {
    layOutPack(root, bundle, TASKS, FIXTURE);
    const name = `${STEM}-limit`;
    const reset = Math.floor(Date.now() / 1000) + 60;
    // The first session is the host's, as the conversation opens; the limit ends the Builder's.
    let asked = 0;
    const slept: number[] = [];
    const seats: Seats = {
      seated: builderScript(winning(), [
        // A promotion waits for the session writing beside the conversation, and refuses.
        ["promote", {}],
        ["examine", {}],
        ["examine", {}],
        ["finish", { note: "The Examiner was asked again after the limit." }],
      ]),
      examine: (request, wall) => {
        asked += 1;
        if (asked === 2) throw new Error(`Claude Code: usage limit (limit reached|${String(reset)})`);
        return unwritten(request, wall);
      },
      host: {
        ...HOST,
        sleep: async (ms: number) => {
          slept.push(ms);
        },
      },
    };
    const ending = await harnessBuilder([...seeded(name), "--target", "8", "--practice", "3"], seats);
    expect(ending).toMatchObject({ move: "end", ending: "exam", code: "tasks" });
    // Until 13 October a throw with nothing written after its move was read as a refusal before the
    // limit was asked for, and the Builder was told to choose another action.
    expect(slept).toHaveLength(1);
    expect(of(name, "campaign.waited")).toMatchObject([{ for: "provider" }]);
    expect(said(name, "examine")[0]).toContain("call examine again");
    expect(said(name, "examine")[0]).not.toContain("usage limit");
    expect(of(name, "exam.started", true)).toHaveLength(2);
  });

  it("writes blind labels for rejected comparison answers", async () => {
    layOutPack(root, bundle, TASKS, FIXTURE);
    const name = `${STEM}-settle`;
    const args = seeded(name);
    const pack = args.slice(0, -4);
    const seats: Seats = {
      seated: builderScript(
        scriptedSeats({ held: { old: "fail", fresh: "pass" }, starter: "none" }, GRADED, []),
        [
          CHANGE_GUIDE,
          ["compare", {}],
          ["finish", { note: "The failed answers need a person's blind label." }],
        ],
      ),
      examine: unwritten,
    };
    // The comparison is the third move, and the packet needs nothing after it.
    await harnessBuilder([...args, "--sessions", "1", "--target", "5", "--moves", "4"], seats);
    expect(await settleCommand([...pack, "--session", "g-1"])).toBe(0);
    // The reference failed every task, so rejections are drawn, and no drawn answer names either harness.
    const folder = join(REPO, ".ana", "d2", name, "settle-g-1");
    const labels = readFileSync(join(folder, "labels.json"), "utf8");
    const drawn = Object.keys(parseJsonAs<{ rejections: JsonObject }>(labels).rejections);
    expect(drawn.length).toBeGreaterThan(0);
    const [started] = of(name, "comparison.started");
    const sides = [started?.old, started?.fresh].filter(isString);
    expect(sides).toHaveLength(2);
    for (const solve of drawn) {
      const packet = readFileSync(join(folder, `${solve}.json`), "utf8");
      for (const side of sides) expect(packet).not.toContain(side);
    }
  });
});

describe("a campaign tool where the table names more than the action", () => {
  const passing = () => winning(GRADED_MANY);

  it("reads the starter against a promoted reference while harness/ is that reference", async () => {
    layOutPack(root, bundle, MANY, FIXTURE);
    const name = `${STEM}-control`;
    const seats: Seats = {
      seated: builderScript(passing(), [
        CHANGE_GUIDE,
        ["compare", {}],
        ["examine", {}],
        ["compare", {}],
        // On the harness it promoted, a finish is told the table's next move, and a second one ends
        // the conversation.
        ["finish", { note: "The control was read." }],
        ["finish", { note: "The control was read." }],
      ]),
      examine: writer,
    };
    // The starter comparison reads the tasks x-1 wrote beside retained ones; the promoted harness answers
    // none of them while a valid answer to each is on record, which is room, so the table builds.
    await harnessBuilder([...seeded(name), ...FLAGS, "--exam-tasks", "6", "--moves", "8"], seats);
    const [first, starterComparison] = of(name, REPORTED);
    // The table's starter comparison, as it names it: until 12 October the tool froze harness/, which was the
    // reference, the comparison was refused, and the advice stayed the same.
    expect(starterComparison).toMatchObject({ fresh: first?.old, old: first?.fresh });
    expect(of(name, "build.checkpoint")).toHaveLength(1);
    expect(said(name, "compare")[1]).toContain("the starter harness was read against it");
    // The new reference's practice is released by the host as x-1 ends, before the starter comparison, and
    // after the starter comparison the table builds.
    expect(
      of(name, MOVED)
        .slice(6, 9)
        .map(({ move, code }) => [move, code]),
    ).toEqual([
      ["prepare", "practice"],
      ["compare", "unread"],
      ["build", "led"],
    ]);
    // buffer-149, 14 October: its Builder finished on the harness just promoted, and the climb
    // stopped at one step while the table named a move.
    const [stopped, closing] = said(name, "finish");
    expect(stopped).toContain("Not finished. harness/ is the harness last promoted,");
    expect(closing).not.toContain("harness last promoted");
    expect(of(name, FINISHED)[0]).toMatchObject({ session: "b-1", ended: "finished" });
  });

  it("promotes the harness each step froze as it reports, whatever harness/ holds since, and records the Builder's comparison of a changed harness/ as its own where the table named the starter comparison", async () => {
    layOutPack(root, bundle, MANY, FIXTURE);
    const name = `${STEM}-asked`;
    const seats: Seats = {
      seated: builderScript(passing(), [
        CHANGE_GUIDE,
        ["compare", {}],
        // The promoted harness closed the tasks it was read on: the next step is read on new ones.
        ["examine", {}],
        CHANGE_AGAIN,
        ["compare", {}],
        ["promote", {}],
        ["finish", { note: "The change was read." }],
        ["finish", { note: "The change was read." }],
      ]),
      examine: writer,
    };
    await harnessBuilder([...seeded(name), ...FLAGS, "--exam-tasks", "6", "--moves", "10"], seats);
    const [first, second] = of(name, REPORTED);
    const snapshots = of(name, "build.checkpoint");
    // One reading of a step promotes the harness it froze (19 October): until then a step was read
    // again on fresh solves before anything was promoted.
    expect(first).toMatchObject({ reading: "step" });
    expect(snapshots[0]).toMatchObject({ harness: first?.fresh });
    const [told] = said(name, "compare");
    expect(told).toContain("and the host has made it the campaign's reference");
    // Beside it, what the host spent and counts: until 14 October the last tally alone.
    expect(told).toMatch(/Comparison g-1 took \d+ minutes? and billed \d+\.\d\d dollars\./);
    expect(told).toContain("Moves without a gain since the last step: 0 of the patience's ");
    // The changed working copy is what was measured, not the starter the table named, and it is
    // read against the promoted harness.
    expect(second).toMatchObject({ old: first?.fresh, fresh: snapshots[1]?.harness });
    expect(second?.fresh).not.toBe(first?.fresh);
    // Each step is promoted as it reports, so the Builder's own call finds nothing to promote:
    // until 12 October the tool named the last harness frozen.
    expect(of(name, "harness.promoted")).toMatchObject([
      { harness: first?.fresh },
      { harness: second?.fresh },
    ]);
    expect(said(name, "promote")[0]).toContain("Nothing was promoted");
    const moves = of(name, MOVED);
    const compares = moves.filter(({ move }) => move === "compare");
    // Each of the Builder's comparisons measured its working copy, and is recorded as asked. What a
    // move records: the comparison's id and flags, and the harness a promotion named. The host's
    // load is each solve's (`solve.started`), and a move holds none of its own.
    expect(compares.map(({ code }) => code)).toEqual(["asked", "asked"]);
    expect(compares[0]?.session).toBe("g-1");
    for (const move of compares) {
      expect(move).not.toHaveProperty("load");
      expect(move.args).toContain("--level");
    }
    expect(moves.find(({ move }) => move === "promote")).toMatchObject({
      harness: first?.fresh,
      code: "step",
    });
    // r3, 19 October: g-3 and g-6 kept the starter comparison's code and reason while measuring a harness
    // snapshot.
    expect(compares[1]?.why).toContain("where the table named a comparison of the starter harness");
  });

  /** Everything the Builder read from its tools in a campaign whose two comparisons tied the
   *  tasks `ties` names, by comparison, as the nth tasks that comparison solved or by id, with the
   *  host's clock taken out. Three ties of five keep each reading below a step at the suite's level. */
  const read_ = async (
    name: string,
    ties: Readonly<Record<string, readonly (number | string)[]>>,
    flags: readonly string[] = FLAGS,
  ): Promise<string> => {
    const answering = passing();
    const seen = new Map<string, string[]>();
    const nth = (comparison: string, task: string) => {
      const solved = seen.get(comparison) ?? [];
      if (!solved.includes(task)) solved.push(task);
      seen.set(comparison, solved);
      return solved.indexOf(task);
    };
    const silent = scriptedSeats({ held: { old: "none", fresh: "none" }, starter: "none" }, GRADED, []);
    const base: Seated = (campaign, given) => {
      const [won, tie] = [answering(campaign, given), silent(campaign, given)];
      return {
        ...won,
        solve: (task, harness, kill, comparison) =>
          ([nth(comparison ?? "", task.taskId), task.taskId].some(
            (key) => ties[comparison ?? ""]?.includes(key) === true,
          )
            ? tie
            : won
          ).solve(task, harness, kill, comparison),
      };
    };
    const seats: Seats = {
      seated: builderScript(base, [
        CHANGE_GUIDE,
        ["compare", {}],
        CHANGE_AGAIN,
        ["compare", {}],
        ["campaign_status", {}],
        ["read_opening", {}],
        ["finish", { note: "Read two harnesses." }],
        ["finish", { note: "Read two harnesses." }],
      ]),
    };
    expect(await harnessBuilder([...seeded(name), ...flags], seats)).toMatchObject({ ending: "finished" });
    expect(of(name, REPORTED).map(({ scored }) => scored)).toMatchObject(
      ["g-1", "g-2"].map((comparison) => ({ wins: 2, losses: 0, ties: ties[comparison]?.length })),
    );
    // The campaign's facts end each campaign tool's result once, and no other tool's.
    const facts = of(name, CALLED).map(({ tool, text }) => ({
      campaign: tool === "compare" || tool === "campaign_status",
      count: isString(text) ? text.split("Campaign facts:").length - 1 : 0,
    }));
    expect(facts.length).toBeGreaterThan(4);
    for (const { campaign, count } of facts) expect(count).toBe(campaign ? 1 : 0);
    return (
      of(name, CALLED)
        .map(({ tool, text }) => `${isString(tool) ? tool : ""}: ${isString(text) ? text : ""}`)
        .join("\n")
        .replaceAll(/\d+:\d\d of/gu, "0:00 of")
        // A comparison's minutes are the host's clock: on 14 October CI read one campaign's g-1 at
        // 0 minutes and the other's at 1, the same tally under a busier host.
        .replaceAll(/took \d+ minutes?/gu, "took 0 minutes")
    );
  };

  it("tells the Builder the same whichever held-out task was won", async () => {
    layOutPack(root, bundle, MANY, FIXTURE);
    // The two campaigns tie other tasks in each comparison, and the tallies are the same. Until
    // 12 October the status counted the tasks waiting for a label and the exhausted ones, and two
    // such campaigns read differently (rule 3).
    const same = await read_(`${STEM}-won-one`, { "g-1": [0, 1, 2], "g-2": [0, 1, 2] });
    const moved = await read_(`${STEM}-won-other`, { "g-1": [1, 2, 3], "g-2": [2, 3, 4] });
    expect(moved).toBe(same);
    expect(same).toContain("2 won, 0 lost, 3 tied");
    expect(same).toContain("Comparison g-2 took 0 minutes and billed");
  });

  it("tells the Builder the same whichever held-out task was won where the frontier falls below the target", async () => {
    layOutPack(root, bundle, MANY, FIXTURE);
    // A task no side answered in two comparisons waits for a label and leaves the frontier. Here
    // the candidate's g-2 win takes the first task out of that wait or leaves it in, so the count a
    // comparison would score differs unless no harness but the reference decides it (rule 3).
    // The stored sweep accepted no answer, so no held-out task holds a valid answer on record
    // before a comparison gives it one.
    const grades = join(root, "grades", "s", "grades.tsv");
    writeFileSync(grades, readFileSync(grades, "utf8").replaceAll("verified-pass", "verified-fail"));
    const flags = [...FLAGS.slice(0, -LEVEL.length - 2), "--target", "8", ...LEVEL];
    // The comparisons draw t-2, t-4, t-6, t-8 to t-12. Each ties six and the candidate wins two; in
    // the second campaign g-2 wins t-2 in place of t-11.
    const tied = ["t-2", "t-4", "t-6", "t-8", "t-9", "t-10"];
    const same = await read_(`${STEM}-short-one`, { "g-1": tied, "g-2": tied }, flags);
    const moved = await read_(
      `${STEM}-short-other`,
      { "g-1": tied, "g-2": [...tied.slice(1), "t-11"] },
      flags,
    );
    const awaiting = ["one", "other"].map((world) => supplyOf(logOf(`${STEM}-short-${world}`)).awaiting);
    // Until 31 October a candidate's pass took a task out of the wait: 6 and 5 waited, and the
    // first campaign's Builder was told to examine where the second's was told to build.
    expect(awaiting).toEqual([8, 8]);
    expect(same).toContain("2 won, 0 lost, 6 tied");
    expect(moved).toBe(same);
  });
});

describe("a campaign's endings", () => {
  // Both harnesses pass: no reading reads a step that the host would promote after a `finish`.
  const passing = () => scriptedSeats({ held: { old: "pass", fresh: "pass" }, starter: "none" }, GRADED, []);
  // Neither answers: a Builder that practises fails, so the table names a build and no Examiner
  // session opens beside the next conversation (16 October).
  const failing = () => scriptedSeats({ held: { old: "none", fresh: "none" }, starter: "none" }, GRADED, []);
  /** A practice solve of the campaign's first released task, by its id. */
  const practise = (name: string): Step => ({
    wait: async () => {
      const [version] = taskSets(logOf(name)).released;
      const id = of(name, "task.proposed").find((task) => task.version === version)?.taskId;
      return ["practice", { tasks: [isString(id) ? id : ""] }];
    },
  });

  it("ends on its supply patience of readings with no room inside a live conversation", async () => {
    layOutPack(root, bundle, TASKS, FIXTURE);
    const name = `${STEM}-roomless-live`;
    const asking: Step[] = [
      ["examine", {}],
      ["wait", {}],
    ];
    const seats: Seats = {
      seated: builderScript(passing(), [CHANGE_GUIDE, ["compare", {}], ...asking, ...asking, ...asking]),
      examine: unwritten,
    };
    // g-1 closes every task it reads, and two Examiner sessions that hold out none spend a supply patience
    // of two: the conversation that asked for them is halted there. Until 22 October that ending
    // was advice while a conversation lived, and the conversation bought a third session (the job
    // campaign of 22 October started x-9 after six).
    expect(await harnessBuilder([...seeded(name), ...FLAGS, "--patience", "2"], seats)).toMatchObject({
      move: "end",
      ending: "no-room",
    });
    expect(of(name, EXAMINED)).toMatchObject([{ held: [] }, { held: [] }]);
    expect(of(name, MOVED).filter(({ move }) => move === "examine")).toHaveLength(2);
    expect(of(name, "campaign.ended")).toMatchObject([{ ending: "no-room" }]);
  });

  it("opens a new conversation where one ended at its turns, and goes on to a typed ending", async () => {
    layOutPack(root, bundle, TASKS, FIXTURE);
    const name = `${STEM}-turns`;
    const seats: Seats = {
      seated: builderScripts(passing(), [
        [CHANGE_GUIDE, CHANGE_AGAIN, CHANGE_GUIDE],
        [
          ["compare", {}],
          ["finish", { note: "The harness the first conversation left was measured." }],
        ],
        IDLE,
        IDLE,
        IDLE,
      ]),
      examine: unwritten,
    };
    // Until 12 October the command returned the table's next move there and wrote no ending. g-1
    // closes every task it read (15 October), so b-2 opens on the campaign's first Examiner
    // session and b-3 on the next (16 October; until then three conversations came first): two
    // sessions that hold out none spend a supply patience of two.
    expect(
      await harnessBuilder([...seeded(name), ...FLAGS, "--turns", "3", "--patience", "2"], seats),
    ).toMatchObject({ move: "end", ending: "no-room" });
    expect(of(name, FINISHED).map(({ session, ended }) => [session, ended])).toEqual([
      ["b-1", "turns"],
      ["b-2", "finished"],
      ["b-3", "finished"],
    ]);
    expect(of(name, REPORTED)).toMatchObject([{ fresh: of(name, FINISHED)[0]?.harness }]);
    expect(of(name, EXAMINED)).toMatchObject([{ held: [] }, { held: [] }]);
    expect(of(name, "campaign.ended")).toMatchObject([{ ending: "no-room" }]);
    // Three conversations in a row that end at their limits with no campaign move end it too, and
    // the third is told of the two before it. Until 14 October only the budget ended such a run.
    const editing = `${STEM}-turns-idle`;
    const status: Step = ["campaign_status", {}];
    const limited = [practise(editing), status, status];
    const edits: Seats = {
      seated: builderScripts(failing(), [limited, limited, limited]),
      examine: unwritten,
    };
    // Three sessions that fail their practice and change nothing are three moves towards the
    // patience, so it is four here, at six tasks; one practice task leaves the seed's seven six to
    // score.
    const longer = ["--turns", "3", "--practice", "1", "--target", "6", "--patience", "4"];
    expect(await harnessBuilder([...seeded(editing), ...FLAGS, ...longer], edits)).toMatchObject({
      move: "end",
      ending: "finished",
    });
    expect(of(editing, FINISHED).map(({ ended }) => ended)).toEqual(["turns", "turns", "turns"]);
    const told = said(editing, "campaign_status");
    expect(told[1]).not.toContain("made no campaign move");
    expect(told[3]).toContain("The conversation before this one made no campaign move.");
    expect(told[5]).toContain("The 2 conversations before this one made no campaign move.");
  });

  it("opens a new conversation where the provider failed one, and ends on the environment where they fail in a row", async () => {
    layOutPack(root, bundle, TASKS, FIXTURE);
    const name = `${STEM}-crashed`;
    // A script with no further call is a turn the provider fails: the session is on record as
    // crashed, and read back it is refused (`spent`).
    const seats: Seats = {
      seated: builderScripts(passing(), [
        [CHANGE_GUIDE],
        [
          ["compare", {}],
          ["finish", { note: "The harness the crashed conversation left was measured." }],
        ],
        IDLE,
        IDLE,
      ]),
    };
    // Until 13 October the refusal was the environment's ending, and the command threw. A crashed
    // conversation left no harness, so b-2's compare has nothing to read, and the three after b-1
    // make no campaign move: the provider's failure is no conversation idle (since 15 October).
    expect(await harnessBuilder([...seeded(name), ...FLAGS], seats)).toMatchObject({ ending: "finished" });
    expect(of(name, FINISHED).map(({ session, ended }) => [session, ended])).toEqual([
      ["b-1", "crashed"],
      ["b-2", "finished"],
      ["b-3", "finished"],
      ["b-4", "finished"],
    ]);
    expect(of(name, "campaign.ended")).toMatchObject([{ ending: "finished" }]);
    // None of three conversations changed a harness: the table's crash rule ends the campaign.
    const crashing = `${STEM}-crashes`;
    const none: Seats = { seated: builderScripts(passing(), []) };
    expect(await harnessBuilder([...seeded(crashing), ...FLAGS], none)).toMatchObject({
      move: "end",
      ending: "environment",
    });
    expect(of(crashing, FINISHED).map(({ ended }) => ended)).toEqual(["crashed", "crashed", "crashed"]);
    // Nor does a conversation that edited and then crashed leave a harness to go on from.
    const editing = `${STEM}-edits`;
    const edits: Seats = {
      seated: builderScripts(passing(), [[CHANGE_GUIDE], [CHANGE_GUIDE], [CHANGE_GUIDE]]),
    };
    expect(await harnessBuilder([...seeded(editing), ...FLAGS], edits)).toMatchObject({
      move: "end",
      ending: "environment",
    });
    expect(of(editing, FINISHED)).toHaveLength(3);
  });

  it("ends on the environment, on record, where three Examiner sessions crash while the Builder lives", async () => {
    layOutPack(root, bundle, TASKS, FIXTURE);
    const name = `${STEM}-halted`;
    // A promotion waits for the Examiner writing beside it, so each examine starts a session.
    const waits: Step = ["promote", {}];
    const seats: Seats = {
      seated: builderScript(winning(), [
        ["examine", {}],
        waits,
        ["examine", {}],
        waits,
        ["examine", {}],
        waits,
        ["finish", { note: "Not reached: the host halts this conversation." }],
      ]),
      // A script with no call is a turn the provider fails: each session is on record as crashed.
      examine: (request) => examine({ ...request, ...scripted([]) }),
    };
    expect(await harnessBuilder([...seeded(name), "--target", "8", "--practice", "3"], seats)).toMatchObject({
      move: "end",
      ending: "environment",
    });
    // Until 14 October the halted Builder read as a whole session, the crash count went back to
    // nought, and the command returned with no ending on record.
    expect(of(name, EXAMINED).map(({ ended }) => ended)).toEqual(["crashed", "crashed", "crashed"]);
    expect(of(name, FINISHED).map(({ ended }) => ended)).toEqual(["stopped"]);
    expect(of(name, "campaign.ended")).toMatchObject([{ ending: "environment" }]);
    // Three in a row stand up to the ending, which starts the count again for a run by its name.
    const events = logOf(name);
    const end = events.findIndex(({ kind }) => kind === "campaign.ended");
    expect(crashedRun(events.slice(0, end)).count).toBe(3);
  });
});
