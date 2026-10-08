/**
 * One round over a campaign, the plan's D2: a Builder session from the campaign's harness, the
 * screening of held tasks under the old and the new harness, the scoring solves, and the readings.
 *
 *   bun tools/d2/round.ts --root ../anabasis-cycles-4c67fc --sweep veryhard-hb-4c67fc --cycle c01 \
 *     --bundle ../anabasis-cycles-4c67fc/fixture/round4-veryhard-workspace --name truss --session b-1 \
 *     --builder claude/claude-opus-5-5 --reviewer claude/claude-opus-5-5
 *
 * The sets are the log's (`prepare.ts`): the released tasks are the Builder's practice, the anchor
 * is the anchor, and every feasible task still held outside it is a candidate. Candidates are
 * screened in an order drawn by the contract's hash and the session's id, and never in the order of
 * what an earlier solve showed of them, so that neither harness's fails choose which come first.
 * Tasks already admitted, by a stored sweep's solves say, are scored only with `--admitted`: they
 * were chosen by other harnesses' fails, which is fit for a plumbing run and for nothing else.
 *
 * The defaults are the plan's: 24 scored tasks, three scoring solves a harness, screening on three
 * solves and two fails (its decision 26), the sign test at 0.10, an anchor floor of 8 and a stop
 * past three check defects. The anchor's level defaults to the scored set's; a guard may be asked
 * to fire sooner with `--anchor-level`. `--reviewer` gives the Builder the Referee and the
 * Diagnoser on its practice fails and the round the Referee on screening and scoring fails. There
 * the Referee advises: a fail it rules a check defect stands and its task is reported as flagged,
 * for the hand reading the plan keeps as the gate, and the report holds the reading without the
 * flagged tasks beside the first (`unflagged`). `--referee-decides` lets such a ruling dispute
 * the task, once its rulings have cleared the operator's bar against hand labels
 * (`src/review/agreement.ts`).
 *
 * Every solve is the cycle's own model at its effort, unless `--solver` and `--solver-effort` name
 * another to solve in its place.
 *
 * The session starts from the cycle's harness, or with `--parent <digest>` from a harness an
 * earlier session of the campaign kept, so that a step can be built on.
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
import { type RoundReport, round, stopRule } from "#src/builder/round.ts";
import type { BuildRequest, Practised } from "#src/builder/session.ts";
import { draw } from "#src/kernel/compare.ts";
import { contractHash } from "#src/kernel/contract.ts";
import { read } from "#src/kernel/log.ts";
import type { TaskPackage } from "#src/kernel/task.ts";
import { join } from "#src/meta/path.ts";
import { parseArgs } from "#src/meta/process.ts";
import { modelNamed } from "../m0/stored-sweep.ts";
import { type Kept, LIMITS, openCampaign, setsOf, stayAwake } from "./campaign.ts";

export type Campaign = Awaited<ReturnType<typeof openCampaign>>;

/** A round's two model seats: who builds, and who solves a task under a harness. */
interface Seats {
  readonly builder: Pick<BuildRequest, "model" | "models">;
  readonly solve: (task: TaskPackage, harness: Kept, kill: AbortSignal | undefined) => Promise<Practised>;
}

/** Who sits in a round's seats, once its campaign is open and its parent harness is known. */
export type Seated = (
  campaign: Campaign,
  given: { readonly builder: string | undefined; readonly parent: string },
) => Seats;

const OPTIONS = {
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
  admitted: { type: "boolean", default: false },
  "referee-decides": { type: "boolean", default: false },
  target: { type: "string", default: "24" },
  solves: { type: "string", default: "3" },
  screen: { type: "string", default: "3" },
  fails: { type: "string", default: "2" },
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
  };
};

/** `bun tools/d2/round.ts`, and under a simulation's `seated` the same round with its seats scripted. */
export async function roundCommand(args: readonly string[], seated: Seated = hosted): Promise<RoundReport> {
  const { values } = parseArgs({ args: [...args], options: OPTIONS });
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
  const seed = `${contractHash(campaign.contract)}:${session}`;
  const parent = values.parent === undefined ? campaign.parent : join(campaign.states, values.parent);
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
    scored: values.admitted ? sets.admitted : [],
    candidates: draw(sets.candidates, sets.candidates.length, seed),
    anchor: sets.anchor,
    target: Number(values.target),
    screening: { solves: Number(values.screen), fails: Number(values.fails) },
    solves: Number(values.solves),
    level: Number(values.level),
    anchorLevel: Number(values["anchor-level"] ?? values.level),
    anchorFloor: Number(values["anchor-floor"]),
    defects: Number(values.defects),
    concurrency: LIMITS.concurrency,
    solve: (version, dir, digest, kill) => seats.solve(packageOf(version), { dir, digest }, kill),
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
