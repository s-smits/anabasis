/**
 * Where each leaf of a submitted answer first appears, one row a solve, for lane 15's frozen table:
 *
 *   bun tools/wri/provenance.ts --log <log> --wins g-3 [--leaves]
 *   bun tools/wri/provenance.ts --log <log> --solves <id>,<id> [--leaves]
 *
 * A leaf is a number or a string of the judged answer (`verdictsOf`): each value of a JSON answer or
 * answer file, each cell of a CSV one and each number of any other text. Each is looked for, verbatim,
 * in what lay before the solve (the task's public input; the harness it ran under, its guide and its
 * own tool source, opened from the state beside the log; the public input of the practice tasks
 * released before that harness was first set to solve, and the measures their practice solves
 * returned to the Builder) and in the solve's own trace in log order (each call's arguments, then
 * its output, and the solver's turn text). The task's hidden values are a column of their own, on the
 * exam side. `--wins` reads the tasks a comparison's new harness won and the reference's solves of
 * them as the control; `--leaves` adds one line a leaf. It prints positions, sources and counts, never
 * a value, and reads no reading, score or other lane's file, so lane 15 stays isolated.
 *
 * 10 of 15 lane-15 sessions between 3 and 10 November wrote this search by hand (`trace.py` in six
 * versions, `literal.py`, `writer.py`), at a median of 44 calls a session, and 6 of the 9 calls the
 * lane guard refused there were greps of the kept states this opens itself.
 */
import { draftOf } from "#src/examiner/draft.ts";
import { proposalsOf } from "#src/kernel/history.ts";
import { type LogEvent, read } from "#src/kernel/log.ts";
import { lastReports } from "#src/kernel/reports.ts";
import { practiceRan, ranUnder, verdictsOf } from "#src/kernel/solves.ts";
import { type Call, tracesIn, type Turn } from "#src/kernel/trace.ts";
import { objectiveOf } from "#src/kernel/verify.ts";
import { AGENT_DIR, GENERATED_TOOLS_FILE, GUIDE_FILE, TOOLS_SPEC_FILE } from "#src/meta/bundle-layout.ts";
import { existsSync, readFileSync } from "#src/meta/filesystem.ts";
import { capturedJsonParse, capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { asRecord, isBoolean, isNumber, isString, type JsonValue } from "#src/meta/json-shape.ts";
import { dirname, join } from "#src/meta/path.ts";
import { parseArgs } from "#src/meta/process.ts";
import { exampleId } from "#tools/d2/exam.ts";
import { logAcross } from "#tools/runs/snapshots.ts";
import { countBy } from "#src/meta/tally.ts";
import { programsOf } from "./programs.ts";
import { indexOf } from "./folds.ts";
import { wonOf } from "./read.ts";
import { ownFilesOf } from "./trajectory.ts";

/** One value of an answer: where it stands, what it is, and its significant digits or length. */
interface Leaf {
  readonly position: string;
  readonly value: number | string;
  readonly size: number;
}

/** A text indexed for verbatim matches: each number at every precision it was written to. */
interface Holder {
  readonly text: string;
  readonly keys: ReadonlySet<string>;
}

/** A place a leaf may appear, before the solve or in it. */
interface Place {
  readonly source: Source;
  readonly where: string;
  readonly holder: Holder;
}

/** One leaf as found: its first place, the precision there, and who else holds it. */
interface Found {
  readonly leaf: Leaf;
  readonly first: Place | null;
  readonly precision: number | null;
  readonly holders: number;
  readonly held: ReadonlySet<Source>;
}

/** What one solve's leaves came to. */
export interface Row {
  readonly solve: string;
  readonly side: Side;
  readonly task: string;
  readonly harness: string;
  readonly found: readonly Found[];
  readonly writers: readonly Named[];
  readonly kept: boolean;
}

/** An answer file and the last call before the submit whose arguments name it, with what it ran. */
interface Named {
  readonly file: string;
  readonly call: number | null;
  readonly ran: string;
}

/** One solve to read, with what a reader needs of it from the log. */
export interface Asked {
  readonly solve: string;
  readonly side: Side;
}

type Side = "new" | "reference" | "asked";
type Source =
  | "input"
  | "hidden"
  | "call-args"
  | "call-output"
  | "turn-text"
  | "guide"
  | "tool-src"
  | "practice-input"
  | "practice-measure";

/** The first place a leaf is counted under, in this order. */
const FIRSTS = [
  "input",
  "call-args",
  "call-output",
  "turn-text",
  "guide",
  "tool-src",
  "practice-input",
  "practice-measure",
] as const satisfies readonly Source[];
/** The sources a leaf is also counted as held by, whatever came first. */
const HELD = [
  "guide",
  "tool-src",
  "practice-input",
  "practice-measure",
  "hidden",
] as const satisfies readonly Source[];
const IN_SOLVE: ReadonlySet<Source> = new Set(["call-args", "call-output", "turn-text"]);

/** Below this many significant digits a number matches only as written. */
const MIN_PRECISION = 3;
const MAX_PRECISION = 17;
/** A leaf this short (digits or characters) is printed with its size, as a chance match is likelier. */
const SHORT = 3;
const EXAMPLES = 3;
const NUMBER = /(?<![\w.])-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/gu;
const WHOLE_NUMBER = /^-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?$/u;
const CELLS = /[,\t|;]/u;
const TABLE_FILE = /\.(csv|tsv)$/u;
const SOLVE_SEAT = "solve";
const USAGE =
  "usage: bun tools/wri/provenance.ts --log <log> (--wins <comparison> | --solves <id,id>) [--leaves]";
const LEGEND = [
  "provenance (lane 15): where each leaf of a solve's judged answer first appears, verbatim. A number",
  `matches at the significant digits shown (as written, or rounded down to ${String(MIN_PRECISION)}), a string exactly;`,
  '"nowhere" is not found verbatim at any precision tried, which says nothing of what computed it.',
  "first: the task's public input, else the solve's first call-args, call-output or turn-text in log",
  "order, else the harness's guide, its tool source, the public input of practice released before the",
  "harness was first set to solve, or the measures its practice solves returned to the Builder.",
  "held: leaves a source holds whatever came first; hidden is the task's hidden values (exam side).",
  `short: leaves of at most ${String(SHORT)} digits or characters. No value is printed.`,
];

/** A number's significant digits as written: its digits less leading zeros, at least one. */
function digitsOf(written: string): number {
  const mantissa = written
    .replace(/^-/u, "")
    .replace(/[eE].*$/u, "")
    .replace(".", "");
  return Math.max(1, mantissa.replace(/^0+/u, "").length);
}

/** Every number in `text`, indexed at each precision from one to its written digits. */
export function holderOf(text: string): Holder {
  const keys = new Set<string>();
  for (const [written] of text.matchAll(NUMBER)) {
    const value = Number(written);
    if (!Number.isFinite(value)) continue;
    for (let digits = 1; digits <= Math.min(digitsOf(written), MAX_PRECISION); digits += 1) {
      keys.add(`${String(digits)}:${value.toPrecision(digits)}`);
    }
  }
  return { text, keys };
}

/** The precision at which `holder` holds `leaf`, or null: a string by its length, exactly. */
export function heldAt(holder: Holder, { value, size }: Leaf): number | null {
  if (isString(value)) return holder.text.includes(value) ? size : null;
  const from = Math.min(size, MAX_PRECISION);
  for (let digits = from; digits >= Math.min(from, MIN_PRECISION); digits -= 1) {
    if (holder.keys.has(`${String(digits)}:${value.toPrecision(digits)}`)) return digits;
  }
  return null;
}

/** Every string and number a JSON value holds, one a line. */
function flatText(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return "";
  if (isString(value)) return value;
  if (isNumber(value) || isBoolean(value)) return String(value);
  return (Array.isArray(value) ? value : Object.values(value)).map(flatText).join("\n");
}

const numberLeaf = (position: string, written: string): Leaf => ({
  position,
  value: Number(written),
  size: digitsOf(written),
});

/** The leaves of a JSON value under `at`. */
function jsonLeaves(value: JsonValue, at: string): Leaf[] {
  if (isNumber(value)) return [numberLeaf(at, String(value))];
  if (isString(value)) return value === "" ? [] : [{ position: at, value, size: value.length }];
  if (Array.isArray(value)) {
    return value.flatMap((each, index) => jsonLeaves(each, `${at}[${String(index)}]`));
  }
  if (value === null || isBoolean(value)) return [];
  return Object.entries(value).flatMap(([key, each]) => jsonLeaves(each, `${at}.${key}`));
}

/** One table cell or text line's leaves: a whole number, else its numbers, and a table's word. */
function cellLeaves(cell: string, at: string, unit: "cell" | "line"): Leaf[] {
  const trimmed = cell.trim();
  const table = unit === "cell";
  if (table && WHOLE_NUMBER.test(trimmed)) return [numberLeaf(at, trimmed)];
  const numbers = [...trimmed.matchAll(NUMBER)].map(([written], index) =>
    numberLeaf(`${at}#${String(index + 1)}`, written),
  );
  const word = table && trimmed !== "" && numbers.length === 0 && !/\s/u.test(trimmed);
  return word ? [{ position: at, value: trimmed, size: trimmed.length }] : numbers;
}

/** The leaves of one answer file: a JSON one walked, a table's cells, any other text's numbers. */
function fileLeaves(path: string, content: string): Leaf[] {
  if (path.endsWith(".json")) {
    try {
      return jsonLeaves(capturedJsonParse(content), `${path}:$`);
    } catch {
      // Not JSON after all, so it is read as text below.
    }
  }
  const table = TABLE_FILE.test(path);
  return content
    .split("\n")
    .flatMap((line, row) =>
      table
        ? line
            .split(CELLS)
            .flatMap((cell, column) =>
              cellLeaves(cell, `${path}:${String(row + 1)}:${String(column + 1)}`, "cell"),
            )
        : cellLeaves(line, `${path}:${String(row + 1)}`, "line"),
    );
}

/** Every leaf of a judged answer: its files' where it holds files, else the value walked. */
export function leavesOf(answer: JsonValue | undefined): Leaf[] {
  if (answer === undefined || answer === null) return [];
  const files = asRecord(asRecord(answer)?.files);
  if (files === null) return jsonLeaves(answer, "$");
  return Object.entries(files).flatMap(([path, content]) =>
    isString(content) ? fileLeaves(path, content) : jsonLeaves(content, `${path}:$`),
  );
}

/** Each task version's public input and hidden values, from its proposal or the drafted exam. */
function tasksOf(events: readonly LogEvent[]) {
  const drafted = new Map((draftOf(events)?.tasks ?? []).map((task, index) => [exampleId(index), task]));
  return new Map(
    proposalsOf(events).map(({ version, taskId, task }) => {
      const whole = task ?? drafted.get(taskId ?? "");
      return [
        version,
        whole === undefined ? null : { input: whole.publicInput, hidden: whole.hidden },
      ] as const;
    }),
  );
}

const fileText = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : null);

/** The harness's guide and its own tool source, from its state beside the log; none where not kept. */
function harnessPlaces(log: string, harness: string): Place[] {
  const state = join(dirname(log), "states", harness);
  if (!existsSync(state)) return [];
  const guide = fileText(join(state, AGENT_DIR, GUIDE_FILE));
  const own = ownFilesOf(state);
  const tools = [
    ...[GENERATED_TOOLS_FILE, TOOLS_SPEC_FILE].map((file) => ({
      where: file,
      text: fileText(join(state, file)),
    })),
    ...own.paths.map((path) => ({ where: path, text: fileText(join(own.root, path)) })),
  ];
  return [
    ...(guide === null ? [] : [{ source: "guide" as const, where: GUIDE_FILE, holder: holderOf(guide) }]),
    ...tools.flatMap(({ where, text }) =>
      text === null ? [] : [{ source: "tool-src" as const, where, holder: holderOf(text) }],
    ),
  ];
}

/** The practice the build side held before `cut`: released tasks' public input, practice measures. */
function practicePlaces(
  events: readonly LogEvent[],
  tasks: ReturnType<typeof tasksOf>,
): (cut: number) => Place[] {
  const releases = events.flatMap(({ kind, data }, index) =>
    kind === "task.state" && data.state === "released" && isString(data.version)
      ? [{ index, version: data.version }]
      : [],
  );
  const verdicts = verdictsOf(events);
  const practised = practiceRan(events).flatMap(({ id, finished }) => {
    const measure = finished === null ? null : objectiveOf(verdicts.get(id)?.checker);
    return measure === null || finished === null ? [] : [{ finished, measure }];
  });
  return (cut) => {
    const released = releases.flatMap(({ index, version }) => (index < cut ? [version] : []));
    const measures = practised.flatMap(({ finished, measure }) => (finished < cut ? [String(measure)] : []));
    return [
      ...released.map((version) => ({
        source: "practice-input" as const,
        where: version.slice(0, 8),
        holder: holderOf(flatText(tasks.get(version)?.input)),
      })),
      {
        source: "practice-measure",
        where: `${String(measures.length)} measures`,
        holder: holderOf(measures.join("\n")),
      },
    ];
  };
}

/** A solve's trace as places in log order: each call's arguments, then its output, and each turn. */
function tracePlaces(trace: readonly (Call | Turn)[]): Place[] {
  let number = 0;
  return trace.flatMap((each): Place[] => {
    if (each.part === "turn") {
      return [
        { source: "turn-text", where: `turn ${String(each.turn ?? "?")}`, holder: holderOf(each.text) },
      ];
    }
    number += 1;
    if (each.tool === "submit") return [];
    const where = `call ${String(number)} turn ${String(each.turn ?? "?")} ${ranBy(each)}`;
    return [
      { source: "call-args", where, holder: holderOf(flatText(each.args)) },
      { source: "call-output", where, holder: holderOf(each.text) },
    ];
  });
}

/** What a call ran, as `programsOf` reads it, or its tool where that names none. */
function ranBy(call: Call): string {
  const { programs } = programsOf(call);
  return programs.length === 0 ? call.tool : `${call.tool}(${[...new Set(programs)].join("+")})`;
}

/** For each answer file, the last call before the submit whose arguments name it. */
function writersOf(answer: JsonValue | undefined, calls: readonly Call[]): Named[] {
  return Object.keys(asRecord(asRecord(answer)?.files) ?? {}).map((file) => {
    const at = calls.findLastIndex(
      (call) => call.tool !== "submit" && capturedJsonStringify(call.args).includes(file),
    );
    const call = calls[at];
    return { file, call: call === undefined ? null : at + 1, ran: call === undefined ? "none" : ranBy(call) };
  });
}

/** One leaf against the places, the public input first and the trace in order. */
function findOf(leaf: Leaf, places: readonly Place[]): Found {
  const holding = places.flatMap((place) => {
    const precision = heldAt(place.holder, leaf);
    return precision === null ? [] : [{ place, precision }];
  });
  const firstOf = (source: Source) => holding.find(({ place }) => place.source === source);
  const order = [
    firstOf("input"),
    holding.find(({ place }) => IN_SOLVE.has(place.source)),
    ...FIRSTS.slice(4).map(firstOf),
  ];
  const first = order.find((each) => each !== undefined) ?? null;
  return {
    leaf,
    first: first?.place ?? null,
    precision: first?.precision ?? null,
    holders: holding.length,
    held: new Set(holding.map(({ place }) => place.source)),
  };
}

/** Each asked solve's leaves, found. A solve with no judged answer or no recorded task is left out. */
export function provenanceOf(events: readonly LogEvent[], log: string, asked: readonly Asked[]): Row[] {
  const verdicts = verdictsOf(events);
  const ran = new Map(ranUnder(events).map((each) => [each.id, each]));
  const tasks = tasksOf(events);
  const practiceAt = practicePlaces(events, tasks);
  const harnesses = new Map<string, Place[]>();
  const practices = new Map<number, Place[]>();
  const traces = Map.groupBy(
    tracesIn(events).filter(
      (each): each is Call | Turn => each.seat === SOLVE_SEAT && each.part !== "compacted",
    ),
    ({ id }) => id,
  );
  const ids = [...ran.keys()];
  return asked.flatMap(({ solve: named, side }) => {
    const matching = ids.filter((id) => id.endsWith(named));
    const solve = ran.has(named) || matching.length !== 1 ? named : (matching[0] ?? named);
    const solved = ran.get(solve);
    const answer = verdicts.get(solve)?.answer;
    if (solved === undefined || answer === undefined) return [];
    const { harness, task } = solved.under;
    // The practice it could hold: what was released before the harness was first set to solve.
    const set = events.findIndex(
      ({ kind, data }) => kind === "condition.recorded" && asRecord(data.condition)?.harness === harness,
    );
    const cut = set === -1 ? solved.started : Math.min(set, solved.started);
    const own = tasks.get(task);
    const trace = traces.get(solve) ?? [];
    const harnessed = harnesses.get(harness) ?? harnessPlaces(log, harness);
    harnesses.set(harness, harnessed);
    const practice = practices.get(cut) ?? practiceAt(cut);
    practices.set(cut, practice);
    const places = [
      { source: "input" as const, where: "public input", holder: holderOf(flatText(own?.input)) },
      ...tracePlaces(trace),
      ...harnessed,
      ...practice,
      { source: "hidden" as const, where: "hidden values", holder: holderOf(flatText(own?.hidden)) },
    ];
    return [
      {
        solve,
        side,
        task,
        harness,
        found: leavesOf(answer).map((leaf) => findOf(leaf, places)),
        writers: writersOf(
          answer,
          trace.filter((each): each is Call => each.part === "call"),
        ),
        kept: harnessed.length > 0,
      },
    ];
  });
}

/** Comparison `session`'s last report, its pairs, and the pairs its new harness won, as `WINS` reads
 *  them (`wonOf`, `read.ts`); null where no report of it stands. */
export function wonPairs(events: readonly LogEvent[], session: string) {
  const report = lastReports(events).find((each) => each.session === session);
  const found = wonOf(indexOf(events)).find((each) => each.session === session);
  return report === undefined || found === undefined ? null : { report, pairs: found.pairs, won: found.won };
}

/** The solves of the tasks comparison `session`'s new harness won, each side's (`wonPairs`). */
export function winsOf(events: readonly LogEvent[], session: string): Asked[] | null {
  return (
    wonPairs(events, session)?.won.flatMap(({ solves }) => [
      ...(solves?.fresh ?? []).map((solve) => ({ solve, side: "new" as const })),
      ...(solves?.old ?? []).map((solve) => ({ solve, side: "reference" as const })),
    ]) ?? null
  );
}

const countOf = (found: readonly Found[], test: (each: Found) => boolean) =>
  String(found.filter(test).length).padStart(6);

/** The column counts of a set of leaves: by first source, then by holder. */
function countsOf(found: readonly Found[]): string {
  return [
    String(found.length).padStart(6),
    ...FIRSTS.map((source) => countOf(found, ({ first }) => first?.source === source)),
    countOf(found, ({ first }) => first === null),
    ...HELD.map((source) => countOf(found, ({ held }) => held.has(source))),
    countOf(
      found,
      ({ held }) => held.has("tool-src") && (held.has("practice-input") || held.has("practice-measure")),
    ),
    countOf(found, ({ leaf }) => leaf.size <= SHORT),
  ].join(" ");
}

const HEADER = [
  "leaves",
  ...FIRSTS,
  "nowhere",
  ...HELD.map((source) => `held:${source}`),
  "tool+practice",
  "short",
].join(" ");

/** One line a leaf: position, kind, size, first place and precision, holders. */
function leafLine(solve: string, { leaf, first, precision, holders, held }: Found): string {
  const kind = isString(leaf.value)
    ? `string of ${String(leaf.size)}`
    : `number of ${String(leaf.size)} digits`;
  const at = first === null ? "nowhere" : `${first.source} ${first.where} at ${String(precision)}`;
  const also = [...held].filter((source) => source !== first?.source).join(",");
  return `  ${solve} ${leaf.position} ${kind}: ${at}; held by ${String(holders)} places${also === "" ? "" : ` (also ${also})`}`;
}

/** The longest prefix ending in "-" that every solve id shares, which the table leaves off. */
export function sharedPrefix(ids: readonly string[]): string {
  const [first = ""] = ids;
  let length = first.length;
  for (const id of ids) {
    while (!id.startsWith(first.slice(0, length))) length -= 1;
  }
  return first.slice(0, first.lastIndexOf("-", length - 1) + 1);
}

const numbersIn = (found: readonly Found[]) => found.filter(({ leaf }) => isNumber(leaf.value));

/** The printed table: a legend, a row a solve, a total a side, and examples a first source. */
export function provenanceLines(rows: readonly Row[], leaves: "all" | "examples"): string[] {
  const unkept = new Set(rows.filter(({ kept }) => !kept).map(({ harness }) => harness.slice(0, 8)));
  const prefix = sharedPrefix(rows.map(({ solve }) => solve));
  const named = (solve: string) => solve.slice(prefix.length);
  const sides = Map.groupBy(rows, ({ side }) => side);
  const examples = FIRSTS.flatMap((source) =>
    rows
      .flatMap(({ solve, found }) =>
        found.filter(({ first }) => first?.source === source).map((each) => leafLine(named(solve), each)),
      )
      .slice(0, EXAMPLES),
  );
  return [
    ...LEGEND,
    ...(prefix === "" ? [] : [`solve ids below leave off their shared prefix ${prefix}`]),
    ...(unkept.size === 0
      ? []
      : [
          `harness states not kept beside the log, so no guide or tool source read: ${[...unkept].join(" ")}`,
        ]),
    `numbers: solve side harness task ${HEADER}`,
    ...rows.map(
      ({ solve, side, harness, task, found }) =>
        `${named(solve)} ${side} ${harness.slice(0, 8)} ${task.slice(0, 8)} ${countsOf(numbersIn(found))}`,
    ),
    ...[...sides].flatMap(([side, each]) => {
      const all = each.flatMap(({ found }) => found);
      const of = `${side} (${String(each.length)} solves)`;
      return [
        `total numbers ${of} ${countsOf(numbersIn(all))}`,
        `total strings ${of} ${countsOf(all.filter(({ leaf }) => isString(leaf.value)))}`,
      ];
    }),
    ...[...sides].map(([side, each]) => {
      const byRan = countBy(
        each.flatMap(({ writers }) => writers),
        ({ ran }) => ran,
      );
      const said = Object.entries(byRan)
        .toSorted(([, one], [, other]) => other - one)
        .map(([by, n]) => `${by} ${String(n)}`);
      return `answer files ${side} by last-call-naming-the-file (the last call before the submit whose arguments name it; not shown to have written it), what that call ran: ${said.join(", ") || "no answer files"}`;
    }),
    ...(leaves === "all"
      ? rows.flatMap(({ solve, found, writers }) => [
          `  ${named(solve)} last-call-naming-the-file (not shown to have written it): ${writers.map(({ file, call, ran }) => `${file} ${call === null ? "none" : `call ${String(call)} ${ran}`}`).join("; ")}`,
          ...found.map((each) => leafLine(named(solve), each)),
        ])
      : [`examples (up to ${String(EXAMPLES)} a first source):`, ...examples]),
  ];
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      log: { type: "string" },
      wins: { type: "string" },
      solves: { type: "string" },
      leaves: { type: "boolean" },
    },
  });
  if (values.log === undefined || (values.wins === undefined) === (values.solves === undefined)) {
    throw new Error(USAGE);
  }
  const log = await logAcross(values.log);
  const events = read(log);
  const asked =
    values.wins === undefined
      ? (values.solves ?? "")
          .split(",")
          .filter((solve) => solve !== "")
          .map((solve) => ({ solve, side: "asked" as const }))
      : winsOf(events, values.wins);
  if (asked === null) throw new Error(`no comparison ${values.wins ?? ""} reported in ${log}`);
  console.log(
    provenanceLines(provenanceOf(events, log, asked), values.leaves === true ? "all" : "examples").join("\n"),
  );
}

if (import.meta.main) await main();
