/**
 * One Builder session over a campaign, with no comparison after it.
 *
 *   bun tools/d2/session.ts --name truss --session b-2 --builder claude/claude-opus-5-5 --cap 150
 *
 * Before its first event the session asks whether it may start (`admitSession`,
 * `src/campaign/admission.ts`): on a checker nobody has read, or after the stop rule has
 * stopped the campaign, it starts nothing. `--past-stop "<why>"` goes on past the stop rule.
 *
 * A simulation runs this same command with a script in its seats
 * (`bun run runs rehearse --no-comparison`).
 */
import { admitSession } from "#src/campaign/admission.ts";
import { sessionOnce, type BuildRequest } from "#src/builder/session.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { parseArgs } from "#src/meta/process.ts";
import { keptAs, packNamed, PROMOTED, stayAwake } from "./campaign.ts";
import {
  campaignFor,
  parentNamed,
  predictionNamed,
  reviewersNamed,
  type Seated,
  SESSION_OPTIONS,
  sessionNamed,
  solved,
} from "./round.ts";
import { keepSetting } from "./setting.ts";

/** `bun tools/d2/session.ts`, and under a simulation's `seated` the same session with its seats
 *  scripted. Returns what the session left: the harness it froze, or null where it left the one it
 *  started from. */
export async function sessionCommand(
  args: readonly string[],
  seated: Seated = solved,
  campaignTools?: BuildRequest["campaign"],
) {
  const { values } = parseArgs({ args: [...args], options: SESSION_OPTIONS });
  const { session } = values;
  const pack = packNamed(values, " and --session");
  if (session === undefined) throw new Error("name --session, the id the session takes in the log");
  const { cap, setting, campaign } = await campaignFor(values, pack, seated);
  const parent = await parentNamed(campaign, { ...values, session });
  // A scripted solve is told from its harness which side of a comparison it stands on, and a
  // practice solve stands on none: it is seated against the campaign's reference harness.
  const reference = await keptAs(campaign, "--reference", PROMOTED);
  const seats = seated(campaign, { builder: values.builder, reference: reference.dir });
  const request = sessionNamed(
    campaign,
    { ...values, session },
    {
      parent,
      reference: reference.dir,
      limits: setting.named.limits,
      seats,
      reviewers: reviewersNamed(campaign, values),
    },
  );
  // Asked last of all that can refuse, and before anything is recorded.
  const notes = admitSession(campaign.log, {
    id: session,
    wanted: {
      cap: cap ?? null,
      pastStop: predictionNamed(values["past-stop"]),
      practiceSolves: Number(values["practice-solves"]),
    },
    seats: seats.paid ? "paid" : "scripted",
  });
  for (const note of notes) console.log(`· ${note}`);
  keepSetting(campaign.log, setting);
  stayAwake();
  const { kept, broken } = await sessionOnce({ ...request, cap, ...keyIfDefined("campaign", campaignTools) });
  console.log(JSON.stringify({ session, harness: kept?.digest ?? null, broken }, null, 2));
  console.log(
    kept === null
      ? `session ${session} left the harness it started from: there is nothing of it to compare`
      : `session ${session} left harness ${kept.digest}: tools/d2/checkpoint.ts --new latest compares it`,
  );
  return kept;
}

if (import.meta.main) await sessionCommand(Bun.argv.slice(2));
