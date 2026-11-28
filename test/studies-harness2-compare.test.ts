/**
 * What fixes a JobBench comparison's terms and reads its result: a draw from unread professions,
 * sides no reader can name, terms written once, an A/A beside each reading, and a further judging
 * with no rollout. No model is called.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { chmodSync } from "node:fs";
import {
  agreeLines,
  blocksOf,
  defaultCount,
  deriveTree,
  drawTasks,
  fixTerms,
  prepareAgain,
  readLines,
  sidesOf,
  splitRubrics,
} from "../studies/harness2/compare.ts";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { capturedJsonParse, capturedJsonStringify } from "../src/meta/json-runtime.ts";
import { isRecord, isString, type JsonValue } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { capturedExecPath, runtimeProcess } from "../src/meta/process.ts";
import { decodeOutput, runSync } from "../src/meta/subprocess.ts";

const SECRET = "a rubric sentence no ledger may hold";
const ALL = ["a/task1", "a/task2", "b/task1", "b/task2", "c/task1", "d/task1", "d/task2"];
const root = mkdtempSync(join(tmpdir(), "ana-study-compare-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const json = (value: JsonValue): string => capturedJsonStringify(value) ?? "";

function grade(out: string, side: string, task: string, rubrics: readonly (readonly [number, number])[]) {
  const [group, name] = task.split("/");
  const folder = join(
    out,
    "dataset",
    String(group),
    String(name),
    "eval_result",
    `eval_${side}__${group}__${name}`,
  );
  mkdirSync(folder, { recursive: true });
  writeFileSync(
    join(folder, "x_judge.json"),
    json({
      total_score: rubrics.reduce((sum, [, score]) => sum + score, 0),
      max_score: rubrics.reduce((sum, [weight]) => sum + weight, 0),
      rubrics: rubrics.map(([weight, score], index) => ({
        index,
        weight,
        rubric: SECRET,
        result: {
          score,
          criteria_passed: score === weight ? 1 : 0,
          criteria_count: 1,
          overall_reasoning: SECRET,
        },
      })),
    }),
  );
}

const terms = (out: string, id: string, overrides: Partial<Parameters<typeof fixTerms>[0]> = {}) => ({
  out,
  id,
  arms: ["campaign-built", "starter"],
  repeats: 2,
  salt: "s4lt",
  prediction: "the built arm reads no step",
  tasks: ["b/task1", "c/task1"],
  burned: ["a/task1"],
  ...overrides,
});

describe("the draw", () => {
  it("defaults to 30% of the benchmark, rounded up to a multiple of five", () => {
    expect(defaultCount(65)).toBe(20);
    expect(defaultCount(100)).toBe(30);
    expect(defaultCount(60)).toBe(20);
    expect(defaultCount(20)).toBe(10);
  });

  it("closes a whole profession for one burned task, since its tasks share a domain", () => {
    expect(drawTasks(ALL, ["a/task1"], 4, "s4lt")).toStrictEqual([
      "b/task1",
      "b/task2",
      "d/task1",
      "d/task2",
    ]);
  });

  it("takes a stream whole and never a profession of one task, which has no task before any other", () => {
    expect(drawTasks(ALL, [], 6, "s4lt")).toStrictEqual(ALL.filter((task) => !task.startsWith("c/")));
    expect(new Set(drawTasks(ALL, [], 2, "s4lt").map((task) => task.split("/")[0])).size).toBe(1);
  });

  it("reaches 20 exactly on the benchmark's shape, whatever the salt", () => {
    const sizes = [...Array.from({ length: 11 }, () => 2), ...Array.from({ length: 7 }, () => 3), 1, 1];
    const tasks = sizes.flatMap((size, at) =>
      Array.from({ length: size }, (_, index) => `p${String(at)}/task${String(index + 1)}`),
    );
    for (const salt of Array.from({ length: 300 }, (_, index) => `salt${String(index)}`)) {
      expect(drawTasks(tasks, [], 20, salt)).toHaveLength(20);
    }
  });

  it("follows from the salt and not from the order the tasks came in", () => {
    expect(drawTasks(ALL.toReversed(), [], 2, "s4lt")).toStrictEqual(drawTasks(ALL, [], 2, "s4lt"));
    const draws = ["a", "b", "c", "d", "e", "f"].map((salt) => drawTasks(ALL, [], 2, salt).join(","));
    expect(new Set(draws).size).toBeGreaterThan(1);
  });

  it("refuses what whole professions cannot reach instead of drawing short", () => {
    expect(() => drawTasks(ALL, ["a/task1", "b/task1", "d/task1"], 2, "s4lt")).toThrow("reach 0");
    expect(() => drawTasks(ALL, [], 3, "s4lt")).toThrow("reach 0");
  });
});

describe("the terms", () => {
  it("writes the arm's name only into the key, so terms and labels name no arm", () => {
    const out = join(root, "named");
    fixTerms(terms(out, "c1"));
    const written = readFileSync(join(out, "comparisons", "c1", "terms.json"), "utf8");
    expect(written).not.toContain("campaign-built");
    expect(written).not.toContain("starter");
    expect(readFileSync(join(out, "comparisons", "c1", "key.json"), "utf8")).toContain("campaign-built");
  });

  it("is written once, whatever a second plan says", () => {
    const out = join(root, "once");
    fixTerms(terms(out, "c1"));
    expect(() => fixTerms(terms(out, "c1", { prediction: "another" }))).toThrow("fixed once");
  });

  it("refuses a task in a burned profession, and takes it where nothing is burned", () => {
    const out = join(root, "burned");
    expect(() => fixTerms(terms(out, "c1", { tasks: ["a/task2"] }))).toThrow("burned profession");
    expect(() => fixTerms(terms(out, "c2", { tasks: ["a/task2"], burned: [] }))).not.toThrow();
  });

  it("refuses one arm on one side, which compares nothing", () => {
    expect(() => fixTerms(terms(join(root, "alone"), "c1", { arms: ["starter"], repeats: 1 }))).toThrow(
      "make a comparison",
    );
  });

  it("gives one arm two sides for an A/A, and refuses an arm named twice", () => {
    const { sides, key } = sidesOf(["starter"], 2, "s4lt");
    expect(sides).toHaveLength(2);
    expect(key.size).toBe(1);
    expect(() => sidesOf(["starter", "starter"], 1, "s4lt")).toThrow("named twice");
  });

  it("refuses a stored rollout as an arm, since it is never solved afresh", () => {
    expect(() => fixTerms(terms(join(root, "stored"), "c1", { arms: ["sweep:agg1", "starter"] }))).toThrow(
      "stored rollout",
    );
  });

  it("owes the held-out arm no stream's first task, and counts and reads it so", () => {
    const out = join(root, "heldout");
    const told = fixTerms(
      terms(out, "c1", { arms: ["heldout", "starter"], repeats: 1, tasks: ["b/task1", "b/task2"] }),
    );
    expect(told[0]).toContain("3 rollouts");
    const { sides, key } = sidesOf(["heldout", "starter"], 1, "s4lt");
    const heldOut = sides.find((side) => key.get(side.replace(/r\d+$/u, "")) === "heldout") ?? "";
    mkdirSync(join(out, "dataset"));
    const reading = readLines(out, "c1", { unblind: false })[1];
    expect(reading).toContain(`${heldOut} b/task2`);
    expect(reading).not.toContain(`${heldOut} b/task1`);
  });

  it("prices a plan from this store's records alone, and says so where it holds none", () => {
    const out = join(root, "priced");
    expect(fixTerms(terms(out, "c1")).join("\n")).toContain("no record to price");
    mkdirSync(join(out, "judged", "old"), { recursive: true });
    writeFileSync(join(out, "judged", "old", "x.json"), json({ solveUsd: 2, judgeUsd: 8 }));
    writeFileSync(join(out, "judged", "old", "y.json"), json({ solveUsd: 0, judgeUsd: 8 }));
    const told = fixTerms(terms(out, "c2")).join("\n");
    expect(told).toContain("8 rollouts");
    expect(told).toContain("about 80 dollars at 10.00 a rollout, the mean of 1 records");
  });

  it("enforces confirmation power floor, baseline, minGain, and sealed professions", () => {
    const out = join(root, "confirm");
    const fourTasks = ["p1/task1", "p1/task2", "p2/task1", "p2/task2"];
    const sixTasks = [...fourTasks, "p3/task1", "p3/task2"];
    const arms = ["pi:tree:/tmp/cand", "pi:base"];
    const base = {
      arms,
      baseline: "pi:base",
      minGain: 5,
      repeats: 2,
      confirm: true,
      burned: [] as const,
    };
    expect(() => fixTerms(terms(out, "short-4", { ...base, tasks: fourTasks, repeats: 4 }))).toThrow(
      /needs at least 6 tasks.*got 4/u,
    );
    expect(() => fixTerms(terms(out, "no-aa", { ...base, tasks: sixTasks, repeats: 1 }))).toThrow(
      /--repeats 2/u,
    );
    expect(() => fixTerms(terms(out, "zero-gain", { ...base, tasks: sixTasks, minGain: 0 }))).toThrow(
      /--min-gain above 0/u,
    );
    expect(existsSync(join(out, "sealed-professions.json"))).toBe(false);

    const pilot = fixTerms(terms(out, "pilot-4", { arms, tasks: fourTasks, burned: [] }));
    expect(pilot.join("\n")).toContain("power: 4 held-out tasks can be scored");
    expect(pilot.join("\n")).toContain("cannot read a step");

    const ok = fixTerms(terms(out, "conf-1", { ...base, tasks: sixTasks }));
    expect(ok[0]).toContain("minGain 5 pts/task, confirmation sealed");
    expect(ok.join("\n")).toContain("power: 6 held-out tasks can be scored");
    expect(capturedJsonParse(readFileSync(join(out, "sealed-professions.json"), "utf8"))).toStrictEqual([
      "p1",
      "p2",
      "p3",
    ]);

    expect(() => fixTerms(terms(out, "conf-reuse", { ...base, tasks: sixTasks }))).toThrow(
      /already sealed in a prior confirmation: p1, p2, p3/u,
    );
  });
});

describe("the order", () => {
  const { sides } = sidesOf(["campaign-built", "starter"], 2, "s4lt");
  const blocks = blocksOf({ tasks: ["b/task1", "c/task1", "d/task1"], sides, salt: "s4lt" });

  it("runs every side of a task before the next task's, so no arm has a day of its own", () => {
    expect(blocks).toHaveLength(12);
    const order = blocks.map(({ task }) => task);
    expect(new Set(order.slice(0, 4)).size).toBe(1);
    expect(new Set(order.slice(4, 8)).size).toBe(1);
  });

  it("orders each block's sides apart, so no side always goes first", () => {
    const firsts = [0, 4, 8].map((at) => blocks[at]?.side);
    const manyTasks = blocksOf({ tasks: ALL, sides, salt: "s4lt" });
    const leads = new Set(manyTasks.filter((_, at) => at % 4 === 0).map(({ side }) => side));
    expect(firsts).toHaveLength(3);
    expect(leads.size).toBeGreaterThan(1);
  });
});

describe("the reading", () => {
  const out = join(root, "read");
  fixTerms(terms(out, "c1", { tasks: ["g/task1", "g/task2", "h/task1"], burned: [] }));
  const { sides } = sidesOf(["campaign-built", "starter"], 2, "s4lt");
  const [builtOne = "", builtTwo = "", starterOne = "", starterTwo = ""] = sides;
  for (const [side, scores] of [
    [builtOne, [10, 6, 0]],
    [builtTwo, [0, 6, 0]],
    [starterOne, [10, 0, 4]],
    [starterTwo, [10, 0, 4]],
  ] as const) {
    grade(out, side, "g/task1", [[10, scores[0]]]);
    grade(out, side, "g/task2", [[6, scores[1]]]);
    if (side !== builtTwo) grade(out, side, "h/task1", [[4, scores[2]]]);
  }

  it("states the fixed primary measure first and reads it both ways", () => {
    const told = readLines(out, "c1", { unblind: false });
    expect(told[0]).toContain("primary points at 0.02");
    const primary = told.find((line) => line.startsWith("primary, each task's mean"));
    expect(primary).toContain("p ");
    expect(primary).toContain("tied on 0");
  });

  it("leaves a task short on any side out of the pool, and names it", () => {
    const told = readLines(out, "c1", { unblind: false }).join("\n");
    expect(told).toContain(`not graded yet: ${builtTwo} h/task1`);
    const primary = readLines(out, "c1", { unblind: false }).find((line) => line.startsWith("primary, each"));
    expect(primary).toContain("above on 1");
    expect(primary).toContain("above on 1, tied on 0");
  });

  it("prints each arm's A/A, where a gap can only be noise", () => {
    const aa = readLines(out, "c1", { unblind: false }).filter((line) => line.startsWith("A/A "));
    expect(aa).toHaveLength(2);
    expect(aa.some((line) => line.includes("above on 1"))).toBe(true);
  });

  it("names no arm until it is asked to, and prints no rubric's text either way", () => {
    const blind = readLines(out, "c1", { unblind: false }).join("\n");
    expect(blind).not.toContain("campaign-built");
    expect(blind).not.toContain(SECRET);
    const open = readLines(out, "c1", { unblind: true }).join("\n");
    expect(open).toContain("campaign-built");
    expect(open).not.toContain(SECRET);
  });

  it("checks signed mean delta against minGain when unblinded against baseline", () => {
    const gainOut = join(root, "signed-gain");
    const tasks = ["p1/task1", "p1/task2", "p2/task1", "p2/task2", "p3/task1", "p3/task2"];
    fixTerms(
      terms(gainOut, "loss", {
        arms: ["pi:cand", "pi:base"],
        baseline: "pi:base",
        minGain: 5,
        repeats: 2,
        confirm: true,
        tasks,
        burned: [],
      }),
    );
    const { sides: gainSides, key: gainKey } = sidesOf(["pi:cand", "pi:base"], 2, "s4lt");
    for (const side of gainSides) {
      const arm = gainKey.get(side.replace(/r\d+$/u, ""));
      const score = arm === "pi:base" ? 10 : 2;
      for (const task of tasks) grade(gainOut, side, task, [[10, score]]);
    }
    const blind = readLines(gainOut, "loss", { unblind: false }).join("\n");
    expect(blind).toContain("|mean delta| >= minGain 5; direction needs --unblind");
    const open = readLines(gainOut, "loss", { unblind: true }).join("\n");
    expect(open).toContain("mean delta (pi:cand - pi:base) -8.00 pts/task (below minGain 5)");
  });
});

describe("judging again", () => {
  const out = join(root, "again");
  const jb = join(root, "jb");
  const task = "g/task1";
  mkdirSync(join(jb, "dataset", "main", task), { recursive: true });
  writeFileSync(
    join(jb, "dataset", "main", task, "RUBRICS.json"),
    json({ rubrics: [{ rubric: "zero" }, { rubric: "one" }, { rubric: "two" }] }),
  );
  const deliverable = join(out, "dataset", task, "model_output", "built__g__task1");
  mkdirSync(deliverable, { recursive: true });
  writeFileSync(join(deliverable, "report.md"), "the report");
  grade(out, "built", task, [
    [10, 10],
    [6, 0],
    [4, 4],
  ]);
  grade(out, "bare", task, [
    [10, 0],
    [6, 6],
    [4, 4],
  ]);

  it("finds the rubrics two sides split, whichever side won", () => {
    expect(splitRubrics(join(out, "dataset"), "built", "bare").get(task)).toStrictEqual([0, 1]);
  });

  it("places the deliverable under its own name and hands the judge only the chosen rubrics", () => {
    const file = prepareAgain({ out, jb, label: "built", time: 1, task, indexes: [0, 2] });
    expect(existsSync(join(out, "dataset", task, "model_output", "built-j1__g__task1", "report.md"))).toBe(
      true,
    );
    expect(capturedJsonParse(readFileSync(file, "utf8"))).toStrictEqual({
      rubrics: [{ rubric: "zero" }, { rubric: "two" }],
      indexes: [0, 2],
    });
  });

  it("takes every rubric where none is chosen", () => {
    const file = prepareAgain({ out, jb, label: "built", time: 2, task, indexes: null });
    expect(capturedJsonParse(readFileSync(file, "utf8"))).toMatchObject({ indexes: [0, 1, 2] });
  });

  it("refuses a side with no deliverable instead of judging an empty folder", () => {
    expect(() => prepareAgain({ out, jb, label: "gone", time: 1, task, indexes: null })).toThrow(
      "no deliverable",
    );
  });

  it("maps a judge's own numbering back, and reads what moved and what the gap read each time", () => {
    const place = (label: string) => prepareAgain({ out, jb, label, time: 1, task, indexes: [0, 1] });
    mkdirSync(join(out, "dataset", task, "model_output", "bare__g__task1"), { recursive: true });
    place("built");
    place("bare");
    grade(out, "built-j1", task, [
      [10, 10],
      [6, 6],
    ]);
    grade(out, "bare-j1", task, [
      [10, 0],
      [6, 6],
    ]);
    const told = agreeLines(out, ["built", "bare"], 1);
    expect(told[0]).toBe("judged 2 times: 2 rubrics, 1 moved on at least one side, 1 split in every judging");
    expect(told[1]).toContain("first judging then each again: 4, 10");
    expect(told.join("\n")).not.toContain(SECRET);
  });
});

describe("a derived tree", () => {
  const from = join(root, "tree");
  mkdirSync(join(from, "scripts"), { recursive: true });
  writeFileSync(join(from, "CLAUDE.md"), "the built guide");
  writeFileSync(join(from, "scripts", "tool"), "a program");
  const guide = join(root, "starter-guide.md");
  writeFileSync(guide, "the starter's guide");

  it("keeps the programs under another guide, records the guide's digest and leaves its source alone", () => {
    const into = join(root, "derived");
    deriveTree(from, guide, into);
    expect(readFileSync(join(into, "CLAUDE.md"), "utf8")).toBe("the starter's guide");
    expect(readFileSync(join(into, "scripts", "tool"), "utf8")).toBe("a program");
    expect(readFileSync(join(from, "CLAUDE.md"), "utf8")).toBe("the built guide");
    expect(capturedJsonParse(readFileSync(join(into, "derived.json"), "utf8"))).toMatchObject({ from });
  });

  it("is made once, and refuses a source that is no tree", () => {
    const into = join(root, "derived-once");
    deriveTree(from, guide, into);
    expect(() => deriveTree(from, guide, into)).toThrow("made once");
    expect(() => deriveTree(join(root, "again"), guide, join(root, "no"))).toThrow("no tree");
  });

  it("derives native pi exported trees by replacing harness/agent/BUILT_AGENTS.md", () => {
    const piFrom = join(root, "pi-tree");
    mkdirSync(join(piFrom, "harness", "agent"), { recursive: true });
    writeFileSync(join(piFrom, "harness", "agent", "BUILT_AGENTS.md"), "# Built pi guide\n");
    const piInto = join(root, "pi-derived");
    deriveTree(piFrom, guide, piInto);
    expect(readFileSync(join(piInto, "harness", "agent", "BUILT_AGENTS.md"), "utf8")).toBe(
      "the starter's guide",
    );
    expect(readFileSync(join(piFrom, "harness", "agent", "BUILT_AGENTS.md"), "utf8")).toBe(
      "# Built pi guide\n",
    );
  });
});

/**
 * The whole path on stand-ins: `claude` writes one report and bills half a dollar, and the judge
 * takes the benchmark's rubric file.
 */
describe("a comparison run through the scorer, on stand-ins", () => {
  const COMPARE = new URL("../studies/harness2/compare.ts", import.meta.url).pathname;
  const place = join(root, "whole");
  const [jb, out, bin] = [join(place, "jb"), join(place, "out"), join(place, "bin")];
  const TASKS = ["alpha/task1", "beta/task1"];
  const seen = join(place, "seen.jsonl");
  for (const task of TASKS) {
    mkdirSync(join(jb, "dataset", "main", task, "task_folder"), { recursive: true });
    writeFileSync(join(jb, "dataset", "main", task, "task_folder", "TASK_INSTRUCTIONS.txt"), "Report.");
    writeFileSync(
      join(jb, "dataset", "main", task, "RUBRICS.json"),
      json({
        rubrics: [
          { rubric: SECRET, weight: 3 },
          { rubric: SECRET, weight: 2 },
        ],
      }),
    );
  }
  mkdirSync(join(jb, "eval"), { recursive: true });
  mkdirSync(join(jb, ".venv", "bin"), { recursive: true });
  mkdirSync(bin, { recursive: true });
  mkdirSync(join(place, "tmp"), { recursive: true });
  writeFileSync(join(jb, "eval", "judge.py"), "# stand-in: the venv's python is judge.mjs\n");
  writeFileSync(
    join(place, "judge.mjs"),
    `import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const flag = (name) => args[args.indexOf(name) + 1];
// The scorer's question before its first rollout, python -m pip --version: this interpreter has one.
if (args[0] === "-m") process.exit(0);
// A wider cut's launch is python -c <driver> <judge.py> <cap> <judge.py's flags>; judgeExtract's has no cap.
const capped = args[0] === "-c" && /^\\d+$/.test(args[3] ?? "");
if (args[0] === "-c" && !capped) process.exit(1);
if (capped) appendFileSync(${JSON.stringify(join(place, "capped.jsonl"))}, JSON.stringify(args) + "\\n");
appendFileSync(${JSON.stringify(seen)}, JSON.stringify({ judge: flag("--evaluated-model") }) + "\\n");
const handed = JSON.parse(readFileSync(flag("--rubrics-file"), "utf8")).rubrics;
const rubrics = handed.map((rubric, index) => ({ index, weight: rubric.weight, result: { passed: true, score: rubric.weight, criteria_passed: 1, criteria_count: 1, overall_reasoning: "stand-in" } }));
const sum = rubrics.reduce((all, rubric) => all + rubric.result.score, 0);
writeFileSync(flag("--details-file"), JSON.stringify({ total_score: sum, max_score: sum, passed_count: rubrics.length, total_count: rubrics.length, rubrics }));
`,
  );
  writeFileSync(
    join(jb, ".venv", "bin", "python"),
    `#!/bin/sh\nexec '${capturedExecPath}' '${join(place, "judge.mjs")}' "$@"\n`,
  );
  writeFileSync(
    join(place, "claude.mjs"),
    `import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2);
const ws = args[args.indexOf("--add-dir") + 1];
appendFileSync(${JSON.stringify(seen)}, JSON.stringify({ solve: ws }) + "\\n");
writeFileSync(join(ws, "output", "report.md"), "# Stand-in report\\n");
for (const event of [{ type: "system", subtype: "init", cwd: process.cwd(), model: "stand-in" }, { type: "assistant", message: { content: [{ type: "text", text: "done" }] } }, { type: "result", subtype: "success", num_turns: 1, total_cost_usd: 0.5 }]) console.log(JSON.stringify(event));
`,
  );
  writeFileSync(
    join(bin, "claude"),
    `#!/bin/sh\nexec '${capturedExecPath}' '${join(place, "claude.mjs")}' "$@"\n`,
  );
  chmodSync(join(bin, "claude"), 0o755);
  chmodSync(join(jb, ".venv", "bin", "python"), 0o755);
  const tree = join(place, "tree");
  mkdirSync(tree, { recursive: true });
  writeFileSync(join(tree, "CLAUDE.md"), "# A guide\n");
  const env = {
    ...runtimeProcess.env,
    PATH: `${bin}:/usr/bin:/bin`,
    HOME: join(place, "home"),
    TMPDIR: join(place, "tmp"),
  };
  const compare = (...args: string[]) =>
    runSync([capturedExecPath, COMPARE, ...args], { env, timeout: 120_000 });
  const common = ["--out", out, "--id", "c1", "--jb", jb, "--api-base", "http://127.0.0.1:9/v1"];
  const planned = compare(
    "plan",
    "--out",
    out,
    "--id",
    "c1",
    "--jb",
    jb,
    "--arm",
    `tree:${tree}`,
    "--repeats",
    "2",
    "--salt",
    "s4lt",
    "--predict",
    "the two sides tie",
    "--tasks",
    TASKS.join(","),
    "--burned",
    "",
  );
  const refused = compare("run", ...common);
  const before = existsSync(seen);
  const ran = compare("run", ...common, "--yes");
  const rows = readFileSync(seen, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => capturedJsonParse(line));
  const told = compare("read", "--out", out, "--id", "c1");

  it("starts nothing without --yes", () => {
    expect(planned.exitCode).toBe(0);
    expect(refused.exitCode).not.toBe(0);
    expect(decodeOutput(refused.stderr)).toContain("--yes");
    expect(before).toBe(false);
  });

  it("solves every side of every task once, every rollout before any judgement", () => {
    expect(ran.exitCode).toBe(0);
    const kinds = rows.map((row) => (isRecord(row) && "solve" in row ? "solve" : "judge"));
    expect(kinds.join(" ")).toBe("solve solve solve solve judge judge judge judge");
  });

  it("reads the two sides of one arm as an A/A with nothing short", () => {
    const text = decodeOutput(told.stdout);
    expect(text).toContain("not graded yet: none");
    expect(text).toContain("A/A ");
    expect(text).toContain("tied on 2");
    expect(text).not.toContain(SECRET);
  });

  it("judges a deliverable again without a further rollout", () => {
    const { sides } = sidesOf([`tree:${tree}`], 2, "s4lt");
    const [one = "", other = ""] = sides;
    const shared = [
      "--out",
      out,
      "--jb",
      jb,
      "--api-base",
      "http://127.0.0.1:9/v1",
      "--of",
      one,
      "--of",
      other,
    ];
    const judged = compare(
      "rejudge",
      ...shared,
      "--times",
      "1",
      "--tasks",
      "alpha/task1",
      "--salt",
      "s4lt",
      "--yes",
    );
    expect(judged.exitCode).toBe(0);
    const after = readFileSync(seen, "utf8");
    expect(after.match(/"solve"/gu)).toHaveLength(4);
    expect(after.match(/"judge"/gu)).toHaveLength(6);
    const agreed = compare("agree", "--out", out, "--of", one, "--of", other, "--times", "1");
    expect(decodeOutput(agreed.stdout)).toContain("judged 2 times: 2 rubrics, 0 moved");
  });

  it("judges under a wider cut only a deliverable judged again, under a name of its own", () => {
    const SCORE = new URL("../studies/harness2/score.ts", import.meta.url).pathname;
    const capped = join(place, "capped.jsonl");
    const seenBefore = readFileSync(seen, "utf8");
    const official = (cap: string, arm: string) =>
      runSync(
        [capturedExecPath, SCORE, "score", "--arm", arm, "--name", "wide", "--tasks", "alpha/task1"].concat([
          "--out",
          out,
          "--jb",
          jb,
          "--api-base",
          "http://127.0.0.1:9/v1",
          "--cap",
          cap,
          "--yes",
        ]),
        { env, timeout: 120_000 },
      );
    const wrongArm = official("400000", `tree:${tree}`);
    expect(wrongArm.exitCode).not.toBe(0);
    expect(decodeOutput(wrongArm.stderr)).toContain("--cap judges only an again: arm");
    expect(official("200000", "again:any").exitCode).not.toBe(0);
    expect(readFileSync(seen, "utf8")).toBe(seenBefore);
    expect(existsSync(capped)).toBe(false);
    const { sides } = sidesOf([`tree:${tree}`], 2, "s4lt");
    const [one = "", other = ""] = sides;
    const shared = [
      "--out",
      out,
      "--jb",
      jb,
      "--api-base",
      "http://127.0.0.1:9/v1",
      "--of",
      one,
      "--of",
      other,
    ];
    const equalCap = compare(
      "rejudge",
      ...shared,
      "--times",
      "1",
      "--tasks",
      "alpha/task1",
      "--cap",
      "200000",
      "--salt",
      "s4lt",
      "--yes",
    );
    expect(equalCap.exitCode).not.toBe(0);
    expect(readdirSync(join(out, "dataset", "alpha", "task1", "model_output")).join(" ")).not.toContain(
      "-c200000-",
    );
    const judged = compare(
      "rejudge",
      ...shared,
      "--times",
      "1",
      "--tasks",
      "alpha/task1",
      "--cap",
      "400000",
      "--salt",
      "s4lt",
      "--yes",
    );
    expect(judged.exitCode).toBe(0);
    const launches = readFileSync(capped, "utf8")
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => capturedJsonParse(line));
    expect(launches).toHaveLength(2);
    for (const argv of launches) {
      if (!Array.isArray(argv)) throw new Error("a launch is an argv");
      expect(isString(argv[1]) ? argv[1] : "").toContain("mod.MAX_CHARS_PER_FILE = cap");
      expect([argv[0], argv[2], argv[3], argv[4]]).toStrictEqual([
        "-c",
        join(jb, "eval", "judge.py"),
        "400000",
        "--output-dir",
      ]);
    }
    const record = capturedJsonParse(
      readFileSync(join(out, "judged", `${one}-c400000-j1`, "alpha__task1.json"), "utf8"),
    );
    expect(isRecord(record) ? record.cap : null).toBe(400_000);
    const agreed = compare(
      "agree",
      "--out",
      out,
      "--of",
      one,
      "--of",
      other,
      "--times",
      "1",
      "--cap",
      "400000",
    );
    expect(decodeOutput(agreed.stdout)).toContain("judged 2 times: 2 rubrics, 0 moved");
  });

  it("plans and dry-runs a sealed native pi confirmation against pi:base", () => {
    const SCORE = new URL("../studies/harness2/score.ts", import.meta.url).pathname;
    const piPlace = join(root, "pi-confirm");
    const [piJb, piOut] = [join(piPlace, "jb"), join(piPlace, "out")];
    const profs = ["prof1", "prof2", "prof3", "prof4"];
    for (const prof of profs) {
      for (const t of ["task1", "task2"]) {
        mkdirSync(join(piJb, "dataset", "main", prof, t, "task_folder"), { recursive: true });
        writeFileSync(join(piJb, "dataset", "main", prof, t, "task_folder", "TASK_INSTRUCTIONS.txt"), "Do.");
        writeFileSync(join(piJb, "dataset", "main", prof, t, "RUBRICS.json"), json({ rubrics: [] }));
      }
    }
    mkdirSync(join(piJb, "eval"), { recursive: true });
    mkdirSync(join(piJb, ".venv", "bin"), { recursive: true });
    writeFileSync(join(piJb, "eval", "judge.py"), "# stand-in\n");
    writeFileSync(join(piJb, ".venv", "bin", "python"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const exported = runSync(
      [
        capturedExecPath,
        SCORE,
        "tree",
        "--arm",
        "pi:starter",
        "--name",
        "cand",
        "--out",
        piOut,
        "--for",
        `${runtimeProcess.platform}-${runtimeProcess.arch}`,
      ],
      { env, timeout: 120_000 },
    );
    expect(exported.exitCode).toBe(0);
    const candTree = join(piOut, "trees", "cand");
    const plannedPi = compare(
      "plan",
      "--out",
      piOut,
      "--id",
      "pi-c1",
      "--jb",
      piJb,
      "--arm",
      `pi:tree:${candTree}`,
      "--confirm",
      "--count",
      "6",
      "--min-gain",
      "5",
      "--salt",
      "s4lt",
      "--predict",
      "starter matches base",
      "--burned",
      "",
    );
    expect(decodeOutput(plannedPi.stderr)).toBe("");
    expect(plannedPi.exitCode).toBe(0);
    expect(decodeOutput(plannedPi.stdout)).toContain("confirmation sealed");
    const sealedFirst = capturedJsonParse(readFileSync(join(piOut, "sealed-professions.json"), "utf8"));
    expect(Array.isArray(sealedFirst) ? sealedFirst.length : 0).toBe(3);

    const dryPi = compare(
      "run",
      "--out",
      piOut,
      "--id",
      "pi-c1",
      "--jb",
      piJb,
      "--api-base",
      "http://127.0.0.1:9/v1",
      "--dry-run",
    );
    expect(decodeOutput(dryPi.stderr)).toBe("");
    expect(dryPi.exitCode).toBe(0);
    expect(decodeOutput(dryPi.stdout)).toContain("on pi-durable, inside the harness itself");

    const secondPlan = compare(
      "plan",
      "--out",
      piOut,
      "--id",
      "pi-c2",
      "--jb",
      piJb,
      "--arm",
      `pi:tree:${candTree}`,
      "--confirm",
      "--count",
      "6",
      "--min-gain",
      "5",
      "--salt",
      "s4lt2",
      "--predict",
      "insufficient unsealed professions",
      "--burned",
      "",
    );
    expect(secondPlan.exitCode).not.toBe(0);
    expect(decodeOutput(secondPlan.stderr)).toContain("reach 2");

    const sealedProfs = Array.isArray(sealedFirst) ? sealedFirst.filter(isString) : [];
    const explicitReuse = compare(
      "plan",
      "--out",
      piOut,
      "--id",
      "pi-c3",
      "--jb",
      piJb,
      "--arm",
      `pi:tree:${candTree}`,
      "--confirm",
      "--tasks",
      sealedProfs.flatMap((p) => [`${p}/task1`, `${p}/task2`]).join(","),
      "--min-gain",
      "5",
      "--salt",
      "s4lt3",
      "--predict",
      "explicit reuse must refuse",
      "--burned",
      "",
    );
    expect(explicitReuse.exitCode).not.toBe(0);
    expect(decodeOutput(explicitReuse.stderr)).toContain("already sealed in a prior confirmation");

    const altGuide = join(piPlace, "alt-guide.md");
    writeFileSync(altGuide, "# Alternative derived guide\n");
    const derivedTree = join(piOut, "trees", "cand-derived");
    deriveTree(candTree, altGuide, derivedTree);
    const derivedDry = runSync(
      [
        capturedExecPath,
        SCORE,
        "score",
        "--arm",
        `pi:tree:${derivedTree}`,
        "--name",
        "pi-derived-check",
        "--tasks",
        "prof1/task1",
        "--out",
        piOut,
        "--jb",
        piJb,
        "--api-base",
        "http://127.0.0.1:9/v1",
        "--dry-run",
      ],
      { env, timeout: 120_000 },
    );
    expect(decodeOutput(derivedDry.stderr)).toBe("");
    expect(derivedDry.exitCode).toBe(0);
    const origExport = capturedJsonParse(readFileSync(join(candTree, "export.json"), "utf8"));
    const origDigest = isRecord(origExport) && isString(origExport.harness) ? origExport.harness : "";
    expect(origDigest).not.toBe("");
    expect(decodeOutput(derivedDry.stdout)).not.toContain(origDigest);
  }, 120_000);
});
