import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { hashJsonValue } from "../src/meta/stable-json.ts";
import { semanticFindingsIdentity } from "../src/author/builder-execution.ts";
import { controllerValidatedFinding } from "../src/truth/brief.ts";
import { builderToolFindings, builderToolsReport } from "../tools/outcome/builder-tools.ts";
import { scorecardFromReports } from "../tools/outcome/scorecard.ts";
import { cleanupScratch } from "./helpers/scratch.ts";
import {
  campaignDir,
  epoch,
  oneEpochCampaign,
  recordRow,
  session,
  contractlessSession,
} from "./helpers/builder-census-campaign.ts";

/**
 * What the census makes of a campaign holding several authoring epochs: which one is the last
 * authoring pass, what the workshop evidence adds, and when two recorded diagnoses are the same
 * diagnosis repeated.
 *
 * Epoch order is the controller's record, not directory order, and a repeat identity is derived
 * from the finding's semantics so a reworded diagnosis still reads as a repeat. The per-session
 * census the projection is built from is `outcome-builder-census.test.ts`.
 */

afterAll(cleanupScratch);

describe("the census across a campaign's epochs", () => {
  it("keeps workshop and authoring evidence in one composed epoch projection", () => {
    const campaign = oneEpochCampaign({
      "builder-session.json": contractlessSession,
      "verifier-workshop.jsonl": JSON.stringify({
        schema: "verifier-workshop-action/v2",
        sequence: 1,
        at: "2026-07-29T10:00:00.000Z",
        action: "inspect",
        outcome: "completed",
        reason: null,
        policyDigest: "policy-offline",
        requestDigest: "a".repeat(64),
        resultDigest: "b".repeat(64),
        subjectDigest: null,
      }),
    });
    const epochDir = join(campaign, "epoch-1");
    const iterationDir = join(epochDir, "01-matching");
    const nonResultDir = join(epochDir, "evidence-builder-authoring");
    mkdirSync(iterationDir, { recursive: true });
    mkdirSync(nonResultDir, { recursive: true });
    writeFileSync(
      join(iterationDir, "iteration.json"),
      JSON.stringify({
        ordinal: 1,
        dir: "01-matching",
        outcome: "build-failed",
        stage: "tests",
        attempts: { brief: 1, tests: 2 },
      }),
    );
    writeFileSync(
      join(nonResultDir, "02-aborted.json"),
      JSON.stringify({
        schema: "builder-authoring-attempts/v1",
        evidenceOwner: "controller-evidence",
        ordinal: 2,
        dir: "02-matching",
        outcome: "non-result",
        terminal: { role: "tests", status: "aborted", attribution: null },
        authorCalls: { brief: 1, tests: 1 },
        sessions: [
          { stage: "brief", state: "accepted", attempts: 1 },
          { stage: "tests", state: "non-result", attempts: 1 },
        ],
        source: null,
        writtenAt: "2026-07-29T10:00:00.000Z",
      }),
    );
    const report = builderToolsReport(campaign);
    expect(report.epochs[0]?.authoring.iterations[0]).toMatchObject({
      ordinal: 1,
      sessions: [
        { stage: "brief", state: "accepted", attempts: 1 },
        { stage: "tests", state: "rejected", attempts: 2 },
      ],
    });
    expect(report.epochs[0]?.authoring.nonResults[0]).toMatchObject({
      terminal: { role: "tests", status: "aborted" },
      authorCalls: { brief: 1, tests: 1 },
    });
    expect(report.epochs[0]?.workshop).toMatchObject({ actions: 1, completed: 1 });
    expect(builderToolFindings(report).join("\n")).toMatch(/authoring non-result at tests/);
  });

  it("names a record policy the session evidence never composed", () => {
    const campaign = oneEpochCampaign({
      "builder-session.json": session,
      "builder-path-record.jsonl": [
        recordRow({ policyDigest: "policy-a" }),
        recordRow({ seq: 2, policyDigest: "policy-b" }),
      ].join("\n"),
    });
    const findings = builderToolFindings(builderToolsReport(campaign));
    expect(findings.join("\n")).toMatch(
      /record rows used policies the session evidence never composed: policy-b/,
    );
  });

  it("normalises a historical multi-policy session without calling an unused policy anomalous", () => {
    const campaign = oneEpochCampaign({
      "builder-session.json": contractlessSession,
      "builder-path-record.jsonl": [
        recordRow({ policyDigest: "policy-author" }),
        recordRow({
          seq: 2,
          capability: "verifier_workshop",
          policyDigest: "policy-offline",
        }),
      ].join("\n"),
    });
    const one = builderToolsReport(campaign).epochs[0];
    expect(one?.composed?.isolations).toHaveLength(2);
    expect(one?.undeclared).toEqual([]);
    expect(builderToolFindings(builderToolsReport(campaign))).toEqual([]);
  });

  it("refuses a session record whose schema no writer produces", () => {
    const campaign = oneEpochCampaign({
      "builder-session.json": JSON.stringify({
        ...JSON.parse(session),
        schema: "builder-session-evidence/v1",
      }),
    });
    // An unread composition is stated absent, never as a session that composed nothing.
    expect(builderToolsReport(campaign).epochs[0]?.composed).toBeNull();
  });

  it("projects workshop failures and non-results from the protected action stream", () => {
    const campaign = campaignDir();
    const action = (
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
    epoch(campaign, "epoch-1", {
      "builder-session.json": session,
      "builder-path-record.jsonl": recordRow({}),
      "verifier-workshop.jsonl": [
        action(1, "completed", null, "c".repeat(64)),
        action(2, "failed", "command-failed", null),
        action(3, "non-result", "timeout", null),
      ].join("\n"),
    });
    const report = builderToolsReport(campaign);
    expect(report.epochs[0]?.workshop).toMatchObject({
      actions: 3,
      completed: 1,
      failed: 1,
      nonResults: 1,
      byReason: { "command-failed": 1, timeout: 1 },
      subjectDigests: ["c".repeat(64)],
    });
    expect(builderToolFindings(report).join("\n")).toMatch(/completed 1 failed and 1 non-result actions/);
  });

  it("a capability that only ever denied is the Builder asking for access it never had", () => {
    const campaign = oneEpochCampaign({
      "builder-session.json": session,
      "builder-path-record.jsonl": recordRow({ decision: "deny", reason: "deny/outside-allow", bytes: null }),
    });
    const findings = builderToolFindings(builderToolsReport(campaign));
    expect(findings.join("\n")).toMatch(/read was denied all 1 times \(deny\/outside-allow\)/);
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

  it("derives a detail-free semantic hash from recorded feedback, so a reworded diagnosis repeats", () => {
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
    });
    const report = builderToolsReport(campaign);
    const rows = report.epochs[0]?.authoring.iterations ?? [];
    expect(rows[0]?.semanticFindingsHash).toEqual(expect.any(String));
    // The exact hashes differ with the detail strings; the semantic hashes deliberately match.
    expect(rows[0]?.findingsHash).not.toBe(rows[1]?.findingsHash);
    expect(rows[0]?.semanticFindingsHash).toBe(rows[1]?.semanticFindingsHash);
    expect(rows[2]?.semanticFindingsHash).toBeNull();
    // The scorecard's repeat reading prefers the semantic view, so the rewording reads as a repeat.
    expect<unknown>(
      scorecardFromReports(report, null, "run-1").authoringEfficiency?.repeatedFindingHashes,
    ).toEqual([rows[0]?.semanticFindingsHash]);
  });

  // Run w26's exact shape: five gate rounds, one owner, one claim, 357 identical findings, and a
  // fresh record UUID inside 300 of the detail strings. The old identity read five different
  // hashes and the session ran to $45.96 without one repeat.
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
            detail: `engine returned ok:false on control "reject-esp32-build-arity" (record ${record})`,
          },
        ],
      },
    ];
    const first = semanticFindingsIdentity(round("87597ec2-2d8b-48c4-8759-dfabb08efae3"), null);
    const second = semanticFindingsIdentity(round("10021380-6853-44e5-a436-97bd5280357f"), null);
    expect(first).toBe(second);
    // Hostile: a genuinely different diagnosis at the same owner must still separate, or the stall
    // rule would end a session that was making progress.
    expect(
      semanticFindingsIdentity(
        [
          {
            owner: "oracle",
            claim,
            findings: [{ code: "DISCRIMINATION_REJECT_PASSED", path: "grader/controls.json" }],
          },
        ],
        null,
      ),
    ).not.toBe(first);
    // A gate that names no finding rows still separates on its claim, which is the only answer it
    // gave.
    expect(semanticFindingsIdentity([{ owner: "tests", claim: "authoring finding 1" }], null)).not.toBe(
      semanticFindingsIdentity([{ owner: "tests", claim: "authoring finding 2" }], null),
    );
    // So must the same finding raised at a different build stage.
    expect(semanticFindingsIdentity(round("87597ec2-2d8b-48c4-8759-dfabb08efae3"), "bundle")).not.toBe(first);
    // A grouped census finding keeps one code for every control, so progress shows only in the ids
    // its author projection names: repairing one of two rejected accepts is not a repeat, rewording is.
    const grouped = (detail: string) =>
      semanticFindingsIdentity(
        [
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
        ],
        null,
      );
    expect(grouped('2 valid example(s) were rejected on [span]: "a1", "a2"')).not.toBe(
      grouped('1 valid example(s) were rejected on [span]: "a2"'),
    );
    expect(grouped('rejected on [span]: "a2"')).toBe(grouped('the checks refused "a2"'));
    // Past the eight named ids, progress shows in the count of the rest.
    expect(grouped('rejected: "a1" and 22 more')).not.toBe(grouped('rejected: "a1" and 21 more'));
  });

  it("derives one repeat identity for the controller and the outcome reader", () => {
    const campaign = campaignDir();
    const findings = [{ code: "family-binding", path: "grader/controls.json", detail: "one detail" }];
    epoch(campaign, "epoch-1", {
      "01-domain/iteration.json": JSON.stringify({
        ordinal: 1,
        outcome: "gates-blocked",
        stage: null,
        attempts: { tests: 1 },
        findingsHash: semanticFindingsIdentity([{ owner: "tests", claim: "one claim", findings }], null),
        feedback: [{ owner: "tests", claim: "one claim", findings }],
      }),
    });
    const row = builderToolsReport(campaign).epochs[0]?.authoring.iterations[0];
    // The recorded controller hash and the derived reader hash are the same value, so a repeat
    // cannot read as progress in the loop and as a repeat in the census.
    expect(row?.semanticFindingsHash).toBe(row?.findingsHash);
  });
});
