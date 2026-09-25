/**
 * The Harness Builder tool census: what a campaign's sessions composed, what the path record and
 * the execution records saw them call, and what the census makes of several epochs together.
 *
 * The census never reads silence as evidence: a capability the record cannot see stays unknown
 * rather than unused. Epoch order is the controller's record, not directory order, and a repeat
 * identity is derived from a finding's semantics so a reworded diagnosis still reads as a repeat.
 * How execution records are numbered and read is `builder-execution-store.test.ts`.
 */
import { afterAll, describe, expect, it } from "bun:test";

import { mkdirSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { hashJsonValue } from "../src/meta/stable-json.ts";
import { type BuilderSubmitAttempt, semanticFindingsIdentity } from "../src/author/builder-execution.ts";
import { builderExecutionEvidenceWriter } from "../src/author/builder-execution-writer.ts";
import { controllerValidatedFinding } from "../src/truth/brief.ts";
import { builderToolFindings, builderToolsReport } from "../tools/outcome/builder-tools.ts";
import { scorecardFromReports } from "../tools/outcome/scorecard.ts";
import {
  campaignDir,
  contractlessSession,
  epoch,
  oneEpochCampaign,
  reconciledSession,
  recordRow,
  session,
} from "./helpers/builder-census-campaign.ts";
import { cleanupScratch } from "./helpers/scratch.ts";
import { type ExecutionRecordOverrides, executionRecord } from "./helpers/session-execution-record.ts";

afterAll(cleanupScratch);

/** An epoch folder holding `sessionEvidence`, with one written session per record in order. */
function sessionsEpoch(
  campaign: string,
  name: string,
  sessionEvidence: string | null,
  records: ExecutionRecordOverrides[],
): void {
  const epochDir = join(campaign, name);
  mkdirSync(epochDir, { recursive: true });
  if (sessionEvidence !== null) writeFileSync(join(epochDir, "builder-session.json"), sessionEvidence);
  for (const record of records) builderExecutionEvidenceWriter(epochDir)(executionRecord(record));
}

describe("one epoch's tool census", () => {
  it("joins the composed roster with the calls in the path record", () => {
    const campaign = oneEpochCampaign({
      "builder-session.json": session,
      "builder-path-record.jsonl": [
        recordRow({}),
        recordRow({
          seq: 2,
          capability: "write",
          decision: "deny",
          reason: "deny/outside-allow",
          bytes: null,
        }),
      ].join("\n"),
    });
    const one = builderToolsReport(campaign).epochs[0];
    expect(one?.composed?.isolated).toEqual(["bash", "read", "write"]);
    expect(one?.composed?.research).toEqual(["context", "oss"]);
    expect(one?.record?.byCapability.read).toEqual({
      allowed: 1,
      denied: 0,
      bytes: 10,
      reasons: ["allow/under-root"],
    });
    expect(one?.record?.firstAllowedRead).toEqual({
      seq: 1,
      requested: "STARTER.md",
      resolved: "/workspace/STARTER.md",
    });
    // Composed and never touched: exposure the Builder carried into every turn and did not use.
    expect(one?.neverUsed).toEqual(["bash"]);
  });

  // Production rows carry the tool name in `capability` and the access kind in `mode`, so a
  // predicate on the capability name would match no production row.
  it("keys firstAllowedRead on the access mode, not on the capability name", () => {
    const campaign = oneEpochCampaign({
      "builder-session.json": session,
      "builder-path-record.jsonl": recordRow({ capability: "public_source" }),
    });
    expect(builderToolsReport(campaign).epochs[0]?.record?.firstAllowedRead).toEqual({
      seq: 1,
      requested: "STARTER.md",
      resolved: "/workspace/STARTER.md",
    });
  });

  it("states what neither record can see, so silence is never read as evidence", () => {
    const campaign = campaignDir();
    epoch(campaign, "epoch-1", { "builder-session.json": session });
    const report = builderToolsReport(campaign);
    const one = report.epochs[0];
    expect(one?.unobserved).toContain("oss");
    expect(one?.unobserved).toContain("submit");
    // No path record is a stated null, never an empty count that reads as "made no calls".
    expect(one?.record).toBeNull();
    expect(one?.neverUsed).toBeNull();
    // No execution record leaves custom-tool use unknown in the same way.
    expect(report.customToolCalls).toBeNull();
    expect(builderToolFindings(report).join("\n")).toMatch(/no path record, so capability use is unknown/);
  });

  it("refuses a session record whose schema no writer produces, stating the composition absent", () => {
    const campaign = oneEpochCampaign({
      "builder-session.json": JSON.stringify({
        ...JSON.parse(session),
        schema: "builder-session-evidence/v1",
      }),
    });
    expect(builderToolsReport(campaign).epochs[0]?.composed).toBeNull();
  });

  it.each([
    [
      "names a record policy the session evidence never composed",
      session,
      [recordRow({ policyDigest: "policy-a" }), recordRow({ seq: 2, policyDigest: "policy-b" })],
      /record rows used policies the session evidence never composed: policy-b/,
    ],
    [
      "names a capability that only ever denied as access the Builder never had",
      session,
      [recordRow({ decision: "deny", reason: "deny/outside-allow", bytes: null })],
      /read was denied all 1 times \(deny\/outside-allow\)/,
    ],
    // The look-alike: several composed policies, each used, are not an undeclared one.
    [
      "reads a multi-policy session without calling a composed policy anomalous",
      contractlessSession,
      [
        recordRow({ policyDigest: "policy-author" }),
        recordRow({ seq: 2, capability: "verifier_workshop", policyDigest: "policy-offline" }),
      ],
      null,
    ],
  ])("%s", (_, sessionEvidence, rows, finding) => {
    const campaign = oneEpochCampaign({
      "builder-session.json": sessionEvidence,
      "builder-path-record.jsonl": rows.join("\n"),
    });
    const report = builderToolsReport(campaign);
    if (finding === null) {
      expect(report.epochs[0]?.composed?.isolations).toHaveLength(2);
      expect(report.epochs[0]?.undeclared).toEqual([]);
      expect(builderToolFindings(report)).toEqual([]);
    } else {
      expect(builderToolFindings(report).join("\n")).toMatch(finding);
    }
  });

  it("reports when the first successful workspace read skipped the Starter Pack", () => {
    const campaign = oneEpochCampaign({
      "builder-session.json": contractlessSession,
      "builder-path-record.jsonl": [
        recordRow({ requested: "MEMORY.md", resolved: "/workspace/MEMORY.md" }),
        recordRow({ seq: 2, requested: "STARTER.md", resolved: "/workspace/STARTER.md" }),
      ].join("\n"),
    });
    expect(builderToolFindings(builderToolsReport(campaign))).toContain(
      "epoch-1: first successful primary workspace read was MEMORY.md, not STARTER.md",
    );
  });
});

describe("the execution records in the census", () => {
  // A long session behind a nearly empty path record, resubmitting an unchanged tree against a
  // refusal it had already been handed: every number comes from the session's own evidence.
  it("carries the execution evidence and names a session that repeated itself", () => {
    const campaign = campaignDir();
    const refused = (over: Partial<BuilderSubmitAttempt> = {}): Partial<BuilderSubmitAttempt> => ({
      outcome: "refused",
      stage: "bundle",
      findingsDigest: "same-findings",
      findingCodes: ["unsupported-operation"],
      repeatedFindings: true,
      workspaceChanged: false,
      ...over,
    });
    epoch(campaign, "epoch-1", {
      "builder-session.json": contractlessSession,
      "builder-path-record.jsonl": recordRow({}),
      "builder-execution.json": JSON.stringify(
        executionRecord({
          turns: 4,
          durationMs: 2_622_000,
          toolCalls: { byName: { Read: 14, submit: 3, context: 3 } },
          usage: { inputTokens: 900, outputTokens: 120, reportedTurns: 4 },
          firstToolMs: 4_000,
          submits: [refused({ repeatedFindings: null, workspaceChanged: null }), refused(), refused()],
          outcome: "turn-bound",
          writtenAt: "2026-08-01T12:00:35.000Z",
        }),
      ),
    });
    const one = builderToolsReport(campaign).epochs[0];
    expect(one?.execution[0]).toMatchObject({ turns: 4, outcome: "turn-bound", backend: "claude" });
    expect(one?.execution[0]?.toolCalls.native).toBe(14);
    const findings = builderToolFindings(builderToolsReport(campaign)).join("\n");
    expect(findings).toMatch(
      /2 of 3 submissions completed at the commit the submission before them had already completed/,
    );
    expect(findings).toMatch(/2 of 3 submissions were refused with the findings/);
    // The path record saw one access while the session made fourteen native calls; stating both
    // together is the point.
    expect(findings).toMatch(/14 of 20 tool calls ran on the backend's native contract.*1 rows/);
  });

  it("sums Builder-owned custom calls by normalised tool name across sessions", () => {
    const campaign = campaignDir();
    sessionsEpoch(campaign, "epoch-1", null, [
      {
        backend: "claude",
        toolCalls: { byName: { mcp__harness__context: 3, context: 2, submit: 3, Read: 4 } },
        failedByName: { mcp__harness__context: 1, Read: 1 },
      },
      { backend: "openrouter", toolCalls: { byName: { read: 4, submit: 1 } } },
      { backend: null, toolCalls: { byName: { mcp__harness__context: 2 } } },
    ]);
    const census = builderToolsReport(campaign).customToolCalls;
    expect(census).toMatchObject({ sessions: 3, calls: 15, failed: 1 });
    expect(Object.keys(census?.byName ?? {}).slice(0, 3)).toEqual(["context", "read", "submit"]);
    expect(census?.byName.context).toEqual({
      calls: 7,
      failed: 1,
      sessionsCalled: 2,
      sessionsExposed: 2,
      sessionsExposureUnknown: 1,
    });
    // Without a recorded roster, Claude's host read exposure is unknown as well.
    expect(census?.byName.read).toEqual({
      calls: 4,
      failed: 0,
      sessionsCalled: 1,
      sessionsExposed: 1,
      sessionsExposureUnknown: 2,
    });
    expect(census?.byName.submit).toEqual({
      calls: 4,
      failed: 0,
      sessionsCalled: 2,
      sessionsExposed: 2,
      sessionsExposureUnknown: 1,
    });
    expect(census?.neverCalled).not.toContain("verifier_workshop");
    expect(census?.neverCalled).not.toContain("Read");
    expect(builderToolFindings(builderToolsReport(campaign))).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/custom tools never called/)]),
    );
  });

  it("uses an exact historical contract after a custom tool is renamed", () => {
    const campaign = campaignDir();
    const historical = JSON.parse(reconciledSession);
    const roster = ["context", "harness_preview", "public_source", "submit", "verifier_workshop"];
    historical.contract = {
      ...historical.contract,
      catalogued: roster,
      registered: roster,
      backendExposed: roster,
    };
    sessionsEpoch(campaign, "epoch-legacy-preview", JSON.stringify(historical), [
      { toolCalls: { byName: { mcp__harness__harness_preview: 7, submit: 1 } } },
    ]);
    const census = builderToolsReport(campaign).customToolCalls;
    expect(census).toMatchObject({ calls: 8 });
    expect(census?.byName.harness_preview).toMatchObject({ calls: 7, sessionsCalled: 1, sessionsExposed: 1 });
    expect(census?.byName).not.toHaveProperty("harness_inspect");
  });

  it("sums safe custom-tool actions and states the calls that carry no receipt", () => {
    const campaign = campaignDir();
    sessionsEpoch(campaign, "epoch-1", null, [
      {
        backend: "codex",
        toolCalls: { byName: { harness_inspect: 2 } },
        customCalls: [
          { tool: "harness_inspect", action: "readiness" },
          { tool: "harness_inspect", action: "task" },
        ],
      },
      { backend: "codex", toolCalls: { byName: { submit: 1 } } },
    ]);
    expect(builderToolsReport(campaign).customToolCalls?.intent).toEqual({
      recorded: 2,
      omitted: 0,
      aggregateCallsWithoutReceipt: 1,
      byToolAction: { harness_inspect: { readiness: 1, task: 1 } },
    });
  });

  it("counts zero use only against a recorded final interface and keeps an unrecorded one unknown", () => {
    const campaign = campaignDir();
    const submitOnly = { toolCalls: { byName: { submit: 1 } } };
    sessionsEpoch(campaign, "epoch-exact", reconciledSession, [submitOnly]);
    sessionsEpoch(campaign, "epoch-legacy", contractlessSession, [submitOnly]);
    const report = builderToolsReport(campaign);
    const census = report.customToolCalls;
    expect(census?.byName.context).toEqual({
      calls: 0,
      failed: 0,
      sessionsCalled: 0,
      sessionsExposed: 2,
      sessionsExposureUnknown: 0,
    });
    expect(census?.byName.harness_inspect).toEqual({
      calls: 0,
      failed: 0,
      sessionsCalled: 0,
      sessionsExposed: 1,
      sessionsExposureUnknown: 1,
    });
    expect(census?.neverCalled).toContain("context");
    expect(builderToolFindings(report)[0]).toMatch(
      /context \(exposed 2, exposure unknown 0\).*harness_inspect \(exposed 1, exposure unknown 1\)/,
    );
  });
});

const workshopAction = (
  sequence: number,
  outcome: "completed" | "failed" | "non-result",
  reason: string | null,
  subjectDigest: string | null,
) =>
  JSON.stringify({
    schema: "verifier-workshop-action/v2",
    sequence,
    at: "2026-07-29T10:00:00.000Z",
    action: "run",
    outcome,
    reason,
    policyDigest: "policy-a",
    requestDigest: "a".repeat(64),
    resultDigest: "b".repeat(64),
    subjectDigest,
  });

describe("the census across a campaign's epochs", () => {
  it("keeps workshop and authoring evidence in one composed epoch projection", () => {
    const campaign = oneEpochCampaign({
      "builder-session.json": contractlessSession,
      "verifier-workshop.jsonl": [
        workshopAction(1, "completed", null, "c".repeat(64)),
        workshopAction(2, "failed", "command-failed", null),
        workshopAction(3, "non-result", "timeout", null),
      ].join("\n"),
    });
    const epochDir = join(campaign, "epoch-1");
    mkdirSync(join(epochDir, "01-matching"), { recursive: true });
    mkdirSync(join(epochDir, "evidence-builder-authoring"), { recursive: true });
    writeFileSync(
      join(epochDir, "01-matching", "iteration.json"),
      JSON.stringify({
        ordinal: 1,
        dir: "01-matching",
        outcome: "gates-blocked",
        attempts: { brief: 1, tests: 2 },
      }),
    );
    writeFileSync(
      join(epochDir, "evidence-builder-authoring", "02-aborted.json"),
      JSON.stringify({
        schema: "builder-authoring-attempts/v1",
        evidenceOwner: "controller-evidence",
        ordinal: 2,
        dir: "02-matching",
        outcome: "non-result",
        terminal: { role: "tests", status: "aborted", attribution: null },
        authorCalls: { brief: 1, tests: 1 },
        source: null,
        writtenAt: "2026-07-29T10:00:00.000Z",
      }),
    );
    const report = builderToolsReport(campaign);
    expect(report.epochs[0]?.authoring.iterations[0]).toMatchObject({
      ordinal: 1,
      attempts: { brief: 1, tests: 2 },
    });
    expect(report.epochs[0]?.authoring.nonResults[0]).toMatchObject({
      terminal: { role: "tests", status: "aborted" },
      authorCalls: { brief: 1, tests: 1 },
    });
    expect(report.epochs[0]?.workshop).toMatchObject({
      actions: 3,
      completed: 1,
      failed: 1,
      nonResults: 1,
      byReason: { "command-failed": 1, timeout: 1 },
      subjectDigests: ["c".repeat(64)],
    });
    const findings = builderToolFindings(report).join("\n");
    expect(findings).toMatch(/authoring non-result at tests/);
    expect(findings).toMatch(/completed 1 failed and 1 non-result actions/);
  });

  it("orders content-addressed epochs by the controller record before projecting the last authoring", () => {
    const campaign = campaignDir();
    const first = "epoch-ffffffffffff";
    const second = "epoch-000000000000";
    const unlisted = "epoch-unlisted";
    const iteration = (commit: string) =>
      JSON.stringify({
        ordinal: 1,
        outcome: "fingerprinted",
        attempts: { fingerprint: 1 },
        workspaceChange: { commit },
      });
    epoch(campaign, first, { "01-domain/iteration.json": iteration("a".repeat(40)) });
    epoch(campaign, second, { "01-domain/iteration.json": iteration("b".repeat(40)) });
    mkdirSync(join(campaign, unlisted));
    writeFileSync(
      join(campaign, "epochs.json"),
      JSON.stringify({
        schema: "campaign-epochs/v1",
        current: second,
        epochs: [
          { key: first, supersedes: null },
          { key: second, supersedes: first },
        ],
      }),
    );
    const report = builderToolsReport(campaign);
    expect(report.epochs.map(({ epoch: key }) => key)).toEqual([first, second, unlisted]);
    expect(scorecardFromReports(report, null, "run-1").reach?.lastAuthoring).toMatchObject({
      epoch: second,
      ordinal: 1,
      workspaceCommit: "b".repeat(40),
    });
  });

  it("derives one detail-free semantic hash for the controller and the reader, so a reworded diagnosis repeats", () => {
    const campaign = campaignDir();
    const iteration = (dir: string, ordinal: number, detail: string) => ({
      [`${dir}/iteration.json`]: JSON.stringify({
        ordinal,
        outcome: "gates-blocked",
        attempts: { tests: 1 },
        findingsHash: hashJsonValue({ detail }),
        feedback: [
          {
            owner: "tests",
            claim: "the control corpus does not isolate one family",
            findings: [{ code: "family-binding", path: "correctness-model/controls.json", detail }],
          },
        ],
      }),
    });
    const controllerFindings = [
      { code: "family-binding", path: "grader/controls.json", detail: "one detail" },
    ];
    epoch(campaign, "epoch-1", {
      ...iteration("01-domain", 1, "family fan has no isolating reject"),
      ...iteration("02-domain", 2, "no reject isolates the fan family (reworded)"),
      // A row whose feedback names no finding derives nothing: null, not a hash over emptiness.
      "03-domain/iteration.json": JSON.stringify({
        ordinal: 3,
        outcome: "fingerprinted",
        attempts: { fingerprint: 1 },
        feedback: [{ owner: "tests", claim: "the bundle fingerprinted", findings: [] }],
      }),
      // The controller records the same identity the reader derives, so a repeat cannot read as
      // progress in the loop and as a repeat in the census.
      "04-domain/iteration.json": JSON.stringify({
        ordinal: 4,
        outcome: "gates-blocked",
        attempts: { tests: 1 },
        findingsHash: semanticFindingsIdentity([
          { owner: "tests", claim: "one claim", findings: controllerFindings },
        ]),
        feedback: [{ owner: "tests", claim: "one claim", findings: controllerFindings }],
      }),
    });
    const report = builderToolsReport(campaign);
    const rows = report.epochs[0]?.authoring.iterations ?? [];
    expect(rows[0]?.semanticFindingsHash).toEqual(expect.any(String));
    expect(rows[0]?.findingsHash).not.toBe(rows[1]?.findingsHash);
    expect(rows[0]?.semanticFindingsHash).toBe(rows[1]?.semanticFindingsHash);
    expect(rows[2]?.semanticFindingsHash).toBeNull();
    expect(rows[3]?.semanticFindingsHash).toBe(rows[3]?.findingsHash);
    // The scorecard's repeat reading prefers the semantic view, so the rewording reads as a repeat.
    expect<unknown>(
      scorecardFromReports(report, null, "run-1").authoringEfficiency?.repeatedFindingHashes,
    ).toEqual([rows[0]?.semanticFindingsHash]);
  });

  it("reads a re-executed diagnosis as a repeat when only a per-execution record id moved", () => {
    const claim = "control census against the real engine returned 1 finding(s)";
    const round = (record: string) => [
      {
        owner: "oracle" as const,
        claim,
        findings: [
          {
            code: "EXTERNAL_RESULT_UNBOUND",
            path: "grader/controls.json",
            detail: `engine returned ok:false on control "reject-build-arity" (record ${record})`,
          },
        ],
      },
    ];
    const first = semanticFindingsIdentity(round("87597ec2-2d8b-48c4-8759-dfabb08efae3"));
    expect(semanticFindingsIdentity(round("10021380-6853-44e5-a436-97bd5280357f"))).toBe(first);
    // Hostile: a genuinely different diagnosis at the same owner must still separate, or the stall
    // rule would end a session that was making progress.
    expect(
      semanticFindingsIdentity([
        {
          owner: "oracle",
          claim,
          findings: [{ code: "DISCRIMINATION_REJECT_PASSED", path: "grader/controls.json" }],
        },
      ]),
    ).not.toBe(first);
    // A gate that names no finding rows still separates on its claim, the only answer it gave.
    expect(semanticFindingsIdentity([{ owner: "tests", claim: "authoring finding 1" }])).not.toBe(
      semanticFindingsIdentity([{ owner: "tests", claim: "authoring finding 2" }]),
    );
    // A grouped census finding keeps one code for every control, so progress shows only in the ids
    // its author projection names: repairing one of two rejected accepts is not a repeat, rewording is.
    const grouped = (detail: string) =>
      semanticFindingsIdentity([
        {
          owner: "correctness-model",
          claim,
          findings: [
            controllerValidatedFinding({
              code: "DISCRIMINATION_ACCEPT_REJECTED",
              path: "correctness-model/controls.json",
              detail,
            }),
          ],
        },
      ]);
    expect(grouped('2 valid example(s) were rejected on [span]: "a1", "a2"')).not.toBe(
      grouped('1 valid example(s) were rejected on [span]: "a2"'),
    );
    expect(grouped('rejected on [span]: "a2"')).toBe(grouped('the checks refused "a2"'));
    // Past the eight named ids, progress shows in the count of the rest.
    expect(grouped('rejected: "a1" and 22 more')).not.toBe(grouped('rejected: "a1" and 21 more'));
  });
});
