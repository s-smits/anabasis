/**
 * What each side's solves ran on the tasks a comparison's new harness won, for lane 16:
 *
 *   bun tools/wri/parts.ts --log <log> --comparison g-3 [--no-diff] [--all]
 *
 * One row a solve: its task, side, how the comparison read it (valid or not, and its objective where
 * one is fixed), how it ended, its calls, and the programs its calls ran (`programsOf`, `programs.ts`, the
 * one reader of which program a call ran). Then, unless `--no-diff`, what the new harness wrote that the
 * reference did not (`writtenIn`, `trajectory.ts`: the guide and its own programs, added or changed
 * against the reference's kept state, by content), and for each solve the first call that ran one of
 * those programs and the first whose arguments name one. It assigns no kind to a win: where the two
 * sides part is the lane's reading, and the catalogue asks for the traces before the diff, so
 * `--no-diff` prints the rows alone.
 *
 * 8 of 13 lane-16 sessions between 3 and 10 November tabulated each won task's programs per solve by
 * hand (`wins.py` in three versions, `methods.py`, `best.ts`), and 5 typed the changed files of a
 * harness by hand from diffs of its kept states.
 */
import type { LogEvent } from "#src/kernel/log.ts";
import { read } from "#src/kernel/log.ts";
import { ranUnder } from "#src/kernel/solves.ts";
import { type Call, tracesIn } from "#src/kernel/trace.ts";
import { TOOL_TREE_DIR } from "#src/meta/bundle-layout.ts";
import { existsSync, readFileSync } from "#src/meta/filesystem.ts";
import { capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { isString } from "#src/meta/json-shape.ts";
import { dirname, join } from "#src/meta/path.ts";
import { parseArgs } from "#src/meta/process.ts";
import { logAcross } from "#tools/runs/snapshots.ts";
import { programsOf } from "./programs.ts";
import { sharedPrefix, wonPairs } from "./provenance.ts";
import { writtenIn } from "./trajectory.ts";

/** What the new harness wrote against the reference, by path (`guide` for its guide); a path added with
 *  the bytes of one removed is a rename, `old -> new`, and neither added nor removed. */
export interface Written {
  readonly added: readonly string[];
  readonly changed: readonly string[];
  readonly removed: readonly string[];
  readonly renamed: readonly { readonly from: string; readonly to: string }[];
  /** What the reference's kept state lacks: its tool tree, its guide, or the state itself. */
  readonly unkept: readonly string[];
}

/** One solve of a won task, as read. */
interface SolveRow {
  readonly task: string;
  readonly side: "new" | "reference";
  readonly solve: string;
  readonly valid: boolean;
  readonly objective: number | null;
  readonly ending: string;
  readonly calls: readonly Call[];
}

const USAGE = "usage: bun tools/wri/parts.ts --log <log> --comparison <session> [--no-diff] [--all]";
const GUIDE = "guide";
const NONE = "-";

const contentOf = (path: string) => (existsSync(path) ? readFileSync(path) : null);

/** What `fresh`'s state wrote that `old`'s did not, or wrote otherwise, both kept beside the log. */
export function writtenAgainst(old: string, fresh: string): Written {
  const before = existsSync(old) ? writtenIn(old) : new Map<string, string>();
  const after = writtenIn(fresh);
  const same = (path: string) => {
    const one = contentOf(before.get(path) ?? "");
    const other = contentOf(after.get(path) ?? "");
    return one !== null && other !== null && one.equals(other);
  };
  const paths = (from: ReadonlyMap<string, string>) => [...from.keys()].toSorted();
  const added = paths(after).filter((path) => !before.has(path));
  const removed = paths(before).filter((path) => !after.has(path));
  const renamed = added.flatMap((to) => {
    const bytes = contentOf(after.get(to) ?? "");
    const from = removed.find(
      (path) => bytes !== null && contentOf(before.get(path) ?? "")?.equals(bytes) === true,
    );
    return from === undefined ? [] : [{ from, to }];
  });
  const moved = new Set(renamed.flatMap(({ from, to }) => [from, to]));
  const unkept = existsSync(old)
    ? [...(existsSync(join(old, TOOL_TREE_DIR)) ? [] : ["tool tree"]), ...(before.has(GUIDE) ? [] : [GUIDE])]
    : ["state"];
  return {
    added: added.filter((path) => !moved.has(path)),
    changed: paths(after).filter((path) => before.has(path) && !same(path)),
    removed: removed.filter((path) => !moved.has(path)),
    renamed,
    unkept,
  };
}

const fileOf = (path: string) => path.replace(/^.*\//u, "");
const escaped = (text: string) => text.replaceAll(/[$()*+.?[\\\]^{|}]/gu, String.raw`\$&`);
/** The names `programsOf` may give the program at `path`: its file name, and that less its extension
 *  (a module run with `-m`). */
const namesOf = (path: string) => [fileOf(path), fileOf(path).replace(/\.[^.]+$/u, "")];

/** The first call that ran one of `programs`, and the first whose arguments name one by its whole
 *  file name. */
function firstUses(calls: readonly Call[], programs: readonly string[]): { ran: string; named: string } {
  const files = programs.map(fileOf);
  const names = new Set(programs.flatMap(namesOf));
  const word =
    files.length === 0 ? null : new RegExp(`(?<![\\w.-])(?:${files.map(escaped).join("|")})(?![\\w-])`, "u");
  const ran = calls.findIndex((call) => programsOf(call).programs.some((program) => names.has(program)));
  const named = word === null ? -1 : calls.findIndex((call) => word.test(capturedJsonStringify(call.args)));
  const at = (index: number) => (index === -1 ? NONE : `call ${String(index + 1)}`);
  return { ran: at(ran), named: at(named) };
}

/** Each solve of each won task, both sides, with its calls in the order logged. */
export function solveRows(events: readonly LogEvent[], session: string): SolveRow[] | null {
  const found = wonPairs(events, session);
  if (found === null) return null;
  const endings = new Map(
    ranUnder(events).map(({ id, ending }) => {
      const outcome = isString(ending?.outcome) ? ending.outcome : "not ended";
      return [id, isString(ending?.kind) ? `${outcome}:${ending.kind}` : outcome] as const;
    }),
  );
  const calls = Map.groupBy(
    tracesIn(events).filter((each): each is Call => each.seat === "solve" && each.part === "call"),
    ({ id }) => id,
  );
  return found.won.flatMap((pair) =>
    (["fresh", "old"] as const).flatMap((side) =>
      (pair.solves?.[side] ?? []).map((solve, at) => ({
        task: pair.task,
        side: side === "fresh" ? ("new" as const) : ("reference" as const),
        solve,
        valid: pair[side][at] === true,
        objective: pair.objective?.[side][at] ?? null,
        ending: endings.get(solve) ?? "not recorded",
        calls: calls.get(solve) ?? [],
      })),
    ),
  );
}

/** A solve's programs, each once in the order first run, with how many calls ran it. */
function programsLine(calls: readonly Call[]): string {
  const counts = new Map<string, number>();
  for (const call of calls) {
    for (const program of new Set(programsOf(call).programs)) {
      counts.set(program, (counts.get(program) ?? 0) + 1);
    }
  }
  return [...counts].map(([program, n]) => `${program}x${String(n)}`).join(" ") || NONE;
}

/** The printed rows: a header, the diff unless asked not to, a row a solve and a count a side. */
export function partsLines(
  rows: readonly SolveRow[],
  { session, old, fresh, paired }: { session: string; old: string; fresh: string; paired: number },
  written: Written | null,
  table: "all" | "parted" = "parted",
): string[] {
  const tasks = new Set(rows.map(({ task }) => task)).size;
  const touched =
    written === null
      ? []
      : [...written.added, ...written.changed, ...written.renamed.map(({ to }) => to)].filter(
          (path) => path !== GUIDE,
        );
  const list = (paths: readonly string[]) => (paths.length === 0 ? "none" : paths.join(" "));
  const prefix = sharedPrefix(rows.map(({ solve }) => solve));
  const head = [
    `parts (lane 16): ${session}, reference ${old.slice(0, 8)} against new ${fresh.slice(0, 8)}; the new harness won ${String(tasks)} of ${String(paired)} paired tasks, read as the report recorded each (WINS).`,
    "One row a solve of a won task: valid as the comparison read it, objective, ending, calls, and each program its calls ran with its count of calls (programsOf).",
    ...(prefix === "" ? [] : [`Solve ids leave off their shared prefix ${prefix}.`]),
    ...(written === null
      ? ["Diff left out (--no-diff)."]
      : [
          `What the new harness wrote against the reference (writtenIn, by content): added ${list(written.added)}; changed ${list(written.changed)}; removed ${list(written.removed)}; renamed ${list(written.renamed.map(({ from, to }) => `${from} -> ${to}`))}.`,
          ...(written.unkept.length === 0
            ? []
            : [
                `The reference's kept state holds no ${written.unkept.join(" and no ")}, so what the new one holds there counts as added; the reference rows below show which of those programs its own solves ran.`,
              ]),
          "ran: the first call that ran an added, changed or renamed program; named: the first call whose arguments name one by its file name.",
        ]),
  ];
  const lines = rows.map((row) => {
    const uses = written === null ? null : firstUses(row.calls, touched);
    return [
      row.task.slice(0, 8),
      row.side,
      row.solve.slice(prefix.length),
      row.valid ? "valid" : "invalid",
      row.objective === null ? NONE : String(row.objective),
      row.ending,
      `${String(row.calls.length)} calls`,
      programsLine(row.calls),
      ...(uses === null ? [] : [`ran ${uses.ran}`, `named ${uses.named}`]),
    ].join("  ");
  });
  return [...head, ...lines, ...ranTable(rows, touched, table)];
}

/** For each program any won solve ran (and each added or changed one), how many solves a side ran it:
 *  with `parted`, only the added or changed ones and those run by more solves of one side. */
function ranTable(rows: readonly SolveRow[], touched: readonly string[], table: "all" | "parted"): string[] {
  const sides = ["new", "reference"] as const;
  const ranBy = new Map(
    rows.map((row) => [row, new Set(row.calls.flatMap((call) => programsOf(call).programs))] as const),
  );
  const made = new Set(touched.flatMap(namesOf));
  const programs = new Set([...[...ranBy.values()].flatMap((each) => [...each]), ...touched.map(fileOf)]);
  const counted = [...programs].toSorted().map((program) => {
    const of = sides.map((side) => {
      const own = rows.filter((row) => row.side === side);
      return { side, ran: own.filter((row) => ranBy.get(row)?.has(program) === true).length, of: own.length };
    });
    return { program, made: made.has(program), of };
  });
  // A program one side's solves alone ran, in fewer than a tenth of them, is that side's own
  // one-off script (77 of the 109 rows of a buffer comparison of 25 October were such), and is counted
  // on one line a side instead of printed.
  const oneOff = ({ of: [one, other] }: (typeof counted)[number]) =>
    [one, other].some((side) => side?.ran === 0) &&
    [one, other].every((side) => side === undefined || side.ran * 10 < side.of);
  const kept = counted.filter(
    (each) => table === "all" || each.made || (each.of[0]?.ran !== each.of[1]?.ran && !oneOff(each)),
  );
  const alike = counted.filter((each) => !each.made && each.of[0]?.ran === each.of[1]?.ran).length;
  const folded = sides.map((side, at) => {
    const own = counted.filter((each) => !each.made && oneOff(each) && (each.of[at]?.ran ?? 0) > 0);
    return `${side} ${String(own.length)}`;
  });
  return [
    `Solves a side that ran each program, by programsOf's name (a shell command and a harness program of one name count together)${table === "all" ? "" : `; ${String(counted.length - kept.length)} of ${String(counted.length)} programs left out (--all prints them): ${String(alike)} run by as many solves on each side, and those one side alone ran in under a tenth of its solves, ${folded.join(", ")}`}:`,
    ...kept.map(
      ({ program, made: changed, of }) =>
        `  ${program}${changed ? " (added or changed)" : ""}  ${of.map(({ side, ran, of: all }) => `${side} ${String(ran)}/${String(all)}`).join("  ")}`,
    ),
  ];
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      log: { type: "string" },
      comparison: { type: "string" },
      "no-diff": { type: "boolean" },
      all: { type: "boolean" },
    },
  });
  if (values.log === undefined || values.comparison === undefined) throw new Error(USAGE);
  const log = await logAcross(values.log);
  const events = read(log);
  const found = wonPairs(events, values.comparison);
  const rows = solveRows(events, values.comparison);
  if (found === null || rows === null) {
    throw new Error(`no comparison ${values.comparison} reported in ${log}`);
  }
  const old = isString(found.report.data.old) ? found.report.data.old : "";
  const fresh = isString(found.report.data.fresh) ? found.report.data.fresh : "";
  const states = join(dirname(log), "states");
  const kept = existsSync(join(states, fresh));
  const written =
    values["no-diff"] === true || !kept ? null : writtenAgainst(join(states, old), join(states, fresh));
  console.log(
    [
      ...partsLines(
        rows,
        { session: values.comparison, old, fresh, paired: found.pairs.length },
        written,
        values.all === true ? "all" : "parted",
      ),
      ...(kept
        ? []
        : [`the new harness's state ${fresh.slice(0, 8)} is not kept beside the log, so no diff`]),
    ].join("\n"),
  );
}

if (import.meta.main) await main();
