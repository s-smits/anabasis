/**
 * The drafted exam's structure and how it came to stand, for lane 6 (the drafted exam against its
 * prompt):
 *
 *   bun tools/wri/drafted.ts <log> [--siblings]
 *
 * One row for the prompt (its words and digest), one a drafting session with each draft it put and
 * how the host read it, one for the standing draft (`draftOf`, `src/examiner/draft.ts`) with the
 * shape faults `draftFaults` finds in it, one for its checks (those their author decides,
 * `unadmitted`, and those `contract.frozen` admitted), and one for the drafting calls that failed.
 * Between 3 and 10 November 13 of 17 lane-6 sessions read `exam.drafted` with jq for these fields,
 * 12 read `draft.started` and `draft.finished` beside it, and 7 read `draft.call` for a failed
 * import or write.
 *
 * A draft the host refused is told only in the `draft_exam` result (`drafting`), so its faults are
 * read from there, by the lead the host writes. `--siblings` adds the archived campaigns drafted
 * from the same prompt, each with its own standing draft's counts; it reads the archive, so a lane
 * passes it by hand and the derived output holds none of it. Counts, ids and the host's own fault
 * sentences only: no rule statement, check source or task.
 */
import { openingOf } from "#src/campaign/opening.ts";
import { type Draft, draftFaults, draftOf } from "#src/examiner/draft.ts";
import { unadmitted } from "#src/kernel/acceptance.ts";
import { type LogEvent, read } from "#src/kernel/log.ts";
import { tracesIn } from "#src/kernel/trace.ts";
import { sha256 } from "#src/meta/digest.ts";
import { existsSync, readdirSync, readFileSync } from "#src/meta/filesystem.ts";
import { parseJsonAs } from "#src/meta/json-runtime.ts";
import { asRecord, isNumber, isString } from "#src/meta/json-shape.ts";
import { join } from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { plural } from "#src/meta/text.ts";
import { archiveOf } from "#tools/runs/registry.ts";

const NOT_RECORDED = "not recorded";
/** How the host begins its reading of a draft that does not stand (`drafting`, `draft.ts`). */
const FELL = "The draft does not stand.";
const STOOD = "The draft stands";
/** A fault sentence is cut here: the host's sentences run to a few hundred characters. */
const CLIP = 140;

const clip = (text: string) => (text.length <= CLIP ? text : `${text.slice(0, CLIP)}...`);
const words = (text: string) => text.split(/\s+/u).filter((word) => word !== "").length;

/** Each `draft_exam` call of a session as the host read it: stands, or the faults it named. */
function putsOf(events: readonly LogEvent[], session: string): string[] {
  return tracesIn(events).flatMap((call) => {
    if (call.part !== "call" || call.seat !== "draft" || call.id !== session || call.tool !== "draft_exam") {
      return [];
    }
    const at = `turn ${String(call.turn ?? "?")}`;
    if (call.text.startsWith(STOOD)) return [`  ${at}: stands`];
    if (!call.text.startsWith(FELL)) return [`  ${at}: ${clip(call.text.split("\n")[0] ?? "")}`];
    const faults = call.text.split("\n").filter((line) => line.startsWith("- "));
    return [
      `  ${at}: does not stand, ${plural(faults.length, "fault")}`,
      ...faults.map((fault) => `    ${clip(fault)}`),
    ];
  });
}

/** One row a drafting session: how it ended, after how many drafts, turns, seconds and dollars. */
function sessionRows(events: readonly LogEvent[]): string[] {
  return events.flatMap(({ kind, data }) => {
    if (kind !== "draft.finished" || !isString(data.session)) return [];
    const count = (value: unknown, unit: string) =>
      isNumber(value) ? plural(value, unit) : `${unit}s ${NOT_RECORDED}`;
    const spent = [
      count(data.tries, "draft"),
      count(data.turns, "turn"),
      isNumber(data.seconds) ? `${String(Math.round(data.seconds))} s` : `seconds ${NOT_RECORDED}`,
      isNumber(data.billed) ? `$${data.billed.toFixed(2)}` : `bill ${NOT_RECORDED}`,
    ];
    const crash = isString(data.crash) ? `; crash: ${clip(data.crash)}` : "";
    return [
      `${data.session}: ended ${isString(data.ended) ? data.ended : NOT_RECORDED} after ${spent.join(", ")}${crash}`,
      ...putsOf(events, data.session),
    ];
  });
}

/** The standing draft's counts, one line. */
function standingRow(draft: Draft, session: string): string {
  const objective =
    draft.objective === undefined
      ? `none (reason given: ${draft.unmeasured === undefined ? NOT_RECORDED : "yes"})`
      : `${draft.objective.direction}, a quantity of ${plural(words(draft.objective.quantity), "word")}`;
  const fields = Object.keys(asRecord(asRecord(draft.answerFormat)?.properties) ?? {}).length;
  const families = new Set(draft.tasks.map(({ family }) => family)).size;
  const rules = draft.rules.map(({ id }) => id);
  return `standing draft (${session}): ${plural(rules.length, "rule")} (${rules.join(", ")}), ${plural(draft.checks.length, "check")}, objective ${objective}, ${plural(fields, "answer field")}, ${plural(draft.tasks.length, "example")} in ${String(families)} ${families === 1 ? "family" : "families"}, controls ${String(draft.accept.length)} accepted and ${String(draft.reject.length)} refused`;
}

/** The checks their author decides, and those the frozen contract admitted, by id. */
function checkRow(events: readonly LogEvent[]): string {
  const reading = events.findLast(({ kind }) => kind === "checker.read");
  if (reading === undefined) return `checks: checker reading ${NOT_RECORDED}`;
  const authored = unadmitted(events, []);
  const frozen = events.findLast(({ kind }) => kind === "contract.frozen")?.data;
  const admitted = Array.isArray(frozen?.admitted) ? frozen.admitted.filter(isString) : null;
  const rows = Array.isArray(reading.data.rows) ? reading.data.rows.length : 0;
  const left = admitted === null ? [] : authored.filter((id) => !admitted.includes(id));
  return `checks: ${String(rows)} read, ${String(authored.length)} decided by their author; frozen with ${
    admitted === null
      ? `admissions ${NOT_RECORDED}`
      : `${String(admitted.length)} admitted (${admitted.join(", ") || "none"})`
  }${left.length === 0 ? "" : `; author-decided and not admitted: ${left.join(", ")}`}`;
}

/** The drafting calls that failed, each by session, turn and tool, with its first line. */
function failedRows(events: readonly LogEvent[]): string[] {
  const calls = tracesIn(events).flatMap((each) =>
    each.part === "call" && each.seat === "draft" ? [each] : [],
  );
  const failed = calls.filter(({ isError }) => isError);
  return [
    `drafting calls: ${String(calls.length)}, ${String(failed.length)} failed`,
    // A failed call's own output can hold what its author computed, so only where it fell is said.
    ...failed.map(({ id, turn, tool }) => `  ${id} turn ${String(turn ?? "?")} ${tool}`),
  ];
}

/** The prompt the exam was drafted from, as `openingOf` reads it, or the first drafting session's. */
function promptOf(events: readonly LogEvent[]): string | null {
  const opened = openingOf(events)?.prompt;
  if (isString(opened)) return opened;
  const started = events.find(({ kind }) => kind === "draft.started")?.data.prompt;
  return isString(started) ? started : null;
}

const digestOf = (prompt: string) => sha256(prompt).slice(0, 12);

/** Every row, with a first line that says what they are. */
export function draftRows(events: readonly LogEvent[]): string[] {
  const prompt = promptOf(events);
  const drafted = events.findLast(({ kind }) => kind === "exam.drafted")?.data.session;
  const draft = draftOf(events);
  const faults = draft === null ? [] : draftFaults(draft);
  return [
    "draft: the exam's drafting as the log records it, each drafting session and each draft it put, then the standing draft's counts; ids, counts and the host's fault sentences only",
    prompt === null
      ? `prompt: ${NOT_RECORDED}`
      : `prompt: ${plural(words(prompt), "word")}, digest ${digestOf(prompt)}`,
    ...sessionRows(events),
    draft === null ? "standing draft: none" : standingRow(draft, isString(drafted) ? drafted : "?"),
    ...(draft === null
      ? []
      : [
          `shape faults in the standing draft: ${faults.length === 0 ? "none" : faults.map(clip).join("; ")}`,
        ]),
    checkRow(events),
    ...failedRows(events),
  ];
}

/** The archived campaigns drafted from the same prompt, each with its standing draft's counts. */
export function siblingRows(prompt: string, archive: string, own: string): string[] {
  if (!existsSync(archive)) return [`siblings: no archive at ${archive}`];
  const digest = digestOf(prompt);
  const logs = readdirSync(archive).flatMap((host) =>
    existsSync(join(archive, host))
      ? readdirSync(join(archive, host)).map((name) => join(archive, host, name, "log.jsonl"))
      : [],
  );
  const rows = logs.flatMap((log) => {
    if (log === own || !existsSync(log)) return [];
    // Only the drafting lines are parsed: an archived log runs to 90 MB.
    const lines = readFileSync(log, "utf8")
      .split("\n")
      .filter((line) => line.includes('"kind":"campaign.opened"') || line.includes('"kind":"exam.drafted"'));
    const events = lines.map((line) => parseJsonAs<LogEvent>(line));
    const theirs = promptOf(events);
    if (theirs === null || digestOf(theirs) !== digest) return [];
    const draft = draftOf(events);
    const name = log.slice(archive.length + 1, -"/log.jsonl".length);
    return [`  ${name}: ${draft === null ? "no standing draft" : standingRow(draft, "last")}`];
  });
  return [`siblings, drafted from the prompt of digest ${digest}: ${String(rows.length)}`, ...rows];
}

if (import.meta.main) {
  const args = runtimeProcess.argv.slice(2);
  const log = args.find((arg) => !arg.startsWith("--"));
  if (log === undefined) throw new Error("name a log: bun tools/wri/drafted.ts <log> [--siblings]");
  const events = read(log);
  const prompt = promptOf(events);
  const siblings =
    args.includes("--siblings") && prompt !== null
      ? siblingRows(prompt, archiveOf(import.meta.dir), log)
      : [];
  console.log([...draftRows(events), ...siblings].join("\n"));
}
