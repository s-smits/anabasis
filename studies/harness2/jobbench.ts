/**
 * Harness²'s k=1 path on JobBench with Claude Code as executor and improver, in TypeScript, so that
 * a sweep of ours can be set beside the pilot's Python one (`h2/`, ported from Harness² at 1cfe254
 * with the fork's Claude Code commits 4a4d271, fabf45e and 0c121fd; Apache-2.0, Google LLC). The
 * operator asked on 3 November 2026 to "propagate the Python harness into TypeScript anabasis
 * style, keep in the studies/harness2 folder for now".
 *
 *   bun studies/harness2/jobbench.ts sweep --tasks <profession/taskN,...> --out <dir>
 *     --sections <sections.json> --jb <job-bench-eval checkout> [--dry-run] --yes
 *
 * Each profession is one stream, run beside the others; within it the tasks run in order and each
 * reads the library its earlier tasks left (`h2/recursion.ts`). A sweep starts `claude -p` on the
 * login the environment carries, so it is paid and asks for `--yes`; `--dry-run` checks the inputs
 * and prints the plan with no model call. `--jb` (or `HARNESS2_JB_REPO`) names the job-bench-eval
 * checkout: its `dataset/main/<task>/task_folder` and the extractor in its `eval/judge.py`, run
 * under its `.venv` as the pilot ran it. `h2/base/CLAUDE.md` is Harness²'s
 * `third_party/jb_runner/claude_base_harness/CLAUDE.md` at 4a4d271, verbatim.
 *
 * Local changes: the rollout environment carries the runner's variables except
 * `HARNESS_RENDER_DIR`, since no runner script sits between; the extractor runs synchronously, so
 * a stage's evidence build holds the other streams' timers while judge.py reads a deliverable.
 *
 * Not ported: the OpenCode and Codex substrates, WorkBuddy and lab, report rendering, k > 1 with
 * its selector session, the judge (`judge.py` stays JobBench's own; `score.ts` runs it), the
 * completion marks that reuse a rollout, and the run-identity fields of the judge and Vertex.
 */
import {
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
import { capturedJsonParse } from "#src/meta/json-runtime.ts";
import { isNumber, isRecord, isString, type JsonObject, type JsonValue } from "#src/meta/json-shape.ts";
import { dirname, join, resolve, sep } from "#src/meta/path.ts";
import { capturedExecPath, parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { decodeOutput, runSync } from "#src/meta/subprocess.ts";
import { improve, renderEvents, rollout, type Claude } from "./h2/claude.ts";
import type { Evidence } from "./h2/context.ts";
import { Library } from "./h2/library.ts";
import { prompt, readSections } from "./h2/prompts.ts";
import { pyDumps, pyLen, pyLstrip, pySlice, splitLines, walkFiles } from "./h2/py.ts";
import { DeadRollout, NAMESPACE, runDomain, type Bench } from "./h2/recursion.ts";

/** The pilot's settings (`h2l1.sh`): one model for both seats, high effort, five dollars a rollout. */
const PILOT = { model: "claude-opus-5-5", effort: "high", budgetUsd: "5", timeoutS: 3600 };
const BASE_HARNESS = new URL("h2/base", import.meta.url).pathname;
export const MAX_CHARS_PER_FILE = 200_000;
/** judge.py's `SQLITE_EXTS`: a database's text is never cut. */
const SQLITE_EXTS = new Set(["db", "sqlite", "sqlite3"]);
const VISION = new Set(["png", "jpg", "jpeg", "gif", "webp"]);
const MAX_VISION = 8;
/** The four improver jobs a task runs, whose prompt sizes the plan prints. */
const JOBS = ["propose INV", "propose DOM", "aggregate", "experience"] as const;
/** `config.SCRUB_ENV`: what the extractor's child never sees. */
export const SCRUB = [
  "HARNESS2_JUDGE_API_KEY",
  "HARNESS2_BRIDGE_KEY",
  "HARNESS2_CODEX_API_KEY",
  "HARNESS2_WB_CLAUDE_KEY",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_BEDROCK_BASE_URL",
  "CLAUDE_CODE_USE_BEDROCK",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "SLACK_BOT_TOKEN",
  "SLACK_WEBHOOK_URL",
  "JIRA_API_TOKEN",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_BEARER_TOKEN_BEDROCK",
];
/** `_EXTRACT_DRIVER` of `harness2/benchmarks/jobbench.py`, verbatim. */
const EXTRACT_DRIVER = `import importlib.util, json, sys
from pathlib import Path

judge_py, run_dir = sys.argv[1], Path(sys.argv[2])
spec = importlib.util.spec_from_file_location("_jb_judge_extractor", judge_py)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
files = {}
for f in sorted(p for p in run_dir.rglob("*") if p.is_file()):
    rel = str(f.relative_to(run_dir))
    try:
        files[rel] = str(mod.convert_file_to_text(f))
    except Exception as exc:                       # per-file tool failure, recorded in place
        files[rel] = f"(extraction failed: {type(exc).__name__}: {exc})"
print(json.dumps({
    "files": files,
    "flat": str(mod.extract_all_file_contents(run_dir)),
    "images": [str(p) for p in mod.collect_image_paths(run_dir)],
}))
`;

interface Extract {
  readonly files: ReadonlyMap<string, string>;
  readonly flat: string;
  readonly images: readonly string[];
}

const OPTIONS = {
  tasks: { type: "string" },
  out: { type: "string" },
  sections: { type: "string" },
  jb: { type: "string" },
  "dry-run": { type: "boolean" },
  yes: { type: "boolean" },
} as const;

/**
 * The fork's `os.environ` less `drop`: this process's environment with what the fork's Python
 * adds before it starts anything, `config.py`'s Vertex region and PEP 538's UTF-8 locale where the
 * inherited one is C (both seen in `test/studies-harness2-parity.test.ts`, 3 November 2026).
 */
export function envOf(drop: readonly string[]): Record<string, string> {
  const own = runtimeProcess.env;
  const ctype = [own.LC_CTYPE, own.LANG].find((value) => (value ?? "") !== "") ?? "C";
  const coerced = (own.LC_ALL ?? "") === "" && ["C", "POSIX"].includes(ctype) ? { LC_CTYPE: "C.UTF-8" } : {};
  return Object.fromEntries(
    Object.entries({ GOOGLE_CLOUD_LOCATION: "global", ...own, ...coerced }).flatMap(([key, value]) =>
      value === undefined || drop.includes(key) ? [] : [[key, value]],
    ),
  );
}

/** `_raw_extract`: each file read as text, the fallback when judge.py cannot run. */
function rawExtract(dir: string): Extract {
  const files = new Map<string, string>();
  const parts: string[] = [];
  const images: string[] = [];
  for (const rel of walkFiles(dir)) {
    const path = join(dir, rel);
    const name = rel.split("/").at(-1) ?? rel;
    if (name.lastIndexOf(".") > 0 && VISION.has(name.slice(name.lastIndexOf(".") + 1).toLowerCase())) {
      images.push(path);
    }
    const text = readFileSync(path, "utf8");
    files.set(rel, text);
    const clipped =
      pyLen(text) <= MAX_CHARS_PER_FILE
        ? text
        : `${pySlice(text, 0, MAX_CHARS_PER_FILE)}\n... [Content truncated at ${MAX_CHARS_PER_FILE} characters]`;
    parts.push(`=== FILE: ${name} ===\n${clipped}\n`);
  }
  return { files, flat: parts.join("\n"), images: images.slice(0, MAX_VISION) };
}

/** judge.py's own reading of a deliverable, or null when it did not run or lacked its readers. */
function judgeExtract(jb: string, dir: string): Extract | null {
  const judge = join(jb, "eval", "judge.py");
  if (!existsSync(judge)) return null;
  const venv = join(jb, ".venv", "bin", "python");
  const python = existsSync(venv) ? venv : "python3";
  const ran = runSync([python, "-c", EXTRACT_DRIVER, judge, dir], {
    env: envOf(SCRUB),
    timeout: 900_000,
    maxBuffer: 1 << 30,
  });
  if (ran.exitCode !== 0) return null;
  let doc: JsonValue;
  try {
    doc = capturedJsonParse(decodeOutput(ran.stdout));
  } catch {
    return null;
  }
  if (!isRecord(doc) || !isRecord(doc.files)) return null;
  const files = new Map(
    Object.entries(doc.files).flatMap(([rel, text]) => (isString(text) ? [[rel, text]] : [])),
  );
  if ([...files.values()].some((text) => text.startsWith("[ERROR:") && text.includes("not available"))) {
    return null;
  }
  const images = Array.isArray(doc.images) ? doc.images.filter((path) => isString(path)) : [];
  return { files, flat: isString(doc.flat) ? doc.flat : "", images };
}

/**
 * The files of `dir` whose text judge.py's `extract_all_file_contents` cuts before the judge reads
 * it, each with its length in Python's characters. Its rule: `if ext not in SQLITE_EXTS and
 * len(content) > MAX_CHARS_PER_FILE`, where `ext` is the file's suffix lowered without its dot and
 * the content is `convert_file_to_text`'s; `limit` stands for `MAX_CHARS_PER_FILE` where a reading
 * judged again sets a wider cut. Null where the judge's own reader did not run, so that a cut
 * nobody could count is not read as none.
 */
export function cutOf(
  jb: string,
  dir: string,
  limit = MAX_CHARS_PER_FILE,
): { file: string; chars: number }[] | null {
  const read = judgeExtract(jb, dir);
  if (read === null) return null;
  return [...read.files].flatMap(([file, text]) => {
    const name = file.split("/").at(-1) ?? file;
    const dot = name.lastIndexOf(".");
    const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
    const chars = pyLen(text);
    return chars > limit && !SQLITE_EXTS.has(ext) ? [{ file, chars }] : [];
  });
}

/** The JobBench adapter (`JobBenchAdapter` on the `cc` substrate), over one run store. */
export function jobBench(
  jb: string,
  store: string,
  claude: Claude,
): Omit<Bench, "sections"> & { cache: Map<string, Extract> } {
  const dataset = (task: string): string => {
    if (!task.includes("/") || task.includes("..") || task.startsWith("/")) {
      throw new Error(`malformed JobBench task id '${task}' (expected '<profession>/task<N>')`);
    }
    return join(jb, "dataset", "main", task, "task_folder");
  };
  const cache = new Map<string, Extract>();
  const extract = (dir: string): Extract => {
    const key = resolve(dir);
    const hit = cache.get(key) ?? judgeExtract(jb, key) ?? rawExtract(key);
    cache.set(key, hit);
    return hit;
  };
  const isDir = (dir: string): boolean => statSync(dir, { throwIfNoEntry: false })?.isDirectory() === true;
  const evidence: Evidence = {
    taskPrompt: (task) => readFileSync(join(dataset(task), "TASK_INSTRUCTIONS.txt"), "utf8"),
    taskFiles: (task) => (isDir(dataset(task)) ? dataset(task) : null),
    trajectory: (runDir) => {
      const parts = runDir.split(sep);
      const at = parts.indexOf("model_output");
      if (at < 2) throw new Error(`${runDir} is not a JobBench model_output run directory`);
      const [task, label] = [parts.slice(at - 2, at).join("/"), parts.at(-1) ?? ""];
      const dir = join(store, task, "model_traj", label);
      const newest = (isDir(dir) ? readdirSync(dir).filter((name) => name.endsWith(".jsonl")) : [])
        .map((name) => join(dir, name))
        .toSorted((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
      return newest === undefined ? `(no trajectory for ${task} @ ${label})` : renderEvents(newest);
    },
    files: (runDir) => (isDir(runDir) ? extract(runDir).files : new Map()),
    images: (runDir) => (isDir(runDir) ? extract(runDir).images : []),
    text: (runDir) => (isDir(runDir) ? extract(runDir).flat : ""),
  };
  const seed = (task: string): void => {
    const dest = join(store, task, "task_folder");
    if (isDir(dest)) return;
    if (!isDir(dataset(task))) throw new Error(`dataset task inputs missing: ${dataset(task)}`);
    const tmp = join(store, task, `.task_folder.tmp.${runtimeProcess.pid}`);
    cpSync(dataset(task), tmp, { recursive: true });
    renameSync(tmp, dest);
  };
  return {
    evidence,
    baseHarness: BASE_HARNESS,
    cache,
    async execute(task, harnessDir, runId) {
      const label = runId.replaceAll("/", "__");
      const out = join(store, task, "model_output", label);
      const traj = join(store, task, "model_traj", label);
      rmSync(out, { recursive: true, force: true });
      rmSync(traj, { recursive: true, force: true });
      cache.delete(resolve(out));
      seed(task);
      const runner = {
        TASK_IDS: task,
        LABEL: label,
        TASKS_BASE_DIR: store,
        MODEL_ID: claude.model,
        EFFORT: claude.effort,
        MAX_BUDGET_USD: claude.budgetUsd,
      };
      const env = { ...claude.env, ...runner, TIMEOUT_PER_TASK: String(claude.timeoutS), MAX_RETRIES: "2" };
      const usd = await rollout({ store, task, label }, harnessDir ?? BASE_HARNESS, { ...claude, env });
      if (isDir(out) && readdirSync(out).length > 0) return { runDir: out, usd };
      // `_has_events`: at least one line of a trajectory reads as a JSON event.
      const traced =
        isDir(traj) &&
        readdirSync(traj).some(
          (name) =>
            name.endsWith(".jsonl") &&
            splitLines(readFileSync(join(traj, name), "utf8")).some((line) => pyLstrip(line).startsWith("{")),
        );
      throw new DeadRollout(
        `JobBench produced no output for ${task} @ ${label} (${traced ? "trajectory without deliverables" : "dead agent"}: proxy/auth/binary) -- left UNMARKED so the next attempt re-rolls instead of serving an empty rollout as evidence`,
        usd,
      );
    },
    improve: async (call) =>
      await improve(
        { ...call, tries: 2 },
        { ...claude, env: envOf([]) },
        join(dirname(store), "adapt", "_audit", NAMESPACE),
      ),
  };
}

/**
 * The `claude` every rollout starts with, the sweep's and `score.ts`'s alike: the pilot's settings
 * and this process's environment with `_run_runner`'s PATH, the judge's interpreter first and then
 * Bun's directory.
 */
export function pilotClaude(jb: string): Claude {
  return {
    bin: "claude",
    ...PILOT,
    env: {
      ...envOf([]),
      PATH: [join(jb, ".venv", "bin"), dirname(capturedExecPath), runtimeProcess.env.PATH ?? ""].join(":"),
    },
  };
}

/** The streams: each profession's tasks in the stream's order (`sorted`). */
function streamsOf(list: string): Map<string, string[]> {
  const streams = new Map<string, string[]>();
  for (const task of list
    .split(",")
    .map((each) => each.trim())
    .filter((each) => each !== "")
    .toSorted()) {
    const domain = task.split("/")[0] ?? "";
    streams.set(domain, [...(streams.get(domain) ?? []), task]);
  }
  return new Map([...streams].toSorted(([a], [b]) => (a < b ? -1 : 1)));
}

/** `_check_identity`: a second sweep into one directory must be the same experiment. */
function holdIdentity(dir: string, identity: JsonObject): void {
  const path = join(dir, "config.json");
  mkdirSync(dir, { recursive: true });
  if (!existsSync(path)) {
    writeFileSync(path, `${pyDumps(identity, { indent: 2 })}\n`);
    return;
  }
  if (readFileSync(path, "utf8") !== `${pyDumps(identity, { indent: 2 })}\n`) {
    throw new Error(`${path} belongs to different models or tasks; choose a new --out for a new experiment`);
  }
}

async function sweep(values: {
  tasks?: string;
  out?: string;
  sections?: string;
  jb?: string;
  "dry-run"?: boolean;
  yes?: boolean;
}): Promise<void> {
  const jb = values.jb ?? runtimeProcess.env.HARNESS2_JB_REPO ?? "";
  if (values.tasks === undefined || values.out === undefined || values.sections === undefined || jb === "") {
    throw new Error("sweep needs --tasks, --out, --sections and --jb (or HARNESS2_JB_REPO)");
  }
  const streams = streamsOf(values.tasks);
  const sections = readSections(values.sections);
  const out = resolve(values.out);
  for (const task of [...streams.values()].flat()) {
    if (!existsSync(join(jb, "dataset", "main", task, "task_folder", "TASK_INSTRUCTIONS.txt"))) {
      throw new Error(`${task}: no TASK_INSTRUCTIONS.txt under ${jb}/dataset/main`);
    }
  }
  const tasks = [...streams.values()].flat();
  console.log(
    `jb-cc k=1 on ${PILOT.model} (effort ${PILOT.effort}, $${PILOT.budgetUsd} a rollout): ${tasks.length} tasks in ${streams.size} streams`,
  );
  console.log(
    `  each task: 4 rollouts (base1, inv1, dom1, agg1) and 3 sessions (inv1, dom1, agg1), then experience.agg1`,
  );
  console.log(`  prompts: ${JOBS.map((job) => `${job} ${pyLen(prompt(job, sections))} chars`).join(", ")}`);
  console.log(`  writes: ${join(out, "adapt")}, ${join(out, "dataset")}, ${join(out, "library")}`);
  if (values["dry-run"] === true) return;
  if (values.yes !== true) {
    throw new Error(
      "a sweep starts paid claude sessions; --yes is the operator's word for it, --dry-run checks without one",
    );
  }
  const claude = pilotClaude(jb);
  const runsRoot = join(out, "adapt");
  holdIdentity(join(runsRoot, NAMESPACE), {
    executor: PILOT.model,
    improver: PILOT.model,
    effort: PILOT.effort,
    budget_usd: PILOT.budgetUsd,
    tasks,
    sections,
  });
  const bench = { ...jobBench(jb, join(out, "dataset"), claude), sections };
  const started = new Date().toISOString();
  const domains = await Promise.all(
    [...streams].map(
      async ([domain, list]) =>
        await runDomain(
          bench,
          domain,
          list,
          runsRoot,
          new Library(join(out, "library", "jb", "k1-cc", "agg"), domain),
        ),
    ),
  );
  const finished = new Date();
  const record = {
    benchmark: "jb",
    substrate: "cc",
    k: 1,
    modes: ["agg"],
    seed: null,
    tag: "",
    domain_order: [...streams.keys()],
    max_tasks: null,
    only_tasks: tasks,
    started_at: started,
    finished_at: finished.toISOString(),
    n_domains: streams.size,
    domains,
  };
  mkdirSync(join(runsRoot, "_sweeps"), { recursive: true });
  const stamp = finished.toISOString().replaceAll(/[-:]|\.\d+/gu, "");
  writeFileSync(
    join(runsRoot, "_sweeps", `${NAMESPACE}-${stamp}.json`),
    `${pyDumps(record, { indent: 2 })}\n`,
  );
  const failed = domains.reduce((sum, domain) => sum + (isNumber(domain.failed) ? domain.failed : 0), 0);
  if (failed > 0) runtimeProcess.exitCode = 1;
}

async function main(args: readonly string[]): Promise<void> {
  const [verb, ...rest] = args;
  if (verb !== "sweep") {
    throw new Error(
      "usage: jobbench.ts sweep --tasks <profession/taskN,...> --out <dir> --sections <file> --jb <dir> [--dry-run] --yes",
    );
  }
  const { values } = parseArgs({ args: [...rest], options: OPTIONS, strict: true });
  await sweep(values);
}

if (import.meta.main) await main(Bun.argv.slice(2));
