/**
 * A campaign: one log, one staged check program and one folder of harness states under
 * `.ana/d2/<name>`, over a stored sweep's pack. It is what the D1b and D2 commands share, so that
 * each builds its conditions, its solves and its reviewers the same way:
 *
 *   bun tools/c/accept.ts      ... --name <name> [--freeze]                     what the checker has been seen to do; the operator's word that it stands
 *   bun tools/m1/admit-sweep.ts ... --log .ana/d2/<name>/log.jsonl --feasible   the pack's tasks, gates 1 to 4
 *   bun tools/d1b/examine.ts   ... --name <name> --session x-1                  an Examiner session
 *   bun tools/d2/prepare.ts    ... --name <name>                                the anchor's draw, the releases
 *   bun tools/d2/round.ts      ... --name <name> --session b-1                  a Builder session and its comparison
 *
 * The campaign folder is inside the repository, which every solve's and every Builder's wall denies,
 * as `live-solve.ts` keeps its check program: the log holds hidden values and the checks' verdicts.
 *
 * What is stood in for is what `admit-sweep.ts` and `live-solve.ts` stand in: the contract is the
 * check program's brief with the answer format the sweep's record tool took, and the limits are the sweep's `config.yaml` with a disk cap. The
 * test condition's model and effort are the stored cycle's, and its harness state is the cycle's
 * `hb-bundles` folder, which is the harness a round's session starts from.
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
  conditionsOf,
  type Limits,
  recordCondition,
  type Setting,
  settingId,
} from "#src/kernel/condition.ts";
import { contractHash } from "#src/kernel/contract.ts";
import { frontierOf, type Rule, type Stand } from "#src/kernel/ladder.ts";
import { type LogEvent, read } from "#src/kernel/log.ts";
import { freezePrices, priceKey } from "#src/kernel/meter.ts";
import { type RejectControl, type TaskPackage, taskSets, taskStates, taskVersion } from "#src/kernel/task.ts";
import { checkProgramVersion, openVerifier, type Task } from "#src/kernel/verify.ts";
import { existsSync, mkdirSync, readFileSync } from "#src/meta/filesystem.ts";
import { parseJsonAs } from "#src/meta/json-runtime.ts";
import { asRecord, isString, type JsonValue } from "#src/meta/json-shape.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { join, resolve } from "#src/meta/path.ts";
import { capturedSpawn, runtimeProcess } from "#src/meta/process.ts";
import { hashJsonValue } from "#src/meta/stable-json.ts";
import { diagnose } from "#src/review/diagnoser.ts";
import type { Reader } from "#src/review/reader.ts";
import { referee } from "#src/review/referee.ts";
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
  /** The cycle whose harness state, model and effort the test condition takes. */
  readonly cycle: string;
  readonly bundle: string;
  readonly name: string;
  /** The model and effort that solve in the cycle's place, when not its own. */
  readonly solver?: { readonly model: string; readonly effort: ThinkingLevel } | undefined;
}

/** A harness as a solve is handed it. */
export interface Kept {
  readonly dir: string;
  readonly digest: string;
}

/** Who solves: the model and effort, and which side of the pair it stands on. */
interface Solver {
  readonly model: Model<Api>;
  readonly effort: ThinkingLevel;
  readonly side: Condition["side"];
  /** The backends of a solver this host's do not serve: a simulation's script (`tools/runs/rehearse.ts`). */
  readonly models?: (home: string) => Models;
}

/** The sweep's `config.yaml` and its solves' `maxTurns`, with a disk cap the sweep did not have, as
 *  `live-solve.ts` has them, but four solves at a time where a parity solve runs alone. Concurrency
 *  is part of a condition, so a campaign's solves and a parity solve are not under the same one. */
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

/**
 * Gate 5's rule as every command of a campaign takes it: the solves of a task under a harness that
 * are read, and the fails among them that keep it (the plan's decision 26). A round screens by it,
 * an Examiner session's word is read by it, and `prepare.ts` places tasks by it, so the three are
 * declared once and cannot drift apart.
 */
export const SCREENING_OPTIONS = {
  screen: { type: "string", default: "3" },
  fails: { type: "string", default: "2" },
} as const;

/** The rule those two flags name. */
export function screeningRule(values: { readonly screen: string; readonly fails: string }): Rule {
  return { solves: Number(values.screen), fails: Number(values.fails) };
}

/** The task sets a log holds: the feasible versions, and among them the anchor's, the released, the
 *  ones still held outside the anchor (`candidates`) and the ones a round admitted. The last two
 *  together are the live pool, which every round screens again under its own two harnesses
 *  (`src/builder/round.ts`). */
export function setsOf(events: readonly LogEvent[]) {
  const { states, feasible, anchor } = taskSets(events);
  const inState = (state: string) => [...feasible].filter((version) => states.get(version) === state);
  return {
    feasible: [...feasible],
    // A disputed anchor task is in no comparison and is an anchor task still: a round counts its
    // check defects outside the anchor, and must know this one was inside.
    anchor: [...anchor].filter((version) => ["held", "disputed"].includes(states.get(version) ?? "")),
    released: inState("released"),
    admitted: inState("admitted"),
    candidates: inState("held").filter((version) => !anchor.has(version)),
  };
}

/** The tasks a log's sessions wrote, each whole in its proposal: an Examiner's instances, which no
 *  pack holds. */
export function writtenTasks(events: readonly LogEvent[]): Task[] {
  return events.flatMap(({ kind, data }) => {
    const task = asRecord(kind === "task.proposed" ? data.task : null);
    return task !== null && isString(task.taskId) && isString(task.family)
      ? [
          {
            taskId: task.taskId,
            family: task.family,
            publicInput: task.publicInput ?? null,
            hidden: task.hidden ?? null,
          },
        ]
      : [];
  });
}

/** A task a session wrote that stood feasible in its log, with what gates it again under another
 *  checker and no solve: the answer its stronger solve was accepted on, and its controls. */
export interface Carriable {
  readonly task: Task;
  /** The stronger solve that passed gate 2, as the log names it. */
  readonly solve: string;
  readonly accepted: JsonValue;
  readonly controls: readonly RejectControl[];
}

/**
 * What a log holds of its sessions' tasks for a campaign under a repaired checker. `feasible` are
 * the tasks that passed gate 4 with their controls on record. `recovered` are the tasks gate 2
 * closed as too hard on an answer a check refused: a repair may accept that answer, and the task
 * then lacks only its controls. A task whose controls were written before a log held them whole
 * (`examiner/session.ts`) is counted in `bare`, and takes a session to write them again.
 *
 * `waiting` are the tasks past gate 3 that gate 4 never saw: their session ended before its
 * Examiner wrote controls. The next session of the same campaign takes them up (`examine.ts`), since
 * each has cost a stronger solve. On 2026-10-08 the provider's session limit ended a session one
 * turn after such a solve passed, 15 minutes and $3.15 in.
 */
export function carriable(events: readonly LogEvent[]) {
  const written = new Map(writtenTasks(events).map((task) => [task.taskId, task]));
  const answerOf = (solve: JsonValue | undefined) =>
    events.findLast(({ kind, data }) => kind === "verdict" && data.solve === solve)?.data.answer;
  const gate = (version: JsonValue | undefined, number: number) =>
    events.findLast(
      ({ kind, data }) => kind === "task.gate" && data.version === version && data.gate === number,
    )?.data;
  const feasible: Carriable[] = [];
  const recovered: Omit<Carriable, "controls">[] = [];
  const waiting: Omit<Carriable, "controls">[] = [];
  let bare = 0;
  for (const { kind, data } of events) {
    const task = kind === "task.proposed" && isString(data.taskId) ? written.get(data.taskId) : undefined;
    if (task === undefined) continue;
    const second = gate(data.version, 2);
    const accepted = answerOf(second?.solve);
    if (!isString(second?.solve) || accepted === undefined) continue;
    const witness = { task, solve: second.solve, accepted };
    const fourth = gate(data.version, 4);
    if (second.outcome === "too-hard" && second.kind === "rejected") recovered.push(witness);
    else if (fourth?.outcome === "passed" && Array.isArray(fourth.set)) {
      feasible.push({ ...witness, controls: fourth.set.flatMap(controlOf) });
    } else if (fourth?.outcome === "passed") bare += 1;
    else if (fourth === undefined && gate(data.version, 3)?.outcome === "passed") waiting.push(witness);
  }
  return { feasible, recovered, waiting, bare };
}

/**
 * The reach tasks an Examiner session puts to the stronger solver again: the tasks a session wrote
 * that wait in `too-hard`, whose last stronger solve ran elsewhere than where the stronger solver
 * stands now. So a task is tried again when the harness has moved, and also when the stronger
 * solver itself is another model or runs at another effort, which is the other way a witness
 * grows. One that solve already failed where the solver stands is not paid for twice.
 */
export function reachOf(events: readonly LogEvent[], stand: Stand): Task[] {
  const states = taskStates(events);
  const conditions = conditionsOf(events);
  /** The solves that ran where the stronger solver stands now. */
  const here = new Set(
    events.flatMap(({ kind, data }) => {
      const ran = conditions.get(isString(data.condition) ? data.condition : "");
      return kind === "solve.started" &&
        isString(data.solve) &&
        ran?.harness === stand.harness &&
        settingId(ran) === stand.setting
        ? [data.solve]
        : [];
    }),
  );
  const written = new Map(writtenTasks(events).map((task) => [task.taskId, task]));
  return events.flatMap(({ kind, data }) => {
    const task = kind === "task.proposed" && isString(data.taskId) ? written.get(data.taskId) : undefined;
    if (task === undefined || !isString(data.version) || states.get(data.version) !== "too-hard") return [];
    const last = events.findLast(
      (event) => event.kind === "task.gate" && event.data.version === data.version && event.data.gate === 2,
    )?.data.solve;
    return isString(last) && here.has(last) ? [] : [task];
  });
}

/** A control as gate 4 logged it, or none where the row is not one. */
function controlOf(row: JsonValue): RejectControl[] {
  const control = asRecord(row);
  return control?.answer !== undefined && isString(control.expectedCheckId)
    ? [{ answer: control.answer, expectedCheckId: control.expectedCheckId }]
    : [];
}

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
      diskBytes: LIMITS.diskBytes,
    }),
    limits: LIMITS,
    host,
    side: by.side,
  });
  let solves = 0;
  /** One live solve of a task under a harness, by a solver, its condition recorded first. */
  const solveOnce = (
    task: TaskPackage,
    harness: Kept,
    by: Solver,
    kill: AbortSignal | undefined,
  ): Promise<Practised> => {
    const condition: Condition = {
      ...settingOf(by),
      harness: harness.digest,
      task: taskVersion(task),
      solverTools: harness.digest,
    };
    solves += 1;
    return practised({
      // No two solves of a campaign share an id, whichever process made them.
      id: `${args.name}-${Date.now().toString(36)}-${String(solves)}`,
      condition: recordCondition(log, condition),
      task,
      contract,
      harness: harness.dir,
      resources,
      model: by.model,
      effort: by.effort,
      limits: LIMITS,
      models: by.models ?? ((home) => backends(sweepOptions(home))),
      verify,
      log,
      repoRoot: REPO,
      ...keyIfDefined("kill", kill),
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
    checks,
    brief,
    tasks,
    contract,
    checker,
    resources,
    parent: join(args.root, "hb-bundles", `${args.sweep}-${args.cycle}`),
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
    /** The setting of every solve by `by`, as an id: with a harness's digest, where it stands
     *  (`src/kernel/ladder.ts`). */
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
 * The harness a campaign stands on, as a solve is handed it: the one its last step left, kept under
 * its digest among the campaign's states, or the stored cycle's while no round has stepped. It is
 * where a round's session starts, and the harness an Examiner session's witness and test solves
 * run under, so that what is feasible and what is too easy are read against where the campaign is
 * and not where it began (`src/kernel/ladder.ts`).
 */
export async function frontier(campaign: {
  readonly log: string;
  readonly states: string;
  readonly parent: string;
}): Promise<Kept> {
  const stepped = frontierOf(read(campaign.log));
  const dir = stepped === null ? campaign.parent : join(campaign.states, stepped);
  return { dir, digest: (await openHarness(dir)).digest };
}

/**
 * The backends of a session whose tools are all this host's: a Builder, an Examiner or a reviewer.
 * It is sent its own prompt without Claude Code's before it, which only a solver reads, as the
 * sweep's did. A Builder keeps the CLI's WebSearch, since it researches the field and its shell
 * reaches the network anyway; an Examiner and a reviewer work from what they are shown, and a
 * search of theirs would be read by nobody, since the trace holds the host's tools alone.
 */
function hostSession(search: { readonly webSearch: boolean }) {
  return (home: string) => backends({ claude: { ...sweepOptions(home).claude, preset: false, ...search } });
}

/** The plan runs every solve under `caffeinate -s`, so the Mac cannot sleep inside a wall; it exits
 *  with this process, and unreferenced it does not hold this one open. */
export function stayAwake(): void {
  if (runtimeProcess.platform === "darwin") {
    capturedSpawn(["caffeinate", "-s", "-w", String(runtimeProcess.pid)]).unref();
  }
}
