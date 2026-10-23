/**
 * One campaign's reading: its row in the list, and the whole of what the Campaign pane draws.
 *
 * Every number is a fold's, or computed from one (`folds.ts`): the steps, the supply and the two
 * harnesses are `campaignOf`'s, the next move is the decision table's asked as `bun run runs view`
 * asks it (`decidedOn`, `tools/runs/view.ts`), so that the page and the view name one move on one
 * log by construction.
 *
 * A campaign's project is the one its opening names (`Opening.project`, `--project` on the campaign
 * command since 12 October). An opening written before then names none, and a campaign run by the
 * hand commands alone has no opening: both stand under `NO_PROJECT`, and no project is guessed for
 * them from a prompt or a name.
 *
 * The reason of a campaign that ended on its environment: it is the
 * error that ended it (`errorMessage`, `tools/d2/harness-builder.ts`), free text that may quote
 * whatever the failing step saw, where every other ending's reason is worded by the controller or
 * is the operator's own word. The next move is held to the same rule (`reasonSaid`): the table's
 * environment ending quotes the last crashed session's error (`decide.ts`), and it names that
 * ending before the campaign has logged it.
 *
 * An A/A control reads a step, for the counter, as the whole-run reader reads one: where either
 * side's test clears the level (`readsStepEitherWay`, `compare.ts`; `tools/wri/read.ts`, "REFERENCE
 * AGAINST ITSELF"), since a step either way between two samples of one harness is a false one. The
 * report's own `p` is one-sided.
 */
import { type Decided, decidedLine, type Ending } from "../../../../src/campaign/move.ts";
import { barsOf } from "../../../../src/campaign/climb.ts";
import { openSteps } from "../../../../src/campaign/handover.ts";
import { reported } from "../../../../src/campaign/comparison.ts";
import { namesOf } from "../../../../src/campaign/names.ts";
import { readsStepEitherWay } from "../../../../src/kernel/compare.ts";
import { patienceOf } from "../../../../src/kernel/reports.ts";
import { billedAll, billedParts } from "../../../../src/kernel/trace.ts";
import { isString } from "../../../../src/meta/json-shape.ts";
import { keyIfDefined } from "../../../../src/meta/optional-key.ts";
import { errorMessage } from "../../../../src/meta/runtime-values.ts";
import { recordedSetting } from "../../../../tools/d2/setting.ts";
import { decidedOn } from "../../../../tools/runs/view.ts";
import {
  type CampaignReading,
  type CampaignRow,
  type Counters,
  type Issue,
  type NextMove,
  NO_PROJECT,
  type Tier,
} from "../models.ts";
import { campaignIn, epochsIn, type Log, once, openingIn, reportsIn, stopIn } from "./folds.ts";
import { harnessesIn, promotionsIn, spendIn } from "./lineage.ts";
import { type Found, type Process, sourceOf } from "./logs.ts";
import { barsIn, movesIn, starterIn } from "./moves.ts";
import { examTier } from "./trace.ts";
import { unsettledCount } from "./withheld.ts";

const ENDINGS = [
  "budget",
  "stop",
  "exam",
  "no-room",
  "environment",
  "operator",
  "control",
  "finished",
] as const satisfies readonly Ending[];
/** The endings whose reason the controller words itself, or the operator gives: every one but an
 *  environment's. */
const WORDED: ReadonlySet<Ending> = new Set([
  "budget",
  "stop",
  "exam",
  "no-room",
  "operator",
  "control",
  "finished",
]);
/** What the default tier is sent of an environment ending's reason in a next move, whose type
 *  holds a reason for every move. */
const ENVIRONMENT_WITHHELD = "withheld in the default tier: it quotes the error that ended a session";

/** Whether `tier` is sent the reason of `ending`: every ending's in the exam tier, and in the
 *  default tier those the controller words itself (`WORDED`). */
const reasonSaid = (ending: Ending, tier: Tier): boolean => examTier(tier) || WORDED.has(ending);

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
    project: opening?.project ?? NO_PROJECT,
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
  const { project, ending, ...facts } = factsIn(log);
  const status = ending === null ? "open" : "ended";
  const said = ending !== null && reasonSaid(ending.ending, tier);
  return {
    key: found.key,
    name: found.name,
    tree: found.label,
    project,
    status: process === "open" ? "running" : status,
    ending:
      ending === null
        ? null
        : { ending: ending.ending, ...keyIfDefined("why", said ? ending.why : undefined) },
    ...facts,
  };
}

/** The table's next move as the view asks for it, or why it could not be asked. */
const nextIn = once((log) => {
  try {
    return { decided: decidedOn(log.events), issue: null };
  } catch (error) {
    return { decided: null, issue: `the decision table could not be asked: ${errorMessage(error)}` };
  }
});

/** The next move as `tier` is sent it, its line built from the reason the tier may see. */
function nextShown(decided: Decided, tier: Tier): NextMove {
  const shown =
    decided.move === "end" && !reasonSaid(decided.ending, tier)
      ? { ...decided, why: ENVIRONMENT_WITHHELD }
      : decided;
  return { ...shown, line: decidedLine(shown) };
}

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

/** What the promotion attempts under the current reference risk together (`falsePromotion`,
 *  `climb.ts`). Until 16 October the table held the next attempt past a quarter of it. */
function riskIn(log: Log): Counters["risk"] {
  const epoch = epochsIn(log).at(-1);
  if (epoch === undefined) return null;
  const { attempts, union, bound, controls, incapable, errors } = epoch.falsePromotion;
  return { attempts, union, bound, controls, incapable, errors };
}

/** What is left of the campaign's total, and what the last comparison the cap did not cut billed. */
function runwayIn(log: Log): Counters["runway"] {
  const budget = openingIn(log)?.budget?.dollars;
  const last = reportsIn(log).findLast(({ data }) => data.capped !== true);
  if (budget === undefined || last === undefined) return null;
  const each = billedParts(log.events, last.session).comparison;
  return { left: budget - billedAll(log.events), each, comparison: last.session };
}

/** Everything of the reading that the tier does not change. */
const coreIn = once((log) => {
  const campaign = campaignIn(log);
  const bars = barsIn(log);
  const { sinceStep } = stopIn(log);
  return {
    prompt: openingIn(log)?.prompt ?? null,
    terms: openingIn(log)?.terms ?? {},
    attended: openingIn(log)?.attended ?? false,
    led: openingIn(log)?.led ?? false,
    bars: barsOf(log.events),
    supply: campaign.supply,
    reference: campaign.reference,
    starter: starterIn(log),
    names: Object.fromEntries(namesOf(log.events)),
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
      risk: riskIn(log),
      runway: runwayIn(log),
    },
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
  const { decided, issue } = nextIn(log);
  const solver = solverIn(log);
  const opening = openingIn(log);
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
    nextMove: decided === null ? null : nextShown(decided, tier),
  };
}
