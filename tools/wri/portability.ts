/**
 * Static portability and external-transfer readiness audit for kept harnesses (lane 12):
 *
 *   bun tools/wri/wri.ts reader portability --log <log>
 *
 * Inspects every kept harness under `states/<digest>/` for export hazards before external
 * evaluation (`runs bench`): hardcoded host paths, non-portable shebangs, non-executable `bin/`
 * files, broken symlinks, exam `answerFormat` key coupling, and guide-to-tool weight ratio.
 * Wall-safe: emits only counts, ratios, roles, and 8-char digests — never file names, key names,
 * or source snippets. Each kept harness line opens with its 8-char digest so `bun run runs pulse`
 * surfaces portability hazards immediately on `harness.promoted`.
 */
import { starterIn } from "#src/campaign/climb.ts";
import { draftOf } from "#src/examiner/draft.ts";
import { portableGuide } from "#src/harness/starter.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import { asRecord, isString } from "#src/meta/json-shape.ts";
import { join } from "#src/meta/path.ts";
import { plural } from "#src/meta/text.ts";
import { keptStates, stateAuditFiles } from "./trajectory.ts";

/** Hardcoded host-environment or Anabasis-internal path prefixes that break external transfer. */
const HOST_PATH_RE = /(?:\/Users\/|\/home\/|\/opt\/homebrew\/|\/private\/tmp\/|\/var\/folders\/|\.ana\/)/gu;
/** Absolute-path shebangs that fail across OSes/hosts (portable ones use `#!/usr/bin/env` or `/bin/sh`). */
const BAD_SHEBANG_RE = /^#!\s*\/(?:Users|home|opt\/homebrew|Library)\//u;
/** Campaign-only mechanics that belong strictly below `HOST_ONLY` (`## Validity and score`). */
const PORTABLE_LEAK_RE =
  /(?:public\/task\.json|public\/files\/|public\/resources\/|answer\.json|\bsubmit\b)/gu;
const MIN_KEY_LEN = 4;

/** Top-level `answerFormat.properties` keys of length >= `MIN_KEY_LEN` from the standing draft. */
function examAnswerKeys(events: readonly LogEvent[]): readonly string[] {
  const props = asRecord(asRecord(draftOf(events)?.answerFormat)?.properties);
  if (props === null) return [];
  return Object.keys(props).filter((key) => key.length >= MIN_KEY_LEN);
}

/** Audit one kept harness folder and return its compact single-line summary. */
function auditHarness(digest: string, role: string, stateDir: string, answerKeys: readonly string[]): string {
  const { written, brokenLinks, toolTreeFiles, weight } = stateAuditFiles(stateDir);
  let [hostPathHits, badShebangs, nonExecBins, filesWithExamKeys] = [0, 0, 0, 0];
  const matchedKeys = new Set<string>();
  for (const { path, text, executable } of written) {
    hostPathHits += (text.match(HOST_PATH_RE) ?? []).length;
    badShebangs += Number(BAD_SHEBANG_RE.test(text));
    nonExecBins += Number(path.startsWith("bin/") && !executable);
    const matched = answerKeys.filter((key) => text.includes(key));
    for (const key of matched) matchedKeys.add(key);
    filesWithExamKeys += Number(matched.length > 0);
  }
  const guideEntry = written.find(({ path }) => path === "guide");
  const portable = guideEntry === undefined ? "" : portableGuide(guideEntry.text);
  const hasHostOnly = guideEntry !== undefined && portable.length < guideEntry.text.length;
  const portableLines = portable.split("\n").filter((line) => line.trim() !== "").length;
  const aboveLeaks = (portable.match(PORTABLE_LEAK_RE) ?? []).length;
  const { guide, files: toolFiles, lines: toolLines } = weight ?? { guide: 0, files: 0, lines: 0 };
  const ratio = toolLines === 0 ? "guide-only" : `${(guide / toolLines).toFixed(2)}x`;
  const hazards = hostPathHits + badShebangs + nonExecBins + brokenLinks;
  const examPart =
    answerKeys.length === 0
      ? "exam-keys n/a"
      : `exam-keys ${String(matchedKeys.size)}/${String(answerKeys.length)} in ${plural(filesWithExamKeys, "file")}`;
  return `${digest.slice(0, 8)} (${role}): guide ${String(guide)}L (host-only ${hasHostOnly ? "yes" : "no"}, portable ${String(portableLines)}L, above-leaks ${String(aboveLeaks)}), own ${String(toolFiles)}f/${String(toolLines)}L (${ratio}), tree ${String(toolTreeFiles)}f · hazards ${String(hazards)} (host-paths ${String(hostPathHits)}, bad-shebangs ${String(badShebangs)}, non-exec-bins ${String(nonExecBins)}, broken-links ${String(brokenLinks)}) · ${examPart}`;
}

/** Static portability audit for every kept harness under `statesDir`. */
export function portabilityRows(events: readonly LogEvent[], statesDir: string): string[] {
  const kept = keptStates(statesDir);
  if (kept.length === 0) return [`portability: no kept harness under ${statesDir}`];
  const answerKeys = examAnswerKeys(events);
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
    auditHarness(digest, roleOf(digest), join(statesDir, digest), answerKeys),
  );
  return [
    `portability: ${plural(kept.length, "kept harness")} audited for host paths, shebangs, bin modes, broken links, exam answer-format key coupling (${String(answerKeys.length)} keys) and guide/tool weight`,
    ...rows,
  ];
}
