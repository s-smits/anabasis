/**
 * Shared campaign log discovery across the archive and worktrees for skill scripts (`replay.ts`,
 * `table.ts`, `trend.ts`, `starter-reads.ts`).
 *
 * By default, discovery queries the production registry and refreshed peer records across all
 * configured hosts. Passing an explicit `home` directory scans offline layouts via `campaignsIn`
 * (a directory of worktrees, a `data/runs` archive, or a single host's campaign folder), keeping
 * the largest copy of each campaign name. Excludes seeds (`seed.json`, unless explicitly named),
 * scratch prefixes (`sim-`, `rh-`, `test-`), and scripted rehearsals (`faux/` models, checked via
 * `rehearsed`).
 */
import type { LogEvent } from "#src/kernel/log.ts";
import { closeSync, fstatSync, openSync, readdirSync, readSync, statSync } from "#src/meta/filesystem.ts";
import { parseJsonAs } from "#src/meta/json-runtime.ts";
import { asRecord, isString } from "#src/meta/json-shape.ts";
import { join } from "#src/meta/path.ts";
import { CAMPAIGNS, campaignsIn, type Run, wholeLines } from "#tools/runs/registry.ts";
import { readableAcross } from "#tools/runs/snapshots.ts";

export type Found = Pick<Run, "name" | "path" | "archived">;

/** Tail byte window read to extract a log's final event timestamp without reading the entire file. */
const TAIL = 65_536;
const LEFT_OUT = ["sim-", "rh-", "test-"] as const;

/** Returns the `at` timestamp of the last complete event in `path` (reading from the tail when
 *  possible, or the full file if the final event exceeds `TAIL`), or `""` if empty. */
export function lastAt(path: string): string {
  const fd = openSync(path, "r");
  try {
    const start = Math.max(0, fstatSync(fd).size - TAIL);
    const buffer = Buffer.alloc(TAIL);
    const tail = buffer.subarray(0, readSync(fd, buffer, 0, TAIL, start)).toString("utf8");
    const lines = (start > 0 && tail.split("\n").length > 2 ? tail : wholeLines(path)).split("\n");
    const last = lines.at(-2);
    return last === undefined || last === "" ? "" : parseJsonAs<LogEvent>(last).at;
  } finally {
    closeSync(fd);
  }
}

/** Discovers all campaign logs under `home` (keeping the largest file per campaign name and
 *  excluding unnamed seeds and `LEFT_OUT` prefixes). */
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

/** Returns discovered campaign logs filtered by explicit `names` (when non-empty) or `lastAt >= since`. */
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
  return all.filter(({ name, path }) => (names.length > 0 ? names.includes(name) : lastAt(path) >= since));
}

/** Returns `true` when `events` came from a scripted rehearsal (`faux/` seat or solver model). */
export function rehearsed(events: readonly LogEvent[]): boolean {
  const models = events.flatMap(({ kind, data }) => {
    if (kind === "campaign.setting") return [asRecord(data.solver)?.model];
    if (kind !== "campaign.opened") return [];
    return Object.values(asRecord(data.seats) ?? {}).map((seat) => asRecord(seat)?.model);
  });
  return models.some((model) => isString(model) && model.startsWith("faux/"));
}
