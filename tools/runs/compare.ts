/**
 * Recorded rounds read against one another: v1's model-condition-comparison, on v2's log. It starts
 * nothing. Each round is said as its log holds it: what it was given (contract, anchor set, source,
 * Builder, solver, parent harness), the harness its Builder kept, and how its solves ended under
 * each harness. Each two rounds are then said by what they were given differently.
 *
 *   bun run runs compare <name> [<name> ...]
 *
 * A name is matched as the pulse matches it, among rounds' logs only, and every Builder session of
 * a log is a round, named `<log>:<session>` where a log holds more than one. Two rounds whose
 * contract or anchor set differs are `not-comparable`: they did not solve the same tasks under the
 * same checks. Otherwise their fresh harnesses differ by everything the rounds were given
 * differently, their old harnesses by all of it but the Builder, which never touched them, and a
 * harness one round kept and the other started from by the solves' conditions alone. One variable
 * apart is comparable in it, none is a replica, more moved together. Each such pair of harnesses is
 * counted on the anchor, the one set both rounds solved: a task once, by which round passed it more
 * often, as the kernel's own anchor test counts it.
 *
 * A condition names the host's code by content and the log holds no commit. A round started with
 * `bun run runs launch` has its commit in the launch's receipt, and the reader says it from there;
 * for any other it says where the worktree stands now. A report holds the scored target a round
 * asked for since 2026-10-08, and the reader says when one does not.
 */
import { type Paired, pairsOf } from "#src/kernel/compare.ts";
import { type Condition, conditionsOf, fieldsApart } from "#src/kernel/condition.ts";
import type { EventKind, LogEvent } from "#src/kernel/log.ts";
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
  readonly parent: string;
  /** The harness the Builder session kept, empty while it has kept none. */
  readonly fresh: string;
  readonly anchor: readonly string[];
  /** Each anchor task's passes and fails under the old harness and the fresh. */
  readonly pairs: readonly Paired[];
  readonly said: readonly string[];
}

type Side = "old" | "fresh";

/** The sets a round solves, in its order, and the two a task's state names. */
const SETS = ["practice", "screened", "scored", "anchor"];
const SET_OF = new Map([
  ["released", "practice"],
  ["admitted", "scored"],
]);
const OUTCOMES = ["pass", "fail", "non-result", "unfinished"];
const ANCHOR_DRAWN = "anchor.drawn";
const TASK_STATE = "task.state";
const REPORTED = "comparison.reported";
/** What a round is given beside its solves' conditions. Its harness is none of them: a Builder
 *  makes it, so it differs wherever these do, and between two sessions that were given the same. */
const GIVEN: readonly (readonly [name: string, of: (round: Round) => string])[] = [
  ["Builder", (round) => round.builder],
  ["parent harness", (round) => round.parent],
  ["anchor set", (round) => round.anchor.join(" ")],
];
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
 * Every test-side solve the log holds, as the round of `session` counts it: its condition, the set
 * its task was in when the solve started, and how it ended. A task is the anchor's from its draw
 * on, practice once released and scored once admitted; any other is being screened. The anchor is
 * topped up before each round (`tools/d2/prepare.ts`), so a task a round screened and left held may
 * be drawn after it, and its screening solves are that round's screening still.
 *
 * A round screens the whole pool, the tasks earlier rounds admitted among them, and scores a task
 * from its own admission on (`src/builder/round.ts`). So an earlier round's admission leaves a task
 * this round goes on to place among the screened: read as scored, a simulated round's 21 solves
 * that screened seven such tasks were said with the 18 that scored its six (2026-10-08). A task
 * the round never places is scored on the earlier admission, as a round before that date did.
 */
function solvesOf(events: readonly LogEvent[], session: string) {
  const placed = new Set(
    events.flatMap(({ kind, data }) =>
      kind === TASK_STATE && data.session === session ? [word(data.version)] : [],
    ),
  );
  const conditions = conditionsOf(events);
  const endings = new Map(
    events.flatMap(({ kind, data }) => {
      const ending = asRecord(data.ending);
      const said = [ending?.outcome, ending?.kind].filter(isString).join(" ");
      return kind === "solve.finished" ? [[word(data.solve), said] as const] : [];
    }),
  );
  const sets = new Map<string, string>();
  const solves: { readonly under: Condition; readonly set: string; readonly ending: string }[] = [];
  for (const { kind, data } of events) {
    const under = conditions.get(word(data.condition));
    if (kind === ANCHOR_DRAWN) for (const task of strings(data.tasks)) sets.set(task, "anchor");
    if (kind === TASK_STATE) {
      const version = word(data.version);
      const others = data.session !== session && placed.has(version);
      sets.set(version, (others ? undefined : SET_OF.get(word(data.state))) ?? "screened");
    }
    if (kind === "solve.started" && under?.side === "test") {
      const ending = endings.get(word(data.solve)) ?? "unfinished";
      solves.push({ under, set: sets.get(under.task) ?? "screened", ending });
    }
  }
  return solves;
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
  // The log as the round counts it (`asReported` in src/builder/round.ts): of the solves, only
  // those from its session's start to its own report, or to the next session's start while it has
  // none. What follows a report in a round's window is an Examiner session's, and since the exam
  // follows the frontier its test-side solves run under the harness the round's step left: read to
  // the next session, a simulated round's 27 screening and 18 anchor solves under its fresh harness
  // were said as 60 and 24 (2026-10-08).
  const ends = [
    events.findIndex(({ kind }, index) => index > from && kind === "build.started"),
    events.findIndex(
      ({ kind, data }, index) => index > from && kind === REPORTED && data.session === session,
    ),
  ].filter((index) => index !== -1);
  const until = Math.min(events.length, ...ends);
  const own = events.filter(
    ({ kind }, index) => !kind.startsWith("solve.") || (index > from && index < until),
  );
  const mine = (kind: EventKind) =>
    events.findLast((event) => event.kind === kind && event.data.session === session)?.data;
  const [built, anchored, report] = [mine("build.finished"), mine("anchor.scored"), mine(REPORTED)];
  const parent = word(started.parent);
  const fresh = built?.changed === true && isString(built.harness) ? built.harness : "";
  // The anchor is the log's, every draw of it: two rounds of one campaign are then read on the
  // tasks both solved, and a task drawn after a round is one that round left unresolved.
  const anchor = events.flatMap(({ kind, data }) => (kind === ANCHOR_DRAWN ? strings(data.tasks) : []));
  const drawnThen = events
    .slice(0, until)
    .flatMap(({ kind, data }) => (kind === ANCHOR_DRAWN ? strings(data.tasks) : [])).length;

  const solves = solvesOf(own, session);
  const condition = solves.at(-1)?.under;
  if (condition === undefined) throw new Error(`${name} has started no solve yet: nothing to compare`);
  // Passes, fails by kind, non-results by kind and solves with no ending yet, each counted apart: a
  // non-result is no measurement, so no rate is taken here for one to fall into.
  const counted = SETS.flatMap((set) => {
    const here = solves.filter((solve) => solve.set === set);
    return [...new Set([parent, ...here.map(({ under }) => under.harness)])].flatMap((harness) => {
      const under = here.filter((solve) => solve.under.harness === harness);
      const counts = Object.entries(countBy(under, ({ ending }) => ending));
      const said = OUTCOMES.flatMap((outcome) => counts.filter(([ending]) => ending.startsWith(outcome)));
      const side = harness === parent ? "old" : harness === fresh ? "fresh" : brief(harness);
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
  const scored = strings(report?.versions).length;
  const target = isNumber(report?.target)
    ? `a target of ${String(report.target)}`
    : "a target its log does not hold";
  return {
    name,
    condition,
    builder,
    parent,
    fresh,
    anchor,
    pairs: pairsOf(own, anchor, parent, fresh).pairs,
    said: [
      `contract ${brief(condition.contract)} · source ${brief(condition.host)} · anchor of ${String(anchor.length)}${drawnThen < anchor.length ? `, ${String(drawnThen)} of them drawn when it ran` : ""}: ${anchor.map(brief).join(" ")}`,
      `Builder ${builder}${built === undefined ? ", still building" : `, ended at ${word(built.ended)}`}`,
      `solver ${condition.model}, ${condition.effort}, ${condition.compaction}`,
      `harness ${brief(parent)} > ${fresh === "" ? "none kept" : `${brief(fresh)}, ${writer}`}`,
      anchored === undefined
        ? "anchor not scored yet"
        : `anchor ${word(anchored.reading)}: ${word(anchored.wins)} won, ${word(anchored.losses)} lost, ${word(anchored.ties)} tied (informative ${word(anchored.informative)}, floor ${word(anchored.floor)}, solves a side ${word(anchored.solves)})`,
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
 * can rest on, the verdict and the anchor's tasks by which round passed each more often. A task one
 * round has no pass or fail on, or fewer than the other, is unresolved and in neither's favour.
 */
export function compared(a: Round, b: Round): string[] {
  const fields = fieldsApart(a.condition, b.condition).filter((field) => !MADE.has(field));
  const given = GIVEN.flatMap(([variable, of]) => (of(a) === of(b) ? [] : [variable]));
  const moved = [...new Set([...given, ...fields.map((field) => VARIABLE.get(field) ?? field)])];
  const head = `${a.name} against ${b.name}`;
  const refused = moved.filter((variable) => variable === "contract" || variable === "anchor set");
  if (refused.length > 0) {
    return [
      `${head}: not-comparable. They differ in the ${refused.join(" and the ")}, so they did not solve the same tasks under the same checks`,
    ];
  }
  const solving = moved.filter((variable) => variable !== "Builder");
  const kept = solving.filter((variable) => variable !== "parent harness");
  const cells: (readonly [Side, Side, readonly string[]])[] = [
    ["old", "old", solving],
    ["fresh", "fresh", moved],
    ...(a.fresh === b.parent ? [["fresh", "old", kept] as const] : []),
    ...(a.parent === b.fresh ? [["old", "fresh", kept] as const] : []),
  ];
  const harness = (round: Round, side: Side) => (side === "old" ? round.parent : round.fresh);
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
      const buckets = countBy(a.anchor, (task) => {
        const [here, there] = [passes(a, left, task), passes(b, right, task)];
        if (here.length === 0 || here.length !== there.length) return "unresolved";
        const ahead = there.filter(Boolean).length - here.filter(Boolean).length;
        if (ahead !== 0) return `${(ahead > 0 ? b : a).name} ahead`;
        return here.every(Boolean) ? "both pass" : here.some(Boolean) ? "level" : "both fail";
      });
      const counts = Object.entries(buckets).map(([bucket, n]) => `${bucket} ${String(n)}`);
      return [
        `  ${left} ${brief(ours)} against ${right} ${brief(theirs)}: ${verdict}`,
        `    anchor tasks: ${counts.sort().join(", ")}`,
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
