// The Harness Builder's controller over a fixture pack, with a script in each model seat: a
// campaign run from set-up to an ending on one command (`tools/d2/harness-builder.ts`). The exam's
// reading, the task sets, each Builder session's wall and freeze, each solve's wall and the
// comparison are the real ones; the seats are scripts, which are paid nothing.

import { afterAll, describe, expect, it, setDefaultTimeout, spyOn } from "bun:test";
import { draftExam } from "../src/examiner/draft.ts";
import { examine } from "../src/examiner/session.ts";
import { type LogEvent, read } from "../src/kernel/log.ts";
import {
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
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import { isString, type JsonObject } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join, resolve } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { closeCommand } from "../tools/d2/close.ts";
import { settleCommand } from "../tools/d2/settle.ts";
import { harnessBuilder, type Seats } from "../tools/d2/harness-builder.ts";
import { wordCommand } from "../tools/d2/word.ts";
import { scriptedSeats } from "../tools/runs/rehearse.ts";
import { FORMAT, fixtureTasks, gradedOf, layOutPack, scriptedModel } from "./helpers/fixture-pack.ts";

const REPO = resolve(import.meta.dir, "..");
const FIXTURE = join(REPO, "test", "fixtures", "harness-min");
const STEM = `test-hb-${String(runtimeProcess.pid)}`;
const TASKS = fixtureTasks(7);
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
function seeded(name: string): string[] {
  names.push(name);
  const folder = join(REPO, ".ana", "d2", name);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "seed.json"), `${JSON.stringify({ from: null, events: 0 })}\n`);
  // The fixture's one check is its author's own arithmetic, which stands on the operator's word.
  const admitted = ["--admit", "check-product"];
  return ["--root", root, "--sweep", "s", "--cycle", "c01", "--bundle", bundle, "--name", name, ...admitted];
}

/** What a campaign's log holds of one kind, in order. */
const of = (name: string, kind: string): JsonObject[] =>
  read(join(REPO, ".ana", "d2", name, "log.jsonl")).flatMap((event: LogEvent) =>
    event.kind === kind ? [event.data] : [],
  );

describe("a campaign run by its log", () => {
  it("runs from set-up to an ending on one command, with every move on record: a session with nothing to work on sends it to the Examiner", async () => {
    layOutPack(root, bundle, TASKS, FIXTURE);
    const name = `${STEM}-idle`;
    // A patience of two, so that the ending is reached in two idle Examiner sessions.
    const flags = [...seeded(name), "--patience", "2"];
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
      examine: (request) => examine({ ...request, ...scripted([["finish", { note: "Nothing to add." }]]) }),
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
    // Reading the exam and setting the tasks apart asked the host nothing. The one session
    // looked three times: twice at a loaded host, where it said so and waited, and once at a
    // quiet one. An Examiner session solves nothing and looks not at all.
    expect(looks).toHaveLength(3);
    expect(ending).toEqual({
      move: "end",
      ending: "no-room",
      why: "2 Examiner sessions in a row held out no task (Builder session b-1 left its harness as it was, and no practice solve of its failed: it had nothing to work on, so the tasks have to change before another session is paid for): the tasks could not be made to leave room",
    });
    expect(of(name, "campaign.move").map(({ move, session }) => [move, session ?? null])).toEqual([
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
    expect(of(name, "campaign.opened")).toEqual([
      {
        budget: null,
        limit: null,
        ladder: [],
        sessions: 3,
        patience: 2,
        seats: { builder: null, examiner: null, reviewer: null },
        terms: { practice: "2" },
      },
    ]);
    // The ending is the log's last event, and run again the command says it and adds nothing.
    const log = read(join(REPO, ".ana", "d2", name, "log.jsonl"));
    expect(log.at(-1)).toMatchObject({
      kind: "campaign.ended",
      data: { ending: "no-room", reference: "starter" },
    });
    expect(await harnessBuilder(flags, seats)).toMatchObject({ move: "end", ending: "no-room" });
    expect(read(join(REPO, ".ana", "d2", name, "log.jsonl"))).toHaveLength(log.length);
    expect(strayed).toEqual([]);
  });

  it("ends on an exam whose checks wait for the operator's word, and prints the command that gives it with the pack's flags", async () => {
    const name = `${STEM}-admit`;
    const flags = seeded(name).slice(0, -2);
    const seats: Seats = {
      seated: scriptedSeats({ held: { old: "none", fresh: "pass" }, starter: "none" }, GRADED, []),
    };
    const said = spyOn(console, "log");
    const ending = await harnessBuilder(flags, seats);
    const lines = said.mock.calls.map(([line]) => (isString(line) ? line : ""));
    said.mockRestore();
    expect(ending).toMatchObject({ move: "end", ending: "exam" });
    // Run as printed, the command opens the campaign's pack: on 9 October the line named the
    // campaign alone, and over a stored pack that run threw for want of the four flags.
    const printed = lines
      .find((line) => line.startsWith("to admit"))
      ?.split(": bun tools/d2/harness-builder.ts ")[1];
    expect(printed).toBe(`${flags.join(" ")} --admit check-product`);
    const next = await harnessBuilder([...(printed ?? "").split(" "), "--dry-run"], seats);
    expect(next).toMatchObject({ move: "accept" });
  });

  it("compares a step again, waits for the operator's word to promote it, and then has tasks written", async () => {
    const name = `${STEM}-climb`;
    // The seed holds five tasks to score once two are released, and the comparison scores five:
    // the row that writes tasks up to the target is tested in `test/decide.test.ts`.
    const flags = [...seeded(name), "--practice", "2", "--solves", "1", "--sessions", "1", "--target", "5"];
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
    // The setting's first comparison read the reference against itself beside the test, and that
    // reading stands for the repeat, which solves the two harnesses alone.
    expect(of(name, "comparison.started").map(({ noise }) => noise)).toEqual([true, false]);
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
    // The tasks written are read by a control before a Builder session is paid for: the starter
    // against the promoted harness, with the reference against itself, since tasks were held out
    // since it was last read so. Until 10 October the Builder built here, three times, on
    // practice the promoted harness passed (t-4, t-9, t-10).
    expect(next).toMatchObject({ move: "compare", fresh: "starter", reference: "promoted", noise: true });
    const after = await harnessBuilder([...flags, "--unattended", "--moves", "1"], seats);
    expect(of(name, "comparison.started").at(-1)).toMatchObject({
      session: "g-3",
      fresh: first?.starter,
      old: first?.fresh,
      noise: true,
    });
    // The script answers nothing under the reference nor the starter, so the control reads the new
    // tasks as beyond both, and the table has other tasks written rather than a harness built.
    expect(of(name, "comparison.reported").at(-1)).toMatchObject({ session: "g-3", reading: "no-step" });
    expect(after).toMatchObject({ move: "examine" });
    expect(after.why).toContain("neither harness was valid on one solve in four");
    expect(strayed).toEqual([]);

    // A person reads two of the answers that passed in g-1: the draw is by the comparison's id, so
    // asked again it is the same two; the labels are recorded once a label stands on each, and
    // once only. g-1 held 5 passes, the new harness's, and the noise arm's are the reference's,
    // which answered none.
    const pack = ["--root", root, "--sweep", "s", "--cycle", "c01", "--bundle", bundle, "--name", name];
    const passes = join(REPO, ".ana", "d2", name, "settle-g-1", "passes", "passes.json");
    await settleCommand([...pack, "--session", "g-1", "--passes", "2"]);
    const drawn = Object.keys(parseJsonAs<JsonObject>(readFileSync(passes, "utf8")));
    expect(drawn).toHaveLength(2);
    rmSync(passes);
    await settleCommand([...pack, "--session", "g-1", "--passes", "2"]);
    expect(Object.keys(parseJsonAs<JsonObject>(readFileSync(passes, "utf8")))).toEqual(drawn);
    expect(
      readFileSync(join(REPO, ".ana", "d2", name, "settle-g-1", "passes", `${drawn[0]}.json`), "utf8"),
    ).toContain('"rules"');
    writeFileSync(passes, JSON.stringify({ [drawn[0] ?? ""]: "sound", [drawn[1] ?? ""]: "wrng" }));
    expect(settleCommand([...pack, "--session", "g-1", "--passes", "2"])).rejects.toThrow(
      "holds what is no label (sound, wrong, unclear) for 1 answer",
    );
    writeFileSync(passes, JSON.stringify({ [drawn[0] ?? ""]: "sound", [drawn[1] ?? ""]: "" }));
    await settleCommand([...pack, "--session", "g-1", "--passes", "2"]);
    expect(of(name, "pass.labelled")).toEqual([]);
    writeFileSync(passes, JSON.stringify({ [drawn[0] ?? ""]: "sound", [drawn[1] ?? ""]: "wrong" }));
    await settleCommand([...pack, "--session", "g-1", "--passes", "2"]);
    await settleCommand([...pack, "--session", "g-1", "--passes", "2"]);
    expect(of(name, "pass.labelled")).toMatchObject([
      { session: "g-1", of: 5, labels: { [drawn[0] ?? ""]: "sound", [drawn[1] ?? ""]: "wrong" } },
    ]);

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
    expect(readFileSync(join(to, "REPORT.md"), "utf8")).toContain(
      "a person read 2 of the 5 in 1 comparison, drawn by each comparison's id: 1 sound, 1 wrong, 0 unclear",
    );
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
    // The step is named with the budget it was read at and the reading at the full limit beside it.
    expect(report).toContain(
      `harness ${handed.harness.slice(0, 8)}, read by g-1 and g-2 at the full limit. At the full limit (g-2) it won 5, lost 0 and tied 0`,
    );
    expect(report).toContain("| g-1 |");
    expect(report).toContain("The campaign has not ended");
    // No task is named in it, and no check.
    expect(report).not.toContain("t-1");
    expect(report).not.toContain("check-product");

    // The harness solves a task from where it was handed over, outside the campaign's folder: the
    // solve is recorded in a log of its own under the campaign, and the campaign's log is as it was.
    const before = read(join(REPO, ".ana", "d2", name, "log.jsonl")).length;
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
    const trialled = read(join(REPO, ".ana", "d2", name, "handover", "log.jsonl"));
    expect(trialled.filter(({ kind }) => kind === "solve.finished")).toMatchObject([
      { data: { ending: { outcome: "pass" }, harness: handed.harness } },
    ]);
    expect(read(join(REPO, ".ana", "d2", name, "log.jsonl"))).toHaveLength(before);
    expect(strayed).toEqual([]);
  });

  it("reads a word the operator left during a comparison at the next move, and changes nothing in the comparison", async () => {
    const name = `${STEM}-word`;
    // The seed holds five tasks to score once two are released, and the comparison scores five:
    // the row that writes tasks up to the target is tested in `test/decide.test.ts`.
    const flags = [...seeded(name), "--practice", "2", "--solves", "1", "--sessions", "1", "--target", "5"];
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

  it("has the tasks changed where the reference left no room, and sets the budget by the rule once the Examiner's patience is spent", async () => {
    const name = `${STEM}-budget`;
    const limits = ["--solve-model-turns", "8", "--ladder", "4,1"];
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
      ...limits,
    ];
    const strayed: string[] = [];
    // Every harness answers every task, in two of the model's turns: no room at eight or at four.
    // The Examiner holds out nothing, twice, which is the campaign's patience.
    const seats: Seats = {
      seated: scriptedSeats({ held: { old: "pass", fresh: "pass" }, starter: "pass" }, GRADED, strayed),
      examine: (request) => examine({ ...request, ...scripted([["finish", { note: "Nothing to add." }]]) }),
    };
    const next = await harnessBuilder([...flags, "--moves", "10"], seats);
    expect(
      of(name, "campaign.move").map(({ move, session, modelTurns }) => [move, session ?? modelTurns ?? null]),
    ).toEqual([
      ["accept", null],
      ["prepare", null],
      ["build", "b-1"],
      ["compare", "g-1"],
      ["examine", "x-1"],
      ["examine", "x-2"],
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
    // comparison there shows the same; with the Examiner's patience already spent, it ends on
    // its room.
    expect(of(name, "campaign.setting").map(({ modelTurns }) => modelTurns)).toEqual([8, 1, 4]);
    expect(third).toMatchObject({ reading: "no-step", valid: { old: [0, 5], fresh: [0, 5] } });
    expect(next).toMatchObject({ move: "end", ending: "no-room" });
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
    const flags = ["--name", name, ...solver, ...terms, "--target", "5"];
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
    // The Builder session recorded the setting, with the scored tasks the campaign opened with:
    // t-2 (10 October) opened with --target 6 and its first session recorded the default 12.
    expect(of(name, "campaign.setting")).toMatchObject([{ minutes: 8, target: 5 }]);
    expect(of(name, "task.state").filter(({ state }) => state === "released")).toHaveLength(2);
    expect(of(name, "comparison.started")).toMatchObject([{ solves: 1 }]);
    expect(of(name, "comparison.started")[0]?.tasks).toHaveLength(5);
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
    expect(next).toMatchObject({ move: "compare", noise: false });
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
