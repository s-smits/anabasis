// Historical Progress Guard yield: guard verdict → paired contest → promotion decision.
// Its contract held replacement when evidence binding, paired measurement or attribution was not
// proved; promote only a candidate that beat current on the same fresh battery. Opportunity: a
// guard record exists for the iteration. Output: the guard verdict. Consumed: the recorded
// promotion carries that verdict. Changed: the guard's clause was the only reason the decision
// held. This reads recorded clauses; current-loop rows mark the component absent.
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  CURRENT_LOOP_SCHEMAS,
  absentRow,
  iterationRunIds,
  iterationSchema,
  presentRows,
  readAnalysis,
  report,
  tallyText,
} from "./common.mjs";
import { isRecord, isString } from "#src/meta/json-shape.ts";
import { readJsonFileOrNull } from "#src/meta/completed-json.ts";

const COMPONENT = "the progress guard chain";

const GUARD_CLAUSE = /^progress-guard-(hold|investigate|missing)\b/;

function clauseCode(clause) {
  const text = isString(clause) ? clause : isRecord(clause) ? String(clause.code ?? clause.id ?? "") : "";
  return text.split(":")[0].trim();
}

function guardOutput(guard) {
  if (!isRecord(guard)) return null;
  const checks = Array.isArray(guard.checks) ? guard.checks : [];
  const notPassed = checks
    .filter((check) => isRecord(check) && check.state !== "pass")
    .map((check) => `${check.id}:${check.state}`);
  return {
    verdict: guard.verdict ?? null,
    notPassed,
    findings: Array.isArray(guard.findings) ? guard.findings.length : 0,
  };
}

function comparisonFacts(comparison) {
  if (!isRecord(comparison)) return null;
  return { wins: comparison.wins ?? null, losses: comparison.losses ?? null, ties: comparison.ties ?? null };
}

function promotionFacts(promotion) {
  const clauses = Array.isArray(promotion.clauses) ? promotion.clauses.map(clauseCode) : [];
  return {
    decision: promotion.decision ?? null,
    experiment: promotion.experiment ?? null,
    repairDisposition: promotion.repairDisposition ?? null,
    comparison: comparisonFacts(promotion.comparison),
    pairedAbsence: isRecord(promotion.pairedAbsence) ? (promotion.pairedAbsence.kind ?? "present") : null,
    clauses,
    guardClauses: clauses.filter((code) => GUARD_CLAUSE.test(code)).length,
  };
}

function row(campaignDir, runId) {
  if (CURRENT_LOOP_SCHEMAS.has(iterationSchema(campaignDir, runId))) return absentRow(runId, COMPONENT);
  const guard = readAnalysis(campaignDir, runId, "progress-guard");
  const contest = readAnalysis(campaignDir, runId, "contest");
  const promotionPath = join(campaignDir, "promotions", `${runId}.json`);
  const promotion = existsSync(promotionPath) ? readJsonFileOrNull(promotionPath) : null;
  const output = guardOutput(guard);
  const facts = isRecord(promotion) ? promotionFacts(promotion) : null;
  const carried =
    facts !== null &&
    isRecord(promotion.progressGuard) &&
    promotion.progressGuard.verdict === output?.verdict;
  const consumer = carried
    ? {
        path: `promotions/${runId}.json`,
        field: "progressGuard.verdict, clauses",
        value: { verdict: output.verdict, clauses: facts.clauses },
      }
    : null;
  const changed =
    facts?.decision === "held" && facts.guardClauses > 0 && facts.guardClauses === facts.clauses.length;
  let note;
  if (guard === null) note = "no progress-guard file";
  else if (promotion === null) note = `guard ${output.verdict}; no promotion decision for this iteration`;
  else if (facts.decision === "promoted") {
    note = `${facts.experiment} candidate installed (${facts.comparison === null ? "no paired comparison" : "paired"})`;
  } else if (changed) note = `held on the guard alone: ${facts.clauses.join(", ")}`;
  else note = `held on ${facts.clauses.length} clause(s), ${facts.guardClauses} from the guard`;
  return {
    runId,
    opportunity: guard !== null,
    output,
    consumer,
    changed,
    experiment: facts?.experiment ?? (isRecord(contest?.repair) ? (contest.repair.experiment ?? null) : null),
    promotion: facts,
    contestComparison: comparisonFacts(contest?.comparison),
    note,
  };
}

export function collect(campaignDir) {
  const runIds = iterationRunIds(campaignDir);
  const rows = runIds.map((runId) => row(campaignDir, runId));
  const { present, reasons } = presentRows(COMPONENT, rows);
  const verdicts = tallyText(present, (entry) => entry.output?.verdict ?? null);
  if (verdicts !== "") reasons.push(`guard verdicts: ${verdicts}`);
  const decisions = tallyText(present, (entry) =>
    entry.promotion === null ? null : `${entry.promotion.decision}/${entry.promotion.experiment}`,
  );
  if (decisions !== "") reasons.push(`promotion decisions: ${decisions}`);
  const paired = present.filter((entry) => entry.promotion?.comparison !== null && entry.promotion !== null);
  const repairPromoted = present.filter(
    (entry) => entry.promotion?.experiment === "repair" && entry.promotion?.decision === "promoted",
  ).length;
  if (present.length > 0) {
    reasons.push(`paired comparisons ${paired.length}; repair promotions ${repairPromoted}`);
  }
  const heldOnGuard = present.filter((entry) => entry.changed).map((entry) => entry.runId);
  if (heldOnGuard.length > 0) reasons.push(`held on the guard alone: ${heldOnGuard.join(", ")}`);
  return report("progress-guard", campaignDir, rows, reasons);
}
