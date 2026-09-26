/**
 * The Builder's `submit`: the only acceptance path. It asks the controller-bound submission for a
 * verdict on the current workspace, records the attempt, and shapes the one text the model reads.
 * A refusal keeps the session unless it is final; acceptance fixes the candidate and closes the
 * running turn.
 */
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import type {
  BuilderCustomToolSemantic,
  BuilderExecutionRecorder,
  BuilderSubmitAttempt,
} from "../author/builder-execution.ts";
import { type CandidateSnapshot, conditionKey } from "../author/candidate-check.ts";
import type { ExperimentSubmission } from "../author/experiment-plan.ts";
import {
  type AuthorCheckStage,
  type BuilderAuthorFeedback,
  FEEDBACK_NAVIGATION,
  authorFindingOverview,
} from "../builder/author-feedback.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { type ContractFinding, controllerValidatedFinding } from "../truth/brief.ts";

/** What the controller read the submitted bytes as: the identity of the two contract roots at the
 *  submitted commit. The execution record compares submissions on this rather than on the commit,
 *  because a commit is not a byte identity — `submittedBytes` in `src/author/builder-execution.ts`
 *  falls back to the commit only where no tree identity was supplied. A controller stop inspected
 *  no tree and carries none. */
interface SubmittedTree {
  treeId?: string;
}

/** A gate refusal carries recorded findings, projected where they are rendered. `terminal` marks a
 *  refusal another turn cannot or should not repair. */
export type BuilderSubmitOutcome =
  | (CandidateSnapshot & SubmittedTree)
  | ({
      ok: false;
      stage: AuthorCheckStage;
      findings: ContractFinding[];
      commit: string;
      terminal?: boolean;
      /** A controller stop that did not validate or inspect a candidate tree. */
      kind?: "controller-terminal";
      experimentProposal?: ExperimentSubmission;
      /** Where the plan and this round's rehearsals disagree: advice, never a refusal. */
      advice?: readonly string[];
    } & SubmittedTree);

type Refused = Extract<BuilderSubmitOutcome, { ok: false }>;

/** The session state submit reads and settles; one per Builder session. */
interface SubmitSessionState {
  accepted: CandidateSnapshot | null;
  attempts: number;
  lastRefusal: ContractFinding[];
  activeTurn: number;
  terminal: boolean;
  submitBound: boolean;
}

const SUBMIT_BOUND_CODE = "submit-bound";

/** Submit takes no arguments: it always judges the whole current workspace. */
const SubmitParams = Type.Object({}, { additionalProperties: false });

/** The settlement the controller declares after repeated tool non-results is never named here: a
 *  Builder told it is an answer resubmits the same tree to reach it. What an unchanged resubmit
 *  actually meets is the remembered refusal and its no-op strike (candidate-memory.ts); a retryable
 *  non-result is neither remembered nor struck. */
export const SUBMIT_DESCRIPTION =
  "Run the authoritative gates over the current candidate package and freeze its bytes if accepted. A refusal returns a bounded repair overview; read exact findings through harness_inspect feedback, repair them, then retry. A refused candidate resubmitted with its files and installed tools unchanged returns the same refusal and counts toward ending the round; one refused by a runtime non-result may be retried as it is.";

interface SubmitToolBinding {
  submit(input: { turn: number }): BuilderSubmitOutcome | Promise<BuilderSubmitOutcome>;
  /** Asked before any attempt is counted. Text it returns is this call's whole result: nothing was
   *  submitted, and no attempt is recorded. */
  hold?: () => Promise<string | null>;
  state: SubmitSessionState;
  recorder: BuilderExecutionRecorder;
  /** The operator's turn cap, which also bounds refused submits; absent, the round has none. */
  maxTurns?: number;
  feedback: BuilderAuthorFeedback;
}

/** The refused-submit half of `maxTurns`: a refusal at the bound becomes final. */
function atSubmitBound(outcome: Refused, attempts: number, maxTurns: number | undefined): Refused {
  if (outcome.terminal === true || maxTurns === undefined || attempts < maxTurns) return outcome;
  const bound = controllerValidatedFinding({
    code: SUBMIT_BOUND_CODE,
    path: "submit",
    detail: `submit ${attempts} of ${maxTurns}: the round's submit bound is reached; this refusal is final and the round ends here`,
  });
  return { ...outcome, terminal: true, findings: [...outcome.findings, bound] };
}

/**
 * The first page of grouped repair findings. A probe that runs once per task reports the same code
 * and path for every task it touches, so those rows fold into one group that carries its count
 * instead of filling the page; the shared feedback store holds the remaining pages, so the page
 * limit hides no public repair text from the Builder.
 */
function repairUnits(findings: readonly ContractFinding[], repair: "actionable" | "final"): string[] {
  const page = authorFindingOverview(findings);
  const rows = page.groups.flatMap((group) => {
    const multiplicity = group.count === 1 ? "" : ` ×${group.count}`;
    const cut = group.code.complete && group.path.complete && group.detail.complete ? "" : "…";
    return [
      `- group ${group.group}${multiplicity} ${group.code.text} ${group.path.text}: ${group.detail.text}${cut}`,
      ...(group.variantIndex ?? []).map((line) => `    · ${line}`),
    ];
  });
  const range = `Showing repair groups ${page.from}-${page.to} of ${page.totalGroups} (${page.totalFindings} finding rows).`;
  return [range, ...rows, ...(repair === "actionable" ? [FEEDBACK_NAVIGATION] : [])];
}

/**
 * The refusal the model reads. Beyond the findings it states what a repeating Builder cannot see
 * about itself: how the finding codes moved since the previous submit, since a bare "same issues:
 * no" hides one class falling from 50 to 15 while another arrives at 100; whether the files moved
 * at all; whether this exact tree was already refused once, which is how a session ends
 * byte-identical to its first submission after a hundred attempts; and whether an earlier tree
 * carried fewer findings, since a session can wander from 221 findings to 638 while every
 * comparison truthfully says the tree changed. Each is a fact about the Builder's own output, or
 * about a set bound before model work began.
 */
export function renderRefusal(
  outcome: Refused,
  attempt: BuilderSubmitAttempt,
  maxTurns: number | undefined,
  closest: { ordinal: number; commit: string; findings: number } | null,
): string {
  const prior = attempt.ordinal - 1;
  const delta = attempt.findingsDelta;
  const history =
    delta === null
      ? []
      : [
          `finding codes against submit ${prior}: ${delta.carried} carried over, ${delta.resolved} resolved, ${delta.introduced} new`,
          `agent/ or correctness-model/ changed since submit ${prior}: ${attempt.workspaceChanged === true ? "yes" : "no"}`,
        ];
  const first = attempt.treeFirstSubmittedAsAttempt;
  const echo =
    first !== null && first < prior ? [`these exact files were already refused in submit ${first}`] : [];
  const drift =
    closest !== null && outcome.findings.length > closest.findings
      ? [
          `your closest tree so far is submit ${closest.ordinal} (commit ${closest.commit.slice(0, 12)}, ${closest.findings} finding${closest.findings === 1 ? "" : "s"}); this tree has ${outcome.findings.length} — consider diffing against it before rewriting further`,
        ]
      : [];
  const of = maxTurns === undefined ? "" : ` of ${maxTurns}`;
  return [
    `Submit ${attempt.ordinal} was refused at ${outcome.stage} (turn ${attempt.turn}${of}, submit ${attempt.ordinal}${of}).${outcome.terminal === true ? " This refusal is final; no further submit is possible." : ""}`,
    ...repairUnits(outcome.findings, outcome.terminal === true ? "final" : "actionable"),
    ...history,
    ...echo,
    ...drift,
    ...(outcome.advice ?? []),
  ].join("\n");
}

const text = (value: string, receipt: BuilderCustomToolSemantic) => ({
  content: [{ type: "text" as const, text: value }],
  details: { receipt },
});

async function settleSubmit(binding: SubmitToolBinding) {
  const { state, recorder, maxTurns } = binding;
  const raw = await binding.submit({ turn: state.activeTurn });
  const outcome = raw.ok ? raw : atSubmitBound(raw, state.attempts, maxTurns);
  if (!outcome.ok && outcome.findings.some((finding) => finding.code === SUBMIT_BOUND_CODE)) {
    state.submitBound = true;
  }
  // Read before this attempt joins the record, so it names a strictly earlier submission.
  const closest = outcome.ok ? null : recorder.fewestFindingsRefusal(outcome.stage);
  const attempt = recorder.recordSubmit({
    ...keyIfDefined("experimentProposal", outcome.experimentProposal),
    kind: outcome.ok ? "candidate" : (outcome.kind ?? "candidate"),
    turn: state.activeTurn,
    outcome: outcome.ok ? "accepted" : "refused",
    stage: outcome.ok ? null : outcome.stage,
    commit: outcome.commit,
    ...keyIfDefined("treeId", outcome.treeId),
    findings: outcome.ok ? outcome.advisories : outcome.findings,
    terminal: outcome.ok ? false : outcome.terminal === true,
  });
  if (outcome.ok) {
    state.accepted = outcome;
    // Adoption uses the accepted snapshot, so nothing written later in this turn can change the
    // accepted product; `terminate` ends the round at this turn's boundary, before another model
    // request could try.
    return {
      ...text(
        `Accepted. Agent ${outcome.fingerprint.agentHash.slice(0, 12)}, correctnessModel ${outcome.fingerprint.correctnessModelHash.slice(0, 12)}, ${outcome.changedPaths.length} changed paths. The candidate is fixed at this accepted tree: the build is complete, and later file edits are not part of it.`,
        { outcome: "accepted", candidateId: outcome.snapshotId, conditionId: conditionKey(outcome) },
      ),
      terminate: true,
    };
  }
  state.lastRefusal = outcome.findings;
  binding.feedback.record(
    { attempt: attempt.ordinal, turn: attempt.turn, stage: outcome.stage, commit: outcome.commit },
    outcome.findings,
  );
  state.terminal ||= outcome.terminal === true;
  return {
    ...text(renderRefusal({ ...outcome, terminal: state.terminal }, attempt, maxTurns, closest), {
      outcome: "refused",
      stage: outcome.stage,
      findings: outcome.findings.length,
      ...keyIfDefined(
        "findingCodes",
        outcome.findings.length === 0
          ? undefined
          : [...new Set(outcome.findings.map((finding) => finding.code))].sort(),
      ),
      ...keyIfDefined("reason", state.terminal ? "terminal-refusal" : undefined),
    }),
    terminate: state.terminal,
  };
}

export function makeSubmitTool(binding: SubmitToolBinding): AgentTool<typeof SubmitParams> {
  const { state } = binding;
  let inFlight = false;
  return {
    name: "submit",
    label: "submit",
    description: SUBMIT_DESCRIPTION,
    parameters: SubmitParams,
    async execute() {
      if (state.accepted !== null) {
        return text("Already accepted. Nothing was submitted a second time.", {
          outcome: "terminal-closed",
          reason: "accepted",
        });
      }
      if (state.terminal) {
        return text("Submit has already ended with a final controller refusal.", {
          outcome: "terminal-closed",
          reason: "terminal-refusal",
        });
      }
      // A model does call submit again while the first call is still running, several times over.
      // Each such call would otherwise capture the workspace again and record its own attempt
      // against bytes already under judgement.
      if (inFlight) {
        return text(
          "Submit is already running; its verdict returns from that first call. Do not call submit again until it returns.",
          {
            outcome: "blocked",
            reason: "submit-in-flight",
          },
        );
      }
      inFlight = true;
      try {
        const held = binding.hold === undefined ? null : await binding.hold();
        if (held !== null) return text(held, { outcome: "blocked", reason: "review-unread" });
        state.attempts += 1;
        return await settleSubmit(binding);
      } finally {
        inFlight = false;
      }
    },
  };
}
