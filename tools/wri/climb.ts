/**
 * Lane 31 across campaigns: one row a campaign, in the columns the lane compares, and the paths
 * under the host's `/tmp` that one campaign named before another campaign's solve ran them.
 *
 * Campaigns of one pack run side by side on one host, each on its own code. Read one at a time, a
 * promotion's tally says nothing of whether its peer on another tree climbed faster, and a solve
 * that ran a program from `/tmp` says nothing of who put it there: on 10 October abl175-new's
 * reference solve ran the phreeqc buffer-a's Builder had installed under `/tmp/phq-inst` four
 * hours before, and only the two logs together show it. `wri.ts climb` prints this, and the
 * lane 31 prompt carries it beside the peers' overviews.
 */
import { gateAnswers } from "#src/examiner/record.ts";
import { flipP, informative, type Paired, pairings } from "#src/kernel/compare.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import { pairsReported } from "#src/kernel/reports.ts";
import { asRecord, isNumber, isString } from "#src/meta/json-shape.ts";
import {
  type Compared,
  count,
  fired,
  type Index,
  indexOf,
  items,
  short,
  strings,
  type Trigger,
  text,
} from "./folds.ts";
import { epochsOf, joinedFrontier, pSaid, SHARED_PATH, spentTo, testSaid, validOf } from "./promotion.ts";

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

/** The opening's level and trigger, or the tree's default. */
function ruleOf(log: Index): string {
  const terms = asRecord(log.of("campaign.opened").at(-1)?.terms);
  const pinned = ["level", "trigger"].flatMap((key) =>
    isString(terms?.[key]) ? [`${key} ${text(terms[key])}`] : [],
  );
  return pinned.join(", ") || "default";
}

/** Of a test record, the tasks that did not tie, of all. */
function untied(tested: Parameters<typeof asRecord>[0]): string {
  const record = asRecord(tested);
  if (record === null) return "-";
  const [wins, losses, ties] = ["wins", "losses", "ties"].map((key) => count(record[key]));
  const decided = (wins ?? 0) + (losses ?? 0);
  return `${String(decided)}/${String(decided + (ties ?? 0))}`;
}

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
    ({ session, last }) => `${session} ${(validOf(asRecord(last.valid)?.old).share * 100).toFixed(0)}%`,
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
    ruleOf(log),
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
 * both. 9: the joined frontier on validity alone does not clear the level, so the objective decided
 * it, as it did all three of r3's (1-0, 0-0 and 1-0 on validity); a drafted exam's objective is its
 * author's own computation, which nothing outside it has checked.
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
    const joined = joinedFrontier(reports);
    if (rests.length === 0 || flipP(joined) > level) return [];
    const harness = `${short(text(data.harness))} ${said(joined)} joined at level ${String(level)}`;
    return [
      { level, harness, without: joinedFrontier(reports, authored), valid: validityOf(log.events, rests) },
    ];
  });
  const author = promotions.filter(({ without, level }) => flipP(without) > level);
  const objective = promotions.filter(({ valid, level }) => flipP(valid) > level);
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
    ...(objective.length > 0
      ? [
          fired(
            "SAFEGUARD-9 PROMOTION BY THE OBJECTIVE ALONE",
            objective.map(({ harness, valid }) => `${harness}, ${said(valid)} on validity alone`).join("; "),
          ),
        ]
      : []),
  ];
}

/** Each frontier task's difference in pairs won on validity alone, summed over a promotion's two
 *  readings as `joined` sums them. */
function validityOf(events: readonly LogEvent[], rests: readonly Compared[]): number[] {
  const validity = new Map<string, number>();
  for (const { session, at, last } of rests) {
    const frontier = new Set(strings(asRecord(last.frontier)?.of));
    const pairs = pairsReported(events, { session, index: at, data: last }).filter(({ task }) =>
      frontier.has(task),
    );
    for (const pair of pairs) {
      const { fresh, old } = pairings(pair).validity;
      validity.set(pair.task, (validity.get(pair.task) ?? 0) + fresh - old);
    }
  }
  return [...validity.values()];
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
  for (const { kind, at, data } of events) {
    if (!["solve.call", "build.call", "exam.call"].includes(kind)) continue;
    const solve = kind === "solve.call" ? text(data.solve) : null;
    const by = solve ?? text(data.session);
    for (const [, path = ""] of JSON.stringify(data.args ?? "").matchAll(SHARED_PATH)) {
      if (first.has(path)) continue;
      first.set(path, {
        campaign: name,
        by,
        at,
        side: solve === null ? null : (sideOf.get(solve) ?? "unknown"),
      });
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
