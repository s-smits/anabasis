// A campaign that changes its checker inside one log, on stand-ins: three check programs that are a
// brief and a marker file in a scratch, each with a verifier that answers by a task's base, the real
// round on the faux Builder, the real Examiner session on the faux provider, and solves that answer
// as a table says and are graded by the checker the campaign stands on. What is under test is what
// an adoption reads, refuses and writes (`tools/c/adoption.ts`, `src/kernel/epoch.ts`), and that
// the campaign's own commands' parts go on from it. The tests of the walk run in order, each from
// the log the one before left.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { type RoundRequest, round } from "../src/builder/round.ts";
import { type BuildRequest, type Built, type Practised, session } from "../src/builder/session.ts";
import type { Bench } from "../src/builder/tools.ts";
import { examine } from "../src/examiner/session.ts";
import type { Control } from "../src/kernel/acceptance.ts";
import { type Condition, conditionId, recordCondition, settingId } from "../src/kernel/condition.ts";
import { type Contract, contractHash } from "../src/kernel/contract.ts";
import { carried, epochsOf, liveTasks, openWork, unfinished } from "../src/kernel/epoch.ts";
import { endingsOf, frontierOf, ladder } from "../src/kernel/ladder.ts";
import { append, appendAll, type EventKind, type LogEvent, read } from "../src/kernel/log.ts";
import type { Ending } from "../src/kernel/solve.ts";
import { type RejectControl, taskSets, taskVersion } from "../src/kernel/task.ts";
import { checkProgramVersion, type Task, type Verdict, type Verifier } from "../src/kernel/verify.ts";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { asRecord, isString, type JsonObject, type JsonValue } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { dirname, join } from "../src/meta/path.ts";
import { hashJsonValue, requireJsonValue } from "../src/meta/stable-json.ts";
import type { Ruling } from "../src/review/referee.ts";
import { text, tool } from "../src/solve/answer.ts";
import { openHarness } from "../src/solve/harness.ts";
import { type AdoptionRequest, adoption, remaining, type Side } from "../tools/c/adoption.ts";
import { carriable, reachOf, setsOf, stagedChecks } from "../tools/d2/campaign.ts";
import { overview } from "../tools/wri/read.ts";

/** The three harnesses of the walk: the fixture, and what its two Builder sessions leave. */
type Harness = "parent" | "first" | "second";

const FIXTURE = new URL("fixtures/harness-min", import.meta.url).pathname;
const R1 = { id: "R1", statement: "The answer is the base times six." };
const R2 = { id: "R2", statement: "For an odd base the answer ends in N; for an even base it is bare." };
const CONTRACT: Contract = {
  answerFormat: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"] },
  conventions: "",
  rules: [R1],
  scope: "Fixture.",
};
const LIMITS = {
  wallSeconds: 600,
  turns: 12,
  shellDefaultSeconds: 30,
  shellMaxSeconds: 60,
  concurrency: 1,
  diskBytes: 64 * 1024 * 1024,
  practiceSolves: 3,
};
const RULE = { solves: 3, fails: 2 };
const PRODUCT = "check-product";
const UNIT = "check-unit";
const REGRADED = "verdict.regraded";
const GATE = "task.gate";
const AT = "2026-10-08T00:00:00.000Z";
const PRICE = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 };
const scratch = realpathSync(mkdtempSync(join(tmpdir(), "ana-epoch-")));
const toolUse = { stopReason: "toolUse" } as const;
const call = (name: string, args: JsonObject) => fauxAssistantMessage(fauxToolCall(name, args), toolUse);

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const task = (taskId: string, base: number): Task => ({
  taskId,
  family: "fixture",
  publicInput: { base },
  hidden: null,
});
const baseOf = (of: Task) => Number(asRecord(of.publicInput)?.base);
const product = (of: Task) => baseOf(of) * 6;
const said = (answer: JsonValue | undefined) => {
  const value = asRecord(answer ?? null)?.answer;
  return isString(value) ? value : "";
};
const verdictOf = (blocking: string[]): Verdict =>
  blocking.length === 0 ? { kind: "pass" } : { kind: "fail", blocking };
/** Within six in a hundred of the product: the margin the repaired check allows. */
const near = (of: Task, value: number) => Math.abs(value - product(of)) <= product(of) * 0.06;

/** The first checker: the product to the digit. */
const strict: Verifier = async (of, answer) =>
  verdictOf(said(answer) === String(product(of)) ? [] : [PRODUCT]);
/** The same check repaired: an answer within the margin stands. */
const repaired: Verifier = async (of, answer) => verdictOf(near(of, Number(said(answer))) ? [] : [PRODUCT]);
/** The repaired check and a requirement beside it: the unit, on an odd base only. */
const united: Verifier = async (of, answer) =>
  verdictOf([
    ...(near(of, Number.parseFloat(said(answer))) ? [] : [PRODUCT]),
    ...(said(answer).endsWith(" N") === (baseOf(of) % 2 === 1) ? [] : [UNIT]),
  ]);

/** A checker as an adoption reads one: a check program in the scratch, a contract and a verifier. */
function side(name: string, contract: Contract, verify: Verifier, checkIds: readonly string[]): Side {
  const checks = join(scratch, "programs", name);
  mkdirSync(checks, { recursive: true });
  const execution = {
    families: "all",
    artifactPaths: ["$.answer"],
    publicInputPaths: ["$.base"],
    hidden: "none",
    evidence: { kind: "authored" },
  };
  const cited = (id: string) => (id === UNIT ? ["R2"] : ["R1"]);
  writeFileSync(
    join(checks, "brief.json"),
    JSON.stringify({
      correctnessContract: "check-program/v1",
      truthChecks: checkIds.map((id) => ({ id, citedDecisionIds: cited(id), execution })),
    }),
  );
  writeFileSync(join(checks, "evaluator.ts"), `// ${name}\nexport const checks = {};\n`);
  return {
    checker: { contract: contractHash(contract), checks: hashJsonValue(checkProgramVersion(checks)) },
    contract,
    checks,
    verify,
    pack: (of) => ({ ...of, ruleIds: contract.rules.map(({ id }) => id), checks }),
    // What a solver is shown: the contract, and each check by its id, as the public resources do.
    shown: hashJsonValue({ contract: contractHash(contract), checks: [...checkIds] }),
  };
}

const STRICT = side("strict", CONTRACT, strict, [PRODUCT]);
const REPAIRED = side("repaired", CONTRACT, repaired, [PRODUCT]);
const UNITED = side("united", { ...CONTRACT, rules: [R1, R2] }, united, [PRODUCT, UNIT]);

/** The pack's own two tasks, with the controls its author wrote and the stored passes of a sweep. */
const PACK = [task("t-1", 2), task("t-2", 6)];
const packControls = (more: readonly Control[] = []): Control[] => [
  ...PACK.map((of) => ({ taskId: of.taskId, answer: { answer: String(product(of)) }, refusedBy: null })),
  ...PACK.flatMap((of) =>
    ["0", "1", String(product(of) + 4)].map((answer) => ({
      taskId: of.taskId,
      answer: { answer },
      refusedBy: PRODUCT,
    })),
  ),
  ...more,
];
const STORED = new Map(
  PACK.map((of) => [of.taskId, [{ solve: `s-c01-${of.taskId}`, answer: { answer: String(product(of)) } }]]),
);

/** The tasks a session wrote, by the part each plays in the walk. */
const ANCHORED = [task("x-1-001", 7), task("x-1-002", 8)];
const NEAR = task("x-1-003", 3);
const EARNED = task("x-1-004", 5);
const PASSED = task("x-1-005", 9);
const SLIPPED = task("x-1-006", 10);
const WON = [task("x-1-007", 16), task("x-1-008", 18), task("x-1-009", 20)];
const POOL = [NEAR, PASSED, EARNED, SLIPPED, ...WON];
/** Held and never screened; one of its controls is refused for the wrong reason once the unit is asked. */
const UNSCREENED = task("x-1-010", 12);
/** Two the stronger solver did not pass: one a hair off, which a repair accepts, and one far off. */
const HAIR = task("x-1-011", 13);
const FAR = task("x-1-012", 15);
const WRITTEN = [...ANCHORED, ...POOL, UNSCREENED, HAIR, FAR];

/**
 * What each harness answers. The parent gets no pool task right. The first child is a hair off on
 * two of them, right on five and wrong on one; the second is right where the first was wrong and
 * a hair off, and wrong on one the first was a hair off on. The anchor moves with none of them:
 * its second task is passed once in three by every harness.
 */
function answered(of: Task, harness: Harness, nth: number): string {
  const right = String(product(of));
  if (of === ANCHORED[1]) return nth % 3 === 0 ? right : "0";
  if (!POOL.includes(of)) return right;
  if (harness === "parent") return "0";
  if (of === NEAR) return harness === "first" ? "17" : right;
  if (of === EARNED) return harness === "first" ? "0" : right;
  if (of === SLIPPED) return harness === "first" ? "59" : "0";
  return right;
}

/** The campaign of the walk: a scratch with the fixture harness as the first parent, a log, the
 *  checker it stands on, and the stand-ins that solve, build and examine. */
async function campaign() {
  const dir = join(scratch, "campaign");
  const log = join(dir, "log.jsonl");
  const parent = join(dir, "parent");
  mkdirSync(dir);
  cpSync(FIXTURE, parent, { recursive: true });
  const record = (kind: EventKind, data: JsonObject) => append(log, kind, data);
  const stands = { on: STRICT };
  const children: string[] = [];
  const old = (await openHarness(parent)).digest;
  const condition = (version: string, harness: string, as: Condition["side"]): Condition => ({
    contract: stands.on.checker.contract,
    harness,
    task: version,
    model: `faux/${as}`,
    effort: "medium",
    prices: { [`faux/${as}`]: PRICE },
    runtime: {},
    compaction: "off",
    solverTools: harness,
    verifierTools: "t1",
    sandbox: "p1",
    limits: LIMITS,
    host: "h1",
    side: as,
  });
  const versionOf = (of: Task) => taskVersion(stands.on.pack(of));
  const taskOf = (version: string) => {
    const found = [...PACK, ...WRITTEN].find((of) => versionOf(of) === version);
    if (found === undefined) throw new Error(`no task of the walk is version ${version}`);
    return found;
  };
  /** Every solve asked for, in order: the task, and the harness it ran under. */
  const asked: { task: string; harness: string }[] = [];
  let solves = 0;
  /** One solve as the runner logs one, graded by the checker the campaign stands on. */
  const solved = async (
    of: Task,
    harness: string,
    as: Condition["side"],
    answer: string,
  ): Promise<Practised> => {
    solves += 1;
    const solve = `${as}-${String(solves)}`;
    const verdict = await stands.on.verify(of, { answer });
    const ending: Ending =
      verdict.kind === "pass" ? { outcome: "pass" } : { outcome: "fail", kind: "rejected" };
    record("solve.started", {
      solve,
      condition: recordCondition(log, condition(versionOf(of), harness, as)),
    });
    record("verdict", { solve, task: of.taskId, answer: { answer }, ...verdict });
    record("solve.finished", { solve, ending, seconds: 30 });
    return { solve, ending };
  };
  const counts = new Map<string, number>();
  /** A measured solve under a harness of the walk, by its digest. */
  const solve = (version: string, _dir: string, digest: string): Promise<Practised> => {
    if (digest !== old && !children.includes(digest)) children.push(digest);
    const harness: Harness = digest === old ? "parent" : digest === children[0] ? "first" : "second";
    const of = taskOf(version);
    const nth = counts.get(`${of.taskId} ${digest}`) ?? 0;
    counts.set(`${of.taskId} ${digest}`, nth + 1);
    asked.push({ task: of.taskId, harness });
    return solved(of, digest, "test", answered(of, harness, nth));
  };
  const controlsOf = (of: Task): RejectControl[] =>
    ["0", "1", of === UNSCREENED ? `${String(product(of))} N` : "2"].map((answer) => ({
      answer: { answer },
      expectedCheckId: PRODUCT,
    }));

  const faux = fauxProvider({ models: [{ id: "faux-builder", contextWindow: 200_000, cost: PRICE }] });
  const models = createModels();
  models.setProvider(faux.provider);
  /** The walled write, stood in for: the same tool name, writing as the host. */
  const walled = (bench: Bench) => [
    tool({
      name: "write_file",
      label: "write",
      description: "Writes a file under harness/.",
      parameters: Type.Object({ path: Type.String(), content: Type.String() }),
      execute: async (_id, args) => {
        const file = join(bench.home, "harness", args.path);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, args.content);
        return text("Wrote it.");
      },
    }),
  ];
  let sessions = 0;
  const builder = async (request: BuildRequest): Promise<Built> => {
    sessions += 1;
    const home = join(dir, `home-${String(sessions)}`);
    const host = join(dir, `host-${String(sessions)}`);
    mkdirSync(home);
    mkdirSync(host);
    return await session(request, { home, host }, walled);
  };
  /** One round over the sets the log names, its pool in the order given, from `from`. */
  const rounded = (id: string, from: string, pool: readonly Task[], target: number, guide: string) => {
    faux.setResponses([
      call("write_file", { path: "agent/BUILT_AGENTS.md", content: guide }),
      call("finish", { note: "A shorter guide." }),
    ]);
    const sets = setsOf(read(log));
    const request: RoundRequest = {
      session: {
        id,
        parent: from,
        states: join(dir, "states"),
        tasks: sets.released.map((version) => ({ version, task: taskOf(version) })),
        contract: stands.on.contract,
        resources: [],
        model: faux.getModel(),
        effort: "medium",
        limits: LIMITS,
        models: () => models,
        log,
        repoRoot: dir,
        practise: async (practice, at, digest) => solve(practice.version, at, digest),
      },
      builder,
      candidates: pool.map(versionOf),
      anchor: sets.anchor,
      target,
      setting: settingId(condition("any", "any", "test")),
      screening: RULE,
      solves: 3,
      level: 0.1,
      anchorLevel: 0.1,
      anchorFloor: 1,
      defects: 3,
      concurrency: 1,
      solve,
      refereeDecides: false,
    };
    return round(request);
  };
  /** What an adoption of `candidate` is asked with, over the log as it stands. */
  const asks = (
    candidate: Side,
    more: Partial<AdoptionRequest> & { readonly controls?: readonly Control[] } = {},
  ): AdoptionRequest => ({
    events: read(log),
    candidate: { ...candidate, tasks: PACK, controls: more.controls ?? packControls(), found: () => true },
    current: stands.on,
    witnesses: STORED,
    labels: new Map(),
    refereeDecides: false,
    running: [],
    jobs: 2,
    ...more,
  });
  const of = (kind: EventKind) =>
    read(log)
      .filter((event) => event.kind === kind)
      .map(({ data }) => data);
  /** Where a solver of one side stands under a harness, as the checker the campaign stands on, or
   *  another, sets its solves. */
  const stand = (harness: string, as: Condition["side"], under: Side = stands.on) => ({
    harness,
    setting: settingId({ ...condition("any", "any", as), contract: under.checker.contract }),
  });
  /** The ids of the walk's tasks whose versions under the standing checker are among `versions`. */
  const ids = (versions: readonly string[]) =>
    [...PACK, ...WRITTEN].flatMap((each) => (versions.includes(versionOf(each)) ? [each.taskId] : [])).sort();
  return {
    dir,
    log,
    parent,
    old,
    children,
    record,
    stands,
    versionOf,
    solved,
    controlsOf,
    asked,
    rounded,
    asks,
    of,
    stand,
    ids,
  };
}

describe("a campaign that adopts a changed checker", () => {
  let c: Awaited<ReturnType<typeof campaign>>;
  const idsOf = (tasks: readonly Task[]) => tasks.map(({ taskId }) => taskId).sort();
  const first = () => c.children[0] ?? "";

  beforeAll(async () => {
    c = await campaign();
  });

  it("stands on a step, with every set in place, before any checker changes", async () => {
    c.record("contract.frozen", { ...STRICT.checker });
    // The pack's two tasks as `admit-sweep.ts --feasible` leaves them: no instance in the proposal,
    // no solve named at gate 2, the controls by their digest alone.
    for (const each of PACK) {
      const version = c.versionOf(each);
      c.record("task.proposed", { version, taskId: each.taskId });
      for (const gate of [1, 2, 3, 4]) {
        c.record(GATE, { version, gate, outcome: "passed", controls: "d" });
      }
    }
    // The session's tasks as `examine` leaves them: whole in the proposal, the stronger solve named
    // at gate 2 with its answer in the log, the controls whole at gate 4.
    for (const each of WRITTEN) {
      const version = c.versionOf(each);
      const { taskId } = each;
      c.record("task.proposed", { version, taskId, session: "x-1", task: { ...each } });
      c.record(GATE, { version, gate: 1, outcome: "passed" });
      const missed = each === HAIR ? "77" : each === FAR ? "1" : null;
      const { solve } = await c.solved(each, c.old, "strong", missed ?? String(product(each)));
      if (missed !== null) {
        c.record(GATE, { version, gate: 2, outcome: "too-hard", solve, kind: "rejected" });
        c.record("task.state", { version, state: "too-hard", session: "x-1" });
        continue;
      }
      c.record(GATE, { version, gate: 2, outcome: "passed", solve });
      c.record(GATE, { version, gate: 3, outcome: "passed" });
      const set = c.controlsOf(each).map((control) => ({ ...control }));
      c.record(GATE, { version, gate: 4, outcome: "passed", controls: hashJsonValue(set), set });
    }
    c.record("anchor.drawn", {
      tasks: [PACK[1], ...ANCHORED].flatMap((each) => (each ? [c.versionOf(each)] : [])),
    });
    c.record("task.state", { version: c.versionOf(PACK[0] ?? NEAR), state: "released" });
    // The measured solver under the parent, as a session's test-side solves leave it on record.
    for (const each of POOL) {
      for (const nth of [0, 1, 2]) await c.solved(each, c.old, "test", answered(each, "parent", nth));
    }

    const report = await c.rounded("b-1", c.parent, [...POOL, UNSCREENED], POOL.length, "Multiply first.\n");
    expect(report).toMatchObject({
      scored: { wins: 4, losses: 0, ties: 3 },
      anchor: { informative: 1, reading: "held" },
      reading: "step",
    });
    expect(frontierOf(read(c.log))).toBe(first());
    expect(epochsOf(read(c.log))).toMatchObject([{ checker: STRICT.checker, asked: null, adopted: null }]);
  });

  it("refuses a repair that withdraws a refusal nobody ruled a defect, and writes nothing", async () => {
    const before = readFileSync(c.log, "utf8");
    const reading = await adoption(c.asks(REPAIRED));
    // The first child's two near answers, three solves each, and the stronger solve a hair off.
    const withdrawn = reading.repair.withdrawn.unread;
    expect(withdrawn).toHaveLength(7);
    expect(reading).toMatchObject({ epoch: 2, asked: "same", faults: [], refused: [] });
    expect(reading.against).toEqual([
      `7 answers refused before and read by nobody would pass: ${withdrawn.join(", ")}`,
    ]);
    expect(() => reading.entries("")).toThrow(
      "not adopted: 1 finding against the pack, and no reason given for adopting it all the same",
    );
    // The Referee's rulings count only once the operator says they have cleared their bar, and a
    // ruling of earned withdraws nothing.
    for (const solve of withdrawn) c.record("referee.finding", { solve, ruling: "check-defect" });
    expect((await adoption(c.asks(REPAIRED))).against).toHaveLength(1);
    const cleared = await adoption(c.asks(REPAIRED, { refereeDecides: true }));
    expect(cleared.against).toEqual([]);
    const [one = ""] = withdrawn;
    const labels = new Map<string, Ruling>([[one, "earned"]]);
    expect((await adoption(c.asks(REPAIRED, { refereeDecides: true, labels }))).against).toEqual([
      `1 answer ruled an earned fail would pass: ${one}`,
    ]);
    // A reading appends nothing but what the test logged of the Referee.
    expect(readFileSync(c.log, "utf8").startsWith(before)).toBe(true);
    expect(epochsOf(read(c.log))).toHaveLength(1);
  });

  it("adopts a repaired evaluator: every task goes on, the sets stay, and the solves on record place the new versions", async () => {
    const before = read(c.log);
    const anchored = c.ids(setsOf(before).anchor);
    const was = new Map([...PACK, ...WRITTEN].map((each) => [each.taskId, c.versionOf(each)]));
    const labels = new Map<string, Ruling>(
      (await adoption(c.asks(REPAIRED))).repair.withdrawn.unread.map((solve) => [solve, "check-defect"]),
    );
    const reading = await adoption(c.asks(REPAIRED, { labels }));
    expect(reading.against).toEqual([]);
    const written = appendAll(c.log, reading.entries(""));
    c.stands.on = REPAIRED;
    const events = read(c.log);

    // One log: what was there is there byte for byte, and the checker is the last one frozen.
    expect(events.slice(0, before.length)).toEqual(before);
    expect(written.map(({ kind }) => kind).slice(0, 2)).toEqual(["checker.read", "contract.frozen"]);
    expect(written.at(-1)?.kind).toBe("checker.adopted");
    const [, epoch] = epochsOf(events);
    expect(epoch).toMatchObject({ checker: REPAIRED.checker, asked: "same", despite: null });
    expect(unfinished(events)).toBeNull();
    expect(epoch?.adopted).toMatchObject({
      epoch: 2,
      tasks: { feasible: 12, waiting: 1, reach: 1 },
      // The task a hair off has a witness now, and waits only for controls it never had.
      waiting: [HAIR.taskId],
      recovered: [HAIR.taskId],
      reach: [FAR.taskId],
      lost: [],
      stood: before.filter(({ kind }) => kind === "solve.finished").length,
      moved: 7,
      withdrawn: { "check-defect": 7, earned: 0, unread: 0 },
      tightened: 0,
      against: 0,
    });

    // Each live task has a new version that names the one it continues, and the old one is stale.
    const { states, anchor } = taskSets(events);
    for (const each of [...PACK, ...WRITTEN]) {
      expect(states.get(was.get(each.taskId) ?? "")).toBe("stale");
      expect(c.of("task.proposed").find(({ version }) => version === c.versionOf(each))).toMatchObject({
        taskId: each.taskId,
        continues: was.get(each.taskId) ?? "",
        task: { ...each },
      });
    }
    // The sets are the campaign's still: the anchor's three, the practice task, and the pool, whose
    // admitted tasks are held for the next round to screen again.
    const after = setsOf(events);
    expect(anchored).toEqual(["t-2", "x-1-001", "x-1-002"]);
    expect(c.ids(after.anchor)).toEqual(anchored);
    expect([...anchor].filter((version) => states.get(version) !== "stale")).toEqual(after.anchor);
    expect(c.ids(after.released)).toEqual(["t-1"]);
    expect(after.admitted).toEqual([]);
    expect(c.ids(after.candidates)).toEqual(idsOf([...POOL, UNSCREENED]));
    expect(carriable(events).waiting.map(({ task: each }) => each.taskId)).toEqual([HAIR.taskId]);
    expect(frontierOf(events)).toBe(first());
    expect(stagedChecks(c.dir, events)).toBe(join(c.dir, "epochs", REPAIRED.checker.checks.slice(0, 16)));

    // The first child's solves, graded again, place the new versions against it with no solve: the
    // two tasks it was a hair off on are cleared now, and the one it got wrong still stops it.
    const placed = ladder(events, c.stand(first(), "test"), RULE);
    expect(c.ids(placed.pool.stops)).toEqual([EARNED.taskId]);
    expect(c.ids(placed.pool.clears)).toEqual(idsOf([NEAR, PASSED, SLIPPED, ...WON]));
    expect(c.ids(placed.pool.unknown)).toEqual([UNSCREENED.taskId]);
    expect(c.ids(placed.reach)).toEqual([FAR.taskId]);
    // The task still without a witness keeps the solve it waited on: it is tried again when the
    // harness has moved, and not where that solve already failed.
    expect(reachOf(events, c.stand(c.old, "strong"))).toEqual([]);
    expect(reachOf(events, c.stand(first(), "strong")).map(({ taskId }) => taskId)).toEqual([FAR.taskId]);
  });

  it("goes on with a round that carries and retires on the parent's solves on record, and solves the parent only to score", async () => {
    const from = c.asked.length;
    const pool = [NEAR, PASSED, EARNED, SLIPPED, ...WON, UNSCREENED];
    const report = await c.rounded("b-2", join(c.dir, "states", first()), pool, 2, "Check.\n");
    const moved = c.of("task.state").filter((data) => data.session === "b-2");
    expect(moved).toEqual([
      // Both harnesses pass these two: the campaign has got past them.
      { version: c.versionOf(NEAR), state: "too-easy", session: "b-2" },
      { version: c.versionOf(PASSED), state: "too-easy", session: "b-2" },
      // The parent's fails on record admit this one with no screening solve at all.
      { version: c.versionOf(EARNED), state: "admitted", session: "b-2", carried: true },
      { version: c.versionOf(SLIPPED), state: "admitted", session: "b-2" },
    ]);
    const mine = c.asked.slice(from);
    const under = (harness: Harness, of: Task) =>
      mine.filter((each) => each.harness === harness && each.task === of.taskId).length;
    // No task was solved under the parent to be placed: the retired two not once, the scored two
    // three times each, which are their scoring solves.
    expect([NEAR, PASSED, EARNED, SLIPPED].map((each) => under("first", each))).toEqual([0, 0, 3, 3]);
    expect([NEAR, PASSED, EARNED, SLIPPED].map((each) => under("second", each))).toEqual([3, 3, 3, 6]);
    // Scoring reads fresh solves alone: the parent's near answer passes under the repaired check.
    expect(report).toMatchObject({
      versions: [EARNED, SLIPPED].map(c.versionOf),
      scored: { wins: 1, losses: 1, ties: 0 },
      anchor: { informative: 1, reading: "held" },
      unscreened: [],
      reading: "no-step",
    });
    expect(frontierOf(read(c.log))).toBe(first());
  });

  it("adopts a pack that adds a rule: nothing is placed, and a task whose witness the new check refuses waits for one", async () => {
    const before = read(c.log);
    const repairedVersion = new Map([...PACK, ...WRITTEN].map((each) => [each.taskId, c.versionOf(each)]));
    const controls = packControls([{ taskId: "t-1", answer: { answer: "12 N" }, refusedBy: UNIT }]);
    const reading = await adoption(c.asks(UNITED, { controls }));
    // An accepted answer the new rule refuses is what a requirement does: reported, not counted.
    expect(reading.asked).toBe("changed");
    expect(reading.repair.tightened.length).toBeGreaterThan(0);
    expect(reading.against).toEqual([]);
    expect(reading.stood).toBe(0);
    appendAll(c.log, reading.entries(""));
    c.stands.on = UNITED;
    const events = read(c.log);
    expect(events.slice(0, before.length)).toEqual(before);
    const lost = [ANCHORED[0] ?? NEAR, EARNED, HAIR];
    expect(epochsOf(events).at(-1)?.adopted).toMatchObject({
      epoch: 3,
      asked: "changed",
      tasks: { feasible: 7, waiting: 1, reach: 4 },
      waiting: [UNSCREENED.taskId],
      lost: lost.map(({ taskId }) => taskId),
      recovered: [],
      stood: 0,
      tightened: reading.repair.tightened.length,
    });
    // The two tasks the campaign got past are not carried: they left the exam on evidence.
    const { states, anchor, feasible } = taskSets(events);
    for (const retired of [NEAR, PASSED]) {
      expect(states.get(repairedVersion.get(retired.taskId) ?? "")).toBe("too-easy");
      expect(states.has(c.versionOf(retired))).toBe(false);
    }
    // A task whose witness the new check refuses is not refused and not dropped: it waits for a
    // witness, the anchor's as the anchor's, and names no solve it waited on, so the next session
    // puts it to the stronger solver whatever harness that solver stands on.
    for (const each of lost) {
      expect(states.get(c.versionOf(each))).toBe("too-hard");
      expect(c.of(GATE).findLast(({ version }) => version === c.versionOf(each))).toMatchObject({
        gate: 2,
        outcome: "too-hard",
        kind: "rejected",
        reason: `the adopted checks do not accept its witness: fail ${UNIT}`,
      });
    }
    expect(anchor.has(c.versionOf(ANCHORED[0] ?? NEAR))).toBe(true);
    const after = setsOf(events);
    expect(c.ids(after.anchor)).toEqual(["t-2", "x-1-002"]);
    expect(c.ids(after.released)).toEqual(["t-1"]);
    expect(reachOf(events, c.stand(c.old, "strong")).map(({ taskId }) => taskId)).toEqual(
      [...lost, FAR].map(({ taskId }) => taskId),
    );
    // A task whose controls no longer hold keeps its witness and is handed on for controls.
    expect(feasible.has(c.versionOf(UNSCREENED))).toBe(false);
    expect(carriable(events).waiting.map(({ task: each, accepted }) => [each.taskId, accepted])).toEqual([
      [UNSCREENED.taskId, { answer: "72" }],
    ]);
    // Nothing on record stands for a new version, so the pool is unplaced against the frontier
    // under the old contract's setting as under the new one's, and a round solves it again.
    expect(
      events.filter(
        ({ kind, data }) =>
          kind === REGRADED && data.checks === UNITED.checker.checks && isString(data.version),
      ),
    ).toEqual([]);
    for (const checker of [REPAIRED, UNITED]) {
      const placed = ladder(events, c.stand(first(), "test", checker), RULE);
      expect(c.ids(placed.pool.unknown)).toEqual(idsOf([SLIPPED, ...WON]));
      expect([placed.pool.stops, placed.pool.clears]).toEqual([[], []]);
    }
    expect(frontierOf(events)).toBe(first());
  });

  it("hands the tasks that wait to the next Examiner session, and the anchor's is the anchor's again once it is feasible", async () => {
    const events = read(c.log);
    const faux = fauxProvider({ models: [{ id: "faux-examiner", contextWindow: 200_000, cost: PRICE }] });
    const edits = (accepted: string) => [
      { check: PRODUCT, path: "$.answer", value: JSON.stringify(accepted.replace(/^\d+/, "0")) },
      { check: PRODUCT, path: "$.answer", value: JSON.stringify(accepted.replace(/^\d+/, "1")) },
      {
        check: UNIT,
        path: "$.answer",
        value: JSON.stringify(accepted.endsWith(" N") ? accepted.slice(0, -2) : `${accepted} N`),
      },
    ];
    const anchored = ANCHORED[0] ?? NEAR;
    faux.setResponses([
      call("write_controls", {
        sets: [
          { task: anchored.taskId, controls: edits("42 N") },
          { task: UNSCREENED.taskId, controls: edits("72") },
        ],
      }),
      call("finish", { note: "Wrote the controls that were waited for." }),
    ]);
    const models = createModels();
    models.setProvider(faux.provider);
    const examined = await examine({
      id: "x-2",
      contract: UNITED.contract,
      checks: [PRODUCT, UNIT].map((id) => ({ id, assertion: id, families: "all" as const })),
      examples: PACK,
      waiting: carriable(events).waiting,
      reach: reachOf(events, c.stand(first(), "strong")),
      standsOn: c.stand(first(), "test"),
      pack: UNITED.pack,
      verify: UNITED.verify,
      // The stronger solver knows the unit now, and still misses the task it was far off on.
      strong: (each) =>
        c.solved(each, first(), "strong", each.taskId === FAR.taskId ? "1 N" : `${String(product(each))} N`),
      test: (each) => c.solved(each, first(), "test", String(product(each))),
      screening: RULE,
      refereeDecides: false,
      model: faux.getModel(),
      effort: "medium",
      limits: { wallSeconds: 600, turns: 12, concurrency: 1, candidates: 8, feasible: 24 },
      models: () => models,
      log: c.log,
    });
    expect(examined.ended).toBe("finished");
    const after = read(c.log);
    const { states, feasible } = taskSets(after);
    // Witnessed again under the adopted checks, each reach task is held past gate 3; the two whose
    // controls were written are feasible, and the far one waits on.
    expect([anchored, EARNED, HAIR, FAR, UNSCREENED].map((each) => states.get(c.versionOf(each)))).toEqual([
      "held",
      "held",
      "held",
      "too-hard",
      "held",
    ]);
    expect([anchored, UNSCREENED, EARNED].map((each) => feasible.has(c.versionOf(each)))).toEqual([
      true,
      true,
      false,
    ]);
    expect(c.ids(setsOf(after).anchor)).toEqual(["t-2", "x-1-001", "x-1-002"]);
    expect(c.ids(setsOf(after).candidates)).toContain(UNSCREENED.taskId);
    expect(carriable(after).waiting.map(({ task: each }) => each.taskId)).toEqual([
      EARNED.taskId,
      HAIR.taskId,
    ]);
    // The kernel's rule holds for the carried version: the anchor's task is never admitted.
    expect(() => append(c.log, "task.state", { version: c.versionOf(anchored), state: "admitted" })).toThrow(
      "is an anchor task, so it is never admitted",
    );
    expect(openWork(after)).toEqual({ dangling: [], unreported: [], unsettled: [] });
  });
  it("is read by the investigation's reader as three epochs of one log", () => {
    const { rows, triggers } = overview(read(c.log));
    const short = ({ checker }: Side) =>
      `contract ${checker.contract.slice(0, 8)}, check program ${checker.checks.slice(0, 8)}`;
    const identity = rows.find(({ id }) => id === "B")?.lines ?? [];
    // An answer one check refused and two refuse now has moved, and is no accepted answer refused.
    const last = epochsOf(read(c.log)).at(-1)?.adopted;
    const [tightened, moved] = [Number(last?.tightened), Number(last?.moved)];
    expect(moved).toBeGreaterThan(tightened);
    expect(identity[0]).toBe(`frozen: ${short(UNITED)}`);
    expect(identity.slice(2)).toEqual([
      "3 checker epochs in this log: each result was counted under the checker frozen before it",
      `epoch 2 (${short(REPAIRED)}; the solver asked the same thing): 14 tasks went on with no solve: 12 feasible, 1 waiting for controls, 1 for a witness (0 had one before, 1 given one by an answer on record); 93 solves on record stand for them by regrade; 7 verdicts moved`,
      `epoch 3 (${short(UNITED)}; the solver asked another thing): 12 tasks went on with no solve: 7 feasible, 1 waiting for controls, 4 for a witness (3 had one before, 0 given one by an answer on record); 0 solves on record stand for them by regrade; ${String(moved)} verdicts moved`,
    ]);
    const fired = (name: string) => triggers.flatMap((each) => (each.name === name ? [each.detail] : []));
    expect(fired("TASKS CARRIED").map((detail) => detail.slice(0, 40))).toEqual([
      "epoch 2: 14 tasks went on with no solve:",
      "epoch 3: 12 tasks went on with no solve:",
    ]);
    expect(fired("REFUSALS WITHDRAWN")).toEqual([
      "epoch 2: 7 ruled a check defect, 0 ruled earned, 0 read by nobody",
    ]);
    expect(fired("ACCEPTED NEWLY REFUSED")).toEqual([
      `epoch 3: ${String(tightened)} answers, the solver asked another thing`,
    ]);
    expect([fired("FROZEN DESPITE FAULTS"), fired("ADOPTION CUT SHORT")]).toEqual([[], []]);
    // The anchor is three tasks still, whatever number of versions each has had, and a carried
    // anchor task is no part of the pool a round screens.
    const sets = rows.find(({ id }) => id === "D")?.lines ?? [];
    expect(sets[0]).toBe("14 tasks: 12 written by a session, 0 carried, the rest the pack's");
    expect(sets[1]).toBe(
      "26 later versions of those tasks under an adopted checker; the versions they continue are stale",
    );
    expect(sets[2]).toContain("; anchor 3");
    expect(sets[3]).toBe("5 feasible tasks held outside the anchor, for a round to screen");
  });
});

const event = (kind: EventKind, data: JsonObject): LogEvent => ({ at: AT, kind, data });
const LONE = task("x-1-001", 4);
const LONE_SET = ["0", "1", "2"].map((answer) => ({ answer: { answer }, expectedCheckId: PRODUCT }));
/** A second repair of the same check: another program, the same verdicts. */
const MENDED = side("mended", CONTRACT, repaired, [PRODUCT]);

/** A small campaign's log: the strict checker frozen, and one task a session wrote, feasible on a
 *  stronger solve whose answer the log holds. */
function small(): LogEvent[] {
  const version = taskVersion(STRICT.pack(LONE));
  return [
    event("contract.frozen", { ...STRICT.checker }),
    event("task.proposed", { version, taskId: LONE.taskId, session: "x-1", task: { ...LONE } }),
    event(GATE, { version, gate: 1, outcome: "passed" }),
    event("verdict", { solve: "strong-1", task: LONE.taskId, answer: { answer: "24" }, kind: "pass" }),
    event(GATE, { version, gate: 2, outcome: "passed", solve: "strong-1" }),
    event(GATE, { version, gate: 3, outcome: "passed" }),
    event(GATE, { version, gate: 4, outcome: "passed", controls: "d", set: LONE_SET }),
  ];
}

/** What an adoption over an in-memory log is asked with: a pack with no task and no control of its
 *  own. A check that then never refused is a fault the two checkers share, and counts for neither. */
const asked = (
  events: readonly LogEvent[],
  candidate: Side,
  more: Partial<AdoptionRequest> = {},
): AdoptionRequest => ({
  events,
  candidate: { ...candidate, tasks: [], controls: [], found: () => true },
  current: STRICT,
  witnesses: new Map(),
  labels: new Map(),
  refereeDecides: false,
  running: [],
  jobs: 1,
  ...more,
});

describe("what an adoption waits for, and what it never takes", () => {
  const started = (id: string) => event("build.started", { session: id, parent: "h" });
  const ended = (id: string, how: string) => event("build.finished", { session: id, ended: how });

  it("refuses, whatever reason is given, while a process writes the log or a round has not reported or been settled", async () => {
    const written = await adoption(asked(small(), REPAIRED, { running: [4242] }));
    expect(written.refused).toEqual([
      "the campaign's log is being written by pid 4242: a comparison is paired within one checker, so an adoption waits for the round or the session to end",
    ]);
    expect(() => written.entries("it is only a rehearsal")).toThrow(
      "None of it is the operator's to overrule",
    );

    // A session that ended whole and has no report is a round to be run on; one that was killed or
    // that crashed is never compared, and is not waited for.
    const whole = [...small(), started("b-1"), ended("b-1", "finished")];
    expect(openWork(whole)).toEqual({ dangling: [], unreported: ["b-1"], unsettled: [] });
    expect((await adoption(asked(whole, REPAIRED))).refused).toEqual([
      "round b-1 ended its session and wrote no report: run it again to its report first, it goes on from its log",
    ]);
    for (const how of ["killed", "crashed"]) {
      const cut = await adoption(asked([...small(), started("b-1"), ended("b-1", how)], REPAIRED));
      expect([cut.refused, cut.against]).toEqual([[], []]);
    }
    const reported = (reading: string) => event("comparison.reported", { session: "b-1", reading });
    const flagged = [...whole, reported("flags-decide")];
    expect((await adoption(asked(flagged, REPAIRED))).refused[0]).toContain(
      "round b-1 reads flags-decide and is not settled: settle it first",
    );
    // Settled, its last report is another, and the adoption goes ahead.
    expect((await adoption(asked([...flagged, reported("no-step")], REPAIRED))).refused).toEqual([]);
  });

  it("counts a session that started and never ended against the adoption, until the operator says it is over", async () => {
    const open = [...small(), event("exam.started", { session: "x-2" }), started("b-1")];
    expect(openWork(open).dangling).toEqual(["b-1", "x-2"]);
    const reading = await adoption(asked(open, REPAIRED));
    expect(reading.refused).toEqual([]);
    expect(reading.against).toEqual(
      ["b-1", "x-2"].map(
        (id) =>
          `session ${id} started and never ended, and no process writes the log now: an adoption waits for a session in flight, so say that this one is over`,
      ),
    );
    expect(() => reading.entries(" ")).toThrow("not adopted: 2 findings against the pack");
    const entries = reading.entries("both died with the host on 8 October");
    expect(entries.find(({ kind }) => kind === "contract.frozen")?.data).toMatchObject({
      ...REPAIRED.checker,
      epoch: 2,
      continues: STRICT.checker,
      asked: "same",
      despite: "both died with the host on 8 October",
      faults: 2,
    });
    expect(entries.at(-1)?.data).toMatchObject({ against: 2, over: ["b-1", "x-2"] });
    // The reader names the adoption as one given over what counted against it.
    const seen = overview([...open, ...entries.map(({ kind, data }) => event(kind, data))]);
    expect(seen.triggers.find(({ name }) => name === "FROZEN DESPITE FAULTS")?.detail).toBe(
      "epoch 2: 2 findings",
    );
    // While a process writes the log the host knows what is in flight, and nothing is the operator's.
    const live = await adoption(asked(open, REPAIRED, { running: [7] }));
    expect([live.refused.length, live.against]).toEqual([1, []]);
  });

  it("takes no check program the log froze before, and no pack that cannot hold a live task", async () => {
    const again = await adoption(asked(small(), STRICT));
    expect(again.refused).toEqual([
      "the log froze this check program before: a task's version names its check program, so the versions of that epoch are spent and it is not adopted again",
    ]);
    // A pack's own task, in the log by its id alone: only the pack can say what it is.
    const own = [1, 2, 3, 4].map((gate) =>
      event(GATE, { version: "v-pack", gate, outcome: "passed", controls: "d" }),
    );
    const held = [...small(), event("task.proposed", { version: "v-pack", taskId: "t-9" }), ...own];
    const without = await adoption(asked(held, REPAIRED));
    expect(without.refused).toEqual([
      "task t-9 is live and neither the pack nor the log holds it whole; an adoption drops no task, so the pack has to hold it",
    ]);
    expect(without.tasks).toEqual([]);
    // A rule the contract no longer holds leaves a task its checks cannot be put to.
    const narrowed = side("narrowed", { ...CONTRACT, rules: [R2] }, repaired, [PRODUCT]);
    const unfit = await adoption(asked(small(), { ...narrowed, pack: REPAIRED.pack }));
    expect(unfit.refused).toEqual([
      "task x-1-001 cannot be put to the pack's checks: rule R1 is not in the contract; an adoption drops no task, so the pack has to hold it",
    ]);
  });
});

describe("one task under an adopted checker", () => {
  const [live] = liveTasks(small());
  const put = (controls: readonly RejectControl[] | null) => {
    if (live === undefined) throw new Error("the small log holds a live task");
    return {
      live,
      task: REPAIRED.pack(LONE),
      witnesses: live.witness === null ? [] : [live.witness],
      controls: controls === null ? null : { accepted: null, set: controls },
    };
  };

  it("is feasible again with no solve, on the answer and the controls the log holds", async () => {
    expect(live).toMatchObject({
      taskId: LONE.taskId,
      wrote: "x-1",
      state: "held",
      anchor: false,
      witness: { solve: "strong-1", answer: { answer: "24" } },
      controls: LONE_SET,
    });
    const went = await carried(REPAIRED.contract, REPAIRED.verify, put(LONE_SET));
    expect(went).toMatchObject({ word: "feasible", why: null, faults: [], was: "held" });
    const version = taskVersion(REPAIRED.pack(LONE));
    expect(
      went.entries.map(({ kind, data }) => [kind, data.version, data.gate ?? data.state ?? data.solve]),
    ).toEqual([
      ["task.proposed", version, undefined],
      [GATE, version, 1],
      // The witness answer under the adopted checks, where a reviewer looks for an accepted one.
      ["verdict", undefined, "carried-strong-1"],
      [GATE, version, 2],
      [GATE, version, 3],
      [GATE, version, 4],
      ["task.state", live?.version, "stale"],
    ]);
    expect(went.entries[0]?.data).toMatchObject({
      continues: live?.version,
      wrote: "x-1",
      task: { ...LONE },
    });
    expect(went.entries[5]?.data.set).toEqual(LONE_SET);
  });

  it("names a witness accepted once and not again, and a reject control now accepted, as the checker's faults", async () => {
    let runs = 0;
    const once: Verifier = async (of, answer) => {
      runs += 1;
      return runs === 1 ? repaired(of, answer) : { kind: "fail", blocking: [PRODUCT] };
    };
    const flaky = await carried(REPAIRED.contract, once, put(LONE_SET));
    expect(flaky).toMatchObject({
      word: "reach",
      faults: [
        `the witness of x-1-001 was accepted once and not again: run 1 failed the accepted answer on ${PRODUCT}`,
      ],
    });
    // The margin of a repair that is too wide lets a control through: 23 for 24.
    const loose = LONE_SET.map((control, index) =>
      index === 2 ? { ...control, answer: { answer: "23" } } : control,
    );
    const widened = await carried(REPAIRED.contract, REPAIRED.verify, put(loose));
    expect(widened).toMatchObject({
      word: "waiting",
      why: "its controls do not hold under the adopted checks: the check passed control 3",
      faults: ["a reject control of x-1-001 is accepted by the adopted checks: the check passed control 3"],
    });
    // Controls the log does not hold whole are a session's to write again, and nobody's fault.
    expect(await carried(REPAIRED.contract, REPAIRED.verify, put(null))).toMatchObject({
      word: "waiting",
      why: "its controls are not on record",
      faults: [],
    });
  });
});

describe("the solves on record under an adopted checker", () => {
  const setting: Omit<Condition, "task"> = {
    contract: STRICT.checker.contract,
    harness: "h",
    model: "faux/test",
    effort: "medium",
    prices: { "faux/test": PRICE },
    runtime: {},
    compaction: "off",
    solverTools: "h",
    verifierTools: "t1",
    sandbox: "p1",
    limits: LIMITS,
    host: "h1",
    side: "test",
  };
  const stand = { harness: "h", setting: settingId(setting) };
  /** One solve of the lone task's first version: its answer and verdict where it gave one. */
  const ran = (solve: string, ending: Ending, verdict?: JsonObject): LogEvent[] => {
    const condition: Condition = { ...setting, task: taskVersion(STRICT.pack(LONE)) };
    return [
      event("condition.recorded", { id: conditionId(condition), condition: requireJsonValue(condition) }),
      event("solve.started", { solve, condition: conditionId(condition) }),
      ...(verdict === undefined ? [] : [event("verdict", { solve, task: LONE.taskId, ...verdict })]),
      event("solve.finished", { solve, ending }),
    ];
  };
  const PASS: Ending = { outcome: "pass" };
  const REJECTED: Ending = { outcome: "fail", kind: "rejected" };
  const WALL: Ending = { outcome: "fail", kind: "wall-ended" };
  const answer = (value: JsonValue) => ({ answer: { answer: value } });
  const solves = [
    ...ran("s-right", PASS, { ...answer("24"), kind: "pass" }),
    ...ran("s-near", REJECTED, { ...answer("23"), kind: "fail", blocking: [PRODUCT] }),
    ...ran("s-wrong", REJECTED, { ...answer("0"), kind: "fail", blocking: [PRODUCT] }),
    // Three that no check judged: at the wall, outside the format, and one the host never finished.
    ...ran("s-wall", WALL),
    ...ran("s-format", REJECTED, { ...answer(24), kind: "fail", fault: "answer is no string" }),
    ...ran("s-none", { outcome: "non-result", kind: "provider", reason: "r" }),
    // A pass whose answer the log does not hold cannot be graded again.
    ...ran("s-lost", PASS),
  ];
  const labels = new Map<string, Ruling>([["s-near", "check-defect"]]);
  /** The log after `candidate` is adopted over `events`. */
  const adopted = async (events: readonly LogEvent[], candidate: Side, current: Side) => {
    const reading = await adoption(asked(events, candidate, { labels, current }));
    return [...events, ...reading.entries("").map(({ kind, data }) => event(kind, data))];
  };
  const standings = (events: readonly LogEvent[], under: Side) =>
    events.flatMap(({ kind, data }) =>
      kind === REGRADED && data.checks === under.checker.checks
        ? [
            [
              data.solve,
              data.version === undefined ? "moved" : "stands",
              asRecord(data.ending)?.outcome ?? data.kind,
            ],
          ]
        : [],
    );

  it("stand for the version that continues theirs: a verdict graded again, an ending no check gave as it was", async () => {
    const events = await adopted([...small(), ...solves], REPAIRED, STRICT);
    // The stronger solve of the small log names no condition, so it is no solve of any stand's.
    expect(standings(events, REPAIRED)).toEqual([
      ["s-right", "stands", "pass"],
      ["s-near", "stands", "pass"],
      ["s-wrong", "stands", "fail"],
      ["s-wall", "stands", "fail"],
      ["s-format", "stands", "fail"],
    ]);
    const version = taskVersion(REPAIRED.pack(LONE));
    expect(endingsOf(events, version, stand)).toEqual([PASS, PASS, REJECTED, WALL, REJECTED]);
    // The old version reads as its solves ended, and no other harness reads the carried ones.
    expect(endingsOf(events, taskVersion(STRICT.pack(LONE)), stand)).toEqual([
      PASS,
      REJECTED,
      REJECTED,
      WALL,
      REJECTED,
      PASS,
    ]);
    expect(endingsOf(events, version, { ...stand, harness: "other" })).toEqual([]);
  });

  it("stand through a second repair as the first left them, each answer read against the checker replaced", async () => {
    const once = await adopted([...small(), ...solves], REPAIRED, STRICT);
    const second = await adoption(asked(once, MENDED, { current: REPAIRED }));
    // Nothing moves between two checkers that agree, so nothing counts and no label is asked for.
    expect([second.against, second.rows.filter(({ was, now }) => was !== now)]).toEqual([[], []]);
    const twice = [...once, ...second.entries("").map(({ kind, data }) => event(kind, data))];
    expect(standings(twice, MENDED)).toEqual(standings(once, REPAIRED));
    expect(endingsOf(twice, taskVersion(MENDED.pack(LONE)), stand)).toEqual([
      PASS,
      PASS,
      REJECTED,
      WALL,
      REJECTED,
    ]);
    expect(epochsOf(twice).map(({ asked: how }) => how)).toEqual([null, "same", "same"]);
  });

  it("stand for nothing where the task or what a solver is shown changed, and the moved verdicts are logged all the same", async () => {
    // The same check program, read as another public side: nothing stands for the new version.
    const shown = { ...MENDED, shown: "another" };
    const events = await adopted([...small(), ...solves], shown, STRICT);
    expect(standings(events, MENDED)).toEqual([["s-near", "moved", "pass"]]);
    expect(endingsOf(events, taskVersion(MENDED.pack(LONE)), stand)).toEqual([]);
    // A pack that words the task otherwise asked another question of it, whatever its checks.
    const reworded = { ...LONE, publicInput: { base: 4, note: "in newtons" } };
    const reading = await adoption({
      ...asked([...small(), ...solves], REPAIRED, { labels }),
      candidate: { ...REPAIRED, tasks: [reworded], controls: [], found: () => true },
    });
    expect([reading.asked, reading.stood]).toEqual(["same", 0]);
  });
});

describe("an adoption a crash cut short", () => {
  it("leaves the campaign unfinished, and is finished by the events the same reading gives", async () => {
    const log = join(scratch, "cut.jsonl");
    for (const { kind, data } of small()) append(log, kind, data);
    const before = read(log);
    const batch = (await adoption(asked(before, REPAIRED))).entries("");
    // The write stopped four events in: the reading, the freeze, and two of the task's.
    appendAll(log, batch.slice(0, 4));
    expect(unfinished(read(log))).toEqual(REPAIRED.checker);
    expect(epochsOf(read(log)).at(-1)).toMatchObject({ adopted: null });
    const cut = () => overview(read(log)).triggers.filter(({ name }) => name === "ADOPTION CUT SHORT");
    expect(cut().map(({ detail }) => detail)).toEqual([
      "epoch 2: its freeze is in the log and nothing closes it; the campaign opens once accept.ts is run again",
    ]);
    const after = read(log).slice(before.length + 2);
    const left = remaining(after, batch);
    expect(left).toEqual(batch.slice(4));
    appendAll(log, left);
    expect(unfinished(read(log))).toBeNull();
    expect(cut()).toEqual([]);
    expect(
      read(log)
        .slice(before.length)
        .map(({ kind, data }) => ({ kind, data })),
    ).toEqual(batch);
    // Another pack's reading does not finish it.
    const other = (await adoption(asked(before, MENDED))).entries("");
    expect(() => remaining(after, other)).toThrow(
      "the log holds 2 events after the adoption's freeze, and event 1 of them is not the one this pack and this log give",
    );
  });
});

describe("a log with one freeze", () => {
  it("reads as it did before a campaign could adopt a checker", () => {
    const events = small();
    expect(epochsOf(events)).toEqual([
      { index: 0, checker: STRICT.checker, asked: null, despite: null, adopted: null },
    ]);
    expect(unfinished(events)).toBeNull();
    // The word given twice, and a freeze over faults, are still one checker and one epoch.
    const twice = [...events, event("contract.frozen", { ...STRICT.checker, despite: "stale", faults: 1 })];
    expect(epochsOf(twice)).toHaveLength(1);
    expect(stagedChecks("/campaign", twice)).toBe("/campaign/checks");
    expect(setsOf(events)).toMatchObject({ anchor: [], released: [], admitted: [] });
    expect(setsOf(events).candidates).toEqual([taskVersion(STRICT.pack(LONE))]);
    expect(carriable(events).feasible.map(({ solve }) => solve)).toEqual(["strong-1"]);
  });

  it("reads a campaign of the superseded route: tasks another log's repair carried in", () => {
    // What `carry.ts` wrote until 2026-10-08: the proposal names the old log's solve, and the copy
    // of its answer is a verdict like any other.
    const version = taskVersion(REPAIRED.pack(LONE));
    const events = [
      event("contract.frozen", { ...REPAIRED.checker }),
      event("task.proposed", { version, taskId: LONE.taskId, carried: "strong-1", task: { ...LONE } }),
      event(GATE, { version, gate: 1, outcome: "passed" }),
      event("verdict", {
        solve: "carried-strong-1",
        task: LONE.taskId,
        answer: { answer: "24" },
        kind: "pass",
      }),
      event(GATE, { version, gate: 2, outcome: "passed", solve: "carried-strong-1" }),
      event(GATE, { version, gate: 3, outcome: "passed" }),
      event(GATE, { version, gate: 4, outcome: "passed", controls: "d", set: LONE_SET }),
    ];
    expect(epochsOf(events)).toHaveLength(1);
    expect(setsOf(events).candidates).toEqual([version]);
    expect(liveTasks(events)).toMatchObject([
      { taskId: LONE.taskId, wrote: null, witness: { solve: "carried-strong-1" }, controls: LONE_SET },
    ]);
  });
});
