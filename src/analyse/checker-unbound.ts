/** A checker outage the Builder owns: EXTERNAL_RESULT_UNBOUND rows recorded in the measured
 *  battery. The row says a check reported an externally grounded verdict that no host tool run
 *  supports — the check never called `runtime.tools.run`, or it read a non-result as an answer.
 *  Since the host resolves every tool itself there is no declared registry left to blame, which is
 *  what makes the check code the owner. Without this row a checker whose own compiles exceed its
 *  timeout blocks the claim and reads as an environment failure with no owner, so the one
 *  repairable thing in it never reaches an author session. The routed claim carries public
 *  identities and counts only; task ids and process facts stay in the battery. */
import { existsSync, readFileSync } from "../meta/filesystem.ts";
import { join, relative } from "../meta/path.ts";
import { parseJsonAs } from "../meta/json-runtime.ts";
import { batteryPath } from "../correctness-bundle/battery-record.ts";
import { EVALUATOR_FILE } from "../meta/bundle-layout.ts";
import type { AnalysisFinding, IterationAnalysis } from "./iteration-analysis.ts";

export function checkerUnboundFinding(repoRoot: string, analysis: IterationAnalysis): AnalysisFinding | null {
  const path = batteryPath(join(repoRoot, analysis.treeRoot), analysis.battery.runId);
  const parsed = parseJsonAs<{ discrimination?: { findings?: Array<{ code?: unknown }> } }>(
    existsSync(path) ? readFileSync(path, "utf8") : "{}",
  );
  const unbound = (parsed.discrimination?.findings ?? []).filter(
    (row) => row.code === "EXTERNAL_RESULT_UNBOUND",
  ).length;
  if (unbound === 0) return null;
  return {
    owner: EVALUATOR_FILE,
    defect: true,
    claim: `run ${analysis.battery.runId} recorded ${unbound} unbound-external-result finding(s): a check reported an external verdict that no host tool run supports, so this battery supports no claim. Repair the check — call the declared tool through runtime.tools.run and return a non-result when the run did not complete — instead of waiting for an environment fix`,
    evidence: relative(repoRoot, path),
    hostRule: "external-result-unbound",
  };
}
