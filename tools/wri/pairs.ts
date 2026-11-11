/**
 * Every task each comparison named, one row a task, and one summary line a comparison: what each
 * side's solves did, the task's score and what carried it, the reference against itself as its
 * report stored it and as this tree rebuilds it, the new side against itself, and of a tie, its kind.
 *
 *   bun tools/wri/pairs.ts <log>
 *
 * Lanes 9, 17, 18, 20 and 29 read a comparison task by task. Between 3 and 10 November 11 of 17
 * lane-9 sessions built this table by hand (`ties.py`, `tiecost.py`, `rep.py`), 4 of 4 lane-29
 * sessions set each win beside its own task's A/A, and one tie script paired the tasks with the
 * report's scores by position, which misaligns once retained tasks are tallied. Here every number is
 * the production fold's on one pair (`pairsReported`, `differenceOf`, `pointsOf`, `carriedBy`,
 * `gapAgainst`, `src/kernel/`), and a pair is never matched to a score by its place in a list.
 *
 * A row's `diff` is the new side's score over the reference's on that task in thousandths
 * (`differenceOf`), so in a starter read, whose new side is the starter, a positive `diff` is a task
 * the starter won, and `starter-reads.ts --tasks`, which gives the reference's margin over the
 * starter, has the opposite sign on the same task. Under each comparison's rows one line counts its
 * new side's wins whose `diff` stands inside, level with or outside that task's rebuilt A/A, and
 * apart those whose task has no A/A. A report stores its A/A (`noise`) aligned with `versions`; since 9a9528bf5 this
 * tree mirrors the A/A's halves from one task to the next, so the rebuilt A/A can differ from the
 * stored one on an older log, and both are printed. Tasks the report did not tally have a row too,
 * by the list that holds them (`aside`, `short`, `disputed`, `flagged`, `withdrawn`), `unpaired`
 * where a start named them and no list does, as a comparison its cap cut leaves them, and `open`
 * in a comparison with no report: those rows give each side's counted solves and no score. A tie's
 * kind is a fact of its solves: `both-invalid` (no valid answer on either side), `exact-repeat`
 * (every answer valid, one measure throughout), `within-room` (every answer valid and every pairing
 * of a solve of each within the floor, `ROOM`), `both-valid` (every answer valid, the objective
 * not measured on each), and `cancelling` (gains of the two sides cancelling over the pairings).
 * The origin a starter read gives each task is `starter-reads.ts --tasks`'s column
 * (`comparison-reading`), so no column here repeats it. `x_best` gives each side's median ratio to
 * the best answer on record for the task, reference then new (1.00 is the best; `sideGap`, `gap.ts`,
 * which prints the same per comparison): half of lane 11's sessions of 3 to 10 November set it
 * beside each task's writer by hand. It comes from hidden values, so the output stays on the exam
 * side: it names task versions and families and no task text, answer or measure.
 */
import {
  type Measures,
  carriedBy,
  differenceOf,
  gapAgainst,
  type Paired,
  pointsOf,
  scoresIn,
  testOf,
  unsolved,
} from "#src/kernel/compare.ts";
import { proposalsOf } from "#src/kernel/history.ts";
import { type LogEvent, read } from "#src/kernel/log.ts";
import { sideGap } from "#skills/comparison-reading/scripts/gap.ts";
import { lastReports, pairsReported, poolOf, type Reported } from "#src/kernel/reports.ts";
import { ended, passed, type Ran, ranUnder } from "#src/kernel/solves.ts";
import { asRecord, isNumber, isString, type JsonObject, type JsonValue } from "#src/meta/json-shape.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { NO_TRACES, printRows } from "./folds.ts";

/** The kind of a tied task, by its solves. */
type TieKind = "both-invalid" | "exact-repeat" | "within-room" | "both-valid" | "cancelling";

/** A finished counted solve, with the place its start stands in the log. */
type Counted = Ran & { readonly finished: number; readonly end: JsonObject };

/** What every row of one comparison reads beside its own pair. */
interface Context {
  readonly session: string;
  readonly read: "candidate" | "starter";
  readonly retained: ReadonlySet<string>;
  readonly writers: ReadonlyMap<string, { readonly session: string; readonly family: string }>;
  readonly ran: ReadonlyMap<string, Counted>;
  readonly stored: ReadonlyMap<string, number>;
  readonly aa: ReadonlyMap<string, Paired>;
  readonly self: ReadonlyMap<string, Paired>;
  /** The best measure on record by task (`poolOf`). */
  readonly bests: ReadonlyMap<string, number>;
}

/** How close two measures stand to read as one, past a float's own noise (`answers.ts`). */
const EXACTLY = 1e-6;
const APART = ["aside", "short", "disputed", "flagged", "withdrawn"] as const;
const KINDS: readonly TieKind[] = ["exact-repeat", "within-room", "both-valid", "both-invalid", "cancelling"];
const HEAD = [
  "comparison",
  "read",
  "part",
  "task",
  "writer",
  "family",
  "old",
  "new",
  "diff",
  "carried",
  "aa_stored",
  "aa_rebuilt",
  "new_self",
  "flips",
  "repeat",
  "spread",
  "x_best",
  "billed",
  "tie",
].join("\t");
const NONE = "-";
const PASS = "pass";

/** The pair of the `o`th solve of the reference and the `f`th of the new side. */
function pairingOf(pair: Paired, o: number, f: number): Paired {
  const objective = pair.objective;
  return {
    task: pair.task,
    old: pair.old.slice(o, o + 1),
    fresh: pair.fresh.slice(f, f + 1),
    ...keyIfDefined(
      "objective",
      objective && {
        ...objective,
        old: objective.old.slice(o, o + 1),
        fresh: objective.fresh.slice(f, f + 1),
      },
    ),
  };
}

/** The measures of a pair's two sides, null where a solve has none. */
function measuresOf(pair: Paired): (number | null)[] {
  return pair.objective === undefined ? [] : [...pair.objective.old, ...pair.objective.fresh];
}

/** Of a task its score ties (`differenceOf`), the kind of tie its solves make; null for one it
 *  does not tie. */
export function tieKind(pair: Paired): TieKind | null {
  if (differenceOf(pair) !== 0) return null;
  if (unsolved(pair)) return "both-invalid";
  if (![...pair.old, ...pair.fresh].every(Boolean)) return "cancelling";
  const measures = measuresOf(pair);
  if (measures.length === 0 || !measures.every(isNumber)) return "both-valid";
  if (Math.max(...measures) - Math.min(...measures) <= EXACTLY) return "exact-repeat";
  const within = [...pair.old.keys()].every((o) =>
    [...pair.fresh.keys()].every((f) => differenceOf(pairingOf(pair, o, f)) === 0),
  );
  return within ? "within-room" : "cancelling";
}

/** Whether a side's solves of a task disagree on validity. */
const flipped = (valid: readonly boolean[]) => valid.includes(true) && valid.includes(false);

/** Whether a side repeated its measure: exactly, within the floor (`gapAgainst`), or apart; none
 *  where it has fewer than two or a solve without one. */
function repeatOf(pair: Paired, side: "old" | "fresh"): string {
  const measures = pair.objective?.[side] ?? [];
  const known = measures.filter(isNumber);
  if (known.length < 2 || known.length !== pair[side].length) return NONE;
  if (Math.max(...known) - Math.min(...known) <= EXACTLY) return "exact";
  return gapAgainst(pair, side, []) ? "apart" : "within";
}

/** The spread of every measure of a task over both sides, as a share of the larger magnitude. */
function spreadOf(pair: Paired): string {
  const known = measuresOf(pair).filter(isNumber);
  if (known.length < 2) return NONE;
  const [low, high] = [Math.min(...known), Math.max(...known)];
  const larger = Math.max(Math.abs(low), Math.abs(high));
  return larger === 0 ? "0" : ((high - low) / larger).toFixed(3);
}

/** Dollars to the cent over `bills`, none where none is recorded. */
function billedOf(bills: readonly (number | null | undefined)[]): string {
  const known = bills.filter(isNumber);
  return known.length === 0 ? NONE : known.reduce((sum, bill) => sum + bill, 0).toFixed(2);
}

/** The ending of a solve that does not count as valid, as a row names it: `wrong-pass` where a
 *  settled wrong pass counts it a fail, its kind, or its outcome. */
function endingOf(solve: Counted | undefined): string {
  const ending = solve?.ending;
  if (ending?.outcome === PASS) return "wrong-pass";
  const named = isString(ending?.kind) ? ending.kind : ending?.outcome;
  return isString(named) ? named : NONE;
}

/** The columns a row gives every task: where it was written and what part it took. */
function placeOf(context: Context, part: string, task: string): string[] {
  return [context.session, context.read, part, task.slice(0, 8), ...originOf(context, task)];
}

/** The session that wrote a task and the task's family. */
function originOf(context: Context, task: string): [string, string] {
  const writer = context.writers.get(task);
  return [writer?.session ?? "not recorded", writer?.family ?? NONE];
}

/** The row of a tallied task. */
function pairRow(context: Context, pair: Paired): string {
  const side = (which: "old" | "fresh") =>
    pair[which]
      .map((valid, at) => (valid ? PASS : endingOf(context.ran.get(pair.solves?.[which][at] ?? ""))))
      .join(",");
  const difference = differenceOf(pair);
  const measures: Measures = pointsOf(pair);
  const rebuilt = context.aa.get(pair.task);
  const self = context.self.get(pair.task);
  const stored = context.stored.get(pair.task);
  // Each side's median ratio to the task's best on record (`sideGap`); `-` for a side with no valid
  // measured answer, or a task with no best.
  const best = (which: "old" | "fresh") => sideGap([pair], which, context.bests).ratio?.toFixed(2) ?? NONE;
  return [
    ...placeOf(context, context.retained.has(pair.task) ? "retained" : "frontier", pair.task),
    side("old"),
    side("fresh"),
    String(difference),
    carriedBy(measures) ?? NONE,
    stored === undefined ? NONE : String(stored),
    rebuilt === undefined ? NONE : String(differenceOf(rebuilt)),
    self === undefined ? NONE : String(differenceOf(self)),
    `${flipped(pair.old) ? "1" : "0"}/${flipped(pair.fresh) ? "1" : "0"}`,
    `${repeatOf(pair, "old")}/${repeatOf(pair, "fresh")}`,
    spreadOf(pair),
    `${best("old")}/${best("fresh")}`,
    billedOf([...(pair.used?.old ?? []), ...(pair.used?.fresh ?? [])].map(({ billed }) => billed)),
    tieKind(pair) ?? NONE,
  ].join("\t");
}

/** The row of a task the report did not tally: each side's counted solves, and no score. */
function unpairedRow(context: Context, part: string, task: string, sides: readonly [string, string]): string {
  const solves = [...context.ran.values()].filter(
    ({ start, under }) => start.comparison === context.session && under.task === task,
  );
  const of = (harness: string) => solves.filter(({ under }) => under.harness === harness);
  const said = (harness: string) =>
    of(harness)
      .map((solve) => (passed(solve) === true ? PASS : endingOf(solve)))
      .join(",") || NONE;
  return [
    ...placeOf(context, part, task),
    said(sides[0]),
    said(sides[1]),
    ...Array.from({ length: 9 }, () => NONE),
    billedOf(solves.map(({ end }) => (isNumber(end.billed) ? end.billed : null))),
    NONE,
  ].join("\t");
}

/** The `share`th quantile of `values` by nearest rank. */
function quantile(values: readonly number[], share: number): number {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(share * sorted.length) - 1)] ?? 0;
}

/** A tally of task scores and its sign-flip p, as a summary says it. */
function testSaid(differences: readonly number[]): string {
  const { wins, losses, ties, p } = testOf(differences);
  return `${String(wins)}-${String(losses)}-${String(ties)} p ${p.toFixed(4)}`;
}

/** The tally of each side's first solves alone and of its second alone: a description of those
 *  solves, which reads no step and no reading, since only the comparison reads (rule 1). None where
 *  a pair holds fewer than two a side. */
function samplesSaid(pairs: readonly Paired[]): string {
  if (pairs.length === 0 || pairs.some(({ old, fresh }) => old.length < 2 || fresh.length < 2)) {
    return "solve halves: not split, fewer than two solves a side";
  }
  const at = (index: number) => pairs.map((pair) => differenceOf(pairingOf(pair, index, index)));
  return `solve halves, a description and not a reading: first solves ${testSaid(at(0))}, second solves ${testSaid(at(1))}`;
}

/** The new side's wins by where each `diff` stands against its own task's rebuilt A/A
 *  (`|difference|`): inside it, level with it or outside it, and apart where the task has no A/A. */
function winsAgainstNoise(context: Context, pairs: readonly Paired[]): string {
  const counts = { inside: 0, level: 0, outside: 0, none: 0 };
  for (const pair of pairs) {
    const stands = againstNoise(context, pair);
    if (stands !== null) counts[stands] += 1;
  }
  const { inside, level, outside, none } = counts;
  return `== ${context.session} wins of the new side against their own task's rebuilt A/A: inside ${String(inside)}, level ${String(level)}, outside ${String(outside)}, no A/A ${String(none)}`;
}

/** Where a win of the new side stands against its own task's rebuilt A/A; null for a pair it did
 *  not win. */
function againstNoise(context: Context, pair: Paired): "inside" | "level" | "outside" | "none" | null {
  const [win, aa] = [differenceOf(pair), context.aa.get(pair.task)];
  if (win <= 0) return null;
  if (aa === undefined) return "none";
  const noise = Math.abs(differenceOf(aa));
  return win < noise ? "inside" : win === noise ? "level" : "outside";
}

/**
 * One comparison's tally by the session that wrote each task, or by its family: the new side's
 * won, lost and tied, its summed `diff`, and its wins outside their task's A/A, the largest group
 * first. Both lane sessions of 10 November grouped the rows by hand for this, one several times
 * and one with two count errors; `starter-reads.ts` splits a starter read by origin alone.
 */
function groupsSaid(context: Context, pairs: readonly Paired[], by: "writer" | "family"): string {
  const groups = new Map<string, Paired[]>();
  for (const pair of pairs) {
    const key = originOf(context, pair.task)[by === "writer" ? 0 : 1];
    groups.set(key, [...(groups.get(key) ?? []), pair]);
  }
  const said = [...groups]
    .toSorted(([, one], [, other]) => other.length - one.length)
    .map(([key, some]) => {
      const diffs = some.map((pair) => differenceOf(pair));
      const count = (sign: number) => String(diffs.filter((diff) => Math.sign(diff) === sign).length);
      const net = diffs.reduce((sum, diff) => sum + diff, 0);
      const outside = some.filter((pair) => againstNoise(context, pair) === "outside").length;
      return `${key} ${count(1)}-${count(-1)}-${count(0)}, diff ${net > 0 ? "+" : ""}${String(net)}, ${String(outside)} outside`;
    });
  return `== ${context.session} by ${by} (won-lost-tied of the new side, summed diff, wins outside their task's A/A): ${said.join("; ")}`;
}

/** The summary line of one comparison's tallied pairs. */
function summaryOf(
  context: Context,
  report: JsonObject,
  pairs: readonly Paired[],
  untallied: string,
): string {
  const kinds = pairs.flatMap((pair) => tieKind(pair) ?? []);
  const kindSaid = KINDS.map((kind) => `${kind} ${String(kinds.filter((one) => one === kind).length)}`).join(
    ", ",
  );
  const rebuilt = pairs.flatMap(({ task }) => {
    const aa = context.aa.get(task);
    return aa === undefined ? [] : [Math.abs(differenceOf(aa))];
  });
  const differ = pairs.filter(({ task }) => {
    const [aa, stored] = [context.aa.get(task), context.stored.get(task)];
    return aa !== undefined && stored !== undefined && differenceOf(aa) !== stored;
  }).length;
  const aaSaid =
    rebuilt.length === 0
      ? "A/A not rebuilt"
      : `A/A |difference| rebuilt median ${String(quantile(rebuilt, 0.5))}, p75 ${String(quantile(rebuilt, 0.75))}, p90 ${String(quantile(rebuilt, 0.9))}, max ${String(quantile(rebuilt, 1))} over ${String(rebuilt.length)}; stored ${context.stored.size === 0 ? "not recorded" : `differs from rebuilt on ${String(differ)} of ${String(rebuilt.length)}`}`;
  const tied = pairs.filter((pair) => differenceOf(pair) === 0);
  const billed = (some: readonly Paired[]) => {
    const said = billedOf(
      some.flatMap((pair) =>
        [...(pair.used?.old ?? []), ...(pair.used?.fresh ?? [])].map(({ billed: one }) => one),
      ),
    );
    return said === NONE ? "none recorded" : `$${said}`;
  };
  const retained = pairs.filter(({ task }) => context.retained.has(task)).length;
  return [
    `== ${context.session} ${context.read} ${isString(report.reading) ? report.reading : "unread"}: tallied ${String(pairs.length)} (frontier ${String(pairs.length - retained)}, retained ${String(retained)})${untallied}`,
    `ties ${String(tied.length)}: ${kindSaid}`,
    aaSaid,
    samplesSaid(pairs),
    `billed ${billed(tied)} on tied tasks, ${billed(pairs.filter((pair) => differenceOf(pair) !== 0))} on untied`,
  ].join("; ");
}

/** The stored A/A of a report by task, where its scores align with `versions`. */
function storedOf(data: JsonObject): Map<string, number> {
  const versions = Array.isArray(data.versions) ? data.versions.filter(isString) : [];
  const scores = scoresIn(asRecord(data.noise) ?? {});
  return scores.length === versions.length && scores.length > 0
    ? new Map(versions.map((version, at) => [version, scores[at] ?? 0]))
    : new Map<string, number>();
}

/** The task versions a list of a report or start holds. */
function versionsIn(value: JsonValue | undefined): string[] {
  return Array.isArray(value) ? value.filter(isString) : [];
}

/** One comparison's rows and its summary, from its last report, or from its start alone where it
 *  has none. */
function comparisonRows(
  events: readonly LogEvent[],
  start: JsonObject,
  report: Reported | undefined,
  shared: Pick<Context, "writers" | "ran" | "bests">,
): string[] {
  const data = report?.data ?? start;
  const [old, fresh] = [isString(data.old) ? data.old : "", isString(data.fresh) ? data.fresh : ""];
  const byTask = (pairs: readonly Paired[]) => new Map(pairs.map((pair) => [pair.task, pair]));
  const context: Context = {
    ...shared,
    session: isString(start.session) ? start.session : "",
    read: fresh === data.starter && old !== data.starter ? "starter" : "candidate",
    retained: new Set(versionsIn(start.retained)),
    stored: report === undefined ? new Map() : storedOf(report.data),
    aa: report === undefined ? new Map() : byTask(pairsReported(events, report, "old")),
    self: report === undefined ? new Map() : byTask(pairsReported(events, report, "fresh")),
  };
  const sides = [old, fresh] as const;
  if (report === undefined) {
    const rows = versionsIn(start.tasks).map((task) => unpairedRow(context, "open", task, sides));
    return [
      ...rows,
      `== ${context.session} ${context.read} open: no report; ${String(rows.length)} tasks named at its start`,
    ];
  }
  const pairs = pairsReported(events, report);
  const listed = new Map(
    APART.flatMap((part) => versionsIn(report.data[part]).map((task) => [task, part] as const)),
  );
  const tallied = new Set(pairs.map(({ task }) => task));
  const unpaired = versionsIn(start.tasks).filter((task) => !tallied.has(task) && !listed.has(task));
  const apart = [...listed].map(([task, part]) => unpairedRow(context, part, task, sides));
  const loose = unpaired.map((task) => unpairedRow(context, "unpaired", task, sides));
  const counts = [
    ...APART.map((part) => [part, [...listed.values()].filter((one) => one === part).length] as const),
    ["unpaired", unpaired.length] as const,
  ];
  const untallied = counts.flatMap(([part, n]) => (n === 0 ? [] : [`, ${part} ${String(n)}`])).join("");
  return [
    ...pairs.map((pair) => pairRow(context, pair)),
    ...apart,
    ...loose,
    winsAgainstNoise(context, pairs),
    groupsSaid(context, pairs, "writer"),
    groupsSaid(context, pairs, "family"),
    summaryOf(context, report.data, pairs, untallied),
  ];
}

/** The rows of every comparison `events` holds, in the order they started. */
export function pairRows(events: readonly LogEvent[]): string[] {
  const reports = new Map(lastReports(events).map((report) => [report.session, report]));
  const starts = new Map(
    events.flatMap(({ kind, data }) =>
      kind === "comparison.started" && isString(data.session) ? [[data.session, data] as const] : [],
    ),
  );
  const writers = new Map(
    proposalsOf(events).map(({ version, session, family }) => [
      version,
      { session: session ?? "the opening exam", family: family ?? NONE },
    ]),
  );
  const { bests } = poolOf(events);
  const ran = new Map(
    ended(ranUnder(events)).flatMap((solve) =>
      solve.under.side === "test" ? [[solve.id, solve] as const] : [],
    ),
  );
  const rows = [...starts].flatMap(([session, start]) =>
    comparisonRows(events, start, reports.get(session), { writers, ran, bests }),
  );
  const unaligned = [...reports.values()].filter(
    ({ data }) => asRecord(data.noise) !== null && storedOf(data).size === 0,
  ).length;
  return [
    `pairs: one row per task each comparison named, by its last report; diff, aa_stored, aa_rebuilt and new_self in thousandths, new side over reference${unaligned === 0 ? "" : `; the stored A/A of ${String(unaligned)} reports is not recorded by task`}`,
    HEAD,
    ...rows,
  ];
}

if (import.meta.main) printRows("pairs", (log) => pairRows(read(log, NO_TRACES)));
