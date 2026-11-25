/**
 * Stops a run and releases what it held on the host. It ends the process that writes each named
 * campaign's log and every process that one started, and nothing else, since a round started by
 * hand can share its process group with a sibling. A name is one campaign's whole name
 * (`runNamed`). Without `--yes` it prints what it would end. The campaign goes on from its log when
 * run again under the same name (`bun run runs continue`); a word (`tools/campaign/signal.ts`) or `bun run
 * runs pause` stops one at a boundary instead.
 *
 *   bun run runs stop <name> ... [--yes]
 */
import { EXAMINE } from "#src/campaign/admission.ts";
import { keepCutNotes, sessionDirs, spent } from "#src/builder/session.ts";
import { examinerDirs } from "#src/examiner/shell.ts";
import { examinerSessions } from "#src/kernel/solves.ts";
import { unfinished } from "#src/kernel/trace.ts";
import { existsSync } from "#src/meta/filesystem.ts";
import { isString } from "#src/meta/json-shape.ts";
import { dirname } from "#src/meta/path.ts";
import { parseArgs } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { runTextSyncOrThrow, terminateAndReapProcessGroupId } from "#src/meta/subprocess.ts";
import { type SolveDirs, solveDirs } from "#src/tools/command.ts";
import { releaseRoot } from "#src/sandbox/sandbox-root.ts";
import {
  BUILDER,
  DRAFT,
  flagOf,
  keepers,
  logEvents,
  Misused,
  processes,
  type Run,
  runNamed,
  type Running,
  runsAs,
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
 * The directories of the solves and sessions a run started and never finished: a stopped or killed
 * run leaves them, since only its own process would have let them go. A seed's log begins as its
 * source's, and what that run has open is the source's to hold.
 */
export function unreleasedSandboxes(run: Pick<Run, "path" | "seed">): (SolveDirs & { build?: string })[] {
  const events = logEvents(run.path).slice(run.seed === true ? seedCut(dirname(run.path)) : 0);
  const seats = unfinished(events).flatMap(({ of, id }) => {
    if (!isString(id)) return [];
    if (of === "solve") return [solveDirs(id)];
    return of === "build" ? [{ ...sessionDirs(run.path, id), build: id }] : [];
  });
  return [
    ...seats,
    ...[...examinerSessions(events)].filter(isString).map((id) => examinerDirs(run.path, id)),
  ];
}

/** What a stopped process's run may go on with, by the command it ran. A round has no ending to
 *  write when it is stopped, so a stop inside a Builder session spends that session's id; the
 *  session is the stopped process's own, by its flags, since a log's last session may be another
 *  run's, and a campaign stopped by signal would otherwise lose a session that was running. */
function after(run: Run, ran: readonly string[]): string {
  if (runsAs(ran, [EXAMINE, DRAFT])) {
    return "An Examiner session's id names one session: the next takes another --session";
  }
  if (runsAs(ran, [BUILDER])) {
    return "A campaign goes on from its log under the same name, and the session it was inside has spent its id";
  }
  const session = flagOf(ran, "--session");
  return (
    (session === undefined ? null : spent(logEvents(run.path), session)) ??
    "A round or a standalone comparison goes on from it when started again under the same id"
  );
}

export async function stopProcessTree(pid: number, table?: string): Promise<number> {
  const rows = table ?? runTextSyncOrThrow(["ps", "-axo", "pid=,ppid="]);
  let left = 0;
  for (const each of family(rows, pid)) left += (await terminateAndReapProcessGroupId(each)) ? 0 : 1;
  return left;
}

/** Ends `run`'s writers and all they started, the run's own process first, so that it starts nothing more. */
async function end(run: Run, running: readonly Running[], yes: boolean): Promise<number> {
  const table = runTextSyncOrThrow(["ps", "-axo", "pid=,ppid="]);
  const found = writers(run, running);
  for (const { pid, args } of found) {
    const pids = family(table, pid);
    console.log(
      `${run.name} in ${run.tree}: pid ${String(pid)} and the ${String(pids.length - 1)} it started`,
    );
    if (!yes) continue;
    const left = await stopProcessTree(pid, table);
    if (left > 0) console.log(`  ⚠ ${String(left)} of them would not end`);
    console.log(`  stopped, its log as it was. ${after(run, args)}`);
  }
  return found.length;
}

/** Release sandbox directories left open by `run` (`unreleasedSandboxes`) once no live process
 *  writes to it, preserving interrupted Builder notes first. */
export async function release(
  run: Run,
  running: readonly Running[],
  act: "release" | "describe",
  open = unreleasedSandboxes(run),
): Promise<number> {
  if (writers(run, running).length > 0) return 0;
  const left = open.filter(({ root }) => existsSync(root));
  if (left.length === 0) return 0;
  console.log(
    `${run.name} in ${run.tree}: ${String(left.length)} root(s) its solves and sessions left behind`,
  );
  if (act === "describe") return left.length;
  let kept = 0;
  for (const { root, build } of left) {
    try {
      if (build !== undefined) keepCutNotes(run.path, build);
      await releaseRoot(root);
    } catch (error) {
      kept++;
      console.log(`  ⚠ ${errorMessage(error)}`);
    }
  }
  console.log(kept === 0 ? "  released" : `  released but ${String(kept)}`);
  return left.length;
}

export async function stop(args: readonly string[]): Promise<void> {
  const { values, positionals: names } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: { yes: { type: "boolean", default: false } },
  });
  if (names.length === 0) throw new Misused();
  const named = names.map((name) => runNamed(name));
  const running = processes();
  // A run stopped by hand is not gone on with: its keeper ends with it (`keep.ts`), and first, since
  // a keeper that outlived its writer would start the run again before the stop came to it.
  for (const pid of values.yes ? named.flatMap(({ name }) => keepers(name, running)) : []) {
    await terminateAndReapProcessGroupId(pid);
    console.log(`  its keeper, pid ${String(pid)}, ended`);
  }
  let acted = 0;
  for (const run of named) acted += await end(run, running, values.yes);
  if (acted === 0) console.log("none of these is running");
  // Read again: what ended no longer writes, and one that would not end still does.
  const left = processes();
  for (const run of named) acted += await release(run, left, values.yes ? "release" : "describe");
  if (acted > 0 && !values.yes) console.log("nothing is ended or released without --yes");
}
