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
 * `--as-ran` puts the seed in a tree that holds the code the run ran at the cut (`treeAsRan`)
 * instead of this one, and `--points` prints where a seed can be cut and writes nothing.
 *
 * Not copied: the receipts and outputs, which are the source run's, and the notes of a
 * session the cut log no longer holds, which a session run again under its id would otherwise find
 * in its place. The states come with the
 * tool trees kept beside them. A state frozen while its link named the tree by its whole path still
 * links to the source's tree; a solve reads it behind the wall and writes nothing there.
 */
import { epochsOf } from "#src/campaign/climb.ts";
import { lastHost } from "#src/kernel/condition.ts";
import { LOG_FILE, type LogEvent, read } from "#src/kernel/log.ts";
import { lastReports } from "#src/kernel/reports.ts";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "#src/meta/filesystem.ts";
import { gitMaybe, mainTree } from "#src/meta/git.ts";
import { capturedJsonParse, capturedJsonStringify, parseJsonAs } from "#src/meta/json-runtime.ts";
import { asRecord, isString } from "#src/meta/json-shape.ts";
import { basename, dirname, join, resolve } from "#src/meta/path.ts";
import { containsPath } from "#src/meta/path-containment.ts";
import { parseArgs } from "#src/meta/process.ts";
import { compareCodeUnits } from "#src/meta/stable-json.ts";
import { taskSets } from "#src/kernel/task.ts";
import { codeOf } from "../d2/campaign.ts";
import { treeAt } from "./code.ts";
import { receipts } from "./receipt.ts";
import { CAMPAIGNS, logEvents, SEED_FILE } from "./registry.ts";
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

/** The whole lines of the log in `from`: a run still writing may have a torn last line, which is no
 *  event yet. */
function linesOf(from: string): string[] {
  const source = join(from, LOG_FILE);
  if (!existsSync(source)) throw new Error(`${from} holds no ${LOG_FILE}: name a campaign's folder`);
  return readFileSync(source, "utf8").split("\n").slice(0, -1);
}

/**
 * The tree that holds the code the campaign in `from` ran at the cut: the host code its last
 * condition at or before the cut names (`codeOf`), or, before any, the commit of the launch that
 * covers the cut, from a clean tree. The run's own tree is asked first, then a detached tree at that
 * launch's commit (`treeAt`), since `runs continue --at` leaves the run's tree at its last commit,
 * which is not the code of an earlier stretch. Refused where neither holds it.
 */
export function treeAsRan(from: string, cut: Cut, repo: string): string {
  const lines = linesOf(from);
  // Lines `append` wrote; `seedCampaign` reads the copy again and refuses an unknown kind.
  const events = lines.slice(0, keptLines(lines, cut)).map((line) => parseJsonAs<LogEvent>(line));
  const host = lastHost(events);
  const at = events.at(-1)?.at ?? "";
  const launches = receipts(join(from, LOG_FILE));
  const launch = launches.findLast((each) => compareCodeUnits(each.at, at) <= 0) ?? launches[0];
  const fits = (tree: string) =>
    host === undefined
      ? launch?.dirty === false && gitMaybe(tree, "rev-parse", "HEAD") === launch.commit
      : hostOf(tree) === host;
  const own = resolve(from, "..", "..", "..");
  const trees = new Set([
    ...(resolve(from, "..") === join(own, CAMPAIGNS) && own !== mainTree(repo) ? [own] : []),
    join(dirname(mainTree(repo)), `anabasis-${basename(from)}`),
  ]);
  const found = [...trees].find((tree) => fits(tree));
  if (found !== undefined) return found;
  const made = launch === undefined ? null : treeAt(repo, launch.commit);
  if (made !== null && fits(made)) return made;
  const ran =
    host?.slice(0, 8) ?? `no condition yet, launched at ${launch?.commit.slice(0, 9) ?? "no receipt"}`;
  throw new Error(
    `no tree holds the code ${basename(from)} ran by event ${String(events.length)} (${ran}${launch?.dirty === true ? ", from a dirty tree" : ""}): ${made === null ? "this repository holds no commit of its launch" : `${made} holds ${hostOf(made)?.slice(0, 8) ?? "no host code"}`}`,
  );
}

/** The host's code as a condition names it (`codeOf`), for a tree that holds it. */
export function hostOf(tree: string): string | undefined {
  const parts = ["src", "vendor", "package.json"].map((part) => join(tree, part));
  return parts.every((part) => existsSync(part)) ? codeOf(tree).host : undefined;
}

/** Where a seed of `events` can be cut, one line each as `--events` counts: the index of the event
 *  it keeps nothing from, its kind and session or solve, and a comparison's reading. Each Builder
 *  and Examiner session's start and a Builder's end, each promotion, each comparison's report and
 *  each starter read's start (`epochsOf`), and each Referee reading's first turn with the solve its
 *  finding names: a turn names its reader alone. */
export function pointsOf(events: readonly LogEvent[]): string[] {
  const starterReads = new Set(epochsOf(events).flatMap(({ starter_read }) => starter_read ?? []));
  const reports = new Map(lastReports(events).map((report) => [report.index, report.data.reading]));
  const solveOf = new Map(
    events.flatMap(({ kind, data }) => (kind === "referee.finding" ? [[data.reader, data.solve]] : [])),
  );
  const readers = new Set<unknown>();
  return events.flatMap(({ kind, data }, index) => {
    const row = (...parts: unknown[]) => [[index, kind, ...parts].map(String).join(" ")];
    if (SESSION_STARTS.has(kind) || kind === "build.finished") return row(data.session);
    if (kind === "harness.promoted") return row(data.harness);
    if (kind === "comparison.started" && isString(data.session) && starterReads.has(data.session)) {
      return row(data.session, "starter read");
    }
    if (reports.has(index)) return row(data.session, reports.get(index));
    if (kind !== "referee.turn" || readers.has(data.reader)) return [];
    readers.add(data.reader);
    return row("solve", solveOf.get(data.reader) ?? "with no finding");
  });
}

/** One line on whether `tree` holds the code the seed in `folder` ran at its cut. It informs and
 *  refuses nothing, since the after arm of a before-and-after simulation is meant to differ. */
export function codeLine(tree: string, folder: string): string {
  const here = hostOf(tree);
  const ran = lastHost(read(join(folder, LOG_FILE)));
  if (here === undefined) return `code: ${tree} holds no host code to read`;
  if (ran === undefined) return `code: ${here.slice(0, 8)} here; the seed records no condition by its cut`;
  return `code: ${here.slice(0, 8)} here, ${ran === here ? "the code" : `not the ${ran.slice(0, 8)}`} its source ran at the cut`;
}

/** Copy the campaign in `from` to the folder `to`, its log cut, and say what the seed holds. */
export function seedCampaign(from: string, to: string, cut: Cut) {
  if (existsSync(to)) throw new Error(`${to} is there already: a seed takes a name of its own`);
  const lines = linesOf(from);
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
      "as-ran": { type: "boolean", default: false },
      points: { type: "boolean", default: false },
    },
  });
  const { from, name, before, events, points } = values;
  if (from === undefined || (name === undefined && !points)) {
    throw new Error(
      "usage: bun run runs seed --from <campaign folder> (--points | --name <name> [--before <session> | --events <n>] [--as-ran])",
    );
  }
  const source = existsSync(from) ? from : dirname(await logAcross(from, points ? "record" : "whole"));
  if (points || name === undefined) {
    console.log(pointsOf(logEvents(join(source, LOG_FILE))).join("\n"));
    return;
  }
  const repo = resolve(import.meta.dir, "..", "..");
  const tree = values["as-ran"] ? treeAsRan(source, { before, events }, repo) : repo;
  const { sets, ...made } = seedCampaign(source, join(tree, CAMPAIGNS, name), { before, events });
  console.log(
    `seeded ${name} from ${made.from}: ${String(made.events)} of ${String(made.of)} events${made.before === null ? "" : `, cut before session ${made.before}`}`,
  );
  console.log(
    `  ${String(sets.held.length)} held out, ${String(sets.released.length)} released for practice`,
  );
  if (!made.examinerHome) {
    console.log("  no Examiner home: the source holds none, or a session after the cut replaced it");
  }
  if (tree !== repo) console.log(`  in ${tree}, which holds the code the run ran at the cut`);
  console.log(`  scripted  bun run runs rehearse ... --name ${name} --session <id>`);
  console.log(`  live      bun tools/d2/harness-builder.ts ... --name ${name}, or a move's own command`);
}
