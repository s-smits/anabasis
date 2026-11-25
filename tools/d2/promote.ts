/**
 * Promote a harness the campaign keeps to be its reference: the operator's word, with a record.
 * Without a step on record it needs `--despite "<why>"`.
 *
 *   bun tools/d2/promote.ts --name buffer --harness latest [--yes] [--despite "<why>"]
 */
import { unpromoted } from "#src/campaign/scheduler.ts";
import { openingOf, planOf } from "#src/campaign/opening.ts";
import { append, read } from "#src/kernel/log.ts";
import { comparedAs, promoted } from "#src/kernel/reports.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { dirname, join } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { namesOf } from "#src/campaign/names.ts";
import { harnessNamed, resolveCheckpoint, starter } from "./campaign.ts";
import { COMPARISON_OPTIONS } from "./round.ts";

const OPTIONS = {
  name: { type: "string" },
  harness: { type: "string" },
  yes: { type: "boolean", default: false },
  despite: { type: "string" },
} as const;

export async function promoteCommand(args: readonly string[]): Promise<number> {
  const { values } = parseArgs({ args: [...args], options: OPTIONS });
  const { log, harness } = harnessNamed(values);
  const campaign = { log, states: join(dirname(log), "states") };
  const events = read(log);
  const [kept, least] = [await resolveCheckpoint(campaign, "--harness", harness), await starter(campaign)];
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
  // The opening's level where it names one, the default otherwise.
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
