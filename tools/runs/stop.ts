/**
 * Stop a run, and release what it held on the host: v1's stop, on v2's records.
 *
 *   bun run runs stop <name> ... [--yes]
 *
 * `stop` ends the process that writes each named campaign's log and every process that one
 * started, and nothing else: a round started by hand can share its process group with a sibling. A
 * name is one campaign's whole name (`runNamed`), refused where it is none or two. Without `--yes`
 * it prints what it would end. A campaign goes on from its log when its command is run again under
 * the same name (`bun run runs continue`), and the session the stop fell inside has spent its id;
 * a word left with `tools/d2/word.ts` ends a campaign at its next move boundary and spends none, and
 * `bun run runs pause` stops one where nothing but its Builder's conversation is open.
 *
 * A stop also releases what the run held on the host: the capped root of each solve and session its
 * log started and never finished (`unfinished`, `src/kernel/reports.ts`), which only the ended
 * process would have let go. A named run that is not running is released the same way, so a run
 * that was killed, or stopped before this was done, is cleaned up by stopping it again. A keeper
 * of the run (`runs keep`) ends with it, but for the one that asked for the stop.
 */
import { EXAMINE } from "#src/builder/admission.ts";
import { sessionDirs, spent } from "#src/builder/session.ts";
import { examinerDirs } from "#src/examiner/shell.ts";
import { unfinished } from "#src/kernel/reports.ts";
import { existsSync, rmSync } from "#src/meta/filesystem.ts";
import { isString } from "#src/meta/json-shape.ts";
import { dirname } from "#src/meta/path.ts";
import { parseArgs } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { runTextSyncOrThrow, terminateAndReapProcessGroupId } from "#src/meta/subprocess.ts";
import { type SolveDirs, solveDirs } from "#src/solve/command.ts";
import { releaseDiskCap } from "#src/verify/disk-cap.ts";
import {
  BUILDER,
  DRAFT,
  keepers,
  logEvents,
  processes,
  type Run,
  runNamed,
  type Running,
  writers,
} from "./registry.ts";
import { seedCut } from "./seed.ts";

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
 * cut stayed mounted and had to be released by hand (buffer x-1, 2026-10-10). A session that drafts
 * an exam has had one since 11 October.
 */
export function leftOpen(run: Pick<Run, "path" | "seed">): SolveDirs[] {
  const events = logEvents(run.path).slice(run.seed === true ? seedCut(dirname(run.path)) : 0);
  return unfinished(events).flatMap(({ of, id }) => {
    if (!isString(id)) return [];
    if (of === "solve") return [solveDirs(id)];
    if (of === "build") return [sessionDirs(run.path, id)];
    return of === "exam" || of === "draft" ? [examinerDirs(run.path, id)] : [];
  });
}

/** What a stopped process's run may go on with, by the command it ran. A round has no ending to
 *  write when it is stopped, so a stop inside a Builder session spends that session's id; the
 *  session is the stopped process's own, by its flags, since a log's last session may be another
 *  run's. Both campaigns stopped by signal on 10 October lost a session that was running. */
function after(run: Run, ran: readonly string[]): string {
  const ranAs = (tool: string) => ran.some((arg) => arg.endsWith(tool));
  if (ranAs(EXAMINE) || ranAs(DRAFT)) {
    return "An Examiner session's id names one session: the next takes another --session";
  }
  if (ranAs(BUILDER)) {
    return "A campaign goes on from its log under the same name, and the session it was inside has spent its id";
  }
  const at = ran.indexOf("--session");
  const session = at === -1 ? undefined : ran[at + 1];
  return (
    (session === undefined ? null : spent(logEvents(run.path), session)) ??
    "A round or a checkpoint goes on from it when started again under the same id"
  );
}

/** End `run`'s writers in `running` and all they started, the run's own process first so that it
 *  starts nothing more. */
async function end(run: Run, running: readonly Running[], yes: boolean): Promise<number> {
  const table = runTextSyncOrThrow(["ps", "-axo", "pid=,ppid="]);
  const found = writers(run, running);
  for (const { pid, args } of found) {
    const pids = family(table, pid);
    console.log(
      `${run.name} in ${run.tree}: pid ${String(pid)} and the ${String(pids.length - 1)} it started`,
    );
    if (!yes) continue;
    let left = 0;
    for (const each of pids) left += (await terminateAndReapProcessGroupId(each)) ? 0 : 1;
    if (left > 0) console.log(`  ⚠ ${String(left)} of them would not end`);
    console.log(`  stopped, its log as it was. ${after(run, args)}`);
  }
  return found.length;
}

/** Release the capped roots `run` left, where no process writes it any more: a mounted volume, or
 *  the folder and image of one. A stalled volume is left attached by its release, and the stop goes
 *  on to the next root. */
async function release(run: Run, yes: boolean): Promise<number> {
  if (writers(run, processes()).length > 0) return 0;
  const left = leftOpen(run).filter(({ root }) => existsSync(root));
  if (left.length === 0) return 0;
  console.log(
    `${run.name} in ${run.tree}: ${String(left.length)} capped root(s) its solves and sessions left behind`,
  );
  if (!yes) return left.length;
  let kept = 0;
  for (const { root, host } of left) {
    try {
      await releaseDiskCap(root);
      rmSync(host, { recursive: true, force: true });
    } catch (error) {
      kept++;
      console.log(`  ⚠ ${errorMessage(error)}`);
    }
  }
  console.log(
    kept === 0 ? "  released" : `  released but ${String(kept)}; a reboot clears what a stalled volume holds`,
  );
  return left.length;
}

/** `bun run runs stop`. */
export async function stop(args: readonly string[]): Promise<void> {
  const { values, positionals: names } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: { yes: { type: "boolean", default: false } },
  });
  if (names.length === 0) throw new Error("usage: bun run runs stop <name> ... [--yes]");
  const named = names.map((name) => runNamed(name));
  const running = processes();
  let acted = 0;
  for (const run of named) acted += await end(run, running, values.yes);
  if (acted === 0) console.log("none of these is running");
  for (const run of named) acted += await release(run, values.yes);
  // A run stopped by hand is not gone on with: its keeper ends with it (`keep.ts`).
  for (const pid of values.yes ? named.flatMap(({ name }) => keepers(name)) : []) {
    await terminateAndReapProcessGroupId(pid);
    console.log(`  its keeper, pid ${String(pid)}, ended`);
  }
  if (acted > 0 && !values.yes) console.log("nothing is ended or released without --yes");
}
