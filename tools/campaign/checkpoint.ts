/**
 * One comparison of two harnesses a campaign keeps, on its held-out tasks, with no Builder session.
 *
 *   bun tools/campaign/checkpoint.ts --name truss --id g-2 --target 8 --cap 437
 */
import { admitComparison } from "#src/campaign/admission.ts";
import type { Report } from "#src/campaign/comparison.ts";
import { type CheckpointRequest, checkpoint, refuseTerms } from "#src/campaign/round.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { parseArgs } from "#src/meta/process.ts";
import { resolveCheckpoint, PACK_OPTIONS, packNamed, stayAwake } from "./campaign.ts";
import {
  campaignFor,
  COMPARISON_OPTIONS,
  comparedOn,
  reviewersNamed,
  type Seated,
  solved,
  printReport,
  wantedNamed,
} from "./round.ts";
import { keepSetting, SETTING_OPTIONS } from "./setting.ts";

const STANDALONE_OPTIONS = {
  ...PACK_OPTIONS,
  id: { type: "string" },
  new: { type: "string", default: "latest" },
  ...SETTING_OPTIONS,
  ...COMPARISON_OPTIONS,
} as const;

/** `bun tools/campaign/checkpoint.ts`, and under a simulation's `seated` the same comparison with its
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
  const old = await resolveCheckpoint(campaign, "--reference", values.reference);
  const fresh = await resolveCheckpoint(campaign, "--new", values.new);
  const reviewers = reviewersNamed(campaign, values);
  const seats = seated(campaign, { builder: undefined, reference: old.dir });
  const request: CheckpointRequest = {
    log: campaign.log,
    id,
    old,
    fresh,
    ...(await comparedOn({ campaign, setting, cap }, values, seats, reviewers, fresh.digest)),
    ...keyIfDefined("kill", kill),
  };
  const own = () => {
    if (old.digest === fresh.digest) {
      throw new Error(
        `--reference ${values.reference} and --new ${values.new} name one harness, ${old.digest}: there is nothing to compare${values.new === "latest" ? " until a Builder session has left a harness" : ""}. A harness is read against itself beside every comparison`,
      );
    }
    refuseTerms(request, { log: campaign.log, id });
  };
  // Every refusal comes before anything is recorded, as in a round: the admission's, then the
  // comparison's own terms, then the campaign's setting.
  const notes = admitComparison(campaign.log, {
    id,
    wanted: wantedNamed(values, { setting, cap, builds: false, judged: request.judge !== undefined }),
    seats: seats.paid ? "paid" : "scripted",
    own,
  });
  for (const note of notes) console.log(`· ${note}`);
  // What the caller records once the comparison is admitted: a led Builder's move.
  admitted?.();
  keepSetting(campaign.log, setting);
  stayAwake();
  const report = await checkpoint(request);
  printReport(campaign, id, report);
  return report;
}

if (import.meta.main) {
  const args = Bun.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    const flags = Object.keys(STANDALONE_OPTIONS)
      .map((name) => `--${name}`)
      .join(" ");
    console.log(`bun tools/campaign/checkpoint.ts --name <name> --id <id> [options]\n  options: ${flags}`);
  } else {
    await checkpointCommand(args);
  }
}
