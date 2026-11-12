// One sweep of the TypeScript Harness² port (`studies/harness2/jobbench.ts`) end to end, with a
// stand-in `claude` first on its PATH and no credential in its environment, so no model is called.
// The stand-in writes deliverables and stream-json `result` events with `total_cost_usd` for each
// rollout, and edits `context/harness/` and replies as an improver session would, logging every
// call. Four tasks in three professions: alpha's two in order, so the second reads the first's
// library entry; beta's one, which never sees alpha's; and gamma's, whose deliverables carry a
// grader's verdict, so no session may see its evidence.
import { afterAll, describe, expect, it } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { capturedJsonParse } from "../src/meta/json-runtime.ts";
import { isRecord, isString, type JsonObject, type JsonValue } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { capturedExecPath } from "../src/meta/process.ts";
import { decodeOutput, runSync } from "../src/meta/subprocess.ts";

const FIRST = "alpha/task1";
const TASKS = [FIRST, "alpha/task2", "beta/task1", "gamma/task1"];
const SWEEP = new URL("../studies/harness2/jobbench.ts", import.meta.url).pathname;
const MARKER = '"pass_rate": 1';
const REJECTED = "YOUR PREVIOUS ATTEMPT WAS REJECTED";

const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-study-harness2-sweep-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const [jb, out, calls] = [join(root, "jb"), join(root, "out"), join(root, "calls.jsonl")];

/** The stand-in `claude`: a rollout when asked for stream-json, an improver session otherwise. */
const STAND_IN = `import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
const LOG = ${JSON.stringify(calls)};
const args = process.argv.slice(2);
const rows = () => existsSync(LOG) ? readFileSync(LOG, "utf8").split("\\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
const log = (row) => appendFileSync(LOG, JSON.stringify(row) + "\\n");
if (args.includes("stream-json")) {
  const ws = args[args.indexOf("--add-dir") + 1];
  const label = basename(ws).replace(/_\\d+$/, "").replace(/^[a-z]+_task\\d_/, "");
  const attempt = rows().filter((row) => row.label === label).length + 1;
  const guide = existsSync(join(ws, "CLAUDE.md")) ? readFileSync(join(ws, "CLAUDE.md"), "utf8") : "";
  const files = (at) => readdirSync(join(ws, at), { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(join(at, entry.name)) : [join(at, entry.name)]);
  log({ kind: "rollout", label, attempt, guide, budget: args[args.indexOf("--max-budget-usd") + 1], env: process.env.MAX_BUDGET_USD ?? "", files: files("").sort(), path: process.env.PATH, cwd: process.cwd() });
  const dead = guide.includes("DEAD");
  const empty = (label.endsWith("alpha__task1__base1") && attempt === 1) || guide.includes("EMPTY") || dead;
  if (!empty) writeFileSync(join(ws, "output", "report.md"), (label.includes("gamma") ? ${JSON.stringify(`${MARKER}\n`)} : "") + "report by " + label + "\\n" + guide);
  if (guide.includes("LONG")) for (const [name, size] of [["long.csv", 200001], ["exact.csv", 200000], ["data.db", 200001]]) writeFileSync(join(ws, "output", name), "x".repeat(size));
  const said = guide.includes("PEEK") ? { type: "tool_use", name: "Bash", input: { command: "cat ../RUBRICS.json" } } : { type: "text", text: "working" };
  const events = [{ type: "system", subtype: "init" }, { type: "assistant", message: { content: [said] } }, { type: "result", subtype: "success", num_turns: 1, total_cost_usd: empty ? 0.125 : 0.25 }];
  for (const event of dead ? events.slice(0, 1) : events) console.log(JSON.stringify(event));
} else {
  const mission = readFileSync(0, "utf8");
  const context = join(process.cwd(), "context");
  const task = /Task (\\S+):/.exec(readFileSync(join(context, "task.md"), "utf8"))[1];
  const job = mission.includes("# WHAT HAPPENED") ? "experience" : mission.includes("You are the INVARIANT harness editor") ? "inv" : mission.includes("You are the DOMAIN harness editor") ? "dom" : "agg";
  const library = join(context, "library", "harnesses");
  const retry = mission.includes(${JSON.stringify(REJECTED)});
  log({ kind: "session", task, job, retry, library: existsSync(library) ? readdirSync(library).sort() : null });
  const guide = join(context, "harness", "CLAUDE.md");
  let text = "<notes>" + job + " notes</notes>";
  if (job === "experience") text = "<edits>- CLAUDE.md: one line from each editor</edits>\\n<experience>\\ncue: " + task + " totals\\nlesson: check the totals\\nevidence: the agg1 rollout\\nconfidence: medium\\n</experience>";
  else if (job === "agg") writeFileSync(guide, readFileSync(guide, "utf8").replace(${JSON.stringify(`${MARKER}\n`)}, "") + (task === "alpha/task1" && !retry ? ${JSON.stringify(`${MARKER}\n`)} : "agg edit\\n"));
  else writeFileSync(guide, readFileSync(guide, "utf8") + job + " edit\\n");
  console.log(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: text, total_cost_usd: job === "experience" ? 0.0625 : 0.5 }));
}
`;

function setUp() {
  for (const task of TASKS) {
    const folder = join(jb, "dataset", "main", task, "task_folder");
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "TASK_INSTRUCTIONS.txt"), `Task ${task}: total the table in data.csv.\n`);
    writeFileSync(join(folder, "data.csv"), "a,b\n1,2\n");
  }
  const bin = join(root, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(root, "stand-in.mjs"), STAND_IN);
  writeFileSync(
    join(bin, "claude"),
    `#!/bin/sh\nexec '${capturedExecPath}' '${join(root, "stand-in.mjs")}' "$@"\n`,
  );
  chmodSync(join(bin, "claude"), 0o755);
  writeFileSync(
    join(root, "sections.json"),
    JSON.stringify({
      work: "statistical work",
      inv_levers: "procedure levers",
      dom_levers: "domain levers",
      yardstick: "a careful statistician",
      domain_guidance: "check every total",
    }),
  );
  mkdirSync(join(root, "tmp"), { recursive: true });
  return { PATH: `${bin}:/usr/bin:/bin`, HOME: join(root, "home"), TMPDIR: join(root, "tmp") };
}

const sweep = (env: Record<string, string>, ...flags: string[]) =>
  runSync(
    [
      capturedExecPath,
      SWEEP,
      "sweep",
      "--tasks",
      TASKS.join(","),
      "--out",
      out,
      "--sections",
      join(root, "sections.json"),
      "--jb",
      jb,
      ...flags,
    ],
    { env, timeout: 280_000 },
  );

const readJson = (path: string): JsonValue => capturedJsonParse(readFileSync(path, "utf8"));
const rowsOf = (path: string): JsonValue[] =>
  existsSync(path)
    ? readFileSync(path, "utf8")
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => capturedJsonParse(line))
    : [];
const text = (value: JsonValue | undefined): string => (isString(value) ? value : "");
const field = (value: JsonValue | undefined, ...keys: string[]): JsonValue | undefined =>
  keys.reduce<JsonValue | undefined>((at, key) => (isRecord(at) ? at[key] : undefined), value);
const summaryOf = (task: string): JsonObject => {
  const summary = readJson(join(out, "adapt", "jb-cc-agg1", task.replaceAll("/", "__"), "summary.json"));
  return isRecord(summary) ? summary : {};
};

const env = setUp();

describe("one Harness² k=1 sweep on a stand-in claude", () => {
  const refused = sweep(env);
  const planned = sweep(env, "--dry-run");
  const called = existsSync(calls);
  const ran = sweep(env, "--yes");
  const log = rowsOf(calls);
  const sessions = (task: string) =>
    log.filter((row) => field(row, "kind") === "session" && field(row, "task") === task);
  const rollouts = (task: string) =>
    log.filter(
      (row) =>
        field(row, "kind") === "rollout" && text(field(row, "label")).includes(task.replace("/", "__")),
    );

  it("starts nothing without --yes, and plans without a call under --dry-run", () => {
    expect(refused.exitCode).not.toBe(0);
    expect(decodeOutput(refused.stderr)).toContain("--yes");
    expect(planned.exitCode).toBe(0);
    expect(decodeOutput(planned.stdout)).toContain("4 tasks in 3 streams");
    expect(called).toBe(false);
  });

  it("runs R = 4 rollouts, P = 3 sessions and one experience session a task, with their dollars summed", () => {
    expect(ran.exitCode).toBe(1);
    for (const task of [FIRST, "alpha/task2", "beta/task1"]) {
      const summary = summaryOf(task);
      expect(summary.status).toBe("ok");
      const ledger = field(summary, "modes", "agg", "ledger");
      expect(field(ledger, "rollouts")).toEqual(["base1", "inv1", "dom1", "agg1"]);
      expect(field(ledger, "sessions")).toEqual(["inv1", "dom1", "agg1"]);
      const first = task === FIRST;
      expect(field(ledger, "rollout_usd")).toBe(first ? 1.125 : 1);
      expect(field(ledger, "session_usd")).toBe(first ? 2 : 1.5);
      expect(field(ledger, "usd")).toBe(first ? 3.125 : 2.5);
      expect(field(summary, "selections", "agg", "usd")).toBe(0.0625);
      expect(
        sessions(task)
          .map((row) => text(field(row, "job")))
          .toSorted(),
      ).toEqual(
        (first ? ["inv", "dom", "agg", "agg", "experience"] : ["inv", "dom", "agg", "experience"]).toSorted(),
      );
      expect(rollouts(task)).toHaveLength(first ? 5 : 4);
    }
  });

  it("retries a rollout that left no deliverable once, and gives each rollout the runner's cap", () => {
    const traj = join(out, "dataset", "alpha", "task1", "model_traj", "jb-cc-agg1__alpha__task1__base1");
    expect(readdirSync(traj).filter((name) => name.endsWith(".jsonl"))).toHaveLength(2);
    expect(rollouts(FIRST).map((row) => field(row, "attempt"))).toContain(2);
    expect(
      new Set(
        log.flatMap((row) =>
          field(row, "kind") === "rollout" ? [field(row, "budget"), field(row, "env")] : [],
        ),
      ),
    ).toEqual(new Set(["5"]));
  });

  it("delivers agg1's rollout, under the harness the aggregator wrote", () => {
    const selection = readJson(
      join(out, "adapt", "jb-cc-agg1", "alpha__task1", "selection", "agg1", "selection.json"),
    );
    expect(field(selection, "chosen_label")).toBe("agg1");
    const runDir = text(field(selection, "chosen_run_dir"));
    expect(runDir).toBe(
      join(out, "dataset", "alpha", "task1", "model_output", "jb-cc-agg1__alpha__task1__agg1"),
    );
    expect(readFileSync(join(runDir, "report.md"), "utf8")).toContain("agg edit");
  });

  it("refuses a harness or an evidence tree that holds a grader's verdict", () => {
    expect(
      sessions(FIRST)
        .filter((row) => field(row, "job") === "agg")
        .map((row) => field(row, "retry")),
    ).toEqual([false, true]);
    const kept = join(out, "adapt", "jb-cc-agg1", "alpha__task1", "harnesses", "agg1", "CLAUDE.md");
    expect(readFileSync(kept, "utf8")).not.toContain(MARKER);
    expect(sessions("gamma/task1")).toEqual([]);
    const gamma = summaryOf("gamma/task1");
    expect(gamma.status).toBe("partial");
    expect(text(field(gamma, "modes", "agg", "error"))).toContain("grader verdict would enter model context");
  });

  it("writes each profession's library, read only by that profession's later tasks", () => {
    const library = join(out, "library", "jb", "k1-cc", "agg");
    expect(readdirSync(join(library, "alpha", "harnesses")).toSorted()).toEqual([
      "alpha__task1",
      "alpha__task2",
    ]);
    expect(readdirSync(join(library, "beta", "harnesses"))).toEqual(["beta__task1"]);
    expect(existsSync(join(library, "gamma", "harnesses"))).toBe(false);
    const read = (task: string, job: string) =>
      field(
        sessions(task).find((row) => field(row, "job") === job),
        "library",
      );
    for (const job of ["inv", "dom", "agg"]) {
      expect(read(FIRST, job)).toBeNull();
      expect(read("alpha/task2", job)).toEqual(["alpha__task1"]);
      expect(read("beta/task1", job)).toBeNull();
    }
    expect(
      readFileSync(join(library, "alpha", "harnesses", "alpha__task1", "EXPERIENCE.md"), "utf8"),
    ).toContain("check the totals");
    const records = readdirSync(join(out, "adapt", "_sweeps"));
    expect(records).toHaveLength(1);
    expect(field(readJson(join(out, "adapt", "_sweeps", records[0] ?? "")), "n_domains")).toBe(3);
  });
});

/**
 * The stand-in judge: JobBench's `judge.py` shape. A rubric passes when the deliverables hold its
 * needle; with no deliverable every rubric fails unasked, as judge.py's does; a report that says
 * FLAKY leaves one rubric unanswered; each answered rubric bills the shim log a cent.
 */
const JUDGE_STAND_IN = `import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2);
const flag = (name) => args[args.indexOf(name) + 1];
// judgeExtract's launch, python -c <driver> <judge.py> <dir>: each file's text, as the driver prints it.
if (args[0] === "-c") {
  const dir = args[3];
  console.log(JSON.stringify({ files: Object.fromEntries(readdirSync(dir).sort().map((name) => [name, readFileSync(join(dir, name), "utf8")])), flat: "", images: [] }));
  process.exit(0);
}
appendFileSync(${JSON.stringify(join(root, "judge.jsonl"))}, JSON.stringify({ args, cwd: process.cwd(), effort: process.env.JUDGE_REASONING_EFFORT, key: process.env.JUDGE_API_KEY, scrubbed: process.env.ANTHROPIC_API_KEY ?? null }) + "\\n");
const dir = flag("--output-dir");
const names = existsSync(dir) ? readdirSync(dir) : [];
const report = names.map((name) => readFileSync(join(dir, name), "utf8")).join("\\n");
const rubrics = JSON.parse(readFileSync(flag("--rubrics-file"), "utf8")).map((rubric, index) => {
  if (names.length > 0) appendFileSync(${JSON.stringify(join(root, "shim.jsonl"))}, JSON.stringify({ t: Date.now() / 1000, usage: { total_cost_usd: 0.01 } }) + "\\n");
  const passed = report.includes(rubric.needle);
  const overall_reasoning = names.length === 0 ? "No output files found in the model output directory." : report.includes("FLAKY") && index === 1 ? "Opus judge failed after 3 attempts" : passed ? "met" : "unmet";
  return { index, weight: rubric.weight, result: { passed, score: passed ? rubric.weight : 0, overall_reasoning } };
});
const sum = (pick) => rubrics.reduce((all, rubric) => all + pick(rubric), 0);
writeFileSync(flag("--details-file"), JSON.stringify({ total_score: sum((r) => r.result.score), max_score: sum((r) => r.weight), passed_count: rubrics.filter((r) => r.result.passed).length, total_count: rubrics.length, rubrics }));
`;

describe("every arm scored on the sweep's rollout and JobBench's judge, on stand-ins", () => {
  const SCORE = new URL("../studies/harness2/score.ts", import.meta.url).pathname;
  for (const task of TASKS) {
    const rubrics = [
      { rubric: "reports", weight: 3, needle: "report by" },
      { rubric: "aggregated", weight: 2, needle: "agg edit" },
    ];
    writeFileSync(join(jb, "dataset", "main", task, "RUBRICS.json"), JSON.stringify(rubrics));
  }
  mkdirSync(join(jb, "eval"), { recursive: true });
  writeFileSync(join(jb, "eval", "judge.py"), "# stand-in: the venv's python is judge.mjs\n");
  mkdirSync(join(jb, ".venv", "bin"), { recursive: true });
  writeFileSync(join(root, "judge.mjs"), JUDGE_STAND_IN);
  writeFileSync(
    join(jb, ".venv", "bin", "python"),
    `#!/bin/sh\nexec '${capturedExecPath}' '${join(root, "judge.mjs")}' "$@"\n`,
  );
  chmodSync(join(jb, ".venv", "bin", "python"), 0o755);
  // A second fair task, solved only by the arm whose deliverable the judge's reader cuts.
  const LONG = "beta/task2";
  mkdirSync(join(jb, "dataset", "main", LONG, "task_folder"), { recursive: true });
  writeFileSync(join(jb, "dataset", "main", LONG, "task_folder", "TASK_INSTRUCTIONS.txt"), "Report.\n");
  writeFileSync(
    join(jb, "dataset", "main", LONG, "RUBRICS.json"),
    readFileSync(join(jb, "dataset", "main", FIRST, "RUBRICS.json")),
  );
  for (const word of ["PEEK", "DEAD", "EMPTY", "FLAKY", "LONG"]) {
    mkdirSync(join(root, "trees", word), { recursive: true });
    writeFileSync(join(root, "trees", word, "CLAUDE.md"), `# ${word}\n`);
  }
  const before = rowsOf(calls).length;
  const scored = (arm: string, name: string, tasks: string, ...flags: string[]) =>
    runSync(
      [
        capturedExecPath,
        SCORE,
        "score",
        "--arm",
        arm,
        "--name",
        name,
        "--tasks",
        tasks,
        "--out",
        out,
        "--jb",
        jb,
      ].concat(["--api-base", "http://127.0.0.1:9/v1", "--judge-log", join(root, "shim.jsonl"), ...flags]),
      { env: { ...env, ANTHROPIC_API_KEY: "never-reaches-the-judge" }, timeout: 280_000 },
    );
  const alpha = "alpha/task1,alpha/task2";
  const refused = scored("base", "base", alpha);
  const planned = scored("base", "base", alpha, "--dry-run");
  const calledBefore = rowsOf(calls).length;
  const runs = {
    base: scored("base", "base", alpha, "--yes"),
    starter: scored("starter", "starter", FIRST, "--yes"),
    heldout: scored("heldout", "heldout", "alpha/task2", "--yes"),
    k1: scored("sweep:agg1", "k1", alpha, "--yes"),
    peek: scored(`tree:${join(root, "trees", "PEEK")}`, "peek", "beta/task1", "--yes"),
    dead: scored(`tree:${join(root, "trees", "DEAD")}`, "dead", "beta/task1", "--yes"),
    empty: scored(`tree:${join(root, "trees", "EMPTY")}`, "empty", "beta/task1", "--yes"),
    flaky: scored(`tree:${join(root, "trees", "FLAKY")}`, "flaky", "beta/task1", "--yes"),
    long: scored(`tree:${join(root, "trees", "LONG")}`, "long", LONG, "--yes"),
  };
  const rolledOnce = rowsOf(calls).length;
  const again = scored("base", "base", alpha, "--yes");
  const tabled = runSync([capturedExecPath, SCORE, "table", "--out", out, "--tasks", alpha], { env });
  const tabledFair = runSync(
    [capturedExecPath, SCORE, "table", "--out", out, "--tasks", `alpha/task2,${LONG}`],
    { env },
  );
  const rolls = rowsOf(calls).slice(before);
  const judges = rowsOf(join(root, "judge.jsonl"));
  const record = (name: string, task: string): JsonValue =>
    readJson(join(out, "judged", name, `${task.replace("/", "__")}.json`));
  const rollsOf = (name: string) => rolls.filter((row) => text(field(row, "label")).startsWith(`${name}__`));

  it("starts nothing without --yes, and plans without a call under --dry-run", () => {
    expect(refused.exitCode).not.toBe(0);
    expect(decodeOutput(refused.stderr)).toContain("--yes");
    expect(planned.exitCode).toBe(0);
    expect(decodeOutput(planned.stdout)).toContain("claude-opus-5-5 at high, $5 and 3600 s an attempt");
    expect(calledBefore).toBe(before);
  });

  it("solves each task once under the arm's tree, with the sweep's PATH and cap, and no grader in reach", () => {
    expect(runs.base.exitCode).toBe(0);
    expect(
      rollsOf("base")
        .map((row) => text(field(row, "label")))
        .toSorted(),
    ).toEqual(["base__alpha__task1", "base__alpha__task2"]);
    for (const row of rolls) {
      expect(text(field(row, "path")).split(":").slice(0, 2)).toEqual([
        join(jb, ".venv", "bin"),
        capturedExecPath.slice(0, capturedExecPath.lastIndexOf("/")),
      ]);
      expect([field(row, "budget"), field(row, "env")]).toEqual(["5", "5"]);
      const files = field(row, "files");
      expect(
        Array.isArray(files) && files.some((name) => /RUBRICS|eval_result|judged/u.test(text(name))),
      ).toBe(false);
    }
    const baseGuide = readFileSync(new URL("../studies/harness2/h2/base/CLAUDE.md", import.meta.url), "utf8");
    expect(field(rollsOf("base")[0], "guide")).toBe(baseGuide);
    expect(text(field(rollsOf("starter")[0], "guide"))).toBe(
      readFileSync(join(out, "trees", "starter", "CLAUDE.md"), "utf8"),
    );
    expect(text(field(rollsOf("heldout")[0], "guide"))).toBe(
      readFileSync(
        join(out, "adapt", "jb-cc-agg1", "alpha__task1", "harnesses", "agg1", "CLAUDE.md"),
        "utf8",
      ),
    );
    expect(rollsOf("k1")).toEqual([]);
    expect(rollsOf("dead")).toHaveLength(2);
    expect(rowsOf(calls).length).toBe(rolledOnce);
    expect(again.exitCode).toBe(0);
  });

  it("judges with judge.py's flags at medium through the shim, in a scrubbed environment", () => {
    const first = judges.find((row) => {
      const args = field(row, "args");
      return Array.isArray(args) && args.at(-1) === "base__alpha__task1";
    });
    const details = join(out, "dataset", "alpha", "task1", "eval_result", "eval_base__alpha__task1");
    expect(field(first, "args")).toEqual([
      join(jb, "eval", "judge.py"),
      "--output-dir",
      join(out, "dataset", "alpha", "task1", "model_output", "base__alpha__task1"),
      "--rubrics-file",
      join(jb, "dataset", "main", "alpha", "task1", "RUBRICS.json"),
      "--details-file",
      join(details, "claude-opus-5-5_judge.json"),
      "--judge-model",
      "anthropic/claude-opus-5-5",
      "--api-base",
      "http://127.0.0.1:9/v1",
      "--max-workers",
      "8",
      "--max-retries",
      "3",
      "--timeout-per-rubric",
      "240",
      "--evaluated-model",
      "base__alpha__task1",
    ]);
    for (const row of judges) {
      expect([field(row, "cwd"), field(row, "effort"), field(row, "key"), field(row, "scrubbed")]).toEqual([
        jb,
        "medium",
        "local-shim",
        null,
      ]);
    }
  });

  it("records points, dollars apart and the build each arm cost", () => {
    const base = record("base", FIRST);
    expect([
      field(base, "points"),
      field(base, "total"),
      field(base, "solveUsd"),
      field(base, "judgeUsd"),
    ]).toEqual([3, 5, 0.25, 0.02]);
    expect(field(base, "build")).toEqual({ of: "base", usd: 0 });
    const held = record("heldout", "alpha/task2");
    expect([field(held, "points"), field(held, "build", "usd")]).toEqual([5, 3.1875]);
    expect(field(record("k1", FIRST), "build")).toEqual({ of: "sweep alpha/task1", usd: 2.9375 });
    expect(field(record("k1", "alpha/task2"), "build")).toEqual({ of: "sweep alpha/task2", usd: 2.3125 });
    expect(field(record("k1", FIRST), "solveUsd")).toBe(0.25);
    expect(field(record("starter", FIRST), "harness")).toMatch(/^[0-9a-f]{16,}$/u);
    expect(field(record("peek", "beta/task1"), "peeked")).toEqual(["RUBRICS.json"]);
  });

  it("judges an empty delivery as zero, and records neither a dead agent nor an unanswered rubric", () => {
    const empty = record("empty", "beta/task1");
    expect([field(empty, "delivered"), field(empty, "points"), field(empty, "attempts")]).toEqual([
      false,
      0,
      2,
    ]);
    expect(field(empty, "judgeUsd")).toBe(0);
    expect(runs.dead.exitCode).toBe(1);
    expect(decodeOutput(runs.dead.stdout)).toContain("a non-result");
    expect(existsSync(join(out, "judged", "dead"))).toBe(false);
    expect(runs.flaky.exitCode).toBe(1);
    expect(existsSync(join(out, "judged", "flaky"))).toBe(false);
    const failed = join(out, "dataset", "beta", "task1", "eval_result", "eval_flaky__beta__task1");
    expect(readdirSync(failed)).toContain("claude-opus-5-5_judge.json.judge_failed");
  });

  it("prints the pilot's arms table over all the tasks and the fair ones", () => {
    const lines = decodeOutput(tabled.stdout).split("\n");
    expect(tabled.exitCode).toBe(0);
    const fairAt = lines.indexOf("fair 1");
    const [all, fairLines] = [lines.slice(0, fairAt), lines.slice(fairAt, lines.indexOf("fair uncut 1"))];
    expect(all).toContain("all 2");
    expect(all).toContain("  heldout    1 of 2 tasks scored");
    for (const [part, pattern] of [
      [
        all,
        /^ {2}base +score 6\/10 \(60\.0%\) system 0\.50 \(build 0\.00, solve 0\.50\) judge 0\.04 solve hours /u,
      ],
      [all, /^ {2}k1 +score 10\/10 \(100\.0%\) system 5\.75 \(build 5\.25, solve 0\.50\) judge 0\.04 /u],
      [fairLines, /^ {2}heldout +score 5\/5 \(100\.0%\) system [\d.]+ \(build 3\.19, /u],
    ] as const) {
      expect(part.filter((line) => pattern.test(line))).toHaveLength(1);
    }
    expect(lines).toContain("alpha/task1: base 3/5, k1 5/5, starter 3/5");
  });

  it("records the files the judge's reader cuts, a database and a file of exactly the cap not among them", () => {
    expect(runs.long.exitCode).toBe(0);
    expect(field(record("long", LONG), "cut")).toEqual([{ file: "long.csv", chars: 200_001 }]);
    for (const [name, task] of [
      ["base", FIRST],
      ["base", "alpha/task2"],
      ["heldout", "alpha/task2"],
      ["k1", FIRST],
    ] as const) {
      expect(field(record(name, task), "cut")).toEqual([]);
    }
    const lines = decodeOutput(tabledFair.stdout).split("\n");
    expect(lines).toContain(`${LONG}: long 3/5 CUT 1`);
    const uncutAt = lines.indexOf("fair uncut 1");
    expect(uncutAt).toBeGreaterThan(lines.indexOf("fair 2"));
    const uncut = lines.slice(uncutAt);
    expect(uncut.filter((line) => /^ {2}heldout +score 5\/5 /u.test(line))).toHaveLength(1);
    expect(uncut.filter((line) => /^ {2}long +0 of 1 tasks scored$/u.test(line))).toHaveLength(1);
  });
});
