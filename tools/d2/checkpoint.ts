/**
 * One comparison of two harnesses a campaign keeps, on its held-out tasks, with no Builder session.
 *
 *   bun tools/d2/checkpoint.ts --root ../anabasis-cycles-4c67fc --sweep veryhard-hb-4c67fc --cycle c01 \
 *     --bundle ../anabasis-cycles-4c67fc/fixture/round4-veryhard-workspace --name truss --id g0 \
 *     --target 8 --cap 375 --budget turns=12 --budget turns=6
 *
 * With no `--reference` and no `--new` it is the plan's first experiment and its gate G0
 * (`docs/plan.md`, Phase 0): the minimal baseline, which is the solver with a shell and the answer
 * writer, set against the harness the campaign starts with, before anything else is built. What the
 * gate reads is in the report as counts: the tasks won, lost and tied at the full limit (`scored`)
 * and at each `--budget` (`budgets`), how many of the ties had no valid answer under either harness
 * (`unsolved`), how far the use of each unit moved between two solves of one harness on one task
 * (`spread`), and the billed dollars of a solve (`billed`). The gate passes when at some budget at
 * least 4 of 8 tasks are untied. Which side won them says which arm is the better one, and the
 * operator names that one as the reference from then on.
 *
 * `--reference` and `--new` each name a harness the campaign keeps (`campaign.ts`, `keptAs`):
 * `start`, `baseline`, `latest`, or the whole digest of one a session froze. So the same command
 * compares the latest harness of several Builder sessions with the reference one, which is the
 * plan's checkpoint (`--new latest`), and a harness with the baseline where a settling left a step
 * unread against it.
 *
 * `--noise` also reads the reference harness against itself, the plan's A/A comparison: it is
 * solved twice as often, and its first solves of a task are set against its later ones. With it,
 * and with a budget the solver is told, this command is gate G2: 8 tasks, two solves under the
 * baseline and four under the reference harness.
 *
 * `--tasks` names the scored tasks by id, where the operator chooses them, as Phase 0 has it.
 * Without it the scored set is `--target` of the held-out tasks by the contract's draw. The solves a
 * side, the level, the Referee, the budgets, the cap and the solver's four flags are a round's,
 * with a round's defaults (`round.ts`), and `--cap` is required as it is there. With no
 * `--reviewer`, every rejection waits for a person and sets its task aside until
 * `tools/d2/settle.ts` has its labels, which is how Phase 0 is read before there is a Judge.
 *
 * Run again with the same `--id`, it goes on from its log, and once it has reported it says what
 * it said.
 *
 * Not run here: see `campaign.ts`.
 */
import type { ThinkingLevel } from "@earendil-works/pi-ai";
import { checkpoint, type Report, scoredSet } from "#src/builder/round.ts";
import { contractHash } from "#src/kernel/contract.ts";
import { read } from "#src/kernel/log.ts";
import { stopRule } from "#src/kernel/reports.ts";
import type { TaskPackage } from "#src/kernel/task.ts";
import { parseArgs } from "#src/meta/process.ts";
import { modelNamed } from "../m0/stored-sweep.ts";
import { awaitingLines, baseline, keptAs, openCampaign, stayAwake } from "./campaign.ts";
import { budgetsNamed, capNamed, COMPARISON_OPTIONS, ROUND_OPTIONS, type Seated, solved } from "./round.ts";
import { SETTING_OPTIONS, settingNamed } from "./setting.ts";

const OPTIONS = {
  root: ROUND_OPTIONS.root,
  sweep: ROUND_OPTIONS.sweep,
  cycle: ROUND_OPTIONS.cycle,
  bundle: ROUND_OPTIONS.bundle,
  name: ROUND_OPTIONS.name,
  id: { type: "string" },
  new: { type: "string", default: "baseline" },
  noise: { type: "boolean", default: false },
  tasks: { type: "string" },
  ...SETTING_OPTIONS,
  ...COMPARISON_OPTIONS,
} as const;

/** `bun tools/d2/checkpoint.ts`, and under a simulation's `seated` the same comparison with its
 *  solver scripted. */
export async function checkpointCommand(args: readonly string[], seated: Seated = solved): Promise<Report> {
  const { values } = parseArgs({ args: [...args], options: OPTIONS });
  const { root, sweep, cycle, bundle, name, id } = values;
  if (
    root === undefined ||
    sweep === undefined ||
    cycle === undefined ||
    bundle === undefined ||
    name === undefined ||
    id === undefined
  ) {
    throw new Error("name --root, --sweep, --cycle, --bundle, --name and --id");
  }
  // Read before the campaign is opened: a paid comparison with no cap starts nothing.
  const cap = capNamed(values, seated === solved ? "paid" : "scripted");
  const budgets = budgetsNamed(values.budget);
  const setting = settingNamed(values);
  const campaign = await openCampaign({ root, sweep, cycle, bundle, name, ...setting });
  const packages = campaign.packages();
  const packageOf = (version: string): TaskPackage => {
    const task = packages.get(version);
    if (task === undefined) {
      throw new Error(`task ${version} is in the log and in neither the pack nor a proposal`);
    }
    return task;
  };
  const old = await keptAs(campaign, "--reference", values.reference);
  const fresh = await keptAs(campaign, "--new", values.new);
  const events = read(campaign.log);
  /** The scored tasks `--tasks` names, by version: each a task of the pack or of a session. */
  const named = (ids: string) =>
    ids.split(",").map((taskId) => {
      const found = [...packages].find(([, task]) => task.taskId === taskId);
      if (found === undefined) throw new Error(`--tasks ${taskId}: the campaign holds no task of that id`);
      return found[0];
    });
  const reviewer = values.reviewer;
  const reviewers =
    reviewer === undefined
      ? null
      : campaign.reviewers(
          // SAFETY: an effort is one of pi's levels, and a backend refuses one it does not serve.
          campaign.reader(modelNamed(reviewer), values["reviewer-effort"] as ThinkingLevel),
        );
  const seats = seated(campaign, { builder: undefined, reference: old.dir });
  stayAwake();
  const report = await checkpoint({
    log: campaign.log,
    id,
    old,
    fresh,
    baseline: await baseline(campaign),
    tasks:
      values.tasks === undefined
        ? scoredSet(events, Number(values.target), contractHash(campaign.contract))
        : named(values.tasks),
    solves: Number(values.solves),
    level: Number(values.level),
    defects: Number(values.defects),
    noise: values.noise,
    budgets,
    cap,
    concurrency: setting.limits.concurrency,
    solve: (version, dir, digest, kill) => seats.solve(packageOf(version), { dir, digest }, kill),
    setting: seats.setting,
    referee:
      reviewers === null
        ? undefined
        : (solve, version, kill) => reviewers.referee(solve, packageOf(version), kill),
  });
  console.log(JSON.stringify(report, null, 2));
  console.log(JSON.stringify(stopRule(read(campaign.log)), null, 2));
  for (const line of awaitingLines(campaign)) console.log(line);
  return report;
}

if (import.meta.main) await checkpointCommand(Bun.argv.slice(2));
