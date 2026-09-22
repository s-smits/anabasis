/**
 * One gate run, shared by correctness_check and submit.
 *
 * Preview and submit run the same sequence on the same immutable snapshot, so a candidate whose
 * bytes and installed tools have not moved must not pay for it twice — and a candidate whose
 * condition did move must not inherit the earlier verdict. These fix where that line falls.
 */
import { existsSync, readFileSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { afterAll, describe, expect, it } from "bun:test";
import {
  completeBundle,
  installTool,
  requireExternalVerifier,
  submitTool,
} from "./helpers/builder-campaign.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import type { FixtureSubmitTool } from "./helpers/builder-campaign.ts";
import { MATCHING_ACCEPTS, MATCHING_REJECTS, padToCalibrationFloor } from "./helpers/matching-fixture.ts";
import { required, scriptedSession, toolDouble } from "./helpers/doubles.ts";
import { hashJsonValue } from "../src/meta/stable-json.ts";
import { runBuilderCampaign } from "../src/run/builder-campaign.ts";
import type { CampaignOutcome } from "../src/author/campaign-types.ts";
import { resumeCampaignMemory } from "../src/author/campaign-memory.ts";
import type { HostSession, PiTool } from "../src/backends/pi-session.ts";

afterAll(cleanupScratch);

describe("a gate run two callers may share", () => {
  it.each([
    "unchanged",
    "candidate",
    "tool",
    "submit-first",
    "preview-throws",
    "preview-blocks",
    "host-recovers",
  ])("submit joins an in-flight correctness_check only for the same condition: %s", async (change) => {
    // Variant S (a Sol run, 2026-08-23): a clear check took 240.6 s and the submit of the unchanged
    // tree paid 240.0 s for the same rows. The trial's evidence is the iteration's evidence.
    const campaignDir = scratchDir("ana-check-then-submit-");
    const workspace = join(campaignDir, "workspace");
    let probeLoads = 0;
    const gateDirs: string[] = [];
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const open = async (tools: readonly PiTool[]) =>
      scriptedSession(async () => {
        completeBundle(workspace);
        requireExternalVerifier(workspace);
        installTool(workspace, "field-engine", "#!/bin/sh\nexit 0\n");
        // SAFETY: the toolkit registers correctness_check whenever a gate is mounted; the fixture
        // reads only the name and the execute hook a tool row exposes.
        const check = tools.find(
          (tool) => (tool as { name?: string }).name === "correctness_check",
        ) as FixtureSubmitTool;
        const first = change === "submit-first" ? submitTool(tools) : check;
        const second = change === "submit-first" ? check : submitTool(tools);
        const checking = first.execute("first", {});
        await started.promise;
        if (change === "candidate") {
          writeFileSync(join(workspace, "correctness-model", "guide.md"), "# changed\n");
        }
        if (change === "tool") installTool(workspace, "field-engine", "#!/bin/sh\nexit 1\n");
        const submitting = second.execute("second", {});
        release.resolve();
        await Promise.all([checking, submitting]);
        return { status: "completed", assistantText: "submitted" };
      });
    const outcome = await runBuilderCampaign(
      {
        campaignDir,
        slug: "matching",
        kickoff: "Build a slot binding harness.",
        expectedTasks: 4,
        maxTurns: change === "preview-blocks" ? 1 : 2,
      },
      {
        open,
        tools: [],
        toolsProbes: () => ({
          load: async () => {
            probeLoads += 1;
            return [];
          },
        }),
        gates: async (_harness, iterationDir) => {
          gateDirs.push(iterationDir);
          started.resolve();
          await release.promise;
          if (gateDirs.length === 1 && change === "preview-throws") throw new Error("preview host failed");
          if (gateDirs.length === 1 && (change === "preview-blocks" || change === "host-recovers")) {
            return [
              {
                owner: change === "host-recovers" ? "environment" : "correctness-model",
                severity: "blocking",
                claim: "preview refused",
                evidence: "gate.json",
              },
            ];
          }
          writeFileSync(join(iterationDir, "census.json"), "{}\n");
          return [];
        },
      },
    );
    expect(outcome.buildAdmissible).toBe(change !== "preview-blocks");
    // Matching conditions share the first gate's evidence. Submit always loads its immutable
    // snapshot; a later preview can read that receipt without another conformance load.
    expect(gateDirs).toHaveLength(["unchanged", "submit-first", "preview-blocks"].includes(change) ? 1 : 2);
    if (change !== "submit-first") expect(gateDirs[0]).toStartWith(join(campaignDir, "trials"));
    expect(probeLoads).toBe(change === "submit-first" ? 1 : 2);
    expect(existsSync(join(campaignDir, "01-matching", "census.json"))).toBe(change !== "preview-blocks");
  });

  // Safeguard 33 observes a clear preview followed by a refused submit of the same condition.
  // Make the repeated conformance load fail to exercise that disagreement.
  it("names a refused submit of bytes whose correctness_check was clear", async () => {
    const campaignDir = scratchDir("ana-check-then-refused-");
    const workspace = join(campaignDir, "workspace");
    let probeLoads = 0;
    const open = async (tools: readonly PiTool[]) =>
      scriptedSession(async () => {
        completeBundle(workspace);
        // SAFETY: the toolkit registers correctness_check whenever a gate is mounted; the fixture
        // reads only the name and the execute hook a tool row exposes.
        const check = tools.find(
          (tool) => (tool as { name?: string }).name === "correctness_check",
        ) as FixtureSubmitTool;
        await check.execute("check-1", {});
        await submitTool(tools).execute("submit-1", {});
        return { status: "completed", assistantText: "submitted" };
      });
    const lines: string[] = [];
    const original = console.error;
    console.error = (message?: string) => {
      const line = String(message);
      if (line.includes("33-preview-clear-submit-refused")) lines.push(line);
      else original(line);
    };
    let outcome: CampaignOutcome;
    try {
      outcome = await runBuilderCampaign(
        {
          campaignDir,
          slug: "matching",
          kickoff: "Build a slot binding harness.",
          expectedTasks: 4,
          maxTurns: 1,
        },
        {
          open,
          tools: [],
          toolsProbes: () => ({
            load: async () => {
              probeLoads += 1;
              return probeLoads === 1
                ? []
                : [
                    {
                      code: "generated-load-crash",
                      path: "agent/tools.ts",
                      detail: "worker exited before its handshake",
                    },
                  ];
            },
          }),
          gates: async (_harness, iterationDir) => {
            writeFileSync(join(iterationDir, "census.json"), "{}\n");
            return [];
          },
        },
      );
    } finally {
      console.error = original;
    }
    expect(outcome.buildAdmissible).toBe(false);
    expect(probeLoads).toBe(2);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("correctness_check was clear under condition");
    expect(lines[0]).toContain("submit refused at stage");
    // The operator line carries the stage and the finding code, never the fixture detail.
    expect(lines[0]).toContain("with generated-load-crash");
    expect(lines[0]).not.toContain("handshake");
  });

  it.concurrent("returns the unknown-check finding submit refuses with, before either spends the census", async () => {
    // The preview and submit share structural admission. Check-program behaviour is decided by
    // execution, so this parity case uses an unknown check identity instead of a static cascade.
    const campaignDir = scratchDir("ana-check-cascade-parity-");
    const workspace = join(campaignDir, "workspace");
    const texts: string[] = [];
    const open = async (tools: readonly PiTool[]) =>
      scriptedSession(async () => {
        completeBundle(workspace);
        // The reject cannot attribute a failure to a check the package never declared.
        const cascading = MATCHING_REJECTS.map((reject) =>
          reject.id === "r-wrongbind"
            ? {
                ...reject,
                expectedCheckId: "missing-check",
              }
            : reject,
        );
        writeFileSync(
          join(workspace, "correctness-model/controls.json"),
          JSON.stringify({
            accept: padToCalibrationFloor("accept", MATCHING_ACCEPTS),
            reject: padToCalibrationFloor("reject", cascading),
          }),
        );
        // SAFETY: as above — the fixture reads only the registered tool's name and execute hook.
        const check = tools.find(
          (tool) => (tool as { name?: string }).name === "correctness_check",
        ) as FixtureSubmitTool;
        for (const tool of [check, submitTool(tools)]) {
          const answer = await tool.execute("call", {});
          texts.push(answer.content.map((part) => part.text).join("\n"));
        }
        return { status: "completed", assistantText: "submitted" };
      });
    const outcome = await runBuilderCampaign(
      {
        campaignDir,
        slug: "matching",
        kickoff: "Build a slot binding harness.",
        expectedTasks: 4,
        maxTurns: 1,
      },
      {
        open,
        tools: [],
        toolsProbes: () => ({}),
        gates: async () => {
          throw new Error("the census gate must not run past a bundle refusal");
        },
      },
    );
    expect(outcome.buildAdmissible).toBe(false);
    expect(texts).toHaveLength(2);
    for (const text of texts) {
      expect(text).toContain("controls-reject-unknown-check");
      expect(text).toContain("r-wrongbind");
      expect(text).toContain("missing-check");
    }
    expect(JSON.parse(required(texts[0], "check text"))).toMatchObject({
      status: "findings",
      stage: "bundle",
      notReached: ["validation", "conformance", "gates"],
    });
  });

  it("reuses only the refused installed-tool condition and accepts its clear repaired preview", async () => {
    const campaignDir = scratchDir("ana-refused-tool-condition-");
    const workspace = join(campaignDir, "workspace");
    const submits: string[] = [];
    let gateCalls = 0;
    const outcome = await runBuilderCampaign(
      {
        campaignDir,
        slug: "matching",
        kickoff: "Build a slot binding harness.",
        expectedTasks: 4,
        maxTurns: 6,
      },
      {
        tools: [],
        toolsProbes: () => ({}),
        gates: async () => {
          gateCalls += 1;
          return readFileSync(join(workspace, ".toolchain/bin/field-engine"), "utf8").includes("exit 0")
            ? []
            : [
                {
                  owner: "correctness-model",
                  severity: "blocking",
                  claim: "installed tool failed",
                  evidence: "gate.json",
                },
              ];
        },
        open: async (tools) =>
          scriptedSession(async () => {
            completeBundle(workspace);
            requireExternalVerifier(workspace);
            installTool(workspace, "field-engine", "#!/bin/sh\nexit 1\n");
            const submit = async () =>
              submits.push(JSON.stringify(await submitTool(tools).execute("submit", {})));
            await submit();
            const first = resumeCampaignMemory(
              campaignDir,
              "matching",
              hashJsonValue("Build a slot binding harness."),
            );
            await submit();
            expect(gateCalls).toBe(1);
            expect(submits[1]).toContain("authoring-noop-submit");
            installTool(workspace, "field-engine", "#!/bin/sh\nexit 2\n");
            await submit();
            expect(gateCalls).toBe(2);
            expect(submits[2]).not.toContain("authoring-noop-submit");
            const changed = resumeCampaignMemory(
              campaignDir,
              "matching",
              hashJsonValue("Build a slot binding harness."),
            );
            expect(changed.lastBlockedCandidateId).not.toBe(first.lastBlockedCandidateId);
            expect(changed.lastBlockedCandidateStrikes).toBe(0);
            installTool(workspace, "field-engine", "#!/bin/sh\nexit 0\n");
            // SAFETY: the mounted gate registers this tool; only its execute hook is used.
            const check = tools.find(
              (tool) => (tool as { name?: string }).name === "correctness_check",
            ) as FixtureSubmitTool;
            const preview = await check.execute("check", {});
            expect(preview.content[0]).toMatchObject({
              type: "text",
              text: expect.stringContaining('"status":"clear"'),
            });
            await submit();
            return { status: "completed", assistantText: "submitted" };
          }),
      },
    );
    expect(outcome.buildAdmissible).toBe(true);
    expect(gateCalls).toBe(3);
  });

  it("replays persisted submit tool conditions across changed and repeated refusals", async () => {
    const campaignDir = scratchDir("ana-resumed-tool-condition-");
    const workspace = join(campaignDir, "workspace");
    const memories: ReturnType<typeof resumeCampaignMemory>[] = [];
    for (const exit of [1, 2, 2]) {
      await runBuilderCampaign(
        { campaignDir, slug: "matching", kickoff: "Build a harness.", expectedTasks: 4, maxTurns: 1 },
        {
          tools: [],
          toolsProbes: () => ({}),
          gates: async () => [
            {
              owner: "correctness-model",
              severity: "blocking",
              claim: "installed tool failed",
              evidence: "gate.json",
            },
          ],
          open: async (tools) =>
            scriptedSession(async () => {
              completeBundle(workspace);
              requireExternalVerifier(workspace);
              installTool(workspace, "field-engine", `#!/bin/sh\nexit ${exit}\n`);
              await submitTool(tools).execute("submit", {});
              return { status: "completed", assistantText: "submitted" };
            }),
        },
      );
      memories.push(resumeCampaignMemory(campaignDir, "matching", hashJsonValue("Build a harness.")));
    }
    expect(memories.every((memory) => memory.clause === null)).toBe(true);
    expect(memories.map((memory) => memory.lastBlockedCandidateStrikes)).toEqual([0, 0, 1]);
    expect(memories[0]?.lastBlockedCandidateId).not.toBe(memories[1]?.lastBlockedCandidateId);
    expect(memories[1]?.lastBlockedCandidateId).toBe(memories[2]?.lastBlockedCandidateId);
    const file = join(campaignDir, "03-matching", "iteration.json");
    const row = JSON.parse(readFileSync(file, "utf8"));
    // `undefined` drops the key: a completed record that states no condition is refused too.
    for (const invalid of [null, 0, "", undefined]) {
      writeFileSync(file, JSON.stringify({ ...row, submissionConditionId: invalid }));
      expect(resumeCampaignMemory(campaignDir, "matching", hashJsonValue("Build a harness.")).clause).toBe(
        "improvement-memory-missing",
      );
    }
    writeFileSync(file, JSON.stringify(row));
    expect(
      resumeCampaignMemory(campaignDir, "matching", hashJsonValue("Build a harness.")).clause,
    ).toBeNull();
  });

  it("re-measures when the installed tool moves between the check and the submit", async () => {
    // The hostile side of the reuse above. `snapshotId` covers the brief that names the tool and
    // stops there: `.toolchain` sits outside the fingerprint by construction, so the Builder can
    // check a tree, replace the executable that tool id resolves to, and submit the same bytes.
    // Reusing the rows would report a verifier that no longer exists. Not concurrent: it rewrites
    // an installed tool at a fixed path whose digest the recorded condition is read from.
    const campaignDir = scratchDir("ana-check-condition-moved-");
    const workspace = join(campaignDir, "workspace");
    const gateDirs: string[] = [];
    const open = async (tools: readonly PiTool[]) =>
      scriptedSession(async () => {
        completeBundle(workspace);
        requireExternalVerifier(workspace);
        installTool(workspace, "field-engine", "#!/bin/sh\nexit 0\n");
        // SAFETY: as above — the fixture reads only the registered tool's name and execute hook.
        const check = tools.find(
          (tool) => (tool as { name?: string }).name === "correctness_check",
        ) as FixtureSubmitTool;
        await check.execute("check-1", {});
        // The declaration is byte-identical; only what it resolves to moved, which is exactly the
        // change `snapshotId` cannot see.
        installTool(workspace, "field-engine", "#!/bin/sh\nexit 1\n");
        await submitTool(tools).execute("submit-1", {});
        return { status: "completed", assistantText: "submitted" };
      });
    const outcome = await runBuilderCampaign(
      {
        campaignDir,
        slug: "matching",
        kickoff: "Build a slot binding harness.",
        expectedTasks: 4,
        maxTurns: 2,
      },
      {
        open,
        tools: [],
        toolsProbes: () => ({ load: async () => [] }),
        gates: async (_harness, iterationDir) => {
          gateDirs.push(iterationDir);
          writeFileSync(join(iterationDir, "census.json"), "{}\n");
          return [];
        },
      },
    );
    expect(outcome.buildAdmissible).toBe(true);
    // Twice: once in the trial, once for the condition the run is actually measured under.
    expect(gateDirs).toHaveLength(2);
    expect(gateDirs[0]).toStartWith(join(campaignDir, "trials"));
    expect(gateDirs[1]).toBe(join(campaignDir, "01-matching"));
  });

  it.concurrent("keeps one session across a post-record gate refusal and admits only the clean resubmission", async () => {
    const campaignDir = scratchDir("ana-primary-builder-");
    const workspace = join(campaignDir, "workspace");
    let opened = 0;
    let turns = 0;
    const probeDirs: string[] = [];
    const gateDirs: string[] = [];
    const open = async (tools: readonly PiTool[]): Promise<HostSession> => {
      opened += 1;
      return scriptedSession(async () => {
        turns += 1;
        if (turns === 1) completeBundle(workspace);
        // The repair the gate asked for. It has to move the tree: the controller validates one
        // candidate tree once, so a resubmission of the same bytes reads the first verdict back
        // rather than sampling the gates again.
        else {
          const tasks = join(workspace, "correctness-model", "tasks.json");
          writeFileSync(tasks, `${readFileSync(tasks, "utf8").trim()}\n`);
        }
        const submit = submitTool(tools);
        await submit.execute(`submit-${turns}`, {});
        return { status: "completed", assistantText: "submitted" };
      });
    };
    let gateCalls = 0;
    const outcome = await runBuilderCampaign(
      {
        campaignDir,
        slug: "matching",
        kickoff: "Build a slot binding harness.",
        expectedTasks: 4,
        maxTurns: 3,
        admissionLineage: { digest: "packet-settled", reason: "agenda-consumed" },
      },
      {
        open,
        tools: [
          toolDouble({
            name: "read",
            async execute() {
              return { content: [{ type: "text", text: "unused" }] };
            },
          }),
        ],
        toolsProbes: (candidateDir) => {
          probeDirs.push(candidateDir);
          if (gateCalls === 1) writeFileSync(join(workspace, "agent/tools.ts"), "post-submit drift\n");
          return {
            load: async () => {
              expect(readFileSync(join(candidateDir, "agent/tools.ts"), "utf8")).not.toBe(
                "post-submit drift\n",
              );
              return [];
            },
          };
        },
        gates: async (_harness, _iterationDir, candidateDir) => {
          gateDirs.push(candidateDir);
          gateCalls += 1;
          return gateCalls === 1
            ? [
                {
                  owner: "tests",
                  severity: "blocking",
                  claim: "first gate refusal",
                  evidence: "test gate",
                  findings: [
                    { code: "test-gate", path: "correctness-model/tasks.json", detail: "repair once" },
                  ],
                },
              ]
            : [];
        },
      },
    );
    expect(opened).toBe(1);
    expect(turns).toBe(2);
    expect(gateCalls).toBe(2);
    expect(outcome.buildAdmissible).toBe(true);
    expect(outcome.iterations.map((row) => row.outcome)).toEqual(["gates-blocked", "fingerprinted"]);
    expect(outcome.iterations[0]?.admissionLineage).toEqual({
      digest: "packet-settled",
      reason: "agenda-consumed",
    });
    expect(outcome.iterations[1]?.admissionLineage).toBeUndefined();
    expect(outcome.iterations[1]?.diagnosisInput).toEqual({ kind: "in-campaign-carry", digest: null });
    if (outcome.buildAdmissible) {
      expect(probeDirs.at(-1)).toBe(outcome.acceptedSnapshot);
      expect(gateDirs.at(-1)).toBe(outcome.acceptedSnapshot);
    }
    expect(JSON.parse(readFileSync(join(campaignDir, "02-matching", "iteration.json"), "utf8"))).toEqual(
      expect.objectContaining({ outcome: "fingerprinted" }),
    );
  });
});
