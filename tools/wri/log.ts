/**
 * The one query tool a lane runs over a campaign's log, in four verbs with fixed flags:
 *
 *   bun tools/wri/log.ts kinds --log <log> [--kind <kind>[,<kind>...]]
 *   bun tools/wri/log.ts events --log <log> --kind <kind>[,<kind>...] [--fields a,b.c] [--where f=v|f!=v|f~prefix|f>n|f>=n|f<n|f<=n]... [--count-by f[,g]] [--full]
 *   bun tools/wri/log.ts solves --log <log> [--comparison <id>] [--role old|new|both|try|practice] [--where column<op>value]... [--count-by column[,column]]
 *   bun tools/wri/log.ts trace --log <log> <solve or session id>
 *
 * `kinds` gives each event kind's count and lines, and each `data` key with its JSON types and the
 * first and last line holding it, so a key that an old log lacks or a shape that changed shows as
 * lines, never as a value. `events` prints the chosen fields of one kind, or of several in the log's
 * order with the kind beside each, a line, at the log's line numbers, with every string over 80 characters cut and a digest shortened (`--full` lifts both), or
 * counts one field's values. `solves` prints one row a solve from the folds (`indexOf`,
 * `folds.ts`): its comparison is the one its start names or the fold's window for an older report,
 * never the comparison that started last, and its `--where` and `--count-by` name its columns. `trace` names the `slice.ts` command (oracle-handover)
 * that prints a solve's or a session's turns and calls.
 *
 * Between 3 and 10 November, 104 of 107 lane sessions listed an event kind's keys by hand (829
 * commands), 103 selected a kind (2,472), and 78 joined each solve to its comparison's side in 61
 * scripts of their own, one of which took the last `comparison.started` for a solve's comparison.
 * A timeline of several kinds at once was written by hand in 68 of those sessions, 7 of lane 25's 13.
 * A numeric bound on a field (`ms > 400000`) was written by hand in 24, 3 of lane 24's 7, and 11 of
 * lane 10's 26 grouped the passes under a tenth of the deadline by harness with `awk` over `solves`.
 * `events` prints what the log holds, hidden values among them, which is the exam side's to read
 * and never a seat's. It is no query language: a question these flags cannot ask is `jq`'s.
 */
import { proposalsOf } from "#src/kernel/history.ts";
import { LOG_FILE, type LogEvent, read } from "#src/kernel/log.ts";
import { type Seat, tracesIn } from "#src/kernel/trace.ts";
import { existsSync, statSync } from "#src/meta/filesystem.ts";
import {
  asRecord,
  isNumber,
  isString,
  type JsonObject,
  type JsonValue,
  typeName,
} from "#src/meta/json-shape.ts";
import { keysIf } from "#src/meta/optional-key.ts";
import { join } from "#src/meta/path.ts";
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import { countBy } from "#src/meta/tally.ts";
import { indexOf, type Solve } from "./folds.ts";

/** A string printed whole only under `--full`: one task statement or call result fills a screen. */
const CUT = 80;
const DIGEST = /^[0-9a-f]{64}$/u;
const NOT_RECORDED = "n/r";
const SLICE = ".claude/skills/oracle-handover/scripts/slice.ts";
/** The selector seat `slice.ts` reads for each of the log's seats. */
const SLICE_SEATS = new Map(
  Object.entries({
    build: "Builder",
    exam: "Examiner",
    draft: "Drafter",
    referee: "Referee",
    solve: "Solver",
  } satisfies Record<Seat, string>),
);
const VERBS = ["kinds", "events", "solves", "trace"];
/** The numeric comparisons `--where` takes, each against a number written after it. */
const BOUNDS = new Map([
  [">", (value: number, bound: number) => value > bound],
  [">=", (value: number, bound: number) => value >= bound],
  ["<", (value: number, bound: number) => value < bound],
  ["<=", (value: number, bound: number) => value <= bound],
]);
/** The columns of `solves`, which `--where` and `--count-by` name; a number is printed with these digits. */
const SOLVE_COLUMNS = [
  "solve",
  "comparison",
  "role",
  "harness",
  "task",
  "family",
  "outcome",
  "kind",
  "ruled",
  "turns",
  "bound",
  "prompts",
  "seconds",
  "deadline",
  "load",
  "cores",
  "billed",
] as const;
const DIGITS = new Map([
  ["deadline", 0],
  ["load", 1],
  ["billed", 2],
]);

interface SolveQuery {
  readonly comparison?: string | undefined;
  readonly role?: string | undefined;
  readonly where?: readonly string[] | undefined;
  readonly countBy?: string | undefined;
}

interface EventQuery {
  readonly kind: string;
  readonly fields: readonly string[];
  readonly where: readonly string[];
  readonly countBy: string | undefined;
  readonly full: boolean;
}

/** Where one `data` key stood: the JSON types it held and the lines it held them on. */
interface KeyHeld {
  readonly types: Set<string>;
  readonly lines: number[];
}
interface KindHeld {
  readonly lines: number[];
  readonly keys: Map<string, KeyHeld>;
}

/** A log named by its path or by its campaign's folder. */
export function logPath(named: string): string {
  return existsSync(named) && statSync(named).isDirectory() ? join(named, LOG_FILE) : named;
}

/** Lines of the log are its events' indices from 1, as `grep -n` and `sed -n` count them. */
const lineOf = (index: number) => index + 1;
function span(lines: readonly number[]): string {
  const [first = 0, last = first] = [lines[0], lines.at(-1)];
  return first === last ? `line ${String(first)}` : `lines ${String(first)}-${String(last)}`;
}

/** Each kind and each of its `data` keys: the types each held and the lines it stood on. */
export function kindRows(events: readonly LogEvent[], only?: ReadonlySet<string>): string[] {
  const kinds = new Map<string, KindHeld>();
  for (const [index, { kind, data }] of events.entries()) {
    const entry: KindHeld = kinds.get(kind) ?? { lines: [], keys: new Map() };
    kinds.set(kind, entry);
    entry.lines.push(lineOf(index));
    for (const [key, value] of Object.entries(data)) {
      const held: KeyHeld = entry.keys.get(key) ?? { types: new Set(), lines: [] };
      entry.keys.set(key, held);
      held.types.add(typeName(value));
      held.lines.push(lineOf(index));
    }
  }
  const rows = [
    "kinds: each event kind's count and lines, then each data key's JSON types, how many events hold it and on which lines; no value is printed",
  ];
  for (const [kind, { lines, keys }] of [...kinds].toSorted(([one], [other]) => one.localeCompare(other))) {
    if (only !== undefined && !only.has(kind)) continue;
    rows.push(`${kind} ${String(lines.length)}, ${span(lines)}`);
    for (const [key, { types, lines: on }] of [...keys].toSorted(([one], [other]) =>
      one.localeCompare(other),
    )) {
      const some = on.length === lines.length ? "" : `, in ${String(on.length)} of ${String(lines.length)}`;
      rows.push(`  ${key} ${[...types].toSorted().join("|")}${some}, ${span(on)}`);
    }
  }
  return rows;
}

/** A field by its dotted path into an event's `data`. */
function fieldOf(data: JsonValue, path: string): JsonValue | undefined {
  let value: JsonValue | undefined = data;
  for (const part of path.split(".")) value = asRecord(value)?.[part];
  return value;
}

/** A value as one cell: a string as itself, anything else as JSON, absent as `-`. */
const whole = (value: JsonValue | undefined): string =>
  value === undefined ? "-" : isString(value) ? value : JSON.stringify(value);

/** A cell cut to `CUT` characters, with the count cut, and a digest to its first eight. */
function cell(value: JsonValue | undefined, full: boolean): string {
  const said = whole(value).replaceAll("\n", String.raw`\n`);
  if (full) return said;
  if (DIGEST.test(said)) return said.slice(0, 8);
  return said.length > CUT ? `${said.slice(0, CUT)}[+${String(said.length - CUT)} chars]` : said;
}

/**
 * Whether an event's field meets one `--where`, on the uncut value: `f=v`, `f!=v` and `f~prefix` on
 * its text, `f>n`, `f>=n`, `f<n` and `f<=n` on its number. A field that is absent or not a number
 * meets no numeric bound, and is `unmeasured`, so that `eventRows` counts it apart instead of as 0.
 */
function meets(data: JsonValue, condition: string): boolean | "unmeasured" {
  const [, path = "", op = "", wanted = ""] = /^([\w.]+)(!=|>=|<=|=|~|>|<)(.*)$/u.exec(condition) ?? [];
  const bound = BOUNDS.get(op);
  if (path === "" || (bound !== undefined && (wanted.trim() === "" || !Number.isFinite(Number(wanted))))) {
    throw new Error(`--where ${condition}: write f=v, f!=v, f~prefix, or f>n, f>=n, f<n, f<=n with a number`);
  }
  const field = fieldOf(data, path);
  if (bound !== undefined) return isNumber(field) ? bound(field, Number(wanted)) : "unmeasured";
  const value = whole(field);
  if (op === "~") return value.startsWith(wanted);
  return op === "=" ? value === wanted : value !== wanted;
}

/** The items whose fields meet every `--where`, and the words that say so, with those a bound left out. */
function filtered<T>(items: readonly T[], dataOf: (item: T) => JsonValue, where: readonly string[]) {
  let unmeasured = 0;
  const chosen = items.filter((item) => {
    const met = where.map((condition) => meets(dataOf(item), condition));
    if (met.includes("unmeasured")) unmeasured += 1;
    return met.every((each) => each === true);
  });
  const left =
    unmeasured === 0 ? "" : ` (${String(unmeasured)} left out: a bounded field absent or not a number)`;
  return { chosen, filters: where.length === 0 ? "" : ` where ${where.join(" and ")}${left}` };
}

/** One kind's events a row each, or several kinds' with the kind named, or one field's counts. */
export function eventRows(events: readonly LogEvent[], query: EventQuery): string[] {
  const kinds = new Set(query.kind.split(","));
  const several = kinds.size > 1;
  const { chosen, filters } = filtered(
    events.flatMap((event, index) => (kinds.has(event.kind) ? [{ line: lineOf(index), event }] : [])),
    ({ event }) => event.data,
    query.where,
  );
  if (query.countBy !== undefined) {
    const by = query.countBy;
    const counts = countBy(chosen, ({ event }) =>
      by
        .split(",")
        .map((field) => cell(fieldOf(event.data, field), query.full))
        .join(" "),
    );
    return [
      `events: ${String(chosen.length)} ${query.kind}${filters}, counted by ${by}`,
      ...Object.entries(counts)
        .toSorted(([, one], [, other]) => other - one)
        .map(([value, number]) => `${String(number)} ${value}`),
    ];
  }
  const cut = query.full
    ? ""
    : `, strings cut at ${String(CUT)} characters and digests at 8 (--full lifts both)`;
  return [
    `events: ${String(chosen.length)} ${query.kind}${filters}, a row each: log line, time, ${several ? "kind, " : ""}then ${query.fields.length === 0 ? "every data field" : query.fields.join(", ")}${cut}`,
    ...chosen.map(({ line, event }) => {
      const named = query.fields.length === 0 ? Object.keys(event.data) : query.fields;
      const cells = named.map((path) =>
        query.fields.length === 0
          ? `${path}=${cell(fieldOf(event.data, path), query.full)}`
          : cell(fieldOf(event.data, path), query.full),
      );
      return [String(line), event.at, ...(several ? [event.kind] : []), ...cells].join("\t");
    }),
  ];
}

/**
 * One solve's columns as values: a number stays a number for `--where`, a field the log does not
 * record is null (`n/r`), and the seconds and share of the deadline of a solve with no end are absent.
 */
function solveRecord(solve: Solve, ruled: string | null | undefined, family: string | undefined): JsonObject {
  const ended = solve.outcome !== null;
  const share = ended && solve.wallSeconds > 0 ? Math.round((solve.seconds / solve.wallSeconds) * 100) : null;
  return {
    solve: solve.id,
    comparison: solve.comparison ?? "-",
    role: solve.role,
    harness: solve.harness.slice(0, 8),
    task: solve.task === "" ? null : solve.task,
    family: family ?? null,
    outcome: solve.outcome ?? "open",
    kind: solve.kind ?? "-",
    ruled: ruled ?? "-",
    turns: solve.turns,
    bound: solve.modelTurns,
    prompts: solve.prompts,
    ...keysIf(ended, () => ({ seconds: Math.round(solve.seconds), deadline: share })),
    load: solve.load,
    cores: solve.cores,
    billed: solve.billed,
  };
}

function solveCell(record: JsonObject, column: string): string {
  const value = record[column];
  if (value === undefined) return "-";
  if (value === null) return NOT_RECORDED;
  if (isNumber(value)) return `${value.toFixed(DIGITS.get(column) ?? 0)}${column === "deadline" ? "%" : ""}`;
  return whole(value);
}

/** Every solve a row as the folds read it, or one column's counts among them, then by role and outcome. */
export function solveRows(events: readonly LogEvent[], only: SolveQuery): string[] {
  const index = indexOf(events);
  const families = new Map(proposalsOf(events).map(({ version, family }) => [version, family ?? undefined]));
  const records = index.solves
    .filter(
      (solve) =>
        (only.comparison === undefined || solve.comparison === only.comparison) &&
        (only.role === undefined || solve.role === only.role),
    )
    .map((solve) => solveRecord(solve, index.stands.get(solve.id), families.get(solve.version)));
  const { chosen, filters } = filtered(records, (record) => record, only.where ?? []);
  const by = only.countBy;
  if (by !== undefined) {
    const columns = by.split(",");
    const unknown = columns.find((each) => !SOLVE_COLUMNS.some((column) => column === each));
    if (unknown !== undefined) {
      throw new Error(`--count-by ${unknown}: name a column, one of ${SOLVE_COLUMNS.join(", ")}`);
    }
    const counts = countBy(chosen, (record) => columns.map((column) => solveCell(record, column)).join(" "));
    return [
      `solves: ${String(chosen.length)}${filters}, counted by ${by}`,
      ...Object.entries(counts)
        .toSorted(([, one], [, other]) => other - one)
        .map(([value, count]) => `${String(count)} ${value}`),
    ];
  }
  const tally = countBy(chosen, (record) => `${solveCell(record, "role")} ${solveCell(record, "outcome")}`);
  return [
    `solves: ${String(chosen.length)}${filters}, a row each from the folds (indexOf); ${NOT_RECORDED} is a field this log does not record, an open solve has no end on record, and deadline is the share of the wall-clock limit its seconds took`,
    SOLVE_COLUMNS.join("\t"),
    ...chosen.map((record) => SOLVE_COLUMNS.map((column) => solveCell(record, column)).join("\t")),
    `by role and outcome: ${
      chosen.length === 0
        ? "none"
        : Object.entries(tally)
            .map(([name, count]) => `${name} ${String(count)}`)
            .join(", ")
    }`,
  ];
}

/** The `slice.ts` command for each seat's trace or solve whose id is `id`, or ends or begins so. */
export function traceRows(events: readonly LogEvent[], id: string, log: string): string[] {
  const owners = new Map<string, string>();
  for (const { seat, id: owner } of tracesIn(events)) owners.set(`${seat} ${owner}`, owner);
  for (const { kind, data } of events) {
    if (kind === "solve.started" && isString(data.solve)) owners.set(`solve ${data.solve}`, data.solve);
  }
  const exact = [...owners].filter(([, owner]) => owner === id);
  const near = [...owners].filter(([, owner]) => owner.endsWith(id) || owner.startsWith(id));
  const found = exact.length > 0 ? exact : near;
  if (found.length === 0) return [`trace: no solve or session ${id} in this log`];
  if (new Set(found.map(([, owner]) => owner)).size > 1) {
    return [
      `trace: ${id} names ${String(found.length)} solves or sessions; name one whole`,
      ...found.map(([key]) => `  ${key}`),
    ];
  }
  return [
    `trace: the command that prints ${id}'s turns, each with the calls it made (slice.ts, oracle-handover), cut at 2000 characters an item`,
    ...found.map(([key, owner]) => {
      const seat = SLICE_SEATS.get(key.split(" ")[0] ?? "") ?? "";
      return `bun ${SLICE} ${log} '${seat}:${owner}{1-}' --max-chars 2000`;
    }),
  ];
}

function main(argv: readonly string[]): string[] {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      log: { type: "string" },
      kind: { type: "string" },
      fields: { type: "string" },
      where: { type: "string", multiple: true },
      "count-by": { type: "string" },
      full: { type: "boolean", default: false },
      comparison: { type: "string" },
      role: { type: "string" },
    },
  });
  const [verb = "", named] = positionals;
  if (!VERBS.includes(verb) || values.log === undefined) {
    throw new Error(`usage: bun tools/wri/log.ts ${VERBS.join("|")} --log <log> (see the head comment)`);
  }
  const log = logPath(values.log);
  if (!existsSync(log)) throw new Error(`${log}: no log`);
  const events = read(log);
  if (verb === "kinds") {
    return kindRows(events, values.kind === undefined ? undefined : new Set(values.kind.split(",")));
  }
  if (verb === "solves") {
    return solveRows(events, {
      comparison: values.comparison,
      role: values.role,
      where: values.where,
      countBy: values["count-by"],
    });
  }
  if (verb === "trace") {
    if (named === undefined) throw new Error("name a solve or session: log.ts trace --log <log> <id>");
    return traceRows(events, named, log);
  }
  if (values.kind === undefined) throw new Error("name one --kind: log.ts kinds lists them");
  return eventRows(events, {
    kind: values.kind,
    fields: values.fields?.split(",").filter((field) => field !== "") ?? [],
    where: values.where ?? [],
    countBy: values["count-by"],
    full: values.full,
  });
}

if (import.meta.main) console.log(main(runtimeProcess.argv.slice(2)).join("\n"));
