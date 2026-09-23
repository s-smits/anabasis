/**
 * A candidate whose checks name an installed tool.
 *
 * `toolId` resolves once, under the candidate's own .toolchain and then the host PATH. A tool the
 * host cannot find is the Builder's to install, a tool the host cannot read is the environment's,
 * and the difference decides whether the session stays open.
 */
import { mkdirSync, readFileSync, rmSync, symlinkSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { afterAll, describe, expect, it } from "bun:test";
import {
  bundleWithoutGuide,
  completeBundle,
  installTool,
  proposeExperiment,
  requireExternalVerifier,
  runOneTool,
  submitTool,
  toolHost,
} from "./helpers/builder-campaign.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import { double, scriptedSession } from "./helpers/doubles.ts";
import { createVerifierHost } from "../src/verify/host.ts";
import { makeCensusGate } from "../src/run/census-gate.ts";
import { runBuilderCampaign } from "../src/run/builder-campaign.ts";
import { VerifierExecutionNonResult } from "../src/truth/verifier-nonresult.ts";
import { readExecutionEvidence } from "../tools/outcome/builder-execution-facts.ts";

/** The campaign every case in this file opens; what each one changes is the tool contract. */
const OPENING = { slug: "matching", kickoff: "Build a harness.", expectedTasks: 4, maxTurns: 2 };

afterAll(cleanupScratch);

describe("a declared external tool", () => {
  // An external check whose tool is installed nowhere the host looks cannot be measured: refusing
  // costs one resubmit, while accepting would spend the whole census before every run of that tool
  // settled as a non-result, which reads as the domain being ungradable.
  it.concurrent("refuses a candidate whose external check names a tool that is installed nowhere", async () => {
    const campaignDir = scratchDir("ana-primary-verifier-required-");
    const workspace = join(campaignDir, "workspace");
    let submitOutput = "";
    const outcome = await runBuilderCampaign(
      { campaignDir, slug: "matching", kickoff: "Build a harness.", expectedTasks: 4, maxTurns: 1 },
      {
        tools: [],
        toolsProbes: () => ({}),
        open: async (tools) =>
          scriptedSession(async () => {
            completeBundle(workspace);
            requireExternalVerifier(workspace);
            const submit = submitTool(tools);
            submitOutput = JSON.stringify(await submit.execute("submit", {}));
            return { status: "completed", assistantText: "submitted" };
          }),
      },
    );
    expect(outcome.buildAdmissible).toBe(false);
    expect(submitOutput).toContain("tool-missing");
    expect(submitOutput).toContain("field-engine");
    expect(submitOutput).toContain("install the public tool under .toolchain or on the host PATH");
  });

  // The first refusal is the recovery surface: the Builder re-grounds from its text, so the
  // install guidance must survive the wall projection instead of laundering to the generic
  // unclassified label (a wall projects a finding exactly once).
  it.concurrent("delivers the tool-install guidance in the first verifier-required refusal", async () => {
    const campaignDir = scratchDir("ana-primary-verifier-required-guidance-");
    const workspace = join(campaignDir, "workspace");
    let submitOutput = "";
    await runBuilderCampaign(
      { campaignDir, slug: "matching", kickoff: "Build a harness.", expectedTasks: 4, maxTurns: 1 },
      {
        tools: [],
        toolsProbes: () => ({}),
        open: async (tools) =>
          scriptedSession(async () => {
            completeBundle(workspace);
            requireExternalVerifier(workspace);
            const submit = submitTool(tools);
            submitOutput = JSON.stringify(await submit.execute("submit", {}));
            return { status: "completed", assistantText: "submitted" };
          }),
      },
    );
    expect(submitOutput).toContain("correctness-model/brief.json");
    expect(submitOutput).toContain("resolves to no executable under");
    expect(submitOutput).toContain("field-engine");
    expect(submitOutput).not.toContain("generated-execution-unclassified");
  });

  // An installed tool is ordinary Builder work: the candidate that names it is accepted like any
  // other bundle, and what the run may claim from it is decided later by the discrimination
  // evidence, not by a sentence in the acceptance.
  it.concurrent("accepts a candidate whose named tool is installed, and freezes it once", async () => {
    const campaignDir = scratchDir("ana-primary-provenance-declaration-");
    const workspace = join(campaignDir, "workspace");
    const submitOutputs: string[] = [];
    const outcome = await runBuilderCampaign(
      { campaignDir, slug: "matching", kickoff: "Build a harness.", expectedTasks: 4, maxTurns: 1 },
      {
        tools: [],
        toolsProbes: () => ({}),
        open: async (tools) =>
          scriptedSession(async () => {
            completeBundle(workspace);
            proposeExperiment(workspace, "tasks"); // A stale draft cannot open an adopted/fixed scope on a fresh build.
            requireExternalVerifier(workspace);
            installTool(workspace, "field-engine");
            const submit = submitTool(tools);
            submitOutputs.push(JSON.stringify(await submit.execute("submit", {})));
            submitOutputs.push(JSON.stringify(await submit.execute("submit", {})));
            return { status: "completed", assistantText: "submitted" };
          }),
      },
    );
    expect(submitOutputs[0]).toContain("Accepted");
    expect(submitOutputs[1]).toContain("Nothing was submitted a second time");
    expect(outcome.experimentProposal).toBeUndefined();
    expect(readExecutionEvidence(campaignDir)[0]?.submits[0]?.experimentProposal).toBeUndefined();
  });

  // Both reasons ship. Substituting the missing-tool finding for the bundle's own findings leaves
  // neither the Builder nor the evidence naming the second defect, so it never gets repaired. A
  // tree that fails the record stays a repairable defect: the campaign runs out of turns instead of
  // settling verifier-required on a bundle the gate never actually reached.
  it.concurrent("keeps the bundle findings beside the missing-tool finding", async () => {
    const campaignDir = scratchDir("ana-primary-verifier-required-census-");
    const workspace = join(campaignDir, "workspace");
    let submitOutput = "";
    let opening = "";
    const outcome = await runBuilderCampaign(
      // The battery holds 4 tasks; the ask states 5, so the count refuses in the same submit.
      { campaignDir, slug: "matching", kickoff: "Build a harness.", expectedTasks: 5, maxTurns: 1 },
      {
        tools: [],
        toolsProbes: () => ({}),
        open: async (tools) =>
          scriptedSession(async ({ prompt }) => {
            opening = prompt;
            completeBundle(workspace);
            requireExternalVerifier(workspace);
            const submit = submitTool(tools);
            submitOutput = JSON.stringify(await submit.execute("submit", {}));
            return { status: "completed", assistantText: "submitted" };
          }),
      },
    );
    expect(outcome).toMatchObject({ buildAdmissible: false, clauses: ["iterations-exhausted"] });
    expect(opening).toContain("Task count: exactly 5 tasks.");
    expect(submitOutput).toContain("tool-missing");
    expect(submitOutput).toContain("tasks-exact-census");
    expect(submitOutput).toContain("requires exactly 5 tasks; found 4");
  });

  // Installing the tool is an ordinary authoring repair: the same session receives the refusal,
  // installs what its brief names, and submits again.
  it.concurrent("keeps the session open so the Builder can install the tool it named", async () => {
    const campaignDir = scratchDir("ana-primary-verifier-required-reground-");
    const workspace = join(campaignDir, "workspace");
    let turns = 0;
    const outcome = await runBuilderCampaign(
      { campaignDir, ...OPENING },
      {
        tools: [],
        toolsProbes: () => ({}),
        open: async (tools) =>
          scriptedSession(async () => {
            turns += 1;
            completeBundle(workspace);
            requireExternalVerifier(workspace);
            if (turns === 2) installTool(workspace, "field-engine");
            const submit = submitTool(tools);
            await submit.execute("submit", {});
            return { status: "completed", assistantText: "submitted" };
          }),
      },
    );
    expect(turns).toBe(2);
    expect(outcome).toMatchObject({ buildAdmissible: true });
  });

  // The second half of the tool verdict: an adapterId that is not a bare command name resolves
  // nowhere by construction. It earns its own finding, because "install it" is the wrong repair
  // for a path the host would never look up.
  it.concurrent("refuses an adapterId that is not a command name, and takes the corrected one", async () => {
    const campaignDir = scratchDir("ana-primary-engine-adapter-missing-");
    const workspace = join(campaignDir, "workspace");
    let turns = 0;
    let firstSubmit = "";
    const outcome = await runBuilderCampaign(
      { campaignDir, ...OPENING },
      {
        tools: [],
        toolsProbes: () => ({}),
        open: async (tools) =>
          scriptedSession(async () => {
            turns += 1;
            completeBundle(workspace);
            // Turn 1 grounds on a path; turn 2 names the installed command itself.
            requireExternalVerifier(workspace, turns === 1 ? "../field-engine" : "field-engine");
            installTool(workspace, "field-engine");
            const submit = submitTool(tools);
            const output = JSON.stringify(await submit.execute("submit", {}));
            if (turns === 1) firstSubmit = output;
            return { status: "completed", assistantText: "submitted" };
          }),
      },
    );
    // The refusal names the id and says what a tool id may be, rather than where to install one.
    expect(firstSubmit).toContain("tool-id-invalid");
    expect(firstSubmit).toContain("../field-engine");
    expect(firstSubmit).toContain("is not a command name");
    expect(firstSubmit).not.toContain("tool-missing");
    // The session stayed open, so the corrected id is recorded on the next turn.
    expect(turns).toBe(2);
    expect(outcome).toMatchObject({ buildAdmissible: true });
  });

  // The first missing-tool refusal keeps the session open for repair, as the case above shows.
  // What this case adds is where an unrepaired session ends up, and the answer is not the one the
  // tool verdict might suggest: an unresolved tool id is a bundle finding, so validation refuses
  // the tree before the verifier settlement is ever reached. The tree never changes between
  // submits, so each repeat is a counted no-op strike and the session ends as authoring-stalled
  // rather than verifier-required. That other ending needs recorded tool non-results to reach, and
  // builder-campaign-tool-ceiling.test.ts writes them. Nothing here infers why the Builder kept the
  // declaration or whether a model would have understood the refusal; the scripted session
  // resubmits unchanged because that is what it was told to do.
  it.concurrent("ends a kept tool declaration on the no-op ceiling instead of burning every turn", async () => {
    const campaignDir = scratchDir("ana-primary-verifier-required-settle-");
    const workspace = join(campaignDir, "workspace");
    let turns = 0;
    const outcome = await runBuilderCampaign(
      { campaignDir, slug: "matching", kickoff: "Build a harness.", expectedTasks: 4, maxTurns: 8 },
      {
        tools: [],
        toolsProbes: () => ({}),
        open: async (tools) =>
          scriptedSession(async () => {
            turns += 1;
            completeBundle(workspace);
            requireExternalVerifier(workspace);
            const submit = submitTool(tools);
            await submit.execute("submit", {});
            return { status: "completed", assistantText: "submitted" };
          }),
      },
    );
    // Eight turns were available: the original refusal, three counted strikes, terminal on the
    // third — four submits of one tree, well inside the budget.
    expect(turns).toBe(4);
    expect(outcome).toMatchObject({ buildAdmissible: false, clauses: ["authoring-stalled"] });
  });

  // The handshake belongs to a tree the record accepted. A tree the record refused never reached
  // the verifier gate, so repeating it cannot settle a clause about a gate that was never
  // consulted; the unchanged resubmission is instead a no-op strike: steered with its count below
  // the ceiling, terminal as authoring-stalled at POLICY.loop.noopSubmitStrikes. Without the
  // ceiling a session sends the same bytes over a hundred times and spends the whole budget on it.
  it.concurrent("does not settle verifier-required on a repeated tree that fails the record", async () => {
    const campaignDir = scratchDir("ana-primary-verifier-required-malformed-");
    const workspace = join(campaignDir, "workspace");
    let turns = 0;
    const outcome = await runBuilderCampaign(
      // The battery holds 4 tasks; the ask states 5, so every submit refuses at the record.
      { campaignDir, slug: "matching", kickoff: "Build a harness.", expectedTasks: 5, maxTurns: 6 },
      {
        tools: [],
        toolsProbes: () => ({}),
        open: async (tools) =>
          scriptedSession(async () => {
            turns += 1;
            completeBundle(workspace);
            requireExternalVerifier(workspace);
            const submit = submitTool(tools);
            await submit.execute("submit", {});
            return { status: "completed", assistantText: "submitted" };
          }),
      },
    );
    // Six turns were available: the original refusal, three counted strikes, terminal on the
    // third — four submits of one tree in total.
    expect(turns).toBe(4);
    expect(outcome).toMatchObject({ buildAdmissible: false, clauses: ["authoring-stalled"] });
  });

  // A changed candidate is repair, not a kept declaration. The provisional clause from turn one
  // must not survive into a later tree that dropped external grounding and failed for its own
  // separate reason: the evidence would blame a gate the final tree never asked for.
  it.concurrent("clears the provisional verifier-required clause when a changed tree fails for its own reason", async () => {
    const campaignDir = scratchDir("ana-primary-verifier-required-clear-");
    const workspace = join(campaignDir, "workspace");
    let turns = 0;
    const outcome = await runBuilderCampaign(
      { campaignDir, ...OPENING },
      {
        tools: [],
        toolsProbes: () => ({}),
        open: async (tools) =>
          scriptedSession(async () => {
            turns += 1;
            if (turns === 1) {
              completeBundle(workspace);
              requireExternalVerifier(workspace);
            } else {
              // Intrinsic again, but with a separate defect: the operating guide is missing.
              bundleWithoutGuide(workspace);
              rmSync(join(workspace, "agent/BUILT_AGENTS.md"), { force: true });
            }
            const submit = submitTool(tools);
            await submit.execute("submit", {});
            return { status: "completed", assistantText: "submitted" };
          }),
      },
    );
    expect(turns).toBe(2);
    expect(outcome).toMatchObject({ buildAdmissible: false, clauses: ["iterations-exhausted"] });
  });

  // Who owns a tool that will not run is the whole question, because the two answers cost very
  // different amounts: reading it as the environment's discards the campaign whole, including
  // every authoring iteration already paid for. But the Builder chose that tool, so a crash in it
  // is ordinary authoring work: the round continues and the author is told what to repair. The
  // case proves that by running a real installed tool that kills itself with a signal, so the
  // `crash` classification comes from the host's own row rather than from a string this test
  // picked. What it injects is the control census path — `VerifierExecutionNonResult` through
  // probeControls, the same typed exception the solvability witness throws — so no F2 solve runs
  // here.
  it.concurrent("continues the round when a tool the brief named reached no completed run", async () => {
    const campaignDir = scratchDir("ana-primary-census-candidate-");
    const workspace = join(campaignDir, "workspace");
    mkdirSync(join(campaignDir, "node_modules"), { recursive: true });
    symlinkSync(join(import.meta.dir, "../node_modules/@ana"), join(campaignDir, "node_modules", "@ana"));
    let turns = 0;
    // A real host run of a real installed tool that dies on a signal: `crash` is author-repairable,
    // so the host's own row — not a string this test chose — decides the settlement.
    const verifier = toolHost(campaignDir, "#!/bin/sh\nkill -9 $$\n");
    const gate = makeCensusGate({
      probeControls: async () => {
        throw new VerifierExecutionNonResult(await runOneTool(verifier));
      },
      expectedTasks: 4,
    });
    const outcome = await runBuilderCampaign(
      { campaignDir, ...OPENING },
      {
        tools: [],
        toolsProbes: () => ({}),
        gates: async (harness, iterationDir, slugDir) => {
          harness.conformance = double({ schema: "test-conformance/v1", verdict: "pass" });
          return gate(harness, iterationDir, slugDir);
        },
        open: async (tools) =>
          scriptedSession(async () => {
            turns += 1;
            completeBundle(workspace);
            const submit = submitTool(tools);
            await submit.execute("submit", {});
            return { status: "completed", assistantText: "submitted" };
          }),
      },
    );
    // Not environment-blocked: the campaign kept working until it ran out of iterations.
    expect(outcome).toMatchObject({ buildAdmissible: false, clauses: ["iterations-exhausted"] });
    expect(turns).toBe(2);
    const iteration = JSON.parse(readFileSync(join(campaignDir, "01-matching", "iteration.json"), "utf8"));
    expect(iteration.feedback).toEqual([
      expect.objectContaining({
        owner: "correctness-model",
        claim: 'control census: runs of tool "fwcheck" reached no completed run',
      }),
    ]);
    // The author reads back the identities it wrote itself — the tool id and the check — plus the
    // process facts. A `crash` reason is the host's own sentence and stays in the protected evidence.
    const { detail } = iteration.feedback[0].findings[0];
    expect(detail).toContain('Tool "fwcheck"');
    expect(detail).toContain('check "parts-assigned"');
    expect(detail).not.toContain(verifier.evidence()[0]?.nonResultReason);
  });

  it.concurrent("ends the campaign on the environment when the host cannot read the tool at all", async () => {
    // The other side of the rule above. `verifierUnavailable` is environment-owned: the host could
    // not read the executable, which no evaluator edit repairs. The census gate retries once and
    // then settles it on the environment rather than opening another paid authoring round.
    const campaignDir = scratchDir("ana-primary-census-unavailable-");
    const workspace = join(campaignDir, "workspace");
    mkdirSync(join(campaignDir, "node_modules"), { recursive: true });
    symlinkSync(join(import.meta.dir, "../node_modules/@ana"), join(campaignDir, "node_modules", "@ana"));
    let turns = 0;
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
    const gate = makeCensusGate({
      probeControls: async () => {
        throw new VerifierExecutionNonResult(await runOneTool(verifier));
      },
      expectedTasks: 4,
    });
    const outcome = await runBuilderCampaign(
      { campaignDir, ...OPENING },
      {
        tools: [],
        toolsProbes: () => ({}),
        gates: async (harness, iterationDir, slugDir) => {
          harness.conformance = double({ schema: "test-conformance/v1", verdict: "pass" });
          return gate(harness, iterationDir, slugDir);
        },
        open: async (tools) =>
          scriptedSession(async () => {
            turns += 1;
            completeBundle(workspace);
            const submit = submitTool(tools);
            await submit.execute("submit", {});
            return { status: "completed", assistantText: "submitted" };
          }),
      },
    );
    expect(outcome).toMatchObject({ buildAdmissible: false, clauses: ["environment-blocked"] });
    // One round, not two: a host outage does not buy the author another turn.
    expect(turns).toBe(1);
    const iteration = JSON.parse(readFileSync(join(campaignDir, "01-matching", "iteration.json"), "utf8"));
    expect(iteration.focusOwner).toBe("environment");
    expect(iteration.feedback).toEqual([
      expect.objectContaining({ owner: "environment", severity: "blocking" }),
    ]);
    expect(iteration.feedback[0].findings ?? []).toHaveLength(0);
  });
});

/** Campaign regression for the missing-tool refusal. The scripted session examines the previous
 *  submit reply for installation guidance, then installs the fixture tool. That branch fails if a
 *  second projection replaces the guidance with the generic unclassified label. The script already
 *  knows the tool name and installation procedure; it does not discover a repair from arbitrary
 *  prose. This proves that the guidance reaches a consumer and that the scripted installation
 *  allows the next submission. A live run is needed to establish whether a model uses the same
 *  guidance successfully. */
describe("campaign: a scripted Builder responds to the missing-tool refusal", () => {
  it.concurrent("reads the refusal, installs the tool it names, and reaches build-admissible", async () => {
    const campaignDir = scratchDir("ana-verifier-required-e2e-");
    const workspace = join(campaignDir, "workspace");
    const submitOutputs: string[] = [];
    const outcome = await runBuilderCampaign(
      { campaignDir, slug: "matching", kickoff: "Build a harness.", expectedTasks: 4, maxTurns: 3 },
      {
        tools: [],
        toolsProbes: () => ({}),
        open: async (tools) =>
          scriptedSession(async () => {
            completeBundle(workspace);
            requireExternalVerifier(workspace);
            // The trigger comes from the previous submit output, which a model would also read.
            // The repair is scripted: installTool already knows the file and its contents.
            const lastRefusal = submitOutputs.at(-1) ?? "";
            if (lastRefusal.includes(".toolchain (any bin directory)")) {
              installTool(workspace, "field-engine");
            }
            const submit = submitTool(tools);
            submitOutputs.push(JSON.stringify(await submit.execute("submit", {})));
            return { status: "completed", assistantText: "submitted" };
          }),
      },
    );
    // Turn 1: the refusal itself carried the recovery instruction, not the laundered label.
    expect(submitOutputs[0]).toContain(".toolchain (any bin directory)");
    expect(submitOutputs[0]).toContain("field-engine");
    expect(submitOutputs[0]).not.toContain("generated-execution-unclassified");
    // Turn 2: acting on those words was sufficient — the campaign recovered.
    expect(submitOutputs).toHaveLength(2);
    expect(outcome).toMatchObject({ buildAdmissible: true });
  });
});
