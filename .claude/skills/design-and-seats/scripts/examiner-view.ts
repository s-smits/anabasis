#!/usr/bin/env bun
/**
 * Summarises the campaign record an Examiner opening would receive, or with `--each` reconstructs
 * what each recorded writing session was told when it began: `examiner-view.ts <log.jsonl |
 * campaign name> [--each]`. Calls `heard` (`src/examiner/record.ts`) over the drafted examples and
 * written tasks and reports line counts per heading, reference outcome counts (`poolOf`), the last
 * comparison line and any promotion notice, omitting task prose, refusal text and hidden values.
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

function familiesOf(events: readonly LogEvent[]): Map<string, string> {
  const drafted = draftOf(events)?.tasks ?? [];
  return new Map([
    ...drafted.map(({ family }, index) => [exampleId(index), family] as const),
    ...writtenTasks(events).map(({ taskId, family }) => [taskId, family] as const),
  ]);
}

function namedTasks(ids: readonly string[], families: ReadonlyMap<string, string>): Named[] {
  return ids.map((taskId) => ({ taskId, family: families.get(taskId) ?? NOT_RECORDED }));
}

function nextTasks(events: readonly LogEvent[]): Named[] {
  const last = events.findLast(({ kind }) => kind === "exam.started");
  const examples = Array.isArray(last?.data.examples) ? last.data.examples.filter(isString) : [];
  const ids = [...new Set([...examples, ...writtenTasks(events).map(({ taskId }) => taskId)])];
  return namedTasks(ids, familiesOf(events));
}

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

function partsAt(rebuilt: string, served: string): number | null {
  if (rebuilt === served) return null;
  const [mine, theirs] = [rebuilt.split("\n"), served.split("\n")];
  const at = mine.findIndex((line, index) => line !== theirs[index]);
  return (at === -1 ? mine.length : at) + 1;
}

function servedWake(events: readonly LogEvent[], start: number): string | null {
  for (const { kind, data } of events.slice(start + 1)) {
    if (kind === "exam.finished") return null;
    const at = kind === "exam.call" && isString(data.text) ? data.text.indexOf(WAKE) : -1;
    if (at !== -1 && isString(data.text)) return data.text.slice(at);
  }
  return null;
}

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

/** The view rebuilt on the log before the session's start, against what the log holds of what it
 *  was served. */
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
