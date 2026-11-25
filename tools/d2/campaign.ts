/**
 * Shared campaign state: opens `.ana/d2/<name>` for every campaign command. `CODE_TREES` puts
 * `tools/d2`, `tools/c` and `tools/d1b` in the code digest, so a comparison refuses to go on if
 * campaign code changes mid-round.
 */
import type { Api, Model, Models, ThinkingLevel } from "@earendil-works/pi-ai";
import { type BackendOptions, backends, compactionMode } from "#src/agent/backends/models.ts";
import { type Practised, practised } from "#src/builder/session.ts";
import { DIGEST, namesOf } from "#src/campaign/names.ts";
import { type Opening, openingOf } from "#src/campaign/opening.ts";
import { draftOf } from "#src/examiner/draft.ts";
import { departure } from "#src/kernel/acceptance.ts";
import {
  type Condition,
  type Limits,
  recordCondition,
  type Setting,
  settingId,
} from "#src/kernel/condition.ts";
import { type Contract, contractHash } from "#src/kernel/contract.ts";
import { writtenTasks } from "#src/kernel/history.ts";
import { LOG_FILE, read, TRACE_KINDS } from "#src/kernel/log.ts";
import { freezePrices, priceKey } from "#src/kernel/meter.ts";
import { latestBuilt, poolOf, promoted } from "#src/kernel/reports.ts";
import { type TaskPackage, taskVersion } from "#src/kernel/task.ts";
import {
  checkProgramVersion,
  HOST_TOOLS_FILE,
  openVerifier,
  pinnedEngines,
  type Task,
  type Verifier,
} from "#src/kernel/verify.ts";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "#src/meta/filesystem.ts";
import { parseJsonAs } from "#src/meta/json-runtime.ts";
import { asRecord, type JsonValue } from "#src/meta/json-shape.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { tmpdir } from "#src/meta/os.ts";
import { plural } from "#src/meta/text.ts";
import { join, resolve } from "#src/meta/path.ts";
import { isSafePathSegment } from "#src/meta/path-segment.ts";
import { gitMaybe, worktrees } from "#src/meta/git.ts";
import { capturedSpawn, runtimeProcess } from "#src/meta/process.ts";
import { hashJsonValue } from "#src/meta/stable-json.ts";
import { type Reader, auditRejection } from "#src/audit/auditor.ts";
import { type Asked, judgePair } from "#src/audit/judge.ts";
import { writeStarter } from "#src/harness/starter.ts";
import { stageExam } from "./exam.ts";
import type { NamedSolver } from "./setting.ts";
import { openHarness, treeContent } from "#src/harness/open.ts";
import { HOST_SOLVE_ISOLATION_PROFILE_ID } from "#src/sandbox/base.ts";
import {
  contractOf,
  packageOf,
  readPack,
  modelNamed,
  sweepOptions,
  sweepResources,
} from "../m0/stored-sweep.ts";

interface CampaignArgs {
  readonly name: string;
  readonly solver?: NamedSolver | undefined;
  readonly limits?: Limits | undefined;
  readonly trial?: string | undefined;
}

export interface Kept {
  readonly dir: string;
  readonly digest: string;
}

interface Keeping {
  readonly log: string;
  readonly states: string;
}

interface Solver {
  readonly model: Model<Api>;
  readonly effort: ThinkingLevel;
  readonly side: Condition["side"];
  readonly window?: number;
  readonly models?: (home: string) => Models;
}

interface Standing {
  readonly contract: Contract;
  readonly checks: string;
  readonly tools: string;
  readonly limits: Limits;
}

export const PROMOTED = "promoted";
const PROGRAMS_OF = "programs-of:";

export const LIMITS = {
  wallSeconds: 1800,
  modelTurns: 20,
  turns: 24,
  shellDefaultSeconds: 300,
  shellMaxSeconds: 900,
  concurrency: 4,
} as const satisfies Limits;
export const REPO = resolve(import.meta.dir, "..", "..");
export const FOLLOWED = "ana-followed";

export const PACK_OPTIONS = { name: { type: "string" } } as const;
const RUNTIME = ["@anthropic-ai/claude-agent-sdk", "@earendil-works/pi-ai", "@earendil-works/pi-durable"];
export const CODE_TREES = ["src", "vendor", "tools/d2", "tools/c", "tools/d1b"] as const;

/**
 * A campaign's log and hidden values lie under `.ana` in its own worktree, which a shell in a
 * sibling worktree could otherwise read; a gone worktree is left out, since a denied root must
 * exist for the wall to mount over it.
 */
export function worktreesOf(repo: string): string[] {
  const own = resolve(repo);
  return worktrees(repo)
    .map((tree) => resolve(tree))
    .filter((tree) => tree !== own && existsSync(tree));
}

/**
 * A seat runs its tree's source for hours, so a tree checked out again under it runs the seat on
 * two commits: the main worktree and one the follow job marked are such trees.
 */
export function treeFault(tree: string): string | null {
  const own = gitMaybe(tree, "rev-parse", "--path-format=absolute", "--git-dir");
  if (own === null) return null;
  const moved =
    own === gitMaybe(tree, "rev-parse", "--path-format=absolute", "--git-common-dir")
      ? "is its repository's main worktree"
      : existsSync(join(own, FOLLOWED))
        ? `is kept at the top of the open stack (${FOLLOWED})`
        : null;
  return moved === null
    ? null
    : `${tree} ${moved}, which is checked out again under a running seat; start a run or a simulation from a worktree of its own (\`git worktree add --detach <path> <commit>\`, as \`runs fresh\` makes one)`;
}

export function seatBackends(options: BackendOptions): ReturnType<typeof backends> {
  const fault = treeFault(REPO);
  if (fault !== null) throw new Error(fault);
  return backends(options);
}

export const campaignLog = (name: string): string => join(REPO, ".ana", "d2", name, LOG_FILE);

export function harnessNamed(flags: {
  readonly name?: string | undefined;
  readonly harness?: string | undefined;
}) {
  const { name, harness } = flags;
  if (name === undefined || harness === undefined) throw new Error("name --name and --harness");
  return { log: campaignLog(name), harness };
}

export function packNamed(flags: { readonly name?: string | undefined }, also = ""): CampaignArgs {
  const { name } = flags;
  if (name === undefined) throw new Error(`name --name${also}`);
  if (draftOf(read(campaignLog(name), TRACE_KINDS)) === null) {
    throw new Error(
      `campaign ${name} holds no exam of its own, which only a campaign that opened from a prompt drafts (tools/d2/harness-builder.ts --prompt)`,
    );
  }
  return { name };
}

function packOpened(dir: string, log: string, args: CampaignArgs) {
  const events = read(log, TRACE_KINDS);
  const draft = draftOf(events);
  if (draft === null) throw new Error(`${log} holds no drafted exam`);
  const named = openingOf(events)?.solver ?? null;
  return {
    ...stageExam(dir, draft),
    events,
    format: draft.answerFormat,
    solver: () => {
      if (named === null) {
        throw new Error(
          `name --solver: campaign ${args.name} opened from a prompt, and neither its opening nor this command names who solves`,
        );
      }
      // SAFETY: an effort the opening recorded from a command's `--solver-effort`.
      return { model: modelNamed(named.model), effort: named.effort as ThinkingLevel };
    },
  };
}

export function codeOf(tree: string) {
  const pins = parseJsonAs<{ dependencies: Record<string, string> }>(
    readFileSync(join(tree, "package.json"), "utf8"),
  ).dependencies;
  const lock = join(tree, "bun.lock");
  const resolved = existsSync(lock) ? asRecord(Bun.JSONC.parse(readFileSync(lock, "utf8"))) : null;
  const packages = asRecord(resolved?.packages) ?? {};
  const named = (entry: JsonValue | undefined) =>
    ["dependencies", "optionalDependencies", "peerDependencies"].flatMap((field) =>
      Object.keys(asRecord(asRecord(entry)?.[field]) ?? {}),
    );
  const production = new Map<string, JsonValue | undefined>();
  const visit = (parent: readonly string[], names: readonly string[]): void => {
    for (const name of names) {
      const place = [...parent.map((_, cut) => [...parent.slice(0, parent.length - cut), name]), [name]].find(
        (each) => packages[each.join("/")] !== undefined,
      );
      const key = place?.join("/") ?? "";
      if (place === undefined || production.has(key)) continue;
      const entry = packages[key];
      production.set(key, entry);
      visit(place, named(Array.isArray(entry) ? entry[2] : undefined));
    }
  };
  visit([], named(asRecord(resolved?.workspaces)?.[""]));
  const trees = CODE_TREES.map((part) => {
    const dir = join(tree, part);
    return existsSync(dir) ? treeContent(dir) : null;
  });
  return {
    runtime: {
      ...Object.fromEntries(RUNTIME.map((name) => [name, pins[name] ?? "unpinned"])),
      bun: Bun.version,
    },
    host: hashJsonValue([...trees, resolved === null ? null : Object.fromEntries(production)]),
  };
}

let here: ReturnType<typeof codeOf> | undefined;

function recordedUnder({ contract, checks, tools, limits }: Standing) {
  const hostManifest = join(tools, HOST_TOOLS_FILE);
  const engines = pinnedEngines({ checks, tools });
  const verifierTools =
    existsSync(hostManifest) || engines.some(({ external }) => external)
      ? hashJsonValue([treeContent(tools), engines.map(({ name, sha256 }) => [name, sha256])])
      : hashJsonValue(treeContent(tools));
  here ??= codeOf(REPO);
  const { runtime, host } = here;
  const settingOf = (by: Solver): Setting => ({
    contract: contractHash(contract),
    model: priceKey(by.model),
    effort: by.effort,
    prices: freezePrices([by.model]),
    runtime,
    compaction: compactionMode(by.model, sweepOptions(undefined, by.window)),
    verifierTools,
    sandbox: hashJsonValue({
      profile: HOST_SOLVE_ISOLATION_PROFILE_ID,
      platform: runtimeProcess.platform,
    }),
    limits,
    host,
    side: by.side,
  });
  const conditionOf = (task: TaskPackage, harness: Kept, by: Solver): Condition => ({
    ...settingOf(by),
    harness: harness.digest,
    task: taskVersion(task),
    solverTools: harness.digest,
  });
  const setting = (by: Solver) => settingId(settingOf(by));
  return { conditionOf, setting };
}

function reviewersOf(
  reader: Reader,
  at: { log: string; contract: Contract; checks: string; verify: Verifier },
) {
  const { log, contract, checks, verify } = at;
  const prompt = openingOf(read(log, TRACE_KINDS))?.prompt ?? undefined;
  return {
    referee: (solve: string, task: TaskPackage, kill: AbortSignal) =>
      auditRejection({ ...reader, kill }, { solve, task, contract, checks, verify, log }),
    reviewer: priceKey(reader.model),
    pair: (task: TaskPackage, asked: Asked, kill: AbortSignal) =>
      judgePair({ ...reader, kill }, { log, task, contract, prompt, ...asked }),
  };
}

export async function openCampaign(args: CampaignArgs) {
  const dir = join(REPO, ".ana", "d2", args.name);
  mkdirSync(dir, { recursive: true });
  // Where a Node program of a kept tool tree ends its walk for its module type, short of the checkout's
  // manifest, which the solver's wall keeps closed (`commandReadAllows`).
  writeFileSync(join(dir, "package.json"), "{}\n");
  const log = join(dir, LOG_FILE);
  const { bundle, checks, events, format, solver } = packOpened(dir, log, args);
  const { brief, tasks } = readPack(bundle);
  const contract = contractOf(brief, format);
  // Once the operator has frozen a checker (`tools/c/accept.ts --freeze`), a campaign whose own is
  // another does not open, since what the log counted was counted under the frozen one.
  const checker = { contract: contractHash(contract), checks: hashJsonValue(checkProgramVersion(checks)) };
  const moved = departure(events, checker);
  if (moved !== null) throw new Error(`${log}: ${moved}`);
  const resources = sweepResources(brief);
  const tools = join(bundle, ".toolchain");
  const trees = worktreesOf(REPO);
  const verify = openVerifier({ checks, tools, otherTrees: trees });
  const limits = args.limits ?? LIMITS;
  const { conditionOf, setting } = recordedUnder({ contract, checks, tools, limits });
  const pack = (task: Task): TaskPackage => packageOf(checks, task);
  const packages = (): Map<string, TaskPackage> =>
    new Map(
      [...tasks, ...writtenTasks(read(log, TRACE_KINDS))].map((task) => {
        const packaged = pack(task);
        return [taskVersion(packaged), packaged];
      }),
    );
  let solves = 0;
  const written = args.trial ?? log;
  const solveOnce = (
    task: TaskPackage,
    harness: Kept,
    by: Solver,
    kill: AbortSignal | undefined,
    comparison?: string,
  ): Promise<Practised> => {
    solves += 1;
    return practised({
      id: `${args.name}-${Date.now().toString(36)}-${String(solves)}`,
      condition: recordCondition(written, conditionOf(task, harness, by)),
      task,
      contract,
      harness: harness.dir,
      resources,
      model: by.model,
      effort: by.effort,
      limits,
      models: by.models ?? ((home, shutdown) => seatBackends(sweepOptions(home, by.window, shutdown))),
      verify,
      log: written,
      repoRoot: REPO,
      otherTrees: trees,
      ...keyIfDefined("kill", kill),
      ...keyIfDefined("comparison", comparison),
    });
  };
  const reviewers = (reader: Reader) => reviewersOf(reader, { log: written, contract, checks, verify });
  return {
    repo: REPO,
    trees,
    log,
    states: join(dir, "states"),
    memory: join(dir, "memory"),
    checks,
    brief,
    tasks,
    contract,
    checker,
    resources,
    limits,
    bundle,
    test: {
      ...(args.solver === undefined
        ? solver()
        : {
            model: modelNamed(args.solver.model),
            effort: args.solver.effort,
            ...keyIfDefined("window", args.solver.window),
          }),
      side: "test",
    } as const,
    verify,
    pack,
    packages,
    solveOnce,
    conditionOf,
    setting,
    reviewers,
    reader: (model: Model<Api>, effort: ThinkingLevel): Reader => ({
      model,
      effort,
      models: hostSession({ webSearch: false, cacheTtl: "5m" }),
    }),
    builder: hostSession({ webSearch: true, cacheTtl: "1h" }),
    examiner: examinerSession,
  };
}

export async function starter(campaign: { readonly states: string }): Promise<Kept> {
  const scratch = mkdtempSync(join(tmpdir(), "ana-starter-"));
  try {
    writeStarter(scratch);
    const { digest } = await openHarness(scratch);
    const dir = join(campaign.states, digest);
    if (!existsSync(dir)) {
      mkdirSync(campaign.states, { recursive: true });
      cpSync(scratch, dir, { recursive: true });
    }
    return { dir, digest };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

export async function resolveCheckpoint(campaign: Keeping, flag: string, asked: string): Promise<Kept> {
  if (asked.startsWith(PROGRAMS_OF)) {
    return await programsAblation(
      campaign,
      await resolveCheckpoint(campaign, flag, asked.slice(PROGRAMS_OF.length)),
    );
  }
  const events = read(campaign.log, TRACE_KINDS);
  const built = asked === "latest" ? latestBuilt(events) : asked === PROMOTED ? promoted(events) : null;
  if (asked === "starter" || ((asked === "latest" || asked === PROMOTED) && built === null)) {
    return await starter(campaign);
  }
  const lettered = [...namesOf(events)].flatMap(([each, letter]) => (letter === asked ? [each] : []));
  const digest = built ?? (lettered.length === 1 ? (lettered[0] ?? asked) : asked);
  const kept = existsSync(campaign.states)
    ? readdirSync(campaign.states)
        .filter((each) => DIGEST.test(each))
        .toSorted()
    : [];
  if (!kept.includes(digest)) {
    const begun = kept.filter((each) => digest !== "" && each.startsWith(digest));
    const named =
      "It also takes starter, for the harness every campaign starts from, promoted, for the reference harness, latest, for the last a session left, and a letter the view prints";
    throw new Error(
      kept.length === 0
        ? `${flag} ${asked} is no harness this campaign keeps: no session has kept one under ${campaign.states} yet. ${named}`
        : `${flag} ${asked} is no harness this campaign keeps. It takes one of the digests under ${campaign.states}, whole: ${kept.join(", ")}.${begun.length === 1 ? ` ${asked} begins ${String(begun[0])}.` : ""} ${named}`,
    );
  }
  const dir = join(campaign.states, digest);
  if ((await openHarness(dir)).digest === digest) return { dir, digest };
  throw new Error(`${dir} no longer opens as the harness it is kept as`);
}

async function programsAblation(campaign: Keeping, source: Kept): Promise<Kept> {
  const tree = join(source.dir, ".toolchain");
  if (!existsSync(tree)) {
    throw new Error(
      `${source.digest} installed no program, so the control for its programs is the starter itself`,
    );
  }
  const scratch = mkdtempSync(join(campaign.states, "control-"));
  try {
    writeStarter(scratch);
    cpSync(tree, join(scratch, ".toolchain"), { recursive: true, verbatimSymlinks: true });
    const { digest } = await openHarness(scratch);
    const dir = join(campaign.states, digest);
    if (!existsSync(dir)) renameSync(scratch, dir);
    return { dir, digest };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

export function awaitingLines(campaign: {
  readonly log: string;
  readonly packages: () => Map<string, TaskPackage>;
}): string[] {
  const { awaiting } = poolOf(read(campaign.log, TRACE_KINDS));
  if (awaiting.length === 0) return [];
  const packages = campaign.packages();
  const named = awaiting.map((version) => packages.get(version)?.taskId ?? version.slice(0, 8));
  const [has, is, it] = awaiting.length === 1 ? ["has", "is", "it"] : ["have", "are", "them"];
  return [
    `${plural(awaiting.length, "held-out task")} ${has} no valid answer on record after two comparisons that cut no solve of ${it} at a limit, and ${is} left out of the scored set until a person has read ${it}: ${named.join(", ")}. A task may be hard, wrongly checked, or have no valid answer at all. Label each with tools/d2/prepare.ts: --keep <task id> returns it to the set, --infeasible <task id> refuses it`,
  ];
}

/**
 * A Builder keeps WebSearch, since its shell reaches the network anyway; an Examiner's or
 * reviewer's search would be read by nobody.
 */
function hostSession(seat: { readonly webSearch: boolean; readonly cacheTtl: "5m" | "1h" }) {
  return (home: string, shutdown: AbortSignal) =>
    seatBackends({ claude: { ...sweepOptions(home, undefined, shutdown).claude, ...seat } });
}

export const examinerSession = hostSession({ webSearch: false, cacheTtl: "1h" });

export function stayAwake(): void {
  if (runtimeProcess.platform === "darwin") {
    capturedSpawn(["caffeinate", "-s", "-w", String(runtimeProcess.pid)]).unref();
  }
}

export function projectOf(log: string, named: string | undefined, was: Opening | null): string {
  const recorded = was?.project ?? null;
  const project = named ?? recorded;
  if (project === null) {
    throw new Error(
      `name --project, the project this campaign belongs to: ${log} names none, and a campaign is opened under one`,
    );
  }
  if (!isSafePathSegment(project)) {
    throw new Error(
      `--project ${project}: a project is named as v1's were, by letters, digits, '.', '_' and '-'`,
    );
  }
  if (recorded !== null && project !== recorded) {
    throw new Error(
      `--project ${project}: this campaign belongs to project ${recorded}, and keeps it; another project takes a campaign of its own`,
    );
  }
  return project;
}
