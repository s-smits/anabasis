#!/usr/bin/env bun
/**
 * Synthetic logs: build a campaign's events in memory, hand them to any reader of a tree, and print
 * what the reader makes of them. No model runs and nothing is written. It answers "does this reader
 * turn this pattern into the step I expect", for a pattern no recorded run happens to hold.
 *
 *   bun .claude/skills/system-path-simulation/scripts/synthetic.ts --list
 *   bun .claude/skills/system-path-simulation/scripts/synthetic.ts pool [--tree <worktree>]
 *   bun .claude/skills/system-path-simulation/scripts/synthetic.ts <scenario.ts> [--tree <worktree>]
 *
 * A scenario is a function of the kit (`Kit`): a log builder (`Log`), the tree's readers already
 * loaded (`readers`), the tree's root (`tree`, to import any other module of it) and `table`. The
 * examples at the foot of this file are scenarios: run one by name, or copy it into a scratch file
 * that default-exports a scenario, change its constants, and run that. The readers come from
 * `--tree` (the working directory by default), so one scenario read on two trees shows what a
 * change between them does to the reader.
 *
 * The events stay in memory: rule 3 of the skill keeps hand-built events out of every seed and
 * campaign folder. Written on 29 October, when two solves a side and the counts of #516 had to be
 * read on patterns (0/2 twice, 2/2 then 1/2, a promotion between readings) that no log held yet.
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import type { Plan } from "#src/campaign/ground.ts";
import type { Condition } from "#src/kernel/condition.ts";
import type { EventKind, LogEvent } from "#src/kernel/log.ts";
import type { JsonObject } from "#src/meta/json-shape.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { join, resolve } from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { requireJsonValue } from "#src/meta/stable-json.ts";

const USAGE = `usage: synthetic.ts (<example> | <scenario.ts> | --list) [--tree <dir>]

Runs one scenario over a log built in memory and prints what the tree's readers make of it. An
example is named from this file; a scenario file default-exports (kit) => void.`;
const OPTIONS = { tree: "abs", list: "flag" } as const;

/** The kind of fail each solve letter but `P` stands for: a rejection ruled earned, a solve the
 *  deadline cut, and one that gave no answer. */
const FAILS = { F: "rejected", W: "wall-ended", N: "no-answer" } as const;

interface Readers {
  readonly reports: typeof import("#src/kernel/reports.ts");
  readonly size: typeof import("#src/kernel/size.ts");
  readonly condition: typeof import("#src/kernel/condition.ts");
  readonly record: typeof import("#src/examiner/record.ts");
  readonly decide: typeof import("#src/campaign/decide.ts");
  readonly move: typeof import("#src/campaign/move.ts");
}

export interface Kit {
  readonly tree: string;
  readonly readers: Readers;
  readonly log: () => Log;
  readonly table: (header: readonly string[], rows: readonly (readonly string[])[]) => void;
}
export type Scenario = (kit: Kit) => void | Promise<void>;

/** How the task pool's readers sort each task by its readings, one comparison a reading. */
const POOL = {
  "every twice": ["PP/PP", "PP/PP"],
  "every, then some": ["PP/PP", "PP/PP", "FP/PP"],
  "next harness slips": ["PP/PP", "PP/FP"],
  "none twice": ["FF/FF", "FF/FF"],
  "none twice, cut": ["WF/FF", "WF/FF"],
  "none, author answered": ["FF/FF", "FF/FF"],
} satisfies Readonly<Record<string, readonly string[]>>;

/** The move the decision table names for a log, under a plan whose terms are the constants here. */
const PLAN: Plan = {
  sessions: 1,
  patience: 3,
  unprepared: false,
  practice: null,
  wanted: { target: 8, level: 0.1 },
  pastStop: null,
  prompted: false,
  admits: [],
  left: null,
};

/** A log under construction. Each method appends the events the campaign's own writer would, in
 *  the shapes the readers read, and returns the log, so calls chain. `add` takes any other kind. */
export class Log {
  readonly events: LogEvent[] = [];
  private solves = 0;
  private readonly condition: Readers["condition"];

  constructor(condition: Readers["condition"]) {
    this.condition = condition;
  }

  add(kind: EventKind, data: JsonObject): this {
    this.events.push({ at: "2026-10-29T00:00:00.000Z", kind, data });
    return this;
  }

  /** A task held out, with the reference's room solves at its admission where `reference` names them. */
  hold(task: string, reference?: { readonly valid: number; readonly solves: number }): this {
    this.add("task.proposed", { version: task, taskId: task });
    return this.add("task.gate", {
      version: task,
      gate: 1,
      outcome: "passed",
      ...keyIfDefined("reference", reference === undefined ? undefined : { ...reference, turns: [] }),
    });
  }

  /** A draft the admission refused after reading the reference's `solves` room solves. */
  refuse(task: string, valid: number, solves = 3): this {
    this.add("task.proposed", { version: task, taskId: task });
    return this.add("task.gate", {
      version: task,
      gate: 1,
      outcome: "refused",
      reference: { valid, solves, turns: [] },
    });
  }

  /** A task held out, then released for practice. */
  release(task: string): this {
    return this.hold(task).add("task.state", { version: task, state: "released" });
  }

  /** The author's own answer passed on the task: a valid answer on record. */
  feasible(task: string): this {
    return this.add("task.feasible", { version: task, session: "x-1" });
  }

  /** One comparison `session` of `old` against `fresh`, with each task's solves as `<old>/<fresh>`
   *  letters (P valid, F rejected and ruled earned, W cut by the deadline, N no answer). */
  compare(
    session: string,
    sides: { readonly old: string; readonly fresh: string; readonly starter?: string },
    tasks: Readonly<Record<string, string>>,
    reported: JsonObject = {},
  ): this {
    const scored = Object.entries(tasks);
    for (const [task, reading] of scored) {
      const [own = "", next = ""] = reading.split("/");
      this.solved(session, task, sides.old, own).solved(session, task, sides.fresh, next);
    }
    return this.add("comparison.reported", {
      session,
      reading: "no-step",
      starter: sides.old,
      ...sides,
      solves: scored[0]?.[1].split("/")[0]?.length ?? 0,
      setting: this.condition.settingId(conditionOf("any", "any")),
      scored: { wins: 0, losses: 0, ties: scored.length },
      versions: scored.map(([task]) => task),
      ...reported,
    });
  }

  promote(harness: string, from: string, comparison: string): this {
    return this.add("harness.promoted", { harness, from, comparison });
  }

  private solved(session: string, task: string, harness: string, letters: string): this {
    const ran = conditionOf(task, harness);
    const id = this.condition.conditionId(ran);
    this.add("condition.recorded", { id, condition: requireJsonValue(ran) });
    for (const letter of letters.split("")) {
      this.solves += 1;
      const solve = `s-${String(this.solves)}`;
      const kind = Object.entries(FAILS).find(([key]) => key === letter)?.[1];
      this.add("solve.started", { solve, condition: id, comparison: session });
      this.add("solve.finished", {
        solve,
        ending: kind === undefined ? { outcome: "pass" } : { outcome: "fail", kind },
        billed: 2,
      });
      if (letter === "F") this.add("referee.finding", { solve, ruling: "earned" });
    }
    return this;
  }
}

const conditionOf = (task: string, harness: string): Condition => ({
  contract: "c1",
  harness,
  task,
  model: "faux/solver",
  effort: "medium",
  prices: { "faux/solver": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 } },
  runtime: {},
  compaction: "off",
  solverTools: harness,
  verifierTools: "t1",
  sandbox: "p1",
  limits: { wallSeconds: 600, turns: 12, shellDefaultSeconds: 30, shellMaxSeconds: 60, concurrency: 1 },
  host: "h",
  side: "test",
});

// The examples. Each is a scenario to run by name, or to copy into a scratch file and tune: change
// its constants, add a task, a promotion or a reader, and read the output again.

const pool: Scenario = ({ readers: { reports }, log, table }) => {
  const built = log();
  for (const task of Object.keys(POOL)) built.hold(task);
  built.feasible("none, author answered");
  const rounds = Math.max(...Object.values(POOL).map((readings) => readings.length));
  for (let index = 0; index < rounds; index += 1) {
    const tasks = Object.entries(POOL).flatMap(([task, readings]) => {
      const reading = readings[index];
      return reading === undefined ? [] : [[task, reading] as const];
    });
    built.compare(
      `b-${String(index + 1)}`,
      { old: "h1", fresh: `n-${String(index + 1)}` },
      Object.fromEntries(tasks),
    );
  }
  const read = reports.poolOf(built.events);
  const released = new Map(reports.releaseOrder(built.events, Object.keys(POOL), 3, "seed"));
  const has = (list: Iterable<string>, task: string) => ([...list].includes(task) ? "yes" : "-");
  table(
    ["task", "frontier", "easy", "awaiting", "practice", "released first", "history"],
    Object.keys(POOL).map((task) => [
      task,
      has(read.frontier, task),
      has(read.exhausted, task),
      has(read.awaiting, task),
      has(read.practiceFrontier, task),
      released.get(task)?.split(",")[0]?.replace(/^: /u, "") ?? "-",
      read.histories
        .get(task)
        ?.reads.map(({ valid, cut }) => (cut ? `${valid} (cut)` : valid))
        .join(", ") ?? "-",
    ]),
  );
};

/** What the Examiner is told after a promotion: the summary across the exam, the admissions under
 *  the new reference, and each task's line. */
const examiner: Scenario = ({ readers: { record }, log }) => {
  const built = log()
    .hold("a", { valid: 3, solves: 3 })
    .hold("b", { valid: 1, solves: 3 })
    .hold("c", { valid: 0, solves: 3 })
    .compare("b-1", { old: "h1", fresh: "h2" }, { a: "PP/PP", b: "FP/PP", c: "FF/PF" }, { reading: "step" })
    .promote("h2", "h1", "b-1")
    .hold("d", { valid: 1, solves: 3 })
    .refuse("e", 3)
    .compare("b-2", { old: "h2", fresh: "h3", starter: "h1" }, { a: "PP/PP", b: "PP/FP", d: "FF/FF" });
  const heard = record.heard(
    built.events,
    ["a", "b", "c", "d"].map((taskId) => ({ taskId, family: "f" })),
  );
  console.log(heard.measured ?? "(no summary)");
  for (const line of heard.lines) console.log(`  ${line}`);
};

const decision: Scenario = ({ readers, log }) => {
  const built = log().add("checker.read", { contract: "c", checks: "k", faults: [] });
  const tasks = Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`t${String(index)}`, "FP/PP"]));
  for (const task of Object.keys(tasks)) built.hold(task);
  built.release("p1").compare("b-1", { old: "h1", fresh: "h2" }, tasks);
  const decided = readers.decide.decide(built.events, PLAN);
  console.log(`${decided.code}: ${readers.move.decidedLine(decided)}`);
};

const EXAMPLES = { pool, examiner, decision };

async function main(args: CommandArgs): Promise<number> {
  const [named] = args.positionals;
  if (args.flag("list") || named === undefined) {
    console.log(`examples: ${Object.keys(EXAMPLES).join(", ")}`);
    return 0;
  }
  const tree = args.value("tree") ?? runtimeProcess.cwd();
  // SAFETY: each module is the tree's own copy of the one this file's types name; a tree whose
  // reader changed its signature fails in the scenario that calls it, which is the finding.
  const readers: Readers = {
    reports: (await import(join(tree, "src/kernel/reports.ts"))) as Readers["reports"],
    size: (await import(join(tree, "src/kernel/size.ts"))) as Readers["size"],
    condition: (await import(join(tree, "src/kernel/condition.ts"))) as Readers["condition"],
    record: (await import(join(tree, "src/examiner/record.ts"))) as Readers["record"],
    decide: (await import(join(tree, "src/campaign/decide.ts"))) as Readers["decide"],
    move: (await import(join(tree, "src/campaign/move.ts"))) as Readers["move"],
  };
  const scenario =
    Object.entries(EXAMPLES).find(([key]) => key === named)?.[1] ??
    // SAFETY: a scenario file's contract is a default export of a scenario; one that exports
    // something else fails when it is called, naming the file.
    ((await import(resolve(named))) as { readonly default?: Scenario }).default ??
    args.die(`${named} is no example and default-exports no scenario`);
  const { SIZE, RUNS } = readers.size;
  console.log(`tree ${tree}: SIZE ${JSON.stringify(SIZE)}, RUNS ${JSON.stringify(RUNS)}`);
  await scenario({
    tree,
    readers,
    log: () => new Log(readers.condition),
    table: (header, rows) => {
      for (const row of [header, ...rows]) console.log(row.join(" | "));
    },
  });
  return 0;
}

if (import.meta.main) {
  await runCommand({ name: "synthetic", usage: USAGE, options: OPTIONS, positionals: [0, 1] }, main);
}
