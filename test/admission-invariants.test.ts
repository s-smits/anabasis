import { afterAll, describe, expect, it } from "bun:test";
import {
  admitComparison,
  admitSession,
  billedRate,
  Refused,
  refusals,
  stopRule,
  supplyOf,
} from "../src/campaign/admission.ts";
import { conditionId, settingId } from "../src/kernel/condition.ts";
import { type EventKind, eventsOf, type LogEvent, read } from "../src/kernel/log.ts";
import { ended, solvesIn } from "../src/kernel/solves.ts";
import { mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { requireJsonValue } from "../src/meta/stable-json.ts";
import { conditionOf } from "./helpers/logged-round.ts";

const AT = "2026-11-26T00:00:00.000Z";
const STARTER = "starter-h";
const COMP_STARTED = "comparison.started";
const COMP_REPORTED = "comparison.reported";
const SOLVE_STARTED = "solve.started";
const SOLVE_FINISHED = "solve.finished";
const CHECKER_READ = "checker.read";
const TASK_STATE = "task.state";
const root = mkdtempSync(join(tmpdir(), "ana-admit-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const ev = (kind: EventKind, data: JsonObject): LogEvent => ({ at: AT, kind, data });
const writeLog = (name: string, events: readonly LogEvent[]): string => {
  const path = join(root, `${name}.jsonl`);
  writeFileSync(path, `${events.map((e) => JSON.stringify(e)).join("\n")}\n`);
  return path;
};
const heldTasks = (count: number): LogEvent[] =>
  Array.from({ length: count }, (_, i) => [
    ev("task.proposed", { version: `t-${String(i)}` }),
    ev("task.gate", { version: `t-${String(i)}`, gate: 1, outcome: "passed" }),
  ]).flat();

const checked = (faults: readonly string[] = []) =>
  ev(CHECKER_READ, { contract: "c", checks: "k", faults: [...faults] });

const stoppedLog = (extra: readonly LogEvent[] = []): LogEvent[] => [
  checked(),
  ...heldTasks(6),
  ev("build.checkpoint", { session: "b-1", harness: "h-1" }),
  ev("campaign.opened", { patience: 1 }),
  ev(COMP_STARTED, { session: "g-0", old: STARTER, fresh: "h-1", starter: STARTER }),
  ev(COMP_REPORTED, {
    session: "g-0",
    old: STARTER,
    fresh: "h-1",
    starter: STARTER,
    reading: "no-step",
    versions: ["t-0"],
    scored: { wins: 0, losses: 0, ties: 1 },
    valid: { old: [1, 1, 0], fresh: [1, 1, 0], informative: { old: 1, fresh: 1 } },
  }),
  ...extra,
];

const solvePair = (comparison: string, fresh: string, task: string, ending: JsonObject): LogEvent[] =>
  ([STARTER, fresh] as const).flatMap((harness, i) => {
    const cond = conditionOf(task, harness);
    const id = conditionId(cond);
    const solve = `${comparison}-${task}-${String(i)}`;
    return [
      ev("condition.recorded", { id, condition: requireJsonValue(cond) }),
      ev(SOLVE_STARTED, { solve, condition: id, comparison }),
      ev(SOLVE_FINISHED, { solve, ending }),
    ];
  });

const WANTED = {
  target: 6,
  solves: 1,
  level: 0.1,
  builds: false,
  cap: { dollars: 20, reserve: 1 },
} as const;

describe("admission invariants", () => {
  it("pins billedRate, frozen supply, and held vs held-short refusals", () => {
    expect(billedRate([])).toBeNull();
    const billed = (solve: string, dollars: number): LogEvent[] => [
      ev(SOLVE_STARTED, { solve, condition: "c" }),
      ev(SOLVE_FINISHED, { solve, billed: dollars, ending: { outcome: "pass" } }),
    ];
    expect(billedRate(ended(solvesIn(billed("s1", 2))))).toBe(2);
    expect(billedRate(ended(solvesIn([...billed("s1", 2), ...billed("s2", 4)])))).toBe(3);

    expect(supplyOf([checked()]).frozen).toBe(false);
    expect(supplyOf([checked(), ev("contract.frozen", { contract: "c", checks: "k" })]).frozen).toBe(true);

    const zeroSupply = supplyOf([checked()]);
    expect(refusals(zeroSupply, WANTED).map(({ code }) => code)).toEqual(["no-held"]);
    const oneSupply = supplyOf([checked(), ...heldTasks(1)]);
    expect(refusals(oneSupply, WANTED).map(({ code }) => code)).toEqual(["held-short"]);
    const fullSupply = supplyOf([checked(), ...heldTasks(6)]);
    expect(refusals(fullSupply, WANTED)).toEqual([]);
  });

  it("enforces admitComparison refusals, alreadyStarted idempotence, stop.overridden once, and advisory notes", () => {
    const baseEvents = [checked(), ...heldTasks(6)];
    const baseLog = writeLog("comp-base", baseEvents);
    let owned = 0;
    expect(() =>
      admitComparison(baseLog, {
        id: "g-1",
        wanted: { ...WANTED, cap: null },
        seats: "paid",
        own: () => {
          owned += 1;
        },
      }),
    ).toThrow(Refused);
    expect(owned).toBe(0);

    const startedLog = writeLog("comp-started", [
      ...baseEvents,
      ev(COMP_STARTED, { session: "g-other", old: STARTER, fresh: "h-1", starter: STARTER }),
      ev(COMP_STARTED, { session: "g-1", old: STARTER, fresh: "h-1", starter: STARTER }),
    ]);
    expect(
      admitComparison(startedLog, {
        id: "g-1",
        wanted: { ...WANTED, cap: null },
        seats: "paid",
        own: () => {
          owned += 1;
        },
      }),
    ).toEqual([]);
    expect(owned).toBe(0);

    const exactNotes = admitComparison(baseLog, {
      id: "g-exact",
      wanted: { ...WANTED, cap: { dollars: 12, reserve: 1 }, pastStop: "not-stopped" },
      seats: "paid",
      own: () => {
        owned += 1;
      },
    });
    expect(owned).toBe(1);
    expect(exactNotes.some((n) => n.includes("holds a reserve"))).toBe(false);
    expect(exactNotes.some((n) => n.includes("no task is released"))).toBe(false);
    expect(exactNotes.some((n) => n.includes("wait for a person's label"))).toBe(false);
    expect(exactNotes.some((n) => n.includes("only as retained tasks"))).toBe(false);
    expect(exactNotes.some((n) => n.includes("going on past the plan's stop rule"))).toBe(false);

    const shortJudgedNotes = admitComparison(baseLog, {
      id: "g-short",
      wanted: { ...WANTED, judged: true, builds: true, cap: { dollars: 1, reserve: 1 } },
      seats: "paid",
      own: () => {},
    });
    expect(shortJudgedNotes.some((n) => n.includes("for 0 solves beside about $9.00 of judging"))).toBe(true);
    expect(shortJudgedNotes.some((n) => n.includes("no task is released"))).toBe(true);

    const oneShortNotes = admitComparison(baseLog, {
      id: "g-11",
      wanted: { ...WANTED, cap: { dollars: 11, reserve: 1 } },
      seats: "paid",
      own: () => {},
    });
    expect(oneShortNotes.some((n) => n.includes("for 11 solves"))).toBe(true);

    const releasedLog = writeLog("comp-rel", [
      ...baseEvents,
      ...heldTasks(7).slice(-2),
      ev(TASK_STATE, { version: "t-6", state: "released" }),
    ]);
    const buildsReleased = admitComparison(releasedLog, {
      id: "g-rel",
      wanted: { ...WANTED, builds: true },
      seats: "paid",
      own: () => {},
    });
    expect(buildsReleased.some((n) => n.includes("no task is released"))).toBe(false);

    const faultUnfrozen = admitComparison(writeLog("comp-fault", [checked(["f1"]), ...heldTasks(6)]), {
      id: "g-f",
      wanted: WANTED,
      seats: "paid",
      own: () => {},
    });
    expect(faultUnfrozen.some((n) => n.includes("fault(s)"))).toBe(true);
    const faultFrozen = admitComparison(
      writeLog("comp-frozen", [
        checked(["f1"]),
        ev("contract.frozen", { contract: "c", checks: "k" }),
        ...heldTasks(6),
      ]),
      { id: "g-fz", wanted: WANTED, seats: "paid", own: () => {} },
    );
    expect(faultFrozen.some((n) => n.includes("fault(s)"))).toBe(false);

    const overrideLog = writeLog("comp-stop", [
      ...stoppedLog([ev("stop.overridden", { session: "g-other", reason: "prior" })]),
    ]);
    const stopNotes = admitComparison(overrideLog, {
      id: "g-ov",
      wanted: { ...WANTED, pastStop: "continue" },
      seats: "paid",
      own: () => {},
    });
    expect(stopNotes.some((n) => n.includes("continuing past the patience stop rule"))).toBe(true);
    expect(eventsOf(read(overrideLog), "stop.overridden")).toHaveLength(2);
    admitComparison(overrideLog, {
      id: "g-ov",
      wanted: { ...WANTED, pastStop: "continue" },
      seats: "paid",
      own: () => {},
    });
    expect(eventsOf(read(overrideLog), "stop.overridden")).toHaveLength(2);
  });

  it("reports awaiting pool notes and enforces admitSession refusals and practice bounds", () => {
    const setting = settingId(conditionOf("any", "any"));
    const poolComp = (session: string, fresh: string): LogEvent[] => [
      ev(COMP_STARTED, { session, old: STARTER, fresh, starter: STARTER }),
      ...solvePair(session, fresh, "t-0", { outcome: "fail", kind: "no-answer" }),
      ...solvePair(session, fresh, "t-1", { outcome: "pass" }),
      ev(COMP_REPORTED, {
        session,
        old: STARTER,
        fresh,
        starter: STARTER,
        setting,
        solves: 1,
        reading: "no-step",
        versions: ["t-0", "t-1"],
        scored: { wins: 0, losses: 0, ties: 2 },
      }),
    ];
    const poolLog = writeLog("comp-pool", [
      checked(),
      ...heldTasks(8),
      ...poolComp("g-1", "h-1"),
      ...poolComp("g-2", "h-2"),
    ]);
    const poolNotes = admitComparison(poolLog, {
      id: "g-3",
      wanted: WANTED,
      seats: "paid",
      own: () => {},
    });
    expect(poolNotes.some((n) => n.includes("waiting for human review"))).toBe(true);

    const unreadNoRel = writeLog("sess-unread-0", [...heldTasks(2)]);
    expect(() => admitSession(unreadNoRel, { id: "s-0", wanted: { cap: null }, seats: "paid" })).toThrow(
      Refused,
    );
    const noRelNotes = admitSession(unreadNoRel, {
      id: "s-1",
      wanted: { cap: { dollars: 5, reserve: 2 }, practiceSolves: 3 },
      seats: "paid",
    });
    expect(noRelNotes.some((n) => n.includes("no task is released"))).toBe(true);
    expect(noRelNotes.some((n) => n.includes("for 2 practice solves"))).toBe(true);
    expect(noRelNotes.some((n) => n.includes("fault(s)"))).toBe(false);
    const exactPractice = admitSession(unreadNoRel, {
      id: "s-2",
      wanted: { cap: { dollars: 5, reserve: 2 }, practiceSolves: 2 },
      seats: "paid",
    });
    expect(exactPractice.some((n) => n.includes("practice solves"))).toBe(false);

    const unreadWithRel = writeLog("sess-unread-1", [
      ...heldTasks(2),
      ev(TASK_STATE, { version: "t-0", state: "released" }),
    ]);
    expect(() =>
      admitSession(unreadWithRel, {
        id: "s-3",
        wanted: { cap: { dollars: 10, reserve: 2 } },
        seats: "paid",
      }),
    ).toThrow(Refused);

    const readWithRel = writeLog("sess-read-1", [
      checked(),
      ...heldTasks(2),
      ev(TASK_STATE, { version: "t-0", state: "released" }),
    ]);
    const cleanNotes = admitSession(readWithRel, {
      id: "s-4",
      wanted: { cap: { dollars: 10, reserve: 2 } },
      seats: "paid",
    });
    expect(cleanNotes.some((n) => n.includes("no task is released"))).toBe(false);
    expect(cleanNotes.some((n) => n.includes("fault(s)"))).toBe(false);
  });

  it("counts moves since the epoch's last step, adding a parent's count only before any step or promotion, over every log of up to four moves", () => {
    const moves = ["step", "flat", "promote"] as const;
    const logsOf = (length: number): (typeof moves)[number][][] =>
      length === 0 ? [[]] : logsOf(length - 1).flatMap((head) => moves.map((one) => [...head, one]));
    const opened = (carried: number | null) =>
      carried === null
        ? []
        : [
            ev("campaign.opened", {
              parent: {
                campaign: "a",
                revised: "r",
                kind: "tune",
                carried: { spent: 0, sinceStep: carried, attempts: 0, tunes: 1 },
              },
            }),
          ];
    const room = { old: [1, 1, 0], fresh: [1, 1, 0], informative: { old: 1, fresh: 1 } };
    let logs = 0;
    for (const carried of [null, 0, 3]) {
      for (const order of [0, 1, 2, 3, 4].flatMap(logsOf)) {
        const log = [
          ...opened(carried),
          ...order.flatMap((move, at) => {
            const harness = `h-${String(at)}`;
            return move === "promote"
              ? [ev("harness.promoted", { harness: `p-${String(at)}`, from: STARTER })]
              : [
                  ev("build.checkpoint", { session: `b-${String(at)}`, harness }),
                  ev(COMP_REPORTED, {
                    session: `g-${String(at)}`,
                    old: STARTER,
                    fresh: harness,
                    reading: move === "step" ? "step" : "no-step",
                    versions: ["t-0"],
                    scored: { wins: 0, losses: 0, ties: 1 },
                    valid: room,
                  }),
                ];
          }),
        ];
        const promotedAt = order.lastIndexOf("promote");
        const epoch = order.slice(promotedAt + 1);
        const lastStep = epoch.lastIndexOf("step");
        const since = epoch.length - 1 - lastStep;
        const inherited = promotedAt === -1 && lastStep === -1 ? (carried ?? 0) : 0;
        expect(stopRule(log).sinceStep).toBe(since + inherited);
        logs += 1;
      }
    }
    expect(logs).toBe(3 * (1 + 3 + 9 + 27 + 81));
  });
});
