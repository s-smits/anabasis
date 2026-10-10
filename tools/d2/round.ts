/**
 * One round over a campaign: a Builder session from the latest harness the campaign keeps, then the
 * comparison of the harness it left with the reference harness, on held-out tasks.
 *
 *   bun tools/d2/round.ts --root ../anabasis-cycles-4c67fc --sweep veryhard-hb-4c67fc --cycle c01 \
 *     --bundle ../anabasis-cycles-4c67fc/fixture/round4-veryhard-workspace --name truss --session b-1 \
 *     --builder claude/claude-opus-5-5 --tasks <eight task ids> --cap 625 \
 *     --budget turns=40 --budget turns=20
 *
 * That is the plan's first round and its gate G0 (`docs/plan.md`, Phase 0). The Builder forks the
 * Starter Built Harness and builds on it, and the harness it leaves is compared with the starter
 * on the eight tasks named, two solves a harness, under today's limits and a dollar cap. The same
 * comparison shows how the starter does by itself: the report holds, for each harness at the full
 * limit and at each `--budget`, on how many tasks it was valid in every solve, in some and in
 * none (`valid`), which the command also prints in words. The plan continues at the budget where
 * the starter is valid on about half its solves. With no `--reviewer`, every rejection waits for a
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
 * The defaults are the plan's (`docs/plan.md`, Tuning): 12 scored tasks, two solves a harness, the
 * sign test at 0.10, and a stop past three check defects. At those a round's comparison is 48
 * solves, all of them fresh and side by side. Until 2026-10-09 a round was about 430.
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
 * `--reviewer` gives the Builder the Referee and the Diagnoser on its practice fails, and the
 * comparison the Referee on every rejected answer. A rejection counts only once it is ruled a true
 * fail. One ruled a check defect or unclear, and with no reviewer every one, sets its task aside
 * until a person has labelled it (`tools/d2/settle.ts`). `--budget` reads the same solves at a
 * shorter budget as well, as `turns=40,seconds=1800` with either or both of its two units, and may
 * be given more than once; the budgets are fixed with the comparison's other terms before its
 * first solve. The units are the model's `turns` and the `seconds` of the whole attempt
 * (`src/kernel/compare.ts`), which are the two a solver can be told and held to. The CPU seconds
 * of a solve's commands are reported and are no unit: a cut command leaves them unknown.
 *
 * Who solves, what a solve is held to and which tasks are scored are the campaign's setting, which
 * its log records once (`setting.ts`). A round that names none of it runs under the record, and
 * one whose `--solver`, `--solve-minutes`, `--solve-turns`, `--solve-model-turns`, `--tasks` or
 * `--target` name another is refused, unless `--new-setting` says the campaign's setting changes
 * here. The first comparison of a campaign records what it names, with the stored cycle's own
 * solver and the sweep's limits for the rest. `--minutes` and `--turns` are the Builder session's
 * own.
 *
 * Before its first event a round asks whether its comparison may start, as a launch of it does
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
import { predicted, type Report, type Valid } from "#src/builder/comparison.ts";
import { refuseTerms, type RoundRequest, round, scoredSet } from "#src/builder/round.ts";
import type { BuildRequest, Practised } from "#src/builder/session.ts";
import { type Budget, UNITS } from "#src/kernel/compare.ts";
import type { Limits } from "#src/kernel/condition.ts";
import { contractHash } from "#src/kernel/contract.ts";
import { type LogEvent, read } from "#src/kernel/log.ts";
import { priceKey } from "#src/kernel/meter.ts";
import { type Cap, capHolds, stopRule } from "#src/kernel/reports.ts";
import { solverLast } from "#src/kernel/solves.ts";
import { type TaskPackage, taskSets } from "#src/kernel/task.ts";
import { isString } from "#src/meta/json-shape.ts";
import { parseArgs } from "#src/meta/process.ts";
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
  restarts,
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
interface Seats extends SolverSeat {
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
  solves: { type: "string", default: "2" },
  level: { type: "string", default: "0.1" },
  defects: { type: "string", default: "3" },
  budget: { type: "string", multiple: true },
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

/** A round's flags and their defaults. A launch reads the same ones (`tools/runs/launch.ts`), so
 *  what it says a round can read is said of the round that would start. */
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
    log: campaign.log,
    repoRoot: campaign.repo,
    otherTrees: campaign.trees,
    practise: (task, dir, digest, kill) => seats.solve(packageOf(task.version), { dir, digest }, kill),
    ...(reviewers === null
      ? {}
      : {
          referee: (solve, task, kill) => reviewers.referee(solve, packageOf(task.version), kill),
          diagnose: (solve, task, kill) => reviewers.diagnose(solve, packageOf(task.version), kill),
        }),
  };
}

/**
 * The scored set a command's flags name, by task version: the tasks `--tasks` lists by id, each a
 * task of the pack or of a session, or `--target` of the held-out tasks by the contract's draw
 * (`scoredSet`). Whether each is a held-out task is the comparison's to refuse.
 */
export function scoredNamed(campaign: Campaign, tasks: string | undefined, target: number): string[] {
  if (tasks === undefined) return scoredSet(read(campaign.log), target, contractHash(campaign.contract));
  const packages = [...campaign.packages()];
  return tasks.split(",").map((taskId) => {
    const found = packages.find(([, task]) => task.taskId === taskId);
    if (found === undefined) throw new Error(`--tasks ${taskId}: the campaign holds no task of that id`);
    return found[0];
  });
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
    builds: given.builds,
    cap: given.cap ?? null,
    restarted: restarts(solving, ran),
    pastStop: predictionNamed(values["past-stop"]),
    unrecorded: firstRecord(given.setting, solving, ran),
  };
}

/** Who an open campaign's test-side solves are by, as a condition names the model, and what they
 *  are held to: what a log's last solves are set against (`restarts`, `firstRecord`). */
export function solvingAs(campaign: Campaign, { limits }: Pick<AskedSetting, "named">["named"]) {
  const { model, effort } = campaign.test;
  return { solver: { model: priceKey(model), effort }, limits };
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

/** The budgets `--budget` names, each as `turns=40,seconds=1800` with either or both units. */
export function budgetsNamed(flags: readonly string[] = []): Budget[] {
  return flags.map((flag): Budget => {
    const named = flag.split(",").map((part) => {
      const [unit = "", most, ...more] = part.split("=");
      return { unit, most: more.length === 0 ? Number(most) : Number.NaN };
    });
    if (named.some(({ unit, most }) => !UNITS.some((known) => known === unit) || !(most > 0))) {
      throw new Error(
        `--budget ${flag}: a budget names turns or seconds, each with a number above nothing, as turns=40,seconds=1800. The prompts a solver was given and the CPU seconds of its commands are units no longer: the first read what the full limit read, and the second is unknown once a command is cut`,
      );
    }
    const budget: Record<string, number> = Object.fromEntries(named.map(({ unit, most }) => [unit, most]));
    return budget;
  });
}

/**
 * The dollars `--cap` and `--reserve` name, read in one place for every command and for the
 * launcher: each is a plain number above nothing. A cap typed as "$40" is no number, and held
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
 * A report's `valid` in lines: each harness by itself, at the full limit and at each budget, as
 * the tasks by how many of their solves were valid. It is what the plan's first gate reads of the
 * starter, which is the reference harness of the first round (`docs/plan.md`, G0). None for a
 * report that compared nothing.
 */
export function validLines({ valid, budgets }: Pick<Report, "valid" | "budgets">): string[] {
  if (valid === null) return [];
  const row = (at: string, each: Valid) =>
    `  ${at}: reference ${each.old.join("/")}, new ${each.fresh.join("/")}`;
  const named = (budget: Budget) =>
    UNITS.flatMap((unit) => (budget[unit] === undefined ? [] : [`${unit}=${String(budget[unit])}`])).join(
      ",",
    );
  return [
    `each harness by itself, as how many tasks had ${valid.old.map((_, count) => String(count)).join(", ")} valid answers in ${String(valid.old.length - 1)} solves (a count of tasks a column, not a share):`,
    row("at its limits", valid),
    ...budgets.flatMap((budget) =>
      budget.valid === undefined ? [] : [row(`at ${named(budget)}`, budget.valid)],
    ),
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
  const budgets = budgetsNamed(values.budget);
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
  const built = sessionNamed(campaign, { ...values, session }, { parent, limits, seats, reviewers });
  const request: RoundRequest = {
    session: built,
    reference,
    starter: await starter(campaign),
    tasks: scoredNamed(campaign, setting.tasks, setting.target),
    solves: Number(values.solves),
    level: Number(values.level),
    defects: Number(values.defects),
    budgets,
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
    ...validLines(report),
    ...predictionLines(read(campaign.log), session, report),
    ...awaitingLines(campaign),
  ]) {
    console.log(line);
  }
  return report;
}

if (import.meta.main) await roundCommand(Bun.argv.slice(2));
