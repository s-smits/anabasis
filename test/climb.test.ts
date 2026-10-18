// The climb, simulated: a campaign run by its log over the fixture pack with a script in each
// model seat, where a task's difficulty is its base and a harness's strength is a number its guide
// carries. A solve passes where the base is at most the strength, and gives no answer otherwise;
// each Builder session, or each edit of a Builder that leads its campaign, raises the strength by two; each Examiner session asked for room reads the
// reference harness's strength from its kept state and writes tasks on either side of it, as an
// Examiner that hears which tasks were answered would. What this proves is the host's part
// of the climb and nothing of a model: that a scripted Builder promotes a harness, requests harder tasks
// written, promotes a harder one on them, and ends on its budget of moves and not before. Run by
// name, since its solves run under the real wall and take minutes:
//
//   ANA_CLIMB=1 bun run test -- test/climb.test.ts
//
// That is a campaign led by its Builder, as one that opens now is. `ANA_CLIMB=host` runs the same
// climb with the host making every move the table names (`--no-builder-led`).
//
// The operator's question of 10 October: does the system climb, epoch after epoch, where an
// epoch ends with a promotion and the next one's tasks are harder?

import { afterAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import {
  type Epoch,
  epochLine,
  epochsOf,
  promotionsWorth,
  regressionLine,
  regressionOf,
  riskLines,
  worthLine,
  worthOf,
} from "../src/builder/climb.ts";
import { examine } from "../src/examiner/session.ts";
import { type Condition, conditionId, settingId } from "../src/kernel/condition.ts";
import { type EventKind, type LogEvent, read } from "../src/kernel/log.ts";
import { GUIDE_FILE } from "../src/meta/bundle-layout.ts";
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
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join, resolve } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { requireJsonValue } from "../src/meta/stable-json.ts";
import { ANSWER_FILE } from "../src/solve/answer.ts";
import type { Seats } from "../tools/d2/campaign-terms.ts";
import { harnessBuilder } from "../tools/d2/harness-builder.ts";
import { fixtureTasks, layOutPack, scriptedModel } from "./helpers/fixture-pack.ts";

const REPO = resolve(import.meta.dir, "..");
const FIXTURE = join(REPO, "test", "fixtures", "harness-min");
const NAME = `test-climb-${String(runtimeProcess.pid)}`;
const TASKS = fixtureTasks(7);
/** The starter's strength: it answers a base of three and under. */
const STARTER_STRENGTH = 3;
/** What one Builder session adds, or one edit of a Builder that leads its campaign. */
const HOSTED = runtimeProcess.env.ANA_CLIMB === "host";
const RAISE = 2;
/** Tasks an Examiner asked for writes, by how far above the reference's strength each is: one
 *  past it, which the reference answers on some of its solves and not all, so that a task is
 *  informative for it as room asks (`informative`, `roomOf`) and as `try_task` admits a draft;
 *  and harder ones, some past any harness so far. */
const ABOVE = [1, 1, 2, 2, 3, 4];
/** A led Builder's finish in a conversation after its first, said twice where finish first gives
 *  a notice. */
const IDLE: readonly [string, JsonObject] = ["finish", { note: "Nothing further." }];
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
        "--project",
        "climb",
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
          // Led by its Builder, one scripted Builder keeps its conversation while it edits, compares
          // and promotes, and the conversations after it make no campaign move.
          // Run by the host, a Builder session raises the strength of the harness it starts from by two, and
          // finishes. The seat is made for every command, a comparison's too, so the strength is
          // read from the log: the sessions that began before this one.
          builder: HOSTED
            ? (() => {
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
              })()
            : read(campaign.log).some(({ kind }) => kind === "build.started")
              ? scriptedModel([IDLE, IDLE])
              : scriptedModel([
                  ...Array.from({ length: 3 }, (_, epoch) => {
                    const strength = STARTER_STRENGTH + (epoch + 1) * RAISE;
                    return [
                      ["examine", {}],
                      ["release_practice", {}],
                      [
                        "bash",
                        {
                          command: `printf '\\nstrength: ${String(strength)}\\n' >> "$HOME/harness/agent/${GUIDE_FILE}"`,
                        },
                      ],
                      ["compare", {}],
                      ["compare", {}],
                      ["promote", {}],
                    ] satisfies readonly (readonly [string, JsonObject])[];
                  }).flat(),
                  ["finish", { note: "Three scripted improvements in one conversation." }],
                ]),
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
      // in 36 moves and still climbing). A campaign that ends on its moves has not stopped. Led by
      // its Builder, the three improvements are made by campaign tools inside one conversation.
      const ending = await harnessBuilder(
        [...flags, "--moves", "24", ...(HOSTED ? ["--no-builder-led"] : [])],
        seats,
      );
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
      // Led by its Builder, the first conversation made every improvement, and none after it
      // changed a harness. Until 14 October a finish ended the campaign there.
      const later = of("build.finished").slice(1);
      if (!HOSTED) expect(later.map(({ changed }) => changed)).not.toContain(true);
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
    // One comparison reads nothing; a second of the same candidate is read against the one before.
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

  it("sums the attempts' rates by the rule's design, one a candidate and unsuccessful ones included", () => {
    // `h2`'s step and its repeat are one attempt; `h3`'s report carries the rule's own rate.
    const rated = event("comparison.reported", {
      ...attempt("g-3", "S", "h3").data,
      frontier: { differences: [0], falseRate: 0.05 },
    });
    const stepped = event("comparison.reported", {
      ...attempt("g-1", "S", "h2").data,
      frontier: { differences: [1, 1] },
    });
    const log = [started, stepped, attempt("g-2", "S", "h2"), rated];
    const [epoch] = epochsOf(log);
    // Each attempt at its own rate, the level where its report holds none.
    expect(epoch?.falsePromotion).toMatchObject({ attempts: 2, errors: 0, pairs: 0, bound: 0.1 });
    expect(epoch?.falsePromotion.union).toBeCloseTo(0.15, 12);
    if (epoch === undefined) throw new Error("an epoch");
    expect(epochLine(epoch)).toContain(
      "2 promotion attempts under this reference, a false promotion among them estimated at 15%: 10% for the riskiest attempt by the rule's design; no two A/A controls on record",
    );
    // The closing report sums the epochs' estimates, here the one epoch's (the plan's 7.6).
    expect(riskLines(log).slice(0, 2)).toEqual([
      "- Epoch 1: 2 promotion attempts, a false promotion among them estimated at 15%: 10% for the riskiest attempt by the rule's design; no two A/A controls on record.",
      "Over the campaign, a false promotion in any epoch estimated at 15%: the sum of the epochs' estimates, capped at one, which assumes nothing of how the attempts depend on one another. It sums estimates, so it is an estimate and no bound.",
    ]);
    // A rate under ten percent is printed to a tenth: 1.8% is not 2%.
    const small = { ...rated, data: { ...rated.data, frontier: { differences: [0], falseRate: 0.018 } } };
    expect(riskLines([started, small])[0]).toContain("1.8% for the riskiest attempt by the rule's design");
  });

  it("counts the pairs of A/A controls the rule promoted beside the design's rate, and lets them set none of it", () => {
    // Four controls tie every task: two pairs read by the promotion rule, no error. Until 19 October
    // they replaced the design's 10% with a 95% bound of 78% an attempt, and four attempts read 100%.
    const ties = [0, 0, 0];
    const log = [
      started,
      ...["g-1", "g-2", "g-3", "g-4"].map((id) => attempt(id, "S", "h2", ties)),
      event("harness.promoted", { harness: "h2" }),
      attempt("g-5", "h2", "h4"),
    ];
    const [first, second] = epochsOf(log);
    // The four are one candidate's readings, none of which bought a repeat: four attempts, each of
    // which could have (16 October; until then one a candidate, the Oracle's answer of 12 October).
    expect(first?.falsePromotion).toMatchObject({ attempts: 4, errors: 0, pairs: 2, bound: 0.1 });
    expect(first?.falsePromotion.union).toBeCloseTo(0.4, 12);
    expect(second?.falsePromotion).toMatchObject({
      attempts: 1,
      errors: 0,
      pairs: 2,
      bound: 0.1,
      union: 0.1,
    });
    if (second === undefined) throw new Error("an epoch");
    expect(epochLine(second)).toContain(
      "a false promotion among them estimated at 10%: 10% for the riskiest attempt by the rule's design; 0 of 2 pairs of A/A controls promoted",
    );
    expect(riskLines(log)[2]).toStartWith(
      "Over the campaign, a false promotion in any epoch estimated at 50%:",
    );
    // Two controls that each read 2-0 promote as a step and its repeat: one error in one pair, said.
    const lucky = [started, attempt("g-1", "S", "h2", [1, 1]), attempt("g-2", "S", "h2", [1, 1])];
    expect(epochsOf(lucky)[0]?.falsePromotion).toMatchObject({ errors: 1, pairs: 1 });
    expect(riskLines(lucky)[0]).toContain("1 of 1 pair of A/A controls promoted");
    // Past one the sum is capped there.
    const many = Array.from({ length: 11 }, (_, at) =>
      attempt(`g-${String(at + 1)}`, "S", `h${String(at + 2)}`),
    );
    expect(epochsOf([started, ...many])[0]?.falsePromotion.union).toBe(1);
  });
});

describe("the bar a promotion is read against, beside an old ladder's readings", () => {
  /** A candidate's comparison against `old` that read a frontier. */
  const stepRead = (session: string, old: string, fresh: string) =>
    event("comparison.reported", {
      session,
      reading: "step",
      old,
      fresh,
      solves: 2,
      level: 0.1,
      setting: SETTING,
      versions: ["v1"],
      // Three tasks won by two pairs each: p 0.125, under the trigger, so it buys a repeat.
      frontier: { differences: [2, 2, 2], falseRate: 0.01 },
      retained: "unmeasured",
    });
  /** An old ladder read on `reference` (retired 16 October): tasks by the starter's valid solves
   *  and by the reference's. */
  const ladderRead = (session: string, reference: string, starter: number[], valid: number[]) =>
    event("comparison.reported", {
      session,
      old: reference,
      fresh: "S",
      tasks: 4,
      ladder: true,
      valid: { old: valid, fresh: starter },
    });
  const log = [
    event("campaign.opened", { terms: { cost: "2" } }),
    event("comparison.started", { session: "g-1", old: "S", fresh: "ha", starter: "S" }),
    ...heldOut("v1"),
    event("build.finished", { session: "b-1", changed: true }),
    stepRead("g-1", "S", "ha"),
    event("harness.promoted", { harness: "ha", from: "S" }),
    event("comparison.started", { session: "g-2", ladder: true, tasks: ["l1", "l2", "l3", "l4"] }),
    ladderRead("g-2", "ha", [4, 0, 0], [2, 2, 0]),
    event("build.finished", { session: "b-2", changed: true, billed: 5 }),
    stepRead("g-3", "ha", "hb"),
    event("harness.promoted", { harness: "hb", from: "ha" }),
    event("comparison.started", { session: "g-4", ladder: true, frozen: "g-2", tasks: ["l1", "l2", "l3"] }),
    ladderRead("g-4", "hb", [3, 0, 0], [0, 0, 3]),
    event("comparison.started", { session: "g-5", ladder: true, tasks: ["l5", "l6"] }),
    ladderRead("g-5", "hb", [2, 0, 0], [2, 0, 0]),
  ];

  it("reads each promotion's cost against the operator's bar, gating nothing", () => {
    const worth = promotionsWorth(log);
    expect(worth.get("ha")).toEqual({
      bars: { cost: 2 },
      cost: { attempts: 1, sessions: 1, dollars: 0, met: true },
    });
    expect(worthLine(worth.get("hb") ?? { bars: { cost: 2 }, cost: null })).toBe(
      "cost, gating nothing: 1 promotion attempt this epoch (bar 2 after set-up): met, over 1 Builder session and 5.00 dollars billed",
    );
  });

  it("reads a step as the log stood before its report, with its candidate as one attempt and a repeat as none", () => {
    const step = log.findIndex(({ data }) => data.session === "g-3" && data.reading === "step");
    const asked = { id: "g-3", fresh: "hb" };
    const before = worthOf(log.slice(0, step), asked);
    expect(worthOf(log.slice(0, step + 1), asked)).toEqual(before);
    expect(before.cost).toMatchObject({ attempts: 1, met: true });
    expect(worthOf(log.slice(0, step + 1), { ...asked, id: "g-5" }).cost).toMatchObject({ attempts: 1 });
    // A reading after that repeat is the candidate's second attempt: until 16 October any earlier
    // reading made it a repeat, and buffer-159-opus's g-6 read one attempt where there were two.
    const tied = { ...stepRead("g-5", "ha", "hb").data, reading: "no-step", frontier: { differences: [0] } };
    const repeated = [...log.slice(0, step + 1), event("comparison.reported", tied)];
    expect(worthOf(repeated, { ...asked, id: "g-6" }).cost).toMatchObject({ attempts: 2 });
  });

  it("reads no old ladder reading as a step, a control or an attempt of the climb's", () => {
    expect(epochsOf(log).map(({ comparisons }) => comparisons)).toEqual(
      epochsOf(log.filter(({ data }) => data.ladder !== true)).map(({ comparisons }) => comparisons),
    );
  });
});
