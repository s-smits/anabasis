// One sweep of the TypeScript Harness² port (`studies/harness2/jobbench.ts`) end to end, with a
// stand-in `claude` first on its PATH and no credential in its environment, so no model is called.
// The stand-in writes deliverables and stream-json `result` events with `total_cost_usd` for each
// rollout, and edits `context/harness/` and replies as an improver session would, logging every
// call. Four tasks in three professions: alpha's two in order, so the second reads the first's
// library entry; beta's one, which never sees alpha's; and gamma's, whose deliverables carry a
// grader's verdict, so no session may see its evidence.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
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
import { basename, join } from "../src/meta/path.ts";
import { pooled } from "../src/meta/pool.ts";
import { capturedExecPath, capturedSpawn } from "../src/meta/process.ts";
import { decodeOutput, runSync } from "../src/meta/subprocess.ts";

interface RunOut {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

const FIRST = "alpha/task1";
/** The task every arm that is only a tree is scored on. */
const BETA = "beta/task1";
const TASKS = [FIRST, "alpha/task2", BETA, "gamma/task1"];
const SWEEP = new URL("../studies/harness2/jobbench.ts", import.meta.url).pathname;
const MARKER = '"pass_rate": 1';
const REJECTED = "YOUR PREVIOUS ATTEMPT WAS REJECTED";

const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-study-harness2-sweep-")));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const [jb, out, calls] = [join(root, "jb"), join(root, "out"), join(root, "calls.jsonl")];

/** The stand-in `claude`: a rollout when asked for stream-json, an improver session otherwise. */
const STAND_IN = `import { appendFileSync, existsSync, fstatSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
const LOG = ${JSON.stringify(calls)};
const args = process.argv.slice(2);
const rows = () => existsSync(LOG) ? readFileSync(LOG, "utf8").split("\\n").filter(Boolean).map((line) => JSON.parse(line)) : [];
const log = (row) => appendFileSync(LOG, JSON.stringify(row) + "\\n");
if (args.includes("stream-json")) {
  const ws = args[args.indexOf("--add-dir") + 1];
  // Neither the workspace nor the environment names the rollout, so its label is read from the
  // trajectory its stdout writes: <store>/<group>/<task>/model_traj/<label>/<file>.
  const ino = fstatSync(1).ino;
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? (entry.name === ".venv" ? [] : walk(join(dir, entry.name))) : entry.name.endsWith(".jsonl") && statSync(join(dir, entry.name)).ino === ino ? [join(dir, entry.name)] : []);
  const traj = walk(${JSON.stringify(root)})[0];
  const label = basename(dirname(traj));
  const taskDir = dirname(dirname(dirname(traj)));
  const attempt = rows().filter((row) => row.label === label).length + 1;
  const guide = existsSync(join(ws, "CLAUDE.md")) ? readFileSync(join(ws, "CLAUDE.md"), "utf8") : "";
  const files = (at) => readdirSync(join(ws, at), { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(join(at, entry.name)) : [join(at, entry.name)]);
  log({ kind: "rollout", label, attempt, guide, budget: args[args.indexOf("--max-budget-usd") + 1], env: process.env.MAX_BUDGET_USD ?? "", files: files("").sort(), path: process.env.PATH, venv: process.env.VIRTUAL_ENV ?? "", cwd: process.cwd(), named: ["LABEL", "TASK_IDS", "TASKS_BASE_DIR"].filter((key) => key in process.env) });
  const dead = guide.includes("DEAD");
  const empty = (label.endsWith("alpha__task1__base1") && attempt === 1) || guide.includes("EMPTY") || dead;
  if (!empty) writeFileSync(join(ws, "output", "report.md"), (label.includes("gamma") ? ${JSON.stringify(`${MARKER}\n`)} : "") + "report by " + label + "\\n" + guide);
  if (guide.includes("LONG")) for (const [name, size] of [["long.csv", 200001], ["exact.csv", 200000], ["data.db", 200001]]) writeFileSync(join(ws, "output", name), "x".repeat(size));
  // CUT leaves a file where its deliverable folder belongs, so that the rollout throws at its delivery.
  if (guide.includes("CUT")) writeFileSync(join(taskDir, "model_output", label), "in the way");
  // PEEK reads a rubric, STORE lists other arms' deliverables, and VENV only meets a traceback through
  // the benchmark's interpreter, which every rollout imports from.
  const command = guide.includes("PEEK") ? "cat ../RUBRICS.json" : guide.includes("STORE") ? "ls " + join(taskDir, "model_output") : guide.includes("VENV") ? "python3 -c 'import pandas' # " + join(process.env.VIRTUAL_ENV, "lib", "site-packages", "pandas", "__init__.py") : null;
  const said = command === null ? { type: "text", text: "working" } : { type: "tool_use", name: "Bash", input: { command } };
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
    for (const task of [FIRST, "alpha/task2", BETA]) {
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
      expect(read(BETA, job)).toBeNull();
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
// The scorer's question before its first rollout, python -m pip --version, and its repair, python
// -m ensurepip: this interpreter has no pip until ensurepip ran once.
if (args[0] === "-m") {
  const pip = ${JSON.stringify(join(root, "pip.txt"))};
  const had = existsSync(pip);
  appendFileSync(pip, args[1] + "\\n");
  process.exit(args[1] === "ensurepip" || had ? 0 : 1);
}
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
  // A rubric that fails is one criterion short of its weight in criteria, as a near miss is.
  return { index, weight: rubric.weight, result: { passed, score: passed ? rubric.weight : 0, criteria_count: rubric.weight, criteria_passed: rubric.weight - (passed ? 0 : 1), overall_reasoning } };
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
  for (const word of ["PEEK", "STORE", "VENV", "DEAD", "EMPTY", "FLAKY", "LONG", "CUT"]) {
    mkdirSync(join(root, "trees", word), { recursive: true });
    writeFileSync(join(root, "trees", word, "CLAUDE.md"), `# ${word}\n`);
  }
  const spawnOut = async (cmd: string[], extraEnv: Record<string, string>): Promise<RunOut> => {
    const child = capturedSpawn(cmd, { env: extraEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { exitCode, stdout, stderr };
  };
  const scored = (arm: string, name: string, tasks: string, ...flags: string[]) =>
    spawnOut(
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
      { ...env, ANTHROPIC_API_KEY: "never-reaches-the-judge" },
    );
  const tableCmd = (...args: string[]) =>
    spawnOut([capturedExecPath, SCORE, "table", "--out", out, ...args], env);
  // Two exported arms already in the store: one whose tool tree holds a program for a processor no
  // host of the suite has (32-bit Arm), one holding the opening bytes of the Bun this test runs on.
  const armElf = Buffer.alloc(20);
  armElf.writeUInt32BE(0x7f_45_4c_46, 0);
  armElf.writeUInt16LE(40, 18);
  for (const [name, program] of [
    ["foreign", armElf],
    ["native", readFileSync(capturedExecPath).subarray(0, 128)],
  ] as const) {
    mkdirSync(join(out, "trees", name, "harness", ".toolchain", "bin"), { recursive: true });
    mkdirSync(join(out, "trees", name, "harness", "agent"), { recursive: true });
    writeFileSync(join(out, "trees", name, "harness", ".toolchain", "bin", "tool"), program);
    writeFileSync(
      join(out, "trees", name, "harness", "agent", "tools-spec.json"),
      JSON.stringify({ presets: ["bash"], tools: [] }),
    );
    writeFileSync(
      join(out, "trees", name, "export.json"),
      JSON.stringify({ harness: name, mode: "pi", toolchain: "harness/.toolchain" }),
    );
  }
  const alpha = "alpha/task1,alpha/task2";
  const treeArm = (word: string) =>
    scored(`tree:${join(root, "trees", word)}`, word.toLowerCase(), BETA, "--yes");
  const record = (name: string, task: string): JsonValue =>
    readJson(join(out, "judged", name, `${task.replace("/", "__")}.json`));
  const emptyOut: RunOut = { exitCode: -1, stdout: "", stderr: "" };
  let before = 0;
  let calledBefore = 0;
  let rolledOnce = 0;
  let foreignArm = emptyOut;
  let nativeArm = emptyOut;
  let refused = emptyOut;
  let planned = emptyOut;
  let runs: Record<string, RunOut> = {};
  let again = emptyOut;
  let tabled = emptyOut;
  let tabledFair = emptyOut;
  let tabledPair = emptyOut;
  let tabledUncounted = emptyOut;
  let tabledOwn = emptyOut;
  let tabledAbsent = emptyOut;
  let rolls: JsonValue[] = [];
  let judges: JsonValue[] = [];
  const rollsOf = (name: string) => rolls.filter((row) => text(field(row, "label")).startsWith(`${name}__`));

  beforeAll(async () => {
    before = rowsOf(calls).length;
    [foreignArm, nativeArm, refused, planned] = await Promise.all([
      scored("pi:starter", "foreign", FIRST, "--dry-run"),
      scored("pi:starter", "native", FIRST, "--dry-run"),
      scored("base", "base", alpha),
      scored("base", "base", alpha, "--dry-run"),
    ]);
    calledBefore = rowsOf(calls).length;
    const base = await scored("base", "base", alpha, "--yes");
    const k1 = await scored("sweep:agg1", "k1", alpha, "--yes");
    const empty = await treeArm("EMPTY");
    const armJobs: readonly [string, () => Promise<RunOut>][] = [
      ["heldout", () => scored("heldout", "heldout", "alpha/task2", "--yes")],
      ["peek", () => treeArm("PEEK")],
      ["store", () => treeArm("STORE")],
      ["venv", () => treeArm("VENV")],
      ["dead", () => treeArm("DEAD")],
      ["flaky", () => treeArm("FLAKY")],
      ["long", () => scored(`tree:${join(root, "trees", "LONG")}`, "long", LONG, "--yes")],
      ["cut", () => treeArm("CUT")],
    ];
    const settled = await pooled(armJobs, 4, async ([name, fn]) => [name, await fn()] as const);
    const cutAgain = await treeArm("CUT");
    runs = { base, k1, empty, ...Object.fromEntries(settled), cutAgain };
    rolledOnce = rowsOf(calls).length;
    [again, tabled, tabledFair, tabledPair] = await Promise.all([
      scored("base", "base", alpha, "--yes"),
      tableCmd("--tasks", alpha),
      tableCmd("--tasks", `alpha/task2,${LONG}`),
      tableCmd("--tasks", `alpha/task2,${LONG}`, "--name", "heldout, k1"),
    ]);
    rolls = rowsOf(calls).slice(before);
    judges = rowsOf(join(root, "judge.jsonl"));
    const heldout = record("heldout", "alpha/task2");
    if (!isRecord(heldout)) throw new Error("the fixture holds no record of heldout on alpha/task2");
    mkdirSync(join(out, "judged", "uncounted"));
    writeFileSync(
      join(out, "judged", "uncounted", "alpha__task2.json"),
      JSON.stringify({ ...heldout, arm: "uncounted", cut: null }),
    );
    [tabledUncounted, tabledOwn, tabledAbsent] = await Promise.all([
      tableCmd("--tasks", `alpha/task2,${LONG}`, "--name", "heldout,uncounted"),
      tableCmd("--name", "heldout,k1"),
      tableCmd("--name", "absent"),
    ]);
  }, 280_000);

  it("starts nothing without --yes, and plans without a call under --dry-run", () => {
    expect(refused.exitCode).not.toBe(0);
    expect(refused.stderr).toContain("--yes");
    expect(planned.exitCode).toBe(0);
    expect(planned.stdout).toContain("claude-opus-5-5 at high, $5 and 3600 s an attempt");
    expect(calledBefore).toBe(before);
  });

  it("gives the rollouts' interpreter a pip of its own once, where it has none, and asks under the word alone", () => {
    const asked = readFileSync(join(root, "pip.txt"), "utf8").trim().split("\n");
    // The refusal and the plans asked nothing; the first scoring found none and added one, and
    // every later scoring found it there.
    expect(asked.slice(0, 3)).toEqual(["pip", "ensurepip", "pip"]);
    expect(asked.filter((what) => what === "ensurepip")).toHaveLength(1);
    expect(runs.base?.stdout).toContain("installer: pip added for");
    expect(runs.peek?.stdout).not.toContain("installer:");
  });

  it("refuses an arm whose programs this machine cannot run, and plans one whose programs it can", () => {
    expect(foreignArm.exitCode).not.toBe(0);
    expect(foreignArm.stderr).toContain("holds 1 programs this machine");
    expect(foreignArm.stderr).toContain("bin/tool (an ELF binary for machine 40)");
    expect(nativeArm.exitCode).toBe(0);
    expect(nativeArm.stdout).toContain(join(out, "trees", "native"));
  });

  it("solves each task once under the arm's tree, with the sweep's PATH and cap, and no grader in reach", () => {
    expect(runs.base?.exitCode).toBe(0);
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
      // An install that names no interpreter takes the one `python3` starts.
      expect(field(row, "venv")).toBe(join(jb, ".venv"));
      const files = field(row, "files");
      expect(
        Array.isArray(files) && files.some((name) => /RUBRICS|eval_result|judged/u.test(text(name))),
      ).toBe(false);
      // Neither the workspace the prompt spells nor the environment names the arm or the store.
      const task = text(field(row, "label")).split("__").slice(1).join("_");
      expect(basename(text(field(row, "cwd")))).toMatch(new RegExp(`^${task}_[A-Za-z0-9]{6}$`, "u"));
      expect(field(row, "named")).toEqual([]);
    }
    const baseGuide = readFileSync(new URL("../studies/harness2/h2/base/CLAUDE.md", import.meta.url), "utf8");
    expect(field(rollsOf("base")[0], "guide")).toBe(baseGuide);
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
    expect(field(record("peek", BETA), "peeked")).toEqual(["RUBRICS.json"]);
    // The suite's folder is named for the study, as a checkout's path can be, and flags nothing.
    expect(field(record("store", BETA), "peeked")).toEqual([join(out, "dataset"), "model_output"]);
    expect(field(record("venv", BETA), "peeked")).toEqual([]);
  });

  it("judges an empty delivery as zero, and records neither a dead agent nor an unanswered rubric", () => {
    const empty = record("empty", BETA);
    expect([field(empty, "delivered"), field(empty, "points"), field(empty, "attempts")]).toEqual([
      false,
      0,
      2,
    ]);
    expect(field(empty, "judgeUsd")).toBe(0);
    expect(runs.dead?.exitCode).toBe(1);
    expect(runs.dead?.stdout).toContain("a non-result");
    expect(existsSync(join(out, "judged", "dead"))).toBe(false);
    expect(runs.flaky?.exitCode).toBe(1);
    expect(existsSync(join(out, "judged", "flaky"))).toBe(false);
    const failed = join(out, "dataset", "beta", "task1", "eval_result", "eval_flaky__beta__task1");
    expect(readdirSync(failed)).toContain("claude-opus-5-5_judge.json.judge_failed");
  });

  it("reads a rollout that threw at its delivery as a non-result, and rolls it again", () => {
    for (const run of [runs.cut, runs.cutAgain]) {
      expect(run?.exitCode).toBe(1);
      expect(run?.stdout).toContain("a non-result");
    }
    expect(rollsOf("cut")).toHaveLength(2);
    expect(judges.filter((row) => text(field(row, "args")).includes("cut__beta__task1"))).toEqual([]);
    expect(existsSync(join(out, "judged", "cut"))).toBe(false);
  });

  it("prints the pilot's arms table over all the tasks and the fair ones", () => {
    const lines = tabled.stdout.split("\n");
    expect(tabled.exitCode).toBe(0);
    const fairAt = lines.indexOf("fair 1");
    const [all, fairLines] = [lines.slice(0, fairAt), lines.slice(fairAt, lines.indexOf("fair uncut 1"))];
    expect(all).toContain("all 2");
    expect(all).toContain("  heldout    1 of 2 tasks scored");
    for (const [part, pattern] of [
      [
        all,
        /^ {2}base +score 6\/10 \(60\.0%\) criteria 8\/10 system 0\.50 \(build 0\.00, solve 0\.50\) judge 0\.04 solve hours /u,
      ],
      [
        all,
        /^ {2}k1 +score 10\/10 \(100\.0%\) criteria 10\/10 system 5\.75 \(build 5\.25, solve 0\.50\) judge 0\.04 /u,
      ],
      [fairLines, /^ {2}heldout +score 5\/5 \(100\.0%\) criteria 5\/5 system [\d.]+ \(build 3\.19, /u],
    ] as const) {
      expect(part.filter((line) => pattern.test(line))).toHaveLength(1);
    }
    expect(lines).toContain("alpha/task1: base 3/5, k1 5/5");
  });

  it("records the files the judge's reader cuts, a database and a file of exactly the cap not among them", () => {
    expect(runs.long?.exitCode).toBe(0);
    expect(field(record("long", LONG), "cut")).toEqual([{ file: "long.csv", chars: 200_001 }]);
    for (const [name, task] of [
      ["base", FIRST],
      ["base", "alpha/task2"],
      ["heldout", "alpha/task2"],
      ["k1", FIRST],
    ] as const) {
      expect(field(record(name, task), "cut")).toEqual([]);
    }
    const lines = tabledFair.stdout.split("\n");
    expect(lines).toContain(`${LONG}: long 3/5 CUT 1`);
    const uncutAt = lines.indexOf("fair uncut 1");
    expect(uncutAt).toBeGreaterThan(lines.indexOf("fair 2"));
    const uncut = lines.slice(uncutAt);
    expect(uncut.filter((line) => /^ {2}heldout +score 5\/5 /u.test(line))).toHaveLength(1);
    expect(uncut.filter((line) => /^ {2}long +0 of 1 tasks scored$/u.test(line))).toHaveLength(1);
    // Between two arms that cut nothing, the third arm's cut file takes no task out.
    const pair = tabledPair.stdout.split("\n");
    expect(pair).toContain("fair uncut 2");
    expect(pair.filter((line) => /^ {2}long /u.test(line))).toEqual([]);
    // A cut nobody could count is not read as none, and a label with no records is refused.
    expect(tabledUncounted.stdout.split("\n")).toContain("fair uncut 1");
    const own = tabledOwn.stdout.split("\n");
    expect(own).toContain("all 2");
    expect(own).toContain("  heldout    1 of 2 tasks scored");
    expect(tabledAbsent.exitCode).not.toBe(0);
    expect(tabledAbsent.stderr).toContain(join("judged", "absent"));
  });
});
