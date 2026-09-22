/**
 * The Builder execution record: what the Builder did inside one session.
 *
 * `builder-session.json` describes the fixed composition before model work; this record keeps the
 * per-turn tool tallies, provider spend and submission history. A turn that never returns has no
 * settled tally, so `builder-turn-observation.ts` folds the running turn's events beside it.
 *
 * It decides nothing and is never model-facing. Unknown provider spend stays null rather than zero.
 */
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import type { AgentTurnEvent, AgentTurnResult, BackendId, TurnUsage } from "../backends/backend-types.ts";
import type { RuntimeModelIdentity } from "../claim/runtime-model-identity.ts";
import type { BuilderExecutionInvocation } from "../run/builder-execution-closure.ts";
import type { ExperimentSubmission } from "./experiment-proposal.ts";
import type { JsonValue } from "../meta/json-shape.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { compareCodeUnits, hashJsonValue } from "../meta/stable-json.ts";
import { type ContractFinding, projectFindingForAuthor } from "../truth/brief.ts";
import { codeDelta } from "../builder/author-feedback.ts";
import {
  CUSTOM_TOOL_NAMES,
  bareCustomToolName,
  customCallIntent,
  semanticFromResult,
  type BuilderCustomToolCall,
} from "./builder-custom-tool-call.ts";
export type { BuilderCustomToolCall, BuilderCustomToolSemantic } from "./builder-custom-tool-call.ts";
import {
  BuilderTurnObservation,
  mergeCounts,
  type BuilderFailedCall,
  type BuilderTurnToolTally,
} from "./builder-turn-observation.ts";
export type { BuilderFailedCall } from "./builder-turn-observation.ts";
import { BuilderProseLog, type BuilderProseCapture, type BuilderProseRow } from "./builder-prose.ts";

export const BUILDER_EXECUTION_EVIDENCE_FILE = "builder-execution.json";
export const BUILDER_EXECUTION_SCHEMA = "builder-execution/v5";
const MAX_CUSTOM_CALL_RECEIPTS = 512;

export interface BuilderSubmitAttempt {
  experimentProposal?: ExperimentSubmission;
  /** Whether this row records a real candidate tree or only a controller stop. */
  kind: "candidate" | "controller-terminal";
  /** 1-based submission ordinal within the session. */
  ordinal: number;
  /** The session turn this submission was made from. */
  turn: number;
  /** Milliseconds from session start to this submission. */
  atMs: number;
  outcome: "accepted" | "refused";
  /** Which submission stage refused; null on acceptance. */
  stage: "bundle" | "validation" | "gates" | null;
  /** The workspace commit at which the controller completed this submission. */
  commit: string;
  /** Content identity of the two contract roots at that commit (`candidateTreeIdentity`); absent on
   *  a controller stop, where readers fall back to the commit. Unlike a commit sha, it is unchanged
   *  by a return to earlier bytes or a root-level note. Repeat strikes key on it. */
  treeId?: string;
  /** Digest over the refused findings; null on acceptance. */
  findingsDigest: string | null;
  /** Finding codes only; codes are what a repeat reads. */
  findingCodes: string[];
  /** The previous submission carried the same findings digest; null when there was none. */
  repeatedFindings: boolean | null;
  /** Multiset comparison by finding code against the previous submission; null when there was
   *  none. Shows partial progress the boolean above collapses. */
  findingsDelta: { carried: number; resolved: number; introduced: number } | null;
  /** The contract roots moved since the previous submission; null when there was none. */
  workspaceChanged: boolean | null;
  /** Ordinal of the earliest submission that already carried these bytes; null when none did.
   *  Catches a return to an older tree, which the previous-submission fields above cannot see. */
  treeFirstSubmittedAsAttempt: number | null;
  /** The refusal ended the session instead of costing one more turn. */
  terminal: boolean;
}

/** One retried authoring turn: a provider or transport failure that produced no build output, and
 *  the wait before running the same turn again. `turn-retry.ts` owns when one is written. */
export interface TurnRetryRow {
  /** The authoring role whose turn failed. */
  role: string;
  /** The session turn retried; null when the retry caller ran one turn per call. */
  turn: number | null;
  /** 1-based retry ordinal within that turn. */
  attempt: number;
  /** Retries the schedule allows, so a row states its own denominator. */
  of: number;
  status: "failed" | "aborted";
  /** The transport's own error text, flattened and bounded. */
  reason: string;
  waitMs: number;
}

export interface BuilderSubmitCounts {
  /** Every submit row, including controller stops. */
  raw: number;
  /** Rows representing a real candidate tree. */
  candidates: number;
  /** Controller stops and budget-boundary rows. */
  controllerTerminals: number;
}

export interface BuilderExecutionEvidence {
  schema: typeof BUILDER_EXECUTION_SCHEMA;
  backend: BackendId | null;
  /** What the provider reported about itself; null when the transport reported nothing. */
  runtimeIdentity: RuntimeModelIdentity | null;
  turns: number;
  durationMs: number;
  toolCalls: {
    total: number;
    failed: number;
    byName: Record<string, number>;
    /** The same calls split by owner: `custom` is the controller's roster, `native` the backend's. */
    custom: number;
    native: number;
  };
  /** Provider-reported spend, summed over the turns that reported any. */
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    costUsd: number | null;
    /** How many turns reported usage; the three totals above cover only these turns. */
    reportedTurns: number;
    /** How many of those turns never reached their provider terminal, so their share is the
     *  transport's in-flight estimate. A total holding estimated turns bounds nothing. */
    estimatedTurns: number;
  };
  /** Milliseconds from session start to the first tool call; null when the Builder called none. */
  firstToolMs: number | null;
  /** Milliseconds from session start to the first submission; null when it never submitted. */
  firstSubmitMs: number | null;
  submits: BuilderSubmitAttempt[];
  /** Submissions whose findings digest repeated the submission before it. */
  repeatedFindingSubmits: number;
  /** Submissions completed at the previous submission's commit. */
  unchangedTreeSubmits: number;
  /** Distinct candidate trees submitted; the gates ran once per tree. */
  uniqueCandidateTrees: number;
  /** Submissions at a tree an earlier submission had already completed at. */
  repeatedTreeSubmits: number;
  /** The raw and candidate-only row counts. */
  submitCounts: BuilderSubmitCounts;
  /** The turn still running when this record was written, and its calls so far. Those calls are
   *  already in `toolCalls`, while `turns` counts settled turns only. Null when no turn was open. */
  partialTurn: { turn: number; toolCalls: BuilderTurnToolTally } | null;
  /** Turns re-run after a failure that produced no build output. Each retry is also counted in
   *  `turns` and the provider budget. */
  turnRetries: TurnRetryRow[];
  /** Authoring reviews after a completed tool call: advice characters attached (0 when none, null
   *  when the review failed) and how long the review held the session. */
  authoringReviews: Array<{ turn: number; tool: string; adviceChars: number | null; reviewMs: number }>;
  /** Failed tool calls by name. */
  failedByName: Record<string, number>;
  /** Bounded identity for reported failures: which call, when, its arguments and its result. */
  failedCalls: BuilderFailedCall[];
  /** Failures beyond the bounded row list. `failedByName` above stays exact. */
  failedCallsOmitted: number;
  /** Ordered safe receipts for controller-hosted tools. */
  customCalls: BuilderCustomToolCall[];
  /** Calls beyond the bounded receipt list. Aggregate tool counts above remain exact. */
  customCallsOmitted: number;
  /** The Builder's messages and reasoning summaries. Written to the `builder-prose.jsonl` sidecar,
   *  never into this JSON; a record read back carries `proseCapture` instead. */
  prose?: BuilderProseRow[];
  /** Rows beyond the prose log's bound. */
  proseOmitted?: number;
  /** Identity and row counts joining this record to the prose sidecar, added when the sidecar is
   *  written. */
  proseCapture?: BuilderProseCapture;
  /** `in-flight` marks a checkpoint written while the session runs; the settled write replaces it.
   *  `recorded-at-terminal` is a checkpoint the controller closed at its own terminal: the submit
   *  rows are real, the aggregates are still a checkpoint's. */
  outcome:
    | "recorded"
    | "turn-bound"
    | "terminal-refusal"
    /** The round went `STALLED_TURNS` turns without a successful tool call. */
    | "no-progress"
    /** The run's model budget ran out inside the round. */
    | "budget-limited"
    | "turn-non-result"
    | "evidence-unavailable"
    | "in-flight"
    | "recorded-at-terminal";
  /** Present only when cleanup prevented a trustworthy final record. */
  lifecycle?: { kind: "evidence-unavailable"; phase: "session-dispose" };
  /** The controller terminal that closed this record; present exactly on `recorded-at-terminal`. */
  closure?: BuilderExecutionInvocation;
  /** The invocation that had already recorded its terminal when this record was written; such a
   *  late write is kept and named. */
  postTerminal?: BuilderExecutionInvocation;
  writtenAt: string;
}

type SubmitProjection = Pick<
  BuilderExecutionEvidence,
  | "firstSubmitMs"
  | "repeatedFindingSubmits"
  | "unchangedTreeSubmits"
  | "uniqueCandidateTrees"
  | "repeatedTreeSubmits"
  | "submitCounts"
>;

/** One gate's contribution to a refusal identity: who refused, what it said, and which finding
 *  codes and paths it carried. */
type SemanticGate = {
  owner: string;
  claim: string;
  /** Absent on a routing-only feedback row, which still contributes its owner and claim. */
  findings?: readonly (Pick<ContractFinding, "code" | "path" | "disclosure"> & { detail?: string })[];
};

/** The bytes a submission carried: `treeId` when the controller supplied one, else the commit. */
function submittedBytes(row: Pick<BuilderSubmitAttempt, "commit" | "treeId">): string {
  return row.treeId ?? row.commit;
}

/** The event rows retained in `submits`: controller stops stay visible but are not candidate data. */
export function isCandidateSubmit(row: Pick<BuilderSubmitAttempt, "kind">): boolean {
  return row.kind === "candidate";
}

/** The counts a record states beside its submit rows; the outcome reader refuses a record whose
 *  stated counts differ. */
export function submitProjection(submits: readonly BuilderSubmitAttempt[]): SubmitProjection {
  const candidateRows = submits.filter(isCandidateSubmit);
  return {
    firstSubmitMs: candidateRows[0]?.atMs ?? null,
    repeatedFindingSubmits: candidateRows.filter((s) => s.repeatedFindings === true).length,
    unchangedTreeSubmits: candidateRows.filter((s) => s.workspaceChanged === false).length,
    uniqueCandidateTrees: new Set(candidateRows.map(submittedBytes)).size,
    repeatedTreeSubmits: candidateRows.filter((s) => s.treeFirstSubmittedAsAttempt !== null).length,
    submitCounts: {
      raw: submits.length,
      candidates: candidateRows.length,
      controllerTerminals: submits.length - candidateRows.length,
    },
  };
}

/** Digest over a refusal's findings: codes and author-projected paths, in order. Withheld paths
 *  cannot move it, and detail is excluded because its text varies every round. */
export function findingsDigest(findings: readonly ContractFinding[]): string {
  return hashJsonValue(findings.map((f) => ({ code: f.code, path: projectFindingForAuthor(f).path })));
}

/** The repeat identity of one refusal: stage, gate owner and claim, sorted finding codes and
 *  author-projected paths, and the quoted ids (with any "N more" count) named in projected detail.
 *
 *  Raw per-finding free text is excluded because it carries per-execution values such as record
 *  UUIDs, which would make every repeat look new. The claim stays: it is the gate's own summary.
 *  Quoted ids stay so repairing one control of many under one code counts as progress. The
 *  controller and the outcome reader share this rule. */
export function semanticFindingsIdentity(gates: readonly SemanticGate[], stage: string | null): string {
  return hashJsonValue({
    stage,
    gates: gates
      .map(({ owner, claim, findings = [] }) => {
        const projected = findings.map((finding) => projectFindingForAuthor({ detail: "", ...finding }));
        return {
          owner,
          claim,
          codes: findings.map(({ code }) => code).sort(compareCodeUnits),
          paths: projected.map(({ path }) => path).sort(compareCodeUnits),
          ids: projected
            .flatMap(({ detail }) => [...detail.matchAll(/"[^"]+"|\d+ more/g)].map(([match]) => match))
            .sort(compareCodeUnits),
        };
      })
      .sort((a, b) => compareCodeUnits(capturedJsonStringify(a), capturedJsonStringify(b))),
  });
}

function add(total: number | null, value: number | null): number | null {
  return value === null ? total : (total ?? 0) + value;
}

/** The per-session collector. Nothing here reads back into the loop, so a recording mistake cannot
 *  change what the Builder may do. */
export class BuilderExecutionRecorder {
  private readonly byName: Record<string, number> = {};
  private readonly failedByName: Record<string, number> = {};
  private readonly submits: BuilderSubmitAttempt[] = [];
  private readonly turnRetries: TurnRetryRow[] = [];
  private readonly authoringReviews: BuilderExecutionEvidence["authoringReviews"] = [];
  private total = 0;
  private failed = 0;
  private turns = 0;
  private reportedTurns = 0;
  private estimatedTurns = 0;
  private inputTokens: number | null = null;
  private outputTokens: number | null = null;
  private costUsd: number | null = null;
  private firstToolMs: number | null = null;
  private backend: BackendId | null = null;
  private runtimeIdentity: RuntimeModelIdentity | null = null;
  private previous: { bytes: string; findingsDigest: string | null } | null = null;
  private readonly customCalls: BuilderCustomToolCall[] = [];
  private customCallsOmitted = 0;
  private readonly proseLog = new BuilderProseLog(() => this.since());
  private readonly running = new BuilderTurnObservation(() => this.since());
  private messagesThisTurn = 0;

  constructor(private readonly startedAt: number = Date.now()) {}

  /** One reasoning summary, as the transport surfaced it during the current turn. */
  reasoning(text: string): void {
    this.proseLog.push("reasoning", text, this.turns + 1);
  }

  /** One completed assistant message during the current turn, at its own observation time. */
  message(text: string): void {
    this.messagesThisTurn += 1;
    this.proseLog.push("message", text, this.turns + 1);
  }

  private since(): number {
    return Date.now() - this.startedAt;
  }

  /** The transport that actually opened, read once the session exists. */
  openedOn(backend: BackendId): void {
    this.backend = backend;
  }

  /** The first tool call's arrival time. */
  toolStarted(): void {
    this.firstToolMs ??= this.since();
  }

  /** Folds one tool event into the running turn. The settled result replaces this tally at
   *  `turnCompleted`; a turn killed first keeps what was folded. */
  turnToolEvent(event: Extract<AgentTurnEvent, { type: "tool_started" | "tool_ended" }>): void {
    if (event.type === "tool_started") {
      this.toolStarted();
      this.running.started(event);
      return;
    }
    this.running.ended(event, this.turns + 1);
  }

  /** Records one controller-hosted dispatch and returns its sequence for `customToolFinished`. */
  customToolStarted(
    name: string,
    args: Record<string, JsonValue> | undefined,
    turn: number = this.turns + 1,
  ): number | null {
    const tool = bareCustomToolName(name);
    if (!CUSTOM_TOOL_NAMES.has(tool)) return null;
    this.toolStarted();
    if (this.customCalls.length >= MAX_CUSTOM_CALL_RECEIPTS) {
      this.customCallsOmitted += 1;
      return null;
    }
    const intent = customCallIntent(tool, args);
    const sequence = this.customCalls.length + 1;
    this.customCalls.push({
      sequence,
      turn,
      tool,
      ...intent,
      startedAtMs: this.since(),
      durationMs: null,
      dispatchOutcome: "in-flight",
    });
    return sequence;
  }

  customToolFinished(sequence: number | null, ending: "threw" | "returned", result?: unknown): void {
    if (sequence === null) return;
    const call = this.customCalls[sequence - 1];
    if (call?.dispatchOutcome !== "in-flight") return;
    call.durationMs = call.startedAtMs === null ? null : Math.max(0, this.since() - call.startedAtMs);
    call.dispatchOutcome = ending;
    const semantic = semanticFromResult(result);
    if (semantic !== undefined) call.semantic = semantic;
  }

  /** One turn re-run after a transport failure; the retried attempt still folds through
   *  `turnCompleted`. */
  turnRetried(row: TurnRetryRow): void {
    this.turnRetries.push(row);
  }

  /** One authoring review that settled after a tool call and attached advice or failed. */
  authoringReviewed(turn: number, tool: string, adviceChars: number | null, reviewMs: number): void {
    this.authoringReviews.push({ turn, tool, adviceChars, reviewMs });
  }

  /** What the provider reported for one turn; absent fields stay unknown. An `estimated` turn ended
   *  without its provider terminal; it is still summed and counted in `estimatedTurns`. */
  reportedUsage(usage: TurnUsage, ending: "final" | "estimated"): void {
    this.reportedTurns += 1;
    if (ending === "estimated") this.estimatedTurns += 1;
    this.inputTokens = add(this.inputTokens, usage.inputTokens);
    this.outputTokens = add(this.outputTokens, usage.outputTokens);
    this.costUsd = add(this.costUsd, usage.costUsd);
  }

  /** Folds one completed turn; the result's tally owns the per-tool counts. */
  turnCompleted(result: AgentTurnResult): void {
    this.turns += 1;
    // OpenRouter has no completed-message events, so its completed turn is the fallback row.
    if (this.messagesThisTurn === 0 && result.assistantText !== undefined) {
      this.proseLog.push("message", result.assistantText, this.turns);
    }
    this.messagesThisTurn = 0;
    if (result.runtimeIdentity !== undefined) this.runtimeIdentity = result.runtimeIdentity;
    // Without a reported tally, the events this turn emitted are its only account.
    const calls = result.toolCalls ?? this.running.turnTally();
    this.running.turnSettled();
    this.total += calls.total;
    this.failed += calls.failed;
    for (const [name, count] of Object.entries(calls.byName)) {
      this.byName[name] = (this.byName[name] ?? 0) + count;
    }
    for (const [name, count] of Object.entries(calls.failedByName)) {
      this.failedByName[name] = (this.failedByName[name] ?? 0) + count;
    }
  }

  /** The session's closest tree so far: the earlier refusal at the same stage with the fewest
   *  finding codes, derived from the recorded rows. Lets the Builder see a regression. */
  fewestFindingsRefusal(
    stage: BuilderSubmitAttempt["stage"],
  ): { ordinal: number; commit: string; findings: number } | null {
    let best: BuilderSubmitAttempt | null = null;
    for (const row of this.submits) {
      if (!isCandidateSubmit(row) || row.outcome !== "refused" || row.stage !== stage) continue;
      if (best === null || row.findingCodes.length < best.findingCodes.length) best = row;
    }
    return best === null
      ? null
      : { ordinal: best.ordinal, commit: best.commit, findings: best.findingCodes.length };
  }

  /** Records a submission and compares it with the earlier ones. */
  recordSubmit(input: {
    experimentProposal?: ExperimentSubmission;
    kind?: BuilderSubmitAttempt["kind"];
    turn: number;
    outcome: "accepted" | "refused";
    stage: BuilderSubmitAttempt["stage"];
    commit: string;
    /** The submitted contract roots, when the controller resolved them. */
    treeId?: string;
    findings: readonly ContractFinding[];
    terminal: boolean;
  }): BuilderSubmitAttempt {
    const kind = input.kind ?? "candidate";
    const candidate = isCandidateSubmit({ kind });
    const digest = input.outcome === "accepted" ? null : findingsDigest(input.findings);
    // A controller terminal is a closure event, never a predecessor for candidate comparison.
    const previous = candidate ? this.previous : null;
    const bytes = submittedBytes(input);
    // Searched before this attempt joins the list, so it names an earlier candidate or nothing.
    const firstSame = candidate
      ? this.submits.find((row) => isCandidateSubmit(row) && submittedBytes(row) === bytes)
      : undefined;
    const codes = input.findings.map((f) => f.code);
    const prior = candidate ? this.submits.findLast(isCandidateSubmit) : undefined;
    const attempt: BuilderSubmitAttempt = {
      ...keyIfDefined("experimentProposal", input.experimentProposal),
      kind,
      ordinal: this.submits.length + 1,
      turn: input.turn,
      atMs: this.since(),
      outcome: input.outcome,
      stage: input.stage,
      commit: input.commit,
      ...keyIfDefined("treeId", input.treeId),
      findingsDigest: digest,
      findingCodes: codes,
      repeatedFindings: previous === null ? null : digest !== null && digest === previous.findingsDigest,
      findingsDelta: prior === undefined ? null : codeDelta(prior.findingCodes, codes),
      workspaceChanged: previous === null ? null : bytes !== previous.bytes,
      treeFirstSubmittedAsAttempt: firstSame?.ordinal ?? null,
      terminal: input.terminal,
    };
    this.submits.push(attempt);
    if (candidate) this.previous = { bytes, findingsDigest: digest };
    return attempt;
  }

  finish(
    outcome: BuilderExecutionEvidence["outcome"],
    lifecycle?: BuilderExecutionEvidence["lifecycle"],
  ): BuilderExecutionEvidence {
    // A record written mid-turn carries the running turn's calls; its settled tally replaces them.
    const open = this.running.turnTally();
    const byName = mergeCounts(this.byName, open.byName);
    let custom = 0;
    for (const [name, count] of Object.entries(byName)) {
      // The Claude backend names roster tools `mcp__harness__<name>`.
      if (CUSTOM_TOOL_NAMES.has(bareCustomToolName(name))) custom += count;
    }
    const total = this.total + open.total;
    const prose = this.proseLog.snapshot();
    const failedCalls = this.running.failedCalls();
    return {
      schema: BUILDER_EXECUTION_SCHEMA,
      backend: this.backend,
      runtimeIdentity: this.runtimeIdentity,
      turns: this.turns,
      durationMs: this.since(),
      toolCalls: {
        total,
        failed: this.failed + open.failed,
        byName,
        custom,
        native: total - custom,
      },
      usage: {
        inputTokens: this.inputTokens,
        outputTokens: this.outputTokens,
        costUsd: this.costUsd,
        reportedTurns: this.reportedTurns,
        estimatedTurns: this.estimatedTurns,
      },
      firstToolMs: this.firstToolMs,
      // Copied: finish() also runs per checkpoint, and an earlier snapshot must not grow.
      submits: [...this.submits],
      ...submitProjection(this.submits),
      partialTurn: open.total === 0 ? null : { turn: this.turns + 1, toolCalls: open },
      failedByName: mergeCounts(this.failedByName, open.failedByName),
      turnRetries: [...this.turnRetries],
      authoringReviews: this.authoringReviews.map((row) => ({ ...row })),
      failedCalls: failedCalls.rows,
      failedCallsOmitted: failedCalls.omitted,
      customCalls: this.customCalls.map((call) => {
        const target = { ...call.target };
        if (call.target.toolNames !== undefined) target.toolNames = [...call.target.toolNames];
        const copied = { ...call, target };
        if (call.semantic !== undefined) copied.semantic = { ...call.semantic };
        return copied;
      }),
      customCallsOmitted: this.customCallsOmitted,
      prose: prose.rows,
      proseOmitted: prose.omitted,
      outcome,
      writtenAt: new Date().toISOString(),
      ...keyIfDefined("lifecycle", lifecycle),
    };
  }
}
