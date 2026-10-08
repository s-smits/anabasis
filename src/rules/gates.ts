/**
 * What an added check has to be seen to do before its candidate stands, read from verdicts the
 * host got by running the whole candidate program. Three readings, in the order a session meets
 * them after the proof that the candidate only adds (`candidate.ts`):
 *
 * - The controls. A control is an answer the checks accepted for an existing task, unchanged or
 *   with one change, labelled by its author: the candidate must accept it, or the new check must
 *   refuse it. A reject control is refused by the new check and by no other, so that it shows the
 *   new requirement and nothing an existing check already judged. The unchanged answer each
 *   control starts from is put to the candidate too and must pass whole: it is the proof that the
 *   requirement can be met at all, by an answer its author did not write. v1 is why both labels
 *   are asked for. Its passes were sound and its rejections were not: 36 of 47 rehearsal misses
 *   were a check refusing a right answer (v1 #124), and what shows that fault before any solve is
 *   an accept control the check's author did not shape to pass.
 * - The repeat. Every control is run twice, and a second verdict that differs is a check that
 *   decides nothing (`controlFault` in `src/kernel/acceptance.ts`, whose runs these are).
 * - The interference, which is reported and refuses nothing. Every accepted answer on record for
 *   a task the new check applies to is graded under the candidate: the witnesses while the
 *   session runs, and the rest when it is over (`session.ts` says why). A new requirement is
 *   expected to refuse some of them, and each task it leaves without an accepted answer waits for
 *   a new witness once the candidate is adopted. A check that refuses every one of them, or cannot
 *   run on one, is suspect; one that refuses none has so far been seen to refuse only its author's
 *   own edits, and whether a solver could make one of those is a person's to read. The reading
 *   says which, and adopting is the operator's.
 *
 * An answer no longer accepted by the existing checks says nothing of the addition: those checks
 * are the pack's own bytes. Such an answer is counted apart as stale, as `tools/c/repaired.ts`
 * counts a control that held under neither checker. On 8 October all 35 accept controls of the
 * truss pack had gone stale.
 */
import type { Control, ControlRun } from "../kernel/acceptance.ts";
import { answerFormatFault, type Contract } from "../kernel/contract.ts";
import { CONTROLS } from "../kernel/task.ts";
import { spelled, type Task, type Verdict } from "../kernel/verify.ts";
import type { JsonValue } from "../meta/json-shape.ts";
import { compareCodeUnits, stableJson } from "../meta/stable-json.ts";
import { plural } from "../meta/text.ts";
import type { Added } from "./candidate.ts";

/** A control with the words its author is told of it: `control 2`, or `the accepted answer of
 *  x-1-003` for the unchanged answer a control starts from. */
export interface NamedControl extends Control {
  readonly name: string;
}

/** An accepted answer on record, and where it is from. A `witness` is the answer a stronger solve
 *  was accepted on at a task's gate 2: the session may read it, write controls on it and be told
 *  what its check makes of it. The others it is never shown and never told of: any other solve's
 *  accepted answer in the log, the measured solver's among them, a pack's accept control, and a
 *  stored sweep's pass. */
export interface Stored {
  readonly task: Task;
  readonly answer: JsonValue;
  readonly from: "witness" | "solve" | "control" | "sweep";
}

/** A stored answer with the candidate's verdict of it. */
export interface Regraded {
  readonly stored: Stored;
  readonly verdict: Verdict;
}

/** What the candidate makes of the accepted answers on record. */
export interface Interference {
  /** The answers the existing checks still accept, beside the ones the session's own controls
   *  start from: what the reading is taken over. */
  readonly applied: number;
  /** Of those, the ones the new check refuses, and the ones it could not run on. */
  readonly refused: number;
  readonly unrunnable: number;
  /** Answers an existing check no longer accepts: no part of `applied`. */
  readonly stale: number;
  /** Each task with an answer the new check refuses or cannot run on, and how many of its
   *  accepted answers on record the candidate still accepts. */
  readonly tasks: readonly {
    readonly taskId: string;
    readonly refused: number;
    readonly unrunnable: number;
    readonly kept: number;
  }[];
  readonly reading: "unread" | "refuses-none" | "refuses-some" | "refuses-all";
  /** Whether the reading alone is a reason to doubt the check, and the sentence that says why or
   *  what is left to read. */
  readonly suspect: boolean;
  readonly note: string;
}

/** The kinds of fault a control set can hold, for a reading of what the gate refused. */
export type ControlFaultKind =
  | "count"
  | "repeat"
  | "format"
  | "family"
  | "accept-refused"
  | "passed"
  | "faulty"
  | "other-check"
  | "also-refused";

export type Fault = readonly [ControlFaultKind, string];

/** A control set before any check runs: its faults, and the controls fit to be run. */
interface Sifted {
  readonly faults: Fault[];
  readonly fit: NamedControl[];
}

type Standing = "kept" | "refused" | "unrunnable" | "stale";

/** What each reading says, for whoever decides on the candidate. */
const NOTES = {
  unread: "no accepted answer is on record for a task it applies to, beside the ones its controls start from",
  "refuses-none":
    "it refuses no accepted answer on record: it has so far been seen to refuse only its author's own edits, each one change from an accepted answer, and whether a solver could make one is to be read from them",
  "refuses-some":
    "it refuses some accepted answers on record and passes others: each task left without an accepted answer waits for a new witness once this is adopted",
  "refuses-all":
    "it refuses every accepted answer on record but the ones its controls start from: the requirement may be met by those alone, or the check may be wrong",
} as const;

const key = (taskId: string, answer: JsonValue) => `${taskId} ${stableJson(answer)}`;

/** Whether the added check applies to a task, by its declared families. */
export function appliesTo(added: Added, task: Pick<Task, "family">): boolean {
  return added.check.families === "all" || added.check.families.includes(task.family);
}

/**
 * A control set before any check runs: what is wrong with it, and the controls fit to be run. The
 * faults are too few reject controls, two controls alike, an answer outside the contract's format,
 * which no solver can submit and no check should be charged with, and a task the new check does
 * not apply to, whose controls would show nothing of it. A control with either of the last two is
 * not run. Every fault is named, as gate 4 names every one (`controlsGate` in
 * `src/kernel/task.ts`).
 */
export function sifted(
  contract: Contract,
  added: Added,
  tasks: ReadonlyMap<string, Task>,
  controls: readonly NamedControl[],
): Sifted {
  const rejects = controls.filter((control) => control.refusedBy !== null).length;
  const keys = controls.map(({ taskId, answer }) => key(taskId, answer));
  const read = controls.map((control, index) => {
    const task = tasks.get(control.taskId);
    const faults: Fault[] = [
      ...(keys.indexOf(keys[index] ?? "") === index
        ? []
        : [["repeat", `${control.name} repeats another control or the answer it starts from`] as const]),
      ...(answerFormatFault(contract, control.answer) === null
        ? []
        : [["format", `${control.name} does not follow the answer format`] as const]),
      ...(task !== undefined && appliesTo(added, task)
        ? []
        : [["family", `${control.name} is of a task ${added.check.id} does not apply to`] as const]),
    ];
    return { control, faults };
  });
  const few: Fault[] =
    rejects < CONTROLS
      ? [["count", `reject controls: ${String(rejects)}, where at least ${String(CONTROLS)} are due`]]
      : [];
  return {
    faults: [...few, ...read.flatMap(({ faults }) => faults)],
    fit: read.flatMap(({ control, faults }) =>
      faults.some(([kind]) => kind === "format" || kind === "family") ? [] : [control],
    ),
  };
}

/** Why each control's first verdict is not what its label says: an accept control the candidate
 *  does not pass whole, and a reject control the new check passes, cannot run on, is not among
 *  the refusers of, or shares with another check. */
export function labelFaults(checkId: string, runs: readonly (ControlRun & NamedControl)[]): Fault[] {
  return runs.flatMap(({ name, refusedBy, verdicts: [verdict] }): Fault[] => {
    if (verdict.kind === "faulty") {
      return [["faulty", `${name}: check ${verdict.check} could not run on it: ${verdict.reason}`]];
    }
    if (refusedBy === null) {
      return verdict.kind === "pass"
        ? []
        : [["accept-refused", `${name} must pass every check and did not: ${spelled(verdict)}`]];
    }
    if (verdict.kind !== "fail") return [["passed", `${checkId} passed ${name}, which it must refuse`]];
    const others = verdict.blocking.filter((check) => check !== checkId).sort(compareCodeUnits);
    if (!verdict.blocking.includes(checkId)) {
      return [["other-check", `${name} was refused by ${others.join(", ")} and not by ${checkId}`]];
    }
    return others.length === 0
      ? []
      : [
          [
            "also-refused",
            `${name} was refused by ${others.join(", ")} as well as ${checkId}: a reject control changes only what the new check judges`,
          ],
        ];
  });
}

/** The controls whose two runs gave two verdicts, a sentence each. */
export function repeatFaults(runs: readonly (ControlRun & NamedControl)[]): string[] {
  return runs.flatMap(({ name, verdicts: [first, second] }) =>
    spelled(first) === spelled(second)
      ? []
      : [`${name} got two verdicts from one answer: ${spelled(first)}, then ${spelled(second)}`],
  );
}

/** The stored answers the interference reads: of tasks the new check applies to, each answer once,
 *  as the first source that holds it names it. */
export function interfering(added: Added, stored: readonly Stored[]): Stored[] {
  const chosen = new Map<string, Stored>();
  for (const each of stored) {
    const name = key(each.task.taskId, each.answer);
    if (appliesTo(added, each.task) && !chosen.has(name)) chosen.set(name, each);
  }
  return [...chosen.values()];
}

/** What the candidate made of one stored answer: it still accepts it, the new check refuses it or
 *  cannot run on it, or an existing check no longer accepts it. */
function standingOf(checkId: string, verdict: Verdict): Standing {
  if (verdict.kind === "pass") return "kept";
  if (verdict.kind === "fail" && verdict.blocking.includes(checkId)) return "refused";
  return verdict.kind === "faulty" && verdict.check === checkId ? "unrunnable" : "stale";
}

/**
 * The reading of what the candidate made of the answers `interfering` chose. `bases` are the
 * unchanged answers the session's own controls start from: the controls gate has passed them, so
 * they are counted for their tasks and left out of what the reading is taken over. A check that
 * refuses every other accepted answer is suspect though it passes the ones its author picked.
 */
export function interference(
  checkId: string,
  graded: readonly Regraded[],
  bases: readonly Control[],
): Interference {
  const own = new Set(bases.map(({ taskId, answer }) => key(taskId, answer)));
  const sorted = graded.map(({ stored, verdict }) => ({
    taskId: stored.task.taskId,
    how: standingOf(checkId, verdict),
    base: own.has(key(stored.task.taskId, stored.answer)),
  }));
  const count = (how: Standing, taskId?: string) =>
    sorted.filter((each) => each.how === how && (taskId === undefined || each.taskId === taskId)).length;
  const [refused, unrunnable, stale] = [count("refused"), count("unrunnable"), count("stale")];
  const applied = sorted.filter(({ how, base }) => how !== "stale" && !base).length;
  const lost = sorted.flatMap(({ taskId, how }) =>
    how === "refused" || how === "unrunnable" ? [taskId] : [],
  );
  const mixed = refused + unrunnable === applied ? "refuses-all" : "refuses-some";
  const settled = refused + unrunnable === 0 ? "refuses-none" : mixed;
  const reading = applied === 0 ? "unread" : settled;
  return {
    applied,
    refused,
    unrunnable,
    stale,
    tasks: [...new Set(lost)].sort(compareCodeUnits).map((taskId) => ({
      taskId,
      refused: count("refused", taskId),
      unrunnable: count("unrunnable", taskId),
      kept: count("kept", taskId),
    })),
    reading,
    suspect: reading === "refuses-all" || unrunnable > 0,
    note:
      unrunnable > 0
        ? `it could not run on ${plural(unrunnable, "accepted answer")} on record, which a check must; ${NOTES[reading]}`
        : NOTES[reading],
  };
}
