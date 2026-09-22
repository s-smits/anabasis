/** A checker outage the Builder owns: EXTERNAL_RESULT_UNBOUND rows recorded in the measured
 *  battery. The row says a check reported an externally grounded verdict that no host tool run
 *  supports — the check never called `runtime.tools.run`, or it read a non-result as an answer.
 *  Since the host resolves every tool itself (2026-09-03) there is no declared registry to blame,
 *  so the owner is the check code. Run esp32-new-sol 2026-08-27: three compiles exceeded the
 *  checker's own timeout, the claim blocked, and the analysis called it environment with no owner,
 *  so the repairable check reached no author session. The routed claim carries public identities
 *  and counts only; task ids and process facts stay in the battery. */
import { existsSync, readFileSync } from "../meta/filesystem.ts";
import { join, relative } from "../meta/path.ts";
import { parseJsonAs } from "../meta/json-runtime.ts";
import { batteryPath } from "../truth/battery-record.ts";
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
    kind: "harness-defect",
    claim: `run ${analysis.battery.runId} recorded ${unbound} unbound-external-result finding(s): a check reported an external verdict that no host tool run supports, so this battery supports no claim. Repair the check — call the declared tool through runtime.tools.run and return a non-result when the run did not complete — instead of waiting for an environment fix`,
    evidence: relative(repoRoot, path),
    proposedOwner: "correctness-model",
  };
}
