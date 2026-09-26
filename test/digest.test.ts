import { afterAll, describe, expect, it } from "bun:test";
import { buildDigest } from "../.claude/skills/whole-run-investigation/scripts/digest.mjs";
import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { isString } from "../src/meta/json-shape.ts";
import { recordDigestBattery } from "./helpers/digest-battery.ts";
import { caseRecordRow } from "./helpers/case-record-row.ts";
import type { CaseRecordRow } from "../src/claim/case-record.ts";
import { dirname, join } from "../src/meta/path.ts";
import { recordedController } from "./helpers/recorded-controller.ts";
import {
  executionRecord,
  experimentProposal,
  submitCall,
  trialCall,
} from "./helpers/builder-execution-record.ts";
import { EPOCH_REVIEW_SCHEMA } from "../src/review/epoch-review-findings.ts";
import type { TurnRetryRow } from "../src/author/builder-execution.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";

type DigestFixture = { campaign: string; domainsRoot: string };

afterAll(cleanupScratch);

function fixture(): DigestFixture {
  const root = scratchDir("ana-digest-");
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

/** Write an empty case trace at `path` under `root`, returning the row's trace binding. */
function writeTrace(root: string, path: string): { path: string; sha256: string }[] {
  const trace = JSON.stringify({
    schema: "case-trace/v4",
    turns: [],
    toolCalls: [],
    truncated: false,
    droppedRawEvents: 0,
  });
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), trace);
  return [{ path, sha256: new Bun.CryptoHasher("sha256").update(trace).digest("hex") }];
}

/** Check the untyped script's output once. */
function digestOf(paths: DigestFixture): string {
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
        schema: "difficulty-decision/v7",
        runId: "placed-0",
        difficulty: {
          band: [0.2, 0.5],
          decision: {
            rationale: "5/6, Wilson interval [0.436, 0.970] against target range [0.2, 0.5]",
            placement: { passes: 5, n: 6, zone: "over-aim", aim: [2, 3], toAim: -2 },
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
        schema: "difficulty-decision/v7",
        runId: "unplaced-1",
        difficulty: {
          decision: { placement: null, rationale: "no batteries recorded" },
          admitted: 0,
          excluded: [],
        },
      }),
    );
    const digest = digestOf(paths);
    expect(digest).toContain("placed-0: over-aim · 5/6 aim [2,3] toAim -2 · admitted 1 excluded 1");
    expect(digest).toContain("unplaced-1: unplaced · admitted 0 excluded 0");
    expect(digest).not.toMatch(/(?:STOP|BROADEN|REBUILD) DUE/);
  });

  // Only the version separates a retired meaning from a current one, since a placement is spelled the
  // same in both vocabularies. A refusal must not read as the empty-section sentence either: absence says
  // read the controller's decision reasons, refusal says read the campaign with the tree that wrote it.
  it.each([
    [
      "an unversioned pre-v5 record",
      { runId: "legacy-0", difficulty: { decision: { action: "climb" }, saturatedClimbs: 4, admitted: 4 } },
      "no schema",
    ],
    ["a v3 record", { schema: "difficulty-decision/v3", runId: "old-0" }, "difficulty-decision/v3"],
    ["a v4 record", { schema: "difficulty-decision/v4", runId: "old-4" }, "difficulty-decision/v4"],
    ["a v5 record", { schema: "difficulty-decision/v5", runId: "old-5" }, "difficulty-decision/v5"],
    ["a v6 record", { schema: "difficulty-decision/v6", runId: "old-6" }, "difficulty-decision/v6"],
  ])("refuses %s by name rather than reading it or calling it never recorded", (_title, record, reason) => {
    const paths = fixture();
    mkdirSync(join(paths.campaign, "difficulty-decisions"));
    writeFileSync(join(paths.campaign, "difficulty-decisions", "0.json"), JSON.stringify(record));
    const digest = digestOf(paths);
    expect(digest).toContain(`refused, not difficulty-decision/v7 — 0.json: ${reason}`);
    expect(digest).not.toContain(record.runId);
    expect(digest).not.toContain("no recorded difficulty decisions");
    expect(digest).not.toMatch(/satClimbs|satLevelled|satRange|satBroadens|THRESHOLD DRIFT/);
  });

  it("raises the perfect-battery trigger off the zone that replaced the climb action", () => {
    const perfect = (zone: string): string => {
      const paths = fixture();
      const dir = join(paths.campaign, "difficulty-decisions");
      mkdirSync(dir);
      writeFileSync(
        join(dir, "0.json"),
        JSON.stringify({
          schema: "difficulty-decision/v7",
          // run-4 graded 1 and passed 1, so a decision that read it above the aim and got a
          // perfect battery back is lane 5's question.
          runId: "run-4",
          difficulty: { decision: { placement: { zone } }, admitted: 1, excluded: [] },
        }),
      );
      return digestOf(paths);
    };
    expect(perfect("too-easy")).toContain("PERFECT BATTERY OVER AIM (lane 5): run-4 1/1");
    expect(perfect("over-aim")).toContain("PERFECT BATTERY OVER AIM (lane 5): run-4 1/1");
    expect(perfect("on-aim")).not.toContain("PERFECT BATTERY OVER AIM");
  });

  it("reads the recorded check table, submits, decisions and roster, and never verifier issue text", () => {
    const digest = digestOf(fixture());
    // Checks with reject controls but no measured rejection, and the submits that rejected.
    expect(digest).toContain("UNTRIPPED IN SHIPPING (rejCtl>0, shipRej=0 over 2 graded rows): alpha-check");
    expect(digest).not.toContain(
      "UNTRIPPED IN SHIPPING (rejCtl>0, shipRej=0 over 2 graded rows): alpha-check, beta-check",
    );
    expect(digest).toContain("3 submits (refused:2 accepted:1)");
    expect(digest).toContain("topFindingsDigest aaaa1111 x2");
    expect(digest).not.toContain("surviving pairs");
    // An absent decisions directory says no decision was recorded, not that the selector never ran.
    expect(digest).toContain("no recorded difficulty decisions: no placement was recorded");
    expect(digest).not.toContain("never ran");
    // Each half of the check table names the terminal ledger and the exact tree it came from.
    expect(digest).toContain("graded oracle rows: 2 (from 2 terminal case rows)");
    expect(digest).toContain("correctness-model/controls.json");
    expect(digest).toContain("a candidate battery may declare a different corpus");
    expect(digest).toContain("measured adopted-tree demo-slug");
    // A repeated candidate evaluator is flagged when the noun precedes the judging verb.
    expect(digest).toContain("judge_pin_choice");
    expect(digest).toContain(
      "CHECK TOOL IN SOLVER TRACE (lane 23): judge_pin_choice repeated per-case candidate evaluation via public tool",
    );
    // Rule 4: verifier issue text never crosses into the digest.
    expect(digest).not.toContain("secret-verifier-detail-7731");
    expect(digest).not.toContain("missing token");
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
        schema: "judge-reviews/v12",
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

  it("keys the check table and tool roster on the candidate that graded the measured rows", () => {
    // Move the graded battery into a candidate root with its own corpus and tool spec: the digest
    // must follow the rows rather than read the adopted tree's unused controls.
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
    expect(digest).not.toContain("CHECK TOOL IN SOLVER TRACE");
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

  // The ledgers digest-ledgers.mjs reads. Each case writes the recorded shape a real
  // campaign carries and checks the trigger row a lane is admitted on, plus its nearest quiet shape.
  it("classifies provider-typed non-results as censoring and reads the Builder's allowance waits", () => {
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
        schema: "difficulty-decision/v7",
        runId: "run-3",
        difficulty: {
          decision: { placement: { zone: "on-aim" }, evidence: [{ runId: "run-2" }] },
        },
      }),
    );
    // The Builder transport's own retry rows: one reason is the provider's allowance clause and
    // the other a generic limit, and only the first is printed as an explicit allowance wait.
    const retry = (turn: number, reason: string, waitMs: number): TurnRetryRow => ({
      role: "builder",
      turn,
      attempt: 1,
      of: 3,
      status: "failed",
      reason,
      waitMs,
    });
    writeFileSync(
      join(paths.campaign, "epoch-aa", "builder-execution.json"),
      executionRecord([{}], 0, {
        turnRetries: [
          retry(3, "You've hit your weekly limit · resets Sep 12 at 8am", 600_000),
          retry(4, "429 too many requests", 60_000),
        ],
      }),
    );

    const digest = digestOf(paths);
    expect(digest).toContain("REVIEW TURNS EXCEED SOLVER TURNS (lane 24): review 10 > built 5");
    expect(digest).toContain('absent step "epoch review"');
    const censoredRow =
      "run-2: graded 0 · provider non-results 2 · first 2026-09-08T00:00:00.000Z last 2026-09-08T00:01:30.000Z" +
      " · CENSORED (provider non-results; the typed kind is the evidence, the message is not)";
    expect(digest).toContain(censoredRow);
    expect(digest).toContain("DECISION ON CENSORED BATTERY (lane 24): run-3 on-aim read run-2");
    expect(digest).toContain("epoch-aa/builder-execution.json: turn retries 2 · waited 11 min in total");
    expect(digest).toContain(
      "EXPLICIT ALLOWANCE WAIT (lane 24): epoch-aa/builder-execution.json turn 3 attempt 1/3 failed waited 10 min (explicit allowance)",
    );
    expect(digest).toContain(
      "turn retry: epoch-aa/builder-execution.json turn 4 attempt 1/3 failed waited 1 min (other reason; not proof of exhaustion)",
    );
    expect(digest.split("EXPLICIT ALLOWANCE WAIT").length).toBe(2);
    // No exhaustion verdict is read out of free text: the typed kind is the whole evidence.
    expect(digest).not.toMatch(
      /EXPLICIT PROVIDER EXHAUSTION|classification:|PROVIDER NON-RESULTS UNEXPLAINED|explicit-exhaustion/,
    );

    // A generic message under the same typed kind censors exactly the same way.
    battery(["429 too many requests", "socket hang up"]);
    record({ builder: 5, built: 10, review: 5 }, "epoch review — 429 too many requests");
    const generic = digestOf(paths);
    expect(generic).toContain("run-1: provider turns 20 of cap 21 · builder 5 · built 10 · review 5");
    expect(generic).not.toContain("REVIEW TURNS EXCEED SOLVER TURNS");
    expect(generic).toContain(censoredRow);

    // A terminal the controller reader refuses prints no role counts or steps it cannot vouch for.
    const terminal = join(paths.campaign, "controller", "run-1", "terminal.json");
    const { providerResourceBudget: _dropped, ...rest } = JSON.parse(readFileSync(terminal, "utf8"));
    writeFileSync(terminal, JSON.stringify(rest));
    const refused = digestOf(paths);
    expect(refused).toContain("run-1: CONTROLLER EVIDENCE REFUSED — ");
    expect(refused).not.toContain("run-1: provider turns");
    expect(refused).not.toContain('absent step "epoch review"');
  });

  it("counts an advisory finding's recurrence over measured reviews by placement and declared check", () => {
    const paths = fixture();
    const analysis = join(paths.campaign, "analysis");
    mkdirSync(analysis, { recursive: true });
    const review = (label: string, findings: unknown[]) =>
      writeFileSync(
        join(analysis, `${label}-epoch-review.json`),
        JSON.stringify({ schema: EPOCH_REVIEW_SCHEMA, status: "completed", findings, reads: [] }),
      );
    const advisory = {
      defect: true,
      severity: "advisory",
      checkId: "alpha-check",
      owner: "correctness-model/brief.json",
    };
    review("run-1", [advisory]);
    const once = digestOf(paths);
    expect(once).toContain("run-1: epoch review completed · findings 1 · unrouted 0 · reads 0");
    expect(once).not.toContain("ADVISORY FINDING RECURS UNROUTED");
    // An authoring checkpoint reads the same bytes a measured review reads, so it is no recurrence.
    review("authoring-01a0b788-f000-7000-8000-000000000000", [advisory]);
    expect(digestOf(paths)).not.toContain("ADVISORY FINDING RECURS UNROUTED");
    review("run-2", [advisory, { defect: true, severity: "advisory" }]);
    const twice = digestOf(paths);
    expect(twice).toContain(
      "ADVISORY FINDING RECURS UNROUTED (lane 14): defect alpha-check advisory in 2 measured reviews (run-1, run-2)",
    );
    expect(twice).toContain("advisory findings naming no check: 1 (no recurrence identity)");
    // A review of another schema is refused by name rather than read for its findings.
    writeFileSync(
      join(analysis, "run-3-epoch-review.json"),
      JSON.stringify({ status: "completed", findings: [advisory], reads: [] }),
    );
    const refused = digestOf(paths);
    expect(refused).toContain(`run-3: epoch review refused, not ${EPOCH_REVIEW_SCHEMA}`);
    expect(refused).toContain("advisory in 2 measured reviews (run-1, run-2)");
  });

  it("joins each rehearsal to the accepted submit's candidate and reads the declared target against it", () => {
    const paths = fixture();
    const candidate = "c".repeat(64);
    for (const [n, taskId] of [
      [1, "t1"],
      [2, "t2"],
    ] as const) {
      mkdirSync(join(paths.campaign, "epoch-aa", "rehearsals", `rehearsal-${n}`, "cases", taskId), {
        recursive: true,
      });
    }
    const write = (submitted: string, verifiedPasses: number) =>
      writeFileSync(
        join(paths.campaign, "epoch-aa", "builder-execution.json"),
        executionRecord(
          [{ experimentProposal: experimentProposal({ comparator: "at-most", verifiedPasses }) }],
          0,
          {
            customCalls: [
              trialCall(1, "t1", candidate, "pass"),
              trialCall(2, "t2", candidate, "not-run"),
              submitCall(3, submitted),
            ],
          },
        ),
      );
    write(candidate, 0);
    const digest = digestOf(paths);
    expect(digest).toContain(
      "epoch-aa/builder-execution.json: rehearsals 2 (pass 1, not-run 1) · accepted submits 1",
    );
    expect(digest).not.toContain("rehearsal case directories");
    expect(digest).toContain("REHEARSAL NOT-RUN (lane 9): 1 of 2 rehearsals reached no verdict");
    expect(digest).not.toContain("SUBMITTED BYTES NEVER REHEARSED");
    // A pass the rehearsal already recorded on the frozen bytes is a verified pass the battery will
    // find again, so an at-most 0 target is contradicted before the battery runs.
    expect(digest).toContain(
      "REHEARSAL CONTRADICTS TARGET (lane 11): epoch-aa declared at-most 0 verified passes; 1 rehearsal pass(es) on the submitted bytes already exceed it (1 > 0)",
    );
    write(candidate, 1);
    expect(digestOf(paths)).toContain(
      "target at-most 1 · rehearsal passes on the submitted bytes 1 · not contradicted",
    );
    // Rehearsals of other bytes say nothing about the candidate the submit froze.
    write("d".repeat(64), 0);
    const other = digestOf(paths);
    expect(other).toContain(
      "SUBMITTED BYTES NEVER REHEARSED (lane 11): epoch-aa candidate dddddddddddddddd · 2 rehearsal(s) on other bytes",
    );
    expect(other).not.toContain("REHEARSAL CONTRADICTS TARGET");
    rmSync(join(paths.campaign, "epoch-aa", "rehearsals", "rehearsal-2"), { recursive: true });
    expect(digestOf(paths)).toContain("rehearsal case directories 1 against 2 recorded call(s)");
  });

  it("reads each retained version's toolchain shape and the claim's wrapper-only tool digests", () => {
    const paths = fixture();
    const versions = join(paths.campaign, "versions");
    const real = join(paths.campaign, "epoch-aa", "workspace", ".toolchain");
    const gone = join(paths.campaign, "gone", ".toolchain");
    mkdirSync(real, { recursive: true });
    mkdirSync(join(versions, "v1"), { recursive: true });
    symlinkSync(real, join(versions, "v1", ".toolchain"));
    mkdirSync(join(versions, "v2", ".toolchain"), { recursive: true });
    mkdirSync(join(versions, "v3"), { recursive: true });
    symlinkSync(gone, join(versions, "v3", ".toolchain"));
    writeFileSync(
      join(paths.campaign, "claims", "run-1.json"),
      JSON.stringify({
        claim: {
          statement: {
            groundings: [{ checkId: "alpha-check", kind: "intrinsic", adapterId: null }],
            verifierEnvironmentHash: null,
            verifierTools: [
              { toolId: "gcc", kind: "binary", source: "host", interpreter: null, digest: "x" },
              {
                toolId: "wrap",
                kind: "script",
                source: "workspace-toolchain",
                interpreter: "bash",
                digest: "y",
              },
            ],
          },
        },
      }),
    );
    const digest = digestOf(paths);
    expect(digest).toContain(`VERSION TOOLCHAIN IS A SYMLINK (lane 2): versions/v1/.toolchain → ${real}`);
    expect(digest).not.toContain("VERSION TOOLCHAIN DANGLING (lane 2): versions/v1/");
    expect(digest).toContain("versions/v2/.toolchain: real directory");
    expect(digest).not.toContain("VERSION TOOLCHAIN IS A SYMLINK (lane 2): versions/v2/");
    expect(digest).toContain(
      `VERSION TOOLCHAIN DANGLING (lane 2): versions/v3/.toolchain → ${gone} resolves to nothing`,
    );
    expect(digest).toContain("run-1: verifier tools 2 · binaries 1 · scripts 1");
    expect(digest).toContain(
      "WRAPPER-ONLY TOOL DIGEST (lane 2): run-1 wrap (workspace-toolchain, interpreter bash)",
    );
    expect(digest).not.toContain("WRAPPER-ONLY TOOL DIGEST (lane 2): run-1 gcc");
  });

  it("reads an off-aim streak and a missed target from the recorded readout rows", () => {
    const paths = fixture();
    const dir = join(paths.campaign, "difficulty-decisions");
    mkdirSync(dir);
    const decision = (name: string, runId: string, toAim: number, rows: unknown[]) =>
      writeFileSync(
        join(dir, `${name}.json`),
        JSON.stringify({
          schema: "difficulty-decision/v7",
          runId,
          difficulty: {
            decision: { placement: { passes: 5, n: 6, zone: "over-aim", aim: [2, 3], toAim } },
            admitted: 1,
            excluded: [],
            rows,
          },
        }),
      );
    decision("0", "d1", -2, [
      {
        runId: "run-1",
        passed: 5,
        verified: 6,
        zone: "over-aim",
        target: { comparator: "at-most", verifiedPasses: 2, result: "missed", missedBy: 3 },
      },
    ]);
    const one = digestOf(paths);
    expect(one).toContain("  run-1: target at-most 2 · passed 5/6 · missed");
    expect(one).toContain(
      "TARGET MISSED (lane 10): run-1 declared at-most 2 verified passes and measured 5, missed by 3",
    );
    expect(one).not.toContain("OFF-AIM STREAK");
    decision("1", "d2", -2, []);
    expect(digestOf(paths)).toContain(
      "OFF-AIM STREAK (lane 10): 2 consecutive placements above the aim (d1, d2)",
    );
    // A placement that crossed the aim ends the streak, and one placement on a side is no streak.
    decision("1", "d2", 1, []);
    expect(digestOf(paths)).not.toContain("OFF-AIM STREAK");
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

  it("settles the judge census inventory and triggers lane 16 on a recorded disagreement", () => {
    const paths = fixture();
    mkdirSync(join(paths.campaign, "analysis"), { recursive: true });
    const judges = (disagreements: number) =>
      JSON.stringify({
        schema: "judge-reviews/v12",
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
    expect(quiet).toContain("lane 16: no census recorded a Judge/verifier disagreement");
    // The census carries no controls by construction, so neither a controls column nor an alarm
    // about their absence tells a reader anything: src/review/judge.ts writes a constant zero.
    expect(quiet).not.toContain("JUDGE CENSUS WITHOUT CONTROLS");
    expect(quiet).not.toContain("controlValidity");

    // One disagreement in six must still trigger; a validated-only trigger would hide it.
    writeFileSync(join(paths.campaign, "analysis", "run-1-judges.json"), judges(1));
    expect(digestOf(paths)).toContain("CENSUS WITH DISAGREEMENT (lane 16): 1 census(es)");

    // A record the judge-reviews writer did not produce is refused by name, not read as a census.
    writeFileSync(
      join(paths.campaign, "analysis", "run-1-judges.json"),
      JSON.stringify({ census: { judge: "on", disagreements: 1 }, exit: { kind: "completed" } }),
    );
    const refused = digestOf(paths);
    expect(refused).toContain("refused, not judge-reviews/v12 — run-1-judges.json");
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
      // run-4 carries a manifest-verified battery of the same task set under the same pin as run-1;
      // run-2 carries none, so its condition is unobservable rather than distinct.
      row("run-4", "sa", "spatial", false),
    ]);
    mkdirSync(join(paths.campaign, "analysis"), { recursive: true });
    writeFileSync(
      join(paths.campaign, "analysis", "run-1-admission.json"),
      JSON.stringify({
        admitted: [
          { defect: false, owner: null },
          { defect: true, owner: "correctness-model/evaluator.ts" },
        ],
        refused: [],
        feedback: [{ owner: "correctness-model/evaluator.ts" }],
        policy: "epoch-review/v3",
      }),
    );
    const digest = digestOf(paths);
    expect(digest).toContain("run-1: 12/17");
    expect(digest).toMatch(/spatial\s+0\/5\s+\[[0-9.]+,[0-9.]+\]\s+all-fail AGGREGATE HIDES FAMILY/);
    expect(digest).toContain("FAMILY UNMOVED all-fail: spatial 0/5 → 0/2 (run-1 → run-2)");
    expect(digest).toContain("REPEATED CONDITION (lane 20): run-1, run-4");
    expect(digest).toContain("run-2: task set unobservable — no manifest-verified battery record");
    expect(digest).toContain(
      "run-1: admitted 2 ((none) 1, correctness-model/evaluator.ts 1) · refused 0 · feedback owners {correctness-model/evaluator.ts} · policy epoch-review/v3",
    );
    expect(digest).toContain("FINDINGS WITHOUT OWNER (lane 14): 1 of 2 admitted findings name no owner");
  });

  it("each measured product keeps its check corpus, join targets and case denominator", () => {
    const root = scratchDir("ana-product-digest-");
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
        const traces = writeTrace(product, `runs/${id}/cases/t${index}/trace.json`);
        if (index < verified) {
          writeFileSync(
            join(product, "runs", id, "cases", `t${index}`, "verifier.json"),
            JSON.stringify({ ok: true, issues: [] }),
          );
        }
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
    const digest = digestOf({ campaign, domainsRoot: join(root, "domains") });
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
    expect(digestOf({ campaign, domainsRoot: join(root, "domains") })).toContain("no terminal case rows");
  });

  it("copied traces use their battery's product fingerprint, or report the missing product", () => {
    const root = scratchDir("ana-shared-traces-");
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
      const traces = writeTrace(domain, `runs/${id}/cases/task/trace.json`);
      writeFileSync(
        join(domain, "runs", id, "cases", "task", "verifier.json"),
        JSON.stringify({ ok: true, issues: [] }),
      );
      rows.push(
        caseRecordRow("task", "fam", {
          runId: id,
          traces,
        }),
      );
      recordDigestBattery(domain, [id]);
      if (id === "old") {
        cpSync(join(domain, "agent"), join(old, "agent"), { recursive: true });
        cpSync(join(domain, "correctness-model"), join(old, "correctness-model"), { recursive: true });
      }
    }
    writeLedger(campaign, rows);
    const paths = { campaign, domainsRoot: join(root, "domains") };
    const digest = digestOf(paths);
    expect(digest.split("product root:")[1]).toContain("old-only");
    expect(digest.split("product root:")[1]).not.toContain("new-only");
    expect(digest.split("product root:")[2]).toContain("new-only");
    rmSync(old, { recursive: true, force: true });
    const missing = digestOf(paths);
    expect(missing).toContain(
      "product binding unresolved: old — no retained product matches battery fingerprint",
    );
    expect(missing).not.toContain("old-only");
    expect(missing).toContain("old: graded 1 · unaccepted 0 · non-result 0");
  });
});
