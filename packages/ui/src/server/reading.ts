/**
 * One campaign's reading: its row in the list, and the whole of what the Campaign pane draws.
 *
 * Every number is a fold's, or computed from one (`folds.ts`): the steps, the supply and the two
 * harnesses are `campaignOf`'s, the next move is the decision table's asked as `bun run runs view`
 * asks it (`decidedOn`, `tools/runs/view.ts`), so that the page and the view name one move on one
 * log by construction, and the reader's rows and triggers are `overview`'s.
 *
 * v2 records no project, so it is read: the opening's prompt, else the campaign's name. A campaign
 * over a stored pack names its pack on its commands' flags (`--sweep`, `--cycle`, `--bundle`) and
 * in no event: `campaign.opened` keeps neither prompt nor pack for one (`opened`,
 * `tools/d2/harness-builder.ts`), and the receipt beside the log that holds the flags is no event.
 *
 * The reader's triggers of lanes 1 to 12, the exam side's (`triggerShown`), are withheld in the
 * default tier, and the reading says how many: an expected absence and no issue, which is kept for
 * what could not be read. So is the reason of a campaign that ended on its environment: it is the
 * error that ended it (`errorMessage`, `tools/d2/harness-builder.ts`), free text that may quote
 * whatever the failing step saw, where every other ending's reason is worded by the controller or
 * is the operator's own word.
 *
 * An A/A control reads a step, for the counter, as the whole-run reader reads one: where either
 * side's test clears the level (`readsStepEitherWay`, `compare.ts`; `tools/wri/read.ts`, "REFERENCE
 * AGAINST ITSELF"), since a step either way between two samples of one harness is a false one. The
 * report's own `p` is one-sided.
 */
import { decidedLine, type Ending } from "../../../../src/builder/move.ts";
import { regressionOf } from "../../../../src/builder/climb.ts";
import { openSteps } from "../../../../src/builder/handover.ts";
import { reported } from "../../../../src/builder/comparison.ts";
import { readsStepEitherWay } from "../../../../src/kernel/compare.ts";
import { billedAll, patienceOf } from "../../../../src/kernel/reports.ts";
import { isString } from "../../../../src/meta/json-shape.ts";
import { keyIfDefined } from "../../../../src/meta/optional-key.ts";
import { errorMessage } from "../../../../src/meta/runtime-values.ts";
import { recordedSetting } from "../../../../tools/d2/setting.ts";
import { decidedOn } from "../../../../tools/runs/view.ts";
import type { CampaignReading, CampaignRow, Issue, NextMove, Tier } from "../models.ts";
import { campaignIn, type Log, once, openingIn, overviewIn, reportsIn, stopIn } from "./folds.ts";
import { harnessesIn, promotionsIn, spendIn } from "./lineage.ts";
import { type Found, type Process, sourceOf } from "./logs.ts";
import { barsIn, movesIn, starterIn } from "./moves.ts";
import { examTier, triggerShown } from "./trace.ts";
import { triggerKeepsRulings, unsettledCount } from "./withheld.ts";

const ENDINGS = [
  "budget",
  "stop",
  "exam",
  "no-room",
  "environment",
  "operator",
] as const satisfies readonly Ending[];
/** The endings whose reason the controller words itself, or the operator gives: every one but an
 *  environment's. */
const WORDED: ReadonlySet<Ending> = new Set(["budget", "stop", "exam", "no-room", "operator"]);

/** How a campaign ended, where its last event is its ending: one before the last event is an
 *  ending the campaign went on from. Read from `campaign.ended`, which no fold reads. */
function endingOf(log: Log): { readonly ending: Ending; readonly why: string } | null {
  const last = log.events.at(-1);
  if (last?.kind !== "campaign.ended") return null;
  const ending = ENDINGS.find((each) => each === last.data.ending);
  if (ending === undefined) return null;
  return { ending, why: isString(last.data.why) ? last.data.why : "" };
}

/** What a campaign's row holds of its log alone, kept with the log: the list is polled every few
 *  seconds, and most logs have not moved since the last poll. */
const factsIn = once((log) => {
  const { events } = log;
  const opening = openingIn(log);
  const last = reportsIn(log).at(-1);
  const report = last === undefined ? null : reported(events, last.session);
  return {
    prompt: opening?.prompt ?? null,
    ending: endingOf(log),
    lastEventAt: events.at(-1)?.at ?? null,
    lastReading:
      last === undefined || report === null
        ? null
        : {
            id: last.session,
            reading: report.reading,
            tally:
              report.scored === null
                ? null
                : { wins: report.scored.wins, losses: report.scored.losses, ties: report.scored.ties },
          },
    billed: billedAll(events),
    budget: opening?.budget?.dollars ?? null,
  };
});

/** A campaign's row in the list, in `tier`, with `process` as the processes on the host say:
 *  `open` while one writes its log. */
export function campaignRow(
  found: Found,
  log: Log,
  { process, tier }: { readonly process: Process | null; readonly tier: Tier },
): CampaignRow {
  const { prompt, ending, ...facts } = factsIn(log);
  const status = ending === null ? "open" : "ended";
  const said = ending !== null && (examTier(tier) || WORDED.has(ending.ending));
  return {
    key: found.key,
    name: found.name,
    tree: found.label,
    project: prompt ?? found.name,
    status: process === "open" ? "running" : status,
    ending:
      ending === null
        ? null
        : { ending: ending.ending, ...keyIfDefined("why", said ? ending.why : undefined) },
    ...facts,
    seed: found.seed === true,
  };
}

/** The table's next move as the view asks for it, or why it could not be asked. */
const nextIn = once((log) => {
  try {
    const decided = decidedOn(log.events);
    const next: NextMove = { ...decided, line: decidedLine(decided) };
    return { next, issue: null };
  } catch (error) {
    return { next: null, issue: `the decision table could not be asked: ${errorMessage(error)}` };
  }
});

/** Who solves: the setting's solver (`recordedSetting`), else the opening's; and why the setting
 *  could not be read, where it could not. */
const solverIn = once((log) => {
  try {
    return { solver: recordedSetting(log.events)?.solver ?? openingIn(log)?.solver ?? null, issue: null };
  } catch (error) {
    return {
      solver: openingIn(log)?.solver ?? null,
      issue: `the setting does not read: ${errorMessage(error)}`,
    };
  }
});

/** Everything of the reading that the tier does not change. */
const coreIn = once((log) => {
  const campaign = campaignIn(log);
  const bars = barsIn(log);
  const { sinceStep } = stopIn(log);
  return {
    terms: openingIn(log)?.terms ?? {},
    attended: openingIn(log)?.attended ?? false,
    supply: campaign.supply,
    reference: campaign.reference,
    starter: starterIn(log),
    open: openSteps(campaign.steps),
    moves: movesIn(log),
    comparisons: bars,
    promotions: promotionsIn(log),
    harnesses: harnessesIn(log),
    spend: spendIn(log),
    counters: {
      withoutGain: sinceStep,
      patience: patienceOf(log.events),
      labels: { tasks: campaign.supply.awaiting, rejections: unsettledCount(log) },
      controls: bars.filter((bar) => bar.noise !== null).length,
      controlSteps: bars.filter(
        ({ noise, level }) => noise !== null && readsStepEitherWay(noise.differences, level),
      ).length,
    },
    regression: regressionOf(log.events),
  };
});

/** The whole reading of a campaign, in `tier`, with `row` as the list has it. */
export function campaignReading(
  found: Found,
  log: Log,
  {
    row,
    tier,
    issues,
  }: { readonly row: CampaignRow; readonly tier: Tier; readonly issues: readonly Issue[] },
): CampaignReading {
  const source = sourceOf(found);
  const { next, issue } = nextIn(log);
  const solver = solverIn(log);
  const opening = openingIn(log);
  const reader = overviewIn(log);
  const shown = reader.triggers.filter(
    (trigger) => triggerShown(trigger, tier) && triggerKeepsRulings(log, trigger),
  );
  const said: Issue[] = [
    ...issues,
    ...[issue, solver.issue].flatMap((message): Issue[] =>
      message === null ? [] : [{ level: "warning", source, message }],
    ),
  ];
  return {
    tier,
    issues: said,
    row,
    ...coreIn(log),
    seats: {
      builder: opening?.seats.builder ?? null,
      examiner: opening?.seats.examiner ?? null,
      reviewer: opening?.seats.reviewer ?? null,
      solver: solver.solver,
    },
    nextMove: next,
    reader: {
      rows: reader.rows,
      triggers: shown,
      withheld: reader.triggers.filter((trigger) => !triggerShown(trigger, tier)).length,
    },
  };
}
