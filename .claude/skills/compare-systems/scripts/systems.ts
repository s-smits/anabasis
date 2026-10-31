/**
 * Two or more solving systems, each a solver inside a harness, read against each other on one
 * campaign's held-out tasks. A campaign cannot make this reading: its setting fixes the solver, and
 * every comparison it makes sets two harnesses under that one solver (`tools/d2/setting.ts`). The
 * operator asked for it on 27 October: does a built system with a cheap solver reach what a bare
 * system with a dear solver reaches, as `gpt-6.1-terra` at high inside the truss campaign's harness
 * against `claude-opus-5-5` at medium inside the starter? That is the point of building a harness. On the same day a reading of Terra in the starter against Terra in the built
 * harness answered a campaign's question instead, and the operator asked for one solve of every
 * held-out task a system, so a reading is one run per task and system unless `--solves` names more.
 * `--login N` puts the login `CLAUDE_CODE_OAUTH_TOKEN<N>` in the plain token's place for a Claude
 * solver, as `runs launch --login` does (`loginEnv`).
 *
 * Everything here is a production primitive, and this file only joins them. Each system opens a seed
 * of the campaign with its own solver and its own trial log (`openCampaign`, the path
 * `close.ts --solve` takes). It solves through the campaign's paid seat held at the host's load
 * (`solved`, `gated`), so a solve is a campaign's solve under that campaign's checks, limits and
 * wall. Its log is read back by the log's own folds (`ranUnder`, `verdictsOf`, `billedAll`). Two
 * systems are scored as a comparison scores its pairs (`scored`, `readsStep`, `detectable`,
 * `carriedBy`, `src/kernel/compare.ts`).
 *
 * Both of a comparison's judges rule every solve: the campaign's checks, and the Referee `--reviewer`
 * names on every rejection, which counts as a fail only once ruled earned and otherwise sets its task
 * aside for every system (`rejectionAside`), as a comparison's does. At two solves or more, an even
 * count, the baseline is read against itself on halves of its solves mirrored in time, the comparison's A/A,
 * so a reading has its own noise beside it. A table sets the systems side by side on averages a solve
 * (cost, wall time, slowest solve, model turns), since the operator asked on 28 October for time
 * beside cost: a built system that costs a fifteenth can still take twice as long. The trial logs hold hidden values, so they stay under
 * `.ana/compare/`, behind the wall and outside `.ana/d2/`, where `runs retire` sweeps idle seeds.
 */
import { type CommandArgs, runCommand } from "#skills/main/cli.ts";
import {
  carriedBy,
  detectable,
  draw,
  flipP,
  type Paired,
  pointsOf,
  readsStep,
  scored,
} from "#src/kernel/compare.ts";
import { contractHash } from "#src/kernel/contract.ts";
import { LOG_FILE, read } from "#src/kernel/log.ts";
import { ended, passed, ranUnder, rejectionAside, verdictsOf } from "#src/kernel/solves.ts";
import { taskSets } from "#src/kernel/task.ts";
import { billedAll } from "#src/kernel/trace.ts";
import { existsSync, mkdirSync } from "#src/meta/filesystem.ts";
import { isNumber } from "#src/meta/json-shape.ts";
import { keyIfDefined } from "#src/meta/optional-key.ts";
import { join } from "#src/meta/path.ts";
import { isSafePathSegment } from "#src/meta/path-segment.ts";
import { keptAs, openCampaign, packNamed } from "#tools/d2/campaign.ts";
import { gated } from "#tools/d2/host.ts";
import { objectiveNamed, reviewersNamed, solved } from "#tools/d2/round.ts";
import { recordedSetting, settingNamed } from "#tools/d2/setting.ts";
import { loginEnv } from "#tools/runs/manage.ts";
import { SEED_FILE } from "#tools/runs/registry.ts";

const USAGE = `compare-systems: solve a campaign's held-out tasks under two or more systems, and read them

  bun .claude/skills/compare-systems/scripts/systems.ts --seed <seed> \\
    --baseline <name>=<model>:<effort>@<harness> --candidate <name>=<model>:<effort>@<harness> \\
    [--candidate ...] [--root <dir> --sweep <id> --cycle <id> --bundle <dir>] [--tasks <all>] [--solves 1] [--level 0.02] [--login N] [--read | --cap <dollars> --reviewer <model>]

<seed> is a seed of a campaign that opened from a prompt (bun run runs seed), never the campaign
itself; a seed of a campaign over a stored pack names that pack by its four flags. <harness> is starter, promoted, or a whole digest or a letter the seed keeps; import a harness
from elsewhere into the seed first (tools/d2/import.ts).
Each candidate is read against the baseline, by default on every held-out task, one solve a task.
--login N solves on the login CLAUDE_CODE_OAUTH_TOKEN<N> instead of the plain one. Without --read it solves what each system is short
of, up to --cap dollars over every system, has the Referee --reviewer names rule every rejection
not yet ruled, then reads; run it again to go on. With --read it only reads.`;

interface System {
  readonly name: string;
  readonly model: string;
  readonly effort: string;
  readonly harness: string;
}

/** One system's counted solves of one task, a pass or a fail, in the order they started. */
interface Solved {
  readonly valid: boolean[];
  readonly measure: (number | null)[];
  readonly billed: (number | null)[];
  /** The solve's wall seconds and its model turns, as its ending records them. */
  readonly seconds: (number | null)[];
  readonly turns: (number | null)[];
  /** A rejection not ruled earned, which sets its task aside (`rejectionAside`). */
  readonly aside: boolean[];
}

function systemOf(flag: string, die: CommandArgs["die"]): System {
  // Each part is checked by its owner: the name is a folder, the model must be served and the effort
  // a level (`settingNamed`), and the harness kept and reopening under its digest (`keptAs`).
  const [name = "", system = "", ...more] = flag.split("=");
  const [solver = "", harness = "", ...after] = system.split("@");
  const [model = "", effort = "", ...extra] = solver.split(":");
  if (
    !isSafePathSegment(name) ||
    model === "" ||
    effort === "" ||
    harness === "" ||
    [...more, ...after, ...extra].length > 0
  ) {
    return die(`${flag}: name=model:effort@harness, as built-terra=openai-codex/gpt-6.1-terra:high@promoted`);
  }
  return { name, model, effort, harness };
}

/** Every task's counted solves in one system's log. A non-result is no measurement and is left out. */
function solvedIn(log: string): Map<string, Solved> {
  const events = existsSync(log) ? read(log) : [];
  const verdicts = verdictsOf(events);
  const out = new Map<string, Solved>();
  for (const solve of ended(ranUnder(events)).sort((a, b) => a.started - b.started)) {
    const valid = passed(solve);
    if (valid === null) continue;
    const task = out.get(solve.under.task) ?? {
      valid: [],
      measure: [],
      billed: [],
      seconds: [],
      turns: [],
      aside: [],
    };
    const checker = verdicts.get(solve.id)?.checker;
    task.valid.push(valid);
    task.measure.push(checker?.kind === "pass" ? (checker.objective ?? null) : null);
    task.billed.push(isNumber(solve.end.billed) ? solve.end.billed : null);
    task.seconds.push(isNumber(solve.end.seconds) ? solve.end.seconds : null);
    task.turns.push(isNumber(solve.end.turns) ? solve.end.turns : null);
    task.aside.push(rejectionAside(events, solve));
    out.set(solve.under.task, task);
  }
  return out;
}

const dollars = (value: number) => `$${value.toFixed(2)}`;
const mean = (values: readonly (number | null)[]) => {
  const counted = values.filter(isNumber);
  return counted.length === 0 ? null : counted.reduce((sum, one) => sum + one, 0) / counted.length;
};

/** The systems side by side, each on the average of its counted solves. The cost is the log's whole
 *  bill over those solves, the Referee's rulings included, so it runs a little over the solves' own;
 *  the time is a solve's wall, which a harness's own programs can fill (`improve-truss` searched to
 *  a deadline in all 12 solves of the truss reading of 28 October). */
function tableLines(rows: readonly { system: System; own: Map<string, Solved>; billed: number }[]): string[] {
  const minutes = (seconds: number | null) => (seconds === null ? "n/a" : `${(seconds / 60).toFixed(1)} min`);
  return [
    "| system | valid solves | average cost a solve | average time a solve | slowest solve | average model turns |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows.map(({ system, own, billed }) => {
      const solves = [...own.values()];
      const valid = solves.flatMap((row) => row.valid);
      const seconds = solves.flatMap((row) => row.seconds).filter(isNumber);
      const turns = mean(solves.flatMap((row) => row.turns));
      return `| ${system.name} | ${String(valid.filter(Boolean).length)} of ${String(valid.length)} | ${valid.length === 0 ? "n/a" : dollars(billed / valid.length)} | ${minutes(mean(seconds))} | ${minutes(seconds.length === 0 ? null : Math.max(...seconds))} | ${turns === null ? "n/a" : turns.toFixed(1)} |`;
    }),
  ];
}

/** What one system did on the tasks, on its own. */
function systemLines(system: System, digest: string, own: Map<string, Solved>): string[] {
  const rows = [...own.values()];
  const valid = rows.flatMap((row) => row.valid).filter(Boolean).length;
  const solves = rows.flatMap((row) => row.valid).length;
  const every = rows.filter((row) => row.valid.every(Boolean)).length;
  const none = rows.filter((row) => !row.valid.some(Boolean)).length;
  const aside = rows.flatMap((row) => row.aside).filter(Boolean).length;
  return [
    `${system.name}: ${system.model} at ${system.effort}, inside ${digest.slice(0, 8)}`,
    `  valid in ${String(valid)} of ${String(solves)} solves; of ${String(rows.length)} tasks, every solve valid on ${String(every)}, some on ${String(rows.length - every - none)}, none on ${String(none)}`,
    `  ${String(aside)} of its ${String(solves - valid)} fails are rejections the Referee did not rule earned, which set their tasks aside`,
  ];
}

/** A candidate read against the baseline over the tasks both solved `solves` times: the comparison's tally and
 *  its step rule, read both ways. */
export function pairLines(
  [baseline, old]: readonly [System, Map<string, Solved>],
  [candidate, fresh]: readonly [System, Map<string, Solved>],
  at: { readonly solves: number; readonly level: number; readonly direction: "lower" | "higher" | undefined },
): string[] {
  const cut = <T>(values: readonly T[]) => values.slice(0, at.solves);
  const solvedBoth = [...fresh.keys()].flatMap((task) => {
    const [a, b] = [old.get(task), fresh.get(task)];
    return a === undefined || b === undefined || a.valid.length < at.solves || b.valid.length < at.solves
      ? []
      : [{ task, a, b }];
  });
  const both = solvedBoth.filter(({ a, b }) => ![...cut(a.aside), ...cut(b.aside)].some(Boolean));
  const pairs = both.map(
    ({ task, a, b }): Paired => ({
      task,
      old: cut(a.valid),
      fresh: cut(b.valid),
      used: {
        old: cut(a.billed).map((billed) => ({ billed })),
        fresh: cut(b.billed).map((billed) => ({ billed })),
      },
      ...keyIfDefined(
        "objective",
        at.direction === undefined
          ? undefined
          : { direction: at.direction, old: cut(a.measure), fresh: cut(b.measure) },
      ),
    }),
  );
  const { wins, losses, ties, p, differences, unbilled } = scored(pairs);
  // Exchanging the sides negates every score, so the other way is the same scores negated.
  const other = { differences: differences.map((one) => -one), unbilled: unbilled.map((one) => -one) };
  const carried = pairs.map((pair) => carriedBy(pointsOf(pair)));
  const by = (measure: string) => carried.filter((one) => one === measure).length;
  const [x, y] = [candidate.name, baseline.name];
  const shift = detectable(differences, at.level);
  const reading = readsStep(unbilled, at.level)
    ? `${x} is better: a step at the level ${String(at.level)}, without the bill`
    : readsStep(other.unbilled, at.level)
      ? `${y} is better: a step at the level ${String(at.level)}, without the bill`
      : `no step either way at the level ${String(at.level)}. That is no proof they are equal: ${shift === null ? "too few tasks are untied for any difference to show" : `this size shows four times in five a side that wins ${String(Math.round(shift * 100))}% of the untied tasks`}`;
  return [
    `${x} against ${y}, on the ${String(pairs.length)} tasks both solved ${String(at.solves)} times:`,
    `  ${x} won ${String(wins)}, lost ${String(losses)}, tied ${String(ties)}; untied tasks carried by validity ${String(by("validity"))}, by the objective ${String(by("objective"))}, by the bill alone ${String(by("bill"))}`,
    `  p ${p.toFixed(3)} that ${x} is better, ${flipP(other.differences).toFixed(3)} that ${y} is; ${reading}`,
    `  ${String(solvedBoth.length - both.length)} more tasks both solved are set aside on a rejection the Referee did not rule earned`,
  ];
}

/** The baseline against itself on halves of its solves mirrored in time (at four, first and last
 *  against the two between; at two, first against second), the A/A every comparison of two solves a
 *  side carries: it should read no step. */
function itself(baseline: System, own: Map<string, Solved>, at: Parameters<typeof pairLines>[2]): string[] {
  if (at.solves < 2 || at.solves % 2 !== 0) return [];
  const half = (keep: boolean) =>
    new Map(
      [...own].map(([task, row]) => {
        const pick = <T>(values: readonly T[]) =>
          values.slice(0, at.solves).filter((_, index) => (index % 4 === 0 || index % 4 === 3) === keep);
        return [
          task,
          {
            valid: pick(row.valid),
            measure: pick(row.measure),
            billed: pick(row.billed),
            seconds: pick(row.seconds),
            turns: pick(row.turns),
            aside: pick(row.aside),
          },
        ];
      }),
    );
  const named = (which: string) => ({ ...baseline, name: `${baseline.name} (${which} half)` });
  return [
    ...pairLines([named("one"), half(true)], [named("other"), half(false)], { ...at, solves: at.solves / 2 }),
    "",
  ];
}

async function main(args: CommandArgs): Promise<number> {
  const seed = args.required("seed");
  const baseline = systemOf(args.required("baseline"), args.die);
  const systems = [baseline, ...args.list("candidate").map((flag) => systemOf(flag, args.die))];
  if (systems.length < 2 || new Set(systems.map(({ name }) => name)).size < systems.length) {
    return args.die("name a --baseline and at least one --candidate, each under its own name");
  }
  const [solves, count, level, cap] = [
    args.int("solves") ?? 1,
    args.int("tasks") ?? Number.POSITIVE_INFINITY,
    Number(args.value("level") ?? "0.02"),
    Number(args.value("cap") ?? Number.NaN),
  ];
  const reviewer = {
    reviewer: args.value("reviewer") ?? undefined,
    "reviewer-effort": args.value("reviewer-effort") ?? "high",
  };
  if (!args.flag("read") && (!(cap > 0) || reviewer.reviewer === undefined)) {
    return args.die(
      "name --cap, the dollars every system's solves may bill together, and --reviewer, the Referee",
    );
  }
  // A seed of a campaign over a stored pack names the pack as the campaign's commands do (`packNamed`).
  const flag = (name: string) => args.value(name) ?? undefined;
  const login = flag("login");
  if (login !== undefined) Object.assign(Bun.env, loginEnv(Bun.env, login));
  const stored = packNamed({
    name: seed,
    root: flag("root"),
    sweep: flag("sweep"),
    cycle: flag("cycle"),
    bundle: flag("bundle"),
  });
  const source = await openCampaign(stored);
  if (!existsSync(join(source.log, "..", SEED_FILE))) {
    return args.die(`${seed} is no seed: copy the campaign first with bun run runs seed`);
  }
  const events = read(source.log);
  const recorded = recordedSetting(events);
  if (recorded === null) return args.die(`${seed} records no setting yet: no comparison or session has run`);
  const { held } = taskSets(events);
  const tasks = draw(held, Math.min(count, held.length), contractHash(source.contract));
  const out = join(source.repo, ".ana", "compare", seed);
  const opened = await Promise.all(
    systems.map(async (system) => {
      // Each system runs under the campaign's limits, with its own solver in the campaign's place.
      const { solver, limits } = settingNamed({
        solver: system.model,
        "solver-effort": system.effort,
        "solve-minutes": String(recorded.minutes),
        "solve-model-turns": recorded.modelTurns === null ? "unlimited" : String(recorded.modelTurns),
      });
      mkdirSync(join(out, system.name), { recursive: true });
      const log = join(out, system.name, LOG_FILE);
      const campaign = await openCampaign({ ...stored, solver, limits, trial: log });
      const harness = await keptAs(campaign, system.name, system.harness);
      const seat = gated({ seated: solved, loaded: false }, log)(campaign, {
        builder: undefined,
        reference: harness.dir,
      });
      return { system, log, harness, seat, reviewers: reviewersNamed(campaign, reviewer) };
    }),
  );
  const billed = (log: string) => (existsSync(log) ? billedAll(read(log)) : 0);
  if (!args.flag("read")) {
    // Interleaved by solve, task and system, so every system meets the host's load alike. A run again
    // solves only what each system is still short of, read from its own log.
    const counted = opened.map(({ log }) => solvedIn(log));
    const jobs = Array.from({ length: solves }, (_, at) => at).flatMap((at) =>
      tasks.flatMap((task) =>
        opened.flatMap((system, index) =>
          (counted[index]?.get(task)?.valid.length ?? 0) <= at ? [{ system, task }] : [],
        ),
      ),
    );
    const spent = () => opened.reduce((total, { log }) => total + billed(log), 0);
    console.log(
      `${String(jobs.length)} solves to make, ${dollars(spent())} billed so far of ${dollars(cap)}`,
    );
    const packages = source.packages();
    const work = async () => {
      for (let job = jobs.shift(); job !== undefined && spent() < cap; job = jobs.shift()) {
        const pack = packages.get(job.task);
        if (pack === undefined) throw new Error(`task ${job.task} has no package in ${seed}`);
        // A non-result is no measurement, and is solved again once, as a comparison's slot is.
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const { ending } = await job.system.seat.solve(pack, job.system.harness, undefined, undefined);
          console.log(
            `${job.system.system.name} ${job.task.slice(0, 8)}: ${ending.outcome}${"kind" in ending ? ` (${ending.kind})` : ""}`,
          );
          if (ending.outcome !== "non-result") break;
        }
      }
    };
    await Promise.all(Array.from({ length: source.limits.concurrency }, work));
    // The Referee rules every rejection no finding answers yet, this run's and an earlier one's.
    const unruled = opened.flatMap(({ system, log, reviewers }) => {
      const own = existsSync(log) ? read(log) : [];
      const found = new Set(
        own.flatMap(({ kind, data }) => (kind === "referee.finding" ? [data.solve] : [])),
      );
      return ended(ranUnder(own)).flatMap((solve) =>
        solve.ending?.kind === "rejected" && !found.has(solve.id) ? [{ system, reviewers, solve }] : [],
      );
    });
    const rule = async () => {
      for (let one = unruled.shift(); one !== undefined; one = unruled.shift()) {
        const pack = packages.get(one.solve.under.task);
        if (pack === undefined || one.reviewers === null) continue;
        const { ruling } = await one.reviewers.referee(one.solve.id, pack, new AbortController().signal);
        console.log(`${one.system.name} ${one.solve.under.task.slice(0, 8)}: the Referee ruled ${ruling}`);
      }
    };
    await Promise.all(Array.from({ length: source.limits.concurrency }, rule));
  }
  const drawn = new Set(tasks);
  const solvedBy = opened.map(({ log }) => new Map([...solvedIn(log)].filter(([task]) => drawn.has(task))));
  const direction = objectiveNamed(source)?.direction;
  const lines = [
    `${String(tasks.length)} of the ${String(held.length)} held-out tasks of ${seed}, drawn by its contract's hash. Its Examiner admitted them under ${recorded.solver === null ? "the stored cycle's solver" : `${recorded.solver.model} at ${recorded.solver.effort}`} against its reference harnesses. Task selection therefore depended on that solver and those harnesses.`,
    `Every solve: ${String(recorded.minutes)} minutes and ${recorded.modelTurns === null ? "unlimited" : String(recorded.modelTurns)} model turns, the campaign's checks, and the Referee on every rejection.`,
    "",
    ...opened.flatMap(({ system, harness }, index) =>
      systemLines(system, harness.digest, solvedBy[index] ?? new Map<string, Solved>()),
    ),
    "",
    ...tableLines(
      opened.map(({ system, log }, index) => ({
        system,
        own: solvedBy[index] ?? new Map<string, Solved>(),
        billed: billed(log),
      })),
    ),
    "",
    ...itself(baseline, solvedBy[0] ?? new Map<string, Solved>(), { solves, level, direction }),
    ...opened.slice(1).flatMap(({ system }, index) =>
      pairLines([baseline, solvedBy[0] ?? new Map()], [system, solvedBy[index + 1] ?? new Map()], {
        solves,
        level,
        direction,
      }),
    ),
  ];
  console.log(lines.join("\n"));
  return 0;
}

if (import.meta.main) {
  await runCommand(
    {
      name: "compare-systems",
      usage: USAGE,
      options: {
        seed: "text",
        baseline: "text",
        candidate: "list",
        tasks: "int",
        solves: "int",
        cap: "text",
        level: "text",
        read: "flag",
        root: "text",
        sweep: "text",
        cycle: "text",
        bundle: "text",
        reviewer: "text",
        "reviewer-effort": "text",
        login: "text",
      },
    },
    main,
  );
}
