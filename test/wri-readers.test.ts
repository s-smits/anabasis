// What the investigation reads from a log and from a lane's report, each as one table over the
// synthetic campaign: the overview's rows agree with the production folds that own each count, each
// trigger fires on its lane with its count, the catalogue names every trigger the reader can fire,
// and a report is collected as a finding, no finding or could not read only when its fields are even.
import { afterAll, describe, expect, it } from "bun:test";
import { STARTED as COMPARISON_STARTED } from "../src/campaign/comparison.ts";
import { conditionId } from "../src/kernel/condition.ts";
import type { LogEvent } from "../src/kernel/log.ts";
import { lastReports, referenceOf } from "../src/kernel/reports.ts";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { isString } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { requireJsonValue } from "../src/meta/stable-json.ts";
import { hasWholeToken } from "../src/meta/text.ts";
import { solvesIn } from "../src/kernel/solves.ts";
import { taskSets } from "../src/kernel/task.ts";
import { catalogueText, type Lane, lanesOf, ownersOf } from "../tools/wri/catalogue.ts";
import { draftAuditRows, groundingRows, seatSummaryRows, wallAuditRows } from "../tools/wri/components.ts";
import { continuityRows } from "../tools/wri/continuity.ts";
import { deliverableRows } from "../tools/wri/deliverables.ts";
import { READERS } from "../tools/wri/derive.ts";
import { diagnosticRows } from "../tools/wri/diagnostics.ts";
import { executionRows } from "../tools/wri/execution.ts";
import { indexOf, TRIGGERS } from "../tools/wri/folds.ts";
import { rankCatalogue } from "../tools/wri/rank-lanes.ts";
import { gamingRows } from "../tools/wri/gaming.ts";
import { reportIndex, reportOf, ROWS, sessionsOf } from "../tools/wri/investigation.ts";
import { buildPackets } from "../tools/wri/packets.ts";
import { portabilityRows } from "../tools/wri/portability.ts";
import { overview } from "../tools/wri/read.ts";
import { scoreRows } from "../tools/wri/scores.ts";
import { transferRows } from "../tools/wri/transfer.ts";
import { conditionOf } from "./helpers/logged-round.ts";
import { wriCampaign } from "./helpers/wri-campaign.ts";

const events = wriCampaign((tag) => `secret ${tag}`);
const { rows, triggers } = overview(events);
const catalogue = catalogueText();
const lanes = lanesOf(catalogue);
const owners = ownersOf(catalogue);
const lane = (number: number): Lane => {
  const found = lanes.find((each) => each.number === number);
  if (found === undefined) throw new Error(`no lane ${String(number)}`);
  return found;
};
const row = (id: string) => rows.find((each) => each.id === id)?.lines.join("\n") ?? "";

describe("the overview's rows, against the folds that own each count", () => {
  const solves = solvesIn(events);
  const ended = new Map<string, number>();
  for (const { ending } of solves) {
    const key = [ending?.outcome, ending?.kind].filter(isString).join(" ");
    ended.set(key, (ended.get(key) ?? 0) + 1);
  }
  const sets = taskSets(events);
  const conditions = new Set(
    events.flatMap(({ kind, data }) => (kind === "condition.recorded" ? [data.id] : [])),
  );
  const readings = lastReports(events, "all").map(
    ({ session, data }) => `reading ${session} ${isString(data.reading) ? data.reading : ""}`,
  );

  it.each([
    ["A", `${String(events.length)} events`],
    ["A", `${String(readings.length)} reports`],
    ["C", `${String(conditions.size)} conditions`],
    ["C", `of ${String(solves.length)} finished solves`],
    ["D", `held ${String(sets.held.length)}, released ${String(sets.released.length)}`],
    [
      "E",
      `test side: ${[...ended]
        .toSorted(([a], [b]) => a.localeCompare(b))
        .map(([key, count]) => `${key} ${String(count)}`)
        .join(", ")}`,
    ],
    ...readings.map((reading) => ["F", reading] as const),
  ])("row %s says %s", (id, text) => {
    expect(row(id)).toContain(text);
  });

  it("names the promoted harness the fold reads as the reference", () => {
    expect(referenceOf(events)).toBe("hd");
    expect(triggers.find(({ name }) => name === "PROMOTED")?.detail).toStartWith("hd from hp");
  });
});

describe("each trigger, on its lane with its count", () => {
  it.each([
    ["PASSES UNREAD", "8 passes; no reviewer reads a pass"],
    ["NO CHECKER READING", "has not read this campaign's checker"],
    ["CHECKER NOT FROZEN", "no contract.frozen in the log"],
    ["REFUSED UNREAD", "2 of 5 refused answers no reviewer ruled on"],
    ["CHECK DEFECT RULED", "1 of 5; by check: check-a 1"],
    ["RULED UNCLEAR", "1 of 5"],
    ["SCORED SET MOVED", "b-1: 2 of 4 tasks it began with are not in its tally"],
    ["SET ASIDE BY SIDE", "b-1: 1 rejection set 1 task aside, 1 under the reference harness"],
    ["SET ASIDE AND UNSETTLED", "1 task left out of a comparison on a rejection no person has labelled"],
    ["DEFECT RULED BESIDE PASSES", "a frozen alternative can settle"],
    ["OUTCOMES BY SESSION", "disputed 1, reference-every 3"],
    ["HARNESS CHANGED", "b-1: hp to hc; written by its file tools and shell: agent/tools.mjs"],
    ["NEVER CHECKED", "b-1: no check_harness call"],
    ["TOOLS CALLED", "over 3 test-side solves: bash 3, submit 3; through bash: solve.py 3"],
    ["TOOLS EDITED", "b-1: agent/tools.mjs"],
    ["FINAL BYTES NEVER PRACTISED", "b-1: no practice solve ran under hc"],
    ["PRACTICE FAILS", "b-1: 1 fail under its own states, 0 ruled earned"],
    ["CHAIN", "b-1 hp>hc no-step; b-2 hp>hd step"],
    ["WINS", "b-1: 2 of 2 tasks won: v3 new s7, reference s6"],
    ["ANSWER FROM A PROGRAM", "b-1: 3 of 3 under the new harness, 1 of 3 under the reference"],
    ["PROMOTED", "hd from hp at event"],
    ["AFTER THE PROMOTION", "Examiner sessions: none; Builder sessions: none"],
    ["PROMOTION UNCONFIRMED", "1 of 1 promotions: hd in epoch 2, open: no starter comparison reported"],
    ["MISSES AT A LIMIT", "b-1: 2 of 2 reference misses and 0 of 0 new at a limit (wall-ended 2)"],
    ["WALL SHARE", "b-1: median 50.0% under the reference harness"],
    ["NON-RESULTS", "2 of 20; check 1, provider 1; b-2: 0 under the reference harness, 2 under the others"],
    ["MISSES WITHOUT A VERDICT", "wall-ended 5"],
  ] as const)("%s says %s", (name, detail) => {
    const fired = triggers.filter((trigger) => trigger.name === name);
    expect(fired.map((trigger) => trigger.lane)).toContain(TRIGGERS[name]);
    expect(fired.map((trigger) => trigger.detail).join("\n")).toContain(detail);
  });

  it("fires nothing the catalogue does not name under the lane it opens", () => {
    for (const { name, lane: number } of triggers) expect<number>(TRIGGERS[name]).toBe(number);
    const named = lanes.flatMap(({ number, triggers: each }) =>
      each.map((name) => `${name} (lane ${String(number)})`),
    );
    const fold = Object.entries(TRIGGERS).map(([name, number]) => `${name} (lane ${String(number)})`);
    expect(named.toSorted()).toEqual(fold.toSorted());
  });

  it("numbers twenty lanes in descending importance order and matches rankCatalogue", () => {
    expect(lanes.map(({ number }) => number)).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));
    for (let index = 1; index < lanes.length; index += 1) {
      expect(lanes[index]?.importance ?? 0).toBeLessThanOrEqual(lanes[index - 1]?.importance ?? 1);
    }
    const foldsText = readFileSync(join(import.meta.dir, "..", "tools", "wri", "folds.ts"), "utf8");
    expect(rankCatalogue(catalogueText(), foldsText).changed).toBe(false);
    for (const count of [1, 4, 7]) {
      expect(
        sessionsOf(lanes, count)
          .flat()
          .map(({ number }) => number)
          .toSorted((a, b) => a - b),
      ).toEqual(lanes.map(({ number }) => number));
    }
  });
});

describe("a lane's report, as the synthesis collects it", () => {
  const head = "# Lane 4: Rejection rulings and Referee calibration";
  const finding = (title = "The tolerance", seen = "") =>
    `### ${title}\nObservation: confirmed, 40 of 55 name check-a\nCause: plausible, the tolerance\nOwner: pack/evaluator\nReverses if: a refused answer is invalid\nDecision: whether a repair is owed\n${seen}`;
  const one = ["buffer-a"];
  const two = ["buffer-a", "buffer-b"];
  it.each([
    ["a finding", 4, `${head}\nVerdict: finding, one.\n## Findings\n${finding()}`, one, "ok", "finding", []],
    [
      "no finding",
      4,
      `${head}\nVerdict: no finding, sound.\n## Checked\nthe tolerance\n`,
      one,
      "ok",
      "no finding",
      [],
    ],
    [
      "could not read",
      18,
      "# Lane 18: x\nVerdict: could not read, the receipts are gone.\n",
      one,
      "ok",
      "could not read",
      [],
    ],
    [
      "an omitted open lane",
      3,
      "# Lane 3: Rejection rulings and Referee calibration\nVerdict: omitted, lane 12 covers it.\n",
      one,
      "ok",
      "omitted",
      [],
    ],
    [
      "a finding seen in every campaign",
      4,
      `${head}\nVerdict: finding, one.\n${finding("t", "Seen in: buffer-a shows; buffer-b absent")}`,
      two,
      "ok",
      "finding",
      [],
    ],
    [
      "uneven fields",
      4,
      `${head}\nVerdict: finding, one.\n${finding()}Owner: host\n`,
      one,
      "invalid",
      "finding",
      ["the findings are uneven: Observation: 1, Cause: 1, Owner: 2, Reverses if: 1, Decision: 1"],
    ],
    [
      "no Seen in line",
      4,
      `${head}\nVerdict: finding, one.\n${finding()}`,
      two,
      "invalid",
      "finding",
      [
        "the findings are uneven: Observation: 1, Cause: 1, Owner: 1, Reverses if: 1, Decision: 1, Seen in: 0",
      ],
    ],
    [
      "a Seen in line by a prefix",
      4,
      `${head}\nVerdict: finding, one.\n${finding("t", "Seen in: buffer-a-r5 shows, buffer-b absent")}`,
      two,
      "invalid",
      "finding",
      ["a Seen in: line leaves out buffer-a"],
    ],
    [
      "a finding with none written",
      4,
      `${head}\nVerdict: finding, one.\n`,
      one,
      "invalid",
      "finding",
      ["the verdict is a finding and none is written"],
    ],
    [
      "no finding over a finding",
      4,
      `${head}\nVerdict: no finding.\n${finding()}`,
      one,
      "invalid",
      "no finding",
      ["the verdict is no finding and the report writes 1 finding"],
    ],
    [
      "an omitted isolated lane",
      20,
      "# Lane 20: x\nVerdict: omitted, covered.\n",
      one,
      "invalid",
      "omitted",
      ["an isolated lane may not be omitted"],
    ],
    [
      "a pending verdict",
      18,
      "# Lane 18: x\nVerdict: pending\n",
      one,
      "invalid",
      null,
      ["the verdict is pending: the session is still writing"],
    ],
    [
      "a provisional verdict",
      18,
      "# Lane 18: x\nVerdict: could not read, provisional\n",
      one,
      "invalid",
      "could not read",
      ["the verdict is provisional: the session is still writing"],
    ],
    [
      "an unknown owner",
      4,
      `${head}\nVerdict: finding, one.\n${finding().replace("pack/evaluator", "nobody")}`,
      one,
      "invalid",
      "finding",
      ["1 of 1 owners are not in the owner table"],
    ],
    [
      "another lane's head",
      4,
      "# Lane 14: x\nVerdict: no finding.\n",
      one,
      "invalid",
      "no finding",
      ["the first line does not name the lane"],
    ],
  ] as const)("collects %s", (...[, number, text, names, state, verdict, faults]) => {
    expect(reportOf(lane(number), text, owners, names)).toMatchObject({ state, verdict, faults });
  });

  it("collects no file as missing, and indexes each finding by its id with its marks", () => {
    expect(reportOf(lane(4), null, owners, one).state).toBe("missing");
    const report = reportOf(
      lane(4),
      `${head}\nVerdict: finding, two.\n${finding("First")}${finding("Second")}`,
      owners,
      one,
    );
    const index = reportIndex([report], (number) => `/r/${String(number)}.md`, []);
    expect(index).toContain("- lane 4: ok, finding, 2 findings, at `/r/4.md`");
    expect(index).toContain("  - 4.2, observation confirmed, cause plausible, owner pack/evaluator: Second");
  });

  it("excludes ladder comparisons from scoreRows just like lastReports does", () => {
    const at = "2026-11-22T00:00:00.000Z";
    const lines = scoreRows([
      { at, kind: "comparison.started", data: { session: "l-1", ladder: true } },
      { at, kind: "comparison.started", data: { session: "g-1" } },
    ]);
    const joined = lines.join("\n");
    expect(joined).toContain("g-1: report absent");
    expect(joined).not.toContain("l-1");
  });
});

describe("current-system WRI triggers and blind packet rendering", () => {
  const AT = "2026-11-22T12:00:00.000Z";
  const dir = mkdtempSync(join(tmpdir(), "wri-packets-test-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("fires pass-label, deliverable, practice, examiner, continuity, control, solver and billing triggers", () => {
    const base = wriCampaign((tag) => `secret ${tag}`);
    const extra = [
      // Pass labels (lane 1)
      {
        at: AT,
        kind: "comparison.reported",
        data: { session: "g-p", settled: { passes: { s1: "sound", s2: "wrong" } } },
      },
      // Deliverable capture (lane 3)
      {
        at: AT,
        kind: "verdict",
        data: {
          solve: "s99",
          task: "v1",
          kind: "pass",
          files: [{ path: "report.md", bytes: 512, sha256: "a".repeat(64) }],
        },
      },
      // Pre-promotion task released after promotion (lane 11)
      { at: AT, kind: "task.state", data: { version: "v2", state: "released" } },
      // Examiner zero-yield session (lane 13)
      {
        at: AT,
        kind: "exam.call",
        data: { session: "x-2", turn: 1, tool: "try_reference", args: {}, text: "", isError: false, ms: 1 },
      },
      { at: AT, kind: "exam.finished", data: { session: "x-2", ended: "finished", held: [] } },
      // Examiner & solver compaction (lane 15) + unpriced compaction (lane 19)
      {
        at: AT,
        kind: "exam.compacted",
        data: { session: "x-2", tokensBefore: 90_000, seconds: 5, usages: [] },
      },
      {
        at: AT,
        kind: "solve.compacted",
        data: { solve: "s1", tokensBefore: 80_000, seconds: 4, usages: [] },
      },
      // Interrupted Builder handover (lane 15)
      { at: AT, kind: "build.started", data: { session: "b-3", parent: "hd" } },
      {
        at: AT,
        kind: "build.finished",
        data: { session: "b-3", ended: "killed", billed: 1, reportedCost: 2 },
      },
      { at: AT, kind: "build.started", data: { session: "b-4", parent: "hd" } },
      // Underpowered no-steps (lane 16)
      {
        at: AT,
        kind: "comparison.started",
        data: { session: "g-u1", old: "hd", fresh: "he", starter: "hbase" },
      },
      {
        at: AT,
        kind: "comparison.reported",
        data: {
          session: "g-u1",
          old: "hd",
          fresh: "he",
          starter: "hbase",
          reading: "no-step",
          scored: { wins: 5, losses: 3, ties: 0 },
        },
      },
      {
        at: AT,
        kind: "comparison.started",
        data: { session: "g-u2", old: "hd", fresh: "hf", starter: "hbase" },
      },
      {
        at: AT,
        kind: "comparison.reported",
        data: {
          session: "g-u2",
          old: "hd",
          fresh: "hf",
          starter: "hbase",
          reading: "no-step",
          scored: { wins: 4, losses: 4, ties: 1 },
        },
      },
    ] as const;
    const fired = overview([...base, ...extra]).triggers;
    const byName = (name: keyof typeof TRIGGERS) => fired.filter((trigger) => trigger.name === name);
    expect(byName("PASSES LABELLED")[0]).toMatchObject({ lane: TRIGGERS["PASSES LABELLED"] });
    expect(byName("PASSES LABELLED")[0]?.detail).toContain("wrong rate 50.0%");
    expect(byName("DELIVERABLES CAPTURED")[0]).toMatchObject({ lane: TRIGGERS["DELIVERABLES CAPTURED"] });
    expect(byName("PRE-PROMOTION PRACTICE RELEASED")[0]).toMatchObject({
      lane: TRIGGERS["PRE-PROMOTION PRACTICE RELEASED"],
    });
    expect(byName("BUILT HARNESS FOR EXPORT")[0]).toMatchObject({
      lane: TRIGGERS["BUILT HARNESS FOR EXPORT"],
    });
    expect(byName("EXAMINER ZERO YIELD")[0]).toMatchObject({ lane: TRIGGERS["EXAMINER ZERO YIELD"] });
    expect(byName("EXAMINER ZERO YIELD")[0]?.detail).toContain("x-2");
    expect(byName("EXAMINER COMPACTED")[0]).toMatchObject({ lane: TRIGGERS["EXAMINER COMPACTED"] });
    expect(byName("SOLVER COMPACTED")[0]).toMatchObject({ lane: TRIGGERS["SOLVER COMPACTED"] });
    expect(byName("INTERRUPTED HANDOVER")[0]).toMatchObject({ lane: TRIGGERS["INTERRUPTED HANDOVER"] });
    expect(byName("INTERRUPTED HANDOVER")[0]?.detail).toContain("b-4 after b-3 (killed)");
    expect(byName("UNDERPOWERED NO-STEPS")[0]).toMatchObject({ lane: TRIGGERS["UNDERPOWERED NO-STEPS"] });
    expect(byName("BILLING RESIDUAL")[0]).toMatchObject({ lane: TRIGGERS["BILLING RESIDUAL"] });
  });

  it("fires NO DELIVERABLES CAPTURED when a draft reads files, and ignores unused type declarations", () => {
    const fired = overview([
      {
        at: AT,
        kind: "exam.drafted",
        data: { draft: { evaluator: "export const checks = { c: ({ files }) => files.length > 0 };" } },
      },
      { at: AT, kind: "verdict", data: { solve: "s1", task: "v1", kind: "pass" } },
    ]).triggers;
    expect(fired.find((trigger) => trigger.name === "NO DELIVERABLES CAPTURED")).toMatchObject({
      lane: TRIGGERS["NO DELIVERABLES CAPTURED"],
    });
    const silent = overview([
      {
        at: AT,
        kind: "exam.drafted",
        data: { draft: { evaluator: "type Req = { artifact: any; files?: any };" } },
      },
      { at: AT, kind: "verdict", data: { solve: "s1", task: "v1", kind: "pass" } },
    ]).triggers;
    expect(silent.find((trigger) => trigger.name === "NO DELIVERABLES CAPTURED")).toBeUndefined();
  });

  it("fires FAMILY CONCENTRATION without printing the family name", () => {
    const tasks = Array.from({ length: 8 }, (_, index) => {
      const version = `v-${String(index)}`;
      const family = index < 6 ? "SECRET-FAMILY-ALPHA" : "SECRET-FAMILY-BETA";
      return [
        {
          at: AT,
          kind: "task.proposed",
          data: { version, task: { taskId: version, family, publicInput: {} } },
        },
        { at: AT, kind: "task.gate", data: { version, gate: 1, outcome: "passed" } },
      ] as const;
    }).flat();
    const trigger = overview(tasks).triggers.find((each) => each.name === "FAMILY CONCENTRATION");
    expect(trigger).toMatchObject({ lane: TRIGGERS["FAMILY CONCENTRATION"] });
    expect(trigger?.detail).toContain("6 of 8 held tasks across 2 families");
    expect(trigger?.detail).not.toContain("SECRET-FAMILY");
  });

  it("renders blind grading packets directly from the rewritten blind lane", () => {
    const lines = buildPackets(
      [
        { name: "camp-a", log: join(dir, "a", "log.jsonl"), events },
        { name: "camp-b", log: join(dir, "b", "log.jsonl"), events },
      ],
      dir,
      2,
    );
    expect(lines).toHaveLength(2);
    const prompt = readFileSync(join(dir, "grader-a.md"), "utf8");
    expect(prompt).toContain("# Blind grades for lane 1");
    expect(prompt).toContain("**Reach** measures how difficult");
    expect(prompt).toContain("**Soundness** measures whether");
    expect(prompt).toContain("01a-report.md");
  });

  it("maps every ROWS entry to an existing derived reader", () => {
    const names = new Set(READERS.map(({ name }) => name));
    for (const [trigger, reader] of Object.entries(ROWS)) {
      expect({ trigger, exists: names.has(reader) }).toEqual({ trigger, exists: true });
    }
  });

  it("covers rewritten and new readers (execution, continuity, deliverables, portability, transfer, diagnostics)", () => {
    const digest = "a".repeat(64);
    const states = join(dir, "states");
    const binDir = join(states, digest, ".toolchain", "bin");
    const agentDir = join(states, digest, "agent");
    mkdirSync(binDir, { recursive: true });
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, "BUILT_AGENTS.md"), "Run /Users/dev/helper for secretKeyAlpha.\n");
    writeFileSync(join(binDir, "unused-tool"), "#!/opt/homebrew/bin/python3\nprint('hi')\n");
    chmodSync(join(binDir, "unused-tool"), 0o644);

    const deadCond = conditionOf("v1", digest, { wallSeconds: 100, turns: 8 });
    const deadCondId = conditionId(deadCond);
    const log: readonly LogEvent[] = [
      ...events,
      {
        at: AT,
        kind: "exam.drafted",
        data: {
          draft: {
            evaluator: "export const checks = { f: ({ files }) => files.length > 0 };",
            answerFormat: { properties: { secretKeyAlpha: {}, otherField: {} } },
            accept: [{ files: [{ path: "a.txt", text: "ok" }] }],
          },
        },
      },
      {
        at: AT,
        kind: "verdict",
        data: {
          solve: "s1",
          task: "v1",
          kind: "pass",
          files: [{ path: "out.csv", bytes: 128, sha256: digest }],
        },
      },
      {
        at: AT,
        kind: "referee.finding",
        data: { solve: "s2", ruling: "earned", probeRows: [{ id: 1, changes: [{ path: "file:out.csv" }] }] },
      },
      { at: AT, kind: "harness.promoted", data: { harness: digest, from: "hp" } },
      {
        at: AT,
        kind: "build.compacted",
        data: { session: "b-1", tokensBefore: 50_000, seconds: 3, usages: [] },
      },
      {
        at: AT,
        kind: "build.call",
        data: { session: "b-1", turn: 9, tool: "bash", args: {}, text: "", isError: false, ms: 5 },
      },
      {
        at: AT,
        kind: "build.call",
        data: {
          session: "b-1",
          turn: 10,
          tool: "practice",
          args: {},
          text: "objective: 12.5",
          isError: false,
          ms: 5,
        },
      },
      { at: AT, kind: "build.started", data: { session: "b-3", parent: digest } },
      { at: AT, kind: "build.finished", data: { session: "b-3", ended: "killed", turns: 4 } },
      { at: AT, kind: "build.started", data: { session: "b-4", parent: digest } },
      { at: AT, kind: "exam.started", data: { session: "x-2", conversation: "x-1" } },
      { at: AT, kind: "exam.finished", data: { session: "x-2", ended: "finished", held: [], billed: 4 } },
      ...Array.from({ length: 4 }, (_, nth): LogEvent[] => [
        {
          at: AT,
          kind: "condition.recorded",
          data: { id: deadCondId, condition: requireJsonValue(deadCond) },
        },
        {
          at: AT,
          kind: "solve.started",
          data: { solve: `su-${String(nth)}`, condition: deadCondId, comparison: "g-dead" },
        },
        {
          at: AT,
          kind: "solve.finished",
          data: { solve: `su-${String(nth)}`, ending: { outcome: "pass" }, seconds: 5 },
        },
      ]).flat(),
      ...Array.from({ length: 4 }, (_, nth): LogEvent[] => [
        {
          at: AT,
          kind: "comparison.started",
          data: { session: `g-p${String(nth)}`, old: digest, fresh: digest, starter: "hp" },
        },
        {
          at: AT,
          kind: "comparison.reported",
          data: {
            session: `g-p${String(nth)}`,
            old: "hp",
            fresh: digest,
            starter: "hbase",
            reading: "no-step",
            scored: { wins: 1, losses: 1, ties: 0 },
          },
        },
      ]).flat(),
    ];

    expect(executionRows(indexOf(events)).join("\n")).toContain("pass routes");
    const cont = continuityRows(log).join("\n");
    expect(cont).toContain("read_opening<=3: no");
    expect(cont).toContain("b-4 (interrupted handover): opened after b-3 (killed");
    const deliv = deliverableRows(log).join("\n");
    expect(deliv).toContain("evaluator reads files");
    expect(deliv).toContain("referee file:* probes 1/");
    expect(deliverableRows(events).join("\n")).toContain("deliverables: none");
    const port = portabilityRows(log, states).join("\n");
    expect(port).toContain("host-only no, portable 1L, above-leaks 0");
    expect(port).toContain("host-paths 2, bad-shebangs 1, non-exec-bins 1");
    expect(port).toContain("exam-keys 1/2 in 1 file");
    expect(port).not.toContain("secretKeyAlpha");
    expect(port).not.toContain("/Users/");
    const xfer = transferRows(log).join("\n");
    expect(xfer).toContain("1 raw-measure leaks");
    expect(xfer).toContain("epoch practice scoping:");
    const diag = diagnosticRows(log, states).join("\n");
    expect(diag).toContain("unused harness bins:");
    expect(diag).toContain("compaction amnesia:");
    expect(diag).toContain("patience burn: 4/6");
    expect(diag).toContain("examiner inefficiency:");
  });

  it("fires lanes 20-23 component triggers, readers, and HOST_ONLY portability leaks", () => {
    const cleanDigest = "b".repeat(64);
    const leakDigest = "c".repeat(64);
    const states = join(dir, "port-states");
    for (const [d, guide] of [
      [cleanDigest, "# Guide\nUse tool.\n\n## Validity and score\nRead public/task.json and submit.\n"],
      [
        leakDigest,
        "# Guide\nRead public/task.json and write answer.json then submit.\n\n## Validity and score\nDone.\n",
      ],
    ] as const) {
      const agentDir = join(states, d, "agent");
      mkdirSync(agentDir, { recursive: true });
      writeFileSync(join(agentDir, "BUILT_AGENTS.md"), guide);
    }
    const portText = portabilityRows(
      [
        { at: AT, kind: "harness.promoted", data: { harness: cleanDigest, from: "hp" } },
        { at: AT, kind: "harness.promoted", data: { harness: leakDigest, from: cleanDigest } },
      ],
      states,
    ).join("\n");
    expect(portText).toContain(
      `${cleanDigest.slice(0, 8)} (promoted): guide 4L (host-only yes, portable 2L, above-leaks 0, above-keys 0, above-rules 0)`,
    );
    expect(portText).toContain(
      `${leakDigest.slice(0, 8)} (promoted): guide 4L (host-only yes, portable 2L, above-leaks 3, above-keys 0, above-rules 0)`,
    );

    const examsDir = join(dir, "exams");
    const draft = {
      domain: "stats",
      scope: "s",
      conventions: "c",
      rules: [{ id: "R1", statement: "ok", source: "s" }],
      answerFormat: { type: "object", properties: { v: { type: "number" } } },
      checks: [{ id: "check-domain", rule: "R1", assertion: "a", tools: ["python3"] }],
      evaluator: "export const checks = {};",
      objectiveTools: ["python3"],
      tasks: [{ family: "f", publicInput: {}, hidden: null }],
      accept: [],
      reject: [],
    };
    const draftHash = requireJsonValue(draft);
    const cond = conditionOf("v-held", cleanDigest, { wallSeconds: 100, turns: 8 });
    const cid = conditionId(cond);
    const compLog: readonly LogEvent[] = [
      { at: AT, kind: "draft.started", data: { session: "d-1" } },
      {
        at: AT,
        kind: "referee.draft",
        data: {
          session: "d-1",
          pass: 1,
          verdict: "defects",
          findings: [{ kind: "vacuous-pass", task: "ex-001", probe: 1, reason: "SECRET-REF-PROSE" }],
          probeRows: [{ id: 1 }],
          turns: 5,
          billed: 1.5,
        },
      },
      {
        at: AT,
        kind: "referee.draft.refused",
        data: { session: "d-1", pass: 1, ruling: "defects", why: "SECRET-WHY" },
      },
      {
        at: AT,
        kind: "referee.draft",
        data: {
          session: "d-1",
          pass: 2,
          verdict: "defects",
          findings: [{ kind: "objective-defect", task: "ex-002", probe: 2, reason: "SECRET-PASS2" }],
          probeRows: [{ id: 1 }, { id: 2 }],
          turns: 4,
          billed: 1.4,
        },
      },
      {
        at: AT,
        kind: "referee.draft",
        data: {
          session: "d-2",
          pass: 1,
          verdict: "skipped",
          findings: [],
          probeRows: [],
          turns: 1,
          billed: 0.2,
        },
      },
      { at: AT, kind: "exam.drafted", data: { session: "d-1", draft: draftHash } },
      { at: AT, kind: "draft.finished", data: { session: "d-1", ended: "finished", billed: 5 } },
      {
        at: AT,
        kind: "checker.read",
        data: { rows: [{ id: "check-domain", instrument: "author" }] },
      },
      { at: AT, kind: "contract.frozen", data: { contract: "c1", checks: "k1", admitted: ["check-domain"] } },
      {
        at: AT,
        kind: "task.proposed",
        data: {
          version: "v-held",
          taskId: "x-1-009",
          task: { taskId: "x-1-009", family: "f", publicInput: {} },
        },
      },
      { at: AT, kind: "task.gate", data: { version: "v-held", gate: 1, outcome: "passed" } },
      { at: AT, kind: "build.started", data: { session: "b-1", parent: "hp" } },
      {
        at: AT,
        kind: "build.call",
        data: {
          session: "b-1",
          turn: 1,
          tool: "practice",
          args: {},
          text: "failed check-domain on x-1-009",
          isError: false,
          ms: 5,
        },
      },
      {
        at: AT,
        kind: "build.finished",
        data: { session: "b-1", ended: "finished", harness: cleanDigest, billed: 6 },
      },
      { at: AT, kind: "condition.recorded", data: { id: cid, condition: requireJsonValue(cond) } },
      {
        at: AT,
        kind: "comparison.started",
        data: {
          session: "g-1",
          old: "hp",
          fresh: cleanDigest,
          starter: "hp",
          tasks: ["v-held"],
          retained: [],
        },
      },
      { at: AT, kind: "solve.started", data: { solve: "sn1", condition: cid, comparison: "g-1" } },
      {
        at: AT,
        kind: "solve.finished",
        data: { solve: "sn1", ending: { outcome: "pass" }, network: "uv", seconds: 10, billed: 2 },
      },
      { at: AT, kind: "solve.started", data: { solve: "sn2", condition: cid, comparison: "g-1" } },
      {
        at: AT,
        kind: "solve.finished",
        data: {
          solve: "sn2",
          ending: { outcome: "non-result", kind: "verifier" },
          network: "unreached",
          seconds: 10,
          billed: 1,
        },
      },
      {
        at: AT,
        kind: "verdict",
        data: { solve: "sn2", task: "v-held", kind: "faulty", reason: "SECRET-FAULT" },
      },
      { at: AT, kind: "campaign.word", data: { word: "pause", after: "reported", base: 0, why: "promo 2" } },
      {
        at: AT,
        kind: "comparison.reported",
        data: {
          session: "g-1",
          old: "hp",
          fresh: cleanDigest,
          starter: "hp",
          reading: "no-step",
          scored: { wins: 1, losses: 1, ties: 0 },
        },
      },
      // Overshoot comparison started AFTER pause(--after reported, base 0) was already reached
      {
        at: AT,
        kind: "comparison.started",
        data: {
          session: "g-2",
          old: "hp",
          fresh: cleanDigest,
          starter: "hp",
          tasks: ["v-held"],
          retained: [],
        },
      },
    ];

    const fired = overview(compLog).triggers;
    const byName = (name: keyof typeof TRIGGERS) => fired.filter((trigger) => trigger.name === name);
    expect(byName("DRAFT AUDITED")[0]).toMatchObject({ lane: TRIGGERS["DRAFT AUDITED"] });
    expect(byName("DRAFT AUDIT DEFECTS")[0]).toMatchObject({ lane: TRIGGERS["DRAFT AUDIT DEFECTS"] });
    expect(byName("DRAFT AUDIT DEFECTS")[0]?.detail).toContain("unverified final pass");
    expect(byName("DRAFT AUDIT REFUSED")[0]).toMatchObject({ lane: TRIGGERS["DRAFT AUDIT REFUSED"] });
    expect(byName("DRAFT AUDIT SKIPPED")[0]).toMatchObject({ lane: TRIGGERS["DRAFT AUDIT SKIPPED"] });
    expect(byName("VERIFIER TOOL PROVENANCE")[0]).toMatchObject({
      lane: TRIGGERS["VERIFIER TOOL PROVENANCE"],
    });
    expect(byName("VERIFIER FAULTS")[0]).toMatchObject({ lane: TRIGGERS["VERIFIER FAULTS"] });
    expect(byName("NETWORK PARITY MISMATCH")[0]).toMatchObject({ lane: TRIGGERS["NETWORK PARITY MISMATCH"] });
    expect(byName("NETWORK PARITY MISMATCH")[0]?.detail).toContain("g-1 (unreached vs uv)");
    expect(byName("WALL BOUNDARY SIGNAL")[0]).toMatchObject({ lane: TRIGGERS["WALL BOUNDARY SIGNAL"] });
    expect(byName("SEAT BOUNDARY ANOMALY")[0]).toMatchObject({ lane: TRIGGERS["SEAT BOUNDARY ANOMALY"] });
    expect(byName("SEAT BOUNDARY ANOMALY")[0]?.detail).toContain(
      "pause overshoot: g-2 after pause(reported)",
    );
    expect(byName("ROLE YIELD SKEW")[0]).toMatchObject({ lane: TRIGGERS["ROLE YIELD SKEW"] });

    const daText = draftAuditRows(compLog).join("\n");
    expect(daText).toContain("final-pass unverified defects: yes (1)");
    expect(daText).not.toContain("SECRET-REF-PROSE");
    expect(daText).not.toContain("SECRET-WHY");
    const grText = groundingRows(compLog, examsDir).join("\n");
    expect(grText).toContain("1 drafted check (1 with tools)");
    expect(grText).not.toContain("SECRET-FAULT");
    const waText = wallAuditRows(compLog).join("\n");
    expect(waText).toContain("check-ids 1, held-tasks 1");
    expect(waText).toContain("g-1 (unreached vs uv)");
    const seatText = seatSummaryRows(compLog).join("\n");
    expect(seatText).toContain("referee.draft:");
    expect(seatText).toContain("pause overshoots: g-2 after pause(reported)");
  });

  it("fires lane 24 reward-hacking triggers and keeps gaming.txt wall-safe", () => {
    const STAMP = "2026-11-23T12:00:00.000Z";
    const pracCond = conditionOf("v-prac", "h-cand");
    const pracCid = conditionId(pracCond);
    const practiceSolves: LogEvent[] = Array.from({ length: 6 }, (_, index) => [
      {
        at: STAMP,
        kind: "solve.started" as const,
        data: { solve: `p-${String(index)}`, condition: pracCid, task: "v-prac", version: "v-prac" },
      },
      {
        at: STAMP,
        kind: "solve.finished" as const,
        data: {
          solve: `p-${String(index)}`,
          ending: { outcome: "pass" },
          seconds: 20,
          billed: 0.2,
        },
      },
    ]).flat();
    const clusterSolves: LogEvent[] = [0, 1, 2].flatMap((index) => {
      const task = `v-c${String(index)}`;
      const cond = conditionOf(task, "h-cand");
      const cid = conditionId(cond);
      return [
        {
          at: STAMP,
          kind: "condition.recorded" as const,
          data: { id: cid, condition: requireJsonValue(cond) },
        },
        {
          at: STAMP,
          kind: "solve.started" as const,
          data: { solve: `sc-${String(index)}`, condition: cid, comparison: "g-1", task, version: task },
        },
        {
          at: STAMP,
          kind: "solve.finished" as const,
          data: {
            solve: `sc-${String(index)}`,
            ending: { outcome: "pass" },
            seconds: 10,
            billed: 0.2,
          },
        },
        {
          at: STAMP,
          kind: "verdict" as const,
          data: {
            solve: `sc-${String(index)}`,
            task,
            kind: "pass",
            checks: [],
            objective: 42.5,
            reason: "SECRET-VERDICT",
          },
        },
      ];
    });
    const gamingLog: LogEvent[] = [
      { at: STAMP, kind: "condition.recorded", data: { id: pracCid, condition: requireJsonValue(pracCond) } },
      { at: STAMP, kind: "draft.started", data: { session: "d-1", prompt: "SECRET-PROMPT" } },
      {
        at: STAMP,
        kind: "draft.call",
        data: {
          session: "d-1",
          turn: 1,
          tool: "draft_exam",
          args: {
            rules: [{ id: "r1" }, { id: "r2" }],
            checks: [{ id: "check-a" }, { id: "check-b" }, { id: "check-c" }],
          },
          text: "The draft does not stand.",
          isError: false,
        },
      },
      {
        at: STAMP,
        kind: "draft.call",
        data: {
          session: "d-1",
          turn: 2,
          tool: "draft_exam",
          args: { rules: [{ id: "r1" }], checks: [{ id: "check-a" }] },
          text: "The draft stands",
          isError: false,
        },
      },
      {
        at: STAMP,
        kind: "referee.draft",
        data: {
          session: "d-1",
          pass: 1,
          verdict: "defects",
          findings: [
            { kind: "vacuous-pass", task: "ex-1", probe: 1, reason: "SECRET-AUDIT-1" },
            { kind: "vacuous-pass", task: "ex-1", probe: 2, reason: "SECRET-AUDIT-2" },
          ],
          summary: "SECRET-SUMMARY",
          probeRows: [{ id: 1 }, { id: 2 }],
          turns: 3,
          billed: 0.5,
        },
      },
      {
        at: STAMP,
        kind: "exam.drafted",
        data: {
          session: "d-1",
          draft: {
            domain: "stat",
            scope: "SECRET-SCOPE",
            conventions: "SECRET-CONV",
            rules: [{ id: "r1", statement: "SECRET-RULE" }],
            answerFormat: { type: "object" },
            checks: [{ id: "check-a", rule: "r1", assertion: "SECRET-ASSERT" }],
            evaluator: "export default () => ({});",
            objective: { quantity: "SECRET-OBJ", direction: "lower" },
            tasks: [],
            accept: [],
            reject: [],
          },
        },
      },
      { at: STAMP, kind: "task.proposed", data: { version: "v-prac", taskId: "t-prac", family: "fam-a" } },
      { at: STAMP, kind: "task.gate", data: { version: "v-prac", gate: 1, outcome: "passed" } },
      { at: STAMP, kind: "task.state", data: { version: "v-prac", state: "released" } },
      { at: STAMP, kind: "build.started", data: { session: "b-1", parent: "h-parent" } },
      ...practiceSolves,
      ...clusterSolves,
      { at: STAMP, kind: "build.checkpoint", data: { session: "b-1", harness: "h-untried-1" } },
      {
        at: STAMP,
        kind: "comparison.started",
        data: { session: "g-1", old: "h-parent", fresh: "h-untried-1", tasks: ["v-c0"], retained: [] },
      },
      {
        at: STAMP,
        kind: "comparison.reported",
        data: {
          session: "g-1",
          old: "h-parent",
          fresh: "h-untried-1",
          starter: "h-parent",
          reading: "no-step",
          scored: { wins: 0, losses: 1, ties: 0 },
        },
      },
      { at: STAMP, kind: "build.checkpoint", data: { session: "b-1", harness: "h-untried-2" } },
      {
        at: STAMP,
        kind: "comparison.started",
        data: { session: "g-2", old: "h-parent", fresh: "h-untried-2", tasks: ["v-c1"], retained: [] },
      },
      {
        at: STAMP,
        kind: "comparison.reported",
        data: {
          session: "g-2",
          old: "h-parent",
          fresh: "h-untried-2",
          starter: "h-parent",
          reading: "no-step",
          scored: { wins: 0, losses: 1, ties: 0 },
        },
      },
      {
        at: STAMP,
        kind: "build.finished",
        data: { session: "b-1", ended: "finished", harness: "h-untried-2" },
      },
    ];

    const fired = overview(gamingLog).triggers;
    const byName = (name: keyof typeof TRIGGERS) => fired.filter((trigger) => trigger.name === name);
    expect(byName("DRAFT RULE DROP")[0]).toMatchObject({ lane: TRIGGERS["DRAFT RULE DROP"] });
    expect(byName("DRAFT RULE DROP")[0]?.detail).toContain("checks [3->1]");
    expect(byName("DRAFT RULE DROP")[0]?.detail).toContain("rules [2->1]");
    expect(byName("PRACTICE HILL-CLIMBING")[0]).toMatchObject({ lane: TRIGGERS["PRACTICE HILL-CLIMBING"] });
    expect(byName("PRACTICE HILL-CLIMBING")[0]?.detail).toContain("max 6/task");
    expect(byName("PRACTICE HILL-CLIMBING")[0]?.detail).toContain("2 untried compared candidates");
    expect(byName("SPECIFICATION GAMING LEAD")[0]).toMatchObject({
      lane: TRIGGERS["SPECIFICATION GAMING LEAD"],
    });
    expect(byName("SPECIFICATION GAMING LEAD")[0]?.detail).toContain("ceremony-only");
    expect(byName("SPECIFICATION GAMING LEAD")[0]?.detail).toContain("identical-objective cluster");

    const text = gamingRows(gamingLog).join("\n");
    expect(text).toContain("draft-rule-drop");
    expect(text).toContain("audit-ceremony-only");
    expect(text).toContain("practice-hill-climbing");
    expect(text).toContain("untried-compare-fishing");
    expect(text).toContain("repeated-objective-cluster");
    expect(text).not.toContain("SECRET-");
  });

  it("enforces cluster-6 WRI detector accuracy across wall-audit, portability, diagnostics, fast-pass, tmp, margins, and live examiners", () => {
    const STAMP = "2026-11-23T18:00:00.000Z";
    const candDigest = "d".repeat(64);
    const shortCand = candDigest.slice(0, 8);
    const states = join(dir, "cluster6-states");
    const binDir = join(states, candDigest, ".toolchain", "bin");
    const agentDir = join(states, candDigest, "agent");
    mkdirSync(binDir, { recursive: true });
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      join(agentDir, "BUILT_AGENTS.md"),
      "# Guide\nEnsure record_id obeys R1 and check output.\n\n## Validity and score\nSubmit answer.json.\n",
    );
    writeFileSync(
      join(binDir, "write-package"),
      "#!/usr/bin/env python3\nimport subprocess\nsubprocess.run(['check-package'])\n",
    );
    writeFileSync(join(binDir, "check-package"), "#!/usr/bin/env python3\nprint('ok')\n");
    writeFileSync(join(binDir, "dead-cli"), "#!/usr/bin/env python3\nprint('dead')\n");
    chmodSync(join(binDir, "write-package"), 0o755);
    chmodSync(join(binDir, "check-package"), 0o755);
    chmodSync(join(binDir, "dead-cli"), 0o755);

    const compCond = conditionOf("v-held", candDigest, { wallSeconds: 1800, turns: 20 });
    const compCondId = conditionId(compCond);
    const pracCond = conditionOf("v-prac", candDigest, { wallSeconds: 1800, turns: 20 });
    const pracCondId = conditionId(pracCond);
    const cluster6Log: readonly LogEvent[] = [
      { at: STAMP, kind: "campaign.opened", data: { budget: { dollars: 100, reserve: 1 } } },
      {
        at: STAMP,
        kind: "exam.drafted",
        data: {
          draft: {
            rules: [{ id: "R1", statement: "Required rule" }],
            answerFormat: {
              type: "object",
              properties: {
                rows: { type: "array", items: { type: "object", properties: { record_id: {} } } },
              },
            },
            checks: [{ id: "check-r1", assertion: "valid" }],
          },
        },
      },
      { at: STAMP, kind: "task.proposed", data: { version: "v-held", taskId: "x-1-001", session: "x-1" } },
      { at: STAMP, kind: "task.proposed", data: { version: "v-prac", taskId: "x-1-002", session: "x-1" } },
      // Builder references x-1-002 BEFORE it is released -> must flag time-indexed held-task leak!
      {
        at: STAMP,
        kind: "build.call",
        data: {
          session: "b-1",
          turn: 1,
          tool: "bash",
          args: { command: "echo hi > /tmp/x" },
          text: "Operation not permitted on /tmp/x while reading x-1-002 and referee.draft",
          isError: false,
        },
      },
      { at: STAMP, kind: "task.gate", data: { version: "v-prac", gate: 1, outcome: "passed" } },
      { at: STAMP, kind: "task.state", data: { version: "v-prac", state: "released" } },
      { at: STAMP, kind: "build.checkpoint", data: { session: "b-1", harness: candDigest } },
      // Examiner wake call mentions 8-char short digest -> must flag exam harness-digests leak!
      {
        at: STAMP,
        kind: "exam.started",
        data: { session: "x-live", conversation: "x-1" },
      },
      {
        at: STAMP,
        kind: "exam.call",
        data: {
          session: "x-live",
          turn: 1,
          tool: "read_opening",
          args: {},
          text: `Ref ${shortCand}`,
          isError: false,
        },
      },
      {
        at: STAMP,
        kind: "condition.recorded",
        data: { id: compCondId, condition: requireJsonValue(compCond) },
      },
      {
        at: STAMP,
        kind: "condition.recorded",
        data: { id: pracCondId, condition: requireJsonValue(pracCond) },
      },
      // Practice solve runs dead-cli (must NOT mask dead-cli from comparison solves!).
      { at: STAMP, kind: "solve.started", data: { solve: "sp-1", condition: pracCondId, side: "practice" } },
      {
        at: STAMP,
        kind: "solve.call",
        data: {
          solve: "sp-1",
          turn: 1,
          tool: "bash",
          args: { command: "dead-cli" },
          isError: false,
          text: "",
        },
      },
      {
        at: STAMP,
        kind: "solve.finished",
        data: { solve: "sp-1", ending: { outcome: "pass" }, seconds: 20, turns: 7 },
      },
      // 4 comparison solves run write-package (which invokes check-package internally), all 7 turns < 90s (must NOT trigger PASSES AT A SMALL WALL SHARE).
      ...Array.from({ length: 4 }, (_, nth): LogEvent[] => [
        {
          at: STAMP,
          kind: "solve.started",
          data: { solve: `sc-${String(nth)}`, condition: compCondId, comparison: "g-1" },
        },
        {
          at: STAMP,
          kind: "solve.call",
          data: {
            solve: `sc-${String(nth)}`,
            turn: 1,
            tool: "bash",
            args: { command: "write-package" },
            isError: false,
            text: "",
          },
        },
        {
          at: STAMP,
          kind: "solve.finished",
          data: { solve: `sc-${String(nth)}`, ending: { outcome: "pass" }, seconds: 45, turns: 7 },
        },
      ]).flat(),
      {
        at: STAMP,
        kind: COMPARISON_STARTED,
        data: { session: "g-1", old: "h-starter", fresh: candDigest, starter: "h-starter" },
      },
      {
        at: STAMP,
        kind: "comparison.reported",
        data: {
          session: "g-1",
          old: "h-starter",
          fresh: candDigest,
          starter: "h-starter",
          reading: "no-step",
          scored: { wins: 1, losses: 1, ties: 0 },
        },
      },
    ];

    const wallText = wallAuditRows(cluster6Log).join("\n");
    expect(wallText).toContain("network-parity: unobserved");
    expect(wallText).toContain("held-tasks 1");
    expect(wallText).toContain("internal-kinds 1");
    expect(wallText).toContain("harness-digests 1");

    const portText = portabilityRows(cluster6Log, states).join("\n");
    expect(portText).toContain("above-leaks 0, above-keys 1, above-rules 1");
    expect(portText).not.toContain("record_id");

    const diagText = diagnosticRows(cluster6Log, states).join("\n");
    // 3 bins shipped; write-package ran, check-package credited via write-package, ONLY dead-cli (1) unused despite practice call.
    expect(diagText).toContain("shipped 3 bin programs, 1 never invoked across 4 comparison solves");

    const firedNames = overview(cluster6Log).triggers.map(({ name }) => name);
    expect(firedNames).not.toContain("PASSES AT A SMALL WALL SHARE");
    expect(firedNames).not.toContain("SHARED TEMPORARY FOLDER");
    expect(firedNames).not.toContain("EXAMINER NEVER FINISHED");
  });

  it("matches whole identifier-bounded tokens without regex escapes and detects pause overshoots across padded traces", () => {
    for (const [haystack, needle, expected] of [
      ["", "", false],
      ["check-a.b+1", "check-a.b+1", true],
      ["xcheck-a and check-a_1 and (check-a)!", "check-a", true],
      ["prefix_tok and tok-suffix and 9tok", "tok", false],
      ["$price[0] == 1", "$price[0]", true],
    ] as const) {
      expect(hasWholeToken(haystack, needle)).toBe(expected);
    }

    const padded: LogEvent[] = [
      { at: AT, kind: "campaign.word", data: { word: "pause", after: "reported", base: 0 } },
      ...Array.from(
        { length: 200 },
        (_, i): LogEvent => ({
          at: AT,
          kind: "solve.call",
          data: { solve: `s-${String(i)}`, tool: "bash", text: "" },
        }),
      ),
      {
        at: AT,
        kind: "comparison.reported",
        data: { session: "g-1", old: "h0", fresh: "h1", starter: "h0", reading: "no-step" },
      },
      {
        at: AT,
        kind: COMPARISON_STARTED,
        data: { session: "g-2", old: "h0", fresh: "h2", starter: "h0" },
      },
    ];
    expect(seatSummaryRows(padded)[0]).toContain("pause overshoots: g-2 after pause(reported)");
  });
});
