/**
 * Static portability audit of every kept harness (lane 10):
 *
 *   bun tools/wri/wri.ts reader portability --log <log>
 *
 * Reads each harness under `states/<digest>/` through `readHarnessFiles`: host paths, non-portable
 * shebangs, non-executable `bin/` files, broken symlinks, `answerFormat` key coupling and the guide's
 * size against the tools'. It prints counts, ratios, roles and 8-character digests, never file or key
 * names, and each line opens with its digest so the pulse shows a hazard at `harness.promoted`.
 */
import { starterIn } from "#src/campaign/climb.ts";
import { draftOf } from "#src/examiner/draft.ts";
import { formatKeys, readHarnessFiles } from "#src/harness/files.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import { isString } from "#src/meta/json-shape.ts";
import { join } from "#src/meta/path.ts";
import { plural } from "#src/meta/text.ts";
import { keptStates } from "./trajectory.ts";

function summaryRow(
  digest: string,
  role: string,
  stateDir: string,
  answerKeys: readonly string[],
  ruleIds: readonly string[],
): string {
  const info = readHarnessFiles(stateDir, answerKeys, ruleIds);
  const { guide, files: toolFiles, lines: toolLines } = info.size ?? { guide: 0, files: 0, lines: 0 };
  const ratio = toolLines === 0 ? "guide-only" : `${(guide / toolLines).toFixed(2)}x`;
  const hazards = info.hostPaths + info.hostShebangs + info.plainBins + info.brokenLinks;
  const examPart =
    answerKeys.length === 0
      ? "exam-keys n/a"
      : `exam-keys ${String(info.matchedKeys.size)}/${String(answerKeys.length)} in ${plural(info.filesWithKeys, "file")}`;
  return `${digest.slice(0, 8)} (${role}): guide ${String(guide)}L (host-only ${info.hasSplit ? "yes" : "no"}, portable ${String(info.keptLines)}L, above-leaks ${String(info.keptHostRefs)}, above-keys ${String(info.keptFormatKeys)}, above-rules ${String(info.keptRuleIds)}), own ${String(toolFiles)}f/${String(toolLines)}L (${ratio}), tree ${String(info.treeFiles)}f · hazards ${String(hazards)} (host-paths ${String(info.hostPaths)}, bad-shebangs ${String(info.hostShebangs)}, non-exec-bins ${String(info.plainBins)}, broken-links ${String(info.brokenLinks)}) · ${examPart}`;
}

export function portabilityRows(events: readonly LogEvent[], statesDir: string): string[] {
  const kept = keptStates(statesDir);
  if (kept.length === 0) return [`portability: no kept harness under ${statesDir}`];
  const draft = draftOf(events);
  const answerKeys = [...new Set(formatKeys(draft?.answerFormat))];
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
    summaryRow(digest, roleOf(digest), join(statesDir, digest), answerKeys, ruleIds),
  );
  return [
    `portability: ${plural(kept.length, "kept harness")} audited for host paths, shebangs, bin modes, broken links, exam answer-format key coupling (${String(answerKeys.length)} keys) and guide/tool weight`,
    ...rows,
  ];
}
