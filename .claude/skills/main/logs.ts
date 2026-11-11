/**
 * The campaign logs a skill script reads across the record, found one way for every skill: the
 * replay, the lab, the tables and the trend of promotion-tuner and the starter reads of
 * comparison-reading each list them here (until 11 November the list lived in promotion-tuner's
 * `tree.ts`, and comparison-reading reached into that skill for it).
 *
 * Default discovery uses the production registry and refreshed records on every configured host
 * (22 October 2026). An explicit home keeps the offline layouts the registry's `campaignsIn` reads:
 * a folder of worktrees, an archive (`data/runs`, a folder a host) or one host's folder of
 * campaigns, with the largest copy of each name there. Left out: a seed (`seed.json` beside its
 * log) unless named, as an investigation's snapshot is (until 4 November its derived replay read
 * none), a name that starts `sim-`, `rh-` or `test-`, and a rehearsal, whose seats are
 * `faux/script` (`rehearsed`, which a caller asks once it has read the log).
 */
import type { LogEvent } from "#src/kernel/log.ts";
import { closeSync, openSync, readdirSync, readSync, statSync } from "#src/meta/filesystem.ts";
import { asRecord, isString } from "#src/meta/json-shape.ts";
import { join } from "#src/meta/path.ts";
import { CAMPAIGNS, campaignsIn, type Run } from "#tools/runs/registry.ts";
import { readableAcross } from "#tools/runs/snapshots.ts";

export type Found = Pick<Run, "name" | "path" | "archived">;

/** Bytes read from a log's end to find its last event's time without reading the whole file. */
const TAIL = 65_536;
const LEFT_OUT = ["sim-", "rh-", "test-"] as const;
export const AT = '{"at":"';

/** The time of a log's last event, read from its end; null where the end holds no whole event. */
function lastAt(path: string): string | null {
  const size = statSync(path).size;
  const length = Math.min(size, TAIL);
  const buffer = Buffer.alloc(length);
  const fd = openSync(path, "r");
  try {
    readSync(fd, buffer, 0, length, size - length);
  } finally {
    closeSync(fd);
  }
  // The first line of the tail may be cut; a cut that starts as an event does starts one.
  const last = buffer
    .toString("utf8")
    .split("\n")
    .findLast((line) => line.startsWith(AT));
  return last?.slice(AT.length, AT.length + 24) ?? null;
}

/** Every campaign log under `home`, one a name, the largest where copies exist; seeds and the
 *  names of `LEFT_OUT` are not listed. `home` may be a folder of worktrees, an archive
 *  (`data/runs`, a folder a host) or one host's folder of campaigns: the registry's `campaignsIn`
 *  reads each layout. Until 30 October this walked worktrees alone, so a replay of the archive read
 *  no campaign. */
function everyLog(home: string, names: readonly string[]): Found[] {
  const largest = new Map<string, { path: string; size: number }>();
  const found = [home, ...readdirSync(home).map((entry) => join(home, entry))].flatMap((dir) => [
    ...campaignsIn(dir, dir),
    ...campaignsIn(join(dir, CAMPAIGNS), dir),
  ]);
  for (const { name, path, seed } of found) {
    if ((seed === true && !names.includes(name)) || LEFT_OUT.some((prefix) => name.startsWith(prefix))) {
      continue;
    }
    const { size } = statSync(path);
    if (size > (largest.get(name)?.size ?? -1)) largest.set(name, { path, size });
  }
  return [...largest]
    .map(([name, { path }]) => ({ name, path }))
    .toSorted((a, b) => (a.name < b.name ? -1 : 1));
}

/** The logs a reader takes: those `names` lists where it lists any, else those whose last event is
 *  at or after `since`. */
export async function campaignLogs(
  home: string | null,
  names: readonly string[],
  since: string,
): Promise<Found[]> {
  const all =
    home === null
      ? (await readableAcross(names)).filter(
          (run) =>
            (run.seed !== true || names.includes(run.name)) &&
            !LEFT_OUT.some((prefix) => run.name.startsWith(prefix)),
        )
      : everyLog(home, names);
  return all.filter(({ name, path }) =>
    names.length > 0 ? names.includes(name) : (lastAt(path) ?? "") >= since,
  );
}

/** Whether a log is a rehearsal's: a seat or its solver is `faux/script`. */
export function rehearsed(events: readonly LogEvent[]): boolean {
  const models = events.flatMap(({ kind, data }) => {
    if (kind === "campaign.setting") return [asRecord(data.solver)?.model];
    if (kind !== "campaign.opened") return [];
    return Object.values(asRecord(data.seats) ?? {}).map((seat) => asRecord(seat)?.model);
  });
  return models.some((model) => isString(model) && model.startsWith("faux/"));
}
