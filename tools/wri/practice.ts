/**
 * Every practice solve, one a row, with the place its harness held in the log when it started:
 *
 *   bun tools/wri/practice.ts <log>
 *   bun tools/wri/practice.ts --log <log> [--session b-2]
 *
 * A row names the Builder session (`practiceOf`, `tools/wri/folds.ts`), the turn of the `practice` call
 * that returned it, the task, the harness and its role: `starter`, `reference` (promoted before the
 * solve started), `compared g-N` (frozen for a comparison, with that comparison's reading, earlier or
 * later), or `practised-only`. It then says whether the state moved since the session's previous
 * practice call: from the solves' own harness digests, which every solve's condition records, with
 * the session's file-tool and shell calls that wrote the harness between the two calls beside it. A
 * shell write leaves no `edit` call, so the digests are the reading and the calls are the context;
 * where a solve's condition names no harness, the row says that it rests on the calls alone.
 *
 * Between 3 and 10 November 13 of 16 lane 14 sessions built this table by hand, parsing solve ids out
 * of the practice call's text, and the vetting of one of them refuted its count: it took 98 solves
 * under practised-only states for probes of the starter, where 52 of 264 practice solves ran under
 * the starter. The role column is that count's fold.
 *
 * It prints outcomes, so lane 27 reads it only after it has graded. It decides nothing: which practice
 * taught the Builder what is the lane's reading of the turns around each call
 * (`slice.ts Builder:<session>{<turn>}`).
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { type LogEvent, read } from "#src/kernel/log.ts";
import { practiceRan } from "#src/kernel/solves.ts";
import { asRecord, isString } from "#src/meta/json-shape.ts";
import { countBy } from "#src/meta/tally.ts";
import { logAcross } from "#tools/runs/snapshots.ts";
import { type Build, type Index, indexOf, practiceOf, type Solve, tally } from "./folds.ts";
import { FILE_WRITERS } from "./read.ts";
import { proposedTasks } from "./tasks.ts";

const USAGE = "usage: bun tools/wri/practice.ts (<log> | --log <log>) [--session <id>]";
const OPTIONS = { log: "text", session: "text" } as const;
/** A shell command that names the harness's own folders writes there as often as it reads. It names
 *  the guide's folder too, unlike `harnessTriggers`' `.toolchain` test, which lists tool files alone. */
const NAMES_HARNESS = /(^|[\s"'=/])(harness\/|\.toolchain|agent\/)/;

/** A `practice` call of a session: where the log holds it and the turn it was asked in. */
interface Asked {
  readonly index: number;
  readonly turn: number | null;
}

interface Making {
  readonly harness: string;
  readonly at: number;
  readonly session: string;
  readonly reading: string;
}

/** The facts a role is read from: the starter, each promotion and each comparison's new harness. */
function rolesOf(log: Index) {
  const started = log.events.flatMap(({ kind, data }, at) =>
    kind === "comparison.started" ? [{ at, data }] : [],
  );
  const starter =
    started.map(({ data }) => data.starter).find(isString) ??
    log.builds.map(({ parent }) => parent).find((parent) => parent !== "") ??
    null;
  const promotions = log.events.flatMap(({ kind, data }, at) =>
    kind === "harness.promoted" && isString(data.harness) ? [{ at, harness: data.harness }] : [],
  );
  const readings = new Map(
    log.compared.map(({ session, last }) => [session, isString(last.reading) ? last.reading : "no report"]),
  );
  const compared: Making[] = started.flatMap(({ at, data }) =>
    isString(data.fresh) && isString(data.session)
      ? [
          {
            harness: data.fresh,
            at,
            session: data.session,
            reading: readings.get(data.session) ?? "no report",
          },
        ]
      : [],
  );
  return (solve: Solve): string => {
    if (solve.harness === "") return "not recorded";
    const reference = promotions.findLast(({ at }) => at < solve.index)?.harness ?? starter;
    if (solve.harness === starter && reference === starter) return "starter";
    if (solve.harness === reference) return "reference";
    if (solve.harness === starter) return "starter";
    const frozen = compared.filter(({ harness }) => harness === solve.harness);
    if (frozen.length > 0) {
      return frozen.map(({ session, reading }) => `compared ${session} (${reading})`).join(", ");
    }
    return "practised-only";
  };
}

/** The session's calls between two log indices that wrote its harness: its file tools by name, and
 *  shell commands naming the harness's folders. */
function editsBetween(build: Build, from: number, until: number): string {
  const calls = build.calls.filter(({ index }) => index > from && index < until);
  const files = calls.filter(({ tool }) => FILE_WRITERS.has(tool)).length;
  const shell = calls.filter(({ tool, args }) => {
    const command = asRecord(args)?.command;
    return tool === "bash" && isString(command) && NAMES_HARNESS.test(command);
  }).length;
  return `${String(files)} file-tool, ${String(shell)} shell naming the harness`;
}

/** One session's rows, a practice solve each, and its calls that started none. */
function sessionRows(
  log: Index,
  build: Build,
  roleOf: (solve: Solve) => string,
  taskOf: (version: string) => string,
) {
  const solves = practiceOf(log, build);
  const calls: Asked[] = log.traces.flatMap((each) =>
    each.seat === "build" && each.part === "call" && each.id === build.session && each.tool === "practice"
      ? [{ index: each.index, turn: each.turn }]
      : [],
  );
  const answered = new Set<number>();
  let previous: { readonly index: number; readonly harness: string } = {
    index: build.from,
    harness: build.parent,
  };
  const rows = solves.map((solve) => {
    const call = calls.find(({ index }) => index > solve.index);
    if (call !== undefined) answered.add(call.index);
    const before = calls.findLast(({ index }) => index < solve.index)?.index ?? build.from;
    const edits = editsBetween(build, before, solve.index);
    const state =
      solve.harness === ""
        ? `state not recorded; rests on edit calls alone: ${edits}`
        : `${solve.harness === previous.harness ? "same state" : `state moved from ${previous.harness.slice(0, 8) || "none"}`}; ${edits}`;
    if (before !== previous.index || solve.harness !== previous.harness) {
      previous = { index: before, harness: solve.harness === "" ? previous.harness : solve.harness };
    }
    return [
      build.session,
      call?.turn === null || call === undefined ? "-" : String(call.turn),
      solve.id,
      taskOf(solve.version),
      solve.harness.slice(0, 8) || "-",
      roleOf(solve),
      solve.outcome ?? "unfinished",
      solve.kind ?? "-",
      state,
    ].join("\t");
  });
  return { rows, empty: calls.filter(({ index }) => !answered.has(index)).length, solves };
}

/** The table, a session at a time, then the totals by role and how the solves ended. */
export function practiceRows(events: readonly LogEvent[], only: string | null = null): string[] {
  const log = indexOf(events);
  const roleOf = rolesOf(log);
  const ids = new Map(
    proposedTasks(events).map(({ version, taskId }) => [version, taskId ?? version.slice(0, 8)]),
  );
  const taskOf = (version: string) => ids.get(version) ?? version.slice(0, 8);
  const sessions = log.builds
    .filter(({ session }) => only === null || session === only)
    .map((build) => sessionRows(log, build, roleOf, taskOf));
  const all = sessions.flatMap(({ solves }) => solves);
  const inWindow = new Set(all.map(({ id }) => id));
  const outside = only === null ? practiceRan(events).filter(({ id }) => !inWindow.has(id)).length : 0;
  const roles = countBy(all, (solve) => roleOf(solve).replace(/ \(.*$/u, ""));
  const ends = countBy(
    all,
    (solve) => `${roleOf(solve).replace(/ \(.*$/u, "")} ${solve.outcome ?? "unfinished"}`,
  );
  return [
    "practice: one row a practice solve of a Builder session (practiceOf), the role its harness held when it started, how it ended, and whether the state moved since the session's previous practice call (from the solves' harness digests; the calls that wrote the harness beside it)",
    "session\tturn\tsolve\ttask\tharness\trole\toutcome\tkind\tsince the previous practice call",
    ...sessions.flatMap(({ rows }) => rows),
    `totals: ${String(all.length)} practice solves; by role ${tally(roles)}`,
    `by role and outcome: ${tally(ends)}`,
    `practice calls that started no solve: ${String(sessions.reduce((sum, { empty }) => sum + empty, 0))}`,
    ...(outside === 0
      ? []
      : [`practice solves in no Builder session's window (practiceRan): ${String(outside)}`]),
  ];
}

async function main(args: CommandArgs): Promise<number> {
  const named = args.value("log") ?? args.positionals[0] ?? args.die(USAGE);
  console.log(practiceRows(read(await logAcross(named)), args.value("session")).join("\n"));
  return 0;
}

if (import.meta.main) {
  await runCommand({ name: "practice", usage: USAGE, options: OPTIONS, positionals: [0, 1] }, main);
}
