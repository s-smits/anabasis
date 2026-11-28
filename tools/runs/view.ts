/**
 * `bun run runs view <name> [--level N] [--target N] [--practice N] [--past-stop "<why>"]`: a
 * campaign's setup, sessions, comparisons, climb summary, and the next action the decision table
 * selects (`decide`, `src/campaign/scheduler.ts`). Terms fall back from flags to `campaign.opened`
 * (`src/campaign/opening.ts`) to defaults, so it matches `tools/campaign/harness-builder.ts` on the same
 * log.
 */
import { barLines, epochLine, epochsOf, starterReads } from "#src/campaign/climb.ts";
import { nextAction } from "#src/campaign/scheduler.ts";
import { comparisonFloor, refusals, supplyOf } from "#src/campaign/admission.ts";
import { askedOf, type Plan } from "#src/campaign/state.ts";
import { type ScheduledAction, decidedLine, short } from "#src/campaign/move.ts";
import { type Called, calledBy, namesOf } from "#src/campaign/names.ts";
import { openingOf, planOf } from "#src/campaign/opening.ts";
import { type Campaign, campaignOf, type Handover, openSteps } from "#src/campaign/summary.ts";
import { type EventKind, eventsOf, type LogEvent, read as readEvents } from "#src/kernel/log.ts";
import { type Call, traced } from "#src/kernel/trace.ts";
import { HOUR_MS, MINUTE_MS } from "#src/meta/clock.ts";
import { isString } from "#src/meta/json-shape.ts";
import { parseArgs } from "#src/meta/process.ts";
import { gitText } from "#src/meta/git.ts";
import { resolve } from "#src/meta/path.ts";
import { plural } from "#src/meta/text.ts";
import { PRACTICE } from "../campaign/prepare.ts";
import { COMPARISON_OPTIONS } from "../campaign/round.ts";
import { Misused, processes } from "./registry.ts";
import { readAcross } from "./snapshots.ts";
import { dollars } from "./summary.ts";
import { lastLaunch } from "./receipt.ts";
import { lifeOf } from "./diagnosis.ts";
import { runReason, runState } from "./state.ts";

/** A delay between first comparison admissibility and start longer than this is flagged. */
const DELAY_FLAG_MS = 75 * MINUTE_MS;
const VIEW_OPTIONS = {
  level: { type: "string" },
  target: { type: "string" },
  practice: { type: "string" },
  "past-stop": { type: "string" },
} as const;

type ViewFlags = { readonly [Flag in keyof typeof VIEW_OPTIONS]?: string | undefined };

const SKIP_CLOSED: ReadonlySet<EventKind> = new Set(["solve.call", "referee.call"]);
const STANDINGS = [
  ["open", "open"],
  ["passed-once", "passed once"],
  ["repaired", "repaired"],
  ["failing-again", "failing again"],
] as const;

const row = (id: string, body: string) => `  ${id.padEnd(11)} ${body}`;

function stateOf(step: Exclude<Handover, { readonly step: "comparison" }>, now: number): string {
  if (step.ended !== null) return step.ended;
  if (step.cut) return "interrupted before completion (superseded by a later step)";
  const minutes = Math.max(0, Math.round((now - Date.parse(step.last)) / MINUTE_MS));
  return `active, ${plural(step.turns, "turn")}, last event at ${step.last.slice(11, 19)}Z (${plural(minutes, "minute")} ago)`;
}

/** One campaign step (Examiner, Builder, or comparison), with letter aliases from `called`. */
function stepLine(step: Handover, now: number, called: Called): string {
  if (step.step === "examiner") {
    return row(
      step.id,
      `Examiner session (${stateOf(step, now)}): ${String(step.proposed)} proposed, ${String(step.held)} held out, ${String(step.refused)} refused · ${dollars(step.billed)}`,
    );
  }
  if (step.step === "builder") {
    const result =
      step.changed && step.harness !== null ? `produced ${called(step.harness)}` : "harness unchanged";
    const lineage = `from ${called(step.parent ?? "")}${step.ended === null ? "" : `, ${result}`}`;
    return row(
      step.id,
      `Builder session (${stateOf(step, now)}): ${lineage}, ${plural(step.practiceSolves, "practice solve")} · ${dollars(step.billed)}`,
    );
  }
  const { tally, valid, rulings, grain, repeat } = step;
  const inFlight = `${plural(step.solved, "solve")} finished, ${String(step.begun - step.solved)} ${step.cut ? "cut" : "open"}`;
  const outcome =
    step.reading === null
      ? `no report yet (${step.cut ? "interrupted" : "in progress"}): ${inFlight}`
      : `${tally === null ? "no tasks scored" : `${String(tally.wins)} won, ${String(tally.losses)} lost, ${String(tally.ties)} tied for ${called(step.fresh)}`} (outcome: ${step.reading})`;
  const ruled = [
    rulings.earned > 0 && `${plural(rulings.earned, "rejection")} ruled earned`,
    rulings["check-defect"] > 0 && `${String(rulings["check-defect"])} ruled check-defect`,
    rulings.unclear > 0 && `${String(rulings.unclear)} ruled unclear`,
  ].filter(Boolean);
  return row(
    step.id,
    [
      `comparison ${called(step.fresh)} vs ${called(step.old)} on ${plural(step.tasks, "task")}, ${String(step.solves)} rollouts per arm at alpha=${String(step.level)}: ${outcome}`,
      grain !== null &&
        grain.largest >= 2 &&
        `${String(grain.largest)} of ${plural(grain.of, "tallied frontier task")} in one family`,
      repeat !== null &&
        `${String(repeat.tasks)} of ${plural(step.tasks, "task")} also drawn by ${repeat.with}`,
      valid !== null &&
        `valid answers per task (${valid.old.map((_, index) => String(index)).join("/")}): reference ${valid.old.join("/")}, candidate ${valid.fresh.join("/")}`,
      step.points !== null &&
        `score delta (candidate minus reference): validity ${String(step.points.validity)}, objective ${String(step.points.objective)}`,
      step.aside > 0 && `${plural(step.aside, "task")} set aside awaiting operator labels`,
      ruled.length > 0 && ruled.join(", "),
      dollars(step.billed),
    ]
      .filter(Boolean)
      .join(" · "),
  );
}

export function viewLines(name: string, campaign: Campaign, now: number, called: Called = short): string[] {
  const { supply, fails } = campaign;
  const checker =
    supply.faults === null
      ? "checker not yet audited"
      : `checker audited, ${plural(supply.faults, "fault")}, ${supply.frozen ? "frozen" : "not frozen"}`;
  const standing = STANDINGS.flatMap(([state, label]) => {
    const found = fails.filter((fail) => fail.standing === state).length;
    return found === 0 ? [] : [`${String(found)} ${label}`];
  });
  return [
    name,
    row(
      "setup",
      `${String(supply.held)} held out · ${String(supply.released)} released for practice · ${String(supply.awaiting)} awaiting label · ${String(supply.exhausted)} exhausted · ${checker} · reference: ${campaign.reference === null ? "starter" : called(campaign.reference)}`,
    ),
    ...campaign.steps.map((step) => stepLine(step, now, called)),
    ...(fails.length === 0
      ? []
      : [row("practice", `${plural(fails.length, "failed practice solve")}: ${standing.join(", ")}`)]),
  ];
}

/**
 * The decision table on `events` under flag overrides, recorded opening terms and defaults; shared
 * with the UI server (`packages/ui/src/server/campaigns.ts`).
 */
export function decidedOn(events: readonly LogEvent[], values: ViewFlags = {}): ScheduledAction {
  return nextAction(events, planOn(events, values));
}

export function planOn(events: readonly LogEvent[], values: ViewFlags = {}): Plan {
  const opening = openingOf(events);
  const term = (flag: "level" | "practice", fallback: string) =>
    values[flag] ?? opening?.terms[flag] ?? fallback;
  const { target } = values;
  return planOf(
    events,
    {
      unprepared: opening?.prompt == null && eventsOf(events, "task.proposed").length === 0,
      level: Number(term("level", COMPARISON_OPTIONS.level.default)),
      target: target === undefined ? undefined : Number(target),
      pastStop: values["past-stop"],
      practice: Number(term("practice", String(PRACTICE))),
    },
    opening,
  );
}

/** `bun run runs view <name>`, by this checkout's reader after refreshing remote state. */
export async function view(args: readonly string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: [...args],
    allowPositionals: true,
    options: VIEW_OPTIONS,
  });
  const [name] = positionals;
  if (name === undefined) throw new Misused();
  const run = await readAcross(name);
  const reader = gitText(resolve(import.meta.dir, "../.."), "rev-parse", "--short=9", "HEAD");
  const launched = lastLaunch(run.path)?.commit.slice(0, 9) ?? "no receipt";
  console.log(`reader ${reader}; last launch ${launched}; decision table uses this checkout`);
  const running = processes();
  const events = readEvents(run.path, lifeOf(run, running).writing ? undefined : SKIP_CLOSED);
  for (const line of await runReason(run, runState(run, events, running))) console.log(line);
  const campaign = campaignOf(events);
  const called = calledBy(namesOf(events));
  const parent = openingOf(events)?.parent;
  const successor = eventsOf(events, "campaign.ended").at(-1)?.event.data.successor;
  const lineage = [
    ...(parent == null
      ? []
      : [
          row(
            "lineage",
            `from ${parent.campaign} (${parent.kind}) · carried ${dollars(parent.carried.spent)}`,
          ),
        ]),
    ...(isString(successor) ? [row("successor", successor)] : []),
  ];
  const lines = viewLines(name, campaign, Date.now(), called);
  const open = openSteps(campaign.steps);
  const decided = decidedOn(events, values);
  const reads = starterReads(events);
  const climb = epochsOf(events).map((epoch) => `  ${epochLine(epoch, called, reads)}`);
  console.log(
    [
      ...lines.slice(0, 2),
      ...lineage,
      ...lines.slice(2),
      "Climb summary",
      ...climb,
      ...barLines(events).map((bar) => `  ${bar}`),
      open.length === 0
        ? "Recommended next action"
        : `Recommended next action (with ${open.join(", ")} still open)`,
      `  ${decidedLine(decided)}`,
    ].join("\n"),
  );
}

/** Hours within `[from, to)` spent inside Builder `wait` calls. */
export function waitedIn(waits: readonly Call[], from: string, to: string): number {
  const [start, end] = [Date.parse(from), Date.parse(to)];
  let total = 0;
  for (const { at, ms } of waits) {
    const [began, ended] = [Date.parse(at) - (ms ?? 0), Date.parse(at)];
    total += Math.max(0, Math.min(end, ended) - Math.max(start, began));
  }
  return total / HOUR_MS;
}

export const builderWaits = (events: readonly LogEvent[]): Call[] =>
  eventsOf(events, "build.call").flatMap(({ index, event }) => {
    if (event.data.tool !== "wait") return [];
    const call = traced(event, index);
    return call?.part === "call" ? [call] : [];
  });

/** Pool counts and admission blockers after the first `upTo` events. */
export function poolOn(events: readonly LogEvent[], upTo: number) {
  const prefix = events.slice(0, upTo);
  const supply = supplyOf(prefix);
  const codes = refusals(supply, askedOf(planOn(prefix))).map(({ code }) => code);
  const refused = codes.length === 0 ? "none" : codes.join(", ");
  return {
    open: codes.length === 0,
    text: `${String(supply.held)} held out, ${String(supply.released)} released · admission blockers: ${refused}`,
  };
}

/**
 * The first log index at which comparison admission opened, the hours until the first comparison
 * started (or log end), and the share spent in Builder `wait` calls; null if admission never
 * opened.
 */
export function firstComparisonDelay(events: readonly LogEvent[]) {
  const first = eventsOf(events, "comparison.started")[0]?.index ?? -1;
  const end = first === -1 ? events.length : first;
  let [checkerRead, gates, floor] = [false, 0, comparisonFloor(Number(COMPARISON_OPTIONS.level.default))];
  let index = -1;
  for (let at = 0; at < end; at += 1) {
    const event = events[at];
    if (event === undefined) continue;
    const { kind, data } = event;
    if (kind === "checker.read") checkerRead = true;
    else if (kind === "task.gate" && data.outcome !== "refused") gates += 1;
    else if (kind === "campaign.opened") {
      const level = Number(openingOf([event])?.terms.level ?? COMPARISON_OPTIONS.level.default);
      if (Number.isFinite(level) && level > 0) floor = comparisonFloor(level);
    }
    // The pool moves with a task and the terms with the opening or a word.
    if (checkerRead && gates >= floor && /^(task|campaign)\./.test(kind) && poolOn(events, at + 1).open) {
      index = at;
      break;
    }
  }
  if (index === -1) return null;
  const from = events[index]?.at ?? "";
  const to = events[first === -1 ? events.length - 1 : first]?.at ?? from;
  const hours = (Date.parse(to) - Date.parse(from)) / HOUR_MS;
  const summary = `${hours.toFixed(2)} h ${first === -1 ? "to log end (no comparison started)" : "until first comparison started"}, ${waitedIn(builderWaits(events), from, to).toFixed(2)} h inside Builder waits`;
  return { index, summary, hours, long: hours * HOUR_MS >= DELAY_FLAG_MS };
}
