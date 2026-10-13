// The Harness Builder's live controller over a fixture pack. A scripted Builder chooses the
// campaign tools in the same place a paid Builder does; the command never falls back to the old
// move-by-move scheduler for a rehearsal.
// The paid run keeps a Receipt beside its log; these tests use scripted seats and inspect the log.

import { afterAll, describe, expect, it, setDefaultTimeout, spyOn } from "bun:test";
import { pendingWords } from "../src/builder/word.ts";
import { examine } from "../src/examiner/session.ts";
import { append, LOG_FILE, type LogEvent, read } from "../src/kernel/log.ts";
import {
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { isString, type JsonObject } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join, resolve } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { flagsOf, opened, type Seats } from "../tools/d2/campaign-terms.ts";
import { closeCommand } from "../tools/d2/close.ts";
import { harnessBuilder } from "../tools/d2/harness-builder.ts";
import { HOST } from "../tools/d2/host.ts";
import { importCommand } from "../tools/d2/import.ts";
import type { Seated } from "../tools/d2/round.ts";
import { settleCommand } from "../tools/d2/settle.ts";
import { wordCommand } from "../tools/d2/word.ts";
import { scriptedSeats } from "../tools/runs/rehearse.ts";
import { fixtureTasks, gradedOf, layOutPack, scriptedModel } from "./helpers/fixture-pack.ts";

const REPO = resolve(import.meta.dir, "..");
const FIXTURE = join(REPO, "test", "fixtures", "harness-min");
const STEM = `test-hb-${String(runtimeProcess.pid)}`;
const OPENED = "campaign.opened";
const PROJECT = "fixture-products";
const MOVED = "campaign.move";
const CALLED = "build.call";
const TASKS = fixtureTasks(7);
const GRADED = [
  ...gradedOf(TASKS),
  ...TASKS.map(({ taskId }) => ({ taskId, answer: { answer: "wrong" }, refusedBy: "check-product" })),
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
// Five held-out tasks all won read a step at 0.05 and none at the tree's default, 0.02, which takes
// six: this suite is of who makes the moves, so it names the level its five tasks can read at.
const LEVEL = ["--level", "0.05"];
const FLAGS = [
  "--practice",
  "2",
  "--solves",
  "1",
  "--sessions",
  "1",
  "--target",
  "5",
  "--trigger",
  "0.5",
  ...LEVEL,
];
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

/** What a campaign's log holds of one kind, in order. */
const of = (name: string, kind: string): JsonObject[] =>
  read(join(REPO, ".ana", "d2", name, LOG_FILE)).flatMap((event: LogEvent) =>
    event.kind === kind ? [event.data] : [],
  );

/** Give a scripted Builder the campaign tools it chooses in the live path. */
function builderScript(base: Seated, calls: readonly (readonly [string, JsonObject])[]): Seated {
  return (campaign, given) => ({ ...base(campaign, given), builder: scripted(calls) });
}

/** A scripted Builder with one script a conversation, in the order the conversations open. */
function builderScripts(
  base: Seated,
  scripts: readonly (readonly (readonly [string, JsonObject])[])[],
): Seated {
  return (campaign, given) => {
    const conversations = read(campaign.log).filter(({ kind }) => kind === "build.started").length;
    return { ...base(campaign, given), builder: scripted(scripts[conversations] ?? []) };
  };
}

/** What the Builder read from each call of `tool`, in order. */
const said = (name: string, tool: string): string[] =>
  of(name, CALLED).flatMap((call) => (call.tool === tool && isString(call.text) ? [call.text] : []));

/** An Examiner that holds out six further instances. */
const writer: NonNullable<Seats["examine"]> = (request) =>
  examine({
    ...request,
    ...scripted([
      [
        "propose_tasks",
        {
          tasks: Array.from({ length: 6 }, (_, n) => ({
            family: "fixture",
            public_input: { base: 2, rehearsal_copy: { of: "t-1", n } },
            hidden: null,
          })),
        },
      ],
    ]),
  });

describe("a campaign run by its live Builder", () => {
  it("lets the Builder ask the Examiner, and keeps the handover filtered", async () => {
    layOutPack(root, bundle, TASKS, FIXTURE);
    const name = `${STEM}-examiner`;
    const asked: { tasks: number; minutes: number | undefined; turns: number; proposals: number }[] = [];
    const base = scriptedSeats({ held: { old: "none", fresh: "pass" }, starter: "none" }, GRADED, []);
    const seats: Seats = {
      seated: builderScript(base, [
        ["examine", {}],
        ["finish", { note: "The campaign needs more held-out tasks." }],
      ]),
      examine: (request) => {
        asked.push({
          tasks: request.wanted,
          minutes: request.budget?.minutes,
          turns: request.limits.turns,
          proposals: request.limits.puts,
        });
        return examine({
          ...request,
          ...scripted([
            ["finish", { note: "Nothing to add." }],
            ["finish", { note: "Nothing to add." }],
          ]),
        });
      },
    };
    const ending = await harnessBuilder(
      [
        ...seeded(name),
        "--patience",
        "2",
        "--target",
        "5",
        "--practice",
        "2",
        "--solve-minutes",
        "7",
        "--exam-tasks",
        "4",
        "--exam-turns",
        "17",
        "--exam-proposals",
        "9",
      ],
      seats,
    );
    expect(ending).toMatchObject({ move: "end", ending: "finished" });
    expect(asked).toEqual([{ tasks: 4, minutes: 7, turns: 17, proposals: 9 }]);
    expect(of(name, MOVED).map(({ move, session }) => [move, session ?? null])).toEqual([
      ["accept", null],
      ["prepare", null],
      // The conversation is on record as it begins, and each move it makes after it.
      ["build", "b-1"],
      ["examine", "x-1"],
    ]);
    expect(of(name, "exam.started")).toMatchObject([{ limits: { tasks: 4 } }]);
    expect(of(name, "build.finished")).toMatchObject([{ session: "b-1", ended: "finished" }]);
    expect(of(name, "campaign.ended")).toMatchObject([{ ending: "finished" }]);
    const examinerCall = of(name, CALLED).find(({ tool }) => tool === "examine");
    // One count of the held-out tasks, in the result and in the facts under it (v1's lesson 2).
    expect(examinerCall?.text).toContain(
      "ended whole. It held out 0 tasks, and the campaign holds 5 held-out",
    );
    expect(examinerCall?.text).toContain("Campaign facts: 5 held-out tasks, 2 practice tasks.");
    expect(examinerCall?.text).not.toContain("check-product");
  });

  it("honours a task word during the conversation before allowing another action", async () => {
    layOutPack(root, bundle, TASKS, FIXTURE);
    const name = `${STEM}-live-tasks`;
    let calls = 0;
    const seats: Seats = {
      seated: builderScript(
        scriptedSeats({ held: { old: "none", fresh: "pass" }, starter: "none" }, GRADED, []),
        [
          ["examine", {}],
          ["promote", {}],
          ["examine", {}],
          ["finish", { note: "The operator's task request was honoured." }],
        ],
      ),
      examine: async (request) => {
        const result = await examine({
          ...request,
          ...scripted([
            ["finish", { note: "No further instance." }],
            ["finish", { note: "No further instance." }],
          ]),
        });
        calls += 1;
        if (calls === 1) wordCommand(["--name", name, "--tasks", "other tasks please"]);
        return result;
      },
    };
    expect(await harnessBuilder([...seeded(name), "--target", "5", "--practice", "2"], seats)).toMatchObject({
      ending: "finished",
    });
    expect(of(name, "exam.started")).toHaveLength(2);
    expect(of(name, MOVED).filter(({ move }) => move === "examine")).toHaveLength(2);
    expect(of(name, MOVED).some(({ move }) => move === "promote")).toBe(false);
    // The word is the operator's and reaches no seat: the Builder reads what the campaign waits for.
    const waited = of(name, CALLED).find(({ tool }) => tool === "promote")?.text;
    expect(waited).toContain("Other tasks are to be written before another action");
    expect(waited).not.toContain("operator");
    expect(waited).not.toContain("other tasks please");
    expect(pendingWords(read(join(REPO, ".ana", "d2", name, LOG_FILE)))).toEqual([]);
  });

  it("stops before the next Builder turn when an operator stops a child action", async () => {
    layOutPack(root, bundle, TASKS, FIXTURE);
    const name = `${STEM}-live-stop`;
    const seats: Seats = {
      seated: builderScript(
        scriptedSeats({ held: { old: "none", fresh: "pass" }, starter: "none" }, GRADED, []),
        [["examine", {}], CHANGE_GUIDE],
      ),
      examine: async (request) => {
        const result = await examine({
          ...request,
          ...scripted([
            ["finish", { note: "No more." }],
            ["finish", { note: "No more." }],
          ]),
        });
        wordCommand(["--name", name, "--stop", "stop after this child"]);
        return result;
      },
    };
    expect(await harnessBuilder([...seeded(name), "--target", "5", "--practice", "2"], seats)).toMatchObject({
      ending: "operator",
    });
    expect(of(name, "build.turn")).toHaveLength(1);
    expect(of(name, CALLED).some(({ tool }) => tool === "bash")).toBe(false);
  });

  it("uses the last permitted move and refreshes practice without following a Builder's link", async () => {
    layOutPack(root, bundle, TASKS, FIXTURE);
    const name = `${STEM}-last-move`;
    const seats: Seats = {
      seated: builderScript(
        scriptedSeats({ held: { old: "none", fresh: "pass" }, starter: "none" }, GRADED, []),
        [
          [
            "bash",
            {
              command:
                'mkdir -p "$HOME/fixtures/links"; printf LINK-CANARY > "$HOME/fixtures/links/kept.json"; first=$(ls "$HOME/practice" | head -1); ln -sf "$HOME/fixtures/links/kept.json" "$HOME/practice/$first"',
            },
          ],
          ["examine", {}],
          ["bash", { command: 'cat "$HOME/fixtures/links/kept.json"' }],
          ["release_practice", {}],
          ["finish", { note: "The host's move limit should stop before this call." }],
        ],
      ),
      examine: (request) =>
        examine({
          ...request,
          ...scripted([
            ["finish", { note: "No more." }],
            ["finish", { note: "No more." }],
          ]),
        }),
    };
    await harnessBuilder([...seeded(name), "--target", "5", "--practice", "2", "--moves", "4"], seats);
    const shells = of(name, CALLED).filter(({ tool }) => tool === "bash");
    expect(shells).toHaveLength(2);
    expect(shells[1]?.text).toContain("LINK-CANARY");
    expect(of(name, MOVED)).toHaveLength(5);
    expect(of(name, CALLED).some(({ tool }) => tool === "finish")).toBe(false);
  });

  it("keeps one Builder conversation from A to B and then from B to C", async () => {
    layOutPack(root, bundle, TASKS, FIXTURE);
    const name = `${STEM}-promote`;
    const strayed: string[] = [];
    const base = scriptedSeats({ held: { old: "none", fresh: "pass" }, starter: "none" }, GRADED, strayed);
    const seats: Seats = {
      seated: builderScript(base, [
        CHANGE_GUIDE,
        ["compare", {}],
        ["compare", {}],
        ["promote", {}],
        ["examine", {}],
        CHANGE_GUIDE,
        ["compare", {}],
        ["compare", {}],
        ["promote", {}],
        ["finish", { note: "Two harnesses are promoted and measured." }],
      ]),
      examine: (request) =>
        examine({
          ...request,
          ...scripted([
            [
              "propose_tasks",
              {
                tasks: Array.from({ length: 6 }, (_, n) => ({
                  family: "fixture",
                  public_input: { base: 2, rehearsal_copy: { of: "t-1", n } },
                  hidden: null,
                })),
              },
            ],
          ]),
        }),
    };
    const ending = await harnessBuilder(
      [
        ...seeded(name),
        "--practice",
        "2",
        "--solves",
        "1",
        "--sessions",
        "1",
        "--target",
        "5",
        "--trigger",
        "0.5",
        // The second step is read on the four tasks the first left on the frontier: all won is
        // 0.0625 of the time by chance, which 0.1 calls a step and 0.05 does not.
        "--level",
        "0.1",
        // A campaign opens at 0.1 where it bears one attempt without a gain, and no more.
        "--patience",
        "1",
        "--exam-tasks",
        "6",
      ],
      seats,
    );
    expect(ending).toMatchObject({ move: "end", ending: "finished" });
    expect(of(name, MOVED).map(({ move }) => move)).toEqual([
      "accept",
      "prepare",
      "build",
      "compare",
      "compare",
      "promote",
      "examine",
      "compare",
      "compare",
      "promote",
    ]);
    const [first, repeat, second, secondRepeat] = of(name, "comparison.reported");
    expect(first).toMatchObject({ reading: "step", scored: { wins: 5, losses: 0, ties: 0 } });
    expect(repeat).toMatchObject({ reading: "step", old: first?.old, fresh: first?.fresh });
    expect(second).toMatchObject({
      old: first?.fresh,
      reading: "step",
      scored: { wins: 5, losses: 0, ties: 0 },
    });
    expect(second?.fresh).not.toBe(first?.fresh);
    expect(secondRepeat).toMatchObject({ old: second?.old, fresh: second?.fresh });
    expect(of(name, "harness.promoted")).toHaveLength(2);
    expect(of(name, "build.started")).toHaveLength(1);
    expect(of(name, "build.finished")).toHaveLength(1);
    expect(of(name, "campaign.ended")).toMatchObject([{ ending: "finished", latest: second?.fresh }]);
    expect(strayed).toEqual([]);
    const campaignCalls = of(name, CALLED).filter(({ tool }) =>
      ["compare", "promote"].includes(isString(tool) ? tool : ""),
    );
    expect(campaignCalls.every(({ text }) => !isString(text) || !text.includes("check-product"))).toBe(true);
    expect(campaignCalls.every(({ text }) => !isString(text) || !text.includes("t-1"))).toBe(true);
  });

  it("resumes an interrupted comparison on its original harness after further edits", async () => {
    layOutPack(root, bundle, TASKS, FIXTURE);
    const name = `${STEM}-resume`;
    const base = scriptedSeats({ held: { old: "none", fresh: "pass" }, starter: "none" }, GRADED, []);
    let cut = true;
    const seats: Seats = {
      seated: (campaign, given) => {
        const by = base(campaign, given);
        return {
          ...by,
          builder: scripted([CHANGE_GUIDE, ["compare", {}], ["finish", { note: "The comparison resumed." }]]),
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
    const args = [
      ...seeded(name),
      "--target",
      "5",
      "--practice",
      "2",
      "--solves",
      "1",
      "--budget",
      "20",
      "--reserve",
      "0.01",
    ];
    expect(await harnessBuilder(args, seats)).toMatchObject({ ending: "environment" });
    const [start] = of(name, "comparison.started");
    if (start === undefined) throw new Error("the comparison did not record its original terms");
    expect(of(name, "comparison.reported")).toEqual([]);
    expect(of(name, CALLED).find(({ tool }) => tool === "compare")?.text).not.toContain(
      "PRIVATE-COMPARISON-FAULT",
    );
    cut = false;
    expect(await harnessBuilder(args, seats)).toMatchObject({ ending: "finished" });
    expect(of(name, "comparison.started")).toEqual([start]);
    expect(of(name, "comparison.reported")).toMatchObject([
      { session: start?.session, old: start?.old, fresh: start?.fresh },
    ]);
    expect(of(name, "build.checkpoint")).toHaveLength(1);
    expect(of(name, "build.finished").at(-1)?.harness).not.toBe(start?.fresh);
  });

  it("keeps hard gates in the host and leaves dry-run as an advisory reader", async () => {
    layOutPack(root, bundle, TASKS, FIXTURE);
    const name = `${STEM}-dry-run`;
    const seats: Seats = {
      seated: builderScript(
        scriptedSeats({ held: { old: "none", fresh: "pass" }, starter: "none" }, GRADED, []),
        [["finish", { note: "not reached" }]],
      ),
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
    const base = scriptedSeats({ held: { old: "none", fresh: "pass" }, starter: "none" }, GRADED, []);
    const seats: Seats = {
      seated: builderScript(base, [
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
    let limited = true;
    const slept: number[] = [];
    const seats: Seats = {
      seated: builderScript(
        scriptedSeats({ held: { old: "none", fresh: "pass" }, starter: "none" }, GRADED, []),
        [
          ["examine", {}],
          ["examine", {}],
          ["finish", { note: "The Examiner was asked again after the limit." }],
        ],
      ),
      examine: (request) => {
        if (limited) {
          limited = false;
          throw new Error(`Claude Code: usage limit (limit reached|${String(reset)})`);
        }
        return examine({
          ...request,
          ...scripted([
            ["finish", { note: "Nothing to add." }],
            ["finish", { note: "Nothing to add." }],
          ]),
        });
      },
      host: {
        ...HOST,
        sleep: async (ms: number) => {
          slept.push(ms);
        },
      },
    };
    const ending = await harnessBuilder([...seeded(name), "--target", "8", "--practice", "3"], seats);
    expect(ending).toMatchObject({ move: "end", ending: "finished" });
    // Until 13 October a throw with nothing written after its move was read as a refusal before the
    // limit was asked for, and the Builder was told to choose another action.
    expect(slept).toHaveLength(1);
    expect(of(name, "campaign.waited")).toMatchObject([{ for: "provider" }]);
    expect(said(name, "examine")[0]).toContain("call examine again");
    expect(said(name, "examine")[0]).not.toContain("usage limit");
    expect(of(name, "exam.started")).toHaveLength(1);
  });

  it("applies operator stop and budget words at the next live boundary", async () => {
    layOutPack(root, bundle, TASKS, FIXTURE);
    const stopName = `${STEM}-operator-stop`;
    const stopArgs = seeded(stopName);
    const seats: Seats = {
      seated: builderScript(
        scriptedSeats({ held: { old: "none", fresh: "pass" }, starter: "none" }, GRADED, []),
        [],
      ),
    };
    expect(await harnessBuilder([...stopArgs, "--moves", "0"], seats)).toMatchObject({ move: "accept" });
    expect(wordCommand(["--name", stopName, "--stop", "the operator paused this run"])).toBe("stop");
    expect(await harnessBuilder([...stopArgs, "--moves", "0"], seats)).toMatchObject({
      move: "end",
      ending: "operator",
    });

    const budgetName = `${STEM}-operator-budget`;
    const budgetArgs = [...seeded(budgetName), "--target", "6", "--practice", "2"];
    // Set up, the table wants the tasks a comparison scores and its practice draws written first.
    expect(await harnessBuilder([...budgetArgs, "--budget", "20", "--moves", "2"], seats)).toMatchObject({
      move: "examine",
    });
    expect(wordCommand(["--name", budgetName, "--budget", "1"])).toBe("budget");
    expect(await harnessBuilder([...budgetArgs, "--moves", "0"], seats)).toMatchObject({
      move: "end",
      ending: "budget",
    });
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
    };
    await harnessBuilder([...args, "--sessions", "1", "--target", "5"], seats);
    expect(await settleCommand([...pack, "--session", "g-1"])).toBe(0);
    expect(readdirSync(join(REPO, ".ana", "d2", name, "settle-g-1"))).toContain("labels.json");
  });
});

describe("a campaign tool where the table names more than the action", () => {
  const passing = () => scriptedSeats({ held: { old: "none", fresh: "pass" }, starter: "none" }, GRADED, []);

  it("repeats a step on the harness that reading froze, whatever harness/ holds since, and promotes it", async () => {
    layOutPack(root, bundle, TASKS, FIXTURE);
    const name = `${STEM}-repeat`;
    const seats: Seats = {
      seated: builderScript(passing(), [
        CHANGE_GUIDE,
        ["compare", {}],
        CHANGE_AGAIN,
        ["compare", {}],
        ["promote", {}],
        // harness/ holds the second change, which no practice solve ran: said once, and not refused.
        ["finish", { note: "The step was read twice." }],
        ["finish", { note: "The step was read twice." }],
      ]),
    };
    expect(await harnessBuilder([...seeded(name), ...FLAGS], seats)).toMatchObject({ ending: "finished" });
    const [first, repeat] = of(name, "comparison.reported");
    // Until 12 October the second comparison froze harness/ again: the edit was measured in the
    // repeat's place, the step was never read twice, and the promotion was refused.
    expect(repeat).toMatchObject({ fresh: first?.fresh, old: first?.old, reading: "step" });
    expect(of(name, "build.checkpoint")).toMatchObject([{ harness: first?.fresh }]);
    expect(of(name, "harness.promoted")).toMatchObject([{ harness: first?.fresh }]);
    expect(of(name, "build.finished").at(-1)?.harness).not.toBe(first?.fresh);
    const [, told] = said(name, "compare");
    expect(told).toContain("repeated harness");
    expect(told).toContain("changes made to harness/ since are not in it");
    // The status under the first tally says the same before the Builder asks, and what a
    // comparison of the tasks held can read: the table would have more written first.
    expect(said(name, "compare")[0]).toContain(
      "Suggested action: examine.\nComparison size: 5 held-out tasks",
    );
    expect(said(name, "compare")[0]).toContain("compare repeats harness");
    // What a move records: the comparison's id and flags, when it began and the host's load then,
    // which the page and the investigation read, and the harness a promotion named.
    const moves = of(name, MOVED);
    expect(moves.filter(({ move }) => move === "compare").map(({ session }) => session)).toEqual([
      "g-1",
      "g-2",
    ]);
    for (const move of moves.filter(({ move: made }) => made === "compare")) {
      expect(move).toMatchObject({ load: expect.any(Number), began: expect.any(String) });
      expect(move.args).toContain("--trigger");
    }
    expect(moves.find(({ move }) => move === "promote")).toMatchObject({ harness: first?.fresh });
  });

  it("promotes the harness the rule names where a later one was frozen since", async () => {
    layOutPack(root, bundle, TASKS, FIXTURE);
    const name = `${STEM}-owed`;
    const seats: Seats = {
      seated: builderScript(passing(), [
        CHANGE_GUIDE,
        ["compare", {}],
        ["compare", {}],
        CHANGE_AGAIN,
        ["compare", {}],
        ["promote", {}],
        ["finish", { note: "The earlier harness was owed its promotion." }],
      ]),
    };
    expect(await harnessBuilder([...seeded(name), ...FLAGS], seats)).toMatchObject({ ending: "finished" });
    const [first, , later] = of(name, "comparison.reported");
    expect(later?.fresh).not.toBe(first?.fresh);
    // Until 12 October the tool named the last harness frozen, which the rule refused every time.
    expect(of(name, "harness.promoted")).toMatchObject([{ harness: first?.fresh }]);
    expect(said(name, "promote")[0]).toContain("is now the campaign's reference");
  });

  it("reads the starter against a promoted reference while harness/ is that reference", async () => {
    layOutPack(root, bundle, TASKS, FIXTURE);
    const name = `${STEM}-control`;
    const seats: Seats = {
      seated: builderScript(passing(), [
        CHANGE_GUIDE,
        ["compare", {}],
        ["compare", {}],
        ["promote", {}],
        ["examine", {}],
        ["compare", {}],
        ["finish", { note: "The control was read." }],
      ]),
      examine: writer,
    };
    expect(await harnessBuilder([...seeded(name), ...FLAGS, "--exam-tasks", "6"], seats)).toMatchObject({
      ending: "finished",
    });
    const [first, , control] = of(name, "comparison.reported");
    // The table's control, as it names it: until 12 October the tool froze harness/, which was the
    // reference, the comparison was refused, and the advice stayed the same.
    expect(control).toMatchObject({ fresh: first?.old, old: first?.fresh });
    expect(of(name, "build.checkpoint")).toHaveLength(1);
    expect(said(name, "compare")[2]).toContain("the starter harness was read against it");
  });

  it("makes no second draw of a pair nothing changed in, and records no move for an action it refused", async () => {
    layOutPack(root, bundle, TASKS, FIXTURE);
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
    expect(of(name, MOVED).map(({ move }) => move)).toEqual(["accept", "prepare", "build", "compare"]);
  });

  it("tells the Builder the same whichever held-out task was won", async () => {
    layOutPack(root, bundle, TASKS, FIXTURE);
    /** Everything the Builder read from its tools in a campaign whose two comparisons tied the
     *  tasks `ties` names, by comparison, with the host's clock taken out. */
    const read_ = async (name: string, ties: Readonly<Record<string, string>>): Promise<string> => {
      const answering = passing();
      const silent = scriptedSeats({ held: { old: "none", fresh: "none" }, starter: "none" }, GRADED, []);
      const seats: Seats = {
        seated: (campaign, given) => {
          const [won, tie] = [answering(campaign, given), silent(campaign, given)];
          return {
            ...won,
            builder: scripted([
              CHANGE_GUIDE,
              ["compare", {}],
              ["compare", {}],
              ["campaign_status", {}],
              ["read_opening", {}],
              ["finish", { note: "Read twice." }],
            ]),
            solve: (task, harness, kill, comparison) =>
              (ties[comparison ?? ""] === task.taskId ? tie : won).solve(task, harness, kill, comparison),
          };
        },
      };
      expect(await harnessBuilder([...seeded(name), ...FLAGS], seats)).toMatchObject({ ending: "finished" });
      expect(of(name, "comparison.reported").map(({ scored }) => scored)).toMatchObject([
        { wins: 4, losses: 0, ties: 1 },
        { wins: 4, losses: 0, ties: 1 },
      ]);
      return of(name, CALLED)
        .map(({ tool, text }) => `${isString(tool) ? tool : ""}: ${isString(text) ? text : ""}`)
        .join("\n")
        .replaceAll(/\d+:\d\d of/gu, "0:00 of");
    };
    // One campaign ties the same task twice, so that no answer to it is on record and it waits for
    // a label; the other ties a different task each time, and none waits. The tallies are the
    // same. Until 12 October the status counted the tasks waiting for a label and the exhausted
    // ones, and the two campaigns read differently (rule 3).
    const same = await read_(`${STEM}-won-one`, { "g-1": "t-2", "g-2": "t-2" });
    const moved = await read_(`${STEM}-won-other`, { "g-1": "t-2", "g-2": "t-4" });
    expect(moved).toBe(same);
    expect(same).toContain("4 won, 0 lost, 1 tied");
  });
});

describe("who makes a campaign's moves, as its opening keeps it", () => {
  it("opens a campaign led by its Builder, records nothing of the term for one the host runs, and keeps either when run again", () => {
    const logOf = (name: string) => join(root, "terms", name, LOG_FILE);
    const flags = (...more: string[]) =>
      flagsOf(["--root", root, "--name", "terms", "--project", PROJECT, ...more]);
    const led = logOf("led");
    expect(opened(led, flags(), "scripted").led).toBe(true);
    expect(opened(led, flags(), "scripted").led).toBe(true);
    expect(read(led).map(({ data }) => data.led)).toEqual([true]);
    // The record of a campaign the host runs is a record from before the term, key for key: run
    // again by a command that names nothing, either is the host's, and nothing is recorded again.
    const hosted = logOf("hosted");
    expect(opened(hosted, flags("--no-builder-led"), "scripted").led).toBe(false);
    expect(read(hosted)[0]?.data).not.toHaveProperty("led");
    expect(opened(hosted, flags(), "scripted").led).toBe(false);
    expect(read(hosted)).toHaveLength(1);
    // The operator's flag hands the campaign over, on record.
    expect(opened(hosted, flags("--builder-led"), "scripted").led).toBe(true);
    expect(read(hosted).at(-1)?.data).toMatchObject({ led: true });
  });
});

describe("a campaign's endings", () => {
  const passing = () => scriptedSeats({ held: { old: "none", fresh: "pass" }, starter: "none" }, GRADED, []);

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
      ]),
    };
    // Until 12 October the command returned the table's next move there and wrote no ending.
    expect(await harnessBuilder([...seeded(name), ...FLAGS, "--turns", "3"], seats)).toMatchObject({
      move: "end",
      ending: "finished",
    });
    expect(of(name, "build.finished").map(({ session, ended }) => [session, ended])).toEqual([
      ["b-1", "turns"],
      ["b-2", "finished"],
    ]);
    expect(of(name, "comparison.reported")).toMatchObject([
      { fresh: of(name, "build.finished")[0]?.harness },
    ]);
    expect(of(name, "campaign.ended")).toMatchObject([{ ending: "finished" }]);
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
      ]),
    };
    // Until 13 October the refusal was the environment's ending, and the command threw.
    expect(await harnessBuilder([...seeded(name), ...FLAGS], seats)).toMatchObject({ ending: "finished" });
    expect(of(name, "build.finished").map(({ session, ended }) => [session, ended])).toEqual([
      ["b-1", "crashed"],
      ["b-2", "finished"],
    ]);
    expect(of(name, "campaign.ended")).toMatchObject([{ ending: "finished" }]);
    // None of three conversations changed a harness: the table's crash rule ends the campaign.
    const failing = `${STEM}-crashes`;
    const none: Seats = { seated: builderScripts(passing(), []) };
    expect(await harnessBuilder([...seeded(failing), ...FLAGS], none)).toMatchObject({
      move: "end",
      ending: "environment",
    });
    expect(of(failing, "build.finished").map(({ ended }) => ended)).toEqual([
      "crashed",
      "crashed",
      "crashed",
    ]);
    // Nor does a conversation that edited and then crashed leave a harness to go on from.
    const editing = `${STEM}-edits`;
    const edits: Seats = {
      seated: builderScripts(passing(), [[CHANGE_GUIDE], [CHANGE_GUIDE], [CHANGE_GUIDE]]),
    };
    expect(await harnessBuilder([...seeded(editing), ...FLAGS], edits)).toMatchObject({
      move: "end",
      ending: "environment",
    });
    expect(of(editing, "build.finished")).toHaveLength(3);
  });

  it("goes on with a new conversation when run again after the Builder finished", async () => {
    layOutPack(root, bundle, TASKS, FIXTURE);
    const name = `${STEM}-again`;
    const seats: Seats = {
      seated: builderScripts(passing(), [
        [["finish", { note: "Too early." }]],
        [CHANGE_GUIDE, ["compare", {}], ["finish", { note: "Measured now." }]],
      ]),
    };
    const args = [...seeded(name), ...FLAGS];
    expect(await harnessBuilder(args, seats)).toMatchObject({ ending: "finished" });
    expect(of(name, "comparison.started")).toEqual([]);
    // Until 12 October a campaign its Builder had finished started nothing again, whatever was left.
    expect(await harnessBuilder(args, seats)).toMatchObject({ ending: "finished" });
    expect(of(name, "build.started")).toHaveLength(2);
    expect(of(name, "comparison.reported")).toHaveLength(1);
    expect(of(name, "campaign.ended")).toHaveLength(2);
  });

  it("ends on an exam whose checks wait for the operator's word, and prints the command that gives it with the pack's flags", async () => {
    layOutPack(root, bundle, TASKS, FIXTURE);
    const name = `${STEM}-admit`;
    const flags = seeded(name).slice(0, -2);
    const seats: Seats = { seated: passing() };
    const printed = spyOn(console, "log");
    const ending = await harnessBuilder(flags, seats);
    const lines = printed.mock.calls.map(([line]) => (isString(line) ? line : ""));
    printed.mockRestore();
    expect(ending).toMatchObject({ move: "end", ending: "exam" });
    // Run as printed, the command opens the campaign's pack: on 9 October the line named the
    // campaign alone, and over a stored pack that run threw for want of the four flags.
    const admit = lines
      .find((line) => line.startsWith("to admit"))
      ?.split(": bun tools/d2/harness-builder.ts ")[1];
    expect(admit).toBe(`${flags.slice(0, -2).join(" ")} --admit check-product`);
    // The reading printed its fault as it was made; the ending does not print it a second time.
    expect(lines.filter((line) => line.startsWith("fault: "))).toHaveLength(1);
    const next = await harnessBuilder([...(admit ?? "").split(" "), "--dry-run"], seats);
    expect(next).toMatchObject({ move: "accept" });
  });
});

describe("campaign handover", () => {
  it("keeps harness links as links and refuses a copied guide that points outside", async () => {
    layOutPack(root, bundle, TASKS, FIXTURE);
    const name = `${STEM}-links`;
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
