/** Blocking-check attribution shared by the editable seed and controller control receipts. */
import type { CorrectnessModelResult } from "../../src/verify/correctness-model-result.ts";
import { compareCodeUnits } from "../../src/meta/stable-json.ts";

export function observedBlockingCheckIds(result: CorrectnessModelResult): string[] {
  return [...new Set(result.issues.map((issue) => issue.checkId))].sort(compareCodeUnits);
}
