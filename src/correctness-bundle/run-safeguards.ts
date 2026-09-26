/** Runtime safeguards: log lines only, never a case kind, terminal, route or score. */
import { type SafeguardContext, safeguardTriggered } from "../meta/safeguard.ts";

/** Safeguard 40: a refused submit whose findings repeat one code across most of the battery is one
 * defect reported once per task, and the recorded findings keep only the count of it. The floor is
 * a 25-task battery refused on one cause, so a smaller battery repeating a code does not trip it. */
const REPEATED_CODE_FLOOR = 20;
export function safeguardRepeatedRefusalCode(
  outcome: { stage: string; findings: ReadonlyArray<{ code: string }> },
  context: SafeguardContext | undefined,
): void {
  const counts = new Map<string, number>();
  for (const finding of outcome.findings) counts.set(finding.code, (counts.get(finding.code) ?? 0) + 1);
  const [code, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
  if (count < REPEATED_CODE_FLOOR) return;
  safeguardTriggered(
    "40-refused-submit-repeated-code",
    `stage ${outcome.stage}: ${code} x${count} of ${outcome.findings.length} findings`,
    context,
  );
}
