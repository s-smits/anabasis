/**
 * One Builder session over a campaign, with no comparison after it. `admitSession` refuses it on an
 * unread checker or after the stop rule stopped the campaign, unless `--past-stop "<why>"`. A
 * rehearsal runs the same command with scripted seats (`bun run runs rehearse --no-comparison`).
 *
 *   bun tools/campaign/session.ts --name truss --session b-2 --builder claude/claude-opus-5-5 --cap 150
 */
import { CLAUDE_SESSIONS_DIR } from "#src/agent/backends/claude-transcript.ts";
import { admitSession } from "#src/campaign/admission.ts";
import { sessionOnce, type BuildRequest } from "#src/builder/session.ts";
import { keyIfDefined, keysIf } from "#src/meta/optional-key.ts";
import { dirname, join } from "#src/meta/path.ts";
import { parseArgs } from "#src/meta/process.ts";
import { hostSession, resolveCheckpoint, packNamed, PROMOTED, stayAwake } from "./campaign.ts";
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
import { FORK_OPTIONS, seatForkPlan } from "./seat-fork.ts";
import { keepSetting } from "./setting.ts";

const OPTIONS = { ...SESSION_OPTIONS, ...FORK_OPTIONS } as const;

/** `bun tools/campaign/session.ts`, and under a simulation's `seated` the same session with scripted
 *  seats. Returns the harness it froze, or null where it left its parent. */
export async function sessionCommand(
  args: readonly string[],
  seated: Seated = solved,
  campaignTools?: BuildRequest["campaign"],
) {
  const { values } = parseArgs({ args: [...args], options: OPTIONS });
  const { session } = values;
  const pack = packNamed(values, " and --session");
  if (session === undefined) throw new Error("name --session, the id the session takes in the log");
  const { cap, setting, campaign } = await campaignFor(values, pack, seated);
  const parent = await parentNamed(campaign, { ...values, session });
  // A practice solve stands on no side of a comparison, so it is seated against the reference harness.
  const reference = await resolveCheckpoint(campaign, "--reference", PROMOTED);
  const seats = seated(campaign, { builder: values.builder, reference: reference.dir });
  const baseRequest = sessionNamed(
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
  const forkPlan = seatForkPlan(campaign.log, "build", baseRequest.model, values);
  const request: BuildRequest = {
    ...baseRequest,
    ...keysIf(forkPlan.fork !== undefined, () => ({
      models: hostSession({
        webSearch: true,
        cacheTtl: "1h",
        persistDir: join(dirname(campaign.log), CLAUDE_SESSIONS_DIR),
        fork: forkPlan.fork,
      }),
    })),
    ...keyIfDefined("continuation", forkPlan.continuation),
  };
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
      : `session ${session} left harness ${kept.digest}: tools/campaign/checkpoint.ts --new latest compares it`,
  );
  return kept;
}

if (import.meta.main) await sessionCommand(Bun.argv.slice(2));
