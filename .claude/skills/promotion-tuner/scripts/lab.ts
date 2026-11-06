#!/usr/bin/env bun
/**
 * Any promotion mechanism, read over the whole record on one panel. It starts no solve, calls no
 * model and changes no log.
 *
 *   bun --env-file=.env.runs .claude/skills/promotion-tuner/scripts/lab.ts
 *     [--try <knobs>]... [--mechanism <file>]... [--against <worktree>]... [--tree <worktree>]
 *     [--from <tag or date>] [--logs <dir>] [--name <campaign>]... [--record <file>] [--refresh]
 *     [--split <tag or date>] [--named]
 *
 * A replay of one tree's rule can say what that rule reads; a question about the rule itself took a
 * script of its own each time, and each script read a different set of campaigns. So a mechanism here
 * is data (`mechanisms.ts`), and each one is read on everything the rule can be wanted for:
 *
 * - steps, added and dropped against the tree, and what each added step had going for it by the
 *   tree's own tally of the same tasks: ahead, level, 0-0 or behind;
 * - A/A either way beside how many A/As could read a step at all, since most are too small to and a
 *   rate over all of them flatters any rule;
 * - the starter reads, the sign repeat on the disjoint solves of one comparison, and the tasks that
 *   moved between win, loss and tie;
 * - what became of each added step, with the runs that never read again counted apart, since most
 *   campaigns have no ending to read;
 * - dollars, turns and seconds of the harnesses it would promote against their references, and the
 *   solves' dollars and hours a step;
 * - every row by pack, since a pooled rate reads the mix of packs: buffer's objective carried 89% of
 *   the pooled wins, which said nothing of the other packs.
 *
 * Replaying the record counts readings. It says nothing of the path a campaign would have taken,
 * since an earlier promotion changes every reference after it, so it never establishes a gain.
 * It prints counts, session ids and campaign names, and never a task, an answer or a measure.
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import { readsStep, wholePoints } from "#src/kernel/compare.ts";
import { isFunction, isString } from "#src/meta/json-shape.ts";
import { resolve } from "#src/meta/path.ts";
import { median } from "#src/meta/tally.ts";
import {
  type Knobs,
  knobbed,
  knobsOf,
  type Mechanism,
  ratioOf,
  type Resource,
  STANDARD,
  TODAY,
} from "./mechanisms.ts";
import { type Comparison, once, paired, recordOf, type Task, timeOf } from "./record.ts";
import { loadTree, type Tree } from "./tree.ts";

const USAGE = `usage:
  bun --env-file=.env.runs .claude/skills/promotion-tuner/scripts/lab.ts
    [--try <knobs>]... [--mechanism <file>]... [--against <worktree>]... [--tree <worktree>]
    [--from <tag or date>] [--logs <dir>] [--name <campaign>]... [--record <file>] [--refresh]
    [--split <tag or date>] [--named]

--try        a mechanism as knobs over today's, as bill=0.05,when=tied (repeatable); see mechanisms.ts.
             With neither --try nor --mechanism, a standard set of the bill's, time's and the score's forms
--mechanism  a file whose default export is a Mechanism or a list of them (repeatable)
--against    a candidate worktree, read by its own pointsOf and stepOf (repeatable)
--tree       the worktree every row is read against; this checkout by default
--from       campaigns opened at or after this release tag or date; v0.8.0 by default
--logs       an explicit offline folder of campaigns; default: the registry and every configured host
--name       these campaigns only (repeatable)
--record     keep the reduced record in this file (under data/derived/: it holds exam-side measures), and
             read it from there next time
--refresh    read the logs again although --record exists
--split      each row's step rates either side of this tag or date, raw and at the pooled mix of packs
--named      name each comparison a mechanism added or dropped`;
const OPTIONS = {
  try: "list",
  mechanism: "list",
  against: "list",
  tree: "abs",
  from: "text",
  logs: "abs",
  name: "list",
  record: "abs",
  refresh: "flag",
  split: "text",
  named: "flag",
} as const;
const ROOT = resolve(import.meta.dir, "..", "..", "..", "..");
/** Older campaigns ran another exam and another score, and are thin. */
const FROM = "v0.8.0";
const HOUR = 3600;

interface Read {
  readonly scores: readonly number[];
  readonly up: boolean;
  readonly down: boolean;
}

/** One mechanism's panel. */
interface Panel {
  readonly name: string;
  readonly steps: ReadonlySet<Comparison>;
  readonly added: readonly Comparison[];
  readonly dropped: readonly Comparison[];
  /** Added steps by what the tree's own tally of the tasks read. */
  readonly classes: Readonly<Record<"ahead" | "level" | "zero" | "behind", number>>;
  readonly starter: { readonly of: number; readonly reads: number };
  readonly aa: { readonly of: number; readonly capable: number; readonly either: number };
  readonly moved: Readonly<Record<"tasks" | "lossToWin" | "winToLoss" | "tieToWin" | "tieToLoss", number>>;
  readonly repeat: { readonly signed: number; readonly same: number };
  readonly later: Readonly<Record<"same" | "other" | "none" | "unread", number>>;
  readonly ratios: Readonly<Record<Resource, number | null>>;
  readonly untied: number | null;
}

const swapped = (task: Task): Task => ({ ...task, old: task.fresh, fresh: task.old });
const tallyOf = (scores: readonly number[]) => ({
  won: scores.filter((one) => one > 0).length,
  lost: scores.filter((one) => one < 0).length,
  tied: scores.filter((one) => one === 0).length,
});
const fmt = ({ won, lost, tied }: ReturnType<typeof tallyOf>) =>
  `${String(won)}-${String(lost)}-${String(tied)}`;

/** A tree's own rule as a mechanism: its `pointsOf`, and its `stepOf`, given the scores without a
 *  bill where it scores one. */
function treeMechanism(tree: Tree, name: string): Mechanism {
  const answers = (task: Task) => {
    const { validity, objective } = tree.points(paired(task));
    return wholePoints(validity + objective);
  };
  return {
    name,
    score: (task) => {
      const { validity, objective, bill } = tree.points(paired(task));
      return wholePoints(validity + objective + bill);
    },
    test: (scores, level, tasks) => tree.readsStep(scores, tasks.map(answers), level),
  };
}

/** What a mechanism's test reads of a set of tasks, each way. A guard is not read here. */
function readOf(mechanism: Mechanism, tasks: readonly Task[], level: number): Read {
  const test = mechanism.test ?? readsStep;
  const scores = tasks.map(mechanism.score);
  return {
    scores,
    up: test(scores, level, tasks),
    down: test(
      scores.map((one) => -one),
      level,
      tasks.map(swapped),
    ),
  };
}

const stepsUnder = (mechanism: Mechanism, candidates: readonly Comparison[]) =>
  new Set(
    candidates.filter(
      ({ tasks, level }) => readOf(mechanism, tasks, level).up && (mechanism.guard?.(tasks) ?? true),
    ),
  );

/** The tasks' solves one by one, so that the two samples of a comparison share no solve. */
function samples(tasks: readonly Task[]): [Task[], Task[]] | null {
  if (tasks.length === 0 || tasks.some(({ old, fresh }) => old.length < 2 || fresh.length < 2)) return null;
  const at = (index: number) =>
    tasks.map(
      (task): Task => ({
        ...task,
        old: task.old.slice(index, index + 1),
        fresh: task.fresh.slice(index, index + 1),
      }),
    );
  return [at(0), at(1)];
}

/** How often the sign of a task's score holds on the comparison's other solves. */
function repeatOf(mechanism: Mechanism, candidates: readonly Comparison[]) {
  let [signed, same] = [0, 0];
  for (const { tasks } of candidates) {
    const both = samples(tasks);
    if (both === null) continue;
    const [one, other] = both;
    for (const [at, task] of one.entries()) {
      const [first, second] = [mechanism.score(task), mechanism.score(other[at] ?? task)];
      if (first === 0 || second === 0) continue;
      signed += 1;
      same += Math.sign(first) === Math.sign(second) ? 1 : 0;
    }
  }
  return { signed, same };
}

function movedOf(mechanism: Mechanism, base: Mechanism, comparisons: readonly Comparison[]) {
  const moved = { tasks: 0, lossToWin: 0, winToLoss: 0, tieToWin: 0, tieToLoss: 0 };
  for (const task of comparisons.flatMap(({ tasks }) => tasks)) {
    const [was, now] = [base.score(task), mechanism.score(task)];
    moved.tasks += was === now ? 0 : 1;
    moved.lossToWin += was < 0 && now > 0 ? 1 : 0;
    moved.winToLoss += was > 0 && now < 0 ? 1 : 0;
    moved.tieToWin += was === 0 && now > 0 ? 1 : 0;
    moved.tieToLoss += was === 0 && now < 0 ? 1 : 0;
  }
  return moved;
}

function classesOf(added: readonly Comparison[], base: Mechanism) {
  const classes = { ahead: 0, level: 0, zero: 0, behind: 0 };
  for (const { tasks } of added) {
    const { won, lost } = tallyOf(tasks.map(base.score));
    if (won === 0 && lost === 0) classes.zero += 1;
    else if (lost > won) classes.behind += 1;
    else if (lost === won) classes.level += 1;
    else classes.ahead += 1;
  }
  return classes;
}

/** What became of a step the record did not act on. Censored where the campaign read nothing after. */
function laterOf(added: readonly Comparison[]) {
  const later = { same: 0, other: 0, none: 0, unread: 0 };
  for (const { fresh, after } of added) {
    if (after.promoted.includes(fresh)) later.same += 1;
    else if (after.promoted.length > 0) later.other += 1;
    else if (after.readings > 0) later.none += 1;
    else later.unread += 1;
  }
  return later;
}

function panelOf(mechanism: Mechanism, base: Mechanism, comparisons: readonly Comparison[]): Panel {
  const candidates = comparisons.filter(({ kind }) => kind === "candidate");
  const starters = comparisons.filter(({ kind }) => kind === "starter");
  const controls = comparisons.filter(({ aa }) => aa.length > 0);
  const steps = stepsUnder(mechanism, candidates);
  const baseSteps = stepsUnder(base, candidates);
  const added = candidates.filter((one) => steps.has(one) && !baseSteps.has(one));
  const reads = controls.map(({ aa, level }) => ({ read: readOf(mechanism, aa, level), level }));
  const ratio = (resource: Resource) =>
    median([...steps].flatMap(({ tasks }) => ratioOf(tasks, resource) ?? [])) ?? null;
  return {
    name: mechanism.name,
    steps,
    added,
    dropped: candidates.filter((one) => baseSteps.has(one) && !steps.has(one)),
    classes: classesOf(added, base),
    starter: {
      of: starters.length,
      reads: starters.filter(({ tasks, level }) => readOf(mechanism, tasks, level).down).length,
    },
    aa: {
      of: controls.length,
      // Could these margins read a step at all: the signing that wins every untied task. Every test
      // here reads that signing as its least p, so the sign-flip test answers for all of them.
      capable: reads.filter(({ read, level }) => readsStep(read.scores.map(Math.abs), level)).length,
      either: reads.filter(({ read }) => read.up || read.down).length,
    },
    moved: movedOf(mechanism, base, comparisons),
    repeat: repeatOf(mechanism, candidates),
    later: laterOf(added),
    ratios: { bill: ratio("bill"), turns: ratio("turns"), seconds: ratio("seconds") },
    untied: median(
      [...steps].map(({ tasks }) => tasks.map(mechanism.score).filter((one) => one !== 0).length),
    ),
  };
}

const pad = (text: string, width: number) => text.padStart(width);
const two = (value: number | null) => (value === null ? "-" : value.toFixed(2));
const share = (some: number, of: number) => (of === 0 ? "-" : (some / of).toFixed(2));

/** The main table: one row a mechanism. */
function panelLines(panels: readonly Panel[], comparisons: readonly Comparison[]): string[] {
  // Tasks alone: an A/A halves the reference's own solves, so counting it would pay for them twice.
  const solves = comparisons
    .filter(({ kind }) => kind === "candidate")
    .flatMap(({ tasks }) => tasks.flatMap(({ old, fresh }) => [...old, ...fresh]));
  const dollars = solves.reduce((all, { billed }) => all + (billed ?? 0), 0);
  const hours = solves.reduce((all, { seconds }) => all + (seconds ?? 0), 0) / HOUR;
  const width = Math.max(10, ...panels.map(({ name }) => name.length));
  const candidates = comparisons.filter(({ kind }) => kind === "candidate").length;
  const header = `${"mechanism".padEnd(width)} steps   +   - | ahead lvl 0-0 bhd | starter  A/A (could) | repeat | bill turns  secs | $/step h/step untied`;
  return [
    `steps of ${String(candidates)} candidate comparisons; + and - against the first row; bill, turns and secs are the new side over the reference in the comparisons it steps on`,
    header,
    ...panels.map((one) => {
      const { steps, added, dropped, classes, starter, aa, repeat, ratios, untied } = one;
      const per = (total: number) => (steps.size === 0 ? "-" : (total / steps.size).toFixed(1));
      return [
        `${one.name.padEnd(width)} ${pad(String(steps.size), 5)} ${pad(`+${String(added.length)}`, 3)} ${pad(`-${String(dropped.length)}`, 3)}`,
        `${pad(String(classes.ahead), 5)} ${pad(String(classes.level), 3)} ${pad(String(classes.zero), 3)} ${pad(String(classes.behind), 3)}`,
        `${pad(`${String(starter.reads)}/${String(starter.of)}`, 7)} ${pad(`${String(aa.either)}/${String(aa.capable)}`, 4)} ${pad(`(${String(aa.of)})`, 7)}`,
        pad(share(repeat.same, repeat.signed), 6),
        `${pad(two(ratios.bill), 4)} ${pad(two(ratios.turns), 5)} ${pad(two(ratios.seconds), 5)}`,
        `${pad(per(dollars), 6)} ${pad(per(hours), 6)} ${pad(untied === null ? "-" : String(untied), 6)}`,
      ].join(" | ");
    }),
  ];
}

function detailLines(panels: readonly Panel[], comparisons: readonly Comparison[]): string[] {
  const candidates = comparisons.filter(({ kind }) => kind === "candidate");
  const packs = [...new Set(candidates.map(({ pack }) => pack))].toSorted();
  const width = Math.max(10, ...panels.map(({ name }) => name.length));
  const of = (pack: string) => candidates.filter((one) => one.pack === pack).length;
  const lines = [
    "",
    `steps by pack, of ${packs.map((pack) => `${pack} ${String(of(pack))}`).join(", ")}`,
    `${"mechanism".padEnd(width)} ${packs.map((pack) => pad(pack, Math.max(pack.length, 3))).join(" ")}`,
    ...panels.map(({ name, steps }) => {
      const cells = packs.map((pack) =>
        pad(String([...steps].filter((one) => one.pack === pack).length), Math.max(pack.length, 3)),
      );
      return `${name.padEnd(width)} ${cells.join(" ")}`;
    }),
    "",
    "tasks moved against the first row; what became of each added step (the harness promoted later, another, none though read again, nothing read after)",
    `${"mechanism".padEnd(width)}  moved  L>W  W>L  T>W  T>L | same other none unread | added shared with the row above`,
  ];
  for (const [at, panel] of panels.entries()) {
    const { moved, later, added } = panel;
    const above = panels[at - 1]?.added ?? [];
    const shared = added.filter((one) => above.includes(one)).length;
    lines.push(
      [
        `${panel.name.padEnd(width)} ${pad(String(moved.tasks), 6)} ${pad(String(moved.lossToWin), 4)} ${pad(String(moved.winToLoss), 4)} ${pad(String(moved.tieToWin), 4)} ${pad(String(moved.tieToLoss), 4)}`,
        `${pad(String(later.same), 4)} ${pad(String(later.other), 5)} ${pad(String(later.none), 4)} ${pad(String(later.unread), 6)}`,
        `${String(shared)} of ${String(added.length)} (above ${String(above.length)})`,
      ].join(" | "),
    );
  }
  return lines;
}

/** Each row's step rate either side of a time, raw and at the pooled mix of packs on both sides: on
 *  the record a later cohort read lower raw and higher at one mix, the gap being which packs ran. */
function splitLines(
  panels: readonly Panel[],
  comparisons: readonly Comparison[],
  time: number,
  label: string,
) {
  const candidates = comparisons.filter(({ kind }) => kind === "candidate");
  const sides = [
    candidates.filter(({ opened }) => opened < time),
    candidates.filter(({ opened }) => opened >= time),
  ];
  const shared = [...new Set(candidates.map(({ pack }) => pack))].filter((pack) =>
    sides.every((side) => side.some((one) => one.pack === pack)),
  );
  const pooled = candidates.filter(({ pack }) => shared.includes(pack));
  const rate = (steps: ReadonlySet<Comparison>, side: readonly Comparison[]) => {
    const rows = shared.map((pack) => {
      const mine = side.filter((one) => one.pack === pack);
      const weight = pooled.filter((one) => one.pack === pack).length / Math.max(1, pooled.length);
      return (mine.filter((one) => steps.has(one)).length / Math.max(1, mine.length)) * weight;
    });
    return rows.reduce((all, one) => all + one, 0);
  };
  const [before = [], since = []] = sides;
  return [
    "",
    `step rate before and from ${label} (${String(before.length)}, ${String(since.length)}), raw, then at the pooled mix of ${shared.join(", ")}`,
    ...panels.map(({ name, steps }) => {
      const raw = (side: readonly Comparison[]) =>
        share(side.filter((one) => steps.has(one)).length, side.length);
      return `  ${name}: ${raw(before)} ${raw(since)}; ${rate(steps, before).toFixed(2)} ${rate(steps, since).toFixed(2)}`;
    }),
  ];
}

function namedLines(panels: readonly Panel[], mechanisms: readonly Mechanism[], base: Mechanism): string[] {
  return panels.flatMap((panel, at) => {
    const mechanism = mechanisms[at] ?? base;
    const row = (sign: string, { campaign, session, tasks, after }: Comparison) =>
      `  ${sign} ${campaign} ${session}: ${fmt(tallyOf(tasks.map(base.score)))} by the tree, ${fmt(tallyOf(tasks.map(mechanism.score)))} here; later promotions ${String(after.promoted.length)}, later readings ${String(after.readings)}`;
    const rows = [...panel.added.map((one) => row("+", one)), ...panel.dropped.map((one) => row("-", one))];
    return rows.length === 0 ? [] : ["", panel.name, ...rows];
  });
}

/** How far the knobs at production's values and the record's own readings stand from the tree. */
function reconcileLines(base: Mechanism, comparisons: readonly Comparison[], tree: Tree): string[] {
  const knobs = knobbed(TODAY, "knobs");
  const tasks = comparisons.flatMap(({ tasks: scored, aa }) => [...scored, ...aa]);
  const differ = tasks.filter((task) => knobs.score(task) !== base.score(task)).length;
  const otherwise = comparisons.filter(({ kind, tasks: scored, level, reading }) => {
    if (kind !== "candidate") return false;
    return readOf(base, scored, level).up !== (reading === "step");
  }).length;
  return [
    `tree ${tree.path} at ${tree.commit}`,
    `knobs at today's values against the tree's score: ${String(tasks.length)} tasks, ${String(differ)} differ${differ === 0 ? "" : ": rows of knobs are not read from the tree's rule"}`,
    `candidates the tree reads otherwise than their report did, under the rule of their own day: ${String(otherwise)}`,
  ];
}

async function fileMechanisms(args: CommandArgs): Promise<Mechanism[]> {
  const found: Mechanism[] = [];
  for (const file of args.list("mechanism")) {
    // SAFETY: the check below refuses an export without a name and a score.
    const { default: exported } = (await import(resolve(file))) as { default: Mechanism | Mechanism[] };
    for (const one of Array.isArray(exported) ? exported : [exported]) {
      if (!isString(one?.name) || !isFunction(one.score)) {
        return args.die(`${file} must export a mechanism with a name and a score`);
      }
      found.push(one);
    }
  }
  return found;
}

async function main(args: CommandArgs): Promise<number> {
  const tree = await loadTree(args.value("tree") ?? ROOT);
  const base = treeMechanism(tree, "tree");
  const { comparisons: read, unread } = await recordOf({
    file: args.value("record"),
    home: args.value("logs"),
    names: args.list("name"),
    from: timeOf(args.value("from") ?? FROM),
    refresh: args.flag("refresh"),
  });
  const comparisons = once(read);
  const { die } = args;
  const tried = args.list("try").map((spec) => knobbed(knobsOf(spec, die) satisfies Knobs, spec));
  const files = await fileMechanisms(args);
  const others = await Promise.all(
    args.list("against").map(async (path) => treeMechanism(await loadTree(resolve(path)), path)),
  );
  const asked = [...tried, ...files, ...others];
  const shown = asked.length > 0 ? asked : STANDARD.map((spec) => knobbed(knobsOf(spec, die), spec));
  const mechanisms = [base, ...shown];
  const panels = mechanisms.map((mechanism) => panelOf(mechanism, base, comparisons));
  const split = args.value("split");
  console.log(
    [
      ...reconcileLines(base, comparisons, tree),
      `comparisons ${String(comparisons.length)} (${String(read.length - comparisons.length)} fork copies dropped), campaigns not read ${String(unread.length)}${unread.length === 0 ? "" : `: ${unread.join("; ")}`}`,
      "",
      ...panelLines(panels, comparisons),
      ...detailLines(panels, comparisons),
      ...(split === null ? [] : splitLines(panels, comparisons, timeOf(split), split)),
      ...(args.flag("named") ? namedLines(panels, mechanisms, base) : []),
    ].join("\n"),
  );
  return 0;
}

if (import.meta.main) await runCommand({ name: "lab", usage: USAGE, options: OPTIONS }, main);
