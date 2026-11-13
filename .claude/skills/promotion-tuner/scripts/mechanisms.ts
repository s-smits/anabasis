/**
 * What a promotion mechanism is, so that one can be tried without a candidate tree: a task's score,
 * a test over the scores, and a guard that may refuse a step. Any of them may be free code in a file
 * (`--mechanism`); most are written as knobs (`--try bill=0.05,when=tied`).
 *
 * The knobs start from production's weights and floor, and `replay.ts`'s panel counts every task on
 * which their score at those values differs from the tree's own, so they cannot drift from it
 * unseen. Each knob is one the record has been asked about:
 *
 * - `validity`, `objective`: the weights. They set a task's margin and never whether a tied task
 *   counts, so a change moves many scores and few readings.
 * - `bill`, `turns`, `seconds`: a resource as a gain, its log ratio between two valid answers, nothing
 *   under `floor`, at most one either way. Any weight above a small one adds nearly the same steps,
 *   since a task otherwise tied now leans, and the test counts the lean more than its size.
 * - `when`: where a resource gain counts: `always`, `tied` (only a task the answers tie) or
 *   `no-objective` (only an exam with no objective).
 * - `side`: `cheaper` counts only what the new side saved, `dearer` only what it spent over. Either
 *   leans between identical sides, since their solves differ by noise, and the test assumes a score
 *   that negates when the sides swap, so read such a row's A/A before its steps.
 * - `lead`: `answers` refuses a step unless the answers alone won more tasks than they lost, so that a
 *   resource can tip a comparison and never carry one.
 * - `mostBill`, `mostTurns`, `mostSeconds`: a resource as a guard: a step is refused where the new side
 *   used more than this many times the reference on tasks both answered in every solve. A guard can
 *   only remove a step, and it reads no A/A, since a guard is no part of the test.
 * - `room`: the objective's floor. `gain`: `share` as production, `sign`, or `log`.
 * - `test`: `flip` as production, `sign` (margins ignored) or `rank` (signed ranks). `level`: in place
 *   of the recorded one. `untied`: the fewest untied tasks a step may rest on.
 * - `retained`: `out` leaves the retained tasks out of the score.
 * - `unit`: what the test counts once: each `task` as production, or each family, by the `family`'s
 *   mean score or its `first` task's (the line `wri.ts reader scores` prints). Siblings of one family
 *   repeat one effect, which a test over tasks counts once for each; a task of no family stands alone.
 */
import { flipP, ROOM, WEIGHTS, wholePoints } from "#src/kernel/compare.ts";
import type { Solve, Task } from "./record.ts";

export interface Mechanism {
  readonly name: string;
  /** What a task scores for the new harness, positive where it is the better, in whole points. */
  score: (task: Task) => number;
  /** Whether a comparison's scores read a step for the new side; the sign-flip test by default. */
  test?: (scores: readonly number[], level: number, tasks: readonly Task[]) => boolean;
  /** Whether a step that read may promote; every step by default. Only a candidate's step reads it. */
  guard?: (tasks: readonly Task[]) => boolean;
}

const RESOURCES = {
  bill: ({ billed }: Solve) => billed,
  turns: ({ turns }: Solve) => turns,
  seconds: ({ seconds }: Solve) => seconds,
} as const;
export type Resource = keyof typeof RESOURCES;

const CHOICES = {
  gain: ["share", "sign", "log"],
  when: ["always", "tied", "no-objective"],
  side: ["both", "cheaper", "dearer"],
  lead: ["any", "answers"],
  test: ["flip", "sign", "rank"],
  retained: ["in", "out"],
  unit: ["task", "family", "first"],
} as const;
type Choice = keyof typeof CHOICES;

const NUMBERS = ["validity", "objective", "bill", "turns", "seconds", "room", "floor", "untied"] as const;
const OPTIONAL = ["level", "mostBill", "mostTurns", "mostSeconds"] as const;

export type Knobs = Readonly<
  Record<(typeof NUMBERS)[number], number> &
    Record<(typeof OPTIONAL)[number], number | null> & { [Key in Choice]: (typeof CHOICES)[Key][number] }
>;

/** Production's score and test, as knobs. */
export const TODAY: Knobs = {
  validity: WEIGHTS.validity,
  objective: WEIGHTS.objective,
  bill: 0,
  turns: 0,
  seconds: 0,
  room: ROOM,
  floor: 1.25,
  untied: 0,
  level: null,
  mostBill: null,
  mostTurns: null,
  mostSeconds: null,
  gain: "share",
  when: "always",
  side: "both",
  lead: "any",
  test: "flip",
  retained: "in",
  unit: "task",
};

/** What each form of the bill, of time and of the score's other choices reads, when none is named. */
export const STANDARD = [
  "bill=0.1",
  "bill=0.05",
  "bill=0.01",
  "bill=0.05,when=tied",
  "bill=0.05,when=no-objective",
  "bill=0.1,lead=answers",
  "bill=0.1,side=cheaper,lead=answers",
  "bill=0.1,side=dearer",
  "bill=0.1,floor=1.5,lead=answers",
  "seconds=0.05",
  "seconds=0.05,when=tied",
  "seconds=0.05,when=no-objective",
  "mostBill=1.1",
  "mostBill=1.25",
  "mostBill=1.5",
  "mostBill=2",
  "mostSeconds=1.25",
  "mostSeconds=1.5",
  "mostSeconds=2",
  "mostSeconds=4",
  "mostTurns=1.25",
  "room=0",
  "room=0.05",
  "validity=0.45,objective=0.45",
  "test=sign",
  "test=rank",
  "level=0.01",
  "untied=8",
  "retained=out",
  "unit=family",
  "unit=first",
] as const;

const POINTS = 1000;
const NEAR = 1e-9;

/** How much better `one` is than `other` by the objective, under the knobs' floor and form. */
function objectiveGain(
  knobs: Knobs,
  direction: Task["direction"],
  one: number | null,
  other: number | null,
): number {
  if (direction === null || one === null || other === null) return 0;
  const larger = Math.max(Math.abs(one), Math.abs(other));
  if (larger === 0) return 0;
  const gain = Math.max(-1, Math.min(1, (direction === "lower" ? other - one : one - other) / larger));
  if (Math.abs(gain) < knobs.room) return 0;
  if (knobs.gain === "sign") return Math.sign(gain);
  if (knobs.gain === "log") {
    return Math.sign(gain) * Math.min(1, -Math.log2(Math.max(1 - Math.abs(gain), NEAR)));
  }
  return gain;
}

/** How much less the new side used, as a log ratio at most one either way; 0 under the floor, and
 *  where either is unknown or nothing. */
function resourceGain(knobs: Knobs, fresh: number | null, old: number | null): number {
  if (fresh === null || old === null || fresh <= 0 || old <= 0) return 0;
  const ratio = Math.log2(old / fresh);
  if (Math.abs(ratio) < Math.log2(knobs.floor) - NEAR) return 0;
  if ((knobs.side === "cheaper" && ratio < 0) || (knobs.side === "dearer" && ratio > 0)) return 0;
  return Math.max(-1, Math.min(1, ratio));
}

/** A task's points by measure under the knobs, unrounded. */
function partsOf(task: Task, knobs: Knobs) {
  const sums = { validity: 0, objective: 0, bill: 0, turns: 0, seconds: 0 };
  for (const fresh of task.fresh) {
    for (const old of task.old) {
      if (fresh.valid !== old.valid) sums.validity += fresh.valid ? 1 : -1;
      if (!fresh.valid || !old.valid) continue;
      sums.objective += objectiveGain(knobs, task.direction, fresh.measure, old.measure);
      for (const [name, pick] of Object.entries(RESOURCES)) {
        // SAFETY: the keys of `RESOURCES` are `Resource`, and `sums` holds each.
        sums[name as Resource] += resourceGain(knobs, pick(fresh), pick(old));
      }
    }
  }
  const each = POINTS / Math.max(1, task.fresh.length * task.old.length);
  return {
    answers: (sums.validity * knobs.validity + sums.objective * knobs.objective) * each,
    resources: (sums.bill * knobs.bill + sums.turns * knobs.turns + sums.seconds * knobs.seconds) * each,
  };
}

/** The score under the knobs. */
function scoreOf(task: Task, knobs: Knobs): number {
  if (task.retained && knobs.retained === "out") return 0;
  const { answers, resources } = partsOf(task, knobs);
  const counts =
    knobs.when === "always" ||
    (knobs.when === "tied" && wholePoints(answers) === 0) ||
    (knobs.when === "no-objective" && task.direction === null);
  return wholePoints(answers + (counts ? resources : 0));
}

/** Whether the answers alone, without any resource, won more tasks than they lost. */
function answersLead(tasks: readonly Task[], knobs: Knobs): boolean {
  const signs = tasks.map((task) => Math.sign(wholePoints(partsOf(task, knobs).answers)));
  return signs.reduce<number>((all, one) => all + one, 0) > 0;
}

/** The signed-rank statistic through `flipP`: ranks doubled, so that a tie's mean is a whole number. */
function rankP(scores: readonly number[]): number {
  const untied = scores.filter((one) => one !== 0);
  const sizes = untied.map(Math.abs).toSorted((one, other) => one - other);
  return flipP(
    untied.map((one) => {
      const first = sizes.indexOf(Math.abs(one));
      const last = sizes.lastIndexOf(Math.abs(one));
      return Math.sign(one) * (first + last + 2);
    }),
  );
}

/** The new side's use of `resource` over the reference's, on tasks both answered in every solve and
 *  every solve of which holds it; null where none does. */
export function ratioOf(tasks: readonly Task[], resource: Resource): number | null {
  const pick = RESOURCES[resource];
  const usable = tasks.filter(({ old, fresh }) =>
    [...old, ...fresh].every((solve) => solve.valid && pick(solve) !== null),
  );
  const sum = (solves: readonly Solve[]) => solves.reduce((all, solve) => all + (pick(solve) ?? 0), 0);
  const [fresh, old] = [
    usable.reduce((all, task) => all + sum(task.fresh), 0),
    usable.reduce((all, task) => all + sum(task.old), 0),
  ];
  return fresh > 0 && old > 0 ? fresh / old : null;
}

/** Whether every resource with a ceiling stays under it. A comparison with no usable task passes:
 *  it holds nothing that says the new side costs more. */
function withinCeilings(tasks: readonly Task[], knobs: Knobs): boolean {
  const ceilings = [
    ["bill", knobs.mostBill],
    ["turns", knobs.mostTurns],
    ["seconds", knobs.mostSeconds],
  ] as const;
  return ceilings.every(([resource, most]) => most === null || (ratioOf(tasks, resource) ?? 0) <= most);
}

/** The scores the test reads under `unit`, one a task or one a family. */
function unitsOf(scores: readonly number[], tasks: readonly Task[], unit: Knobs["unit"]): number[] {
  if (unit === "task") return [...scores];
  const kin = Map.groupBy(scores, (_, at) => tasks[at]?.family ?? `task ${String(at)}`);
  return [...kin.values()].map((each) =>
    unit === "first" ? (each[0] ?? 0) : wholePoints(each.reduce((all, one) => all + one, 0) / each.length),
  );
}

/** A mechanism from knobs. */
export function knobbed(knobs: Knobs, name: string): Mechanism {
  const pOf = (scores: readonly number[]) => {
    if (knobs.test === "sign") return flipP(scores.map(Math.sign));
    return knobs.test === "rank" ? rankP(scores) : flipP(scores);
  };
  return {
    name,
    score: (task) => scoreOf(task, knobs),
    test: (scores, level, tasks) => {
      const units = unitsOf(scores, tasks, knobs.unit);
      return (
        units.filter((one) => one !== 0).length >= knobs.untied &&
        pOf(units) <= (knobs.level ?? level) &&
        (knobs.lead === "any" || answersLead(tasks, knobs))
      );
    },
    guard: (tasks) => withinCeilings(tasks, knobs),
  };
}

function knobEntry(part: string, die: (why: string) => never): [string, string | number] {
  const [key = "", value = ""] = part.split("=");
  if (key in CHOICES) {
    // SAFETY: `key in CHOICES` holds here.
    const allowed: readonly string[] = CHOICES[key as Choice];
    if (allowed.includes(value)) return [key, value];
    return die(`${key} takes ${allowed.join(", ")}; got ${value}`);
  }
  const known: readonly string[] = [...NUMBERS, ...OPTIONAL];
  if (!known.includes(key)) {
    return die(`no knob ${key}: the knobs are ${[...known, ...Object.keys(CHOICES)].join(", ")}`);
  }
  const number = Number(value);
  if (value === "" || !Number.isFinite(number) || number < 0) {
    return die(`${key} takes a number from 0 up; got ${value}`);
  }
  return [key, number];
}

/** The knobs a `--try` spec names over production's, as `bill=0.05,when=tied`. */
export function knobsOf(spec: string, die: (why: string) => never): Knobs {
  const entries = spec.split(",").map((part) => knobEntry(part, die));
  // SAFETY: `knobEntry` checks each key against the knobs and each value against its kind.
  return { ...TODAY, ...(Object.fromEntries(entries) as Partial<Knobs>) };
}
