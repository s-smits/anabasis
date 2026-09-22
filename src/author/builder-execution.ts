/**
 * The Builder execution record — what the Builder actually did inside its one session.
 *
 * `builder-session.json` describes the FIXED composition before model work: the roster, the isolations,
 * the framing digest. It cannot answer "what did the Builder do", and since native Read/Edit/Bash
 * calls stopped passing the path record, the record cannot answer it either. Run 35 is the
 * measurement of that gap: 43 minutes and 141 refused submissions left 19 record rows, six
 * observability rows, and one authoring non-result naming zero sessions. The only complete record was
 * the workspace git history, which no evidence read.
 *
 * The turn results carried most of the answer all along. Every session settles a per-turn
 * `(byName, failed, total)` tally (pi-session.ts) and reports provider spend on `turn_ended`; the driver read `status` and dropped the rest. This owner keeps that tally, the
 * spend, and the submission history as ONE evidence per session. A turn that never returns has no
 * settled tally, so `builder-turn-observation.ts` folds the running turn's own events beside it.
 *
 * It decides nothing. No threshold, gate, verdict or claim reads it, and it is never model-facing.
 * Unknown provider spend stays null rather than zero, so a transport that reports nothing says so
 * instead of appearing to have run for free.
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
  /** Whether this row records a real candidate tree or only a controller stop. The reader refuses
   *  a row that does not say, so no reader has to guess a stop from a commit that reads like one. */
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
  /** Content identity of the two contract roots at that commit, as `candidateTreeIdentity` reads
   *  them; absent on a controller stop, where readers fall back to the commit. A commit is not a
   *  byte identity: A -> B -> A settles at a third sha over the first tree, and a root-level note
   *  changes the sha over unchanged contract roots. The candidate
   *  memory keys its repeat strikes on this identity (`src/run/builder-campaign.ts`); so do the fields below. */
  treeId?: string;
  /** Digest over the refused findings; null on acceptance. */
  findingsDigest: string | null;
  /** Finding codes only. The detail text is already model-visible, but codes are what a repeat
   *  reads from, and keeping the record to codes leaves nothing to argue about. */
  findingCodes: string[];
  /** The previous submission carried the same findings digest; null when there was none. */
  repeatedFindings: boolean | null;
  /** Multiset comparison by finding code against the previous submission; null when there was
   *  none. The boolean above collapses every partial outcome: run 68's submit 3 read "same
   *  issues: no" while one class fell 50 to 15 and a new class arrived at 100. These counts are
   *  what the refusal text shows the Builder instead. */
  findingsDelta: { carried: number; resolved: number; introduced: number } | null;
  /** The contract roots moved since the previous submission; null when there was none. */
  workspaceChanged: boolean | null;
  /** Ordinal of the earliest submission that already carried these bytes; null when none did.
   *  The two fields above compare against the previous submission only, which is blind to a tree
   *  the session has returned to: run 35 ended byte-identical to its FIRST submission after 141
   *  attempts, and every depth-1 comparison along the way truthfully said the tree had changed. */
  treeFirstSubmittedAsAttempt: number | null;
  /** The refusal ended the session instead of costing one more turn. */
  terminal: boolean;
}

/** One retried authoring turn: a provider or transport failure that produced no build output,
 *  and the wait the controller took before running the same turn again. The row exists so a
 *  reviewer can see that a run survived a transient failure, and at what cost in provider turns;
 *  `turn-retry.ts` owns when one is written. */
export interface TurnRetryRow {
  /** The authoring role whose turn failed. */
  role: string;
  /** The session turn retried. Null stays for the outcome reader, which reads recorded sessions
   *  whose retry caller ran one turn per call. */
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
    /** How many of those turns never reached their own provider terminal, so their share of the
     *  totals is the transport's in-flight estimate: a streamed Claude frame's `usage` is not final,
     *  each frame repeats the whole cached input and none carries a cost, so a total with estimated
     *  turns in it bounds nothing (esp32 run 17f9de: four such epochs as 36.5M input, 3,317 output,
     *  no cost). */
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
  /** Distinct candidate trees submitted. The controller validates each one once, so this is also
   *  the number of times the probes and the adoption gates executed. */
  uniqueCandidateTrees: number;
  /** Submissions at a tree an earlier submission had already completed at, whether the session came
   *  straight back to it or returned through others. Reads with the field above: 17 submissions
   *  over 2 trees is the run-52 shape, and 15 of them cost no second execution. */
  repeatedTreeSubmits: number;
  /** The raw and candidate-only row counts. */
  submitCounts: BuilderSubmitCounts;
  /** The turn that was still running when this record was written, and what it had already done.
   *  Its calls are already inside `toolCalls`, while `turns` still counts settled turns only, so a
   *  record killed mid-turn says both how much work was recorded and that one turn never returned.
   *  Null when no turn was open. */
  partialTurn: { turn: number; toolCalls: BuilderTurnToolTally } | null;
  /** Turns re-run after a provider or transport failure that produced no build output. The
   *  retried attempts are inside `turns` and the provider budget: each one reserved and spent its
   *  own turn. */
  turnRetries: TurnRetryRow[];
  /** Authoring reviews that ran after a completed tool call: the advice characters attached to that
   *  tool's result (0 when it found nothing), or null when the review failed and the result went
   *  back unchanged, and how long the review held the session, which the call's own `durationMs`
   *  leaves out. */
  authoringReviews: Array<{ turn: number; tool: string; adviceChars: number | null; reviewMs: number }>;
  /** Failed tool calls by name. The aggregate above says how many failed; a name says which
   *  contract the session was fighting. */
  failedByName: Record<string, number>;
  /** Bounded identity for the failures the transport reported: which call, when, what it was asked
   *  and what came back. */
  failedCalls: BuilderFailedCall[];
  /** Failures beyond the bounded row list. `failedByName` above stays exact. */
  failedCallsOmitted: number;
  /** Ordered safe receipts for controller-hosted tools. */
  customCalls: BuilderCustomToolCall[];
  /** Calls beyond the bounded receipt list. Aggregate tool counts above remain exact. */
  customCallsOmitted: number;
  /** The Builder's messages and reasoning summaries. Held in memory on the evidence object and
   *  written to the `builder-prose.jsonl` sidecar, never into this JSON, so a record read back
   *  carries `proseCapture` in their place. */
  prose?: BuilderProseRow[];
  /** Rows beyond the prose log's bound. */
  proseOmitted?: number;
  /** Safe identity and cardinality join for the protected prose sidecar, which the writer adds
   *  when it writes the sidecar. The sidecar header repeats these fields and names this execution
   *  file. */
  proseCapture?: BuilderProseCapture;
  /** `in-flight` appears only on a checkpoint written while the session still runs; the settled
   *  write replaces it in place. A record left at `in-flight` belongs to a session the host killed
   *  before its finally ran — run A's SIGTERM erased 66 minutes of authoring evidence exactly this
   *  way, because the only write happened after the loop settled. `recorded-at-terminal` is that
   *  same record after the controller closed it at its own terminal: the submit rows are real, the
   *  aggregates are still a checkpoint's, and no `in-flight` record survives an invocation. */
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
  /** The invocation that had ALREADY recorded its terminal when this record was written. Run 25
   *  wrote sessions 2 and 4 eighteen and twenty-eight minutes after their invocations ended, into
   *  a campaign no controller still owned; such a write is kept and named rather than accepted
   *  silently. */
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
  /** Optional because a routing-only feedback row carries no findings; it contributes its owner
   *  and claim rather than dropping out of the identity. */
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

/** The counts a record states beside its submit rows. The writer records them, and the outcome
 *  reader refuses a record whose stated counts are not these. */
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

/** Digest over the findings a refusal returned: codes and author-projected paths, in order, so a
 *  withheld path such as a task location cannot move it. Detail is excluded for the same reason
 *  `semanticFindingsIdentity` excludes it: the published process facts and the "repeat n of m"
 *  steering vary the text every round. */
export function findingsDigest(findings: readonly ContractFinding[]): string {
  return hashJsonValue(findings.map((f) => ({ code: f.code, path: projectFindingForAuthor(f).path })));
}

/** The repeat identity of one refusal: stage, gate owner and claim, plus sorted finding codes and
 *  paths. Per-finding free text is excluded.
 *
 *  Free text cannot carry the identity. Run w26 refused five gate rounds with the same owner, the
 *  same claim and the same 357 findings, and the stall detector still read five different hashes:
 *  each `EXTERNAL_RESULT_UNBOUND` detail names its own record UUID, so 300 of the 357 differed in
 *  that one value and nothing else. The session spent 1h57m and $45.96 without ever repeating a
 *  hash. Dropping detail makes all five rounds byte-identical.
 *
 *  The claim stays in, because it is the gate's own summary of the diagnosis rather than a
 *  per-execution artefact: a gate that reports "finding 1" and then "finding 2" has changed its
 *  answer even when it names no finding rows at all.
 *
 *  Codes are never protected and stay raw; paths and ids are read from the author projection, so a
 *  withheld path or detail cannot split a repeat. The quoted ids it names stay in, with the count of ids past the first eight:
 *  census findings group every control under one code, so repairing 1 of 30 rejected accepts
 *  changes only those ids or that count. An unmarked finding projects to a fixed label and names
 *  none, so w26's record UUIDs still cannot split a repeat.
 *
 *  The controller and the outcome reader share this one rule, so a repeat cannot read as progress
 *  in the loop and as a repeat in the census. */
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

/**
 * The per-session collector. The driver calls the verbs; nothing here reads back into the loop,
 * so a recording mistake can never change what the Builder is allowed to do.
 */
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

  /** Fold one transport tool event into the turn that is still running: its tally, and the
   *  identity of the call when it failed. The settled result replaces this tally at `turnCompleted`,
   *  so nothing is counted twice; a turn the host kills first keeps what this already folded. */
  turnToolEvent(event: Extract<AgentTurnEvent, { type: "tool_started" | "tool_ended" }>): void {
    if (event.type === "tool_started") {
      this.toolStarted();
      this.running.started(event);
      return;
    }
    this.running.ended(event, this.turns + 1);
  }

  /** Record one real controller-hosted dispatch. Returns its sequence for the completion edge. */
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

  /** One turn re-run after a transport failure. The retried attempt still folds through
   *  `turnCompleted`, so the turn and spend counts keep naming every provider turn. */
  turnRetried(row: TurnRetryRow): void {
    this.turnRetries.push(row);
  }

  /** One authoring review that settled after a tool call and attached advice or failed. */
  authoringReviewed(turn: number, tool: string, adviceChars: number | null, reviewMs: number): void {
    this.authoringReviews.push({ turn, tool, adviceChars, reviewMs });
  }

  /** What the provider reported it spent on one turn. Absent fields stay unknown. `estimated`
   *  is a turn that ended without its own provider terminal, which is what the counts are
   *  qualified by; the numbers are still summed, because an estimate beats nothing. */
  reportedUsage(usage: TurnUsage, ending: "final" | "estimated"): void {
    this.reportedTurns += 1;
    if (ending === "estimated") this.estimatedTurns += 1;
    this.inputTokens = add(this.inputTokens, usage.inputTokens);
    this.outputTokens = add(this.outputTokens, usage.outputTokens);
    this.costUsd = add(this.costUsd, usage.costUsd);
  }

  /** Fold one completed turn: the accumulator's tally is the one owner of the per-tool counts. */
  turnCompleted(result: AgentTurnResult): void {
    this.turns += 1;
    // OpenRouter has no completed-message events, so its completed turn is the fallback row.
    if (this.messagesThisTurn === 0 && result.assistantText !== undefined) {
      this.proseLog.push("message", result.assistantText, this.turns);
    }
    this.messagesThisTurn = 0;
    if (result.runtimeIdentity !== undefined) this.runtimeIdentity = result.runtimeIdentity;
    // The accumulator's own tally owns the turn it closes. A transport that reported none leaves
    // the events this turn emitted as the only account of it, which is better than dropping them.
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
   *  finding codes. Derived on demand from the recorded rows rather than copied into the record
   *  duplicate what the submit list already proves). Run esp32-w33 wandered from 221 findings at
   *  submit 13 to 638 at submit 16 while every depth-1 comparison truthfully said the tree had
   *  changed; nothing named the regression, so the Builder could not know it had been closer. */
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

  /** Record a submission and compare it here, where the earlier submissions are already known. */
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
    // A controller terminal is a raw closure event, not a candidate comparison. It must not
    // become the predecessor for a later candidate or manufacture a tree repeat/delta.
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
      kind: input.kind ?? "candidate",
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
    // The running turn joins the settled ones here rather than at its own edge: a record written
    // mid-turn must carry the calls that turn has already made, and the turn's own settled tally
    // replaces this one when it returns.
    const open = this.running.turnTally();
    const byName = mergeCounts(this.byName, open.byName);
    let custom = 0;
    for (const [name, count] of Object.entries(byName)) {
      // The Claude backend interfaces roster tools as `mcp__harness__<name>`.
      const bare = bareCustomToolName(name);
      if (CUSTOM_TOOL_NAMES.has(bare)) custom += count;
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
      // Copied, not aliased: finish() also runs per checkpoint, and an earlier snapshot must
      // not grow when a later submission lands.
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
