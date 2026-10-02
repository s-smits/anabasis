#!/usr/bin/env bun
/**
 * One command from a launch request to running controllers. It resolves the source, captures each
 * selected credential once, forks one worktree per run, probes each through the launched tree's own
 * `probe.ts`, settles the source gate at most once, then starts each controller detached under the
 * user's service manager and waits for the opening that says it started what was planned.
 *
 * Every run leaves `.scratch/quick-run/launch.json`: `started` once its opening checks out,
 * `start-unconfirmed` when its launch did not, and `refused` with the stage when the batch stopped
 * before launching anything. `tools/runs` reads it, and the receipt never claims the run is still
 * alive: that is the controller's terminal to say.
 */
import { boundText } from "#src/meta/bounded-text.ts";
import {
  appendFileSync,
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  statfsSync,
  symlinkSync,
  writeFileSync,
} from "#src/meta/filesystem.ts";
import { dirname, isAbsolute, join, resolve } from "#src/meta/path.ts";
import { homedir, loadavg } from "#src/meta/os.ts";
import { parseEnv } from "#src/meta/env-parser.ts";
import {
  CONDITIONS,
  DEFAULT_DISK_MIN_GIB,
  HELP,
  LAUNCH_ARGUMENTS,
  MAX_LAUNCH_LOAD,
  MAX_LIVE_RUNS,
  PRESETS,
  SCRATCH,
  fullrunArgs,
  launchOptions,
  openingProblems,
  planRuns,
  probeArgs,
  record,
  requestIdentity,
  slotEnvironment,
  sourceIdentity,
  type Backend,
  type Gate,
  type LaunchOptions,
  type OpeningPlan,
  type RunPlan,
} from "./options.ts";
import { serviceManager, type ServiceManager } from "./service.ts";
import { STOP_RECEIPT_PATH } from "./stop.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { type ExitWith, exitWith, parseOrDie } from "#skills/main/cli.ts";
import { gitMaybe, gitText } from "#skills/main/git.ts";
import { openRecordedRun, type RecordedRun } from "#skills/main/run.ts";
import { isNumber, isString } from "#src/meta/json-shape.ts";
import type { JsonObject } from "#src/meta/json-shape.ts";
import { hasText } from "#src/meta/text.ts";
import { sha256 } from "#src/meta/digest.ts";
import { campaignRoot } from "#src/meta/campaign-root.ts";
import { CODEX_AUTH_FILE } from "#src/backends/login-state.ts";
import { OPENING_FILE } from "#src/run/controller-lineage.ts";
import { describeSourceRef, SOURCE_REF_ENV, type SourceRef, type StackEdge } from "#src/run/source-ref.ts";
import { runTextSyncOrThrow } from "#src/meta/subprocess.ts";
import { parseJsonAs } from "#src/meta/json-runtime.ts";
import { WORKTREE_SCRIPT } from "#tools/dependency-identity.ts";
import { LAUNCH_RECEIPT_PATH } from "#tools/runs/discover.ts";
import { collectRows } from "#tools/runs/rows.ts";

const REPO = resolve(import.meta.dirname, "../../../..");
const WORKTREE = join(REPO, WORKTREE_SCRIPT);
const SKILLS = resolve(import.meta.dirname, "../..");
/** The stop timer and what it imports from the skills tree, relative to `SKILLS`; the first runs. */
const STOP_TIMER_FILES = [
  "launch-run/scripts/stop.ts",
  "launch-run/scripts/service.ts",
  "main/cli.ts",
] as const;
/** One open pull request as `gh pr list --json` names it. */
export interface OpenPullRequest {
  number: number;
  headRefName: string;
  headRefOid: string;
  baseRefName: string;
}

type Environment = Record<string, string | undefined>;
interface CommandOptions {
  cwd?: string;
  env?: Environment;
  quiet?: boolean;
  log?: string;
  check?: boolean;
}
interface CommandResult {
  code: number;
  out: string;
  err: string;
}
export type Command = (argv: string[], options?: CommandOptions) => Promise<CommandResult>;
interface Credentials {
  kind: Backend;
  origin: string;
  bytes: string | Uint8Array;
  /** Twelve hex of a digest of what names the account, so two runs sharing one read as sharing it. */
  account: string;
}
interface Context {
  commit: string;
  /** Recorded in each run's receipt and handed to its controller for the opening. */
  sourceRef?: SourceRef;
  /** The commit of the checkout this launcher runs from, which owns the options and pins. */
  launcher: string;
  uid: number;
  sharedRoot: string;
  credentials: Partial<Record<Backend, Credentials>>;
  manager: ServiceManager;
  /** The pre-push hook's `ana-gate-passed`, which `bun run land` and a passing launch gate share. */
  passRecord: string;
  /** The one-minute load, and the controller runs `bun run runs` reads as live or why it could not. */
  host: { load: number; live: readonly string[] | string };
}
interface PreparedRun extends OpeningPlan {
  environment: Environment;
  sourceRef: SourceRef | null;
  argv: string[];
  credentialSource: string;
  credentialAccount: string;
}
/** How the batch settled its source gate, the same in every receipt of the batch. */
interface GateReceipt {
  policy: Gate;
  decision: "ran" | "recorded-pass" | "operator-skip";
  /** The gate's log when it ran, the pass record when a recorded pass stood in for it. */
  evidence: string | null;
  seconds: number | null;
  /** The one-minute load average as the gate started, since a loaded host is what fails it. */
  load: number | null;
}
interface Opened {
  project: string;
  opening: string;
  campaign: string;
}
type LaunchResult =
  | ({ runId: string; source: string; condition: RunPlan["condition"]; log: string } & Opened)
  | { runId: string; error: string; log: string };
export const spawnCommand: Command = async (
  argv,
  { cwd = REPO, env = process.env, quiet = false, log, check = true } = {},
) => {
  const fd = hasText(log) ? openSync(log, "w", 0o600) : null;
  try {
    const child = Bun.spawn(argv, {
      cwd,
      env,
      stdin: "ignore",
      stdout: fd ?? (quiet ? "pipe" : "inherit"),
      stderr: fd ?? (quiet ? "pipe" : "inherit"),
    });
    const read = (stream: typeof child.stdout) =>
      stream instanceof ReadableStream ? new Response(stream).text() : Promise.resolve("");
    const [code, out, err] = await Promise.all([child.exited, read(child.stdout), read(child.stderr)]);
    if (check && code !== 0) {
      throw new Error(
        `${argv[0]} exited ${code}${hasText(log) ? `; log: ${log}` : `: ${boundText(err, 3000, "tail").shown}`}`,
      );
    }
    return { code, out: out.trim(), err: err.trim() };
  } finally {
    if (fd !== null) closeSync(fd);
  }
};

/** The full commit `--source` names in the launcher's checkout, fetching a PR head or origin first. */
export function resolveSource(source: string, repo = REPO): string {
  let ref = source;
  if (source.startsWith("pr:")) {
    const number = source.slice(3);
    if (!/^[1-9]\d*$/.test(number)) throw new Error("--source pr:<number> requires a positive PR number");
    ref = `refs/remotes/origin/pr/${number}`;
    gitText(repo, "fetch", "origin", `pull/${number}/head:${ref}`);
  } else if (/^(origin\/|refs\/remotes\/origin\/)/.test(source)) {
    gitText(repo, "fetch", "origin", "--quiet");
  }
  return gitText(repo, "rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`);
}

/**
 * The open stack the commit came from: the pull request whose own range holds it — its base's head
 * does not — then each base down to `main`. A commit reached through a bare `--source <sha>` is
 * placed exactly as one reached through `pr:<n>`, which is why the lookup is by commit.
 */
export function stackOf(
  commit: string,
  mainHead: string,
  open: readonly OpenPullRequest[],
  contains: (commit: string, head: string) => boolean,
): Pick<SourceRef, "atHead" | "stack"> {
  const byBranch = new Map(open.map((pr) => [pr.headRefName, pr]));
  const baseHead = (pr: OpenPullRequest) =>
    byBranch.get(pr.baseRefName)?.headRefOid ?? (pr.baseRefName === "main" ? mainHead : null);
  const holds = (pr: OpenPullRequest) => {
    const base = baseHead(pr);
    return contains(commit, pr.headRefOid) && (base === null || !contains(commit, base));
  };
  const stack: StackEdge[] = [];
  for (let pr = open.find((row) => row.headRefOid === commit) ?? open.find(holds); pr !== undefined; ) {
    if (stack.some((edge) => edge.pr === pr?.number)) break;
    stack.push({ pr: pr.number, branch: pr.headRefName, head: pr.headRefOid, base: pr.baseRefName });
    pr = byBranch.get(pr.baseRefName);
  }
  return { atHead: stack[0]?.head === commit, stack };
}

/**
 * A run id's tail: the launch instant, then the pull request that carried the commit (`pr75`), or
 * `main` for main's own head, then the commit's first seven hex. The instant keeps every id unique;
 * `runs pulse` drops it, so two launches of one preset and model from one commit share a label.
 */
export function runSuffix(at: Date, commit: string | null, ref: SourceRef | null): string {
  const top = ref?.stack?.[0];
  const onMain = ref?.main === commit ? "main-" : "";
  const from = top === undefined ? onMain : `pr${top.pr}-`;
  return `${at.toISOString().replace(/[-:.]/g, "")}-${from}${commit?.slice(0, 7) ?? "unresolved"}`;
}

/** Where the launched commit came from, read once before the fork. It is annotation, so it never
 *  refuses a launch: an unreachable origin is recorded as a null `main` and stack, rather than a
 *  stale local `origin/main` read as current, and GitHub unreadable as a null stack alone, never as
 *  "no pull request". */
export function sourceRef(requested: string, commit: string, repo = REPO): SourceRef {
  let mainHead: string;
  try {
    gitText(repo, "fetch", "origin", "--quiet");
    mainHead = gitText(repo, "rev-parse", "--verify", "refs/remotes/origin/main^{commit}");
  } catch {
    return { requested, main: null, atHead: false, stack: null };
  }
  const contains = (ancestor: string, head: string) =>
    gitMaybe(repo, "merge-base", "--is-ancestor", ancestor, head) !== null;
  let open: OpenPullRequest[];
  try {
    const listed = runTextSyncOrThrow(
      [
        "gh",
        "pr",
        "list",
        "--state",
        "open",
        "--limit",
        "200",
        "--json",
        "number,headRefName,headRefOid,baseRefName",
      ],
      { cwd: repo },
    );
    open = parseJsonAs<OpenPullRequest[]>(listed);
  } catch {
    return { requested, main: mainHead, atHead: false, stack: null };
  }
  return { requested, main: mainHead, ...stackOf(commit, mainHead, open, contains) };
}

const fingerprint = (value: string): string => sha256(value).slice(0, 12);

/** The one credential a backend kind reads, captured once for the whole batch. */
export function readCredentials(
  kind: Backend,
  options: LaunchOptions,
  mainRepo: string,
  environment: Environment = process.env,
): Credentials {
  if (kind === "claude") {
    const path = options["env-file"] ?? join(mainRepo, ".env");
    // parseEnv answers with every key it read and no promise that a value is present, so the
    // token map carries the same optional shape the process environment has.
    let file: Environment;
    try {
      file = parseEnv(readFileSync(path, "utf8"));
    } catch {
      throw new Error(
        `cannot read Claude credentials from ${path}; supply --env-file with the intended file`,
      );
    }
    const token = file.CLAUDE_CODE_OAUTH_TOKEN ?? "";
    if (token === "" || /\s|["'`#$\\]/.test(token)) {
      throw new Error(
        `${path}: a single-line CLAUDE_CODE_OAUTH_TOKEN is required; no API-key or shell fallback`,
      );
    }
    // `claude setup-token` mints one token per account, so the token itself names the account.
    return { kind, origin: path, bytes: `CLAUDE_CODE_OAUTH_TOKEN=${token}\n`, account: fingerprint(token) };
  }
  const codexHome = options["codex-home"] ?? environment.CODEX_HOME ?? join(homedir(), ".codex");
  if (!isAbsolute(codexHome)) throw new Error("the selected CODEX_HOME must be absolute");
  const path = join(codexHome, CODEX_AUTH_FILE);
  let bytes: Uint8Array;
  let tokens: JsonObject;
  try {
    bytes = readFileSync(path);
    tokens = record(record(JSON.parse(new TextDecoder().decode(bytes))).tokens);
    if (!isString(tokens.access_token) || !tokens.access_token) throw new Error("missing token");
  } catch {
    throw new Error(`${path}: readable Codex subscription auth with an access token is required`);
  }
  // The access token rotates on refresh, so the account id names the account where it is recorded.
  const account = isString(tokens.account_id) ? tokens.account_id : tokens.access_token;
  return { kind, origin: path, bytes, account: fingerprint(account) };
}

/**
 * The run's frozen environment: private home roots under its scratch directory, a worker temp root
 * outside the checkout, the credential snapshot where its backend reads it, and the condition's
 * slot pins. Nothing from the launcher's own environment is carried except absolute PATH entries.
 */
export function prepareEnvironment(
  plan: RunPlan,
  credentials: Credentials,
  pathValue = process.env.PATH ?? "",
): Environment {
  if (existsSync(join(plan.dir, ".env"))) {
    throw new Error(`${plan.runId}: credential snapshot already exists`);
  }
  if (credentials.kind !== CONDITIONS[plan.condition].kind) {
    throw new Error(`${plan.runId}: credential kind does not match condition`);
  }
  const scratch = join(plan.dir, SCRATCH);
  // The Built wall closes the checkout; the generated worker must live outside it, on the
  // disk-backed temp root: a Linux /tmp is often a small tmpfs.
  const roots = {
    HOME: join(scratch, "home"),
    CODEX_HOME: join(scratch, "codex"),
    TMPDIR: mkdtempSync(
      join(process.platform === "darwin" ? "/private/var/tmp" : "/var/tmp", "ana-quick-run-"),
    ),
  };
  for (const path of Object.values(roots)) mkdirSync(path, { recursive: true, mode: 0o700 });
  const paths = [...new Set([dirname(process.execPath), ...pathValue.split(":").filter(isAbsolute)])];
  const target =
    credentials.kind === "claude" ? join(plan.dir, ".env") : join(roots.CODEX_HOME, CODEX_AUTH_FILE);
  writeFileSync(target, credentials.bytes, { flag: "wx", mode: 0o600 });
  if (credentials.kind === "codex") writeFileSync(join(plan.dir, ".env"), "", { flag: "wx", mode: 0o600 });
  return { ...roots, PATH: paths.join(":"), ...slotEnvironment(plan.condition) };
}

/** The launched tree's own probe: it imports that tree's modules, so it matches their layout by
 *  construction, where the launcher's modules may have moved since. */
async function probeTarget(
  plan: RunPlan,
  environment: Environment,
  options: LaunchOptions,
  command: Command,
) {
  const probe = join(plan.dir, ".claude/skills/launch-run/scripts/probe.ts");
  const result = await command(
    [WORKTREE, "run", plan.dir, "bun", "--no-env-file", probe, ...probeArgs(plan, options)],
    { cwd: plan.dir, env: environment, quiet: true },
  );
  const row = record(JSON.parse(result.out));
  const source = sourceIdentity(row.source);
  const worker = record(row.worker);
  const { model, efforts } = CONDITIONS[plan.condition];
  if (
    worker.model !== model ||
    worker.reasoningEffort !== efforts[1] ||
    !isNumber(worker.confinedPid) ||
    worker.confinedPid <= 0
  ) {
    throw new Error(`${plan.runId}: worker probe did not confirm the requested condition under confinement`);
  }
  const allowance = record(row.allowance);
  if (allowance.ok !== true) {
    const reason = isString(allowance.message) ? allowance.message : "no reason recorded";
    throw new Error(`${plan.runId}: the provider refused the Builder slot's allowance probe: ${reason}`);
  }
  return { source, ...requestIdentity(row), worker, allowance };
}

async function prepare(
  plan: RunPlan,
  options: LaunchOptions,
  context: Context,
  command: Command,
): Promise<PreparedRun> {
  console.log(`${plan.runId}: preparing ${context.commit.slice(0, 9)} in ${plan.dir}`);
  await command([WORKTREE, "new", plan.branch, plan.dir, context.commit]);
  chmodSync(plan.dir, 0o700);
  for (const name of ["campaigns", "domains"]) {
    const shared = join(context.sharedRoot, name);
    mkdirSync(shared, { recursive: true });
    symlinkSync(shared, join(plan.dir, name), "dir");
  }
  const credentials = context.credentials[CONDITIONS[plan.condition].kind];
  if (!credentials) throw new Error(`${plan.runId}: missing selected credential snapshot`);
  const environment = prepareEnvironment(plan, credentials);
  if (context.sourceRef !== undefined) environment[SOURCE_REF_ENV] = JSON.stringify(context.sourceRef);
  console.log(
    `${plan.runId}: checking source, request, confined worker and the provider allowance with one minimal turn`,
  );
  const { worker, ...identity } = await probeTarget(plan, environment, options, command);
  if (identity.source.commit !== context.commit || identity.source.dirty) {
    throw new Error(`${plan.runId}: target did not return the requested clean source`);
  }
  writeFileSync(join(plan.dir, SCRATCH, "probe.json"), JSON.stringify({ ...identity, worker }, null, 2), {
    mode: 0o600,
  });
  return {
    ...plan,
    environment,
    sourceRef: context.sourceRef ?? null,
    ...identity,
    argv: fullrunArgs(plan, options, identity.source),
    budget: options.budget,
    credentialSource: credentials.origin,
    credentialAccount: credentials.account,
    service: context.manager.service(context.uid, plan.label),
  };
}

export function findOpening(plan: RunPlan, root = campaignRoot(plan.dir)): string | null {
  if (!existsSync(root)) return null;
  const matches = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name, "controller", plan.runId, OPENING_FILE))
    .filter(existsSync);
  if (matches.length > 1) throw new Error(`${plan.runId}: multiple openings found; identity is ambiguous`);
  return matches[0] ?? null;
}

/** Whether the service manager still reports this plan's launcher as running. The query runs with
 *  `check: false`, so a service the manager no longer knows about reads as not running rather than
 *  throwing, and the caller raises the error that names the launcher log. */
async function launcherRunning(
  plan: OpeningPlan,
  command: Command,
  manager: ServiceManager,
): Promise<boolean> {
  const service = await command(manager.query(plan.service), { quiet: true, check: false });
  return service.code === 0 && manager.running(service.out);
}

/**
 * The project of an opening that records exactly this launch and has not closed. The opening and
 * any terminal are read through `openRecordedRun`, so a terminal counts only as the controller's
 * strict reader states it; one that reader refuses still closes the startup, and says why.
 */
function openedProject(plan: OpeningPlan, path: string): string {
  let run: RecordedRun;
  try {
    run = openRecordedRun(resolve(dirname(path), "../.."), plan.runId);
  } catch (error) {
    throw new Error(`${plan.runId}: opening mismatch: ${errorMessage(error)}; inspect ${path}`, {
      cause: error,
    });
  }
  const problems = openingProblems(run.opening, plan);
  if (problems.length > 0) {
    throw new Error(`${plan.runId}: opening mismatch: ${problems.join(", ")}; inspect ${path}`);
  }
  const { controller, controllerError } = run;
  if (controller?.state === "recorded") {
    throw new Error(`${plan.runId}: startup closed: ${controller.terminalReason}; ${run.controllerDir}`);
  }
  if (controller === null) {
    throw new Error(
      `${plan.runId}: startup not confirmed; the controller's reader refuses this run's evidence: ${controllerError}`,
    );
  }
  const project = record(run.opening.project).id;
  if (!isString(project)) {
    throw new Error(`${plan.runId}: the opening carries no project id; inspect ${path}`);
  }
  return project;
}

export async function checkOpening(
  plan: OpeningPlan,
  command: Command,
  {
    attempts = 90,
    sleep = Bun.sleep,
    manager = serviceManager(),
  }: { attempts?: number; sleep?: (ms: number) => Promise<void>; manager?: ServiceManager } = {},
): Promise<Opened> {
  for (let i = 0; i < attempts; i += 1) {
    const path = findOpening(plan);
    if (hasText(path)) {
      await sleep(1000); // An opening can precede an immediate worker exit.
      const project = openedProject(plan, path);
      if (!(await launcherRunning(plan, command, manager))) {
        throw new Error(
          `${plan.runId}: opening exists but launcher is no longer running; inspect ${plan.log}`,
        );
      }
      return { project, opening: path, campaign: resolve(dirname(path), "../..") };
    }
    if (!(await launcherRunning(plan, command, manager))) {
      throw new Error(`${plan.runId}: launcher stopped without an opening; inspect ${plan.log}`);
    }
    if (i === 29 || i === 59) {
      console.log(`${plan.runId}: waiting for the controller opening; log: ${plan.log}`);
    }
    await sleep(1000);
  }
  throw new Error(
    `${plan.runId}: opening not confirmed within 90 seconds; start is uncertain. Inspect ${plan.log} before any relaunch`,
  );
}

function reportPath(plan: RunPlan): string {
  return join(plan.dir, LAUNCH_RECEIPT_PATH);
}
/** The run's receipt, holding everything planned and prepared except its environment. */
function writeReport(plan: RunPlan, status: string, extra: JsonObject = {}): void {
  const publicPlan = Object.fromEntries(Object.entries(plan).filter(([key]) => key !== "environment"));
  mkdirSync(dirname(reportPath(plan)), { recursive: true });
  writeFileSync(reportPath(plan), JSON.stringify({ ...publicPlan, status, ...extra }, null, 2) + "\n", {
    mode: 0o600,
  });
}

/** The stop timer outlives this launcher's worktree, which is disposable, so it runs a copy of this
 *  skill's stop script staged in the run worktree. The copy keeps the launcher's bytes: a launch
 *  procedure comes from main, never from the revision being measured. The copy keeps the skills
 *  tree's layout, so the stop script's relative import of `main/cli.ts` finds the launcher's parser. */
function stageStopTimer(runDir: string): string {
  const staged = join(runDir, SCRATCH, "stop-timer");
  for (const file of STOP_TIMER_FILES) {
    mkdirSync(dirname(join(staged, file)), { recursive: true });
    copyFileSync(join(SKILLS, file), join(staged, file));
  }
  return join(staged, STOP_TIMER_FILES[0]);
}

/** `argv` started detached by the service manager in the run tree, under its frozen environment. */
function serviceArgv(plan: PreparedRun, manager: ServiceManager, label: string, log: string, argv: string[]) {
  const environment = Object.entries(plan.environment).flatMap(([key, value]) =>
    value === undefined ? [] : ["--env", `${key}=${value}`],
  );
  return [
    join(plan.dir, manager.launcher),
    "--worktree",
    plan.dir,
    "--log",
    log,
    "--label",
    label,
    ...environment,
    "--",
    ...argv,
  ];
}

async function armStopTimer(plan: PreparedRun, killAfterMs: string, context: Context, command: Command) {
  const deadline = Date.now() + Number(killAfterMs);
  const timer = [process.execPath, "--no-env-file", stageStopTimer(plan.dir), "--worktree", plan.dir];
  timer.push(
    "--run",
    plan.runId,
    "--service",
    plan.service,
    "--deadline",
    String(deadline),
    "--grace",
    "30000",
  );
  const log = join(plan.dir, SCRATCH, "stop.log");
  await command(serviceArgv(plan, context.manager, `${plan.label}.stop`, log, timer));
  const ready = join(plan.dir, `${STOP_RECEIPT_PATH}.ready`);
  for (let attempt = 0; attempt < 50 && !existsSync(ready); attempt++) await Bun.sleep(100);
  if (!existsSync(ready)) {
    throw new Error(`${plan.runId}: stop timer did not confirm readiness; controller not launched`);
  }
  if (Date.now() >= deadline || existsSync(join(plan.dir, STOP_RECEIPT_PATH))) {
    throw new Error(`${plan.runId}: stop deadline elapsed before controller launch`);
  }
}

/** Whether the pass record holds `<commit> --at`: the whole gate passed on a checkout holding
 *  nothing but that commit's bytes, which is exactly what a launch gate would prove again. */
function recordedPass(passRecord: string, commit: string): boolean {
  return existsSync(passRecord) && readFileSync(passRecord, "utf8").split("\n").includes(`${commit} --at`);
}

/**
 * The source gate, run at most once per batch and, through the shared pass record, once per commit.
 * A pass on the first run's clean tree is recorded as the hook records its own, so the next launch
 * or push of the same commit does not pay for it again.
 */
async function settleGate(
  first: PreparedRun,
  policy: Gate,
  context: Context,
  command: Command,
): Promise<GateReceipt> {
  const short = context.commit.slice(0, 9);
  if (policy === "skip") {
    console.log(`${short}: launching without bun run gate, as --gate skip asked`);
    return { policy, decision: "operator-skip", evidence: null, seconds: null, load: null };
  }
  if (policy === "auto" && recordedPass(context.passRecord, context.commit)) {
    console.log(`${short} already passed the whole gate on its own bytes; ${context.passRecord}`);
    return { policy, decision: "recorded-pass", evidence: context.passRecord, seconds: null, load: null };
  }
  const log = join(first.dir, SCRATCH, "gate.log");
  const load = oneMinuteLoad();
  console.log(`Checking the source gate once for ${short} at load ${load}; ${log}`);
  if (policy === "auto") {
    console.log("No recorded pass for this commit; --gate skip launches without the gate.");
  }
  // The run tree's campaigns and domains link into the shared root, and the observatory build inside
  // the gate reads its evidence snapshot there. No ANA_TESTED_COMMIT: a wrapper checking the named
  // commit refuses those links as a changed tree, and the probe already proved the clean source.
  const env: Environment = { ...process.env, ANA_UI_REPO_ROOT: context.sharedRoot };
  delete env.ANA_TESTED_COMMIT;
  const started = performance.now();
  await command([WORKTREE, "run", first.dir, "bun", "run", "gate"], { log, env });
  const seconds = Math.round((performance.now() - started) / 1000);
  // The hook's own condition: the tree still holds nothing but the commit's bytes after the gate.
  if (gitMaybe(first.dir, "status", "--porcelain") === "") {
    appendFileSync(context.passRecord, `${context.commit} --at\n`);
  }
  return { policy, decision: "ran", evidence: log, seconds, load };
}

const oneMinuteLoad = (): number => Math.round((loadavg()[0] ?? 0) * 10) / 10;

/** The host now, its live runs read by the `bun run runs` listing's own reader; a reader that
 *  fails is reported by its error, never as no live runs. */
function readHostPace(repo: string): Context["host"] {
  const load = oneMinuteLoad();
  try {
    const rows = collectRows(repo, { closedLimit: 0 });
    return { load, live: rows.flatMap((row) => (row.liveness.state === "live" ? [row.runId] : [])) };
  } catch (error) {
    return { load, live: errorMessage(error) };
  }
}

/** The operator's pace, settled before any tree is prepared or any provider is asked: a batch past
 *  either limit is refused unless `--over-capacity` gives a reason. Live runs the reader could not
 *  read are said, and the load alone decides. Every receipt keeps the reading and the reason. */
function settlePace({ load, live }: Context["host"], starting: number, reason: string | undefined) {
  const runs = isString(live)
    ? `live runs unread (${live}), so the load alone decides`
    : `${live.length + starting} runs live with this batch (limit ${MAX_LIVE_RUNS}), live now: ${live.join(", ") || "none"}`;
  const reading = `one-minute load ${load} (limit ${MAX_LAUNCH_LOAD}); ${runs}`;
  const over = load > MAX_LAUNCH_LOAD || (!isString(live) && live.length + starting > MAX_LIVE_RUNS);
  if (over && reason === undefined) {
    throw new Error(
      `refused before preparing any tree: ${reading}\nEach run added slows every run already there. Wait for the load to fall or a run to close, or pass --over-capacity "<reason>" to launch anyway.`,
    );
  }
  console.log(`${over ? `Launching over capacity (${reason})` : "Pace"}: ${reading}`);
  return { load, live, overCapacity: reason ?? null };
}

/** Prepares and probes every run and settles the gate; a failure leaves a `refused` receipt in each
 *  tree it created, naming the stage, before it is rethrown. */
async function prepareBatch(plans: RunPlan[], options: LaunchOptions, context: Context, command: Command) {
  const prepared: PreparedRun[] = [];
  let stage = "prepare";
  try {
    for (const plan of plans) prepared.push(await prepare(plan, options, context, command));
    const first = prepared[0];
    if (!first) throw new Error("no runs requested");
    stage = "gate";
    return { prepared, gate: await settleGate(first, options.gate, context, command) };
  } catch (error) {
    for (const plan of plans) {
      const row = prepared.find((item) => item.runId === plan.runId) ?? plan;
      if (existsSync(plan.dir)) writeReport(row, "refused", { stage, error: errorMessage(error) });
    }
    throw error;
  }
}

export async function launchBatch(
  plans: RunPlan[],
  options: LaunchOptions,
  context: Context,
  command: Command = spawnCommand,
): Promise<LaunchResult[]> {
  const pace = settlePace(context.host, plans.length, options["over-capacity"]);
  const { prepared, gate } = await prepareBatch(plans, options, context, command);
  const extra = { gate: { ...gate }, pace, launcher: context.launcher };
  const results: LaunchResult[] = [];
  for (const plan of prepared) {
    console.log(
      `${plan.runId}: launching; log: ${plan.log}\nStop: ${context.manager.terminate(plan.service).join(" ")}`,
    );
    try {
      writeReport(plan, "starting", extra);
      const killAfter = options["kill-after-ms"];
      if (killAfter !== undefined) await armStopTimer(plan, killAfter, context, command);
      const fullrun = ["bun", "run", "fullrun", "--", ...plan.argv];
      await command(serviceArgv(plan, context.manager, plan.label, plan.log, fullrun));
      const opened = await checkOpening(plan, command, { manager: context.manager });
      writeReport(plan, "started", { ...extra, ...opened });
      results.push({
        runId: plan.runId,
        source: plan.source.commit,
        condition: plan.condition,
        ...opened,
        log: plan.log,
      });
      console.log(`${plan.runId}: opening verified and process running; project ${opened.project}`);
    } catch (error) {
      writeReport(plan, "start-unconfirmed", { ...extra, error: errorMessage(error) });
      console.error(
        `${plan.runId}: ${errorMessage(error)}\nReceipt: ${reportPath(plan)}\nNo retry or signal was sent.`,
      );
      results.push({ runId: plan.runId, error: errorMessage(error), log: plan.log });
      break;
    }
  }
  return results;
}

/** What `--dry-run` says the gate will do, read from the same record the launch reads. */
function plannedGate(policy: Gate, passRecord: string, commit: string | null): string {
  if (policy === "skip") return "skipped by --gate skip";
  if (policy === "run") return "bun run gate once before launch";
  if (commit === null) return "skipped when the hook recorded a whole-gate pass, run once otherwise";
  return recordedPass(passRecord, commit)
    ? `skipped: ${commit.slice(0, 9)} passed the whole gate (${passRecord})`
    : `bun run gate once before launch: no recorded pass for ${commit.slice(0, 9)}`;
}

const die: ExitWith = exitWith("launch-run");

export async function main(argv: readonly string[]): Promise<number> {
  const options = launchOptions(parseOrDie(die, LAUNCH_ARGUMENTS, argv), die);
  if (options.help) {
    console.log(HELP);
    return 0;
  }
  if (options.list) {
    console.log(JSON.stringify(PRESETS, null, 2));
    return 0;
  }
  const commonDir = gitText(REPO, "rev-parse", "--path-format=absolute", "--git-common-dir"),
    mainRepo = dirname(commonDir),
    parent = options["output-dir"] ?? dirname(mainRepo),
    passRecord = join(commonDir, "ana-gate-passed");
  if (options["dry-run"]) {
    // A dry run fetches nothing, so only a full commit named outright reads the record.
    const commit = /^[0-9a-f]{40}$/.test(options.source) ? options.source : null;
    const plans = planRuns(options, parent, runSuffix(new Date(), commit, null));
    const summary = {
      source: options.source,
      condition: options.condition,
      budgetPerRun: Number(options.budget),
      tasks: Number(options.tasks),
      pins: Object.fromEntries(options.conditions.map((name) => [name, slotEnvironment(name)])),
      gate: plannedGate(options.gate, passRecord, commit),
      runs: plans,
    };
    console.log(JSON.stringify(summary, null, 2));
    return 0;
  }
  const commit = resolveSource(options.source);
  const ref = sourceRef(options.source, commit);
  const plans = planRuns(options, parent, runSuffix(new Date(), commit, ref));
  const manager = serviceManager();
  if (!process.getuid) throw new Error("this launcher needs a POSIX user id");
  if (Bun.version !== readFileSync(join(REPO, ".bun-version"), "utf8").trim()) {
    throw new Error("run with the pinned Bun version");
  }
  const campaigns = campaignRoot(mainRepo);
  const disk = statfsSync(existsSync(campaigns) ? campaigns : mainRepo);
  if (disk.bavail * disk.bsize < DEFAULT_DISK_MIN_GIB * 1024 ** 3) {
    throw new Error(`less than ${DEFAULT_DISK_MIN_GIB} GiB free on the shared run volume`);
  }
  for (const plan of plans) {
    if (existsSync(plan.dir)) {
      throw new Error(`run directory already exists: ${plan.dir}; choose a fresh run id`);
    }
    if (hasText(findOpening(plan, campaignRoot(mainRepo)))) {
      throw new Error(`${plan.runId}: an opening already exists; choose a fresh run id`);
    }
  }
  if (options.project !== undefined && !existsSync(join(campaigns, options.project))) {
    throw new Error(`--project ${options.project}: no such campaign under ${campaigns}`);
  }
  const credentials: Partial<Record<Backend, Credentials>> = {};
  for (const condition of options.conditions) {
    const kind = CONDITIONS[condition].kind;
    credentials[kind] ??= readCredentials(kind, options, mainRepo);
  }
  console.log(
    `${plans.length} run(s), ${options.condition}, ${options.budget} provider turns each; source ${commit} (${describeSourceRef(ref)})`,
  );
  for (const credential of Object.values(credentials)) {
    console.log(
      `Credential source: ${credential.origin}, account ${credential.account}; captured for this batch`,
    );
  }
  const results = await launchBatch(plans, options, {
    commit,
    sourceRef: ref,
    launcher: gitText(REPO, "rev-parse", "HEAD"),
    credentials,
    sharedRoot: mainRepo,
    uid: process.getuid(),
    manager,
    passRecord,
    host: readHostPace(mainRepo),
  });
  console.log(JSON.stringify(results, null, 2));
  return results.length === plans.length && results.every((row) => !("error" in row)) ? 0 : 1;
}

if (import.meta.main) {
  try {
    process.exitCode = await main(Bun.argv.slice(2));
  } catch (error) {
    die(errorMessage(error), 1);
  }
}
