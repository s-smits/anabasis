/**
 * Lane 31 across campaigns: one row a campaign, in the columns the lane compares, and the paths
 * under the host's `/tmp` that one campaign named before another campaign's solve ran them.
 *
 * Campaigns of one pack run side by side on one host, each on its own code. Read one at a time, a
 * promotion's tally says nothing of whether its peer on another tree climbed faster, and a solve
 * that ran a program from `/tmp` says nothing of who put it there: on 10 October abl175-new's
 * reference solve ran the phreeqc buffer-a's Builder had installed under `/tmp/phq-inst` four
 * hours before, and only the two logs together show it. `wri.ts climb` prints this, and the
 * lane 31 prompt carries it beside the peers' overviews. The 18 October 2026 self-analysis found
 * that all three promotions in four campaigns followed the table, so live moves no longer use the
 * Builder-led idle count; this file still reads its safeguard from old logs.
 */
import type { LogEvent } from "#src/kernel/log.ts";
import { asRecord, isString } from "#src/meta/json-shape.ts";
import { decidedOn } from "../runs/view.ts";
import {
  count,
  EXAM_END,
  EXAM_START,
  fired,
  type Index,
  indexOf,
  items,
  REPORTED,
  short,
  type Trigger,
  text,
} from "./folds.ts";
import { epochsOf, SHARED_PATH, spentTo, testSaid, validOf } from "./promotion.ts";

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
 * The safeguards: what went wrong in a live campaign before a mechanism answered it, read from the
 * log alone and printed, never acted on, since the move table, its holds and the load gate already
 * decide (the review of 14 October, section 5). A safeguard goes by deleting its key in the change
 * that names its replacement, and a number is never reused. 5 went at birth, as `waitOut` waits
 * out any named reset since 15 October; 6 is `HOST LOADED`; 8 waits for a second promotion.
 */
export function safeguardTriggers({ events }: Index): Trigger[] {
  // Old led logs used three as the idle count and reported the safeguard after two counts.
  const HISTORICAL_IDLE = 3;
  const said = (name: Parameters<typeof fired>[0], lines: readonly string[]) =>
    lines.length > 0 ? [fired(name, lines.join("; "))] : [];
  // 1: a run of the command ended `finished` while the table on the log up to there named a move.
  const named = events.flatMap(({ kind, at, data }, index) => {
    if (kind !== "campaign.ended" || data.ending !== "finished") return [];
    const { move } = decidedOn(events.slice(0, index));
    return move === "end" ? [] : [`${clock(at)}: ${move}`];
  });
  // 2: a Builder session ended at its wall while a host action it asked for had begun and not ended.
  const walled = events.flatMap(({ kind, data }, index) => {
    if (kind !== "build.finished" || data.ended !== "wall") return [];
    const from = events.findLastIndex((each, at) => at < index && each.kind === "build.started");
    const open = new Set<string>();
    for (const each of events.slice(from, index)) {
      if (["comparison.started", EXAM_START].includes(each.kind)) open.add(text(each.data.session));
      if ([REPORTED, EXAM_END].includes(each.kind)) open.delete(text(each.data.session));
    }
    return open.size > 0 ? [`${text(data.session)} during ${[...open].join(", ")}`] : [];
  });
  // 3 and 4: one move asked again with no report or Examiner ending between, and Builder
  // conversations in a row across the command's endings in old led logs.
  const runs = { same: new Map<string, number>(), again: new Map<string, number>(), led: 0, most: 0 };
  for (const { kind, data } of events) {
    if (kind === REPORTED || kind === EXAM_END) runs.same.clear();
    if (kind !== "campaign.move") continue;
    const key = [data.move, data.code, data.session].map(text).join(" ");
    const times = (runs.same.get(key) ?? 0) + 1;
    runs.same.set(key, times);
    if (times >= 3) runs.again.set(key, times);
    runs.led = data.code === "led" ? runs.led + 1 : 0;
    runs.most = Math.max(runs.most, runs.led);
  }
  // 7: a session's limits moved between two sessions, which no term of the opening names.
  const limits = events.flatMap(({ kind, data }) =>
    kind === "build.started" ? [{ session: text(data.session), limits: asRecord(data.limits) ?? {} }] : [],
  );
  const moved = limits.slice(1).flatMap(({ session, limits: now }, index) => {
    const before = limits[index]?.limits ?? {};
    return Object.keys(now).flatMap((key) => {
      const [was, is] = [before[key], now[key]].map((value) => JSON.stringify(value));
      return was === is ? [] : [`${session}: ${key} ${String(was)} to ${String(is)}`];
    });
  });
  return [
    ...said("SAFEGUARD-1 ENDED WITH A MOVE NAMED", named),
    ...said("SAFEGUARD-2 WALL DURING A HOST ACTION", walled),
    ...said(
      "SAFEGUARD-3 SAME MOVE ASKED AGAIN",
      [...runs.again].map(([key, times]) => `${key} ${String(times)} times`),
    ),
    ...said(
      "SAFEGUARD-4 CONVERSATIONS WITHOUT PROGRESS",
      runs.most >= 2 * HISTORICAL_IDLE ? [`${String(runs.most)} in a row`] : [],
    ),
    ...said("SAFEGUARD-7 LIMITS MOVED", moved),
  ];
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
