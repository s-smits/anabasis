/**
 * Combine four separately recorded streams into one read-only report: the Builder's own aggregate
 * tool counts, its per-call receipts, its submit attempts and the verifier workshop's action log.
 * Nothing here decides anything — it says what each stream recorded and where two of them
 * disagree. Consecutive receipts can have native calls or model text between them.
 */
import { keyIfDefined } from "../../src/meta/optional-key.ts";
import { basename } from "../../src/meta/path.ts";
import {
  type BuilderCustomToolCall,
  type BuilderExecutionEvidence,
  type BuilderSubmitAttempt,
  type BuilderSubmitCounts,
  submitProjection,
} from "../../src/author/builder-execution.ts";
import { bareBuilderToolName, builderCustomToolCensus, builderToolsReport } from "./builder-tools.ts";
import {
  actionLabel,
  canonicalTool,
  selectedEpochs,
  workshopJourney,
  type CampaignSelection,
  type WorkshopJourneyJoin,
} from "./builder-tool-workshop-journey.ts";

export type { WorkshopJourneyJoin } from "./builder-tool-workshop-journey.ts";

const BUILDER_TOOL_JOURNEYS_SCHEMA = "builder-tool-journeys/v2";

type CountMap = Record<string, number>;
const PHASES = [
  "no-submit",
  "before-first-submit",
  "submit",
  "between-submits",
  "after-last-submit",
] as const;
type Phase = (typeof PHASES)[number];
const DISPATCH_OUTCOMES = ["returned", "threw", "in-flight"] as const;

interface SubmitMoment {
  ordinal: number;
  /** Session turn shared by the dispatch receipt and controller attempt. */
  turn: number;
  /** `joined` only when this turn carries exactly one receipt and one attempt. */
  join: SubmitJoin;
  receiptSequence: number | null;
  dispatchOutcome: BuilderCustomToolCall["dispatchOutcome"] | null;
  /** Candidate or controller terminal; absent on old execution records. */
  kind?: BuilderSubmitAttempt["kind"];
  outcome: BuilderSubmitAttempt["outcome"] | null;
  stage: BuilderSubmitAttempt["stage"] | null;
  findingCount: number | null;
  findingCodes: string[];
  findingsDelta: BuilderSubmitAttempt["findingsDelta"] | null;
  workspaceChanged: boolean | null;
  before: string[];
  after: string[];
}

interface SessionJourney {
  epoch: string;
  session: number;
  backend: BuilderExecutionEvidence["backend"];
  outcome: BuilderExecutionEvidence["outcome"];
  aggregateCustomCalls: number;
  nativeCallsOutsideJourney: number;
  receiptCalls: number;
  receiptCallsOmitted: number;
  /** Aggregate minus known receipts; negative is retained as evidence contradiction. */
  aggregateMinusKnownReceipts: number;
  timeline: Array<{ action: string; count: number; firstSequence: number; lastSequence: number }>;
  submitMoments: SubmitMoment[];
  submitCounts: BuilderSubmitCounts;
}

interface CampaignJourney {
  campaign: string;
  label: string;
  selection: { epoch: string | null; writtenBefore: string | null };
  sessions: number;
  aggregateCustomCalls: number | null;
  observedCustomCalls: number | null;
  receiptCalls: number;
  receiptCallsOmitted: number;
  aggregateMinusKnownReceipts: number | null;
  /** Per-campaign rows keep a global failure rate from hiding which run produced it. */
  tools: ToolJourneyCensus[];
  workshopJoins: WorkshopJourneyJoin[];
  journeys: SessionJourney[];
  submitCounts: BuilderSubmitCounts;
  /** Recognised execution files that could not be read safely. */
  executionUnavailable: string[];
}

interface ToolJourneyCensus {
  tool: string;
  rawNames: string[];
  campaignsCalled: number;
  aggregateCalls: number;
  receiptCalls: number;
  /** Sum of per-session max(aggregate, receipts); a lower bound when receipts were omitted. */
  observedCalls: number;
  sessionsCalled: number;
  sessionsExposed: number;
  sessionsExposureUnknown: number;
  aggregateDispatchFailures: number;
  dispatchOutcomes: Record<BuilderCustomToolCall["dispatchOutcome"], number>;
  phases: Record<Phase, number>;
  semantic: {
    source: SemanticSource;
    observations: number | null;
    successes: number | null;
    failures: number | null;
    nonResults: number | null;
    byOutcome: CountMap;
    byReason: CountMap;
    byFindingCode: CountMap;
  };
}

interface BuilderToolJourneysReport {
  schema: typeof BUILDER_TOOL_JOURNEYS_SCHEMA;
  authority: "diagnostic-only";
  boundary: { adjacency: string; dispatch: string; intent: string };
  campaigns: CampaignJourney[];
  tools: ToolJourneyCensus[];
}

type SemanticSource = "submit-attempts" | "workshop-actions" | "tool-receipts" | "not-recorded";

/**
 * Which recorded stream owns a tool's outcomes. A receipt's own semantic is folded only for a
 * tool absent from this table, so submit attempts and the workshop log stay authoritative for
 * theirs even when a receipt carries an outcome of its own.
 */
const SEMANTIC_OWNER = new Map<string, SemanticSource>([
  ["submit", "submit-attempts"],
  ["verifier_workshop", "workshop-actions"],
  ["public_source", "workshop-actions"],
]);

/** The scalars a census row carries, listed once so one loop initialises, merges and reads them. */
const TALLY_KEYS = [
  "aggregateCalls",
  "receiptCalls",
  "observedCalls",
  "sessionsCalled",
  "sessionsExposed",
  "sessionsExposureUnknown",
  "aggregateDispatchFailures",
] as const;

const SEMANTIC_COUNTS = ["observations", "successes", "failures", "nonResults"] as const;
type SemanticCount = (typeof SEMANTIC_COUNTS)[number];

interface SemanticTally {
  source: SemanticSource;
  counts: Record<SemanticCount, number | null>;
  byOutcome: CountMap;
  byReason: CountMap;
  byFindingCode: CountMap;
}

interface ToolTally extends Omit<ToolJourneyCensus, "rawNames" | "campaignsCalled" | "semantic"> {
  rawNames: Set<string>;
  campaigns: Set<string>;
  semantic: SemanticTally;
}

type Tallies = Map<string, ToolTally>;

interface SubmitPair {
  receipt?: BuilderCustomToolCall;
  attempt?: BuilderSubmitAttempt;
}

/** A receipt the controller recorded no attempt for. */
const UNATTEMPTED: Pick<
  SubmitMoment,
  "outcome" | "stage" | "findingCount" | "findingsDelta" | "workspaceChanged"
> = { outcome: null, stage: null, findingCount: null, findingsDelta: null, workspaceChanged: null };

/** The same two words the workshop journey reader uses for the same question. */
type SubmitJoin = "joined" | "ambiguous";

interface SubmitPairGroup {
  join: SubmitJoin;
  pairs: SubmitPair[];
}

function emptyTally(tool: string): ToolTally {
  // Submit attempts are the one owning stream a session writes whenever it used the tool, so a
  // submit row names its source and counts from zero. Every other source stays unknown until its
  // own stream supplies an observation: a workshop tool with no action log recorded nothing.
  const counted = SEMANTIC_OWNER.get(tool) === "submit-attempts";
  const start = counted ? 0 : null;
  return {
    tool,
    rawNames: new Set(),
    campaigns: new Set(),
    aggregateCalls: 0,
    receiptCalls: 0,
    observedCalls: 0,
    sessionsCalled: 0,
    sessionsExposed: 0,
    sessionsExposureUnknown: 0,
    aggregateDispatchFailures: 0,
    dispatchOutcomes: { returned: 0, threw: 0, "in-flight": 0 },
    phases: {
      "no-submit": 0,
      "before-first-submit": 0,
      submit: 0,
      "between-submits": 0,
      "after-last-submit": 0,
    },
    semantic: {
      source: counted ? "submit-attempts" : "not-recorded",
      counts: { observations: start, successes: start, failures: start, nonResults: start },
      byOutcome: {},
      byReason: {},
      byFindingCode: {},
    },
  };
}

/** The tally for a tool, by the canonical name; raw names are kept beside it. */
function tallyFor(tallies: Tallies, rawName: string): ToolTally {
  const tool = canonicalTool(rawName);
  const existing = tallies.get(tool);
  if (existing !== undefined) return existing;
  const fresh = emptyTally(tool);
  tallies.set(tool, fresh);
  return fresh;
}

function bump(counts: CountMap, key: string, count = 1): void {
  if (count === 0) return;
  counts[key] = (counts[key] ?? 0) + count;
}

function bumpSemantic(semantic: SemanticTally, key: SemanticCount, count = 1): void {
  semantic.counts[key] = (semantic.counts[key] ?? 0) + count;
}

function mergeCounts(target: CountMap, source: CountMap): void {
  for (const [key, count] of Object.entries(source)) bump(target, key, count);
}

function orderedCounts(counts: CountMap): CountMap {
  return Object.fromEntries(
    Object.entries(counts).sort(
      ([leftName, left], [rightName, right]) => right - left || leftName.localeCompare(rightName),
    ),
  );
}

/** Add one scope's tallies into another. The campaign folds its sessions this way; the report
 *  folds its campaigns the same way, so a cross-campaign row is its campaign rows summed. */
function mergeInto(target: Tallies, source: Tallies): void {
  for (const row of source.values()) {
    const into = tallyFor(target, row.tool);
    for (const rawName of row.rawNames) into.rawNames.add(rawName);
    for (const campaign of row.campaigns) into.campaigns.add(campaign);
    for (const key of TALLY_KEYS) into[key] += row[key];
    for (const outcome of DISPATCH_OUTCOMES) into.dispatchOutcomes[outcome] += row.dispatchOutcomes[outcome];
    for (const phase of PHASES) into.phases[phase] += row.phases[phase];
    if (row.semantic.source !== "not-recorded") into.semantic.source = row.semantic.source;
    for (const key of SEMANTIC_COUNTS) {
      const left = into.semantic.counts[key];
      const right = row.semantic.counts[key];
      into.semantic.counts[key] = left === null && right === null ? null : (left ?? 0) + (right ?? 0);
    }
    mergeCounts(into.semantic.byOutcome, row.semantic.byOutcome);
    mergeCounts(into.semantic.byReason, row.semantic.byReason);
    mergeCounts(into.semantic.byFindingCode, row.semantic.byFindingCode);
  }
}

function censusRow(row: ToolTally): ToolJourneyCensus {
  const { rawNames, campaigns, semantic, ...counted } = row;
  return {
    ...counted,
    rawNames: [...rawNames].sort(),
    campaignsCalled: campaigns.size,
    semantic: {
      source: semantic.source,
      ...semantic.counts,
      byOutcome: orderedCounts(semantic.byOutcome),
      byReason: orderedCounts(semantic.byReason),
      byFindingCode: orderedCounts(semantic.byFindingCode),
    },
  };
}

function censusRows(tallies: Tallies): ToolJourneyCensus[] {
  return [...tallies.values()]
    .map(censusRow)
    .sort(
      (left, right) =>
        right.aggregateCalls - left.aggregateCalls ||
        right.receiptCalls - left.receiptCalls ||
        left.tool.localeCompare(right.tool),
    );
}

function parseSelection(spec: string): CampaignSelection {
  const [campaignDir, epoch, writtenBefore, extra] = spec.split("::");
  if (campaignDir === undefined || campaignDir === "" || extra !== undefined) {
    throw new Error(`invalid builder journey selection ${spec}`);
  }
  if (writtenBefore !== undefined && Number.isNaN(Date.parse(writtenBefore))) {
    throw new Error(`invalid builder journey cutoff ${writtenBefore}`);
  }
  return {
    campaignDir,
    epoch: epoch === undefined || epoch === "" ? null : epoch,
    writtenBefore: writtenBefore === undefined || writtenBefore === "" ? null : writtenBefore,
  };
}

/** Each call's phase, read from the session's own submit positions once rather than per call. */
function sessionPhases(calls: readonly BuilderCustomToolCall[]): Phase[] {
  const submits = calls.flatMap((call, index) => (call.tool === "submit" ? [index] : []));
  const first = submits[0];
  const last = submits.at(-1);
  return calls.map((call, index) => {
    if (call.tool === "submit") return "submit";
    if (first === undefined || last === undefined) return "no-submit";
    if (index < first) return "before-first-submit";
    if (index > last) return "after-last-submit";
    return "between-submits";
  });
}

function timeline(calls: readonly BuilderCustomToolCall[]): SessionJourney["timeline"] {
  const out: SessionJourney["timeline"] = [];
  for (const call of calls) {
    const action = actionLabel(call);
    const previous = out.at(-1);
    if (previous?.action === action) {
      previous.count += 1;
      previous.lastSequence = call.sequence;
    } else {
      out.push({ action, count: 1, firstSequence: call.sequence, lastSequence: call.sequence });
    }
  }
  return out;
}

/** One turn's receipts and attempts pair up only when the turn holds exactly one of each. */
function submitPairs(
  receipts: readonly BuilderCustomToolCall[],
  attempts: readonly BuilderSubmitAttempt[],
): SubmitPairGroup {
  const [onlyReceipt] = receipts;
  const [onlyAttempt] = attempts;
  if (
    receipts.length === 1 &&
    attempts.length === 1 &&
    onlyReceipt !== undefined &&
    onlyAttempt !== undefined
  ) {
    return { join: "joined", pairs: [{ receipt: onlyReceipt, attempt: onlyAttempt }] };
  }
  return {
    join: "ambiguous",
    pairs: [...receipts.map((receipt) => ({ receipt })), ...attempts.map((attempt) => ({ attempt }))],
  };
}

function submitMoment(
  calls: readonly BuilderCustomToolCall[],
  pair: SubmitPair,
  turn: number,
  join: SubmitJoin,
  ordinal: number,
): SubmitMoment {
  const { receipt, attempt } = pair;
  const at = receipt === undefined ? -1 : calls.indexOf(receipt);
  return {
    ordinal,
    turn,
    join,
    receiptSequence: receipt?.sequence ?? null,
    dispatchOutcome: receipt?.dispatchOutcome ?? null,
    ...(attempt === undefined
      ? UNATTEMPTED
      : {
          ...keyIfDefined("kind", attempt.kind),
          outcome: attempt.outcome,
          stage: attempt.stage,
          findingCount: attempt.findingCodes.length,
          findingsDelta: attempt.findingsDelta,
          workspaceChanged: attempt.workspaceChanged,
        }),
    findingCodes: [...(attempt?.findingCodes ?? [])],
    before: at < 0 ? [] : calls.slice(Math.max(0, at - 4), at).map(actionLabel),
    after: at < 0 ? [] : calls.slice(at + 1, at + 5).map(actionLabel),
  };
}

/** Receipts and attempts join by the turn they share, never by their order in either stream. */
function submitMoments(
  calls: readonly BuilderCustomToolCall[],
  attempts: readonly BuilderSubmitAttempt[],
): SubmitMoment[] {
  const byTurn = new Map<number, { receipts: BuilderCustomToolCall[]; attempts: BuilderSubmitAttempt[] }>();
  const bucket = (turn: number) => {
    const existing = byTurn.get(turn);
    if (existing !== undefined) return existing;
    const fresh = { receipts: [], attempts: [] };
    byTurn.set(turn, fresh);
    return fresh;
  };
  for (const call of calls) if (call.tool === "submit") bucket(call.turn).receipts.push(call);
  for (const attempt of attempts) bucket(attempt.turn).attempts.push(attempt);

  const moments: SubmitMoment[] = [];
  for (const [turn, group] of [...byTurn.entries()].sort(([left], [right]) => left - right)) {
    const { join, pairs } = submitPairs(group.receipts, group.attempts);
    for (const pair of pairs) moments.push(submitMoment(calls, pair, turn, join, moments.length + 1));
  }
  return moments;
}

function foldReceipts(calls: readonly BuilderCustomToolCall[], tallies: Tallies, campaign: string): void {
  const phases = sessionPhases(calls);
  calls.forEach((call, index) => {
    const row = tallyFor(tallies, call.tool);
    row.rawNames.add(call.tool);
    row.campaigns.add(campaign);
    row.receiptCalls += 1;
    row.dispatchOutcomes[call.dispatchOutcome] += 1;
    row.phases[phases[index] ?? "no-submit"] += 1;
    if (call.semantic !== undefined && !SEMANTIC_OWNER.has(row.tool)) {
      const { semantic } = row;
      semantic.source = "tool-receipts";
      bumpSemantic(semantic, "observations");
      bump(semantic.byOutcome, call.semantic.outcome);
      if (call.semantic.reason !== undefined) bump(semantic.byReason, call.semantic.reason);
      for (const code of call.semantic.findingCodes ?? []) bump(semantic.byFindingCode, code);
      if (["completed", "clear", "accepted"].includes(call.semantic.outcome)) {
        bumpSemantic(semantic, "successes");
      } else if (call.semantic.outcome === "non-result") bumpSemantic(semantic, "nonResults");
      else bumpSemantic(semantic, "failures");
    }
  });
}

function foldSubmits(attempts: readonly BuilderSubmitAttempt[], tallies: Tallies): void {
  if (attempts.length === 0) return;
  const { semantic } = tallyFor(tallies, "submit");
  semantic.source = "submit-attempts";
  bumpSemantic(semantic, "observations", attempts.length);
  for (const attempt of attempts) {
    bump(semantic.byOutcome, `${attempt.outcome}${attempt.stage === null ? "" : `:${attempt.stage}`}`);
    bumpSemantic(semantic, attempt.outcome === "accepted" ? "successes" : "failures");
    for (const code of attempt.findingCodes) bump(semantic.byFindingCode, code);
  }
}

function foldWorkshop(
  workshop: NonNullable<ReturnType<typeof builderToolsReport>["epochs"][number]["workshop"]>,
  tallies: Tallies,
): void {
  for (const [action, outcomes] of Object.entries(workshop.byActionOutcome)) {
    const { semantic } = tallyFor(tallies, action === "fetch" ? "public_source" : "verifier_workshop");
    semantic.source = "workshop-actions";
    bumpSemantic(semantic, "observations", outcomes.completed + outcomes.failed + outcomes.nonResults);
    bumpSemantic(semantic, "successes", outcomes.completed);
    bumpSemantic(semantic, "failures", outcomes.failed);
    bumpSemantic(semantic, "nonResults", outcomes.nonResults);
    bump(semantic.byOutcome, `${action}.completed`, outcomes.completed);
    bump(semantic.byOutcome, `${action}.failed`, outcomes.failed);
    bump(semantic.byOutcome, `${action}.non-result`, outcomes.nonResults);
    for (const [reason, count] of Object.entries(outcomes.byReason)) bump(semantic.byReason, reason, count);
  }
}

/** Per tool, the larger of what a session counted for itself and what it recorded receipts for. */
function foldObservedCalls(
  executions: readonly BuilderExecutionEvidence[],
  customNames: ReadonlySet<string>,
  tallies: Tallies,
): void {
  for (const execution of executions) {
    const aggregate: CountMap = {};
    const receipts: CountMap = {};
    for (const [rawName, count] of Object.entries(execution.toolCalls.byName)) {
      const bareName = bareBuilderToolName(rawName);
      if (customNames.has(bareName)) bump(aggregate, canonicalTool(bareName), count);
    }
    for (const call of execution.customCalls) bump(receipts, canonicalTool(call.tool));
    for (const name of new Set([...Object.keys(aggregate), ...Object.keys(receipts)])) {
      tallyFor(tallies, name).observedCalls += Math.max(aggregate[name] ?? 0, receipts[name] ?? 0);
    }
  }
}

function foldCensus(
  census: ReturnType<typeof builderCustomToolCensus>,
  tallies: Tallies,
  campaign: string,
): void {
  for (const [rawName, use] of Object.entries(census?.byName ?? {})) {
    const row = tallyFor(tallies, rawName);
    row.rawNames.add(rawName);
    if (use.calls > 0) row.campaigns.add(campaign);
    row.aggregateCalls += use.calls;
    row.aggregateDispatchFailures += use.failed;
    row.sessionsCalled += use.sessionsCalled;
    row.sessionsExposed += use.sessionsExposed;
    row.sessionsExposureUnknown += use.sessionsExposureUnknown;
  }
}

function sessionJourney(
  epoch: string,
  session: number,
  execution: BuilderExecutionEvidence,
  tallies: Tallies,
  campaign: string,
): SessionJourney {
  const calls = [...execution.customCalls].sort((left, right) => left.sequence - right.sequence);
  foldReceipts(calls, tallies, campaign);
  foldSubmits(execution.submits, tallies);
  const omitted = execution.customCallsOmitted;
  return {
    epoch,
    session,
    backend: execution.backend,
    outcome: execution.outcome,
    aggregateCustomCalls: execution.toolCalls.custom,
    nativeCallsOutsideJourney: execution.toolCalls.native,
    receiptCalls: calls.length,
    receiptCallsOmitted: omitted,
    aggregateMinusKnownReceipts: execution.toolCalls.custom - calls.length - omitted,
    timeline: timeline(calls),
    submitMoments: submitMoments(calls, execution.submits),
    submitCounts: submitProjection(execution.submits).submitCounts,
  };
}

function campaignJourney(selection: CampaignSelection, shared: Tallies): CampaignJourney {
  const selected = selectedEpochs(selection);
  const tallies: Tallies = new Map();
  const census = builderCustomToolCensus(selected.map(({ epoch }) => epoch));
  foldCensus(census, tallies, selection.campaignDir);
  const journeys = selected.flatMap(({ epoch }) => {
    if (epoch.workshop !== null) foldWorkshop(epoch.workshop, tallies);
    return epoch.execution.map((execution, index) =>
      sessionJourney(
        epoch.epoch,
        epoch.executionSessions?.[index] ?? index + 1,
        execution,
        tallies,
        selection.campaignDir,
      ),
    );
  });
  foldObservedCalls(
    selected.flatMap(({ epoch }) => epoch.execution),
    new Set(Object.keys(census?.byName ?? {})),
    tallies,
  );
  mergeInto(shared, tallies);

  const receiptCalls = journeys.reduce((sum, row) => sum + row.receiptCalls, 0);
  const receiptCallsOmitted = journeys.reduce((sum, row) => sum + row.receiptCallsOmitted, 0);
  const aggregate = census?.calls ?? null;
  return {
    campaign: selection.campaignDir,
    label: basename(selection.campaignDir),
    selection: { epoch: selection.epoch, writtenBefore: selection.writtenBefore },
    sessions: journeys.length,
    aggregateCustomCalls: aggregate,
    observedCustomCalls:
      journeys.length === 0
        ? null
        : journeys.reduce(
            (sum, row) =>
              sum + Math.max(row.aggregateCustomCalls, row.receiptCalls + row.receiptCallsOmitted),
            0,
          ),
    receiptCalls,
    receiptCallsOmitted,
    aggregateMinusKnownReceipts: aggregate === null ? null : aggregate - receiptCalls - receiptCallsOmitted,
    tools: censusRows(tallies),
    workshopJoins: selected.flatMap(({ epoch, facts }) => {
      const joined = workshopJourney(epoch, facts);
      return joined === null ? [] : [joined];
    }),
    journeys,
    submitCounts: journeys.reduce(
      (total, row) => ({
        raw: total.raw + row.submitCounts.raw,
        candidates: total.candidates + row.submitCounts.candidates,
        controllerTerminals: total.controllerTerminals + row.submitCounts.controllerTerminals,
      }),
      { raw: 0, candidates: 0, controllerTerminals: 0 },
    ),
    executionUnavailable: selected.flatMap(({ epoch }) => epoch.executionUnavailable ?? []),
  };
}

export function builderToolJourneysReport(campaignSpecs: readonly string[]): BuilderToolJourneysReport {
  if (campaignSpecs.length === 0) throw new Error("builder tool journeys need at least one campaign dir");
  const shared: Tallies = new Map();
  const campaigns = campaignSpecs.map((spec) => campaignJourney(parseSelection(spec), shared));
  return {
    schema: BUILDER_TOOL_JOURNEYS_SCHEMA,
    authority: "diagnostic-only",
    boundary: {
      adjacency:
        "before/after and timelines contain controller-hosted custom calls only; native workspace calls and model text may occur between adjacent rows",
      dispatch:
        "returned means only that the tool call completed; its recorded outcome, submit attempt or workshop action states the result separately",
      intent:
        "intent contains only the recorded action and public target fields; it contains no private reasoning trace",
    },
    campaigns,
    tools: censusRows(shared),
  };
}
