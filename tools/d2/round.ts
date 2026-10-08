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
 * for the hand reading the plan keeps as the gate. `--referee-decides` lets such a ruling dispute
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
 * Not run here: see `campaign.ts`.
 */
import type { ThinkingLevel } from "@earendil-works/pi-ai";
import { round, stopRule } from "#src/builder/round.ts";
import { draw } from "#src/kernel/compare.ts";
import { contractHash } from "#src/kernel/contract.ts";
import { read } from "#src/kernel/log.ts";
import type { TaskPackage } from "#src/kernel/task.ts";
import { join } from "#src/meta/path.ts";
import { parseArgs } from "#src/meta/process.ts";
import { modelNamed } from "../m0/stored-sweep.ts";
import { LIMITS, openCampaign, setsOf, stayAwake } from "./campaign.ts";

const { values } = parseArgs({
  options: {
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
  },
});

async function main(): Promise<void> {
  const { root, sweep, cycle, bundle, name, session, builder } = values;
  if (
    root === undefined ||
    sweep === undefined ||
    cycle === undefined ||
    bundle === undefined ||
    name === undefined ||
    session === undefined ||
    builder === undefined
  ) {
    throw new Error("name --root, --sweep, --cycle, --bundle, --name, --session and --builder");
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
  stayAwake();
  const report = await round({
    session: {
      id: session,
      parent: values.parent === undefined ? campaign.parent : join(campaign.states, values.parent),
      states: campaign.states,
      tasks: sets.released.map((version) => ({ version, task: packageOf(version) })),
      contract: campaign.contract,
      resources: campaign.resources,
      model: modelNamed(builder),
      effort: effort(values["builder-effort"]),
      limits: {
        ...LIMITS,
        wallSeconds: Number(values.minutes) * 60,
        turns: Number(values.turns),
        practiceSolves: Number(values["practice-solves"]),
      },
      models: campaign.builder,
      log: campaign.log,
      repoRoot: campaign.repo,
      practise: (task, dir, digest, kill) =>
        campaign.solveOnce(packageOf(task.version), { dir, digest }, campaign.test, kill),
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
    solve: (version, dir, digest, kill) =>
      campaign.solveOnce(packageOf(version), { dir, digest }, campaign.test, kill),
    ...(reviewers === null
      ? {}
      : { referee: (solve, version, kill) => reviewers.referee(solve, packageOf(version), kill) }),
    refereeDecides: values["referee-decides"],
  });
  console.log(JSON.stringify(report, null, 2));
  console.log(JSON.stringify(stopRule(read(campaign.log)), null, 2));
}

await main();
