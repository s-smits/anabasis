// The Harness Builder's controller over a fixture pack, with a script in each model seat: a
// campaign run from set-up to an ending on one command (`tools/d2/harness-builder.ts`). The exam's
// reading, the task sets, each Builder session's wall and freeze, each solve's wall and the
// comparison are the real ones; the seats are scripts, which are paid nothing.

import { afterAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { draftExam } from "../src/examiner/draft.ts";
import { examine } from "../src/examiner/session.ts";
import { type LogEvent, read } from "../src/kernel/log.ts";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { isString, type JsonObject } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join, resolve } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { openCampaign } from "../tools/d2/campaign.ts";
import { closeCommand } from "../tools/d2/close.ts";
import { harnessBuilder, type Seats } from "../tools/d2/harness-builder.ts";
import { wordCommand } from "../tools/d2/word.ts";
import { scriptedSeats } from "../tools/runs/rehearse.ts";

const REPO = resolve(import.meta.dir, "..");
const FIXTURE = join(REPO, "test", "fixtures", "harness-min");
const STEM = `test-hb-${String(runtimeProcess.pid)}`;
const FORMAT = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] };
const TASKS = Array.from({ length: 7 }, (_, index) => ({
  taskId: `t-${String(index + 1)}`,
  family: "fixture",
  publicInput: { base: index + 2 },
  hidden: null,
}));
const TOOL_USE = { stopReason: "toolUse" } as const;
const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-hb-")));
const bundle = join(root, "bundle");
const names: string[] = [];

setDefaultTimeout(600_000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  for (const name of names) rmSync(join(REPO, ".ana", "d2", name), { recursive: true, force: true });
});

/** A stored sweep and its pack as v1 left one: seven tasks whose answer is the base times six, one
 *  check, and a control of each kind. */
function layOut(): void {
  const model = join(bundle, "correctness-model");
  mkdirSync(join(root, "grades", "s"), { recursive: true });
  const graded = TASKS.map(({ taskId }) => ["1", taskId, "verified-pass", ""].join("\t"));
  writeFileSync(
    join(root, "grades", "s", "grades.tsv"),
    `${["cycle\ttaskId\tkind\tblockingChecks", ...graded].join("\n")}\n`,
  );
  for (const { taskId, publicInput } of TASKS) {
    const dir = join(root, "runs", "s", "c01", taskId);
    const caseDir = join(dir, "harness", "cases", taskId);
    mkdirSync(caseDir, { recursive: true });
    mkdirSync(join(dir, "work"), { recursive: true });
    const stored = {
      provider: "claude",
      model: "claude-opus-5-5",
      timedOut: false,
      answerPresent: true,
      answerParses: true,
    };
    writeFileSync(join(dir, "result.json"), JSON.stringify(stored));
    writeFileSync(join(dir, "work", "answer.json"), JSON.stringify({ answer: String(publicInput.base * 6) }));
    const ended = { status: "ended", inputTokens: 1, outputTokens: 1, costUsd: 0.01 };
    writeFileSync(join(caseDir, "trace.json"), JSON.stringify({ turns: [ended] }));
    writeFileSync(
      join(caseDir, "built-runtime.json"),
      JSON.stringify({
        modelWorker: { modelSelection: { effort: "medium" } },
        contractCondition: {
          tools: [{ description: "Role: artifact-writer. Records.", parameters: FORMAT }],
        },
      }),
    );
  }
  cpSync(FIXTURE, join(root, "hb-bundles", "s-c01"), { recursive: true });
  mkdirSync(model, { recursive: true });
  mkdirSync(join(bundle, ".toolchain", "bin"), { recursive: true });
  const execution = {
    families: "all",
    artifactPaths: ["$.answer"],
    publicInputPaths: ["$.base"],
    hidden: "none",
    evidence: { kind: "authored" },
  };
  writeFileSync(
    join(model, "brief.json"),
    JSON.stringify({
      correctnessContract: "check-program/v1",
      domain: "Fixture",
      ruleDecisions: [{ id: "R1", statement: "The answer is the base times six.", visibility: "public" }],
      truthChecks: [{ id: "check-product", assertion: "Six times.", citedDecisionIds: ["R1"], execution }],
      artifactSchema: [],
      designRuleConstants: [],
    }),
  );
  writeFileSync(
    join(model, "evaluator.ts"),
    `export const checks = {\n  "check-product": (req) => req.artifact.answer === String(req.publicTask.publicInput.base * 6),\n};\n`,
  );
  writeFileSync(join(model, "tasks.json"), JSON.stringify(TASKS));
  writeFileSync(
    join(model, "controls.json"),
    JSON.stringify({
      accept: TASKS.map(({ taskId, publicInput }) => ({
        taskId,
        artifact: { answer: String(publicInput.base * 6) },
      })),
      reject: [{ taskId: "t-1", artifact: { answer: "13" }, expectedCheckId: "check-product" }],
    }),
  );
}

/** A campaign's folder marked as a seed, which is where a scripted solve may be written, and the
 *  flags that name it. */
function seeded(name: string): string[] {
  names.push(name);
  const folder = join(REPO, ".ana", "d2", name);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "seed.json"), `${JSON.stringify({ from: null, events: 0 })}\n`);
  // The fixture's one check is its author's own arithmetic, which stands on the operator's word.
  const admitted = ["--admit", "check-product"];
  return ["--root", root, "--sweep", "s", "--cycle", "c01", "--bundle", bundle, "--name", name, ...admitted];
}

/** A model that makes `calls` in order, a turn each. */
function scripted(calls: readonly (readonly [string, JsonObject])[]) {
  const faux = fauxProvider({
    models: [
      { id: "script", contextWindow: 200_000, cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 } },
    ],
  });
  faux.setResponses(calls.map(([name, args]) => fauxAssistantMessage(fauxToolCall(name, args), TOOL_USE)));
  const models = createModels();
  models.setProvider(faux.provider);
  return { model: faux.getModel(), models: () => models };
}

/** The pack's controls, as a rehearsal's solves are scripted from them. */
const GRADED = TASKS.map(({ taskId, publicInput }) => ({
  taskId,
  answer: { answer: String(publicInput.base * 6) },
  refusedBy: null,
}));

/** What a campaign's log holds of one kind, in order. */
const of = (name: string, kind: string): JsonObject[] =>
  read(join(REPO, ".ana", "d2", name, "log.jsonl")).flatMap((event: LogEvent) =>
    event.kind === kind ? [event.data] : [],
  );

describe("a campaign run by its log", () => {
  it("runs from set-up to the stop rule's ending on one command, with every move on record", async () => {
    layOut();
    const name = `${STEM}-idle`;
    const flags = seeded(name);
    const strayed: string[] = [];
    const solves = scriptedSeats({ held: { old: "none", fresh: "pass" }, starter: "none" }, GRADED, strayed);
    // A Builder that finishes with the harness as it was: three such sessions are the stop rule.
    const seats: Seats = {
      seated: (campaign, given) => ({
        ...solves(campaign, given),
        builder: scripted([["finish", { note: "Nothing to change." }]]),
      }),
    };
    // The host is loaded at the first two looks: a move that solves waits, and the others do not.
    const looks: number[] = [];
    const host = {
      load: () => {
        looks.push(looks.length);
        return looks.length <= 2 ? 99 : 0;
      },
      cores: 4,
      waitMs: 1,
    };
    // A dry run names the first move and writes nothing.
    expect(await harnessBuilder([...flags, "--dry-run"], seats)).toMatchObject({ move: "accept" });
    expect(of(name, "campaign.opened")).toEqual([]);

    const ending = await harnessBuilder([...flags, "--practice", "2"], { ...seats, host });
    // Reading the exam and setting the tasks apart asked the host nothing. The first session
    // looked three times: twice at a loaded host, where it said so and waited, and once at a
    // quiet one. The two sessions after it looked once each.
    expect(looks).toHaveLength(5);
    expect(ending).toEqual({
      move: "end",
      ending: "stop",
      why: "3 moves in a row could have shown a gain and showed none: the plan stops the campaign at three",
    });
    // The exam was read, the tasks set apart, and three sessions ran, each from the starter.
    expect(of(name, "campaign.move").map(({ move, session }) => [move, session ?? null])).toEqual([
      ["accept", null],
      ["prepare", null],
      ["build", "b-1"],
      ["build", "b-2"],
      ["build", "b-3"],
    ]);
    expect(of(name, "checker.read")).toHaveLength(1);
    expect(of(name, "build.finished").map(({ changed }) => changed)).toEqual([false, false, false]);
    expect(of(name, "solve.started")).toEqual([]);
    // It runs by what it was opened with: no budget under a rehearsal's seats, and no limit named.
    expect(of(name, "campaign.opened")).toEqual([
      {
        budget: null,
        limit: null,
        ladder: [],
        sessions: 3,
        seats: { builder: null, examiner: null, reviewer: null },
        terms: { practice: "2" },
      },
    ]);
    // The ending is the log's last event, and run again the command says it and adds nothing.
    const log = read(join(REPO, ".ana", "d2", name, "log.jsonl"));
    expect(log.at(-1)).toMatchObject({
      kind: "campaign.ended",
      data: { ending: "stop", reference: "starter" },
    });
    expect(await harnessBuilder(flags, seats)).toMatchObject({ move: "end", ending: "stop" });
    expect(read(join(REPO, ".ana", "d2", name, "log.jsonl"))).toHaveLength(log.length);
    // Past the stop rule on the operator's reason, one more session runs.
    const past = await harnessBuilder([...flags, "--past-stop", "a path test", "--moves", "1"], seats);
    expect(past).toMatchObject({ move: "build" });
    // A rehearsal's seats are exempt from the admission, which is where a paid session's override
    // is logged: here the session runs, and the log holds its move.
    expect(of(name, "campaign.move").at(-1)).toMatchObject({ move: "build", session: "b-4" });
    expect(strayed).toEqual([]);
  });

  it("compares a step again, waits for the operator's word to promote it, and then has tasks written", async () => {
    const name = `${STEM}-climb`;
    const flags = [...seeded(name), "--practice", "2", "--solves", "1", "--sessions", "1"];
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
        ]);
        return examine({ ...request, ...script });
      },
    };
    // Set-up, one session, the comparison and its repeat: then the promotion is the operator's.
    const waits = await harnessBuilder(flags, seats);
    expect(waits).toMatchObject({ move: "promote" });
    expect(of(name, "campaign.move").map(({ move, session }) => [move, session ?? null])).toEqual([
      ["accept", null],
      ["prepare", null],
      ["build", "b-1"],
      ["compare", "g-1"],
      ["compare", "g-2"],
    ]);
    const [first, repeat] = of(name, "comparison.reported");
    expect(first).toMatchObject({ reading: "step", scored: { wins: 5, losses: 0, ties: 0 } });
    expect(repeat).toMatchObject({ reading: "step", old: first?.old, fresh: first?.fresh });
    // Both read the reference against itself beside the test, as a repeat does and a setting's first.
    expect(of(name, "comparison.started").map(({ noise }) => noise)).toEqual([true, true]);
    expect(of(name, "harness.promoted")).toEqual([]);

    // With the word given once for the campaign, the harness is promoted. No budget leaves the
    // promoted harness failing half its solves, so the tasks have to change: an Examiner session.
    const next = await harnessBuilder([...flags, "--unattended", "--moves", "2"], seats);
    expect(of(name, "harness.promoted")).toMatchObject([{ harness: first?.fresh }]);
    expect(of(name, "campaign.move").slice(5)).toMatchObject([
      { move: "promote", harness: first?.fresh },
      { move: "examine", session: "x-1" },
    ]);
    expect(of(name, "exam.finished")).toMatchObject([{ session: "x-1", proposed: 3 }]);
    // Against the new reference nothing is built yet: the Builder builds.
    expect(next).toMatchObject({ move: "build" });
    expect(strayed).toEqual([]);

    // What the campaign hands over: the promoted harness as a folder that stands by itself, the
    // public rules, and the closing report. It is written outside the repository and once.
    const pack = ["--root", root, "--sweep", "s", "--cycle", "c01", "--bundle", bundle, "--name", name];
    const to = join(root, "handover");
    expect(closeCommand([...pack, "--to", join(REPO, ".ana", "handover")])).rejects.toThrow(
      "lies inside the repository",
    );
    const handed = await closeCommand([...pack, "--to", to]);
    expect(handed.to).toBe(to);
    expect(of(name, "harness.promoted")).toMatchObject([{ harness: handed.harness }]);
    expect(closeCommand([...pack, "--to", to])).rejects.toThrow("holds something already");
    // It holds no link: a kept harness names its programs by one, into a tree beside it, and what
    // is handed over is the files themselves.
    const links = readdirSync(join(to, "harness"), { recursive: true }).filter((entry) =>
      lstatSync(join(to, "harness", String(entry))).isSymbolicLink(),
    );
    expect(links).toEqual([]);
    expect(readFileSync(join(to, "harness", "agent", "BUILT_AGENTS.md"), "utf8")).toContain(
      "A rehearsal added this line.",
    );
    expect(readFileSync(join(to, "RULES.md"), "utf8")).toContain("- R1: The answer is the base times six.");
    const report = readFileSync(join(to, "REPORT.md"), "utf8");
    expect(report).toContain(`harness ${handed.harness.slice(0, 8)}, read by g-1 and g-2`);
    expect(report).toContain("| g-1 |");
    expect(report).toContain("The campaign has not ended");
    // No task is named in it, and no check.
    expect(report).not.toContain("t-1");
    expect(report).not.toContain("check-product");

    // The harness solves a task from where it was handed over, outside the campaign's folder.
    const campaign = await openCampaign({ root, sweep: "s", cycle: "c01", bundle, name });
    const seat = scriptedSeats(
      { held: { old: "none", fresh: "pass" }, starter: "none" },
      GRADED,
      strayed,
    )(campaign, { builder: undefined, reference: join(root, "no-such-harness") });
    const task = [...campaign.packages().values()].find(({ taskId }) => taskId === "t-1");
    if (task === undefined) throw new Error("the pack holds no t-1");
    const solved = await seat.solve(task, { dir: join(to, "harness"), digest: handed.harness }, undefined);
    expect(solved.ending).toEqual({ outcome: "pass" });
    expect(strayed).toEqual([]);
  });

  it("reads a word the operator left during a comparison at the next move, and changes nothing in the comparison", async () => {
    const name = `${STEM}-word`;
    const flags = [...seeded(name), "--practice", "2", "--solves", "1", "--sessions", "1"];
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
      { session: "g-1", reading: "step", scored: { wins: 5, losses: 0, ties: 0 } },
    ]);
    expect(stopped).toMatchObject({
      move: "end",
      ending: "operator",
      why: "the operator's word: enough for today",
    });
    const log = read(join(REPO, ".ana", "d2", name, "log.jsonl"));
    const at = log.findIndex(({ kind }) => kind === "campaign.word");
    expect(log.at(-1)).toMatchObject({ kind: "campaign.ended", data: { ending: "operator", answers: [at] } });
    expect(of(name, "campaign.move").map(({ move }) => move)).toEqual([
      "accept",
      "prepare",
      "build",
      "compare",
    ]);

    // Run again, the campaign goes on: the word was heard once. A word for other tasks and one
    // for another total are each acted on at the next move, and named by what acted on them.
    expect(await harnessBuilder([...flags, "--moves", "0"], seats)).toMatchObject({ move: "compare" });
    wordCommand(["--name", name, "--budget", "50"]);
    wordCommand(["--name", name, "--tasks", "the step was too easy"]);
    expect(await harnessBuilder([...flags, "--moves", "0"], seats)).toMatchObject({
      move: "examine",
      why: "the operator asked for other tasks: the step was too easy",
    });
    expect(of(name, "campaign.opened").at(-1)).toMatchObject({ budget: { dollars: 50 } });
    // No word is left for a campaign that has no opening, and none that names two things.
    expect(() => wordCommand(["--name", `${name}-none`, "--stop", "x"])).toThrow("has no opening on record");
    expect(() => wordCommand(["--name", name, "--stop", "x", "--budget", "5"])).toThrow("one word");
    expect(strayed).toEqual([]);
  });

  it("sets the budget by the rule where the reference left no room, and compares again under it", async () => {
    const name = `${STEM}-budget`;
    const limits = ["--solve-model-turns", "8", "--ladder", "4,1"];
    const flags = [...seeded(name), "--practice", "2", "--solves", "1", "--sessions", "1", ...limits];
    const strayed: string[] = [];
    // Every harness answers every task, in two of the model's turns: no room at eight or at four.
    const seats: Seats = {
      seated: scriptedSeats({ held: { old: "pass", fresh: "pass" }, starter: "pass" }, GRADED, strayed),
    };
    const next = await harnessBuilder([...flags, "--moves", "8"], seats);
    expect(
      of(name, "campaign.move").map(({ move, session, modelTurns }) => [move, session ?? modelTurns ?? null]),
    ).toEqual([
      ["accept", null],
      ["prepare", null],
      ["build", "b-1"],
      ["compare", "g-1"],
      ["budget", 1],
      ["compare", "g-2"],
      ["budget", 4],
      ["compare", "g-3"],
    ]);
    // The first comparison ran at the full limit and was read at each shorter budget of the ladder:
    // the reference answered every task at eight turns and at four, and none at one.
    const [first, second, third] = of(name, "comparison.reported");
    expect(first).toMatchObject({
      reading: "no-step",
      valid: { old: [0, 5] },
      budgets: [
        { turns: 4, valid: { old: [0, 5] } },
        { turns: 1, valid: { old: [5, 0] } },
      ],
    });
    // The rule took one turn, the setting was recorded again, and the second comparison ran under it.
    expect(second).toMatchObject({ reading: "no-step", valid: { old: [5, 0], fresh: [5, 0] }, budgets: [] });
    // At one turn nobody answers, and at four the first reading left no room: no budget of the
    // ladder leaves room. The campaign stands at four turns, where a solver can answer, and its
    // comparison there shows the same: the tasks have to change.
    expect(of(name, "campaign.setting").map(({ modelTurns }) => modelTurns)).toEqual([8, 1, 4]);
    expect(third).toMatchObject({ reading: "no-step", valid: { old: [0, 5], fresh: [0, 5] } });
    expect(next).toMatchObject({ move: "examine", room: true });
    // What strayed from its script is the second comparison alone: each of its solves, scripted to
    // answer in two turns, was ended by the budget of one.
    expect(strayed).toHaveLength(15);
    expect(strayed.every((line) => line.includes('"kind":"turns-ended"'))).toBe(true);
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
    const flags = ["--name", name, ...solver, ...terms];
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
      taskId: `ex-00${String(index + 1)}`,
      answer: { answer: String(publicInput.base * 6) },
      refusedBy: null,
    }));
    const seats: Seats = {
      seated: scriptedSeats({ held: { old: "none", fresh: "pass" }, starter: "none" }, examples, strayed),
      draft: (request) =>
        draftExam({
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
    expect(existsSync(join(folder, "log.jsonl"))).toBe(false);

    // A campaign that opens from a prompt has no folder before its opening, which makes one.
    const fresh = `${STEM}-fresh`;
    names.push(fresh);
    expect(existsSync(join(REPO, ".ana", "d2", fresh))).toBe(false);
    const opened = [
      "--name",
      fresh,
      "--solver",
      "claude/claude-opus-5-5",
      "--prompt",
      prompt,
      "--moves",
      "0",
    ];
    expect(await harnessBuilder(opened, seats)).toMatchObject({ move: "draft" });
    expect(of(fresh, "campaign.opened")).toMatchObject([{ prompt }]);

    // The Examiner drafts, the host reads each draft without a model, and the second stands. Its
    // one check is its author's own computation, so the campaign waits for the operator's word.
    const waits = await harnessBuilder([...flags, "--prompt", prompt], seats);
    expect(waits).toMatchObject({ move: "end", ending: "exam" });
    expect(of(name, "campaign.opened")).toMatchObject([
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
    expect(of(name, "campaign.move").map(({ move, session }) => [move, session ?? null])).toEqual([
      ["draft", "d-1"],
      ["accept", null],
    ]);

    // With that word, by its name alone: the exam is read again, its tasks are set apart, a
    // Builder builds, and the two harnesses are compared on the tasks the draft gave. Every move
    // runs by the terms the campaign was opened with, which this command does not name: the
    // second campaign from a prompt, continued so, ran each by its default (2026-10-09).
    const next = await harnessBuilder(["--name", name, "--admit", "check-product", "--moves", "4"], seats);
    expect(of(name, "campaign.opened")).toHaveLength(1);
    expect(of(name, "campaign.setting")).toMatchObject([{ minutes: 8 }]);
    expect(of(name, "task.state").filter(({ state }) => state === "released")).toHaveLength(2);
    expect(of(name, "comparison.started")).toMatchObject([{ solves: 1 }]);
    expect(
      of(name, "campaign.move")
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
      { reading: "step", scored: { wins: 5, losses: 0, ties: 0 } },
    ]);
    expect(next).toMatchObject({ move: "compare", noise: true });
    expect(strayed).toEqual([]);

    // A term named again is recorded again, and a flag that names another setting than the
    // campaign's is refused with both.
    await harnessBuilder(["--name", name, "--practice-solves", "3", "--moves", "0"], seats);
    expect(of(name, "campaign.opened").at(-1)).toMatchObject({
      terms: { practice: "2", solves: "1", "solve-minutes": "8", "practice-solves": "3" },
    });
    expect(harnessBuilder(["--name", name, "--solve-minutes", "30", "--moves", "0"], seats)).rejects.toThrow(
      "--solve-minutes 30 names another setting than the campaign's, which was recorded as --solve-minutes 8",
    );
    expect(of(name, "campaign.opened")).toHaveLength(2);
  });
});
