/**
 * Every arm of the JobBench pilot scored on one path: each task solved once under one frozen
 * harness by the k=1 sweep's own rollout (`jobBench(...).execute`, the port of `jb_claude_runner.py`)
 * and judged by JobBench's own `eval/judge.py` with the flags of the pilot's `judge-arm.sh` and the
 * adapter's `_run_judge`. The operator asked on 3 November 2026 to "mimick how the benchmark works
 * and copy over to our system but for our produced jobstat harness(ses) through Anabasis to fairly
 * compare", and allowed tuning to our primitives "but it should not be changing the core premise".
 *
 *   bun studies/harness2/score.ts score --arm <arm> --name <name> --out <dir> --jb <checkout>
 *     --api-base <url> [--harness <kept>] [--tasks <profession/taskN,...>] [--judge-log <shim.jsonl>]
 *     [--solve-only] [--rubrics <file>] [--cap <chars>] [--dry-run] --yes
 *   bun studies/harness2/score.ts table --out <dir> [--tasks <profession/taskN,...>]
 *
 * An arm is `base` (Harness²'s base harness, the pilot's Base), `starter` or a campaign's name
 * (its kept harness written out by `claude-export.ts`, `--harness` as `keptAs` takes it),
 * `tree:<dir>` (any Claude Code tree), `heldout` (task N under the sweep's final harness of task
 * N-1) or `sweep:base1` and `sweep:agg1` (the sweep's own rollouts in `--out`, judged and rolled
 * by nothing else). Scoring into the sweep's `--out` keeps every arm in one store, as the pilot's
 * `runs/jb/dataset` was. The tasks default to the pilot's eight, the fair five for `heldout`.
 * Rollouts run three at a time as `score.sh` ran them; judgements run one at a time, so a
 * judgement's dollars are the shim log's rows inside its window. One record a task lands in
 * `<out>/judged/<name>/`, and `table` prints the pilot's arms table from them: every arm over all
 * the tasks (the pilot's eight unless named) and over those that are not a profession's first.
 * A record also names the files judge.py's reader cut at 200,000 characters before the judge read
 * them (`cut`: each file with its length, or null where that reader did not run), since a score on
 * a cut file partly reads how long the file ran. `table` marks such a cell `CUT <n>` and prints a
 * third block, `fair uncut`, over the fair tasks on which no record of any arm in the store holds a
 * cut file; a record written before `cut` existed counts as holding none.
 * `compare.ts` runs a whole comparison through `score`: `--solve-only` leaves a block's judging for
 * afterwards, and `again:<side>` with `--rubrics` judges a deliverable it copied once more,
 * under a wider cut than judge.py's where `--cap` names one, recorded as `cap` with `cut` counted
 * against it; no other arm takes `--cap`.
 *
 * What is the same for every arm: the task and its prompt, Opus 5.5 at high with $5 and 3600 s an
 * attempt and a second attempt only when none is delivered, one harness frozen for the whole arm,
 * judge.py and the task's `RUBRICS.json` untouched (Opus 5.5 at medium, 8 workers, 3 retries,
 * 240 s a rubric), and the rollout's environment. Tuned to our primitives, each named: the
 * rollout is the TypeScript runner, so the environment carries no `HARNESS_RENDER_DIR`; every
 * tree is installed by `installTree` as the sweep installs one, where `score.sh` copied a tree's
 * `CLAUDE.md`, `.claude/` and `scripts/` raw, which adds only an empty `.claude/settings.json` for
 * an exported harness; the judge's environment is the adapter's scrubbed one without Vertex's
 * region; and a record is one JSON file a task. Kept the benchmark's way: Claude Code's own
 * `total_cost_usd` is the solve's dollars (the pilot's tables read it, not `src/kernel/meter.ts`),
 * the workspace has no wall (a trajectory that names a rubric or a judged result is flagged in its
 * record instead), and the judge's transport is the operator's shim, named by `--api-base`.
 *
 * One difference from the pilot is deliberate. Its Base and Harness² k=1 rollouts ran under the
 * sweep's PATH, the judge's interpreter first, with pandas, openpyxl and python-docx; its Anabasis
 * and held-out arms ran through `score.sh` under `uv run`, whose interpreter has none of them, and
 * their trajectories met "No module named" for one of those six packages (pandas, numpy, openpyxl,
 * docx, pdfplumber, mammoth) 88 and 54 times, where Base's met it 12 times and k=1's never.
 * Here every arm gets the sweep's PATH (`pilotClaude`).
 */
import { billedAll } from "#src/kernel/meter.ts";
import { read } from "#src/kernel/log.ts";
import {
  appendFileSync,
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
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { dirname, join, resolve } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { logAcross } from "#tools/runs/snapshots.ts";
import { exportForClaudeCode } from "../shared/claude-export.ts";
import { inGroup, REFUSED } from "./h2/claude.ts";
import { NAMESPACE } from "./h2/recursion.ts";
import { cutOf, envOf, jobBench, MAX_CHARS_PER_FILE, pilotClaude, SCRUB } from "./jobbench.ts";

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
const AT_ONCE = 3;
const STAGES = ["base1", "inv1", "dom1", "agg1"];

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
}

/** How one judgement runs: the transport, the shim's log, the rubrics and any wider cut. */
interface Judging {
  readonly apiBase: string;
  readonly shimLog: string | undefined;
  readonly rubrics: string | undefined;
  readonly cap: number | undefined;
}

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
/** A JSON value as text, as a record prints it. */
const text = (value: JsonValue | undefined): string =>
  isString(value) ? value : value === undefined ? "" : capturedJsonStringify(value);

/**
 * The runner's own log of one label, as the pilot's `costs.py` and `walls.py` read it: the dollars
 * of every attempt in every log, and the newest log's start to its last attempt. `ran` is false
 * where no attempt of the newest log reached a `result` of the arm's own, which is a dead agent or
 * a refused session (`REFUSED`), never a zero.
 */
function rolloutLog(store: string, task: string, label: string) {
  const dir = join(store, ".harness2-logs");
  const prefix = `hevo_${task.replace("/", "_")}_${label}_`;
  const logs = (existsSync(dir) ? readdirSync(dir) : [])
    .filter((name) => name.startsWith(prefix) && /^\d{8}_\d{6}\.log$/u.test(name.slice(prefix.length)))
    .toSorted();
  const attempts = logs.map((name) =>
    [
      ...readFileSync(join(dir, name), "utf8").matchAll(
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
    ran: last.some((attempt) => attempt.result !== "None" && attempt.result !== REFUSED),
    seconds,
  };
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

async function armOf(values: Values, out: string, baseHarness: string): Promise<Arm> {
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
  // `compare.ts rejudge` copies a rollout's deliverable under this name, so the judge reads it again.
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
  // An arm's name binds its tree, written once: another harness takes another name.
  const into = join(out, "trees", name);
  if (!existsSync(into)) {
    await exportForClaudeCode(
      into,
      arm === "starter" ? "starter" : { campaign: arm, ...keyIfDefined("harness", values.harness) },
    );
  }
  const digest = field(readJson(join(into, "export.json")), "harness");
  const build = { of: arm, usd: arm === "starter" ? 0 : billedAll(read(await logAcross(arm))) };
  return rolled(
    isString(digest) ? digest : into,
    () => into,
    () => build,
  );
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
  const output = join(place.store, place.task, "model_output", place.label);
  const details = join(place.store, place.task, "eval_result", `eval_${place.label}`, DETAILS);
  const judgePy = join(jb, "eval", "judge.py");
  let usd: number | null = null;
  if (!existsSync(details) || statSync(details).size === 0) {
    mkdirSync(dirname(details), { recursive: true });
    mkdirSync(output, { recursive: true });
    const from = Date.now() / 1000;
    const code = await inGroup(
      [
        join(jb, ".venv", "bin", "python"),
        ...(cap === undefined ? [judgePy] : ["-c", WIDER, judgePy, String(cap)]),
        "--output-dir",
        output,
        "--rubrics-file",
        rubrics,
        "--details-file",
        details,
        "--judge-model",
        JUDGE.model,
        "--api-base",
        apiBase,
        "--max-workers",
        "8",
        "--max-retries",
        "3",
        "--timeout-per-rubric",
        "240",
        "--evaluated-model",
        place.label,
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
} as const;

export async function score(values: Values): Promise<void> {
  if (values.out === undefined || values["api-base"] === undefined || values.jb === undefined) {
    throw new Error("score needs --arm, --name, --out, --jb and --api-base");
  }
  // An official record keeps judge.py's own cut, so a wider one reads only a deliverable judged again.
  const cap = capOf(values.cap);
  if (cap !== undefined && !(values.arm ?? "").startsWith("again:")) {
    throw new Error("--cap judges only an again: arm, so no official record is made under another cut");
  }
  const jb = resolve(values.jb);
  const out = resolve(values.out);
  const store = join(out, "dataset");
  const claude = pilotClaude(jb);
  const bench = jobBench(jb, store, claude);
  const arm = await armOf(values, out, bench.baseHarness);
  const tasks = tasksOf(values.tasks, values.arm === "heldout" ? fair(PILOT_TASKS) : PILOT_TASKS);
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
      tree === null ? join(store, task, "model_output", arm.label(task)) : join(tree, "CLAUDE.md"),
    ];
    const missing = needs.find((need) => !existsSync(need));
    if (missing !== undefined) throw new Error(`${task}: ${missing} is missing`);
  }
  const judged = join(out, "judged", arm.name);
  console.log(`arm ${arm.name}: ${arm.harness}, ${tasks.length} tasks into ${judged}`);
  console.log(
    `  solve: ${claude.model} at ${claude.effort}, $${claude.budgetUsd} and ${claude.timeoutS} s an attempt, 2 attempts, ${AT_ONCE} at once`,
  );
  console.log(
    `  judge: ${JUDGE.model} at ${JUDGE.effort} through ${values["api-base"]}, one at a time, each file cut at ${String(cap ?? MAX_CHARS_PER_FILE)} characters`,
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
  const needles = ["RUBRICS.json", "eval_result", join(out, "judged")];
  const scoreOne = async (task: string): Promise<void> => {
    const label = arm.label(task);
    const place = { store, task, label };
    const output = join(store, task, "model_output", label);
    const got = await judge(jb, place, {
      apiBase: values["api-base"] ?? "",
      shimLog: values["judge-log"],
      rubrics: values.rubrics,
      cap,
    });
    if (isString(got)) {
      console.log(`${task}: not judged (${got})`);
      runtimeProcess.exitCode = 1;
      return;
    }
    const traj = join(store, task, "model_traj", label);
    const traces = existsSync(traj)
      ? readdirSync(traj).map((name) => readFileSync(join(traj, name), "utf8"))
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
      peeked: needles.filter((needle) => traces.some((trace) => trace.includes(needle))),
      cut: cutOf(jb, output, cap),
      ...keyIfDefined("cap", cap),
    };
    mkdirSync(judged, { recursive: true });
    writeFileSync(join(judged, `${keyOf(task)}.json`), `${capturedJsonStringify(record, null, 2)}\n`);
    console.log(`${task}: ${text(record.points)}/${text(record.total)}, $${log.usd.toFixed(4)} solved`);
  };
  const queue = tasks.filter((task) => !existsSync(join(judged, `${keyOf(task)}.json`)));
  let judging = Promise.resolve();
  const worker = async (): Promise<void> => {
    for (let task = queue.shift(); task !== undefined; task = queue.shift()) {
      const tree = arm.tree(task);
      const label = arm.label(task);
      // The runner's SKIP: a rollout on record, delivered or not, is this arm's one solve.
      if (tree !== null && !rolloutLog(store, task, label).ran) {
        try {
          await bench.execute(task, tree, `${arm.name}/${task}`);
        } catch (error) {
          console.log(`${task}: ${errorMessage(error)}`);
        }
      }
      if (tree !== null && !rolloutLog(store, task, label).ran) {
        console.log(`${task}: no attempt reached a result, a non-result; scoring again rolls it again`);
        runtimeProcess.exitCode = 1;
        continue;
      }
      // `compare.ts run` solves a block's sides side by side and judges them in turn afterwards.
      if (values["solve-only"] === true) continue;
      const due = task;
      judging = judging.then(async () => await scoreOne(due));
    }
  };
  await Promise.all(Array.from({ length: AT_ONCE }, worker));
  await judging;
}

/** The pilot's arms table (`final.py`) from the records under `<out>/judged/`. */
function table(out: string, tasks: readonly string[]): void {
  const root = join(out, "judged");
  const records = (existsSync(root) ? readdirSync(root) : []).flatMap((arm) =>
    readdirSync(join(root, arm)).flatMap((name) => {
      const record = readJson(join(root, arm, name));
      return isRecord(record) ? [record] : [];
    }),
  );
  const arms = [...new Set(records.map((record) => text(record.arm)))].toSorted();
  const money = (value: number | null): string => (value === null ? "?" : value.toFixed(2));
  const width = Math.max(10, ...arms.map((arm) => arm.length));
  const cuts = (record: JsonObject | undefined): number =>
    Array.isArray(record?.cut) ? record.cut.length : 0;
  const uncut = fair(tasks).filter(
    (task) => !records.some((record) => record.task === task && cuts(record) > 0),
  );
  for (const [title, set] of [
    ["all", tasks],
    ["fair", fair(tasks)],
    ["fair uncut", uncut],
  ] as const) {
    console.log(`${title} ${set.length}`);
    for (const arm of arms) {
      const rows = set.map((task) => records.find((record) => record.arm === arm && record.task === task));
      const held = rows.filter((row) => row !== undefined);
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
      const build = [...builds.values()].every((usd) => isNumber(usd))
        ? [...builds.values()].reduce<number>((all, usd) => all + (isNumber(usd) ? usd : 0), 0)
        : null;
      const [points, total, solve, judgeUsd, seconds] = [
        sum("points"),
        sum("total"),
        sum("solveUsd"),
        sum("judgeUsd"),
        sum("seconds"),
      ];
      // A system costs its build and its solves; the judge prices the benchmark, not the system. On
      // 4 November the starter's "total $60.62" was $10.79 of solving and $49.83 of judging.
      const system = build === null || solve === null ? null : build + solve;
      const share =
        points === null || total === null || total === 0 ? "?" : ((100 * points) / total).toFixed(1);
      console.log(
        `  ${arm.padEnd(width)} score ${String(points)}/${String(total)} (${share}%) system ${money(system)} (build ${money(build)}, solve ${money(solve)}) judge ${money(judgeUsd)} solve hours ${seconds === null ? "?" : (seconds / 3600).toFixed(2)}`,
      );
    }
  }
  for (const task of tasks) {
    const cells = arms.flatMap((arm) => {
      const row = records.find((record) => record.arm === arm && record.task === task);
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
  if (verb === "score") {
    await score(values);
  } else if (verb === "table" && values.out !== undefined) {
    table(resolve(values.out), tasksOf(values.tasks, PILOT_TASKS));
  } else {
    throw new Error(
      "usage: score.ts score --arm <arm> --name <name> --out <dir> --jb <dir> --api-base <url> --yes | table --out <dir> [--tasks <list>]",
    );
  }
}

if (import.meta.main) await main(Bun.argv.slice(2));
