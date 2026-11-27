import { afterAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { supplyOf } from "../src/campaign/admission.ts";
import { nextAction } from "../src/campaign/scheduler.ts";
import { crashedRun } from "../src/campaign/state.ts";
import { short } from "../src/campaign/move.ts";
import { pendingSignals } from "../src/campaign/signal.ts";
import { examine } from "../src/examiner/session.ts";
import { append, LOG_FILE, type LogEvent, read } from "../src/kernel/log.ts";
import { sizeLines } from "../src/kernel/size.ts";
import { taskSets } from "../src/kernel/task.ts";
import {
  cpSync,
  existsSync,
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
import { type CampaignContext, releasePendingPractice } from "../tools/campaign/campaign-actions.ts";
import { openCampaign, packNamed } from "../tools/campaign/campaign.ts";
import { flagsOf, opened, type Seats, turnOf } from "../tools/campaign/campaign-terms.ts";
import { harnessBuilder } from "../tools/campaign/harness-builder.ts";
import { HOST } from "../tools/campaign/host.ts";
import type { Seated } from "../tools/campaign/round.ts";
import { settleCommand } from "../tools/campaign/settle.ts";
import { wordCommand } from "../tools/campaign/signal.ts";
import { scriptedSeats } from "../tools/runs/rehearse.ts";
import {
  type FixtureTask,
  fixtureTasks,
  gradedOf,
  layOutPack,
  OPENED_FROM,
  type Step,
  scriptedModel,
} from "./helpers/fixture-pack.ts";
import { containing } from "./helpers/matchers.ts";

const REPO = resolve(import.meta.dir, "..");
const STEM = `test-bl-${String(runtimeProcess.pid)}`;
const OPENED = "campaign.opened";
const PROJECT = "fixture-products";
const MOVED = "campaign.move";
const CALLED = "build.call";
const FINISHED = "build.finished";
const REPORTED = "comparison.reported";
const COMPARED = "comparison.started";
const EXAMINED = "exam.finished";
const EXAM_STARTED = "exam.started";
const TASKS = fixtureTasks(7);
const GRADED = [
  ...gradedOf(TASKS),
  ...TASKS.map(({ taskId }) => ({ taskId, answer: { answer: "wrong" }, refusedBy: "check-product" })),
];
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
const CHANGE_AGAIN: readonly [string, JsonObject] = [
  "bash",
  { command: `printf '\\nA second live change.\\n' >> "$HOME/harness/agent/BUILT_AGENTS.md"` },
];
const FINISH_IDLE: Step = ["finish", { note: "Nothing further." }];
const IDLE: readonly Step[] = [FINISH_IDLE, FINISH_IDLE];
const LEVEL = ["--level", "0.125", "--patience", "3"];
const FLAGS = ["--practice", "2", "--target", "5", ...LEVEL];
const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-hb-")));
const names: string[] = [];
const preparedTemplates = new Map<readonly FixtureTask[], Promise<string>>();

setDefaultTimeout(600_000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  for (const name of names) rmSync(join(REPO, ".ana", "d2", name), { recursive: true, force: true });
});

function seeded(name: string, tasks: readonly FixtureTask[] = TASKS, answered?: number): string[] {
  names.push(name);
  const folder = join(REPO, ".ana", "d2", name);
  if (!existsSync(join(folder, LOG_FILE))) layOutPack(folder, tasks, answered);
  writeFileSync(join(folder, "seed.json"), `${JSON.stringify({ from: null, events: 0 })}\n`);
  return ["--name", name, "--project", PROJECT, ...OPENED_FROM, "--admit", "check-product"];
}

async function prepared(name: string, tasks: readonly FixtureTask[] = TASKS): Promise<string[]> {
  let ready = preparedTemplates.get(tasks);
  if (ready === undefined) {
    const template = `${STEM}-tpl-${String(tasks.length)}`;
    ready = harnessBuilder([...seeded(template, tasks), ...FLAGS, "--moves", "2"], {
      seated: winning(tasks === MANY ? GRADED_MANY : GRADED),
    }).then(() => join(REPO, ".ana", "d2", template));
    preparedTemplates.set(tasks, ready);
  }
  names.push(name);
  cpSync(await ready, join(REPO, ".ana", "d2", name), { recursive: true });
  return ["--name", name, "--project", PROJECT, ...OPENED_FROM, "--admit", "check-product"];
}

const logOf = (name: string): LogEvent[] => read(join(REPO, ".ana", "d2", name, LOG_FILE));

const positions = (name: string) => {
  const kinds = logOf(name).map(({ kind, data }) =>
    kind === CALLED && isString(data.tool) ? `${kind}:${data.tool}` : kind,
  );
  return (kind: string) => kinds.indexOf(kind);
};

const winning = (graded = GRADED) =>
  scriptedSeats({ held: { old: "none", fresh: "pass" }, starter: "none" }, graded, []);

function confirming(graded = GRADED_MANY, strayed: string[] = []): Seated {
  const candidate = scriptedSeats({ held: { old: "none", fresh: "pass" }, starter: "none" }, graded, strayed);
  const starterBeat = scriptedSeats(
    { held: { old: "pass", fresh: "none" }, starter: "none" },
    graded,
    strayed,
  );
  return (campaign, given) => {
    const base = candidate(campaign, given);
    const beat = starterBeat(campaign, given);
    const kept = new Map<string, string>();
    return {
      ...base,
      solve: async (task, harness, kill, comparison) => {
        const started = read(campaign.log).findLast(
          ({ kind, data }) => kind === COMPARED && data.session === comparison,
        )?.data;
        const isStarterRead =
          isString(started?.starter) && started.fresh === started.starter && started.old !== started.starter;
        if (!isStarterRead || comparison === undefined) {
          return await base.solve(task, harness, kill, comparison);
        }
        const skipped = kept.get(comparison) ?? task.taskId;
        kept.set(comparison, skipped);
        return task.taskId === skipped
          ? await base.solve(task, harness, kill, comparison)
          : await beat.solve(task, harness, kill, comparison);
      },
    };
  };
}

const of = (name: string, kind: string, first = false): JsonObject[] => {
  const events = logOf(name);
  const end = first ? events.findIndex((event) => event.kind === FINISHED) : -1;
  return events
    .slice(0, end === -1 ? undefined : end + 1)
    .flatMap((event: LogEvent) => (event.kind === kind ? [event.data] : []));
};

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

const builderScript = (base: Seated, calls: readonly Step[]): Seated => builderScripts(base, [calls], IDLE);

const said = (name: string, tool: string): string[] =>
  of(name, CALLED).flatMap((call) => (call.tool === tool && isString(call.text) ? [call.text] : []));

const proposing = (count: number, from = 0): readonly [string, JsonObject] => [
  "propose_tasks",
  {
    tasks: Array.from({ length: count }, (_, n) => ({
      family: "fixture",
      public_input: { base: 2, rehearsal_copy: { of: "ex-001", n: n + from } },
      hidden: null,
    })),
  },
];

const writer: NonNullable<Seats["examine"]> = (request) =>
  examine({ ...request, ...scripted([proposing(6)]) });

const unwritten: NonNullable<Seats["examine"]> = (request) =>
  examine({ ...request, ...scripted([FINISH_IDLE, FINISH_IDLE]) });

describe.concurrent("the host's practice release", () => {
  const owing = async (name: string): Promise<CampaignContext> => {
    const flags = [...(await prepared(name, MANY)), ...FLAGS];
    const seats: Seats = { seated: winning(GRADED_MANY) };
    const log = join(REPO, ".ana", "d2", name, LOG_FILE);
    const values = flagsOf([...flags, "--practice", "4"]);
    return {
      log,
      values,
      opening: opened(log, values, "scripted"),
      seats,
      held: seats.seated,
      campaign: await openCampaign(packNamed(values)),
      paid: "scripted",
      maxMoves: 12,
      used: 0,
      began: 0,
      failed: null,
    };
  };
  const released = ({ log }: CampaignContext) => taskSets(read(log)).released.length;

  it("aborts practice release if a comparison draws concurrently, and deduplicates parallel callers", async () => {
    const raced = await owing(`${STEM}-release-raced`);
    const releasing = releasePendingPractice(raced, "the race under test");
    append(raced.log, COMPARED, { session: "g-1", old: "start", fresh: "h1" });
    expect(await releasing).toBe(false);
    expect(released(raced)).toBe(2);
    expect(raced.used).toBe(0);

    const name = `${STEM}-release-twice`;
    const twice = await owing(name);
    const asked = await Promise.all([
      releasePendingPractice(twice, "the first cause"),
      releasePendingPractice(twice, "the second cause"),
    ]);
    expect(asked).toEqual([true, false]);
    expect(released(twice)).toBe(4);
    expect(twice.used).toBe(1);
    expect(of(name, MOVED, true).filter(({ code }) => code === "practice")).toHaveLength(1);

    const moveOf = (ctx: CampaignContext) => {
      const turn = turnOf(ctx);
      return nextAction(turn.events, turn.plan).move;
    };
    const toPromote = await owing(`${STEM}-release-promote`);
    append(toPromote.log, "comparison.started", { session: "g-p", old: "s", fresh: "h1", starter: "s" });
    append(toPromote.log, "comparison.reported", {
      session: "g-p",
      old: "s",
      fresh: "h1",
      starter: "s",
      reading: "step",
      versions: [],
      scored: { wins: 5, losses: 0, ties: 0 },
    });
    expect(moveOf(toPromote)).toBe("promote");
    expect(await releasePendingPractice(toPromote, "before promote")).toBe(false);
    expect([released(toPromote), toPromote.used]).toEqual([2, 0]);

    const toRevert = await owing(`${STEM}-release-revert`);
    const baseStarter =
      read(toRevert.log).find(({ kind }) => kind === COMPARED)?.data.starter ??
      read(toRevert.log).find(({ kind }) => kind === OPENED)?.data.starter ??
      "s";
    append(toRevert.log, "harness.promoted", { harness: "h1", from: baseStarter });
    append(toRevert.log, "comparison.started", {
      session: "g-r",
      old: "h1",
      fresh: baseStarter,
      starter: baseStarter,
    });
    append(toRevert.log, "comparison.reported", {
      session: "g-r",
      old: "h1",
      fresh: baseStarter,
      starter: baseStarter,
      reading: "no-step",
      versions: ["v-1"],
      scored: { "v-1": 0 },
    });
    expect(moveOf(toRevert)).toBe("revert");
    expect(await releasePendingPractice(toRevert, "before revert")).toBe(false);
    expect([released(toRevert), toRevert.used]).toEqual([2, 0]);

    const toEnd = await owing(`${STEM}-release-end`);
    append(toEnd.log, "campaign.word", { word: "stop", why: "done" });
    expect(moveOf(toEnd)).toBe("end");
    expect(await releasePendingPractice(toEnd, "before end")).toBe(false);
    expect([released(toEnd), toEnd.used]).toEqual([2, 0]);
  });
});

describe.concurrent("live Builder and Examiner coordination", () => {
  it("keeps handover filtered, wakes one Examiner across asks, reopens after crash, and skips load on non-solve moves", async () => {
    const name = `${STEM}-conversing`;
    const sessions: { id: string; tasks: string[]; minutes: number | undefined }[] = [];
    const asked: Step[] = [
      ["examine", {}],
      ["wait", {}],
    ];
    let looks = 0;
    const host = {
      load: () => {
        looks += 1;
        return 99;
      },
      cores: 4,
      waitMs: 1,
      sleep: Bun.sleep,
    };
    const seats: Seats = {
      seated: builderScript(winning(), [...asked, ...asked, ...asked, ...asked, FINISH_IDLE]),
      examine: (request, wall) => {
        sessions.push({
          id: request.id,
          tasks: request.tasks.map(({ taskId }) => taskId),
          minutes: request.budget?.minutes,
        });
        const calls = sessions.length === 1 ? [proposing(12), proposing(12, 12)] : [proposing(12, 24)];
        return examine({ ...request, ...scripted(calls), rest: request.rest }, wall);
      },
      host,
    };
    const common = [
      ...seeded(name),
      "--patience",
      "2",
      "--level",
      "0.125",
      "--target",
      "5",
      "--practice",
      "2",
      "--solve-minutes",
      "7",
    ];
    await harnessBuilder([...common, "--moves", "2"], { seated: winning() });
    const ending = await harnessBuilder(common, seats);
    expect(ending).toMatchObject({ move: "end", ending: "finished", code: "finished" });
    expect(looks).toBe(0);
    expect(sessions.map(({ id, minutes }) => [id, minutes])).toEqual([
      ["x-1", 7],
      ["x-4", 7],
    ]);
    expect(
      of(name, EXAM_STARTED).map(({ session, conversation }) => [session, conversation ?? null]),
    ).toEqual([
      ["x-1", null],
      ["x-2", "x-1"],
      ["x-3", "x-1"],
      ["x-4", null],
    ]);
    expect(of(name, EXAMINED).map(({ session, ended }) => [session, ended])).toEqual([
      ["x-1", "supplied"],
      ["x-2", "supplied"],
      ["x-3", "crashed"],
      ["x-4", "supplied"],
    ]);
    expect(sessions[1]?.tasks).toContain("x-1-001");
    expect(sessions[1]?.tasks).toContain("x-2-001");
    const examinerCall = of(name, CALLED).find(({ tool }) => tool === "examine")?.text;
    expect(examinerCall).toContain("Examiner session x-1 is writing beside this conversation");
    expect(examinerCall).not.toContain("Suggested action");
    expect(examinerCall).not.toContain("check-product");
    expect(examinerCall).toContain(
      `No comparison has a tally yet. Released for practice: 2 of the 2 tasks the campaign names. ${sizeLines(5, 0.125)[0] ?? ""}.`,
    );
    expect(of(name, FINISHED).map(({ session }) => session)).toEqual(["b-1", "b-2", "b-3", "b-4"]);
  });

  it("refuses unchanged, already-read, and >=80% overlapping compares until fresh tasks arrive", async () => {
    const name = `${STEM}-compare-guards`;
    const tied = scriptedSeats({ held: { old: "none", fresh: "none" }, starter: "none" }, GRADED, []);
    const seats: Seats = {
      seated: builderScript(tied, [
        ["compare", {}],
        CHANGE_GUIDE,
        ["compare", {}],
        ["compare", {}],
        CHANGE_AGAIN,
        ["compare", {}],
        ["examine", {}],
        ["wait", {}],
        ["compare", {}],
        FINISH_IDLE,
        FINISH_IDLE,
      ]),
      examine: writer,
    };
    await harnessBuilder([...(await prepared(name)), ...FLAGS, "--moves", "8"], seats);
    const [untouched, , sameAgain, overlapped, fresh] = said(name, "compare");
    expect(untouched).toContain("harness/ is the reference harness: there is nothing to compare");
    expect(sameAgain).toContain("nothing in it has changed since: there is nothing new to compare");
    expect(overlapped).toContain("frontier tasks (100%) already scored in comparison g-1");
    expect(overlapped).toContain("Call examine to hold out fresh tasks");
    expect(fresh).not.toContain("already scored in comparison");
    expect(of(name, COMPARED)).toHaveLength(2);
    expect(of(name, "build.checkpoint")).toHaveLength(2);
  });

  it("lets Builder practise while Examiner writes, declines unmeasured finish once, and guards practice symlinks", async () => {
    const name = `${STEM}-beside`;
    const log = join(REPO, ".ana", "d2", name, LOG_FILE);
    const practised = Promise.withResolvers<void>();
    const seats: Seats = {
      seated: builderScript(winning(), [
        [
          "bash",
          {
            command:
              'mkdir -p "$HOME/fixtures/links"; printf LINK-CANARY > "$HOME/fixtures/links/kept.json"; first=$(ls "$HOME/practice" | head -1); ln -sf "$HOME/fixtures/links/kept.json" "$HOME/practice/$first"',
          },
        ],
        ["examine", {}],
        ["examine", {}],
        { wait: async () => ["practice", { tasks: [taskSets(read(log)).released[0] ?? ""] }] },
        CHANGE_GUIDE,
        ["finish", { note: "Unmeasured while x-1 writes." }],
        {
          wait: async () => {
            practised.resolve();
            return ["wait", {}];
          },
        },
        ["bash", { command: 'cat "$HOME/fixtures/links/kept.json"' }],
        ["finish", { note: "Done." }],
      ]),
      examine: (request) =>
        examine({
          ...request,
          ...scripted([
            {
              wait: async () => {
                await practised.promise;
                return FINISH_IDLE;
              },
            },
            FINISH_IDLE,
          ]),
        }),
    };
    expect(await harnessBuilder([...(await prepared(name)), ...FLAGS], seats)).toMatchObject({
      move: "end",
      ending: "finished",
    });
    const at = positions(name);
    expect(at(EXAM_STARTED)).toBeLessThan(at(`${CALLED}:practice`));
    expect(at(`${CALLED}:practice`)).toBeLessThan(at(EXAMINED));
    expect(at(EXAMINED)).toBeLessThan(at(FINISHED));
    const [firstExam, secondExam] = said(name, "examine");
    expect(firstExam).toContain("Examiner session x-1 is writing");
    expect(secondExam).toContain("Examiner session x-1 is still writing.");
    const finishes = of(name, CALLED).filter(({ tool }) => tool === "finish");
    expect(finishes.slice(0, 2).map(({ isError }) => isError)).toEqual([true, false]);
    expect(finishes[0]?.text).toContain("unmeasured");
    expect(finishes[0]?.text).toContain("x-1");
    const shells = of(name, CALLED).filter(({ tool }) => tool === "bash");
    expect(shells.at(-1)?.text).toContain("LINK-CANARY");
    expect(of(name, COMPARED)).toEqual([]);
  });

  it("starts first Examiner when table asks, and releases owed practice after Examiner ends while respecting floor", async () => {
    const flags = ["--practice", "4", ...LEVEL];
    const runHold = async (name: string, count: number) => {
      const waiting = Promise.withResolvers<void>();
      const seats: Seats = {
        seated: builderScript(winning(), [
          {
            wait: async () => {
              waiting.resolve();
              return ["wait", {}];
            },
          },
          FINISH_IDLE,
        ]),
        examine: (request) =>
          examine({
            ...request,
            ...scripted([
              {
                wait: async () => {
                  await waiting.promise;
                  return proposing(count);
                },
              },
              FINISH_IDLE,
              FINISH_IDLE,
            ]),
          }),
      };
      await harnessBuilder([...seeded(name), ...flags, "--target", "5"], seats);
      const events = logOf(name);
      const during = events.slice(
        events.findIndex(({ kind }) => kind === EXAM_STARTED),
        events.findIndex(({ kind }) => kind === EXAMINED),
      );
      expect(
        during.filter(({ kind, data }) => kind === "task.state" && data.state === "released"),
      ).toHaveLength(0);
      expect(positions(name)(`${CALLED}:wait`)).toBeGreaterThan(positions(name)(EXAMINED));
    };

    const enough = `${STEM}-on-hold-enough`;
    await runHold(enough, 6);
    expect(said(enough, "wait")[0]).toContain("Campaign facts: 9 held-out tasks, 4 practice tasks.");
    expect(of(enough, MOVED, true).filter(({ code }) => code === "practice")).toMatchObject([
      { move: "prepare", why: containing("Examiner session x-1 beside the conversation ended") },
    ]);

    const shortFrontier = `${STEM}-on-hold-short`;
    await runHold(shortFrontier, 1);
    expect(said(shortFrontier, "wait")[0]).toContain(
      `Released for practice: 3 of the 4 tasks the campaign names, and another only while more than 5 tasks stay held out. ${sizeLines(5, 0.125)[0] ?? ""}.`,
    );
    expect(of(shortFrontier, MOVED, true).filter(({ code }) => code === "practice")).toEqual([]);
  });

  it("handles dry-run, filtered Examiner refusal, provider limit wait, interrupted compare resume, and blind rejection packets", async () => {
    const dryName = `${STEM}-dry`;
    const drySeats: Seats = { seated: builderScript(winning(), [FINISH_IDLE]) };
    expect(await harnessBuilder([...seeded(dryName), "--dry-run"], drySeats)).toMatchObject({
      move: "accept",
    });
    expect(of(dryName, OPENED)).toHaveLength(1);
    expect(await harnessBuilder([...seeded(dryName), "--moves", "0"], drySeats)).toMatchObject({
      move: "accept",
    });
    expect(of(dryName, "checker.read")).toEqual([]);

    const errName = `${STEM}-examiner-error`;
    const errEnding = await harnessBuilder([...(await prepared(errName)), ...FLAGS], {
      seated: builderScript(winning(), [["examine", {}], FINISH_IDLE]),
      examine: () => {
        throw new Error("private examiner failure with check-product and t-1");
      },
    });
    expect(errEnding).toMatchObject({ move: "end", ending: "finished" });
    const errText = said(errName, "examine")[0];
    expect(errText).toContain("choose another action");
    expect(errText).not.toContain("private examiner failure");
    expect(errText).not.toContain("check-product");

    const limitName = `${STEM}-limit`;
    const reset = Math.floor(Date.now() / 1000) + 60;
    let asked = 0;
    const slept: number[] = [];
    const limitEnding = await harnessBuilder([...seeded(limitName), "--target", "8", "--practice", "3"], {
      seated: builderScript(winning(), [["wait", {}], ["examine", {}], ["examine", {}], FINISH_IDLE]),
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
    });
    expect(limitEnding).toMatchObject({ move: "end", ending: "exam", code: "tasks" });
    expect(slept).toHaveLength(1);
    expect(of(limitName, "campaign.waited")).toMatchObject([{ for: "provider" }]);
    expect(said(limitName, "examine")[0]).toContain("call examine again");
    expect(said(limitName, "examine")[0]).not.toContain("usage limit");

    const resumeName = `${STEM}-resume`;
    const base = winning();
    let cut = true;
    const resumeSeats: Seats = {
      seated: (campaign, given) => {
        const by = base(campaign, given);
        return {
          ...by,
          builder: scripted(
            read(campaign.log).filter(({ kind }) => kind === "build.started").length < 2
              ? [CHANGE_GUIDE, ["compare", {}], FINISH_IDLE, FINISH_IDLE]
              : IDLE,
          ),
          solve: async (...args) => {
            if (cut) throw new Error("PRIVATE-COMPARISON-FAULT check-product t-1");
            return by.solve(...args);
          },
        };
      },
    };
    const resumeArgs = [...(await prepared(resumeName)), ...FLAGS, "--budget", "20", "--reserve", "0.01"];
    expect(await harnessBuilder(resumeArgs, resumeSeats)).toMatchObject({ ending: "environment" });
    const [start] = of(resumeName, COMPARED);
    expect(said(resumeName, "compare")[0]).not.toContain("PRIVATE-COMPARISON-FAULT");
    cut = false;
    const conversations = of(resumeName, "build.started").length;
    expect(await harnessBuilder([...resumeArgs, "--moves", "1"], resumeSeats)).toMatchObject({
      move: "promote",
    });
    expect(of(resumeName, "build.started")).toHaveLength(conversations);
    expect(start).toBeDefined();
    expect(of(resumeName, COMPARED)).toEqual(start === undefined ? [] : [start]);
    expect(of(resumeName, REPORTED)).toMatchObject([
      { session: start?.session, old: start?.old, fresh: start?.fresh },
    ]);

    const settleName = `${STEM}-settle`;
    const settleArgs = await prepared(settleName);
    await harnessBuilder([...settleArgs, ...FLAGS, "--moves", "2"], {
      seated: builderScript(
        scriptedSeats({ held: { old: "fail", fresh: "pass" }, starter: "none" }, GRADED, []),
        [CHANGE_GUIDE, ["compare", {}], FINISH_IDLE],
      ),
      examine: unwritten,
    });
    expect(await settleCommand([...settleArgs.slice(0, 2), "--session", "g-1"])).toBe(0);
    const settleFolder = join(REPO, ".ana", "d2", settleName, "settle-g-1");
    const drawn = Object.keys(
      parseJsonAs<{ rejections: JsonObject }>(readFileSync(join(settleFolder, "labels.json"), "utf8"))
        .rejections,
    );
    expect(drawn.length).toBeGreaterThan(0);
    const [started] = of(settleName, COMPARED);
    for (const solve of drawn) {
      const text = readFileSync(join(settleFolder, `${solve}.json`), "utf8");
      for (const side of [started?.old, started?.fresh].filter(isString)) expect(text).not.toContain(side);
    }
  });
});

describe.concurrent("promotion, starter reads, operator words, and Rule 3 wall", () => {
  const passing = () => confirming(GRADED_MANY);

  it("climbs A->B->C in one conversation: wakes resting Examiner, waits before starter read, refreshes kept/, and runs candidate next", async () => {
    const name = `${STEM}-climb-full`;
    const strayed: string[] = [];
    let conversations = 0;
    const compareAsked = Promise.withResolvers<void>();
    const postStarterExam = Promise.withResolvers<void>();
    const seats: Seats = {
      seated: builderScript(confirming(GRADED_MANY, strayed), [
        ["examine", {}],
        ["wait", {}],
        CHANGE_GUIDE,
        ["compare", {}],
        ["bash", { command: 'ls "$HOME/kept"' }],
        CHANGE_AGAIN,
        {
          wait: async () => {
            compareAsked.resolve();
            return ["compare", {}];
          },
        },
        ["examine", {}],
        {
          wait: async () => {
            postStarterExam.resolve();
            return ["compare", {}];
          },
        },
        FINISH_IDLE,
        FINISH_IDLE,
      ]),
      examine: (request, wall) => {
        conversations += 1;
        return examine(
          {
            ...request,
            ...scripted([
              proposing(12, 0),
              {
                wait: async () => {
                  await compareAsked.promise;
                  await Bun.sleep(50);
                  return proposing(12, 12);
                },
              },
              {
                wait: async () => {
                  await postStarterExam.promise;
                  await Bun.sleep(50);
                  return proposing(12, 24);
                },
              },
              FINISH_IDLE,
            ]),
            rest: request.rest,
          },
          wall,
        );
      },
    };
    const ending = await harnessBuilder(
      [...(await prepared(name, MANY)), ...FLAGS, "--promotions", "2"],
      seats,
    );
    expect(ending).toMatchObject({ move: "end", ending: "operator", code: "stop" });
    expect(conversations).toBe(1);
    expect(
      of(name, EXAM_STARTED)
        .slice(0, 3)
        .map(({ session, conversation }) => [session, conversation ?? null]),
    ).toEqual([
      ["x-1", null],
      ["x-2", "x-1"],
      ["x-3", "x-1"],
    ]);
    const [first, starterComparison, second] = of(name, REPORTED);
    expect(first).toMatchObject({ reading: "step", scored: { wins: 5, losses: 0, ties: 0 } });
    expect(starterComparison).toMatchObject({ old: first?.fresh, fresh: first?.old });
    expect(second).toMatchObject({
      old: first?.fresh,
      reading: "step",
      frontier: { wins: 5, losses: 0, ties: 0 },
    });
    expect(of(name, "harness.promoted")).toMatchObject([
      { harness: first?.fresh },
      { harness: second?.fresh },
    ]);
    expect(of(name, "build.started")).toHaveLength(1);
    const compares = of(name, MOVED).filter(({ move }) => move === "compare");
    expect(compares.map(({ code }) => code)).toEqual(["led", "unread", "led"]);
    expect(compares[2]?.why).toBe("the Builder's own move in its campaign conversation");
    const [promotedBy] = said(name, "compare");
    expect(promotedBy).toContain("and the host has made it the campaign's reference");
    expect(promotedBy?.split(", which reads ")).toHaveLength(2);
    expect(promotedBy).toContain("1 comparison with a tally; the last:\n- Harness ");
    expect(promotedBy).not.toContain("The comparison has no tally yet.");
    expect(said(name, "compare")[1]).toContain("The table's comparison of the starter ran first");
    expect(said(name, "compare")[2]).not.toContain("The table's comparison of the starter ran first");
    const events = logOf(name);
    const promotedAt = events.findIndex(({ kind }) => kind === "harness.promoted");
    const written = events.findIndex(({ kind }, at) => at > promotedAt && kind === EXAMINED);
    const started = events.findIndex(({ kind }, at) => at > promotedAt && kind === COMPARED);
    expect(written).toBeGreaterThan(promotedAt);
    expect(started).toBeGreaterThan(written);
    const promoted = first?.fresh;
    expect(
      said(name, "bash").find((text) => isString(promoted) && text.includes(short(promoted))),
    ).toBeDefined();
    expect(strayed).toEqual([]);
  });

  it("reads starter while harness/ is reference, reverts unconfirmed reference, and enforces --promotions cap", async () => {
    const revertName = `${STEM}-revert-unconfirmed`;
    await harnessBuilder([...(await prepared(revertName, MANY)), ...FLAGS, "--moves", "10"], {
      seated: builderScript(winning(GRADED_MANY), [
        CHANGE_GUIDE,
        ["compare", {}],
        ["examine", {}],
        ["compare", {}],
        CHANGE_AGAIN,
        ["compare", {}],
        FINISH_IDLE,
        FINISH_IDLE,
      ]),
      examine: writer,
    });
    const [first, starterComparison, second] = of(revertName, REPORTED);
    expect(starterComparison).toMatchObject({ fresh: first?.old, old: first?.fresh, reading: "no-step" });
    expect(of(revertName, "harness.reverted")).toMatchObject([{ harness: first?.old, from: first?.fresh }]);
    expect(said(revertName, "compare")[1]).toContain("the starter harness was read against it");
    expect(said(revertName, "compare")[1]).toContain("reverted the campaign's reference to");
    expect(second).toMatchObject({ old: first?.old });
    expect(of(revertName, "harness.promoted")).toMatchObject([
      { harness: first?.fresh },
      { harness: second?.fresh },
    ]);
    const [stopped, closing] = said(revertName, "finish");
    expect(stopped).toContain("Not finished. harness/ is the harness last promoted,");
    expect(closing).not.toContain("harness last promoted");

    const capName = `${STEM}-capped`;
    const capSeats: Seats = {
      seated: builderScript(passing(), [CHANGE_GUIDE, ["compare", {}], ["examine", {}], FINISH_IDLE]),
      examine: writer,
    };
    const capEnding = await harnessBuilder(
      [...(await prepared(capName, MANY)), ...FLAGS, "--promotions", "1"],
      capSeats,
    );
    expect(capEnding).toMatchObject({ move: "end", ending: "operator", code: "stop" });
    expect(of(capName, "harness.promoted")).toHaveLength(1);
    const told = of(capName, CALLED)
      .flatMap(({ text }) => (isString(text) ? [text] : []))
      .join("\n");
    expect(told).not.toMatch(/\bcap\b|promotions?\b.*\b1\b/u);
    await expect(
      harnessBuilder([...seeded(capName, MANY), ...FLAGS, "--promotions", "0"], capSeats),
    ).rejects.toThrow("--promotions 0");
  });

  it("handles operator stop and task words during live Examiner and while promotion waits", async () => {
    const stopName = `${STEM}-beside-stop`;
    const stopped = Promise.withResolvers<void>();
    expect(
      await harnessBuilder([...(await prepared(stopName)), ...FLAGS], {
        seated: builderScript(winning(), [
          ["examine", {}],
          {
            wait: async () => {
              wordCommand(["--name", stopName, "--stop", "the operator stops this run"]);
              stopped.resolve();
              return ["campaign_status", {}];
            },
          },
        ]),
        examine: (request) =>
          examine({
            ...request,
            ...scripted([
              {
                wait: async () => {
                  await stopped.promise;
                  await Bun.sleep(150);
                  return FINISH_IDLE;
                },
              },
              FINISH_IDLE,
            ]),
          }),
      }),
    ).toMatchObject({ ending: "operator" });
    expect(of(stopName, EXAMINED)).toMatchObject([{ session: "x-1", ended: "killed" }]);

    const waitStopName = `${STEM}-stop-waiting`;
    await harnessBuilder([...(await prepared(waitStopName, MANY)), ...FLAGS, "--moves", "10"], {
      seated: builderScript(passing(), [["examine", {}], CHANGE_GUIDE, ["compare", {}], FINISH_IDLE]),
      examine: (request) =>
        examine({
          ...request,
          ...scripted([
            {
              wait: async () => {
                for (
                  let tries = 0;
                  tries < 600 && !logOf(waitStopName).some(({ kind }) => kind === REPORTED);
                  tries += 1
                ) {
                  await Bun.sleep(25);
                }
                wordCommand(["--name", waitStopName, "--stop", "enough for today"]);
                return proposing(6);
              },
            },
            FINISH_IDLE,
          ]),
        }),
    });
    expect(of(waitStopName, REPORTED)).toMatchObject([{ reading: "step" }]);
    expect(of(waitStopName, "harness.promoted")).toEqual([]);
    expect(of(waitStopName, "campaign.ended")).toMatchObject([{ ending: "operator" }]);

    const waitTasksName = `${STEM}-word-waiting`;
    await harnessBuilder([...(await prepared(waitTasksName, MANY)), ...FLAGS, "--moves", "10"], {
      seated: builderScript(passing(), [
        ["examine", {}],
        CHANGE_GUIDE,
        ["compare", {}],
        ["examine", {}],
        FINISH_IDLE,
        FINISH_IDLE,
      ]),
      examine: (request) =>
        examine({
          ...request,
          ...scripted([
            {
              wait: async () => {
                for (
                  let tries = 0;
                  tries < 600 && !logOf(waitTasksName).some(({ kind }) => kind === REPORTED);
                  tries += 1
                ) {
                  await Bun.sleep(25);
                }
                wordCommand(["--name", waitTasksName, "--tasks", "harder ones"]);
                return proposing(6);
              },
            },
            FINISH_IDLE,
            FINISH_IDLE,
          ]),
        }),
    });
    const events = logOf(waitTasksName);
    const word = events.findIndex(({ kind }) => kind === "campaign.word");
    const promoted = events.findIndex(({ kind }) => kind === "harness.promoted");
    const answered = events.findIndex(
      ({ kind, data }) => kind === MOVED && data.move === "examine" && Array.isArray(data.answers),
    );
    expect(promoted).toBeGreaterThan(word);
    expect(answered).toBeGreaterThan(promoted);
    expect(pendingSignals(events)).toEqual([]);
  });

  const everythingRead = async (
    name: string,
    ties: Readonly<Record<string, readonly (number | string)[]>>,
    flags: readonly string[] = FLAGS,
    ended: { readonly ending: string; readonly why?: string } = { ending: "finished" },
    answered?: number,
  ): Promise<string> => {
    const whole = ended.ending === "finished";
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
        FINISH_IDLE,
        FINISH_IDLE,
      ]),
    };
    const setup =
      answered === undefined && flags[0] === "--practice" && flags[1] === "2" && flags[3] === "5"
        ? await prepared(name, MANY)
        : seeded(name, MANY, answered);
    expect(await harnessBuilder([...setup, ...flags], seats)).toMatchObject(ended);
    expect(of(name, REPORTED).map(({ scored }) => scored)).toMatchObject(
      ["g-1", "g-2"]
        .slice(0, whole ? 2 : 1)
        .map((comparison) => ({ wins: 2, losses: 0, ties: ties[comparison]?.length })),
    );
    const facts = of(name, CALLED).map(({ tool, text }) => ({
      campaign: tool === "compare" || tool === "campaign_status",
      count: isString(text) ? text.split("Campaign facts:").length - 1 : 0,
    }));
    expect(facts.length).toBeGreaterThan(whole ? 4 : 1);
    for (const { campaign, count } of facts) expect(count).toBe(campaign ? 1 : 0);
    for (const text of said(name, "campaign_status")) expect(text).not.toContain("the campaign names");
    return of(name, CALLED)
      .map(({ tool, text }) => `${isString(tool) ? tool : ""}: ${isString(text) ? text : ""}`)
      .join("\n")
      .replaceAll(/\d+:\d\d of/gu, "0:00 of")
      .replaceAll(/took \d+ minutes?/gu, "took 0 minutes")
      .replaceAll(/billed \d+\.\d\d dollars/gu, "billed 0.00 dollars");
  };

  it("tells the Builder the same whichever held-out task was won", async () => {
    const same = await everythingRead(`${STEM}-won-one`, { "g-1": [0, 1, 2], "g-2": [0, 1, 2] });
    const moved = await everythingRead(`${STEM}-won-two`, { "g-1": [1, 2, 3], "g-2": [2, 3, 4] });
    expect(moved).toBe(same);
    expect(same).toContain("2 won, 0 lost, 3 tied");
    expect(same).toMatch(/Validity differed on \w+ of the 5 tasks/u);
    expect(same).toContain("Comparison g-2 took 0 minutes and billed");
  });

  it("tells the Builder the same whichever held-out task was won where the cap is short of the next test", async () => {
    const flags = [...FLAGS, "--budget", "1.40", "--reserve", "0.01"];
    const ended = { ending: "budget", why: containing("below what the next comparison's test costs") };
    const same = await everythingRead(
      `${STEM}-cap-one`,
      { "g-1": [0, 1, 2], "g-2": [0, 1, 2] },
      flags,
      ended,
    );
    const moved = await everythingRead(
      `${STEM}-cap-two`,
      { "g-1": [1, 2, 3], "g-2": [2, 3, 4] },
      flags,
      ended,
    );
    expect(moved).toBe(same);
    expect(same).toContain("2 won, 0 lost, 3 tied");
  });

  it("tells the Builder the same whichever held-out task was won where the frontier falls below the target", async () => {
    const flags = [...FLAGS.slice(0, -LEVEL.length - 2), "--target", "8", ...LEVEL];
    const tied = ["ex-002", "ex-003", "ex-004", "ex-006", "ex-009", "ex-010"];
    const again = ["ex-003", "ex-004", "ex-006", "ex-010", "ex-011"];
    const same = await everythingRead(
      `${STEM}-short-one`,
      { "g-1": tied, "g-2": ["ex-002", ...again] },
      flags,
      { ending: "finished" },
      1,
    );
    const moved = await everythingRead(
      `${STEM}-short-two`,
      { "g-1": tied, "g-2": [...again, "ex-012"] },
      flags,
      { ending: "finished" },
      1,
    );
    expect(["one", "two"].map((world) => supplyOf(logOf(`${STEM}-short-${world}`)).awaiting)).toEqual([7, 7]);
    expect(same).toContain("2 won, 0 lost, 6 tied");
    expect(moved).toBe(same);
  });
});

describe.concurrent("a campaign's endings", () => {
  const passing = () => scriptedSeats({ held: { old: "pass", fresh: "pass" }, starter: "none" }, GRADED, []);
  const failing = () => scriptedSeats({ held: { old: "none", fresh: "none" }, starter: "none" }, GRADED, []);
  const practise = (name: string): Step => ({
    wait: async () => {
      const [version] = taskSets(logOf(name)).released;
      const id = of(name, "task.proposed").find((task) => task.version === version)?.taskId;
      return ["practice", { tasks: [isString(id) ? id : ""] }];
    },
  });

  it("ends on supply patience inside a live conversation, across turns-ended sessions, and after three idle turn limits", async () => {
    const liveName = `${STEM}-roomless-live`;
    const asking: Step[] = [
      ["examine", {}],
      ["wait", {}],
    ];
    expect(
      await harnessBuilder([...(await prepared(liveName)), ...FLAGS, "--patience", "2"], {
        seated: builderScript(passing(), [CHANGE_GUIDE, ["compare", {}], ...asking, ...asking, ...asking]),
        examine: unwritten,
      }),
    ).toMatchObject({ move: "end", ending: "no-room" });
    expect(of(liveName, EXAMINED)).toMatchObject([{ held: [] }, { held: [] }]);

    const turnsName = `${STEM}-turns`;
    expect(
      await harnessBuilder([...(await prepared(turnsName)), ...FLAGS, "--turns", "3", "--patience", "2"], {
        seated: builderScripts(passing(), [
          [CHANGE_GUIDE, CHANGE_AGAIN, CHANGE_GUIDE],
          [["compare", {}], FINISH_IDLE],
          IDLE,
          IDLE,
          IDLE,
        ]),
        examine: unwritten,
      }),
    ).toMatchObject({ move: "end", ending: "no-room" });
    expect(of(turnsName, FINISHED).map(({ session, ended }) => [session, ended])).toEqual([
      ["b-1", "turns"],
      ["b-2", "finished"],
      ["b-3", "finished"],
      ["b-4", "finished"],
    ]);

    const editing = `${STEM}-turns-idle`;
    const status: Step = ["campaign_status", {}];
    const limited = [practise(editing), status, status];
    expect(
      await harnessBuilder(
        [...seeded(editing), ...FLAGS, "--turns", "3", "--practice", "1", "--target", "6", "--patience", "4"],
        { seated: builderScripts(failing(), [limited, limited, limited]), examine: unwritten },
      ),
    ).toMatchObject({ move: "end", ending: "finished" });
    expect(of(editing, FINISHED).map(({ ended }) => ended)).toEqual(["turns", "turns", "turns"]);
    const told = said(editing, "campaign_status");
    expect(told[3]).toContain("The conversation before this one made no campaign move.");
    expect(told[5]).toContain("The 2 conversations before this one made no campaign move.");
  });

  it("recovers from a single Builder crash, and ends on environment after three Builder or Examiner crashes", async () => {
    const recovered = `${STEM}-crashed`;
    expect(
      await harnessBuilder([...(await prepared(recovered)), ...FLAGS], {
        seated: builderScripts(passing(), [[CHANGE_GUIDE], [["compare", {}], FINISH_IDLE], IDLE, IDLE]),
      }),
    ).toMatchObject({ ending: "finished" });
    expect(of(recovered, FINISHED).map(({ session, ended }) => [session, ended])).toEqual([
      ["b-1", "crashed"],
      ["b-2", "finished"],
      ["b-3", "finished"],
      ["b-4", "finished"],
    ]);

    const crashing = `${STEM}-crashes`;
    expect(
      await harnessBuilder([...(await prepared(crashing)), ...FLAGS], {
        seated: builderScripts(passing(), [[CHANGE_GUIDE], [CHANGE_GUIDE], [CHANGE_GUIDE]]),
      }),
    ).toMatchObject({ move: "end", ending: "environment" });
    expect(of(crashing, FINISHED).map(({ ended }) => ended)).toEqual(["crashed", "crashed", "crashed"]);

    const halted = `${STEM}-halted`;
    const waits: Step = ["wait", {}];
    expect(
      await harnessBuilder([...seeded(halted), "--target", "8", "--practice", "3"], {
        seated: builderScript(winning(), [
          ["examine", {}],
          waits,
          ["examine", {}],
          waits,
          ["examine", {}],
          waits,
          FINISH_IDLE,
        ]),
        examine: (request) => examine({ ...request, ...scripted([]) }),
      }),
    ).toMatchObject({ move: "end", ending: "environment" });
    expect(of(halted, EXAMINED).map(({ ended }) => ended)).toEqual(["crashed", "crashed", "crashed"]);
    expect(of(halted, FINISHED).map(({ ended }) => ended)).toEqual(["stopped"]);
    const events = logOf(halted);
    expect(
      crashedRun(
        events.slice(
          0,
          events.findIndex(({ kind }) => kind === "campaign.ended"),
        ),
      ).count,
    ).toBe(3);
  });
});
