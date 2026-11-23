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
import type { LogEvent } from "#src/kernel/log.ts";
import { asRecord, isString } from "#src/meta/json-shape.ts";
import { join } from "#src/meta/path.ts";
import { plural } from "#src/meta/text.ts";
import { keptStates, stateAuditFiles, weightOf } from "./trajectory.ts";

/** Hardcoded host-environment or Anabasis-internal path prefixes that break external transfer. */
const HOST_PATH_RE = /(?:\/Users\/|\/home\/|\/opt\/homebrew\/|\/private\/tmp\/|\/var\/folders\/|\.ana\/)/gu;
/** Absolute-path shebangs that fail across OSes/hosts (portable ones use `#!/usr/bin/env` or `/bin/sh`). */
const BAD_SHEBANG_RE = /^#!\s*\/(?:Users|home|opt\/homebrew|Library)\//u;
const MIN_KEY_LEN = 4;

/** Top-level `answerFormat.properties` keys of length >= `MIN_KEY_LEN` from the standing draft. */
function examAnswerKeys(events: readonly LogEvent[]): readonly string[] {
  const props = asRecord(asRecord(draftOf(events)?.answerFormat)?.properties);
  if (props === null) return [];
  return Object.keys(props).filter((key) => key.length >= MIN_KEY_LEN);
}

/** Role label for a kept harness digest in this campaign. */
function roleOf(events: readonly LogEvent[], digest: string): string {
  if (digest === starterIn(events)) return "starter";
  const promoted = events.filter(({ kind, data }) => kind === "harness.promoted" && data.harness === digest);
  if (promoted.length > 0) return "promoted";
  const compared = events.some(
    ({ kind, data }) => kind === "comparison.started" && (data.fresh === digest || data.old === digest),
  );
  return compared ? "compared" : "other";
}

/** Audit one kept harness folder and return its compact single-line summary. */
function auditHarness(digest: string, role: string, stateDir: string, answerKeys: readonly string[]): string {
  const weight = weightOf(stateDir);
  const { written, brokenLinks, toolTreeFiles } = stateAuditFiles(stateDir);
  let hostPathHits = 0;
  let badShebangs = 0;
  let nonExecBins = 0;
  let filesWithExamKeys = 0;
  const matchedKeys = new Set<string>();
  for (const { path, text, executable } of written) {
    hostPathHits += (text.match(HOST_PATH_RE) ?? []).length;
    if (BAD_SHEBANG_RE.test(text)) badShebangs += 1;
    if (path.startsWith("bin/") && !executable) nonExecBins += 1;
    let hitInFile = false;
    for (const key of answerKeys) {
      if (text.includes(key)) {
        matchedKeys.add(key);
        hitInFile = true;
      }
    }
    if (hitInFile) filesWithExamKeys += 1;
  }
  const guide = weight?.guide ?? 0;
  const toolFiles = weight?.files ?? 0;
  const toolLines = weight?.lines ?? 0;
  const ratio = toolLines === 0 ? "guide-only" : `${(guide / toolLines).toFixed(2)}x`;
  const hazards = hostPathHits + badShebangs + nonExecBins + brokenLinks;
  const examPart =
    answerKeys.length === 0
      ? "exam-keys n/a"
      : `exam-keys ${String(matchedKeys.size)}/${String(answerKeys.length)} in ${plural(filesWithExamKeys, "file")}`;
  return `${digest.slice(0, 8)} (${role}): guide ${String(guide)}L, own ${String(toolFiles)}f/${String(toolLines)}L (${ratio}), tree ${String(toolTreeFiles)}f · hazards ${String(hazards)} (host-paths ${String(hostPathHits)}, bad-shebangs ${String(badShebangs)}, non-exec-bins ${String(nonExecBins)}, broken-links ${String(brokenLinks)}) · ${examPart}`;
}

/** Static portability audit for every kept harness under `statesDir`. */
export function portabilityRows(events: readonly LogEvent[], statesDir: string): string[] {
  const kept = keptStates(statesDir);
  if (kept.length === 0) return [`portability: no kept harness under ${statesDir}`];
  const answerKeys = examAnswerKeys(events);
  const promotedOrder = new Map(
    events
      .flatMap(({ kind, data }) =>
        kind === "harness.promoted" && isString(data.harness) ? [data.harness] : [],
      )
      .map((digest, index) => [digest, index]),
  );
  const ordered = kept.toSorted((one, other) => {
    const [a, b] = [promotedOrder.get(one), promotedOrder.get(other)];
    if (a !== undefined && b !== undefined) return b - a;
    if (a !== undefined) return -1;
    if (b !== undefined) return 1;
    return one.localeCompare(other);
  });
  const rows = ordered.map((digest) =>
    auditHarness(digest, roleOf(events, digest), join(statesDir, digest), answerKeys),
  );
  return [
    `portability: ${plural(kept.length, "kept harness")} audited for host paths, shebangs, bin modes, broken links, exam answer-format key coupling (${String(answerKeys.length)} keys) and guide/tool weight`,
    ...rows,
  ];
}
