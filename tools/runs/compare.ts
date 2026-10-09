/**
 * Recorded rounds read against one another: v1's model-condition-comparison, on v2's log. It starts
 * nothing. Each round is said as its log holds it: what it was given (contract, scored set, source,
 * Builder, solver, the harness its session started from and the reference harness it was compared
 * with), the harness its Builder kept, and how its solves ended under each harness. Each two rounds
 * are then said by what they were given differently.
 *
 *   bun run runs compare <name> [<name> ...]
 *
 * A name is matched as the pulse matches it, among rounds' logs only, and every Builder session of
 * a log is a round, named `<log>:<session>` where a log holds more than one. Two rounds whose
 * contract differs are `not-comparable`: they did not solve under the same rules and checks.
 * Otherwise their fresh harnesses differ by everything the rounds were given differently but the
 * reference, their reference harnesses by the solves' conditions alone, since no Builder of the
 * round touched them, and so does a harness one round kept and the other was compared with. One
 * variable apart is comparable in it, none is a replica, more moved together. Each such pair of
 * harnesses is counted on the tasks both rounds scored: a task once, by which round's harness gave
 * a valid answer more often.
 *
 * To set two kept harnesses against each other with solves made side by side is another command:
 * `tools/d2/checkpoint.ts --reference <digest> --new <digest>`. Solves of two rounds were made
 * apart, under whatever each host's hour was, which is why the plan counts none of them twice
 * (`src/builder/round.ts`). Until 2026-10-09 this reader counted on the anchor, the one set every
 * round of a campaign solved; the scored set is drawn by the contract alone now.
 *
 * A condition names the host's code by content and the log holds no commit. A round started with
 * `bun run runs launch` has its commit in the launch's receipt, and the reader says it from there;
 * for any other it says where the worktree stands now.
 */
import type { Paired } from "#src/kernel/compare.ts";
import { type Condition, conditionsOf, fieldsApart } from "#src/kernel/condition.ts";
import type { EventKind, LogEvent } from "#src/kernel/log.ts";
import { lastReports, pairsReported } from "#src/kernel/reports.ts";
import { TOOLS_SPEC_FILE } from "#src/meta/bundle-layout.ts";
import { existsSync, readFileSync } from "#src/meta/filesystem.ts";
import { parseJsonAs } from "#src/meta/json-runtime.ts";
import { asRecord, isNumber, isString, type JsonValue } from "#src/meta/json-shape.ts";
import { basename, dirname, join } from "#src/meta/path.ts";
import { runTextSyncOrThrow } from "#src/meta/subprocess.ts";
import { countBy } from "#src/meta/tally.ts";
import { plural } from "#src/meta/text.ts";
import { receiptOf } from "./launch.ts";
import { logEvents, runs, standing, word } from "./pulse.ts";

/** One round as its log tells it: what it was given, what its Builder kept, and its lines. */
export interface Round {
  readonly name: string;
  /** One test-side solve's condition: the pattern of them all, but for the harness and the task. */
  readonly condition: Condition;
  readonly builder: string;
  /** The harness its session started from. */
  readonly parent: string;
  /** The harness its comparison was made against: the parent, in a report that names none. */
  readonly reference: string;
  /** The harness the Builder session kept, empty while it has kept none. */
  readonly fresh: string;
  /** The task versions its comparison solved: the ones it tallied, and the ones it left out as
   *  short of their solves or set aside. */
  readonly scored: readonly string[];
  /** Each of those tasks' valid answers and others under the reference harness and the fresh. */
  readonly pairs: readonly Paired[];
  readonly said: readonly string[];
}

type Side = "old" | "fresh";

/** The sets a round solves, in its order. */
const SETS = ["practice", "scored"];
const OUTCOMES = ["pass", "fail", "non-result", "unfinished"];
const REPORTED = "comparison.reported";
/** What a round is given beside its solves' conditions. Its harness is none of them: a Builder
 *  makes it, so it differs wherever these do, and between two sessions that were given the same. */
const GIVEN: readonly (readonly [name: string, of: (round: Round) => string])[] = [
  ["Builder", (round) => round.builder],
  ["parent harness", (round) => round.parent],
  ["reference harness", (round) => round.reference],
  ["scored set", (round) => round.scored.toSorted().join(" ")],
];
/** The variables that say which harness a round built and which it was compared with. */
const BUILT = new Set(["Builder", "parent harness", "reference harness"]);
/** The fields of a condition a round is not given: what its Builder made, and the solve's task. */
const MADE = new Set(["harness", "solverTools", "task"]);
/** The variable a condition's field moves with: a price table holds the solver's one row, and the
 *  backend sets the compaction. A field not named here is a variable of its own. */
const VARIABLE = new Map([
  ["model", "solver"],
  ["effort", "solver"],
  ["prices", "solver"],
  ["compaction", "solver"],
  ["host", "source"],
]);

const strings = (value: JsonValue | undefined) => (Array.isArray(value) ? value.filter(isString) : []);
const brief = (digest: string) => digest.slice(0, 8);

/**
 * Every test-side solve of a round, with its condition, the set its task is in and how it ended:
 * the practice solves its session made, and the solves of its scored tasks under one of the
 * harnesses its comparison read, made in the round's own window of the log.
 */
function solvesOf(
  events: readonly LogEvent[],
  given: {
    readonly practice: ReadonlySet<string>;
    readonly scored: ReadonlySet<string>;
    readonly harnesses: ReadonlySet<string>;
    /** The round's own window of the log, and where its report stands. */
    readonly from: number;
    readonly until: number;
  },
) {
  const conditions = conditionsOf(events);
  const endings = new Map(
    events.flatMap(({ kind, data }) => {
      const ending = asRecord(data.ending);
      const said = [ending?.outcome, ending?.kind].filter(isString).join(" ");
      return kind === "solve.finished" ? [[word(data.solve), said] as const] : [];
    }),
  );
  return events.flatMap(({ kind, data }, index) => {
    const under = conditions.get(word(data.condition));
    if (kind !== "solve.started" || under?.side !== "test" || index >= given.until) return [];
    const practised = given.practice.has(under.task) && index > given.from;
    const scored = given.scored.has(under.task) && given.harnesses.has(under.harness) && index > given.from;
    if (!practised && !scored) return [];
    const ending = endings.get(word(data.solve)) ?? "unfinished";
    return [{ under, set: practised ? "practice" : "scored", ending }];
  });
}

/**
 * The round of Builder session `session` in `events`, under `name`. `kinds` gives the tool kinds a
 * harness's spec declares, or null when the spec is not on disk: submit takes only an answer an
 * artifact-writer prepared, so a harness with none fails every solve at `no-answer` whatever its
 * solver.
 */
export function roundOf(
  name: string,
  events: readonly LogEvent[],
  session: string,
  kinds: (harness: string) => readonly string[] | null,
): Round {
  const from = events.findIndex(({ kind, data }) => kind === "build.started" && data.session === session);
  const started = events[from]?.data;
  if (started === undefined) throw new Error(`${name} holds no Builder session ${session}`);
  // The round's window of the log runs from its session's start to its own report, or to the next
  // session's start while it has none.
  const ends = [
    events.findIndex(({ kind }, index) => index > from && kind === "build.started"),
    events.findIndex(
      ({ kind, data }, index) => index > from && kind === REPORTED && data.session === session,
    ),
  ].filter((index) => index !== -1);
  const until = Math.min(events.length, ...ends);
  const mine = (kind: EventKind) =>
    events.findLast((event) => event.kind === kind && event.data.session === session)?.data;
  const [built, report] = [mine("build.finished"), mine(REPORTED)];
  const parent = word(started.parent);
  const fresh = built?.changed === true && isString(built.harness) ? built.harness : "";
  const found = lastReports(events).find((each) => each.session === session);
  const pairs = found === undefined ? [] : pairsReported(events, found);
  // The tasks the comparison tallied, and beside them the ones it solved and left out: short of
  // their solves, or set aside on a rejection.
  const tallied = strings(report?.versions);
  const scoredSet = [...tallied, ...strings(report?.short), ...strings(report?.aside)];
  const baseline = isString(report?.baseline) ? report.baseline : "";
  const reference = isString(report?.old) ? report.old : parent;

  const solves = solvesOf(events, {
    practice: new Set(strings(started.tasks)),
    scored: new Set(scoredSet),
    harnesses: new Set([reference, fresh, baseline]),
    from,
    until,
  });
  const condition = solves.at(-1)?.under;
  if (condition === undefined) throw new Error(`${name} has started no solve yet: nothing to compare`);
  // Passes, fails by kind, non-results by kind and solves with no ending yet, each counted apart: a
  // non-result is no measurement, so no rate is taken here for one to fall into.
  // The later name stands where two of the three are one harness.
  const sides = new Map([
    [baseline, "baseline"],
    [fresh, "fresh"],
    [reference, "reference"],
  ]);
  const counted = SETS.flatMap((set) => {
    const here = solves.filter((solve) => solve.set === set);
    return [...new Set([reference, ...here.map(({ under }) => under.harness)])].flatMap((harness) => {
      const under = here.filter((solve) => solve.under.harness === harness);
      const counts = Object.entries(countBy(under, ({ ending }) => ending));
      const said = OUTCOMES.flatMap((outcome) => counts.filter(([ending]) => ending.startsWith(outcome)));
      const side = sides.get(harness) ?? brief(harness);
      const census = said.map(([ending, n]) => `${String(n)} ${ending}`).join(", ");
      return under.length === 0 ? [] : [`${set} ${side}: ${census}`];
    });
  });

  const limits = asRecord(started.limits) ?? {};
  const builder = `${word(started.model)}, ${word(started.effort)} (wall ${word(limits.wallSeconds)}s, turns ${word(limits.turns)}, practice solves ${word(limits.practiceSolves)})`;
  const declared = kinds(fresh);
  const writer =
    declared === null
      ? "whose tool spec is not on disk"
      : declared.includes("artifact-writer")
        ? "which declares an artifact-writer"
        : "which declares no artifact-writer, so no solve under it can prepare an answer to submit";
  const score = asRecord(report?.scored);
  const against = asRecord(report?.against);
  const scored = tallied.length;
  const target = isNumber(report?.tasks)
    ? `${plural(report.tasks, "task")} asked for`
    : "a count of tasks its log does not hold";
  return {
    name,
    condition,
    builder,
    parent,
    reference,
    fresh,
    scored: scoredSet,
    pairs,
    said: [
      `contract ${brief(condition.contract)} · source ${brief(condition.host)} · scored set of ${String(scoredSet.length)}: ${scoredSet.map(brief).join(" ")}`,
      `Builder ${builder}${built === undefined ? ", still building" : `, ended at ${word(built.ended)}`}`,
      `solver ${condition.model}, ${condition.effort}, ${condition.compaction}`,
      `harness ${brief(parent)} > ${fresh === "" ? "none kept" : `${brief(fresh)}, ${writer}`}, compared with ${brief(reference)}`,
      against === null
        ? "not read against the baseline"
        : `against the baseline ${brief(baseline)}: ${word(against.wins)} won, ${word(against.losses)} lost, ${word(against.ties)} tied`,
      `${report === undefined ? "not reported yet" : `reported ${word(report.reading)}, for ${target}`}${
        score === null
          ? ""
          : `: scored ${word(score.wins)} won, ${word(score.losses)} lost, ${word(score.ties)} tied on ${
              scored === 0
                ? "no task, so the round could not step"
                : `${plural(scored, "task")}, p ${word(score.p)}`
            }`
      }`,
      ...counted,
    ],
  };
}

/**
 * What rounds `a` and `b` were given differently, and for each pair of their harnesses a reading
 * can rest on, the verdict and the tasks both scored by which round passed each more often. A task
 * one round has no pass or fail on, or fewer than the other, is unresolved and in neither's favour.
 */
export function compared(a: Round, b: Round): string[] {
  const fields = fieldsApart(a.condition, b.condition).filter((field) => !MADE.has(field));
  const given = GIVEN.flatMap(([variable, of]) => (of(a) === of(b) ? [] : [variable]));
  const moved = [...new Set([...given, ...fields.map((field) => VARIABLE.get(field) ?? field)])];
  const head = `${a.name} against ${b.name}`;
  const both = a.scored.filter((task) => b.scored.includes(task));
  if (moved.includes("contract") || both.length === 0) {
    return [
      `${head}: not-comparable. ${moved.includes("contract") ? "They differ in the contract, so they did not solve under the same rules and checks" : "They scored no task in common"}`,
    ];
  }
  // What one harness solved in two rounds differs by: the solves' conditions and the scored set.
  // Two reference harnesses differ by that and by which they are, and two harnesses the rounds
  // built by everything but what each was compared with.
  const kept = moved.filter((variable) => !BUILT.has(variable));
  const without = (...variables: string[]) => moved.filter((variable) => !variables.includes(variable));
  const cells: (readonly [Side, Side, readonly string[]])[] = [
    ["old", "old", without("Builder", "parent harness")],
    ["fresh", "fresh", without("reference harness")],
    ...(a.fresh === b.reference ? [["fresh", "old", kept] as const] : []),
    ...(a.reference === b.fresh ? [["old", "fresh", kept] as const] : []),
  ];
  const harness = (round: Round, side: Side) => (side === "old" ? round.reference : round.fresh);
  const passes = (round: Round, side: Side, task: string) =>
    round.pairs.find((pair) => pair.task === task)?.[side] ?? [];
  return [
    `${head}, given differently: ${moved.join(", ") || "nothing"}`,
    ...cells.flatMap(([left, right, apart]) => {
      const [ours, theirs] = [harness(a, left), harness(b, right)];
      if (ours === "" || theirs === "") return [];
      const noise = `solve noise${ours === theirs ? "" : " and what each Builder session made"}`;
      const verdict =
        apart.length === 0
          ? `replicas, which differ by ${noise}`
          : apart.length === 1
            ? `comparable in ${apart.join("")}, beside ${noise}`
            : `not comparable in one variable: ${apart.join(", ")} moved together`;
      const buckets = countBy(both, (task) => {
        const [here, there] = [passes(a, left, task), passes(b, right, task)];
        if (here.length === 0 || here.length !== there.length) return "unresolved";
        const ahead = there.filter(Boolean).length - here.filter(Boolean).length;
        if (ahead !== 0) return `${(ahead > 0 ? b : a).name} ahead`;
        return here.every(Boolean) ? "both pass" : here.some(Boolean) ? "level" : "both fail";
      });
      const counts = Object.entries(buckets).map(([bucket, n]) => `${bucket} ${String(n)}`);
      return [
        `  ${left === "old" ? "reference" : left} ${brief(ours)} against ${right === "old" ? "reference" : right} ${brief(theirs)}: ${verdict}`,
        `    tasks both scored: ${counts.sort().join(", ")}`,
      ];
    }),
  ];
}

/** `bun run runs compare`. */
export function compareRuns(names: readonly string[]): void {
  const logs = runs().filter((run) => run.end === REPORTED);
  const chosen = [...new Set(names.flatMap((name) => logs.filter((run) => run.name.includes(name))))];
  const rounds = chosen.flatMap((run) => {
    const events = logEvents(run.path);
    const sessions = events.flatMap(({ kind, data }, at) =>
      kind === "build.started" ? [{ session: word(data.session), at }] : [],
    );
    return sessions.flatMap(({ session, at }, index) => {
      const name = sessions.length === 1 ? run.name : `${run.name}:${session}`;
      // A session stopped before its first solve has nothing to read, and stops no other's reading.
      if (!events.slice(at, sessions[index + 1]?.at).some(({ kind }) => kind === "solve.started")) {
        console.log(`${name}  left out: session ${session} has started no solve`);
        return [];
      }
      const receipt = receiptOf(run.path, session);
      const { commit, dirty } = receipt ?? standing(run.tree);
      const from = receipt === null ? "where its worktree stands now" : "by its launch receipt";
      const read = roundOf(name, events, session, (harness) => {
        const spec = join(dirname(run.path), "states", harness, TOOLS_SPEC_FILE);
        if (!existsSync(spec)) return null;
        const tools = parseJsonAs<{ tools?: { kind?: string }[] }>(readFileSync(spec, "utf8")).tools ?? [];
        return tools.flatMap(({ kind }) => (isString(kind) ? [kind] : []));
      });
      console.log(
        `${name}  session ${session}, ${basename(run.tree)} at ${commit.slice(0, 9)}${dirty ? " with uncommitted changes" : ""}, ${from}`,
      );
      for (const line of read.said) console.log(`  ${line}`);
      return [{ read, commit }];
    });
  });
  if (rounds.length < 2) throw new Error("usage: bun run runs compare <name> [...], of two rounds or more");
  for (const [index, a] of rounds.entries()) {
    for (const b of rounds.slice(index + 1)) {
      console.log(["", ...compared(a.read, b.read)].join("\n"));
      if (a.read.condition.host !== b.read.condition.host) {
        const apart = runTextSyncOrThrow(["git", "rev-list", "--count", `${a.commit}...${b.commit}`]).trim();
        console.log(
          `  source: ${a.commit.slice(0, 9)} and ${b.commit.slice(0, 9)} are ${apart} commits apart`,
        );
      }
    }
  }
}
