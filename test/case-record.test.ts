/**
 * Tests for the case record: one writer serialises appends, and a strict reader refuses incomplete
 * lines or sequence gaps. Allowed outcome values keep non-results out of the score; matching each
 * task to one row fixes the denominator. Trace pointers include content digests. Split out of
 * test/judge-reviews.test.ts when that file's census subject was rewritten around one battery.
 */
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { afterEach, describe, expect, it } from "bun:test";
import {
  CASE_RECORD_SCHEMA,
  CaseRecord,
  type CaseRecordRow,
  assertCompleteRun,
  caseRowDefect,
  caseVerdict,
  classifyCaseOutcome,
  readCaseRecord,
  tracePointer,
  verifyTracePointers,
} from "../src/claim/case-record.ts";
import type { JsonValue } from "../src/meta/json-shape.ts";
import { double } from "./helpers/doubles.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";

afterEach(cleanupScratch);

function verifiedRow(taskId: string, pass: boolean, overrides: Partial<CaseRecordRow> = {}): CaseRecordRow {
  return {
    schema: CASE_RECORD_SCHEMA,
    runId: "r1",
    builderId: "bun-run-gate",
    slug: "matching",
    buildInputsHash: "h1",
    backendPin: "scripted/none",
    taskId,
    family: "f",
    acceptedSubmit: true,
    truthOk: pass,
    pass,
    runtimeNonResult: null,
    runtimeNonResultKind: null,
    isolation: { strength: "contractual" },
    condition: null,
    traces: [],
    ...overrides,
  };
}

describe("one writer, serialized appends", () => {
  it("round-trips rows in append order with writer-owned seq", async () => {
    const path = join(scratchDir("ana-case-record-"), "case-record.jsonl");
    const record = CaseRecord.open(path);
    expect(await record.append(verifiedRow("t1", true))).toBe(1);
    expect(await record.append(verifiedRow("t2", false))).toBe(2);
    await record.close();
    const rows = readCaseRecord(path);
    expect(rows.map((r) => [r.seq, r.row.taskId, r.row.pass])).toEqual([
      [1, "t1", true],
      [2, "t2", false],
    ]);
  });

  it("refuses a second writer and an existing lock file", async () => {
    const path = join(scratchDir("ana-case-record-"), "case-record.jsonl");
    const record = CaseRecord.open(path);
    expect(() => CaseRecord.open(path)).toThrow(/ONE writer/);
    await record.close();
    // After close the lock is released and a new writer may open.
    const second = CaseRecord.open(path);
    await second.close();
    // A crashed writer's lock stays on disk; opening the record must not remove it automatically.
    writeFileSync(`${path}.lock`, "999999\n");
    expect(() => CaseRecord.open(path)).toThrow(/another writer holds/);
  });

  it("keeps every line intact under concurrent appends — the queue is the single writer", async () => {
    const path = join(scratchDir("ana-case-record-"), "case-record.jsonl");
    const record = CaseRecord.open(path);
    const big = "x".repeat(8192); // each row far beyond PIPE_BUF: interleaving would tear lines
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        record.append(verifiedRow(`t${i}`, true, { runtimeNonResult: null, family: big })),
      ),
    );
    await record.close();
    const rows = readCaseRecord(path);
    expect(rows).toHaveLength(12);
    expect(rows.map((r) => r.seq)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
  });

  it("reports a refused row and still accepts later appends", async () => {
    const path = join(scratchDir("ana-case-record-"), "case-record.jsonl");
    const record = CaseRecord.open(path);
    const partialRow = verifiedRow("bad", true, {
      runtimeNonResult: "solver blocked",
      runtimeNonResultKind: null,
    });
    await expect(record.append(partialRow)).rejects.toThrow(/half-shaped/);
    expect(await record.append(verifiedRow("t2", true))).toBe(1);
    await record.close();
  });

  it("opening an existing record strict-reads it first — a torn file refuses to grow", async () => {
    const path = join(scratchDir("ana-case-record-"), "case-record.jsonl");
    const record = CaseRecord.open(path);
    await record.append(verifiedRow("t1", true));
    await record.close();
    appendFileSync(path, '{"seq":2,"row":{"tor\n');
    expect(() => CaseRecord.open(path)).toThrow(/malformed record line/);
  });
});
describe("strict parser — B-1 cannot hide malformed rows behind a tolerant reader", () => {
  it("throws on a malformed line instead of skipping it", async () => {
    const path = join(scratchDir("ana-case-record-"), "case-record.jsonl");
    const record = CaseRecord.open(path);
    await record.append(verifiedRow("t1", true));
    await record.append(verifiedRow("t2", true));
    await record.close();
    const lines = readFileSync(path, "utf8").trim().split("\n");
    writeFileSync(path, `${lines[0]}\n{"seq":2,"half`.concat("\n"));
    expect(() => readCaseRecord(path)).toThrow(/malformed record line/);
  });

  it("throws on a seq gap — a lost row is a defect, never an absence", async () => {
    const path = join(scratchDir("ana-case-record-"), "case-record.jsonl");
    const record = CaseRecord.open(path);
    await record.append(verifiedRow("t1", true));
    await record.append(verifiedRow("t2", true));
    await record.append(verifiedRow("t3", true));
    await record.close();
    const lines = readFileSync(path, "utf8").trim().split("\n");
    writeFileSync(path, `${lines[0]}\n${lines[2]}\n`);
    expect(() => readCaseRecord(path)).toThrow(/breaks the append order/);
  });
});

describe("row discipline", () => {
  it("classifies the Run A denominator into mutually exclusive outcomes", () => {
    const rows = [
      ...Array.from({ length: 45 }, (_, index) => verifiedRow(`pass-${index}`, true)),
      ...Array.from({ length: 50 }, (_, index) => verifiedRow(`fail-${index}`, false)),
      ...Array.from({ length: 5 }, (_, index) =>
        verifiedRow(`unaccepted-${index}`, false, {
          acceptedSubmit: false,
          truthOk: null,
          pass: false,
        }),
      ),
    ];
    const outcomes = rows.map(classifyCaseOutcome);
    const counts = {
      verified: outcomes.filter((outcome) => outcome === "pass" || outcome === "fail").length,
      unaccepted: outcomes.filter((outcome) => outcome === "unaccepted").length,
      nonResults: outcomes.filter((outcome) => outcome === "non-result").length,
    };
    expect(counts).toEqual({ verified: 95, unaccepted: 5, nonResults: 0 });
    expect(counts.verified + counts.unaccepted + counts.nonResults).toBe(100);
  });

  it("accepts verified, unaccepted and non-result rows and refuses inconsistent fields", () => {
    expect(caseRowDefect(verifiedRow("t1", true))).toBeNull();
    // Solver timestamps are optional: absent is valid, but a non-string value is refused.
    expect(
      caseRowDefect(
        verifiedRow("t1", true, {
          solverStartedAt: "2026-09-01T00:00:00.000Z",
          solverEndedAt: "2026-09-01T00:00:09.000Z",
        }),
      ),
    ).toBeNull();
    const numericInstant: JsonValue = { ...verifiedRow("t1", true), solverStartedAt: 5 };
    expect(caseRowDefect(numericInstant)).toBe("solverStartedAt must be a string instant when present");
    const unaccepted = verifiedRow("t1", false, { acceptedSubmit: false, truthOk: null, pass: false });
    expect(caseRowDefect(unaccepted)).toBeNull();
    const nonResult = verifiedRow("t1", false, {
      truthOk: null,
      pass: null,
      runtimeNonResult: "status 402: payment required",
      runtimeNonResultKind: "provider",
    });
    expect(caseRowDefect(nonResult)).toBeNull();
    // false-for-both — an unaccepted row may not carry a truth verdict
    expect(
      caseRowDefect(verifiedRow("t1", false, { acceptedSubmit: false, truthOk: false, pass: false })),
    ).toMatch(/no truth verdict/);
    // half-shaped non-result evidence
    expect(
      caseRowDefect(verifiedRow("t1", false, { truthOk: null, pass: null, runtimeNonResult: "blocked" })),
    ).toMatch(/half-shaped/);
    expect(
      caseRowDefect(
        verifiedRow("t1", false, { truthOk: null, pass: null, runtimeNonResultKind: "provider" }),
      ),
    ).toMatch(/half-shaped/);
    // a non-result carries no verdict
    expect(
      caseRowDefect(
        verifiedRow("t1", true, { runtimeNonResult: "blocked", runtimeNonResultKind: "provider" }),
      ),
    ).toMatch(/carries no verdict/);
  });

  it("refuses a non-result kind outside the closed vocabulary at the read boundary", () => {
    // The type union is erased in stored JSON; a producer bug or hand-edited row could carry any
    // string. An unowned kind must be a named defect, never an excused non-result.
    for (const hostile of ["interrupted", "verifier-unavailable", "keyless", "Provider"]) {
      const defect = caseRowDefect(
        verifiedRow("t1", false, {
          truthOk: null,
          pass: null,
          runtimeNonResult: "blocked",
          runtimeNonResultKind: double(hostile),
        }),
      );
      expect(defect).toMatch(/unknown non-result kind/);
      expect(defect).toContain(`"${hostile}"`);
    }
  });

  it("isolation is required: null records UNPROVEN, a missing key records nothing and is refused", () => {
    const { isolation: _dropped, ...withoutIsolation } = verifiedRow("t1", true);
    expect(caseRowDefect(withoutIsolation)).toMatch(/isolation field `isolation` is required/);
    expect(caseRowDefect(verifiedRow("t1", true, { isolation: null }))).toBeNull();
  });
});

describe("denominator from the task set (B-1 fix 3)", () => {
  it("passes exactly when rows are a bijection with the task ids", async () => {
    const path = join(scratchDir("ana-case-record-"), "case-record.jsonl");
    const record = CaseRecord.open(path);
    await record.append(verifiedRow("t1", true));
    await record.append(verifiedRow("t2", false));
    await record.append(verifiedRow("zz", true, { runId: "other-run" }));
    await record.close();
    const rows = readCaseRecord(path);
    expect(() => assertCompleteRun(rows, "r1", ["t1", "t2"])).not.toThrow();
    expect(() => assertCompleteRun(rows, "r1", ["t1", "t2", "t3"])).toThrow(/missing \[t3\]/);
    expect(() => assertCompleteRun(rows, "r1", ["t1"])).toThrow(/foreign \[t2\]/);
  });

  it("names a duplicated case — 24 rows for 23 tasks is a defect, not extra evidence", async () => {
    const path = join(scratchDir("ana-case-record-"), "case-record.jsonl");
    const record = CaseRecord.open(path);
    await record.append(verifiedRow("t1", true));
    await record.append(verifiedRow("t1", false));
    await record.close();
    expect(() => assertCompleteRun(readCaseRecord(path), "r1", ["t1"])).toThrow(/duplicated \[t1\]/);
  });
});

describe("the verdict alone", () => {
  /**
   * `caseVerdict` exists because the outcome query and the iteration analysis each wrote these
   * five fields out. The shortcut that would make it wrong is `{ ...row }`: a case row also
   * carries identity, isolation, the run condition and trace pointers, and the query publishes the
   * verdict beside a separate `identity` object. The keys are asserted exactly for that reason.
   */
  it("carries the five fields and nothing else the row holds", () => {
    const row = double<CaseRecordRow>({
      schema: CASE_RECORD_SCHEMA,
      runId: "r1",
      builderId: "b1",
      slug: "s1",
      buildInputsHash: "h1",
      backendPin: "codex",
      taskId: "t1",
      family: "f1",
      acceptedSubmit: false,
      truthOk: null,
      pass: false,
      runtimeNonResult: null,
      runtimeNonResultKind: null,
      isolation: null,
      condition: null,
      traces: [],
    });
    expect(caseVerdict(row)).toEqual({
      acceptedSubmit: false,
      truthOk: null,
      pass: false,
      runtimeNonResult: null,
      runtimeNonResultKind: null,
    });
    expect(classifyCaseOutcome(caseVerdict(row))).toBe("unaccepted");
  });
});

describe("trace pointers checked against recorded digests", () => {
  it("a rewritten or deleted trace demotes its pointer instead of resolving silently", () => {
    const base = scratchDir("ana-case-record-");
    mkdirSync(join(base, "runs/r1/cases/t1"), { recursive: true });
    writeFileSync(join(base, "runs/r1/cases/t1/trace.json"), '{"turns":[]}');
    writeFileSync(join(base, "runs/r1/cases/t1/verifier.json"), '{"ok":true}');
    const row = verifiedRow("t1", true, {
      traces: [
        tracePointer(base, "runs/r1/cases/t1/trace.json"),
        tracePointer(base, "runs/r1/cases/t1/verifier.json"),
      ],
    });
    expect(verifyTracePointers(row, base).map((v) => v.state)).toEqual(["intact", "intact"]);
    writeFileSync(join(base, "runs/r1/cases/t1/trace.json"), '{"turns":[],"falsified":true}');
    rmSync(join(base, "runs/r1/cases/t1/verifier.json"));
    expect(verifyTracePointers(row, base).map((v) => v.state)).toEqual(["drifted", "missing"]);
  });
});
