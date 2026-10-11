/**
 * Stop a run, and release what it held on the host: v1's stop, on v2's records.
 *
 *   bun run runs stop <name> ... [--yes]
 *
 * `stop` ends the process that writes each named run's log and every process that one started, and
 * nothing else: a round started by hand can share its process group with a sibling. A name is
 * matched whole. Without `--yes` it prints what it would end. A campaign goes on from its log when
 * its command is run again under the same name, and the session the stop fell inside has spent its
 * id; a round or a checkpoint started by hand goes on under the same id, unless the stop fell
 * inside a Builder session: that session never finished, and the round refuses a second one under
 * its id. An Examiner session's id is spent wherever the stop fell.
 *
 * A stop also releases what the run held on the host: the capped root of each solve and Builder
 * session its log started and never finished, which only the ended process would have let go. A
 * named run that is not running is released the same way, so a run that was killed, or stopped
 * before this was done, is cleaned up by stopping it again.
 *
 * Until 11 October this file also launched a round, a checkpoint, a session or an Examiner session
 * after reading the log and the host (`bun run runs launch`). The campaign command asks the same
 * admission before each move and waits for the host's load, and the launcher went
 * (`docs/simplify.md`, D2).
 */
import { EXAMINE } from "#src/builder/admission.ts";
import { sessionDirs, spent } from "#src/builder/session.ts";
import { examinerDirs } from "#src/examiner/session.ts";
import { existsSync, rmSync } from "#src/meta/filesystem.ts";
import { isString } from "#src/meta/json-shape.ts";
import { dirname } from "#src/meta/path.ts";
import { parseArgs } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { runTextSyncOrThrow, terminateAndReapProcessGroupId } from "#src/meta/subprocess.ts";
import { type SolveDirs, solveDirs } from "#src/solve/command.ts";
import { releaseDiskCap } from "#src/verify/disk-cap.ts";
import { BUILDER, logEvents, processes, type Run, runs, writers } from "./pulse.ts";
import { seedCut } from "./seed.ts";

/** The value of `--name` among a running process's arguments, or undefined. */
function flagOf(args: readonly string[], name: string): string | undefined {
  const joined = args.find((arg) => arg.startsWith(`--${name}=`));
  if (joined !== undefined) return joined.slice(name.length + 3);
  const at = args.indexOf(`--${name}`);
  return at === -1 ? undefined : args[at + 1];
}

/** `pid` and every process it started, the nearest first, from a `ps` table of pid and parent. */
export function family(table: string, pid: number): number[] {
  const started = new Map<number, number[]>();
  for (const row of table.trim().split("\n")) {
    const [child = 0, parent = 0] = row.trim().split(/\s+/).map(Number);
    started.set(parent, [...(started.get(parent) ?? []), child]);
  }
  const found = [pid];
  for (const next of found) found.push(...(started.get(next) ?? []));
  return found;
}

/**
 * The directories of the solves and sessions a run started and never finished. A run that was
 * stopped or killed leaves the capped root of each mounted: only its own process would have let it
 * go. A seed's log begins as its source's, and what that run has open is the source's to hold.
 *
 * An Examiner session has a capped root as a Builder's: left out here, the root of the one a stop
 * cut stayed mounted and had to be released by hand (buffer x-1, 2026-10-10).
 */
export function leftOpen(run: Pick<Run, "path" | "seed">): SolveDirs[] {
  const events = logEvents(run.path).slice(run.seed === true ? seedCut(dirname(run.path)) : 0);
  const open = (role: "solve" | "build" | "exam", key: "solve" | "session") => {
    const ended = new Set(
      events.flatMap(({ kind, data }) => (kind === `${role}.finished` ? [data[key]] : [])),
    );
    return events.flatMap(({ kind, data }) => {
      const id = data[key];
      return kind === `${role}.started` && isString(id) && !ended.has(id) ? [id] : [];
    });
  };
  return [
    ...open("solve", "solve").map((id) => solveDirs(id)),
    ...open("build", "session").map((id) => sessionDirs(run.path, id)),
    ...open("exam", "session").map((id) => examinerDirs(run.path, id)),
  ];
}

/** `bun run runs stop`. */
export async function stop(args: readonly string[]): Promise<void> {
  const { values, positionals: names } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: { yes: { type: "boolean", default: false } },
  });
  if (names.length === 0) throw new Error("usage: bun run runs stop <name> ... [--yes]");
  const running = processes();
  const table = runTextSyncOrThrow(["ps", "-axo", "pid=,ppid="]);
  const named = runs().filter((run) => names.includes(run.name));
  const found = named.flatMap((run) =>
    writers(run, running).map(({ pid, args: ran }) => ({ run, ran, pids: family(table, pid) })),
  );
  if (found.length === 0) console.log("none of these is running");
  for (const { run, ran, pids } of found) {
    console.log(
      `${run.name} in ${run.tree}: pid ${String(pids[0])} and the ${String(pids.length - 1)} it started`,
    );
    if (!values.yes) continue;
    // The run's own process first, so that it starts nothing more, then what it left.
    let left = 0;
    for (const pid of pids) left += (await terminateAndReapProcessGroupId(pid)) ? 0 : 1;
    if (left > 0) console.log(`  ⚠ ${String(left)} of them would not end`);
    // A round has no ending to write when it is stopped, so a stop inside a Builder session spends
    // that session's id: say so here, where the operator decides what to start next.
    // The session is the stopped process's own, by its flags: a checkpoint names none, and the
    // log's last Builder session may be another run's.
    const session = flagOf(ran, "session");
    const ranAs = (tool: string) => ran.some((arg) => arg.endsWith(tool));
    const byHand = session === undefined ? null : spent(logEvents(run.path), session);
    // A campaign command names no session: the one it was inside is in its log, and its id is
    // spent whichever role it was. A word costs none, and both campaigns stopped by signal on
    // 10 October lost a session that was running (b-1 and x-1).
    const cut = ranAs(EXAMINE)
      ? "An Examiner session's id names one session: the next takes another --session"
      : ranAs(BUILDER)
        ? "A campaign goes on from its log under the same --name, and the session it was inside has spent its id. A word left with tools/d2/word.ts ends a campaign at its next move boundary and spends none"
        : byHand;
    console.log(
      `  stopped, its log as it was. ${cut ?? "A round or a checkpoint goes on from it when started again under the same id"}`,
    );
  }
  // What a run was stopped or killed inside is still there, whenever that was: a mounted volume, or
  // the folder and image of one. A run that is still being written holds its roots in use, and is
  // left alone.
  const still = processes();
  let held = 0;
  for (const run of named.filter((each) => writers(each, still).length === 0)) {
    const left = leftOpen(run).filter(({ root }) => existsSync(root));
    if (left.length === 0) continue;
    held += left.length;
    console.log(
      `${run.name} in ${run.tree}: ${String(left.length)} capped root(s) its solves and sessions left behind`,
    );
    if (!values.yes) continue;
    // A stalled volume is left attached by its release, and the stop goes on to the next root.
    let kept = 0;
    for (const { root, host } of left) {
      try {
        await releaseDiskCap(root);
      } catch (error) {
        kept++;
        console.log(`  ⚠ ${errorMessage(error)}`);
        continue;
      }
      rmSync(host, { recursive: true, force: true });
    }
    console.log(
      kept === 0
        ? "  released"
        : `  released but ${String(kept)}; a reboot clears what a stalled volume holds`,
    );
  }
  if (found.length + held > 0 && !values.yes) console.log("nothing is ended or released without --yes");
}
