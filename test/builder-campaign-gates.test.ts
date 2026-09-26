/**
 * One gate run per candidate condition, and what each run leaves behind.
 *
 * correctness_check and submit run the same sequence on the same immutable snapshot, so a
 * condition whose bytes and installed tools have not moved buys one validation, and a condition
 * that did move never inherits the earlier verdict. Every executed run keeps its own directory and
 * receipt, including the runs no iteration records. A check that names an installed tool resolves
 * it once: a tool the host cannot find is the Builder's to install, a tool that crashes is the
 * Builder's to repair, and a tool the host cannot read is the environment's.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { afterAll, describe, expect, it } from "bun:test";
import {
  FRESH_BUILD,
  blockingRow,
  bundleWithoutGuide,
  commitRoundEntry,
  completeBundle,
  installTool,
  namedTool,
  proposeExperiment,
  replyText,
  requireExternalVerifier,
  runOneTool,
  submitTool,
  submittingSession,
  toolHost,
} from "./helpers/builder-campaign.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import { MATCHING_ACCEPTS, MATCHING_REJECTS, padToCalibrationFloor } from "./helpers/matching-fixture.ts";
import { double, required, scriptedSession, toolDouble } from "./helpers/doubles.ts";
import { writeBoundRepresentation } from "./helpers/bound-representation.ts";
import { hashJsonValue } from "../src/meta/stable-json.ts";
import { controllerValidatedFinding } from "../src/correctness-bundle/brief.ts";
import { VerifierExecutionNonResult } from "../src/correctness-bundle/verifier-nonresult.ts";
import { createVerifierHost } from "../src/verify/host.ts";
import type { VerifierHostHandle } from "../src/verify/verifier-port.ts";
import { makeCensusGate } from "../src/run/census-gate.ts";
import { runBuilderCampaign } from "../src/run/builder-campaign.ts";
import type { BuilderCampaignDeps, BuilderCampaignInput } from "../src/run/builder-campaign.ts";
import { resumeCampaignMemory } from "../src/author/campaign-memory.ts";
import type { HostSession, PiTool } from "../src/backends/pi-session.ts";
import { readExecutionEvidence } from "../tools/outcome/builder-execution-facts.ts";

const loadCrash = {
  code: "generated-load-crash",
  path: "agent/tools.ts",
  detail: "worker exited before its handshake",
};
const BARE = { tools: [], toolsProbes: () => ({}) } satisfies Pick<
  BuilderCampaignDeps,
  "tools" | "toolsProbes"
>;
const KICKOFF_HASH = hashJsonValue(FRESH_BUILD.kickoff);
const check = (tools: readonly PiTool[]) => namedTool(tools, "correctness_check");

afterAll(cleanupScratch);

/** Runs `body` while collecting safeguard 33's operator lines; every other stderr line passes through. */
async function safeguard33<T>(body: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const lines: string[] = [];
  const original = console.error;
  console.error = (message?: string) => {
    const line = String(message);
    if (line.includes("33-preview-clear-submit-refused")) lines.push(line);
    else original(line);
  };
  try {
    return { result: await body(), lines };
  } finally {
    console.error = original;
  }
}

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
        const first = change === "submit-first" ? submitTool(tools) : check(tools);
        const second = change === "submit-first" ? check(tools) : submitTool(tools);
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
      { campaignDir, ...FRESH_BUILD, maxTurns: change === "preview-blocks" ? 1 : 2 },
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
              blockingRow(
                change === "host-recovers" ? "environment" : "correctness-model/evaluator.ts",
                "preview refused",
              ),
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

  it("re-measures when the installed tool moves between a completed check and the submit", async () => {
    // `.toolchain` sits outside the fingerprint by construction, so the declaration stays
    // byte-identical while what it resolves to moves; reusing the rows would report a verifier that
    // no longer exists. Not concurrent: it rewrites an installed tool at a fixed path.
    const campaignDir = scratchDir("ana-check-condition-moved-");
    const workspace = join(campaignDir, "workspace");
    const gateDirs: string[] = [];
    const outcome = await runBuilderCampaign(
      { campaignDir, ...FRESH_BUILD, maxTurns: 2 },
      {
        tools: [],
        toolsProbes: () => ({ load: async () => [] }),
        gates: async (_harness, iterationDir) => {
          gateDirs.push(iterationDir);
          writeFileSync(join(iterationDir, "census.json"), "{}\n");
          return [];
        },
        open: async (tools) =>
          scriptedSession(async () => {
            completeBundle(workspace);
            requireExternalVerifier(workspace);
            installTool(workspace, "field-engine", "#!/bin/sh\nexit 0\n");
            await check(tools).execute("check-1", {});
            installTool(workspace, "field-engine", "#!/bin/sh\nexit 1\n");
            await submitTool(tools).execute("submit-1", {});
            return { status: "completed", assistantText: "submitted" };
          }),
      },
    );
    expect(outcome.buildAdmissible).toBe(true);
    expect(gateDirs).toHaveLength(2);
    expect(gateDirs[0]).toStartWith(join(campaignDir, "trials"));
    expect(gateDirs[1]).toBe(join(campaignDir, "01-matching"));
  });

  it("reuses only the refused installed-tool condition and accepts its clear repaired preview", async () => {
    const campaignDir = scratchDir("ana-refused-tool-condition-");
    const workspace = join(campaignDir, "workspace");
    const submits: string[] = [];
    let gateCalls = 0;
    const outcome = await runBuilderCampaign(
      { campaignDir, ...FRESH_BUILD, maxTurns: 6 },
      {
        ...BARE,
        gates: async () => {
          gateCalls += 1;
          return readFileSync(join(workspace, ".toolchain/bin/field-engine"), "utf8").includes("exit 0")
            ? []
            : [blockingRow("correctness-model/evaluator.ts", "installed tool failed")];
        },
        open: async (tools) =>
          scriptedSession(async () => {
            completeBundle(workspace);
            requireExternalVerifier(workspace);
            installTool(workspace, "field-engine", "#!/bin/sh\nexit 1\n");
            const submit = async () => submits.push(await replyText(submitTool(tools), "submit"));
            await submit();
            const first = resumeCampaignMemory(campaignDir, "matching", KICKOFF_HASH);
            await submit();
            expect(gateCalls).toBe(1);
            expect(submits[1]).toContain("authoring-noop-submit");
            installTool(workspace, "field-engine", "#!/bin/sh\nexit 2\n");
            await submit();
            expect(gateCalls).toBe(2);
            expect(submits[2]).not.toContain("authoring-noop-submit");
            const changed = resumeCampaignMemory(campaignDir, "matching", KICKOFF_HASH);
            expect(changed.lastBlockedCandidateId).not.toBe(first.lastBlockedCandidateId);
            expect(changed.lastBlockedCandidateStrikes).toBe(0);
            installTool(workspace, "field-engine", "#!/bin/sh\nexit 0\n");
            expect(await replyText(check(tools), "check")).toContain('"status":"clear"');
            await submit();
            return { status: "completed", assistantText: "submitted" };
          }),
      },
    );
    expect(outcome.buildAdmissible).toBe(true);
    expect(gateCalls).toBe(3);
  });

  it("replays persisted submit tool conditions and refuses a record that states none", async () => {
    const campaignDir = scratchDir("ana-resumed-tool-condition-");
    const workspace = join(campaignDir, "workspace");
    const memories: ReturnType<typeof resumeCampaignMemory>[] = [];
    for (const exit of [1, 2, 2]) {
      const session = submittingSession(() => {
        completeBundle(workspace);
        requireExternalVerifier(workspace);
        installTool(workspace, "field-engine", `#!/bin/sh\nexit ${exit}\n`);
      });
      await runBuilderCampaign(
        { campaignDir, ...FRESH_BUILD, maxTurns: 1 },
        {
          ...BARE,
          gates: async () => [blockingRow("correctness-model/evaluator.ts", "installed tool failed")],
          open: session.open,
        },
      );
      memories.push(resumeCampaignMemory(campaignDir, "matching", KICKOFF_HASH));
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
      expect(resumeCampaignMemory(campaignDir, "matching", KICKOFF_HASH).clause).toBe(
        "improvement-memory-missing",
      );
    }
    writeFileSync(file, JSON.stringify(row));
    expect(resumeCampaignMemory(campaignDir, "matching", KICKOFF_HASH).clause).toBeNull();
  });

  it("publishes submit's run before its first await, so a preview started meanwhile joins it", async () => {
    const campaignDir = scratchDir("ana-submit-publishes-");
    const workspace = join(campaignDir, "workspace");
    let probeLoads = 0;
    const loading = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    await runBuilderCampaign(
      { campaignDir, ...FRESH_BUILD, maxTurns: 2 },
      {
        tools: [],
        toolsProbes: () => ({
          load: async () => {
            probeLoads += 1;
            loading.resolve();
            await release.promise;
            return [
              {
                code: "generated-toolset-termination",
                path: "agent/tools.ts",
                detail: "the worker did not settle",
              },
            ];
          },
        }),
        gates: async () => {
          throw new Error("a runtime non-result must not reach the gates");
        },
        open: async (tools) =>
          scriptedSession(async () => {
            completeBundle(workspace);
            const submitting = submitTool(tools).execute("submit-1", {});
            const joining = check(tools).execute("check-1", {});
            await loading.promise;
            release.resolve();
            await Promise.all([submitting, joining]);
            expect(probeLoads).toBe(1);
            await replyText(check(tools), "check-2");
            expect(probeLoads).toBe(2);
            await submitTool(tools).execute("submit-2", {});
            expect(probeLoads).toBe(3);
            return { status: "completed", assistantText: "submitted" };
          }),
      },
    );
  });

  it.concurrent("keeps one session across a post-record gate refusal and admits only the clean resubmission", async () => {
    const campaignDir = scratchDir("ana-primary-builder-");
    const workspace = join(campaignDir, "workspace");
    let opened = 0;
    const probeDirs: string[] = [];
    const gateDirs: string[] = [];
    let gateCalls = 0;
    const session = submittingSession((turn) => {
      if (turn === 1) return completeBundle(workspace);
      // The repair has to move the tree: a resubmission of the same bytes reads the first verdict back.
      const tasks = join(workspace, "correctness-model", "tasks.json");
      writeFileSync(tasks, `${readFileSync(tasks, "utf8").trim()}\n`);
    });
    const outcome = await runBuilderCampaign(
      {
        campaignDir,
        ...FRESH_BUILD,
        maxTurns: 3,
        admissionLineage: { digest: "packet-settled" },
      },
      {
        open: async (tools): Promise<HostSession> => {
          opened += 1;
          return session.open(tools);
        },
        tools: [
          toolDouble({
            name: "read",
            execute: async () => ({ content: [{ type: "text", text: "unused" }] }),
          }),
        ],
        toolsProbes: (candidateDir) => {
          probeDirs.push(candidateDir);
          if (gateCalls === 1) writeFileSync(join(workspace, "agent/tools.ts"), "post-submit drift\n");
          return {
            load: async () => {
              // The probe reads the frozen snapshot, never the live tree drifting after submit.
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
                  ...blockingRow("correctness-model/tasks.json", "first gate refusal", "test gate"),
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
    expect(session.replies).toHaveLength(2);
    expect(gateCalls).toBe(2);
    expect(outcome.buildAdmissible).toBe(true);
    expect(outcome.iterations.map((row) => row.outcome)).toEqual(["gates-blocked", "fingerprinted"]);
    expect(outcome.iterations[0]?.admissionLineage).toEqual({ digest: "packet-settled" });
    expect(outcome.iterations[1]?.admissionLineage).toBeUndefined();
    expect(outcome.iterations[1]?.diagnosisInput).toEqual({ kind: "in-campaign-carry", digest: null });
    if (outcome.buildAdmissible) {
      expect(probeDirs.at(-1)).toBe(outcome.acceptedSnapshot);
      expect(gateDirs.at(-1)).toBe(outcome.acceptedSnapshot);
    }
  });
});

describe("the receipts a gate run records", () => {
  it("names a refused submit of bytes whose correctness_check was clear, with the stage and code only", async () => {
    const campaignDir = scratchDir("ana-check-then-refused-");
    const workspace = join(campaignDir, "workspace");
    let probeLoads = 0;
    const { result: outcome, lines } = await safeguard33(() =>
      runBuilderCampaign(
        { campaignDir, ...FRESH_BUILD, maxTurns: 1 },
        {
          tools: [],
          toolsProbes: () => ({
            load: async () => {
              probeLoads += 1;
              return probeLoads === 1 ? [] : [loadCrash];
            },
          }),
          gates: async (_harness, iterationDir) => {
            writeFileSync(join(iterationDir, "census.json"), "{}\n");
            return [];
          },
          open: async (tools) =>
            scriptedSession(async () => {
              completeBundle(workspace);
              await check(tools).execute("check-1", {});
              await submitTool(tools).execute("submit-1", {});
              return { status: "completed", assistantText: "submitted" };
            }),
        },
      ),
    );
    expect(outcome.buildAdmissible).toBe(false);
    expect(probeLoads).toBe(2);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("correctness_check was clear under condition");
    expect(lines[0]).toContain("submit refused at stage");
    expect(lines[0]).toContain("with generated-load-crash");
    expect(lines[0]).not.toContain("handshake");
    // The submit's own receipt names the refusal's codes, as a correctness_check receipt does; a
    // clear check names none.
    const calls = readExecutionEvidence(campaignDir)[0]?.customCalls ?? [];
    const semantic = (tool: string) => calls.find((call) => call.tool === tool)?.semantic;
    expect(semantic("submit")).toMatchObject({
      outcome: "refused",
      findingCodes: ["generated-load-crash", "submit-bound"],
    });
    expect(semantic("correctness_check")).toMatchObject({ outcome: "clear" });
    expect(semantic("correctness_check")).not.toHaveProperty("findingCodes");
  });

  it("runs the gates beside an admission refusal without writing an iteration or a parity safeguard", async () => {
    // Check and submit report the same admission refusal, so a clear gate run followed by an
    // admission-only refusal is agreement between the two paths, not safeguard 33's divergence.
    const campaignDir = scratchDir("ana-admission-gated-");
    const workspace = join(campaignDir, "workspace");
    commitRoundEntry(workspace);
    const adoptedDir = join(campaignDir, "adopted");
    cpSync(workspace, adoptedDir, { recursive: true, filter: (path) => !path.includes("/.git") });
    writeBoundRepresentation(
      adoptedDir,
      undefined,
      readFileSync(join(adoptedDir, "agent/tools-spec.json"), "utf8"),
    );
    const texts: string[] = [];
    const gateDirs: string[] = [];
    const { result: outcome, lines } = await safeguard33(() =>
      runBuilderCampaign(
        { campaignDir, ...FRESH_BUILD, maxTurns: 1, experiment: "build", adoptedDir },
        {
          ...BARE,
          gates: async (_harness, iterationDir) => {
            gateDirs.push(iterationDir);
            return [];
          },
          open: async (tools) =>
            scriptedSession(async () => {
              writeFileSync(join(workspace, "EXPERIMENT.json"), "{}");
              texts.push(
                await replyText(check(tools), "check"),
                await replyText(submitTool(tools), "submit"),
              );
              return { status: "completed", assistantText: "submitted" };
            }),
        },
      ),
    );
    for (const text of texts) expect(text).toContain("experiment-plan-schema");
    expect(outcome.buildAdmissible).toBe(false);
    expect(outcome.iterations).toEqual([]);
    expect(gateDirs).toHaveLength(1);
    expect(gateDirs[0]).toContain(join(campaignDir, "trials"));
    expect(lines).toEqual([]);
  });

  it.concurrent("returns the refusal submit gives, with receipts for the work that ran, before either spends the census", async () => {
    // Two shapes of one parity: an unknown check identity, which the bundle stage settles alone,
    // and a malformed proposal beside a broken bundle, which used to be returned alone with the
    // bundle receipt marked passed although the file contract never ran.
    const run = async (author: (workspace: string) => void, adopted: boolean) => {
      const campaignDir = scratchDir("ana-check-parity-");
      const workspace = join(campaignDir, "workspace");
      const adoptedDir = join(campaignDir, "adopted");
      if (adopted) {
        commitRoundEntry(workspace);
        completeBundle(adoptedDir);
      }
      const texts: string[] = [];
      const input: BuilderCampaignInput = { campaignDir, ...FRESH_BUILD, maxTurns: 1 };
      if (adopted) {
        input.experiment = "build";
        input.adoptedDir = adoptedDir;
      }
      const outcome = await runBuilderCampaign(input, {
        ...BARE,
        gates: async () => {
          throw new Error("the census gate must not run past a bundle refusal");
        },
        open: async (tools) =>
          scriptedSession(async () => {
            author(workspace);
            texts.push(await replyText(check(tools), "check"), await replyText(submitTool(tools), "submit"));
            return { status: "completed", assistantText: "submitted" };
          }),
      });
      expect(outcome.buildAdmissible).toBe(false);
      return { texts, preview: JSON.parse(required(texts[0], "check text")) };
    };

    const unknown = await run((workspace) => {
      completeBundle(workspace);
      const cascading = MATCHING_REJECTS.map((reject) =>
        reject.id === "r-wrongbind" ? { ...reject, expectedCheckId: "missing-check" } : reject,
      );
      writeFileSync(
        join(workspace, "correctness-model/controls.json"),
        JSON.stringify({
          accept: padToCalibrationFloor("accept", MATCHING_ACCEPTS),
          reject: padToCalibrationFloor("reject", cascading),
        }),
      );
    }, false);
    for (const text of unknown.texts) {
      for (const expected of ["controls-reject-unknown-check", "r-wrongbind", "missing-check"]) {
        expect(text).toContain(expected);
      }
    }
    expect(unknown.preview).toMatchObject({
      status: "findings",
      stage: "bundle",
      notReached: ["validation", "conformance", "gates"],
    });

    const malformed = await run((workspace) => {
      bundleWithoutGuide(workspace);
      writeFileSync(join(workspace, "EXPERIMENT.json"), "{");
    }, true);
    for (const text of malformed.texts) {
      expect(text).toContain("experiment-proposal-read");
      expect(text).toContain("BUILT_AGENTS.md");
    }
    expect(malformed.preview).toMatchObject({
      status: "findings",
      stage: "bundle",
      notReached: ["conformance", "gates"],
    });
    expect(malformed.preview.stages.map((receipt: { status: string }) => receipt.status)).toEqual([
      "refused",
      "refused",
      "not-run",
      "not-run",
    ]);
  });

  it("returns a remembered gate refusal under the commit and proposal of the submit that asked", async () => {
    const campaignDir = scratchDir("ana-remembered-commit-");
    const workspace = join(campaignDir, "workspace");
    commitRoundEntry(workspace);
    const adoptedDir = join(campaignDir, "adopted");
    cpSync(join(workspace, "agent"), join(adoptedDir, "agent"), { recursive: true });
    cpSync(join(workspace, "correctness-model"), join(adoptedDir, "correctness-model"), { recursive: true });
    const proposals: ReturnType<typeof proposeExperiment>[] = [];
    let gateCalls = 0;
    await runBuilderCampaign(
      { campaignDir, ...FRESH_BUILD, maxTurns: 2, experiment: "build", adoptedDir },
      {
        ...BARE,
        gates: async () => {
          gateCalls += 1;
          const finding = {
            code: "DISCRIMINATION_REJECT_PASSED",
            path: "correctness-model/controls.json",
            detail: "a reject passed",
          };
          return [
            {
              ...blockingRow("correctness-model/evaluator.ts", "a reject passed", "census.json"),
              findings: [controllerValidatedFinding(finding)],
            },
          ];
        },
        open: async (tools) =>
          scriptedSession(async () => {
            const file = join(workspace, "correctness-model/controls.json");
            writeFileSync(file, `${readFileSync(file, "utf8")}\n`);
            for (const gap of ["First public gap.", "Second public gap."]) {
              proposals.push(proposeExperiment(workspace, "product", gap));
              await submitTool(tools).execute(gap, {});
            }
            return { status: "completed", assistantText: "submitted" };
          }),
      },
    );
    expect(gateCalls).toBe(1);
    const submits = readExecutionEvidence(campaignDir)[0]?.submits ?? [];
    expect(submits.map((row) => row.experimentProposal)).toEqual(proposals);
    expect(submits[1]?.commit).not.toBe(submits[0]?.commit);
    expect(submits[1]?.commit).toBe(
      Bun.spawnSync(["git", "-C", workspace, "rev-parse", "HEAD"]).stdout.toString().trim(),
    );
    expect(submits[1]?.findingCodes.slice(0, 2)).toEqual([
      "DISCRIMINATION_REJECT_PASSED",
      "authoring-noop-submit",
    ]);
  });

  it("keeps each executed gate run in its own directory: full preview, census-only submit, remembered preview", async () => {
    const campaignDir = scratchDir("ana-run-dirs-");
    const workspace = join(campaignDir, "workspace");
    let probeLoads = 0;
    const gateDirs: string[] = [];
    const texts: string[] = [];
    await runBuilderCampaign(
      { campaignDir, ...FRESH_BUILD, maxTurns: 2 },
      {
        tools: [],
        toolsProbes: () => ({
          load: async () => {
            probeLoads += 1;
            return probeLoads === 1 ? [] : [loadCrash];
          },
        }),
        gates: async (_harness, dir, _tree, _stages, scope) => {
          gateDirs.push(dir);
          const findings = scope?.referenceSolve === true ? [] : [{ census: "only" }];
          writeFileSync(join(dir, "census.json"), JSON.stringify({ findings }));
          return [];
        },
        open: async (tools) =>
          scriptedSession(async () => {
            completeBundle(workspace);
            texts.push(
              await replyText(check(tools), "check-1"),
              await replyText(submitTool(tools), "submit"),
              await replyText(check(tools), "check-2"),
            );
            return { status: "completed", assistantText: "submitted" };
          }),
      },
    );
    expect(gateDirs.map((dir) => dir.split("/").pop())).toEqual(["full-1", "census-1"]);
    expect(new Set(gateDirs.map((dir) => dir.split("/").slice(0, -1).join("/"))).size).toBe(1);
    expect(texts[1]).toContain("refused at conformance");
    expect(JSON.parse(required(texts[2], "second check"))).toMatchObject({
      status: "clear",
      repeated: expect.any(String),
      coverage: { censusFindings: 0 },
    });
    expect(JSON.parse(readFileSync(join(required(gateDirs[0], "full run"), "census.json"), "utf8"))).toEqual({
      findings: [],
    });
  });
});

describe("a check that names an installed tool", () => {
  it.concurrent("refuses a tool installed nowhere with install guidance the next turn can act on", async () => {
    // The first refusal is the recovery surface: the guidance must survive the wall projection
    // instead of laundering to the generic unclassified label. The script already knows the tool;
    // this proves the words reach the consumer, not that a model would act on them.
    const campaignDir = scratchDir("ana-tool-missing-e2e-");
    const workspace = join(campaignDir, "workspace");
    const session = submittingSession(() => {
      completeBundle(workspace);
      requireExternalVerifier(workspace);
      if ((session.replies.at(-1) ?? "").includes(".toolchain (any bin directory)")) {
        installTool(workspace, "field-engine");
      }
    });
    const outcome = await runBuilderCampaign(
      { campaignDir, ...FRESH_BUILD, maxTurns: 3 },
      { ...BARE, open: session.open },
    );
    const [refusal] = session.replies;
    for (const expected of [
      "tool-missing",
      "field-engine",
      "install the public tool under .toolchain or on the host PATH",
      "correctness-model/brief.json",
      "resolves to no executable under",
      ".toolchain (any bin directory)",
    ]) {
      expect(refusal).toContain(expected);
    }
    expect(refusal).not.toContain("generated-execution-unclassified");
    expect(session.replies).toHaveLength(2);
    expect(outcome).toMatchObject({ buildAdmissible: true });
  });

  it.concurrent("accepts a candidate whose named tool is installed, freezes it once, and records a fresh build's plan without opening its scope", async () => {
    const campaignDir = scratchDir("ana-primary-provenance-declaration-");
    const workspace = join(campaignDir, "workspace");
    const replies: string[] = [];
    const outcome = await runBuilderCampaign(
      { campaignDir, ...FRESH_BUILD, maxTurns: 1 },
      {
        ...BARE,
        open: async (tools) =>
          scriptedSession(async () => {
            completeBundle(workspace);
            // A fresh build's plan is recorded and scored, but cannot open an adopted or fixed scope.
            proposeExperiment(workspace, "tasks");
            requireExternalVerifier(workspace);
            installTool(workspace, "field-engine");
            replies.push(
              await replyText(submitTool(tools), "submit-1"),
              await replyText(submitTool(tools), "submit-2"),
            );
            return { status: "completed", assistantText: "submitted" };
          }),
      },
    );
    expect(replies[0]).toContain("Accepted");
    expect(replies[1]).toContain("Nothing was submitted a second time");
    expect(outcome.experimentProposal?.scope).toBe("tasks");
    expect(outcome).not.toHaveProperty("experimentScope");
  });

  it.concurrent("keeps the bundle's own findings beside the missing-tool finding", async () => {
    // Substituting one reason for the other leaves the second defect unnamed, so it never gets
    // repaired. The battery holds 4 tasks and the ask states 5, so the count refuses in the same submit.
    const campaignDir = scratchDir("ana-tool-missing-beside-bundle-");
    const workspace = join(campaignDir, "workspace");
    let opening = "";
    let reply = "";
    const outcome = await runBuilderCampaign(
      { campaignDir, ...FRESH_BUILD, expectedTasks: 5, maxTurns: 1 },
      {
        ...BARE,
        open: async (tools) =>
          scriptedSession(async ({ prompt }) => {
            opening = prompt;
            completeBundle(workspace);
            requireExternalVerifier(workspace);
            reply = await replyText(submitTool(tools), "submit");
            return { status: "completed", assistantText: "submitted" };
          }),
      },
    );
    expect(outcome).toMatchObject({ buildAdmissible: false, clause: "iterations-exhausted" });
    expect(opening).toContain("Task count: exactly 5 tasks.");
    for (const expected of ["tool-missing", "tasks-exact-census", "requires exactly 5 tasks; found 4"]) {
      expect(reply).toContain(expected);
    }
  });

  it.concurrent("refuses an adapterId that is not a command name, and takes the corrected one", async () => {
    // "Install it" is the wrong repair for a path the host would never look up.
    const campaignDir = scratchDir("ana-primary-engine-adapter-missing-");
    const workspace = join(campaignDir, "workspace");
    const session = submittingSession((turn) => {
      completeBundle(workspace);
      requireExternalVerifier(workspace, turn === 1 ? "../field-engine" : "field-engine");
      installTool(workspace, "field-engine");
    });
    const outcome = await runBuilderCampaign(
      { campaignDir, ...FRESH_BUILD, maxTurns: 2 },
      { ...BARE, open: session.open },
    );
    const [first] = session.replies;
    expect(first).toContain("tool-id-invalid");
    expect(first).toContain("../field-engine");
    expect(first).toContain("is not a command name");
    expect(first).not.toContain("tool-missing");
    expect(session.replies).toHaveLength(2);
    expect(outcome).toMatchObject({ buildAdmissible: true });
  });

  /** A campaign whose census gate reaches one real host run of `verifier` and throws its evidence. */
  async function censusThrough(campaignDir: string, verifier: VerifierHostHandle) {
    mkdirSync(join(campaignDir, "node_modules"), { recursive: true });
    symlinkSync(join(import.meta.dir, "../node_modules/@ana"), join(campaignDir, "node_modules", "@ana"));
    const gate = makeCensusGate({
      probeControls: async () => {
        throw new VerifierExecutionNonResult(await runOneTool(verifier));
      },
      expectedTasks: 4,
    });
    const session = submittingSession(() => completeBundle(join(campaignDir, "workspace")));
    const outcome = await runBuilderCampaign(
      { campaignDir, ...FRESH_BUILD, maxTurns: 2 },
      {
        ...BARE,
        gates: async (harness, iterationDir, slugDir) => {
          harness.conformance = double({ schema: "test-conformance/v1", verdict: "pass" });
          return gate(harness, iterationDir, slugDir);
        },
        open: session.open,
      },
    );
    const iteration = JSON.parse(readFileSync(join(campaignDir, "01-matching", "iteration.json"), "utf8"));
    return { outcome, turns: session.replies.length, iteration };
  }

  it.concurrent("continues the round when the tool it named crashed, and tells the author only its own identities", async () => {
    // A real installed tool that dies on a signal, so the host's own row decides `crash`, which is
    // the author's to repair: the campaign keeps working until it runs out of turns.
    const campaignDir = scratchDir("ana-primary-census-candidate-");
    const verifier = toolHost(campaignDir, "#!/bin/sh\nkill -9 $$\n");
    const { outcome, turns, iteration } = await censusThrough(campaignDir, verifier);
    expect(outcome).toMatchObject({ buildAdmissible: false, clause: "iterations-exhausted" });
    expect(turns).toBe(2);
    expect(iteration.feedback).toEqual([
      expect.objectContaining({
        owner: "correctness-model/evaluator.ts",
        claim: 'control census: runs of tool "fwcheck" reached no completed run',
      }),
    ]);
    const { detail } = iteration.feedback[0].findings[0];
    expect(detail).toContain('Tool "fwcheck"');
    expect(detail).toContain('check "parts-assigned"');
    expect(detail).not.toContain(verifier.evidence()[0]?.nonResultReason);
  });

  it.concurrent("ends the campaign on the environment when the host cannot read the tool at all", async () => {
    // No evaluator edit repairs an unreadable executable, so a host outage buys no second turn.
    const campaignDir = scratchDir("ana-primary-census-unavailable-");
    const verifier = createVerifierHost({
      inventory: {
        fwcheck: {
          id: "fwcheck",
          path: join(campaignDir, "absent-tool"),
          digest: "0".repeat(64),
          source: "host",
          kind: "binary",
          interpreter: null,
        },
      },
    });
    const { outcome, turns, iteration } = await censusThrough(campaignDir, verifier);
    expect(outcome).toMatchObject({ buildAdmissible: false, clause: "environment-blocked" });
    expect(turns).toBe(1);
    expect(iteration.focusOwner).toBe("environment");
    expect(iteration.feedback).toEqual([
      expect.objectContaining({ owner: "environment", severity: "blocking" }),
    ]);
    expect(iteration.feedback[0].findings).toEqual([
      expect.objectContaining({ code: "tool-unavailable", path: "environment" }),
    ]);
  });
});
