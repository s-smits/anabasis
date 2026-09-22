/** Task-family applicability binds each control to its declared installed-tool evidence. */
import { keyIfDefined } from "../meta/optional-key.ts";
import { type Brief, applicableTruthChecks } from "./brief.ts";
import { environmentOwnedToolNonResult } from "./verifier-nonresult.ts";
import { EVALUATOR_FILE } from "../meta/bundle-layout.ts";

/** One required check/tool pair; the external name remains for historical readers. `adapterId` is the tool id. */
interface ExternalCheckBinding {
  checkId: string;
  adapterId: string;
  /** Which evidence the check declared. An `authored` row's tool is the candidate's own
   *  interpreter, so its launches attest execution and never independence. */
  kind?: "authored" | "external";
}

/** The evidence rows the verifier host recorded, read for the join alone. */
interface GroundingEvidenceRow {
  subjectId: string;
  checkId: string;
  toolId: string;
  outcome: string;
  attempt: number;
}

/** How the control runner settled one control: the attempt its receipt came from, and the host
 *  non-result kind when that attempt settled as one. A retry supersedes its first attempt. */
export interface SettledControl {
  attempt: number;
  hostNonResult: string | null;
}

/** A control and the task it binds. */
interface GroundedControl {
  id: string;
  taskId: string;
  hidden?: readonly { checkId: string }[];
  /** A reject's named check. It owes a completed tool run only for that check, since a hollow
   *  design another check refuses may leave the analysis unrun. */
  expectedCheckId?: string | null;
}

/** Task fields used to determine which checks apply. */
interface GroundedTask {
  taskId: string;
  family: string;
  hidden?: readonly { checkId: string }[];
}

/** A grounding row with the examples it names, so a consumer can match it to other rows by subject. */
export interface GroundingFinding {
  code: string;
  path: string;
  detail: string;
  controlIds: string[];
}

/** The finding code the census gate routes to the environment owner. */
export const TOOL_REFUSED_CODE = "verifier-tool-refused";

/**
 * One declared tool-grounded truth check as the control census actually exercised it.
 *
 * Two numbers, both host-measured: how often the host ran that tool for this check, and how many
 * reject controls the check itself blocked. An external check that never launches its tool, or
 * never rejects anything, otherwise reads as working until the paid battery is spent.
 */
export type ToolCheckCoverage = {
  checkId: string;
  toolId: string;
  /** Host-recorded runs of this exact (check, tool) pair. Read from the host's own evidence rows,
   *  never from anything the evaluator reported about itself. */
  attestedLaunches: number;
  /** Reject controls this check was the blocking check for. Recorded beside the launches so a
   *  reader can see both; the per-family reject census, not this row, owns discrimination. */
  rejects: number;
  /** The declared evidence kind, carried so an authored check over an installed interpreter is not
   *  read as a declared external instrument. */
  kind?: "authored" | "external";
};

/** Control receipt fields used to count reject coverage. */
interface CoverageReceipt {
  kind: "accept" | "reject";
  observedOutcome: string;
  observedBlockingCheckIds: readonly string[];
}

/** What running one declared check cost the control census: how many evaluations the host
 *  dispatched, their total wall time and how many tool runs the host attested for that check.
 *  Every field is a public authoring identity or the candidate's own evaluator running. */
export type CheckCost = { checkId: string; evaluations: number; totalMs: number; toolLaunches: number };

/**
 * Required check/tool pairs for a control. If its task is unknown, retain the complete set.
 * Another validator refuses the unknown task; this path must not treat an unresolved binding
 * as evidence that no tool execution is required.
 */
function externalChecksForControl(
  brief: Brief,
  externalChecks: readonly ExternalCheckBinding[],
  task: GroundedTask | undefined,
): readonly ExternalCheckBinding[] {
  if (task === undefined) return externalChecks;
  const marked = new Set(applicableTruthChecks(brief, task).map((check) => check.id));
  return externalChecks.filter((check) => marked.has(check.checkId));
}

/** One finding per external check with no completed tool run, naming the examples that owe one.
 *
 *  An accept always owes a completed run: passing without the tool is a hollow pass. A reject
 *  aimed at the check may be refused before the analysis runs (a design declaring no loss path
 *  cannot be analysed for member loss) once another reject aimed at that check
 *  completed a run, so the tool still takes part in rejecting something. A run the check started
 *  and did not complete is still owed on every example.
 *
 *  One row per check/tool pair, not per example: it states the total count and names up to eight
 *  examples, with the remaining count when necessary. */
export function unexecutedGroundingFindings(input: {
  brief: Brief;
  tasks: readonly GroundedTask[];
  controls: readonly GroundedControl[];
  /** The runner's settled observation per control id. Only rows of that attempt count, so an
   *  earlier refusal a retry superseded cannot decide the owner. A control with no settled
   *  observation has no rows. */
  settled: ReadonlyMap<string, SettledControl>;
  externalChecks: readonly ExternalCheckBinding[];
  evidence: readonly GroundingEvidenceRow[];
  path: string;
}): GroundingFinding[] {
  const { brief, controls, externalChecks, evidence, path } = input;
  const taskById = new Map(input.tasks.map((task) => [task.taskId, task]));
  const rowsOf = (control: GroundedControl, check: ExternalCheckBinding) =>
    evidence.filter(
      (row) =>
        row.subjectId === control.id &&
        row.checkId === check.checkId &&
        row.toolId === check.adapterId &&
        row.attempt === input.settled.get(control.id)?.attempt,
    );
  const aimedAt = (control: GroundedControl, check: ExternalCheckBinding) =>
    control.expectedCheckId === check.checkId;
  const toolDecidedReject = new Set(
    controls.flatMap((control) =>
      externalChecks
        .filter(
          (check) =>
            aimedAt(control, check) && rowsOf(control, check).some((row) => row.outcome === "executed"),
        )
        .map((check) => `${check.checkId}\u0000${check.adapterId}`),
    ),
  );
  const owed = new Map<string, { check: ExternalCheckBinding; kind: string; controlIds: string[] }>();
  const refused = new Map<string, { check: ExternalCheckBinding; kind: string; controlIds: string[] }>();
  for (const control of controls) {
    const applicable = externalChecksForControl(brief, externalChecks, taskById.get(control.taskId));
    const settled = input.settled.get(control.id);
    // A pair the host never ran for any example is inertToolFindings' one row, which the census
    // also returns, so it is skipped here rather than stated twice.
    for (const check of applicable.filter((pair) =>
      evidence.some((row) => row.checkId === pair.checkId && row.toolId === pair.adapterId),
    )) {
      if ((control.expectedCheckId ?? check.checkId) !== check.checkId) continue;
      const rows = rowsOf(control, check);
      if (rows.some((row) => row.outcome === "executed")) continue;
      if (
        rows.length === 0 &&
        aimedAt(control, check) &&
        toolDecidedReject.has(`${check.checkId}\u0000${check.adapterId}`)
      ) {
        continue;
      }
      // The check did call the tool and the host could not run it: that is the environment's
      // row, not a missing call. Only a control the runner settled as that refusal counts; a
      // timeout, crash or throw on the retry is the author's, and is still a call rather than a
      // missing one.
      const refusal =
        settled?.hostNonResult != null && environmentOwnedToolNonResult(settled.hostNonResult)
          ? rows.find((row) => environmentOwnedToolNonResult(row.outcome))
          : undefined;
      const bucket = refusal === undefined ? owed : refused;
      const kind = (refusal ?? rows[0])?.outcome ?? "";
      const key = `${check.checkId}\u0000${check.adapterId}\u0000${bucket === owed ? kind : ""}`;
      const prior = bucket.get(key);
      if (prior === undefined) bucket.set(key, { check, kind, controlIds: [control.id] });
      else prior.controlIds.push(control.id);
    }
  }
  const refusals = [...refused.values()].map(({ check, kind, controlIds }) => ({
    code: TOOL_REFUSED_CODE,
    path,
    controlIds,
    detail: `${controlIds.length} example(s) called tool "${check.adapterId}" for check "${check.checkId}" and the host could not run it (${kind}) after its retry: ${namedExamples(controlIds)}; the verifier environment owns this, not the correctness model`,
  }));
  return [
    ...refusals,
    ...[...owed.values()].map(({ check, kind, controlIds }) => ({
      code: "generated-external-grounding-unexecuted",
      path,
      controlIds,
      detail:
        kind === ""
          ? `${controlIds.length} example(s) of required check "${check.checkId}" returned with no run of tool "${check.adapterId}" launched (0 runs), although the check called it for other examples: ${namedExamples(controlIds)}; decide these through the tool too, or let a check that does not require the tool refuse them`
          : `${controlIds.length} example(s) called tool "${check.adapterId}" for required check "${check.checkId}" and the run did not complete (${kind}): ${namedExamples(controlIds)}; the call was made, so the run itself must complete`,
    })),
  ];
}

/** Every quoted id an author finding names, since a bare count leaves the Builder unable to find
 *  the rest. */
export function namedExamples(controlIds: readonly string[]): string {
  return controlIds.map((id) => `"${id}"`).join(", ");
}

/** The coverage rows, one per declared external check, over whatever host rows the caller scopes:
 *  admission passes the control census, the claim passes the runs on its verified cases. The
 *  launch count is the one owner of "this check's tool ran"; `rejects` names the reject controls
 *  the check blocked in that scope. */
export function toolCheckCoverage(input: {
  externalChecks: readonly ExternalCheckBinding[];
  evidence: ReadonlyArray<Pick<GroundingEvidenceRow, "checkId" | "toolId">>;
  rejects: (checkId: string) => number;
}): ToolCheckCoverage[] {
  return input.externalChecks.map((check) => ({
    checkId: check.checkId,
    toolId: check.adapterId,
    attestedLaunches: input.evidence.filter(
      (row) => row.checkId === check.checkId && row.toolId === check.adapterId,
    ).length,
    rejects: input.rejects(check.checkId),
    ...keyIfDefined("kind", check.kind),
  }));
}

/** The cost rows, dearest first. `spend` is the whole corpus summed per check, so no control,
 *  task or failure location survives into a row; a check absent from `spend` never ran. */
export function checkCostRows(
  spend: ReadonlyMap<string, { evaluations: number; totalMs: number }>,
  evidence: ReadonlyArray<Pick<GroundingEvidenceRow, "checkId">>,
): CheckCost[] {
  return [...spend]
    .map(([checkId, row]) => ({
      checkId,
      evaluations: row.evaluations,
      totalMs: row.totalMs,
      toolLaunches: evidence.filter((attested) => attested.checkId === checkId).length,
    }))
    .sort((left, right) => right.totalMs - left.totalMs);
}

/** Reject controls whose recorded failure named `checkId` as a blocking check. */
export function rejectsBlockedBy(receipts: readonly CoverageReceipt[], checkId: string): number {
  return receipts.filter(
    (receipt) =>
      receipt.kind === "reject" &&
      receipt.observedOutcome === "fail" &&
      receipt.observedBlockingCheckIds.includes(checkId),
  ).length;
}

/**
 * The admission refusal for an inert tool declaration, before any paid battery, and the readiness
 * clause for a declared check that ran on no verified case of a measured battery (`scope`).
 *
 * A check whose tool the host never ran decides by some other route than the one its grounding
 * names. The finding names public authoring identities only — check id, tool id and counts — so
 * the author is told which declaration to fix without any verifier output crossing.
 */
export function inertToolFindings(
  coverage: readonly ToolCheckCoverage[],
  scope = "the whole control census",
): { code: string; path: string; detail: string }[] {
  return coverage
    .values()
    .filter((row) => row.attestedLaunches === 0)
    .map((row) => ({
      code: "external-check-tool-unlaunched",
      path: EVALUATOR_FILE,
      detail: `Truth check "${row.checkId}" requires tool "${row.toolId}", but the host ran that tool 0 times for this check in ${scope}; ${row.rejects} reject control(s) of the control census name it as their blocking check. The check decides by another route than the one it names: call runtime.tools.run for this check, or remove the unused requirement from the check`,
    }))
    .toArray();
}
