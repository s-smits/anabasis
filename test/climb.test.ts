// The climb, simulated: a campaign run by its log over the fixture pack with a script in each
// model seat, where a task's difficulty is its base and a harness's strength is a number its guide
// carries. A solve passes where the base is at most the strength, and gives no answer otherwise;
// each edit of the Builder that leads the campaign raises the strength by two; each Examiner session asked for room reads the
// reference harness's strength from its kept state and writes tasks on either side of it, as an
// Examiner that hears which tasks were answered would. What this proves is the host's part
// of the climb and nothing of a model: that a scripted Builder promotes a harness, requests harder tasks
// written, promotes a harder one on them, and ends on its budget of moves and not before. Run by
// name, since its solves run under the real wall and take minutes:
//
//   ANA_CLIMB=1 bun run test -- test/climb.test.ts
//
// The operator's question of 10 October: does the system climb, epoch after epoch, where an
// epoch ends with a promotion and the next one's tasks are harder?

import { afterAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { barLines, type Epoch, epochLine, epochsOf, riskLines, worthOf } from "../src/campaign/climb.ts";
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
import { tmpdir } from "../src/meta/os.ts";
import { join, resolve } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { requireJsonValue } from "../src/meta/stable-json.ts";
import { ANSWER_FILE } from "../src/tools/answer.ts";
import type { Seats } from "../tools/d2/campaign-terms.ts";
import { harnessBuilder } from "../tools/d2/harness-builder.ts";
import { fixtureTasks, layOutPack, scriptedModel } from "./helpers/fixture-pack.ts";
import { present } from "./helpers/matchers.ts";

const REPO = resolve(import.meta.dir, "..");
const REPORTED = "comparison.reported" as const;
const FIXTURE = join(REPO, "test", "fixtures", "harness-min");
const NAME = `test-climb-${String(runtimeProcess.pid)}`;
const TASKS = fixtureTasks(7);
/** The starter's strength: it answers a base of three and under. */
const STARTER_STRENGTH = 3;
/** What one edit of the Builder adds. */
const RAISE = 2;
/** Tasks an Examiner asked for writes, by how far above the reference's strength each is: one
 *  past it, which the reference answers on some of its solves and not all, so that a task is
 *  informative for it as room asks (`informative`, `roomOf`);
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

// A log written here as `test/reports.test.ts` writes one, for the epochs' reading.
const AT = "2026-10-10T00:00:00.000Z";
const event = (kind: EventKind, data: JsonObject): LogEvent => ({ at: AT, kind, data });
const condition = (task: string, harness: string): Condition => ({
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
  },
  host: "h",
  side: "test",
});
const SETTING = settingId(condition("any", "any"));
const heldOut = (version: string) => [
  event("task.proposed", { version, taskId: version }),
  event("task.gate", { version, gate: 1, outcome: "passed" }),
];

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
        // The target the simulated climb stalled at on 10 October (climb-9): drawn by hash from
        // the tasks of every epoch at once, 8 over the 19 tasks the third epoch held took two or
        // three the reference fails and left the comparison one win short three times. The draw
        // now takes the newest epoch's tasks first (`scoredSet`), and this run is the proof that
        // the third epoch reads its step at the target a real campaign runs near.
        "--target",
        "8",
        "--patience",
        "3",
      ];
      let written = 0;
      const seats: Seats = {
        seated: (campaign) => ({
          // One scripted Builder keeps its conversation while it edits and compares, and
          // the conversations after it make no campaign move.
          builder: read(campaign.log).some(({ kind }) => kind === "build.started")
            ? scriptedModel([IDLE, IDLE])
            : scriptedModel([
                ...Array.from({ length: 3 }, (_, epoch) => {
                  const strength = STARTER_STRENGTH + (epoch + 1) * RAISE;
                  return [
                    // The comparisons read the tasks the session writes, so the Builder waits for it.
                    ["examine", {}],
                    ["wait", {}],
                    [
                      "bash",
                      {
                        command: `printf '\\nstrength: ${String(strength)}\\n' >> "$HOME/harness/agent/${GUIDE_FILE}"`,
                      },
                    ],
                    ["compare", {}],
                    ["compare", {}],
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
        if (kind === REPORTED) {
          console.log(
            `  ${said(data.session)} ${said(data.reading)} ${JSON.stringify(data.scored)} valid ${JSON.stringify(data.valid)}`,
          );
        }
      }
      // The highest base held out in an epoch: what the test knows of difficulty.
      const hardest = (epoch: Epoch) =>
        Math.max(0, ...epoch.tasks.map((version) => baseOf.get(version) ?? 0));
      // The first conversation made every improvement, and none after it
      // changed a harness. Until 14 October a finish ended the campaign there.
      const later = of("build.finished").slice(1);
      expect(later.map(({ changed }) => changed)).not.toContain(true);
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
      expect(strengths).toEqual([...strengths].toSorted((one, other) => one - other));
      expect(strengths[1] ?? 0).toBeGreaterThan(strengths[0] ?? 0);
      expect(ending.move === "end" ? ending.ending : "moves").not.toBe("stop");
    },
  );
});

describe("the chance of a false promotion among an epoch's attempts", () => {
  /** A candidate's comparison against `old` that tallied one task, with the reference read
   *  against itself beside it where `noise` holds its differences. */
  const attempt = (session: string, old: string, fresh: string, noise?: number[]) =>
    event(REPORTED, {
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

  it("sums the attempts' rates by the rule's design, every reading against the reference one, unsuccessful ones included", () => {
    // Since 19 October each reading is an attempt: `h2`'s two readings are two, and `h3`'s report
    // carries the test's own rate. Until then a step and the repeat it bought were one.
    const rated = event(REPORTED, {
      ...attempt("g-3", "S", "h3").data,
      frontier: { differences: [0], falseRate: 0.05 },
    });
    const stepped = event(REPORTED, {
      ...attempt("g-1", "S", "h2").data,
      frontier: { differences: [1, 1] },
    });
    const log = [started, stepped, attempt("g-2", "S", "h2"), rated];
    const [epoch] = epochsOf(log);
    // Each attempt at its own rate, the level where its report holds none.
    expect(epoch?.falsePromotion).toMatchObject({ attempts: 3, errors: 0, controls: 0 });
    expect(epoch?.falsePromotion.union).toBeCloseTo(0.25, 12);
    if (epoch === undefined) throw new Error("an epoch");
    // The line and the closing report's epoch carry the attempts, their summed estimate and that
    // no control was read; the campaign's line sums the epochs' estimates, here the one epoch's, as
    // an estimate and no bound (the plan's 7.6).
    const [epochRisk, total] = riskLines(log);
    for (const line of [epochLine(epoch), epochRisk]) {
      expect(line).toMatch(/\b3 promotion attempts\b.*\b25%.*\bno A\/A comparison\b/u);
    }
    expect(total).toContain("25%");
    expect(total).toContain("no bound");
    // A rate under ten percent is printed to a tenth: 1.8% is not 2%.
    const small = { ...rated, data: { ...rated.data, frontier: { differences: [0], falseRate: 0.018 } } };
    expect(riskLines([started, small])[0]).toContain("estimated at 1.8%;");
  });

  it("counts the A/A controls that could read a step and those that read one, one-sided at the level, beside the design's rate, and lets them set none of it", () => {
    // Three controls tie every task and cannot read a step at any level; the fourth wins three of
    // four untied tasks, which could have read one at 0.10 (four of four, p 1/16) and reads none
    // (p 5/16). Until 20 October a control that could not read a step counted as one that read
    // none, and 30 of the 49 controls on record were such. Until 19 October they were read in
    // pairs by the two-stage rule, and until then too a 95% bound replaced the design's 10%.
    const ties = [0, 0, 0];
    const log = [
      started,
      ...["g-1", "g-2", "g-3"].map((id) => attempt(id, "S", "h2", ties)),
      attempt("g-4", "S", "h2", [1, -1, 1, 1]),
      event("harness.promoted", { harness: "h2" }),
      attempt("g-5", "h2", "h4"),
    ];
    const [first, second] = epochsOf(log);
    expect(first?.falsePromotion).toMatchObject({
      attempts: 4,
      errors: 0,
      controls: 1,
      incapable: 3,
      tied: 3,
    });
    expect(first?.falsePromotion.union).toBeCloseTo(0.4, 12);
    expect(second?.falsePromotion).toMatchObject({
      attempts: 1,
      errors: 0,
      controls: 1,
      incapable: 3,
      union: 0.1,
    });
    if (second === undefined) throw new Error("an epoch");
    expect(epochLine(second)).toContain(
      "a false promotion among them estimated at 10%; 0 of 1 A/A comparison with enough untied tasks to read a step read one, and 3 too small to read one at their level, 3 of them because the reference tied every task with itself;",
    );
    // A control too small with one untied task did not tie every task, so it is too small and no more.
    const short = [started, attempt("g-1", "S", "h2", [1, 0, 0])];
    expect(epochsOf(short)[0]?.falsePromotion).toMatchObject({ incapable: 1, tied: 0 });
    expect(riskLines(short)[0]).toContain("1 too small to read one at their level.");
    // A control with no task tallied tied none, so it is too small and no more.
    const empty = [started, attempt("g-1", "S", "h2", [])];
    expect(epochsOf(empty)[0]?.falsePromotion).toMatchObject({ incapable: 1, tied: 0 });
    expect(riskLines(log)[2]).toStartWith(
      "Over the campaign, a false promotion in any epoch estimated at 50%:",
    );
    // A control whose four tasks all went one way reads a step at 0.10 (p 1/16): one error, said.
    // The other way it reads none, one-sided as a comparison is.
    const lucky = [
      started,
      attempt("g-1", "S", "h2", [1, 1, 1, 1]),
      attempt("g-2", "S", "h2", [-1, -1, -1, -1]),
    ];
    expect(epochsOf(lucky)[0]?.falsePromotion).toMatchObject({ errors: 1, controls: 2, incapable: 0 });
    expect(riskLines(lucky)[0]).toContain(
      "1 of 2 A/A comparisons with enough untied tasks to read a step read one.",
    );
    // Past one the sum is capped there.
    const many = Array.from({ length: 11 }, (_, at) =>
      attempt(`g-${String(at + 1)}`, "S", `h${String(at + 2)}`),
    );
    expect(epochsOf([started, ...many])[0]?.falsePromotion.union).toBe(1);
  });

  it("reads an A/A on its scores without the bill, so a bill-only sweep is too small to read a step", () => {
    const aa = (session: string, unbilled: readonly number[]) =>
      event(REPORTED, {
        ...attempt(session, "S", "h2").data,
        noise: { differences: [1, 1, 1, 1], unbilled: [...unbilled] },
      });
    const log = [
      started,
      aa("bill-only", [0, 0, 0, 0]),
      aa("unbilled-short", [1, 1, 1, -1]),
      aa("opposite", [-1, -1, -1, -1]),
      aa("both", [1, 1, 1, 1]),
    ];
    expect(epochsOf(log)[0]?.falsePromotion).toMatchObject({ errors: 1, controls: 3, incapable: 1 });
  });
});

describe("the starter comparison in an epoch's row", () => {
  // In an objective domain the starter answers every task validly and still loses on the
  // objective: the row reads the reference's tally against it without the bill, from the
  // reference's side, and not the starter's share of valid answers.
  const opened = event("comparison.started", { session: "g-1", old: "S", fresh: "h2", starter: "S" });
  const promoted = event("harness.promoted", { harness: "h2" });
  const starterRead = (scored: JsonObject, more: JsonObject = {}) =>
    event(REPORTED, {
      session: "g-2",
      reading: "no-step",
      old: "h2",
      fresh: "S",
      level: 0.02,
      scored,
      ...more,
    });

  it("counts the reference's wins without the bill, where the bill alone turned one task", () => {
    const log = [
      opened,
      promoted,
      starterRead({ differences: [-1, -1, -0.1, 0.1], unbilled: [-1, -1, 0, 0.1] }),
    ];
    const [first, second] = epochsOf(log);
    expect(first?.starter_tally).toBeNull();
    expect(second?.starter_tally).toEqual({ wins: 2, losses: 1, ties: 1 });
    expect(epochLine(present(second))).toContain("against the starter 2 won, 1 lost, 1 tied, no step;");
    expect([first?.confirmed, second?.confirmed]).toEqual([null, false]);
  });

  it("confirms the promotion only where the reference clears the level against the starter without the bill", () => {
    // Six tasks won on the bill alone are no step without it; six won on validity are one at 0.02.
    const onBill = starterRead({
      differences: Array.from({ length: 6 }, () => -0.1),
      unbilled: Array.from({ length: 6 }, () => 0),
    });
    const onValidity = starterRead({
      differences: Array.from({ length: 6 }, () => -1),
      unbilled: Array.from({ length: 6 }, () => -1),
    });
    expect(epochsOf([opened, promoted, onBill])[1]?.confirmed).toBe(false);
    const confirmed = present(epochsOf([opened, promoted, onValidity])[1]);
    expect(confirmed.confirmed).toBe(true);
    expect(epochLine(confirmed)).toContain("6 won, 0 lost, 0 tied, a step, so its promotion is confirmed");
  });

  it("confirms on the epoch's first starter comparison that tallied a task, so a later draw of the pair replaces no reading", () => {
    const short = starterRead({
      differences: Array.from({ length: 5 }, () => -1),
      unbilled: Array.from({ length: 5 }, () => -1),
    });
    const six = {
      differences: Array.from({ length: 6 }, () => -1),
      unbilled: Array.from({ length: 6 }, () => -1),
    };
    const again = starterRead(six, { session: "g-3", reading: "step" });
    const redrawn = epochsOf([opened, promoted, short, again])[1];
    expect([redrawn?.starter_tally?.wins, redrawn?.confirmed]).toEqual([5, false]);
    // One that tallied nothing tested nothing, so the comparison after it is the first reading.
    const empty = starterRead({ differences: [], unbilled: [] }, { reading: "not-scored" });
    expect(epochsOf([opened, promoted, empty, again])[1]?.confirmed).toBe(true);
  });

  it("says unread before a starter comparison reports, and nothing in the first epoch", () => {
    const [first, second] = epochsOf([opened, promoted]);
    expect(second?.starter_tally).toBeNull();
    expect(second?.confirmed).toBe(false);
    expect(epochLine(present(second))).toContain("against the starter unread");
    expect(epochLine(present(first))).not.toContain("against the starter");
  });
});

describe("the bar a promotion is read against, beside an old ladder's readings", () => {
  /** A candidate's comparison against `old` that read a frontier. */
  const stepRead = (session: string, old: string, fresh: string) =>
    event(REPORTED, {
      session,
      reading: "step",
      old,
      fresh,
      solves: 2,
      level: 0.1,
      setting: SETTING,
      versions: ["v1"],
      // Three tasks won by two pairs each: p 0.125, read as a step here by its word.
      frontier: { differences: [2, 2, 2], falseRate: 0.01 },
      retained: "unmeasured",
    });
  /** An old ladder read on `reference` (retired 16 October): tasks by the starter's valid solves
   *  and by the reference's. */
  const ladderRead = (session: string, reference: string, starter: number[], valid: number[]) =>
    event(REPORTED, {
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

  it("reads a step as the log stood before its report, as one attempt more, and every reading before it as one", () => {
    const step = log.findIndex(({ data }) => data.session === "g-3" && data.reading === "step");
    const before = worthOf(log.slice(0, step), "g-3");
    expect(worthOf(log.slice(0, step + 1), "g-3")).toEqual(before);
    expect(before.cost).toMatchObject({ attempts: 1, met: true });
    // A reading after the step is an attempt of its own: until 19 October a repeat was none.
    expect(worthOf(log.slice(0, step + 1), "g-5").cost).toMatchObject({ attempts: 2 });
    const tied = { ...stepRead("g-5", "ha", "hb").data, reading: "no-step", frontier: { differences: [0] } };
    const again = [...log.slice(0, step + 1), event(REPORTED, tied)];
    expect(worthOf(again, "g-6").cost).toMatchObject({ attempts: 3 });
  });

  it("counts a led session in each epoch it acted in, and a finished one in its own epoch alone", () => {
    // WRI lane 31, 2 November: a led session finishes in no epoch, so 11 of 11 steps in seven
    // campaigns read "over 0 Builder sessions".
    const led = [
      event("campaign.opened", { terms: { cost: "2" } }),
      event("comparison.started", { session: "g-1", old: "S", fresh: "ha", starter: "S" }),
      event("build.started", { session: "b-1", parent: "S" }),
      event("build.turn", { session: "b-1" }),
      event("build.turn", { session: "b-1" }),
      stepRead("g-1", "S", "ha"),
      event("harness.promoted", { harness: "ha", from: "S" }),
      event("build.turn", { session: "b-1" }),
    ];
    expect(epochsOf(led).map(({ sessions }) => sessions)).toEqual([1, 1]);
    expect(epochsOf(log).map(({ sessions }) => sessions)).toEqual([1, 1, 0]);
  });
});

describe("a campaign against its bars", () => {
  const LEVEL = 0.02;
  const opened = event("comparison.started", { session: "g-0", old: "S", fresh: "h1", starter: "S" });
  /** A report of `fresh` against `old` at 0.02, with an A/A beside it where `noise` is given. */
  const reported = (session: string, old: string, fresh: string, noise?: readonly number[]) =>
    event(REPORTED, {
      session,
      reading: "no-step",
      old,
      fresh,
      level: LEVEL,
      frontier: { differences: [0] },
      noise: noise === undefined ? null : { differences: [...noise] },
    });
  /** The reference's read against the starter, won by `wins` tasks. */
  const againstStarter = (session: string, old: string, wins: number) =>
    event(REPORTED, {
      ...reported(session, old, "S").data,
      frontier: null,
      scored: { differences: Array.from({ length: wins }, () => -1) },
    });
  const promotedTo = (harness: string, from: string) => event("harness.promoted", { harness, from });
  /** Six promotions in a row, each attempted once, with no starter comparison. */
  const six = Array.from({ length: 6 }, (_, at) => {
    const [from, harness] = [at === 0 ? "S" : `h${String(at)}`, `h${String(at + 1)}`];
    return [reported(`g-${harness}`, from, harness), promotedTo(harness, from)];
  }).flat();
  const honesty = (events: readonly LogEvent[]) => barLines([opened, ...events])[1];
  const allWon = [1, 1, 1, 1, 1, 1];

  it("counts promotions confirmed, read short of a step, and never read against the starter", () => {
    const [climb] = barLines([
      opened,
      reported("g-1", "S", "h1"),
      promotedTo("h1", "S"),
      // Confirmed on six tasks won at 0.02, and a later draw of the pair changes nothing.
      againstStarter("g-2", "h1", 6),
      reported("g-3", "h1", "h2"),
      promotedTo("h2", "h1"),
      // Five of five is short of the level, so this one is read and unconfirmed.
      againstStarter("g-4", "h2", 5),
      againstStarter("g-5", "h2", 6),
      promotedTo("h3", "h2"),
    ]);
    expect(climb).toBe(
      "- Climb: 3 promotions, 1 confirmed against a milestone of 6; 1 read against the starter without a step, 1 not read against it.",
    );
    expect(barLines([opened])[0]).toContain("0 promotions, 0 confirmed");
  });

  it("reads the A/A comparisons reported after the sixth promotion alone, and keeps those too small and each direction apart", () => {
    // Five promotions are short of the milestone, whatever the A/A comparisons read.
    const five = six.slice(0, -2);
    expect(honesty([...five, reported("g-a", "h5", "h6", allWon)])).toContain("no promotion 6 yet");
    // The A/A beside the very comparison that promoted the sixth stands before it, and is no reading of it.
    const atTheStep = six.map((each) =>
      each.data.session === "g-h6" ? reported("g-h6", "h5", "h6", allWon) : each,
    );
    expect(honesty(atTheStep)).toContain("after promotion 6, 0 A/A comparisons");
    // One too small, one able that reads none, one for the second solves, one for the first.
    const after = [
      reported("g-a", "h6", "h7", [1, 1]),
      reported("g-b", "h6", "h8", [1, -1, 1, -1, 1, -1]),
      reported("g-c", "h6", "h9", allWon),
      reported(
        "g-d",
        "h6",
        "h10",
        allWon.map((one) => -one),
      ),
    ];
    expect(honesty([...six, ...after])).toBe(
      "- Honesty: after promotion 6, 4 A/A comparisons against the bar's 10, 3 with enough untied tasks to read a step: 1 read one, 2 read one either way.",
    );
    // A reference that matched itself on every task is said apart from one merely too small.
    const tied = reported("g-e", "h6", "h11", [0, 0, 0, 0, 0, 0]);
    expect(honesty([...six, ...after, tied])).toBe(
      "- Honesty: after promotion 6, 5 A/A comparisons against the bar's 10, 3 with enough untied tasks to read a step: 1 read one, 2 read one either way. 1 of them tied every task, as the reference matched itself on every solve, and could read no step.",
    );
    expect(honesty([...five, tied])).toBe(
      "- Honesty: no promotion 6 yet, so none of the bar's 10 A/A comparisons after it. 1 of the campaign's 1 A/A comparison so far tied every task, as the reference matched itself on every solve, and could read no step.",
    );
    // A settlement reports a comparison again: it stands where it first reported, before the promotion.
    const settled = [
      ...five,
      reported("g-s", "h5", "h6"),
      promotedTo("h6", "h5"),
      reported("g-s", "h5", "h6", allWon),
    ];
    expect(honesty(settled)).toContain("after promotion 6, 0 A/A comparisons");
  });

  it("reads the starter against itself on the halves of its own solves in each starter comparison, and counts it towards no bar", () => {
    const starterLine = (events: readonly LogEvent[]) => barLines([opened, ...events])[3];
    let solves = 0;
    /** `harness`'s solves of `task` in comparison `session`, each a pass or a fail. */
    const solved = (session: string, task: string, harness: string, valid: readonly boolean[]) => {
      const ran = condition(task, harness);
      const id = conditionId(ran);
      return [
        event("condition.recorded", { id, condition: requireJsonValue(ran) }),
        ...valid.flatMap((each) => {
          solves += 1;
          const solve = `s-${String(solves)}`;
          const ending = each ? { outcome: "pass" } : { outcome: "fail", kind: "no-answer" };
          return [
            event("solve.started", { solve, condition: id, comparison: session }),
            event("solve.finished", { solve, ending }),
          ];
        }),
      ];
    };
    const TASKS6 = ["v1", "v2", "v3", "v4", "v5", "v6"];
    /** A comparison of `fresh` against `old` on the six tasks at `each` solves a side, the starter's
     *  solves of every task given by `starter`. */
    const compared = (
      session: string,
      old: string,
      fresh: string,
      each: number,
      starter: readonly boolean[],
    ) => [
      ...TASKS6.flatMap((task) => [
        ...solved(
          session,
          task,
          old,
          Array.from({ length: each }, () => true),
        ),
        ...solved(session, task, fresh, starter),
      ]),
      event(REPORTED, {
        ...reported(session, old, fresh).data,
        solves: each,
        setting: SETTING,
        versions: TASKS6,
        scored: { differences: TASKS6.map(() => 0) },
      }),
    ];
    const promoted = [reported("g-1", "S", "h1"), promotedTo("h1", "S"), ...TASKS6.flatMap(heldOut)];
    // The starter passes its first solve of each task and fails its second: six untied tasks, all
    // one way, which read a step for neither half one-sided and for one half either way.
    expect(starterLine([...promoted, ...compared("g-2", "h1", "S", 2, [true, false])])).toBe(
      "- Starter against itself: 1 starter comparison split the starter's own solves in two, 1 with enough untied tasks to read a step: 0 read one, 1 read one either way, and 0 tied every task. Reported only, and counted towards no bar.",
    );
    // A starter that answers alike on every solve ties every task with itself.
    expect(starterLine([...promoted, ...compared("g-2", "h1", "S", 2, [true, true])])).toContain(
      "1 starter comparison split the starter's own solves in two, 0 with enough untied tasks to read a step: 0 read one, 0 read one either way, and 1 tied every task.",
    );
    // One solve a side does not split, and a candidate's comparison is no starter comparison.
    const none =
      "- Starter against itself: no starter comparison split the starter's own solves in two. Reported only.";
    expect(starterLine([...promoted, ...compared("g-2", "h1", "S", 1, [true])])).toBe(none);
    expect(starterLine([...promoted, ...compared("g-2", "h1", "h2", 2, [true, false])])).toBe(none);
    // The reading the comparison reported is the reference's against the starter, untouched.
    const log = [opened, ...promoted, ...compared("g-2", "h1", "S", 2, [true, false])];
    expect(epochsOf(log)[1]?.starter_tally).toEqual({ wins: 0, losses: 0, ties: 6 });
  });

  it("holds every epoch after set-up to the cost bar, an open one too, and set-up's to none", () => {
    const attempts = (old: string, count: number) =>
      Array.from({ length: count }, (_, at) =>
        reported(`${old}-${String(at)}`, old, `${old}-c${String(at)}`),
      );
    const economy = (events: readonly LogEvent[]) => barLines([opened, ...events])[2];
    const log = [
      ...attempts("S", 5),
      promotedTo("h1", "S"),
      ...attempts("h1", 3),
      promotedTo("h2", "h1"),
      ...attempts("h2", 4),
      promotedTo("h3", "h2"),
      ...attempts("h3", 5),
    ];
    expect(economy(log)).toBe(
      "- Economy: 3 epochs after set-up against a bar of 3 promotion attempts each, 2 over it: epoch 3 at 4; epoch 4 at 5, open. Reported only.",
    );
    expect(economy(attempts("S", 9))).toContain(
      "0 epochs after set-up against a bar of 3 promotion attempts each, 0 over it.",
    );
  });
});
