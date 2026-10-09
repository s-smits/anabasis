/**
 * A campaign: one log, one staged check program and one folder of harness states under
 * `.ana/d2/<name>`, over a stored sweep's pack. It is what the commands share, so that each builds
 * its conditions, its solves and its reviewers the same way:
 *
 *   bun tools/c/accept.ts      ... --name <name> [--freeze]          what the check program has been seen to do; the operator's word that it stands
 *   bun tools/d2/prepare.ts    ... --name <name>                     the pack's tasks, held out; the practice tasks, released; the scored tasks, confirmed
 *   bun tools/d2/round.ts      ... --name <name> --session b-1       a Builder session and its comparison
 *   bun tools/d2/settle.ts     ... --name <name> --session b-1       a comparison's rejections, labelled by a person
 *   bun tools/d2/checkpoint.ts ... --name <name> --id g2             one comparison of two kept harnesses
 *   bun tools/d1b/examine.ts   ... --name <name> --session x-1       an Examiner session, which writes further tasks
 *
 * The campaign folder is inside the repository, which every solve's and every Builder's wall denies,
 * as `live-solve.ts` keeps its check program: the log holds hidden values and the checks' verdicts.
 *
 * What is stood in for is what `live-solve.ts` stands in: the contract is the check program's brief
 * with the answer format the sweep's record tool took, and the limits are the sweep's `config.yaml`
 * with a disk cap. The test condition's model and effort are the stored cycle's. The cycle's own
 * harness is not used: it comes from v1's runs, and a campaign starts from the Starter Built
 * Harness, which is also its first reference harness (`src/solve/starter.ts`, `docs/plan.md`,
 * Phase 0). Until 2026-10-09 the stored harness was both.
 *
 * It first ran against a model on 8 October, in a round with a Claude Builder (issue #1). It needs
 * the Mac's command wall, the pack and the sweep on disk, and a model login.
 */
import type { Api, Model, Models, ThinkingLevel } from "@earendil-works/pi-ai";
import { backends, compactionMode } from "#src/backends/models.ts";
import { type Practised, practised } from "#src/builder/session.ts";
import { departure } from "#src/kernel/acceptance.ts";
import {
  type Condition,
  type Limits,
  recordCondition,
  type Setting,
  settingId,
} from "#src/kernel/condition.ts";
import { contractHash } from "#src/kernel/contract.ts";
import { writtenTasks } from "#src/kernel/history.ts";
import { read } from "#src/kernel/log.ts";
import { freezePrices, priceKey } from "#src/kernel/meter.ts";
import { awaitingLabel, latestBuilt } from "#src/kernel/reports.ts";
import { type TaskPackage, taskVersion } from "#src/kernel/task.ts";
import { checkProgramVersion, openVerifier, type Task } from "#src/kernel/verify.ts";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from "#src/meta/filesystem.ts";
import { parseJsonAs } from "#src/meta/json-runtime.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { tmpdir } from "#src/meta/os.ts";
import { plural } from "#src/meta/text.ts";
import { join, resolve } from "#src/meta/path.ts";
import { capturedSpawn, runtimeProcess } from "#src/meta/process.ts";
import { hashJsonValue } from "#src/meta/stable-json.ts";
import { diagnose } from "#src/review/diagnoser.ts";
import type { Reader } from "#src/review/reader.ts";
import { referee } from "#src/review/referee.ts";
import { writeStarter } from "#src/solve/starter.ts";
import { openHarness, treeContent } from "#src/solve/harness.ts";
import { HOST_SOLVE_ISOLATION_PROFILE_ID } from "#src/verify/solve-sandbox.ts";
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

export interface CampaignArgs {
  readonly root: string;
  readonly sweep: string;
  /** The cycle whose model and effort the test condition takes. */
  readonly cycle: string;
  readonly bundle: string;
  readonly name: string;
  /** The model and effort that solve in the cycle's place, when not its own: a command's `--solver`
   *  and `--solver-effort` (`setting.ts`). */
  readonly solver?: { readonly model: string; readonly effort: ThinkingLevel } | undefined;
  /** What every solve of this command is held to, when not `LIMITS`: a command's `--solve-minutes`
   *  and `--solve-turns` (`setting.ts`). */
  readonly limits?: Limits | undefined;
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
  /** The backends of a solver this host's do not serve: a simulation's script (`tools/runs/rehearse.ts`). */
  readonly models?: (home: string) => Models;
}

/** What names the control of a kept harness: `programs-of:latest`, `programs-of:<digest>`. */
const PROGRAMS_OF = "programs-of:";

/** The sweep's `config.yaml` and its solves' `maxTurns`, with a disk cap the sweep did not have, as
 *  `live-solve.ts` has them, but four solves at a time where a parity solve runs alone. Concurrency
 *  is part of a condition, so a campaign's solves and a parity solve are not under the same one.
 *  These are a campaign's limits until a command names a longer wall or more turns (`setting.ts`). */
export const LIMITS: Limits = {
  wallSeconds: 7200,
  turns: 24,
  shellDefaultSeconds: 300,
  shellMaxSeconds: 900,
  concurrency: 4,
  diskBytes: 2 * 1024 ** 3,
};
const REPO = resolve(import.meta.dir, "..", "..");
/** The agent runtime's packages, pinned in `package.json`; the SDK pins the Claude Code binary. */
const RUNTIME = ["@anthropic-ai/claude-agent-sdk", "@earendil-works/pi-agent-core", "@earendil-works/pi-ai"];

export async function openCampaign(args: CampaignArgs) {
  const dir = join(REPO, ".ana", "d2", args.name);
  mkdirSync(dir, { recursive: true });
  const checks = join(dir, "checks");
  if (!existsSync(checks)) checkProgram(args.bundle, checks);
  const log = join(dir, "log.jsonl");
  const { brief, tasks } = readPack(args.bundle);
  const row = sweepRows(args.root, args.sweep).find((each) => each.cycle === args.cycle);
  if (row === undefined) throw new Error(`${args.sweep} graded no solve in ${args.cycle}`);
  const runtime = storedRuntime(row);
  const contract = contractOf(brief, recordedAnswerFormat(row));
  // The checker this campaign runs under: its contract and its staged check program. Once the
  // operator has frozen one in the log (`tools/c/accept.ts --freeze`), a campaign whose own is
  // another does not open, since what the log counted was counted under the frozen one.
  const checker = { contract: contractHash(contract), checks: hashJsonValue(checkProgramVersion(checks)) };
  const moved = departure(read(log), checker);
  if (moved !== null) throw new Error(`${log}: ${moved}`);
  const resources = sweepResources(brief);
  const tools = join(args.bundle, ".toolchain");
  const verify = openVerifier({ checks, tools });
  const pins = parseJsonAs<{ dependencies: Record<string, string> }>(
    readFileSync(join(REPO, "package.json"), "utf8"),
  ).dependencies;
  // Read once: each is a walk of a tree of thousands of files, and neither moves inside a run.
  const verifierTools = hashJsonValue(treeContent(tools));
  const host = hashJsonValue(["src", "vendor"].map((part) => treeContent(join(REPO, part))));
  const limits = args.limits ?? LIMITS;
  const pack = (task: Task): TaskPackage => packageOf(checks, task);
  /** Every task the pack holds or a session wrote into the log, by version. */
  const packages = (): Map<string, TaskPackage> =>
    new Map([...tasks, ...writtenTasks(read(log))].map((task) => [taskVersion(pack(task)), pack(task)]));
  /** What every solve by `by` runs under whatever its task and harness: its condition less those. */
  const settingOf = (by: Solver): Setting => ({
    contract: contractHash(contract),
    model: priceKey(by.model),
    effort: by.effort,
    prices: freezePrices([by.model]),
    runtime: Object.fromEntries(RUNTIME.map((name) => [name, pins[name] ?? "unpinned"])),
    compaction: compactionMode(by.model, sweepOptions()),
    verifierTools,
    sandbox: hashJsonValue({
      profile: HOST_SOLVE_ISOLATION_PROFILE_ID,
      platform: runtimeProcess.platform,
      diskBytes: limits.diskBytes,
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
  let solves = 0;
  /** One live solve of a task under a harness, by a solver, its condition recorded first. A solve
   *  made for a comparison names it, and is counted by that comparison alone. */
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
      condition: recordCondition(log, conditionOf(task, harness, by)),
      task,
      contract,
      harness: harness.dir,
      resources,
      model: by.model,
      effort: by.effort,
      limits,
      models: by.models ?? ((home) => backends(sweepOptions(home))),
      verify,
      log,
      repoRoot: REPO,
      ...keyIfDefined("kill", kill),
      ...keyIfDefined("comparison", comparison),
    });
  };
  /** The two reviewers on one reader. */
  const reviewers = (reader: Reader) => ({
    referee: (solve: string, task: TaskPackage, kill: AbortSignal) =>
      referee({ ...reader, kill }, { solve, task, contract, checks, verify, log }),
    diagnose: (solve: string, task: TaskPackage, kill: AbortSignal) =>
      diagnose({ ...reader, kill }, { solve, task, contract, log }),
  });
  return {
    repo: REPO,
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
    test: {
      ...(args.solver === undefined
        ? { model: rowModel(row), effort: runtime.modelWorker.modelSelection.effort }
        : { model: modelNamed(args.solver.model), effort: args.solver.effort }),
      side: "test",
    } as const,
    verify,
    pack,
    packages,
    solveOnce,
    /** What `solveOnce` records a solve under, for a reader that sets a log beside this command's
     *  flags without a solve of its own. */
    conditionOf,
    /** The setting of every solve by `by`, as an id: what a comparison counts solves under
     *  (`src/kernel/compare.ts`). */
    setting: (by: Solver) => settingId(settingOf(by)),
    reviewers,
    reader: (model: Model<Api>, effort: ThinkingLevel): Reader => ({
      model,
      effort,
      models: hostSession({ webSearch: false }),
    }),
    builder: hostSession({ webSearch: true }),
    examiner: hostSession({ webSearch: false }),
  };
}

/**
 * The Starter Built Harness, as a solve and a Builder session are handed it
 * (`src/solve/starter.ts`): written once and kept under its digest among the campaign's states,
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
 * operator promotes another; `latest` for the one the last whole Builder session left, which is
 * the starter while none has; or the whole digest of one a session froze, which is the name of its
 * folder under the campaign's `states/`. `programs-of:` before any of those names its control, the
 * starter with that harness's installed programs alone (`programsOf`). Any other name is answered with the ones there are: on
 * 2026-10-08 a digest cut to its first eight characters, as every reader prints one, ended a
 * simulated round in a bare `ENOENT`. A state that opens as another harness is refused here: one
 * that lost its tool tree when its campaign was moved had two solves paid for under its name.
 */
export async function keptAs(campaign: Keeping, flag: string, asked: string): Promise<Kept> {
  if (asked.startsWith(PROGRAMS_OF)) {
    return await programsOf(campaign, await keptAs(campaign, flag, asked.slice(PROGRAMS_OF.length)));
  }
  const built = asked === "latest" ? latestBuilt(read(campaign.log)) : null;
  if (asked === "starter" || (asked === "latest" && built === null)) return await starter(campaign);
  const digest = built ?? asked;
  const kept = existsSync(campaign.states) ? readdirSync(campaign.states).sort() : [];
  if (!kept.includes(digest)) {
    const begun = kept.filter((each) => digest !== "" && each.startsWith(digest));
    const named =
      "It also takes starter, for the harness every campaign starts from, and latest, for the last a session left";
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
 * The held-out tasks a person has to read before they are scored again, in lines: the ones no
 * harness answered validly in two comparisons in a row (`awaitingLabel`). They are left out of the
 * scored set until labelled. A command that compares prints them after its report, and
 * `prepare.ts` before one, which is also where they are labelled. None when there is none.
 */
export function awaitingLines(campaign: {
  readonly log: string;
  readonly packages: () => Map<string, TaskPackage>;
}): string[] {
  const awaiting = awaitingLabel(read(campaign.log));
  if (awaiting.length === 0) return [];
  const packages = campaign.packages();
  const named = awaiting.map((version) => packages.get(version)?.taskId ?? version.slice(0, 8));
  return [
    `${plural(awaiting.length, "held-out task")} had no valid answer under either harness in two comparisons in a row, and ${awaiting.length === 1 ? "is" : "are"} left out of the scored set until a person has read ${awaiting.length === 1 ? "it" : "them"}: ${named.join(", ")}. A task may be hard, wrongly checked, or have no valid answer at all. Label each with tools/d2/prepare.ts: --keep <task id> returns it to the set, --infeasible <task id> refuses it`,
  ];
}

/**
 * The backends of a Builder's, an Examiner's or a reviewer's session. A Builder keeps the CLI's
 * WebSearch, since it researches the field and its shell reaches the network anyway; an Examiner
 * and a reviewer work from what they are shown, and a search of theirs would be read by nobody,
 * since the trace holds the host's tools alone. A solver's backends are the sweep's as they stand
 * (`solveOnce`), with the search.
 */
function hostSession(search: { readonly webSearch: boolean }) {
  return (home: string) => backends({ claude: { ...sweepOptions(home).claude, ...search } });
}

/** The plan runs every solve under `caffeinate -s`, so the Mac cannot sleep inside a wall; it exits
 *  with this process, and unreferenced it does not hold this one open. */
export function stayAwake(): void {
  if (runtimeProcess.platform === "darwin") {
    capturedSpawn(["caffeinate", "-s", "-w", String(runtimeProcess.pid)]).unref();
  }
}
