import { afterEach, describe, expect, it } from "bun:test";
// biome-ignore format: the directive below only reaches the specifier while this import is one line
// @ts-expect-error plain-JS skill script without type declarations
import { buildDigest } from "../.claude/skills/whole-run-investigation/scripts/trace-digest.mjs";
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
import { join } from "../src/meta/path.ts";

const dirs: string[] = [];

type DigestFixture = { campaign: string; domainsRoot: string };

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
  mkdirSync(join(domain, "runs", "run-1-repair-on", "cases", "t1"), { recursive: true });
  mkdirSync(join(domain, "runs", "run-1-repair-off", "cases", "t1"), { recursive: true });
  writeFileSync(join(campaign, "epoch-aa", "campaign.json"), JSON.stringify({ slug: "demo-slug" }));
  writeFileSync(
    join(campaign, "epoch-aa", "builder-execution.json"),
    JSON.stringify({
      submits: [
        { outcome: "refused", findingsDigest: "aaaa1111bbbb" },
        { outcome: "refused", findingsDigest: "aaaa1111bbbb" },
        { outcome: "accepted", findingsDigest: null },
      ],
      uniqueCandidateTrees: 3,
      repeatedFindingSubmits: 1,
      unchangedTreeSubmits: 0,
      toolCalls: { total: 9, failed: 1 },
      usage: { inputTokens: null, outputTokens: null, costUsd: null },
      outcome: "recorded",
    }),
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
        },
      },
      solvability: { registrySource: "admitted" },
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
    join(domain, "runs", "run-1-repair-on", "cases", "t1", "oracle.json"),
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
    join(domain, "runs", "run-1-repair-off", "cases", "t1", "oracle.json"),
    JSON.stringify({ ok: true, issues: [] }),
  );
  const traces = new Map<string, string>();
  for (const runId of ["run-1-repair-on", "run-1-repair-off"]) {
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
  const row = (runId: string, truthOk: boolean) => {
    const path = `runs/${runId}/cases/t1/trace.json`;
    return {
      runId,
      taskId: "t1",
      acceptedSubmit: true,
      truthOk,
      runtimeNonResultKind: null,
      traces: [{ path, sha256: traces.get(path) }],
    };
  };
  writeFileSync(
    join(campaign, "case-record.jsonl"),
    [{ row: row("run-1-repair-on", false) }, { row: row("run-1-repair-off", true) }]
      .map((entry) => JSON.stringify(entry))
      .join("\n"),
  );
  recordDigestBattery(domain, ["run-1-repair-on", "run-1-repair-off"]);
  return { campaign, domainsRoot: join(root, "domains") };
}

/** Check the untyped script's output once. */
function digestOf(paths: ReturnType<typeof fixture>): string {
  const digest: unknown = buildDigest(paths);
  if (!isString(digest)) throw new Error("buildDigest must return the digest text");
  return digest;
}

describe("trace-digest", () => {
  it("excludes retained diagnostic verdicts from shipping evidence", () => {
    const paths = fixture();
    const ledger = join(paths.campaign, "case-record.jsonl");
    const bytes = readFileSync(ledger, "utf8")
      .replace('"truthOk":false', '"truthOk":null')
      .replace('"runtimeNonResultKind":null', '"runtimeNonResultKind":"verifierUnavailable"');
    writeFileSync(ledger, bytes);
    expect(digestOf(paths)).toContain("graded oracle rows: 1 (from 2 terminal case rows)");
  });

  it("reports a changed verdict as an evidence gap", () => {
    const paths = fixture();
    const verdict = join(
      paths.domainsRoot,
      "demo-slug",
      "runs",
      "run-1-repair-on",
      "cases",
      "t1",
      "oracle.json",
    );
    writeFileSync(verdict, JSON.stringify({ ok: false, issues: [] }));
    const digest = digestOf(paths);
    expect(digest).toContain("shipping evidence gap:");
    expect(digest).toContain("graded oracle rows: 1 (from 1 terminal case rows)");
  });

  it("retains historical saturation counters without inventing a due controller action", () => {
    const paths = fixture();
    const dir = join(paths.campaign, "difficulty-decisions");
    mkdirSync(dir);
    for (const [index, thresholds] of [
      { rebuildAfterSaturatedLevels: 3 },
      { broadenAfterSaturatedLevels: 3, saturatedBroadens: 0 },
      { broadenAfterSaturatedLevels: 3, saturatedBroadens: 1 },
    ].entries()) {
      writeFileSync(
        join(dir, `${index}.json`),
        JSON.stringify({
          runId: `saturated-${index}`,
          difficulty: {
            ...thresholds,
            decision: { action: "climb", currentLevel: 2, nextLevel: 3 },
            saturatedLevels: 4,
            saturatedClimbs: 4,
            saturatedLevelled: 0,
            rebuildAfterSaturated: 3,
            infeasibleStrikes: 3,
            infeasibleStopStrikes: 3,
            admitted: 4,
            excluded: [],
          },
        }),
      );
    }
    const digest = digestOf(paths);
    expect(digest).toContain("saturated-2: action climb L2→L3");
    expect(digest).toContain("satRange 4/3 satBroadens 1");
    expect(digest).toContain("strikes 3/3");
    expect(digest).not.toMatch(/(?:STOP|BROADEN|REBUILD) DUE/);
  });

  it("flags checks with reject controls but no measured rejection and counts those that rejected", () => {
    const digest = digestOf(fixture());
    expect(digest).toContain("UNTRIPPED IN SHIPPING (rejCtl>0, shipRej=0 over 2 graded rows): alpha-check");
    expect(digest).not.toContain(
      "UNTRIPPED IN SHIPPING (rejCtl>0, shipRej=0 over 2 graded rows): alpha-check, beta-check",
    );
    expect(digest).toContain("3 submits (refused:2 accepted:1)");
    expect(digest).toContain("topFindingsDigest aaaa1111 x2");
    expect(digest).toContain("pair run-1: surviving pairs 1");
  });

  it("counts an omitted blocking field but not an explicit false or a warning", () => {
    const paths = fixture();
    const verdict = join(
      paths.domainsRoot,
      "demo-slug",
      "runs",
      "run-1-repair-on",
      "cases",
      "t1",
      "oracle.json",
    );
    const bothInert =
      "UNTRIPPED IN SHIPPING (rejCtl>0, shipRej=0 over 2 graded rows): alpha-check, beta-check";
    // The fixture row omits `blocking`, so beta-check has a shipping rejection and stays out.
    expect(digestOf(paths)).not.toContain(bothInert);
    for (const issue of [
      { severity: "error", blocking: false, checkId: "beta-check", message: "soft, ships disclosed" },
      { severity: "warning", checkId: "beta-check", message: "advisory only" },
    ]) {
      writeFileSync(verdict, JSON.stringify({ ok: false, issues: [issue] }));
      recordDigestBattery(join(paths.domainsRoot, "demo-slug"), ["run-1-repair-on"]);
      expect(digestOf(paths)).toContain(bothInert);
    }
  });

  it("attributes a contested row through an issue that omits blocking", () => {
    const paths = fixture();
    mkdirSync(join(paths.campaign, "analysis"), { recursive: true });
    writeFileSync(
      join(paths.campaign, "analysis", "run-1-judges.json"),
      JSON.stringify({
        contested: {
          "run-1-repair-on": [{ evidence: "domains/demo-slug/runs/run-1-repair-on/cases/t1/oracle.json" }],
        },
      }),
    );
    // checkId, kind, adapter, grounding source, rejCtl, mutClasses, shipRej, shapes, contested.
    expect(digestOf(paths)).toMatch(
      /^beta-check\s+external-verifier\s+beta-engine\s+engine-registry:admitted\s+1\s+1\s+1\s+1\s+1\s+no$/m,
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
    const stale = join(paths.campaign, "runs", "run-1-repair-on", "cases", "t1");
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
    writeFileSync(join(stale, "oracle.json"), JSON.stringify({ ok: true, issues: [] }));

    const digest = digestOf(paths);
    expect(digest).toContain("graded oracle rows: 2 (from 2 terminal case rows)");
    expect(digest).toContain("traces 2 · distinct tool sequences 1 · tool errors 0");
    expect(digest).toContain("UNTRIPPED IN SHIPPING (rejCtl>0, shipRej=0 over 2 graded rows): alpha-check");
  });

  it("collapses a byte-identical archival duplicate and reports a divergent one", () => {
    const paths = fixture();
    const rows = [
      {
        runId: "run-1-repair-on",
        taskId: "t1",
        acceptedSubmit: true,
        truthOk: false,
        runtimeNonResultKind: null,
      },
      {
        runId: "run-1-repair-off",
        taskId: "t1",
        acceptedSubmit: true,
        truthOk: true,
        runtimeNonResultKind: null,
      },
    ];
    writeFileSync(
      join(paths.campaign, "case-record.jsonl"),
      [
        { row: rows[0] },
        { row: rows[1] },
        // An archival copy of the first row: same case, same bytes. It is one case, not two.
        { row: rows[0] },
        // The same case key claiming a different verdict: never silently collapsed.
        { row: { ...rows[1], truthOk: false } },
      ]
        .map((entry) => JSON.stringify(entry))
        .join("\n"),
    );
    const digest = digestOf(paths);
    expect(digest).toContain("run-1-repair-on: graded 1");
    expect(digest).toContain("run-1-repair-off: graded 1");
    expect(digest).toContain("collapsed 1 byte-identical duplicate case rows");
    expect(digest).toContain("DIVERGENT DUPLICATES (same case key, different bytes): run-1-repair-off/t1");
  });

  it("counts the recorded solver instants as the per-case record", () => {
    const paths = fixture();
    const base = { taskId: "t1", acceptedSubmit: true, truthOk: true, runtimeNonResultKind: null };
    writeFileSync(
      join(paths.campaign, "case-record.jsonl"),
      [
        // The field the recorded row carries since 2026-09-01.
        {
          row: {
            ...base,
            runId: "run-1-repair-on",
            solverStartedAt: "2026-09-02T08:48:17.977Z",
            solverEndedAt: "2026-09-02T08:49:50.879Z",
          },
        },
        // Older evidence without instants, and a row with the keys the probe once looked for.
        { row: { ...base, runId: "run-1-repair-off" } },
        { row: { ...base, runId: "run-2-repair-on", at: "2026-09-02T08:48:17.977Z", timestamp: 1 } },
      ]
        .map((entry) => JSON.stringify(entry))
        .join("\n"),
    );
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

    recordDigestBattery(candidate, ["run-1-repair-on", "run-1-repair-off"]);
    const digest = digestOf(paths);
    expect(digest).toContain("measured candidate fullrun-i02");
    expect(digest).toContain("accept 2 · reject 1");
    expect(digest).toContain("tool roster read from measured candidate fullrun-i02");
    expect(digest).not.toContain("ORACLE-PREVIEW SUSPECT");
    expect(digest).not.toContain("fallback: adopted-tree");
  });

  it("keeps the missing trace visible when a recorded battery still binds the product", () => {
    const paths = fixture();
    writeFileSync(
      join(paths.campaign, "case-record.jsonl"),
      JSON.stringify({
        row: {
          runId: "run-1-repair-on",
          taskId: "t1",
          acceptedSubmit: true,
          truthOk: false,
          runtimeNonResultKind: null,
        },
      }),
    );
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
    const source = join(root, "runs", "run-1-repair-on", "cases", "t1");
    const archived = join(paths.campaign, "candidates", "archived", "runs", "run-1-repair-on", "cases", "t1");
    const solvability = join(root, "runs", "f2-solvability", "cases", "witness");
    mkdirSync(archived, { recursive: true });
    mkdirSync(solvability, { recursive: true });
    for (const name of ["oracle.json", "trace.json"]) {
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

  it("uses explicit controller kind for current records and does not classify a terminal flag alone", () => {
    const paths = fixture();
    writeFileSync(
      join(paths.campaign, "epoch-aa", "builder-execution.json"),
      JSON.stringify({
        schema: "builder-execution/v5",
        submits: [
          { outcome: "refused", commit: "candidate-a", terminal: true, findingCodes: [] },
          { outcome: "refused", commit: "budget-limited-near-miss", terminal: true, findingCodes: [] },
          { outcome: "refused", commit: "budget-limited", terminal: true, findingCodes: [] },
        ],
        uniqueCandidateTrees: 3,
        repeatedFindingSubmits: 0,
        unchangedTreeSubmits: 0,
      }),
    );
    writeFileSync(
      join(paths.campaign, "epoch-aa", "builder-execution-02.json"),
      JSON.stringify({
        schema: "builder-execution/v5",
        submits: [
          { outcome: "refused", commit: "current-boundary", kind: "controller-terminal", terminal: true },
          // The same commit text is not a boundary in a current schema without an explicit kind.
          { outcome: "refused", commit: "budget-limited", terminal: true },
        ],
        uniqueCandidateTrees: 2,
        repeatedFindingSubmits: 0,
        unchangedTreeSubmits: 0,
      }),
    );
    const digest = digestOf(paths);
    // Every row in the first record is terminal and one commit even reads like the boundary, so a
    // reader that classified on those two fields would report a controller row here.
    expect(digest).toContain("builder-execution.json: 3 submits (refused:3)");
    expect(digest).toContain("candidate submits 3 (refused:3) · controller terminals 0 (none)");
    expect(digest).toContain("builder-execution-02.json: 2 submits (refused:2)");
    expect(digest).toContain("candidate submits 1 (refused:1) · controller terminals 1 (refused:1)");
    // The controller row is not a candidate tree, and the raw count the writer recorded stays.
    expect(digest).toContain(
      "INTEGRITY MISMATCH (raw record preserved): uniqueCandidateTrees recorded 2, derived candidate trees 1",
    );
    expect(digest).toContain(
      "builder-execution records: 1 primary bare (first session), 1 numbered (later sessions)",
    );
    expect(digest.indexOf("builder-execution.json: 3 submits")).toBeLessThan(
      digest.indexOf("builder-execution-02.json: 2 submits"),
    );
    expect(digest).not.toContain("last-write-wins");
  });

  // The 2026-09-08 ledgers (digest-ledgers.mjs). Each case writes the recorded shape a real
  // campaign carries and checks the trigger row a lane is admitted on, plus its nearest quiet shape.
  it("classifies provider non-results as censoring and flags a decision read on a censored battery", () => {
    const paths = fixture();
    const domain = join(paths.domainsRoot, "demo-slug");
    mkdirSync(join(paths.campaign, "controller", "run-1-repair-on"), { recursive: true });
    writeFileSync(
      join(paths.campaign, "controller", "run-1-repair-on", "terminal.json"),
      JSON.stringify({
        providerResourceBudget: {
          cap: 100,
          used: 20,
          byRole: { builder: 5, built: 5, review: 10 },
          usage: { reportedTurns: 20, unreportedTurns: 0, totalTokens: null, costUsd: null },
        },
        absentSteps: ["epoch review — the provider reported its weekly limit was reached"],
        terminalReason: "candidate-held: detail",
      }),
    );
    mkdirSync(join(domain, "runs", "run-2"), { recursive: true });
    const battery = (messages: string[]) =>
      JSON.stringify({
        cases: messages.map((message, index) => ({
          taskId: `c${index}`,
          runtimeNonResultKind: "provider",
          solver: {
            nonResult: { kind: "provider", message },
            startedAt: `2026-09-08T00:0${index}:00.000Z`,
            endedAt: `2026-09-08T00:0${index}:30.000Z`,
          },
        })),
      });
    writeFileSync(
      join(domain, "runs", "run-2", "battery.json"),
      battery([
        "You're out of extra usage · resets Sep 12",
        "not attempted: the battery stopped scheduling after 5 consecutive provider non-results",
      ]),
    );
    const rows = readFileSync(join(paths.campaign, "case-record.jsonl"), "utf8");
    const provider = (taskId: string) =>
      JSON.stringify({
        row: {
          runId: "run-2",
          taskId,
          acceptedSubmit: false,
          truthOk: null,
          runtimeNonResultKind: "provider",
          traces: [],
        },
      });
    writeFileSync(
      join(paths.campaign, "case-record.jsonl"),
      [rows, provider("c0"), provider("c1")].join("\n"),
    );
    mkdirSync(join(paths.campaign, "difficulty-decisions"), { recursive: true });
    writeFileSync(
      join(paths.campaign, "difficulty-decisions", "run-3.json"),
      JSON.stringify({
        runId: "run-3",
        difficulty: {
          decision: { action: "hold", currentLevel: 2, nextLevel: 2, evidence: [{ runId: "run-2" }] },
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
    expect(digest).toContain("DECISION ON CENSORED BATTERY (angle 28 trigger): run-3 hold read run-2");
    expect(digest).toContain("classification: explicit exhaustion censors the denominator");

    // A generic limit is not exhaustion: the row asks for an investigation and no censoring claim.
    writeFileSync(
      join(domain, "runs", "run-2", "battery.json"),
      battery(["429 too many requests", "socket hang up"]),
    );
    writeFileSync(
      join(paths.campaign, "controller", "run-1-repair-on", "terminal.json"),
      JSON.stringify({
        providerResourceBudget: { cap: 100, used: 20, byRole: { builder: 5, built: 5, review: 10 } },
        absentSteps: ["epoch review — 429 too many requests"],
        terminalReason: "candidate-held",
      }),
    );
    const generic = digestOf(paths);
    expect(generic).toContain(
      'absent step "epoch review": generic 429/rate limit — investigate the actual failure; not proof of exhaustion',
    );
    expect(generic).toContain("run-2: graded 0 · provider non-results 2 (generic-limit 1, other 1)");
    expect(generic).toContain("PROVIDER NON-RESULTS UNEXPLAINED");
    expect(generic).not.toContain("classification: explicit exhaustion");
  });

  it("separates attested, unattested and no-turn identity rows and flags a served model off the pin", () => {
    const paths = fixture();
    const domain = join(paths.domainsRoot, "demo-slug");
    mkdirSync(join(paths.campaign, "controller", "run-1-repair-on"), { recursive: true });
    writeFileSync(
      join(paths.campaign, "controller", "run-1-repair-on", "opening.json"),
      JSON.stringify({ modelSlots: { built: { model: "claude-opus-5" } } }),
    );
    const identity = (model: string, resultId: string | null) => ({
      schema: "runtime-model-identity/v2",
      provider: { id: "anthropic", model, resultId },
    });
    const battery = (model: string) =>
      JSON.stringify({
        cases: [
          { taskId: "t1", solver: { completedTurns: 3, runtimeIdentities: [identity(model, "msg_1")] } },
          { taskId: "t2", solver: { completedTurns: 2, runtimeIdentities: [identity(model, null)] } },
          { taskId: "t3", solver: { completedTurns: 0, runtimeIdentities: [] } },
        ],
      });
    writeFileSync(join(domain, "runs", "run-1-repair-on", "battery.json"), battery("claude-opus-5"));
    rmSync(join(domain, "runs", "run-1-repair-off", "battery.json"));
    const digest = digestOf(paths);
    expect(digest).toContain(
      "run-1-repair-on: attested 1 · unattested 1 · no completed turn 1 · configured claude-opus-5 · served {claude-opus-5 ×1}",
    );
    expect(digest).toContain("UNATTESTED ROWS: 1 case(s) carry no provider receipt");
    expect(digest).not.toContain("SERVED MODEL MISMATCH");
    expect(digest).toContain("run-1-repair-off: battery record unavailable — attestation unobservable");

    writeFileSync(join(domain, "runs", "run-1-repair-on", "battery.json"), battery("claude-sonnet-5"));
    expect(digestOf(paths)).toContain(
      "SERVED MODEL MISMATCH: provider attested claude-sonnet-5 against configured claude-opus-5",
    );
  });

  it("settles the judge census inventory and triggers angle 2 on a recorded disagreement", () => {
    const paths = fixture();
    mkdirSync(join(paths.campaign, "analysis"), { recursive: true });
    const judges = (disagreements: number) =>
      JSON.stringify({
        census: {
          evidence: {
            judge: "on",
            censusSize: { controls: 0, battery: 2 },
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
  });

  it("reads family coverage, a repeated condition and an unowned admitted finding from recorded rows", () => {
    const paths = fixture();
    const row = (runId: string, taskId: string, family: string, truthOk: boolean) =>
      JSON.stringify({
        row: {
          runId,
          taskId,
          family,
          buildInputsHash: "abc123def456",
          backendPin: "claude/claude-opus-5/medium",
          acceptedSubmit: true,
          truthOk,
          runtimeNonResultKind: null,
          traces: [],
        },
      });
    writeFileSync(
      join(paths.campaign, "case-record.jsonl"),
      [
        ...["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"].map((id) =>
          row("run-1", `p${id}`, "planar", true),
        ),
        ...["a", "b", "c", "d", "e"].map((id) => row("run-1", `s${id}`, "spatial", false)),
        ...["a", "b"].map((id) => row("run-2", `s${id}`, "spatial", false)),
        row("run-2", "pa", "planar", true),
      ].join("\n"),
    );
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
});
