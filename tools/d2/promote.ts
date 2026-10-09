/**
 * Promote a harness the campaign keeps to be its reference harness: the operator's word, with a
 * record.
 *
 *   bun tools/d2/promote.ts --name buffer --harness latest [--yes]
 *
 * A comparison is made against the campaign's reference harness, which is the Starter Built
 * Harness until the operator promotes another (`docs/plan.md`, Phase 6). Until 2026-10-09 a
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
 * The choice is the operator's, and nothing here judges it: the plan promotes a step once it has
 * been repeated on fresh solves, and that rule is not enforced yet (the fix plan's F28).
 *
 * It starts no solve and calls no model.
 */
import { append, read } from "#src/kernel/log.ts";
import { comparedAs, promoted } from "#src/kernel/reports.ts";
import { dirname, join } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { campaignLog, keptAs, starter } from "./campaign.ts";

const { values } = parseArgs({
  options: {
    name: { type: "string" },
    harness: { type: "string" },
    yes: { type: "boolean", default: false },
  },
});

async function main(): Promise<number> {
  const { name, harness } = values;
  if (name === undefined || harness === undefined) throw new Error("name --name and --harness");
  const log = campaignLog(name);
  const campaign = { log, states: join(dirname(log), "states") };
  const events = read(log);
  const [kept, least] = [await keptAs(campaign, "--harness", harness), await starter(campaign)];
  const now = promoted(events) ?? least.digest;
  const said = (digest: string) => (digest === least.digest ? "the starter" : digest);
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
  if (!values.yes) {
    console.log("nothing is recorded without --yes");
    return 0;
  }
  append(log, "harness.promoted", { harness: kept.digest, from: now, rests });
  console.log(
    `${said(kept.digest)} is the reference harness from here on: a comparison that names no --reference is made against it`,
  );
  return 0;
}

runtimeProcess.exitCode = await main();
