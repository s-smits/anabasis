/**
 * Lane 27 across campaigns: one row a campaign, in the columns the lane compares, and the paths
 * under the host's `/tmp` that one campaign named before another campaign's solve ran them.
 *
 * Campaigns of one pack run side by side on one host, each on its own code. Read one at a time, a
 * promotion's tally says nothing of whether its peer on another tree climbed faster, and a solve
 * that ran a program from `/tmp` says nothing of who put it there: on 10 October abl175-new's
 * reference solve ran the phreeqc buffer-a's Builder had installed under `/tmp/phq-inst` four
 * hours before, and only the two logs together show it. `wri.ts climb` prints this, and the
 * lane 27 prompt carries it beside the peers' overviews.
 * Reference validity comes from each report's scored profile; an absent denominator reads
 * unmeasured rather than a measured zero.
 */
import { labelledPairs } from "#src/campaign/comparison.ts";
import { short } from "#src/campaign/move.ts";
import { gateAnswers } from "#src/examiner/record.ts";
import { differenceOf, flipP, informative, type Kept, type Paired } from "#src/kernel/compare.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import { asRecord, isNumber } from "#src/meta/json-shape.ts";
import { type Compared, count, fired, type Index, indexOf, items, type Trigger, text } from "./folds.ts";
import {
  epochsOf,
  joinedTest,
  pinnedRule,
  pSaid,
  sharedPaths,
  spentTo,
  testedOf,
  testSaid,
  untied,
  validOf,
  validSaid,
} from "./promotion.ts";

/** One campaign as the climb table names it: its name and its log's events. */
export interface Campaign {
  readonly name: string;
  readonly events: readonly LogEvent[];
}

/** Where a path under `/tmp` was first named in one campaign: by which call, and when. A solve's
 *  side is the comparison's reference or new harness, or practice. */
interface Named {
  readonly campaign: string;
  readonly by: string;
  readonly at: string;
  readonly side: string | null;
}

/** What `crossings` found: the solves that ran what another campaign's session left, and how many
 *  scratch names solves of two campaigns shared. */
interface Crossed {
  readonly left: string[];
  readonly scratch: string;
}

const COLUMNS = [
  "campaign",
  "host code",
  "rule",
  "first promotion",
  "to it",
  "rests: tally, untied, reference's own untied",
  "reference valid at the rests",
  "since",
  "comparisons after",
  "spent so far",
  "last move ended",
] as const;

/** A campaign's row. Before any promotion its comparisons stand where the rests would. */
function rowOf({ name, events }: Campaign): string[] {
  const log = indexOf(events);
  const [epoch] = epochsOf(events);
  const rests =
    epoch === undefined
      ? log.compared
      : log.compared.filter(({ session }) =>
          items(epoch.data.rests).some((rest) => asRecord(rest)?.comparison === session),
        );
  const tallies = rests.map(
    ({ session, last }) =>
      `${session} ${testSaid(last.scored)}, ${untied(last.scored)}, ${untied(last.noise)}`,
  );
  const valid = rests.map(
    ({ session, last }) => `${session} ${validSaid(validOf(asRecord(last.valid)?.old).share)}`,
  );
  const after = epoch === undefined ? [] : log.compared.filter(({ at }) => at > epoch.at);
  const move = log.of("campaign.move").at(-1);
  // Run again, a campaign goes on past an ending (since 14 October): it ended where its last ending
  // came after its last move. Until 15 October any ending read so, and two live campaigns did.
  const ended = events.findLast(({ kind }) => kind === "campaign.move" || kind === "campaign.ended")?.kind;
  return [
    name,
    // The host code of the last condition the campaign recorded.
    short(text(asRecord(log.of("condition.recorded").at(-1)?.condition)?.host)) || "none",
    pinnedRule(log).join(", ") || "default",
    epoch === undefined
      ? "none yet"
      : `${short(text(epoch.data.harness))} at ${events[epoch.at]?.at.slice(11, 16) ?? ""}Z`,
    epoch === undefined ? "-" : spentTo(log, 0, epoch.at),
    tallies.join("; ") || "none reported",
    valid.join("; ") || "-",
    epoch === undefined ? "-" : spentTo(log, epoch.at, events.length),
    epoch === undefined
      ? "-"
      : after
          .map(({ session, last }) => `${session} ${testSaid(last.scored)} ${text(last.reading)}`)
          .join("; ") || "none",
    spentTo(log, 0, events.length),
    ended === "campaign.ended" ? "ended" : `${text(move?.move)} ${text(move?.session)}`.trim() || "opening",
  ];
}

/** The climb table, one row a campaign, in Markdown. */
export function climbTable(campaigns: readonly Campaign[]): string {
  const line = (cells: readonly string[]) =>
    `| ${cells.map((cell) => cell.replaceAll("|", "/")).join(" | ")} |`;
  return [line(COLUMNS), line(COLUMNS.map(() => "---")), ...campaigns.map((each) => line(rowOf(each)))].join(
    "\n",
  );
}

/**
 * The safeguards: what a promotion leaned on that its reading does not say, read from the log
 * alone and printed, never acted on. A safeguard goes by deleting its key in the change that names
 * its replacement, and a number is never reused.
 *
 * 1 to 4 and 7 were the failures of 14 October (`3e43e04c`): a run that ended `finished` while the
 * table named a move, a Builder's wall during a host action, one move asked three times, Builder
 * conversations in a row without progress, and a session's limits moved. Over the 638 campaign
 * logs on the operator's host on 19 October they fired in 14 logs of campaigns opened from 9 to
 * 14 October and in none of the 12 opened since, which `hostOwed` and `idleOf` (1, 4), the Builder's
 * own-time wall (`Bench.within`, 2), `attemptsOf` (3) and the opening's terms (7) answer; they went
 * on 19 October. 5 went at birth, as `waitOut` waits out a named reset, and 6 is HOST LOADED.
 *
 * 8 and 9 are what buffer-fresh-opus-forkedPR223_v0_5_4-r3 leaned on, the first campaign from a
 * prompt to promote three times (19 October). 8: the joined frontier clears the level only with
 * the tasks the gate held out on their author's answer alone, every reference solve of them valid
 * and alike and the author's better than each (`authorRoom`). Its second promotion
 * read 8-0 joined and 5-0 (p 0.031) without them, its third 8-0 and 3-0 (p 0.125): such a task's
 * room is the author's answer measured by the author's objective, and the promotion is as sound as
 * both. 9: the joined frontier on validity alone does not clear the level, so the objective or the
 * bill decided it, as one did all three of r3's (1-0, 0-0 and 1-0 on validity); a drafted exam's
 * objective is its author's own computation, which nothing outside it has checked. It reads the
 * frontier without the bill beside, since until 22 October it named every such promotion "by the
 * objective alone": the M1 fork of #306 promoted on 11-0 where the bill decided 10 tasks. That
 * reading is by this tree's score, whose objective counts a gain by its size (`FULL`), so it can
 * differ from the ordered rule a comparison begun before 21 October was read by: an outside review
 * of 22 October built eight tasks won by 1.1% and one lost by 20%, 8-1 at p 0.0195 by that rule and
 * p 0.502 by this score. The line says so. Since 26 October a step clears the level without the
 * bill as well (`stepOf`), so the second reading falls short only for a promotion made before.
 */
export function safeguardTriggers(log: Index): Trigger[] {
  const authored = authorRoom(log.events);
  const reported = new Map(log.compared.map((compared) => [compared.session, compared] as const));
  const said = (differences: readonly number[]) =>
    `${String(differences.filter((one) => one > 0).length)}-${String(differences.filter((one) => one < 0).length)} p ${pSaid(flipP(differences))}`;
  const promotions = epochsOf(log.events).flatMap(({ data }) => {
    const rests = items(data.rests).flatMap((rest) => reported.get(text(asRecord(rest)?.comparison)) ?? []);
    const level = count(rests[0]?.last.level);
    const reports = rests.map(({ last }) => last);
    const joined = joinedTest(reports);
    if (rests.length === 0 || flipP(joined) > level) return [];
    const harness = `${short(text(data.harness))} ${said(joined)} joined at level ${String(level)}`;
    const without = joinedTest(reports, authored);
    const valid = measuredOf(log.events, rests, "validity");
    return [{ level, harness, without, valid, unbilled: measuredOf(log.events, rests, "unbilled") }];
  });
  const author = promotions.filter(({ without, level }) => flipP(without) > level);
  const beyond = promotions.filter(({ valid, level }) => flipP(valid) > level);
  return [
    ...(author.length > 0
      ? [
          fired(
            "SAFEGUARD-8 PROMOTION ON AUTHOR ROOM",
            author
              .map(
                ({ harness, without }) =>
                  `${harness}, ${said(without)} without the tasks held on their author's answer alone`,
              )
              .join("; "),
          ),
        ]
      : []),
    ...(beyond.length > 0
      ? [
          fired(
            "SAFEGUARD-9 PROMOTION BEYOND VALIDITY",
            beyond
              .map(
                ({ harness, valid, unbilled }) =>
                  `${harness}, ${said(valid)} on validity alone, ${said(unbilled)} without the bill by the current score`,
              )
              .join("; "),
          ),
        ]
      : []),
  ];
}

/** Each tested task's score (`testedOf`) on the measures `kept` names, as the step reads it
 *  (`differenceOf`), from the settled pairs (`labelledPairs`), summed
 *  over a promotion's two readings as `joined` sums them. Until 25 October
 *  it summed the measures itself, and rounded half points up where the step rounds them away from
 *  zero. */
function measuredOf(events: readonly LogEvent[], rests: readonly Compared[], kept: Kept) {
  const sums = new Map<string, number>();
  for (const { session, at, last } of rests) {
    const tested = new Set(testedOf(last).of);
    for (const pair of labelledPairs(events, { session, index: at, data: last })) {
      if (tested.has(pair.task)) sums.set(pair.task, (sums.get(pair.task) ?? 0) + differenceOf(pair, kept));
    }
  }
  return [...sums.values()];
}

/** The task versions the gate held out on their author's answer alone: every reference solve
 *  valid, their measures alike, and the author's on record better than each, the
 *  room `informative` reads only with the author's measure (since 19 October). */
function authorRoom(events: readonly LogEvent[]): Set<string> {
  const answers = gateAnswers(events, -1);
  const bests = new Map<string, number>();
  let direction: "lower" | "higher" | null = null;
  for (const { kind, data } of events) {
    const objective = asRecord(data.objective);
    if (kind !== "task.feasible" || !isNumber(objective?.measure)) continue;
    direction = objective.direction === "higher" ? "higher" : "lower";
    const was = bests.get(text(data.version));
    const pick = direction === "lower" ? Math.min : Math.max;
    bests.set(text(data.version), was === undefined ? objective.measure : pick(was, objective.measure));
  }
  if (direction === null) return new Set();
  const rule = direction;
  return new Set(
    events.flatMap(({ kind, data }) => {
      const reference = asRecord(data.reference);
      const all = count(reference?.solves);
      if (kind !== "task.gate" || data.outcome !== "passed" || all === 0 || count(reference?.valid) !== all) {
        return [];
      }
      const measures = (answers.get(text(data.version)) ?? []).map(({ measure }) => measure);
      const pair: Paired = {
        task: text(data.version),
        old: measures.map(() => true),
        fresh: [],
        objective: { direction: rule, old: measures, fresh: [] },
      };
      return !informative(pair, "old", new Set()) && informative(pair, "old", new Set(), bests)
        ? [pair.task]
        : [];
    }),
  );
}

/** Each path under `/tmp` a campaign's calls named, first naming first. */
function namedIn({ name, events }: Campaign): Map<string, Named> {
  const log = indexOf(events);
  const reference = new Map(
    log.of("comparison.started").map((start) => [text(start.session), text(start.old)]),
  );
  const sideOf = new Map(
    log.solves.map(({ id, comparison, harness }) => [
      id,
      comparison === null
        ? "practice"
        : `${comparison} ${harness === reference.get(comparison) ? "reference" : "new"}`,
    ]),
  );
  const first = new Map<string, Named>();
  for (const call of log.traces) {
    if (call.part !== "call") continue;
    for (const path of sharedPaths(call)) {
      if (first.has(path)) continue;
      const side = call.seat === "solve" ? (sideOf.get(call.id) ?? "unknown") : null;
      first.set(path, { campaign: name, by: call.id, at: call.at, side });
    }
  }
  return first;
}

const clock = (at: string) => `${at.slice(11, 16)}Z`;

/**
 * The solves that named a path another campaign named first. Where a Builder or an Examiner session
 * named it first, it is a program or a file that session left under the host's `/tmp`, on the path
 * of a solve that should have seen only its own harness: each such solve is named with its side and
 * every path. Where another campaign's solve named it first it is a scratch name two solvers both
 * chose (`/tmp/m.py`), harmless unless they ran at once, and those are counted.
 */
export function crossings(campaigns: readonly Campaign[]): Crossed {
  const named = campaigns.map(namedIn);
  const left = new Map<string, string[]>();
  const scratch = { paths: new Set<string>(), solves: new Set<string>() };
  for (const here of named) {
    for (const [path, use] of here) {
      if (use.side === null) continue;
      const [earliest] = named
        .flatMap((there) => {
          const other = there.get(path);
          return other !== undefined && other.campaign !== use.campaign && other.at < use.at ? [other] : [];
        })
        .toSorted((a, b) => a.at.localeCompare(b.at));
      if (earliest === undefined) continue;
      if (earliest.side !== null) {
        scratch.paths.add(path);
        scratch.solves.add(use.by);
        continue;
      }
      const key = `${use.campaign} solve ${use.by} (${use.side}) from ${clock(use.at)}`;
      left.set(key, [
        ...(left.get(key) ?? []),
        `${path} (${earliest.campaign} ${earliest.by}, ${clock(earliest.at)})`,
      ]);
    }
  }
  return {
    left: [...left].map(([solve, paths]) => `${solve}: ${paths.join(", ")}`),
    scratch: `${String(scratch.paths.size)} scratch paths named by solves of two campaigns, in ${String(scratch.solves.size)} solves`,
  };
}
