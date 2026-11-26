/**
 * Stops a run and releases what it held on the host. It ends the process that writes each named
 * campaign's log and every process that one started, and nothing else, since a round started by
 * hand can share its process group with a sibling. A name is one campaign's whole name
 * (`runNamed`). Without `--yes` it prints what it would end. Once no writer remains, a direct CLI
 * stop of a campaign controller records `campaign.ended` (`ending: "stop"`, resetting idle and
 * crash streaks on continue just as `signal.ts --stop` does) unless the log already holds an
 * ending or an active pause word; internal callers (`keep.ts`, `manage.ts`) never record one. The
 * campaign goes on from its log when run again under the same name (`bun run runs continue`); a
 * word (`tools/campaign/signal.ts`) or `bun run runs pause` stops one at a boundary instead.
 *
 *   bun run runs stop <name> ... [--yes]
 */
import { EXAMINE } from "#src/campaign/admission.ts";
import { pauseSince } from "#src/campaign/signal.ts";
import { keepCutNotes, sessionDirs, spent } from "#src/builder/session.ts";
import { examinerDirs } from "#src/examiner/shell.ts";
import { append } from "#src/kernel/log.ts";
import { endedData, endingOf } from "#src/kernel/reports.ts";
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
import { launchedIn } from "./state.ts";

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

async function end(
  run: Run,
  running: readonly Running[],
  yes: boolean,
): Promise<{ readonly count: number; readonly controller: boolean }> {
  const table = runTextSyncOrThrow(["ps", "-axo", "pid=,ppid="]);
  const found = writers(run, running);
  let controller = false;
  for (const { pid, args } of found) {
    const pids = family(table, pid);
    console.log(
      `${run.name} in ${run.tree}: pid ${String(pid)} and the ${String(pids.length - 1)} it started`,
    );
    if (!yes) continue;
    const left = await stopProcessTree(pid, table);
    if (left > 0) console.log(`  ⚠ ${String(left)} of them would not end`);
    console.log(`  stopped. ${after(run, args)}`);
    controller ||= runsAs(args, [BUILDER]);
  }
  return { count: found.length, controller };
}

export function recordStop(run: Run): boolean {
  const events = logEvents(run.path);
  if (
    events.length === 0 ||
    endingOf(events) !== null ||
    pauseSince(events, launchedIn(run, events)) !== undefined
  ) {
    return false;
  }
  append(run.path, "campaign.ended", endedData(events, { ending: "stop", why: "runs stop" }));
  return true;
}

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

export async function stop(args: readonly string[], { record = false } = {}): Promise<void> {
  const { values, positionals: names } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: { yes: { type: "boolean", default: false } },
  });
  if (names.length === 0) throw new Misused();
  const named = names.map((name) => runNamed(name));
  const running = processes();
  let acted = 0;
  for (const run of named) {
    for (const pid of keepers(run.name, running)) {
      acted += 1;
      if (values.yes) {
        await terminateAndReapProcessGroupId(pid);
        console.log(`  its keeper, pid ${String(pid)}, ended`);
      } else console.log(`${run.name} in ${run.tree}: keeper pid ${String(pid)}`);
    }
  }
  const stoppedControllers = new Set<string>();
  for (const run of named) {
    const ended = await end(run, running, values.yes);
    acted += ended.count;
    if (record && values.yes && ended.controller) stoppedControllers.add(run.name);
  }
  if (acted === 0) console.log("none of these is running");
  const left = processes();
  for (const run of named) {
    if (stoppedControllers.has(run.name) && writers(run, left).length === 0 && recordStop(run)) {
      console.log(`  ${run.name}: recorded campaign.ended (stop)`);
    }
    acted += await release(run, left, values.yes ? "release" : "describe");
  }
  if (acted > 0 && !values.yes) console.log("nothing is ended or released without --yes");
}
