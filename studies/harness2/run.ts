/**
 * The study's one entry point (`README.md`, "Order of work"): WorkBuddy-Bench Code installed the way
 * Harness² installs it, an Anabasis arm bundled for the benchmark's container, a free check of that
 * path, a scored run of one arm, and the reading of two arms.
 *
 *   bun studies/harness2/run.ts setup [--dataset]
 *   bun studies/harness2/run.ts bundle --arm <name> --from <starter | campaign> [--harness <kept>]
 *   bun studies/harness2/run.ts check --arm <name> [--placeholder]
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
 * `bundle` makes an arm from the starter or from a campaign by name, its reference at its ending
 * unless `--harness` names another kept one as `keptAs` takes it (`../shared/bundle.ts`). The arm
 * `opencode-base` needs no bundle: it is Harness²'s own base, OpenCode at the version and variant
 * Harness² runs it (`_job_yaml`, `workbuddy.py`), over the same route to the same solver.
 *
 * `check` runs one test task with the solver's `--dry-run`, which calls no model, and prints the
 * trial as `trialsOf` reads it. `--placeholder` runs it on the study's own synthetic task instead
 * (`placeholder/`), so the container, the mount, the agent and the verifier are proved before the
 * licence word: the task is put beside the benchmark's datasets under the Code subset's bench
 * settings, and its trial is found by name, since Harness²'s `_trials_in` resolves a trial
 * against the Code tasks and needs the dataset. `score` runs every
 * test task `--streams` times and is paid, so it asks for `--yes`. A trial that ends in a non-result
 * is run again, as a campaign solves one again (rule 7): after the job, each task short of its
 * streams is run again for what it lacks, into the same jobs folder as Harness²'s `run_batch`
 * resumes one, up to `RETRIES` rounds, and the tasks still short are left out of every reading and
 * named. Each scored run leaves a record
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
import type { JsonObject } from "#src/meta/json-shape.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { LIMITS } from "#tools/d2/campaign.ts";
import { bundleArm, MOUNT_RECORD } from "../shared/bundle.ts";
import { halves, readArms, shortfall, streamOf, trialsOf } from "../shared/scores.ts";

const STUDY = import.meta.dir;
const REPO = resolve(STUDY, "..", "..");
const HARNESS2 = join(REPO, "studies", "external", "harness2");
const WB = join(HARNESS2, "dependencies", "workbuddy-bench");
const WORK = join(REPO, "studies", "external", "harness2-work");
const RECORDS = join(REPO, "studies", "runs", "harness2");
const PYTHON = join(HARNESS2, ".venv", "bin", "python");
const SPLIT = join(WORK, "split-wb-code.json");
const CODE = "wb-bench-code-v1.0";
/** The study's synthetic task in a Code task's form (`placeholder/dataset.toml`), and its name. */
const PLACEHOLDER = "anabasis-placeholder-code";
const PLACEHOLDER_TASK = "placeholder-add";

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
/** Harness²'s base arm (`WB_OC_HARNESS_VER`, `harness2/config.py`), which takes no mount. */
const OPENCODE = "opencode-base";
const OPENCODE_HARNESS = "opencode/1.14.18";
/** Rounds of trials run again for the tasks a job left short. */
const RETRIES = 2;

const OPTIONS = {
  dataset: { type: "boolean" },
  placeholder: { type: "boolean" },
  arm: { type: "string" },
  from: { type: "string" },
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

/** A job of `tasks` of the dataset folder `dataset` under arm `arm`, as Harness² writes its own
 *  (`_job_yaml`, `workbuddy.py`). */
function jobOf(
  arm: string,
  { dataset, tasks }: { readonly dataset: string; readonly tasks: readonly string[] },
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
  const base = arm === OPENCODE;
  const mounted = [
    "environment_override:",
    "  mounts:",
    "    - type: bind",
    `      source: ${armDir(arm)}`,
    `      target: ${MOUNT}`,
    "      read_only: true",
  ];
  return [
    `model: ${ROUTE}`,
    `harness: ${base ? OPENCODE_HARNESS : HARNESS}`,
    `dataset: datasets/${dataset}/tasks`,
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
    ...(base ? [] : mounted),
    "harness_params_override:",
    ...Object.entries(base ? { OPENCODE_VARIANT: EFFORT } : params).map(
      ([key, value]) => `  ${key}: ${capturedJsonStringify(value)}`,
    ),
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
  if (arm !== OPENCODE && !existsSync(join(armDir(arm), MOUNT_RECORD))) {
    throw new Error(`no arm ${arm}; bundle it first`);
  }
  return arm;
}

async function score(run: string, arm: string, streams: number): Promise<void> {
  const jobs = join(WORK, "runs", run, arm);
  if (existsSync(jobs)) throw new Error(`${jobs} is there already; a run's arm is scored once`);
  const tasks = testTasks();
  const ranAt = standing(REPO);
  const slug = `_anabasis-${run}-${arm}`;
  const text = await job(slug, jobOf(arm, { dataset: CODE, tasks }, streams, jobs, "solve"));
  for (let round = 1; round <= RETRIES; round += 1) {
    const missing = shortfall(trialsOf(harness2Read(["trials", jobs, SPLIT])), tasks, streams);
    if (missing.size === 0) break;
    // One job a count of missing trials, since a job gives every task it names the same attempts.
    for (const count of new Set(missing.values())) {
      const short = [...missing].flatMap(([task, lacks]) => (lacks === count ? [task] : []));
      const again = jobOf(arm, { dataset: CODE, tasks: short }, count, jobs, "solve");
      await job(`${slug}-r${String(round)}-${String(count)}`, again);
    }
  }
  const record = join(RECORDS, run, arm);
  mkdirSync(record, { recursive: true });
  const terms = {
    ...ranAt,
    harness2: PIN,
    workbuddy: standing(WB).commit,
    arm:
      arm === OPENCODE
        ? { harness: OPENCODE_HARNESS, variant: EFFORT }
        : parseJsonAs<JsonObject>(readFileSync(join(armDir(arm), MOUNT_RECORD), "utf8")),
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
  const short = [...shortfall(trials, tasks, streams).keys()];
  console.log(
    `score: ${String(trials.length)} trials of ${String(tasks.length)} tasks, ${String(short.length)} still short of ${String(streams)} scored (${short.join(", ") || "none"}), record in ${relative(REPO, record)}`,
  );
}

/** One dry trial of arm `arm`, on the first test task or on the placeholder, printed as read. */
async function check(arm: string, on: "dataset" | "placeholder"): Promise<void> {
  const placeholder = on === "placeholder";
  if (placeholder) {
    cpSync(join(STUDY, "placeholder"), join(WB, "datasets", PLACEHOLDER), { recursive: true });
    const bench = join(WB, "configs", "bench");
    copyFileSync(join(bench, `${CODE}.yaml`), join(bench, `${PLACEHOLDER}.yaml`));
  }
  const task = placeholder ? PLACEHOLDER_TASK : testTasks()[0];
  if (task === undefined) throw new Error("the split holds no test task; run setup --dataset first");
  const jobs = join(WORK, "checks", `${arm}-${String(Date.now())}`);
  const dataset = placeholder ? PLACEHOLDER : CODE;
  await job(`_anabasis-check-${arm}`, jobOf(arm, { dataset, tasks: [task] }, 1, jobs, "dry-run"));
  const verb = placeholder ? ["named", jobs, task] : ["trials", jobs, SPLIT];
  // The dry result (`agent/pi-result.json`) holds the prompt, the programs found and the proxy's reply.
  console.log(
    `check: ${relative(REPO, jobs)} ${capturedJsonStringify(trialsOf(harness2Read(verb)), null, 2)}`,
  );
}

function read(run: string, a: string, b: string | undefined): void {
  const trialsOfArm = (arm: string) =>
    trialsOf(harness2Read(["trials", join(WORK, "runs", run, arm), SPLIT]));
  const streams = (arm: string) =>
    parseJsonAs<{ readonly streams: number }>(readFileSync(join(RECORDS, run, arm, "terms.json"), "utf8"))
      .streams;
  if (b !== undefined && streams(a) !== streams(b)) {
    throw new Error(
      `${a} ran ${String(streams(a))} streams and ${b} ${String(streams(b))}: the terms differ`,
    );
  }
  if (b === undefined && streams(a) % 2 !== 0) {
    throw new Error(
      `${a} ran ${String(streams(a))} streams: an A/A of one arm splits them in mirrored halves, so it needs an even count (2, 4 or 6), or score a second copy of the arm and read --a against --b`,
    );
  }
  const [first, second] = b === undefined ? halves(trialsOfArm(a)) : [trialsOfArm(a), trialsOfArm(b)];
  const count = b === undefined ? streams(a) / 2 : streams(a);
  const reading = readArms(first, second, count);
  // Each stream alone, for an arm whose harness moves between attempts (Harness²'s improver).
  const byStream =
    b === undefined
      ? []
      : Array.from({ length: count }, (_, at) => readArms(streamOf(first, at), streamOf(second, at), 1));
  const name = b === undefined ? `${a}-aa` : `${a}-${b}`;
  const written = { ...reading, byStream };
  writeFileSync(join(RECORDS, run, `${name}.json`), `${capturedJsonStringify(written, null, 2)}\n`);
  console.log(capturedJsonStringify(written, null, 2));
}

async function main(args: readonly string[]): Promise<void> {
  const [verb, ...rest] = args;
  const { values } = parseArgs({ args: [...rest], options: OPTIONS });
  if (verb === "setup") return await setup(values.dataset === true ? "fetch" : "leave");
  if (verb === "bundle") {
    if (values.arm === undefined || values.from === undefined) {
      throw new Error("bundle needs --arm and --from");
    }
    if (values.arm === OPENCODE) throw new Error(`${OPENCODE} is Harness²'s base and takes no bundle`);
    if (values.from === "starter" && values.harness !== undefined) {
      throw new Error("--harness names a campaign's kept harness; the starter is one harness");
    }
    const source =
      values.from === "starter"
        ? "starter"
        : { campaign: values.from, ...keyIfDefined("harness", values.harness) };
    const { digest, origin } = await bundleArm(armDir(values.arm), source);
    console.log(`bundle: ${values.arm} is harness ${digest}, ${capturedJsonStringify(origin)}`);
    return;
  }
  if (verb === "check") {
    const arm = needArm(values.arm);
    if (arm === OPENCODE) throw new Error(`${OPENCODE} has no dry run: every trial of it calls the model`);
    return await check(arm, values.placeholder === true ? "placeholder" : "dataset");
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
