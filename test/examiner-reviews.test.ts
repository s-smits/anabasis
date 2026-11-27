import { afterAll, describe, expect, it } from "bun:test";
import { taskHistory } from "../src/examiner/record.ts";
import { readReviews, reviewInventoryLine, reviewSummariesByTask } from "../src/examiner/reviews.ts";
import { examine } from "../src/examiner/session.ts";
import { wakeOn } from "../src/examiner/write.ts";
import { conditionId, settingId } from "../src/kernel/condition.ts";
import { append, type EventKind, type LogEvent } from "../src/kernel/log.ts";
import { isString, type JsonObject } from "../src/meta/json-shape.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { requireJsonValue } from "../src/meta/stable-json.ts";
import { call, condition, finish, seat, sweep } from "./helpers/examiner-seat.ts";

afterAll(sweep);

const CANARY_ANSWER = "canary-answer-patch-91f8";
const CANARY_FIND = "canary-find-text-4b2c";
const CANARY_REPLACE = "canary-replace-text-7d1e";
const HARNESS_OLD = "h-ref-canary-1111";
const HARNESS_FRESH = "h-cand-canary-2222";
const PAIR = "referee.pair" as const;

function makeLog() {
  const events: LogEvent[] = [];
  const add = (kind: EventKind, data: JsonObject) =>
    events.push({ at: "2026-11-27T00:00:00.000Z", kind, data });
  const hold = (taskId: string, family = "fixture") => {
    const version = `v-${taskId}`;
    add("task.proposed", { version, taskId, task: { taskId, family, publicInput: {}, hidden: null } });
    add("task.gate", { version, gate: 1, outcome: "passed" });
  };
  const solve = (id: string, taskId: string, harness: string, comparison?: string, pass = true) => {
    const cond = condition(`v-${taskId}`, harness);
    const cid = conditionId(cond);
    add("condition.recorded", { id: cid, condition: requireJsonValue(cond) });
    add("solve.started", {
      solve: id,
      condition: cid,
      ...keyIfDefined("comparison", comparison),
    });
    add("verdict", {
      solve: id,
      task: taskId,
      kind: pass ? "pass" : "fail",
      answer: { answer: CANARY_ANSWER },
    });
    add("solve.finished", {
      solve: id,
      ending: pass ? { outcome: "pass" } : { outcome: "fail", kind: "rejected" },
      turns: 4,
    });
  };
  const report = (
    session: string,
    old: string,
    fresh: string,
    versions: readonly string[],
    labels?: Record<string, string>,
  ) =>
    add("comparison.reported", {
      session,
      reading: "no-step",
      old,
      fresh,
      starter: old,
      solves: 2,
      setting: settingId(condition("any", "any")),
      versions: [...versions],
      aside: [],
      scored: { differences: versions.map(() => 0) },
      noise: null,
      ...keyIfDefined("settled", labels === undefined ? undefined : { labels }),
    });
  return { events, add, hold, solve, report };
}

describe("Examiner review projection and search (read_reviews)", () => {
  it("projects pairs, findings, and drafts while hiding unfinished comparisons and stripped internals", () => {
    const log = makeLog();
    log.hold("t-1");
    log.hold("t-2");
    log.solve("s-old-1", "t-1", HARNESS_OLD, "c-1");
    log.solve("s-fresh-1", "t-1", HARNESS_FRESH, "c-1");
    log.solve("s-old-2", "t-1", HARNESS_OLD, "c-1");
    log.solve("s-fail-1", "t-2", HARNESS_OLD, "c-1", false);
    log.solve("s-fail-2", "t-2", HARNESS_FRESH, "c-1", false);
    log.solve("s-open-1", "t-1", HARNESS_OLD, "c-open");
    log.solve("s-open-2", "t-1", HARNESS_FRESH, "c-open");

    const voteAb = "judge-secret-1:clarity:ab";
    const voteBa = "judge-secret-1:clarity:ba";
    const voteHolAb = "judge-secret-1:holistic:ab";
    const voteHolBa = "judge-secret-1:holistic:ba";
    log.add("referee.call", {
      reader: voteAb,
      tool: "record_vote",
      isError: false,
      args: { better: "A", reason: "Answer A states exact error bars and units." },
    });
    log.add("referee.call", {
      reader: voteAb,
      tool: "record_vote",
      isError: true,
      args: { better: "B", reason: "errored vote must be ignored" },
    });
    log.add("referee.call", {
      reader: voteAb,
      tool: "view_image",
      isError: false,
      args: { better: "B", reason: "non-vote tool must be ignored" },
    });
    log.add("referee.call", {
      reader: voteBa,
      tool: "record_vote",
      isError: false,
      args: { better: "B", reason: "Answer B includes the full sensitivity table." },
    });
    log.add("referee.call", {
      reader: voteHolAb,
      tool: "record_vote",
      isError: false,
      args: { better: "B", reason: "Answer B avoids unsupported extrapolation." },
    });
    log.add("referee.call", {
      reader: voteHolBa,
      tool: "record_vote",
      isError: false,
      args: { better: "A", reason: "Answer A stays grounded in the data." },
    });
    log.add("referee.pair", {
      comparison: "c-1",
      task: "t-1",
      solve: "s-fresh-1",
      old: "s-old-1",
      reader: "judge-secret-1",
      readers: [voteAb, voteBa, voteHolAb, voteHolBa],
      judge: 1,
      holistic: -1,
      criteria: { clarity: 1, holistic: -1 },
      disagreed: [],
      extracts: { files: 4, empty: 1, faults: 1, truncated: 2 },
    });
    log.add("referee.pair", {
      comparison: "c-1",
      task: "t-1",
      solve: "s-old-1",
      old: "s-old-2",
      reader: "judge-secret-aa",
      readers: ["judge-secret-aa:clarity:ab", "judge-secret-aa:clarity:ba"],
      judge: 0,
      holistic: 0,
      criteria: { clarity: 0, holistic: 0 },
      disagreed: ["clarity"],
    });
    log.add("referee.pair", {
      comparison: "c-1",
      task: "t-1",
      solve: "s-fresh-1",
      old: "s-old-1",
      reader: "judge-secret-inc",
      readers: [],
      judge: null,
      holistic: null,
    });
    log.add("referee.pair", {
      comparison: "c-open",
      task: "t-1",
      solve: "s-open-2",
      old: "s-open-1",
      reader: "judge-open",
      readers: [],
      judge: 1,
      holistic: 1,
      criteria: { clarity: 1, holistic: 1 },
      disagreed: [],
    });
    log.add("referee.finding", {
      solve: "s-open-1",
      task: "t-1",
      ruling: "check-defect",
      check: "check-hidden-unfinished",
      reason: "unfinished comparison secret",
    });
    log.add("referee.finding", {
      solve: "s-fail-1",
      task: "t-2",
      ruling: "check-defect",
      check: "check-units",
      reason: "Check rejects valid ISO unit notation allowed by R2.",
      probeRows: [
        {
          id: 1,
          original: { kind: "fail", blocking: ["check-units"] },
          changed: { kind: "pass" },
          moved: ["check-units"],
          changes: [
            { path: "$.answer", value: CANARY_ANSWER, edit: { find: CANARY_FIND, replace: CANARY_REPLACE } },
          ],
        },
      ],
    });
    log.add("referee.finding", {
      solve: "s-fail-2",
      task: "t-2",
      ruling: "check-defect",
      check: "check-units",
      reusedFrom: "s-fail-1",
      reason: "reused check-defect on check-units from earlier solve s-fail-1 in comparison c-1",
    });
    log.add("referee.finding", {
      solve: "s-open-2",
      task: "t-2",
      ruling: "check-defect",
      check: "check-units",
      reusedFrom: "s-fail-1",
      reason: "reused in unreported c-open",
    });
    log.solve("s-orphan-reuse", "t-2", HARNESS_FRESH, "c-1", false);
    log.add("referee.finding", {
      solve: "s-orphan-reuse",
      task: "t-2",
      ruling: "earned",
      check: "check-unseen-primary",
      reusedFrom: "s-missing-primary",
      reason: "reused earned from unseen primary",
    });
    log.add("referee.draft", {
      session: "d-1",
      pass: 1,
      verdict: "defects",
      summary: "Vacuous pass found on t-1.",
      findings: [
        {
          kind: "vacuous-pass",
          task: "t-1",
          check: "check-units",
          probe: 1,
          reason: "Corrupted unit string still passed.",
        },
      ],
      probeRows: [
        {
          id: 1,
          original: { kind: "pass" },
          changed: { kind: "pass" },
          moved: [],
          changes: [{ path: "$.answer", value: CANARY_ANSWER }],
        },
      ],
    });
    log.add("referee.draft", {
      session: "d-1",
      pass: 2,
      verdict: "skipped",
      summary: "draft audit skipped: provider timeout",
      findings: [],
      probeRows: [],
    });
    log.report("c-1", HARNESS_OLD, HARNESS_FRESH, ["v-t-1", "v-t-2"], { "s-fail-1": "earned" });

    const all = readReviews(log.events);
    expect(all).toContain("Showing 1-7 of 7 matching review records");
    expect(all).toContain("[pair] c-1 | task=t-1 | cross | judge-gap=1 holistic-gap=1 (opposed)");
    expect(all).toContain("Answer A states exact error bars and units.");
    expect(all).not.toContain("errored vote must be ignored");
    expect(all).not.toContain("non-vote tool must be ignored");
    expect(all).toContain("check=check-unseen-primary");
    expect(all).toContain("extracts: 4 files (1 empty, 1 faults, 2 truncated)");
    expect(all).toContain("[pair] c-1 | task=t-1 | mirror |");
    expect(all).toContain("reason unavailable");
    expect(all).toContain("[pair] c-1 | task=t-1 | cross | incomplete");
    expect(all).toContain(
      "ruling=check-defect | standing=earned | check=check-units | evidence=replayed (+1 reused)",
    );
    expect(all).toContain("probe #1: fail->pass moved=[check-units]");
    expect(all).toContain("[draft] d-1 pass=1 | verdict=defects | probes=1");
    expect(all).toContain("[draft] d-1 pass=2 | verdict=skipped");
    expect(all).toContain("summary: draft audit skipped");
    expect(all).not.toContain("provider timeout");

    log.add("referee.finding", {
      solve: "s-orphan-without-start",
      task: "t-2",
      ruling: "check-defect",
      check: "check-orphan",
      reason: "orphan truncated finding",
    });
    expect(readReviews(log.events)).not.toContain("check-orphan");

    for (const forbidden of [
      CANARY_ANSWER,
      CANARY_FIND,
      CANARY_REPLACE,
      HARNESS_OLD,
      HARNESS_FRESH,
      "s-fresh-1",
      "s-old-1",
      "s-fail-1",
      "s-fail-2",
      "judge-secret-1",
      "c-open",
      "check-hidden-unfinished",
      "unfinished comparison secret",
      "provider timeout",
      ":ab",
      ":ba",
    ]) {
      expect(all).not.toContain(forbidden);
      expect(readReviews(log.events, { query: forbidden })).toContain("No review records match");
    }

    expect(readReviews(log.events, { source: "pair", outcome: "holistic-oppose" })).toContain(
      "Showing 1-1 of 1",
    );
    expect(readReviews(log.events, { source: "pair", outcome: "disagreed" })).toContain("mirror");
    expect(readReviews(log.events, { source: "finding", outcome: "earned", check: "check-units" })).toContain(
      "standing=earned",
    );
    expect(readReviews(log.events, { source: "finding", outcome: "check-defect" })).toContain(
      "No review records match",
    );
    expect(readReviews(log.events, { source: "draft", outcome: "skipped" })).toContain("draft audit skipped");
    expect(
      readReviews(log.events, { comparison: "c-1", item: "clarity", query: "sensitivity table" }),
    ).toContain("Showing 1-1 of 1");
    expect(readReviews(log.events, { task: "t-2" })).toContain("Showing 1-2 of 2");
    expect(readReviews(log.events, { task: "no-such-task" })).toContain("No review records match");
    expect(readReviews(log.events, { comparison: "d-1" })).toContain("Showing 1-2 of 2");
    expect(readReviews(log.events, { comparison: "no-such-comp" })).toContain("No review records match");
    expect(readReviews(log.events, { item: "clarity" })).toContain("Showing 1-2 of 2");
    expect(readReviews(log.events, { item: "no-such-item" })).toContain("No review records match");
  });

  it("is byte-identical under perturbations of stripped identifiers, raw probe payloads, and A/B arm mapping", () => {
    const build = (variant: {
      solveFresh: string;
      solveOld: string;
      harnessFresh: string;
      harnessOld: string;
      reader: string;
      patch: string;
      flipSigns: boolean;
    }) => {
      const log = makeLog();
      log.hold("t-1");
      log.solve(variant.solveOld, "t-1", variant.harnessOld, "c-1");
      log.solve(variant.solveFresh, "t-1", variant.harnessFresh, "c-1");
      const r1 = `${variant.reader}:depth:ab`;
      const r2 = `${variant.reader}:depth:ba`;
      log.add("referee.call", {
        reader: r1,
        tool: "record_vote",
        isError: false,
        args: { better: "A", reason: "Answer A verifies boundary cases." },
      });
      log.add("referee.call", {
        reader: r2,
        tool: "record_vote",
        isError: false,
        args: { better: "B", reason: "Answer B verifies boundary cases." },
      });
      const sign = variant.flipSigns ? -1 : 1;
      log.add("referee.pair", {
        comparison: "c-1",
        task: "t-1",
        solve: variant.solveFresh,
        old: variant.solveOld,
        reader: variant.reader,
        readers: [r1, r2],
        judge: sign,
        holistic: sign,
        criteria: { depth: sign, holistic: sign },
        disagreed: [],
      });
      log.add("referee.finding", {
        solve: variant.solveOld,
        task: "t-1",
        ruling: "earned",
        rule: "R1",
        field: "$.answer",
        reason: "Violates R1.",
        probeRows: [
          {
            id: 1,
            original: { kind: "fail" },
            changed: { kind: "pass" },
            moved: ["check-product"],
            changes: [{ path: "$.answer", value: variant.patch }],
          },
        ],
      });
      log.report("c-1", variant.harnessOld, variant.harnessFresh, ["v-t-1"]);
      return readReviews(log.events);
    };

    const baseline = build({
      solveFresh: "s-a",
      solveOld: "s-b",
      harnessFresh: "h-fresh-1",
      harnessOld: "h-old-1",
      reader: "judge-1",
      patch: "secret-one",
      flipSigns: false,
    });
    const perturbed = build({
      solveFresh: "s-xyz-999",
      solveOld: "s-uvw-888",
      harnessFresh: "h-different-9",
      harnessOld: "h-other-8",
      reader: "judge-completely-different",
      patch: "secret-two-different-payload",
      flipSigns: true,
    });
    expect(perturbed).toBe(baseline);
  });

  it("enforces cursor pagination without leaking event counts, page byte cap, and filter-bound cursor rejection", () => {
    const log = makeLog();
    for (let i = 1; i <= 5; i += 1) {
      log.add("referee.draft", {
        session: `d-${String(i)}`,
        pass: 1,
        verdict: "sound",
        summary: `Audit ${String(i)}: ${"x".repeat(500)}`,
        findings: [],
        probeRows: [],
      });
    }
    const page1 = readReviews(log.events, { source: "draft", limit: 2 });
    expect(page1).toContain("Showing 1-2 of 5 matching review records");
    expect(page1.indexOf("[draft] d-5")).toBeLessThan(page1.indexOf("[draft] d-4"));
    const cursor = /next cursor: ([^\s\n]+)/u.exec(page1)?.[1];
    expect(cursor).toBeDefined();
    expect(cursor?.split(":")).toHaveLength(2);

    const hiddenEvents = [...log.events];
    for (let i = 0; i < 10; i += 1) {
      hiddenEvents.push({
        at: "2026-11-27T00:00:00.000Z",
        kind: "solve.started",
        data: { solve: `s-hidden-${String(i)}`, comparison: "c-open" },
      });
    }
    expect(readReviews(hiddenEvents, { source: "draft", limit: 2 })).toBe(page1);
    const page2 = readReviews(hiddenEvents, { source: "draft", limit: 2, cursor });
    expect(page2).toContain("Showing 3-4 of 5 matching review records");
    expect(page2).toContain("[draft] d-3");

    expect(readReviews(log.events, { source: "draft", outcome: "defects", cursor })).toContain(
      "Cursor does not match the active filters",
    );
    expect(readReviews(log.events, { cursor: `${cursor ?? "2:bad"}:99` })).toContain(
      "Cursor does not match the active filters",
    );
    expect(readReviews(log.events, { cursor: "bad:cursor" })).toContain(
      "Cursor does not match the active filters",
    );

    const big = makeLog();
    for (let i = 1; i <= 20; i += 1) {
      big.add("referee.draft", {
        session: `d-big-${String(i)}`,
        pass: 1,
        verdict: "defects",
        summary: `Big summary ${String(i)} ${"a".repeat(550)}`,
        findings: [
          { kind: "vacuous-pass", task: "t-1", check: "c-1", probe: 1, reason: "b".repeat(550) },
          { kind: "check-defect", task: "t-2", check: "c-2", probe: 2, reason: "c".repeat(550) },
        ],
        probeRows: [],
      });
    }
    const capped = readReviews(big.events, { source: "draft", limit: 20 });
    expect(capped).toContain("next cursor:");
    expect(Buffer.byteLength(capped)).toBeLessThan(10 * 1024);
    const validCursor = /next cursor: (\S+)/u.exec(capped)?.[1] ?? "";
    expect(validCursor).toMatch(/^\d+:.+$/u);
    const [, key = ""] = validCursor.split(":");
    expect(readReviews(big.events, { source: "draft", cursor: `0:${key}` })).toContain("Showing 1-");
    for (const badCursor of [`${validCursor}:extra`, `-1:${key}`, `1.5:${key}`, "0:wrongkey"]) {
      expect(readReviews(big.events, { source: "draft", cursor: badCursor })).toContain(
        "Cursor does not match the active filters",
      );
    }
    expect(readReviews(big.events, { source: "draft", check: "no-such-check" })).toContain(
      "No review records match",
    );
  });

  it("summarises cross-arm review telemetry on taskHistory lines and omits practice and mirror pairs", () => {
    const log = makeLog();
    log.hold("graded");
    log.hold("tied");
    log.hold("prac");
    log.add("task.state", { version: "v-prac", state: "released" });
    for (const task of ["graded", "tied", "prac"]) {
      log.solve(`s-o-${task}`, task, HARNESS_OLD, "c-1");
      log.solve(`s-f-${task}`, task, HARNESS_FRESH, "c-1");
    }
    log.add(PAIR, {
      comparison: "c-1",
      task: "graded",
      solve: "s-f-graded",
      old: "s-o-graded",
      judge: null,
      holistic: null,
    });
    log.add(PAIR, {
      comparison: "c-1",
      task: "graded",
      solve: "s-f-graded",
      old: "s-o-graded",
      judge: 0.5,
      holistic: -1,
      criteria: { clarity: 1, holistic: -1 },
      disagreed: ["clarity"],
      extracts: { files: 2, empty: 0, faults: 1, truncated: 1 },
    });
    log.add(PAIR, {
      comparison: "c-1",
      task: "graded",
      solve: "s-f-graded",
      old: "s-o-graded",
      judge: null,
      holistic: null,
    });
    log.hold("inc");
    log.solve("s-o-inc", "inc", HARNESS_OLD, "c-1");
    log.solve("s-f-inc", "inc", HARNESS_FRESH, "c-1");
    log.add(PAIR, {
      comparison: "c-1",
      task: "inc",
      solve: "s-f-inc",
      old: "s-o-inc",
      judge: null,
      holistic: null,
    });
    log.hold("halfzero");
    log.solve("s-o-halfzero", "halfzero", HARNESS_OLD, "c-1");
    log.solve("s-f-halfzero", "halfzero", HARNESS_FRESH, "c-1");
    log.add(PAIR, {
      comparison: "c-1",
      task: "halfzero",
      solve: "s-f-halfzero",
      old: "s-o-halfzero",
      judge: 0,
      holistic: 1,
      criteria: { clarity: 0, holistic: 1 },
      disagreed: [],
    });
    log.add("referee.pair", {
      comparison: "c-1",
      task: "graded",
      solve: "s-o-graded",
      old: "s-o-graded",
      judge: 0,
      holistic: 0,
      criteria: { clarity: 0, holistic: 0 },
      disagreed: [],
    });
    log.add("referee.pair", {
      comparison: "c-1",
      task: "tied",
      solve: "s-f-tied",
      old: "s-o-tied",
      judge: 0,
      holistic: 0,
      criteria: { clarity: 0, holistic: 0 },
      disagreed: [],
    });
    log.add("referee.pair", {
      comparison: "c-1",
      task: "prac",
      solve: "s-f-prac",
      old: "s-o-prac",
      judge: 1,
      holistic: 1,
      criteria: { clarity: 1, holistic: 1 },
      disagreed: [],
    });
    log.report("c-1", HARNESS_OLD, HARNESS_FRESH, ["v-graded", "v-tied"]);

    const summaries = reviewSummariesByTask(log.events);
    expect(summaries.get("graded")).toBe(
      "reviews 1/1 pairs, swap-disagreed 1/2, holistic opposed clarity, extracts 1f/1t",
    );
    expect(summaries.get("tied")).toBe("reviews 1/1 pairs (all tied), swap-disagreed 0/2");
    expect(summaries.get("halfzero")).toBe("reviews 1/1 pairs, swap-disagreed 0/2");
    expect(summaries.get("inc")).toBe("reviews 0/1 pairs");
    expect(readReviews(log.events, { task: "halfzero" })).toContain("holistic-gap=1 (tie)");
    expect(readReviews(log.events, { task: "halfzero" })).toContain(
      "clarity: tie, swap-consistent, holistic=tie",
    );

    const told = taskHistory(
      log.events,
      ["graded", "tied", "prac"].map((taskId) => ({ taskId, family: "fixture" })),
    );
    const allLines = told.groups.flatMap((group) => group.lines);
    expect(allLines.find((line) => line.startsWith("graded "))).toContain("holistic opposed clarity");
    expect(allLines.find((line) => line.startsWith("tied "))).toContain("reviews 1/1 pairs (all tied)");
    expect(allLines.find((line) => line.startsWith("prac "))).toBe("prac (fixture)");
    expect(told.reviews).toBe(
      "Reported reviews in read_reviews (newest first): 8 pairs (1 swap-disagreed, 1 holistic-opposed).",
    );
    expect(reviewInventoryLine([])).toBeNull();
  });

  it("reports newest-first order, check-defects stops, and invariant review inventory", () => {
    const log = makeLog();
    log.hold("t-1");
    log.solve("s-old", "t-1", HARNESS_OLD, "c-1", false);
    log.add("referee.draft", {
      session: "d-1",
      pass: 1,
      verdict: "sound",
      summary: "ok",
      findings: [],
      probeRows: [],
    });
    log.add("referee.finding", {
      solve: "s-old",
      task: "t-1",
      ruling: "check-defect",
      check: "check-units",
      reason: "Off by one.",
    });
    log.add("comparison.reported", {
      session: "c-1",
      reading: "check-defects",
      old: HARNESS_OLD,
      fresh: HARNESS_FRESH,
      starter: HARNESS_OLD,
      solves: 2,
      setting: settingId(condition("any", "any")),
      versions: ["v-t-1"],
      aside: ["v-t-1"],
      scored: { differences: [] },
      noise: null,
    });
    const out = readReviews(log.events);
    expect(out.indexOf("[finding] c-1")).toBeLessThan(out.indexOf("[draft] d-1"));
    const told = taskHistory(log.events, [{ taskId: "t-1", family: "fixture" }]);
    expect(told.stood).toContain("It stopped on check defects.");
    const inventory =
      "Reported reviews in read_reviews (newest first): 1 finding (1 check-defect), 1 draft audit.";
    expect(told.reviews).toBe(inventory);
    const limits = { wallSeconds: 600, turns: 10, puts: 4 };
    expect(wakeOn(log.events, [{ taskId: "t-1", family: "fixture" }], limits)).toContain(inventory);
  });

  it("exposes read_reviews inside live Examiner writing sessions via REVIEW_EVENT_KINDS filtering", async () => {
    const s = seat("write", [call("read_reviews", { source: "draft" }), finish, finish]);
    append(s.log, "referee.draft", {
      session: "d-1",
      pass: 1,
      verdict: "sound",
      summary: "All code and judge probes checked out.",
      findings: [],
      probeRows: [],
    });
    append(s.log, "solve.call", { solve: "s-noise", tool: "bash", args: { command: "echo hi" }, text: "hi" });
    await examine(s.request);
    expect(s.sent[0]).toContain("Reported reviews in read_reviews (newest first): 1 draft audit.");
    const reviewCall = s.of("exam.call").find((entry) => entry.tool === "read_reviews");
    expect(reviewCall?.isError).toBe(false);
    expect(isString(reviewCall?.text) && reviewCall.text).toContain("All code and judge probes checked out.");
  });
});
