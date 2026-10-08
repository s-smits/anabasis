/**
 * A checker epoch: the stretch of a campaign's log under one frozen checker, and what it takes to
 * open the next one in the same log.
 *
 * Until 2026-10-08 a changed contract or a repaired check program took a campaign of its own. That
 * campaign began with an empty log: the harness the last step left, every task's standing against
 * it, the anchor, the practice set and the tasks waiting for a witness stayed behind in the old
 * one. So a check found wrong was dear to mend, and a requirement no check read could not be asked
 * at all without giving up the climb. Of a campaign's compartments (`binding.ts`) the correctness
 * model was the one that could not move.
 *
 * Here it moves inside the log. `contract.frozen` is logged again and the last one is the
 * campaign's checker; nothing logged before it is rewritten, and a round's report is still read as
 * that report found it. The word is the operator's and no model is asked (`tools/c/accept.ts`).
 *
 * What an adoption may do follows two rules the campaign already keeps. A comparison is paired
 * within one checker, so no adoption starts while a round or a session is open (`openWork`); what
 * of that the operator may overrule is the caller's to say (`tools/c/adoption.ts`). And an exam
 * grows by judgement and shrinks only on evidence: an adoption drops no task and writes no verdict
 * of its own making.
 *
 * - Every live task goes on (`liveTasks`, `carried`). A task's version holds its check program, so
 *   each is proposed again under the adopted one, naming the version it continues, and the old
 *   version goes stale. It is gated with no solve: gate 2 on the answer its stronger solve was
 *   accepted on, gate 3 on that answer twice more, gate 4 on the controls on record. A task whose
 *   witness the adopted checks refuse has no witness under them. It is not refused, since nothing
 *   was shown wrong with the task: it waits as a reach task, to be put to the stronger solver
 *   again, as a task that solver never passed does. A task whose controls no longer hold waits
 *   past gate 3 for an Examiner session to write them again. The anchor's tasks stay the
 *   anchor's and the practice tasks practice, by the task fold (`task.ts`).
 * - A standing carries only where the solver was asked the same thing (`regradings`). A solve on
 *   record answered the old version, and its answer is in the log, so the adopted checks can grade
 *   it again. That grading stands for a solve of the new version when the task's public side and
 *   the contract's are unchanged: a repair of the evaluator. Where a public rule was added or
 *   changed the old answer answered another question, nothing is logged for the new version, and a
 *   round solves the task again. A fail that reached no check is no checker's verdict and carries
 *   as it is. Whether the two sides are the same is the caller's to say, since it holds both packs.
 *
 * Nothing here scores. A regrading places a task, as a screening solve does, and a round's counted
 * solves are made fresh after its admission (`compare.ts`).
 */
import { asRecord, isString, type JsonObject, type JsonValue } from "../meta/json-shape.ts";
import { keyIfDefined, keyIfNotNull } from "../meta/optional-key.ts";
import type { Checker, Regrade } from "./acceptance.ts";
import { conditionsOf } from "./condition.ts";
import { answerFormatFault, type Contract } from "./contract.ts";
import { lastReports } from "./ladder.ts";
import type { Entry, LogEvent } from "./log.ts";
import {
  controlsGate,
  determinismGate,
  packageGate,
  type RejectControl,
  type TaskPackage,
  taskSets,
  taskVersion,
} from "./task.ts";
import { decided, spelled, type Task, type Verdict, type Verifier } from "./verify.ts";

/** One checker a log froze: where its freeze stands, and how it came to be the campaign's. */
export interface Epoch {
  /** The place of its `contract.frozen` in the log. */
  readonly index: number;
  readonly checker: Checker;
  /** Whether a solver was asked the same thing as under the checker before; null for the first. */
  readonly asked: "same" | "changed" | null;
  /** Why it stands over what counted against it, where the operator said so. */
  readonly despite: string | null;
  /** What its adoption carried, as `checker.adopted` closed it; null for the first freeze, and for
   *  an adoption a crash cut short. */
  readonly adopted: JsonObject | null;
}

/** What a log shows open: work an adoption would cut across. */
export interface OpenWork {
  /** Sessions that started and never ended. One still running is in flight; one that was stopped
   *  is over for good, since neither a round nor an Examiner runs a second session under an id.
   *  The log cannot tell the two apart, and the host can. */
  readonly dangling: readonly string[];
  /** Rounds whose Builder session ended whole and that wrote no report: run again, each goes on. */
  readonly unreported: readonly string[];
  /** Rounds whose reading waits on a person's labels (`flags-decide`). */
  readonly unsettled: readonly string[];
}

/** An answer a stronger solve gave, by the solve the log names it under. */
export interface Witness {
  readonly solve: string;
  readonly answer: JsonValue;
}

/** A task version an adoption carries: one a round, a Builder or an Examiner session would still
 *  read. */
export interface Live {
  readonly version: string;
  /** Null for a proposal that names none, which no pack can be asked for. */
  readonly taskId: string | null;
  /** The task whole, where its proposal holds it; null for a pack's own, which the pack holds. */
  readonly task: Task | null;
  /** The session that wrote it, where one did. */
  readonly wrote: string | null;
  readonly state: "held" | "admitted" | "released" | "too-hard";
  readonly anchor: boolean;
  /** The answer gate 2 last rested on, where the log holds it: accepted for a task with a
   *  witness, refused for a task that waits for one. */
  readonly witness: Witness | null;
  /** For a task that waits for a witness: the stronger solve it last waited on, and how it ended. */
  readonly tried: string | null;
  readonly kind: string | null;
  /** The controls gate 4 passed, where the log holds them whole. */
  readonly controls: readonly RejectControl[] | null;
}

/** What one task is put to the adopted checker with. */
export interface Carry {
  readonly live: Live;
  /** The task under the adopted checker: its content, rule ids and check program. */
  readonly task: TaskPackage;
  /** Answers that may witness it, in the order they are tried: the log's, then any the caller
   *  holds, a stored sweep's passes for a pack's task. */
  readonly witnesses: readonly Witness[];
  /** Its reject controls, and the accepted answer they are edits of where that is not the
   *  witness; null where none are on record. */
  readonly controls: { readonly accepted: JsonValue | null; readonly set: readonly RejectControl[] } | null;
}

/** How one task went into the epoch. */
export interface Carried {
  readonly taskId: string;
  readonly from: string;
  readonly version: string;
  /** The state of the version it continues, as the adoption found it. */
  readonly was: Live["state"];
  /** Feasible again, waiting past gate 3 for its controls, or waiting for a witness. */
  readonly word: "feasible" | "waiting" | "reach";
  /** Why it is not feasible; null when it is. */
  readonly why: string | null;
  /** What of it counts against the adopted checker: a witness it accepted once and not again, and
   *  a reject control it accepts. */
  readonly faults: readonly string[];
  readonly entries: readonly Entry[];
}

const GATE = "task.gate";
const STATE = "task.state";
const REACH = "too-hard";
const PASSED = "passed";
const REGRADED = "verdict.regraded";
/** What an adoption's copy of a witness answer is named after: the solve that gave the answer. */
const COPY = "carried-";
const LIVE = ["held", "admitted", "released", REACH] as const;
/** The endings no check gave, which no checker's change moves. */
const UNJUDGED = new Set(["wall-ended", "context-ended", "no-answer", "broken-harness"]);

/** The checkers a log froze, in order. The word given twice for one checker is one freeze. */
export function epochsOf(events: readonly LogEvent[]): Epoch[] {
  const epochs: Epoch[] = [];
  for (const [index, { kind, data }] of events.entries()) {
    const last = epochs.at(-1);
    const { contract, checks } = data;
    const same = last?.checker.contract === contract && last?.checker.checks === checks;
    if (kind === "contract.frozen" && isString(contract) && isString(checks) && !same) {
      epochs.push({
        index,
        checker: { contract, checks },
        asked: data.asked === "same" || data.asked === "changed" ? data.asked : null,
        despite: isString(data.despite) ? data.despite : null,
        adopted: null,
      });
    } else if (kind === "checker.adopted" && last !== undefined && same) {
      epochs[epochs.length - 1] = { ...last, adopted: data };
    }
  }
  return epochs;
}

/** The adoption a log began and did not close, by its checker, or null. A crash inside an
 *  adoption's append leaves one, and the campaign does not open until it is run again. */
export function unfinished(events: readonly LogEvent[]): Checker | null {
  const epochs = epochsOf(events);
  const last = epochs.at(-1);
  return last !== undefined && epochs.length > 1 && last.adopted === null ? last.checker : null;
}

/** The sessions and rounds a log shows open. */
export function openWork(events: readonly LogEvent[]): OpenWork {
  const of = (kind: LogEvent["kind"]) =>
    events.flatMap(({ kind: each, data }) =>
      each === kind && isString(data.session) ? [[data.session, data] as const] : [],
    );
  const built = new Map(of("build.finished"));
  const examined = new Map(of("exam.finished"));
  const reported = new Map(of("comparison.reported"));
  const builds = [...new Map(of("build.started")).keys()];
  return {
    dangling: [
      ...builds.filter((session) => !built.has(session)),
      ...[...new Map(of("exam.started")).keys()].filter((session) => !examined.has(session)),
    ],
    // A session that was killed or that crashed is not compared (`round.ts`, `spent`), so its
    // round never reports and is not waited for.
    unreported: builds.filter((session) => {
      const ended = built.get(session)?.ended;
      return ended !== undefined && ended !== "killed" && ended !== "crashed" && !reported.has(session);
    }),
    unsettled: lastReports(events).flatMap(({ session, data }) =>
      data.reading === "flags-decide" ? [session] : [],
    ),
  };
}

/** A reject control as gate 4 logged it, or none where the row is not one. */
export function controlOf(row: JsonValue): RejectControl[] {
  const control = asRecord(row);
  return control?.answer !== undefined && isString(control.expectedCheckId)
    ? [{ answer: control.answer, expectedCheckId: control.expectedCheckId }]
    : [];
}

/**
 * The task versions an adoption carries, in the order they were proposed: every one held,
 * admitted or released with a stronger solve's pass behind it, and every one waiting for such a
 * pass. A version a gate refused, one both harnesses passed, one a check defect was ruled on and
 * one already stale are not among them: each left the exam on evidence, or was never in it.
 */
export function liveTasks(events: readonly LogEvent[]): Live[] {
  const { states, anchor } = taskSets(events);
  const gates = Map.groupBy(
    events.flatMap(({ kind, data }) => (kind === GATE ? [data] : [])),
    (data) => data.version,
  );
  const answerOf = (solve: JsonValue | undefined) =>
    events.findLast(({ kind, data }) => kind === "verdict" && data.solve === solve)?.data.answer;
  return events.flatMap(({ kind, data }): Live[] => {
    const { version } = data;
    const state = LIVE.find((known) => known === states.get(isString(version) ? version : ""));
    if (kind !== "task.proposed" || !isString(version) || state === undefined) return [];
    const logged = gates.get(version) ?? [];
    const second = logged.findLast((gate) => gate.gate === 2);
    const fourth = logged.findLast((gate) => gate.gate === 4);
    const ended = logged.some(
      (gate) => gate.outcome !== PASSED && !(gate.gate === 2 && gate.outcome === REACH),
    );
    // A task in the exam has a stronger solve's pass behind it, and one that waits has a miss.
    if (ended || second?.outcome !== (state === REACH ? REACH : PASSED)) return [];
    const whole = asRecord(data.task);
    const named = second?.solve ?? second?.witness;
    const answer = answerOf(named);
    return [
      {
        version,
        taskId: isString(data.taskId) ? data.taskId : null,
        task:
          whole !== null && isString(whole.taskId) && isString(whole.family)
            ? {
                taskId: whole.taskId,
                family: whole.family,
                publicInput: whole.publicInput ?? null,
                hidden: whole.hidden ?? null,
              }
            : null,
        wrote: [data.session, data.wrote].find(isString) ?? null,
        state,
        anchor: anchor.has(version),
        witness: isString(named) && answer !== undefined ? { solve: named, answer } : null,
        tried: state === REACH && isString(second?.solve) ? second.solve : null,
        kind: state === REACH && isString(second?.kind) ? second.kind : null,
        controls:
          fourth?.outcome === PASSED && Array.isArray(fourth.set) ? fourth.set.flatMap(controlOf) : null,
      },
    ];
  });
}

/**
 * One task under the adopted checker, with no solve: the events that propose its new version, gate
 * it and mark the old one stale, and the word of how it went. The caller has held the package to
 * gate 1 already, since a task the adopted checks cannot be put to is a fault of the pack and
 * stops the adoption before anything is written.
 *
 * A witness is an answer the adopted checks accept three times, gate 2's run and gate 3's two. One
 * they accept once and not again is no witness, and is named as a fault of the checker's. So is a
 * reject control on record that they accept: the task waits for controls, and the refusal the
 * adoption withdrew from that answer is one nobody ruled a defect. The copy
 * of the witness answer is logged as a verdict of its own, so that a reviewer set an accepted
 * answer beside a fail finds one these checks accept (`src/review/referee.ts`).
 *
 * A task that loses its witness names no solve at gate 2, so the next Examiner session puts it to
 * the stronger solver again whatever harness the campaign stands on (`reachOf`): that solver was
 * never asked under these checks. A task that already waited keeps the solve it waited on, and is
 * tried again when the harness or the solver has moved, as before.
 */
export async function carried(contract: Contract, verify: Verifier, given: Carry): Promise<Carried> {
  const { live, task } = given;
  const version = taskVersion(task);
  const { taskId, family, publicInput, hidden } = task;
  const packaged = packageGate(contract, task);
  if (packaged.outcome === "refused") {
    throw new Error(`task ${taskId} cannot be put to the adopted checks: ${packaged.reason}`);
  }
  const entry = (kind: Entry["kind"], data: JsonObject): Entry => ({ kind, data: { version, ...data } });
  const head = [
    entry("task.proposed", {
      taskId,
      continues: live.version,
      ...keyIfNotNull("wrote", live.wrote),
      task: { taskId, family, publicInput, hidden },
    }),
    entry(GATE, { gate: 1, outcome: PASSED }),
  ];
  const stale: Entry = { kind: STATE, data: { version: live.version, state: "stale", continued: version } };
  const said = { taskId, from: live.version, version, was: live.state };
  const faults: string[] = [];
  let witness: Witness | null = null;
  let why = "the log holds no answer a stronger solve of it gave";
  for (const candidate of given.witnesses) {
    if (answerFormatFault(contract, candidate.answer) !== null) {
      why = "its witness does not follow the answer format";
      continue;
    }
    const verdict = await decided(verify, task, candidate.answer);
    if (verdict.kind !== "pass") {
      why = `the adopted checks do not accept its witness: ${spelled(verdict)}`;
      continue;
    }
    const repeated = await determinismGate(verify, task, candidate.answer);
    if (repeated.outcome === PASSED) {
      witness = candidate;
      break;
    }
    why = `the adopted checks accepted its witness once and not again: ${repeated.reason}`;
    faults.push(`the witness of ${taskId} was accepted once and not again: ${repeated.reason}`);
  }
  if (witness === null) {
    const [first] = given.witnesses;
    const waited = live.state === REACH && live.tried !== null;
    return {
      ...said,
      word: "reach",
      why,
      faults,
      entries: [
        ...head,
        entry(GATE, {
          gate: 2,
          outcome: REACH,
          kind: (live.state === REACH ? live.kind : null) ?? "rejected",
          ...keyIfNotNull("solve", waited ? live.tried : null),
          ...keyIfDefined("witness", waited ? undefined : first?.solve),
          reason: why,
        }),
        entry(STATE, { state: REACH }),
        stale,
      ],
    };
  }
  const copy = witness.solve.startsWith(COPY) ? witness.solve : `${COPY}${witness.solve}`;
  const witnessed = [
    ...head,
    {
      kind: "verdict",
      data: { solve: copy, task: taskId, answer: witness.answer, kind: "pass", carried: true },
    },
    entry(GATE, { gate: 2, outcome: PASSED, solve: copy }),
    entry(GATE, { gate: 3, outcome: PASSED }),
  ] satisfies Entry[];
  const waiting = (reason: string): Carried => ({
    ...said,
    word: "waiting",
    why: reason,
    faults,
    entries: [...witnessed, stale],
  });
  if (given.controls === null) return waiting("its controls are not on record");
  const { accepted, set } = given.controls;
  const held = await controlsGate(contract, verify, task, accepted ?? witness.answer, set);
  if (held.outcome === "refused") {
    // A control the adopted checks pass is a refusal withdrawn from an answer written to be
    // refused, and nobody ruled that refusal a defect.
    if (held.kinds.includes("passed")) {
      faults.push(`a reject control of ${taskId} is accepted by the adopted checks: ${held.reason}`);
    }
    return waiting(`its controls do not hold under the adopted checks: ${held.reason}`);
  }
  return {
    ...said,
    word: "feasible",
    why: null,
    faults,
    entries: [
      ...witnessed,
      entry(GATE, { gate: 4, ...held, set: set.map((control) => ({ ...control })) }),
      stale,
    ],
  };
}

/** A verdict as a log event holds one. */
function recorded(verdict: Verdict): JsonObject {
  if (verdict.kind === "fail") return { kind: verdict.kind, blocking: [...verdict.blocking] };
  return verdict.kind === "pass" ? { kind: verdict.kind } : { ...verdict };
}

/**
 * What an adoption logs of the solves on record, as `verdict.regraded`: each counted solve of a
 * version in `stands`, graded again for the version that continues it, and beside those every
 * other answer whose verdict the adopted checker moved.
 *
 * `stands` are the versions whose solves may stand for their successors: the caller lists a task
 * only where the solver was asked the same thing. `rows` are the log's answers under the adopted
 * checker (`regraded`). A solve an earlier adoption already carried to a version stands for the
 * next one as that adoption left it, so a standing survives any number of repairs. A solve that
 * reached no check keeps its ending. One whose answer the log does not hold, or which the adopted
 * checks could not run on, stands for nothing.
 *
 * The moved verdicts are logged whether or not they stand for a version: the next adoption reads
 * each answer against the checker it replaces, and that is this one.
 */
export function regradings(
  events: readonly LogEvent[],
  stands: readonly { readonly taskId: string; readonly from: string; readonly to: string }[],
  rows: readonly Regrade[],
  checks: string,
): Entry[] {
  const conditions = conditionsOf(events);
  const next = new Map(stands.map((stand) => [stand.from, stand]));
  const graded = new Map(rows.map((row) => [row.solve, row]));
  const madeOf = new Map(
    events.flatMap(({ kind, data }) => {
      const version = conditions.get(isString(data.condition) ? data.condition : "")?.task;
      return kind === "solve.started" && isString(data.solve) && version !== undefined
        ? [[data.solve, version] as const]
        : [];
    }),
  );
  /** Solves whose answer was outside the contract's format: no check ran on it under any checker. */
  const unread = new Set(
    events.flatMap(({ kind, data }) => (kind === "verdict" && isString(data.fault) ? [data.solve] : [])),
  );
  const standing = events.flatMap(({ kind, data }): Entry[] => {
    const { solve } = data;
    const own = kind === "solve.finished" && isString(solve) ? madeOf.get(solve) : undefined;
    const stand = next.get(kind === REGRADED && isString(data.version) ? data.version : (own ?? ""));
    const ending = asRecord(data.ending);
    if (!isString(solve) || stand === undefined || ending === null) return [];
    const row = graded.get(solve);
    const again = row?.verdict?.kind === "pass" || row?.verdict?.kind === "fail" ? row : undefined;
    const kept = isString(ending.kind) && (UNJUDGED.has(ending.kind) || unread.has(solve));
    const judged = ending.outcome === "pass" || ending.kind === "rejected";
    if (ending.outcome === "fail" && kept) {
      return [{ kind: REGRADED, data: { solve, task: stand.taskId, version: stand.to, checks, ending } }];
    }
    if (!judged || again?.verdict === undefined || again.verdict === null) return [];
    return [
      {
        kind: REGRADED,
        data: {
          solve,
          task: stand.taskId,
          version: stand.to,
          checks,
          ending: again.verdict.kind === "pass" ? { outcome: "pass" } : { outcome: "fail", kind: "rejected" },
          was: again.was,
          ...recorded(again.verdict),
        },
      },
    ];
  });
  const stood = new Set(standing.map(({ data }) => data.solve));
  return [
    ...standing,
    ...rows.flatMap(({ solve, task, was, now, verdict }): Entry[] =>
      verdict === null || was === now || stood.has(solve)
        ? []
        : [{ kind: REGRADED, data: { solve, task, checks, was, ...recorded(verdict) } }],
    ),
  ];
}
