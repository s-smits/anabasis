/**
 * The journeys report joins three separately recorded streams — the Builder's own tool receipts,
 * its submit attempts and the verifier workshop's action log — and its whole job is to say when
 * that join is sound and when it only looks sound. Each fixture below is one description of those
 * three streams, so a test changes the stream it is about and nothing else.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { tmpdir } from "../src/meta/os.ts";
import {
  submitProjection,
  type BuilderCustomToolCall,
  type BuilderExecutionEvidence,
  type BuilderSubmitAttempt,
} from "../src/author/builder-execution.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { builderToolJourneysReport } from "../tools/outcome/builder-tool-journeys.ts";
import { actionLabel } from "../tools/outcome/builder-tool-workshop-journey.ts";
import { main } from "../tools/outcome/cli.ts";

const cleanups: string[] = [];

const AT = "2026-08-24T00:00:00.000Z";
const LATER = "2026-08-25T00:00:00.000Z";

interface CallFacts {
  target?: BuilderCustomToolCall["target"];
  /** How the dispatch ended, which is not the same fact as the tool's own outcome. */
  dispatch?: BuilderCustomToolCall["dispatchOutcome"];
  semantic?: BuilderCustomToolCall["semantic"];
}

interface ActionFacts {
  /** The row's host sequence. The reader requires it to equal the row's own line. */
  sequence: number;
  reason?: string;
  at?: string;
  /** null is a row the report has nothing to join on. */
  resultDigest?: string | null;
}

type Campaign = ReturnType<typeof campaign>;

afterEach(() => {
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * One recorded tool receipt, named `tool.action` the way the report labels it. The sequence
 * doubles as the turn, so a join by turn stays readable against a join by order.
 */
function call(sequence: number, name: string, facts: CallFacts = {}): BuilderCustomToolCall {
  const dot = name.indexOf(".");
  return {
    sequence,
    turn: sequence,
    tool: name.slice(0, dot),
    action: name.slice(dot + 1),
    target: facts.target ?? {},
    startedAtMs: sequence * 100,
    durationMs: 10,
    dispatchOutcome: facts.dispatch ?? "returned",
    ...keyIfDefined("semantic", facts.semantic),
  };
}

function attempt(ordinal: number, accepted: boolean, codes: string[]): BuilderSubmitAttempt {
  return {
    kind: "candidate",
    ordinal,
    turn: ordinal * 3,
    atMs: ordinal * 1_000,
    outcome: accepted ? "accepted" : "refused",
    stage: accepted ? null : "gates",
    commit: String(ordinal).repeat(40),
    findingsDigest: accepted ? null : String(ordinal).repeat(64),
    findingCodes: codes,
    repeatedFindings: ordinal === 1 ? null : false,
    findingsDelta: ordinal === 1 ? null : { carried: 0, resolved: 2, introduced: 0 },
    workspaceChanged: ordinal === 1 ? null : true,
    treeFirstSubmittedAsAttempt: null,
    terminal: false,
  };
}

/** The aggregate a session reports for itself, which the report holds against its receipts. */
function counts(byName: Record<string, number>, failed = 0) {
  const total = Object.values(byName).reduce((sum, calls) => sum + calls, 0);
  return { total, failed, byName, custom: total, native: 0 };
}

/** A session that inspected, ran the workshop and submitted twice, once refused and once accepted. */
function execution(
  overrides: Partial<BuilderExecutionEvidence> = {},
  workshopSequence = 1,
): BuilderExecutionEvidence {
  const base: BuilderExecutionEvidence = {
    schema: "builder-execution/v6",
    backend: "codex",
    runtimeIdentity: null,
    turns: 6,
    durationMs: 6_000,
    toolCalls: counts({ harness_inspect: 2, verifier_workshop: 2, submit: 2 }),
    usage: { inputTokens: null, outputTokens: null, costUsd: null, reportedTurns: 0, estimatedTurns: 0 },
    firstToolMs: 100,
    submits: [attempt(1, false, ["missing-check", "missing-check"]), attempt(2, true, [])],
    partialTurn: null,
    failedCalls: [],
    failedCallsOmitted: 0,
    turnRetries: [],
    authoringReviews: [],
    failedByName: {},
    customCalls: [
      call(1, "harness_inspect.readiness", { semantic: { outcome: "clear", findings: 0 } }),
      call(2, "verifier_workshop.run", {
        semantic: {
          outcome: "failed",
          reason: "command-failed",
          resultDigest: "run-result-digest",
          workshopSequence,
        },
      }),
      call(3, "submit.submit"),
      call(4, "harness_inspect.feedback", {
        target: { feedbackGroup: 1 },
        semantic: { outcome: "findings", findings: 2 },
      }),
      call(5, "verifier_workshop.write", {
        semantic: {
          outcome: "completed",
          resultDigest: "write-result-digest",
          workshopSequence: workshopSequence + 1,
        },
      }),
      call(6, "submit.submit"),
    ],
    customCallsOmitted: 0,
    outcome: "recorded",
    writtenAt: AT,
    ...overrides,
  };
  // The counts are the rows' projection, as the writer states them, whatever rows a test chose.
  return { ...base, ...submitProjection(base.submits) };
}

/** One row of the workshop's own action log, named `action.outcome` as the report counts it. */
function action(name: string, facts: ActionFacts): string {
  const dot = name.indexOf(".");
  const verb = name.slice(0, dot);
  const row = {
    schema: "verifier-workshop-action/v2",
    sequence: facts.sequence,
    at: facts.at ?? AT,
    action: verb,
    outcome: name.slice(dot + 1),
    reason: facts.reason ?? null,
    policyDigest: "policy",
    requestDigest: "a".repeat(64),
    resultDigest: facts.resultDigest === undefined ? `${verb}-result-digest` : facts.resultDigest,
    subjectDigest: null,
  };
  return JSON.stringify(row);
}

/** One campaign holding one epoch: the three streams are written into it and read back out. */
function campaign() {
  const dir = mkdtempSync(join(tmpdir(), "ana-builder-tool-journeys-"));
  cleanups.push(dir);
  const epoch = join(dir, "epoch-fixture");
  mkdirSync(epoch, { recursive: true });
  const put = (name: string, body: string) => writeFileSync(join(epoch, name), body);
  return {
    dir,
    put,
    session: (overrides: Partial<BuilderExecutionEvidence> = {}) =>
      put("builder-execution.json", JSON.stringify(execution(overrides))),
    /** The whole workshop log, replacing whatever an earlier phase of the test wrote. */
    workshop: (...rows: string[]) => put("verifier-workshop.jsonl", rows.join("\n")),
    report: () => builderToolJourneysReport([dir]),
  };
}

const firstJoin = (camp: Campaign) => camp.report().campaigns[0]?.workshopJoins[0];

describe("a tool call's label", () => {
  it("names the recorded run a history read targeted, by its id or by its digest", () => {
    const named = call(1, "harness_inspect.history", { target: { taskId: "t-1", runId: "r-1" } });
    const digested = call(2, "harness_inspect.history", { target: { runIdDigest: "a".repeat(64) } });
    expect(actionLabel(named)).toBe("harness_inspect.history[task=t-1,run=r-1]");
    expect(actionLabel(digested)).toBe(`harness_inspect.history[run#=${"a".repeat(12)}]`);
  });
});

describe("Builder tool journeys", () => {
  it("counts the finding codes each refused preview recorded", () => {
    const camp = campaign();
    camp.session({
      customCalls: [
        call(1, "correctness_check.check", {
          semantic: { outcome: "blocked", findingCodes: ["missing-check", "root-unread"] },
        }),
        call(2, "correctness_check.check", {
          semantic: { outcome: "blocked", findingCodes: ["root-unread"] },
        }),
        call(3, "correctness_check.check", { semantic: { outcome: "clear" } }),
      ],
    });

    const preview = camp.report().tools.find((row) => row.tool === "correctness_check");
    expect(preview?.semantic).toMatchObject({
      observations: 3,
      byFindingCode: { "missing-check": 1, "root-unread": 2 },
    });
  });

  it("joins nearby tool calls to submit and workshop outcomes", () => {
    const camp = campaign();
    camp.session();
    camp.workshop(
      action("run.failed", { reason: "command-failed", sequence: 1 }),
      action("write.completed", { sequence: 2 }),
    );

    const report = camp.report();
    const tool = (name: string) => report.tools.find((row) => row.tool === name);

    expect(tool("harness_inspect")).toMatchObject({
      aggregateCalls: 2,
      receiptCalls: 2,
      phases: { "before-first-submit": 1, "between-submits": 1 },
      semantic: {
        source: "tool-receipts",
        observations: 2,
        successes: 1,
        failures: 1,
        byOutcome: { clear: 1, findings: 1 },
      },
    });
    expect(tool("verifier_workshop")).toMatchObject({
      dispatchOutcomes: { returned: 2 },
      semantic: {
        source: "workshop-actions",
        observations: 2,
        successes: 1,
        failures: 1,
        byOutcome: { "run.failed": 1, "write.completed": 1 },
        byReason: { "command-failed": 1 },
      },
    });
    expect(tool("submit")).toMatchObject({
      semantic: {
        observations: 2,
        successes: 1,
        failures: 1,
        byOutcome: { accepted: 1, "refused:gates": 1 },
        byFindingCode: { "missing-check": 2 },
      },
    });
    expect(report.campaigns[0]?.journeys[0]?.submitMoments).toEqual([
      expect.objectContaining({
        ordinal: 1,
        outcome: "refused",
        before: ["harness_inspect.readiness", "verifier_workshop.run"],
        after: ["harness_inspect.feedback[group=1]", "verifier_workshop.write", "submit.submit"],
      }),
      expect.objectContaining({
        ordinal: 2,
        outcome: "accepted",
        before: [
          "verifier_workshop.run",
          "submit.submit",
          "harness_inspect.feedback[group=1]",
          "verifier_workshop.write",
        ],
        after: [],
      }),
    ]);
    // The same workshop reading is rolled up per campaign, not only across all of them.
    expect(
      report.campaigns[0]?.tools.find((row) => row.tool === "verifier_workshop")?.semantic,
    ).toMatchObject({ observations: 2, successes: 1, failures: 1 });
    expect(firstJoin(camp)).toMatchObject({
      status: "joined",
      failures: [
        expect.objectContaining({
          tool: "verifier_workshop",
          action: "run",
          reason: "command-failed",
          before: ["harness_inspect.readiness"],
          after: ["submit.submit", "harness_inspect.feedback[group=1]", "verifier_workshop.write"],
        }),
      ],
    });
  });

  it("selects one numbered session by its epoch and write time", () => {
    const camp = campaign();
    camp.session();
    camp.put("builder-execution-02.json", JSON.stringify(execution({ writtenAt: LATER }, 3)));
    camp.workshop(
      action("run.failed", { reason: "command-failed", sequence: 1 }),
      action("write.completed", { sequence: 2 }),
      action("run.completed", { at: LATER, sequence: 3 }),
      action("write.completed", { at: LATER, sequence: 4 }),
    );

    const selector = `${camp.dir}::epoch-fixture::2026-08-24T12:00:00.000Z`;
    expect(builderToolJourneysReport([selector]).campaigns[0]).toMatchObject({
      sessions: 1,
      aggregateCustomCalls: 6,
      observedCustomCalls: 6,
      selection: { epoch: "epoch-fixture", writtenBefore: "2026-08-24T12:00:00.000Z" },
      // Only the two actions the selected session produced, out of the four recorded.
      workshopJoins: [{ actionEvidence: 2, receipts: 2, status: "joined" }],
    });
  });

  it("refuses an action log whose sequence is not its own line", () => {
    const camp = campaign();
    camp.session();
    // The host numbers each row as it writes it, so a row out of order is a rewritten log, not an
    // older one: the reader refuses rather than joining receipts by position again.
    camp.workshop(
      action("run.failed", { reason: "command-failed", sequence: 1 }),
      action("write.completed", { sequence: 3 }),
    );
    expect(() => camp.report()).toThrow("invalid verifier workshop action evidence at line 2");
  });

  it("retains aggregate gaps, receipt surplus and in-flight calls instead of inventing success", () => {
    const receiptless = campaign();
    receiptless.put(
      "builder-execution.json",
      JSON.stringify(
        execution({
          toolCalls: counts({ submit: 1 }),
          submits: [],
          customCalls: [],
        }),
      ),
    );

    const killed = campaign();
    killed.session({
      toolCalls: counts({}),
      submits: [],
      customCalls: [call(1, "submit.submit", { dispatch: "in-flight" })],
      outcome: "in-flight",
    });

    const report = builderToolJourneysReport([receiptless.dir, killed.dir]);
    // One session counted a call it recorded no receipt for; the other recorded a receipt its
    // aggregate never reached. Neither gap is closed by assuming the other stream was right.
    expect(report.campaigns.map((row) => row.aggregateMinusKnownReceipts)).toEqual([1, -1]);
    expect(report.campaigns.map((row) => row.observedCustomCalls)).toEqual([1, 1]);
    expect(report.campaigns[0]?.journeys[0]).toMatchObject({ receiptCalls: 0, aggregateCustomCalls: 1 });
    expect(report.campaigns[1]?.journeys[0]).toMatchObject({
      receiptCalls: 1,
      aggregateCustomCalls: 0,
      outcome: "in-flight",
    });
    expect(report.tools.find((row) => row.tool === "submit")).toMatchObject({
      aggregateCalls: 1,
      receiptCalls: 1,
      observedCalls: 2,
      dispatchOutcomes: { "in-flight": 1 },
      semantic: { observations: 0, successes: 0, failures: 0 },
    });
    expect(JSON.parse(main(["--builder-journeys", receiptless.dir, killed.dir]))).toMatchObject({
      schema: "builder-tool-journeys/v2",
      campaigns: [{ aggregateMinusKnownReceipts: 1 }, { aggregateMinusKnownReceipts: -1 }],
    });
  });

  it("keeps the original numbered session and surfaces an unreadable gap", () => {
    const camp = campaign();
    camp.session();
    camp.put("builder-execution-02.json", '{"schema":"builder-execution/v6"');
    camp.put("builder-execution-03.json", JSON.stringify(execution({ writtenAt: LATER })));

    const first = camp.report().campaigns[0];
    expect(first?.executionUnavailable).toEqual([
      expect.stringMatching(/builder-execution-02\.json: malformed JSON/),
    ]);
    expect(first?.journeys.map((session) => session.session)).toEqual([1, 3]);
  });

  it("joins duplicate result digests by host sequence and refuses ambiguous modern receipts", () => {
    const digest = "same-result-digest";
    const camp = campaign();
    // Two workshop calls whose results hashed the same. Only the host sequence separates them, so
    // repeating it leaves the report with no way to say which receipt each action belongs to.
    const pair = (writeSequence: number) =>
      ["run", "write"].map((verb, index) =>
        call(index + 1, `verifier_workshop.${verb}`, {
          semantic: {
            outcome: "completed",
            resultDigest: digest,
            workshopSequence: index === 0 ? 1 : writeSequence,
          },
        }),
      );
    const distinct = { customCalls: pair(2), submits: [], toolCalls: counts({ verifier_workshop: 2 }) };
    camp.session(distinct);

    camp.workshop(
      action("run.completed", { resultDigest: digest, sequence: 1 }),
      action("write.completed", { resultDigest: digest, sequence: 2 }),
    );
    expect(firstJoin(camp)?.status).toBe("joined");

    camp.workshop(
      action("run.completed", { resultDigest: "other-result-digest", sequence: 1 }),
      action("write.completed", { resultDigest: digest, sequence: 2 }),
    );
    expect(firstJoin(camp)?.status).toBe("receipt-mismatch");

    camp.session({ ...distinct, customCalls: pair(1) });
    expect(firstJoin(camp)?.status).toBe("ambiguous");
  });

  it("joins submit receipts and attempts by turn when a dispatch threw before its attempt", () => {
    const camp = campaign();
    // Turn 3: the submit dispatch threw, so no attempt exists for it. Turns 4 and 5 each carry one
    // returned receipt and one attempt. Positional pairing would attach attempt 1 to the thrown
    // receipt; the turn join must not.
    camp.session({
      // The schema requires the aggregate to equal its own per-name map, so three named submits are three.
      toolCalls: { total: 3, failed: 1, byName: { submit: 3 }, custom: 3, native: 0 },
      failedByName: { submit: 1 },
      // Receipts are numbered 1..n in dispatch order, so the turn a receipt names is its own field.
      customCalls: [
        { ...call(1, "submit.submit", { dispatch: "threw" }), turn: 3 },
        { ...call(2, "submit.submit"), turn: 4 },
        { ...call(3, "submit.submit"), turn: 5 },
      ],
      submits: [
        { ...attempt(1, false, ["missing-check"]), turn: 4 },
        { ...attempt(2, true, []), turn: 5 },
        // The one controller-created row states its kind, and the three comparison fields a
        // candidate carries are null on it because no candidate was inspected.
        {
          ...attempt(3, false, ["missing-check"]),
          kind: "controller-terminal",
          turn: 7,
          commit: "budget-limited",
          terminal: true,
          findingsDelta: null,
          repeatedFindings: null,
          workspaceChanged: null,
        },
      ],
    });

    expect(camp.report().campaigns[0]?.journeys[0]?.submitMoments).toEqual([
      expect.objectContaining({ turn: 3, join: "ambiguous", dispatchOutcome: "threw", outcome: null }),
      expect.objectContaining({
        turn: 4,
        join: "joined",
        kind: "candidate",
        dispatchOutcome: "returned",
        outcome: "refused",
      }),
      expect.objectContaining({
        turn: 5,
        join: "joined",
        kind: "candidate",
        dispatchOutcome: "returned",
        outcome: "accepted",
      }),
      expect.objectContaining({
        turn: 7,
        join: "ambiguous",
        kind: "controller-terminal",
        receiptSequence: null,
        outcome: "refused",
      }),
    ]);
  });
});
