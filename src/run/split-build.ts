/**
 * A split build (AGENTS.md "Owners and handoffs"): an answer agent writes the correctness model,
 * the controller hands its public projection to a Harness Builder, and the Harness Builder's
 * submit runs every gate on the two halves together.
 *
 * The sessions take turns rather than run side by side because the gate needs both halves. The
 * census and F2 run only on a candidate whose agent/ conforms, so a correctness-model finding
 * past the bundle stage surfaces only at a submit, and the Harness Builder is the side that
 * submits. The answer agent goes first, since the Harness Builder builds against the tasks it
 * publishes. When its pass ends the controller checks the correctness model alone, returns it
 * until it validates, and then writes the public projection. A submit refused only on the
 * correctness model hands it back with those findings; a submit refused on agent/ stays with the
 * Harness Builder. Neither session reads the other side's findings: the producers mark what is the
 * Harness Builder's (`markHarnessSide`), and the views here keep everything else from it.
 */
import type { PiTool } from "../backends/pi-session.ts";
import { BuilderConversation } from "../author/builder-conversation.ts";
import { type BuilderSessionDeps, runBuilderSession } from "../author/builder-session.ts";
import type { CampaignFeedback } from "../author/campaign-types.ts";
import { type CandidateCheckContext, loadValidatedBundle } from "../author/candidate-check.ts";
import { harnessOwned, onHarnessSide } from "../author/feedback-routing.ts";
import { PUBLIC_RESOURCES_FILE, PUBLIC_TASKS_FILE } from "../author/split-prompts.ts";
import { BuilderAuthorFeedback, authorFindingOverview } from "../builder/author-feedback.ts";
import { type ContractFinding, controllerValidatedFinding } from "../correctness-bundle/brief.ts";
import { briefPublicResources } from "../correctness-bundle/public-resources.ts";
import { commitPublicTask } from "../correctness-bundle/task-split.ts";
import type { GateReport } from "../gate/validation-pipeline.ts";
import { writeJsonFile } from "../meta/completed-json.ts";
import { mkdirSync } from "../meta/filesystem.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { keyIfDefined } from "../meta/optional-key.ts";
import { dirname, join } from "../meta/path.ts";

export type SplitSide = "harness" | "answer";

type BuilderSessionInput = Parameters<typeof runBuilderSession>[0];
type SessionOutcome = Awaited<ReturnType<typeof runBuilderSession>>;
type Submit = NonNullable<BuilderSessionDeps["submit"]>;

/** What one side's session adds to the round: the controller's authoring tools over that side's
 *  own feedback store, and the opening advice that side may read. */
type SideSession = { tools: readonly PiTool[]; advisory: string; freshContext: string };

interface SplitBuild {
  readonly wallMs: number;
  /** Each side's file tools, behind its own side of the wall. */
  readonly files: { readonly harness: readonly PiTool[]; readonly answer: readonly PiTool[] };
  /** The whole Builder's round, which each side's session narrows. */
  readonly input: BuilderSessionInput;
  readonly deps: BuilderSessionDeps & { submit: Submit };
  readonly context: CandidateCheckContext;
  /** One side's session, composed over its own feedback store and its own conversation. */
  readonly side: (
    side: SplitSide,
    feedback: BuilderAuthorFeedback,
    conversation: BuilderConversation | undefined,
  ) => SideSession;
  /** A fresh execution record for each answer pass. */
  readonly answerRecord: () => Pick<BuilderSessionDeps, "onExecution" | "onCheckpoint">;
  readonly stall: () => void;
}

/** How many answer passes one round may open before it ends as stalled. Each may spend its whole
 *  wall, so the bound also caps the round's answer time. */
const ANSWER_PASSES = 3;

/** The advice a Harness Builder's later pass opens with. */
const REVISED = `The answer agent revised the correctness model after your last submit, and ${PUBLIC_TASKS_FILE} now holds its projection; check agent/ against it and submit again.`;

/** The Harness Builder reads what its producers marked its own, and the controller's steering on
 *  its own submit. */
function harnessReads(finding: ContractFinding): boolean {
  return onHarnessSide(finding) || finding.path === "submit";
}

/** The gate rows one side hears; the whole Builder hears every row. */
export function sideRows(side: SplitSide | undefined, rows: readonly CampaignFeedback[]): CampaignFeedback[] {
  return side === undefined
    ? [...rows]
    : rows.filter((row) => harnessOwned(row.owner) === (side === "harness"));
}

/** How many findings a side's view left out, and whose they are. */
function withheldFinding(side: SplitSide, count: number): ContractFinding {
  const findings = `${String(count)} finding${count === 1 ? "" : "s"}`;
  return controllerValidatedFinding({
    code: "split-withheld",
    path: "split-build",
    detail:
      side === "harness"
        ? `Not shown here: ${findings} on the correctness model, which the answer agent repairs; a submit hands them over once none of yours remain.`
        : `Not shown here: ${findings} on agent/, which the Harness Builder repairs after your pass.`,
  });
}

/** A `correctness_check` report as one side reads it: its own refusal rows and a count of the rest,
 *  its own advisory rows, and for the Harness Builder no coverage or experiment summary, which
 *  describe the answer agent's checks, controls and files. */
export function sideView(report: GateReport, side: SplitSide): GateReport {
  const reads = side === "harness" ? harnessReads : (finding: ContractFinding) => !harnessReads(finding);
  const withheld = report.refusals.flatMap((row) => row.findings).filter((finding) => !reads(finding));
  const refusals = report.refusals
    .map(({ stage, findings }) => ({ stage, findings: findings.filter(reads) }))
    .filter((row) => row.findings.length > 0);
  const [first] = report.refusals;
  if (first !== undefined && withheld.length > 0) {
    refusals.push({ stage: first.stage, findings: [withheldFinding(side, withheld.length)] });
  }
  const { experiment, ...rest } = report;
  const gated =
    report.gated === null ? null : { ...report.gated, feedback: sideRows(side, report.gated.feedback) };
  const answerOnly = side === "answer" ? keyIfDefined("experiment", experiment) : {};
  return { ...rest, refusals, gated, harness: side === "answer" ? report.harness : null, ...answerOnly };
}

/** The Harness Builder's submit. A refusal with nothing of its own to repair hands the correctness
 *  model back and ends the pass; any other refusal keeps only the rows it may read. */
function harnessSubmit(submit: Submit, handBack: (findings: ContractFinding[]) => void): Submit {
  return async (request) => {
    const outcome = await submit(request);
    if (outcome.ok) return outcome;
    const own = outcome.findings.filter(harnessReads);
    const theirs = outcome.findings.filter((finding) => !harnessReads(finding));
    if (theirs.length === 0) return outcome;
    if (outcome.terminal === true || own.some((finding) => finding.path !== "submit")) {
      return { ...outcome, findings: [...own, withheldFinding("harness", theirs.length)] };
    }
    handBack(theirs);
    const detail = `The gate refused these bytes only on the correctness model, so its ${String(theirs.length)} finding${theirs.length === 1 ? " goes" : "s go"} back to the answer agent and this pass ends. You continue once its revised projection is in ${PUBLIC_TASKS_FILE}.`;
    return {
      ...outcome,
      terminal: true,
      findings: [controllerValidatedFinding({ code: "split-handed-back", path: "split-build", detail })],
    };
  };
}

function writePublic<T>(workspace: string, file: string, value: T): void {
  const path = join(workspace, file);
  mkdirSync(dirname(path), { recursive: true });
  writeJsonFile(path, value);
}

/** Check the correctness model alone and, when it validates, write what the Harness Builder builds
 *  against: each task's public projection, which is the solver's input, and the brief's public
 *  resources. Returns the findings that send the model back instead. */
function handOff(workspace: string, context: CandidateCheckContext): ContractFinding[] {
  const bundle = loadValidatedBundle(workspace, context, "admission");
  const theirs = bundle.findings.filter((finding) => !harnessReads(finding));
  if (theirs.length > 0) return theirs;
  const { brief, battery } = bundle;
  if (brief === null || battery === null) {
    const detail = "the brief or the tasks did not load, so there is no public projection to hand off";
    return [
      controllerValidatedFinding({ code: "split-model-incomplete", path: "correctness-model", detail }),
    ];
  }
  writePublic(
    workspace,
    PUBLIC_TASKS_FILE,
    battery.tasks.map((task) => commitPublicTask(task).view()),
  );
  writePublic(workspace, PUBLIC_RESOURCES_FILE, briefPublicResources(brief));
  return [];
}

/** One answer pass: one turn under the wall, in the answer agent's own conversation, opening on the
 *  findings that returned the model, which its feedback store also pages. */
function answerPass(
  split: SplitBuild,
  conversation: BuilderConversation,
  returned: readonly ContractFinding[],
) {
  const feedback = new BuilderAuthorFeedback();
  if (returned.length > 0) feedback.recordCheck("gates", returned);
  const side = split.side("answer", feedback, conversation);
  const back =
    returned.length === 0
      ? ""
      : `The correctness model came back with these findings:\n${capturedJsonStringify(authorFindingOverview(returned, undefined, undefined, "feedback"))}`;
  const { submit, beforeSubmit, recordSession, conversation: harnessConversation, ...shared } = split.deps;
  return runBuilderSession(
    {
      ...split.input,
      split: { role: "answer", wallMs: split.wallMs },
      maxTurns: 1,
      advisory: [side.advisory, back].filter(Boolean).join("\n\n"),
      freshContext: side.freshContext,
    },
    {
      ...shared,
      ...split.answerRecord(),
      conversation,
      tools: [...split.files.answer, ...side.tools],
      feedback,
    },
  );
}

/** One Harness Builder pass in the run's conversation, with no review beside it: the review reads
 *  the whole tree, correctness model included. Returns the findings its submit handed back, empty
 *  when the pass ended any other way. */
async function harnessPass(split: SplitBuild, pass: number) {
  const feedback = new BuilderAuthorFeedback();
  const side = split.side("harness", feedback, split.deps.conversation);
  const { afterTool, beforeSubmit, ...shared } = split.deps;
  let handedBack: ContractFinding[] = [];
  const submit = harnessSubmit(split.deps.submit, (findings) => {
    handedBack = findings;
  });
  const outcome = await runBuilderSession(
    {
      ...split.input,
      split: { role: "harness" },
      advisory: [pass > 1 ? REVISED : "", side.advisory].filter(Boolean).join("\n\n"),
      freshContext: side.freshContext,
    },
    { ...shared, tools: [...split.files.harness, ...side.tools], submit, feedback },
  );
  return { outcome, handedBack };
}

/** The round's sessions in turn, until the Harness Builder's submit settles or the passes run out. */
export async function runSplitBuild(split: SplitBuild): Promise<SessionOutcome> {
  const conversation = new BuilderConversation();
  let returned: ContractFinding[] = [];
  let last: SessionOutcome | null = null;
  try {
    for (let pass = 1; pass <= ANSWER_PASSES; pass += 1) {
      const answered = await answerPass(split, conversation, returned);
      if (answered.terminalClause !== null) return answered;
      returned = handOff(split.input.workspace, split.context);
      if (returned.length > 0) continue;
      const harness = await harnessPass(split, pass);
      last = harness.outcome;
      if (harness.handedBack.length === 0) return last;
      returned = harness.handedBack;
    }
  } finally {
    await conversation.close();
  }
  split.stall();
  return (
    last ?? {
      ok: false,
      fingerprint: null,
      turns: 0,
      validationAttempts: 0,
      terminal: true,
      terminalClause: null,
      findings: returned,
    }
  );
}
