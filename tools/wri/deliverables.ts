/**
 * Deliverable file-artifact capture and verification audit (lane 3):
 *
 *   bun tools/wri/wri.ts reader deliverables --log <log>
 *
 * Summarises whether the standing draft's evaluator and controls use deliverable files, per-arm
 * verdict capture rates, file counts, median and maximum byte sizes, capture-cap hits
 * (`DELIVERABLES.count` / `DELIVERABLES.bytes`), pass vs fail splits between file-carrying and
 * file-less verdicts, and Referee probes targeting `file:*` paths. Wall-safe: prints only counts,
 * byte sizes, and comparison/session identifiers — never file paths or contents.
 */
import { DELIVERABLES, manifestOf } from "#src/kernel/answer-files.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import { asRecord, isString, type JsonObject } from "#src/meta/json-shape.ts";
import { median } from "#src/meta/tally.ts";
import { plural } from "#src/meta/text.ts";
import { indexOf, items, text } from "./folds.ts";
import { type Asked, askedOf, sideOf } from "./rejections.ts";

/** Matches evaluator code that reads deliverable files rather than merely declaring a `files?` type. */
const DELIVERABLE_CODE_RE = /\bfiles\s*[.[]|deliverables\//u;

interface Bucket {
  verdicts: number;
  withFiles: number;
  totalFiles: number;
  atBound: number;
  passWith: number;
  passWithout: number;
  readonly bytes: number[];
}

const emptyBucket = (): Bucket => ({
  verdicts: 0,
  withFiles: 0,
  totalFiles: 0,
  atBound: 0,
  passWith: 0,
  passWithout: 0,
  bytes: [],
});

/** Whether the standing draft references deliverable files in its evaluator or control fixtures. */
export function draftDeliverableInfo(events: readonly LogEvent[]): {
  readonly evaluatorUsesFiles: boolean;
  readonly acceptWithFiles: number;
  readonly rejectWithFiles: number;
} {
  const draft = asRecord(events.findLast(({ kind }) => kind === "exam.drafted")?.data.draft);
  const countFiles = (list: readonly ReturnType<typeof asRecord>[]) =>
    list.filter((entry) => items(entry?.files).length > 0).length;
  return {
    evaluatorUsesFiles: DELIVERABLE_CODE_RE.test(text(draft?.evaluator)),
    acceptWithFiles: countFiles(items(draft?.accept).map(asRecord)),
    rejectWithFiles: countFiles(items(draft?.reject).map(asRecord)),
  };
}

/** Add one verdict event's deliverable statistics into `bucket`. */
function recordVerdict(bucket: Bucket, data: JsonObject): void {
  bucket.verdicts += 1;
  const pass = data.kind === "pass";
  const files = data.files === undefined ? [] : manifestOf(data.files);
  if (files.length === 0) {
    if (pass) bucket.passWithout += 1;
    return;
  }
  bucket.withFiles += 1;
  bucket.totalFiles += files.length;
  if (pass) bucket.passWith += 1;
  const totalBytes = files.reduce((sum, entry) => sum + entry.bytes, 0);
  bucket.bytes.push(totalBytes);
  if (files.length >= DELIVERABLES.count || totalBytes >= DELIVERABLES.bytes) bucket.atBound += 1;
}

/** Format one bucket into a compact wall-safe summary string. */
function formatBucket(bucket: Bucket): string {
  const med = median(bucket.bytes);
  const max = bucket.bytes.length === 0 ? 0 : Math.max(...bucket.bytes);
  const without = bucket.verdicts - bucket.withFiles;
  const bytesPart =
    bucket.withFiles === 0 ? "" : `, med ${String(Math.round(med ?? 0))}B max ${String(max)}B`;
  const boundPart = bucket.atBound === 0 ? "" : `, ${String(bucket.atBound)} at bound`;
  return `${String(bucket.withFiles)}/${String(bucket.verdicts)} with files (${plural(bucket.totalFiles, "file")}${bytesPart}${boundPart}; pass w/ ${String(bucket.passWith)}/${String(bucket.withFiles)}, w/o ${String(bucket.passWithout)}/${String(without)})`;
}

/** Count Referee findings whose recorded probe edits touched any `file:*` path. */
function fileProbedRulings(events: readonly LogEvent[]): {
  readonly total: number;
  readonly fileProbed: number;
} {
  const findings = events.flatMap(({ kind, data }) => (kind === "referee.finding" ? [data] : []));
  let fileProbed = 0;
  for (const finding of findings) {
    const touchedFile = items(finding.probeRows).some((row) =>
      items(asRecord(row)?.changes).some((change) => text(asRecord(change)?.path).startsWith("file:")),
    );
    if (touchedFile) fileProbed += 1;
  }
  return { total: findings.length, fileProbed };
}

/** Deliverable capture and verification audit across draft, comparisons, roles, and Referee probes. */
export function deliverableRows(events: readonly LogEvent[]): string[] {
  const log = indexOf(events);
  const draft = draftDeliverableInfo(events);
  const [asked, side] = [askedOf(log), sideOf(log)];
  const solvesById = new Map(log.solves.map((solve) => [solve.id, solve]));
  const byRole: Record<Asked, Bucket> = {
    scored: emptyBucket(),
    practice: emptyBucket(),
    examiner: emptyBucket(),
  };
  const byArm = new Map<string, { ref: Bucket; cand: Bucket }>();
  const all = emptyBucket();
  for (const data of log.of("verdict")) {
    recordVerdict(all, data);
    const solve = isString(data.solve) ? solvesById.get(data.solve) : undefined;
    if (solve === undefined) continue;
    const role = asked(solve);
    recordVerdict(byRole[role], data);
    if (role !== "scored" || solve.comparison === null) continue;
    const arm = byArm.get(solve.comparison) ?? { ref: emptyBucket(), cand: emptyBucket() };
    byArm.set(solve.comparison, arm);
    recordVerdict(side(solve) === "new" ? arm.cand : arm.ref, data);
  }
  const probes = fileProbedRulings(events);
  const draftUses = draft.evaluatorUsesFiles || draft.acceptWithFiles > 0 || draft.rejectWithFiles > 0;
  if (all.withFiles === 0 && !draftUses && probes.fileProbed === 0) {
    return [
      `deliverables: none (draft does not reference files and 0/${String(all.verdicts)} verdicts carried files)`,
    ];
  }
  const draftLine = `draft deliverables: evaluator ${draft.evaluatorUsesFiles ? "reads files" : "no file read"}, controls with files ${String(draft.acceptWithFiles)} accept / ${String(draft.rejectWithFiles)} reject`;
  const comparisonLines = [...byArm].map(
    ([comparison, { ref, cand }]) =>
      `${comparison} deliverables: ref ${formatBucket(ref)}; new ${formatBucket(cand)}`,
  );
  const roleLines = Object.entries(byRole)
    .filter(([, bucket]) => bucket.verdicts > 0)
    .map(([role, bucket]) => `  role ${role}: ${formatBucket(bucket)}`);
  return [
    `deliverables: ${formatBucket(all)}; referee file:* probes ${String(probes.fileProbed)}/${String(probes.total)}`,
    draftLine,
    ...comparisonLines,
    ...roleLines,
  ];
}
