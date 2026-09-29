// What one round hands the next, and whether the next round used it. Four lanes of the catalogue
// each start from one table here, so their paid lanes spend on the question rather than on
// rebuilding the join:
//
//   lane 17  round hand-off census — per round and per channel, whether the channel's bytes were
//            present, served in the kickoff prompt, read back through a tool call, and acted on;
//   lane 10  difficulty calibration — rehearsals, verified passes and the recorded zone, and
//            whether rehearsal or trace evidence was opened before the battery was authored;
//   lane 15  triage hand-off — per failing family, what the Epoch Reviewer and the advice packet
//            said, and which side of the product the successor battery actually moved;
//   lane 18  same-task repair — per family, whether consecutive batteries measured the same public
//            inputs, and which advice issue states moved on a comparison of family names alone.
//
//   bun wri.ts handoff <target> [--json] [--out <abs file>]
//
// Campaign bytes only; nothing executes and nothing is written inside the run. A served marker is a
// sentence the current source renders, so an absent marker reads `not found`, never `not served`:
// an older prompt may have carried the same channel under other words. Reads come from the path
// record and the Builder's custom calls. A file opened through `bash` records only its working
// directory, so every round states its bash count beside the reads as the unobservable remainder.
// A field an older source never recorded is `null` and printed as unobservable, never as zero.
import { existsSync, readdirSync, readFileSync } from "#src/meta/filesystem.ts";
import { basename, join } from "#src/meta/path.ts";
import { BUILDER_EXECUTION_SCHEMA } from "#src/author/builder-execution.ts";
import { DIFFICULTY_DECISION_SCHEMA } from "#src/run/difficulty-decision.ts";
import { readJsonFileOrNull } from "#src/meta/completed-json.ts";
import { hashJsonValue } from "#src/meta/stable-json.ts";
import { isNumber, isRecord, isString, type JsonValue } from "#src/meta/json-shape.ts";
import { parseJsonAs } from "#src/meta/json-runtime.ts";
import { campaignTraceRoots } from "#src/claim/trace-read.ts";
import {
  type AdviceIssue,
  adviceIssueId,
  type IssueDiagnosis,
  issueFacts,
} from "#src/author/rebuild-advice.ts";
import { ownerSide } from "#src/author/feedback-routing.ts";
import { PATH_RECORD_FILE } from "#src/builder/path-record.ts";
import { PUBLIC_TASK_FILE } from "#src/correctness-bundle/recorded-solve.ts";
import { jsonText, readJsonAsOrNull } from "./run-overview.ts";

export const HANDOFFS_SCHEMA = "wri-handoffs/v1";

/** The Builder tools this reader counts, spelled once. */
const TRIAL = "harness_trial";
const PREVIEW = "correctness_check";

/** The operation each triaged side's repair is attributed as, from the accepted bytes
 *  (`experiment-admission.ts`): a task probe repairs neither side, a new baseline moved several. */
const REPAIR_OPERATION = { harness: "harness-intervention", evaluation: "evaluation-correction" };

/** The tool evidence that counts as opening a channel. */
export type ReadKind = "history" | "experiment" | "memory" | "context" | "traces";

/** One channel a round can hand the next. */
export interface Channel {
  name: string;
  marker: string;
  read: ReadKind | null;
  alternative: string;
}

/**
 * The channels a round can hand the next. `marker` is a sentence the current source renders into
 * the kickoff (grep-confirmed at the owner named beside it); `read` names the tool evidence that
 * counts as opening the channel, or null when no tool re-serves it; `alternative` is the cheapest
 * route a served-but-unread channel could take instead, stated as a candidate for lane 17 to test.
 */
export const CHANNELS: readonly Channel[] = [
  // src/run/battery-sizing.ts
  {
    name: "round-facts",
    marker: "Task count:",
    read: null,
    alternative: "re-serve through an existing harness_inspect mode",
  },
  // src/run/climb-readout.ts
  {
    name: "climb-readout",
    marker: "Recorded batteries (controller-derived data",
    read: "history",
    alternative: "harness_inspect history exists; name it where the target is chosen",
  },
  // src/author/rebuild-advice.ts
  {
    name: "rebuild-advice",
    marker: "Standing issues",
    read: null,
    alternative: "return the current packet from harness_inspect feedback",
  },
  // src/author/rebuild-advice.ts
  {
    name: "diagnosis",
    marker: "First failure boundary ",
    read: null,
    alternative: "ride the advice packet's inspect route",
  },
  // src/review/epoch-review-public.ts
  {
    name: "epoch-review",
    marker: "Epoch review (",
    read: null,
    alternative: "return the latest public projection from harness_inspect feedback",
  },
  // src/run/climb-readout.ts planLine, scoring the last round's plan
  {
    name: "experiment",
    marker: "Plan: the plan ",
    read: "experiment",
    alternative: "none: every correctness_check already returns the plan's advice",
  },
  // src/author/builder-memory.ts, rendered by roundPrompt in src/author/builder-session.ts for any
  // round opening in a workspace the conversation has not worked in, resumed sessions included
  {
    name: "memory",
    marker: "Historical notes, model-authored",
    read: "memory",
    alternative:
      "restate on a round that stays in the same workspace, the one round that receives no memory block",
  },
  // src/builder/user-context.ts
  {
    name: "context",
    marker: "User context:",
    read: "context",
    alternative: "none when no files were supplied",
  },
  // src/run/climb-readout.ts
  {
    name: "traces",
    marker: "history source holds every row",
    read: "traces",
    alternative: "an inspect mode summarising the last battery's traces",
  },
];

const READ_PATHS = {
  experiment: /\/EXPERIMENT\.json$/,
  memory: /\/MEMORY\.md$/,
  traces: /\/(rehearsals|trials|cases)\/|trace/,
};

/** The campaign and run whose hand-offs to read; a null or absent run reads every run. */
export interface HandoffsTarget {
  campaign: string;
  runId?: string | null;
}

/** A battery the run claimed, placed on the wall clock. */
interface ClaimedBattery {
  runId: string;
  createdAt: string;
  at: number;
}

/** The round plan an accepted submit recorded, as this reader meets it. */
interface PlanRow {
  families?: JsonValue;
}

/** One battery's difficulty row, as this reader meets it. */
interface DecisionRow {
  runId?: string;
  passed?: number;
  verified?: number;
  unaccepted?: number;
  zone?: JsonValue;
  operation?: string | null;
}

interface DecisionFile {
  schema?: string;
  difficulty?: { rows?: DecisionRow[] } | null;
}

interface SemanticReading {
  truthVerdict?: JsonValue;
}

interface CustomCallRow {
  tool?: string;
  action?: string;
  startedAtMs?: number;
  semantic?: SemanticReading | null;
}

interface SubmitRow {
  outcome?: string;
  atMs?: number;
  experimentPlan?: PlanRow | null;
}

interface ToolCallCounts {
  byName?: { bash?: number } | null;
}

interface ExecutionRecord {
  schema?: string;
  writtenAt?: string;
  durationMs?: number;
  customCalls?: CustomCallRow[];
  authoringReviews?: JsonValue;
  submits?: SubmitRow[];
  toolCalls?: ToolCallCounts | null;
}

type Call = CustomCallRow & { at: number | null };
type Submit = SubmitRow & { at: number | null };

/** One Builder session with its calls placed on the wall clock. */
interface Session {
  start: number;
  end: number;
  calls: Call[];
  reviews: number;
  submits: Submit[];
  bash: number | null;
}

interface ObservabilityRow {
  type?: string;
  contract?: string;
  role?: string;
  prompt?: string;
}

interface EpochRow {
  key?: string;
  createdAt?: string;
}

interface EpochsFile {
  epochs?: EpochRow[];
}

interface PathRow {
  capability?: string;
  resolved?: string | null;
  at?: string;
}

type PathHit = Omit<PathRow, "at"> & { at: number };

/** One round per epoch, as the lanes read it. */
interface Round {
  index: number;
  epoch: string;
  dir: string;
  start: number;
  sessions: Session[];
  paths: PathHit[];
  prompts: string[];
  plan: PlanRow | null;
  battery: string | null;
  prior: ClaimedBattery[];
}

interface AdvicePacket {
  issues?: AdviceIssue[];
}

interface DiagnosesFile {
  diagnoses?: JsonValue;
}

interface ProbeRow {
  refused?: JsonValue;
  baseline?: { outcome?: string } | null;
  movedCheckIds?: JsonValue;
}

interface DisputeRow {
  issueId?: string;
}

interface EpochReviewFile {
  status?: JsonValue;
  findings?: JsonValue;
  probes?: ProbeRow[];
  disputes?: DisputeRow[];
}

/** One channel's cell in one round of the census. */
export interface CensusCell {
  name: string;
  present: boolean;
  served: boolean;
  read: number | null;
  acted: boolean | null;
}

export interface UnreadChannel {
  name: string;
  alternative: string;
}

export interface CensusRow {
  round: number;
  epoch: string;
  promptFound: boolean;
  bashCalls: number | null;
  channels: CensusCell[];
  servedNotRead: UnreadChannel[];
}

export interface BeforeAuthoring {
  history: number | null;
  rehearsals: number;
  traceReads: number;
}

export interface CalibrationRound {
  round: number;
  battery: string | null;
  rehearsals: number;
  rehearsalVerdicts: JsonValue[];
  passed: number | null;
  verified: number | null;
  zone: JsonValue;
  beforeAuthoring: BeforeAuthoring;
}

export interface Calibration {
  rounds: CalibrationRound[];
  onAim: number;
  placed: number;
}

export type TriagedSide = "evaluation" | "harness" | "environment" | "none";

export interface DiagnosisReading {
  side: "evaluation" | "harness";
  owner: string;
  support: JsonValue;
}

export interface ReviewReading {
  status: JsonValue;
  findings: number;
  probes: number;
  unmovedProbes: number;
  disputedThisIssue: boolean;
}

export interface TriagedFamily {
  battery: string;
  family: string;
  kind: AdviceIssue["kind"];
  detail: string | null;
  count: number;
  denominator: number | null;
  status: string;
  diagnosis: DiagnosisReading | null;
  review: ReviewReading | null;
  adviceWithheld: boolean;
  triagedSide: TriagedSide;
  successor: string | null;
  successorOperation: string | null;
  repairedNamedSide: boolean | null;
}

export interface TriageTiming {
  previews: number;
  previewsAfterReview: number;
  submits: number;
  submitsAfterReview: number;
  firstFailingBattery: string | null;
  minutesToFirstReview: number | null;
}

export interface Triage {
  families: TriagedFamily[];
  timing: TriageTiming;
}

export type FamilyJoin =
  | "absent-before"
  | "absent-after"
  | "name-only"
  | "identical-tasks"
  | "partially-shared";

interface TaskInput {
  taskId: JsonValue | undefined;
  family: JsonValue | undefined;
  input: string;
}

export interface FamilyJoinRow {
  family: JsonValue | undefined;
  join: FamilyJoin;
}

export interface IssueTransition {
  family: string;
  kind: AdviceIssue["kind"];
  from: string;
  to: string;
  join: FamilyJoin | null;
  onNamesAlone: boolean;
}

export interface BatteryPair {
  before: string;
  after: string;
  families: FamilyJoinRow[] | null;
  renamedTasks?: number;
  transitions: IssueTransition[];
}

export interface IssueProducer {
  issues: number;
  familyKeyed: number;
}

export interface SameTask {
  pairs: BatteryPair[];
  producer: IssueProducer;
}

interface EmptyHandoffs {
  schema: typeof HANDOFFS_SCHEMA;
  state: "empty";
  reason: string;
  runId: string | null;
  batteries?: never;
  census?: never;
  calibration?: never;
  triage?: never;
  sameTask?: never;
}

export interface ReadHandoffs {
  schema: typeof HANDOFFS_SCHEMA;
  state: "read";
  reason: null;
  runId: string | null;
  batteries: string[];
  census: CensusRow[];
  calibration: Calibration;
  triage: Triage;
  sameTask: SameTask;
}

export type HandoffsReport = EmptyHandoffs | ReadHandoffs;

/** The object rows of a recorded array; anything else reads as no rows. */
function records<T extends object>(value: readonly T[] | null | undefined): T[] {
  return Array.isArray(value) ? value.filter((row) => isRecord(row)) : [];
}

/** How many object rows a recorded array holds; anything else holds none. */
function recordCount(value: JsonValue | undefined): number {
  return Array.isArray(value) ? value.filter((row) => isRecord(row)).length : 0;
}

/** A recorded value read as an object only when it is one, the test `isRecord` applies. */
function recordOf<T extends object>(value: T | null | undefined): T | null {
  return isRecord(value) ? value : null;
}

const jsonl = <T>(path: string): T[] =>
  existsSync(path)
    ? readFileSync(path, "utf8")
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => parseJsonAs<T>(line))
    : [];

/** This run's batteries in claim order, which AGENTS.md makes the order of record. */
function batteriesOf(campaign: string, runId: string | null): ClaimedBattery[] {
  const dir = join(campaign, "claims");
  if (!existsSync(dir)) return [];
  const ownBattery =
    runId === null ? () => true : (battery: string) => battery === runId || battery.startsWith(`${runId}-i`);
  const rows = readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => readJsonFileOrNull(join(dir, name)))
    .flatMap((claim) =>
      isRecord(claim) && isString(claim.runId) && isString(claim.createdAt) && ownBattery(claim.runId)
        ? [{ runId: claim.runId, createdAt: claim.createdAt }]
        : [],
    );
  return rows
    .map((claim) => ({ runId: claim.runId, createdAt: claim.createdAt, at: Date.parse(claim.createdAt) }))
    .sort((a, b) => a.at - b.at);
}

/** Each battery's difficulty row, from whichever decision file recorded it last. A decision under
 *  any other schema is refused by name: its rows carry another shape, and reading them as this one
 *  would put a placement in the table that the controller never made. */
function decisionRows(campaign: string): Map<string, DecisionRow> {
  const dir = join(campaign, "difficulty-decisions");
  const byRun = new Map<string, DecisionRow>();
  if (!existsSync(dir)) return byRun;
  for (const name of readdirSync(dir).sort()) {
    const decision = recordOf(readJsonAsOrNull<DecisionFile | null>(join(dir, name)));
    if (decision === null || decision.schema !== DIFFICULTY_DECISION_SCHEMA) {
      throw new Error(`difficulty-decisions/${name} is not ${DIFFICULTY_DECISION_SCHEMA}`);
    }
    for (const row of records(recordOf(decision.difficulty)?.rows ?? [])) {
      if (isString(row.runId)) byRun.set(row.runId, row);
    }
  }
  return byRun;
}

function analysis<T>(campaign: string, battery: string, kind: string): T | null {
  return readJsonAsOrNull<T | null>(join(campaign, "analysis", `${battery}-${kind}.json`));
}

/** Authoring-time reviews, timed by the UUIDv7 in their file name; battery reviews record no time. */
function authoringReviewTimes(campaign: string): number[] {
  const dir = join(campaign, "analysis");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((name) => /^authoring-([0-9a-f-]{36})-epoch-review\.json$/.exec(name)?.[1])
    .filter((id) => id !== undefined)
    .map((id) => Number.parseInt(id.replaceAll("-", "").slice(0, 12), 16))
    .sort((a, b) => a - b);
}

/** Every Builder session an epoch recorded, with its calls placed on the wall clock. A record under
 *  another schema is refused by name rather than read for the fields that happen to match. */
function sessionsOf(epochDir: string): Session[] {
  return readdirSync(epochDir)
    .filter((name) => /^builder-execution(-\d+)?\.json$/.test(name))
    .map((name) => {
      const record = recordOf(readJsonAsOrNull<ExecutionRecord | null>(join(epochDir, name)));
      if (record === null || record.schema !== BUILDER_EXECUTION_SCHEMA) {
        throw new Error(`${basename(epochDir)}/${name} is not ${BUILDER_EXECUTION_SCHEMA}`);
      }
      return record;
    })
    .flatMap((record) => {
      const { writtenAt, durationMs } = record;
      if (!isString(writtenAt) || !isNumber(durationMs)) return [];
      const start = Date.parse(writtenAt) - durationMs;
      const at = (row: CustomCallRow): number | null =>
        isNumber(row.startedAtMs) ? start + row.startedAtMs : null;
      const byName = recordOf(recordOf(record.toolCalls)?.byName);
      return [
        {
          start,
          end: Date.parse(writtenAt),
          calls: records(record.customCalls).map((row) => ({ ...row, at: at(row) })),
          reviews: recordCount(record.authoringReviews),
          submits: records(record.submits).map((row) => ({
            ...row,
            at: isNumber(row.atMs) ? start + row.atMs : null,
          })),
          bash: byName === null ? null : (byName.bash ?? 0),
        },
      ];
    });
}

/** The full kickoff prompts this run served the Builder, keyed by the epoch workspace they name. */
function promptsByEpoch(campaign: string, runId: string | null): Map<string, string[]> {
  const byEpoch = new Map<string, string[]>();
  const dir = join(campaign, "observability");
  if (!existsSync(dir)) return byEpoch;
  const files = readdirSync(dir).filter(
    (name) => name.endsWith(".jsonl") && (runId === null || name === `${runId}.jsonl`),
  );
  for (const file of files) {
    for (const row of jsonl<ObservabilityRow>(join(dir, file))) {
      if (row.type !== "prompt-ingested" || row.contract !== "builder" || row.role !== "builder") continue;
      const prompt = row.prompt ?? "";
      const epoch = /(epoch-[0-9a-f]{12})\/workspace/.exec(prompt)?.[1];
      if (epoch !== undefined) byEpoch.set(epoch, [...(byEpoch.get(epoch) ?? []), prompt]);
    }
  }
  return byEpoch;
}

/** One round per epoch: its sessions, path record, prompts and the battery its accepted submit fed. */
function roundsOf(campaign: string, runId: string | null, batteries: readonly ClaimedBattery[]): Round[] {
  const epochs = readJsonAsOrNull<EpochsFile | null>(join(campaign, "epochs.json"));
  const prompts = promptsByEpoch(campaign, runId);
  const listed = records(recordOf(epochs)?.epochs).filter((epoch): epoch is EpochRow & { key: string } =>
    isString(epoch.key),
  );
  const scoped = prompts.size === 0 ? listed : listed.filter((epoch) => prompts.has(epoch.key));
  return scoped.map((epoch, index) => {
    const dir = join(campaign, epoch.key);
    const sessions = existsSync(dir) ? sessionsOf(dir) : [];
    const accepted = sessions
      .flatMap((s) => s.submits)
      .filter((s): s is Submit & { at: number } => s.outcome === "accepted" && s.at !== null);
    const acceptedAt = accepted.length === 0 ? null : Math.max(...accepted.map((s) => s.at));
    const battery = acceptedAt === null ? null : (batteries.find((b) => b.at > acceptedAt) ?? null);
    const start =
      sessions.length === 0 ? Date.parse(epoch.createdAt ?? "") : Math.min(...sessions.map((s) => s.start));
    return {
      index: index + 1,
      epoch: epoch.key,
      dir,
      start,
      sessions,
      paths: jsonl<PathRow>(join(dir, PATH_RECORD_FILE)).map((row) => ({
        ...row,
        at: Date.parse(row.at ?? ""),
      })),
      prompts: prompts.get(epoch.key) ?? [],
      plan: accepted.at(-1)?.experimentPlan ?? null,
      battery: battery?.runId ?? null,
      prior: batteries.filter((b) => b.at < start),
    };
  });
}

const calls = (round: Round, tool: string, action?: string): Call[] =>
  round.sessions
    .flatMap((s) => s.calls)
    .filter((c) => c.tool === tool && (action === undefined || c.action === action));
const pathHits = (round: Round, capability: string, pattern: RegExp, before = Infinity): number =>
  round.paths.filter(
    (row) => row.capability === capability && pattern.test(row.resolved ?? "") && row.at < before,
  ).length;

/** Whether a call happened before the mark, the comparison an untyped `c.at < before` made. */
function callBefore(call: Call, before: number): boolean {
  return (call.at ?? 0) < before;
}

function readCount(round: Round, read: ReadKind | null, before = Infinity): number | null {
  if (read === null) return null;
  if (read === "history") {
    return calls(round, "harness_inspect", "history").filter((c) => callBefore(c, before)).length;
  }
  if (read === "context") return calls(round, "context").filter((c) => callBefore(c, before)).length;
  return pathHits(round, "read", READ_PATHS[read], before);
}

function presentOf(campaign: string, round: Round, name: string): boolean {
  const last = round.prior.at(-1)?.runId ?? null;
  const advice = last === null ? null : analysis<AdvicePacket>(campaign, last, "rebuild-advice");
  const diagnoses = last === null ? null : analysis<DiagnosesFile>(campaign, last, "diagnoses");
  switch (name) {
    case "round-facts":
    case "context":
      return true;
    case "rebuild-advice":
      return records(recordOf(advice)?.issues).length > 0;
    case "diagnosis":
      return recordCount(recordOf(diagnoses)?.diagnoses) > 0;
    case "epoch-review":
      return last !== null && analysis<JsonValue>(campaign, last, "epoch-review") !== null;
    case "memory":
      return round.index > 1;
    default:
      return round.prior.length > 0 || (name === "traces" && calls(round, TRIAL).length > 0);
  }
}

function actedOf(round: Round, name: string): boolean | null {
  const plan = recordOf(round.plan);
  // The plan states no pass count, so nothing it records shows the readout acted on.
  if (name === "experiment") return pathHits(round, "write", READ_PATHS.experiment) > 0 && plan !== null;
  if (name === "memory") return pathHits(round, "write", READ_PATHS.memory) > 0;
  if (name === "traces") return calls(round, TRIAL).length > 0;
  return null;
}

/** Lane 17: one row per round, one cell per channel. */
function census(campaign: string, rounds: readonly Round[]): CensusRow[] {
  return rounds.map((round) => {
    const text = round.prompts.join("\n");
    const channels = CHANNELS.map((channel) => {
      let served = text.includes(channel.marker);
      if (channel.name === "epoch-review") served ||= round.sessions.some((s) => s.reviews > 0);
      if (channel.name === "traces") served ||= calls(round, TRIAL).length > 0;
      const read = readCount(round, channel.read);
      return {
        name: channel.name,
        present: presentOf(campaign, round, channel.name),
        served,
        read,
        acted: actedOf(round, channel.name),
      };
    });
    const unread = channels.flatMap((cell) =>
      cell.served && (cell.read === null || cell.read === 0)
        ? [
            {
              name: cell.name,
              // Every cell is named after a channel, so the lookup always finds one.
              alternative: CHANNELS.find((c) => c.name === cell.name)?.alternative ?? "",
            },
          ]
        : [],
    );
    const bash = round.sessions.map((s) => s.bash).filter((n) => n !== null);
    return {
      round: round.index,
      epoch: round.epoch,
      promptFound: round.prompts.length > 0,
      bashCalls: bash.length === 0 ? null : bash.reduce((a, b) => a + b, 0),
      channels,
      servedNotRead: unread,
    };
  });
}

/** When the round started committing to a battery: its first plan write, preview or submit. */
function authoringMark(round: Round): number {
  const writes = round.paths.filter(
    (row) => row.capability === "write" && READ_PATHS.experiment.test(row.resolved ?? ""),
  );
  const gates = [...calls(round, PREVIEW), ...calls(round, "submit")].flatMap((c) =>
    c.at === null ? [] : [c.at],
  );
  const times = [...writes.map((row) => row.at), ...gates];
  return times.length === 0 ? Infinity : Math.min(...times);
}

/** Lane 10: per round, the rehearsals, the verified count and the recorded zone, and the
 *  evidence the round opened before it committed to a battery. */
function calibration(rounds: readonly Round[], rows: ReadonlyMap<string, DecisionRow>): Calibration {
  const out = rounds.map((round) => {
    const row = round.battery === null ? null : (rows.get(round.battery) ?? null);
    const trials = calls(round, TRIAL);
    const recordedPassed = row?.passed;
    const recordedVerified = row?.verified;
    const passed = isNumber(recordedPassed) ? recordedPassed : null;
    const mark = authoringMark(round);
    return {
      round: round.index,
      battery: round.battery,
      rehearsals: trials.length,
      rehearsalVerdicts: trials.map((c) => {
        const semantic = recordOf(c.semantic);
        return semantic === null ? null : (semantic.truthVerdict ?? "not-run");
      }),
      passed,
      verified: isNumber(recordedVerified) ? recordedVerified : null,
      zone: row?.zone ?? null,
      beforeAuthoring: {
        history: readCount(round, "history", mark),
        rehearsals: trials.filter((c) => c.at !== null && c.at < mark).length,
        traceReads: pathHits(round, "read", READ_PATHS.traces, mark),
      },
    };
  });
  const placed = [...rows.values()].filter((row) => isString(row.zone));
  return {
    rounds: out,
    onAim: placed.filter((row) => row.zone === "on-aim").length,
    placed: placed.length,
  };
}

/** The register's facts about a recorded issue. A packet recorded before a field existed leaves it
 *  out, and each absent one reads as the empty value the register writes. */
function recordedFacts(issue: AdviceIssue): string {
  return issueFacts({ ...issue, dispute: issue.dispute ?? null, unmeasured: issue.unmeasured ?? [] });
}

/** A diagnosis names a bundle file or `solver` (`DIAGNOSIS_OWNERS`), and a file's own prefix is the
 *  side its repair reopens, so `correctness-model/brief.json` is the evaluation's. */
function diagnosisOf(value: IssueDiagnosis | null | undefined): DiagnosisReading | null {
  const diagnosis = recordOf(value);
  if (diagnosis === null || !isString(diagnosis.owner)) return null;
  const evaluation = diagnosis.owner !== "solver" && ownerSide(diagnosis.owner) === "correctness-model";
  return {
    side: evaluation ? "evaluation" : "harness",
    owner: diagnosis.owner,
    support: diagnosis.support ?? null,
  };
}

function reviewOf(campaign: string, battery: string, issueId: string): ReviewReading | null {
  const review = recordOf(analysis<EpochReviewFile>(campaign, battery, "epoch-review"));
  if (review === null) return null;
  const probes = records(review.probes);
  const unmoved = probes.filter(
    (p) =>
      (p.refused === null || p.refused === undefined) &&
      p.baseline?.outcome === "pass" &&
      Array.isArray(p.movedCheckIds) &&
      p.movedCheckIds.length === 0,
  );
  return {
    status: review.status ?? null,
    findings: recordCount(review.findings),
    probes: probes.length,
    unmovedProbes: unmoved.length,
    disputedThisIssue: records(review.disputes).some((d) => d.issueId === issueId),
  };
}

/** Lane 15: per failing family, the triage each component recorded and the side the successor moved. */
function triage(
  campaign: string,
  batteries: readonly ClaimedBattery[],
  rows: ReadonlyMap<string, DecisionRow>,
  rounds: readonly Round[],
  reviewTimes: readonly number[],
): Triage {
  const families = batteries.flatMap((battery, index) => {
    const packet = recordOf(analysis<AdvicePacket>(campaign, battery.runId, "rebuild-advice"));
    const issues = records(packet?.issues).filter(
      (issue) => issue.lastSeenRunId === battery.runId && issue.count > 0 && issue.retired !== true,
    );
    const next = batteries[index + 1] ?? null;
    return issues.map((issue) => {
      const review = reviewOf(campaign, battery.runId, issue.id);
      const operation = next === null ? null : (rows.get(next.runId)?.operation ?? null);
      const diagnosis = diagnosisOf(issue.diagnosis);
      const disputeRecorded = issue.dispute !== null && issue.dispute !== undefined;
      const disputed = disputeRecorded || review?.disputedThisIssue === true;
      const undiagnosed = issue.kind === "non-result" ? "environment" : "none";
      const side: TriagedSide = disputed ? "evaluation" : (diagnosis?.side ?? undiagnosed);
      const wanted = side === "harness" || side === "evaluation" ? REPAIR_OPERATION[side] : null;
      return {
        battery: battery.runId,
        family: issue.family,
        kind: issue.kind,
        detail: issue.detail ?? null,
        count: issue.count,
        denominator: issue.denominator ?? null,
        status: recordedFacts(issue),
        diagnosis,
        review,
        adviceWithheld: disputeRecorded,
        triagedSide: side,
        successor: next?.runId ?? null,
        successorOperation: operation,
        repairedNamedSide: wanted === null || operation === null ? null : operation === wanted,
      };
    });
  });
  const gateCalls = rounds.flatMap((round) =>
    [...calls(round, PREVIEW), ...calls(round, "submit")].flatMap((c) => {
      const at = c.at;
      return at === null
        ? []
        : [{ tool: c.tool, reviewed: reviewTimes.some((t) => t >= round.start && t < at) }];
    }),
  );
  const count = (tool: string, reviewed: boolean | null): number =>
    gateCalls.filter((c) => c.tool === tool && (reviewed === null || c.reviewed === reviewed)).length;
  const firstFailing = batteries.find((b) => {
    const row = recordOf(rows.get(b.runId));
    return row !== null && ((row.verified ?? 0) > (row.passed ?? 0) || (row.unaccepted ?? 0) > 0);
  });
  const firstReview = firstFailing === undefined ? undefined : reviewTimes.find((t) => t > firstFailing.at);
  return {
    families,
    timing: {
      previews: count(PREVIEW, null),
      previewsAfterReview: count(PREVIEW, true),
      submits: count("submit", null),
      submitsAfterReview: count("submit", true),
      firstFailingBattery: firstFailing?.runId ?? null,
      minutesToFirstReview:
        firstReview === undefined || firstFailing === undefined
          ? null
          : Math.round((firstReview - firstFailing.at) / 600) / 100,
    },
  };
}

/** The public inputs a battery measured, from the case bytes the solver received. */
function tasksOf(campaign: string, battery: string): TaskInput[] | null {
  for (const root of campaignTraceRoots(campaign)) {
    const cases = join(root, "runs", battery, "cases");
    if (!existsSync(cases)) continue;
    return readdirSync(cases)
      .map((taskId) => readJsonFileOrNull(join(cases, taskId, PUBLIC_TASK_FILE)))
      .flatMap((row) =>
        isRecord(row) && isRecord(row.publicTask)
          ? [
              {
                taskId: row.taskId,
                family: row.family,
                input: hashJsonValue(row.publicTask.publicInput ?? null),
              },
            ]
          : [],
      );
  }
  return null;
}

export function classifyFamily(before: readonly string[], after: readonly string[]): FamilyJoin {
  if (before.length === 0) return "absent-before";
  if (after.length === 0) return "absent-after";
  const shared = after.filter((digest) => before.includes(digest)).length;
  if (shared === 0) return "name-only";
  return shared === after.length && before.length === after.length ? "identical-tasks" : "partially-shared";
}

/** The order an argument-less `sort()` gives recorded values: by their string form, code unit by
 *  code unit. `sort` moves undefined to the end without calling the comparator. */
function byDefaultSortOrder(a: JsonValue | undefined, b: JsonValue | undefined): number {
  const [x, y] = [a === undefined ? "" : jsonText(a), b === undefined ? "" : jsonText(b)];
  if (x < y) return -1;
  return x > y ? 1 : 0;
}

/** Lane 18: consecutive batteries joined per family on public-input digests, and the advice
 *  transitions each join carried. */
function sameTask(campaign: string, batteries: readonly ClaimedBattery[]): SameTask {
  const inputs = new Map(batteries.map((b) => [b.runId, tasksOf(campaign, b.runId)]));
  const packets = new Map(
    batteries.map((b) => [b.runId, recordOf(analysis<AdvicePacket>(campaign, b.runId, "rebuild-advice"))]),
  );
  const pairs = batteries.slice(1).flatMap((after, index): BatteryPair[] => {
    const before = batteries[index];
    // The pair's earlier battery always exists: `after` is the one at index + 1.
    if (before === undefined) return [];
    const [a, b] = [inputs.get(before.runId) ?? null, inputs.get(after.runId) ?? null];
    if (a === null || b === null) {
      return [{ before: before.runId, after: after.runId, families: null, transitions: [] }];
    }
    const names = [...new Set([...a, ...b].map((t) => t.family))].sort(byDefaultSortOrder);
    const digests = (tasks: readonly TaskInput[], family: JsonValue | undefined): string[] =>
      tasks.flatMap((t) => (t.family === family ? [t.input] : []));
    const families = names.map((family) => ({
      family,
      join: classifyFamily(digests(a, family), digests(b, family)),
    }));
    const renamed = b.filter((t) => a.some((p) => p.input === t.input && p.family !== t.family)).length;
    const prior = new Map(records(packets.get(before.runId)?.issues).map((issue) => [issue.id, issue]));
    const transitions = records(packets.get(after.runId)?.issues)
      .flatMap((issue) => {
        const earlier = prior.get(issue.id);
        if (earlier === undefined) return [];
        const [from, to] = [recordedFacts(earlier), recordedFacts(issue)];
        const familyJoin = families.find((f) => f.family === issue.family)?.join ?? null;
        return [
          {
            family: issue.family,
            kind: issue.kind,
            from,
            to,
            join: familyJoin,
            onNamesAlone: familyJoin === "name-only" || familyJoin === "absent-after",
          },
        ];
      })
      .filter((transition) => transition.from !== transition.to);
    return [{ before: before.runId, after: after.runId, families, renamedTasks: renamed, transitions }];
  });
  const issues = batteries.flatMap((b) => records(packets.get(b.runId)?.issues));
  const keyed = issues.filter(
    (issue) => issue.id === adviceIssueId(issue.kind, issue.family, issue.detail ?? null),
  ).length;
  return { pairs, producer: { issues: issues.length, familyKeyed: keyed } };
}

/** The hand-off tables for the campaign directory, reading the named run's batteries and prompts, or
 *  every run the campaign recorded when the run is null or absent. */
export function buildHandoffs({ campaign, runId = null }: HandoffsTarget): HandoffsReport {
  const batteries = batteriesOf(campaign, runId);
  const rows = decisionRows(campaign);
  const rounds = roundsOf(campaign, runId, batteries);
  if (rounds.length === 0 && batteries.length === 0) {
    return { schema: HANDOFFS_SCHEMA, state: "empty", reason: "no epoch and no claimed battery", runId };
  }
  return {
    schema: HANDOFFS_SCHEMA,
    state: "read",
    reason: null,
    runId,
    batteries: batteries.map((b) => b.runId),
    census: census(campaign, rounds),
    calibration: calibration(rounds, rows),
    triage: triage(campaign, batteries, rows, rounds, authoringReviewTimes(campaign)),
    sameTask: sameTask(campaign, batteries),
  };
}

const short = (runId: string | null): string =>
  runId === null ? "none" : runId.replace(/^.*-(?=[0-9a-f]{6}(-i\d+)?$)/, "");
const shown = (value: JsonValue | undefined): string =>
  value === null ? "unobservable" : value === undefined ? String(value) : jsonText(value);
/** One census letter: the letter when the fact holds, `-` when it does not, `·` when nothing records it. */
const mark = (fact: boolean | null, letter: string): string => (fact === null ? "·" : fact ? letter : "-");

function renderCensus(report: ReadHandoffs): string[] {
  const lines = [
    "lane 17 round hand-off census (P present, S served, R read back, A acted; · no channel or no proxy)",
  ];
  lines.push(`  ${"channel".padEnd(15)}${report.census.map((r) => `r${r.round}`.padEnd(6)).join("")}`);
  for (const [i, channel] of CHANNELS.entries()) {
    lines.push(
      `  ${channel.name.padEnd(15)}${report.census
        .map(({ channels }) => {
          const c = channels[i];
          // Every row holds one cell per channel, so the cell always exists.
          if (c === undefined) return "";
          const read = c.read === null ? null : c.read > 0;
          return `${mark(c.present, "P")}${mark(c.served, "S")}${mark(read, "R")}${mark(c.acted, "A")}`.padEnd(
            6,
          );
        })
        .join("")}`,
    );
  }
  for (const round of report.census) {
    const unread = round.servedNotRead.map((u) => `${u.name} (${u.alternative})`).join("; ");
    lines.push(
      `  r${round.round} ${round.epoch}: bash ${shown(round.bashCalls)} (reads through it unobservable)${round.promptFound ? "" : "; kickoff prompt not found"}`,
    );
    if (unread !== "") lines.push(`    served, never read: ${unread}`);
  }
  return lines;
}

function renderCalibration({ calibration: c }: ReadHandoffs): string[] {
  const lines = ["lane 10 difficulty calibration"];
  for (const r of c.rounds) {
    const b = r.beforeAuthoring;
    lines.push(
      `  r${r.round} ${short(r.battery)}: rehearsals ${r.rehearsals} [${jsonText(r.rehearsalVerdicts)}]; passed ${shown(r.passed)}/${shown(r.verified)}; zone ${shown(r.zone)}; before authoring: history ${b.history}, rehearsals ${b.rehearsals}, trace reads ${b.traceReads}`,
    );
  }
  lines.push(`  on-aim ${c.onAim} of ${c.placed} placed batteries`);
  return lines;
}

function renderTriage({ triage: t }: ReadHandoffs): string[] {
  const lines = ["lane 15 triage hand-off"];
  if (t.families.length === 0) lines.push("  no failing family in any advice packet");
  for (const f of t.families) {
    const d =
      f.diagnosis === null
        ? "no diagnosis"
        : `diagnosis ${f.diagnosis.owner} (support ${jsonText(f.diagnosis.support)})`;
    const r =
      f.review === null
        ? "no review"
        : `review ${jsonText(f.review.status)}: ${f.review.findings} findings, ${f.review.probes} probes (${f.review.unmovedProbes} moved no check), disputed ${f.review.disputedThisIssue}`;
    lines.push(
      `  ${short(f.battery)} ${f.family} ${f.kind}${hasDetail(f.detail) ? `/${f.detail}` : ""} ${f.count}/${shown(f.denominator)} [${f.status}]: ${d}; ${r}; advice withheld ${f.adviceWithheld}; triaged ${f.triagedSide}; successor ${short(f.successor)} ${shown(f.successorOperation)}; named side repaired ${shown(f.repairedNamedSide)}`,
    );
  }
  const s = t.timing;
  lines.push(
    `  previews after a mid-round review ${s.previewsAfterReview}/${s.previews}; submits ${s.submitsAfterReview}/${s.submits}; ${s.firstFailingBattery === null ? "no battery failed a verified or unaccepted case" : `first failing battery ${short(s.firstFailingBattery)}, first authoring review ${shown(s.minutesToFirstReview)} min later`}`,
  );
  return lines;
}

/** Whether an issue's detail is printed, the truthiness test an untyped `f.detail ? … : …` applied. */
function hasDetail(detail: string | null): detail is string {
  return detail !== null && detail !== "";
}

function renderSameTask({ sameTask: s }: ReadHandoffs): string[] {
  const lines = ["lane 18 same-task repair"];
  for (const pair of s.pairs) {
    const head = `  ${short(pair.before)} -> ${short(pair.after)}:`;
    if (pair.families === null) {
      lines.push(`${head} case inputs unobservable`);
      continue;
    }
    const counts = new Map<string, number>();
    for (const f of pair.families) counts.set(f.join, (counts.get(f.join) ?? 0) + 1);
    const moved = pair.transitions
      .map((t) => `${t.family} ${t.from}->${t.to} on ${t.join}${t.onNamesAlone ? ", names alone" : ""}`)
      .join("; ");
    lines.push(
      `${head} ${[...counts]
        .map(([k, v]) => `${k} ${v}`)
        .join(
          ", ",
        )}; ${pair.renamedTasks} tasks reappear under another family name${moved === "" ? "" : `; ${moved}`}`,
    );
  }
  lines.push(
    s.producer.issues === 0
      ? "  producer: no advice issue recorded, so no issue state rested on either join"
      : `  producer: ${s.producer.familyKeyed} of ${s.producer.issues} issue ids recompute from (kind, family, detail), so issue state follows the family name, not task identity`,
  );
  return lines;
}

export function renderHandoffs(report: HandoffsReport): string {
  if (report.state !== "read") return `handoffs: ${report.state} (${report.reason})`;
  return [
    ...renderCensus(report),
    ...renderCalibration(report),
    ...renderTriage(report),
    ...renderSameTask(report),
  ].join("\n");
}
