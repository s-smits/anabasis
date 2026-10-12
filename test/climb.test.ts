// The climb, simulated: a campaign run by its log over the fixture pack with a script in each
// model seat, where a task's difficulty is its base and a harness's strength is a number its guide
// carries. A solve passes where the base is at most the strength, and gives no answer otherwise;
// each Builder session raises the strength by two; each Examiner session asked for room reads the
// reference harness's strength from its kept state and writes tasks on either side of it, as an
// Examiner that hears which tasks were answered would. What this proves is the controller's part
// of the climb and nothing of a model: that a campaign promotes a harness, has harder tasks
// written, promotes a harder one on them, and ends on its budget of moves and not before. Run by
// name, since its solves run under the real wall and take minutes:
//
//   ANA_CLIMB=1 bun run test -- test/climb.test.ts
//
// The operator's question of 10 October: does the system climb, epoch after epoch, where an
// epoch ends with a promotion and the next one's tasks are harder?

import { afterAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { examine } from "../src/examiner/session.ts";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { asRecord, isNumber, isString, type JsonObject } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join, resolve } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { ANSWER_FILE } from "../src/solve/answer.ts";
import { GUIDE_FILE } from "../src/meta/bundle-layout.ts";
import { harnessBuilder, type Seats } from "../tools/d2/harness-builder.ts";
import {
  belowBar,
  type Epoch,
  epochLine,
  epochsOf,
  promotionsWorth,
  regressionLine,
  regressionOf,
  worthLine,
  worthOf,
} from "../src/builder/climb.ts";
import type { Paired } from "../src/kernel/compare.ts";
import { type Condition, conditionId, settingId } from "../src/kernel/condition.ts";
import { type EventKind, type LogEvent, read } from "../src/kernel/log.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { requireJsonValue } from "../src/meta/stable-json.ts";
import { fixtureTasks, layOutPack, scriptedModel } from "./helpers/fixture-pack.ts";

const REPO = resolve(import.meta.dir, "..");
const FIXTURE = join(REPO, "test", "fixtures", "harness-min");
const NAME = `test-climb-${String(runtimeProcess.pid)}`;
const TASKS = fixtureTasks(7);
/** The starter's strength: it answers a base of three and under. */
const STARTER_STRENGTH = 3;
/** What one Builder session adds. */
const RAISE = 2;
/** Tasks an Examiner asked for writes, by how far above the reference's strength each is: one
 *  past it, which the reference answers on some of its solves and not all, so that a task is
 *  informative for it as room asks (`informative`, `roomOf`) and as `try_task` admits a draft;
 *  and harder ones, some past any harness so far. */
const ABOVE = [1, 1, 2, 2, 3, 4];
/** How many times each harness has solved each task, by task and harness folder: a harness
 *  answers a task one past its strength on every other solve. */
const tried = new Map<string, number>();
const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-climb-")));
const bundle = join(root, "bundle");
const folder = join(REPO, ".ana", "d2", NAME);

// The regression reading, over a log written here as `test/reports.test.ts` writes one: three
// harnesses, two candidates read in turn against one reference.
const AT = "2026-10-10T00:00:00.000Z";
const event = (kind: EventKind, data: JsonObject): LogEvent => ({ at: AT, kind, data });
const condition = (task: string, harness: string, host = "h"): Condition => ({
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
  limits: {
    wallSeconds: 600,
    turns: 12,
    shellDefaultSeconds: 30,
    shellMaxSeconds: 60,
    concurrency: 1,
    diskBytes: 1024,
  },
  host,
  side: "test",
});
const SETTING = settingId(condition("any", "any"));
let solves = 0;
function solved(
  comparison: string,
  task: string,
  harness: string,
  valid: readonly boolean[],
  under: { host?: string; measures?: readonly number[] } = {},
) {
  const { host = "h", measures = [] } = under;
  const ran = condition(task, harness, host);
  const id = conditionId(ran);
  return [
    event("condition.recorded", { id, condition: requireJsonValue(ran) }),
    ...valid.flatMap((each, nth) => {
      solves += 1;
      const solve = `s-${String(solves)}`;
      const measure = measures[nth];
      return [
        event("solve.started", { solve, condition: id, ...keyIfDefined("comparison", comparison) }),
        ...(each && measure !== undefined
          ? [event("verdict", { solve, task, answer: {}, kind: "pass", objective: measure })]
          : []),
        event("solve.finished", {
          solve,
          ending: each ? { outcome: "pass" } : { outcome: "fail", kind: "rejected" },
          billed: 1,
        }),
      ];
    }),
  ];
}
const heldOut = (version: string) => [
  event("task.proposed", { version, taskId: version }),
  event("task.gate", { version, gate: 1, outcome: "passed" }),
];
const reported = (session: string, old: string, fresh: string, versions: string[], objective?: JsonObject) =>
  event("comparison.reported", {
    session,
    reading: "no-step",
    old,
    fresh,
    solves: 2,
    setting: SETTING,
    versions,
    ...keyIfDefined("objective", objective),
  });

setDefaultTimeout(1_800_000);

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
  // `ANA_CLIMB_KEEP=1` keeps the campaign's folder for reading, under `.ana/d2/`.
  if (runtimeProcess.env.ANA_CLIMB_KEEP === undefined) rmSync(folder, { recursive: true, force: true });
});

/** The strength a harness's guide carries, its last line of the kind, or the starter's where it
 *  carries none: each session appends one, so the last is the session's. */
function strengthOf(dir: string): number {
  const guide = join(dir, "agent", GUIDE_FILE);
  const found = existsSync(guide)
    ? [...readFileSync(guide, "utf8").matchAll(/strength: (\d+)/g)].at(-1)
    : undefined;
  return found === undefined ? STARTER_STRENGTH : Number(found[1]);
}

/** What a campaign's log holds of one kind, in order. */
const of = (kind: string): JsonObject[] =>
  read(join(folder, "log.jsonl")).flatMap((each: LogEvent) => (each.kind === kind ? [each.data] : []));

describe("the climb", () => {
  it.skipIf(runtimeProcess.env.ANA_CLIMB === undefined)(
    "promotes a harness, has harder tasks written, and promotes a harder one on them, epoch after epoch",
    async () => {
      layOutPack(root, bundle, TASKS, FIXTURE);
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, "seed.json"), `${JSON.stringify({ from: null, events: 0 })}\n`);
      const flags = [
        "--root",
        root,
        "--sweep",
        "s",
        "--cycle",
        "c01",
        "--bundle",
        bundle,
        "--name",
        NAME,
        "--admit",
        "check-product",
        "--practice",
        "2",
        "--solves",
        "2",
        "--sessions",
        "1",
        // The target the simulated climb stalled at on 10 October (climb-9): drawn by hash from
        // the tasks of every epoch at once, 8 over the 19 tasks the third epoch held took two or
        // three the reference fails and left the comparison one win short three times. The draw
        // now takes the newest epoch's tasks first (`scoredSet`), and this run is the proof that
        // the third epoch reads its step at the target a real campaign runs near.
        "--target",
        "8",
        "--exam-tasks",
        "6",
        "--patience",
        "3",
      ];
      let written = 0;
      const seats: Seats = {
        seated: (campaign) => ({
          // A Builder session raises the strength of the harness it starts from by two, and
          // finishes. The seat is made for every command, a comparison's too, so the strength is
          // read from the log: the sessions that began before this one.
          builder: (() => {
            const before = read(campaign.log).filter(({ kind }) => kind === "build.started").length;
            const strength = STARTER_STRENGTH + (before + 1) * RAISE;
            return scriptedModel([
              [
                "bash",
                {
                  command: `printf '\\nstrength: ${String(strength)}\\n' >> "$HOME/harness/agent/${GUIDE_FILE}"`,
                },
              ],
              ["finish", { note: `Strength ${String(strength)}.` }],
            ]);
          })(),
          setting: campaign.setting({ ...campaign.test, ...scriptedModel([]) }),
          // A solve passes where the task's base is at most the harness's strength, and one past it
          // on every other solve: since 12 October a task the reference fails in every solve, or
          // answers in every solve, leaves it no room, and the climb simulated on 10 October wrote
          // only such tasks.
          solve: async (task, harness, kill, comparison) => {
            const base = asRecord(task.publicInput)?.base;
            const key = `${JSON.stringify(task.publicInput)} ${harness.dir}`;
            const nth = tried.get(key) ?? 0;
            tried.set(key, nth + 1);
            const strength = strengthOf(harness.dir);
            const passes = isNumber(base) && (base <= strength || (base === strength + 1 && nth % 2 === 0));
            const answer = JSON.stringify({ answer: String(Number(base) * 6) });
            const by = scriptedModel(
              [
                ...(passes ? [["bash", { command: `printf %s '${answer}' > ${ANSWER_FILE}` }] as const] : []),
                ["submit", {}],
              ],
              campaign.limits.turns + 1,
            );
            return campaign.solveOnce(task, harness, { ...campaign.test, ...by }, kill, comparison);
          },
        }),
        // An Examiner writes tasks harder than the reference harness answers: each a fresh
        // instance (`n`, which no check reads, makes it one), at a base above the reference's
        // strength. It knows the reference from the log, as the outcomes it hears tell a real one
        // which tasks were answered; it knows nothing of the harness the Builder is making.
        examine: (request) => {
          const promoted = of("harness.promoted").at(-1)?.harness;
          const reference = isString(promoted) ? join(folder, "states", promoted) : FIXTURE;
          const strength = strengthOf(reference);
          written += 1;
          const tasks = ABOVE.map((above, index) => ({
            family: "fixture",
            public_input: { base: strength + above, n: written * 100 + index },
            hidden: null,
          }));
          return examine({
            ...request,
            ...scriptedModel([
              ["propose_tasks", { tasks }],
              ["finish", { note: `Bases ${ABOVE.map((above) => strength + above).join(", ")}.` }],
            ]),
          });
        },
      };
      // Three epochs take 21 moves with every task scored (climb-10, 10 October: four promotions
      // in 36 moves and still climbing). A campaign that ends on its moves has not stopped.
      const ending = await harnessBuilder([...flags, "--moves", "24"], seats);
      const moves = of("campaign.move").map(({ move }) => (isString(move) ? move : "?"));
      const promotions = of("harness.promoted");
      const log = read(join(folder, "log.jsonl"));
      const epochs = epochsOf(log);
      console.log(moves.join(" "));
      for (const epoch of epochs) console.log(epochLine(epoch));
      // Each comparison by the bases it scored, for reading where a climb stalls.
      const baseOf = new Map(
        log.flatMap(({ kind, data }) => {
          const base = asRecord(asRecord(data.task)?.publicInput)?.base;
          return kind === "task.proposed" && isString(data.version) && isNumber(base)
            ? [[data.version, base] as const]
            : [];
        }),
      );
      const said = (value: unknown) => (isString(value) ? value.slice(0, 8) : "?");
      for (const { kind, data } of log) {
        if (kind === "comparison.started" && Array.isArray(data.tasks)) {
          const scored = data.tasks.map((version) =>
            isString(version) ? (baseOf.get(version) ?? "?") : "?",
          );
          console.log(
            `${said(data.session)}: ${said(data.old)} vs ${said(data.fresh)} on bases ${scored.join(",")}`,
          );
        }
        if (kind === "comparison.reported") {
          console.log(
            `  ${said(data.session)} ${said(data.reading)} ${JSON.stringify(data.scored)} valid ${JSON.stringify(data.valid)}`,
          );
        }
      }
      // The highest base held out in an epoch: what the test knows of difficulty.
      const hardest = (epoch: Epoch) =>
        Math.max(0, ...epoch.tasks.map((version) => baseOf.get(version) ?? 0));
      // Two promotions at least, each on tasks harder than the last epoch's: the second epoch's
      // tasks reach higher bases, the starter answers fewer of them, and the promoted harness of
      // each epoch is stronger than the one before.
      expect(promotions.length).toBeGreaterThanOrEqual(2);
      expect(epochs.length).toBeGreaterThanOrEqual(3);
      // An epoch may hold out no task: since 12 October the first holds a repeat's draw as well, and
      // where its tasks leave the promoted harness room, the next is promoted on them.
      const [first, second] = epochs.filter((epoch) => epoch.tasks.length > 0);
      if (first === undefined || second === undefined) throw new Error("fewer than two epochs wrote tasks");
      expect(hardest(second)).toBeGreaterThan(hardest(first));
      const strengths = promotions.map(({ harness }) =>
        strengthOf(join(folder, "states", isString(harness) ? harness : "")),
      );
      expect(strengths).toEqual([...strengths].sort((one, other) => one - other));
      expect(strengths[1] ?? 0).toBeGreaterThan(strengths[0] ?? 0);
      expect(ending.move === "end" ? ending.ending : "moves").not.toBe("stop");
    },
  );
});

describe("an epoch's shares", () => {
  it("count a comparison's solves of the epoch's tasks, and none an Examiner session had made to try one", () => {
    // Task v1 held out after the reference answered one of three solves of it under try_task.
    const log = [
      event("exam.started", { session: "x-1" }),
      ...solved("x-1", "v1", "h0", [true, false, false]),
      ...heldOut("v1"),
      event("comparison.started", { session: "g-1", starter: "h0" }),
      ...solved("g-1", "v1", "h0", [true, true]),
      reported("g-1", "h0", "h1", ["v1"]),
    ];
    expect(epochsOf(log)).toMatchObject([{ tasks: ["v1"], reference_share: { valid: 2, solves: 2 } }]);
  });
});

describe("the regression reading beside a comparison", () => {
  it("reads the newest candidate against the one before it on the tasks both comparisons scored, and nothing where the conditions differ in more than the harness", () => {
    // g-1 read h2 against the reference h1 on v1..v3; g-2 read h3 against h1 on v2..v4. On v2 h3
    // loses to h2 (0 of 2 valid against 2 of 2), on v3 it ties, and v4 was not scored by g-1. v1
    // is scored by both, but g-2's solves of it ran under another setting (another host), so the
    // comparison itself left them out and the reading shares two tasks.
    const log: LogEvent[] = [
      ...["v1", "v2", "v3", "v4"].flatMap(heldOut),
      ...solved("g-1", "v1", "h1", [false, false]),
      ...solved("g-1", "v1", "h2", [true, true]),
      ...solved("g-1", "v2", "h1", [false, false]),
      ...solved("g-1", "v2", "h2", [true, true]),
      ...solved("g-1", "v3", "h1", [false, false]),
      ...solved("g-1", "v3", "h2", [true, false]),
      reported("g-1", "h1", "h2", ["v1", "v2", "v3"]),
      ...solved("g-2", "v1", "h1", [false, false], { host: "h2-host" }),
      ...solved("g-2", "v1", "h3", [true, true], { host: "h2-host" }),
      ...solved("g-2", "v2", "h1", [false, false]),
      ...solved("g-2", "v2", "h3", [false, false]),
      ...solved("g-2", "v3", "h1", [false, false]),
      ...solved("g-2", "v3", "h3", [true, false]),
      ...solved("g-2", "v4", "h1", [false, false]),
      ...solved("g-2", "v4", "h3", [true, true]),
      reported("g-2", "h1", "h3", ["v1", "v2", "v3", "v4"]),
    ];
    const found = regressionOf(log);
    expect(found).toMatchObject({
      newest: "h3",
      previous: "h2",
      against: "h1",
      comparisons: ["g-2", "g-1"],
      shared: 2,
      wins: 0,
      losses: 1,
      ties: 1,
    });
    if (found === null) throw new Error("no reading");
    expect(regressionLine(found)).toContain("1 lost, 1 tied. A reading beside the test");
    // One comparison, or two of the same candidate, reads nothing.
    expect(
      regressionOf(
        log.slice(
          0,
          log.indexOf(
            log.find(({ kind, data }) => kind === "comparison.reported" && data.session === "g-2")!,
          ) + 0,
        ),
      ),
    ).toBeNull();
    expect(regressionOf([...log, reported("g-3", "h1", "h3", ["v4"])])).toMatchObject({
      newest: "h3",
      previous: "h2",
    });
  });

  it("reads two valid answers by the objective where both comparisons fixed the same rule, and on validity alone otherwise", () => {
    const lower = { direction: "lower", margin: 0.01 };
    // Both candidates answer v1 in both solves; h3's answers are lighter. g-1 and g-2 fixed the
    // same rule, so the reading sets them apart; g-3 fixed another margin, and reads a tie.
    const log: LogEvent[] = [
      ...heldOut("v1"),
      ...solved("g-1", "v1", "h1", [false, false]),
      ...solved("g-1", "v1", "h2", [true, true], { measures: [10, 10] }),
      reported("g-1", "h1", "h2", ["v1"], { ...lower, decided: 0 }),
      ...solved("g-2", "v1", "h1", [false, false]),
      ...solved("g-2", "v1", "h3", [true, true], { measures: [8, 8] }),
      reported("g-2", "h1", "h3", ["v1"], { ...lower, decided: 0 }),
    ];
    expect(regressionOf(log)).toMatchObject({
      newest: "h3",
      previous: "h2",
      shared: 1,
      wins: 1,
      losses: 0,
      ties: 0,
    });
    const other = [
      ...log,
      ...solved("g-3", "v1", "h1", [false, false]),
      ...solved("g-3", "v1", "h4", [true, true], { measures: [6, 6] }),
      reported("g-3", "h1", "h4", ["v1"], { ...lower, margin: 0.5, decided: 0 }),
    ];
    expect(regressionOf(other)).toMatchObject({
      newest: "h4",
      previous: "h3",
      shared: 1,
      wins: 0,
      losses: 0,
      ties: 1,
    });
  });
});

describe("the chance of a false promotion among an epoch's attempts", () => {
  /** A candidate's comparison against `old` that tallied one task, with the reference read
   *  against itself beside it where `noise` holds its differences. */
  const attempt = (session: string, old: string, fresh: string, noise?: number[]) =>
    event("comparison.reported", {
      session,
      reading: "no-step",
      old,
      fresh,
      solves: 2,
      level: 0.1,
      setting: SETTING,
      versions: ["v1"],
      frontier: { differences: [0] },
      retained: "unmeasured",
      families: {},
      noise: noise === undefined ? null : { differences: noise },
    });
  const started = event("comparison.started", { session: "g-1", old: "S", fresh: "h2", starter: "S" });

  it("sums the attempts' bounds, one a candidate and unsuccessful ones included, at the rule's own rate by design before two controls", () => {
    // `h2`'s step and its repeat are one attempt; `h3`'s report carries the rule's own rate.
    const rated = event("comparison.reported", {
      ...attempt("g-3", "S", "h3").data,
      frontier: { differences: [0], falseRate: 0.05 },
    });
    const log = [started, attempt("g-1", "S", "h2"), attempt("g-2", "S", "h2"), rated];
    const [epoch] = epochsOf(log);
    // Before two A/A controls are on record no attempt's rate is measured: the rule bounds one
    // attempt at its own rate, the level where its report holds none, and the bound is indicative.
    expect(epoch?.falsePromotion).toMatchObject({
      attempts: 2,
      errors: 0,
      pairs: 0,
      confidence: 0.95,
      bound: 0.1,
      indicative: true,
    });
    expect(epoch?.falsePromotion.union).toBeCloseTo(0.15, 12);
    if (epoch === undefined) throw new Error("an epoch");
    expect(epochLine(epoch)).toContain(
      "2 promotion attempts under this reference, a false promotion among them at most 15%: 10% an attempt by design, before two A/A controls, indicative",
    );
  });

  it("reads one attempt's rate off pairs of A/A controls by the rule itself, with its errors, its denominator and a one-sided bound", () => {
    // Four controls tie every task: two pairs read by the promotion rule, no error, and a bound of
    // 1 - 0.05^(1/2) an attempt, never a rate of none.
    const ties = [0, 0, 0];
    const log = [
      started,
      ...["g-1", "g-2", "g-3", "g-4"].map((id) => attempt(id, "S", "h2", ties)),
      event("harness.promoted", { harness: "h2" }),
      attempt("g-5", "h2", "h4"),
    ];
    const [first, second] = epochsOf(log);
    // The four are one candidate's, and one attempt (the Oracle's answer, 12 October).
    expect(first?.falsePromotion).toMatchObject({ attempts: 1, errors: 0, pairs: 2, indicative: false });
    expect(first?.falsePromotion.bound).toBeCloseTo(1 - 0.05 ** 0.5, 9);
    expect(first?.falsePromotion.union).toBeCloseTo(1 - 0.05 ** 0.5, 9);
    // Under the next reference the controls read other tasks: the same bound, labelled indicative.
    expect(second?.falsePromotion).toMatchObject({ attempts: 1, errors: 0, pairs: 2, indicative: true });
    if (second === undefined) throw new Error("an epoch");
    expect(epochLine(second)).toContain(
      "0 of 2 pairs of A/A controls promoted, at most 78% an attempt at 95%, indicative",
    );
    // Two controls that each read 2-0 promote as a step and its repeat: one error in one pair.
    const lucky = [started, attempt("g-1", "S", "h2", [1, 1]), attempt("g-2", "S", "h2", [1, 1])];
    expect(epochsOf(lucky)[0]?.falsePromotion).toMatchObject({ errors: 1, pairs: 1, bound: 1, union: 1 });
  });
});

describe("the bars a promotion is read against", () => {
  /** A candidate's comparison against `old` that read a frontier, with the effect its report logged. */
  const stepRead = (session: string, old: string, fresh: string, effect: JsonObject) =>
    event("comparison.reported", {
      session,
      reading: "step",
      old,
      fresh,
      solves: 2,
      level: 0.1,
      setting: SETTING,
      versions: ["v1"],
      frontier: { differences: [2], falseRate: 0.01 },
      valid: { old: [2, 0, 0], fresh: [0, 1, 1] },
      worth: { effect },
    });
  const later = Array.from({ length: 8 }, (_, at) => `w${String(at + 1)}`);
  // The operator set the effect bar at half the valid share; the other two are the plan's.
  const log = [
    event("campaign.opened", { terms: { effect: "0.5" } }),
    event("comparison.started", { session: "g-1", old: "S", fresh: "ha", starter: "S" }),
    ...heldOut("v1"),
    event("build.finished", { session: "b-1", changed: true }),
    // `ha` answers three of four over the starter's none: 75 points.
    stepRead("g-1", "S", "ha", { gain: 0.75, objective: null, met: true }),
    event("harness.promoted", { harness: "ha", from: "S" }),
    // Eight tasks written after its freeze, on which it answers a quarter: it fell 50 points.
    ...later.flatMap((version) => [
      ...heldOut(version),
      ...solved("g-2", version, "ha", Array<boolean>(2).fill(version === "w1" || version === "w2")),
    ]),
    stepRead("g-2", "ha", "hb", { gain: 0.25, objective: null, met: false }),
    event("harness.promoted", { harness: "hb", from: "ha" }),
  ];

  it("reads each promotion's effect, transfer and cost, and names the bars it falls below without refusing it", () => {
    const worth = promotionsWorth(log);
    const [ha, hb] = [worth.get("ha"), worth.get("hb")];
    if (ha === undefined || hb === undefined) throw new Error("two promotions");
    expect(ha).toEqual({
      bars: { effect: 0.5, transfer: 0.15, cost: 3 },
      effect: { gain: 0.75, objective: null, met: true },
      transfer: { harness: "ha", tasks: 8, share: 0.25, was: 0.75, met: false },
      cost: { attempts: 1, sessions: 1, dollars: 0, met: true },
    });
    // Its own epoch holds none of its tasks yet, so `hb`'s transfer is unread.
    expect(hb).toMatchObject({
      effect: { gain: 0.25, met: false },
      transfer: { harness: "hb", tasks: 0, met: null },
      cost: { attempts: 1, sessions: 0, dollars: 16, met: true },
    });
    expect([belowBar(ha), belowBar(hb)]).toEqual([["transfer"], ["effect"]]);
    expect(worthLine(hb)).toBe(
      "worth, read against the bars and gating nothing: effect +25 points of valid share (bar 50): below bar; transfer of hb: no share on 0 tasks written after its freeze, against 75% where it was promoted (bar 15 points, at least 8 tasks): unread; cost 1 promotion attempt this epoch (bar 3 after set-up): met, over 0 Builder sessions and 16.00 dollars billed",
    );
  });

  /** One task's solves on each side, with the objective each valid answer measured, lower better. */
  const pair = (task: string, old: boolean[], fresh: boolean[], measured?: [number[], number[]]): Paired => ({
    task,
    old,
    fresh,
    ...keyIfDefined(
      "objective",
      measured && { direction: "lower" as const, margin: 0.01, old: measured[0], fresh: measured[1] },
    ),
  });
  const step = log.findIndex(({ data }) => data.session === "g-2");
  const g2 = { id: "g-2", fresh: "hb", objective: false };

  it("reads a step as the log stood before its report, with its candidate as one attempt and a repeat as none", () => {
    const pairs = [
      pair("t1", [false, false], [true, false]),
      pair("t2", [true, false], [true, false]),
      pair("t3", [true, false], [true, true]),
      pair("t4", [true, true], [true, true]),
    ];
    const asked = { ...g2, valid: { old: [1, 2, 1], fresh: [0, 2, 2] }, pairs };
    // Read before the report is written and after, it says the same.
    const before = worthOf(log.slice(0, step), asked);
    expect(worthOf(log.slice(0, step + 1), asked)).toEqual(before);
    expect(before).toMatchObject({
      effect: { gain: 0.25, objective: null, met: false },
      transfer: { harness: "ha", tasks: 8, share: 0.25, was: 0.75, met: false },
      cost: { attempts: 1, met: true },
    });
    // Its repeat is no attempt more.
    expect(worthOf(log.slice(0, step + 1), { ...asked, id: "g-3" }).cost).toMatchObject({ attempts: 1 });
  });

  it("meets the effect bar by the objective on half the pairings of two valid answers, and never against an invalid one", () => {
    // Ten points of valid share, and the objective won on three of the four pairings of two valid answers.
    const pairs = [
      pair(
        "t1",
        [true, true],
        [true, true],
        [
          [5, 5],
          [4, 6],
        ],
      ),
      pair(
        "t2",
        [false, false],
        [true, false],
        [
          [0, 0],
          [1, 0],
        ],
      ),
    ];
    const valid = { old: [1, 0, 1], fresh: [0, 1, 1] };
    const won = worthOf(log.slice(0, step), { ...g2, objective: true, valid, pairs });
    expect(won.effect).toEqual({ gain: 0.25, objective: 0.5, met: true });
    // The invalid answers' measures move nothing: the objective is read over the valid pairings only.
    const lost = [
      pair(
        "t1",
        [true, true],
        [true, true],
        [
          [4, 4],
          [5, 5],
        ],
      ),
      ...pairs.slice(1),
    ];
    expect(worthOf(log.slice(0, step), { ...g2, objective: true, valid, pairs: lost }).effect).toMatchObject({
      objective: 0,
      met: false,
    });
  });
});
