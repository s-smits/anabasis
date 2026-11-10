/**
 * Which programs each solve's calls ran, per harness and program, apart by what the solve measured:
 *
 *   bun tools/wri/calls.ts --log <log> [--harness <prefix>] [--program <name>] [--command <re>] [--output <re>]
 *   bun tools/wri/calls.ts --log <log> --list (--command <re> | --output <re>) [--harness <prefix>]
 *   bun tools/wri/calls.ts --log <log> --sequences [--harness <prefix>]
 *
 * A solve under a built harness reaches the harness's programs through `bash`, so its tool names say
 * little: every pass reads `bash ... submit`. The table counts, for each harness, each side a solve
 * stood on (practice, the candidate or the reference of its comparison, an A/A control) and each
 * program, the solves that called it, its calls, the calls the host marked as errors, the calls whose
 * result says the command exited non-zero, and how the calling solves ended. A program reached through
 * a wrapper (`bash -lc "..."`, `python3 -B path`, `timeout 30 prog`, a pipe's later stage) counts once,
 * under the program (`programsOf`, `programs.ts`), and a segment whose program the text does not name
 * (`$RUN x`, `..`) counts as not attributed instead of being dropped. Imports are not traced: a
 * library a script imports (`lib/*.js`) runs under the script's name and reads 0 here. Between 3 and 10 November 12 of 16 lane 13
 * sessions built this table by hand, and lane 12 sessions counted the solves whose command or output
 * reached a changed path; vet-12's finding that a version's change sat on a path no g-2 solve took
 * came from such a count.
 *
 * `--list` prints one row a matching call (its solve, side, harness, tool and whether it erred) and
 * never the call's text: lane 22 reads which calls named a shared temporary folder. `--sequences`
 * prints, for each family and harness, the test-side passes' distinct program sequences, the
 * commonest one's share and the passes' median seconds (lane 10's recipes).
 *
 * The output holds what the log holds of a solver's own calls and stays on the exam side. It names
 * outcomes, so lane 27 reads it only after it has graded; lanes 4 and 15 only after their freeze.
 * It decides nothing: a count of calls says what ran, not whether it helped.
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { type LogEvent, read } from "#src/kernel/log.ts";
import type { Call } from "#src/kernel/trace.ts";
import { capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { asRecord, isString } from "#src/meta/json-shape.ts";
import { median } from "#src/meta/tally.ts";
import { logAcross } from "#tools/runs/snapshots.ts";
import { type Index, indexOf, type Solve, TEST } from "./folds.ts";
import { type CallPrograms, programsOf } from "./programs.ts";
import { proposedTasks } from "./tasks.ts";

const USAGE = `usage:
  bun tools/wri/calls.ts --log <log> [--harness <prefix>] [--program <name>] [--command <re>] [--output <re>]
  bun tools/wri/calls.ts --log <log> --list (--command <re> | --output <re>) [--harness <prefix>]
  bun tools/wri/calls.ts --log <log> --sequences [--harness <prefix>]`;

const OPTIONS = {
  log: "text",
  harness: "text",
  program: "text",
  command: "text",
  output: "text",
  list: "flag",
  sequences: "flag",
} as const;

/** The result text the shell tool ends a failed command's output with. */
const NONZERO = /Command exited with code [1-9]\d*\s*$/;
const SIDE_ORDER = ["practice", "candidate", "reference", "control", "examiner", "other"] as const;
type Side = (typeof SIDE_ORDER)[number];
const SIDE_RANK: ReadonlyMap<string, number> = new Map(SIDE_ORDER.map((side, rank) => [side, rank]));

interface Filters {
  readonly harness: string | null;
  readonly program: string | null;
  readonly command: RegExp | null;
  readonly output: RegExp | null;
}

interface Row {
  readonly solves: Set<string>;
  calls: number;
  erred: number;
  nonzero: number;
}

/** Where a solve stood: practice; the candidate or the reference of its comparison, where the
 *  reference's solves hold its A/A control's too, since a solve's start does not tell them apart; both
 *  sides of a comparison of one harness; an Examiner session's reference solve; or none of these. */
function sidesOf(events: readonly LogEvent[]): (solve: Solve) => Side {
  const sides = new Map(
    events.flatMap(({ kind, data }) =>
      kind === "comparison.started" && isString(data.session) ? [[data.session, data] as const] : [],
    ),
  );
  const exams = new Set(
    events.flatMap(({ kind, data }) =>
      kind === "exam.started" && isString(data.session) ? [data.session] : [],
    ),
  );
  return (solve) => {
    if (solve.side !== TEST) return "other";
    if (solve.comparison === null) return "practice";
    const terms = sides.get(solve.comparison);
    if (terms === undefined) return exams.has(solve.comparison) ? "examiner" : "other";
    if (terms.old === terms.fresh) return "control";
    return solve.harness === terms.fresh ? "candidate" : solve.harness === terms.old ? "reference" : "other";
  };
}

/** How a solve ended, as the comparison counts it: a pass, its side's fail, or a non-result. */
const endOf = (solve: Solve) =>
  solve.outcome === "pass"
    ? "pass"
    : ["fail", "flagged"].includes(solve.outcome ?? "")
      ? "fail"
      : "non-result";

/** Each solve with its calls that pass the filters, and each such call's programs. */
function callsBySolve(index: Index, filters: Filters) {
  const solves = new Map(index.solves.map((solve) => [solve.id, solve]));
  const kept = new Map<string, { readonly call: Call; readonly ran: CallPrograms }[]>();
  for (const each of index.traces) {
    if (each.seat !== "solve" || each.part !== "call") continue;
    const solve = solves.get(each.id);
    if (solve === undefined || (filters.harness !== null && !solve.harness.startsWith(filters.harness))) {
      continue;
    }
    const command = asRecord(each.args)?.command;
    const said = isString(command) ? command : capturedJsonStringify(each.args);
    if (filters.command !== null && !filters.command.test(said)) continue;
    if (filters.output !== null && !filters.output.test(each.text)) continue;
    const ran = programsOf(each);
    if (filters.program !== null && !ran.programs.includes(filters.program)) continue;
    kept.set(each.id, [...(kept.get(each.id) ?? []), { call: each, ran }]);
  }
  return { solves, kept };
}

/** The table: a row a harness, side and program, with the solves under that harness and side. */
export function callRows(events: readonly LogEvent[], filters: Filters): string[] {
  const index = indexOf(events);
  const sideOf = sidesOf(events);
  const { solves, kept } = callsBySolve(index, filters);
  const rows = new Map<string, Row>();
  let unattributed = 0;
  let bash = 0;
  for (const [id, calls] of kept) {
    const solve = solves.get(id);
    if (solve === undefined) continue;
    for (const { call, ran } of calls) {
      unattributed += ran.unattributed;
      bash += call.tool === "bash" ? 1 : 0;
      const counted = new Set(
        ran.programs.filter((one) => filters.program === null || one === filters.program),
      );
      for (const program of counted) {
        const key = `${solve.harness}\u0000${sideOf(solve)}\u0000${program}`;
        const row = rows.get(key) ?? { solves: new Set(), calls: 0, erred: 0, nonzero: 0 };
        row.solves.add(id);
        row.calls += 1;
        row.erred += call.isError ? 1 : 0;
        row.nonzero += NONZERO.test(call.text) ? 1 : 0;
        rows.set(key, row);
      }
    }
  }
  const under = Map.groupBy(index.solves, (solve) => `${solve.harness}\u0000${sideOf(solve)}`);
  const harnesses = [...new Set(index.solves.map(({ harness }) => harness))];
  const ordered = [...rows].toSorted(([one, a], [other, b]) => {
    const [h1 = "", s1 = "", p1 = ""] = one.split("\u0000");
    const [h2 = "", s2 = "", p2 = ""] = other.split("\u0000");
    return (
      harnesses.indexOf(h1) - harnesses.indexOf(h2) ||
      (SIDE_RANK.get(s1) ?? 0) - (SIDE_RANK.get(s2) ?? 0) ||
      b.calls - a.calls ||
      p1.localeCompare(p2)
    );
  });
  const lines = ordered.map(([key, row]) => {
    const [harness = "", side = "", program = ""] = key.split("\u0000");
    const ends = Map.groupBy(
      [...row.solves].flatMap((id) => solves.get(id) ?? []),
      endOf,
    );
    const count = (end: ReturnType<typeof endOf>) => String(ends.get(end)?.length ?? 0);
    return [
      harness.slice(0, 8),
      side,
      String(under.get(`${harness}\u0000${side}`)?.length ?? 0),
      program,
      String(row.solves.size),
      String(row.calls),
      String(row.erred),
      String(row.nonzero),
      `${count("pass")}/${count("fail")}/${count("non-result")}`,
    ].join("\t");
  });
  return [
    "calls: per harness, side and program, the solves under that harness and side, those calling it, its calls, calls the host marked as errors, calls whose result says the command exited non-zero, and how the calling solves ended (pass/fail/non-result, as the comparison counts them); imports are not traced, so a library a script imports counts under the script",
    "harness\tside\tsolves\tprogram\tcalling\tcalls\terred\tnonzero\tpass/fail/non-result",
    ...(lines.length === 0 ? ["no solve call on record passes the filters"] : lines),
    `${String(unattributed)} shell segments in ${String(bash)} bash calls named no program the text shows (a variable or a quoted word), counted under none`,
  ];
}

/** One row a call that passes the filters: never its text. */
export function listRows(events: readonly LogEvent[], filters: Filters): string[] {
  const index = indexOf(events);
  const sideOf = sidesOf(events);
  const { solves, kept } = callsBySolve(index, filters);
  const rows = [...kept].flatMap(([id, calls]) => {
    const solve = solves.get(id);
    return calls.map(({ call, ran }) =>
      [
        id,
        solve === undefined ? "?" : sideOf(solve),
        solve?.harness.slice(0, 8) ?? "?",
        call.tool,
        call.isError ? "erred" : "ok",
        ran.programs.join(",") || "-",
      ].join("\t"),
    );
  });
  return [
    `calls: ${String(rows.length)} calls that pass the filters, one a row, without their text`,
    "solve\tside\tharness\ttool\terror\tprograms",
    ...rows,
  ];
}

/** A solve's calls as one sequence, a run of one name written once with its count. */
function sequenceOf(calls: readonly { readonly ran: CallPrograms }[]): string {
  const names = calls.flatMap(({ ran }) => ran.programs);
  const runs: { name: string; times: number }[] = [];
  for (const name of names) {
    const last = runs.at(-1);
    if (last?.name === name) last.times += 1;
    else runs.push({ name, times: 1 });
  }
  return runs.map(({ name, times }) => (times === 1 ? name : `${name}*${String(times)}`)).join(" > ");
}

/** Lane 10's recipes: the test-side passes of each family and harness, their distinct sequences of
 *  programs, the commonest one's share and their median seconds. */
export function sequenceRows(events: readonly LogEvent[], filters: Filters): string[] {
  const index = indexOf(events);
  const families = new Map(proposedTasks(events).map(({ version, family }) => [version, family ?? "none"]));
  const sideOf = sidesOf(events);
  const { solves, kept } = callsBySolve(index, filters);
  const passes = [...solves.values()].filter(
    (solve) =>
      !["examiner", "other"].includes(sideOf(solve)) && solve.outcome === "pass" && kept.has(solve.id),
  );
  const groups = Map.groupBy(
    passes,
    (solve) => `${families.get(solve.version) ?? "not recorded"}\t${solve.harness.slice(0, 8)}`,
  );
  const rows = [...groups].map(([key, group]) => {
    const sequences = Map.groupBy(group, (solve) => sequenceOf(kept.get(solve.id) ?? []));
    const [commonest = "", most = []] =
      [...sequences].toSorted(([, a], [, b]) => b.length - a.length)[0] ?? [];
    const middle = median(group.map(({ seconds }) => seconds));
    return [
      key,
      String(group.length),
      String(sequences.size),
      `${String(Math.round((100 * most.length) / group.length))}%`,
      middle === null ? "-" : middle.toFixed(0),
      commonest,
    ].join("\t");
  });
  return [
    "sequences: the passes of practice and comparison solves (no Examiner session's) of each family and harness, their distinct sequences of programs, the commonest one's share and the passes' median seconds",
    "family\tharness\tpasses\tsequences\tcommonest\tmedian s\tcommonest sequence",
    ...(rows.length === 0 ? ["no test-side pass on record"] : rows),
  ];
}

const regex = (value: string | null) => (value === null ? null : new RegExp(value, "u"));

async function main(args: CommandArgs): Promise<number> {
  const named = args.value("log") ?? args.positionals[0] ?? args.die(USAGE);
  const events = read(await logAcross(named, "record"));
  const filters = {
    harness: args.value("harness"),
    program: args.value("program"),
    command: regex(args.value("command")),
    output: regex(args.value("output")),
  };
  if (args.flag("list") && filters.command === null && filters.output === null) {
    args.die("--list prints a row a call; name --command or --output to choose which");
  }
  const rows = args.flag("list")
    ? listRows(events, filters)
    : args.flag("sequences")
      ? sequenceRows(events, filters)
      : callRows(events, filters);
  console.log(rows.join("\n"));
  return 0;
}

if (import.meta.main) {
  await runCommand({ name: "calls", usage: USAGE, options: OPTIONS, positionals: [0, 1] }, main);
}
