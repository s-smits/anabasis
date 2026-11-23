/**
 * Static portability and external-transfer readiness audit for kept harnesses (lane 12):
 *
 *   bun tools/wri/wri.ts reader portability --log <log>
 *
 * Inspects every kept harness under `states/<digest>/` via production's `auditHarnessState`
 * (`src/harness/audit.ts`): hardcoded host paths, non-portable shebangs, non-executable `bin/`
 * files, broken symlinks, exam `answerFormat` key coupling, and guide-to-tool weight ratio.
 * Wall-safe: emits only counts, ratios, roles, and 8-char digests — never file names, key names,
 * or source snippets. Each kept harness line opens with its 8-char digest so `bun run runs pulse`
 * surfaces portability hazards immediately on `harness.promoted`.
 */
import { starterIn } from "#src/campaign/climb.ts";
import { draftOf } from "#src/examiner/draft.ts";
import { auditHarnessState, schemaKeys } from "#src/harness/audit.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import { isString } from "#src/meta/json-shape.ts";
import { join } from "#src/meta/path.ts";
import { plural } from "#src/meta/text.ts";
import { keptStates } from "./trajectory.ts";

/** Audit one kept harness folder and return its compact single-line summary. */
function auditRow(
  digest: string,
  role: string,
  stateDir: string,
  answerKeys: readonly string[],
  ruleIds: readonly string[],
): string {
  const audit = auditHarnessState(stateDir, answerKeys, ruleIds);
  const { guide, files: toolFiles, lines: toolLines } = audit.weight ?? { guide: 0, files: 0, lines: 0 };
  const ratio = toolLines === 0 ? "guide-only" : `${(guide / toolLines).toFixed(2)}x`;
  const hazards = audit.hostPathHits + audit.badShebangs + audit.nonExecBins + audit.brokenLinks;
  const examPart =
    answerKeys.length === 0
      ? "exam-keys n/a"
      : `exam-keys ${String(audit.matchedKeys.size)}/${String(answerKeys.length)} in ${plural(audit.filesWithExamKeys, "file")}`;
  return `${digest.slice(0, 8)} (${role}): guide ${String(guide)}L (host-only ${audit.hasHostOnly ? "yes" : "no"}, portable ${String(audit.portableLines)}L, above-leaks ${String(audit.aboveLeaks)}, above-keys ${String(audit.aboveKeys)}, above-rules ${String(audit.aboveRules)}), own ${String(toolFiles)}f/${String(toolLines)}L (${ratio}), tree ${String(audit.toolTreeFiles)}f · hazards ${String(hazards)} (host-paths ${String(audit.hostPathHits)}, bad-shebangs ${String(audit.badShebangs)}, non-exec-bins ${String(audit.nonExecBins)}, broken-links ${String(audit.brokenLinks)}) · ${examPart}`;
}

/** Static portability audit for every kept harness under `statesDir`. */
export function portabilityRows(events: readonly LogEvent[], statesDir: string): string[] {
  const kept = keptStates(statesDir);
  if (kept.length === 0) return [`portability: no kept harness under ${statesDir}`];
  const draft = draftOf(events);
  const answerKeys = [...new Set(schemaKeys(draft?.answerFormat))];
  const ruleIds = [
    ...new Set(
      (Array.isArray(draft?.rules) ? draft.rules : []).map(({ id }) => id).filter((id) => id !== ""),
    ),
  ];
  const starter = starterIn(events);
  const promotedOrder = new Map<string, number>();
  const compared = new Set<string>();
  for (const [at, { kind, data }] of events.entries()) {
    if (kind === "harness.promoted" && isString(data.harness)) {
      promotedOrder.set(data.harness, at);
    } else if (kind === "comparison.started") {
      if (isString(data.fresh)) compared.add(data.fresh);
      if (isString(data.old)) compared.add(data.old);
    }
  }
  const roleOf = (digest: string) => {
    if (digest === starter) return "starter";
    return promotedOrder.has(digest) ? "promoted" : compared.has(digest) ? "compared" : "other";
  };
  const ordered = kept.toSorted(
    (one, other) =>
      (promotedOrder.get(other) ?? -1) - (promotedOrder.get(one) ?? -1) || one.localeCompare(other),
  );
  const rows = ordered.map((digest) =>
    auditRow(digest, roleOf(digest), join(statesDir, digest), answerKeys, ruleIds),
  );
  return [
    `portability: ${plural(kept.length, "kept harness")} audited for host paths, shebangs, bin modes, broken links, exam answer-format key coupling (${String(answerKeys.length)} keys) and guide/tool weight`,
    ...rows,
  ];
}
