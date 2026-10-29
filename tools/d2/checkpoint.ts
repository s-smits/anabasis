/**
 * One comparison of two harnesses a campaign keeps, on its held-out tasks, with no Builder session.
 *
 *   bun tools/d2/checkpoint.ts --root ../anabasis-cycles-4c67fc --sweep veryhard-hb-4c67fc --cycle c01 \
 *     --bundle ../anabasis-cycles-4c67fc/fixture/round4-veryhard-workspace --name truss --id g2 \
 *     --target 8 --cap 437
 *
 * With no `--reference` and no `--new` it compares the latest harness a Builder session left with
 * the Starter Built Harness, which is the plan's standalone comparison: several sessions, then one comparison
 * on fresh solves (`7f0add79:docs/plan.md`, Phase 5). While no session has left a harness there is nothing
 * to compare, and the command says so. The plan's first experiment is no standalone comparison: it is the
 * first round (`round.ts`).
 *
 * `--reference` and `--new` each name a harness the campaign keeps (`campaign.ts`, `keptAs`):
 * `starter`, `latest`, or the whole digest of one a session froze. So the same command compares a
 * harness with a promoted reference, and reads a harness against the starter where a settling, a stop or the cap left a step unread
 * against it (`--reference starter --new <digest>`).
 *
 * `programs-of:` before a name is that harness's programs ablation: the starter with the harness's installed
 * programs and nothing else of it. `--reference starter --new programs-of:latest` reads what the
 * programs are worth by themselves, and `--reference programs-of:latest --new latest` what the
 * guide and the tools add to them. A step is the whole harness's until those two are read.
 *
 * The report also reads the reference harness against itself,
 * the plan's A/A comparison, on halves of its own solves mirrored in time (`comparison.ts`). With
 * the starter as the reference and a fixed budget, this command reads the plan's starter A/A comparison (G2).
 * The A/A comparison
 * should read no step, and its tie share is the noise every later comparison has to exceed.
 *
 * The scored set and the solver's setting are the campaign's, read from its log as a round reads
 * them (`setting.ts`): `--target`, and the solver's flags, name them only where the
 * campaign has recorded none. Until 19 October a repeat, the comparison that followed one of the
 * same two harnesses whose reading cleared `--trigger`, scored that one's untied tasks again; one
 * reading promotes since. The solves a side, the level, the Referee and the cap are a round's, with a round's defaults
 * (`round.ts`), and `--cap` is required as it is there. With no `--reviewer`, every rejection
 * waits for a person and sets its task aside until `tools/d2/settle.ts` has its labels.
 *
 * Before its first event it asks whether the comparison may start, as a round does
 * (`src/campaign/admission.ts`). `--past-stop "<why>"` goes on past the plan's
 * stop rule, and the reason is logged.
 *
 * Run again with the same `--id`, it goes on from its log, and once it has reported it says what
 * it said.
 *
 * Not run here: see `campaign.ts`.
 */
import { admitComparison } from "#src/campaign/admission.ts";
import type { Report } from "#src/campaign/comparison.ts";
import { type CheckpointRequest, checkpoint, refuseTerms, scoredSet } from "#src/campaign/round.ts";
import { SIZE } from "#src/kernel/size.ts";
import { contractHash } from "#src/kernel/contract.ts";
import { read } from "#src/kernel/log.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { parseArgs } from "#src/meta/process.ts";
import { keptAs, packNamed, starter, stayAwake } from "./campaign.ts";
import {
  campaignFor,
  predictionNamed,
  COMPARISON_OPTIONS,
  objectiveNamed,
  packaged,
  reviewersNamed,
  ROUND_OPTIONS,
  type Seated,
  solved,
  printReport,
  wantedNamed,
} from "./round.ts";
import { keepSetting, SETTING_OPTIONS } from "./setting.ts";

/** A standalone comparison's flags and their defaults. */
const STANDALONE_OPTIONS = {
  root: ROUND_OPTIONS.root,
  sweep: ROUND_OPTIONS.sweep,
  cycle: ROUND_OPTIONS.cycle,
  bundle: ROUND_OPTIONS.bundle,
  name: ROUND_OPTIONS.name,
  id: { type: "string" },
  new: { type: "string", default: "latest" },
  ...SETTING_OPTIONS,
  ...COMPARISON_OPTIONS,
} as const;

/** `bun tools/d2/checkpoint.ts`, and under a simulation's `seated` the same comparison with its
 *  solver scripted. */
export async function checkpointCommand(
  args: readonly string[],
  seated: Seated = solved,
  kill?: AbortSignal,
  admitted?: () => void,
): Promise<Report> {
  const { values } = parseArgs({ args: [...args], options: STANDALONE_OPTIONS });
  const { id } = values;
  const pack = packNamed(values, " and --id");
  if (id === undefined) throw new Error("name --id, the id the comparison takes in the log");
  if (kill?.aborted === true) throw new Error(`comparison ${id} was stopped before it began`);
  const { cap, setting, campaign } = await campaignFor(values, pack, seated);
  const packageOf = packaged(campaign);
  const old = await keptAs(campaign, "--reference", values.reference);
  const fresh = await keptAs(campaign, "--new", values.new);
  const reviewers = reviewersNamed(campaign, values);
  const seats = seated(campaign, { builder: undefined, reference: old.dir });
  const request: CheckpointRequest = {
    log: campaign.log,
    id,
    old,
    fresh,
    starter: await starter(campaign),
    ...scoredSet(read(campaign.log), setting.target, contractHash(campaign.contract)),
    solves: SIZE.solves,
    level: Number(values.level),
    objective: objectiveNamed(campaign),
    defects: Number(values.defects),
    cap,
    prediction: predictionNamed(values.predict),
    concurrency: setting.named.limits.concurrency,
    solve: (version, harness, comparison, signal) =>
      seats.solve(packageOf(version), harness, signal, comparison),
    setting: seats.setting,
    referee:
      reviewers === null
        ? undefined
        : (solve, version, signal) => reviewers.referee(solve, packageOf(version), signal),
    ...keyIfDefined("kill", kill),
  };
  const own = () => {
    if (old.digest === fresh.digest) {
      throw new Error(
        `--reference ${values.reference} and --new ${values.new} name one harness, ${old.digest}: there is nothing to compare${values.new === "latest" ? " until a Builder session has left a harness (tools/d2/round.ts)" : ""}. A harness is read against itself beside every comparison`,
      );
    }
    refuseTerms(request, { log: campaign.log, id, practised: new Set() });
  };
  // Every refusal comes before anything is recorded, as in a round: the admission's, then the
  // comparison's own terms, and only then the campaign's setting.
  const notes = admitComparison(campaign.log, {
    id,
    wanted: wantedNamed(campaign, values, { setting, cap, builds: false }),
    seats: seats.paid ? "paid" : "scripted",
    own,
  });
  for (const note of notes) console.log(`· ${note}`);
  // What the caller records of the comparison once it is admitted: a led Builder's move (14 October).
  admitted?.();
  keepSetting(campaign.log, setting);
  stayAwake();
  const report = await checkpoint(request);
  printReport(campaign, id, report);
  return report;
}

if (import.meta.main) await checkpointCommand(Bun.argv.slice(2));
