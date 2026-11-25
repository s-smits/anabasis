/** Campaign log discovery across the archive and worktrees for skill scripts. */
import type { LogEvent } from "#src/kernel/log.ts";
import { closeSync, fstatSync, openSync, readdirSync, readSync, statSync } from "#src/meta/filesystem.ts";
import { parseJsonAs } from "#src/meta/json-runtime.ts";
import { asRecord, isString } from "#src/meta/json-shape.ts";
import { join } from "#src/meta/path.ts";
import { CAMPAIGNS, campaignsIn, type Run } from "#tools/runs/registry.ts";
import { readableAcross } from "#tools/runs/snapshots.ts";

export type Found = Pick<Run, "name" | "path" | "archived">;

/** Tail byte window read for a log's last event timestamp without reading the whole file. */
const [TAIL, NEWLINE] = [65_536, 0x0a];
const LEFT_OUT = ["sim-", "rh-", "test-"] as const;

/** Grows the window when the final event exceeds `TAIL`; `""` if empty. */
export function lastAt(path: string): string {
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    if (size === 0) return "";
    for (let window = TAIL; ; window *= 2) {
      const len = Math.min(size, window);
      const start = size - len;
      const buf = Buffer.allocUnsafe(len);
      const got = readSync(fd, buf, 0, len, start);
      const end = buf.lastIndexOf(NEWLINE, got - 1);
      if (end <= 0) {
        if (start === 0) return "";
        continue;
      }
      const prev = buf.lastIndexOf(NEWLINE, end - 1);
      if (prev === -1 && start > 0) continue;
      const line = buf.toString("utf8", prev + 1, end);
      return line === "" ? "" : parseJsonAs<LogEvent>(line).at;
    }
  } finally {
    closeSync(fd);
  }
}

/** Keeps the largest file per campaign name and excludes unnamed seeds and `LEFT_OUT` prefixes. */
function everyLog(
  home: string,
  names: readonly string[],
  match: ((name: string) => boolean) | null,
): Found[] {
  const largest = new Map<string, { path: string; size: number }>();
  const found = [home, ...readdirSync(home).map((entry) => join(home, entry))].flatMap((dir) => [
    ...campaignsIn(dir, dir),
    ...campaignsIn(join(dir, CAMPAIGNS), dir),
  ]);
  for (const { name, path, seed } of found) {
    if ((seed === true && !names.includes(name)) || LEFT_OUT.some((prefix) => name.startsWith(prefix))) {
      continue;
    }
    if (match !== null && !match(name)) continue;
    const { size } = statSync(path);
    if (size > (largest.get(name)?.size ?? -1)) largest.set(name, { path, size });
  }
  return [...largest]
    .map(([name, { path }]) => ({ name, path }))
    .toSorted((a, b) => (a.name < b.name ? -1 : 1));
}

/** Filtered by explicit `names` when given, else by `lastAt >= since`. */
export async function campaignLogs(
  home: string | null,
  names: readonly string[],
  since: string,
  match: ((name: string) => boolean) | null = null,
): Promise<Found[]> {
  const all =
    home === null
      ? (await readableAcross(names)).filter(
          (run) =>
            (run.seed !== true || names.includes(run.name)) &&
            !LEFT_OUT.some((prefix) => run.name.startsWith(prefix)) &&
            (match === null || match(run.name)),
        )
      : everyLog(home, names, match);
  return all.filter(({ name, path }) => (names.length > 0 ? names.includes(name) : lastAt(path) >= since));
}

/** A scripted rehearsal is one with a `faux/` seat or solver model. */
export function rehearsed(events: readonly LogEvent[]): boolean {
  const models = events.flatMap(({ kind, data }) => {
    if (kind === "campaign.setting") return [asRecord(data.solver)?.model];
    if (kind !== "campaign.opened") return [];
    return Object.values(asRecord(data.seats) ?? {}).map((seat) => asRecord(seat)?.model);
  });
  return models.some((model) => isString(model) && model.startsWith("faux/"));
}
