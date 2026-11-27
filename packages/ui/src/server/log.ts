/**
 * `GET /api/log?key=` and `GET /api/event?key=&index=`: the log as a timeline, one line a thing
 * that happened, and one event whole (exam tier only, refused by the router before this is asked).
 * A line is worded from what the default tier serves (`models.ts`); a session's or solve's turns,
 * calls and compactions are counted into its own line, from its start to its end. The author's
 * answer behind `task.feasible` is the exam side's, so its line says only that one is on record. A
 * verdict, a condition and a ruling have no line.
 */
import type { LogEvent } from "../../../../src/kernel/log.ts";
import type { Seat } from "../../../../src/kernel/trace.ts";
import { isNumber, isRecord, isString } from "../../../../src/meta/json-shape.ts";
import { plural } from "../../../../src/meta/text.ts";
import type { LogEventDetail, Query, Timeline, TimelineGroup, TimelineRow } from "../models.ts";
import { money, seconds } from "../views/format.ts";
import { type Reading, Unanswerable } from "./context.ts";
import { once } from "./folds.ts";
import { campaignAt } from "./logs.ts";

interface Open {
  readonly row: TimelineRow;
  until: string | null;
  turns: number;
  calls: number;
  compactions: number;
  said: string;
}

type LineFormatter = (data: LogEvent["data"], kind: string) => { group: TimelineGroup; what: string };

const SEAT_LABELS = new Map<string, string | null>(
  Object.entries({
    build: "Builder session",
    exam: "Examiner session",
    draft: "Exam draft",
    referee: null,
    solve: null,
  } satisfies Record<Seat, string | null>),
);
/** The kinds a line leaves out: what a solve's ending or the exam side already says. */
const UNSAID: ReadonlySet<string> = new Set(["verdict", "condition.recorded", "referee.finding"]);
/** Why the campaign waited, by a wait's `for` (`tools/campaign/host.ts`, `src/solver/run.ts`). */
const WAITS = new Map([
  ["provider", "for the provider's limit to reset"],
  ["network", "after the network failed a session"],
]);
const TRACE_PART = new Map<string, "turns" | "calls" | "compactions">([
  ["turn", "turns"],
  ["call", "calls"],
  ["compacted", "compactions"],
]);
const TASK_NOTE = new Map<string, (data: LogEvent["data"]) => string | null>([
  ["task.proposed", (data) => `proposed in ${text(data.session) ?? "?"}`],
  ["task.state", (data) => text(data.state)],
  ["task.feasible", () => "valid answer recorded"],
]);

const many = (value: unknown): number | null =>
  Array.isArray(value) ? value.length : isNumber(value) ? value : null;
const text = (value: unknown): string | null => (isString(value) ? value : null);
const joined = (...parts: readonly (string | null)[]): string =>
  parts.filter((part): part is string => part !== null && part !== "").join(" · ");

const checkerLine: LineFormatter = (data, kind) => {
  const [checks, admitted, faults] = [
    many(data.checks) ?? many(data.rows),
    many(data.admitted),
    many(data.faults),
  ];
  return {
    group: "campaign",
    what: joined(
      kind === "contract.frozen" ? "Contract frozen" : "Checks read",
      checks === null ? null : plural(checks, "check"),
      admitted === null ? null : `${String(admitted)} admitted`,
      faults === null ? null : plural(faults, "fault"),
    ),
  };
};

const EVENT_FORMATTERS = new Map<string, LineFormatter>(
  Object.entries({
    "campaign.opened": (data) => {
      const solver = text(isRecord(data.solver) ? data.solver.model : data.solver);
      const parent = text(isRecord(data.parent) ? data.parent.campaign : null);
      return {
        group: "campaign",
        what: joined(
          "Campaign opened",
          text(data.project),
          parent === null ? null : `from ${parent}`,
          solver === null ? null : `solver ${solver}`,
          isNumber(data.budget) ? `budget ${money(data.budget)}` : null,
        ),
      };
    },
    "campaign.setting": (data) => ({
      group: "campaign",
      what: joined(
        "Setting fixed",
        isNumber(data.modelTurns) ? plural(data.modelTurns, "model turn") : null,
        isNumber(data.minutes) ? `${String(data.minutes)} min a solve` : null,
        isNumber(data.solves) ? `${plural(data.solves, "rollout")} per arm` : null,
      ),
    }),
    "campaign.move": (data) => ({
      group: "campaign",
      what: joined(`Move: ${text(data.move) ?? "?"}`, text(data.why)),
    }),
    "campaign.word": (data) => ({
      group: "campaign",
      what: joined(`The operator's word: ${text(data.word) ?? "?"}`, text(data.why)),
    }),
    "campaign.ended": (data) => {
      const ending = text(data.ending) ?? "?";
      const successor = text(data.successor);
      return {
        group: "campaign",
        what:
          ending === "revise"
            ? joined("Campaign ended: revise", successor === null ? null : `successor ${successor}`)
            : joined(`Campaign ended: ${ending}`, text(data.why)),
      };
    },
    "exam.revised": (data) => ({
      group: "campaign",
      what: joined(`Exam revised (${text(data.kind) ?? "?"})`, text(data.draftHash)?.slice(0, 12) ?? null),
    }),
    "campaign.waited": (data) => {
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
    },
    "checker.read": checkerLine,
    "contract.frozen": checkerLine,
    "harness.version": (data) => ({
      group: "harness",
      what: joined("Harness version", text(data.version), text(data.note)),
    }),
    "harness.promoted": (data) => ({
      group: "harness",
      what: `Promoted ${text(data.harness)?.slice(0, 12) ?? "a harness"} to reference`,
    }),
    "harness.reverted": (data) => ({
      group: "harness",
      what: `Reverted reference to ${text(data.harness)?.slice(0, 12) ?? "a harness"}`,
    }),
    "harness.imported": (data) => ({
      group: "harness",
      what: `Imported ${text(data.harness)?.slice(0, 12) ?? "a harness"}`,
    }),
    "build.checkpoint": () => ({ group: "harness", what: "Harness kept before a comparison" }),
    "comparison.started": (data) => {
      const tasks = many(data.tasks);
      return {
        group: "session",
        what: joined(
          "Comparison started",
          tasks === null ? null : plural(tasks, "task"),
          isNumber(data.solves) ? `${plural(data.solves, "rollout")} per arm` : null,
        ),
      };
    },
    "comparison.reported": (data) => ({
      group: "session",
      what: `Comparison read ${text(data.reading) ?? "nothing"}`,
    }),
  } satisfies Record<string, LineFormatter>),
);

/** A solve's ending in the words its badge uses (`endingOf`, `drill.tsx`). */
function endingWords(ending: unknown): string {
  if (!isRecord(ending)) return "ended";
  if (ending.outcome === "pass") return "valid";
  if (ending.outcome === "flagged") return "flagged";
  return text(ending.kind) ?? text(ending.outcome) ?? "ended";
}

function handedOver(seat: string, data: LogEvent["data"]): string | null {
  if (seat === "exam") {
    const tallies = [
      ["proposed", many(data.proposed)],
      ["held out", many(data.held)],
      ["refused", many(data.refused)],
    ] as const;
    return tallies
      .flatMap(([word, value]) => (value === null ? [] : [`${String(value)} ${word}`]))
      .join(", ");
  }
  if (seat !== "build") return null;
  const solves = many(data.practiceSolves);
  return joined(
    data.changed === true ? "changed the harness" : data.changed === false ? "left the harness" : null,
    solves === null ? null : plural(solves, "practice solve"),
  );
}

/** The owner a turn, call or compaction counts into, and the line it opens: a session, solve or
 *  Referee reading. */
function ownerOf(seat: string, data: LogEvent["data"]): string | null {
  if (seat === "solve") return isString(data.solve) ? `solve ${data.solve}` : null;
  if (seat === "referee") return isString(data.reader) ? `referee ${data.reader}` : null;
  return isString(data.session) ? `${seat} ${data.session}` : null;
}

function finishLine(line: Open, seat: string, event: LogEvent): void {
  const { data } = event;
  const outcome =
    seat === "solve" ? endingWords(data.ending) : joined(text(data.ended) ?? "ended", handedOver(seat, data));
  line.said = joined(
    line.said,
    outcome,
    isNumber(data.seconds) ? seconds(data.seconds) : null,
    isNumber(data.billed) ? money(data.billed) : null,
  );
  line.until = event.at;
}

/** Every line of the log, in the order its first event stands. */
const linesIn = once(({ events }) => {
  const lines: Open[] = [];
  const open = new Map<string, Open>();
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
      until: null,
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
    const owner = ownerOf(seat, data);
    const counter = TRACE_PART.get(part);
    if (counter !== undefined) {
      const counting =
        (owner === null ? undefined : open.get(owner)) ??
        start(index, event, seat === "solve" ? "solve" : "session", owner ?? kind, owner ?? undefined);
      counting[counter] += 1;
      counting.until = event.at;
      continue;
    }
    if (kind === "campaign.waited" && data.for === undefined && isNumber(data.ms)) {
      held.set(solveOf(data), `waited ${seconds(data.ms / 1000)} for the host's load`);
      continue;
    }
    const label = SEAT_LABELS.get(seat) ?? null;
    const tracked = seat === "solve" || label !== null;
    if (part === "started" && owner !== null && tracked) {
      if (seat === "solve") {
        const waited = held.get(solveOf(data)) ?? null;
        held.delete(solveOf(data));
        start(
          index,
          event,
          "solve",
          joined(`Solve ${text(data.solve) ?? "?"}`, text(data.comparison) ?? "practice", waited),
          owner,
        );
      } else {
        start(
          index,
          event,
          "session",
          joined(`${label} ${text(data.session) ?? "?"}`, text(data.model)),
          owner,
        );
      }
      continue;
    }
    const line = owner === null ? undefined : open.get(owner);
    if (part === "finished" && line !== undefined && tracked) {
      finishLine(line, seat, event);
      continue;
    }
    if (seat === "task" && isString(data.version)) {
      const task = `task ${data.version}`;
      const known =
        open.get(task) ??
        start(index, event, "task", `Task ${text(data.taskId) ?? data.version.slice(0, 12)}`, task);
      known.said = joined(known.said, TASK_NOTE.get(kind)?.(data) ?? null);
      if (known.row.index !== index) known.until = event.at;
      continue;
    }
    const words = EVENT_FORMATTERS.get(kind)?.(data, kind);
    const plain = kind.replaceAll(".", " ");
    start(
      index,
      event,
      words?.group ?? "campaign",
      words?.what ?? `${plain.charAt(0).toUpperCase()}${plain.slice(1)}`,
    );
  }
  return lines.map(({ row, until, turns, calls, compactions, said: what }) => ({
    ...row,
    until,
    what: joined(
      what,
      turns + calls === 0 ? null : `${plural(turns, "turn")}, ${plural(calls, "call")}`,
      compactions === 0 ? null : plural(compactions, "compaction"),
    ),
  }));
});

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
