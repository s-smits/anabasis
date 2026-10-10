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
import { type Epoch, epochLine, epochsOf, regressionLine, regressionOf } from "../src/builder/climb.ts";
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
/** Tasks an Examiner asked for writes, by how far above the reference's strength each is: all
 *  harder than what the reference answers, as room asks, and some past any harness so far. */
const ABOVE = [1, 1, 2, 2, 3, 4];
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
function solved(comparison: string, task: string, harness: string, valid: readonly boolean[], host = "h") {
  const ran = condition(task, harness, host);
  const id = conditionId(ran);
  return [
    event("condition.recorded", { id, condition: requireJsonValue(ran) }),
    ...valid.flatMap((each) => {
      solves += 1;
      const solve = `s-${String(solves)}`;
      return [
        event("solve.started", { solve, condition: id, ...keyIfDefined("comparison", comparison) }),
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
const reported = (session: string, old: string, fresh: string, versions: string[]) =>
  event("comparison.reported", {
    session,
    reading: "no-step",
    old,
    fresh,
    solves: 2,
    setting: SETTING,
    versions,
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
        "1",
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
        // The operator's word, given once, for the promotions (AGENTS.md, section 3).
        "--unattended",
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
          // A solve passes where the task's base is at most the harness's strength.
          solve: async (task, harness, kill, comparison) => {
            const base = asRecord(task.publicInput)?.base;
            const passes = isNumber(base) && base <= strengthOf(harness.dir);
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
      const [first, second] = epochs;
      if (first === undefined || second === undefined) throw new Error("fewer than two epochs");
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
      ...solved("g-2", "v1", "h1", [false, false], "h2-host"),
      ...solved("g-2", "v1", "h3", [true, true], "h2-host"),
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
});
