import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { CUSTOM_TOOL_NAMES, bareCustomToolName } from "../src/author/builder-custom-tool-call.ts";
import {
  type BuilderCustomToolCall,
  type BuilderExecutionEvidence,
  type BuilderSubmitAttempt,
} from "../src/author/builder-execution.ts";
import {
  builderExecutionEvidenceWriter,
  writeBuilderExecutionEvidence,
} from "../src/author/builder-execution-writer.ts";
import { readExecutionEvidence } from "../tools/outcome/builder-execution-facts.ts";
import { builderToolFindings, builderToolsReport } from "../tools/outcome/builder-tools.ts";
import { cleanupScratch } from "./helpers/scratch.ts";
import {
  campaignDir,
  epoch,
  oneEpochCampaign,
  recordRow,
  session,
  contractlessSession,
  reconciledSession,
} from "./helpers/builder-census-campaign.ts";

type ExecutionFixtureOverrides = Omit<
  Partial<BuilderExecutionEvidence>,
  "toolCalls" | "usage" | "submits" | "customCalls"
> & {
  toolCalls?: Partial<BuilderExecutionEvidence["toolCalls"]>;
  usage?: Partial<BuilderExecutionEvidence["usage"]>;
  submits?: Array<Partial<BuilderSubmitAttempt>>;
  customCalls?: Array<Partial<BuilderCustomToolCall>>;
};

/**
 * The Harness Builder's declared-versus-called tool census, and the execution record it reads.
 *
 * The census joins what a session composed with what the path record saw, and it never reads
 * silence as evidence: a capability the record cannot see stays unknown rather than unused. The
 * epoch projection that composes several sessions into one reading is
 * `outcome-builder-epochs.test.ts`.
 */

afterAll(cleanupScratch);

/** The writer derives its aggregate from the per-name map it just merged, and the reader refuses a
 * record whose aggregate disagrees with it, so a fixture that names calls derives the same way.
 * A case that wants a specific tuple still passes one. */
function derivedToolCalls(
  override: Partial<BuilderExecutionEvidence["toolCalls"]> | undefined,
  failedByName: Record<string, number> | undefined,
): BuilderExecutionEvidence["toolCalls"] {
  const byName = override?.byName ?? {};
  const named = Object.entries(byName);
  const total = named.reduce((sum, [, count]) => sum + count, 0);
  const custom = named.reduce(
    (sum, [name, count]) => sum + (CUSTOM_TOOL_NAMES.has(bareCustomToolName(name)) ? count : 0),
    0,
  );
  const failed = Object.values(failedByName ?? {}).reduce((sum, count) => sum + count, 0);
  return { total, failed, byName, custom, native: total - custom, ...override };
}

/** Build a complete `builder-execution/v6` record. The reader validates every field before
 * projecting it to a consumer, so these fixtures fill the writer's stable defaults and leave each
 * test's actual variation visible in its override. */
function executionRecord(overrides: ExecutionFixtureOverrides = {}): BuilderExecutionEvidence {
  const {
    toolCalls: toolCallsOverride,
    usage: usageOverride,
    submits: submitsOverride,
    customCalls: customCallsOverride,
    ...rest
  } = overrides;
  const submits = (submitsOverride ?? []).map(
    (row, index): BuilderSubmitAttempt => ({
      ordinal: index + 1,
      turn: index + 1,
      atMs: (index + 1) * 1000,
      kind: "candidate",
      outcome: "accepted",
      stage: null,
      commit: "c".repeat(40),
      findingsDigest: null,
      findingCodes: [],
      // Only the first candidate has no predecessor to compare itself with; the reader refuses a
      // later row that leaves those three comparisons unstated.
      repeatedFindings: index === 0 ? null : false,
      findingsDelta: index === 0 ? null : { carried: 0, resolved: 0, introduced: 0 },
      workspaceChanged: index === 0 ? null : true,
      treeFirstSubmittedAsAttempt: null,
      terminal: false,
      ...row,
    }),
  );
  const customCalls = (customCallsOverride ?? []).map(
    (row, index): BuilderCustomToolCall => ({
      sequence: index + 1,
      turn: index + 1,
      tool: "unknown",
      action: "unknown",
      target: {},
      startedAtMs: null,
      durationMs: null,
      dispatchOutcome: "returned",
      ...row,
    }),
  );
  return {
    schema: "builder-execution/v6",
    backend: "claude",
    runtimeIdentity: null,
    turns: 0,
    durationMs: 0,
    toolCalls: derivedToolCalls(toolCallsOverride, rest.failedByName),
    usage: {
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      reportedTurns: 0,
      estimatedTurns: 0,
      ...usageOverride,
    },
    firstToolMs: null,
    submits,
    turnRetries: [],
    authoringReviews: [],
    failedByName: {},
    partialTurn: null,
    failedCalls: [],
    failedCallsOmitted: 0,
    customCalls,
    customCallsOmitted: 0,
    outcome: "in-flight",
    writtenAt: "2026-08-25T00:00:00.000Z",
    ...rest,
  };
}

describe("the Harness Builder tool census", () => {
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

  // run w12 legibility finding: production rows carry tool names in `capability`
  // ("public_source", "verifier_workshop") and the access kind in `mode`; the old predicate
  // tested capability === "read", matched no production row ever, and reported null.
  it("keys firstAllowedRead on the access mode, not on the capability name", () => {
    const campaign = oneEpochCampaign({
      "builder-session.json": session,
      "builder-path-record.jsonl": recordRow({ capability: "public_source" }),
    });
    const one = builderToolsReport(campaign).epochs[0];
    expect(one?.record?.firstAllowedRead).toEqual({
      seq: 1,
      requested: "STARTER.md",
      resolved: "/workspace/STARTER.md",
    });
  });

  it("states what the path record cannot see, so silence is never read as evidence", () => {
    const campaign = campaignDir();
    epoch(campaign, "epoch-1", { "builder-session.json": session });
    const one = builderToolsReport(campaign).epochs[0];
    expect(one?.unobserved).toContain("oss");
    expect(one?.unobserved).toContain("submit");
    // No record file at all is a stated null, never an empty count that reads as "made no calls".
    expect(one?.record).toBeNull();
    // Without a record, there is no record of which capabilities were used.
    expect(one?.neverUsed).toBeNull();
    expect(builderToolFindings(builderToolsReport(campaign)).join("\n")).toMatch(
      /no path record, so capability use is unknown/,
    );
  });

  // Run 35 in miniature: a long session behind a nearly empty path record,
  // resubmitting an unchanged tree against a refusal it had already been handed. Every number here
  // comes from the session's own evidence, so the census stops reading as a Builder that did little.
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
    // The record saw one access while the session made fourteen native calls. Stating both
    // together is the point: the record's silence was never evidence of an idle Builder.
    expect(findings).toMatch(/14 of 20 tool calls ran on the backend's native contract.*1 rows/);
  });

  it("keeps every authoring session's execution record instead of overwriting the first", () => {
    // Run 12x's repair session overwrote the opening build's builder-execution.json, leaving 3 of
    // 4 sessions unobservable. The writer now takes the next free numbered name per session and
    // the reader returns them in write order.
    const campaign = campaignDir();
    const epochDir = join(campaign, "epoch-1");
    mkdirSync(epochDir, { recursive: true });
    const evidence = (turns: number) => executionRecord({ turns });
    writeBuilderExecutionEvidence(epochDir, evidence(1));
    writeBuilderExecutionEvidence(epochDir, evidence(2));
    writeBuilderExecutionEvidence(epochDir, evidence(3));
    expect(readExecutionEvidence(epochDir).map((record) => record.turns)).toEqual([1, 2, 3]);
  });

  it("sums Builder-owned custom calls by normalised tool name across sessions", () => {
    const campaign = campaignDir();
    const epochDir = join(campaign, "epoch-1");
    mkdirSync(epochDir, { recursive: true });
    const execution = (
      backend: "claude" | "openrouter" | null,
      byName: Record<string, number>,
      failedByName: Record<string, number> = {},
    ) =>
      executionRecord({
        backend,
        toolCalls: { byName },
        failedByName,
      });
    writeBuilderExecutionEvidence(
      epochDir,
      execution(
        "claude",
        { mcp__harness__context: 3, context: 2, submit: 3, Read: 4 },
        { mcp__harness__context: 1, Read: 1 },
      ),
    );
    writeBuilderExecutionEvidence(epochDir, execution("openrouter", { read: 4, submit: 1 }));
    writeBuilderExecutionEvidence(epochDir, execution(null, { mcp__harness__context: 2 }));

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
    expect(census?.byName.read).toEqual({
      calls: 4,
      failed: 0,
      sessionsCalled: 1,
      sessionsExposed: 1,
      // Without a recorded roster, Claude's host read exposure is unknown as well.
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
    const epochDir = join(campaign, "epoch-legacy-preview");
    mkdirSync(epochDir, { recursive: true });
    const historical = JSON.parse(reconciledSession);
    const roster = ["context", "harness_preview", "public_source", "submit", "verifier_workshop"];
    historical.contract = {
      ...historical.contract,
      catalogued: roster,
      registered: roster,
      backendExposed: roster,
    };
    writeFileSync(join(epochDir, "builder-session.json"), JSON.stringify(historical));
    writeBuilderExecutionEvidence(
      epochDir,
      executionRecord({
        backend: "claude",
        toolCalls: { byName: { mcp__harness__harness_preview: 7, submit: 1 } },
        failedByName: {},
      }),
    );

    const census = builderToolsReport(campaign).customToolCalls;
    expect(census).toMatchObject({ calls: 8 });
    expect(census?.byName.harness_preview).toMatchObject({
      calls: 7,
      sessionsCalled: 1,
      sessionsExposed: 1,
    });
    expect(census?.byName).not.toHaveProperty("harness_inspect");
  });

  it("sums safe custom-tool actions and states the legacy receipt gap", () => {
    const campaign = campaignDir();
    const epochDir = join(campaign, "epoch-1");
    mkdirSync(epochDir, { recursive: true });
    writeBuilderExecutionEvidence(
      epochDir,
      executionRecord({
        schema: "builder-execution/v6",
        backend: "codex",
        toolCalls: { byName: { harness_inspect: 2 } },
        failedByName: {},
        customCalls: [
          { tool: "harness_inspect", action: "readiness" },
          { tool: "harness_inspect", action: "task" },
        ],
        customCallsOmitted: 0,
      }),
    );
    writeBuilderExecutionEvidence(
      epochDir,
      executionRecord({
        backend: "codex",
        toolCalls: { byName: { submit: 1 } },
        failedByName: {},
      }),
    );
    expect(builderToolsReport(campaign).customToolCalls?.intent).toEqual({
      recorded: 2,
      omitted: 0,
      aggregateCallsWithoutReceipt: 1,
      byToolAction: { harness_inspect: { readiness: 1, task: 1 } },
    });
  });

  it("counts zero use only against a recorded final interface and keeps legacy late tools unknown", () => {
    const campaign = campaignDir();
    const exactDir = join(campaign, "epoch-exact");
    mkdirSync(exactDir, { recursive: true });
    writeFileSync(join(exactDir, "builder-session.json"), reconciledSession);
    writeBuilderExecutionEvidence(
      exactDir,
      executionRecord({
        backend: "claude",
        toolCalls: { byName: { submit: 1 } },
        failedByName: {},
        submits: [],
      }),
    );
    const legacyDir = join(campaign, "epoch-legacy");
    mkdirSync(legacyDir, { recursive: true });
    writeFileSync(join(legacyDir, "builder-session.json"), contractlessSession);
    writeBuilderExecutionEvidence(
      legacyDir,
      executionRecord({
        backend: "claude",
        toolCalls: { byName: { submit: 1 } },
        failedByName: {},
        submits: [],
      }),
    );

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

  it("keeps custom-tool use unknown when no Builder execution record exists", () => {
    const campaign = campaignDir();
    epoch(campaign, "epoch-1", { "builder-session.json": contractlessSession });
    expect(builderToolsReport(campaign).customToolCalls).toBeNull();
  });

  it("rewrites one session's checkpoints in place while a later session claims the next name", () => {
    const campaign = campaignDir();
    const epochDir = join(campaign, "epoch-1");
    mkdirSync(epochDir, { recursive: true });
    const evidence = (turns: number) => executionRecord({ turns });
    const writer = builderExecutionEvidenceWriter(epochDir);
    writer(evidence(1));
    writer(evidence(2));
    writeBuilderExecutionEvidence(epochDir, evidence(9));
    // The first session holds one record, at its latest write; the later session did not overwrite it.
    expect(readExecutionEvidence(epochDir).map((record) => record.turns)).toEqual([2, 9]);
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
