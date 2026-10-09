/**
 * One comparison of two harnesses a campaign keeps, on its held-out tasks, with no Builder session.
 *
 *   bun tools/d2/checkpoint.ts --root ../anabasis-cycles-4c67fc --sweep veryhard-hb-4c67fc --cycle c01 \
 *     --bundle ../anabasis-cycles-4c67fc/fixture/round4-veryhard-workspace --name truss --id g2 \
 *     --tasks <eight task ids> --noise --cap 437
 *
 * With no `--reference` and no `--new` it compares the latest harness a Builder session left with
 * the Starter Built Harness, which is the plan's checkpoint: several sessions, then one comparison
 * on fresh solves (`docs/plan.md`, Phase 5). While no session has left a harness there is nothing
 * to compare, and the command says so. The plan's first experiment is no checkpoint: it is the
 * first round (`round.ts`).
 *
 * `--reference` and `--new` each name a harness the campaign keeps (`campaign.ts`, `keptAs`):
 * `starter`, `latest`, or the whole digest of one a session froze. So the same command compares a
 * harness with a promoted reference, repeats a step on fresh solves before anything is promoted,
 * and reads a harness against the starter where a settling, a stop or the cap left a step unread
 * against it (`--reference starter --new <digest>`).
 *
 * `programs-of:` before a name is that harness's control: the starter with the harness's installed
 * programs and nothing else of it. `--reference starter --new programs-of:latest` reads what the
 * programs are worth by themselves, and `--reference programs-of:latest --new latest` what the
 * guide and the tools add to them. A step is the whole harness's until those two are read.
 *
 * `--noise` also reads the reference harness against itself, the plan's A/A comparison: it is
 * solved twice as often, and its first solves of a task are set against its later ones. With the
 * starter as the reference and a fixed budget, this command is gate G2: 8 tasks, four solves under
 * the starter and two under the latest harness. The A/A comparison should read no step, and its
 * tie share is the noise every later comparison has to exceed.
 *
 * `--tasks` names the scored tasks by id, where the operator chooses them. Without it the scored
 * set is `--target` of the held-out tasks by the contract's draw. The solves a side, the level,
 * the Referee, the budgets, the cap and the solver's four flags are a round's, with a round's
 * defaults (`round.ts`), and `--cap` is required as it is there. With no `--reviewer`, every
 * rejection waits for a person and sets its task aside until `tools/d2/settle.ts` has its labels.
 *
 * Run again with the same `--id`, it goes on from its log, and once it has reported it says what
 * it said.
 *
 * Not run here: see `campaign.ts`.
 */
import type { ThinkingLevel } from "@earendil-works/pi-ai";
import { checkpoint, type Report } from "#src/builder/round.ts";
import { read } from "#src/kernel/log.ts";
import { stopRule } from "#src/kernel/reports.ts";
import type { TaskPackage } from "#src/kernel/task.ts";
import { parseArgs } from "#src/meta/process.ts";
import { modelNamed } from "../m0/stored-sweep.ts";
import { awaitingLines, starter, keptAs, openCampaign, stayAwake } from "./campaign.ts";
import {
  budgetsNamed,
  capNamed,
  COMPARISON_OPTIONS,
  ROUND_OPTIONS,
  scoredNamed,
  type Seated,
  solved,
  targetNamed,
  validLines,
} from "./round.ts";
import { SETTING_OPTIONS, settingNamed } from "./setting.ts";

const OPTIONS = {
  root: ROUND_OPTIONS.root,
  sweep: ROUND_OPTIONS.sweep,
  cycle: ROUND_OPTIONS.cycle,
  bundle: ROUND_OPTIONS.bundle,
  name: ROUND_OPTIONS.name,
  id: { type: "string" },
  new: { type: "string", default: "latest" },
  noise: { type: "boolean", default: false },
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
  const target = targetNamed(values.target);
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
  if (old.digest === fresh.digest) {
    throw new Error(
      `--reference ${values.reference} and --new ${values.new} name one harness, ${old.digest}: there is nothing to compare${values.new === "latest" ? " until a Builder session has left a harness (tools/d2/round.ts)" : ""}. A harness is read against itself beside a comparison, with --noise`,
    );
  }
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
    starter: await starter(campaign),
    tasks: scoredNamed(campaign, values.tasks, target),
    solves: Number(values.solves),
    level: Number(values.level),
    defects: Number(values.defects),
    noise: values.noise,
    budgets,
    cap,
    concurrency: setting.limits.concurrency,
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

if (import.meta.main) await checkpointCommand(Bun.argv.slice(2));
