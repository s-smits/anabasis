/**
 * One round over a campaign: a Builder session from the latest harness the campaign keeps, then the
 * comparison of the harness it left with the reference harness, on held-out tasks.
 *
 *   bun tools/d2/round.ts --root ../anabasis-cycles-4c67fc --sweep veryhard-hb-4c67fc --cycle c01 \
 *     --bundle ../anabasis-cycles-4c67fc/fixture/round4-veryhard-workspace --name truss --session b-1 \
 *     --builder claude/claude-opus-5-5 --tasks <eight task ids> --cap 625
 *
 * That is the plan's first round and its gate G0 (`docs/plan.md`, Phase 0). The Builder forks the
 * Starter Built Harness and builds on it, and the harness it leaves is compared with the starter
 * on the eight tasks named, two solves a harness, under today's limits and a dollar cap. The same
 * comparison shows how the starter does by itself: the report holds, for each harness, on how
 * many tasks it was valid in every solve, in some and in none (`valid`), which the command also
 * prints in words. With no `--reviewer`, every rejection waits for a
 * person's label (`tools/d2/settle.ts`), which is how the first round is read before there is a
 * Judge.
 *
 * The sets are the log's (`prepare.ts`): the released tasks are the Builder's practice. The scored
 * set is the tasks `--tasks` names by id, where the operator chooses them, as the first round has
 * it. Without it the set is `--target` of the held-out tasks, the newest epoch's first and within an
 * epoch drawn by the contract's hash alone.
 * Either way it is fixed before any solve, so that no harness's results choose it
 * (`src/builder/round.ts`, `scoredSet`).
 *
 * The defaults are the plan's (`SIZE`, `src/kernel/size.ts`): 24 scored tasks, four solves a
 * harness, the paired sign-flip test at 0.10, and a stop past three check defects. At those a
 * round's comparison is 192 solves, all of them fresh and side by side; until 12 October it was 12
 * tasks and two solves, 48 solves, and until 2026-10-09 a round was about 430.
 *
 * `--cap` is the round's dollar cap and is required: no solve starts that a reserve for it and for
 * each one running (`--reserve`, $10) would take past it, and the session's spend counts against
 * the same cap. A comparison the cap cuts short reads `not-scored`. On 2026-10-08 eight rounds
 * cost over $220 and scored no task, under no cap.
 *
 * `--reference` names the harness the new one is compared with, and is `promoted`: the campaign's
 * reference harness, which is the starter until the operator promotes another
 * (`tools/d2/promote.ts`) and the one last promoted from then on. Once the reference is no longer
 * the starter, a step is also held to the starter, which is then solved on the tallied tasks.
 * `--parent` names the harness the session starts from, and is `latest`: the one the last whole
 * session left, and the starter while none has. After a comparison without a step the Builder
 * continues from its latest harness, and the operator may send it back to an earlier one.
 *
 * `--reviewer` gives the Builder the Referee on its practice fails, and the
 * comparison the Referee on every rejected answer. A rejection counts only once it is ruled a true
 * fail. One ruled a check defect or unclear, and with no reviewer every one, sets its task aside
 * until a person has labelled it (`tools/d2/settle.ts`). The comparison is read at the one budget
 * its solves were told; until 2026-10-11 `--budget turns=40` read the same solves at shorter
 * budgets as well, which read a solver told the longer one (`docs/simplify.md`, A2).
 *
 * Who solves, what a solve is held to and which tasks are scored are the campaign's setting, which
 * its log records once (`setting.ts`). A round that names none of it runs under the record, and
 * one whose `--solver`, `--solve-minutes`, `--solve-model-turns`, `--tasks` or
 * `--target` name another is refused. The first comparison of a campaign records what it names, with the stored cycle's own
 * solver and the sweep's limits for the rest. `--minutes` and `--turns` are the Builder session's
 * own.
 *
 * Before its first event a round asks whether its comparison may start
 * (`src/builder/admission.ts`): on a checker nobody has read, with too few tasks left to untie, or
 * after the plan's stop rule has stopped the campaign, it starts nothing. `--past-stop "<why>"`
 * goes on past the stop rule, and the reason is logged.
 *
 * Run again with the same `--session`, a round goes on from its log. Its report and the plan's
 * stop rule are printed from the log.
 *
 * A simulation runs this same command with a script in each of its two model seats
 * (`tools/runs/rehearse.ts`), so that what it walks is what a paid round walks.
 *
 * Not run here: see `campaign.ts`.
 */
import type { ThinkingLevel } from "@earendil-works/pi-ai";
import { admitComparison, type Wanted } from "#src/builder/admission.ts";
import { worthLine } from "#src/builder/climb.ts";
import { marginRead, predicted, type Report } from "#src/builder/comparison.ts";
import { refuseTerms, type RoundRequest, round, scoredSet } from "#src/builder/round.ts";
import type { BuildRequest, Practised } from "#src/builder/session.ts";
import { MARGIN, type ObjectiveRule, TRIGGER } from "#src/kernel/compare.ts";
import type { Limits } from "#src/kernel/condition.ts";
import { contractHash } from "#src/kernel/contract.ts";
import { type LogEvent, read } from "#src/kernel/log.ts";
import { priceKey } from "#src/kernel/meter.ts";
import { type Cap, capHolds, patienceOf, poolOf, stopRule } from "#src/kernel/reports.ts";
import { solverLast } from "#src/kernel/solves.ts";
import { readBrief } from "#src/kernel/verify.ts";
import { type TaskPackage, taskSets } from "#src/kernel/task.ts";
import { isString } from "#src/meta/json-shape.ts";
import { parseArgs } from "#src/meta/process.ts";
import { SIZE } from "#src/kernel/size.ts";
import { plural } from "#src/meta/text.ts";
import { median } from "#src/meta/tally.ts";
import { modelNamed } from "../m0/stored-sweep.ts";
import {
  awaitingLines,
  campaignLog,
  PROMOTED,
  starter,
  type Kept,
  keptAs,
  openCampaign,
  packNamed,
  stayAwake,
} from "./campaign.ts";
import {
  type AskedSetting,
  commandSeconds,
  firstRecord,
  keepSetting,
  recordedSetting,
  SETTING_OPTIONS,
  settingAsked,
} from "./setting.ts";

export type Campaign = Awaited<ReturnType<typeof openCampaign>>;

/** The solver's seat: who solves a task under a harness, and for which comparison where one asks. */
interface SolverSeat {
  readonly solve: (
    task: TaskPackage,
    harness: Kept,
    kill: AbortSignal | undefined,
    comparison?: string,
  ) => Promise<Practised>;
  /** The setting those solves record, which names whose solves on record a comparison counts. */
  readonly setting: string;
}

/** A round's two model seats: who solves, and who builds. A comparison with no session takes the
 *  first and never reads the second (`checkpoint.ts`). */
export interface Seats extends SolverSeat {
  readonly builder: Pick<BuildRequest, "model" | "models"> | null;
}

/** Who sits in the seats, once the campaign is open and the comparison's reference harness is
 *  known, by its folder. */
export type Seated = (
  campaign: Campaign,
  given: { readonly builder: string | undefined; readonly reference: string },
) => Seats;

/** The flags of every command that compares, and their defaults: the plan's (`docs/plan.md`,
 *  Tuning). */
export const COMPARISON_OPTIONS = {
  reference: { type: "string", default: PROMOTED },
  tasks: { type: "string" },
  reviewer: { type: "string" },
  "reviewer-effort": { type: "string", default: "high" },
  target: { type: "string" },
  solves: { type: "string", default: String(SIZE.solves) },
  // The step and its repeat read together clear `level`; a first reading at or under `trigger`
  // buys the repeat (`src/kernel/compare.ts`, `readTwice`). 0.20 on each reading alone was the default from
  // #175 until 10 October's two-stage rule, then 0.10, which risks 34.8% over a patience of six; at
  // 0.02 it is 7.6%, under the opening's cap, with 90% power at three in four untied tasks won (the
  // operator, 12 October).
  level: { type: "string", default: "0.02" },
  trigger: { type: "string", default: String(TRIGGER) },
  // Two valid answers are compared by the objective where the check program declares one
  // (`src/kernel/compare.ts`, `ObjectiveRule`), and the better by more than this share of the
  // larger measure wins the pair. It is fixed with the comparison's other terms, and read by no
  // comparison of a check program that declares none. Where no command names it, the last A/A on
  // record sets it from the reference's own spread (`marginRead`), and 0.01 stands before one;
  // until 12 October 0.01 was its default whatever the domain's noise (the overhaul plan's P2).
  margin: { type: "string" },
  defects: { type: "string", default: "3" },
  cap: { type: "string" },
  reserve: { type: "string", default: "10" },
  predict: { type: "string" },
  "past-stop": { type: "string" },
} as const;

/** The flags of a Builder session, in a round or with no comparison after it (`session.ts`), and
 *  their defaults. `--tasks` and `--target` are the campaign's scored set, which a session scores
 *  nothing of: they are the setting's, and the campaign's first command records them. */
export const SESSION_OPTIONS = {
  root: { type: "string" },
  sweep: { type: "string" },
  cycle: { type: "string" },
  bundle: { type: "string" },
  name: { type: "string" },
  session: { type: "string" },
  builder: { type: "string" },
  "builder-effort": { type: "string", default: "high" },
  ...SETTING_OPTIONS,
  tasks: COMPARISON_OPTIONS.tasks,
  target: COMPARISON_OPTIONS.target,
  reviewer: COMPARISON_OPTIONS.reviewer,
  "reviewer-effort": COMPARISON_OPTIONS["reviewer-effort"],
  cap: COMPARISON_OPTIONS.cap,
  reserve: COMPARISON_OPTIONS.reserve,
  "past-stop": COMPARISON_OPTIONS["past-stop"],
  "practice-solves": { type: "string", default: "24" },
  minutes: { type: "string", default: "240" },
  turns: { type: "string", default: "300" },
  parent: { type: "string", default: "latest" },
} as const;

/** A round's flags and their defaults. */
export const ROUND_OPTIONS = { ...SESSION_OPTIONS, ...COMPARISON_OPTIONS } as const;

/** What a Builder session reads of its command's flags, each with its default by then. */
interface SessionFlags {
  readonly session: string;
  readonly parent: string;
  readonly "builder-effort": string;
  readonly minutes: string;
  readonly turns: string;
  readonly "practice-solves": string;
}

/** The campaign's two reviewers, as a command seats them. */
type Reviewers = ReturnType<Campaign["reviewers"]>;
/** A report's tallied task versions and the lists of those it left out (`accounted`). */
type Apart = "versions" | "aside" | "short" | "disputed" | "withdrawn";

// SAFETY: an effort is one of pi's levels, and a backend refuses one it does not serve.
const effortNamed = (flag: string) => flag as ThinkingLevel;

/** A campaign's task by its version, from the pack or a session's proposal. */
export function packaged(campaign: Campaign): (version: string) => TaskPackage {
  const packages = campaign.packages();
  return (version) => {
    const task = packages.get(version);
    if (task === undefined) {
      throw new Error(`task ${version} is in the log and in neither the pack nor a proposal`);
    }
    return task;
  };
}

/** The reviewers `--reviewer` names, or none. */
export function reviewersNamed(
  campaign: Campaign,
  values: { readonly reviewer?: string | undefined; readonly "reviewer-effort": string },
): Reviewers | null {
  const { reviewer } = values;
  if (reviewer === undefined) return null;
  return campaign.reviewers(campaign.reader(modelNamed(reviewer), effortNamed(values["reviewer-effort"])));
}

/** The folder of the harness a session starts from, as `--parent` names it. A session the log
 *  already holds goes on from the harness it started from, whatever a later session has left since. */
export async function parentNamed(
  campaign: Campaign,
  values: Pick<SessionFlags, "session" | "parent">,
): Promise<string> {
  const began = read(campaign.log).find(
    ({ kind, data }) => kind === "build.started" && data.session === values.session,
  )?.data.parent;
  return (await keptAs(campaign, "--parent", isString(began) ? began : values.parent)).dir;
}

/**
 * The Builder session a command's flags name, over the campaign's released tasks and from the
 * harness in `parent`: a round's, or the whole of a command that compares nothing.
 */
export function sessionNamed(
  campaign: Campaign,
  values: SessionFlags,
  given: {
    readonly parent: string;
    readonly reference: string;
    readonly limits: Limits;
    readonly seats: Seats;
    readonly reviewers: Reviewers | null;
  },
): BuildRequest {
  const { limits, seats, reviewers } = given;
  if (seats.builder === null) throw new Error("name --builder");
  const packageOf = packaged(campaign);
  const seconds = Number(values.minutes) * 60;
  return {
    id: values.session,
    parent: given.parent,
    reference: given.reference,
    states: campaign.states,
    memory: campaign.memory,
    tasks: taskSets(read(campaign.log)).released.map((version) => ({ version, task: packageOf(version) })),
    contract: campaign.contract,
    resources: campaign.resources,
    ...seats.builder,
    effort: effortNamed(values["builder-effort"]),
    // The session's own wall and turns, and a command of its own held to that wall and not to a
    // solve's: a Builder builds an engine in one command, whatever a solve's minutes are.
    limits: {
      ...limits,
      wallSeconds: seconds,
      turns: Number(values.turns),
      practiceSolves: Number(values["practice-solves"]),
      ...commandSeconds(seconds),
    },
    solve: limits,
    solver: { model: priceKey(campaign.test.model), effort: campaign.test.effort },
    log: campaign.log,
    repoRoot: campaign.repo,
    otherTrees: campaign.trees,
    packRoots: campaign.packRoots,
    practise: (task, dir, digest, kill) => seats.solve(packageOf(task.version), { dir, digest }, kill),
    ...(reviewers === null
      ? {}
      : {
          referee: (solve, task, kill) => reviewers.referee(solve, packageOf(task.version), kill),
        }),
  };
}

/**
 * The scored set a command's flags name, by task version, and the retained tasks in it: the
 * tasks `--tasks` lists by id, each a task of the pack or of a session, or `--target` of the
 * held-out tasks by the contract's draw (`scoredSet`), which takes a `repeat`'s first stage's
 * tasks and their kin last: a checkpoint names the comparison it may repeat and a round, never a
 * repeat, does not. Whether each is a held-out task is the comparison's to refuse.
 */
export function scoredNamed(
  campaign: Campaign,
  tasks: string | undefined,
  target: number,
  repeat?: Parameters<typeof scoredSet>[3],
): ReturnType<typeof scoredSet> {
  const events = read(campaign.log);
  if (tasks === undefined) return scoredSet(events, target, contractHash(campaign.contract), repeat);
  const packages = [...campaign.packages()];
  const named = tasks.split(",").map((taskId) => {
    const found = packages.find(([, task]) => task.taskId === taskId);
    if (found === undefined) throw new Error(`--tasks ${taskId}: the campaign holds no task of that id`);
    return found[0];
  });
  const { retained } = poolOf(events);
  return { tasks: named, retained: named.filter((task) => retained.includes(task)) };
}

/**
 * What a command's flags ask of a comparison, as its admission takes it (`admitComparison`): the
 * size, the cap, the reason to go on past the stop rule where one is given, and what the setting
 * named here is against the one the log's last test-side solves ran under.
 */
export function wantedNamed(
  campaign: Campaign,
  values: {
    readonly solves: string;
    readonly level: string;
    readonly trigger: string;
    readonly "past-stop"?: string | undefined;
  },
  given: { readonly setting: AskedSetting; readonly cap: Cap | undefined; readonly builds: boolean },
): Wanted {
  const { named, tasks, target } = given.setting;
  // The campaign is open, so who solves is known whether or not a flag named it.
  const solving = solvingAs(campaign, named);
  const ran = solverLast(read(campaign.log));
  return {
    // A comparison that names its tasks scores those, however many the log holds beside them.
    target: tasks === undefined ? target : tasks.split(",").length,
    solves: Number(values.solves),
    level: Number(values.level),
    trigger: Number(values.trigger),
    patience: patienceOf(read(campaign.log)),
    builds: given.builds,
    cap: given.cap ?? null,
    pastStop: predictionNamed(values["past-stop"]),
    unrecorded: firstRecord(given.setting, solving, ran),
  };
}

/** Who an open campaign's test-side solves are by, as a condition names the model, and what they
 *  are held to: what a log's last solves are set against (`firstRecord`). */
export function solvingAs(campaign: Campaign, { limits }: Pick<AskedSetting, "named">["named"]) {
  const { model, effort } = campaign.test;
  return { solver: { model: priceKey(model), effort }, limits };
}

/** The objective comparison `id` of this campaign pairs two valid answers by, where its check
 *  program declares one: the brief's direction and the margin `--margin` names, or else the one the
 *  A/A on record before `id` began set, with what set it (`marginRead`). Undefined otherwise. */
export function objectiveNamed(
  campaign: Pick<Campaign, "checks" | "log">,
  margin: string | undefined,
  id: string,
): ObjectiveRule | undefined {
  const declared = readBrief(campaign.checks).objective;
  if (declared === undefined) return undefined;
  if (margin !== undefined) return { direction: declared.direction, margin: Number(margin) };
  const set = marginRead(read(campaign.log), id);
  return { direction: declared.direction, margin: set?.margin ?? MARGIN, from: set?.pairings ?? null };
}

/** What `--predict` names: the operator's expectation of the comparison, in a sentence, or none. */
export function predictionNamed(flag: string | undefined): string | undefined {
  const said = flag?.trim() ?? "";
  return said === "" ? undefined : said;
}

/** A comparison's prediction beside what it read, as a command prints the two; no line where the
 *  operator predicted nothing. The prediction is the one the comparison began with. */
export function predictionLines(events: readonly LogEvent[], id: string, report: Report): string[] {
  const said = predicted(events, id);
  return said === null ? [] : [`predicted before the first solve: ${said}`, `read: ${report.reading}`];
}

/**
 * The dollars `--cap` and `--reserve` name, read in one place for every command: each is a plain
 * number above nothing. A cap typed as "$40" is no number, and held
 * nothing where it was not checked (`capHolds`).
 */
export function capRead(cap: string, reserve: string): Cap {
  const named = { dollars: Number(cap), reserve: Number(reserve) };
  if (!capHolds(named)) {
    throw new Error(
      `--cap ${cap} --reserve ${reserve}: a cap and its reserve are dollars as plain numbers, each above nothing, as --cap 40 --reserve 10`,
    );
  }
  return named;
}

/**
 * The dollar cap `--cap` and `--reserve` name. A command whose solves are paid for is refused
 * without one (`docs/plan.md`, Phase 0); a simulation, whose seats are scripts, may name none.
 */
export function capNamed(
  values: { readonly cap?: string | undefined; readonly reserve: string },
  seats: "paid" | "scripted",
): Cap | undefined {
  if (values.cap === undefined) {
    if (seats === "scripted") return undefined;
    throw new Error(
      "name --cap, the billed dollars this comparison may hold: no solve starts that would take it past them, and a comparison the cap cuts short reads not-scored",
    );
  }
  return capRead(values.cap, values.reserve);
}

/**
 * A report in lines, printed with every reading: the frontier it was read on, with its untied tasks,
 * the least share of them one reading detects four times in five (`detectable`) and the rule's
 * false rate an attempt beside the level (`falseRate`), and its p with what the test weighs; the
 * reference against itself where the comparison carries it (`aaLines`); the tasks it drew, by what
 * became of each (`accounted`); and `valid`,
 * each harness by itself, as the tasks by how many of their solves were valid, which is what the
 * plan's first gate reads of the starter, the reference harness of the first round (`docs/plan.md`,
 * G0); the objective's margin and what set it, and the one its A/A sets for the next comparison.
 * None for a report that compared nothing.
 */
export function reportLines({
  valid,
  objective,
  frontier,
  noise,
  turns = null,
  worth = null,
  ...apart
}: Pick<Report, "valid" | "objective" | "frontier" | "noise"> &
  Partial<Pick<Report, "turns" | "worth" | Apart>>): string[] {
  if (valid === null) return [];
  // The turns of a valid answer, over the tasks both harnesses answered: reported, in no test.
  const both = Object.values(turns ?? {}).flatMap(({ old, fresh }) =>
    old === null || fresh === null ? [] : [{ old, fresh }],
  );
  const took = (side: "old" | "fresh") => String(median(both.map((each) => each[side])));
  const share = frontier?.detectable ?? null;
  const from = objective?.from;
  const set =
    from === undefined
      ? "as named"
      : from === null
        ? "the default: no A/A on record had measured two valid answers of one task"
        : `the 90th percentile of the reference's own spread over ${plural(from, "A/A pairing")}`;
  const untied = frontier === null ? 0 : frontier.wins + frontier.losses;
  return [
    ...(frontier === null
      ? []
      : [
          `the step is read on ${plural(frontier.tasks.length, "frontier task")}, ${String(untied)} of them untied: one reading at the comparison's level detects four times in five ${share === null ? "no share of them" : `a harness that wins ${String(Math.round(100 * share))}% of them`}`,
          `an attempt at these margins, this reading and a repeat alike, promotes between equal harnesses ${String(Math.round(1000 * frontier.falseRate) / 10)}% of the time: the level is one reading's, and this the rule's`,
          // The test weighs margins, but a sweep's p is its count's alone (the plan's 7.5).
          `its p is ${rounded(frontier.p)}: the test weighs each untied task by its margin in pair wins${frontier.losses === 0 && untied > 0 ? `, and where every untied task is won p is one half to the power of their count whatever the margins: ${String(untied)} won read ${rounded(0.5 ** untied)}` : ""}`,
        ]),
    ...(noise === null ? [] : aaLines(noise)),
    ...accounted(apart),
    `each harness by itself, as how many tasks had ${valid.old.map((_, count) => String(count)).join(", ")} valid answers in ${String(valid.old.length - 1)} solves (a count of tasks a column, not a share):`,
    `  at its limits: reference ${valid.old.join("/")}, new ${valid.fresh.join("/")}`,
    ...(objective === null
      ? []
      : [
          `the objective (${objective.direction} is better, margin ${String(objective.margin)}, ${set}) decided ${plural(objective.decided, "task")} that validity alone would have tied`,
        ]),
    ...(both.length === 0
      ? []
      : [
          `the median turns of a valid answer, over the ${plural(both.length, "task")} both answered: reference ${took("old")}, new ${took("fresh")} (reported, in no test)`,
        ]),
    ...(noise?.margin == null
      ? []
      : [
          `this comparison's A/A sets the objective's margin at ${String(noise.margin.margin)}, over ${plural(noise.margin.pairings, "pairing")} of the reference's valid answers: the next comparison reads by it`,
        ]),
    ...(worth === null ? [] : [worthLine(worth)]),
  ];
}

/** A share, to three places. */
function rounded(share: number): string {
  return String(Math.round(1000 * share) / 1000);
}

/** A share in whole percent. */
function percent(share: number): string {
  return `${String(Math.round(100 * share))}%`;
}

/**
 * The reference against itself beside every reading that carries one (the plan's 7.2): its tie
 * share, its flip rate and the least shift it detects, three readings of the noise with three
 * meanings, each on a line of its own.
 */
function aaLines(noise: NonNullable<Report["noise"]>): string[] {
  const tasks = noise.wins + noise.losses + noise.ties;
  const shift = noise.detectable ?? null;
  return [
    `the reference against itself, on halves of its own solves mirrored in time (the A/A), over the ${plural(tasks, "tallied task")}, ${String(noise.wins + noise.losses)} of them untied:`,
    `  tie share ${tasks === 0 ? "none" : percent(noise.ties / tasks)}: the share of tasks two equal harnesses tied at half the comparison's solves a side, where equal harnesses tie more often than at the comparison's own, so no floor for its ties`,
    `  flip rate ${noise.flips === null ? "none" : percent(noise.flips)}: how often two of its solves of one task disagree on validity`,
    `  least detectable shift: ${shift === null ? "none, too few of its tasks are untied for any shift between its halves to read as a step, so its reading no step shows little" : `one reading of it, two-sided at the level, detects four times in five a half that wins ${percent(shift)} of its untied tasks`}`,
  ];
}

/**
 * The tasks a comparison drew, by what became of them (the plan's 7.3): the tallied ones, which
 * the columns, room and the test are read over, and each kind left out, so that no task left out
 * swells the denominator or leaves the account. None for a report that names no versions.
 */
function accounted({
  versions,
  aside = [],
  short = [],
  disputed = [],
  withdrawn = [],
}: Partial<Pick<Report, Apart>>): string[] {
  if (versions === undefined) return [];
  // A task set aside is counted there and not again among the short: the two can overlap.
  const out: readonly (readonly [readonly string[], string])[] = [
    [aside, "set aside on a rejection not ruled a true fail"],
    [short.filter((task) => !aside.includes(task)), "short of their solves"],
    [disputed, "disputed"],
    [withdrawn, "withdrawn while it ran"],
  ];
  const drew = new Set([...versions, ...aside, ...short, ...disputed, ...withdrawn]).size;
  const left = out.flatMap(([tasks, why]) => (tasks.length === 0 ? [] : [`${String(tasks.length)} ${why}`]));
  return [
    `of the ${plural(drew, "task")} the comparison drew, ${String(versions.length)} ${versions.length === 1 ? "was" : "were"} tallied${left.length === 0 ? "" : ` and ${left.join(", ")}`}: the columns below and room are read over the tallied ones, the test over the frontier among them`,
  ];
}

/** This host's backends in the seats: the campaign's solver, and the Builder `--builder` names
 *  where one is named. */
export const solved: Seated = (campaign, { builder }) => ({
  builder: builder === undefined ? null : { model: modelNamed(builder), models: campaign.builder },
  solve: (task, harness, kill, comparison) =>
    campaign.solveOnce(task, harness, campaign.test, kill, comparison),
  setting: campaign.setting(campaign.test),
});

/** `bun tools/d2/round.ts`, and under a simulation's `seated` the same round with its seats scripted. */
export async function roundCommand(args: readonly string[], seated: Seated = solved): Promise<Report> {
  const { values } = parseArgs({ args: [...args], options: ROUND_OPTIONS });
  const { session } = values;
  const pack = packNamed(values, " and --session");
  const { name } = pack;
  if (session === undefined) throw new Error("name --session, the id the round takes in the log");
  // Read before the campaign is opened: a paid round with no cap starts nothing.
  const cap = capNamed(values, seated === solved ? "paid" : "scripted");
  // The campaign's setting is its log's: what the flags name is held to the record before the
  // campaign is opened under it (`setting.ts`).
  const setting = settingAsked(values, recordedSetting(read(campaignLog(name))));
  const { limits } = setting.named;
  const campaign = await openCampaign({ ...pack, ...setting.named });
  const packageOf = packaged(campaign);
  const reviewers = reviewersNamed(campaign, values);
  const parent = await parentNamed(campaign, { ...values, session });
  const reference = await keptAs(campaign, "--reference", values.reference);
  const seats = seated(campaign, { builder: values.builder, reference: reference.dir });
  const built = sessionNamed(
    campaign,
    { ...values, session },
    { parent, reference: reference.dir, limits, seats, reviewers },
  );
  const request: RoundRequest = {
    session: built,
    reference,
    starter: await starter(campaign),
    ...scoredNamed(campaign, setting.tasks, setting.target),
    solves: Number(values.solves),
    level: Number(values.level),
    trigger: Number(values.trigger),
    objective: objectiveNamed(campaign, values.margin, session),
    defects: Number(values.defects),
    cap,
    prediction: predictionNamed(values.predict),
    concurrency: limits.concurrency,
    solve: (version, harness, comparison, kill) => seats.solve(packageOf(version), harness, kill, comparison),
    setting: seats.setting,
    referee:
      reviewers === null
        ? undefined
        : (solve, version, kill) => reviewers.referee(solve, packageOf(version), kill),
  };
  // Every refusal comes before anything is recorded: the admission's, then the round's own
  // terms, and only then an override of the stop rule and the campaign's setting.
  const notes = admitComparison(campaign.log, {
    id: session,
    reference: values.reference,
    wanted: wantedNamed(campaign, values, { setting, cap, builds: true }),
    seats: seated === solved ? "paid" : "scripted",
    own: () =>
      refuseTerms(request, {
        log: campaign.log,
        id: session,
        practised: new Set(built.tasks.map(({ version }) => version)),
      }),
  });
  for (const note of notes) console.log(`· ${note}`);
  keepSetting(campaign.log, setting);
  stayAwake();
  const report = await round(request);
  console.log(JSON.stringify(report, null, 2));
  console.log(JSON.stringify(stopRule(read(campaign.log)), null, 2));
  for (const line of [
    ...reportLines(report),
    ...predictionLines(read(campaign.log), session, report),
    ...awaitingLines(campaign),
  ]) {
    console.log(line);
  }
  return report;
}

if (import.meta.main) await roundCommand(Bun.argv.slice(2));
