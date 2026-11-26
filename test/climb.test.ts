// The climb, simulated: a campaign over the fixture pack with a script in each model seat, where a
// task's difficulty is its base and a harness's strength a number its guide carries; each Builder edit
// raises it by two, and each Examiner session writes tasks either side of the reference's strength. It
// proves the host's part of the climb and nothing of a model: a scripted Builder promotes, gets harder
// tasks written, promotes again on them, and ends on its budget of moves. Its solves run under the real
// wall and take minutes, so it runs by name: `ANA_CLIMB=1 bun run test -- test/climb.test.ts`.

import { afterAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { stopRule } from "../src/campaign/admission.ts";
import { barLines, type Epoch, epochLine, epochsOf, riskLines } from "../src/campaign/climb.ts";
import { nextAction } from "../src/campaign/scheduler.ts";
import type { Plan } from "../src/campaign/state.ts";
import { taskHistory } from "../src/examiner/record.ts";
import { examine } from "../src/examiner/session.ts";
import { type Condition, conditionId, settingId } from "../src/kernel/condition.ts";
import { type EventKind, type LogEvent, read } from "../src/kernel/log.ts";
import { GUIDE_FILE } from "../src/meta/bundle-layout.ts";
import {
  existsSync,
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
import type { Seats } from "../tools/campaign/campaign-terms.ts";
import { validityOf } from "../tools/campaign/close.ts";
import { harnessBuilder } from "../tools/campaign/harness-builder.ts";
import { fixtureTasks, layOutPack, OPENED_FROM, scriptedModel } from "./helpers/fixture-pack.ts";
import { present } from "./helpers/matchers.ts";
import { objectiveLog } from "./helpers/starter-chain.ts";

const REPO = resolve(import.meta.dir, "..");
const REPORTED = "comparison.reported" as const;
const FIXTURE = join(REPO, "test", "fixtures", "harness-min");
const NAME = `test-climb-${String(runtimeProcess.pid)}`;
const TASKS = fixtureTasks(7);
const STARTER_STRENGTH = 3;
const RAISE = 2;
/** One past the reference's strength, which it answers on some solves and not all, so the task
 *  is informative (`informative`, `evalHeadroom`); and harder ones, some past any harness so far. */
const ABOVE = [1, 1, 2, 2, 3, 4];
const IDLE: readonly [string, JsonObject] = ["finish", { note: "Nothing further." }];
const tried = new Map<string, number>();
const root = realpathSync(mkdtempSync(join(tmpdir(), "ana-climb-")));
const folder = join(REPO, ".ana", "d2", NAME);

// A log written here as `test/wall-practice.test.ts` writes one, for the epochs' reading.
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
  if (runtimeProcess.env.ANA_CLIMB_KEEP === undefined) rmSync(folder, { recursive: true, force: true });
});

function strengthOf(dir: string): number {
  const guide = join(dir, "agent", GUIDE_FILE);
  const found = existsSync(guide)
    ? [...readFileSync(guide, "utf8").matchAll(/strength: (\d+)/g)].at(-1)
    : undefined;
  return found === undefined ? STARTER_STRENGTH : Number(found[1]);
}

const of = (kind: string): JsonObject[] =>
  read(join(folder, "log.jsonl")).flatMap((each: LogEvent) => (each.kind === kind ? [each.data] : []));

describe("the climb", () => {
  it.skipIf(runtimeProcess.env.ANA_CLIMB === undefined)(
    "promotes a harness, has harder tasks written, and promotes a harder one on them, epoch after epoch",
    async () => {
      layOutPack(folder, TASKS);
      writeFileSync(join(folder, "seed.json"), `${JSON.stringify({ from: null, events: 0 })}\n`);
      const flags = [
        "--name",
        NAME,
        "--project",
        "climb",
        ...OPENED_FROM,
        "--admit",
        "check-product",
        "--practice",
        "2",
        // Drawn by hash from every epoch at once, 8 of the third epoch's 19 tasks leave the comparison
        // one win short; the draw takes the newest epoch first (`scoredSet`), so the third epoch reads
        // its step at the target.
        "--target",
        "8",
        "--patience",
        "3",
      ];
      let written = 0;
      const seats: Seats = {
        seated: (campaign) => ({
          builder: read(campaign.log).some(({ kind }) => kind === "build.started")
            ? scriptedModel([IDLE, IDLE])
            : scriptedModel([
                ...Array.from({ length: 3 }, (_, epoch) => {
                  const strength = STARTER_STRENGTH + (epoch + 1) * RAISE;
                  return [
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
          // One past its strength on every other solve, since a task the reference always fails or
          // always answers leaves no room.
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
      // A campaign that ends on its moves has not stopped; led by its Builder, the improvements are
      // made inside one conversation.
      const ending = await harnessBuilder([...flags, "--moves", "24"], seats);
      const moves = of("campaign.move").map(({ move }) => (isString(move) ? move : "?"));
      const promotions = of("harness.promoted");
      const log = read(join(folder, "log.jsonl"));
      const epochs = epochsOf(log);
      console.log(moves.join(" "));
      for (const epoch of epochs) console.log(epochLine(epoch));
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
      const hardest = (epoch: Epoch) =>
        Math.max(0, ...epoch.tasks.map((version) => baseOf.get(version) ?? 0));
      // The first conversation made every improvement, and none after it changed a harness; a
      // finish does not end the campaign there.
      const later = of("build.finished").slice(1);
      expect(later.map(({ changed }) => changed)).not.toContain(true);
      expect(promotions.length).toBeGreaterThanOrEqual(2);
      expect(epochs.length).toBeGreaterThanOrEqual(3);
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
    // Each reading is an attempt: `h2`'s two readings are two, and `h3`'s report carries the test's
    // own rate, so a step and a repeat it bought are not one.
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
    expect(epoch?.falsePromotion).toMatchObject({ attempts: 3, errors: 0, controls: 0 });
    expect(epoch?.falsePromotion.union).toBeCloseTo(0.25, 12);
    if (epoch === undefined) throw new Error("an epoch");
    const [epochRisk, total] = riskLines(log);
    for (const line of [epochLine(epoch), epochRisk]) {
      expect(line).toMatch(/\b3 promotion attempts\b.*\b25%.*\bno powered A\/A control\b/u);
    }
    expect(total).toContain("25%");
    expect(total).toContain("formal bound");
    const small = { ...rated, data: { ...rated.data, frontier: { differences: [0], falseRate: 0.018 } } };
    expect(riskLines([started, small])[0]).toContain("false-promotion risk 1.8%;");
  });

  it("counts the A/A controls that could read a step and those that read one, one-sided at the level, beside the design's rate, and lets them set none of it", () => {
    // Three controls tie every task and cannot read a step; the fourth wins three of four untied tasks
    // (p 5/16) and could have read one only at four of four (p 1/16). A control that could not read a
    // step is not counted as one that read none.
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
      "estimated false-promotion risk 10%; 0 of 1 powered A/A control triggered a false positive (0 two-sided), plus 3 underpowered at alpha, 3 of them tied on every task (zero reference variance);",
    );
    const short = [started, attempt("g-1", "S", "h2", [1, 0, 0])];
    expect(epochsOf(short)[0]?.falsePromotion).toMatchObject({ incapable: 1, tied: 0 });
    expect(riskLines(short)[0]).toContain("plus 1 underpowered at alpha.");
    const empty = [started, attempt("g-1", "S", "h2", [])];
    expect(epochsOf(empty)[0]?.falsePromotion).toMatchObject({ incapable: 1, tied: 0 });
    expect(riskLines(log)[2]).toStartWith(
      "Campaign-wide estimated false-promotion risk across all epochs: 50%",
    );
    // Four tasks all one way read a step at 0.10 (p 1/16): one error. The other way reads none
    // one-sided.
    const lucky = [
      started,
      attempt("g-1", "S", "h2", [1, 1, 1, 1]),
      attempt("g-2", "S", "h2", [-1, -1, -1, -1]),
    ];
    expect(epochsOf(lucky)[0]?.falsePromotion).toMatchObject({
      errors: 1,
      either: 2,
      controls: 2,
      incapable: 0,
    });
    expect(riskLines(lucky)[0]).toContain(
      "1 of 2 powered A/A controls triggered a false positive (2 two-sided).",
    );
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
    expect(epochsOf(log)[0]?.falsePromotion).toMatchObject({
      errors: 1,
      either: 2,
      controls: 3,
      incapable: 1,
    });
  });

  it("splits able A/A controls and steps by whether the reference's own validity flipped", () => {
    const valStep = event(REPORTED, {
      ...attempt("g-val", "S", "h2", [1, 1, 1, 1]).data,
      points: { validity: 120, objective: 10 },
      valid: { old: [1, 1, 2], fresh: [0, 0, 4] },
    });
    // Candidate fails validity while the reference passed every solve: its A/A is objective-only.
    const freshOnlyFail = event(REPORTED, {
      ...attempt("g-fresh-fail", "S", "h2", [1, 1, 1, 1]).data,
      noise: { differences: [1, 1, 1, 1], flips: 0 },
      points: { validity: -80, objective: 25 },
      valid: { old: [0, 0, 4], fresh: [1, 1, 2] },
    });
    // Reference has only all-fail and all-pass tasks (no partial validity): its A/A is objective-only.
    const allOrNoneOld = event(REPORTED, {
      ...attempt("g-obj", "S", "h2", [1, -1, 1, -1]).data,
      points: { validity: 0, objective: 25 },
      valid: { old: [2, 0, 2], fresh: [0, 0, 4] },
    });
    const log = [started, valStep, freshOnlyFail, allOrNoneOld];
    expect(epochsOf(log)[0]?.falsePromotion.byMeasure).toEqual({
      validity: { controls: 1, errors: 1 },
      objective: { controls: 2, errors: 1 },
    });
  });
});

describe("the starter comparison in an epoch's row", () => {
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
    const empty = starterRead({ differences: [], unbilled: [] }, { reading: "not-scored" });
    expect(epochsOf([opened, promoted, empty, again])[1]?.confirmed).toBe(true);
  });

  it("counts no step of the Starter's over the reference among the steps won by validity", () => {
    const points = { validity: 4 };
    const steps = [
      { reading: "step", fresh: "h2", points },
      { reading: "step", fresh: "S", points },
    ];
    expect(validityOf(steps, [opened])).toMatchObject({ stepped: 1, onValidity: 1 });
    expect(validityOf(steps, [promoted])).toMatchObject({ stepped: 2, onValidity: 2 });
  });

  it("says unread before a starter comparison reports, and nothing in the first epoch", () => {
    const [first, second] = epochsOf([opened, promoted]);
    expect(second?.starter_tally).toBeNull();
    expect(second?.confirmed).toBe(false);
    expect(epochLine(present(second))).toContain("against the starter unread");
    expect(epochLine(present(first))).not.toContain("against the starter");
  });
});

describe("a campaign against its bars", () => {
  const LEVEL = 0.02;
  const opened = event("comparison.started", { session: "g-0", old: "S", fresh: "h1", starter: "S" });
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
  const againstStarter = (session: string, old: string, wins: number) =>
    event(REPORTED, {
      ...reported(session, old, "S").data,
      frontier: null,
      scored: { differences: Array.from({ length: wins }, () => -1) },
    });
  const promotedTo = (harness: string, from: string) => event("harness.promoted", { harness, from });
  const honesty = (events: readonly LogEvent[]) => barLines([opened, ...events])[1];
  const allWon = [1, 1, 1, 1, 1, 1];

  it("counts promotions confirmed, read short of a step, and never read against the starter", () => {
    const [climb] = barLines([
      opened,
      reported("g-1", "S", "h1"),
      promotedTo("h1", "S"),
      againstStarter("g-2", "h1", 6),
      reported("g-3", "h1", "h2"),
      promotedTo("h2", "h1"),
      againstStarter("g-4", "h2", 5),
      againstStarter("g-5", "h2", 6),
      promotedTo("h3", "h2"),
    ]);
    expect(climb).toBe(
      "- Climb: 3 promotions, 1 confirmed (milestone: 6) (on the tasks written after alone, a step 0, a step for the starter 0, no step 0, too few 1); 1 failed starter confirmation, 1 pending confirmation.",
    );
    expect(barLines([opened])[0]).toContain("0 promotions, 0 confirmed");
  });

  it("counts every A/A of the campaign, keeps those too small and each direction apart, and bounds the one-sided rate exactly", () => {
    const aa = [
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
    expect(honesty(aa)).toBe(
      "- Honesty: 4 A/A controls; 3 powered A/A controls: 1 one-sided (95% bound 86%), 2 two-sided false positives. Observational; the bar pools a release's.",
    );
    const tied = reported("g-e", "h6", "h11", [0, 0, 0, 0, 0, 0]);
    expect(honesty([...aa, tied])).toContain(
      "1 one-sided (95% bound 86%), 2 two-sided false positives. 1 of them tied every task (identical reference outcomes across rollouts, unpowered).",
    );
    const clean = Array.from({ length: 10 }, (_, at) =>
      reported(`g-${String(at)}`, "h6", `h${String(at + 7)}`, [1, -1, 1, -1, 1, -1]),
    );
    expect(honesty(clean)).toContain("10 powered A/A controls: 0 one-sided (95% bound 26%)");
    expect(honesty([])).toBe(
      "- Honesty: 0 A/A controls; 0 powered A/A controls: 0 one-sided (95% bound 100%), 0 two-sided false positives. Observational; the bar pools a release's.",
    );
  });

  it("reads the starter against itself on the halves of its own solves in each starter comparison, and counts it towards no bar", () => {
    const starterLine = (events: readonly LogEvent[]) => barLines([opened, ...events])[2];
    let solves = 0;
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
    const compared = (
      session: string,
      old: string,
      fresh: string,
      each: number,
      starter: (place: number) => readonly boolean[],
    ) => [
      ...TASKS6.flatMap((task, place) => [
        ...solved(
          session,
          task,
          old,
          Array.from({ length: each }, () => true),
        ),
        ...solved(session, task, fresh, starter(place)),
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
    const [drifts, alike, once] = [() => [true, false], () => [true, true], () => [true]];
    const apart = (place: number) => (place % 2 === 0 ? [true, false] : [false, true]);
    expect(starterLine([...promoted, ...compared("g-2", "h1", "S", 2, apart)])).toBe(
      "- Baseline A/A control: 1 split-arm starter comparison, 1 powered A/A control: 0 one-sided (95% bound 95%), 1 two-sided false positives, 0 tied every task. Observational only, excluded from honesty bar.",
    );
    expect(starterLine([...promoted, ...compared("g-2", "h1", "S", 2, drifts)])).toContain(
      "1 powered A/A control: 0 one-sided (95% bound 95%), 0 two-sided false positives, 0 tied every task.",
    );
    expect(starterLine([...promoted, ...compared("g-2", "h1", "S", 2, alike)])).toContain(
      "1 split-arm starter comparison, 0 powered A/A controls: 0 one-sided (95% bound 100%), 0 two-sided false positives, 1 tied every task.",
    );
    const none = "- Baseline A/A control: no split-arm starter comparison recorded yet. Observational only.";
    expect(starterLine([...promoted, ...compared("g-2", "h1", "S", 1, once)])).toBe(none);
    expect(starterLine([...promoted, ...compared("g-2", "h1", "h2", 2, drifts)])).toBe(none);
    const log = [opened, ...promoted, ...compared("g-2", "h1", "S", 2, drifts)];
    expect(epochsOf(log)[1]?.starter_tally).toEqual({ wins: 0, losses: 0, ties: 6 });
    const repeats = (events: readonly LogEvent[]) => barLines([opened, ...events])[3];
    expect(repeats([...promoted, ...compared("g-2", "h1", "S", 2, alike)])).toBe(
      "- Rollout consistency: in 1 comparison both arms had uniform validity across all rollouts per task, and in 1 uniform objective scores as well (g-2, zero split-arm variance on either arm). Observational only.",
    );
    expect(repeats([...promoted, ...compared("g-2", "h1", "S", 2, drifts)])).toBe(
      "- Rollout consistency: in 0 comparisons both arms had uniform validity across all rollouts per task, and in 0 uniform objective scores as well. Observational only.",
    );
    expect(barLines(objectiveLog(0.05))[3]).toBe(
      "- Rollout consistency: in 1 comparison both arms had uniform validity across all rollouts per task, and in 0 uniform objective scores as well. Observational only.",
    );
    // A difference within the floor the score ties at is no split (1.9e-9 is left unnamed); 2% apart is
    // a split.
    const every = (measures: readonly [number, number]) =>
      Object.fromEntries(["t0", "t1", "t2", "t3", "t4", "t5"].map((task) => [task, measures]));
    const measured = (measures: readonly [number, number]) =>
      /and in (\d+) uniform objective scores/.exec(
        barLines(objectiveLog(0.05, "tied", every(measures)))[3] ?? "",
      )?.[1];
    expect(measured([1, 1])).toBe("1");
    expect(measured([1, 1 + 1e-9])).toBe("1");
    expect(measured([1, 0.98])).toBe("0");
  });

  it("reverts an unconfirmed second promotion to the confirmed ancestor without a repeat starter read, counts it against patience, and ignores not-scored starter reads", () => {
    const plan: Plan = {
      patience: 2,
      unprepared: false,
      practice: 0,
      wanted: { target: 6, level: 0.1, solves: 2 },
      pastStop: null,
      prompted: false,
      admits: [],
      left: null,
      promotions: null,
    };
    const tasks6 = ["t1", "t2", "t3", "t4", "t5", "t6"];
    const report = (
      session: string,
      old: string,
      fresh: string,
      reading: string,
      diffs: readonly number[],
    ) => [
      event("comparison.started", { session, old, fresh, starter: "S" }),
      event(REPORTED, {
        session,
        old,
        fresh,
        starter: "S",
        level: 0.1,
        reading,
        versions: tasks6,
        scored: { differences: [...diffs] },
        valid: { old: [2, 2, 2], fresh: [2, 2, 2], informative: { old: 2, fresh: 2 } },
      }),
    ];
    const base: LogEvent[] = [
      event("campaign.opened", { patience: 2 }),
      event("checker.read", { contract: "c", checks: "k", faults: [] }),
      ...tasks6.flatMap(heldOut),
      event("build.finished", { session: "b-1", harness: "h1", changed: true, ended: "finished" }),
      ...report("g-1", "S", "h1", "step", [1, 1, 1, 1, 1, 0]),
      promotedTo("h1", "S"),
      ...["x1", "x2", "x3", "x4", "x5", "x6"].flatMap(heldOut),
      ...report("g-2", "h1", "S", "no-step", [-1, -1, -1, -1, -1, 0]),
      event("build.finished", { session: "b-2", harness: "h2", changed: true, ended: "finished" }),
      ...report("g-3", "h1", "h2", "step", [1, 1, 1, 1, 1, 0]),
      promotedTo("h2", "h1"),
      ...["y1", "y2", "y3", "y4", "y5", "y6"].flatMap(heldOut),
    ];
    const notScored = [...base, ...report("g-4", "h2", "S", "not-scored", [])];
    expect(nextAction(notScored, plan).move).not.toBe("revert");
    const underpowered = [...base, ...report("g-4", "h2", "S", "no-step", [-1, -1, -1, 0, 0, 0])];
    expect(epochsOf(underpowered).at(-1)).toMatchObject({ confirmed: false, starter_able: false });
    expect(nextAction(underpowered, plan).move).not.toBe("revert");
    const allTied = [...base, ...report("g-4", "h2", "S", "no-step", [0, 0, 0, 0, 0, 0])];
    expect(nextAction(allTied, plan)).toMatchObject({ move: "revert", harness: "h1" });
    const failedStarter = [...base, ...report("g-4", "h2", "S", "no-step", [1, 1, -1, -1, 0, 0])];
    expect(nextAction(failedStarter, plan)).toMatchObject({ move: "revert", harness: "h1" });
    const reverted = [...failedStarter, event("harness.reverted", { harness: "h1", from: "h2" })];
    const epochs = epochsOf(reverted);
    expect(epochs.at(-1)).toMatchObject({ reference: "h1", confirmed: true, reverted: true });
    expect(nextAction(reverted, plan).move).toBe("build");
    expect(stopRule(reverted)).toMatchObject({ sinceStep: 1, stop: false });
    expect(barLines(reverted)[0]).toContain("2 promotions, 1 confirmed");
    // Downstream readers that count harness.promoted never conflate a revert with a promotion,
    // and the Examiner's record distinguishes a revert from a promotion.
    expect(reverted.filter(({ kind }) => kind === "harness.promoted")).toHaveLength(2);
    expect(reverted.filter(({ kind }) => kind === "harness.reverted")).toHaveLength(1);
    expect(taskHistory(reverted, []).promoted).toContain("reverted to an earlier harness");
  });
});
