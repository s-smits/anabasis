/**
 * One round over a campaign, the plan's D2: a Builder session from the harness the campaign stands
 * on, the screening of the live pool under the old and the new harness, the scoring solves, and
 * the readings.
 *
 *   bun tools/d2/round.ts --root ../anabasis-cycles-4c67fc --sweep veryhard-hb-4c67fc --cycle c01 \
 *     --bundle ../anabasis-cycles-4c67fc/fixture/round4-veryhard-workspace --name truss --session b-1 \
 *     --builder claude/claude-opus-5-5 --reviewer claude/claude-opus-5-5
 *
 * The sets are the log's (`prepare.ts`): the released tasks are the Builder's practice, the anchor
 * is the anchor, and the live pool is every feasible task held or admitted outside it. The pool is
 * screened in an order drawn by the contract's hash and the session's id, and never in the order of
 * what an earlier solve showed of it, so that neither harness's fails choose which come first. A
 * task an earlier round admitted is in the pool like any other: this round admits it again or
 * retires it, on the parent's solves the log already holds and the child's own
 * (`src/builder/round.ts`). Until 2026-10-08 a round scored only what it screened itself, and an
 * `--admitted` flag scored an earlier admission as it stood, chosen by other harnesses' fails.
 *
 * The defaults are the plan's: 24 scored tasks, three scoring solves a harness, screening on three
 * solves and two fails (its decision 26), the sign test at 0.10, an anchor floor of 8 and a stop
 * past three check defects. The anchor's level defaults to the scored set's; a guard may be asked
 * to fire sooner with `--anchor-level`. `--reviewer` gives the Builder the Referee and the
 * Diagnoser on its practice fails and the round the Referee on screening and scoring fails. There
 * the Referee advises: a fail it rules a check defect stands and its task is reported as flagged,
 * for the hand reading the plan keeps as the gate. The report holds the reading without the flagged
 * tasks beside the one with them (`unflagged`, `counted`); where the two differ it reads
 * `flags-decide` and claims neither, and `tools/d2/settle.ts` settles it on a person's labels. `--referee-decides` lets such a ruling dispute
 * the task, once its rulings have cleared the operator's bar against hand labels
 * (`src/review/agreement.ts`).
 *
 * Every solve is the cycle's own model at its effort, unless `--solver` and `--solver-effort` name
 * another to solve in its place.
 *
 * The session starts from the frontier: the harness the campaign's last step left, or the cycle's
 * while no round has stepped (`src/kernel/ladder.ts`). So a step is built on without being asked
 * for, and a round that read no step is followed by another from the same parent. `--parent
 * <digest>` names another harness an earlier session kept: the operator's way to build on one the
 * plan's rules did not call a step, and a cross round's (`model-condition-comparison`). It takes
 * the whole digest, the name of the harness's folder under the campaign's `states/`, and a name
 * that is none of those is refused with the ones there are.
 *
 * Run again with the same `--session`, a round goes on from its log. Its report and the plan's
 * three-session reading are printed from the log.
 *
 * A simulation runs this same command with a script in each of its two model seats
 * (`tools/runs/rehearse.ts`), so that what it walks is what a paid round walks.
 *
 * Not run here: see `campaign.ts`.
 */
import type { ThinkingLevel } from "@earendil-works/pi-ai";
import { type RoundReport, round, screeningOrder, stopRule } from "#src/builder/round.ts";
import type { BuildRequest, Practised } from "#src/builder/session.ts";
import { contractHash } from "#src/kernel/contract.ts";
import { read } from "#src/kernel/log.ts";
import type { TaskPackage } from "#src/kernel/task.ts";
import { existsSync, readdirSync } from "#src/meta/filesystem.ts";
import { isString } from "#src/meta/json-shape.ts";
import { join } from "#src/meta/path.ts";
import { parseArgs } from "#src/meta/process.ts";
import { modelNamed } from "../m0/stored-sweep.ts";
import {
  frontier,
  type Kept,
  LIMITS,
  openCampaign,
  SCREENING_OPTIONS,
  screeningRule,
  setsOf,
  stayAwake,
} from "./campaign.ts";

export type Campaign = Awaited<ReturnType<typeof openCampaign>>;

/** A round's two model seats: who builds, and who solves a task under a harness. */
interface Seats {
  readonly builder: Pick<BuildRequest, "model" | "models">;
  readonly solve: (task: TaskPackage, harness: Kept, kill: AbortSignal | undefined) => Promise<Practised>;
  /** The setting those solves record, which names whose solves on record the round may read. */
  readonly setting: string;
}

/** Who sits in a round's seats, once its campaign is open and its parent harness is known. */
export type Seated = (
  campaign: Campaign,
  given: { readonly builder: string | undefined; readonly parent: string },
) => Seats;

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
  solver: { type: "string" },
  "solver-effort": { type: "string", default: "high" },
  reviewer: { type: "string" },
  "reviewer-effort": { type: "string", default: "high" },
  "referee-decides": { type: "boolean", default: false },
  target: { type: "string", default: "24" },
  solves: { type: "string", default: "3" },
  ...SCREENING_OPTIONS,
  level: { type: "string", default: "0.1" },
  "anchor-level": { type: "string" },
  "anchor-floor": { type: "string", default: "8" },
  defects: { type: "string", default: "3" },
  "practice-solves": { type: "string", default: "24" },
  minutes: { type: "string", default: "240" },
  turns: { type: "string", default: "300" },
  parent: { type: "string" },
} as const;

/** This host's backends in both seats: the Builder `--builder` names, and the campaign's solver. */
const hosted: Seated = (campaign, { builder }) => {
  if (builder === undefined) throw new Error("name --builder");
  return {
    builder: { model: modelNamed(builder), models: campaign.builder },
    solve: (task, harness, kill) => campaign.solveOnce(task, harness, campaign.test, kill),
    setting: campaign.setting(campaign.test),
  };
};

/** `bun tools/d2/round.ts`, and under a simulation's `seated` the same round with its seats scripted. */
export async function roundCommand(args: readonly string[], seated: Seated = hosted): Promise<RoundReport> {
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
  const solver =
    values.solver === undefined
      ? undefined
      : { model: values.solver, effort: effort(values["solver-effort"]) };
  const campaign = await openCampaign({ root, sweep, cycle, bundle, name, solver });
  const sets = setsOf(read(campaign.log));
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
  // A session the log already holds goes on from the harness it started from, wherever the
  // frontier has moved since: its own step moves it.
  const began = read(campaign.log).find(
    ({ kind, data }) => kind === "build.started" && data.session === session,
  )?.data.parent;
  const startedFrom =
    isString(began) && existsSync(join(campaign.states, began))
      ? join(campaign.states, began)
      : campaign.parent;
  // `--parent` names a harness by the folder a session froze it under, which is its whole digest.
  // Any other name is answered with the ones there are: on 2026-10-08 a digest cut to its first
  // eight characters, as every reader prints one, ended a simulated round in a bare `ENOENT`.
  const kept = existsSync(campaign.states) ? readdirSync(campaign.states).sort() : [];
  const asked = values.parent;
  if (asked !== undefined && !kept.includes(asked)) {
    const begun = kept.filter((digest) => asked !== "" && digest.startsWith(asked));
    const from =
      "With no --parent a round starts from the harness the last step left, or from the cycle's while no round has stepped";
    throw new Error(
      kept.length === 0
        ? `--parent ${asked} is no harness this campaign keeps: no session has kept one under ${campaign.states} yet. ${from}`
        : `--parent ${asked} is no harness this campaign keeps. It takes one of the digests under ${campaign.states}, whole: ${kept.join(", ")}.${begun.length === 1 ? ` ${asked} begins ${String(begun[0])}.` : ""} ${from}`,
    );
  }
  const named = asked === undefined ? null : join(campaign.states, asked);
  const parent = named ?? (isString(began) ? startedFrom : (await frontier(campaign)).dir);
  const seats = seated(campaign, { builder: values.builder, parent });
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
        ...LIMITS,
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
    candidates: screeningOrder(
      [...sets.candidates, ...sets.admitted],
      contractHash(campaign.contract),
      session,
    ),
    anchor: sets.anchor,
    target: Number(values.target),
    screening: screeningRule(values),
    solves: Number(values.solves),
    level: Number(values.level),
    anchorLevel: Number(values["anchor-level"] ?? values.level),
    anchorFloor: Number(values["anchor-floor"]),
    defects: Number(values.defects),
    concurrency: LIMITS.concurrency,
    solve: (version, dir, digest, kill) => seats.solve(packageOf(version), { dir, digest }, kill),
    setting: seats.setting,
    ...(reviewers === null
      ? {}
      : { referee: (solve, version, kill) => reviewers.referee(solve, packageOf(version), kill) }),
    refereeDecides: values["referee-decides"],
  });
  console.log(JSON.stringify(report, null, 2));
  console.log(JSON.stringify(stopRule(read(campaign.log)), null, 2));
  return report;
}

if (import.meta.main) await roundCommand(Bun.argv.slice(2));
