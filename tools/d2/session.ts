/**
 * On 18 October 2026 the Builder-led mode retired: all 3 promotions followed the table,
 * while concurrent task writing caused 7 crashed conversations. The host owns each next move.
 *
 * One Builder session over a campaign, with no comparison after it.
 *
 *   bun tools/d2/session.ts --root ../anabasis-cycles-4c67fc --sweep veryhard-hb-4c67fc --cycle c01 \
 *     --bundle ../anabasis-cycles-4c67fc/fixture/round4-veryhard-workspace --name truss --session b-2 \
 *     --builder claude/claude-opus-5-5 --cap 150
 *
 * The plan's checkpoint is several sessions and then one comparison (`docs/plan.md`, Phase 5).
 * Until 2026-10-09 the only command that ran a session was a round, which compares what it leaves,
 * so several sessions cost several paid comparisons. This is the session by itself: it forks the
 * harness `--parent` names, `latest` by default, practises on the campaign's released tasks and
 * freezes what it leaves, which `tools/d2/checkpoint.ts --new latest` then compares. It scores
 * nothing and reads no held-out task.
 *
 * It is a round's session and not a second one: the same request (`sessionNamed`, `round.ts`) run
 * by the same function (`sessionOnce`, `src/builder/session.ts`), under the campaign's recorded
 * setting (`setting.ts`). Its flags are a round's without those of a comparison.
 *
 * `--cap` is the session's dollar cap and is required, as a comparison's is: no practice solve
 * starts that a reserve for it (`--reserve`, $10) would take past the cap. The Builder's own turns
 * are billed while the session is live, before another campaign move can spend more; the final
 * session total records them once. They are held by `--turns` and `--minutes`.
 *
 * Before its first event the session asks whether it may start (`admitSession`,
 * `src/builder/admission.ts`): on a checker nobody has read, or after the plan's stop rule has
 * stopped the campaign, it starts nothing. `--past-stop "<why>"` goes on past the stop rule.
 *
 * Run again with the same `--session`, it says what the session left, from the log.
 *
 * A simulation runs this same command with a script in its seats
 * (`bun run runs rehearse --no-comparison`).
 *
 * Not run here: see `campaign.ts`.
 */
import { admitSession } from "#src/builder/admission.ts";
import { sessionOnce } from "#src/builder/session.ts";
import { read } from "#src/kernel/log.ts";
import { solverLast } from "#src/kernel/solves.ts";
import { parseArgs } from "#src/meta/process.ts";
import { campaignLog, keptAs, openCampaign, packNamed, PROMOTED, stayAwake } from "./campaign.ts";
import {
  capNamed,
  parentNamed,
  predictionNamed,
  reviewersNamed,
  type Seated,
  SESSION_OPTIONS,
  sessionNamed,
  solved,
  solvingAs,
} from "./round.ts";
import { firstRecord, keepSetting, recordedSetting, settingAsked } from "./setting.ts";

/** `bun tools/d2/session.ts`, and under a simulation's `seated` the same session with its seats
 *  scripted. Returns what the session left: the harness it froze, or null where it left the one it
 *  started from. */
export async function sessionCommand(args: readonly string[], seated: Seated = solved) {
  const { values } = parseArgs({ args: [...args], options: SESSION_OPTIONS });
  const { session } = values;
  const pack = packNamed(values, " and --session");
  const { name } = pack;
  if (session === undefined) throw new Error("name --session, the id the session takes in the log");
  const paid = seated === solved ? "paid" : "scripted";
  // Read before the campaign is opened: a paid session with no cap starts nothing.
  const cap = capNamed(values, paid);
  const setting = settingAsked(values, recordedSetting(read(campaignLog(name))));
  const campaign = await openCampaign({ ...pack, ...setting.named });
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
      unrecorded: firstRecord(setting, solvingAs(campaign, setting.named), solverLast(read(campaign.log))),
    },
    seats: paid,
  });
  for (const note of notes) console.log(`· ${note}`);
  keepSetting(campaign.log, setting);
  stayAwake();
  const { kept, broken } = await sessionOnce({ ...request, cap });
  console.log(JSON.stringify({ session, harness: kept?.digest ?? null, broken }, null, 2));
  console.log(
    kept === null
      ? `session ${session} left the harness it started from: there is nothing of it to compare`
      : `session ${session} left harness ${kept.digest}: tools/d2/checkpoint.ts --new latest compares it`,
  );
  return kept;
}

if (import.meta.main) await sessionCommand(Bun.argv.slice(2));
