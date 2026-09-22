#!/usr/bin/env bun
import {
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
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
import { parseEnv } from "node:util";
import {
  CONDITIONS,
  DEFAULT_DISK_MIN_GIB,
  HELP,
  PRESETS,
  fullrunArgs,
  openingProblems,
  parseOptions,
  planRuns,
  record,
  requestIdentity,
  slotEnvironment,
  sourceIdentity,
  type Backend,
  type LaunchOptions,
  type OpeningPlan,
  type RunPlan,
} from "./options.ts";
import { serviceManager, type ServiceManager } from "./service.ts";
import { STOP_RECEIPT_PATH } from "./stop.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { isNumber, isString } from "#src/meta/json-shape.ts";
import type { JsonObject } from "#src/meta/json-shape.ts";
import { hasText } from "#src/meta/text.ts";
import { CODEX_AUTH_FILE } from "#src/backends/login-state.ts";
import { OPENING_FILE, TERMINAL_FILE } from "#src/run/controller-lineage.ts";
import { readJsonFile } from "#src/meta/completed-json.ts";
import { WORKTREE_SCRIPT } from "#tools/dependency-identity.ts";
import { LAUNCH_RECEIPT_PATH } from "#tools/runs/discover.ts";

const REPO = resolve(import.meta.dirname, "../../../..");
const WORKTREE = join(REPO, WORKTREE_SCRIPT);
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
}
interface Context {
  commit: string;
  uid: number;
  sharedRoot: string;
  credentials: Partial<Record<Backend, Credentials>>;
  manager: ServiceManager;
  gate?: string[];
}
interface PreparedRun extends OpeningPlan {
  environment: Environment;
  argv: string[];
  credentialSource: string;
  gateLog?: string;
}
interface Opened {
  project: string;
  opening: string;
  campaign: string;
  terminal: false;
  running: true;
}
type LaunchResult =
  | ({ runId: string; source: string; condition: RunPlan["condition"]; log: string } & Opened)
  | { runId: string; error: string; log: string };
export const runCommand: Command = async (
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
      throw new Error(`${argv[0]} exited ${code}${hasText(log) ? `; log: ${log}` : `: ${err.slice(-3000)}`}`);
    }
    return { code, out: out.trim(), err: err.trim() };
  } finally {
    if (fd !== null) closeSync(fd);
  }
};

async function resolveSource(source: string, command: Command): Promise<string> {
  let ref = source;
  if (source.startsWith("pr:")) {
    const number = source.slice(3);
    if (!/^[1-9]\d*$/.test(number)) throw new Error("--source pr:<number> requires a positive PR number");
    ref = `refs/remotes/origin/pr/${number}`;
    await command(["git", "fetch", "origin", `pull/${number}/head:${ref}`]);
  } else if (/^(origin\/|refs\/remotes\/origin\/)/.test(source)) {
    await command(["git", "fetch", "origin", "--quiet"]);
  }
  return (
    await command(["git", "rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`], { quiet: true })
  ).out;
}

export function readCredentials(
  options: LaunchOptions,
  mainRepo: string,
  environment: Environment = process.env,
): Credentials {
  const condition = options.conditions[0];
  if (!condition) throw new Error("missing credential condition");
  if (CONDITIONS[condition].kind === "claude") {
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
    return { kind: "claude", origin: path, bytes: `CLAUDE_CODE_OAUTH_TOKEN=${token}\n` };
  }
  const codexHome = options["codex-home"] ?? environment.CODEX_HOME ?? join(homedir(), ".codex");
  if (!isAbsolute(codexHome)) throw new Error("the selected CODEX_HOME must be absolute");
  const path = join(codexHome, CODEX_AUTH_FILE);
  let bytes: Uint8Array;
  try {
    bytes = readFileSync(path);
    const auth = record(JSON.parse(new TextDecoder().decode(bytes)));
    const token = record(auth.tokens).access_token;
    if (!isString(token) || !token) throw new Error("missing token");
  } catch {
    throw new Error(`${path}: readable Codex subscription auth with an access token is required`);
  }
  return { kind: "codex", origin: path, bytes };
}

export function prepareEnvironment(
  plan: RunPlan,
  credentials: Credentials,
  pathValue = process.env.PATH ?? "",
): Environment {
  const scratch = join(plan.dir, ".scratch/quick-run");
  if (existsSync(join(plan.dir, ".env"))) {
    throw new Error(`${plan.runId}: credential snapshot already exists`);
  }
  if (credentials.kind !== CONDITIONS[plan.condition].kind) {
    throw new Error(`${plan.runId}: credential kind does not match condition`);
  }
  // The Built wall closes the checkout; the generated worker must live outside it, on the
  // disk-backed temp root: a Linux /tmp is often a small tmpfs.
  plan.runtimeTemp = mkdtempSync(
    join(process.platform === "darwin" ? "/private/var/tmp" : "/var/tmp", "ana-quick-run-"),
  );
  const roots = { HOME: join(scratch, "home"), CODEX_HOME: join(scratch, "codex"), TMPDIR: plan.runtimeTemp };
  for (const path of Object.values(roots)) mkdirSync(path, { recursive: true, mode: 0o700 });
  const paths = [...new Set([dirname(process.execPath), ...pathValue.split(":").filter(isAbsolute)])];
  const target =
    credentials.kind === "claude" ? join(plan.dir, ".env") : join(roots.CODEX_HOME, CODEX_AUTH_FILE);
  writeFileSync(target, credentials.bytes, { flag: "wx", mode: 0o600 });
  if (credentials.kind === "codex") writeFileSync(join(plan.dir, ".env"), "", { flag: "wx", mode: 0o600 });
  return { ...roots, PATH: paths.join(":"), ...slotEnvironment(plan.condition) };
}

export async function inspectTarget(
  plan: RunPlan & { environment: Environment },
  options: LaunchOptions,
  command: Command = runCommand,
) {
  const args = [
    "custom",
    "--prompt",
    plan.prompt,
    "--run",
    plan.runId,
    "--condition",
    plan.condition,
    "--budget",
    options.budget,
    "--tasks",
    options.tasks,
  ];
  for (const key of ["max-iterations", "stop-after-ms", "project"] as const) {
    if (options[key] !== undefined) args.push(`--${key}`, options[key]);
  }
  // The launched tree's own probe: it imports that tree's modules, so it matches their layout by
  // construction. Main's probe could not open 03b8cb266, whose pi layer had replaced
  // src/backends/claude-backend.ts (esp32-opus-20260922T022701000Z-08c0f2).
  const probe = join(plan.dir, ".claude/skills/launch-run/scripts/probe.ts");
  const result = await command([WORKTREE, "run", plan.dir, "bun", "--no-env-file", probe, ...args], {
    cwd: plan.dir,
    env: plan.environment,
    quiet: true,
  });
  const row = record(JSON.parse(result.out));
  const source = sourceIdentity(row.source),
    identity = requestIdentity(row);
  const worker = record(row.worker),
    condition = CONDITIONS[plan.condition];
  if (
    worker.model !== condition.model ||
    worker.reasoningEffort !== condition.efforts[1] ||
    !isNumber(worker.confinedPid) ||
    worker.confinedPid <= 0
  ) {
    throw new Error(`${plan.runId}: worker probe did not confirm the requested condition under confinement`);
  }
  const allowance = record(row.allowance);
  if (allowance.ok !== true) {
    throw new Error(
      `${plan.runId}: the provider refused the Builder slot's allowance probe: ${isString(allowance.message) ? allowance.message : "no reason recorded"}`,
    );
  }
  return { source, ...identity, worker, allowance };
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
  console.log(
    `${plan.runId}: checking source, request, confined worker and the provider allowance with one minimal turn`,
  );
  const { worker, ...identity } = await inspectTarget({ ...plan, environment }, options, command);
  if (identity.source.commit !== context.commit || identity.source.dirty) {
    throw new Error(`${plan.runId}: target did not return the requested clean source`);
  }
  writeFileSync(
    join(plan.dir, ".scratch/quick-run/probe.json"),
    JSON.stringify({ ...identity, worker }, null, 2),
    { mode: 0o600 },
  );
  return Object.assign(plan, {
    environment,
    ...identity,
    argv: fullrunArgs(plan, options, identity.source),
    budget: options.budget,
    credentialSource: credentials.origin,
    service: context.manager.service(context.uid, plan.label),
  });
}

export function findOpening(plan: RunPlan, root = join(plan.dir, "campaigns")): string | null {
  if (!existsSync(root)) return null;
  const matches = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name, "controller", plan.runId, OPENING_FILE))
    .filter(existsSync);
  if (matches.length > 1) throw new Error(`${plan.runId}: multiple openings found; identity is ambiguous`);
  return matches[0] ?? null;
}

/** Whether the service manager still reports this plan's launcher as running. */
async function launcherRunning(
  plan: OpeningPlan,
  command: Command,
  manager: ServiceManager,
): Promise<boolean> {
  const service = await command(manager.query(plan.service), { quiet: true, check: false });
  return service.code === 0 && manager.running(service.out);
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
      const opening = record(readJsonFile(path)),
        problems = openingProblems(opening, plan);
      if (problems.length > 0) {
        throw new Error(`${plan.runId}: opening mismatch: ${problems.join(", ")}; inspect ${path}`);
      }
      await sleep(1000); // An opening can precede an immediate worker exit.
      const terminalPath = join(dirname(path), TERMINAL_FILE);
      if (existsSync(terminalPath)) {
        const terminal = record(readJsonFile(terminalPath));
        const closed =
          [terminal.terminalReason, terminal.outcome].find(isString) ?? "no terminal reason recorded";
        throw new Error(`${plan.runId}: startup closed: ${closed}; ${terminalPath}`);
      }
      if (!(await launcherRunning(plan, command, manager))) {
        throw new Error(
          `${plan.runId}: opening exists but launcher is no longer running; inspect ${plan.log}`,
        );
      }
      const project = record(opening.project).id;
      if (!isString(project)) {
        throw new Error(`${plan.runId}: the opening carries no project id; inspect ${path}`);
      }
      return {
        project,
        opening: path,
        campaign: resolve(dirname(path), "../.."),
        terminal: false,
        running: true,
      };
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
function writeReport(plan: PreparedRun, status: string, extra: JsonObject = {}): void {
  const publicPlan = Object.fromEntries(Object.entries(plan).filter(([key]) => key !== "environment"));
  writeFileSync(reportPath(plan), JSON.stringify({ ...publicPlan, status, ...extra }, null, 2) + "\n", {
    mode: 0o600,
  });
}

/** The stop timer outlives this launcher's worktree, which is disposable, so it runs a copy of this
 *  skill's stop script staged in the run worktree. The copy keeps the launcher's bytes: a launch
 *  procedure comes from main, never from the revision being measured. */
function stageStopTimer(runDir: string): string {
  const staged = join(runDir, ".scratch/quick-run/stop-timer");
  mkdirSync(staged, { recursive: true });
  for (const name of ["stop.ts", "service.ts"]) {
    copyFileSync(join(import.meta.dirname, name), join(staged, name));
  }
  return join(staged, "stop.ts");
}

export async function launchBatch(
  plans: RunPlan[],
  options: LaunchOptions,
  context: Context,
  command: Command = runCommand,
): Promise<LaunchResult[]> {
  const prepared: PreparedRun[] = [];
  for (const plan of plans) prepared.push(await prepare(plan, options, context, command));
  const first = prepared[0];
  if (!first) throw new Error("no runs requested");
  const gateLog = join(first.dir, ".scratch/quick-run/gate.log");
  console.log(`Checking the source gate once for ${context.commit.slice(0, 9)}; ${gateLog}`);
  // The run tree's campaigns and domains are links into the shared root; the observatory build
  // inside the gate reads its evidence snapshot from that root instead of refusing the links.
  // No ANA_TESTED_COMMIT: a gate wrapper that checks the named commit refuses the untracked
  // campaigns and domains links as a changed tree (a21d2e, 2026-09-14). The probe above already
  // proved the clean requested source.
  const gateEnv = { ...process.env };
  delete gateEnv.ANA_TESTED_COMMIT;
  await command([WORKTREE, "run", first.dir, ...(context.gate ?? ["bun", "run", "gate"])], {
    log: gateLog,
    env: { ...gateEnv, ANA_UI_REPO_ROOT: context.sharedRoot },
  });
  const results: LaunchResult[] = [];
  for (const plan of prepared) {
    plan.gateLog = gateLog;
    console.log(
      `${plan.runId}: launching; log: ${plan.log}\nStop: ${context.manager.terminate(plan.service).join(" ")}`,
    );
    const environmentArgs = Object.entries(plan.environment).flatMap(([key, value]) =>
      value === undefined ? [] : ["--env", `${key}=${value}`],
    );
    try {
      writeReport(plan, "starting");
      if (options["kill-after-ms"] !== undefined) {
        const deadline = Date.now() + Number(options["kill-after-ms"]);
        await command([
          join(plan.dir, context.manager.launcher),
          "--worktree",
          plan.dir,
          "--log",
          join(plan.dir, ".scratch/quick-run/stop.log"),
          "--label",
          `${plan.label}.stop`,
          ...environmentArgs,
          "--",
          process.execPath,
          "--no-env-file",
          stageStopTimer(plan.dir),
          "--worktree",
          plan.dir,
          "--run",
          plan.runId,
          "--service",
          plan.service,
          "--deadline",
          String(deadline),
          "--grace",
          "30000",
        ]);
        const ready = join(plan.dir, `${STOP_RECEIPT_PATH}.ready`);
        for (let attempt = 0; attempt < 50 && !existsSync(ready); attempt++) await Bun.sleep(100);
        if (!existsSync(ready)) {
          throw new Error(`${plan.runId}: stop timer did not confirm readiness; controller not launched`);
        }
        if (Date.now() >= deadline || existsSync(join(plan.dir, STOP_RECEIPT_PATH))) {
          throw new Error(`${plan.runId}: stop deadline elapsed before controller launch`);
        }
      }
      await command([
        join(plan.dir, context.manager.launcher),
        "--worktree",
        plan.dir,
        "--log",
        plan.log,
        "--label",
        plan.label,
        ...environmentArgs,
        "--",
        "bun",
        "run",
        "fullrun",
        "--",
        ...plan.argv,
      ]);
      const opened = await checkOpening(plan, command, { manager: context.manager });
      writeReport(plan, "running", { ...opened });
      results.push({
        runId: plan.runId,
        source: plan.source.commit,
        condition: plan.condition,
        ...opened,
        log: plan.log,
      });
      console.log(`${plan.runId}: opening verified and process running; project ${opened.project}`);
    } catch (error) {
      writeReport(plan, "start-unconfirmed", { error: errorMessage(error) });
      console.error(
        `${plan.runId}: ${errorMessage(error)}\nReceipt: ${reportPath(plan)}\nNo retry or signal was sent.`,
      );
      results.push({ runId: plan.runId, error: errorMessage(error), log: plan.log });
      break;
    }
  }
  return results;
}

export async function main(argv: string[]): Promise<number> {
  const options = parseOptions(argv);
  if (options.help === true) {
    console.log(HELP);
    return 0;
  }
  if (options.list === true) {
    console.log(JSON.stringify(PRESETS, null, 2));
    return 0;
  }
  const common = (
    await runCommand(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], { quiet: true })
  ).out;
  const mainRepo = dirname(common),
    parent = options["output-dir"] ?? dirname(mainRepo);
  const suffix = `${new Date().toISOString().replace(/[-:.]/g, "")}-${crypto.randomUUID().slice(0, 6)}`;
  const plans = planRuns(options, parent, suffix);
  if (options["dry-run"] === true) {
    console.log(
      JSON.stringify(
        {
          source: options.source,
          condition: options.condition,
          budgetPerRun: Number(options.budget),
          tasks: Number(options.tasks),
          pins: Object.fromEntries(options.conditions.map((name) => [name, slotEnvironment(name)])),
          gate: "once before launch",
          runs: plans,
        },
        null,
        2,
      ),
    );
    return 0;
  }
  const manager = serviceManager();
  if (!process.getuid) throw new Error("this launcher needs a POSIX user id");
  if (Bun.version !== readFileSync(join(REPO, ".bun-version"), "utf8").trim()) {
    throw new Error("run with the pinned Bun version");
  }
  const campaigns = join(mainRepo, "campaigns");
  const disk = statfsSync(existsSync(campaigns) ? campaigns : mainRepo);
  if (disk.bavail * disk.bsize < DEFAULT_DISK_MIN_GIB * 1024 ** 3) {
    throw new Error(`less than ${DEFAULT_DISK_MIN_GIB} GiB free on the shared run volume`);
  }
  for (const plan of plans) {
    if (existsSync(plan.dir)) {
      throw new Error(`run directory already exists: ${plan.dir}; choose a fresh run id`);
    }
    if (hasText(findOpening(plan, join(mainRepo, "campaigns")))) {
      throw new Error(`${plan.runId}: an opening already exists; choose a fresh run id`);
    }
  }
  if (options.project !== undefined && !existsSync(join(campaigns, options.project))) {
    throw new Error(`--project ${options.project}: no such campaign under ${campaigns}`);
  }
  const credentials: Partial<Record<Backend, Credentials>> = {};
  for (const condition of options.conditions) {
    const kind = CONDITIONS[condition].kind;
    credentials[kind] ??= readCredentials({ ...options, condition, conditions: [condition] }, mainRepo);
  }
  const commit = await resolveSource(options.source, runCommand);
  console.log(
    `${plans.length} run(s), ${options.condition}, ${options.budget} provider turns each; source ${commit}`,
  );
  for (const credential of Object.values(credentials)) {
    console.log(`Credential source: ${credential.origin}; captured for this batch`);
  }
  const results = await launchBatch(plans, options, {
    commit,
    credentials,
    sharedRoot: mainRepo,
    uid: process.getuid(),
    manager,
  });
  console.log(JSON.stringify(results, null, 2));
  return results.length === plans.length && results.every((row) => !("error" in row)) ? 0 : 1;
}

if (import.meta.main) {
  try {
    process.exitCode = await main(Bun.argv.slice(2));
  } catch (error) {
    console.error(`launch-run: ${errorMessage(error)}`);
    process.exitCode = 1;
  }
}
