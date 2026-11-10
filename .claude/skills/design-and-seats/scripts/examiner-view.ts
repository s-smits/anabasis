#!/usr/bin/env bun
/**
 * Summarise the campaign information an Examiner opening would receive, or with `--each` what each
 * writing session on record was told as it began.
 *
 *   bun .claude/skills/design-and-seats/scripts/examiner-view.ts <log.jsonl | campaign name> [--each]
 *
 * Call heard, the production composer in src/examiner/record.ts, and report the lines under each
 * block's heading, reference outcomes from poolOf, the last comparison's line and the promotion
 * notice. Print the two aggregate messages in full; omit task text,
 * refusal reasons and hidden values. This helps inspect a view before changing its delivery.
 *
 * The tasks are those the last ask named (`exam.started`'s `examples`) with every task written since,
 * as the next ask is given them; until 10 November they came from proposalsOf alone, which drops a
 * stored pack's tasks and the drafted examples, so the view listed fewer tasks than the session read.
 *
 * `--each` rebuilds each session's view on the log as it stood when that ask began, through the same
 * code: a continued conversation's wake through `wakeOn` (`src/examiner/write.ts`), compared with the
 * wake on record, which the resting call's result carries; an opening's task lines, counted against
 * a `read_opening` result the session received. The contract, the checks and the budget come from the
 * campaign's terms and are not rebuilt. Between 3 and 10 November 18 of 18 lane-2 sessions and 14 of
 * 18 lane-11 sessions rebuilt these by hand, cutting the log before each `exam.started`.
 *
 * logAcross resolves names across configured hosts and refreshes their records. logEvents reads
 * through the last complete line, allowing live logs.
 *
 * Written on 30 October alongside seat-view.ts.
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { draftOf } from "#src/examiner/draft.ts";
import { heard } from "#src/examiner/record.ts";
import { wakeOn } from "#src/examiner/write.ts";
import { writtenTasks } from "#src/kernel/history.ts";
import type { LogEvent } from "#src/kernel/log.ts";
import { poolOf } from "#src/kernel/reports.ts";
import { asRecord, isNumber, isString, type JsonObject } from "#src/meta/json-shape.ts";
import { countBy } from "#src/meta/tally.ts";
import { plural } from "#src/meta/text.ts";
import { exampleId } from "#tools/d2/exam.ts";
import { logEvents } from "#tools/runs/registry.ts";
import { logAcross } from "#tools/runs/snapshots.ts";

const NOT_RECORDED = "not recorded";
/** How a wake begins (`wakeMessage`, `src/examiner/prompt.ts`), which finds it among the calls. */
const WAKE = "The host asks for more tasks under the same exam.";

interface Named {
  readonly taskId: string;
  readonly family: string;
}

/** Each task id the log names a family for: the written tasks, then the drafted exam's examples. */
function familiesOf(events: readonly LogEvent[]): Map<string, string> {
  const drafted = draftOf(events)?.tasks ?? [];
  return new Map([
    ...drafted.map(({ family }, index) => [exampleId(index), family] as const),
    ...writtenTasks(events).map(({ taskId, family }) => [taskId, family] as const),
  ]);
}

/** The tasks an ask named, in its order, each with the family the log gives it, or none. */
function namedTasks(ids: readonly string[], families: ReadonlyMap<string, string>): Named[] {
  return ids.map((taskId) => ({ taskId, family: families.get(taskId) ?? NOT_RECORDED }));
}

/** The ids the last ask named, then every task written since, as the next ask names them. */
function nextTasks(events: readonly LogEvent[]): Named[] {
  const last = events.findLast(({ kind }) => kind === "exam.started");
  const examples = Array.isArray(last?.data.examples) ? last.data.examples.filter(isString) : [];
  const ids = [...new Set([...examples, ...writtenTasks(events).map(({ taskId }) => taskId)])];
  return namedTasks(ids, familiesOf(events));
}

/** The view `heard` gives over `events`, as counts and its two lines of counts. */
export function examinerCounts(events: readonly LogEvent[]): string[] {
  const tasks = nextTasks(events);
  const view = heard(events, tasks);
  const outcomes = countBy([...poolOf(events).outcomes.values()], (outcome) => outcome);
  return [
    `blocks: ${blocksOf(view)}, over ${plural(tasks.length, "task")}`,
    `outcomes in the last comparison that scored each task: ${
      Object.entries(outcomes)
        .map(([outcome, count]) => `${outcome} ${String(count)}`)
        .join(", ") || "none"
    }`,
    `last: ${view.stood ?? "none"}`,
    `promotion: ${view.promoted ?? "none"}`,
  ];
}

const blocksOf = (view: ReturnType<typeof heard>) =>
  view.groups.map(({ heading, lines }) => `${String(lines.length)} under "${heading}"`).join("; ") || "none";

/** The first line at which two texts part, counted from 1, or null where they are the same. */
function partsAt(rebuilt: string, served: string): number | null {
  if (rebuilt === served) return null;
  const [mine, theirs] = [rebuilt.split("\n"), served.split("\n")];
  const at = mine.findIndex((line, index) => line !== theirs[index]);
  return (at === -1 ? mine.length : at) + 1;
}

/** The wake in the first Examiner call result after event `start` that holds one, before the session
 *  it starts finishes: the resting call's result carries it after the call's own text. */
function servedWake(events: readonly LogEvent[], start: number): string | null {
  for (const { kind, data } of events.slice(start + 1)) {
    if (kind === "exam.finished") return null;
    const at = kind === "exam.call" && isString(data.text) ? data.text.indexOf(WAKE) : -1;
    if (at !== -1 && isString(data.text)) return data.text.slice(at);
  }
  return null;
}

/** The `read_opening` results a session received, between its start and its finish. */
function servedOpenings(events: readonly LogEvent[], start: number, session: string): string[] {
  const end = events.findIndex(
    ({ kind, data }, index) => index > start && kind === "exam.finished" && data.session === session,
  );
  return events
    .slice(start + 1, end === -1 ? undefined : end)
    .flatMap(({ kind, data }) =>
      kind === "exam.call" && data.session === session && data.tool === "read_opening" && isString(data.text)
        ? [data.text]
        : [],
    );
}

/** One session's rows: the view rebuilt on the log before its start, and how it stands against
 *  what the log holds of what it was served. */
function sessionRows(events: readonly LogEvent[], start: number): string[] {
  const data: JsonObject = events[start]?.data ?? {};
  const session = isString(data.session) ? data.session : "?";
  const before = events.slice(0, start);
  const ids = Array.isArray(data.examples) ? data.examples.filter(isString) : [];
  const tasks = namedTasks(ids, familiesOf(before));
  const unnamed = tasks.filter(({ family }) => family === NOT_RECORDED).length;
  const over = `${plural(tasks.length, "task")}${unnamed === 0 ? "" : `, ${String(unnamed)} with no family on record`}`;
  if (!isString(data.conversation)) {
    const view = heard(before, tasks);
    const lines = view.groups.flatMap(({ lines: each }) => each.map((line) => `- ${line}`));
    const served = servedOpenings(events, start, session);
    const against = served.map((text) => lines.filter((line) => text.includes(line)).length);
    return [
      `${session}, opening, line ${String(start + 1)}: blocks ${blocksOf(view)}, over ${over}`,
      `  read_opening results: ${served.length === 0 ? "none" : against.map((found) => `${String(found)} of ${String(lines.length)} task lines in it`).join("; ")}`,
    ];
  }
  const limits = asRecord(data.limits);
  const told = {
    wallSeconds: isNumber(limits?.wallSeconds) ? limits.wallSeconds : 0,
    turns: isNumber(limits?.turns) ? limits.turns : 0,
    puts: isNumber(limits?.proposals) ? limits.proposals : 0,
    tries: isNumber(limits?.tries) ? limits.tries : 0,
  };
  const wake = wakeOn(before, tasks, told);
  const served = servedWake(events, start);
  // The session's loop puts its turn line after the wake in the same result.
  const after =
    served?.startsWith(`${wake}\n`) === true ? served.slice(wake.length + 1).split("\n").length : 0;
  const parted = served === null || after > 0 ? null : partsAt(wake, served);
  const reading =
    served === null
      ? `the wake on record: ${NOT_RECORDED}`
      : parted === null
        ? `the same text as the wake on record${after === 0 ? "" : `, which adds ${plural(after, "line")} after it`}`
        : `parts from the wake on record at line ${String(parted)}`;
  return [
    `${session}, continues ${data.conversation}, line ${String(start + 1)}: wake of ${String(wake.split("\n").length)} lines over ${over}; ${reading}`,
  ];
}

/** Each writing session's rows, in the order they started, with a first line saying what they are. */
export function examinerEach(events: readonly LogEvent[]): string[] {
  const starts = events.flatMap(({ kind }, index) => (kind === "exam.started" ? [index] : []));
  return [
    "examiner-view --each: each writing session's view rebuilt by this tree's code on the log before its start, beside what the log holds of what it was served (a log written by older code was served that code's text); counts only",
    ...(starts.length === 0
      ? ["no writing session on record"]
      : starts.flatMap((start) => sessionRows(events, start))),
  ];
}

if (import.meta.main) {
  await runCommand(
    {
      name: "examiner-view",
      usage: "examiner-view.ts <log.jsonl | campaign name> [--each]",
      positionals: 1,
      options: { each: "flag" },
    },
    async (args: CommandArgs) => {
      const [named = ""] = args.positionals;
      const events = logEvents(await logAcross(named));
      console.log((args.flag("each") ? examinerEach(events) : examinerCounts(events)).join("\n"));
    },
  );
}
