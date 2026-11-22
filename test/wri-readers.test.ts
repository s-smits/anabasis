// What the investigation reads from a log and from a lane's report, each as one table over the
// synthetic campaign: the overview's rows agree with the production folds that own each count, each
// trigger fires on its lane with its count, the catalogue names every trigger the reader can fire,
// and a report is collected as a finding, no finding or could not read only when its fields are even.
import { describe, expect, it } from "bun:test";
import { lastReports, referenceOf } from "../src/kernel/reports.ts";
import { isString } from "../src/meta/json-shape.ts";
import { solvesIn } from "../src/kernel/solves.ts";
import { taskSets } from "../src/kernel/task.ts";
import { catalogueText, type Lane, lanesOf, ownersOf } from "../tools/wri/catalogue.ts";
import { TRIGGERS } from "../tools/wri/folds.ts";
import { reportIndex, reportOf, sessionsOf } from "../tools/wri/investigation.ts";
import { overview } from "../tools/wri/read.ts";
import { scoreRows } from "../tools/wri/scores.ts";
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

  it("numbers twenty-three lanes in order and packs each into exactly one session", () => {
    expect(lanes.map(({ number }) => number)).toEqual(Array.from({ length: 23 }, (_, index) => index + 1));
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
  const head = "# Lane 5: False rejection among fails";
  const finding = (title = "The tolerance", seen = "") =>
    `### ${title}\nObservation: confirmed, 40 of 55 name check-a\nCause: plausible, the tolerance\nOwner: pack/evaluator\nReverses if: a refused answer is invalid\nDecision: whether a repair is owed\n${seen}`;
  const one = ["buffer-a"];
  const two = ["buffer-a", "buffer-b"];
  it.each([
    ["a finding", 5, `${head}\nVerdict: finding, one.\n## Findings\n${finding()}`, one, "ok", "finding", []],
    [
      "no finding",
      5,
      `${head}\nVerdict: no finding, sound.\n## Checked\nthe tolerance\n`,
      one,
      "ok",
      "no finding",
      [],
    ],
    [
      "could not read",
      22,
      "# Lane 22: x\nVerdict: could not read, the receipts are gone.\n",
      one,
      "ok",
      "could not read",
      [],
    ],
    ["an omitted open lane", 5, `${head}\nVerdict: omitted, lane 21 covers it.\n`, one, "ok", "omitted", []],
    [
      "a finding seen in every campaign",
      5,
      `${head}\nVerdict: finding, one.\n${finding("t", "Seen in: buffer-a shows; buffer-b absent")}`,
      two,
      "ok",
      "finding",
      [],
    ],
    [
      "uneven fields",
      5,
      `${head}\nVerdict: finding, one.\n${finding()}Owner: host\n`,
      one,
      "invalid",
      "finding",
      ["the findings are uneven: Observation: 1, Cause: 1, Owner: 2, Reverses if: 1, Decision: 1"],
    ],
    [
      "no Seen in line",
      5,
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
      5,
      `${head}\nVerdict: finding, one.\n${finding("t", "Seen in: buffer-a-r5 shows, buffer-b absent")}`,
      two,
      "invalid",
      "finding",
      ["a Seen in: line leaves out buffer-a"],
    ],
    [
      "a finding with none written",
      5,
      `${head}\nVerdict: finding, one.\n`,
      one,
      "invalid",
      "finding",
      ["the verdict is a finding and none is written"],
    ],
    [
      "no finding over a finding",
      5,
      `${head}\nVerdict: no finding.\n${finding()}`,
      one,
      "invalid",
      "no finding",
      ["the verdict is no finding and the report writes 1 finding"],
    ],
    [
      "an omitted isolated lane",
      6,
      "# Lane 6: x\nVerdict: omitted, covered.\n",
      one,
      "invalid",
      "omitted",
      ["an isolated lane may not be omitted"],
    ],
    [
      "a pending verdict",
      22,
      "# Lane 22: x\nVerdict: pending\n",
      one,
      "invalid",
      null,
      ["the verdict is pending: the session is still writing"],
    ],
    [
      "a provisional verdict",
      22,
      "# Lane 22: x\nVerdict: could not read, provisional\n",
      one,
      "invalid",
      "could not read",
      ["the verdict is provisional: the session is still writing"],
    ],
    [
      "an unknown owner",
      5,
      `${head}\nVerdict: finding, one.\n${finding().replace("pack/evaluator", "nobody")}`,
      one,
      "invalid",
      "finding",
      ["1 of 1 owners are not in the owner table"],
    ],
    [
      "another lane's head",
      5,
      "# Lane 4: x\nVerdict: no finding.\n",
      one,
      "invalid",
      "no finding",
      ["the first line does not name the lane"],
    ],
  ] as const)("collects %s", (...[, number, text, names, state, verdict, faults]) => {
    expect(reportOf(lane(number), text, owners, names)).toMatchObject({ state, verdict, faults });
  });

  it("collects no file as missing, and indexes each finding by its id with its marks", () => {
    expect(reportOf(lane(5), null, owners, one).state).toBe("missing");
    const report = reportOf(
      lane(5),
      `${head}\nVerdict: finding, two.\n${finding("First")}${finding("Second")}`,
      owners,
      one,
    );
    const index = reportIndex([report], (number) => `/r/${String(number)}.md`, []);
    expect(index).toContain("- lane 5: ok, finding, 2 findings, at `/r/5.md`");
    expect(index).toContain("  - 5.2, observation confirmed, cause plausible, owner pack/evaluator: Second");
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
