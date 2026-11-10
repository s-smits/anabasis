/**
 * What a look says of one event of a run, and the step that event leaves owed. One owner for the
 * three readers that said these apart until 10 November: the pulse (`pulse.ts`), whose promotion line
 * named no starter comparison; the alerts (`alerts.ts`), which alone said that a run was ready to
 * pause; and the loop's driver (`wri2p2.ts`), which alone read the investigation's trigger. A session
 * that watched the pulse learned of a pause or an investigation owed only from another command.
 *
 * An event's line is read from the event alone (`SAID`), in counts and ids: no line carries a task's
 * text, a check's or a reason the exam side wrote beyond what the pulse already said. The climb's
 * lines are read from the log up to the event (`climbAt`), and the trigger from the whole log
 * (`progressOf`, `triggerOf`).
 */
import { comparisonFloor } from "#src/campaign/admission.ts";
import { BARS, epochsOf, starterReads } from "#src/campaign/climb.ts";
import { readsStepEitherWay, scoresIn, type Tally, testOf } from "#src/kernel/compare.ts";
import type { EventKind, LogEvent } from "#src/kernel/log.ts";
import { clearing, sizeLines } from "#src/kernel/size.ts";
import { asRecord, isNumber, isString, type JsonObject } from "#src/meta/json-shape.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { plural } from "#src/meta/text.ts";

export const REPORTED = "comparison.reported";
export const PROMOTED = "harness.promoted";
export const ENDED = "campaign.ended";
const HOUR_MS = 3_600_000;
const DIGEST_CHARS = 8;

/** Where a run owes its next step, which names an investigation and stops nothing: two promotions
 *  or twelve hours, and two starter comparisons read before a pause. */
export const TRIGGER_AT = { promotions: 2, hours: 12 } as const;
/** The loop's driver, whose `open` a look names where an investigation is due. */
export const DRIVER = ".claude/skills/run-improvement-campaign/scripts/wri2p2.ts";

/** One promotion of a run, and its starter comparison once one tallied a task (`epochsOf`). */
export interface Promotion {
  readonly digest: string;
  readonly read: {
    readonly session: string;
    readonly tally: Tally;
    /** Whether its tally, turned so that the reference is the side ahead, reads a step at its
     *  level (`confirmed`, `epochsOf`); the comparison's own reading is the starter's, never this. */
    readonly confirmed: boolean;
    /** The tally on the tasks written after the promotion. A peer whose tree predates it sends none. */
    readonly writtenAfter?: Tally;
  } | null;
}

/** How far a run has come, as its log reads. */
export interface Progress {
  readonly live: boolean;
  readonly promotions: number;
  readonly compared: number;
  /** Whether a scored comparison reported every task tied. */
  readonly allTied: boolean;
  readonly ending: string | null;
  readonly hours: number;
}

export const minutes = (ms: number) => `${String(Math.round(ms / 60_000))}m`;
export const dollars = (value: number) => `$${value.toFixed(2)}`;
export const short = (value: unknown) => (isString(value) ? value.replaceAll(/\s+/g, " ").slice(0, 160) : "");
/** A string or number field as written, and "?" for a field the event does not hold. */
export const word = (value: unknown) => (isString(value) || isNumber(value) ? String(value) : "?");
/** How many a list field holds, and none for a field the event does not hold. */
const sized = (value: unknown) => (Array.isArray(value) ? value.length : 0);

/** How long a session or a solve took, and what it billed, as its `.finished` event says. */
const cost = (data: JsonObject) =>
  `${isNumber(data.seconds) ? ` in ${minutes(data.seconds * 1000)}` : ""}${isNumber(data.billed) ? `, ${dollars(data.billed)}` : ""}`;

/**
 * A report in the four factors and supply (`AGENTS.md`, section 1), from the event alone: the tasks
 * the reference left room on against the admission floor, the reference against itself, and the
 * attempt this epoch against the economy's bar. Until 1 November the line said only the reading,
 * and a watch learned that buffer's promoted harness left 0 of 8 tasks informative by reading the
 * log by hand. An A/A that clears the level, a floor not met or a bar passed is one to look at.
 */
function factorsOf(data: JsonObject): { said: string; look: boolean } {
  const informative = asRecord(asRecord(data.valid)?.informative)?.old;
  const level = isNumber(data.level) ? data.level : 0.02;
  const floor = comparisonFloor(level);
  // The A/A is read as a step is, either way, on the scores the step is read on (`scoresIn`).
  const noise = asRecord(data.noise);
  const scores = Array.isArray(noise?.differences) ? scoresIn(noise) : undefined;
  const aa = scores === undefined ? null : testOf(scores);
  const clears = scores !== undefined && readsStepEitherWay(scores, level);
  const worth = asRecord(data.worth);
  const spent = asRecord(worth?.cost);
  const attempts = spent?.attempts;
  const scant = isNumber(informative) && informative < floor;
  // Past the bar as the report reads it (`met`, `costOf`, `climb.ts`): set-up's epoch never is.
  const dear = spent?.met === false;
  const parts = [
    isNumber(informative)
      ? `supply ${String(informative)} of ${word(data.tasks)} informative, floor ${String(floor)}`
      : "",
    aa === null
      ? ""
      : `A/A ${String(aa.wins)}-${String(aa.losses)}-${String(aa.ties)}${clears ? " cleared the level" : ""}`,
    isNumber(attempts) ? `attempt ${String(attempts)} of ${String(BARS.cost)} this epoch` : "",
  ].filter((part) => part !== "");
  return { said: parts.map((part) => ` · ${part}`).join(""), look: clears || dear || scant };
}

function reportHead(data: JsonObject): string {
  const settled = asRecord(data.settled);
  if (settled !== null) {
    return `◆ settled by hand as ${word(data.reading)}: ${word(settled.labelled)} labelled, ${word(settled.defects)} a check defect`;
  }
  if (data.capped === true) {
    return `⚠ reported ${word(data.reading)}: its dollar cap cut ${asRecord(data.scored) === null ? "it short" : "the starter's solves short, and its test stands"}`;
  }
  const aside = sized(data.aside);
  if (aside > 0) {
    return `⚠ reported ${word(data.reading)}, with ${String(aside)} task(s) set aside on rejections no person has settled`;
  }
  return `${data.reading === "not-scored" ? "⚠" : "◆"} reported ${word(data.reading)}`;
}

/** What a comparison's report earns: one that scored nothing, one its cap cut, or one with tasks set
 *  aside on rejections nobody has settled is one to look at before it is believed
 *  (`src/campaign/round.ts`), and so is one whose factors say so (`factorsOf`). */
function reportLine(data: JsonObject): string {
  const head = reportHead(data);
  const { said, look: flagged } = factorsOf(data);
  return `${flagged ? head.replace(/^◆/, "⚠") : head}${said}`;
}

/** What a comparison can read, said as it starts and before a solve is paid for: its solves a side,
 *  the tasks it carries over, and the smallest results that clear its level (`sizeLines`). One that
 *  holds too few tasks to read a step is one to look at. Until 10 November a start had no line, and
 *  a watch learned what a comparison could show from its report. */
function startLine(data: JsonObject): string {
  const head = `comparison ${word(data.session)} started`;
  if (!isNumber(data.level) || !isNumber(data.solves)) return `· ${head}`;
  const tasks = sized(data.tasks);
  const retained = sized(data.retained);
  const terms = [
    `${head}${isString(data.starter) && data.fresh === data.starter ? " against the starter" : ""}`,
    `${plural(data.solves, "solve")} a side`,
    ...(retained > 0 ? [`${plural(retained, "task")} retained`] : []),
  ];
  const mark = clearing(tasks, data.level).length === 0 ? "⚠" : "·";
  return `${mark} ${terms.join(", ")}: ${sizeLines(tasks, data.level)[0] ?? ""}`;
}

/** The line each event a reader wants earns; a kind not here is a trace, and null is one of its
 *  kind left unsaid. A promotion's line is the climb's (`climbAt`). */
export const SAID: Partial<Record<EventKind, (data: JsonObject) => string | null>> = {
  // The exam's milestones in counts. Until 10 November a draft, a checker read and a freeze had no
  // line, and the two with a fault were said only by the `rows` reader's triggers, a pass later.
  "exam.drafted": (data) => {
    const draft = asRecord(data.draft);
    return `◆ the exam is drafted: ${plural(sized(draft?.checks), "check")}, ${plural(sized(draft?.tasks), "task")}`;
  },
  "checker.read": (data) => {
    const faults = sized(data.faults);
    const nothing = asRecord(data.doNothing);
    const head = faults > 0 ? `⚠ the checker read with ${plural(faults, "fault")}` : "◆ the checker read";
    return `${head}: ${plural(sized(data.rows), "check")}, ${String(sized(data.admitted))} admitted, ${word(data.controls)} controls, the do-nothing answer rejected on ${word(nothing?.rejected)} of ${word(nothing?.tasks)} tasks`;
  },
  "contract.frozen": (data) => {
    const head =
      isNumber(data.faults) && data.faults > 0
        ? `⚠ the contract is frozen despite ${plural(data.faults, "fault")}`
        : "◆ the contract is frozen";
    return `${head}, ${plural(sized(data.admitted), "check")} admitted`;
  },
  "build.started": (data) => `· build ${word(data.session)} started on ${word(data.model)}`,
  "exam.started": (data) => `· exam ${word(data.session)} started on ${word(data.model)}`,
  "build.finished": (data) =>
    `◆ build ended at ${word(data.ended)} and ${data.changed === true ? "changed the harness" : "left the harness as it was"}` +
    `${data.broken === null ? "" : `, broken: ${short(data.broken)}`}${cost(data)}`,
  "exam.finished": (data) => {
    const head = `◆ exam ${word(data.session)} ended${cost(data)}`;
    if (!isNumber(data.proposed)) return head;
    return `${head}: held ${String(sized(data.held))} of ${String(data.proposed)} proposed, ${String(sized(data.refused))} refused`;
  },
  "harness.version": (data) =>
    `· harness ${word(data.version).slice(0, DIGEST_CHARS)}${short(data.note) === "" ? "" : `: ${short(data.note)}`}`,
  // A solve is counted in the status line, and only a non-result has a line of its own, by its kind
  // and reason: over 57 recorded logs, a line a solve started or passed was 74% of everything the
  // pulse said, and no person acts on one. A line a look counting its solves, replayed on those
  // logs, became the most said line, and printed the row the status line already counts.
  "solve.finished": (data) => {
    const ending = asRecord(data.ending);
    // The gate cut a room solve once another settled the task's room, from 31 October until it
    // stopped solving on 1 November; until 31 October each cut warned as a solve with no result.
    if (ending?.outcome !== "non-result" || ending.cancelledBy === "admission") return null;
    return `⚠ a solve ended without a result, ${word(ending.kind)}: ${short(ending.reason)}`;
  },
  // A campaign's ending, and a wait for the provider or the network: until 15 October the pulse
  // said neither, and a run waiting out a limit read as quiet. A wait on the load is one a solve.
  [ENDED]: (data) => `◆ the campaign ended ${word(data.ending)}: ${short(data.why)}`,
  "campaign.waited": (data) =>
    isString(data.for)
      ? `⚠ waited ${isNumber(data.ms) ? minutes(data.ms) : "?"} for the ${data.for}${isString(data.until) ? ` until ${data.until}` : ""}`
      : null,
  "referee.finding": (data) => `· the Referee on ${word(data.task)}: ${short(data.reason)}`,
  "comparison.started": startLine,
  [REPORTED]: reportLine,
};

/** The promotions of a log, oldest first. */
export function promotionsOf(events: readonly LogEvent[]): Promotion[] {
  const reads = starterReads(events);
  return epochsOf(events)
    .slice(1)
    .map(({ reference, starter_read: session, starter_tally: tally, confirmed }) => {
      const after = reads.find((each) => each.session === session)?.origins["written after"].whole;
      return {
        digest: reference.slice(0, DIGEST_CHARS),
        read:
          session === null || tally === null
            ? null
            : { session, tally, confirmed: confirmed === true, ...keyIfDefined("writtenAfter", after) },
      };
    });
}

/**
 * What a run's promotions and starter comparisons add to what `seen` remembers, oldest first, and
 * whether each is one to look at: a starter comparison that confirmed nothing, and a run ready to
 * pause. A promotion is said with what a pause before its starter comparison costs (`AGENTS.md`,
 * factor 1), and a run is ready once its second starter comparison has read, whatever it read.
 */
export function climbed(
  row: { readonly name: string; readonly promotions: readonly Promotion[] },
  seen: { readonly promotions: number; readonly reads: readonly string[] },
): { line: string; look: boolean }[] {
  const lines = row.promotions.flatMap(({ digest, read }, at) => {
    const nth = String(at + 1);
    const promoted =
      at < seen.promotions
        ? []
        : [
            {
              line: `promotion ${nth}, harness ${digest}${read === null ? "; a pause should wait for its starter comparison, or it stays unconfirmed for good" : ""}`,
              look: false,
            },
          ];
    if (read === null || seen.reads.includes(read.session)) return promoted;
    const { wins, losses, ties } = read.tally;
    const after = read.writtenAfter;
    return [
      ...promoted,
      {
        line: `starter comparison ${read.session} after promotion ${nth} (${digest}) read ${read.confirmed ? "a step" : "no step"} for the reference: won ${String(wins)}, lost ${String(losses)}, tied ${String(ties)}, ${read.confirmed ? "confirmed" : "not confirmed"}${after === undefined ? "" : `; on tasks written after it won ${String(after.wins)}, lost ${String(after.losses)}, tied ${String(after.ties)}`}`,
        look: !read.confirmed,
      },
    ];
  });
  const read = row.promotions.filter((one) => one.read !== null).length;
  return seen.reads.length < TRIGGER_AT.promotions && read >= TRIGGER_AT.promotions
    ? [
        ...lines,
        {
          line: `ready to pause, ${String(read)} promotions read: bun run runs pause ${row.name} --yes`,
          look: true,
        },
      ]
    : lines;
}

/** The climb's lines of the run `name`, each marked and under the index of the event of `log` that
 *  earned it, for the events from `from` on: a promotion's own line at its `harness.promoted`, and a
 *  starter comparison, with the pause it may make ready, at its report. */
export function climbAt(name: string, log: readonly LogEvent[], from: number): Map<number, string[]> {
  const found = new Map<number, string[]>();
  let before: Promotion[] | null = null;
  for (const [at, { kind }] of log.entries()) {
    if (at < from || (kind !== PROMOTED && kind !== REPORTED)) continue;
    before ??= promotionsOf(log.slice(0, at));
    // A report before the first promotion is no starter comparison's.
    if (kind === REPORTED && before.length === 0) continue;
    const promotions = promotionsOf(log.slice(0, at + 1));
    const reads = before.flatMap(({ read }) => (read === null ? [] : [read.session]));
    const lines = climbed({ name, promotions }, { promotions: before.length, reads });
    if (lines.length > 0) {
      found.set(
        at,
        lines.map(({ line, look }) => `${look ? "⚠" : "◆"} ${line}`),
      );
    }
    before = promotions;
  }
  return found;
}

/** The progress of the run `seen` whose log holds `events`, read at `now`. */
export function progressOf<Run extends { readonly live: boolean }>(
  seen: Run,
  events: readonly LogEvent[],
  now: number,
): Run & Progress {
  const last = events.at(-1);
  const opened = Date.parse(events[0]?.at ?? "");
  const reported = events.filter(({ kind }) => kind === REPORTED);
  return {
    ...seen,
    promotions: events.filter(({ kind }) => kind === PROMOTED).length,
    compared: reported.length,
    // A comparison that scored nothing tested nothing, so its empty tally is no tie.
    allTied: reported.some(({ data }) => {
      const scored = asRecord(data.scored);
      return data.reading !== "not-scored" && scored?.wins === 0 && scored.losses === 0;
    }),
    ending: last?.kind === ENDED && isString(last.data.ending) ? last.data.ending : null,
    // A live run is timed to now: one in a long wait writes nothing, and its clock still runs.
    hours: Number.isNaN(opened) ? 0 : ((seen.live ? now : Date.parse(last?.at ?? "")) - opened) / HOUR_MS,
  };
}

/** Why an investigation opens on `row` now, or null while it runs on. */
export function triggerOf(
  row: Progress,
  limits: { promotions: number; hours: number } = TRIGGER_AT,
): string | null {
  if (row.promotions >= limits.promotions) return `${String(row.promotions)} promotions`;
  if (row.allTied) return "a comparison left no task untied";
  if (row.hours >= limits.hours) return `${row.hours.toFixed(1)} h since its opening`;
  // A run that ended before any comparison measured nothing an iteration could read.
  if (!row.live && row.compared > 0) return `closed${row.ending === null ? "" : ` (${row.ending})`}`;
  return null;
}
