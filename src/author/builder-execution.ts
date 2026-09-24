/**
 * The Builder execution record: what the Builder actually did inside its one session.
 *
 * `builder-session.json` describes the fixed composition before any model work — the roster, the
 * isolations, the framing digest — so it cannot answer "what did the Builder do", and without this
 * record the only complete account of a session is the workspace git history, which no evidence
 * reads. Every session already settles a per-turn `(byName, failed, total)` tally and reports
 * provider spend when a turn ends; this owner keeps that tally, the spend and the submission
 * history as one evidence per session, and `builder-turn-observation.ts` folds a running turn's own
 * events beside it, since a turn that never returns has no settled tally.
 *
 * It decides nothing: no threshold, gate, verdict or claim reads it, and it is never model-facing.
 * Unknown provider spend stays null rather than zero, so a transport that reported nothing says so
 * instead of appearing to have run for free.
 */
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { sha256OfFile } from "../meta/digest.ts";
import { existsSync } from "../meta/filesystem.ts";
import { join } from "../meta/path.ts";
import { EXPERIMENT_FILE, MEMORY_FILE, SCRATCHPAD_FILE } from "./builder-memory.ts";
import type { AgentTurnEvent, AgentTurnResult, TurnUsage } from "../backends/backend-types.ts";
import type { BackendKind } from "../backends/resolve.ts";
import type { RuntimeModelIdentity } from "../claim/runtime-model-identity.ts";
import type { BuilderExecutionInvocation } from "../run/builder-execution-closure.ts";
import type { ExperimentSubmission } from "./experiment-plan.ts";
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
export const BUILDER_EXECUTION_SCHEMA = "builder-execution/v6";

/** The workspace files one round leaves for the next. An accepted submit ends the turn, so the
 *  Builder writes no closing message; these files are its handover. */
export const HANDOVER_FILES = [EXPERIMENT_FILE, MEMORY_FILE, SCRATCHPAD_FILE] as const;

const MAX_CUSTOM_CALL_RECEIPTS = 512;

export interface BuilderSubmitAttempt {
  experimentProposal?: ExperimentSubmission;
  /** A real candidate tree, or only a controller stop. The outcome reader refuses a row that does
   *  not say, rather than leaving a reader to infer a stop from a commit that looks like one. */
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
   *  them; absent on a controller stop, where readers fall back to the commit. A commit sha is not a
   *  byte identity: A -> B -> A settles at a third sha over the first tree, and a root note changes
   *  the sha over unchanged roots. `builder-campaign.ts` keys its repeat strikes on this identity,
   *  and so do the three comparison fields below. */
  treeId?: string;
  /** Digest over the refused findings; null on acceptance. */
  findingsDigest: string | null;
  /** Finding codes only. The detail text is already model-visible, but codes are what a repeat
   *  reads from, and holding the record to codes leaves nothing to argue about. */
  findingCodes: string[];
  /** The previous submission carried the same findings digest; null when there was none. */
  repeatedFindings: boolean | null;
  /** Multiset comparison by finding code against the previous submission; null when there was none.
   *  The boolean above collapses every partial outcome into one bit — one class falling from 50 to
   *  15 while another arrives at 100 reads as "same issues: no" — so the refusal text shows these
   *  three counts instead. */
  findingsDelta: { carried: number; resolved: number; introduced: number } | null;
  /** The contract roots moved since the previous submission; null when there was none. */
  workspaceChanged: boolean | null;
  /** Ordinal of the earliest submission that already carried these bytes; null when none did. The
   *  two fields above compare against the previous submission only, so a session that wanders away
   *  from a tree and back reads as changed at every step. */
  treeFirstSubmittedAsAttempt: number | null;
  /** The refusal ended the session instead of costing one more turn. */
  terminal: boolean;
}

/** One retried authoring turn: a provider or transport failure that produced no build output, and
 *  the wait before the same turn ran again. Retried attempts are indistinguishable from ordinary
 *  turns in every other count, so this row is what says a run survived a transient failure and at
 *  what cost in provider turns. `turn-retry.ts` owns when one is written. */
export interface TurnRetryRow {
  /** The authoring role whose turn failed. */
  role: string;
  /** The session turn retried. */
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
  backend: BackendKind | null;
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
     *  totals above is the transport's in-flight estimate rather than the provider's account. A
     *  streamed frame's `usage` is not final, each frame repeats the whole cached input and none of
     *  them carries a cost, so a total holding estimated turns bounds nothing in either direction. */
    estimatedTurns: number;
  };
  /** Milliseconds from session start to the first tool call; null when the Builder called none. */
  firstToolMs: number | null;
  /** Every submission in order. The counts a reader wants over them are `submitProjection`'s, derived
   *  from these rows when read rather than stored beside them. */
  submits: BuilderSubmitAttempt[];
  /** The turn that was still running when this record was written, and what it had already done.
   *  Its calls are already inside `toolCalls`, while `turns` still counts settled turns only, so a
   *  record killed mid-turn says both how much work was recorded and that one turn never returned.
   *  Null when no turn was open. */
  partialTurn: { turn: number; toolCalls: BuilderTurnToolTally } | null;
  /** Turns re-run after a provider or transport failure that produced no build output. The retried
   *  attempts are inside `turns` and the provider budget, because each one reserved and spent its
   *  own turn. */
  turnRetries: TurnRetryRow[];
  /** Authoring reviews that ran after a completed tool call: the advice characters attached to that
   *  tool's result (0 when the review found nothing, null when it failed and the result went back
   *  unchanged), and how long the review held the session, which the call's `durationMs` omits. */
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
  /** The Builder's messages and reasoning summaries. They are held in memory on the evidence object
   *  and written to the `builder-prose.jsonl` sidecar, never into this JSON, so a record read back
   *  carries `proseCapture` in their place. */
  prose?: BuilderProseRow[];
  /** Rows beyond the prose log's bound. */
  proseOmitted?: number;
  /** The identity and row counts that join this record to the protected prose sidecar, added by the
   *  writer when it writes that sidecar. The sidecar's own header repeats these fields and names
   *  this execution file, so either half can be checked against the other. */
  proseCapture?: BuilderProseCapture;
  /** `in-flight` appears only on a checkpoint written while the session is still running, and the
   *  settled write replaces it in place. A record left at `in-flight` belongs to a session the host
   *  killed before its finally ran, which is why the checkpoints exist: a single write after the
   *  loop settles loses the whole session. `recorded-at-terminal` is that record after the
   *  controller closed it at its own terminal — the submit rows are real, the aggregates are still
   *  a checkpoint's, and no `in-flight` record survives an invocation. */
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
  /** sha256 of each file the Builder hands to its next round, read from the workspace when this
   *  record was written, and null where the file was absent. Absent on a record whose recorder was
   *  given no workspace. The files are the Builder's own and nothing is served from here: the
   *  digests say whether a round changed its plan and notes, and which bytes the next one opened on. */
  handovers?: Record<(typeof HANDOVER_FILES)[number], string | null>;
  /** Present only when cleanup prevented a trustworthy final record. */
  lifecycle?: { kind: "evidence-unavailable"; phase: "session-dispose" };
  /** The controller terminal that closed this record; present exactly on `recorded-at-terminal`. */
  closure?: BuilderExecutionInvocation;
  /** The invocation that had already recorded its terminal when this record was written. A session
   *  can settle minutes after its invocation ended, into a campaign no controller still owns; that
   *  write is kept and named rather than accepted silently as part of the live run. */
  postTerminal?: BuilderExecutionInvocation;
  writtenAt: string;
}

/** The counts a reader derives from a record's submit rows. */
interface SubmitProjection {
  /** Milliseconds from session start to the first submission; null when it never submitted. */
  firstSubmitMs: number | null;
  /** Submissions whose findings digest repeated the submission before it. */
  repeatedFindingSubmits: number;
  /** Submissions completed at the previous submission's commit. */
  unchangedTreeSubmits: number;
  /** Distinct candidate trees submitted. The controller validates each one once, so this is also
   *  the number of times the conformance probes and the adoption gates actually executed. */
  uniqueCandidateTrees: number;
  /** Submissions at a tree an earlier submission had already completed at, whether the session came
   *  straight back to it or wandered. Read with the field above, it says how many submissions cost
   *  no second execution. */
  repeatedTreeSubmits: number;
  /** The raw and candidate-only row counts. */
  submitCounts: BuilderSubmitCounts;
}

/** One gate's contribution to a refusal identity: who refused, what it said, and which finding
 *  codes and paths it carried. */
type SemanticGate = {
  owner: string;
  claim: string;
  /** Optional because a routing-only feedback row carries no findings; it contributes its owner and
   *  claim rather than dropping out of the identity altogether. */
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

/** The counts over a record's submit rows, derived where they are read so no stored copy can
 *  disagree with the rows it summarises. */
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
 *  withheld path such as a task location cannot move it. Detail is excluded because the published
 *  process facts and the "repeat n of m" steering vary that text every round, which would make
 *  every repeat look new. */
export function findingsDigest(findings: readonly ContractFinding[]): string {
  return hashJsonValue(findings.map((f) => ({ code: f.code, path: projectFindingForAuthor(f).path })));
}

/** The repeat identity of one refusal: stage, gate owner and claim, sorted finding codes and
 *  author-projected paths, and the quoted ids named in the projected detail. Raw per-finding free
 *  text is excluded, because it cannot carry an identity: a finding detail that names its own record
 *  UUID gives five byte-identical gate rounds five different hashes, and the stall detector then
 *  never fires however long the session spends.
 *
 *  The claim stays in, because it is the gate's own summary of its diagnosis rather than a
 *  per-execution artefact: a gate reporting "finding 1" and then "finding 2" has changed its answer
 *  even when it names no finding rows. Codes are never protected and stay raw, while paths and ids
 *  come from the author projection, so a withheld path cannot split a repeat. The quoted ids stay
 *  because census findings group every control under one code, and repairing 1 of 30 rejected
 *  accepts changes only those ids; an unmarked finding projects to a fixed label and names none.
 *
 *  The controller and the outcome reader share this one rule, so the same refusal cannot read as
 *  progress in the loop and as a repeat in the census. */
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

function handoverDigests(workspace: string): NonNullable<BuilderExecutionEvidence["handovers"]> {
  const digest = (name: string): string | null => {
    const path = join(workspace, name);
    return existsSync(path) ? sha256OfFile(path) : null;
  };
  return {
    [EXPERIMENT_FILE]: digest(EXPERIMENT_FILE),
    [MEMORY_FILE]: digest(MEMORY_FILE),
    [SCRATCHPAD_FILE]: digest(SCRATCHPAD_FILE),
  };
}

/** The per-session collector. The driver calls the verbs and nothing here reads back into the loop,
 *  which is what keeps a recording mistake from ever changing what the Builder is allowed to do. */
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
  private backend: BackendKind | null = null;
  private runtimeIdentity: RuntimeModelIdentity | null = null;
  private previous: { bytes: string; findingsDigest: string | null } | null = null;
  private readonly customCalls: BuilderCustomToolCall[] = [];
  private customCallsOmitted = 0;
  private workspace: string | null = null;
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

  /** The prompt the controller sends to open the next turn. */
  prompt(text: string): void {
    this.proseLog.push("prompt", text, this.turns + 1);
  }

  private since(): number {
    return Date.now() - this.startedAt;
  }

  /** The transport that actually opened, read once the session exists. */
  openedOn(backend: BackendKind): void {
    this.backend = backend;
  }

  /** The workspace whose handover files every later record digests. */
  handoversIn(workspace: string): void {
    this.workspace = workspace;
  }

  /** The first tool call's arrival time. */
  toolStarted(): void {
    this.firstToolMs ??= this.since();
  }

  /** Folds one transport tool event into the turn still running: its tally, and the identity of the
   *  call when it failed. `turnCompleted` replaces this tally with the settled one, so nothing is
   *  counted twice and a turn the host kills first keeps what was already folded. */
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

  /** One turn re-run after a transport failure. The retried attempt still folds through
   *  `turnCompleted`, so the turn and spend counts go on naming every provider turn that was paid
   *  for, and the row beside them is what says which of those turns bought nothing. */
  turnRetried(row: TurnRetryRow): void {
    this.turnRetries.push(row);
  }

  /** One authoring review that settled after a tool call and attached advice or failed. */
  authoringReviewed(turn: number, tool: string, adviceChars: number | null, reviewMs: number): void {
    this.authoringReviews.push({ turn, tool, adviceChars, reviewMs });
  }

  /** What the provider reported it spent on one turn; absent fields stay unknown. An `estimated`
   *  turn ended without its own provider terminal. Its numbers are still summed, because an
   *  estimate beats nothing so long as `estimatedTurns` says how much of the total is estimate. */
  reportedUsage(usage: TurnUsage, ending: "final" | "estimated"): void {
    this.reportedTurns += 1;
    if (ending === "estimated") this.estimatedTurns += 1;
    this.inputTokens = add(this.inputTokens, usage.inputTokens);
    this.outputTokens = add(this.outputTokens, usage.outputTokens);
    this.costUsd = add(this.costUsd, usage.costUsd);
  }

  /** Folds one completed turn. The result's own tally is the single owner of the per-tool counts,
   *  so the running observation is discarded rather than added to it. */
  turnCompleted(result: AgentTurnResult): void {
    this.turns += 1;
    // OpenRouter has no completed-message events, so its completed turn is the fallback row.
    if (this.messagesThisTurn === 0 && result.assistantText !== undefined) {
      this.proseLog.push("message", result.assistantText, this.turns);
    }
    this.messagesThisTurn = 0;
    for (const { tokensBefore, compacted, summary } of result.compactions ?? []) {
      const head = `tokensBefore=${tokensBefore} compacted=${compacted}`;
      this.proseLog.push("compaction", summary === undefined ? head : `${head}\n\n${summary}`, this.turns);
    }
    if (result.runtimeIdentity !== undefined) this.runtimeIdentity = result.runtimeIdentity;
    // A transport that reported no tally leaves the events this turn emitted as the only account
    // of it, so the turn's calls are taken from them rather than dropped.
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
   *  finding codes, derived on demand rather than kept as a second copy of what the submit rows
   *  already prove. A session can wander from 221 findings to 638 while every depth-1 comparison
   *  truthfully says the tree changed, so without this the Builder cannot know it was once closer. */
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

  /** Records a submission and compares it here, where the earlier submissions are already known. */
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
    // A controller terminal is a raw closure event, not a candidate comparison, so it must not
    // become the predecessor of a later candidate and manufacture a tree repeat or a delta.
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
    // The running turn joins the settled ones here rather than at its own edge, because a record
    // written mid-turn must carry the calls that turn has already made; its settled tally replaces
    // this one when it returns.
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
      // Copied, not aliased: finish() also runs per checkpoint, and an earlier snapshot must not
      // grow when a later submission lands.
      submits: [...this.submits],
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
      ...keyIfDefined("handovers", this.workspace === null ? undefined : handoverDigests(this.workspace)),
      ...keyIfDefined("lifecycle", lifecycle),
    };
  }
}
