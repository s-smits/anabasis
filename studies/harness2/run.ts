/**
 * The study's one entry point (`README.md`, "Order of work"): WorkBuddy-Bench Code installed the way
 * Harness² installs it, an Anabasis arm bundled for the benchmark's container, a free check of that
 * path, a scored run of one arm, and the reading of two arms.
 *
 *   bun studies/harness2/run.ts setup [--dataset]
 *   bun studies/harness2/run.ts bundle --arm <name> --harness <a kept harness's folder | starter>
 *   bun studies/harness2/run.ts check --arm <name>
 *   bun --env-file=<file> studies/harness2/run.ts score --run <name> --arm <name> [--streams 3] --yes
 *   bun studies/harness2/run.ts read --run <name> --a <arm> [--b <arm>]
 *
 * Everything the benchmark brings stays in the ignored `studies/external/`: Harness² at its pin,
 * the WorkBuddy-Bench checkout Harness²'s own setup clones, patches and overlays inside it
 * (`clone`, `patch`, `overlays`, `harness2/install.py`), the arms' mounts and every job folder
 * (`harness2-work/`). Harness²'s `workbuddy_models` is the one step left out, since it writes Vertex
 * routes alone; the study writes its own route instead, to the solver the campaigns use. What the
 * study adds is `wb/` and `../shared/harbor/pi_agent.py` (`wb/README.md`). `setup` fetches the
 * dataset only with `--dataset`, which is the operator's word that WorkBuddy-Bench's licence is
 * accepted, and then writes the paper's split with Harness²'s `scripts/split_tasks.py`.
 *
 * `check` runs one test task with the solver's `--dry-run`, which calls no model. `score` runs every
 * test task `--streams` times and is paid, so it asks for `--yes`. Each scored run leaves a record
 * in the tracked `studies/runs/harness2/<run>/`: the terms it ran on, the job it ran, and each
 * trial's score and spend as `trials.py` and `trialsOf` read them. The trajectories stay with the
 * job folders until the licence decision says they may be published. `read` sets two arms of a run
 * beside each other (`readArms`), or one arm's streams split in two, the A/A (`halves`).
 */
import { standing } from "#tools/runs/registry.ts";
import { capturedJsonStringify, parseJsonAs } from "#src/meta/json-runtime.ts";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "#src/meta/filesystem.ts";
import { join, relative, resolve } from "#src/meta/path.ts";
import { capturedSpawn, parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { runSync, runTextSyncOrThrow } from "#src/meta/subprocess.ts";
import { LIMITS } from "#tools/d2/campaign.ts";
import { bundleArm, MOUNT_RECORD } from "../shared/bundle.ts";
import { halves, readArms, trialsOf } from "../shared/scores.ts";

const STUDY = import.meta.dir;
const REPO = resolve(STUDY, "..", "..");
const HARNESS2 = join(REPO, "studies", "external", "harness2");
const WB = join(HARNESS2, "dependencies", "workbuddy-bench");
const WORK = join(REPO, "studies", "external", "harness2-work");
const RECORDS = join(REPO, "studies", "runs", "harness2");
const PYTHON = join(HARNESS2, ".venv", "bin", "python");
const SPLIT = join(WORK, "split-wb-code.json");

/** Harness² as the protocol read it (`README.md`, "What Harness² is"). */
const PIN = "1cfe254e8d25b15f37048c3730134686abe60335";
const ORIGIN = "https://github.com/google-research/harness2";

/** The campaigns' solver, through the same provider, at Harness²'s effort for its executor. */
const SOLVER = "google/gemini-3.5-flash";
const EFFORT = "high";
/** The job's route to it (`configs/models/anabasis/solver.yaml`), and where the route sends it. */
const ROUTE = "anabasis/solver";
const URL_ENV = "ANABASIS_WB_OPENROUTER_URL";
const OPENROUTER = "https://openrouter.ai/api/v1/chat/completions";
/** The harness config `wb/configs/harnesses/anabasis-pi/` holds, and where its agent finds an arm. */
const HARNESS = "anabasis-pi/1";
const MOUNT = "/opt/anabasis";
/** Trials at once in one job, as Harness² runs its own (`WB_MAX_TRIALS`, `harness2/config.py`). */
const AT_ONCE = 2;

const OPTIONS = {
  dataset: { type: "boolean" },
  arm: { type: "string" },
  harness: { type: "string" },
  run: { type: "string" },
  streams: { type: "string", default: "3" },
  yes: { type: "boolean" },
  a: { type: "string" },
  b: { type: "string" },
} as const;

async function ran(cmd: readonly string[], cwd: string, env: Record<string, string> = {}): Promise<void> {
  console.log(`[${relative(REPO, cwd) || "."}] ${cmd.join(" ")}`);
  const child = capturedSpawn([...cmd], {
    cwd,
    env: { ...runtimeProcess.env, ...env },
    stdio: ["inherit", "inherit", "inherit"],
  });
  const code = await child.exited;
  if (code !== 0) throw new Error(`${cmd.join(" ")} exited with ${String(code)}`);
}

/** Harness² at its pin, WorkBuddy-Bench as Harness²'s setup leaves it, and the study's additions. */
async function setup(dataset: "fetch" | "leave"): Promise<void> {
  if (!existsSync(join(HARNESS2, ".git"))) {
    mkdirSync(HARNESS2, { recursive: true });
    await ran(["git", "init", "-q"], HARNESS2);
    await ran(["git", "remote", "add", "origin", ORIGIN], HARNESS2);
    await ran(["git", "fetch", "--depth", "1", "origin", PIN], HARNESS2);
    await ran(["git", "checkout", "-q", "--detach", "FETCH_HEAD"], HARNESS2);
  }
  if (standing(HARNESS2).commit !== PIN) throw new Error(`${HARNESS2} is not at ${PIN}; move it aside first`);
  if (!existsSync(PYTHON)) await ran(["uv", "venv", "--python", "3.12", ".venv"], HARNESS2);
  await ran(["uv", "pip", "install", "--python", PYTHON, "-e", "."], HARNESS2);
  const steps =
    "from harness2 import install\nfor step in (install.clone, install.patch, install.overlays): step('workbuddy-bench')";
  await ran([PYTHON, "-I", "-c", steps], HARNESS2);
  const adapter = join(STUDY, "wb", "anabasis-pi-adapter.diff");
  if (runSync(["git", "-C", WB, "apply", "--reverse", "--check", adapter]).exitCode !== 0) {
    await ran(["git", "apply", adapter], WB);
  }
  cpSync(join(STUDY, "wb", "configs"), join(WB, "configs"), { recursive: true });
  copyFileSync(
    join(STUDY, "..", "shared", "harbor", "pi_agent.py"),
    join(WB, "src", "workbuddy_bench", "agents", "pi_agent.py"),
  );
  // The proxy holds the key and names the model; pi sends the effort itself (`--effort`).
  const route = {
    model: {
      name: SOLVER,
      protocols: ["openai"],
      backend_url_env: URL_ENV,
      backend_key_env: "OPENROUTER_API_KEY",
    },
  };
  mkdirSync(join(WB, "configs", "models", "anabasis"), { recursive: true });
  writeFileSync(join(WB, "configs", "models", `${ROUTE}.yaml`), `${capturedJsonStringify(route, null, 2)}\n`);
  await ran(["uv", "sync", "--locked", "--python", "3.12"], WB);
  if (dataset === "leave") {
    console.log(
      "setup: the dataset is not fetched; --dataset is the operator's word that its licence is accepted",
    );
    return;
  }
  await ran(["bash", "scripts/dataset/fetch-dataset.sh", "code"], WB);
  await ran(
    [
      PYTHON,
      "-I",
      "scripts/split_tasks.py",
      "--bench",
      "wb",
      "--subset",
      "code",
      "--seed",
      "42",
      "--output",
      SPLIT,
    ],
    HARNESS2,
  );
}

/** What `trials.py` prints in Harness²'s venv. */
const harness2Read = (args: readonly string[]) =>
  runTextSyncOrThrow([PYTHON, "-I", join(STUDY, "trials.py"), ...args], { cwd: HARNESS2 });

const testTasks = (): string[] =>
  harness2Read(["tasks", SPLIT])
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => parseJsonAs<string>(line));

const armDir = (arm: string) => join(WORK, "arms", arm);

/** A job of `tasks` under arm `arm`, as Harness² writes its own (`_job_yaml`, `workbuddy.py`). */
function jobOf(
  arm: string,
  tasks: readonly string[],
  attempts: number,
  jobs: string,
  solving: "dry-run" | "solve",
): string {
  const params = {
    PI_MODEL: SOLVER,
    PI_EFFORT: EFFORT,
    PI_MODEL_TURNS: LIMITS.modelTurns,
    PI_WALL_MINUTES: LIMITS.wallSeconds / 60,
    PI_PROMPTS: LIMITS.turns,
    PI_DRY_RUN: solving === "dry-run",
  };
  return [
    `model: ${ROUTE}`,
    `harness: ${HARNESS}`,
    "dataset: datasets/wb-bench-code-v1.0/tasks",
    "harness_backend: local",
    "model_connection: local_proxy",
    `n_attempts: ${String(attempts)}`,
    `jobs_dir: ${jobs}`,
    "task_selection:",
    "  mode: name",
    "  names:",
    ...tasks.map((task) => `    - ${task}`),
    "orchestrator_override:",
    `  n_concurrent_trials: ${String(AT_ONCE)}`,
    "environment_override:",
    "  mounts:",
    "    - type: bind",
    `      source: ${armDir(arm)}`,
    `      target: ${MOUNT}`,
    "      read_only: true",
    "harness_params_override:",
    ...Object.entries(params).map(([key, value]) => `  ${key}: ${capturedJsonStringify(value)}`),
    "",
  ].join("\n");
}

/** Runs one job through the benchmark's own runner, and returns the job file it ran. */
async function job(slug: string, text: string): Promise<string> {
  const path = join(WB, "configs", "jobs", `${slug}.yaml`);
  writeFileSync(path, text);
  try {
    await ran(["uv", "run", "./scripts/run.sh", "--job", slug], WB, {
      NO_FORCE_BUILD: "1",
      [URL_ENV]: OPENROUTER,
    });
  } finally {
    rmSync(path, { force: true });
  }
  return text;
}

function needArm(arm: string | undefined): string {
  if (arm === undefined) throw new Error("name the arm with --arm");
  if (!existsSync(join(armDir(arm), MOUNT_RECORD))) throw new Error(`no arm ${arm}; bundle it first`);
  return arm;
}

async function score(run: string, arm: string, streams: number): Promise<void> {
  const jobs = join(WORK, "runs", run, arm);
  if (existsSync(jobs)) throw new Error(`${jobs} is there already; a run's arm is scored once`);
  const tasks = testTasks();
  const ranAt = standing(REPO);
  const text = await job(`_anabasis-${run}-${arm}`, jobOf(arm, tasks, streams, jobs, "solve"));
  const record = join(RECORDS, run, arm);
  mkdirSync(record, { recursive: true });
  const terms = {
    ...ranAt,
    harness2: PIN,
    workbuddy: standing(WB).commit,
    arm: readFileSync(join(armDir(arm), MOUNT_RECORD), "utf8"),
    solver: SOLVER,
    effort: EFFORT,
    limits: LIMITS,
    streams,
    tasks,
  };
  writeFileSync(join(record, "terms.json"), `${capturedJsonStringify(terms, null, 2)}\n`);
  writeFileSync(join(record, "job.yaml"), text);
  const trials = trialsOf(harness2Read(["trials", jobs, SPLIT]));
  writeFileSync(join(record, "trials.json"), `${capturedJsonStringify(trials, null, 2)}\n`);
  console.log(
    `score: ${String(trials.length)} trials of ${String(tasks.length)} tasks, record in ${relative(REPO, record)}`,
  );
}

function read(run: string, a: string, b: string | undefined): void {
  const trialsOfArm = (arm: string) =>
    trialsOf(harness2Read(["trials", join(WORK, "runs", run, arm), SPLIT]));
  const streams = (arm: string) =>
    parseJsonAs<{ readonly streams: number }>(readFileSync(join(RECORDS, run, arm, "terms.json"), "utf8"))
      .streams;
  const [first, second] = b === undefined ? halves(trialsOfArm(a)) : [trialsOfArm(a), trialsOfArm(b)];
  const reading = readArms(first, second, b === undefined ? Math.floor(streams(a) / 2) : streams(a));
  const name = b === undefined ? `${a}-aa` : `${a}-${b}`;
  writeFileSync(join(RECORDS, run, `${name}.json`), `${capturedJsonStringify(reading, null, 2)}\n`);
  console.log(capturedJsonStringify(reading, null, 2));
}

async function main(args: readonly string[]): Promise<void> {
  const [verb, ...rest] = args;
  const { values } = parseArgs({ args: [...rest], options: OPTIONS });
  if (verb === "setup") return await setup(values.dataset === true ? "fetch" : "leave");
  if (verb === "bundle") {
    if (values.arm === undefined || values.harness === undefined) {
      throw new Error("bundle needs --arm and --harness");
    }
    console.log(`bundle: ${values.arm} is harness ${await bundleArm(armDir(values.arm), values.harness)}`);
    return;
  }
  if (verb === "check") {
    const arm = needArm(values.arm);
    const [task] = testTasks();
    if (task === undefined) throw new Error("the split holds no test task; run setup --dataset first");
    await job(
      `_anabasis-check-${arm}`,
      jobOf(arm, [task], 1, join(WORK, "checks", `${arm}-${String(Date.now())}`), "dry-run"),
    );
    return;
  }
  if (verb === "score") {
    if (values.yes !== true) throw new Error("score is paid; --yes is the operator's word for this run");
    if (values.run === undefined) throw new Error("name the run with --run");
    return await score(values.run, needArm(values.arm), Number(values.streams));
  }
  if (verb === "read") {
    if (values.run === undefined || values.a === undefined) throw new Error("read needs --run and --a");
    return read(values.run, values.a, values.b);
  }
  throw new Error("usage: run.ts setup | bundle | check | score | read (see the head comment)");
}

if (import.meta.main) await main(Bun.argv.slice(2));
