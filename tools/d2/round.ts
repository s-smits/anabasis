/**
 * What a campaign's moves share (`session.ts`, `checkpoint.ts`, and the live Builder's tools through
 * `campaign-terms.ts`): the seats, the flags of a Builder session and of a comparison with their
 * defaults, the request each is made with, and the report a comparison prints.
 */
import type { ThinkingLevel } from "@earendil-works/pi-ai";
import { servedByClaude } from "#src/agent/backends/claude.ts";
import { stopRule, type Wanted } from "#src/campaign/admission.ts";
import { worthLine } from "#src/campaign/climb.ts";
import { predicted, type Report } from "#src/campaign/comparison.ts";
import { type CheckpointRequest, type Judging, scoredSet } from "#src/campaign/round.ts";
import type { BuildRequest, Practised } from "#src/builder/session.ts";
import type { Reader } from "#src/referee/referee.ts";
import {
  JUDGE_STEP,
  type ObjectiveRule,
  objectiveRuleOf,
  scoresIn,
  testedSet,
  testOf,
  WEIGHTS,
} from "#src/kernel/compare.ts";
import type { Limits } from "#src/kernel/condition.ts";
import { type Contract, contractHash, hasJudge } from "#src/kernel/contract.ts";
import { read, TRACE_KINDS } from "#src/kernel/log.ts";
import { priceKey } from "#src/kernel/meter.ts";
import { type Cap, capHolds } from "#src/kernel/reports.ts";
import { solverLast } from "#src/kernel/solves.ts";
import { readBrief } from "#src/kernel/verify.ts";
import { type TaskPackage, taskSets } from "#src/kernel/task.ts";
import { isString } from "#src/meta/json-shape.ts";
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
  PACK_OPTIONS,
} from "./campaign.ts";
import {
  type AskedSetting,
  commandSeconds,
  firstRecord,
  recordedSetting,
  SETTING_OPTIONS,
  settingAsked,
} from "./setting.ts";

export type Campaign = Awaited<ReturnType<typeof openCampaign>>;

interface SolverSeat {
  readonly solve: (
    task: TaskPackage,
    harness: Kept,
    kill: AbortSignal | undefined,
    comparison?: string,
  ) => Promise<Practised>;
  readonly setting: string;
}

export interface Seats extends SolverSeat {
  readonly builder: Pick<BuildRequest, "model" | "models"> | null;
  readonly judge?: Reader;
  /** Set by the paid seats and kept by whatever wraps them, as the solve queue does, since `seated
   *  === solved` fails for every move through the solve queue and would read it as a rehearsal's
   *  and skip its admission. */
  readonly paid?: true;
}

export type Seated = (
  campaign: Campaign,
  given: { readonly builder: string | undefined; readonly reference: string },
) => Seats;

export const COMPARISON_OPTIONS = {
  reference: { type: "string", default: PROMOTED },
  reviewer: { type: "string" },
  "reviewer-effort": { type: "string", default: "high" },
  target: { type: "string" },
  // One reading at or under `level` is a step (`stepOf`, `src/kernel/compare.ts`) and promotes; 0.02 is
  // the operator's choice, a per-comparison level.
  level: { type: "string", default: "0.02" },
  defects: { type: "string", default: "3" },
  cap: { type: "string" },
  reserve: { type: "string", default: "3" },
  predict: { type: "string" },
  "past-stop": { type: "string" },
} as const;

export const SESSION_OPTIONS = {
  ...PACK_OPTIONS,
  session: { type: "string" },
  builder: { type: "string" },
  "builder-effort": { type: "string", default: "high" },
  ...SETTING_OPTIONS,
  target: COMPARISON_OPTIONS.target,
  reviewer: COMPARISON_OPTIONS.reviewer,
  "reviewer-effort": COMPARISON_OPTIONS["reviewer-effort"],
  cap: COMPARISON_OPTIONS.cap,
  reserve: COMPARISON_OPTIONS.reserve,
  "past-stop": COMPARISON_OPTIONS["past-stop"],
  "practice-solves": { type: "string", default: "24" },
  minutes: { type: "string", default: "1440" },
  turns: { type: "string", default: "300" },
  parent: { type: "string", default: "latest" },
} as const;

interface SessionFlags {
  readonly session: string;
  readonly parent: string;
  readonly "builder-effort": string;
  readonly minutes: string;
  readonly turns: string;
  readonly "practice-solves": string;
}

export type Reviewers = ReturnType<Campaign["reviewers"]>;
type Apart = "versions" | "aside" | "short" | "disputed" | "withdrawn";

// SAFETY: an effort is one of pi's levels, and a backend refuses one it does not serve.
const effortNamed = (flag: string) => flag as ThinkingLevel;

export function packaged(campaign: Campaign): (version: string) => TaskPackage {
  let packages = campaign.packages();
  return (version) => {
    const task = packages.get(version) ?? (packages = campaign.packages()).get(version);
    if (task === undefined) {
      throw new Error(`task ${version} is in the log and in neither the pack nor a proposal`);
    }
    return task;
  };
}

export function reviewersNamed(
  campaign: Campaign,
  values: { readonly reviewer?: string | undefined; readonly "reviewer-effort": string },
): Reviewers | null {
  const { reviewer } = values;
  if (reviewer === undefined) return null;
  return campaign.reviewers(campaign.reader(modelNamed(reviewer), effortNamed(values["reviewer-effort"])));
}

export async function parentNamed(
  campaign: Campaign,
  values: Pick<SessionFlags, "session" | "parent">,
): Promise<string> {
  const began = read(campaign.log, TRACE_KINDS).find(
    ({ kind, data }) => kind === "build.started" && data.session === values.session,
  )?.data.parent;
  return (await keptAs(campaign, "--parent", isString(began) ? began : values.parent)).dir;
}

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
    tasks: taskSets(read(campaign.log, TRACE_KINDS)).released.map((version) => ({
      version,
      task: packageOf(version),
    })),
    contract: campaign.contract,
    resources: campaign.resources,
    ...seats.builder,
    effort: effortNamed(values["builder-effort"]),
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
    practise: (task, dir, digest, kill) => seats.solve(packageOf(task.version), { dir, digest }, kill),
    referee:
      reviewers === null
        ? undefined
        : (solve, task, kill) => reviewers.referee(solve, packageOf(task.version), kill),
  };
}

export function wantedNamed(
  values: {
    readonly level: string;
    readonly "past-stop"?: string | undefined;
  },
  given: {
    readonly setting: AskedSetting;
    readonly cap: Cap | undefined;
    readonly builds: boolean;
    readonly judged: boolean;
  },
): Wanted {
  const { target, solves } = given.setting;
  return {
    target,
    solves,
    level: Number(values.level),
    builds: given.builds,
    cap: given.cap ?? null,
    pastStop: predictionNamed(values["past-stop"]),
    judged: given.judged,
  };
}

function solvingAs(campaign: Campaign, { limits }: Pick<AskedSetting, "named">["named"]) {
  const { model, effort } = campaign.test;
  return { solver: { model: priceKey(model), effort }, limits };
}

export function objectiveNamed(campaign: Pick<Campaign, "checks">): ObjectiveRule | undefined {
  return objectiveRuleOf(readBrief(campaign.checks).objective);
}

export function predictionNamed(flag: string | undefined): string | undefined {
  const said = flag?.trim() ?? "";
  return said === "" ? undefined : said;
}

/**
 * The dollars `--cap` and `--reserve` name, read in one place for every command: each is a plain
 * number above nothing, so a cap typed as
 * "$40" is refused (`capHolds`).
 */
export function capRead(cap: string, reserve: string): Cap {
  const named = { dollars: Number(cap), reserve: Number(reserve) };
  if (!capHolds(named)) {
    throw new Error(
      `--cap ${cap} --reserve ${reserve}: a cap and its reserve are dollars as plain numbers, each above nothing, as --cap 40 --reserve 3`,
    );
  }
  return named;
}

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
 * A rejection nobody rules sets its task aside, so a paid run without a Referee would measure
 * nothing of its rejections.
 */
export function refereeNamed(
  values: { readonly reviewer?: string | undefined },
  seats: "paid" | "scripted",
): void {
  if (values.reviewer === undefined && seats === "paid") {
    throw new Error("name --reviewer, the Referee that rules each rejection before it counts");
  }
}

export async function campaignFor(
  values: Parameters<typeof capNamed>[0] &
    Parameters<typeof refereeNamed>[0] &
    Parameters<typeof settingAsked>[0],
  pack: Parameters<typeof openCampaign>[0],
  seated: Seated,
) {
  const seats = seated === solved ? "paid" : "scripted";
  const cap = capNamed(values, seats);
  refereeNamed(values, seats);
  const setting = settingAsked(values, recordedSetting(read(campaignLog(pack.name), TRACE_KINDS)));
  const campaign = await openCampaign({ ...pack, ...setting.named });
  const unrecorded =
    seats === "paid"
      ? firstRecord(setting, solvingAs(campaign, setting.named), solverLast(read(campaign.log, TRACE_KINDS)))
      : undefined;
  if (unrecorded !== undefined) throw new Error(unrecorded);
  return { cap, setting, campaign };
}

export function printReport(campaign: Campaign, id: string, report: Report): void {
  const events = read(campaign.log, TRACE_KINDS);
  const said = predicted(events, id);
  console.log(JSON.stringify(report, null, 2));
  console.log(JSON.stringify(stopRule(events), null, 2));
  for (const line of [
    ...reportLines(report),
    ...(said === null ? [] : [`predicted before the first solve: ${said}`, `read: ${report.reading}`]),
    ...awaitingLines(campaign),
  ]) {
    console.log(line);
  }
}

function stepTestLines(test: Report["scored"] | Report["frontier"]): string[] {
  if (test?.falseRate === undefined) return [];
  const share = test.detectable ?? null;
  const stepped = testOf(scoresIn(test));
  const untied = stepped.wins + stepped.losses;
  return [
    `the step's test is read on the score on ${plural(untied + stepped.ties, "tallied task")}, ${String(untied)} of them untied: one reading at the comparison's level detects four times in five ${share === null ? "no share of them" : `a harness that wins ${String(Math.round(100 * share))}% of them`}`,
    `the test at these margins clears the level between equal harnesses ${String(Math.round(1000 * test.falseRate) / 10)}% of the time, never more than the level`,
    `its p is ${rounded(stepped.p)}: the test weighs each untied task by its score${stepped.losses === 0 && untied > 0 ? `, and where every untied task is won p is one half to the power of their count whatever the margins: ${String(untied)} won read ${rounded(0.5 ** untied)}` : ""}`,
  ];
}

export function reportLines({
  valid,
  objective,
  scored = null,
  frontier,
  noise,
  turns = null,
  worth = null,
  points = null,
  ...apart
}: Pick<Report, "valid" | "objective" | "frontier" | "noise"> &
  Partial<Pick<Report, "scored" | "turns" | "worth" | "points" | Apart>>): string[] {
  if (valid === null) return [];
  // The turns of a valid answer, over the tasks both harnesses answered: reported, in no test.
  const both = Object.values(turns ?? {}).flatMap(({ old, fresh }) =>
    old === null || fresh === null ? [] : [{ old, fresh }],
  );
  const took = (side: "old" | "fresh") => String(median(both.map((each) => each[side])));
  return [
    ...stepTestLines(testedSet(scored, frontier)),
    ...(noise === null ? [] : aaLines(noise)),
    ...accounted(apart),
    `each harness by itself, as how many tasks had ${valid.old.map((_, count) => String(count)).join(", ")} valid answers in ${String(valid.old.length - 1)} solves (a count of tasks a column, not a share):`,
    `  at its limits: reference ${valid.old.join("/")}, new ${valid.fresh.join("/")}`,
    ...(points === null
      ? []
      : [
          `the score weighs validity ${String(WEIGHTS.validity)} and the objective ${String(WEIGHTS.objective)}, and over the tallied tasks gave the new harness ${signed(points.validity)} and ${signed(points.objective)} points, a task's score running from -600 to 600`,
        ]),
    ...(objective === null ? [] : [`the objective: ${objective.direction} is better`]),
    ...(both.length === 0
      ? []
      : [
          `the median turns of a valid answer, over the ${plural(both.length, "task")} both answered: reference ${took("old")}, new ${took("fresh")} (reported, in no test)`,
        ]),
    ...(worth === null ? [] : [worthLine(worth)]),
  ];
}

function signed(points: number): string {
  return points > 0 ? `+${String(points)}` : String(points);
}

function rounded(share: number): string {
  return String(Math.round(1000 * share) / 1000);
}

function percent(share: number): string {
  return `${String(Math.round(100 * share))}%`;
}

function aaLines(noise: NonNullable<Report["noise"]>): string[] {
  const tasks = noise.wins + noise.losses + noise.ties;
  const shift = noise.detectable ?? null;
  return [
    `the reference against itself, on halves of its own solves mirrored in time (the A/A), over the ${plural(tasks, "tallied task")}, ${String(noise.wins + noise.losses)} of them untied:`,
    `  tie share ${tasks === 0 ? "none" : percent(noise.ties / tasks)}: the share of tasks two equal harnesses tied at half the comparison's solves a side, where equal harnesses tie more often than at the comparison's own, so no floor for its ties`,
    `  flip rate ${noise.flips === null ? "none" : percent(noise.flips)}: how often two of its solves of one task disagree on validity`,
    `  least detectable shift: ${shift === null ? "none, too few of its tasks are untied for any shift between its halves to clear the level, so its reading no step shows little" : `one reading of it, either half read at the level, detects four times in five a half that wins ${percent(shift)} of its untied tasks`}`,
  ];
}

function accounted({
  versions,
  aside = [],
  short = [],
  disputed = [],
  withdrawn = [],
}: Partial<Pick<Report, Apart>>): string[] {
  if (versions === undefined) return [];
  const out: readonly (readonly [readonly string[], string])[] = [
    [aside, "set aside on a rejection not ruled a true fail"],
    [short.filter((task) => !aside.includes(task)), "short of their solves"],
    [disputed, "disputed"],
    [withdrawn, "withdrawn while it ran"],
  ];
  const drew = new Set([...versions, ...aside, ...short, ...disputed, ...withdrawn]).size;
  const left = out.flatMap(([tasks, why]) => (tasks.length === 0 ? [] : [`${String(tasks.length)} ${why}`]));
  return [
    `of the ${plural(drew, "task")} the comparison drew, ${String(versions.length)} ${versions.length === 1 ? "was" : "were"} tallied${left.length === 0 ? "" : ` and ${left.join(", ")}`}: the columns below, room and the test are read over the tallied ones`,
  ];
}

export const solved: Seated = (campaign, { builder }) => ({
  builder: builder === undefined ? null : { model: modelNamed(builder), models: campaign.builder },
  solve: (task, harness, kill, comparison) =>
    campaign.solveOnce(task, harness, campaign.test, kill, comparison),
  setting: campaign.setting(campaign.test),
  paid: true,
});

const FIRST_PARTY_VENDORS = new Map([
  ["alibaba", "alibaba"],
  ["anthropic", "anthropic"],
  ["claude", "anthropic"],
  ["claude-code", "anthropic"],
  ["codex", "openai"],
  ["cohere", "cohere"],
  ["deepseek", "deepseek"],
  ["deepseek-ai", "deepseek"],
  ["google", "google"],
  ["google-gemini-cli", "google"],
  ["kimi-coding", "moonshot"],
  ["meta", "meta"],
  ["meta-llama", "meta"],
  ["minimax", "minimax"],
  ["minimax-cn", "minimax"],
  ["mistral", "mistral"],
  ["mistralai", "mistral"],
  ["moonshot", "moonshot"],
  ["moonshotai", "moonshot"],
  ["moonshotai-cn", "moonshot"],
  ["openai", "openai"],
  ["openai-codex", "openai"],
  ["qwen", "alibaba"],
  ["x-ai", "xai"],
  ["xai", "xai"],
  ["z-ai", "zai"],
  ["zai", "zai"],
]);

export function modelVendor(name: string): string | null {
  const normalize = (raw: string): string | null => {
    const clean = raw.replace(/^~/u, "").toLowerCase();
    if (servedByClaude(clean)) return "anthropic";
    return FIRST_PARTY_VENDORS.get(clean) ?? null;
  };
  try {
    const model = modelNamed(name);
    if (servedByClaude(model.provider)) return "anthropic";
    if (model.id.includes("/")) return normalize(model.id.split("/")[0] ?? "");
    return normalize(model.provider);
  } catch {
    const parts = name.split("/");
    return normalize(parts[parts.length >= 3 ? 1 : 0] ?? "");
  }
}

export function crossFamilyVendors(first: string, second: string): boolean {
  const left = modelVendor(first);
  const right = modelVendor(second);
  return left !== null && right !== null && left !== right;
}

export async function comparedOn(
  { campaign, setting, cap }: Awaited<ReturnType<typeof campaignFor>>,
  values: { readonly level: string; readonly defects: string; readonly predict?: string | undefined },
  seats: Seats,
  reviewers: Reviewers | null,
): Promise<Omit<CheckpointRequest, "log" | "id" | "old" | "fresh" | "kill">> {
  const packageOf = packaged(campaign);
  const judges = reviewers ?? (seats.judge === undefined ? null : campaign.reviewers(seats.judge));
  if (seats.paid && hasJudge(campaign.contract.objective)) {
    if (judges === null) {
      throw new Error("name --reviewer: a paid judged comparison needs a cross-family judging reviewer");
    }
    const solver = priceKey(campaign.test.model);
    if (!crossFamilyVendors(judges.reviewer, solver)) {
      const why =
        modelVendor(judges.reviewer) === null
          ? `the reviewer ${judges.reviewer} routes to an unknown vendor`
          : `the reviewer ${judges.reviewer} judges answers by a solver of its own family (${solver})`;
      throw new Error(`${why}; name a reviewer from another family`);
    }
  }
  return {
    starter: await starter(campaign),
    ...scoredSet(read(campaign.log, TRACE_KINDS), setting.target, contractHash(campaign.contract)),
    solves: setting.solves,
    level: Number(values.level),
    objective: objectiveNamed(campaign),
    defects: Number(values.defects),
    cap,
    prediction: predictionNamed(values.predict),
    concurrency: setting.named.limits.concurrency,
    solve: (version, harness, comparison, kill) => seats.solve(packageOf(version), harness, kill, comparison),
    setting: seats.setting,
    referee:
      reviewers === null
        ? undefined
        : (solve, version, kill) => reviewers.referee(solve, packageOf(version), kill),
    judge: judges === null ? undefined : judgingOf(campaign.contract, judges, packageOf),
  };
}

function judgingOf(
  contract: Contract,
  reviewers: Reviewers,
  packageOf: (version: string) => TaskPackage,
): Judging | undefined {
  const items = contract.objective?.items ?? [];
  if (!hasJudge(contract.objective)) return undefined;
  const all = items.reduce((sum, { weight }) => sum + weight, 0);
  const judge = items.reduce((sum, { kind, weight }) => sum + (kind === "judge" ? weight : 0), 0);
  return {
    weights: { code: all - judge, judge, step: JUDGE_STEP },
    reviewer: reviewers.reviewer,
    brief: (version, comparison, kill) => reviewers.brief(packageOf(version), comparison, kill),
    pair: (version, asked, kill) => reviewers.pair(packageOf(version), asked, kill),
  };
}
