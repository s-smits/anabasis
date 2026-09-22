import { existsSync } from "../../src/meta/filesystem.ts";
import { join } from "../../src/meta/path.ts";
import type { BuilderCustomToolCall } from "../../src/author/builder-execution.ts";
import { builderToolsReport, type EpochToolCensus } from "./builder-tools.ts";
import {
  foldWorkshopFacts,
  readWorkshopActionFacts,
  WORKSHOP_ACTION_FILE,
  type WorkshopActionFact,
} from "./builder-workshop-facts.ts";

export interface WorkshopJourneyJoin {
  epoch: string;
  actionEvidence: number;
  receipts: number;
  status: "joined" | "count-mismatch" | "action-mismatch" | "receipt-mismatch" | "ambiguous";
  failures: Array<{
    session: number;
    receiptSequence: number;
    tool: "public_source" | "verifier_workshop";
    action: string;
    outcome: "failed" | "non-result";
    reason: string | null;
    before: string[];
    after: string[];
  }>;
}

export interface CampaignSelection {
  campaignDir: string;
  epoch: string | null;
  writtenBefore: string | null;
}

interface WorkshopReceipt {
  call: BuilderCustomToolCall;
  callIndex: number;
  calls: BuilderCustomToolCall[];
  session: number;
}

interface ReceiptSequenceJoin {
  receipts: readonly WorkshopReceipt[];
  status: "joined" | "receipt-mismatch" | "ambiguous";
}

/** Join each action to the receipt carrying its host sequence. Two receipts claiming one sequence,
 *  or a receipt naming none, leave the order the only pairing, which is exactly what the sequence
 *  replaced: the join says so rather than guessing. */
function receiptsBySequence(
  facts: readonly WorkshopActionFact[],
  receipts: readonly WorkshopReceipt[],
): ReceiptSequenceJoin {
  if (facts.length === 0) return { receipts, status: "joined" };
  const bySequence = new Map<number, WorkshopReceipt>();
  for (const receipt of receipts) {
    const sequence = receipt.call.semantic?.workshopSequence;
    if (
      sequence === undefined ||
      !Number.isSafeInteger(sequence) ||
      sequence <= 0 ||
      bySequence.has(sequence)
    ) {
      return { receipts: [], status: "ambiguous" };
    }
    bySequence.set(sequence, receipt);
  }
  const matched = facts.flatMap((fact) => {
    const receipt = bySequence.get(fact.sequence);
    return receipt === undefined ? [] : [receipt];
  });
  return matched.length === facts.length
    ? { receipts: matched, status: "joined" }
    : { receipts: [], status: "receipt-mismatch" };
}

function joinIssue(
  epoch: string,
  actionEvidence: number,
  receipts: number,
  status: WorkshopJourneyJoin["status"],
): WorkshopJourneyJoin {
  return { epoch, actionEvidence, receipts, status, failures: [] };
}

export function canonicalTool(name: string): string {
  return name === "harness_preview" ? "harness_inspect" : name;
}

function targetSuffix(target: BuilderCustomToolCall["target"]): string {
  const parts: string[] = [];
  if (target.taskId !== undefined) parts.push(`task=${target.taskId}`);
  else if (target.taskIdDigest !== undefined) parts.push(`task#=${target.taskIdDigest.slice(0, 12)}`);
  if (target.runId !== undefined) parts.push(`run=${target.runId}`);
  else if (target.runIdDigest !== undefined) parts.push(`run#=${target.runIdDigest.slice(0, 12)}`);
  if (target.family !== undefined) parts.push(`family=${target.family}`);
  else if (target.familyDigest !== undefined) parts.push(`family#=${target.familyDigest.slice(0, 12)}`);
  if (target.contextId !== undefined) parts.push(`context=${target.contextId}`);
  if (target.feedbackGroup !== undefined) parts.push(`group=${String(target.feedbackGroup)}`);
  if (target.feedbackField !== undefined) parts.push(`field=${target.feedbackField}`);
  if (target.callCount !== undefined) parts.push(`calls=${String(target.callCount)}`);
  if (target.toolNames !== undefined && target.toolNames.length > 0) {
    parts.push(`tools=${target.toolNames.join("+")}`);
  }
  return parts.length === 0 ? "" : `[${parts.join(",")}]`;
}

export function actionLabel(call: BuilderCustomToolCall): string {
  return `${canonicalTool(call.tool)}.${call.action}${targetSuffix(call.target)}`;
}

export function workshopJourney(
  epoch: EpochToolCensus,
  facts: readonly WorkshopActionFact[],
): WorkshopJourneyJoin | null {
  if (epoch.workshop === null) return null;
  const receipts = epoch.execution.flatMap((execution, sessionIndex) => {
    const calls = [...execution.customCalls].sort((left, right) => left.sequence - right.sequence);
    return calls.flatMap((call, callIndex) =>
      ["public_source", "verifier_workshop"].includes(canonicalTool(call.tool))
        ? [
            {
              call,
              callIndex,
              calls,
              session: epoch.executionSessions?.[sessionIndex] ?? sessionIndex + 1,
            },
          ]
        : [],
    );
  });
  if (facts.length !== receipts.length) {
    return joinIssue(epoch.epoch, facts.length, receipts.length, "count-mismatch");
  }
  const matched = receiptsBySequence(facts, receipts);
  if (matched.status === "receipt-mismatch" || matched.status === "ambiguous") {
    return joinIssue(epoch.epoch, facts.length, receipts.length, matched.status);
  }
  const aligned = facts.every((fact, index) => {
    const call = matched.receipts[index]?.call;
    const expectedTool = fact.action === "fetch" ? "public_source" : "verifier_workshop";
    return call !== undefined && canonicalTool(call.tool) === expectedTool && call.action === fact.action;
  });
  if (!aligned) {
    return joinIssue(epoch.epoch, facts.length, receipts.length, "action-mismatch");
  }
  const sameResultDigest = facts.every((fact, index) => {
    const recorded = matched.receipts[index]?.call.semantic?.resultDigest;
    return fact.resultDigest === null || recorded === fact.resultDigest;
  });
  if (!sameResultDigest) {
    return joinIssue(epoch.epoch, facts.length, receipts.length, "receipt-mismatch");
  }
  return {
    epoch: epoch.epoch,
    actionEvidence: facts.length,
    receipts: receipts.length,
    status: matched.status,
    failures: facts.flatMap((fact, index) => {
      if (fact.outcome === "completed") return [];
      const receipt = matched.receipts[index];
      if (receipt === undefined) return [];
      return [
        {
          session: receipt.session,
          receiptSequence: receipt.call.sequence,
          tool: fact.action === "fetch" ? ("public_source" as const) : ("verifier_workshop" as const),
          action: fact.action,
          outcome: fact.outcome,
          reason: fact.reason,
          before: receipt.calls.slice(Math.max(0, receipt.callIndex - 3), receipt.callIndex).map(actionLabel),
          after: receipt.calls.slice(receipt.callIndex + 1, receipt.callIndex + 4).map(actionLabel),
        },
      ];
    }),
  };
}

function atOrBefore(value: string, cutoff: string | null, field: string): boolean {
  if (cutoff === null) return true;
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) throw new Error(`${field}: invalid timestamp ${value}`);
  return timestamp <= Date.parse(cutoff);
}

export function selectedEpochs(
  selection: CampaignSelection,
): Array<{ epoch: EpochToolCensus; facts: WorkshopActionFact[] }> {
  const report = builderToolsReport(selection.campaignDir);
  const epochs = report.epochs.filter((epoch) => selection.epoch === null || epoch.epoch === selection.epoch);
  if (selection.epoch !== null && epochs.length === 0) {
    throw new Error(`${selection.campaignDir}: no epoch ${selection.epoch}`);
  }
  return epochs.map((epoch) => {
    const path = join(selection.campaignDir, epoch.epoch, WORKSHOP_ACTION_FILE);
    const facts = (existsSync(path) ? readWorkshopActionFacts(path) : []).filter((fact) =>
      atOrBefore(fact.at, selection.writtenBefore, path),
    );
    const executions = epoch.execution.flatMap((row, index) =>
      atOrBefore(row.writtenAt, selection.writtenBefore, `${epoch.epoch}/builder-execution`)
        ? [{ row, session: epoch.executionSessions?.[index] ?? index + 1 }]
        : [],
    );
    return {
      epoch: {
        ...epoch,
        execution: executions.map(({ row }) => row),
        executionSessions: executions.map(({ session }) => session),
        workshop: existsSync(path) ? foldWorkshopFacts(facts) : null,
      },
      facts,
    };
  });
}
