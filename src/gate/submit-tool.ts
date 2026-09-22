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
import type { CandidateSnapshot } from "../author/candidate-check.ts";
import type { ExperimentSubmission } from "../author/experiment-proposal.ts";
import {
  type BuilderAuthorFeedback,
  FEEDBACK_NAVIGATION,
  authorFindingOverview,
} from "../builder/author-feedback.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { type ContractFinding, controllerValidatedFinding } from "../truth/brief.ts";

/** What the controller read the submitted bytes as: the identity of the two contract roots at the
 *  submitted commit. The record compares submissions on it, because a commit is not a byte identity
 *  (`src/author/builder-execution.ts`). A controller stop inspected no tree and carries none. */
interface SubmittedTree {
  treeId?: string;
}

/** A gate refusal carries recorded findings, projected where they are rendered. `terminal` marks a
 *  refusal another turn cannot or should not repair. */
export type BuilderSubmitOutcome =
  | (CandidateSnapshot & SubmittedTree)
  | ({
      ok: false;
      stage: "bundle" | "validation" | "gates";
      findings: ContractFinding[];
      commit: string;
      terminal?: boolean;
      /** A controller stop that did not validate or inspect a candidate tree. */
      kind?: "controller-terminal";
      experimentProposal?: ExperimentSubmission;
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

interface SubmitToolBinding {
  submit(input: { turn: number }): BuilderSubmitOutcome | Promise<BuilderSubmitOutcome>;
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
 * The first page of grouped repair findings. A probe that runs once per task can report the same
 * code, path and detail for each task; each group keeps its count, and the shared feedback store
 * holds the remaining pages, so the page limit hides no public repair text.
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
 * about itself: how the finding codes moved since the previous submit (run 68 was told "same
 * issues: no" while one class fell 50 to 15 and another arrived at 100), whether the files moved,
 * whether this exact tree was refused before (run 35 ended byte-identical to its first submission
 * after 141 attempts), and whether an earlier tree had fewer findings (w33 wandered from 221
 * to 638). All are facts about the Builder's own output or a bound set before model work began.
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
    // Adoption uses the accepted snapshot, so nothing later in this turn can change the accepted
    // product. `terminate` ends the round at this turn's boundary, before another model request.
    return {
      ...text(
        `Accepted. Agent ${outcome.fingerprint.agentHash.slice(0, 12)}, correctnessModel ${outcome.fingerprint.correctnessModelHash.slice(0, 12)}, ${outcome.changedPaths.length} changed paths. The candidate is fixed at this accepted tree: the build is complete, and later file edits are not part of it.`,
        { outcome: "accepted", candidateId: outcome.snapshotId },
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
    description:
      "Run the authoritative gates over the current candidate package and freeze its bytes if accepted. A refusal returns a bounded repair overview; read exact findings through harness_inspect feedback, repair coherently, then retry. An unchanged-tree retry is only for an explicit verifier-required settlement and may otherwise end the round.",
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
      // Sol run 23a1bc called submit five times inside one in-flight submit.
      if (inFlight) {
        return text(
          "Submit is already running; its verdict returns from that first call. Do not call submit again until it returns.",
          {
            outcome: "blocked",
            reason: "submit-in-flight",
          },
        );
      }
      state.attempts += 1;
      inFlight = true;
      try {
        return await settleSubmit(binding);
      } finally {
        inFlight = false;
      }
    },
  };
}
