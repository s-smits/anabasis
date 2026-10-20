/**
 * Promote a harness the campaign keeps to be its reference harness: the operator's word, with a
 * record.
 *
 *   bun tools/d2/promote.ts --name buffer --harness latest [--yes]
 *
 * A comparison is made against the campaign's reference harness, which is the Starter Built
 * Harness until the operator promotes another (`7f0add79:docs/plan.md`, Phase 6). Until 2026-10-09 a
 * promotion was `--reference <digest>` on one command: nothing recorded it, and the next command
 * without the flag was read against the starter again. Here it is an event, `harness.promoted`,
 * and every command that compares reads its reference from the last one (`promoted`,
 * `src/kernel/reports.ts`).
 *
 * `--harness` names a harness the campaign keeps, as any flag does (`campaign.ts`, `keptAs`):
 * `latest`, the whole digest of one a session froze, or `starter`, which returns the campaign to
 * the starter. The command says what the log holds of that harness, each comparison it was the
 * new harness of with what it was read against and how it read, and what the reference is now.
 * Without `--yes` it records nothing. With it the event is written, with the comparisons it rests
 * on, so that a reader of the log sees what the operator saw.
 *
 * The plan promotes a harness a comparison against the reference read as a step (`7f0add79:docs/plan.md`,
 * row F28; until 19 October once that step was read again on fresh solves). That rule is move 7's (`unpromoted`, `src/builder/decide.ts`),
 * and it is asked here: a harness it would not promote now is refused, with the reason. The
 * choice stays the operator's: `--despite "<why>"` promotes all the same, and the event keeps the
 * reason. Returning the campaign to the starter is asked nothing. Until 2026-10-09 nothing held a
 * promotion to the rule, and one comparison is one draw.
 *
 * It starts no solve and calls no model.
 */
import { unpromoted } from "#src/builder/decide.ts";
import { openingOf, planOf } from "#src/builder/opening.ts";
import { append, read } from "#src/kernel/log.ts";
import { comparedAs, promoted } from "#src/kernel/reports.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { dirname, join } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { namesOf } from "#src/builder/names.ts";
import { campaignLog, keptAs, starter } from "./campaign.ts";
import { COMPARISON_OPTIONS } from "./round.ts";

const OPTIONS = {
  name: { type: "string" },
  harness: { type: "string" },
  yes: { type: "boolean", default: false },
  despite: { type: "string" },
} as const;

/** `bun tools/d2/promote.ts`. It returns the command's exit code. */
export async function promoteCommand(args: readonly string[]): Promise<number> {
  const { values } = parseArgs({ args: [...args], options: OPTIONS });
  const { name, harness } = values;
  if (name === undefined || harness === undefined) throw new Error("name --name and --harness");
  const log = campaignLog(name);
  const campaign = { log, states: join(dirname(log), "states") };
  const events = read(log);
  const [kept, least] = [await keptAs(campaign, "--harness", harness), await starter(campaign)];
  const now = promoted(events) ?? least.digest;
  // A harness by its letter (`namesOf`) beside its whole digest, which `--harness` takes.
  const names = namesOf(events);
  const said = (digest: string) =>
    digest === least.digest ? "the starter" : `${names.get(digest) ?? "harness"} ${digest}`;
  if (kept.digest === now) {
    console.log(`${said(kept.digest)} is the campaign's reference harness already`);
    return 0;
  }
  const rests = comparedAs(events, kept.digest);
  console.log(`the reference harness is ${said(now)}`);
  console.log(
    rests.length === 0
      ? `no comparison on record measured ${said(kept.digest)}`
      : `${said(kept.digest)} was measured in:`,
  );
  for (const { comparison, against, reading } of rests) {
    console.log(`  ${comparison}: against ${said(against)}, read ${reading}`);
  }
  // The level is the opening's where it names one, and the default otherwise.
  const terms = openingOf(events)?.terms;
  const plan = planOf(events, {
    unprepared: false,
    level: Number(terms?.level ?? COMPARISON_OPTIONS.level.default),
  });
  const why = kept.digest === least.digest ? null : unpromoted(events, plan, kept.digest);
  if (why !== null) console.log(`the plan would not promote it now: ${why}`);
  if (!values.yes) {
    console.log("nothing is recorded without --yes");
    return 0;
  }
  const despite = values.despite?.trim() ?? "";
  if (why !== null && despite === "") {
    console.log(
      'not promoted: a harness is promoted where a comparison against the reference read a step. It is yours to promote all the same: say why with --despite "<why>"',
    );
    return 1;
  }
  append(log, "harness.promoted", {
    harness: kept.digest,
    from: now,
    rests,
    ...keyIfDefined("despite", why === null ? undefined : despite),
  });
  console.log(
    `${said(kept.digest)} is the reference harness from here on: a comparison that names no --reference is made against it`,
  );
  return 0;
}

if (import.meta.main) runtimeProcess.exitCode = await promoteCommand(Bun.argv.slice(2));
