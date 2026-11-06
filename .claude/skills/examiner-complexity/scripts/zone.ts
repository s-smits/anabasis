/**
 * Where a campaign's comparisons sit in the reference's power zone, one row a comparison:
 *
 *   bun .claude/skills/examiner-complexity/scripts/zone.ts <log or campaign name>...
 *
 * A comparison reads a step only on the tasks it leaves untied, and at 2 solves a side a task is most
 * likely to untie where the reference passes it some of the time (`AGENTS.md`, section 1). Each row
 * gives the reference's tasks with no, some and every solve valid, the tasks untied on validity and
 * on the objective alone, and the A/A comparison's untied tasks beside them, since between equal
 * harnesses a task passed half the time also unties, so a share that rises with noise says nothing
 * by itself. A task is tied or carried as the comparison reads it (`carriedBy`), so a residual below
 * half a point is a tie here as it is in the report. It is a reading and decides nothing. No prompt or tool names it, because an author told
 * a share writes towards it (`AGENTS.md`, section 2, consequence 2).
 *
 * A one-off reader of 5 November (`docs/backlog/examiner-power-zone.md`) found jobstat at the ceiling
 * before any promotion, and the operator asked for it on every run.
 */
import { carriedBy, pointsOf } from "#src/kernel/compare.ts";
import { type LogEvent, read } from "#src/kernel/log.ts";
import { lastReports, pairsReported } from "#src/kernel/reports.ts";
import { asRecord, isNumber, isString } from "#src/meta/json-shape.ts";
import { basename, dirname } from "#src/meta/path.ts";
import { runCommand } from "#skills/main/cli.ts";
import { logAcross } from "#tools/runs/snapshots.ts";

const COLUMNS = [
  "campaign",
  "comparison",
  "kind",
  "epoch",
  "reading",
  "tasks",
  "ref_none",
  "ref_some",
  "ref_all",
  "ref_valid_share",
  "untied_validity",
  "untied_objective",
  "tied",
  "untied_share",
  "aa_untied",
  "aa_share",
] as const;

const share = (part: number, whole: number) => (whole === 0 ? "" : (part / whole).toFixed(2));

/** The A/A's untied tasks out of its tasks, as the report holds them, or none where it held no A/A. */
function aaOf(noise: unknown): { untied: number; tasks: number } | null {
  const differences = asRecord(noise)?.differences;
  if (!Array.isArray(differences)) return null;
  return {
    untied: differences.filter((one) => isNumber(one) && one !== 0).length,
    tasks: differences.length,
  };
}

/** One row a comparison that tallied a task, in the order of `COLUMNS`. */
export function zoneRows(campaign: string, events: readonly LogEvent[]): string[][] {
  return lastReports(events).flatMap((report) => {
    const pairs = pairsReported(events, report);
    if (pairs.length === 0) return [];
    const counts = { none: 0, some: 0, all: 0, valid: 0, solves: 0, validity: 0, objective: 0, tied: 0 };
    for (const pair of pairs) {
      const valid = pair.old.filter(Boolean).length;
      counts.valid += valid;
      counts.solves += pair.old.length;
      counts[valid === 0 ? "none" : valid === pair.old.length ? "all" : "some"] += 1;
      counts[carriedBy(pointsOf(pair)) ?? "tied"] += 1;
    }
    const aa = aaOf(report.data.noise);
    return [
      [
        campaign,
        report.session,
        report.data.fresh === report.data.starter ? "starter" : "candidate",
        String(events.slice(0, report.index).filter(({ kind }) => kind === "harness.promoted").length),
        isString(report.data.reading) ? report.data.reading : "",
        String(pairs.length),
        String(counts.none),
        String(counts.some),
        String(counts.all),
        share(counts.valid, counts.solves),
        String(counts.validity),
        String(counts.objective),
        String(counts.tied),
        share(counts.validity + counts.objective, pairs.length),
        aa === null ? "" : String(aa.untied),
        aa === null ? "" : share(aa.untied, aa.tasks),
      ],
    ];
  });
}

if (import.meta.main) {
  const usage = "zone.ts <log or campaign name>...";
  await runCommand({ name: "zone", usage, positionals: [1, 100] }, async ({ positionals }) => {
    console.log(COLUMNS.join("\t"));
    for (const each of positionals) {
      const log = await logAcross(each);
      for (const row of zoneRows(basename(dirname(log)), read(log))) console.log(row.join("\t"));
    }
  });
}
