/**
 * Event formatting and checkpoint triggers shared across `pulse.ts`, `alerts.ts`, and `wri2p2.ts`.
 * Translates raw campaign log events into concise status lines, promotion summaries, and decision
 * triggers without requiring separate log scans.
 */
import { comparisonFloor } from "#src/campaign/admission.ts";
import { BARS, epochsOf, starterReads } from "#src/campaign/climb.ts";
import { readsStep, readsStepEitherWay, scoresIn, type Tally, testOf } from "#src/kernel/compare.ts";
import { type EventKind, eventsOf, type LogEvent } from "#src/kernel/log.ts";
import { endingOf } from "#src/kernel/reports.ts";
import { smallestSteps, sizeLines } from "#src/kernel/size.ts";
import { HOUR_MS } from "#src/meta/clock.ts";
import { asRecord, isBoolean, isNumber, isString, type JsonObject } from "#src/meta/json-shape.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { plural } from "#src/meta/text.ts";

export const REPORTED = "comparison.reported";
export const PROMOTED = "harness.promoted";
export const ENDED = "campaign.ended";
const DIGEST_CHARS = 8;

/** Per-promotion decision points (`1` through `ceilingPromotions = 5`) and non-promoting clock
 *  bound (`12 h`). Each promotion opens a prediction-backtracking decision; promotion 5 is the
 *  iteration ceiling. */
export const TRIGGER_AT = { firstPromotion: 1, ceilingPromotions: 5, hours: 12 } as const;
/** Path to the improvement-loop driver invoked when an investigation opens. */
export const DRIVER = ".claude/skills/run-improvement-campaign/scripts/wri2p2.ts";

/** One promotion in a campaign and its first scored starter confirmation comparison (`epochsOf`). */
export interface Promotion {
  readonly digest: string;
  readonly read: {
    readonly session: string;
    readonly tally: Tally;
    /** True when the reference cleared the significance level against the starter (unbilled). */
    readonly confirmed: boolean;
    /** Tally restricted to tasks written after the promotion (absent on older peer logs). */
    readonly writtenAfter?: Tally;
  } | null;
}

/** High-level progress counters folded from a campaign log. */
export interface Progress {
  readonly live: boolean;
  readonly promotions: number;
  readonly compared: number;
  /** True if any scored comparison ended with every task tied. */
  readonly allTied: boolean;
  readonly ending: string | null;
  readonly hours: number;
}

export const minutes = (ms: number) => `${String(Math.round(ms / 60_000))}m`;
export const dollars = (value: number) => `$${value.toFixed(2)}`;
export const short = (value: unknown) => (isString(value) ? value.replaceAll(/\s+/g, " ").slice(0, 160) : "");
/** Render a string or numeric field, falling back to `"?"` when absent. */
export const word = (value: unknown) => (isString(value) || isNumber(value) ? String(value) : "?");
const sized = (value: unknown) => (Array.isArray(value) ? value.length : 0);

/** Format duration and billed cost from a `.finished` event payload. */
const cost = (data: JsonObject) =>
  `${isNumber(data.seconds) ? ` in ${minutes(data.seconds * 1000)}` : ""}${isNumber(data.billed) ? `, ${dollars(data.billed)}` : ""}`;

/**
 * Format the four factor summaries and supply floor from a `comparison.reported` payload, and
 * return `flag: true` when supply drops below floor, an A/A control triggers a false positive, or
 * epoch attempts exceed the economy threshold.
 */
function factorsOf(data: JsonObject): { text: string; flag: boolean } {
  const informative = asRecord(asRecord(data.valid)?.informative)?.old;
  const level = isNumber(data.level) ? data.level : 0.02;
  const floor = comparisonFloor(level);
  const noise = asRecord(data.noise);
  const scores = Array.isArray(noise?.differences) ? scoresIn(noise) : undefined;
  const aa = scores === undefined ? null : testOf(scores);
  const clears = scores !== undefined && readsStepEitherWay(scores, level);
  const reversed = scores !== undefined && clears && !readsStep(scores, level);
  const worth = asRecord(data.worth);
  const spent = asRecord(worth?.cost);
  const attempts = spent?.attempts;
  const lowSupply = isNumber(informative) && informative < floor;
  const overBudgetAttempts = spent?.met === false;
  const parts = [
    isNumber(informative)
      ? `supply ${String(informative)}/${word(data.tasks)} informative (floor ${String(floor)})`
      : "",
    aa === null
      ? ""
      : `A/A ${String(aa.wins)}-${String(aa.losses)}-${String(aa.ties)}${clears ? ` false positive${reversed ? " (reversed)" : ""}` : ""}`,
    isNumber(attempts) ? `attempt ${String(attempts)}/${String(BARS.cost)} this epoch` : "",
  ].filter((part) => part !== "");
  return {
    text: parts.map((part) => ` · ${part}`).join(""),
    flag: clears || overBudgetAttempts || lowSupply,
  };
}

function reportHead(data: JsonObject): string {
  const settled = asRecord(data.settled);
  if (settled !== null) {
    return `◆ manually adjudicated as ${word(data.reading)}: ${word(settled.labelled)} labelled, ${word(settled.defects)} check defects`;
  }
  if (data.capped === true) {
    return `⚠ reported ${word(data.reading)}: budget cap cut ${asRecord(data.scored) === null ? "comparison short" : "starter solves short (test retained)"}`;
  }
  const aside = sized(data.aside);
  if (aside > 0) {
    return `⚠ reported ${word(data.reading)} (${plural(aside, "task")} set aside awaiting operator labels)`;
  }
  return `${data.reading === "not-scored" ? "⚠" : "◆"} reported ${word(data.reading)}`;
}

/** Format a `comparison.reported` line, upgrading `◆` to `⚠` when any factor or cap warrants inspection. */
function reportLine(data: JsonObject): string {
  const head = reportHead(data);
  const { text, flag } = factorsOf(data);
  return `${flag ? head.replace(/^◆/, "⚠") : head}${text}`;
}

/** Format a `comparison.started` line with rollout count, retained tasks, and minimum step size. */
function startLine(data: JsonObject): string {
  const head = `comparison ${word(data.session)} started`;
  if (!isNumber(data.level) || !isNumber(data.solves)) return `· ${head}`;
  const tasks = sized(data.tasks);
  const retained = sized(data.retained);
  const terms = [
    `${head}${isString(data.starter) && data.fresh === data.starter ? " against starter" : ""}`,
    `${plural(data.solves, "rollout")} per arm`,
    ...(retained > 0 ? [`${plural(retained, "task")} retained`] : []),
  ];
  const mark = smallestSteps(tasks, data.level).length === 0 ? "⚠" : "·";
  return `${mark} ${terms.join(", ")}: ${sizeLines(tasks, data.level)[0] ?? ""}`;
}

/** Formatters for operator-relevant campaign events; absent kinds are routine trace events. */
export const EVENT_FORMATTERS: Partial<Record<EventKind, (data: JsonObject) => string | null>> = {
  "exam.drafted": (data) => {
    const draft = asRecord(data.draft);
    return `◆ exam drafted: ${plural(sized(draft?.checks), "check")}, ${plural(sized(draft?.tasks), "task")}`;
  },
  "checker.read": (data) => {
    const faults = sized(data.faults);
    const nothing = asRecord(data.doNothing);
    const head = faults > 0 ? `⚠ checker audit found ${plural(faults, "fault")}` : "◆ checker audited";
    return `${head}: ${plural(sized(data.rows), "check")}, ${String(sized(data.admitted))} admitted, ${word(data.controls)} controls, do-nothing rejected on ${word(nothing?.rejected)}/${word(nothing?.tasks)} tasks`;
  },
  "contract.frozen": (data) => {
    const head =
      isNumber(data.faults) && data.faults > 0
        ? `⚠ contract frozen despite ${plural(data.faults, "fault")}`
        : "◆ contract frozen";
    return `${head} (${plural(sized(data.admitted), "check")} admitted)`;
  },
  "build.started": (data) => `· build ${word(data.session)} started on ${word(data.model)}`,
  "exam.started": (data) => `· exam ${word(data.session)} started on ${word(data.model)}`,
  "build.finished": (data) => {
    const harness = data.changed === true ? "modified harness" : "harness unchanged";
    const broken = short(data.broken);
    return `◆ build ended (${word(data.ended)})${isBoolean(data.changed) ? `, ${harness}` : ""}${broken === "" ? "" : `, broken: ${broken}`}${cost(data)}`;
  },
  "exam.finished": (data) => {
    const head = `◆ exam ${word(data.session)} ended${cost(data)}`;
    if (!isNumber(data.proposed)) return head;
    return `${head}: held out ${String(sized(data.held))}/${String(data.proposed)} proposed, ${String(sized(data.refused))} refused`;
  },
  "harness.version": (data) =>
    `· harness ${word(data.version).slice(0, DIGEST_CHARS)}${short(data.note) === "" ? "" : `: ${short(data.note)}`}`,
  "solve.finished": (data) => {
    const ending = asRecord(data.ending);
    if (ending?.outcome !== "non-result" || ending.cancelledBy === "admission") return null;
    return `⚠ solve returned non-result (${word(ending.kind)}): ${short(ending.reason)}`;
  },
  [ENDED]: (data) => `◆ campaign ended (${word(data.ending)}): ${short(data.why)}`,
  "campaign.waited": (data) =>
    isString(data.for)
      ? `⚠ waited ${isNumber(data.ms) ? minutes(data.ms) : "?"} for ${data.for}${isString(data.until) ? ` until ${data.until}` : ""}`
      : null,
  "referee.finding": (data) => `· Referee on ${word(data.task)}: ${short(data.reason)}`,
  "referee.draft": (data) =>
    `· Referee audited draft ${word(data.session)} (${word(data.verdict)}): ${short(data.summary)}`,
  "comparison.started": startLine,
  [REPORTED]: reportLine,
};

/** Extract campaign promotions and their first starter confirmation comparisons, oldest first. */
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
 * Format newly reported promotions and starter confirmation results beyond `seen`, flagging
 * unconfirmed promotions and completed confirmation checkpoints ready for backtracking or pause.
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
              line: `promotion ${nth}, harness ${digest}${read === null ? " (wait for starter confirmation before pausing)" : ""}`,
              look: false,
            },
          ];
    if (read === null || seen.reads.includes(read.session)) return promoted;
    const { wins, losses, ties } = read.tally;
    const after = read.writtenAfter;
    return [
      ...promoted,
      {
        line: `starter confirmation ${read.session} for promotion ${nth} (${digest}): ${read.confirmed ? "confirmed" : "not confirmed"} (${String(wins)}-${String(losses)}-${String(ties)}${after === undefined ? "" : `; written-after ${String(after.wins)}-${String(after.losses)}-${String(after.ties)}`})`,
        look: !read.confirmed,
      },
    ];
  });
  const read = row.promotions.filter((one) => one.read !== null).length;
  if (read === 0 || read !== row.promotions.length || read <= seen.reads.length) return lines;
  const action =
    read >= TRIGGER_AT.ceilingPromotions
      ? `ready to pause, ${plural(read, "promotion")} checked (ceiling reached)`
      : `ready to pause or continue, ${plural(read, "promotion")} checked (backtrack predictions, up to ${String(TRIGGER_AT.ceilingPromotions)})`;
  return [...lines, { line: `${action}: bun run runs pause ${row.name} --yes`, look: true }];
}

/** Map log indices from `from` onward to their newly generated promotion and confirmation lines. */
export function climbAt(name: string, log: readonly LogEvent[], from: number): Map<number, string[]> {
  const found = new Map<number, string[]>();
  let before: Promotion[] | null = null;
  for (const {
    index: at,
    event: { kind },
  } of eventsOf(log, [PROMOTED, REPORTED])) {
    if (at < from) continue;
    before ??= promotionsOf(log.slice(0, at));
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

/** Compute live or final campaign progress counters at timestamp `now`. */
export function progressOf<Run extends { readonly live: boolean }>(
  seen: Run,
  events: readonly LogEvent[],
  now: number,
): Run & Progress {
  const last = events.at(-1);
  const opened = Date.parse(events[0]?.at ?? "");
  const reported = eventsOf(events, REPORTED);
  return {
    ...seen,
    promotions: eventsOf(events, PROMOTED).length,
    compared: reported.length,
    // A comparison that scored nothing tested nothing, so its empty tally is no tie.
    allTied: reported.some(({ event: { data } }) => {
      const scored = asRecord(data.scored);
      return data.reading !== "not-scored" && scored?.wins === 0 && scored.losses === 0;
    }),
    ending: endingOf(events),
    hours: Number.isNaN(opened) ? 0 : ((seen.live ? now : Date.parse(last?.at ?? "")) - opened) / HOUR_MS,
  };
}

/**
 * Determine whether `row` has reached a decision point or investigation trigger, returning the
 * reason or `null` if the run should continue unattended.
 */
export function triggerOf(row: Progress): string | null {
  if (row.promotions >= TRIGGER_AT.firstPromotion) return plural(row.promotions, "promotion");
  if (row.allTied) return "all tasks tied in comparison";
  if (row.hours >= TRIGGER_AT.hours) return `${row.hours.toFixed(1)} h since opening`;
  if (!row.live && row.compared > 0) return `closed${row.ending === null ? "" : ` (${row.ending})`}`;
  return null;
}

/** Return the UTC timestamp (rounded up to the second) when a live run reaches its 12 h clock bound. */
export const clockTurns = (row: Pick<Progress, "hours">, now: number): string =>
  new Date(Math.ceil((now + (TRIGGER_AT.hours - row.hours) * HOUR_MS) / 1000) * 1000)
    .toISOString()
    .replace(".000Z", "Z");

/** Return the CLI command that advances a triggered run (pause if live, open investigation if stopped). */
export const openingCommand = (run: { readonly name: string; readonly live: boolean }, on = ""): string =>
  run.live ? `bun run runs ${on}pause ${run.name} --after reported --yes` : `bun ${DRIVER} open ${run.name}`;
