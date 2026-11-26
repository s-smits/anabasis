/**
 * One campaign's reading: its row in the list, and the whole of what the Campaign pane draws. Every
 * number is a fold's or computed from one (`folds.ts`), and the next move is the decision table's
 * asked as `bun run runs view` asks it (`decidedOn`), so the page and the view name one move on one
 * log. A campaign with no opening project stands under `NO_PROJECT`, never guessed from a prompt or
 * a name. An environment ending's reason is the error that ended the campaign and may quote
 * whatever the failing step saw, so the default tier is not sent it, in a row or a next move
 * (`reasonSaid`). An A/A control reads a step, for the counter, where its one-sided test clears
 * the level (`isSignificant`), as `climb.ts` and the release bar read one.
 */
import { type ScheduledAction, decidedLine, type Ending } from "../../../../src/campaign/move.ts";
import { openSteps } from "../../../../src/campaign/summary.ts";
import { reported } from "../../../../src/campaign/comparison.ts";
import { namesOf } from "../../../../src/campaign/names.ts";
import { budgetLeft } from "../../../../src/campaign/opening.ts";
import { isSignificant } from "../../../../src/kernel/compare.ts";
import { endedOf, patienceOf } from "../../../../src/kernel/reports.ts";
import { billedAll, billedParts } from "../../../../src/kernel/meter.ts";
import { keyIfDefined } from "../../../../src/meta/optional-key.ts";
import { errorMessage } from "../../../../src/meta/runtime-values.ts";
import { recordedSetting } from "../../../../tools/campaign/setting.ts";
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
import { campaignIn, doubtedIn, epochsIn, type Log, once, openingIn, reportsIn, stopIn } from "./folds.ts";
import { harnessesIn, promotionsIn, spendIn } from "./lineage.ts";
import { type Found, type Process, sourceOf } from "./logs.ts";
import { barsIn, movesIn, starterIn, steppedOf } from "./moves.ts";
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
/** What the default tier is sent of an environment ending's reason in a next move, whose type holds
 *  a reason for every move. */
const ENVIRONMENT_WITHHELD = "withheld in the default tier: it quotes the error that ended a session";

const reasonSaid = (ending: Ending, tier: Tier): boolean => examTier(tier) || WORDED.has(ending);

function endingOf(log: Log): { readonly ending: Ending; readonly why: string } | null {
  const ended = endedOf(log.events);
  const ending = ENDINGS.find((each) => each === ended?.ending);
  return ended === null || ending === undefined ? null : { ending, why: ended.why };
}

/** What a campaign's row holds of its log alone, kept with the log and by the list in its place
 *  (`campaigns.ts`), since most logs have not moved since the last poll. */
export const factsIn = once((log) => {
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
            tally: report.scored === null ? null : steppedOf(report.scored).tally,
          },
    billed: billedAll(events),
    budget: opening?.budget?.dollars ?? null,
    opened: events[0]?.at ?? "",
  };
});

export function campaignRow(
  found: Found,
  { project, ending, opened: _opened, ...facts }: ReturnType<typeof factsIn>,
  { process, tier }: { readonly process: Process | null; readonly tier: Tier },
): CampaignRow {
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

const nextIn = once((log) => {
  try {
    return { decided: decidedOn(log.events), issue: null };
  } catch (error) {
    return { decided: null, issue: `the decision table could not be asked: ${errorMessage(error)}` };
  }
});

function nextShown(decided: ScheduledAction, tier: Tier): NextMove {
  const shown =
    decided.move === "end" && !reasonSaid(decided.ending, tier)
      ? { ...decided, why: ENVIRONMENT_WITHHELD }
      : decided;
  return { ...shown, line: decidedLine(shown) };
}

/** Who solves (the setting's solver, `recordedSetting`, else the opening's), the tasks a comparison
 *  scores, which only the setting records, and why the setting could not be read, where it could
 *  not. */
const solverIn = once((log) => {
  try {
    const setting = recordedSetting(log.events);
    return {
      solver: setting?.solver ?? openingIn(log)?.solver ?? null,
      target: setting?.target ?? null,
      issue: null,
    };
  } catch (error) {
    return {
      solver: openingIn(log)?.solver ?? null,
      target: null,
      issue: `the setting does not read: ${errorMessage(error)}`,
    };
  }
});

function runwayIn(log: Log): Counters["runway"] {
  const left = budgetLeft(log.events);
  const last = reportsIn(log).findLast(({ data }) => data.capped !== true);
  if (left === null || last === undefined) return null;
  const each = billedParts(log.events, last.session).comparison;
  return { left: left.dollars, each, comparison: last.session };
}

const coreIn = once((log) => {
  const campaign = campaignIn(log);
  const bars = barsIn(log);
  const { sinceStep } = stopIn(log);
  return {
    prompt: openingIn(log)?.prompt ?? null,
    terms: openingIn(log)?.terms ?? {},
    attended: openingIn(log)?.attended ?? false,
    supply: { ...campaign.supply, doubted: doubtedIn(log).size },
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
      controlSteps: bars.filter(({ noise, level }) => noise !== null && isSignificant(noise.scores, level))
        .length,
      risk: epochsIn(log).at(-1)?.falsePromotion ?? null,
      runway: runwayIn(log),
    },
  };
});

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
    target: solver.target,
    nextMove: decided === null ? null : nextShown(decided, tier),
  };
}
