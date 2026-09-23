/**
 * Evidence-bound campaign scorecard, and a read-only one: it writes no controller state and gates
 * no truth, adoption, promotion or claim, which is what the document's own `authority:
 * "diagnostic-only"` says out loud to whoever reads it next. An axis with no evidence behind it is
 * left out of the document altogether and its name goes into `unavailable`, because a rendered
 * zero and a measured zero look identical once the number has been lifted out of the document, and
 * the reader who lifts it has no way to tell which one it was.
 */
import { join } from "../../src/meta/path.ts";
import { ITERATION_FILE } from "../../src/builder/campaign-iterations.ts";
import { countBy } from "../../src/meta/tally.ts";
import { isCandidateSubmit } from "../../src/author/builder-execution.ts";
import { CASE_RECORD_FILE, type OutcomeTally } from "../../src/claim/case-record.ts";
import { compareCodeUnits } from "../../src/meta/stable-json.ts";
import { type BuilderToolsReport, builderToolsReport } from "./builder-tools.ts";
import { type OutcomeReport, outcomeReport } from "./metrics.ts";
import { keyIfDefined, keyIfNotNull, keysIf } from "../../src/meta/optional-key.ts";

const CAMPAIGN_SCORECARD_SCHEMA = "campaign-scorecard/v3";

/** One submitted candidate tree, with enough identity to find the record row that names it. */
interface ParentIdentity {
  commit: string;
  epoch: string;
  /** 1-based submission ordinal inside its authoring session. */
  ordinal: number;
  /** The execution record's write time — the ordering key for "latest". */
  writtenAt: string;
}

/** The candidate trees a campaign produced. Both keys are present; null is "no such submission". */
interface CampaignParents {
  lastCandidate: ParentIdentity | null;
  accepted: ParentIdentity | null;
}

interface CampaignScorecard {
  schema: typeof CAMPAIGN_SCORECARD_SCHEMA;
  campaign: string;
  selector: string;
  authority: "diagnostic-only";
  reach?: {
    controller?: OutcomeReport["controller"];
    /** The candidate trees the Builder actually submitted, by workspace commit. Read from the
     *  execution records rather than from the workspace, so a background write after acceptance
     *  cannot move what these name. */
    parents?: CampaignParents;
    lastAuthoring?: {
      epoch: string;
      ordinal: number;
      outcome: string;
      workspaceCommit: string | null;
    };
    batteries?: Array<OutcomeTally & { runId: string; total: number }>;
  };
  authoringEfficiency?: {
    iterations: number;
    callsBySession: Record<string, number>;
    repeatedFindingHashes: string[];
    reauthoredAcceptedSessions: Record<string, number>;
  };
  runtimeEfficiency?: {
    batteries: Array<{
      runId: string;
      recordedCases: number;
      meanTurns?: number;
      meanToolCalls?: number;
      inputTokens?: { value: number; from: number };
      outputTokens?: { value: number; from: number };
      costUsd?: { value: number; from: number };
    }>;
  };
  learningYield?: {
    /** Submissions inside a Builder turn. `compared` is the denominator: attempts that had a
     *  previous attempt to differ from. The three outcomes partition it. */
    submits: { compared: number; moved: number; stalled: number; unchangedTree: number };
    /** Authoring iterations, compared within an epoch. A new epoch is a new binding, so the last
     *  iteration of one epoch and the first of the next are not the same question. */
    iterations: { compared: number; moved: number };
  };
  evidence: { authoring: string[]; cases?: string };
  unavailable: Array<"learningYield" | "climb" | "intervention">;
}

type AuthoringRow = {
  epoch: string;
  iteration: BuilderToolsReport["epochs"][number]["authoring"]["iterations"][number];
};
type Battery = OutcomeReport["batteries"][string];

/** The one hash both repeat readings compare: the detail-free view where the report derived one
 *  (a diagnosis repeated with reworded detail strings is the same diagnosis), else the exact
 *  hash. Undefined rows — the missing predecessor of a first iteration — read as null. */
function repeatHash(
  row: { findingsHash: string | null; semanticFindingsHash: string | null } | undefined,
): string | null {
  return row === undefined ? null : (row.semanticFindingsHash ?? row.findingsHash);
}

function authoringAxis(
  builder: BuilderToolsReport,
  authoring: readonly AuthoringRow[],
): CampaignScorecard["authoringEfficiency"] {
  if (authoring.length === 0) return undefined;
  const calls = authoring.flatMap(({ iteration }) =>
    iteration.sessions.flatMap((session) => Array.from({ length: session.attempts }, () => session.stage)),
  );
  const repeatedHashes = Object.entries(
    countBy(
      authoring.filter((row) => repeatHash(row.iteration) !== null),
      (row) =>
        /* SAFETY: the filter above kept only iterations whose repeat hash is not null. */ repeatHash(
          row.iteration,
        ) as string,
    ),
  )
    .filter(([, count]) => count > 1)
    .map(([hash]) => hash)
    .sort();
  const reauthored = builder.epochs.flatMap((epoch) =>
    epoch.authoring.iterations
      .slice(1)
      .flatMap((iteration) => iteration.sessions.filter((session) => session.state === "accepted")),
  );
  return {
    iterations: authoring.length,
    callsBySession: countBy(calls, (stage) => stage),
    repeatedFindingHashes: repeatedHashes,
    reauthoredAcceptedSessions: countBy(reauthored, (session) => session.stage),
  };
}

/**
 * Whether successive submissions changed their files or recorded findings.
 *
 * A comparison needs a previous attempt, so the denominator contains attempts with a predecessor
 * rather than every attempt: a campaign that submitted once has no comparison to report here.
 * That absence says nothing about whether it learned. The three submit outcomes
 * partition that denominator by construction, classified in one pass and in this order.
 * `unchangedTree` means the Builder resubmitted a tree it had already submitted. `stalled` means it
 * edited files and reached the same findings. `moved` means submission returned different findings;
 * that change alone establishes neither learning nor an improvement in the product.
 *
 * Run 35 is the case this axis exists to name: 141 submissions, a tree that ended byte-identical to
 * its first guess, and nothing in any evidence that said so. A campaign whose submits are mostly
 * unchangedTree needs investigation of its actions and refusal feedback. This count alone cannot
 * establish domain difficulty or decide whether the repair belongs in the feedback or elsewhere.
 */
function learningYieldAxis(builder: BuilderToolsReport): CampaignScorecard["learningYield"] {
  // A selected execution file that failed the current-shape reader is not an empty session. Do not
  // let the authoring-iteration denominator make a partial report look like a measured yield.
  if (builder.epochs.some((epoch) => (epoch.executionUnavailable?.length ?? 0) > 0)) return undefined;
  // An in-flight row is a checkpoint, not a settled comparison, and `recorded-at-terminal` is that
  // same checkpoint after the controller closed it: the submit rows are real, the aggregates are
  // still a checkpoint's. An evidence-unavailable row says cleanup lost the trustworthy terminal
  // projection. None of the three may contribute its ordinary submit rows to a learning claim.
  if (
    builder.epochs.some((epoch) =>
      epoch.execution.some(
        (execution) =>
          execution.outcome === "in-flight" ||
          execution.outcome === "recorded-at-terminal" ||
          execution.outcome === "evidence-unavailable",
      ),
    )
  ) {
    return undefined;
  }
  let compared = 0;
  let unchangedTree = 0;
  let stalled = 0;
  let moved = 0;
  // An epoch older than the execution evidence states its own absence through an empty list in
  // the census. Counting it as zero here would turn missing evidence into a finished attempt.
  for (const { execution } of builder.epochs) {
    for (const submit of execution.flatMap((session) => session.submits)) {
      if (submit.repeatedFindings === null) continue;
      // A controller terminal is not a Builder answer. A real candidate may itself end the
      // session, however, and remains evidence rather than being blanket-dropped by `terminal`.
      if (submit.kind === "controller-terminal") continue;
      compared += 1;
      // Classify each submission from the tree first. Deriving one row as `repeated - unchangedTree`
      // assumed every unchanged tree repeats its findings. That holds for the deterministic bundle
      // stage but not for gates: probes run in workers and can settle differently over identical
      // bytes, so a single timeout would drive the subtraction negative and the three rows would
      // stop partitioning the denominator at all.
      if (submit.workspaceChanged === false) unchangedTree += 1;
      else if (submit.repeatedFindings) stalled += 1;
      else moved += 1;
    }
  }
  const comparablePairs = builder.epochs
    .flatMap((epoch) =>
      epoch.authoring.iterations
        .slice(1)
        .map((row, index) => [repeatHash(epoch.authoring.iterations[index]), repeatHash(row)]),
    )
    .filter(([before, after]) => before !== null && after !== null);
  // Two empty denominators are the no-evidence case this file omits rather than rendering as zeroes.
  if (compared === 0 && comparablePairs.length === 0) return undefined;
  return {
    submits: { compared, moved, stalled, unchangedTree },
    iterations: {
      compared: comparablePairs.length,
      moved: comparablePairs.filter(([before, after]) => before !== after).length,
    },
  };
}

/**
 * The chronologically newest authoring row, not the last one appended to the flattened list.
 * The flattened list follows `campaignEpochOrder` (creation order), so a re-run that re-selects
 * an EARLIER-created epoch (`selectCampaignEpoch` re-points `current` without moving that epoch's
 * position in the record) writes its newest iteration into a row that still sorts before a later
 * epoch's older one. Run 12x's repair landed in epoch-b2e9851cb76f ordinal 6, chronologically last,
 * while the flattened list still ended on epoch-a5fa6fdc98b6 ordinal 2. Iteration mtimeMs is the
 * available timestamp; a row missing it (an in-memory fixture, never a disk read) falls back to
 * run order against its neighbour, matching the old behaviour exactly when no epoch reordering
 * occurred.
 */
function lastAuthoringRow(authoring: readonly AuthoringRow[]): AuthoringRow | undefined {
  let best: AuthoringRow | undefined;
  for (const row of authoring) {
    const bestTime = best?.iteration.mtimeMs;
    const rowTime = row.iteration.mtimeMs;
    // Either side missing its timestamp leaves run order, which is what the reader did before
    // epochs could reorder the flattened list.
    if (bestTime === undefined || rowTime === undefined || rowTime >= bestTime) best = row;
  }
  return best;
}

/** One candidate submission, flattened out of its record so the two parents share one ordering. */
function submittedParents(builder: BuilderToolsReport): { identity: ParentIdentity; accepted: boolean }[] {
  return (
    builder.epochs
      .flatMap((epoch) => epoch.execution.map((execution) => ({ epoch: epoch.epoch, execution })))
      // A postTerminal record was flushed after another invocation had recorded the campaign: its
      // submit rows are real work, but its late writtenAt would sort it last and hand it the
      // lastCandidate slot (run 25 flushed two records 18 and 28 minutes after their terminals).
      // No controller owned the campaign when the write landed, so it cannot move the lineage.
      .filter(({ execution }) => execution.postTerminal === undefined)
      .sort((left, right) => compareCodeUnits(left.execution.writtenAt, right.execution.writtenAt))
      .flatMap(({ epoch, execution }) =>
        execution.submits.filter(isCandidateSubmit).map((submit) => ({
          identity: { commit: submit.commit, epoch, ordinal: submit.ordinal, writtenAt: execution.writtenAt },
          accepted: submit.outcome === "accepted",
        })),
      )
  );
}

/**
 * The candidate identities the run produced, in the order the records were written.
 *
 * The ordering key is each execution record's own `writtenAt`, not epoch order and not the order
 * the files were appended: tenet 6 requires the latest authoring work to be picked by its recorded
 * time, and run 25 wrote two of its four records after the sessions that precede them in file
 * order. Controller-terminal rows are stops rather than answers, so only candidates are read.
 */
function parentsAxis(builder: BuilderToolsReport): CampaignParents | undefined {
  const rows = submittedParents(builder);
  const last = rows.at(-1);
  if (last === undefined) return undefined;
  const accepted = rows.findLast((row) => row.accepted);
  return { lastCandidate: last.identity, accepted: accepted === undefined ? null : accepted.identity };
}

function reachAxis(
  authoring: readonly AuthoringRow[],
  batteries: readonly Battery[],
  controller: OutcomeReport["controller"] | null,
  parents: CampaignParents | undefined,
): CampaignScorecard["reach"] {
  const last = lastAuthoringRow(authoring);
  if (
    last === undefined &&
    batteries.length === 0 &&
    parents === undefined &&
    (controller === null || controller.state === "absent")
  ) {
    return undefined;
  }
  return {
    ...keyIfDefined("parents", parents),
    ...keyIfNotNull("controller", controller === null || controller.state === "absent" ? null : controller),
    ...keyIfDefined(
      "lastAuthoring",
      last === undefined
        ? undefined
        : {
            epoch: last.epoch,
            ordinal: last.iteration.ordinal,
            outcome: last.iteration.outcome,
            workspaceCommit: last.iteration.workspaceCommit,
          },
    ),
    ...keysIf(batteries.length > 0, () => ({
      batteries: batteries.map((battery) => ({
        runId: battery.runId,
        total: battery.cases.total,
        verified: battery.cases.verified,
        passed: battery.cases.passed,
        failed: battery.cases.failed,
        unaccepted: battery.cases.unaccepted,
        nonResults: battery.cases.nonResults.total,
      })),
    })),
  };
}

function runtimeAxis(batteries: readonly Battery[]): CampaignScorecard["runtimeEfficiency"] {
  if (batteries.length === 0) return undefined;
  return {
    batteries: batteries.map((battery) => ({
      runId: battery.runId,
      recordedCases: battery.telemetry.recorded,
      ...keyIfNotNull("meanTurns", battery.telemetry.meanTurns),
      ...keyIfNotNull("meanToolCalls", battery.telemetry.meanToolCalls),
      ...keyIfNotNull("inputTokens", battery.telemetry.inputTokens),
      ...keyIfNotNull("outputTokens", battery.telemetry.outputTokens),
      ...keyIfNotNull("costUsd", battery.telemetry.costUsd),
    })),
  };
}

/** Pure composition function: tests can prove omission and denominator behaviour without fixtures. */
export function scorecardFromReports(
  builder: BuilderToolsReport,
  outcome: OutcomeReport | null,
  selector: string,
): CampaignScorecard {
  const authoring = builder.epochs.flatMap((epoch) =>
    epoch.authoring.iterations.map((iteration) => ({ epoch: epoch.epoch, iteration })),
  );
  const batteries = outcome === null ? [] : Object.values(outcome.batteries);
  const reach = reachAxis(authoring, batteries, outcome?.controller ?? null, parentsAxis(builder));
  const efficiency = authoringAxis(builder, authoring);
  const runtime = runtimeAxis(batteries);
  const learning = learningYieldAxis(builder);
  return {
    schema: CAMPAIGN_SCORECARD_SCHEMA,
    campaign: builder.campaign,
    selector,
    authority: "diagnostic-only",
    ...keyIfDefined("reach", reach),
    ...keyIfDefined("authoringEfficiency", efficiency),
    ...keyIfDefined("runtimeEfficiency", runtime),
    ...keyIfDefined("learningYield", learning),
    evidence: {
      authoring: authoring.map(({ epoch, iteration }) => join(epoch, iteration.dir, ITERATION_FILE)),
      ...keysIf(outcome?.caseRecord === "present", () => ({ cases: CASE_RECORD_FILE })),
    },
    // Named rather than rendered as a plausible zero, and named only while the evidence are
    // genuinely absent: learningYield left this list once builder-execution.json existed to fill it.
    unavailable: [...(learning === undefined ? (["learningYield"] as const) : []), "climb", "intervention"],
  };
}

export function campaignScorecard(
  campaignDir: string,
  selector: string,
  bundleDir: string | null,
): CampaignScorecard {
  return scorecardFromReports(
    builderToolsReport(campaignDir),
    outcomeReport(campaignDir, selector, bundleDir),
    selector,
  );
}
