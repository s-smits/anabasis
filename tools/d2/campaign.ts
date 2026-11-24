/**
 * Shared campaign state (`tools/d2/campaign.ts`): opens `.ana/d2/<name>` (`log.jsonl`, staged
 * check program, and `states/` kept harnesses) for `tools/c/accept.ts`, `tools/d2/{prepare,settle,session,checkpoint}.ts`,
 * and `tools/d1b/examine.ts`. Includes `tools/d2`, `tools/c`, and `tools/d1b` in the execution
 * code digest so a comparison refuses to continue if campaign execution code changes mid-round.
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
import { type Reader, referee } from "#src/referee/referee.ts";
import { type Asked, judgeBrief, judgePair } from "#src/referee/judge.ts";
import { writeStarter } from "#src/harness/starter.ts";
import { stageExam } from "./exam.ts";
import type { NamedSolver } from "./setting.ts";
import { openHarness, treeContent } from "#src/harness/open.ts";
import { HOST_SOLVE_ISOLATION_PROFILE_ID } from "#src/wall/base.ts";
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
  /** The model and effort that solve in the opening's place, when not its own: a command's `--solver`
   *  and `--solver-effort`, and the window `--solver-window` names (`setting.ts`). */
  readonly solver?: NamedSolver | undefined;
  /** What every solve of this command is held to, when not `LIMITS`: a command's `--solve-minutes`
   *  and `--solve-model-turns` (`setting.ts`). */
  readonly limits?: Limits | undefined;
  /** A log of this command's own for the solves it makes, when not the campaign's: the trial solve
   *  of a handed-over harness (`close.ts --solve`), which the campaign's readings never count. The
   *  exam, the tasks and the checker are read from the campaign's log all the same. */
  readonly trial?: string | undefined;
}

/** A harness as a solve is handed it. */
export interface Kept {
  readonly dir: string;
  readonly digest: string;
}

/** What a command hands over to have a kept harness named: where the campaign's log and its kept
 *  states are. */
interface Keeping {
  readonly log: string;
  readonly states: string;
}

/** Who solves: the model and effort, on the test side. */
interface Solver {
  readonly model: Model<Api>;
  readonly effort: ThinkingLevel;
  readonly side: Condition["side"];
  /** The context its Claude Code compacts at, where the setting names one (`sweepOptions`). */
  readonly window?: number;
  /** The backends of a solver this host's do not serve: a simulation's script (`tools/runs/rehearse.ts`). */
  readonly models?: (home: string) => Models;
}

/** What a solve's condition is made of beside its solver, its task and its harness: the
 *  campaign's contract, the verifier's tool tree, and what every solve is held to. */
interface Standing {
  readonly contract: Contract;
  readonly checks: string;
  readonly tools: string;
  readonly limits: Limits;
}

/** What names the reference harness of a campaign: the one last promoted, or the starter. */
export const PROMOTED = "promoted";
/** What names the programs ablation of a kept harness: `programs-of:latest`, `programs-of:<digest>`. */
const PROGRAMS_OF = "programs-of:";

/** Default solve resource limits (`20` model turns, `30` minutes wall clock, `24` total turns, `4` concurrent solves; overridden via `setting.ts`). */
export const LIMITS = {
  wallSeconds: 1800,
  modelTurns: 20,
  turns: 24,
  shellDefaultSeconds: 300,
  shellMaxSeconds: 900,
  concurrency: 4,
} as const satisfies Limits;
/** The repository a campaign's folder lies in: the worktree whose source the command runs. */
export const REPO = resolve(import.meta.dir, "..", "..");
/** The file in a worktree's own git folder that marks a checkout a job keeps moving to the top of
 *  the open stack (`bun run follow`), so that no paid seat runs from it (`treeFault`). */
export const FOLLOWED = "ana-followed";

/** The flag that names a campaign, whose pack is the exam its log drafted (`packNamed`). */
export const PACK_OPTIONS = { name: { type: "string" } } as const;
/** The agent runtime's packages, pinned in `package.json`; the SDK pins the Claude Code binary. */
const RUNTIME = ["@anthropic-ai/claude-agent-sdk", "@earendil-works/pi-ai", "@earendil-works/pi-durable"];
/** The trees of the host's code a solve runs (`codeOf`), beside the production packages that
 *  `package.json` and `bun.lock` resolve. */
export const CODE_TREES = ["src", "vendor", "tools/d2", "tools/c", "tools/d1b"] as const;

/**
 * The repository's other worktrees, which every wall of this command denies with the one it runs
 * in. A campaign is run from a worktree kept for it, and its log, every hidden value in it, lies
 * under `.ana` there, which a shell in a sibling worktree could otherwise read. A worktree that is
 * gone is left out, since a denied root has to exist for the wall to mount over it.
 */
export function worktreesOf(repo: string): string[] {
  const own = resolve(repo);
  return worktrees(repo)
    .map((tree) => resolve(tree))
    .filter((tree) => tree !== own && existsSync(tree));
}

/**
 * Why `tree` runs no paid seat, or null. A seat executes the source of the tree it started in for
 * hours, so a tree that is checked out again under it runs the seat on two commits, and a tree
 * holding a live seat cannot be moved, so a live solve run from the main checkout would hold the
 * job that keeps that checkout at the stack's top. A repository's main worktree, and a worktree
 * that job marked, are such trees.
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

/** A paid seat's backends, refused in a tree that is checked out again under it (`treeFault`). */
export function seatBackends(options: BackendOptions): ReturnType<typeof backends> {
  const fault = treeFault(REPO);
  if (fault !== null) throw new Error(fault);
  return backends(options);
}

/** Where campaign `name` keeps its log: what a command reads before it opens the campaign, for the
 *  setting the campaign recorded (`setting.ts`). */
export const campaignLog = (name: string): string => join(REPO, ".ana", "d2", name, LOG_FILE);

/** The log and the harness a command's flags must both name, as `import.ts` and `promote.ts` take them. */
export function harnessNamed(flags: {
  readonly name?: string | undefined;
  readonly harness?: string | undefined;
}) {
  const { name, harness } = flags;
  if (name === undefined || harness === undefined) throw new Error("name --name and --harness");
  return { log: campaignLog(name), harness };
}

/**
 * The campaign a command's flags name, refused where its log drafted no exam, one check for every
 * command rather than a copy in each. `also` is what else the command needs, for the sentence that
 * says what is missing.
 */
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

/**
 * What a campaign's drafted exam gives it: the pack's directory, its check program as a verifier
 * opens it, the answer format, and who solves where no flag says: the one the opening names.
 */
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

/** Compute the solve condition's runtime pin versions and host code/lockfile digest (`CODE_TREES`). */
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
  /** Each of `names` from the package at `parent`: Bun keys a nested copy under its parent's key,
   *  and a name resolves to the nearest copy up the chain. */
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

/** The code this process runs (`codeOf`), kept by its first campaign opening. */
let here: ReturnType<typeof codeOf> | undefined;

/**
 * Build solve condition and setting-id constructors for a campaign, caching `codeOf(REPO)` per process.
 */
function recordedUnder({ contract, checks, tools, limits }: Standing) {
  const hostManifest = join(tools, HOST_TOOLS_FILE);
  const engines = pinnedEngines({ checks, tools });
  const verifierTools =
    existsSync(hostManifest) || engines.some(({ external }) => external)
      ? hashJsonValue([treeContent(tools), engines.map(({ name, sha256 }) => [name, sha256])])
      : hashJsonValue(treeContent(tools));
  here ??= codeOf(REPO);
  const { runtime, host } = here;
  /** What every solve by `by` runs under whatever its task and harness: its condition less those. */
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
  /** The condition a solve of a task under a harness by a solver is recorded under. */
  const conditionOf = (task: TaskPackage, harness: Kept, by: Solver): Condition => ({
    ...settingOf(by),
    harness: harness.digest,
    task: taskVersion(task),
    solverTools: harness.digest,
  });
  /** The setting of every solve by `by`, as an id: what a comparison counts solves under
   *  (`src/kernel/compare.ts`). */
  const setting = (by: Solver) => settingId(settingOf(by));
  return { conditionOf, setting };
}

/** The Referee on one reader, for the campaign. */
function reviewersOf(
  reader: Reader,
  at: { log: string; contract: Contract; checks: string; verify: Verifier },
) {
  const { log, contract, checks, verify } = at;
  return {
    referee: (solve: string, task: TaskPackage, kill: AbortSignal) =>
      referee({ ...reader, kill }, { solve, task, contract, checks, verify, log }),
    reviewer: priceKey(reader.model),
    brief: (task: TaskPackage, comparison: string, kill: AbortSignal) =>
      judgeBrief({ ...reader, kill }, { log, comparison, task, contract }),
    pair: (task: TaskPackage, asked: Asked, kill: AbortSignal) =>
      judgePair({ ...reader, kill }, { log, task, contract, ...asked }),
  };
}

export async function openCampaign(args: CampaignArgs) {
  const dir = join(REPO, ".ana", "d2", args.name);
  mkdirSync(dir, { recursive: true });
  // Where a Node program of a kept tool tree ends its walk for its module type, short of the
  // checkout's manifest, which the solver's wall keeps closed (`commandReadAllows`).
  writeFileSync(join(dir, "package.json"), "{}\n");
  const log = join(dir, LOG_FILE);
  const { bundle, checks, events, format, solver } = packOpened(dir, log, args);
  const { brief, tasks } = readPack(bundle);
  const contract = contractOf(brief, format);
  // The checker this campaign runs under: its contract and its staged check program. Once the
  // operator has frozen one in the log (`tools/c/accept.ts --freeze`), a campaign whose own is
  // another does not open, since what the log counted was counted under the frozen one.
  const checker = { contract: contractHash(contract), checks: hashJsonValue(checkProgramVersion(checks)) };
  const moved = departure(events, checker);
  if (moved !== null) throw new Error(`${log}: ${moved}`);
  const resources = sweepResources(brief);
  const tools = join(bundle, ".toolchain");
  const trees = worktreesOf(REPO);
  // The drafted exam is staged under `.ana` here, closed with the repository.
  const verify = openVerifier({ checks, tools, otherTrees: trees });
  const limits = args.limits ?? LIMITS;
  const { conditionOf, setting } = recordedUnder({ contract, checks, tools, limits });
  const pack = (task: Task): TaskPackage => packageOf(checks, task);
  /** Every task the pack holds or a session wrote into the log, by version. */
  const packages = (): Map<string, TaskPackage> =>
    new Map(
      [...tasks, ...writtenTasks(read(log, TRACE_KINDS))].map((task) => {
        const packaged = pack(task);
        return [taskVersion(packaged), packaged];
      }),
    );
  let solves = 0;
  /** One live solve of a task under a harness, by a solver, its condition recorded first. A solve
   *  made for a comparison names it, and is counted by that comparison alone. */
  // Where this command's solves are recorded: the campaign's log, or a trial's of its own.
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
      // No two solves of a campaign share an id, whichever process made them.
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
    /** What every solve of this campaign's command is held to, which its settings hold. */
    limits,
    /** The pack's directory, laid out as a stored bundle is: what a command reads its control answers and
     *  its tool path from. */
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
    /** What `solveOnce` records a solve under, for a reader that sets a log beside this command's
     *  flags without a solve of its own. */
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

/**
 * The Starter Built Harness, as a solve and a Builder session are handed it
 * (`src/harness/starter.ts`): written once and kept under its digest among the campaign's states,
 * like a harness a session froze.
 */
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

/**
 * Resolve a named harness (`starter`, `promoted`, `latest`, a kept digest, a single-match display
 * letter, or `programs-of:<name>`) and verify its kept directory opens under the same digest.
 */
export async function keptAs(campaign: Keeping, flag: string, asked: string): Promise<Kept> {
  if (asked.startsWith(PROGRAMS_OF)) {
    return await programsAblation(campaign, await keptAs(campaign, flag, asked.slice(PROGRAMS_OF.length)));
  }
  const events = read(campaign.log, TRACE_KINDS);
  const built = asked === "latest" ? latestBuilt(events) : asked === PROMOTED ? promoted(events) : null;
  if (asked === "starter" || ((asked === "latest" || asked === PROMOTED) && built === null)) {
    return await starter(campaign);
  }
  // A letter the view and the closing report print names one kept digest (`namesOf`); one that
  // names two, as A can, falls through to the refusal with the digests there are.
  const lettered = [...namesOf(events)].flatMap(([each, letter]) => (letter === asked ? [each] : []));
  const digest = built ?? (lettered.length === 1 ? (lettered[0] ?? asked) : asked);
  // `states/` also holds the tool trees the states link to (`tree-*`), which name no harness.
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

/**
 * The programs ablation for what a harness installed: the Starter Built Harness with that harness's tool
 * tree and nothing else of it, kept under its own digest like any harness. Compared with the
 * starter it reads what the installed programs are worth by themselves, and compared with the
 * harness it was taken from, what the guide and the tools add to them.
 */
async function programsAblation(campaign: Keeping, source: Kept): Promise<Kept> {
  const tree = join(source.dir, ".toolchain");
  if (!existsSync(tree)) {
    throw new Error(
      `${source.digest} installed no program, so the control for its programs is the starter itself`,
    );
  }
  // Made among the states, so that the link a kept state names its tree by leads to the same tree.
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

/**
 * The held-out tasks a person has to read before they are scored again, in lines: the ones with no
 * valid answer on record after two comparisons that cut no solve of them at a limit
 * (`poolOf`, `reports.ts`). They are left out of the
 * scored set until labelled. A command that compares prints them after its report, and
 * `prepare.ts` before one, which is also where they are labelled. None when there is none.
 */
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
 * The backends of a Builder's, an Examiner's or a reviewer's session. A Builder keeps the CLI's
 * WebSearch, since it researches the field and its shell reaches the network anyway; an Examiner
 * and a reviewer work from what they are shown, and a search of theirs would be read by nobody,
 * since the trace holds the host's tools alone. A solver's backends are the sweep's as they stand
 * (`solveOnce`), with the search.
 */
function hostSession(seat: { readonly webSearch: boolean; readonly cacheTtl: "5m" | "1h" }) {
  return (home: string, shutdown: AbortSignal) =>
    seatBackends({ claude: { ...sweepOptions(home, undefined, shutdown).claude, ...seat } });
}

/** An Examiner's backends, for the session that drafts an exam before there is a campaign to
 *  open (`tools/d1b/draft.ts`). */
export const examinerSession = hostSession({ webSearch: false, cacheTtl: "1h" });

/** The plan runs every solve under `caffeinate -s`, so the Mac cannot sleep during a solve; it exits
 *  with this process, and unreferenced it does not hold this one open. */
export function stayAwake(): void {
  if (runtimeProcess.platform === "darwin") {
    capturedSpawn(["caffeinate", "-s", "-w", String(runtimeProcess.pid)]).unref();
  }
}

/**
 * Resolve and validate the campaign's project identifier (`--project` or recorded opening);
 * refuses missing, unsafe, or mismatched project names.
 */
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
