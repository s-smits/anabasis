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
  type CampaignList,
  type CampaignReading,
  type CampaignRow,
  type Counters,
  type Issue,
  type NextMove,
  NO_PROJECT,
  type Query,
  type Tier,
} from "../models.ts";
import type { Reading } from "./context.ts";
import { campaignIn, doubtedIn, epochsIn, type Log, once, openingIn, reportsIn, stopIn } from "./folds.ts";
import { harnessesIn, promotionsIn, spendIn } from "./lineage.ts";
import {
  campaignAt,
  campaignsFound,
  type Found,
  loaded,
  type Process,
  sourceOf,
  stampOf,
  writing,
} from "./logs.ts";
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
  "revise",
] as const satisfies readonly Ending[];
const WORDED: ReadonlySet<Ending> = new Set([
  "budget",
  "stop",
  "exam",
  "no-room",
  "operator",
  "control",
  "finished",
]);
const ENVIRONMENT_WITHHELD = "withheld in the default tier: it quotes the error that ended a session";
const REVISE_WITHHELD = "withheld in the default tier: exam revision detail is on the exam side";

const reasonSaid = (ending: Ending, tier: Tier): boolean => examTier(tier) || WORDED.has(ending);

function endingOf(log: Log): { readonly ending: Ending; readonly why: string } | null {
  const ended = endedOf(log.events);
  const ending = ENDINGS.find((each) => each === ended?.ending);
  return ended === null || ending === undefined ? null : { ending, why: ended.why };
}

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
      ? { ...decided, why: decided.ending === "revise" ? REVISE_WITHHELD : ENVIRONMENT_WITHHELD }
      : decided;
  return { ...shown, line: decidedLine(shown) };
}

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

interface Listed {
  readonly stamp: string | null;
  readonly facts: ReturnType<typeof factsIn> | null;
  readonly issues: readonly Issue[];
}

const listed = new Map<string, Listed>();

function factsOf(found: Found): { readonly read: boolean; readonly listing: Listed } {
  const stamp = stampOf(found);
  const was = listed.get(found.path);
  if (was !== undefined && stamp !== null && was.stamp === stamp) return { read: false, listing: was };
  const { log, issues } = loaded(found, "list");
  let listing: Listed;
  try {
    listing = { stamp, facts: log === null ? null : factsIn(log), issues };
  } catch (error) {
    listing = {
      stamp,
      facts: null,
      issues: [{ level: "error", source: sourceOf(found), message: errorMessage(error) }],
    };
  }
  listed.set(found.path, listing);
  return { read: true, listing };
}

export async function readAll(reading: Pick<Reading, "repo" | "trees" | "now">): Promise<void> {
  for (const each of campaignsFound(reading).found) {
    if (factsOf(each).read) await Bun.sleep(0);
  }
}

export function campaignsAnswer(reading: Reading, _query: Query<"campaigns">): CampaignList {
  const { found, issues: looked } = campaignsFound(reading);
  const paths = new Set(found.map(({ path }) => path));
  for (const path of listed.keys()) if (!paths.has(path)) listed.delete(path);
  const issues: Issue[] = [...looked];
  let unlisted = false;
  const rows = found.flatMap((each): { readonly row: CampaignRow; readonly opened: string }[] => {
    const { facts, issues: read } = factsOf(each).listing;
    issues.push(...read);
    if (facts === null) return [];
    const process = writing(each);
    unlisted ||= process === null;
    return [{ row: campaignRow(each, facts, { process, tier: reading.tier }), opened: facts.opened }];
  });
  if (unlisted) {
    issues.push({
      level: "warning",
      source: "ps, lsof",
      message: "the host's processes could not be listed, so no campaign reads as running",
    });
  }
  return {
    tier: reading.tier,
    issues,
    campaigns: rows.toSorted((one, other) => other.opened.localeCompare(one.opened)).map(({ row }) => row),
  };
}

export function campaignAnswer(reading: Reading, query: Query<"campaign">): CampaignReading {
  const { found, log, issues } = campaignAt(reading, query.key);
  const row = campaignRow(found, factsIn(log), { process: writing(found), tier: reading.tier });
  return campaignReading(found, log, { row, tier: reading.tier, issues });
}
