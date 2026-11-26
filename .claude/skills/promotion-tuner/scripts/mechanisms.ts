/**
 * A promotion mechanism, so one can be tried without a candidate tree: a task's score, a test over
 * the scores, and a guard that may refuse a step. Any may be free code in a file (`--mechanism`);
 * most are written as knobs (`--try bill=0.05,when=tied`). A task's answers are production's
 * `pointsOf` reweighted, and only `room` and `gain` read the objective again, by `gainOver`; a
 * judged task keeps production's objective under them.
 */
import { flipP, GAP_FLOOR, gainOver, pointsOf, rawFlipP, WEIGHTS, wholePoints } from "#src/kernel/compare.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { paired, type Solve, type Task } from "./record.ts";

export interface Mechanism {
  readonly name: string;
  /** What a task scores for the new harness, positive where it is the better, in whole points. */
  score: (task: Task) => number;
  test?: (scores: readonly number[], level: number, tasks: readonly Task[]) => boolean;
  /** Whether a step that read may promote; every step by default. Only a candidate's step reads it.
   */
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
  unit: ["task", "family", "first", "cap2", "cap3"],
} as const;
type Choice = keyof typeof CHOICES;

const NUMBERS = ["validity", "objective", "bill", "turns", "seconds", "room", "floor", "untied"] as const;
const OPTIONAL = ["level", "mostBill", "mostTurns", "mostSeconds"] as const;

type Knobs = Readonly<
  Record<(typeof NUMBERS)[number], number> &
    Record<(typeof OPTIONAL)[number], number | null> & { [Key in Choice]: (typeof CHOICES)[Key][number] }
>;

export const TODAY: Knobs = {
  validity: WEIGHTS.validity,
  objective: WEIGHTS.objective,
  bill: 0,
  turns: 0,
  seconds: 0,
  room: GAP_FLOOR,
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
  test: "rank",
  retained: "in",
  unit: "task",
};

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
  "test=flip",
  "level=0.01",
  "untied=8",
  "retained=out",
  "unit=family",
  "unit=first",
  "unit=cap2",
  "unit=cap3",
] as const;

const POINTS = 1000;
const NEAR = 1e-9;

function objectiveGain(knobs: Knobs, task: Task, one: number | null, other: number | null): number {
  const { direction, scale } = task;
  if (direction === null) return 0;
  const gain = gainOver({ direction, ...keyIfDefined("scale", scale) }, one, other);
  if (Math.abs(gain) < knobs.room) return 0;
  if (knobs.gain === "sign") return Math.sign(gain);
  if (knobs.gain === "log") {
    return Math.sign(gain) * Math.min(1, -Math.log2(Math.max(1 - Math.abs(gain), NEAR)));
  }
  return gain;
}

/** A log ratio at most one either way; 0 under the floor, and where either is unknown or nothing. */
function resourceGain(knobs: Knobs, fresh: number | null, old: number | null): number {
  if (fresh === null || old === null || fresh <= 0 || old <= 0) return 0;
  const ratio = Math.log2(old / fresh);
  if (Math.abs(ratio) < Math.log2(knobs.floor) - NEAR) return 0;
  if ((knobs.side === "cheaper" && ratio < 0) || (knobs.side === "dearer" && ratio > 0)) return 0;
  return Math.max(-1, Math.min(1, ratio));
}

function partsOf(task: Task, knobs: Knobs) {
  const sums = { objective: 0, bill: 0, turns: 0, seconds: 0 };
  for (const fresh of task.fresh) {
    for (const old of task.old) {
      if (!fresh.valid || !old.valid) continue;
      sums.objective += objectiveGain(knobs, task, fresh.measure, old.measure);
      for (const [name, pick] of Object.entries(RESOURCES)) {
        // SAFETY: the keys of `RESOURCES` are `Resource`, and `sums` holds each.
        sums[name as Resource] += resourceGain(knobs, pick(fresh), pick(old));
      }
    }
  }
  const each = POINTS / Math.max(1, task.fresh.length * task.old.length);
  const { validity, objective } = pointsOf(paired(task));
  const curved = task.judged === undefined && (knobs.room !== GAP_FLOOR || knobs.gain !== "share");
  return {
    answers:
      validity * (knobs.validity / WEIGHTS.validity) +
      (curved ? sums.objective * knobs.objective * each : objective * (knobs.objective / WEIGHTS.objective)),
    resources: (sums.bill * knobs.bill + sums.turns * knobs.turns + sums.seconds * knobs.seconds) * each,
  };
}

function scoreOf(task: Task, knobs: Knobs): number {
  if (task.retained && knobs.retained === "out") return 0;
  const { answers, resources } = partsOf(task, knobs);
  const counts =
    knobs.when === "always" ||
    (knobs.when === "tied" && wholePoints(answers) === 0) ||
    (knobs.when === "no-objective" && task.direction === null);
  return wholePoints(answers + (counts ? resources : 0));
}

function answersLead(tasks: readonly Task[], knobs: Knobs): boolean {
  const signs = tasks.map((task) => Math.sign(wholePoints(partsOf(task, knobs).answers)));
  return signs.reduce<number>((all, one) => all + one, 0) > 0;
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

/** A comparison with no usable task passes: it holds nothing that says the new side costs more. */
function withinCeilings(tasks: readonly Task[], knobs: Knobs): boolean {
  const ceilings = [
    ["bill", knobs.mostBill],
    ["turns", knobs.mostTurns],
    ["seconds", knobs.mostSeconds],
  ] as const;
  return ceilings.every(([resource, most]) => most === null || (ratioOf(tasks, resource) ?? 0) <= most);
}

function unitsOf(scores: readonly number[], tasks: readonly Task[], unit: Knobs["unit"]): number[] {
  if (unit === "task") return [...scores];
  const kin = Map.groupBy(scores, (_, at) => tasks[at]?.family ?? `task ${String(at)}`);
  if (unit === "cap2" || unit === "cap3") {
    return [...kin.values()].flatMap((each) => each.slice(0, unit === "cap2" ? 2 : 3));
  }
  return [...kin.values()].map((each) =>
    unit === "first" ? (each[0] ?? 0) : wholePoints(each.reduce((all, one) => all + one, 0) / each.length),
  );
}

export function knobbed(knobs: Knobs, name: string): Mechanism {
  const pOf = (scores: readonly number[]) => {
    if (knobs.test === "sign") return flipP(scores.map(Math.sign));
    return knobs.test === "flip" ? rawFlipP(scores) : flipP(scores);
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
