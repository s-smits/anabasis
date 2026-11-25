/**
 * Each check of a campaign's exam in one row: how the checker reading rated it, the rules its brief
 * cites, its control answers, and what the campaign's answers met under it, by who asked for them
 * and by side, with what stands of its scored refusals.
 *
 *   bun tools/wri/wri.ts reader checks --log <log | campaign folder | name>
 */
import { frozenChecker } from "#src/kernel/acceptance.ts";
import { eventsOf, type LogEvent } from "#src/kernel/log.ts";
import { labelsIn } from "#src/kernel/solves.ts";
import { blockingOf, type Brief, checkProgramVersion, OBJECTIVE, readBrief } from "#src/kernel/verify.ts";
import { CHECK_BRIEF } from "#src/meta/bundle-layout.ts";
import { existsSync } from "#src/meta/filesystem.ts";
import { asRecord, isString, type JsonObject } from "#src/meta/json-shape.ts";
import { dirname, join } from "#src/meta/path.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { hashJsonValue } from "#src/meta/stable-json.ts";
import { countBy } from "#src/meta/tally.ts";
import { passAgreement, settledPassLabels } from "#src/referee/agreement.ts";
import { stagedExamOf } from "#tools/d2/exam.ts";
import { count, indexOf, items, refusals, refusalsByCheck, type Solve, strings, text } from "./folds.ts";
import { askedOf, sideOf } from "./rejections.ts";

interface OnDisk {
  readonly where: string;
  readonly version: string | null;
  readonly brief: Brief | null;
}

const NOT_RECORDED = "not recorded";
const STANDS = ["earned", "check-defect", "unclear", "unread"] as const;
const short = (digest: string | null | undefined) => (isString(digest) ? digest.slice(0, 8) : NOT_RECORDED);

/** The check program a campaign judges by: a drafted exam where it was staged, or a pack's beside the log. */
export function programOnDisk(log: string): OnDisk {
  let checks: string;
  try {
    checks = stagedExamOf(log)?.checks ?? join(dirname(log), "checks");
  } catch (error) {
    return { where: errorMessage(error), version: null, brief: null };
  }
  if (!existsSync(join(checks, CHECK_BRIEF))) {
    return { where: `${checks} (not on disk)`, version: null, brief: null };
  }
  return { where: checks, version: hashJsonValue(checkProgramVersion(checks)), brief: readBrief(checks) };
}

function programsOf(events: readonly LogEvent[]): (solve: Solve) => string | null {
  const readings = eventsOf(events, "checker.read").flatMap(({ index, event: { data } }) =>
    isString(data.checks) ? [{ index, checks: data.checks }] : [],
  );
  return (solve) => readings.findLast(({ index }) => index < solve.index)?.checks ?? null;
}

function headOf(events: readonly LogEvent[], reading: JsonObject | undefined, disk: OnDisk): string {
  const frozen = frozenChecker(events)?.checks ?? null;
  const drafts = eventsOf(events, "exam.drafted").length;
  const readings = eventsOf(events, "checker.read").length;
  const at = text(reading?.checks);
  const against =
    frozen === null ? "none frozen" : at === frozen ? "the frozen one" : `not the frozen ${short(frozen)}`;
  const onDisk =
    disk.version === null
      ? disk.where
      : `${disk.where} at ${short(disk.version)}${disk.version === at ? ", the same" : ", another"}`;
  return `checks: rows of the check program read at ${short(at || null)}, ${against}; on disk ${onDisk}; ${String(drafts)} exam.drafted, ${String(readings)} checker.read`;
}

function controlsLine(reading: JsonObject | undefined): string {
  const idle = asRecord(reading?.doNothing);
  const met =
    idle === null
      ? NOT_RECORDED
      : `refused on ${String(count(idle.rejected))} of ${String(count(idle.tasks))} tasks`;
  const controls = reading?.controls === undefined ? NOT_RECORDED : String(count(reading.controls));
  return `controls read: ${controls}; the do-nothing answer: ${met}`;
}

export function checkRows(events: readonly LogEvent[], disk: OnDisk): string[] {
  const log = indexOf(events);
  const frozen = frozenChecker(events)?.checks;
  const readings = log.of("checker.read");
  const reading = readings.findLast((data) => data.checks === frozen) ?? readings.at(-1);
  const program = isString(reading?.checks) ? reading.checks : null;
  const [asked, side, programOf, labels] = [askedOf(log), sideOf(log), programsOf(events), labelsIn(events)];
  const under = (solve: Solve) => program !== null && programOf(solve) === program;
  const rowsRead = new Map<string, JsonObject>();
  for (const row of items(reading?.rows)) {
    const record = asRecord(row);
    if (record !== null && record.id !== OBJECTIVE.id) rowsRead.set(text(record.id), record);
  }
  const declaredBy = new Map((disk.brief?.truthChecks ?? []).map((check) => [check.id, check] as const));
  const totals = refusalsByCheck(log);
  const refusedBy = new Map<string, Solve[]>();
  for (const solve of refusals(log)) {
    for (const id of blockingOf(log.verdicts.get(solve.id)?.checker)) {
      const list = refusedBy.get(id);
      if (list === undefined) refusedBy.set(id, [solve]);
      else list.push(solve);
    }
  }
  const ids = [...new Set([...rowsRead.keys(), ...Object.keys(totals)])];
  const lines = ids.map((id) => {
    const row = rowsRead.get(id);
    const declared = declaredBy.get(id);
    const mine = refusedBy.get(id) ?? [];
    const here = mine.filter(under);
    const byAsk = Map.groupBy(here, asked);
    const scored = byAsk.get("scored") ?? [];
    const bySide = countBy(scored, side);
    const stood = countBy(scored, (solve) => log.stands.get(solve.id) ?? "unread");
    return [
      id,
      row === undefined ? "not in the reading" : text(row.instrument) || NOT_RECORDED,
      declared === undefined ? NOT_RECORDED : declared.citedDecisionIds.join(",") || "none",
      declared?.execution.evidence?.kind ?? NOT_RECORDED,
      row === undefined ? "-" : `${String(count(row.caught))}/${String(count(row.named))}`,
      String(totals[id] ?? 0),
      `${String(bySide.reference ?? 0)}/${String(bySide.new ?? 0)}`,
      String(byAsk.get("examiner")?.length ?? 0),
      String(byAsk.get("practice")?.length ?? 0),
      String(mine.length - here.length),
      STANDS.map((each) => String(stood[each] ?? 0)).join("/"),
      String(scored.filter((solve) => labels.has(solve.id)).length),
      row === undefined || row.passed === undefined
        ? NOT_RECORDED
        : `${String(count(row.passed))}/${String(count(row.refused))}`,
    ].join("  ");
  });
  const judged = log.solves.filter((solve) => log.verdicts.has(solve.id));
  const underJudged = Map.groupBy(judged.filter(under), asked);
  const verdicts = (["scored", "examiner", "practice"] as const).map((each) => {
    const kinds = countBy(underJudged.get(each) ?? [], (solve) => log.verdicts.get(solve.id)?.kind ?? "none");
    return `${each} pass ${String(kinds.pass ?? 0)} fail ${String(kinds.fail ?? 0)}`;
  });
  const elsewhere = countBy(
    judged.filter((solve) => !under(solve)),
    (solve) => short(programOf(solve)),
  );
  const passSummary = passAgreement(settledPassLabels(events));
  const passLine =
    passSummary.total === 0
      ? "pass soundness: 0 labelled passes (uncalibrated by a human)"
      : `pass soundness: ${String(passSummary.total)} labelled (sound ${String(passSummary.counts.sound)}, wrong ${String(passSummary.counts.wrong)}, unclear ${String(passSummary.counts.unclear)}), wrong rate ${passSummary.wrongRate === null ? "none" : `${(passSummary.wrongRate * 100).toFixed(1)}%`}, bar ${passSummary.clears ? "clears" : "unmet"}`;
  const scoredJudged = underJudged.get("scored") ?? [];
  const scoredPasses = scoredJudged.filter((solve) => log.verdicts.get(solve.id)?.kind === "pass").length;
  const passRate =
    scoredJudged.length === 0
      ? "none"
      : `${String(scoredPasses)}/${String(scoredJudged.length)} (${String(Math.round((100 * scoredPasses) / scoredJudged.length))}%)`;
  const elsewhereText =
    Object.entries(elsewhere)
      .map(([at, n]) => `${at} ${String(n)}`)
      .join(", ") || "none";
  return [
    headOf(events, reading, disk),
    "id  instrument  rules  evidence  controls caught/named  refused in all  scored ref/new  examiner  practice  under another program  scored stands earned/defect/unclear/unread  labelled  every control passed/refused",
    ...lines,
    `verdicts under ${short(program)}: ${verdicts.join(", ")}; scored pass rate ${passRate}; under another program or before any reading: ${elsewhereText}`,
    passLine,
    controlsLine(reading),
    ...(strings(reading?.faults).length > 0
      ? [`the reading's faults: ${String(strings(reading?.faults).length)}`]
      : []),
  ];
}
