/**
 * The drafted exam's structure and how it came to stand, for lane 2:
 *
 *   bun tools/wri/drafted.ts <log> [--siblings]
 */
import { openingOf } from "#src/campaign/opening.ts";
import { type Draft, draftFaults, draftOf } from "#src/examiner/draft.ts";
import { unadmitted } from "#src/kernel/acceptance.ts";
import { eventsOf, type LogEvent, read } from "#src/kernel/log.ts";
import { type Call, callsOf } from "#src/kernel/trace.ts";
import { sha256 } from "#src/meta/digest.ts";
import { existsSync, readdirSync, readFileSync } from "#src/meta/filesystem.ts";
import { parseJsonAs } from "#src/meta/json-runtime.ts";
import { asRecord, isNumber, isString } from "#src/meta/json-shape.ts";
import { join } from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { plural } from "#src/meta/text.ts";
import { archiveOf } from "#tools/runs/registry.ts";
import { indexOf } from "./folds.ts";

const NOT_RECORDED = "not recorded";
const FELL = "The draft does not stand.";
const STOOD = "The draft stands";
const CLIP = 140;

const clip = (text: string) => (text.length <= CLIP ? text : `${text.slice(0, CLIP)}...`);
const words = (text: string) => text.split(/\s+/u).filter(Boolean).length;
const digestOf = (prompt: string) => sha256(prompt).slice(0, 12);

function putsOf(draftCalls: readonly Call[], session: string): string[] {
  return draftCalls.flatMap((call) => {
    if (call.id !== session || call.tool !== "draft_exam") return [];
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

function sessionRows(events: readonly LogEvent[], draftCalls: readonly Call[]): string[] {
  const count = (value: unknown, unit: string) =>
    isNumber(value) ? plural(value, unit) : `${unit}s ${NOT_RECORDED}`;
  return eventsOf(events, "draft.finished").flatMap(({ event: { data } }) => {
    if (!isString(data.session)) return [];
    const spent = [
      count(data.tries, "draft"),
      count(data.turns, "turn"),
      isNumber(data.seconds) ? `${String(Math.round(data.seconds))} s` : `seconds ${NOT_RECORDED}`,
      isNumber(data.billed) ? `$${data.billed.toFixed(2)}` : `bill ${NOT_RECORDED}`,
    ];
    const crash = isString(data.crash) ? `; crash: ${clip(data.crash)}` : "";
    return [
      `${data.session}: ended ${isString(data.ended) ? data.ended : NOT_RECORDED} after ${spent.join(", ")}${crash}`,
      ...putsOf(draftCalls, data.session),
    ];
  });
}

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

function checkRow(events: readonly LogEvent[]): string {
  const reading = eventsOf(events, "checker.read").at(-1)?.event;
  if (reading === undefined) return `checks: checker reading ${NOT_RECORDED}`;
  const authored = unadmitted(events, []);
  const frozen = eventsOf(events, "contract.frozen").at(-1)?.event.data;
  const admitted = Array.isArray(frozen?.admitted) ? frozen.admitted.filter(isString) : null;
  const rows = Array.isArray(reading.data.rows) ? reading.data.rows.length : 0;
  const left = admitted === null ? [] : authored.filter((id) => !admitted.includes(id));
  const admittedText =
    admitted === null
      ? `admissions ${NOT_RECORDED}`
      : `${String(admitted.length)} admitted (${admitted.join(", ") || "none"})`;
  return `checks: ${String(rows)} read, ${String(authored.length)} decided by their author; frozen with ${admittedText}${left.length === 0 ? "" : `; author-decided and not admitted: ${left.join(", ")}`}`;
}

function promptOf(events: readonly LogEvent[]): string | null {
  const opened = openingOf(events)?.prompt;
  if (isString(opened)) return opened;
  const started = eventsOf(events, "draft.started")[0]?.event.data.prompt;
  return isString(started) ? started : null;
}

/** Every row, with a first line that says what they are. */
export function draftRows(events: readonly LogEvent[]): string[] {
  const prompt = promptOf(events);
  const drafted = eventsOf(events, "exam.drafted").at(-1)?.event.data.session;
  const draft = draftOf(events);
  const draftCalls = callsOf(indexOf(events).traces, "draft");
  const failed = draftCalls.filter(({ isError }) => isError);
  const standing =
    draft === null
      ? ["standing draft: none"]
      : [
          standingRow(draft, isString(drafted) ? drafted : "?"),
          `shape faults in the standing draft: ${draftFaults(draft).map(clip).join("; ") || "none"}`,
        ];
  return [
    "draft: the exam's drafting as the log records it, each drafting session and each draft it put, then the standing draft's counts; ids, counts and the host's fault sentences only",
    prompt === null
      ? `prompt: ${NOT_RECORDED}`
      : `prompt: ${plural(words(prompt), "word")}, digest ${digestOf(prompt)}`,
    ...sessionRows(events, draftCalls),
    ...standing,
    checkRow(events),
    `drafting calls: ${String(draftCalls.length)}, ${String(failed.length)} failed`,
    ...failed.map(({ id, turn, tool }) => `  ${id} turn ${String(turn ?? "?")} ${tool}`),
  ];
}

/** The archived campaigns drafted from the same prompt, each with its standing draft's counts. */
export function siblingRows(prompt: string, archive: string, own: string): string[] {
  if (!existsSync(archive)) return [`siblings: no archive at ${archive}`];
  const digest = digestOf(prompt);
  const logs = readdirSync(archive, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap(({ name: host }) =>
      readdirSync(join(archive, host), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map(({ name }) => join(archive, host, name, "log.jsonl")),
    );
  const rows = logs.flatMap((log) => {
    if (log === own || !existsSync(log)) return [];
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
