/**
 * `bun run runs seed --from <campaign folder> --name <name> [--before <session> | --events <n>]`
 *
 * A campaign is its folder: the log, the staged check program and the harness states its sessions
 * kept. A seed is a copy of one under another name in this worktree, with the log cut where a
 * question starts, so that the campaign's own commands (`tools/d2/campaign.ts`) go on from a
 * recorded position and the run that recorded it is never written.
 *
 * `--before` keeps what came before a Builder or an Examiner session started, which is where that
 * session stood. `--events` keeps the first n events, for a position inside a session: after a
 * round's `build.finished`, say, to walk its comparison again. With neither the whole log is kept.
 *
 * `seed.json` in the copy says where it came from and where it was cut. `rehearse` runs only where
 * that file is, since a scripted solve in a real campaign's log would be counted as a solve.
 *
 * Not copied: the launch receipts and outputs, which are the source run's. A kept harness state's
 * `.toolchain` still links to the tree the source keeps beside its states; a solve reads it behind
 * the wall and writes nothing there.
 */
import { read } from "#src/kernel/log.ts";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "#src/meta/filesystem.ts";
import { capturedJsonParse, capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { asRecord } from "#src/meta/json-shape.ts";
import { join, resolve } from "#src/meta/path.ts";
import { parseArgs } from "#src/meta/process.ts";
import { carriable, setsOf } from "../d2/campaign.ts";
import { SEED_FILE } from "./pulse.ts";

const LOG = "log.jsonl";
const SESSION_STARTS = new Set<unknown>(["build.started", "exam.started"]);

/** Where a seed's log is cut: before a session, after a count of events, or nowhere. */
export interface Cut {
  readonly before?: string | undefined;
  readonly events?: string | undefined;
}

/** How many of a log's `lines` a cut keeps. */
export function keptLines(lines: readonly string[], cut: Cut): number {
  if (cut.before !== undefined && cut.events !== undefined) {
    throw new Error("name --before or --events, not both");
  }
  if (cut.events !== undefined) {
    const count = Number(cut.events);
    if (!Number.isInteger(count) || count < 0 || count > lines.length) {
      throw new Error(`--events ${cut.events}: the log holds ${String(lines.length)} events`);
    }
    return count;
  }
  if (cut.before === undefined) return lines.length;
  const start = lines.findIndex((line) => {
    const event = asRecord(capturedJsonParse(line));
    return SESSION_STARTS.has(event?.kind) && asRecord(event?.data)?.session === cut.before;
  });
  if (start === -1) throw new Error(`the log holds no session ${cut.before}`);
  return start;
}

/** Copy the campaign in `from` to the folder `to`, its log cut, and say what the seed holds. */
export function seedCampaign(from: string, to: string, cut: Cut) {
  if (existsSync(to)) throw new Error(`${to} is there already: a seed takes a name of its own`);
  const source = join(from, LOG);
  if (!existsSync(source)) throw new Error(`${from} holds no ${LOG}: name a campaign's folder`);
  // A run still writing may have a torn last line, which is no event yet.
  const lines = readFileSync(source, "utf8").split("\n").slice(0, -1);
  const kept = keptLines(lines, cut);
  mkdirSync(to, { recursive: true });
  try {
    writeFileSync(
      join(to, LOG),
      lines
        .slice(0, kept)
        .map((line) => `${line}\n`)
        .join(""),
    );
    for (const part of ["checks", "states"]) {
      if (existsSync(join(from, part))) {
        cpSync(join(from, part), join(to, part), { recursive: true, verbatimSymlinks: true });
      }
    }
    const origin = { from: resolve(from), events: kept, of: lines.length, before: cut.before ?? null };
    writeFileSync(join(to, SEED_FILE), `${capturedJsonStringify(origin, null, 2)}\n`);
    // Read as this tree reads a log: an event kind it does not know is refused here, not mid-round.
    const events = read(join(to, LOG));
    return {
      ...origin,
      sets: setsOf(events),
      waiting: carriable(events).waiting.map(({ task }) => task.taskId),
    };
  } catch (error) {
    rmSync(to, { recursive: true, force: true });
    throw error;
  }
}

/** `bun run runs seed`. */
export async function seed(args: readonly string[]): Promise<void> {
  const { values } = parseArgs({
    args: [...args],
    options: {
      from: { type: "string" },
      name: { type: "string" },
      before: { type: "string" },
      events: { type: "string" },
    },
  });
  const { from, name, before, events } = values;
  if (from === undefined || name === undefined) {
    throw new Error(
      "usage: bun run runs seed --from <campaign folder> --name <name> [--before <session> | --events <n>]",
    );
  }
  const to = resolve(import.meta.dir, "..", "..", ".ana", "d2", name);
  const { sets, waiting, ...made } = seedCampaign(from, to, { before, events });
  console.log(
    `seeded ${name} from ${made.from}: ${String(made.events)} of ${String(made.of)} events${made.before === null ? "" : `, cut before session ${made.before}`}`,
  );
  console.log(
    `  ${String(sets.feasible.length)} feasible: ${String(sets.anchor.length)} anchor, ${String(sets.released.length)} released, ${String(sets.candidates.length)} held for screening, ${String(sets.admitted.length)} admitted; ${String(waiting.length)} past gate 3 waiting for controls`,
  );
  console.log(`  scripted  bun run runs rehearse ... --name ${name} --session <id>`);
  console.log(`  live      bun run runs launch ... --name ${name} --session <id>`);
}
