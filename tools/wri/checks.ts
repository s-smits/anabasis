/**
 * Each check of a campaign's exam in one row: how the checker reading rated it, the rules its brief
 * cites, its control answers, and what the campaign's answers met under it, by who asked for them
 * and by side, with what stands of its scored refusals. The first line names the exam the rows
 * belong to: the check program on disk, the one the rows were read at and the frozen one.
 *
 *   bun tools/wri/wri.ts reader checks --log <log | campaign folder | name>
 *
 * Lanes 1, 3 and 5 read it first. Between 3 and 10 November all 18 lane 1 sessions found the exam's
 * files by hand and set each `checker.read` row beside its `brief.json` entry, and 5 of 8 lane 3
 * sessions built the same table, about 130 calls between them. `REFUSALS BY CHECK` gave one count a
 * check and no split by side, by who asked or by version.
 *
 * The rows are the last `checker.read` at the frozen check program (`frozenChecker`), or the last
 * reading where none is frozen. A solve is counted under the program of the last reading before it
 * started, so an answer judged under an earlier draft is counted apart, as is one judged before any
 * reading. A refusal by several checks counts under each (`refusalsByCheck`, which `REFUSALS BY
 * CHECK` reads), so a column can sum past the answers. What stands is `standsOf`'s, a label over the
 * ruling (rule 8). A check the verdicts name and the reading does not gets a row of its own, marked.
 * It prints counts; no row says which check to read.
 */
import { frozenChecker } from "#src/kernel/acceptance.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import { labelsIn } from "#src/kernel/solves.ts";
import { blockingOf, type Brief, checkProgramVersion, OBJECTIVE, readBrief } from "#src/kernel/verify.ts";
import { existsSync } from "#src/meta/filesystem.ts";
import { asRecord, isString, type JsonObject } from "#src/meta/json-shape.ts";
import { dirname, join } from "#src/meta/path.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { hashJsonValue } from "#src/meta/stable-json.ts";
import { countBy } from "#src/meta/tally.ts";
import { stagedExamOf } from "#tools/d2/exam.ts";
import { count, indexOf, items, refusals, refusalsByCheck, type Solve, strings, text } from "./folds.ts";
import { askedOf, sideOf } from "./rejections.ts";

/** Where the exam's check program stands on disk, and what it holds, or why neither is known. */
interface OnDisk {
  readonly where: string;
  readonly version: string | null;
  readonly brief: Brief | null;
}

const NOT_RECORDED = "not recorded";
const STANDS = ["earned", "check-defect", "unclear", "unread"] as const;
const short = (digest: string | null | undefined) => (isString(digest) ? digest.slice(0, 8) : NOT_RECORDED);

/** The check program a campaign judges by: a drafted exam where it was staged (`stagedExamOf`), a
 *  stored pack's beside the log. Read, never written. */
export function programOnDisk(log: string): OnDisk {
  let checks: string;
  try {
    checks = stagedExamOf(log)?.checks ?? join(dirname(log), "checks");
  } catch (error) {
    return { where: errorMessage(error), version: null, brief: null };
  }
  if (!existsSync(join(checks, "brief.json"))) {
    return { where: `${checks} (not on disk)`, version: null, brief: null };
  }
  return { where: checks, version: hashJsonValue(checkProgramVersion(checks)), brief: readBrief(checks) };
}

/** The program each solve was judged under: the last `checker.read` before it started. */
function programsOf(events: readonly LogEvent[]): (solve: Solve) => string | null {
  const readings = events.flatMap(({ kind, data }, index) =>
    kind === "checker.read" && isString(data.checks) ? [{ index, checks: data.checks }] : [],
  );
  return (solve) => readings.findLast(({ index }) => index < solve.index)?.checks ?? null;
}

/** The first line: which exam the rows are, against the frozen one and the one on disk. */
function headOf(events: readonly LogEvent[], reading: JsonObject | undefined, disk: OnDisk): string {
  const frozen = frozenChecker(events)?.checks ?? null;
  const drafts = events.filter(({ kind }) => kind === "exam.drafted").length;
  const readings = events.filter(({ kind }) => kind === "checker.read").length;
  const at = text(reading?.checks);
  const against =
    frozen === null ? "none frozen" : at === frozen ? "the frozen one" : `not the frozen ${short(frozen)}`;
  const onDisk =
    disk.version === null
      ? disk.where
      : `${disk.where} at ${short(disk.version)}${disk.version === at ? ", the same" : ", another"}`;
  return `checks: rows of the check program read at ${short(at || null)}, ${against}; on disk ${onDisk}; ${String(drafts)} exam.drafted, ${String(readings)} checker.read`;
}

/** How many control answers the reading put to the checks, and what the do-nothing answer met. */
function controlsLine(reading: JsonObject | undefined): string {
  const idle = asRecord(reading?.doNothing);
  const met =
    idle === null
      ? NOT_RECORDED
      : `refused on ${String(count(idle.rejected))} of ${String(count(idle.tasks))} tasks`;
  const controls = reading?.controls === undefined ? NOT_RECORDED : String(count(reading.controls));
  return `controls read: ${controls}; the do-nothing answer: ${met}`;
}

/** One row a check, then the verdicts under the rows' program by who asked for them. */
export function checkRows(events: readonly LogEvent[], disk: OnDisk): string[] {
  const log = indexOf(events);
  const frozen = frozenChecker(events)?.checks;
  const readings = log.of("checker.read");
  const reading = readings.findLast((data) => data.checks === frozen) ?? readings.at(-1);
  const program = isString(reading?.checks) ? reading.checks : null;
  const [asked, side, programOf, labels] = [askedOf(log), sideOf(log), programsOf(events), labelsIn(events)];
  const under = (solve: Solve) => program !== null && programOf(solve) === program;
  const rowsRead = items(reading?.rows).flatMap((row) => {
    const record = asRecord(row);
    return record === null || record.id === OBJECTIVE.id ? [] : [record];
  });
  const totals = refusalsByCheck(log);
  const ids = [...new Set([...rowsRead.map((row) => text(row.id)), ...Object.keys(totals)])];
  const refused = refusals(log);
  const lines = ids.map((id) => {
    const row = rowsRead.find((each) => each.id === id);
    const declared = disk.brief?.truthChecks.find((check) => check.id === id);
    const mine = refused.filter((solve) => blockingOf(log.verdicts.get(solve.id)?.checker).includes(id));
    const here = mine.filter(under);
    const scored = here.filter((solve) => asked(solve) === "scored");
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
      String(here.filter((solve) => asked(solve) === "examiner").length),
      String(here.filter((solve) => asked(solve) === "practice").length),
      String(mine.length - here.length),
      STANDS.map((each) => String(stood[each] ?? 0)).join("/"),
      String(scored.filter((solve) => labels.has(solve.id)).length),
      row === undefined || row.passed === undefined
        ? NOT_RECORDED
        : `${String(count(row.passed))}/${String(count(row.refused))}`,
    ].join("  ");
  });
  const judged = log.solves.filter((solve) => log.verdicts.has(solve.id));
  const verdicts = (["scored", "examiner", "practice"] as const).map((each) => {
    const of = judged.filter((solve) => under(solve) && asked(solve) === each);
    const kinds = countBy(of, (solve) => log.verdicts.get(solve.id)?.kind ?? "none");
    return `${each} pass ${String(kinds.pass ?? 0)} fail ${String(kinds.fail ?? 0)}`;
  });
  const elsewhere = countBy(
    judged.filter((solve) => !under(solve)),
    (solve) => short(programOf(solve)),
  );
  return [
    headOf(events, reading, disk),
    "id  instrument  rules  evidence  controls caught/named  refused in all  scored ref/new  examiner  practice  under another program  scored stands earned/defect/unclear/unread  labelled  every control passed/refused",
    ...lines,
    `verdicts under ${short(program)}: ${verdicts.join(", ")}; under another program or before any reading: ${
      Object.keys(elsewhere).length === 0
        ? "none"
        : Object.entries(elsewhere)
            .map(([at, n]) => `${at} ${String(n)}`)
            .join(", ")
    }`,
    controlsLine(reading),
    ...(strings(reading?.faults).length > 0
      ? [`the reading's faults: ${String(strings(reading?.faults).length)}`]
      : []),
  ];
}
