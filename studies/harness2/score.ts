/**
 * External JobBench arm runner, judge wrapper, and arms/spread table reader.
 *
 *   bun studies/harness2/score.ts score --arm <arm> --name <name> --out <dir> --jb <checkout>
 *     --api-base <url> [--harness <kept>] [--tasks <profession/taskN,...>] [--judge-log <shim.jsonl>]
 *     [--solve-only] [--rubrics <file>] [--cap <chars>] [--dry-run] --yes
 *   bun studies/harness2/score.ts table --out <dir> [--tasks <profession/taskN,...>] [--name <name,...>]
 *   bun studies/harness2/score.ts spread --out <dir> --name <rollout,...>
 *   bun studies/harness2/score.ts tree --arm <arm> --name <name> --out <dir> --for <linux-x64> [--python <3.12>]
 *     [--harness <kept>]
 *
 * Arms may be `pi:base`, `pi:starter`, `pi:<campaign>` (Anabasis native `pi-durable`), or `base`,
 * `tree:<dir>`, `heldout`, `again:<side>`, `sweep:base1`, `sweep:agg1` (Harness²). Rollouts run
 * sequentially under the benchmark's PATH and judge (`eval/judge.py`); records land in
 * `<out>/judged/<name>/` and track file-length cuts (`cut`) and workspace escape needles (`peeked`).
 */
import { openHarness } from "#src/harness/open.ts";
import { billedAll } from "#src/kernel/meter.ts";
import { read } from "#src/kernel/log.ts";
import { TOOL_TREE_DIR } from "#src/meta/bundle-layout.ts";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "#src/meta/filesystem.ts";
import { capturedJsonParse, capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { isNumber, isRecord, isString, type JsonObject, type JsonValue } from "#src/meta/json-shape.ts";
import { keyIfDefined, keyIfNotNull, keysIf } from "#src/meta/optional-key.ts";
import { tmpdir } from "#src/meta/os.ts";
import { basename, dirname, join, resolve } from "#src/meta/path.ts";
import { capturedExecPath, parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { runSync } from "#src/meta/subprocess.ts";
import { LIMITS } from "#tools/d2/campaign.ts";
import { logAcross } from "#tools/runs/snapshots.ts";
import { foreignPrograms, placeOf } from "#src/harness/place.ts";
import { HARNESS_DIR, HERE, ownPython, placeHarness, sourceNamed } from "../shared/bundle.ts";
import { rebuildForeignPython, uvPython } from "../shared/foreign-python.ts";
import { RESULT_FILE, TRACE_FILE } from "../shared/pi-solve.ts";
import { inGroup, REFUSED, type Agent, type Claude } from "./h2/claude.ts";
import { NAMESPACE } from "./h2/recursion.ts";
import { cutOf, envOf, jobBench, MAX_CHARS_PER_FILE, ownInstaller, pilotClaude, SCRUB } from "./jobbench.ts";

/** The judge as the pilot ran it (`h2l1.sh`, `judge-arm.sh`, `_run_judge`). */
const JUDGE = { model: "anthropic/claude-opus-5-5", effort: "medium", timeoutS: 1800 } as const;
const DETAILS = "claude-opus-5-5_judge.json";
/**
 * judge.py run whole under a wider cut: loaded as a module, as `EXTRACT_DRIVER` loads it, with its
 * `MAX_CHARS_PER_FILE` set before `main()` reads its flags from `sys.argv` through argparse;
 * `extract_all_file_contents` reads that global at each call.
 */
const WIDER = `import importlib.util, sys

judge_py, cap = sys.argv[1], int(sys.argv[2])
spec = importlib.util.spec_from_file_location("_jb_judge_wider", judge_py)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
mod.MAX_CHARS_PER_FILE = cap
sys.argv = [judge_py, *sys.argv[3:]]
mod.main()
`;
/** `_JUDGE_FAILURE_PREFIXES`: a rubric whose reasoning opens so was never judged. */
const FAILED = [
  "opus judge failed",
  "failed after",
  "failed to get judge response",
  "judge raised an exception:",
];
export const PILOT_TASKS = [
  "biostatisticians/task1",
  "biostatisticians/task2",
  "statisticians/task1",
  "statisticians/task2",
  "statisticians/task3",
  "social_science_research_assistants/task1",
  "social_science_research_assistants/task2",
  "social_science_research_assistants/task3",
];
const STAGES = ["base1", "inv1", "dom1", "agg1"];
const PI = "pi:";
/** The store's folder of each task's deliverables, one folder an arm. */
const OUTPUT = "model_output";
const PI_SOLVE = join(import.meta.dir, "..", "shared", "pi-solve.ts");
/** A `pi-solve.ts` ending as Claude Code's log names it: a spent budget gets no second attempt, and
 *  a session that threw or the provider failed is a non-result, rolled again (rule 7). */
const PI_RESULT = new Map(
  Object.entries({ submitted: "success", budget: "error_max_budget_usd", crash: REFUSED, provider: REFUSED }),
);

/** What a score's build cost: `of` names what was built, so an arm counts each build once. */
interface Build {
  readonly of: string;
  readonly usd: number;
}

interface Arm {
  readonly name: string;
  /** The digest, tree or sweep stage the arm's records name. */
  readonly harness: string;
  /** The tree a task is solved under, or null where the sweep already solved it. */
  readonly tree: (task: string) => string | null;
  readonly label: (task: string) => string;
  readonly build: (task: string) => Build | null;
}

/** The options of `score`, as `parseArgs` reads them. */
export interface Values {
  readonly arm?: string;
  readonly name?: string;
  readonly harness?: string;
  readonly tasks?: string;
  readonly out?: string;
  readonly jb?: string;
  readonly "api-base"?: string;
  readonly "judge-log"?: string;
  readonly rubrics?: string;
  readonly "solve-only"?: boolean;
  readonly cap?: string;
  readonly "dry-run"?: boolean;
  readonly yes?: boolean;
  readonly for?: string;
  readonly python?: string;
}

/** How one judgement runs: the transport, the shim's log, the rubrics and any wider cut. */
interface Judging {
  readonly apiBase: string;
  readonly shimLog: string | undefined;
  readonly rubrics: string | undefined;
  readonly cap: number | undefined;
}

interface ScoreContext {
  readonly jb: string;
  readonly store: string;
  readonly judged: string;
  readonly arm: Arm;
  readonly pi: boolean;
  readonly how: Judging;
  readonly needles: readonly string[];
  readonly solveOnly: boolean;
}

const OPTIONS = {
  arm: { type: "string" },
  name: { type: "string" },
  harness: { type: "string" },
  tasks: { type: "string" },
  out: { type: "string" },
  jb: { type: "string" },
  "api-base": { type: "string" },
  "judge-log": { type: "string" },
  rubrics: { type: "string" },
  "solve-only": { type: "boolean" },
  cap: { type: "string" },
  "dry-run": { type: "boolean" },
  yes: { type: "boolean" },
  for: { type: "string" },
  python: { type: "string" },
} as const;

/** `--cap` as a count of characters: a whole number above judge.py's own cut, or a refusal. */
export function capOf(cap: string | undefined): number | undefined {
  if (cap === undefined) return undefined;
  const chars = Number(cap);
  if (!Number.isInteger(chars) || chars <= MAX_CHARS_PER_FILE) {
    throw new Error(
      `--cap takes a whole number of characters above judge.py's ${String(MAX_CHARS_PER_FILE)}`,
    );
  }
  return chars;
}

export const keyOf = (task: string): string => task.replace("/", "__");
/** The tasks with a task before them in their profession, the held-out arm's (`heldout.sh`). */
export const hasOneBefore = (task: string): boolean => !task.endsWith("/task1");
const fair = (tasks: readonly string[]): string[] => tasks.filter(hasOneBefore);
export const tasksOf = (named: string | undefined, otherwise: readonly string[]): string[] =>
  named === undefined
    ? [...otherwise]
    : named
        .split(",")
        .map((task) => task.trim())
        .filter((task) => task !== "");
const field = (value: JsonValue | undefined, ...keys: string[]): JsonValue | undefined =>
  keys.reduce<JsonValue | undefined>((at, key) => (isRecord(at) ? at[key] : undefined), value);
const readJson = (path: string): JsonValue =>
  existsSync(path) ? capturedJsonParse(readFileSync(path, "utf8")) : null;
/** Where judge.py's details of one label lie in a store's dataset. */
const detailsOf = (store: string, task: string, label: string): string =>
  join(store, task, "eval_result", `eval_${label}`, DETAILS);
/** A JSON value as text, as a record prints it. */
const text = (value: JsonValue | undefined): string =>
  isString(value) ? value : value === undefined ? "" : capturedJsonStringify(value);

/**
 * The runner's own log of one label, as the pilot's `costs.py` and `walls.py` read it: the dollars
 * of every attempt in every log, and the newest log's start to its last attempt. `ran` is false
 * where no attempt of the newest log reached a `result` of the arm's own, which is a dead agent or
 * a refused session (`REFUSED`), and where that log lacks the line a rollout closes with, which is
 * one that threw or was killed before its delivery: neither is a zero.
 */
function rolloutLog(store: string, task: string, label: string) {
  const dir = join(store, ".harness2-logs");
  const prefix = `hevo_${task.replace("/", "_")}_${label}_`;
  const logs = (existsSync(dir) ? readdirSync(dir) : [])
    .filter((name) => name.startsWith(prefix) && /^\d{8}_\d{6}\.log$/u.test(name.slice(prefix.length)))
    .toSorted();
  const texts = logs.map((name) => readFileSync(join(dir, name), "utf8"));
  const attempts = texts.map((log) =>
    [
      ...log.matchAll(
        /\[(\d\d):(\d\d):(\d\d)\] attempt \d+: rc=-?\d+ result=(\S*) turns=\d+ tools=\d+ cost_usd=([\d.]+)/gu,
      ),
    ].map((match) => ({
      clock: match.slice(1, 4).map(Number),
      result: match[4] ?? "",
      usd: Number(match[5]),
    })),
  );
  const last = attempts.at(-1) ?? [];
  const stamp = /(\d{4})(\d\d)(\d\d)_(\d\d)(\d\d)(\d\d)\.log$/u
    .exec(logs.at(-1) ?? "")
    ?.slice(1)
    .map(Number);
  const end = last.at(-1)?.clock;
  let seconds: number | null = null;
  if (stamp !== undefined && end !== undefined) {
    const [year = 0, month = 1, day = 1, ...clock] = stamp;
    const at = (hms: readonly number[]): number =>
      new Date(year, month - 1, day, hms[0] ?? 0, hms[1] ?? 0, hms[2] ?? 0).getTime() / 1000;
    seconds = (at(end) - at(clock) + 86_400) % 86_400;
  }
  return {
    usd: attempts.flat().reduce((sum, attempt) => sum + attempt.usd, 0),
    attempts: last.length,
    ran:
      /^\[[\d:]+\] (?:output -> |NO OUTPUT for )/mu.test(texts.at(-1) ?? "") &&
      last.some((attempt) => attempt.result !== "None" && attempt.result !== REFUSED),
    seconds,
  };
}

/** Where one attempt's solver writes: outside `model_traj`, whose files a record reads flat. */
const piLogs = (traj: string): string => join(tmpdir(), "pi-solve-logs", basename(traj, ".jsonl"));

/** One attempt of a pi arm: `pi-solve.ts` inside the placed harness on the pilot's model, effort and
 *  dollars, its wall two minutes inside the hold; its trace is copied, as the store is another mount. */
export function piAgent(claude: Claude): Agent {
  return {
    argv: ({ prompt, treeDir, traj }) => {
      const logs = piLogs(traj);
      rmSync(logs, { recursive: true, force: true });
      mkdirSync(logs, { recursive: true });
      writeFileSync(join(logs, "instruction.md"), prompt);
      const sourceHarness = join(treeDir, HARNESS_DIR);
      const stagedHarness = join(logs, HARNESS_DIR);
      let harness = sourceHarness;
      if (existsSync(sourceHarness)) {
        cpSync(sourceHarness, stagedHarness, { recursive: true, verbatimSymlinks: true });
        harness = stagedHarness;
      }
      const flags = {
        harness,
        instruction: join(logs, "instruction.md"),
        solver: `claude/${claude.model}`,
        effort: claude.effort,
        "wall-minutes": String(Math.floor(claude.timeoutS / 60) - 2),
        "budget-usd": claude.budgetUsd,
        prompts: String(LIMITS.turns),
        logs,
      };
      const wrap = runtimeProcess.env.ANA_SOLVER_WRAP;
      return [
        ...(wrap !== undefined && wrap !== "" ? [wrap] : []),
        capturedExecPath,
        PI_SOLVE,
        ...Object.entries(flags).flatMap(([name, value]) => [`--${name}`, value]),
      ];
    },
    seen: (traj) => {
      const logs = piLogs(traj);
      const result = readJson(join(logs, RESULT_FILE));
      const trace = join(logs, TRACE_FILE);
      const calls = existsSync(trace) ? read(trace).filter(({ kind }) => kind === "solve.call").length : 0;
      if (existsSync(trace)) cpSync(trace, traj);
      rmSync(logs, { recursive: true, force: true });
      const ending = text(field(result, "ending"));
      const [turns, reported, billed] = ["turns", "reportedCost", "billed"].map((key) => field(result, key));
      return {
        turns: isNumber(turns) ? turns : 0,
        subtype: ending === "" ? "None" : (PI_RESULT.get(ending) ?? ending),
        tools: calls,
        costUsd: isNumber(reported) ? reported : isNumber(billed) ? billed : 0,
      };
    },
  };
}

/** The solver's own dry run of a pi arm, no model called: its tools and programs, or a refusal. */
function piDry(claude: Claude, tree: string): string {
  const traj = join(tmpdir(), `pi-dry-${String(runtimeProcess.pid)}.jsonl`);
  const argv = piAgent(claude).argv({ prompt: "A dry run.", treeDir: tree, workspace: tmpdir(), traj });
  runSync([...argv, "--dry-run"], { cwd: tmpdir(), env: claude.env });
  const result = readJson(join(piLogs(traj), RESULT_FILE));
  rmSync(piLogs(traj), { recursive: true, force: true });
  if (field(result, "ending") !== "dry-run") throw new Error(`pi-solve cannot open ${tree}: ${text(result)}`);
  const found = text(field(result, "found")).trim().split("\n").filter(Boolean);
  const missing = found.filter((line) => line.startsWith("missing: "));
  if (missing.length > 0) throw new Error(`pi-solve missing programs in ${tree}: ${missing.join(", ")}`);
  return `  pi-solve: tools ${text(field(result, "tools"))}; ${String(found.length)} installed programs${found.length === 0 ? "" : `: ${found.join(", ")}`}`;
}

/** What the sweep in `out` spent to build the harness of `task` before the `except` rollouts. */
function sweepBuild(out: string, task: string, rollouts: readonly string[]): Build | null {
  const summary = readJson(join(out, "adapt", NAMESPACE, keyOf(task), "summary.json"));
  const sessions = field(summary, "modes", "agg", "ledger", "session_usd");
  const selector = field(summary, "selections", "agg", "usd");
  if (!isNumber(sessions)) return null;
  const rolled = rollouts.reduce(
    (sum, stage) =>
      sum + rolloutLog(join(out, "dataset"), task, `${NAMESPACE}__${keyOf(task)}__${stage}`).usd,
    0,
  );
  return { of: `sweep ${task}`, usd: sessions + (isNumber(selector) ? selector : 0) + rolled };
}

/** The task before `task` in its profession, whose final harness the held-out arm solves under. */
function before(task: string): string {
  const [profession = "", name = ""] = task.split("/");
  const n = Number(/^task(\d+)$/u.exec(name)?.[1] ?? 0);
  if (n < 2) throw new Error(`${task} has no task before it, so the held-out arm cannot score it`);
  return `${profession}/task${n - 1}`;
}

async function exportPiTree(
  into: string,
  source: ReturnType<typeof sourceNamed>,
  place: ReturnType<typeof placeOf>,
): Promise<void> {
  const part = `${into}.part-${String(runtimeProcess.pid)}`;
  const origin = await placeHarness(join(part, HARNESS_DIR), source);
  // Hash the kept harness before cross-platform Python rebuilds mutate `.toolchain/`.
  const harnessDigest = (await openHarness(join(part, HARNESS_DIR))).digest;
  const toolTree = join(part, HARNESS_DIR, TOOL_TREE_DIR);
  const hasTools = existsSync(toolTree);
  const rebuilt = hasTools ? await rebuildForeignPython(toolTree, place, uvPython(place)) : null;
  writeFileSync(
    join(part, "export.json"),
    `${capturedJsonStringify(
      {
        harness: harnessDigest,
        mode: "pi",
        ...origin,
        toolchain: hasTools ? join(HARNESS_DIR, TOOL_TREE_DIR) : null,
        ...keyIfNotNull("rebuilt", rebuilt === null ? null : { for: place.name, ...rebuilt }),
      },
      null,
      2,
    )}\n`,
  );
  renameSync(part, into);
}

async function exportedArm(
  name: string,
  from: string,
  context: {
    readonly harness: string | undefined;
    readonly out: string;
    readonly place: ReturnType<typeof placeOf>;
  },
): Promise<Arm> {
  const { harness, out, place } = context;
  const source = sourceNamed(from, harness);
  const into = join(out, "trees", name);
  if (!existsSync(into)) await exportPiTree(into, source, place);
  const record = readJson(join(into, "export.json"));
  const digest = field(record, "harness") ?? (await openHarness(join(into, HARNESS_DIR))).digest;
  const toolchain =
    isRecord(record) && "toolchain" in record ? field(record, "toolchain") : join(HARNESS_DIR, TOOL_TREE_DIR);
  if (isString(toolchain)) await foreignPrograms(join(into, toolchain), place);
  const priced = `${into}.build.json`;
  if (!existsSync(priced)) {
    const usd = from === "starter" || from === "base" ? 0 : billedAll(read(await logAcross(from)));
    writeFileSync(priced, `${capturedJsonStringify({ of: from, usd })}\n`);
  }
  const [of, usd] = [field(readJson(priced), "of"), field(readJson(priced), "usd")];
  if (!isString(of) || !isNumber(usd)) throw new Error(`${priced} names no build`);
  const build = { of, usd };
  return {
    name,
    harness: isString(digest) ? digest : into,
    tree: () => into,
    build: () => build,
    label: (task) => `${name}__${keyOf(task)}`,
  };
}

async function armOf(values: Values, out: string, baseHarness: string, place = HERE): Promise<Arm> {
  const { arm = "", name = "" } = values;
  if (name === "" || name.includes("__") || name.includes("/") || name.startsWith(NAMESPACE)) {
    throw new Error(`--name '${name}' must be a plain label prefix, not '${NAMESPACE}'`);
  }
  const rolled = (harness: string, tree: (task: string) => string, build: Arm["build"]): Arm => ({
    name,
    harness,
    tree,
    build,
    label: (task) => `${name}__${keyOf(task)}`,
  });
  if (arm === "sweep:base1" || arm === "sweep:agg1") {
    const stage = arm.slice("sweep:".length);
    return {
      name,
      harness: arm,
      tree: () => null,
      label: (task) => `${NAMESPACE}__${keyOf(task)}__${stage}`,
      build: (task) =>
        stage === "base1" ? { of: "base", usd: 0 } : sweepBuild(out, task, STAGES.slice(0, 3)),
    };
  }
  if (arm.startsWith("again:")) {
    return {
      name,
      harness: arm,
      tree: () => null,
      label: (task) => `${name}__${keyOf(task)}`,
      build: () => null,
    };
  }
  if (arm === "heldout") {
    return rolled(
      "heldout",
      (task) => join(out, "adapt", NAMESPACE, keyOf(before(task)), "harnesses", "agg1"),
      (task) => sweepBuild(out, before(task), STAGES),
    );
  }
  if (arm === "base") {
    return rolled(
      baseHarness,
      () => baseHarness,
      () => ({ of: "base", usd: 0 }),
    );
  }
  if (arm.startsWith("tree:")) {
    const dir = resolve(arm.slice("tree:".length));
    return rolled(
      dir,
      () => dir,
      () => null,
    );
  }
  if (arm === "") throw new Error("name --arm");
  if (!arm.startsWith(PI)) {
    throw new Error(`Anabasis arms run natively on pi-durable: pass --arm pi:${arm}`);
  }
  return await exportedArm(name, arm.slice(PI.length), {
    harness: values.harness,
    out,
    place,
  });
}

/** `_judge_failed` and the partial check of `_read_details`: details that are no judgement. */
function unjudged(got: JsonObject): string | null {
  const rubrics = Array.isArray(got.rubrics) ? got.rubrics : Array.isArray(got.details) ? got.details : [];
  if (isString(got.error) && got.error.trim() !== "" && rubrics.length === 0) {
    return `judge error: ${got.error}`;
  }
  if (
    ["overall_reasoning", "reasoning", "error"].some((key) =>
      text(got[key]).toLowerCase().includes("judge failed"),
    )
  ) {
    return "judge failed";
  }
  const reasons = rubrics.map(
    (rubric) => field(rubric, "result", "overall_reasoning") ?? field(rubric, "overall_reasoning"),
  );
  if (reasons.some((reason) => FAILED.some((prefix) => text(reason).toLowerCase().startsWith(prefix)))) {
    return "a rubric the judge never answered";
  }
  const count = got.total_count;
  return isNumber(count) && count > 0 && rubrics.length < count
    ? `partial: ${rubrics.length}/${count} rubrics`
    : null;
}

/** The shim's dollars for the requests it took between `from` and `to`, in Unix seconds. */
function shimDollars(log: string, from: number, to: number): number {
  let sum = 0;
  for (const line of readFileSync(log, "utf8")
    .split("\n")
    .filter((each) => each.trim() !== "")) {
    const row = capturedJsonParse(line);
    const [at, usd] = [field(row, "t"), field(row, "usage", "total_cost_usd")];
    if (isNumber(at) && at >= from && at <= to && isNumber(usd)) sum += usd;
  }
  return sum;
}

/** judge.py on one rollout's output, unless its details are on record; why, where it judged nothing. */
async function judge(
  jb: string,
  place: { store: string; task: string; label: string },
  how: Judging,
): Promise<{ details: JsonObject; usd: number | null } | string> {
  const { apiBase, shimLog, cap } = how;
  const rubrics = how.rubrics ?? join(jb, "dataset", "main", place.task, "RUBRICS.json");
  const output = join(place.store, place.task, OUTPUT, place.label);
  const details = detailsOf(place.store, place.task, place.label);
  const judgePy = join(jb, "eval", "judge.py");
  let usd: number | null = null;
  if (!existsSync(details) || statSync(details).size === 0) {
    mkdirSync(dirname(details), { recursive: true });
    mkdirSync(output, { recursive: true });
    const from = Date.now() / 1000;
    const flags = {
      "output-dir": output,
      "rubrics-file": rubrics,
      "details-file": details,
      "judge-model": JUDGE.model,
      "api-base": apiBase,
      "max-workers": "8",
      "max-retries": "3",
      "timeout-per-rubric": "240",
      "evaluated-model": place.label,
    };
    const code = await inGroup(
      [
        join(jb, ".venv", "bin", "python"),
        ...(cap === undefined ? [judgePy] : ["-c", WIDER, judgePy, String(cap)]),
        ...Object.entries(flags).flatMap(([k, v]) => [`--${k}`, v]),
      ],
      {
        cwd: jb,
        env: {
          ...envOf(SCRUB),
          JUDGE_API_KEY: runtimeProcess.env.JUDGE_API_KEY ?? "local-shim",
          JUDGE_REASONING_EFFORT: JUDGE.effort,
        },
        stdout: `${details}.log`,
        stderr: `${details}.stderr`,
        timeoutS: JUDGE.timeoutS,
      },
    );
    if (existsSync(`${details}.stderr`)) {
      appendFileSync(`${details}.log`, readFileSync(`${details}.stderr`));
      rmSync(`${details}.stderr`);
    }
    if (code !== 0) return `judge.py exited ${code}; see ${details}.log`;
    usd = shimLog === undefined ? null : shimDollars(shimLog, from, Date.now() / 1000);
  }
  const got = readJson(details);
  if (!isRecord(got)) return `${details} holds no judgement`;
  const why = unjudged(got);
  if (why === null) return { details: got, usd };
  renameSync(details, `${details}.judge_failed`);
  return why;
}

async function checkScoreInputs(
  jb: string,
  store: string,
  input: {
    readonly arm: Arm;
    readonly tasks: readonly string[];
    readonly pi: boolean;
    readonly claude: Claude;
  },
): Promise<string> {
  const { arm, tasks, pi, claude } = input;
  const python = join(jb, ".venv", "bin", "python");
  for (const need of [python, join(jb, "eval", "judge.py")]) {
    if (!existsSync(need)) {
      throw new Error(`${need} is missing: the judge runs as the pilot ran it or not at all`);
    }
  }
  for (const task of tasks) {
    const tree = arm.tree(task);
    const needs = [
      join(jb, "dataset", "main", task, "task_folder", "TASK_INSTRUCTIONS.txt"),
      join(jb, "dataset", "main", task, "RUBRICS.json"),
      tree === null ? join(store, task, OUTPUT, arm.label(task)) : join(tree, pi ? HARNESS_DIR : "CLAUDE.md"),
    ];
    const missing = needs.find((need) => !existsSync(need));
    if (missing !== undefined) throw new Error(`${task}: ${missing} is missing`);
  }
  for (const tree of pi ? new Set(tasks.flatMap((task) => arm.tree(task) ?? [])) : []) {
    const own = await ownPython(tree, claude.env);
    if (own !== null) console.log(`  tree ${basename(tree)}: ${own}`);
  }
  return python;
}

async function judgeTask(task: string, ctx: ScoreContext): Promise<void> {
  const { jb, store, judged, arm, pi, how, needles } = ctx;
  const label = arm.label(task);
  const output = join(store, task, OUTPUT, label);
  const got = await judge(jb, { store, task, label }, how);
  if (isString(got)) {
    console.log(`${task}: not judged (${got})`);
    runtimeProcess.exitCode = 1;
    return;
  }
  const traj = join(store, task, "model_traj", label);
  const traces = existsSync(traj)
    ? readdirSync(traj).map((name) => readFileSync(join(traj, name), "utf8").toLowerCase())
    : [];
  const log = rolloutLog(store, task, label);
  const record = {
    arm: arm.name,
    harness: arm.harness,
    task,
    label,
    delivered: readdirSync(output).length > 0,
    points: got.details.total_score ?? null,
    total: got.details.max_score ?? null,
    passed: got.details.passed_count ?? null,
    rubrics: got.details.total_count ?? null,
    solveUsd: log.usd,
    judgeUsd: got.usd,
    seconds: log.seconds,
    attempts: log.attempts,
    build: arm.build(task),
    peeked: needles.filter((needle) => traces.some((trace) => trace.includes(needle.toLowerCase()))),
    cut: cutOf(jb, output, how.cap),
    ...keyIfDefined("cap", how.cap),
    ...keysIf(pi, () => ({ runtime: "pi-durable" })),
  };
  mkdirSync(judged, { recursive: true });
  writeFileSync(join(judged, `${keyOf(task)}.json`), `${capturedJsonStringify(record, null, 2)}\n`);
  console.log(`${task}: ${text(record.points)}/${text(record.total)}, $${log.usd.toFixed(4)} solved`);
}

async function runScoreLoop(
  tasks: readonly string[],
  bench: ReturnType<typeof jobBench>,
  ctx: ScoreContext,
): Promise<void> {
  const { store, judged, arm } = ctx;
  for (const task of tasks.filter((one) => !existsSync(join(judged, `${keyOf(one)}.json`)))) {
    const [tree, label] = [arm.tree(task), arm.label(task)];
    if (tree !== null && !rolloutLog(store, task, label).ran) {
      try {
        await bench.execute(task, tree, `${arm.name}/${task}`);
      } catch (error) {
        console.log(`${task}: ${errorMessage(error)}`);
      }
    }
    if (tree !== null && !rolloutLog(store, task, label).ran) {
      console.log(`${task}: no rollout ended with a result, a non-result; scoring again rolls it again`);
      runtimeProcess.exitCode = 1;
      continue;
    }
    if (!ctx.solveOnly) await judgeTask(task, ctx);
  }
}

function validatedScoreFlags(values: Values) {
  if (values.out === undefined || values["api-base"] === undefined || values.jb === undefined) {
    throw new Error("score needs --arm, --name, --out, --jb and --api-base");
  }
  if (values.for !== undefined || values.python !== undefined) {
    throw new Error("--for and --python are the tree verb's; a rollout runs on this machine");
  }
  const cap = capOf(values.cap);
  if (cap !== undefined && !(values.arm ?? "").startsWith("again:")) {
    throw new Error("--cap judges only an again: arm, so no official record is made under another cut");
  }
  return { jb: resolve(values.jb), out: resolve(values.out), apiBase: values["api-base"], cap };
}

export async function score(values: Values): Promise<void> {
  const { jb, out, apiBase, cap } = validatedScoreFlags(values);
  const [store, claude, pi] = [join(out, "dataset"), pilotClaude(jb), (values.arm ?? "").startsWith(PI)];
  const bench = jobBench(jb, store, claude, pi ? piAgent(claude) : undefined);
  const arm = await armOf(values, out, bench.baseHarness);
  const tasks = tasksOf(values.tasks, values.arm === "heldout" ? fair(PILOT_TASKS) : PILOT_TASKS);
  const python = await checkScoreInputs(jb, store, { arm, tasks, pi, claude });
  const judged = join(out, "judged", arm.name);
  console.log(`arm ${arm.name}: ${arm.harness}, ${tasks.length} tasks into ${judged}`);
  console.log(
    `  solve: ${claude.model} at ${claude.effort}${pi ? " on pi-durable, inside the harness itself" : ""}, $${claude.budgetUsd} and ${claude.timeoutS} s an attempt, 2 attempts, one rollout at a time`,
  );
  if (pi) console.log(piDry(claude, arm.tree(tasks[0] ?? "") ?? ""));
  console.log(
    `  judge: ${JUDGE.model} at ${JUDGE.effort} through ${apiBase}, one at a time, each file cut at ${String(cap ?? MAX_CHARS_PER_FILE)} characters`,
  );
  for (const task of tasks) {
    console.log(`  ${task}: ${arm.label(task)} under ${arm.tree(task) ?? "the sweep's rollout"}`);
  }
  if (values["dry-run"] === true) return;
  if (values.yes !== true) {
    throw new Error(
      "scoring starts paid claude sessions and judgements; --yes is the operator's word for it",
    );
  }
  const installer = ownInstaller(python);
  if (installer !== null) console.log(`  installer: ${installer}`);
  const needles = [
    store,
    OUTPUT,
    "model_traj",
    "eval_result",
    "RUBRICS.json",
    join(jb, "dataset"),
    join(jb, "eval"),
    join(out, "judged"),
    "huggingface.co",
    "hf.co/",
    "google-research/harness2",
    "workbuddy",
  ];
  const how: Judging = { apiBase, shimLog: values["judge-log"], rubrics: values.rubrics, cap };
  const solveOnly = values["solve-only"] === true;
  await runScoreLoop(tasks, bench, { jb, store, judged, arm, pi, how, needles, solveOnly });
}

/** The judged records under `<out>/judged/` of the labels `shown`, or of every label. */
function recordsOf(out: string, shown: readonly string[] | undefined): JsonObject[] {
  const root = join(out, "judged");
  // A name with no folder throws on its path, as the sister readers refuse one.
  return (shown ?? (existsSync(root) ? readdirSync(root) : [])).flatMap((arm) =>
    readdirSync(join(root, arm)).flatMap((name) => {
      const record = readJson(join(root, arm, name));
      return isRecord(record) ? [record] : [];
    }),
  );
}

/** How many files a judged record says were cut from its deliverable, and 0 where it holds none. */
const cuts = (record: JsonObject | undefined): number => (Array.isArray(record?.cut) ? record.cut.length : 0);

/** The fair tasks of `tasks` on which no record of `records` had a file cut, or one nobody counted. */
const uncutOf = (tasks: readonly string[], records: readonly JsonObject[]): string[] =>
  // A cut nobody could count (`cut: null`) is not read as none, so its task leaves the block too.
  fair(tasks).filter(
    (task) => !records.some((record) => record.task === task && (record.cut === null || cuts(record) > 0)),
  );

/**
 * The rollouts `shown` names read as one arm, over the store's fair uncut tasks (`table`'s last
 * block) that every one of them scored: each rollout's points, their range, and each task's range,
 * the lowest mean share first. The outside row reads every difference against the Starter's spread
 * between rollouts, and asks that an arm's spread and worst task stand within what the Starter's
 * show (system-audit, "The pillars and the v1.0 bar"), rather than both being worked out by hand
 * from `table`.
 */
const indexRecords = (records: readonly JsonObject[]) =>
  new Map(records.toReversed().map((r) => [`${text(r.arm)}\0${text(r.task)}`, r] as const));

const sumPair = (
  items: readonly (readonly [number | null, number | null])[],
): readonly [number | null, number | null] => {
  const sumAt = (i: 0 | 1) =>
    items.reduce<number | null>((a, p) => (a === null || p[i] === null ? null : a + p[i]), 0);
  return [sumAt(0), sumAt(1)];
};

function spread(out: string, shown: readonly string[]): void {
  const store = recordsOf(out, undefined);
  const byKey = indexRecords(store);
  const rowOf = (label: string, task: string) => byKey.get(`${label}\0${task}`);
  const held = [...new Set(store.map((record) => text(record.task)))].toSorted();
  const tasks = uncutOf(held, store).filter((task) =>
    shown.every((label) => isNumber(rowOf(label, task)?.points)),
  );
  // A misspelt rollout scores nothing, so it empties the set instead of reading as a zero.
  if (tasks.length === 0) throw new Error(`no fair uncut task that each of ${shown.join(", ")} scored`);
  const pointsOf = (label: string, task: string) => Number(rowOf(label, task)?.points);
  const totalOf = (task: string) => Number(rowOf(shown[0] ?? "", task)?.total);
  const whole = tasks.reduce((all, task) => all + totalOf(task), 0);
  const sums = shown.map((label) => tasks.reduce((all, task) => all + pointsOf(label, task), 0));
  const [low, high] = [Math.min(...sums), Math.max(...sums)];
  console.log(
    `${String(shown.length)} rollouts over the ${String(tasks.length)} fair uncut tasks each scored`,
  );
  for (const [index, label] of shown.entries()) {
    console.log(`  ${label} ${String(sums[index])}/${String(whole)}`);
  }
  console.log(`  range ${String(low)} to ${String(high)} (${String(high - low)} points)`);
  const rows = tasks.map((task) => {
    const points = shown.map((label) => pointsOf(label, task));
    const mean = points.reduce((all, each) => all + each, 0) / points.length / totalOf(task);
    return { task, low: Math.min(...points), high: Math.max(...points), mean };
  });
  for (const row of rows.toSorted((a, b) => a.mean - b.mean)) {
    console.log(
      `${row.task}: ${String(row.low)} to ${String(row.high)} of ${String(totalOf(row.task))}, mean ${(100 * row.mean).toFixed(1)}%`,
    );
  }
}

/** The pilot's arms table (`final.py`) from the records under `<out>/judged/`. */
function table(out: string, named: string | undefined, shown: readonly string[] | undefined): void {
  const records = recordsOf(out, shown);
  const byKey = indexRecords(records);
  const arms = [...new Set(records.map((record) => text(record.arm)))].toSorted();
  // Unnamed, the tasks are those the records hold, not the pilot's eight, of which a sitting may
  // roll six, so that no arm reads "6 of 8" over a fair five no sitting chose.
  const tasks = tasksOf(named, [...new Set(records.map((record) => text(record.task)))].toSorted());
  const money = (value: number | null): string => (value === null ? "?" : value.toFixed(2));
  const width = Math.max(10, ...arms.map((arm) => arm.length));
  const [uncut, dataset] = [uncutOf(tasks, records), join(out, "dataset")];
  // The judge's criterion count is read once per (task, label) across the three table blocks.
  const detailTotals = new Map<string, readonly [number | null, number | null]>();
  const rowCriteria = (row: JsonObject): readonly [number | null, number | null] => {
    const [task, label] = [text(row.task), text(row.label)];
    const key = `${task}\0${label}`;
    const cached = detailTotals.get(key);
    if (cached !== undefined) return cached;
    const rubrics = field(readJson(detailsOf(dataset, task, label)), "rubrics");
    const totals = Array.isArray(rubrics)
      ? sumPair(
          rubrics.map((rubric) => {
            const r = field(rubric, "result");
            const [p, c] = [field(r, "criteria_passed"), field(r, "criteria_count")];
            return [isNumber(p) ? p : null, isNumber(c) ? c : null] as const;
          }),
        )
      : ([null, null] as const);
    detailTotals.set(key, totals);
    return totals;
  };
  const criteria = (rows: readonly JsonObject[]): string =>
    sumPair(rows.map(rowCriteria))
      .map((n) => (n === null ? "?" : String(n)))
      .join("/");
  for (const [title, set] of [
    ["all", tasks],
    ["fair", fair(tasks)],
    ["fair uncut", uncut],
  ] as const) {
    console.log(`${title} ${set.length}`);
    for (const arm of arms) {
      const held = set.flatMap((task) => {
        const row = byKey.get(`${arm}\0${task}`);
        return row === undefined ? [] : [row];
      });
      if (held.length < set.length) {
        console.log(`  ${arm.padEnd(width)} ${held.length} of ${set.length} tasks scored`);
        continue;
      }
      const sum = (key: string): number | null =>
        held.reduce<number | null>(
          (all, row) => (all === null || !isNumber(row[key]) ? null : all + row[key]),
          0,
        );
      const builds = new Map(
        held.map((row) => [text(field(row.build, "of") ?? row.task), field(row.build, "usd")] as const),
      );
      const build = [...builds.values()].reduce<number | null>(
        (all, usd) => (all === null || !isNumber(usd) ? null : all + usd),
        0,
      );
      const [points, total, solve] = [sum("points"), sum("total"), sum("solveUsd")];
      const [judgeUsd, seconds] = [sum("judgeUsd"), sum("seconds")];
      // A system costs its build and its solves; the judge prices the benchmark, not the system,
      // and most of a sitting's total can be judging.
      const system = build === null || solve === null ? null : build + solve;
      const share =
        points === null || total === null || total === 0 ? "?" : ((100 * points) / total).toFixed(1);
      console.log(
        `  ${arm.padEnd(width)} score ${String(points)}/${String(total)} (${share}%) criteria ${criteria(held)} system ${money(system)} (build ${money(build)}, solve ${money(solve)}) judge ${money(judgeUsd)} solve hours ${seconds === null ? "?" : (seconds / 3600).toFixed(2)}`,
      );
    }
  }
  for (const task of tasks) {
    const cells = arms.flatMap((arm) => {
      const row = byKey.get(`${arm}\0${task}`);
      const peeked = Array.isArray(row?.peeked) && row.peeked.length > 0 ? " PEEKED" : "";
      const cut = cuts(row) > 0 ? ` CUT ${String(cuts(row))}` : "";
      return row === undefined ? [] : [`${arm} ${text(row.points)}/${text(row.total)}${peeked}${cut}`];
    });
    if (cells.length > 0) console.log(`${task}: ${cells.join(", ")}`);
  }
}

async function main(args: readonly string[]): Promise<void> {
  const [verb, ...rest] = args;
  const { values } = parseArgs({ args: [...rest], options: OPTIONS, strict: true });
  const shown = values.name?.split(",").map((name) => name.trim());
  if (verb === "score") {
    await score(values);
  } else if (verb === "table" && values.out !== undefined) {
    table(resolve(values.out), values.tasks, shown);
  } else if (verb === "spread" && values.out !== undefined && shown !== undefined) {
    spread(resolve(values.out), shown);
  } else if (verb === "tree" && values.out !== undefined && values.for !== undefined) {
    if (values.python !== undefined && !/^3\.\d+$/u.test(values.python)) {
      throw new Error("--python takes a minor, as 3.12");
    }
    const place = { ...placeOf(values.for), ...keyIfDefined("python", values.python) };
    const arm = await armOf(values, resolve(values.out), "", place);
    console.log(`arm ${arm.name}: ${arm.harness}, for ${values.for}, under ${arm.tree("")}`);
  } else {
    throw new Error(
      "usage: score.ts score --arm <arm> --name <name> --out <dir> --jb <dir> --api-base <url> --yes | table --out <dir> [--tasks <list>] [--name <name,...>] | spread --out <dir> --name <rollout,...> | tree --arm <arm> --name <name> --out <dir> --for <linux-x64> [--python <3.12>]",
    );
  }
}

if (import.meta.main) await main(Bun.argv.slice(2));
