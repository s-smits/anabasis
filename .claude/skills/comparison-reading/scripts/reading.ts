#!/usr/bin/env bun
/**
 * Compare recorded reports with the current comparison rules.
 *
 *   bun .claude/skills/comparison-reading/scripts/reading.ts <log.jsonl | campaign folder | name>
 *     [--comparison <id>] [--level <n>]
 *
 * For each comparison's last report, show its reading, full and unbilled tests, frontier and retained
 * tallies, A/A control, room and omitted-task counts. Re-evaluate the step with stepOf and the A/A
 * with readsStepEitherWay, marking any disagreement with the recorded reading. Older reports may
 * lack the scores required by the current rule. --level uses the requested level for the test.
 *
 * Beside the test it gives what 15 of 20 lane-18 sessions between 3 and 10 November rebuilt by hand:
 * the p read for the reference (a starter comparison confirms on it), a step's wins to spare or a
 * reading's losses short of a step (`clearance.ts`, largest margins first), the wins a step on
 * equal margins needs beside the losses read (`clearing`), whether the A/A tied every task, and
 * the comparison's dollar cap against its test at the dollars its counted solves billed.
 *
 * Names resolve through logAcross; read and lastReports own log parsing and report selection.
 * This script evaluates recorded scores. Use promotion-tuner/lab.ts to rescore recorded solves
 * under other rules. Output contains session ids, counts, short digests and harness letters;
 * it omits task identities, families, answers, objective measures and checks.
 *
 * Written on 30 October, when AGENTS.md sections 7 and 8 moved into comparison-reading.
 */
import { type CommandArgs, CommandFailure, runCommand } from "#skills/main/cli.ts";
import { billedRate } from "#src/campaign/admission.ts";
import { calledBy, type Called, namesOf } from "#src/campaign/names.ts";
import {
  flipP,
  readsStep,
  readsStepEitherWay,
  scoresIn,
  testedSet,
  testOf,
  type Tally,
  UNMEASURED,
} from "#src/kernel/compare.ts";
import { type LogEvent, read } from "#src/kernel/log.ts";
import { lastReports, roomOf } from "#src/kernel/reports.ts";
import { ended, solvesIn } from "#src/kernel/solves.ts";
import {
  asRecord,
  isBoolean,
  isNumber,
  isString,
  type JsonObject,
  type JsonValue,
} from "#src/meta/json-shape.ts";
import { logAcross } from "#tools/runs/snapshots.ts";
import { equalMost, equalNeed, shortOf, spareOf } from "#tools/wri/clearance.ts";

const USAGE = `usage:
  bun .claude/skills/comparison-reading/scripts/reading.ts <log.jsonl | campaign folder | campaign name>
    [--comparison <id>] [--level <n>]

A campaign's name is read where \`logAcross\` finds it, on this host or another ANA_HOSTS names.
--comparison  this comparison only (its session id, as g-1)
--level       read the step and the A/A at this level, in place of each comparison's own`;
const OPTIONS = { comparison: "text", level: "text" } as const;
/** The kinds of task a report lists apart from the tallied ones, in the order they are told. */
const APART = ["aside", "short", "disputed", "flagged", "withdrawn"] as const;

/** A tally with its p. */
type Tested = Tally & { readonly p: number };

/** A comparison's start: its data, and the mean dollars a finished solve billed before it. */
interface Start {
  readonly data: JsonObject;
  readonly rate: number | null;
}

/** A comparison's dollar cap as its start holds it, and its test (the tasks its start names at its
 *  solves a side) priced at the mean dollars a finished solve billed before it. Null is unrecorded. */
interface Cap {
  readonly dollars: number | null;
  readonly reserve: number | null;
  readonly solves: number | null;
  readonly rate: number | null;
  readonly cost: number | null;
  readonly capped: boolean | null;
}

/** One comparison as its last report reads, and as this tree's rules read it again. */
export interface Row {
  readonly session: string;
  readonly reading: string;
  readonly old: string;
  readonly fresh: string | null;
  readonly level: number;
  readonly solves: number | null;
  /** The test as tallied, and the same tasks without the bill in a report of 26 October to
   *  2 November, which the step read; null where nothing was tallied, and `unbilled` null in any
   *  other report. */
  readonly scored:
    | (Tested & {
        /** The share detected four times in five: null where none is, undefined where unrecorded. */
        readonly detectable: number | null | undefined;
        readonly falseRate: number | null;
      })
    | null;
  readonly unbilled: Tested | null;
  readonly frontier: Tested | null;
  readonly retained: Tested | typeof UNMEASURED | null;
  /** The reference against itself: its tally, flip rate and whether it reads a step either way. */
  readonly aa: (Tally & { readonly flips: number | null; readonly either: boolean }) | null;
  /** The p of the scores read for the reference instead: null where nothing was tallied. */
  readonly reverse: number | null;
  /** On the scores the test read: a step's wins to spare, or a reading without one's losses short
   *  of a step (null where turning every loss does not reach one); null where nothing was tallied. */
  readonly margin: { readonly spare: number } | { readonly short: number | null } | null;
  /** On equal margins: the wins a step needs beside the losses read, and the tally with the most
   *  losses the untied tasks could hold and read a step (null where none). */
  readonly need: {
    readonly losses: number;
    readonly wins: number | null;
    readonly untied: number;
    readonly most: { readonly wins: number; readonly losses: number } | null;
  } | null;
  readonly cap: Cap;
  readonly room: "none" | "too-hard" | "room";
  readonly tallied: number;
  readonly apart: Readonly<Record<(typeof APART)[number], number>>;
  /** This tree's `stepOf` at `level`; null where the report holds no frontier with its unbilled
   *  scores to read it on. */
  readonly reread: "step" | "no-step" | null;
}

/** The numbers `value` holds, or null where it is no list of numbers. */
function numbers(value: JsonValue | undefined): readonly number[] | null {
  return Array.isArray(value) && value.every(isNumber) ? value : null;
}

/** A recorded tally with its p, or null where `value` holds none. */
function testedIn(value: JsonValue | undefined): Tested | null {
  const set = asRecord(value);
  const [wins, losses, ties, p] = [set?.wins, set?.losses, set?.ties, set?.p];
  return isNumber(wins) && isNumber(losses) && isNumber(ties) && isNumber(p)
    ? { wins, losses, ties, p }
    : null;
}

/** How many entries the list at `value` holds. */
function count(value: JsonValue | undefined): number {
  return Array.isArray(value) ? value.length : 0;
}

/** The step this tree's rule reads on the report, or null where it holds too little to read. */
function rereadOf(data: JsonObject, level: number): "step" | "no-step" | null {
  if (!Array.isArray(asRecord(data.scored)?.differences)) return null;
  return readsStep(scoresIn(data.scored), level) ? "step" : "no-step";
}

/** The A/A of a report, read either way at `level`. */
function aaOf(noise: JsonValue | undefined, level: number): Row["aa"] {
  const set = asRecord(noise);
  const differences = numbers(set?.differences);
  const tested = testedIn(noise);
  if (set === null || differences === null || tested === null) return null;
  const { wins, losses, ties } = tested;
  return {
    wins,
    losses,
    ties,
    flips: isNumber(set.flips) ? set.flips : null,
    either: readsStepEitherWay(numbers(set.unbilled) ?? differences, level),
  };
}

/** A number at `value`, or null. */
function numberOf(value: JsonValue | undefined): number | null {
  return isNumber(value) ? value : null;
}

/** The cap the comparison started under, and its test, both sides, at the dollars a finished solve
 *  billed before it started. */
function capOf(start: Start | undefined, data: JsonObject): Cap {
  const cap = asRecord(start?.data.cap);
  const each = numberOf(data.solves);
  const tasks = Array.isArray(start?.data.tasks) ? start.data.tasks.length : null;
  const solves = tasks === null || each === null ? null : tasks * each;
  const rate = start?.rate ?? null;
  return {
    dollars: numberOf(cap?.dollars),
    reserve: numberOf(cap?.reserve),
    solves,
    rate,
    cost: solves === null || rate === null ? null : 2 * solves * rate,
    capped: isBoolean(data.capped) ? data.capped : null,
  };
}

/** How the scores the test read stand from `level` (`clearance.ts`). */
function nearOf(scores: readonly number[], level: number): Pick<Row, "reverse" | "margin" | "need"> {
  if (scores.length === 0) return { reverse: null, margin: null, need: null };
  const losses = scores.filter((one) => one < 0).length;
  const untied = scores.filter((one) => one !== 0).length;
  return {
    reverse: flipP(scores.map((one) => -one)),
    margin: readsStep(scores, level) ? { spare: spareOf(scores, level) } : { short: shortOf(scores, level) },
    need: { losses, wins: equalNeed(losses, level), untied, most: equalMost(untied, level) },
  };
}

/** One comparison's row from its report's data, read at `level` or at its own. */
function rowOf(session: string, data: JsonObject, level: number | null, start?: Start): Row {
  const at = level ?? (isNumber(data.level) ? data.level : 0);
  const scored = asRecord(data.scored);
  const tested = testedIn(data.scored);
  const unbilled = numbers(scored?.unbilled);
  // Before 20 October the frontier held the test's detectable share and false rate (`reportLines`).
  const sized = testedSet(scored, asRecord(data.frontier));
  const share = sized?.detectable;
  const retained = data.retained === UNMEASURED ? UNMEASURED : testedIn(data.retained);
  return {
    session,
    reading: isString(data.reading) ? data.reading : "unknown",
    old: isString(data.old) ? data.old : "",
    fresh: isString(data.fresh) ? data.fresh : null,
    level: at,
    solves: isNumber(data.solves) ? data.solves : null,
    scored:
      tested === null
        ? null
        : {
            ...tested,
            detectable: isNumber(share) || share === null ? share : undefined,
            falseRate: isNumber(sized?.falseRate) ? sized.falseRate : null,
          },
    unbilled: unbilled === null ? null : testOf(unbilled),
    frontier: testedIn(data.frontier),
    retained,
    aa: aaOf(data.noise, at),
    ...nearOf(tested === null ? [] : scoresIn(data.scored), at),
    cap: capOf(start, data),
    room: roomOf(data),
    tallied: count(data.versions),
    apart: {
      aside: count(data.aside),
      short: count(data.short),
      disputed: count(data.disputed),
      flagged: count(data.flagged),
      withdrawn: count(data.withdrawn),
    },
    reread: rereadOf(data, at),
  };
}

/** Each comparison of `events` that reported, by its last report, or the one named `only`. */
export function rowsOf(events: readonly LogEvent[], level: number | null, only: string | null): Row[] {
  // The rate admission prices a test at on the log up to each start (`billedRate`), with the log's
  // solves folded once instead of once a comparison.
  const solves = ended(solvesIn(events));
  const starts = new Map(
    events.flatMap(({ kind, data }, at): [string, Start][] =>
      kind === "comparison.started" && isString(data.session)
        ? [[data.session, { data, rate: billedRate(solves.filter(({ finished }) => finished < at)) }]]
        : [],
    ),
  );
  return lastReports(events)
    .filter(({ session }) => only === null || session === only)
    .map(({ session, data }) => rowOf(session, data, level, starts.get(session)));
}

/** A tally as wins-losses-ties. */
function wlt({ wins, losses, ties }: Tally): string {
  return `${String(wins)}-${String(losses)}-${String(ties)}`;
}

/** A p to four places. */
function pOf(p: number): string {
  return p < 0.0001 ? p.toExponential(1) : p.toFixed(4);
}

/** A share in whole percent, or none. */
function percent(share: number | null): string {
  return share === null ? "none" : `${String(Math.round(100 * share))}%`;
}

/** What the tree's rule says beside the recorded reading. */
function rereadLine({ reading, reread, level, scored }: Row): string {
  if (reread === null) {
    const alone =
      scored === null
        ? ""
        : `; its full score alone ${scored.p <= level ? "clears" : "does not clear"} ${String(level)}`;
    return `  read again: the report holds no frontier with its unbilled scores to read the step on${alone}`;
  }
  const agrees = reread === reading;
  return `  read again at ${String(level)} (stepOf, frontier and retained together): ${reread}${agrees ? ", as recorded" : `, where the report recorded ${reading}`}`;
}

/** Dollars to the cent, or unrecorded. */
function dollars(value: number | null): string {
  return value === null ? "not recorded" : `$${value.toFixed(2)}`;
}

/** How the scores stand from the level by their largest margins (`clearance.ts`). */
function marginOf(margin: Row["margin"]): string {
  if (margin === null) return "";
  if ("spare" in margin) return `a step with ${String(margin.spare)} of its largest wins to spare`;
  if (margin.short === null) return "no step with every loss turned to a win";
  return `${String(margin.short)} of its largest losses turned to wins read a step`;
}

/** How near the test stood to its level, and the cap against what the test billed. */
function nearLines({ reverse, margin, need, cap, level }: Row): string[] {
  const losses = (n: number) => `${String(n)} ${n === 1 ? "loss" : "losses"}`;
  const most =
    need?.most === null || need === null
      ? `${String(need?.untied)} untied tasks read no step even all won`
      : `${String(need.untied)} untied tasks read a step at most at ${String(need.most.wins)}-${String(need.most.losses)}`;
  const near =
    reverse === null || need === null
      ? []
      : [
          `  p read for the reference ${pOf(reverse)}; at ${String(level)}, ${marginOf(margin)}; on equal margins ${losses(need.losses)} need ${need.wins === null ? "more wins than any tally holds" : `${String(need.wins)} wins`}, and ${most}`,
        ];
  const capSaid =
    cap.dollars === null
      ? "no cap recorded"
      : `cap ${dollars(cap.dollars)}${cap.reserve === null ? "" : ` (reserve ${dollars(cap.reserve)} a solve)`}`;
  const test =
    cap.solves === null
      ? "its test's solves not recorded"
      : `its test, ${String(cap.solves)} solves a side at the ${dollars(cap.rate)} a finished solve billed before it, comes to ${dollars(cap.cost)}`;
  return [
    ...near,
    `  ${capSaid}; ${test}; cut by its cap ${cap.capped === null ? "not recorded" : cap.capped ? "yes" : "no"}`,
  ];
}

/** The tested part of a row, or what a row without a test says. */
function testLines({ scored, unbilled, frontier, retained }: Row): string[] {
  if (scored === null) return ["  nothing was tallied: nothing was tested"];
  const untied = scored.wins + scored.losses;
  const retainedSaid =
    retained === UNMEASURED
      ? UNMEASURED
      : retained === null
        ? "none"
        : `${wlt(retained)} p ${pOf(retained.p)}`;
  return [
    `  scored ${wlt(scored)} p ${pOf(scored.p)}, ${String(untied)} untied${unbilled === null ? "" : `; without the bill (a report of 26 October to 2 November, which the step read) ${wlt(unbilled)} p ${pOf(unbilled.p)}`}`,
    `  detects four times in five ${scored.detectable === undefined ? "a share not recorded" : `${percent(scored.detectable)} of untied tasks won`}; false rate ${scored.falseRate === null ? "not recorded" : `${(100 * scored.falseRate).toFixed(1)}%`}`,
    `  frontier ${frontier === null ? "none" : `${wlt(frontier)} p ${pOf(frontier.p)}`}; retained ${retainedSaid}`,
  ];
}

/** The lines of one row, each harness `called` by its letter. */
function rowLines(row: Row, called: Called): string[] {
  const apart = APART.flatMap((kind) =>
    row.apart[kind] === 0 ? [] : [`${String(row.apart[kind])} ${kind}`],
  );
  const aa = row.aa;
  return [
    `${row.session}  ${row.reading}  ${row.fresh === null ? "nothing new" : called(row.fresh)} against ${called(row.old)}, ${row.solves === null ? "?" : String(row.solves)} solves a side, level ${String(row.level)}`,
    ...testLines(row),
    aa === null
      ? "  A/A: none in the report"
      : `  A/A ${wlt(aa)}${aa.wins + aa.losses === 0 && aa.ties > 0 ? " (every task tied)" : ""}, flip rate ${percent(aa.flips)}, ${aa.either ? "reads a step either way, where none can be" : "reads no step either way"}`,
    ...nearLines(row),
    `  room for the reference: ${row.room}; ${String(row.tallied)} tallied${apart.length === 0 ? "" : `, ${apart.join(", ")}`}`,
    rereadLine(row),
  ];
}

/** The summary over every row: the readings by word, the A/A that read a step, the readings the
 *  tree reads otherwise. */
function summaryLine(rows: readonly Row[]): string {
  const words = new Map<string, number>();
  for (const { reading } of rows) words.set(reading, (words.get(reading) ?? 0) + 1);
  const said = [...words].map(([word, n]) => `${String(n)} ${word}`).join(", ");
  const aaSteps = rows.filter(({ aa }) => aa?.either === true).length;
  const otherwise = rows.filter(({ reread, reading }) => reread !== null && reread !== reading).length;
  return `${String(rows.length)} comparisons reported${rows.length === 0 ? "" : `: ${said}`}; ${String(aaSteps)} A/A read a step either way; ${String(otherwise)} read otherwise by this tree's stepOf`;
}

if (import.meta.main) {
  await runCommand(
    { name: "reading", usage: USAGE, options: OPTIONS, positionals: 1 },
    async (args: CommandArgs) => {
      const asked = args.value("level");
      const level = asked === null ? null : Number(asked);
      if (level !== null && !(level > 0 && level < 1)) args.die("--level must be a number between 0 and 1");
      const named = args.positionals[0] ?? "";
      const events = read(await logAcross(named));
      const only = args.value("comparison");
      const rows = rowsOf(events, level, only);
      if (only !== null && rows.length === 0) {
        throw new CommandFailure(`no comparison ${only} reported in this log`);
      }
      const called = calledBy(namesOf(events));
      console.log([summaryLine(rows), ...rows.flatMap((row) => rowLines(row, called))].join("\n"));
    },
  );
}
