import { afterEach, describe, expect, it } from "bun:test";
import { buildDigest } from "../.claude/skills/whole-run-investigation/scripts/digest.mjs";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { isString } from "../src/meta/json-shape.ts";
import { tmpdir } from "../src/meta/os.ts";
import { recordDigestBattery } from "./helpers/digest-battery.ts";
import { caseRecordRow } from "./helpers/case-record-row.ts";
import type { CaseRecordRow } from "../src/claim/case-record.ts";
import { dirname, join } from "../src/meta/path.ts";
import { recordedController } from "./helpers/recorded-controller.ts";
import type { BuilderSubmitAttempt } from "../src/author/builder-execution.ts";

const dirs: string[] = [];

type DigestFixture = { campaign: string; domainsRoot: string };

/** A complete `builder-execution/v6` record, since the digest reads through the strict reader. The
 *  submit rows take the writer's defaults, and the record stores the rows alone, as the writer does. */
function executionRecord(rows: Array<Partial<BuilderSubmitAttempt>>, calls = 0): string {
  const submits = rows.map(
    (row, index): BuilderSubmitAttempt => ({
      ordinal: index + 1,
      turn: index + 1,
      atMs: (index + 1) * 1000,
      kind: "candidate",
      outcome: "accepted",
      stage: row.outcome === undefined || row.outcome === "accepted" ? null : "validation",
      commit: "c".repeat(40),
      findingsDigest: row.outcome === undefined || row.outcome === "accepted" ? null : `digest-${index + 1}`,
      findingCodes: [],
      repeatedFindings: index === 0 ? null : false,
      findingsDelta: index === 0 ? null : { carried: 0, resolved: 0, introduced: 0 },
      workspaceChanged: index === 0 ? null : true,
      treeFirstSubmittedAsAttempt: null,
      terminal: false,
      ...row,
    }),
  );
  return JSON.stringify({
    schema: "builder-execution/v6",
    backend: "claude",
    runtimeIdentity: null,
    turns: 0,
    durationMs: 0,
    toolCalls: {
      total: calls,
      failed: 0,
      byName: calls === 0 ? {} : { bash: calls },
      custom: calls,
      native: 0,
    },
    usage: { inputTokens: null, outputTokens: null, costUsd: null, reportedTurns: 0, estimatedTurns: 0 },
    firstToolMs: null,
    submits,
    turnRetries: [],
    authoringReviews: [],
    failedByName: {},
    partialTurn: null,
    failedCalls: [],
    failedCallsOmitted: 0,
    customCalls: [],
    customCallsOmitted: 0,
    outcome: "recorded",
    writtenAt: "2026-08-25T00:00:00.000Z",
  });
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

function fixture(): DigestFixture {
  const root = mkdtempSync(join(tmpdir(), "ana-digest-"));
  dirs.push(root);
  const campaign = join(root, "campaigns", "demo");
  const domain = join(root, "domains", "demo-slug");
  mkdirSync(join(campaign, "epoch-aa"), { recursive: true });
  mkdirSync(join(campaign, "claims"), { recursive: true });
  mkdirSync(join(domain, "correctness-model"), { recursive: true });
  mkdirSync(join(domain, "agent"), { recursive: true });
  writeFileSync(join(domain, "correctness-model", "tasks.json"), "[]");
  mkdirSync(join(domain, "runs", "run-1", "cases", "t1"), { recursive: true });
  mkdirSync(join(domain, "runs", "run-4", "cases", "t1"), { recursive: true });
  writeFileSync(join(campaign, "epoch-aa", "campaign.json"), JSON.stringify({ slug: "demo-slug" }));
  writeFileSync(
    join(campaign, "epoch-aa", "builder-execution.json"),
    executionRecord(
      [
        { commit: "c1", outcome: "refused", findingsDigest: "aaaa1111bbbb" },
        { commit: "c2", outcome: "refused", findingsDigest: "aaaa1111bbbb", repeatedFindings: true },
        { commit: "c3", outcome: "accepted" },
      ],
      9,
    ),
  );
  writeFileSync(
    join(campaign, "claims", "run-1.json"),
    JSON.stringify({
      claim: {
        statement: {
          groundings: [
            { checkId: "alpha-check", kind: "authored", adapterId: null },
            { checkId: "beta-check", kind: "external-verifier", adapterId: "beta-engine" },
          ],
          verifierEnvironmentHash: null,
        },
      },
    }),
  );
  writeFileSync(
    join(domain, "correctness-model", "brief.json"),
    JSON.stringify({
      truthChecks: [
        { id: "alpha-check", grounding: { kind: "authored" } },
        { id: "beta-check", grounding: { kind: "external-verifier" } },
      ],
    }),
  );
  writeFileSync(
    join(domain, "correctness-model", "controls.json"),
    JSON.stringify({
      accept: [{ id: "a1" }],
      reject: [
        { id: "r1", expectedCheckId: "alpha-check", mutationClass: "wrong-value" },
        { id: "r2", expectedCheckId: "beta-check", mutationClass: "wrong-shape" },
      ],
    }),
  );
  writeFileSync(
    join(domain, "agent", "tools-spec.json"),
    JSON.stringify({
      tools: [
        {
          name: "judge_pin_choice",
          description: "Send the candidate pin you picked and have it judged before submission.",
        },
      ],
    }),
  );
  writeFileSync(
    join(domain, "runs", "run-1", "cases", "t1", "verifier.json"),
    JSON.stringify({
      ok: false,
      issues: [
        {
          // Historical verdict shape: severity "error" with the optional `blocking` field
          // omitted. The digest reader treats that omission as blocking, so this fixture
          // contributes one measured rejection for beta-check.
          severity: "error",
          checkId: "beta-check",
          message: "secret-verifier-detail-7731: main.c:81 missing token",
        },
      ],
    }),
  );
  writeFileSync(
    join(domain, "runs", "run-4", "cases", "t1", "verifier.json"),
    JSON.stringify({ ok: true, issues: [] }),
  );
  const traces = new Map<string, string>();
  for (const runId of ["run-1", "run-4"]) {
    const trace = JSON.stringify({
      schema: "case-trace/v4",
      backend: "test",
      turns: [{ turn: 1 }],
      toolCalls: [
        { toolName: "judge_pin_choice", isError: false },
        { toolName: "judge_pin_choice", isError: false },
        { toolName: "submit", isError: false },
      ],
      truncated: false,
      droppedRawEvents: 0,
    });
    const path = `runs/${runId}/cases/t1/trace.json`;
    writeFileSync(join(domain, path), trace);
    traces.set(path, new Bun.CryptoHasher("sha256").update(trace).digest("hex"));
  }
  const traced = (runId: string, pass: boolean) => {
    const path = `runs/${runId}/cases/t1/trace.json`;
    return gradedRow(runId, pass, { traces: [{ path, sha256: traces.get(path) ?? "" }] });
  };
  writeLedger(campaign, [traced("run-1", false), traced("run-4", true)]);
  recordDigestBattery(domain, ["run-1", "run-4"]);
  return { campaign, domainsRoot: join(root, "domains") };
}

/** Write the case ledger the way its one writer does: a `{seq, row}` line per row, seq from 1. */
function writeLedger(campaign: string, rows: CaseRecordRow[]): void {
  writeFileSync(
    join(campaign, "case-record.jsonl"),
    rows.map((row, index) => `${JSON.stringify({ seq: index + 1, row })}\n`).join(""),
  );
}

/** A graded row for task t1 of `runId`, whose verdict is `pass`. */
function gradedRow(runId: string, pass: boolean, overrides: Partial<CaseRecordRow> = {}): CaseRecordRow {
  return caseRecordRow("t1", "fam", { runId, truthOk: pass, pass, ...overrides });
}

/** A provider non-result row, in the shape the writer records one. */
function providerRow(runId: string, taskId: string): CaseRecordRow {
  return caseRecordRow(taskId, "fam", {
    runId,
    acceptedSubmit: false,
    truthOk: null,
    pass: null,
    runtimeNonResult: "provider stopped",
    runtimeNonResultKind: "provider",
  });
}

/** A valid provider-resource-budget/v2 snapshot with these role counts. */
/** Check the untyped script's output once. */
function digestOf(paths: ReturnType<typeof fixture>): string {
  const digest: unknown = buildDigest(paths);
  if (!isString(digest)) throw new Error("buildDigest must return the digest text");
  return digest;
}

describe("digest", () => {
  it("excludes retained diagnostic verdicts from shipping evidence", () => {
    const paths = fixture();
    const ledger = join(paths.campaign, "case-record.jsonl");
    const [first, second] = readFileSync(ledger, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line).row);
    writeLedger(paths.campaign, [
      {
        ...first,
        truthOk: null,
        pass: null,
        runtimeNonResult: "verifier unavailable",
        runtimeNonResultKind: "verifierUnavailable",
      },
      second,
    ]);
    expect(digestOf(paths)).toContain("graded oracle rows: 1 (from 2 terminal case rows)");
  });

  it("reports a changed verdict as an evidence gap", () => {
    const paths = fixture();
    const verdict = join(paths.domainsRoot, "demo-slug", "runs", "run-1", "cases", "t1", "verifier.json");
    writeFileSync(verdict, JSON.stringify({ ok: false, issues: [] }));
    const digest = digestOf(paths);
    expect(digest).toContain("shipping evidence gap:");
    expect(digest).toContain("graded oracle rows: 1 (from 1 terminal case rows)");
  });

  it("names the zone a decision placed its battery in, without inventing a due controller action", () => {
    const paths = fixture();
    const dir = join(paths.campaign, "difficulty-decisions");
    mkdirSync(dir);
    writeFileSync(
      join(dir, "0.json"),
      JSON.stringify({
        schema: "difficulty-decision/v6",
        runId: "placed-0",
        difficulty: {
          band: [0.2, 0.5],
          decision: {
            action: "placed",
            rationale: "5/6, Wilson interval [0.436, 0.970] against target range [0.2, 0.5]",
            placement: { passes: 5, n: 6, zone: "over-aim" },
          },
          admitted: 1,
          excluded: [{ runId: "r2", reason: "claim refused" }],
        },
      }),
    );
    // A decision that placed no battery has no zone to report, and must not grow a stray one.
    writeFileSync(
      join(dir, "1.json"),
      JSON.stringify({
        schema: "difficulty-decision/v6",
        runId: "unplaced-1",
        difficulty: {
          decision: { action: "no-difficulty-evidence", rationale: "no batteries recorded" },
          admitted: 0,
          excluded: [],
        },
      }),
    );
    const digest = digestOf(paths);
    expect(digest).toContain("placed-0: action placed over-aim · admitted 1 excluded 1");
    expect(digest).toContain("unplaced-1: action no-difficulty-evidence · admitted 0 excluded 0");
    expect(digest).not.toMatch(/(?:STOP|BROADEN|REBUILD) DUE/);
  });

  it("refuses a pre-v5 decision by name rather than reading its retired counters", () => {
    const paths = fixture();
    const dir = join(paths.campaign, "difficulty-decisions");
    mkdirSync(dir);
    // The shape a pre-v5 controller recorded. Its action word `climb` is not one of v5's four, but
    // two of them — `placed` and `repeated-failure-set` — are spelled the same in both vocabularies,
    // so nothing inside a record like this separates a retired meaning from a current one. The
    // version is the whole of the evidence, and the ledger prints the file rather than the reading.
    writeFileSync(
      join(dir, "0.json"),
      JSON.stringify({
        runId: "legacy-0",
        difficulty: {
          decision: { action: "climb", currentLevel: 2, nextLevel: 3 },
          saturatedLevels: 4,
          saturatedClimbs: 4,
          saturatedBroadens: 1,
          admitted: 4,
          excluded: [],
        },
      }),
    );
    const digest = digestOf(paths);
    expect(digest).toContain("refused, not difficulty-decision/v6 — 0.json: no schema");
    expect(digest).not.toContain("legacy-0");
    expect(digest).not.toMatch(/satClimbs|satLevelled|satRange|satBroadens|THRESHOLD DRIFT/);
  });

  it("says a decision was refused rather than falling through to the never-recorded line", () => {
    const paths = fixture();
    const dir = join(paths.campaign, "difficulty-decisions");
    mkdirSync(dir);
    writeFileSync(join(dir, "0.json"), JSON.stringify({ schema: "difficulty-decision/v3", runId: "old-0" }));
    // Absence and refusal read alike in a ledger that prints neither, and they call for opposite
    // moves: one says read the controller's own decision reasons, the other says read this campaign
    // with the tree that wrote it. So the empty-section sentence must not stand in for a refusal.
    const digest = digestOf(paths);
    expect(digest).toContain("refused, not difficulty-decision/v6 — 0.json: difficulty-decision/v3");
    expect(digest).not.toContain("no recorded difficulty decisions");
  });

  it("raises the perfect-battery trigger off the zone that replaced the climb action", () => {
    const perfect = (zone: string): string => {
      const paths = fixture();
      const dir = join(paths.campaign, "difficulty-decisions");
      mkdirSync(dir);
      writeFileSync(
        join(dir, "0.json"),
        JSON.stringify({
          schema: "difficulty-decision/v6",
          // run-4 graded 1 and passed 1, so a decision that called it significantly
          // too easy and got a perfect battery back is angle 27's question.
          runId: "run-4",
          difficulty: { decision: { action: "placed", placement: { zone } }, admitted: 1, excluded: [] },
        }),
      );
      return digestOf(paths);
    };
    expect(perfect("too-easy")).toContain("PERFECT BATTERY AFTER CLIMB (angle 27 trigger): run-4 1/1");
    expect(perfect("on-aim")).not.toContain("PERFECT BATTERY AFTER CLIMB");
  });

  it("flags checks with reject controls but no measured rejection and counts those that rejected", () => {
    const digest = digestOf(fixture());
    expect(digest).toContain("UNTRIPPED IN SHIPPING (rejCtl>0, shipRej=0 over 2 graded rows): alpha-check");
    expect(digest).not.toContain(
      "UNTRIPPED IN SHIPPING (rejCtl>0, shipRej=0 over 2 graded rows): alpha-check, beta-check",
    );
    expect(digest).toContain("3 submits (refused:2 accepted:1)");
    expect(digest).toContain("topFindingsDigest aaaa1111 x2");
    expect(digest).not.toContain("surviving pairs");
  });

  it("counts an omitted blocking field but not an explicit false or a warning", () => {
    const paths = fixture();
    const verdict = join(paths.domainsRoot, "demo-slug", "runs", "run-1", "cases", "t1", "verifier.json");
    const bothInert =
      "UNTRIPPED IN SHIPPING (rejCtl>0, shipRej=0 over 2 graded rows): alpha-check, beta-check";
    // The fixture row omits `blocking`, so beta-check has a shipping rejection and stays out.
    expect(digestOf(paths)).not.toContain(bothInert);
    for (const issue of [
      { severity: "error", blocking: false, checkId: "beta-check", message: "soft, ships disclosed" },
      { severity: "warning", checkId: "beta-check", message: "advisory only" },
    ]) {
      writeFileSync(verdict, JSON.stringify({ ok: false, issues: [issue] }));
      recordDigestBattery(join(paths.domainsRoot, "demo-slug"), ["run-1"]);
      expect(digestOf(paths)).toContain(bothInert);
    }
  });

  it("counts a contested verified case by the checks its judge-reviews row names", () => {
    const paths = fixture();
    mkdirSync(join(paths.campaign, "analysis"), { recursive: true });
    // The judge-reviews writer records `contested` as one flat array of cases, each naming the
    // declared checks the cited Judge fail touched.
    const contested = (taskId: string) => ({
      taskId,
      family: "fam",
      judge: "fail",
      verifier: "pass",
      rules: [],
      rationale: "",
      confirmed: true,
      checkIds: ["beta-check"],
      evidence: null,
      artifact: null,
    });
    writeFileSync(
      join(paths.campaign, "analysis", "run-1-judges.json"),
      JSON.stringify({
        schema: "judge-reviews/v11",
        runId: "run-1",
        census: null,
        // t9 was never a verified case of run-1, so its row is not attributed.
        contested: [contested("t1"), contested("t9")],
        exit: { kind: "completed" },
      }),
    );
    // checkId, kind, adapter, grounding source, rejCtl, mutClasses, shipRej, shapes, contested.
    expect(digestOf(paths)).toMatch(
      /^beta-check\s+external-verifier\s+beta-engine\s+in-process\s+1\s+1\s+1\s+1\s+1\s+no$/m,
    );
  });

  it("names an installed-tool claim by its verifier environment digest, and an in-process claim as such", () => {
    const paths = fixture();
    const claimPath = join(paths.campaign, "claims", "run-1.json");
    const groundings = [
      { checkId: "alpha-check", kind: "authored", adapterId: null },
      { checkId: "beta-check", kind: "external-verifier", adapterId: "beta-engine" },
    ];
    // A claim from the installed-tools source: no registry provenance, an environment hash instead.
    writeFileSync(
      claimPath,
      JSON.stringify({ claim: { statement: { groundings, verifierEnvironmentHash: "abcdef0123456789" } } }),
    );
    expect(digestOf(paths)).toMatch(
      /^beta-check\s+external-verifier\s+beta-engine\s+installed-tool:abcdef012\s+/m,
    );
    expect(digestOf(paths)).toContain(
      "algorithm independence and the complete imported dependency chain remain unproved",
    );
    // Nothing ran outside the process: the column must not read as a missing field.
    writeFileSync(
      claimPath,
      JSON.stringify({ claim: { statement: { groundings, verifierEnvironmentHash: null } } }),
    );
    expect(digestOf(paths)).toMatch(/^beta-check\s+external-verifier\s+beta-engine\s+in-process\s+/m);
  });

  it("reads the battery root matching the recorded digest when an earlier root has a changed copy", () => {
    const paths = fixture();
    const stale = join(paths.campaign, "runs", "run-1", "cases", "t1");
    mkdirSync(stale, { recursive: true });
    writeFileSync(
      join(stale, "trace.json"),
      JSON.stringify({
        schema: "case-trace/v4",
        backend: "test",
        turns: [],
        toolCalls: [],
        truncated: false,
        droppedRawEvents: 0,
      }),
    );
    writeFileSync(join(stale, "verifier.json"), JSON.stringify({ ok: true, issues: [] }));

    const digest = digestOf(paths);
    expect(digest).toContain("graded oracle rows: 2 (from 2 terminal case rows)");
    expect(digest).toContain("traces 2 · distinct tool sequences 1 · tool errors 0");
    expect(digest).toContain("UNTRIPPED IN SHIPPING (rejCtl>0, shipRej=0 over 2 graded rows): alpha-check");
  });

  it("collapses a byte-identical archival duplicate and reports a divergent one", () => {
    const paths = fixture();
    const first = gradedRow("run-1", false);
    const second = gradedRow("run-4", true);
    writeLedger(paths.campaign, [
      first,
      second,
      // An archival copy of the first row: same case, same bytes. It is one case, not two.
      first,
      // The same case key claiming a different verdict: never silently collapsed.
      { ...second, truthOk: false, pass: false },
    ]);
    const digest = digestOf(paths);
    expect(digest).toContain("run-1: graded 1");
    expect(digest).toContain("run-4: graded 1");
    expect(digest).toContain("collapsed 1 byte-identical duplicate case rows");
    expect(digest).toContain("DIVERGENT DUPLICATES (same case key, different bytes): run-4/t1");
  });

  it("counts the recorded solver instants as the per-case record", () => {
    const paths = fixture();
    writeLedger(paths.campaign, [
      gradedRow("run-1", true, {
        solverStartedAt: "2026-09-02T08:48:17.977Z",
        solverEndedAt: "2026-09-02T08:49:50.879Z",
      }),
      // The instants are optional on the row, so two rows without them are not counted.
      gradedRow("run-4", true),
      gradedRow("run-9", true),
    ]);
    expect(digestOf(paths)).toContain("case rows with solver instants: 1 of 3");
  });

  it("says no climb decision was recorded instead of claiming the selector never ran", () => {
    // run47-opus-0902: no difficulty-decisions directory, yet round 2's selector ran and chose rebuild.
    const digest = digestOf(fixture());
    expect(digest).toContain("no recorded difficulty decisions: no climb decision was recorded");
    expect(digest).not.toContain("never ran");
  });

  it("names the terminal ledger and the exact tree each half of the check table came from", () => {
    const digest = digestOf(fixture());
    expect(digest).toContain("graded oracle rows: 2 (from 2 terminal case rows)");
    expect(digest).toContain("correctness-model/controls.json");
    expect(digest).toContain("a candidate battery may declare a different corpus");
    expect(digest).toContain("measured adopted-tree demo-slug");
  });

  it("keys the check table and tool roster on the candidate that graded the measured rows", () => {
    // run23 and truss measured a candidate battery while this block read the adopted tree, so the
    // rejCtl column described controls unused by the measured cases. Move the graded battery
    // into a candidate root with its own corpus and tool spec: the digest must follow the rows.
    const paths = fixture();
    const adopted = join(paths.domainsRoot, "demo-slug");
    const candidate = join(paths.campaign, "candidates", "fullrun-i02");
    mkdirSync(join(candidate, "correctness-model"), { recursive: true });
    mkdirSync(join(candidate, "agent"), { recursive: true });
    cpSync(join(adopted, "runs"), join(candidate, "runs"), { recursive: true });
    rmSync(join(adopted, "runs"), { recursive: true, force: true });
    cpSync(
      join(adopted, "correctness-model", "brief.json"),
      join(candidate, "correctness-model", "brief.json"),
    );
    writeFileSync(
      join(candidate, "correctness-model", "controls.json"),
      JSON.stringify({
        accept: [{ id: "a1" }, { id: "a2" }],
        reject: [{ id: "r1", expectedCheckId: "alpha-check", mutationClass: "wrong-value" }],
      }),
    );
    // The same tool, described without offering a verdict. The preview flag reads a description,
    // so it fires only if the roster still came from the adopted tree.
    writeFileSync(
      join(candidate, "agent", "tools-spec.json"),
      JSON.stringify({ tools: [{ name: "judge_pin_choice", description: "Record the pin you chose." }] }),
    );

    recordDigestBattery(candidate, ["run-1", "run-4"]);
    const digest = digestOf(paths);
    expect(digest).toContain("measured candidate fullrun-i02");
    expect(digest).toContain("accept 2 · reject 1");
    expect(digest).toContain("tool roster read from measured candidate fullrun-i02");
    expect(digest).not.toContain("ORACLE-PREVIEW SUSPECT");
    expect(digest).not.toContain("fallback: adopted-tree");
  });

  it("keeps the missing trace visible when a recorded battery still binds the product", () => {
    const paths = fixture();
    writeLedger(paths.campaign, [gradedRow("run-1", false)]);
    const digest = digestOf(paths);
    expect(digest).toContain("measured adopted-tree demo-slug");
    expect(digest).toContain("graded oracle rows: 0");
    expect(digest).not.toContain("measured candidate");
  });

  it("flags a repeated candidate evaluator when the noun precedes the judging verb", () => {
    const digest = digestOf(fixture());
    expect(digest).toContain("judge_pin_choice");
    expect(digest).toContain(
      "ORACLE-PREVIEW SUSPECT: repeated per-case candidate evaluation via public tool",
    );
  });

  it("excludes archived battery copies and solvability roots from terminal trace totals", () => {
    const paths = fixture();
    const root = join(paths.domainsRoot, "demo-slug");
    const source = join(root, "runs", "run-1", "cases", "t1");
    const archived = join(paths.campaign, "candidates", "archived", "runs", "run-1", "cases", "t1");
    const solvability = join(root, "runs", "f2-solvability", "cases", "witness");
    mkdirSync(archived, { recursive: true });
    mkdirSync(solvability, { recursive: true });
    for (const name of ["verifier.json", "trace.json"]) {
      writeFileSync(join(archived, name), readFileSync(join(source, name), "utf8"));
      writeFileSync(join(solvability, name), readFileSync(join(source, name), "utf8"));
    }

    const digest = digestOf(paths);
    expect(digest).toContain("graded oracle rows: 2 (from 2 terminal case rows)");
    expect(digest).toContain("traces 2 · distinct tool sequences 1 · tool errors 0");
    expect(digest).toContain("submit                     2");
    expect(digest).not.toContain("traces 4");
  });

  it("never carries verifier issue text into the digest", () => {
    const digest = digestOf(fixture());
    expect(digest).not.toContain("secret-verifier-detail-7731");
    expect(digest).not.toContain("missing token");
  });

  it("classifies a submit by the producer's kind and never by a terminal flag", () => {
    const paths = fixture();
    const epoch = join(paths.campaign, "epoch-aa");
    writeFileSync(
      join(epoch, "builder-execution.json"),
      executionRecord([
        { outcome: "refused", commit: "candidate-a", terminal: true },
        { outcome: "refused", commit: "budget-limited-near-miss", terminal: true },
        { outcome: "refused", commit: "candidate-c", terminal: true },
      ]),
    );
    writeFileSync(
      join(epoch, "builder-execution-02.json"),
      executionRecord([
        {
          kind: "controller-terminal",
          outcome: "refused",
          stage: "gates",
          commit: "budget-limited",
          findingCodes: ["budget-limited"],
          terminal: true,
        },
        // A candidate that ended the session is terminal too, and stays a candidate.
        { outcome: "refused", commit: "candidate-b", terminal: true },
      ]),
    );
    const digest = digestOf(paths);
    // Every row in the first record is terminal and one commit even reads like the boundary, so a
    // reader that classified on those two fields would report a controller row here.
    expect(digest).toContain("epoch-aa/builder-execution.json: 3 submits (refused:3)");
    expect(digest).toContain("candidate submits 3 (refused:3) · controller terminals 0 (none)");
    expect(digest).toContain("epoch-aa/builder-execution-02.json: 2 submits (refused:2)");
    expect(digest).toContain("candidate submits 1 (refused:1) · controller terminals 1 (refused:1)");
    expect(digest).toContain("  controller terminal commits: budget-limited");
    // The controller row is not a candidate tree, and every count is derived from the rows.
    expect(digest).toContain("candidate trees 1 · repeatedFindings 0 · unchangedTree 0");
    expect(digest).toContain(
      "builder-execution records: 1 primary bare (first session), 1 numbered (later sessions)",
    );
    expect(digest.indexOf("builder-execution.json: 3 submits")).toBeLessThan(
      digest.indexOf("builder-execution-02.json: 2 submits"),
    );
  });

  it("names an execution record the current reader refuses instead of half-reading it", () => {
    const paths = fixture();
    writeFileSync(
      join(paths.campaign, "epoch-aa", "builder-execution.json"),
      JSON.stringify({ schema: "builder-execution/v4", submits: [], outcome: "recorded" }),
    );
    const digest = digestOf(paths);
    expect(digest).toMatch(
      /EXECUTION RECORD UNAVAILABLE: .*builder-execution\.json: .*builder-execution\/v4/,
    );
    expect(digest).not.toContain("builder-execution.json: 0 submits");
    expect(digest).toContain(
      "builder-execution records: 0 primary bare (first session), 0 numbered (later sessions)",
    );
  });

  it("counts workshop actions through the ledger's owner and refuses a damaged ledger whole", () => {
    const paths = fixture();
    const ledger = join(paths.campaign, "epoch-aa", "verifier-workshop.jsonl");
    const row = (sequence: number, outcome: string) =>
      JSON.stringify({ schema: "verifier-workshop-action/v2", sequence, action: "run", outcome });
    writeFileSync(ledger, `${row(1, "completed")}\n${row(2, "non-result")}\n`);
    expect(digestOf(paths)).toContain("epoch-aa: workshop 2 actions, 1 not completed (50%)");
    // A row out of sequence used to be skipped silently, leaving a count that looked complete.
    writeFileSync(ledger, `${row(1, "completed")}\n${row(3, "failed")}\n`);
    const damaged = digestOf(paths);
    expect(damaged).toContain(
      "epoch-aa: WORKSHOP LEDGER REFUSED — invalid verifier workshop action evidence at line 2",
    );
    expect(damaged).not.toContain("epoch-aa: workshop 2 actions");
  });

  // The 2026-09-08 ledgers (digest-ledgers.mjs). Each case writes the recorded shape a real
  // campaign carries and checks the trigger row a lane is admitted on, plus its nearest quiet shape.
  it("classifies provider non-results as censoring and flags a decision read on a censored battery", () => {
    const paths = fixture();
    const domain = join(paths.domainsRoot, "demo-slug");
    const record = (
      providerTurns: { builder: number; built: number; review: number },
      absentStep: string,
    ) => {
      rmSync(join(paths.campaign, "controller", "run-1"), { recursive: true, force: true });
      recordedController({
        repo: dirname(dirname(paths.campaign)),
        projectId: "demo",
        runId: "run-1",
        openedAt: "2026-09-08T00:00:00.000Z",
        providerTurns,
        absentSteps: [absentStep],
      });
    };
    record(
      { builder: 5, built: 5, review: 10 },
      "epoch review — You've hit your weekly limit · resets Sep 12 at 8am",
    );
    const battery = (messages: string[]) =>
      recordDigestBattery(domain, ["run-2"], {
        "run-2": messages.map((message, index) => ({
          taskId: `c${index}`,
          runtimeNonResultKind: "provider",
          solver: {
            nonResult: { kind: "provider", message },
            startedAt: `2026-09-08T00:0${index}:00.000Z`,
            endedAt: `2026-09-08T00:0${index}:30.000Z`,
          },
        })),
      });
    // The controller's own allowance wording. "Out of extra usage" is a provider non-result but not
    // an exhausted allowance there, since a mislabelled entrypoint produces it too.
    battery([
      "You've hit your weekly limit · resets Sep 12 at 8am (Europe/Amsterdam)",
      "not attempted: the battery stopped scheduling after 5 consecutive provider non-results",
    ]);
    const rows = readFileSync(join(paths.campaign, "case-record.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line).row);
    writeLedger(paths.campaign, [...rows, providerRow("run-2", "c0"), providerRow("run-2", "c1")]);
    mkdirSync(join(paths.campaign, "difficulty-decisions"), { recursive: true });
    writeFileSync(
      join(paths.campaign, "difficulty-decisions", "run-3.json"),
      JSON.stringify({
        schema: "difficulty-decision/v6",
        runId: "run-3",
        difficulty: {
          decision: { action: "placed", placement: { zone: "on-aim" }, evidence: [{ runId: "run-2" }] },
        },
      }),
    );

    const digest = digestOf(paths);
    expect(digest).toContain("REVIEW TURNS EXCEED SOLVER TURNS (angle 28 trigger): review 10 > built 5");
    expect(digest).toContain(
      "EXPLICIT PROVIDER EXHAUSTION — operational interruption, not a harness defect (AGENTS.md)",
    );
    expect(digest).toContain(
      "run-2: graded 0 · provider non-results 2 (explicit-exhaustion 1, not-attempted 1)",
    );
    expect(digest).toContain("CENSORED (explicit exhaustion; 1 not attempted after it)");
    expect(digest).toContain("DECISION ON CENSORED BATTERY (angle 28 trigger): run-3 placed read run-2");
    expect(digest).toContain("classification: explicit exhaustion censors the denominator");

    // A generic limit is not exhaustion: the row asks for an investigation and no censoring claim.
    battery(["429 too many requests", "socket hang up"]);
    record({ builder: 5, built: 10, review: 5 }, "epoch review — 429 too many requests");
    const generic = digestOf(paths);
    expect(generic).toContain("run-1: provider turns 20 of cap 21 · builder 5 · built 10 · review 5");
    expect(generic).not.toContain("REVIEW TURNS EXCEED SOLVER TURNS");
    expect(generic).toContain(
      'absent step "epoch review": generic 429/rate limit — investigate the actual failure; not proof of exhaustion',
    );
    expect(generic).toContain("run-2: graded 0 · provider non-results 2 (generic-limit 1, other 1)");
    expect(generic).toContain("PROVIDER NON-RESULTS UNEXPLAINED");
    expect(generic).not.toContain("classification: explicit exhaustion");

    // A terminal the controller reader refuses prints no role counts or steps it cannot vouch for.
    const terminal = join(paths.campaign, "controller", "run-1", "terminal.json");
    const { providerResourceBudget: _dropped, ...rest } = JSON.parse(readFileSync(terminal, "utf8"));
    writeFileSync(terminal, JSON.stringify(rest));
    const refused = digestOf(paths);
    expect(refused).toContain("run-1: CONTROLLER EVIDENCE REFUSED — ");
    expect(refused).not.toContain("run-1: provider turns");
    expect(refused).not.toContain('absent step "epoch review"');
  });

  it("separates attested, unattested and no-turn identity rows and flags a served model off the pin", () => {
    const paths = fixture();
    const domain = join(paths.domainsRoot, "demo-slug");
    recordedController({
      repo: dirname(dirname(paths.campaign)),
      projectId: "demo",
      runId: "run-1",
      openedAt: "2026-09-08T00:00:00.000Z",
      builtModel: "claude-opus-5",
    });
    const identity = (model: string, resultId: string | null) => ({
      schema: "runtime-model-identity/v2",
      provider: { id: "anthropic", model, resultId },
    });
    const battery = (model: string) =>
      recordDigestBattery(domain, ["run-1"], {
        "run-1": [
          { taskId: "t1", solver: { completedTurns: 3, runtimeIdentities: [identity(model, "msg_1")] } },
          { taskId: "t2", solver: { completedTurns: 2, runtimeIdentities: [identity(model, null)] } },
          { taskId: "t3", solver: { completedTurns: 0, runtimeIdentities: [] } },
        ],
      });
    battery("claude-opus-5");
    rmSync(join(domain, "runs", "run-4", "battery.json"));
    const digest = digestOf(paths);
    expect(digest).toContain(
      "run-1: attested 1 · unattested 1 · no completed turn 1 · configured claude-opus-5 · served {claude-opus-5 ×1}",
    );
    expect(digest).toContain("UNATTESTED ROWS: 1 case(s) carry no provider receipt");
    expect(digest).not.toContain("SERVED MODEL MISMATCH");
    expect(digest).toContain("run-4: battery record unavailable — attestation unobservable");

    battery("claude-sonnet-5");
    expect(digestOf(paths)).toContain(
      "SERVED MODEL MISMATCH: provider attested claude-sonnet-5 against configured claude-opus-5",
    );
  });

  it("settles the judge census inventory and triggers angle 2 on a recorded disagreement", () => {
    const paths = fixture();
    mkdirSync(join(paths.campaign, "analysis"), { recursive: true });
    const judges = (disagreements: number) =>
      JSON.stringify({
        schema: "judge-reviews/v11",
        runId: "run-1",
        contested: [],
        census: {
          evidence: {
            judge: "on",
            offered: 2,
            disagreements,
            disagreementDenominator: 2,
          },
        },
        exit: { kind: "completed" },
      });
    writeFileSync(join(paths.campaign, "analysis", "run-1-judges.json"), judges(0));
    const quiet = digestOf(paths);
    expect(quiet).toContain("run-1: judge on · census battery 2 · disagreements 0/2 · exit completed");
    expect(quiet).toContain("angle 2: no trigger");
    // The census carries no controls by construction, so neither a controls column nor an alarm
    // about their absence tells a reader anything: src/truth/judge.ts writes a constant zero.
    expect(quiet).not.toContain("JUDGE CENSUS WITHOUT CONTROLS");
    expect(quiet).not.toContain("controlValidity");

    // Run de8b40 recorded exactly this, 1 of 6, and the validated-only trigger hid it.
    writeFileSync(join(paths.campaign, "analysis", "run-1-judges.json"), judges(1));
    expect(digestOf(paths)).toContain("CENSUS WITH DISAGREEMENT (angle 2 trigger): 1 census(es)");

    // A record the judge-reviews writer did not produce is refused by name, not read as a census.
    writeFileSync(
      join(paths.campaign, "analysis", "run-1-judges.json"),
      JSON.stringify({ census: { judge: "on", disagreements: 1 }, exit: { kind: "completed" } }),
    );
    const refused = digestOf(paths);
    expect(refused).toContain("refused, not judge-reviews/v11 — run-1-judges.json");
    expect(refused).not.toContain("CENSUS WITH DISAGREEMENT");
  });

  it("reads family coverage, a repeated condition and an unowned admitted finding from recorded rows", () => {
    const paths = fixture();
    const row = (runId: string, taskId: string, family: string, pass: boolean) =>
      caseRecordRow(taskId, family, {
        runId,
        buildInputsHash: "abc123def456",
        backendPin: "claude/claude-opus-5/medium",
        truthOk: pass,
        pass,
      });
    writeLedger(paths.campaign, [
      ...["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"].map((id) =>
        row("run-1", `p${id}`, "planar", true),
      ),
      ...["a", "b", "c", "d", "e"].map((id) => row("run-1", `s${id}`, "spatial", false)),
      ...["a", "b"].map((id) => row("run-2", `s${id}`, "spatial", false)),
      row("run-2", "pa", "planar", true),
    ]);
    mkdirSync(join(paths.campaign, "analysis"), { recursive: true });
    writeFileSync(
      join(paths.campaign, "analysis", "run-1-admission.json"),
      JSON.stringify({
        admitted: [
          { kind: "contract", proposedOwner: null },
          { kind: "contract", proposedOwner: "correctness-model" },
        ],
        refused: [],
        feedback: [{ owner: "correctness-model" }],
        policy: "epoch-review/v3",
      }),
    );
    const digest = digestOf(paths);
    expect(digest).toContain("run-1: 12/17");
    expect(digest).toMatch(/spatial\s+0\/5\s+\[[0-9.]+,[0-9.]+\]\s+all-fail AGGREGATE HIDES FAMILY/);
    expect(digest).toContain("FAMILY UNMOVED all-fail: spatial 0/5 → 0/2 (run-1 → run-2)");
    expect(digest).toContain("REPEATED CONDITION (angle 18 trigger): run-1, run-2");
    expect(digest).toContain(
      "run-1: admitted 2 ((none) 1, correctness-model 1) · refused 0 · feedback owners {correctness-model} · policy epoch-review/v3",
    );
    expect(digest).toContain("FINDINGS WITHOUT PROPOSED OWNER: 1 of 2 admitted findings name no owner");
  });

  it("each measured product keeps its check corpus, join targets and case denominator", () => {
    const root = mkdtempSync(join(tmpdir(), "ana-product-digest-"));
    try {
      const campaign = join(root, "campaigns", "demo");
      const rows: CaseRecordRow[] = [];
      for (const [id, verified, joins] of [
        ["initial", 25, 6],
        ["successor", 22, 9],
      ] as const) {
        const product = join(campaign, "versions", id);
        mkdirSync(join(product, "correctness-model"), { recursive: true });
        mkdirSync(join(product, "agent"));
        writeFileSync(join(product, "correctness-model", "tasks.json"), "[]");
        const checks = Array.from({ length: id === "initial" ? 7 : 8 }, (_, index) => ({
          id: `check-${index}`,
        }));
        writeFileSync(
          join(product, "correctness-model", "brief.json"),
          JSON.stringify({ truthChecks: checks }),
        );
        writeFileSync(
          join(product, "correctness-model", "controls.json"),
          JSON.stringify({
            reject: Array.from({ length: joins + 1 }, (_, index) =>
              index < joins
                ? { expectedCheckId: "check-0", targetsJoin: "bound-input" }
                : { expectedCheckId: "check-0" },
            ),
          }),
        );
        for (let index = 0; index < 25; index++) {
          const path = `runs/${id}/cases/t${index}/trace.json`;
          const trace = JSON.stringify({
            schema: "case-trace/v4",
            turns: [],
            toolCalls: [],
            truncated: false,
            droppedRawEvents: 0,
          });
          mkdirSync(join(product, "runs", id, "cases", `t${index}`), { recursive: true });
          writeFileSync(join(product, path), trace);
          if (index < verified) {
            writeFileSync(
              join(product, "runs", id, "cases", `t${index}`, "verifier.json"),
              JSON.stringify({ ok: true, issues: [] }),
            );
          }
          const traces = [{ path, sha256: new Bun.CryptoHasher("sha256").update(trace).digest("hex") }];
          rows.push(
            index < verified
              ? caseRecordRow(`t${index}`, "fam", { runId: id, traces })
              : caseRecordRow(`t${index}`, "fam", {
                  runId: id,
                  traces,
                  acceptedSubmit: false,
                  truthOk: null,
                  pass: false,
                }),
          );
        }
        recordDigestBattery(product, [id]);
      }
      // A refused candidate and an unrelated claim cannot lend checks or grounding to shipping work.
      mkdirSync(join(campaign, "candidates", "refused", "correctness-model"), { recursive: true });
      writeFileSync(
        join(campaign, "candidates", "refused", "correctness-model", "brief.json"),
        JSON.stringify({ truthChecks: [{ id: "refused-only" }] }),
      );
      mkdirSync(join(campaign, "claims"));
      writeFileSync(
        join(campaign, "claims", "unrelated.json"),
        JSON.stringify({
          claim: { statement: { groundings: [{ checkId: "check-0", kind: "unrelated-grounding" }] } },
        }),
      );
      writeLedger(campaign, rows);
      const digest: unknown = buildDigest({ campaign, domainsRoot: join(root, "domains") });
      if (!isString(digest)) throw new Error("buildDigest must return digest text");
      const initial = digest.split("product root:")[1] ?? "";
      const successor = digest.split("product root:")[2] ?? "";
      expect(initial).toContain("25 (from 25 terminal case rows)");
      expect(initial).toMatch(/^check-0\s+reach-only\s+7\s+0\s+6\s+0$/m);
      expect(initial).not.toContain("check-7");
      expect(successor).toContain("22 (from 25 terminal case rows)");
      expect(successor).toMatch(/^check-0\s+reach-only\s+10\s+0\s+9\s+0$/m);
      expect(successor).toContain("check-7");
      expect(digest).toContain("successor: graded 22 · unaccepted 3 · non-result 0");
      expect(digest).not.toContain("over 47 graded rows");
      expect(digest).not.toContain("refused-only");
      expect(digest).not.toContain("unrelated-grounding");
      writeFileSync(join(campaign, "case-record.jsonl"), "");
      expect(buildDigest({ campaign, domainsRoot: join(root, "domains") })).toContain(
        "no terminal case rows",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("copied traces use their battery's product fingerprint, or report the missing product", () => {
    const root = mkdtempSync(join(tmpdir(), "ana-shared-traces-"));
    try {
      const campaign = join(root, "campaigns", "demo");
      const domain = join(root, "domains", "demo");
      const old = join(campaign, "versions", "old");
      mkdirSync(join(domain, "correctness-model"), { recursive: true });
      mkdirSync(join(domain, "agent"));
      const rows: CaseRecordRow[] = [];
      for (const id of ["old", "new"]) {
        writeFileSync(
          join(domain, "correctness-model", "brief.json"),
          JSON.stringify({ truthChecks: [{ id: `${id}-only` }] }),
        );
        const path = `runs/${id}/cases/task/trace.json`;
        const trace = JSON.stringify({
          schema: "case-trace/v4",
          turns: [],
          toolCalls: [],
          truncated: false,
          droppedRawEvents: 0,
        });
        mkdirSync(join(domain, "runs", id, "cases", "task"), { recursive: true });
        writeFileSync(join(domain, path), trace);
        writeFileSync(
          join(domain, "runs", id, "cases", "task", "verifier.json"),
          JSON.stringify({ ok: true, issues: [] }),
        );
        rows.push(
          caseRecordRow("task", "fam", {
            runId: id,
            traces: [{ path, sha256: new Bun.CryptoHasher("sha256").update(trace).digest("hex") }],
          }),
        );
        recordDigestBattery(domain, [id]);
        if (id === "old") {
          cpSync(join(domain, "agent"), join(old, "agent"), { recursive: true });
          cpSync(join(domain, "correctness-model"), join(old, "correctness-model"), { recursive: true });
        }
      }
      writeLedger(campaign, rows);
      const digest: unknown = buildDigest({ campaign, domainsRoot: join(root, "domains") });
      if (!isString(digest)) throw new Error("buildDigest must return digest text");
      expect(digest.split("product root:")[1]).toContain("old-only");
      expect(digest.split("product root:")[1]).not.toContain("new-only");
      expect(digest.split("product root:")[2]).toContain("new-only");
      rmSync(old, { recursive: true, force: true });
      const missing = buildDigest({ campaign, domainsRoot: join(root, "domains") });
      expect(missing).toContain(
        "product binding unresolved: old — no retained product matches battery fingerprint",
      );
      expect(missing).not.toContain("old-only");
      expect(missing).toContain("old: graded 1 · unaccepted 0 · non-result 0");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
