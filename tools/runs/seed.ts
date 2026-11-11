/**
 * `bun run runs seed --from <campaign folder> --name <name> [--before <session> | --events <n>]`
 *
 * A campaign is its folder: the log, the staged check program (or the staged exam it drafted), the
 * harness states its sessions kept and the notes each session left the next (`src/builder/memory.ts`). A seed is a copy of one under another name in this worktree, with the log cut where a
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
 * The Examiner's home comes with it only where it is still the one the cut stood with.
 *
 * Not copied: the receipts and outputs, which are the source run's, and the notes of a
 * session the cut log no longer holds, which a session run again under its id would otherwise find
 * in its place. The states come with the
 * tool trees kept beside them. A state frozen while its link named the tree by its whole path still
 * links to the source's tree; a solve reads it behind the wall and writes nothing there.
 */
import { LOG_FILE, read } from "#src/kernel/log.ts";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "#src/meta/filesystem.ts";
import { capturedJsonParse, capturedJsonStringify, parseJsonAs } from "#src/meta/json-runtime.ts";
import { asRecord, isString } from "#src/meta/json-shape.ts";
import { dirname, join, resolve } from "#src/meta/path.ts";
import { containsPath } from "#src/meta/path-containment.ts";
import { parseArgs } from "#src/meta/process.ts";
import { taskSets } from "#src/kernel/task.ts";
import { receipts } from "./receipt.ts";
import { CAMPAIGNS, SEED_FILE } from "./registry.ts";
import { logAcross } from "./snapshots.ts";

const SESSION_STARTS = new Set<unknown>(["build.started", "exam.started", "draft.started"]);
/** The endings that replace the Examiner's home, as its shell reads them (`src/examiner/shell.ts`). */
const HOME_ENDS = new Set<unknown>(["exam.finished", "draft.finished"]);

/** Where a seed's log is cut: before a session, after a count of events, or nowhere. */
export interface Cut {
  readonly before?: string | undefined;
  readonly events?: string | undefined;
}

/** How many of a log's `lines` a cut keeps. */
function keptLines(lines: readonly string[], cut: Cut): number {
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

/** How many of the first events of the seed in `folder` its source wrote: where its log was cut. */
export const seedCut = (folder: string): number =>
  parseJsonAs<{ events: number }>(readFileSync(join(folder, SEED_FILE), "utf8")).events;

/** Copy the campaign in `from` to the folder `to`, its log cut, and say what the seed holds. */
export function seedCampaign(from: string, to: string, cut: Cut) {
  if (existsSync(to)) throw new Error(`${to} is there already: a seed takes a name of its own`);
  const source = join(from, LOG_FILE);
  if (!existsSync(source)) throw new Error(`${from} holds no ${LOG_FILE}: name a campaign's folder`);
  // A run still writing may have a torn last line, which is no event yet.
  const lines = readFileSync(source, "utf8").split("\n").slice(0, -1);
  const kept = keptLines(lines, cut);
  mkdirSync(to, { recursive: true });
  try {
    writeFileSync(
      join(to, LOG_FILE),
      lines
        .slice(0, kept)
        .map((line) => `${line}\n`)
        .join(""),
    );
    const copy = (part: string) => {
      if (existsSync(join(from, part))) {
        cpSync(join(from, part), join(to, part), { recursive: true, verbatimSymlinks: true });
      }
    };
    // A campaign over a stored pack stages its checks beside the log; one that drafted its exam
    // stages the exam under `exams/<digest>/` (`tools/d2/exam.ts`), which a seed of it needs too.
    for (const part of ["checks", "exams", "states"]) copy(part);
    // Read as this tree reads a log: an event kind it does not know is refused here, not mid-round.
    const events = read(join(to, LOG_FILE));
    for (const { kind, data } of events) {
      if (kind === "build.started" && isString(data.session)) copy(join("memory", data.session));
    }
    // The Examiner's home is one folder each session replaces as it ends (`src/examiner/shell.ts`),
    // so it is the one the cut stood with only where no session ended after the cut. Until 26
    // October no seed copied it, and both arms of one simulation opened their Examiner on no home.
    const examinerHome =
      existsSync(join(from, "examiner-home")) &&
      !lines.slice(kept).some((line) => HOME_ENDS.has(asRecord(capturedJsonParse(line))?.kind));
    if (examinerHome) copy("examiner-home");
    const origin = {
      from: resolve(from),
      events: kept,
      of: lines.length,
      before: cut.before ?? null,
      examinerHome,
    };
    writeFileSync(join(to, SEED_FILE), `${capturedJsonStringify(origin, null, 2)}\n`);
    return { ...origin, sets: taskSets(events) };
  } catch (error) {
    rmSync(to, { recursive: true, force: true });
    throw error;
  }
}

/**
 * A frozen copy of a campaign that may still write, for an investigation to read while the run goes
 * on: the seed's copy with its log cut at the last whole line, and the launch receipts a seed leaves
 * out, from which the investigation reads the code each launch ran. The operator's word of
 * 4 November: an iteration opens on a snapshot, since a run that will not promote is never stopped
 * for its investigation. The copy lies outside `.ana/d2/`, so no registry lists it or continues it.
 * Whatever `to` holds is removed first, since a start killed while it copied leaves part of a copy
 * there: its one caller, `wri.ts start`, reaches it only for an investigation folder that holds no
 * shared instructions, which no start has finished. A `to` that holds the campaign or lies inside
 * it is refused, so the removal never reaches the run's own files.
 */
export function snapshotCampaign(from: string, to: string) {
  const [source, target] = [resolve(from), resolve(to)];
  if (containsPath(source, target) || containsPath(target, source)) {
    throw new Error(`${to} holds the campaign ${from} or lies inside it: snapshot it elsewhere`);
  }
  rmSync(target, { recursive: true, force: true });
  const made = seedCampaign(from, to, {});
  for (const { session } of receipts(join(from, LOG_FILE))) {
    cpSync(join(from, `launch-${session}.json`), join(to, `launch-${session}.json`));
  }
  return made;
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
  const to = join(resolve(import.meta.dir, "..", ".."), CAMPAIGNS, name);
  const source = existsSync(from) ? from : dirname(await logAcross(from));
  const { sets, ...made } = seedCampaign(source, to, { before, events });
  console.log(
    `seeded ${name} from ${made.from}: ${String(made.events)} of ${String(made.of)} events${made.before === null ? "" : `, cut before session ${made.before}`}`,
  );
  console.log(
    `  ${String(sets.held.length)} held out, ${String(sets.released.length)} released for practice`,
  );
  if (!made.examinerHome) {
    console.log("  no Examiner home: the source holds none, or a session after the cut replaced it");
  }
  console.log(`  scripted  bun run runs rehearse ... --name ${name} --session <id>`);
  console.log(`  live      bun tools/d2/harness-builder.ts ... --name ${name}, or a move's own command`);
}
