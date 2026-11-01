/**
 * `GET /api/log?key=` and `GET /api/event?key=&index=`: the log as a timeline, one line a thing that
 * happened, and one event whole, which the exam tier alone answers (`EXAM_ONLY`, refused by the
 * router before this is asked).
 *
 * Until 30 October the Log pane listed every raw event a page at a time: three in four were a
 * model's turns and calls, and on the default tier an event opened to a line saying the exam side
 * held it, so the pane said only that something happened (operator). A line now says what happened
 * in words from what the default tier serves (counts, ids, states, endings, readings, costs and
 * times; `models.ts`), and a session's or a solve's turns, calls and compactions are counted into
 * its own line, which runs from its start to its end, and so is a solve's wait for a loaded host
 * (461 of 2,428 lines in buffer-fresh-opus-v065-a). The author's answer behind `task.feasible` is the exam side's, so its line says only that one is on record. A check's verdict and a condition say nothing
 * the solve's ending does not, and a ruling is the exam side's, so neither has a line.
 */
import type { LogEvent } from "../../../../src/kernel/log.ts";
import { isNumber, isRecord, isString } from "../../../../src/meta/json-shape.ts";
import { plural } from "../../../../src/meta/text.ts";
import type { LogEventDetail, Query, Timeline, TimelineGroup, TimelineRow } from "../models.ts";
import { money, seconds } from "../views/format.ts";
import { type Reading, Unanswerable } from "./context.ts";
import { once } from "./folds.ts";
import { campaignAt } from "./logs.ts";

/** A model seat's sessions, by the prefix of their events' kinds. */
const SEATS = new Map([
  ["build", "Builder session"],
  ["exam", "Examiner session"],
  ["draft", "Exam draft"],
  ["repair", "Exam repair"],
]);
/** The kinds a line leaves out: what a solve's ending or the exam side already says. */
const UNSAID: ReadonlySet<string> = new Set(["verdict", "condition.recorded", "referee.finding"]);

/** Why the campaign waited, by a wait's `for` (`tools/d2/host.ts`, `src/solver/run.ts`). */
const WAITS = new Map([
  ["provider", "for the provider's limit to reset"],
  ["network", "after the network failed a session"],
]);

/** A line while the log is read: its counts, filled in by the events after its start. */
interface Open {
  row: TimelineRow;
  turns: number;
  calls: number;
  compactions: number;
  said: string;
}

/** How many a field holds: an array's length or a count. */
function many(value: unknown): number | null {
  if (Array.isArray(value)) return value.length;
  return isNumber(value) ? value : null;
}

/** A field that is text, or null. */
function text(value: unknown): string | null {
  return isString(value) ? value : null;
}

/** The parts that are said, joined. */
function joined(...parts: readonly (string | null)[]): string {
  return parts.filter((part): part is string => part !== null && part !== "").join(" · ");
}

/** A solve's ending in the words its badge uses (`endingOf`, `drill.tsx`). */
function endingWords(ending: unknown): string {
  if (!isRecord(ending)) return "ended";
  if (ending.outcome === "pass") return "valid";
  if (ending.outcome === "flagged") return "flagged";
  return text(ending.kind) ?? text(ending.outcome) ?? "ended";
}

/** What a finished session handed over, from its own fields. */
function handedOver(seat: string, data: LogEvent["data"]): string | null {
  if (seat === "exam") {
    // `held` and `refused` are lists of task versions, `proposed` a count.
    const tallies = [
      ["proposed", many(data.proposed)],
      ["held out", many(data.held)],
      ["refused", many(data.refused)],
    ] as const;
    return tallies
      .flatMap(([word, value]) => (value === null ? [] : [`${String(value)} ${word}`]))
      .join(", ");
  }
  if (seat === "build") {
    const solves = many(data.practiceSolves);
    return joined(
      data.changed === true ? "changed the harness" : data.changed === false ? "left the harness" : null,
      solves === null ? null : plural(solves, "practice solve"),
    );
  }
  return null;
}

/** The words of a line that stands for one event and runs over no other. */
function said(kind: string, data: LogEvent["data"]): { group: TimelineGroup; what: string } | null {
  switch (kind) {
    case "campaign.opened": {
      // A solver is its model's name, or the model and its effort.
      const solver = text(isRecord(data.solver) ? data.solver.model : data.solver);
      return {
        group: "campaign",
        what: joined(
          "Campaign opened",
          text(data.project),
          solver === null ? null : `solver ${solver}`,
          isNumber(data.budget) ? `budget ${money(data.budget)}` : null,
        ),
      };
    }
    case "campaign.setting": {
      return {
        group: "campaign",
        what: joined(
          "Setting fixed",
          isNumber(data.modelTurns) ? plural(data.modelTurns, "model turn") : null,
          isNumber(data.minutes) ? `${String(data.minutes)} min a solve` : null,
          isNumber(data.solves) ? `${plural(data.solves, "solve")} a side` : null,
        ),
      };
    }
    case "campaign.move": {
      return { group: "campaign", what: joined(`Move: ${text(data.move) ?? "?"}`, text(data.why)) };
    }
    case "campaign.word": {
      return {
        group: "campaign",
        what: joined(`The operator's word: ${text(data.word) ?? "?"}`, text(data.why)),
      };
    }
    case "campaign.ended": {
      return {
        group: "campaign",
        what: joined(`Campaign ended: ${text(data.ending) ?? "?"}`, text(data.why)),
      };
    }
    case "campaign.waited": {
      // A load wait is said in its solve's line; these are the waits of the whole campaign.
      const waitedFor = text(data.for);
      return {
        group: "wait",
        what: [
          "Waited",
          isNumber(data.ms) ? seconds(data.ms / 1000) : null,
          waitedFor === null ? null : (WAITS.get(waitedFor) ?? `for ${waitedFor}`),
        ]
          .filter((part) => part !== null)
          .join(" "),
      };
    }
    case "checker.read":
    case "contract.frozen": {
      const checks = many(data.checks);
      const admitted = many(data.admitted);
      const faults = many(data.faults);
      return {
        group: "campaign",
        what: joined(
          kind === "contract.frozen" ? "Contract frozen" : "Checks read",
          checks === null ? null : plural(checks, "check"),
          admitted === null ? null : `${String(admitted)} admitted`,
          faults === null ? null : plural(faults, "fault"),
        ),
      };
    }
    case "harness.version": {
      return { group: "harness", what: joined("Harness version", text(data.version), text(data.note)) };
    }
    case "harness.promoted":
    case "harness.imported": {
      const harness = text(data.harness)?.slice(0, 12) ?? "a harness";
      return {
        group: "harness",
        what: kind === "harness.promoted" ? `Promoted ${harness} to reference` : `Imported ${harness}`,
      };
    }
    case "build.checkpoint": {
      return { group: "harness", what: "Harness kept before a comparison" };
    }
    case "comparison.started": {
      const tasks = many(data.tasks);
      return {
        group: "session",
        what: joined(
          "Comparison started",
          tasks === null ? null : plural(tasks, "task"),
          isNumber(data.solves) ? `${plural(data.solves, "solve")} a side` : null,
        ),
      };
    }
    case "comparison.reported": {
      return { group: "session", what: `Comparison read ${text(data.reading) ?? "nothing"}` };
    }
    default: {
      return null;
    }
  }
}

/** The owner a turn, call or compaction counts into, and the line it opens: a session, a solve or
 *  a Referee's reading. */
function ownerOf(kind: string, data: LogEvent["data"]): string | null {
  const seat = kind.split(".")[0] ?? "";
  if (seat === "solve") return isString(data.solve) ? `solve ${data.solve}` : null;
  if (seat === "referee") return isString(data.reader) ? `referee ${data.reader}` : null;
  return isString(data.session) ? `${seat} ${data.session}` : null;
}

/** Every line of the log, in the order its first event stands. */
const linesIn = once(({ events }) => {
  const lines: Open[] = [];
  const open = new Map<string, Open>();
  // A solve's wait for a loaded host, said in the line of the solve it held back.
  const held = new Map<string, string>();
  const solveOf = (data: LogEvent["data"]) => `${text(data.task) ?? "?"} ${text(data.comparison) ?? ""}`;
  const start = (index: number, event: LogEvent, group: TimelineGroup, what: string, owner?: string) => {
    const { data } = event;
    const line: Open = {
      row: {
        index,
        at: event.at,
        until: null,
        group,
        what,
        session: text(data.session) ?? text(data.comparison),
        solve: text(data.solve),
        task: text(data.version) ?? (event.kind === "solve.started" ? text(data.task) : null),
      },
      turns: 0,
      calls: 0,
      compactions: 0,
      said: what,
    };
    lines.push(line);
    if (owner !== undefined) open.set(owner, line);
    return line;
  };
  for (const [index, event] of events.entries()) {
    const { kind, data } = event;
    if (UNSAID.has(kind)) continue;
    const [seat = "", part = ""] = kind.split(".");
    const owner = ownerOf(kind, data);
    const line = owner === null ? undefined : open.get(owner);
    if (part === "turn" || part === "call" || part === "compacted") {
      const counting =
        line ??
        start(index, event, seat === "solve" ? "solve" : "session", owner ?? kind, owner ?? undefined);
      if (part === "turn") counting.turns += 1;
      else if (part === "call") counting.calls += 1;
      else counting.compactions += 1;
      counting.row = { ...counting.row, until: event.at };
      continue;
    }
    if (kind === "campaign.waited" && data.for === undefined && isNumber(data.ms)) {
      held.set(solveOf(data), `waited ${seconds(data.ms / 1000)} for the host's load`);
      continue;
    }
    if (kind === "solve.started" && owner !== null) {
      const where = text(data.comparison) ?? "practice";
      const waited = held.get(solveOf(data)) ?? null;
      held.delete(solveOf(data));
      start(index, event, "solve", joined(`Solve ${text(data.solve) ?? "?"}`, where, waited), owner);
      continue;
    }
    if (kind === "solve.finished" && line !== undefined) {
      line.said = joined(
        line.said,
        endingWords(data.ending),
        isNumber(data.seconds) ? seconds(data.seconds) : null,
        isNumber(data.billed) ? money(data.billed) : null,
      );
      line.row = { ...line.row, until: event.at };
      continue;
    }
    const sessionOf = SEATS.get(seat);
    if (sessionOf !== undefined && part === "started" && owner !== null) {
      start(
        index,
        event,
        "session",
        joined(`${sessionOf} ${text(data.session) ?? "?"}`, text(data.model)),
        owner,
      );
      continue;
    }
    if (sessionOf !== undefined && part === "finished" && line !== undefined) {
      line.said = joined(
        line.said,
        text(data.ended) ?? "ended",
        handedOver(seat, data),
        isNumber(data.seconds) ? seconds(data.seconds) : null,
        isNumber(data.billed) ? money(data.billed) : null,
      );
      line.row = { ...line.row, until: event.at };
      continue;
    }
    if (kind.startsWith("task.") && isString(data.version)) {
      const task = `task ${data.version}`;
      const name = text(data.taskId) ?? data.version.slice(0, 12);
      const known = open.get(task) ?? start(index, event, "task", `Task ${name}`, task);
      if (kind === "task.proposed") {
        known.said = joined(known.said, `proposed in ${text(data.session) ?? "?"}`);
      }
      if (kind === "task.state") known.said = joined(known.said, text(data.state));
      if (kind === "task.feasible") known.said = joined(known.said, "a valid answer on record");
      if (known.row.index !== index) known.row = { ...known.row, until: event.at };
      continue;
    }
    // A kind with no words of its own reads as its words: `exam.drafted` as "Exam drafted".
    const plain = kind.replaceAll(".", " ");
    const words = said(kind, data);
    start(
      index,
      event,
      words?.group ?? "campaign",
      words?.what ?? `${plain.charAt(0).toUpperCase()}${plain.slice(1)}`,
    );
  }
  return lines.map(({ row, turns, calls, compactions, said: what }) => ({
    ...row,
    what: joined(
      what,
      turns + calls === 0 ? null : `${plural(turns, "turn")}, ${plural(calls, "call")}`,
      compactions === 0 ? null : plural(compactions, "compaction"),
    ),
  }));
});

/** A whole number from nothing up, as a URL carries it. */
function counted(value: string | undefined, name: string): number {
  if (value === undefined) return 0;
  const number = Number(value);
  if (!/^\d+$/u.test(value) || !Number.isSafeInteger(number)) {
    throw new Unanswerable(400, `${name} is a whole number from 0, and ${value} is not`);
  }
  return number;
}

export function logAnswer(reading: Reading, query: Query<"log">): Timeline {
  const { log, issues } = campaignAt(reading, query.key);
  return { tier: reading.tier, issues, rows: linesIn(log), events: log.events.length };
}

export function eventAnswer(reading: Reading, query: Query<"event">): LogEventDetail {
  const { log, issues } = campaignAt(reading, query.key);
  const index = counted(query.index, "index");
  const event = log.events[index];
  if (event === undefined) {
    throw new Unanswerable(
      404,
      `the log holds ${String(log.events.length)} events, and no event ${String(index)}`,
    );
  }
  return { tier: reading.tier, issues, at: event.at, kind: event.kind, data: event.data };
}
