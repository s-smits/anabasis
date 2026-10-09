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
 * it. Without it the set is `--target` of the held-out tasks, drawn by the contract's hash alone.
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
 * `--reference` names the harness the new one is compared with: `starter`, until the operator
 * promotes another by naming its digest (`campaign.ts`, `keptAs`). Once the reference is no longer
 * the starter, a step is also held to the starter, which is then solved on the tallied tasks.
 * `--parent` names the harness the session starts from, and is `latest`: the one the last whole
 * session left, and the starter while none has. After a comparison without a step the Builder
 * continues from its latest harness, and the operator may send it back to an earlier one.
 *
 * `--reviewer` gives the Builder the Referee and the Diagnoser on its practice fails, and the
 * comparison the Referee on every rejected answer. A rejection counts only once it is ruled a true
 * fail. One ruled a check defect or unclear, and with no reviewer every one, sets its task aside
 * until a person has labelled it (`tools/d2/settle.ts`). `--budget` reads the same solves at a
 * shorter budget as well, as `turns=40,cpu=600` with any of four units, and may be given more than
 * once; the budgets are fixed with the comparison's other terms before its first solve. The units
 * are the model's `turns`, the `prompts` the solver was given, which is what `--solve-turns`
 * limits, the `cpu` seconds of its commands and the `seconds` of the whole attempt
 * (`src/kernel/compare.ts`). A budget in `prompts` has read nothing so far: every solve of the
 * first three rounds was given one prompt (2026-10-09), so name one in `turns`, `cpu` or `seconds`.
 *
 * Every solve is the cycle's own model at its effort, unless `--solver` and `--solver-effort` name
 * another to solve in its place. Every solve is held to the sweep's wall and turns, unless
 * `--solve-minutes` and `--solve-turns` name others. The four are the campaign's, and every
 * command that solves takes them from one owner (`setting.ts`). `--minutes` and `--turns` are the
 * Builder session's own.
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
import { type Cap, type Report, round, scoredSet, type Valid } from "#src/builder/round.ts";
import type { BuildRequest, Practised } from "#src/builder/session.ts";
import { type Budget, UNITS } from "#src/kernel/compare.ts";
import { contractHash } from "#src/kernel/contract.ts";
import { read } from "#src/kernel/log.ts";
import { stopRule } from "#src/kernel/reports.ts";
import { type TaskPackage, taskSets } from "#src/kernel/task.ts";
import { isString } from "#src/meta/json-shape.ts";
import { parseArgs } from "#src/meta/process.ts";
import { plural } from "#src/meta/text.ts";
import { modelNamed } from "../m0/stored-sweep.ts";
import { awaitingLines, starter, type Kept, keptAs, openCampaign, stayAwake } from "./campaign.ts";
import { SETTING_OPTIONS, settingNamed } from "./setting.ts";

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
  reference: { type: "string", default: "starter" },
  tasks: { type: "string" },
  reviewer: { type: "string" },
  "reviewer-effort": { type: "string", default: "high" },
  target: { type: "string", default: "12" },
  solves: { type: "string", default: "2" },
  level: { type: "string", default: "0.1" },
  defects: { type: "string", default: "3" },
  budget: { type: "string", multiple: true },
  cap: { type: "string" },
  reserve: { type: "string", default: "10" },
} as const;

/** A round's flags and their defaults. A launch reads the same ones (`tools/runs/launch.ts`), so
 *  what it says a round can read is said of the round that would start. */
export const ROUND_OPTIONS = {
  root: { type: "string" },
  sweep: { type: "string" },
  cycle: { type: "string" },
  bundle: { type: "string" },
  name: { type: "string" },
  session: { type: "string" },
  builder: { type: "string" },
  "builder-effort": { type: "string", default: "high" },
  ...SETTING_OPTIONS,
  ...COMPARISON_OPTIONS,
  "practice-solves": { type: "string", default: "24" },
  minutes: { type: "string", default: "240" },
  turns: { type: "string", default: "300" },
  parent: { type: "string", default: "latest" },
} as const;

/** The scored tasks `--target` asks for: a whole number of at least one. Anything else would draw
 *  a set nobody asked for: no number draws none, and a negative one all but the last. */
export function targetNamed(flag: string): number {
  const target = Number(flag);
  if (!Number.isInteger(target) || target < 1) {
    throw new Error(`--target ${flag}: the tasks to score are a whole number of at least one`);
  }
  return target;
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

/** The budgets `--budget` names, each as `turns=40,cpu=600` with any of the four units. */
export function budgetsNamed(flags: readonly string[] = []): Budget[] {
  return flags.map((flag): Budget => {
    const named = flag.split(",").map((part) => {
      const [unit = "", most, ...more] = part.split("=");
      return { unit, most: more.length === 0 ? Number(most) : Number.NaN };
    });
    if (named.some(({ unit, most }) => !UNITS.some((known) => known === unit) || !(most > 0))) {
      throw new Error(
        `--budget ${flag}: a budget names turns, prompts, cpu or seconds, each with a number above nothing, as turns=40,cpu=600`,
      );
    }
    const budget: Record<string, number> = Object.fromEntries(named.map(({ unit, most }) => [unit, most]));
    return budget;
  });
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
  return { dollars: Number(values.cap), reserve: Number(values.reserve) };
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
    `each harness by itself, as the tasks with ${valid.old.map((_, count) => String(count)).join(", ")} valid answers in ${String(valid.old.length - 1)} solves:`,
    row("at its limits", valid),
    ...budgets.flatMap((budget) => {
      // A task with a valid solve whose CPU a cut command hid is left out of a CPU budget's reading.
      const unread = budget.unread ?? 0;
      const left =
        unread === 0
          ? ""
          : `, ${plural(unread, "task")} unread: a cut command left a valid solve's CPU unknown`;
      return budget.valid === undefined ? [] : [`${row(`at ${named(budget)}`, budget.valid)}${left}`];
    }),
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
  const { root, sweep, cycle, bundle, name, session } = values;
  if (
    root === undefined ||
    sweep === undefined ||
    cycle === undefined ||
    bundle === undefined ||
    name === undefined ||
    session === undefined
  ) {
    throw new Error("name --root, --sweep, --cycle, --bundle, --name and --session");
  }
  // SAFETY: an effort is one of pi's levels, and a backend refuses one it does not serve.
  const effort = (flag: string) => flag as ThinkingLevel;
  // Read before the campaign is opened: a paid round with no cap starts nothing.
  const cap = capNamed(values, seated === solved ? "paid" : "scripted");
  const budgets = budgetsNamed(values.budget);
  const target = targetNamed(values.target);
  const setting = settingNamed(values);
  const { limits } = setting;
  const campaign = await openCampaign({ root, sweep, cycle, bundle, name, ...setting });
  const sets = taskSets(read(campaign.log));
  const packages = campaign.packages();
  const packageOf = (version: string): TaskPackage => {
    const task = packages.get(version);
    if (task === undefined) {
      throw new Error(`task ${version} is in the log and in neither the pack nor a proposal`);
    }
    return task;
  };
  const reviewer = values.reviewer;
  const reviewers =
    reviewer === undefined
      ? null
      : campaign.reviewers(campaign.reader(modelNamed(reviewer), effort(values["reviewer-effort"])));
  // A session the log already holds goes on from the harness it started from, whatever a later
  // session has left since.
  const began = read(campaign.log).find(
    ({ kind, data }) => kind === "build.started" && data.session === session,
  )?.data.parent;
  const parent = (await keptAs(campaign, "--parent", isString(began) ? began : values.parent)).dir;
  const reference = await keptAs(campaign, "--reference", values.reference);
  const seats = seated(campaign, { builder: values.builder, reference: reference.dir });
  if (seats.builder === null) throw new Error("name --builder");
  stayAwake();
  const report = await round({
    session: {
      id: session,
      parent,
      states: campaign.states,
      tasks: sets.released.map((version) => ({ version, task: packageOf(version) })),
      contract: campaign.contract,
      resources: campaign.resources,
      ...seats.builder,
      effort: effort(values["builder-effort"]),
      limits: {
        ...limits,
        wallSeconds: Number(values.minutes) * 60,
        turns: Number(values.turns),
        practiceSolves: Number(values["practice-solves"]),
      },
      log: campaign.log,
      repoRoot: campaign.repo,
      practise: (task, dir, digest, kill) => seats.solve(packageOf(task.version), { dir, digest }, kill),
      ...(reviewers === null
        ? {}
        : {
            referee: (solve, task, kill) => reviewers.referee(solve, packageOf(task.version), kill),
            diagnose: (solve, task, kill) => reviewers.diagnose(solve, packageOf(task.version), kill),
          }),
    },
    reference,
    starter: await starter(campaign),
    tasks: scoredNamed(campaign, values.tasks, target),
    solves: Number(values.solves),
    level: Number(values.level),
    defects: Number(values.defects),
    budgets,
    cap,
    concurrency: limits.concurrency,
    solve: (version, harness, comparison, kill) => seats.solve(packageOf(version), harness, kill, comparison),
    setting: seats.setting,
    referee:
      reviewers === null
        ? undefined
        : (solve, version, kill) => reviewers.referee(solve, packageOf(version), kill),
  });
  console.log(JSON.stringify(report, null, 2));
  console.log(JSON.stringify(stopRule(read(campaign.log)), null, 2));
  for (const line of [...validLines(report), ...awaitingLines(campaign)]) console.log(line);
  return report;
}

if (import.meta.main) await roundCommand(Bun.argv.slice(2));
