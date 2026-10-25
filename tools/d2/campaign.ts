/**
 * A campaign: one log, one staged check program and one folder of harness states under
 * `.ana/d2/<name>`, over a stored sweep's pack. It is what the commands share, so that each builds
 * its conditions, its solves and its reviewers the same way:
 *
 *   bun tools/c/accept.ts      ... --name <name> [--freeze]          what the check program has been seen to do; the operator's word that it stands
 *   bun tools/d2/prepare.ts    ... --name <name>                     the pack's tasks, held out; the practice tasks, released; the scored tasks, confirmed
 *   bun tools/d2/round.ts      ... --name <name> --session b-1       a Builder session and its comparison
 *   bun tools/d2/settle.ts     ... --name <name> --session b-1       a comparison's rejections, labelled by a person
 *   bun tools/d2/session.ts    ... --name <name> --session b-2       a Builder session with no comparison after it
 *   bun tools/d2/checkpoint.ts ... --name <name> --id g2             one comparison of two kept harnesses
 *   bun tools/d1b/examine.ts   ... --name <name> --session x-1       an Examiner session, which writes further tasks
 *
 * The campaign folder is inside the repository, which every solve's and every Builder's wall denies,
 * as `live-solve.ts` keeps its check program: the log holds hidden values and the checks' verdicts.
 *
 * What is stood in for is what `live-solve.ts` stands in: the contract is the check program's brief
 * with the answer format the sweep's record tool took, and the limits are the sweep's `config.yaml`
 * without its disk cap. The test condition's model and effort are the stored cycle's. The cycle's own
 * harness is not used: it comes from v1's runs, and a campaign starts from the Starter Built
 * Harness, which is also its first reference harness (`src/harness/starter.ts`, `7f0add79:docs/plan.md`,
 * Phase 0). Until 2026-10-09 the stored harness was both.
 *
 * It first ran against a model on 8 October, in a round with a Claude Builder (issue #1). It needs
 * the Mac's command wall, the pack and the sweep on disk, and a model login.
 */
import type { Api, Model, Models, ThinkingLevel } from "@earendil-works/pi-ai";
import { backends, compactionMode } from "#src/agent/backends/models.ts";
import { type Practised, practised } from "#src/builder/session.ts";
import { namesOf } from "#src/campaign/names.ts";
import { type Opening, openingOf } from "#src/campaign/opening.ts";
import { type Draft, draftOf } from "#src/examiner/draft.ts";
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
import { LOG_FILE, read } from "#src/kernel/log.ts";
import { freezePrices, priceKey } from "#src/kernel/meter.ts";
import { latestBuilt, poolOf, promoted } from "#src/kernel/reports.ts";
import { type TaskPackage, taskVersion } from "#src/kernel/task.ts";
import { checkProgramVersion, openVerifier, type Task, type Verifier } from "#src/kernel/verify.ts";
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
import { worktrees } from "#src/meta/git.ts";
import { capturedSpawn, runtimeProcess } from "#src/meta/process.ts";
import { hashJsonValue } from "#src/meta/stable-json.ts";
import type { Reader } from "#src/referee/reader.ts";
import { referee } from "#src/referee/referee.ts";
import { writeStarter } from "#src/harness/starter.ts";
import { stageExam } from "./exam.ts";
import type { NamedSolver } from "./setting.ts";
import { openHarness, treeContent } from "#src/harness/open.ts";
import { HOST_SOLVE_ISOLATION_PROFILE_ID } from "#src/wall/base.ts";
import {
  checkProgram,
  contractOf,
  packageOf,
  readPack,
  recordedAnswerFormat,
  modelNamed,
  rowModel,
  storedRuntime,
  sweepOptions,
  sweepResources,
  sweepRows,
} from "../m0/stored-sweep.ts";

interface CampaignArgs {
  /** The stored pack a campaign opens over, which the four name together. A campaign that
   *  opened from a prompt names none: its exam is the one its own log drafted (`exam.ts`). */
  readonly root?: string | undefined;
  readonly sweep?: string | undefined;
  /** The cycle whose model and effort the test condition takes. */
  readonly cycle?: string | undefined;
  readonly bundle?: string | undefined;
  readonly name: string;
  /** The model and effort that solve in the cycle's place, when not its own: a command's `--solver`
   *  and `--solver-effort`, and the window `--solver-window` names (`setting.ts`). */
  readonly solver?: NamedSolver | undefined;
  /** What every solve of this command is held to, when not `LIMITS`: a command's `--solve-minutes`
   *  and `--solve-model-turns` (`setting.ts`). */
  readonly limits?: Limits | undefined;
  /** A log of this command's own for the solves it makes, when not the campaign's: the trial solve
   *  of a handed-over harness (`close.ts --solve`), which the campaign's readings never count. The
   *  exam, the tasks and the checker are read from the campaign's log all the same. */
  readonly trial?: string | undefined;
  /** A drafted exam the log does not hold yet, which the campaign opens over in place of the one
   *  its log drafted: the draft whose examples the drafting session's measure solves
   *  (`tools/d1b/draft.ts`). */
  readonly draft?: Draft | undefined;
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
  readonly tools: string;
  readonly limits: Limits;
}

/** What names the reference harness of a campaign: the one last promoted, or the starter. */
export const PROMOTED = "promoted";
/** What names the control of a kept harness: `programs-of:latest`, `programs-of:<digest>`. */
const PROGRAMS_OF = "programs-of:";

/** What every solve is held to, whoever solves: 20 of the model's own turns, which bind, and a wall
 *  of 30 minutes, which stops a solve whose provider stalls. A command names another wall or number
 *  of turns (`setting.ts`), and another is another campaign. The prompts, `turns`, are every
 *  solve's (v1's cap on nudges); the shell's timeouts and four solves at a time are the stored
 *  sweep's. Concurrency is part of a condition, so
 *  a campaign's solves and a parity solve (`live-solve.ts`) are not under the same one.
 *
 *  Until 19 October a campaign's default was the sweep's 120 minutes with the model's turns
 *  unlimited, while `bun run runs fresh` named 8 or 30 minutes and 16 turns by model. Of the 1,145
 *  solves of three Opus fresh runs that day at 8 minutes, none ended on its wall; the turns bound.
 *  So one budget stands for every solver, with the turns at 20 (the operator, 19 October).
 *
 *  The turns are what leaves a task room. Until 17 October fresh runs solved at 120 minutes with the
 *  turns unlimited, and the gate held out 6 of 78 buffer drafts and 3 of 24 truss drafts; the three
 *  buffer runs at 16 turns held out 74 of 146, and a truss run 4 of its first 4. A harness's programs
 *  and guide show as an answer reached within the budget, which an unlimited solver reaches anyway.
 *  A turn is also the same on a loaded host, where a second is not. */
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
/** The flags that name a stored pack together. */
const PACK_FLAGS = 4;
/** The agent runtime's packages, pinned in `package.json`; the SDK pins the Claude Code binary. */
const RUNTIME = ["@anthropic-ai/claude-agent-sdk", "@earendil-works/pi-ai", "@earendil-works/pi-durable"];

/**
 * The repository's other worktrees, which every wall of this command denies with the one it runs
 * in. A campaign is run from a worktree kept for it, and its log, every hidden value in it, lies
 * under `.ana` there; a shell in a sibling worktree read it on 10 October. A worktree that is
 * gone is left out, since a denied root has to exist for the wall to mount over it.
 */
export function worktreesOf(repo: string): string[] {
  const own = resolve(repo);
  return worktrees(repo)
    .map((tree) => resolve(tree))
    .filter((tree) => tree !== own && existsSync(tree));
}

/** Where campaign `name` keeps its log: what a command reads before it opens the campaign, for the
 *  setting the campaign recorded (`setting.ts`). */
export const campaignLog = (name: string): string => join(REPO, ".ana", "d2", name, LOG_FILE);

/**
 * The campaign a command's flags name, and the pack it opens over: the stored one that `--root`,
 * `--sweep`, `--cycle` and `--bundle` name together, or, where none of the four is given, the exam
 * the campaign's own log drafted. Ten commands each held their own copy of this check until
 * 2026-10-09, when a campaign could only open over a stored pack. `also` is what else the command
 * needs, for the sentence that says what is missing.
 */
export function packNamed(
  flags: Pick<CampaignArgs, "root" | "sweep" | "cycle" | "bundle"> & { readonly name?: string | undefined },
  also = "",
): CampaignArgs {
  const { root, sweep, cycle, bundle, name } = flags;
  const stored = [root, sweep, cycle, bundle].filter((each) => each !== undefined).length;
  if (name === undefined || (stored > 0 && stored < PACK_FLAGS)) {
    throw new Error(`name --root, --sweep, --cycle, --bundle, --name${also}`);
  }
  if (stored === 0 && draftOf(read(campaignLog(name))) === null) {
    throw new Error(
      `name --root, --sweep, --cycle and --bundle: campaign ${name} holds no exam of its own, which only a campaign that opened from a prompt drafts (tools/d2/harness-builder.ts --prompt)`,
    );
  }
  return { root, sweep, cycle, bundle, name };
}

/**
 * What a campaign's pack gives it: the pack's directory, its check program as a verifier opens
 * it, the answer format, and who solves where no flag and no record says. A stored pack's format
 * and solver are its cycle's; a drafted exam's format is the draft's, and its solver the one the
 * campaign's opening names.
 */
function packOpened(dir: string, log: string, args: CampaignArgs) {
  const { root, sweep, cycle, bundle } = args;
  if (root !== undefined && sweep !== undefined && cycle !== undefined && bundle !== undefined) {
    const checks = join(dir, "checks");
    if (!existsSync(checks)) checkProgram(bundle, checks);
    const row = sweepRows(root, sweep).find((each) => each.cycle === cycle);
    if (row === undefined) throw new Error(`${sweep} graded no solve in ${cycle}`);
    const stored = { model: rowModel(row), effort: storedRuntime(row).modelWorker.modelSelection.effort };
    return { bundle, checks, format: recordedAnswerFormat(row), solver: () => stored };
  }
  const events = read(log);
  const draft = args.draft ?? draftOf(events);
  if (draft === null) throw new Error(`${log} holds no drafted exam, and no stored pack was named`);
  const named = openingOf(events)?.solver ?? null;
  return {
    ...stageExam(dir, draft),
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

/**
 * The code a solve runs, as its condition records it (`src/kernel/condition.ts`): the agent
 * runtime's pins by name with the Bun that runs this command, and the host, `src` and `vendor` of
 * `tree` as they stand with every production package its lockfile resolves. Until 12 October the
 * host was the two trees alone, and a package such as `typebox`, which builds the solver's bash
 * schema, could change under one setting id (the stack review at 658a933b, finding 6). Until 24
 * October the Bun was left out, though the verifier runs every check under it: one campaign read
 * comparison g-1 under Bun 1.4.3 and g-2 under 1.4.4 with one setting id.
 */
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
  const trees = ["src", "vendor"].map((part) => treeContent(join(tree, part)));
  return {
    runtime: {
      ...Object.fromEntries(RUNTIME.map((name) => [name, pins[name] ?? "unpinned"])),
      bun: Bun.version,
    },
    host: hashJsonValue([...trees, resolved === null ? null : Object.fromEntries(production)]),
  };
}

/**
 * What a campaign's solves are recorded under (`src/kernel/condition.ts`): the condition of one
 * solve of a task under a harness by a solver, and the setting of every solve by that solver,
 * whatever its task and harness, as the id a comparison counts solves under. The code it runs
 * (`codeOf`) is read once: each tree is a walk of thousands of files, and none moves inside a run.
 */
function recordedUnder({ contract, tools, limits }: Standing) {
  const verifierTools = hashJsonValue(treeContent(tools));
  const { runtime, host } = codeOf(REPO);
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
  };
}

export async function openCampaign(args: CampaignArgs) {
  const dir = join(REPO, ".ana", "d2", args.name);
  mkdirSync(dir, { recursive: true });
  // Where a Node program of a kept tool tree ends its walk for its module type, short of the
  // checkout's manifest, which the solver's wall keeps closed (`commandReadAllows`).
  writeFileSync(join(dir, "package.json"), "{}\n");
  const log = join(dir, LOG_FILE);
  const { bundle, checks, format, solver } = packOpened(dir, log, args);
  const { brief, tasks } = readPack(bundle);
  const contract = contractOf(brief, format);
  // The checker this campaign runs under: its contract and its staged check program. Once the
  // operator has frozen one in the log (`tools/c/accept.ts --freeze`), a campaign whose own is
  // another does not open, since what the log counted was counted under the frozen one.
  const checker = { contract: contractHash(contract), checks: hashJsonValue(checkProgramVersion(checks)) };
  const moved = departure(read(log), checker);
  if (moved !== null) throw new Error(`${log}: ${moved}`);
  const resources = sweepResources(brief);
  const tools = join(bundle, ".toolchain");
  const trees = worktreesOf(REPO);
  // A stored pack's root and bundle, closed to every command and every check as the repository is.
  // A campaign opened from a prompt drafted its exam under `.ana` here, inside the repository.
  const packRoots = args.root === undefined ? [] : [args.root, bundle];
  const verify = openVerifier({ checks, tools, otherTrees: trees, packRoots });
  const limits = args.limits ?? LIMITS;
  const { conditionOf, setting } = recordedUnder({ contract, tools, limits });
  const pack = (task: Task): TaskPackage => packageOf(checks, task);
  /** Every task the pack holds or a session wrote into the log, by version. */
  const packages = (): Map<string, TaskPackage> =>
    new Map([...tasks, ...writtenTasks(read(log))].map((task) => [taskVersion(pack(task)), pack(task)]));
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
      models: by.models ?? ((home, shutdown) => backends(sweepOptions(home, by.window, shutdown))),
      verify,
      log: written,
      repoRoot: REPO,
      otherTrees: trees,
      packRoots,
      ...keyIfDefined("kill", kill),
      ...keyIfDefined("comparison", comparison),
    });
  };
  const reviewers = (reader: Reader) => reviewersOf(reader, { log, contract, checks, verify });
  return {
    repo: REPO,
    trees,
    packRoots,
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
    /** The pack's directory, laid out as a stored bundle is: what a command reads its controls and
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
 * A harness the campaign keeps, by the name a flag gives it: `starter` for the Starter Built
 * Harness, which the first Builder session forks and which is the reference harness until the
 * operator promotes another; `promoted` for the reference harness itself, the one last promoted
 * and the starter while none has been; `latest` for the one the last whole Builder session left,
 * which is the starter while none has; or the whole digest of one a session froze, which is the
 * name of its folder under the campaign's `states/`. `programs-of:` before any of those names its control, the
 * starter with that harness's installed programs alone (`programsOf`). Any other name is answered with the ones there are: on
 * 2026-10-08 a digest cut to its first eight characters, as every reader prints one, ended a
 * simulated round in a bare `ENOENT`. A state that opens as another harness is refused here: one
 * that lost its tool tree when its campaign was moved had two solves paid for under its name.
 */
export async function keptAs(campaign: Keeping, flag: string, asked: string): Promise<Kept> {
  if (asked.startsWith(PROGRAMS_OF)) {
    return await programsOf(campaign, await keptAs(campaign, flag, asked.slice(PROGRAMS_OF.length)));
  }
  const events = read(campaign.log);
  const built = asked === "latest" ? latestBuilt(events) : asked === PROMOTED ? promoted(events) : null;
  if (asked === "starter" || ((asked === "latest" || asked === PROMOTED) && built === null)) {
    return await starter(campaign);
  }
  // A letter the view and the closing report print names one kept digest (`namesOf`); one that
  // names two, as A can, falls through to the refusal with the digests there are (14 October).
  const lettered = [...namesOf(events)].flatMap(([each, letter]) => (letter === asked ? [each] : []));
  const digest = built ?? (lettered.length === 1 ? (lettered[0] ?? asked) : asked);
  const kept = existsSync(campaign.states) ? readdirSync(campaign.states).sort() : [];
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
 * The control for what a harness installed: the Starter Built Harness with that harness's tool
 * tree and nothing else of it, kept under its own digest like any harness. Compared with the
 * starter it reads what the installed programs are worth by themselves, and compared with the
 * harness it was taken from, what the guide and the tools add to them.
 *
 * Buffer's first step, on 9 October, is why. Its harness installed the field's engine, a checker
 * and an optimiser in its guide, and won 5 tasks to 0 at an eight-minute wall, where 2 of the
 * starter's 20 solves had fetched anything; at two hours, that morning, the starter installed the
 * engine itself and was valid on 18 solves of 18. Which part of the harness the step was could not
 * be read from one comparison of the whole.
 */
async function programsOf(campaign: Keeping, source: Kept): Promise<Kept> {
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
  const { awaiting } = poolOf(read(campaign.log));
  if (awaiting.length === 0) return [];
  const packages = campaign.packages();
  const named = awaiting.map((version) => packages.get(version)?.taskId ?? version.slice(0, 8));
  return [
    `${plural(awaiting.length, "held-out task")} ${awaiting.length === 1 ? "has" : "have"} no valid answer on record after two comparisons that cut no solve of ${awaiting.length === 1 ? "it" : "them"} at a limit, and ${awaiting.length === 1 ? "is" : "are"} left out of the scored set until a person has read ${awaiting.length === 1 ? "it" : "them"}: ${named.join(", ")}. A task may be hard, wrongly checked, or have no valid answer at all. Label each with tools/d2/prepare.ts: --keep <task id> returns it to the set, --infeasible <task id> refuses it`,
  ];
}

/**
 * The backends of a Builder's, an Examiner's or a reviewer's session. A Builder keeps the CLI's
 * WebSearch, since it researches the field and its shell reaches the network anyway; an Examiner
 * and a reviewer work from what they are shown, and a search of theirs would be read by nobody,
 * since the trace holds the host's tools alone. A solver's backends are the sweep's as they stand
 * (`solveOnce`), with the search.
 *
 * A Builder's and an Examiner's cache lives an hour, since they wait on practice solves and on the
 * gate: over the recorded turns of 20 October, 8.4% of a Builder's and 5.0% of an Examiner's came
 * more than five minutes after the one before, and five-minute writes would have billed 48% and 28%
 * more. A reviewer's ruling takes minutes, so its cache lives five.
 */
function hostSession(seat: { readonly webSearch: boolean; readonly cacheTtl: "5m" | "1h" }) {
  return (home: string, shutdown: AbortSignal) =>
    backends({ claude: { ...sweepOptions(home, undefined, shutdown).claude, ...seat } });
}

/** An Examiner's backends, for the session that drafts an exam before there is a campaign to
 *  open (`tools/d1b/draft.ts`). */
export const examinerSession = hostSession({ webSearch: false, cacheTtl: "1h" });

/** The plan runs every solve under `caffeinate -s`, so the Mac cannot sleep inside a wall; it exits
 *  with this process, and unreferenced it does not hold this one open. */
export function stayAwake(): void {
  if (runtimeProcess.platform === "darwin") {
    capturedSpawn(["caffeinate", "-s", "-w", String(runtimeProcess.pid)]).unref();
  }
}

/**
 * The project a campaign's opening names (the operator, 12 October): `named`, the campaign
 * command's `--project`, or the one its opening holds where the flag names none. Every campaign
 * belongs to one, as every v1 run joined one, and is named as v1's were. The opening is not written
 * without one, so a campaign opened, or continued from an opening that names none, takes the flag
 * once; one that names another than its record is refused, since a campaign moved between projects
 * would leave both projects' records wrong. The project groups campaigns for the operator
 * (`packages/ui`) and enters no move and no seat.
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
