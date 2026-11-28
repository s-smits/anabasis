// What the investigation reads from a log and from a lane's report, each as one table over the
// synthetic campaign: the overview's rows agree with the production folds that own each count, each
// trigger fires on its lane with its count, the catalogue names every trigger the reader can fire,
// and a report is collected as a finding, no finding or could not read only when its fields are even.
import { loadRuns } from "#skills/main/runs.ts";
import { afterAll, describe, expect, it } from "bun:test";
import {
  REPORTED as COMPARISON_REPORTED,
  STARTED as COMPARISON_STARTED,
} from "../src/campaign/comparison.ts";
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
import { catalogueText, type Lane, lanesOf, ownersOf, REFERENCES, section } from "../tools/wri/catalogue.ts";
import { draftAuditRows, groundingRows, seatSummaryRows, wallAuditRows } from "../tools/wri/components.ts";
import { continuityRows } from "../tools/wri/continuity.ts";
import { deliverableRows } from "../tools/wri/deliverables.ts";
import { READERS } from "../tools/wri/derive.ts";
import { diagnosticRows } from "../tools/wri/diagnostics.ts";
import { findingsLedger, vettingFaults } from "../tools/wri/findings.ts";
import { rowsOf } from "../tools/wri/ledger.ts";
import { epochSpendLines } from "../tools/wri/epoch-spend.ts";
import { executionRows } from "../tools/wri/execution.ts";
import { indexOf, TRIGGERS } from "../tools/wri/folds.ts";
import { rankCatalogue } from "../tools/wri/rank-lanes.ts";
import { gamingRows } from "../tools/wri/gaming.ts";
import { reportIndex, reportOf, ROWS, sessionsOf } from "../tools/wri/investigation.ts";
import { buildPackets } from "../tools/wri/packets.ts";
import { pairRows, sideGap } from "../tools/wri/pairs.ts";
import { portabilityRows } from "../tools/wri/portability.ts";
import { spentTo } from "../tools/wri/promotion.ts";
import { overview } from "../tools/wri/read.ts";
import { scoreRows } from "../tools/wri/scores.ts";
import { clockOf } from "../tools/wri/trajectory.ts";
import { transferRows } from "../tools/wri/transfer.ts";
import { conditionOf } from "./helpers/logged-round.ts";
import { wriCampaign } from "./helpers/wri-campaign.ts";

const [SOLVE_STARTED, SOLVE_FINISHED, SOLVE_CALL] = [
  "solve.started",
  "solve.finished",
  "solve.call",
] as const;
const EXAM_DRAFTED = "exam.drafted";
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

  it("collects no file as missing, and tables each finding under its kind's number with its marks and pointer", () => {
    expect(reportOf(lane(4), null, owners, one).state).toBe("missing");
    const seen = "Seen in: buffer-a comparison.reported{1,~1} Builder:b-1{4-7}\n";
    const report = reportOf(
      lane(4),
      `${head}\nVerdict: finding, three.\n${finding("Misreading: First", seen)}${finding("leak: Second", seen)}${finding("misreading: Third | fourth", seen)}`,
      owners,
      one,
    );
    expect(report.faults).toEqual([]);
    const index = reportIndex([report], (number) => `/r/${String(number)}.md`, []);
    expect(index).toContain("- lane 4: ok, finding, 3 findings, at `/r/4.md`");
    expect(rowsOf(index, "id")).toEqual(
      [
        ["lane4-misreading1", "First"],
        ["lane4-leak1", "Second"],
        ["lane4-misreading2", "Third / fourth"],
      ].map(([id = "", title = ""]) => [
        id,
        "pack/evaluator",
        "confirmed",
        "plausible",
        title,
        "buffer-a comparison.reported{1,~1} Builder:b-1{4-7}",
        "whether a repair is owed",
      ]),
    );
    const untitled = reportOf(lane(4), `${head}\nVerdict: finding, one.\n${finding()}`, owners, one);
    expect(untitled.written.map(({ id }) => id)).toEqual(["lane4-finding1"]);
    const vetting = (named: string) =>
      `| id | finding | lanes | standing | owner | importance | verdict | fate |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n| vet-1 | f | ${named} | new | host | I2 | plausible | |`;
    const unnamed = (named: string) =>
      vettingFaults(vetting(named), index, []).filter((f) => f.startsWith("no row"));
    expect(unnamed("lane4-misreading1, lane4-leak1")).toEqual([
      "no row names the lane findings lane4-misreading2",
    ]);
    expect(unnamed("4")).toEqual([]);
    expect(
      vettingFaults(
        vetting("primary"),
        "- lane 3: ok, finding, 1 finding, at `x`\n  - 3.1, observation confirmed",
        [],
      ),
    ).toEqual(["no row names the lane findings 3.1"]);
    const counted = "- lane 3: ok, finding, 2 findings, at `x`\n- lane 5: invalid, no Verdict line, at `y`\n";
    expect(vettingFaults(vetting("primary"), counted, [])).toEqual([
      "no row names the lane findings 3.1, 3.2",
    ]);
    expect(vettingFaults(vetting("3"), counted, [])).toEqual([]);
  });

  it("hands each operator question to its lanes, enforces status verdicts, computes a scorecard, and flags conflicts", () => {
    const questions = section(readFileSync(join(REFERENCES, "questions.md"), "utf8"), "Questions");
    const prediction = "| id | lanes | prediction |\n| --- | --- | --- |\n| p1 | 4 | the tolerance holds |";
    const decoy = "| id | lanes | question |\n| --- | --- | --- |\n| Q999 | 4 | decoy outside section |";
    const text = `## Orientation\n\n${decoy}\n\n## Operator questions\n\n${questions}\n| Q0 | 1, 20 | asked of lanes that may see no framing | none |\n\n## The moved variable\n\n${prediction}`;
    const ids = [...questions.matchAll(/^\| (Q\d+) \|/gmu)].map(([, id = ""]) => id);
    expect(ids).toHaveLength(55);
    const owedBy = new Map(
      lanes.map((each) => {
        const fault =
          reportOf(
            each,
            `# Lane ${String(each.number)}: x\nVerdict: no finding.\n`,
            owners,
            one,
            text,
          ).faults.find((said) => said.includes("operator's questions")) ?? "";
        return [each, [...fault.matchAll(/Q\d+/gu)].map(([id]) => id)];
      }),
    );
    const open = lanes.filter((each) => !each.blind && !each.isolated);
    expect(open.filter((each) => (owedBy.get(each) ?? []).length === 0).map(({ number }) => number)).toEqual(
      [],
    );
    expect(lanes.filter((each) => !open.includes(each)).flatMap((each) => owedBy.get(each) ?? [])).toEqual(
      [],
    );
    expect(new Set([...owedBy.values()].flat())).toEqual(new Set(ids));
    const owed4 = owedBy.get(lane(4)) ?? [];
    expect(owed4).not.toContain("Q999");
    const missingStatus = `${head}\nVerdict: no finding.\n## Predictions\nPrediction p1: held, 3 of 3\n## Questions\n${owed4.map((id) => `Question ${id}: 5 of 9 passes, \`checks.txt\``).join("\n")}\n`;
    expect(reportOf(lane(4), missingStatus, owners, one, text).state).toBe("invalid");
    const naturalNo = `${head}\nVerdict: no finding.\n## Predictions\nPrediction p1: held, 3 of 3\n## Questions\n${owed4.map((id) => `Question ${id}: no gaming found, 0 of 12 solves, \`gaming.txt\``).join("\n")}\n`;
    expect(reportOf(lane(4), naturalNo, owners, one, text).state).toBe("invalid");
    const bareStatus = `${head}\nVerdict: no finding.\n## Predictions\nPrediction p1: held, 3 of 3\n## Questions\n${owed4.map((id) => `Question ${id}: **yes**`).join("\n")}\n`;
    expect(reportOf(lane(4), bareStatus, owners, one, text).state).toBe("invalid");

    const written4 = `${head}\nVerdict: no finding.\n## Predictions\nPrediction p1: held, 3 of 3\n## Questions\n${owed4.map((id, idx) => `Question ${id}: ${idx === 0 ? "**yes**" : "yes"}, 5 of 9 passes, \`checks.txt\``).join("\n")}\n`;
    const answered4 = reportOf(lane(4), written4, owners, one, text);
    expect(answered4).toMatchObject({ state: "ok", faults: [], resolved: { p1: "confirmed" } });
    expect(reportOf(lane(4), written4.replaceAll("\n", "\r\n"), owners, one, text)).toMatchObject({
      state: "ok",
      resolved: { p1: "confirmed" },
    });
    const owed7 = owedBy.get(lane(7)) ?? [];
    const written7 = `# Lane 7: supply\nVerdict: no finding.\n## Questions\n${owed7.map((id) => `Question ${id}: no, 0 of 12 valid room, \`ambition.txt\``).join("\n")}\n`;
    const answered7 = reportOf(lane(7), written7, owners, one, text);
    expect(answered7.state).toBe("ok");
    const invalid11 = reportOf(
      lane(11),
      `# Lane 11: exam\nVerdict: finding.\n## Questions\n${(owedBy.get(lane(11)) ?? []).map((id) => `Question ${id}: yes, 1/1, \`drafted.txt\``).join("\n")}\n`,
      owners,
      one,
      text,
    );
    expect(invalid11.state).toBe("invalid");

    const unframed = new Set(lanes.filter((each) => each.blind || each.isolated).map(({ number }) => number));
    const index = reportIndex(
      [answered4, answered7, invalid11],
      (number) => `/r/${String(number)}.md`,
      [],
      text,
      unframed,
    );
    expect(index).toContain("- p1: confirmed by lane 4");
    const scorecardLine = index.split("\n").find((line) => line.includes("Scorecard:")) ?? "";
    expect(scorecardLine).toContain("2 conflict");
    expect(scorecardLine).toContain("incomplete");
    const bucketSum = [
      ...scorecardLine.matchAll(/(\d+) (?:yes|partial|no|unmeasured|conflict|incomplete|unanswered)/gu),
    ].reduce((sum, [, n]) => sum + Number(n), 0);
    expect(bucketSum).toBe(55);
    expect(index).toMatch(/- Q16: [^\n]*\(conflict: lane 4 yes vs lane 7 no\)/u);
    expect(index).toMatch(/- Q20: [^\n]*no line from lane 11/u);
    expect(index).not.toContain("- Q0:");
    expect(index).not.toContain("- Q999:");
    expect(index).toMatch(/- Q1: [^\n]* \(lane 6, 13 not opened\)/u);
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
        kind: EXAM_DRAFTED,
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
        kind: EXAM_DRAFTED,
        data: { draft: { evaluator: "type Req = { artifact: any; files?: any };" } },
      },
      { at: AT, kind: "verdict", data: { solve: "s1", task: "v1", kind: "pass" } },
    ]).triggers;
    expect(silent.find((trigger) => trigger.name === "NO DELIVERABLES CAPTURED")).toBeUndefined();
  });

  it("fires FAMILY CONCENTRATION run-wide and per writing session without printing the family name", () => {
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

    const x1Ids = Array.from({ length: 10 }, (_, i) => `a-${String(i)}`);
    const x2Ids = Array.from({ length: 6 }, (_, i) => `b-${String(i)}`);
    const sessionTasks: LogEvent[] = [
      ...x1Ids.flatMap((version, i) => [
        {
          at: AT,
          kind: "task.proposed" as const,
          data: { version, task: { taskId: version, family: `SECRET-FAM-${String(i)}`, publicInput: {} } },
        },
        { at: AT, kind: "task.gate" as const, data: { version, gate: 1, outcome: "passed" } },
      ]),
      { at: AT, kind: "exam.finished", data: { session: "x-1", held: x1Ids } },
      ...x2Ids.flatMap((version) => [
        {
          at: AT,
          kind: "task.proposed" as const,
          data: { version, task: { taskId: version, family: "SECRET-CLONE-FAM", publicInput: {} } },
        },
        { at: AT, kind: "task.gate" as const, data: { version, gate: 1, outcome: "passed" } },
      ]),
      { at: AT, kind: "exam.finished", data: { session: "x-2", held: x2Ids } },
    ];
    const perSession = overview(sessionTasks).triggers.find((each) => each.name === "FAMILY CONCENTRATION");
    expect(perSession).toMatchObject({ lane: TRIGGERS["FAMILY CONCENTRATION"] });
    expect(perSession?.detail).toContain("by session: x-2 6 of 6 (1 family)");
    expect(perSession?.detail).not.toContain("SECRET-");
  });

  it("counts zero-billed compactions in BILLING RESIDUAL and epoch-spend only for open sessions", () => {
    const endedOnly: LogEvent[] = [
      { at: AT, kind: "exam.started", data: { session: "x-1" } },
      {
        at: AT,
        kind: "exam.compacted",
        data: { session: "x-1", tokensBefore: 90_000, seconds: 5, usages: [] },
      },
      {
        at: AT,
        kind: "exam.finished",
        data: { session: "x-1", ended: "finished", billed: 1, reportedCost: 1 },
      },
    ];
    expect(overview(endedOnly).triggers.find((each) => each.name === "BILLING RESIDUAL")).toBeUndefined();
    expect(epochSpendLines(endedOnly).at(-1)).toContain("0 unpriced compactions");

    const withOpen: LogEvent[] = [
      ...endedOnly,
      { at: AT, kind: "build.started", data: { session: "b-1", parent: "h1" } },
      {
        at: AT,
        kind: "build.compacted",
        data: { session: "b-1", tokensBefore: 80_000, seconds: 4, usages: [] },
      },
      {
        at: AT,
        kind: "build.compacted",
        data: { session: "b-1", tokensBefore: 85_000, seconds: 4, usages: [] },
      },
    ];
    const trigger = overview(withOpen).triggers.find((each) => each.name === "BILLING RESIDUAL");
    expect(trigger).toMatchObject({ lane: TRIGGERS["BILLING RESIDUAL"] });
    expect(trigger?.detail).toContain("2 open compactions with 0 locally priced usage");
    expect(epochSpendLines(withOpen).at(-1)).toContain("2 unpriced compactions");
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
        kind: EXAM_DRAFTED,
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
      { at: AT, kind: EXAM_DRAFTED, data: { session: "d-1", draft: draftHash } },
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
      // An overshoot comparison started after the pause point (`--after reported`, base 0) was reached.
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
    expect(byName("DRAFT AUDIT DEFECTS")[0]?.detail).toContain("replayed final pass");
    expect(byName("DRAFT AUDIT DEFECTS")[0]?.detail).not.toContain("unverified final pass");
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
    expect(daText).toContain("final-pass defects: replayed (1)");
    expect(daText).not.toContain("SECRET-REF-PROSE");
    expect(daText).not.toContain("SECRET-WHY");
    const unprobedLog: LogEvent[] = [
      {
        at: AT,
        kind: "referee.draft",
        data: {
          session: "d-1",
          pass: 2,
          verdict: "defects",
          findings: [
            { kind: "vacuous-pass", probe: 1 },
            { kind: "objective-defect", probe: 9 },
          ],
          probeRows: [{ id: 1 }],
          turns: 2,
          billed: 0.4,
        },
      },
      { at: AT, kind: EXAM_DRAFTED, data: { session: "d-1", draft: draftHash } },
      {
        at: AT,
        kind: "referee.draft",
        data: {
          session: "d-2",
          pass: 2,
          verdict: "defects",
          findings: [{ kind: "vacuous-pass", probe: 1 }],
          probeRows: [{ id: 1 }],
          turns: 2,
          billed: 0.3,
        },
      },
      { at: AT, kind: EXAM_DRAFTED, data: { session: "d-2", draft: draftHash } },
    ];
    expect(draftAuditRows(unprobedLog).join("\n")).toContain(
      "final-pass defects: unverified (1), replayed (1)",
    );
    expect(gamingRows(unprobedLog).join("\n")).toContain("audit-unverified-freeze");
    const unfrozenDefectLog: LogEvent[] = [
      {
        at: AT,
        kind: "referee.draft",
        data: {
          session: "d-1",
          pass: 2,
          verdict: "defects",
          findings: [{ kind: "objective-defect", probe: 1 }],
          probeRows: [{ id: 1 }],
          turns: 4,
          billed: 0.5,
        },
      },
      { at: AT, kind: "campaign.ended", data: { ending: "exam", why: "draft did not stand" } },
    ];
    expect(gamingRows(unfrozenDefectLog).join("\n")).not.toContain("audit-unverified-freeze");
    expect(draftAuditRows(unfrozenDefectLog).join("\n")).toContain("final-pass defects: none");
    const fromFileDraftLog: LogEvent[] = [
      {
        at: AT,
        kind: "draft.call",
        data: {
          session: "d-1",
          turn: 1,
          tool: "draft_exam",
          args: { checks: { from_file: "draft/checks.json" }, rules: { from_file: "draft/rules.json" } },
        },
      },
    ];
    expect(gamingRows(fromFileDraftLog).join("\n")).toContain("checks [none], rules [none]");
    const items = (weight: number) => ({
      objective: { quantity: "score", direction: "higher", items: [{ id: "a", weight }] },
    });
    const revisedLog: LogEvent[] = [
      { at: AT, kind: "exam.drafted", data: { session: "d-1", draft: items(1) } },
      { at: AT, kind: "exam.revised", data: { kind: "tune", why: "w", draft: items(3) } },
    ];
    expect(gamingRows(revisedLog).join("\n")).toContain("revised (tune)");
    expect(
      overview(unprobedLog).triggers.find((trigger) => trigger.name === "DRAFT AUDIT DEFECTS")?.detail,
    ).toContain("unverified final pass");
    expect(
      overview(unprobedLog).triggers.find((trigger) => trigger.name === "DRAFT AUDIT DEFECTS")?.detail,
    ).toContain("replayed final pass");
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
        kind: EXAM_DRAFTED,
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
    expect(byName("SPECIFICATION GAMING LEAD")[0]?.detail).toContain("identical-objective cluster");

    const text = gamingRows(gamingLog).join("\n");
    expect(text).toContain("draft-rule-drop");
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
        kind: EXAM_DRAFTED,
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
      // The Builder names x-1-002 before its release, which must flag a time-indexed held-task leak.
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
      // An Examiner wake naming an 8-character short digest must flag an exam harness-digest leak.
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
      // A practice solve runs dead-cli, which must not mask dead-cli from comparison solves.
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
      // Four comparison solves run write-package, all seven turns under 90 s: no PASSES AT A SMALL WALL SHARE.
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
    // Three bins; check-package is credited through write-package, and only dead-cli is unused.
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

  it("reads unit-scale sideGap near zero without dividing by zero or misclassifying atBest", () => {
    const unitPairs = [
      {
        task: "u-zero",
        old: [true, true],
        fresh: [true, true],
        objective: {
          direction: "higher" as const,
          scale: "unit" as const,
          old: [0, 0],
          fresh: [0.895, 0.905],
        },
      },
      {
        task: "u-low",
        old: [true],
        fresh: [true],
        objective: { direction: "lower" as const, scale: "unit" as const, old: [0.05], fresh: [0] },
      },
    ];
    const bests = new Map([
      ["u-zero", 0.9],
      ["u-low", 0],
    ]);
    const oldGap = sideGap(unitPairs, "old", bests);
    const freshGap = sideGap(unitPairs, "fresh", bests);
    expect(oldGap).toMatchObject({ read: 2, unread: 0, atBest: 0 });
    expect(oldGap.ratio).toBeCloseTo((1.9 + 1.05) / 2, 12);
    expect(freshGap).toMatchObject({ read: 2, unread: 0, atBest: 2 });
    expect(freshGap.ratio).toBeCloseTo(1, 12);
  });
});

describe("the findings ledger", () => {
  it("names each confirmed I0 or I1 row that waits on the operator in the newest window, and no other", () => {
    const root = mkdtempSync(join(tmpdir(), "wri-ledger-"));
    const vetted = ["confirmed", "plausible"].flatMap((verdict) =>
      ["I0", "I1", "I2"].flatMap((importance) =>
        ["operator", "repair"].map((fate) => ({ verdict, importance, fate })),
      ),
    );
    mkdirSync(join(root, "2026-11-26-run"));
    writeFileSync(
      join(root, "2026-11-26-run", "vetting.md"),
      [
        "| id | finding | lanes | standing | owner | importance | verdict | fate |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
        ...vetted.map(
          ({ verdict, importance, fate }, at) =>
            `| vet-${String(at + 1)} | f | primary | new | operator | ${importance} | ${verdict} | ${fate}: why |`,
        ),
      ].join("\n"),
    );
    const listed = findingsLedger(root, Date.parse("2026-11-26T00:00:00Z"), 7).filter((line) =>
      /^- I[0-3]: 2026-/u.test(line),
    );
    const owed = vetted.flatMap(({ verdict, importance, fate }, at) =>
      verdict === "confirmed" && fate === "operator" && importance !== "I2"
        ? [`- ${importance}: 2026-11-26-run vet-${String(at + 1)}`]
        : [],
    );
    expect(listed).toEqual(owed);
    expect(owed).toHaveLength(2);
    rmSync(root, { recursive: true, force: true });
  });

  it("reports corrected lane numbers and catches seat serving gaps, draft freeze deadlocks, unexercised judged lanes, and write refusals", () => {
    const at = "2026-11-26T00:00:00.000Z";
    const log: LogEvent[] = [
      {
        at,
        kind: "campaign.opened",
        data: {
          seats: {
            builder: { model: "claude/claude-opus-5-5", effort: "high" },
            examiner: { model: "claude/claude-opus-5-5", effort: "high" },
            reviewer: { model: "openai-codex/gpt-6.1-sol", effort: "medium" },
          },
          solver: { model: "claude/claude-opus-5-5", effort: "medium" },
          judged: true,
        },
      },
      { at, kind: "draft.started", data: { session: "d-1" } },
      { at, kind: "referee.draft", data: { session: "d-1", pass: 1, verdict: "defects", findings: [] } },
      { at, kind: "referee.draft", data: { session: "d-1", pass: 2, verdict: "defects", findings: [] } },
      { at, kind: "draft.finished", data: { session: "d-1", ended: "finished" } },
      {
        at,
        kind: EXAM_DRAFTED,
        data: {
          session: "d-1",
          draft: {
            objective: {
              quantity: "quality",
              direction: "higher",
              scale: "unit",
              items: [{ id: "clarity", weight: 1, kind: "judge", criterion: "Clear structure and claims" }],
            },
          },
        },
      },
      { at, kind: "campaign.ended", data: { ending: "exam", why: "unaccepted" } },
      {
        at,
        kind: "referee.turn",
        data: { reader: "r-1", turn: 1, stopReason: "error", model: null, error: "timeout" },
      },
      {
        at,
        kind: COMPARISON_STARTED,
        data: { session: "g-1", old: "starter", fresh: "cand", starter: "starter" },
      },
      {
        at,
        kind: COMPARISON_REPORTED,
        data: { session: "g-1", reading: "no-step", differences: [] },
      },
      {
        at,
        kind: "solve.call",
        data: {
          solve: "s-1",
          tool: "write",
          isError: true,
          text: "EPERM: operation not permitted, realpath '/Users/x'",
        },
      },
      {
        at,
        kind: "solve.call",
        data: {
          solve: "s-2",
          tool: "edit",
          isError: true,
          text: "EACCES: permission denied, open '/tmp/outside'",
        },
      },
    ];
    const lines = diagnosticRows(log, join(tmpdir(), "nonexistent-states-dir")).join("\n");
    expect(lines).toContain("[WARN] honesty (lane 9): seat serving gap: 1 unserved error turn (referee 1)");
    expect(lines).toContain(
      "[WARN] verdicts (lane 18): drafting failed to freeze: 2 draft-audit pass(es) (max pass 2, last defects) without contract.frozen",
    );
    expect(lines).toContain(
      "[WARN] verdicts (lane 11): unexercised judged lane: exam declared judge items yet 0 referee.pair votes completed across 1 reported comparisons",
    );
    expect(lines).toContain(
      "[WARN] honesty (lane 19): solver write/edit permission refusals: 2/2 solves hit EPERM/EACCES",
    );

    const clear = diagnosticRows([], join(tmpdir(), "nonexistent-states-dir")).join("\n");
    expect(clear).toContain("all 11 structural checks clear");
  });

  it("catches environment-aborted unexercised judged lanes and per-harness write-refusal arm asymmetry", () => {
    const at = "2026-11-26T00:00:00.000Z";
    const starterDigest = "1".repeat(64);
    const builtDigest = "2".repeat(64);
    const starterCond = conditionOf("v-1", starterDigest);
    const builtCond = conditionOf("v-1", builtDigest);
    const starterCid = conditionId(starterCond);
    const builtCid = conditionId(builtCond);
    const starterSolves: LogEvent[] = Array.from({ length: 20 }, (_, i) => [
      { at, kind: SOLVE_STARTED, data: { solve: `st-${String(i)}`, condition: starterCid } },
      ...(i < 2
        ? [
            {
              at,
              kind: "solve.call" as const,
              data: {
                solve: `st-${String(i)}`,
                tool: "write",
                isError: true,
                text: "EPERM: operation not permitted",
              },
            },
          ]
        : []),
      {
        at,
        kind: SOLVE_FINISHED,
        data: { solve: `st-${String(i)}`, ending: { outcome: "pass" } },
      },
    ]).flat();
    const builtSolves: LogEvent[] = Array.from({ length: 40 }, (_, i) => [
      { at, kind: SOLVE_STARTED, data: { solve: `bu-${String(i)}`, condition: builtCid } },
      {
        at,
        kind: SOLVE_FINISHED,
        data: { solve: `bu-${String(i)}`, ending: { outcome: "pass" } },
      },
    ]).flat();
    const envAbortedLog: LogEvent[] = [
      { at, kind: "campaign.opened", data: { judged: true } },
      {
        at,
        kind: EXAM_DRAFTED,
        data: {
          session: "d-1",
          draft: {
            objective: {
              quantity: "quality",
              direction: "higher",
              scale: "unit",
              items: [{ id: "clarity", weight: 1, kind: "judge", criterion: "Clear structure" }],
            },
          },
        },
      },
      { at, kind: "condition.recorded", data: { id: starterCid, condition: requireJsonValue(starterCond) } },
      { at, kind: "condition.recorded", data: { id: builtCid, condition: requireJsonValue(builtCond) } },
      {
        at,
        kind: COMPARISON_STARTED,
        data: { session: "g-1", old: starterDigest, fresh: builtDigest, starter: starterDigest },
      },
      ...starterSolves,
      ...builtSolves,
      { at, kind: "referee.pair", data: { comparison: "g-1", judge: null, holistic: null } },
      { at, kind: "campaign.ended", data: { ending: "environment", why: "judge error" } },
    ];
    const lines = diagnosticRows(envAbortedLog, join(tmpdir(), "nonexistent-states-dir")).join("\n");
    expect(lines).toContain(
      "[WARN] verdicts (lane 11): unexercised judged lane: exam declared judge items yet 0 referee.pair votes completed across 1 started comparison before ending environment",
    );
    expect(lines).toContain(
      `[WARN] honesty (lane 19): solver write/edit permission refusals: 2/60 solves hit EPERM/EACCES; by harness: starter ${starterDigest.slice(0, 8)} 2/20 (10.0%)`,
    );

    const withProbeLog: LogEvent[] = [
      ...envAbortedLog.map((ev) =>
        ev.kind === SOLVE_CALL && ev.data.solve === "st-0"
          ? { ...ev, data: { ...ev.data, args: { path: "/tmp/probe/dummy", content: "123456789012" } } }
          : ev.kind === SOLVE_CALL && ev.data.solve === "st-1"
            ? {
                ...ev,
                data: {
                  ...ev.data,
                  args: { path: "/tmp/probe/out.py", content: "1234567890123" },
                },
              }
            : ev,
      ),
      {
        at,
        kind: SOLVE_CALL,
        data: { solve: "bu-0", tool: "write", isError: false, text: "EPERM: ignored ok" },
      },
      {
        at,
        kind: SOLVE_CALL,
        data: { solve: "bu-1", tool: "bash", isError: true, text: "EPERM: bash refusal" },
      },
      {
        at,
        kind: "build.call",
        data: { session: "b-1", tool: "write", isError: true, text: "EPERM: build refusal" },
      },
      {
        at,
        kind: "solve.turn",
        data: { solve: "bu-2", turn: 1, text: "EPERM: mentioned in prose" },
      },
    ];
    expect(diagnosticRows(withProbeLog, join(tmpdir(), "nonexistent-states-dir")).join("\n")).toContain(
      `[WARN] honesty (lane 19): solver write/edit permission refusals: 2/60 solves hit EPERM/EACCES (1/2 non-probe); by harness: starter ${starterDigest.slice(0, 8)} 2/20 (10.0%)`,
    );

    const nonJudgedLog: LogEvent[] = [
      {
        at,
        kind: EXAM_DRAFTED,
        data: {
          session: "d-1",
          draft: {
            objective: {
              quantity: "score",
              direction: "higher",
              scale: "unit",
              items: [{ id: "m", weight: 1 }],
            },
          },
        },
      },
      { at, kind: COMPARISON_STARTED, data: { session: "g-1", old: "s", fresh: "h", starter: "s" } },
      { at, kind: COMPARISON_REPORTED, data: { session: "g-1", reading: "no-step", differences: [] } },
    ];
    expect(diagnosticRows(nonJudgedLog, join(tmpdir(), "nonexistent-states-dir")).join("\n")).not.toContain(
      "unexercised judged lane",
    );

    const completedPairLog: LogEvent[] = [
      ...envAbortedLog,
      { at, kind: "referee.pair", data: { comparison: "g-1", judge: 1, holistic: 1 } },
    ];
    expect(
      diagnosticRows(completedPairLog, join(tmpdir(), "nonexistent-states-dir")).join("\n"),
    ).not.toContain("unexercised judged lane");

    const operatorEnded = envAbortedLog.filter(({ kind }) => kind !== "campaign.ended");
    expect(
      diagnosticRows(
        [...operatorEnded, { at, kind: "campaign.ended", data: { ending: "operator", why: "paused" } }],
        join(tmpdir(), "nonexistent-states-dir"),
      ).join("\n"),
    ).not.toContain("unexercised judged lane");
  });

  it("excludes reverted-to-starter epochs from the PROMOTION UNCONFIRMED denominator", () => {
    const at = "2026-11-26T00:00:00.000Z";
    const revertLog: LogEvent[] = [
      { at, kind: "harness.promoted", data: { harness: "h-first00", from: "starter" } },
      { at, kind: "harness.reverted", data: { harness: "starter", from: "h-first00", reason: "no step" } },
      { at, kind: "harness.promoted", data: { harness: "h-second0", from: "starter" } },
    ];
    const unconfirmed = overview(revertLog).triggers.find(({ name }) => name === "PROMOTION UNCONFIRMED");
    expect(unconfirmed?.detail).toStartWith("2 of 2 promotions:");
    expect(unconfirmed?.detail).toContain("h-first0 in epoch 2, closed");
    expect(unconfirmed?.detail).toContain("h-second in epoch 4, open");
  });

  it("summarises judged pair counts, swap disagreements, extract coverage, and spend per comparison in pairRows", () => {
    const at = "2026-11-26T00:00:00.000Z";
    const judgedLog: LogEvent[] = [
      {
        at,
        kind: COMPARISON_STARTED,
        data: { session: "g-j", old: "h0", fresh: "h1", starter: "h0", tasks: ["v-1"] },
      },
      { at, kind: "referee.brief", data: { comparison: "g-j", billed: 0.4 } },
      {
        at,
        kind: "referee.pair",
        data: {
          comparison: "g-j",
          judge: 0.5,
          holistic: 1,
          criteria: { clarity: 0.5, depth: 0, holistic: 1 },
          disagreed: ["depth"],
          extracts: { files: 4, empty: 1, faults: 0, truncated: 2 },
          billed: 1.25,
        },
      },
      {
        at,
        kind: "referee.pair",
        data: {
          comparison: "g-j",
          judge: null,
          holistic: null,
          extracts: { files: 2, empty: 0, faults: 1, truncated: 0 },
          billed: 0.35,
        },
      },
    ];
    const output = pairRows(judgedLog).join("\n");
    expect(output).toContain(
      "== g-j judge: 1/2 pairs (1 null), swap disagreements 1/3 votes, extracts 6 files (1 empty, 1 faults, 2 truncated), billed $2.00",
    );
    expect(output).not.toContain("depth");
    expect(output).not.toContain("clarity");
  });

  it("excludes judge instrument rows from CONTROL COVERAGE and REFUSALS BY CHECK, and loads explicitly named seeded runs", async () => {
    const at = "2026-11-26T00:00:00.000Z";
    const judgedChecks: LogEvent[] = [
      {
        at,
        kind: "checker.read",
        data: {
          rows: [
            { id: "check-a", instrument: "author", named: 1, caught: 1 },
            { id: "clarity", instrument: "judge", named: 0, caught: 0 },
          ],
        },
      },
      { at, kind: SOLVE_STARTED, data: { solve: "s-pass", condition: "c-1" } },
      { at, kind: SOLVE_FINISHED, data: { solve: "s-pass", ending: { outcome: "pass" } } },
      { at, kind: SOLVE_STARTED, data: { solve: "s-fail", condition: "c-1" } },
      { at, kind: SOLVE_FINISHED, data: { solve: "s-fail", ending: { outcome: "fail" } } },
      {
        at,
        kind: "verdict",
        data: { solve: "s-fail", task: "v-1", kind: "fail", blocking: ["check-a"] },
      },
    ];
    const fired = overview(judgedChecks).triggers.map(({ name }) => name);
    expect(fired).not.toContain("CONTROL COVERAGE");
    expect(fired).not.toContain("REFUSALS BY CHECK");

    const runsDir = mkdtempSync(join(tmpdir(), "wri-seeded-runs-"));
    try {
      const opened = `${JSON.stringify({ at, kind: "campaign.opened", data: { project: "jobstat" } })}\n`;
      for (const [name, seeded] of [
        ["jobstat-live", false],
        ["jobstat-seed", true],
      ] as const) {
        const folder = join(runsDir, "here", name);
        mkdirSync(folder, { recursive: true });
        writeFileSync(join(folder, "log.jsonl"), opened);
        if (seeded) writeFileSync(join(folder, "seed.json"), '{"from":"prior"}\n');
      }
      const repo = join(import.meta.dir, "..");
      const byExactSeed = await loadRuns(
        { home: runsDir, since: "2026-11-01", names: ["jobstat-seed"], repo },
        "unpriced",
      );
      expect(byExactSeed.runs.map(({ name }) => name)).toEqual(["jobstat-seed"]);
      const byDomain = await loadRuns(
        { home: runsDir, since: "2026-11-01", names: ["jobstat"], repo },
        "unpriced",
      );
      expect(byDomain.runs.map(({ name }) => name)).toEqual(["jobstat-live"]);
    } finally {
      rmSync(runsDir, { recursive: true, force: true });
    }
  });
});

describe("the hours between two events", () => {
  it("counts each gap under thirty minutes as work and each longer one as silence, and an unreadable time as no hours, over every log of up to three gaps", () => {
    const at = (minutes: number) => new Date(Date.UTC(2026, 10, 1) + minutes * 60_000).toISOString();
    const verdict = (when: string): LogEvent => ({ at: when, kind: "verdict", data: { pass: true } });
    const gapsOf = (length: number): number[][] =>
      length === 0
        ? [[]]
        : gapsOf(length - 1).flatMap((head) => [29, 30, 31, 45].map((gap) => [...head, gap]));
    let logs = 0;
    for (const gaps of [1, 2, 3].flatMap(gapsOf)) {
      const times = [0, ...gaps.map((_, upTo) => gaps.slice(0, upTo + 1).reduce((sum, gap) => sum + gap, 0))];
      const last = times.at(-1) ?? 0;
      const timed = times.map((minutes) => verdict(at(minutes)));
      const worked = gaps.filter((gap) => gap < 30).reduce((sum, gap) => sum + gap, 0);
      expect(clockOf(timed)(at(last))).toBeCloseTo(worked / 60, 9);
      expect(spentTo(indexOf(timed), 0, timed.length)).toBe(`${(last / 60).toFixed(1)} h and $0`);
      logs += 1;
    }
    expect(logs).toBe(4 + 16 + 64);
    for (const unreadable of [[], [verdict("later"), verdict(at(90))], [verdict(at(0)), verdict("later")]]) {
      expect(spentTo(indexOf(unreadable), 0, unreadable.length)).toBe("0.0 h and $0");
    }
  });
});
