import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { selectCampaignEpoch } from "../src/author/campaign-epoch.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { afterEach, describe, expect, it } from "bun:test";
import { CASE_TRACE_SCHEMA } from "../src/backends/trace-capture.ts";
import { sha256 } from "../src/meta/digest.ts";
import { caseRecordRow } from "./helpers/case-record-row.ts";
import {
  CLASS_NAMES,
  type ProseRow,
  type SessionExecution,
  type SessionSubmit,
  anchorVector,
  axis,
  writeSession,
} from "./helpers/prose-session.ts";
import {
  EVIDENCE_FLOOR,
  TRANSFORMERS_VERSION,
  classifyTarget,
  excerptOf,
  gradeEvidence,
  parseArgs,
  renderPosture,
  segmentsOf,
  solvePosture,
  submitPosture,
  summarise,
} from "../.claude/skills/whole-run-investigation/classifier/prose-classify.mjs";
import {
  censusSolves,
  hasCaseRecord,
} from "../.claude/skills/whole-run-investigation/classifier/prose-input.mjs";

const dirs: string[] = [];

const ROWS: ProseRow[] = [
  { turn: 1, atMs: 1000, kind: "reasoning", text: "row one: planning" },
  { turn: 1, atMs: 2000, kind: "message", text: "row two: diagnosing" },
  { turn: 1, atMs: 3000, kind: "reasoning", text: "row three: disputing" },
  { turn: 1, atMs: 5000, kind: "reasoning", text: "**Running tests** **Removing the advisor**" },
  { turn: 1, atMs: 9000, kind: "message", text: "row five:   after the\nlast submit" },
];
const SUBMITS: SessionSubmit[] = [
  { kind: "candidate", turn: 1, atMs: 3500, outcome: "refused", stage: "bundle" },
  { kind: "controller-terminal", turn: 1, atMs: 3600, outcome: "refused" },
  { kind: "candidate", turn: 1, atMs: 6000, outcome: "accepted", stage: null },
];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function temp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** A stand-in for the model: each anchor lands on its class axis, a row lands where its fixture says. */
function fakeEmbed(rows: Map<string, number[]>): (texts: string[]) => Promise<number[][]> {
  return async (texts) =>
    texts.map((text) => {
      const fixture = anchorVector(text) ?? rows.get(text);
      if (fixture === undefined) throw new Error(`no fixture vector for: ${text}`);
      return fixture;
    });
}

function writeEpoch(rows: ProseRow[], submits: SessionSubmit[], extra: SessionExecution = {}): string {
  const epochDir = temp("hb4-posture-");
  writeSession(epochDir, 1, rows, { submits, ...extra });
  return epochDir;
}

const VECTORS = new Map<string, number[]>([
  ["row one: planning", axis("planning")],
  ["row two: diagnosing", axis("diagnosing")],
  // Nearly equidistant from two classes: a low-margin label.
  [
    "row three: disputing",
    CLASS_NAMES.map((name) => (name === "disputing-verifier" ? 0.72 : name === "diagnosing" ? 0.69 : 0)),
  ],
  ["Running tests", axis("running-checks")],
  ["Removing the advisor", axis("workaround")],
  ["row five:   after the\nlast submit", axis("reporting-status")],
]);

describe("prose posture classifier", () => {
  it("pins the same transformers release as the root package.json", async () => {
    const manifest = await Bun.file(new URL("../package.json", import.meta.url)).json();
    expect(manifest.dependencies["@huggingface/transformers"]).toBe(TRANSFORMERS_VERSION);
  });

  it("splits a headline run into segments and keeps a prose row whole", () => {
    expect(segmentsOf("**Running tests** **Removing the advisor**")).toEqual([
      "Running tests",
      "Removing the advisor",
    ]);
    expect(segmentsOf("The **schema** is fine; I will submit now and explain the result at length.")).toEqual(
      ["The **schema** is fine; I will submit now and explain the result at length."],
    );
    expect(excerptOf("**Running tests**\n  after   regeneration", 20)).toBe(
      "Running tests after […13 bytes omitted]",
    );
  });

  it("labels rows by their last segment, keeps text out of rows and joins labels, reactions and excerpts to each submit", async () => {
    const epochDir = writeEpoch(ROWS, SUBMITS);
    const result = await classifyTarget(epochDir, { embed: fakeEmbed(VECTORS), window: 2 });
    expect(result.state).toBe("classified");
    expect(result.model?.embed).toBe("injected");
    expect(result.submits[0]).not.toHaveProperty("prior");
    expect(
      result.rows.map((row: { class: string; lowMargin: boolean; segments: number }) => [
        row.class,
        row.lowMargin,
        row.segments,
      ]),
    ).toEqual([
      ["planning", false, 1],
      ["diagnosing", false, 1],
      ["disputing-verifier", true, 1],
      ["workaround", false, 2],
      ["reporting-status", false, 1],
    ]);
    expect(result.rows[3].segmentClasses).toEqual(["running-checks", "workaround"]);
    expect(result.rows.every((row: { text?: string }) => row.text === undefined)).toBe(true);
    expect("rows" in result.input).toBe(false);
    // The controller-terminal row is not a submit; the second candidate sees only rows since the first.
    expect(
      result.submits.map(
        (submit: {
          outcome: string;
          rowsSincePrevious: number;
          dominant: string;
          recent: Array<{ class: string; excerpt: string }>;
          after: { rows: number; dominant: string | null };
          repeatsRefusedPosture: boolean;
        }) => [
          submit.outcome,
          submit.rowsSincePrevious,
          submit.dominant,
          submit.recent.map((row) => row.class),
          submit.after,
          submit.repeatsRefusedPosture,
        ],
      ),
    ).toEqual([
      [
        "refused",
        3,
        "diagnosing",
        ["diagnosing", "disputing-verifier"],
        { rows: 1, dominant: "workaround" },
        false,
      ],
      ["accepted", 1, "workaround", ["workaround"], { rows: 1, dominant: "reporting-status" }, false],
    ]);
    expect(result.submits[1].recent[0].excerpt).toBe("Running tests Removing the advisor");
    expect(result.summary?.find((row: { class: string }) => row.class === "disputing-verifier")).toEqual({
      class: "disputing-verifier",
      count: 1,
      reasoning: 1,
      message: 0,
      solve: 0,
      meanChars: 20,
      lowMargin: 1,
    });
    expect(result.sessions).toHaveLength(1);
    const text = renderPosture(result).join("\n");
    expect(text).toContain(
      "refused (bundle): 3 rows since previous, dominant diagnosing, recent diagnosing → disputing-verifier?",
    );
    expect(text).toContain("after: 1 rows, dominant workaround");
    expect(text).toContain("#3 disputing-verifier?: row three: disputing");
    expect(text).toContain("[running-checks → workaround]");
  });
  it("classifies only the Builder's own words, never the controller's prompt or a compaction", async () => {
    // The fake embedder throws on any text without a fixture vector, so embedding either of the
    // two controller rows fails the classification outright.
    const epochDir = writeEpoch(
      [
        { turn: 1, atMs: 500, kind: "prompt", text: "Build the harness for this request." },
        ...ROWS,
        // Longer than a message row may be: a compaction keeps its summary, and the reader must too.
        { turn: 1, atMs: 9500, kind: "compaction", text: `tokensBefore=90000 ${"s".repeat(6000)}` },
      ],
      SUBMITS,
    );
    const result = await classifyTarget(epochDir, { embed: fakeEmbed(VECTORS), window: 2 });
    expect(result.state).toBe("classified");
    expect(result.rows).toHaveLength(ROWS.length);
  });

  it("reports an epoch without captured prose as no-prose instead of classifying", async () => {
    const epochDir = temp("hb4-posture-");
    const epoch = selectCampaignEpoch(epochDir, { kickoff: "one line" }).dir;
    writeFileSync(
      join(epoch, "builder-execution.json"),
      JSON.stringify({ schema: "builder-execution/v6", proseOmitted: 0, submits: [] }),
    );
    const result = await classifyTarget(epochDir, { embed: fakeEmbed(new Map()) });
    expect(result.state).toBe("no-prose");
    expect(result.input.totals.unavailable).toBe(1);
    expect(renderPosture(result)[0]).toBe("no-prose: 1 sessions, 0 prose rows");
  });

  it("orders submits by their own session clock, tolerates a submit with no rows and flags a repeated refused posture", () => {
    const row = (sequence: number, atMs: number, cls: string) => ({
      epoch: "e",
      session: 1,
      sequence,
      turn: 1,
      atMs,
      kind: "message",
      class: cls,
      lowMargin: false,
      chars: 5,
    });
    const submit = (atMs: number, outcome: string) => ({
      epoch: "e",
      session: 1,
      turn: 1,
      atMs,
      outcome,
      stage: null,
    });
    const rows = [row(1, 10, "planning"), row(2, 30, "planning"), row(3, 50, "diagnosing")];
    const posture = submitPosture(
      rows,
      [submit(5, "refused"), submit(20, "refused"), submit(40, "refused"), submit(60, "accepted")],
      5,
    );
    expect(
      posture.map(
        (entry: { rowsSincePrevious: number; dominant: string | null; repeatsRefusedPosture: boolean }) => [
          entry.rowsSincePrevious,
          entry.dominant,
          entry.repeatsRefusedPosture,
        ],
      ),
    ).toEqual([
      [0, null, false],
      [1, "planning", false],
      [1, "planning", true],
      [1, "diagnosing", false],
    ]);
    expect(summarise([])).toEqual([]);
  });

  it("scopes a campaign to the sessions one run started, including a shared epoch", async () => {
    const campaign = temp("hb4-run-scope-");
    const epoch = selectCampaignEpoch(campaign, { kickoff: "one line" }).dir;
    const open = (runId: string, writtenAt: string) => {
      mkdirSync(join(campaign, "controller", runId), { recursive: true });
      writeFileSync(
        join(campaign, "controller", runId, "opening.json"),
        JSON.stringify({ runId, writtenAt }),
      );
    };
    const session = (
      n: number,
      text: string,
      writtenAt: string,
      durationMs: number,
      submit: SessionSubmit,
    ) => {
      writeSession(epoch, n, [{ turn: 1, atMs: 1000, text }], {
        backend: "codex",
        writtenAt,
        durationMs,
        submits: [submit],
      });
    };
    const vectors = new Map([
      ["run A planning", axis("planning")],
      ["run B workaround", axis("workaround")],
    ]);
    open("run-a", "2026-09-14T00:00:00.000Z");
    // A's session started at 00:10 but its last checkpoint landed after B opened.
    session(1, "run A planning", "2026-09-14T01:30:00.000Z", 80 * 60_000, {
      kind: "candidate",
      turn: 1,
      atMs: 2000,
      outcome: "refused",
      stage: "bundle",
    });
    const before = await classifyTarget(campaign, { embed: fakeEmbed(vectors), runId: "run-a" });
    open("run-b", "2026-09-14T01:00:00.000Z");
    session(2, "run B workaround", "2026-09-14T01:40:00.000Z", 30 * 60_000, {
      kind: "candidate",
      turn: 1,
      atMs: 2000,
      outcome: "accepted",
      stage: null,
    });
    const after = await classifyTarget(campaign, { embed: fakeEmbed(vectors), runId: "run-a" });
    expect(after.state).toBe("classified");
    expect(after.summary).toEqual(before.summary);
    expect(after.submits).toEqual(before.submits);
    expect(after.input.scope).toEqual({
      kind: "run",
      runId: "run-a",
      otherRunSessions: 1,
      unattributedSessions: 0,
    });
    const b = await classifyTarget(campaign, { embed: fakeEmbed(vectors), runId: "run-b" });
    expect(b.rows.map((row: { class: string }) => row.class)).toEqual(["workaround"]);
    expect(b.submits.map((submit: { outcome: string }) => submit.outcome)).toEqual(["accepted"]);
    const whole = await classifyTarget(campaign, { embed: fakeEmbed(vectors) });
    expect(whole.input.scope).toEqual({ kind: "campaign" });
    expect(whole.rows).toHaveLength(2);
    await expect(classifyTarget(campaign, { embed: fakeEmbed(vectors), runId: "run-c" })).rejects.toThrow(
      "no opening for run run-c",
    );
  });

  it("grades a reading against the row floor instead of calling four rows classified", () => {
    const thin = Array.from({ length: 4 }, () => ({ lowMargin: false }));
    const wide = Array.from({ length: EVIDENCE_FLOOR.rows }, () => ({ lowMargin: false }));
    const blurred = wide.map((row, index) => ({ ...row, lowMargin: index <= EVIDENCE_FLOOR.rows / 2 }));
    // An empty half takes a low-margin share of 1, not 0/0, so a caller reading the share alone
    // sees the worst reading rather than a NaN that serialises as null and drops the second
    // reason. `grade` stays "empty" either way, so pinning the grade alone leaves that guard
    // unheld, and a reader who mistakes the 1 for a full score has exactly one edit to make.
    expect(gradeEvidence([], "Builder")).toEqual({
      grade: "empty",
      rows: 0,
      lowMargin: 0,
      lowMarginShare: 1,
      reasons: [
        `0 classified Builder rows, under the ${EVIDENCE_FLOOR.rows}-row floor`,
        "100% of Builder rows are low-margin",
      ],
    });
    expect(gradeEvidence(thin, "Builder")).toMatchObject({
      grade: "thin",
      rows: 4,
      reasons: [`4 classified Builder rows, under the ${EVIDENCE_FLOOR.rows}-row floor`],
    });
    expect(gradeEvidence(wide, "Builder")).toMatchObject({ grade: "sufficient", lowMargin: 0, reasons: [] });
    expect(gradeEvidence(blurred, "solver").grade).toBe("thin");
  });

  it("reads no posture from a session the controller closed as a typed non-result", async () => {
    // The only row such an epoch captures is the provider's own "You've hit your session limit",
    // and a classifier that reads the transcript alone labels that as Builder reasoning.
    const limit = "You've hit your session limit · resets 8:50pm (Europe/Amsterdam)";
    const dir = writeEpoch([{ turn: 1, atMs: 10, kind: "message", text: limit }], [], {
      outcome: "turn-non-result",
    });
    const result = await classifyTarget(dir, {
      embed: fakeEmbed(new Map([[limit, axis("blocked-environment")]])),
    });
    expect(result.state).toBe("no-prose");
    expect(result.excludedNonResultRows).toBe(1);
    expect(result.input.totals.nonEvidenceSessions).toBe(1);
  });

  it("says from the tool record whether a correctness_check returned before each submit", () => {
    const rows = [
      {
        epoch: "e",
        session: 1,
        sequence: 1,
        atMs: 10,
        kind: "message",
        chars: 3,
        class: "planning",
        lowMargin: false,
      },
    ];
    const submits = [
      { epoch: "e", session: 1, turn: 1, atMs: 20, outcome: "refused" },
      { epoch: "e", session: 1, turn: 2, atMs: 60, outcome: "accepted" },
    ];
    const posture = submitPosture(rows, submits, 5, new Map(), [{ epoch: "e", session: 1, atMs: 40 }]);
    expect(posture.map((submit: { checkedSincePrevious: boolean }) => submit.checkedSincePrevious)).toEqual([
      false,
      true,
    ]);
  });

  it("reads the Built solver's own rows only from a trace whose bytes match the case record", () => {
    const campaign = temp("hb4-solves-");
    const caseDir = join(campaign, "versions", "v1", "runs", "r1", "cases");
    const write = (taskId: string, preview: string) => {
      mkdirSync(join(caseDir, taskId), { recursive: true });
      const trace = JSON.stringify({
        schema: CASE_TRACE_SCHEMA,
        turns: [{ turn: 1, assistantChars: preview.length, assistantPreview: preview, status: "ended" }],
        toolCalls: [],
      });
      writeFileSync(join(caseDir, taskId, "trace.json"), trace);
      return sha256(trace);
    };
    const good = write("t-pass", "All checks pass. Recording the artifact.");
    write("t-stale", "Diagnosing the refusal before retrying.");
    const record = [
      caseRecordRow("t-pass", "f", {
        runId: "r1",
        traces: [{ path: "runs/r1/cases/t-pass/trace.json", sha256: good }],
      }),
      caseRecordRow("t-stale", "f", {
        runId: "r1",
        acceptedSubmit: false,
        truthOk: null,
        pass: false,
        traces: [{ path: "runs/r1/cases/t-stale/trace.json", sha256: "0".repeat(64) }],
      }),
      caseRecordRow("t-cut", "f", {
        runId: "r1",
        truthOk: null,
        pass: null,
        runtimeNonResult: "the provider stopped answering",
        runtimeNonResultKind: "runtime",
      }),
      caseRecordRow("t-elsewhere", "f", { runId: "other" }),
    ];
    writeFileSync(
      join(campaign, "case-record.jsonl"),
      `${record.map((row, index) => JSON.stringify({ seq: index + 1, row })).join("\n")}\n`,
    );

    expect(hasCaseRecord(campaign)).toBe(true);
    const census = censusSolves(campaign, { runId: "r1" });
    expect(census.ok).toBe(false);
    expect(census.issues).toEqual([
      "t-stale: the case trace on disk does not match the digest the case record published",
    ]);
    expect(census.totals).toMatchObject({
      cases: 3,
      verified: 1,
      unaccepted: 1,
      nonResult: 1,
      tracesRead: 1,
      rows: 1,
    });
    expect(census.rows.map((row: { taskId: string }) => row.taskId)).toEqual(["t-pass"]);
    expect(census.cases.map((entry: { outcome: string }) => entry.outcome)).toEqual([
      "verified",
      "unaccepted",
      "non-result",
    ]);
    const posture = solvePosture(
      [
        {
          taskId: "t-pass",
          outcome: "verified",
          kind: "solve-message",
          class: "confident",
          lowMargin: false,
          chars: 40,
        },
      ],
      census.cases,
    );
    expect(
      posture.byOutcome.map((entry: { outcome: string; dominant: string | null }) => [
        entry.outcome,
        entry.dominant,
      ]),
    ).toEqual([
      ["verified", "confident"],
      ["unaccepted", null],
      ["non-result", null],
    ]);
    expect(posture.cases[2]).toMatchObject({
      taskId: "t-cut",
      outcome: "non-result",
      nonResultKind: "runtime",
      trace: "no-trace-pointer",
      rows: 0,
    });
  });

  it("scopes a run whose opening carries no parseable clock instead of refusing the whole reading", async () => {
    // The clock attributes sessions to their run; an opening without one still names a run that
    // exists, and the required view must report what it found rather than fail the snapshot.
    const campaign = temp("hb4-clockless-");
    mkdirSync(join(campaign, "controller", "44"), { recursive: true });
    writeFileSync(
      join(campaign, "controller", "44", "opening.json"),
      JSON.stringify({ runId: "44", source: { commit: "0".repeat(40) } }),
    );
    const result = await classifyTarget(campaign, { runId: "44", embed: fakeEmbed(new Map()) });
    expect(result.state).toBe("no-prose");
    expect(result.input).toMatchObject({
      ok: true,
      scope: { kind: "run", runId: "44", unattributedSessions: 0 },
      totals: { sessions: 0 },
    });
  });

  it("parses its options and refuses malformed ones", () => {
    expect(parseArgs(["/campaign", "--json", "--window", "3"])).toMatchObject({
      target: "/campaign",
      json: true,
      window: 3,
      minMargin: 0.5,
      batchSize: 16,
    });
    expect(parseArgs(["/campaign", "--run", "run-a"])).toMatchObject({ target: "/campaign", runId: "run-a" });
    expect(() => parseArgs(["/campaign", "--run"])).toThrow('option "--run" needs a value');
    expect(() => parseArgs([])).toThrow("expected 1 positional argument");
    expect(() => parseArgs(["/campaign", "--window", "0"])).toThrow("--window must be a positive integer");
    expect(() => parseArgs(["/campaign", "--min-margin", "-1"])).toThrow("minimum margin");
    expect(() => parseArgs(["/campaign", "--batch"])).toThrow('option "--batch" needs a value');
    expect(() => parseArgs(["/campaign", "--else"])).toThrow('unknown option "--else"');
  });
});
