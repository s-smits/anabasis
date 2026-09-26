/**
 * The readers in `src/correctness-bundle/tool-runs.ts`, over rows a real host recorded.
 *
 * The verification runner never reads the host's evidence array directly: it asks which runs
 * belong to one evaluation, whether that evaluation hit a non-result, which checks passed without
 * a completed run of their required tools, and what the environment identity is. Each of those is keyed by phase,
 * subject and attempt, so a retry and a second subject stay apart.
 */
import { afterAll, describe, expect, it } from "bun:test";

import { chmodSync, writeFileSync } from "../src/meta/filesystem.ts";
import { sha256OfFile } from "../src/meta/digest.ts";
import { createVerifierHost } from "../src/verify/host.ts";
import {
  executionEvidence,
  hostNonResult,
  subjectRuns,
  ungroundedPassChecks,
  ungroundedSentence,
} from "../src/correctness-bundle/tool-runs.ts";
import type { CorrectnessModelResult } from "../src/verify/correctness-model-result.ts";
import { verifierEnvironmentHashOfTools } from "../src/correctness-bundle/verifier-environment.ts";
import { required } from "./helpers/doubles.ts";
import { cleanupScratch } from "./helpers/scratch.ts";
import { hostFixture, runOnce, subject, toolPath } from "./helpers/verifier-host.ts";

afterAll(cleanupScratch);

describe("reading the host's rows", () => {
  it("separates each evaluation's tool runs, non-result and checks without tool coverage", async () => {
    const fx = hostFixture({ "good-tool": ["exit 0"], "drift-tool": ["exit 0"] });
    const drift = toolPath(fx, "drift-tool");
    writeFileSync(drift, "#!/bin/sh\nexit 0\n# moved\n");
    chmodSync(drift, 0o755);

    const key = { phase: "battery" as const, subjectId: "case-rows", attempt: 3 };
    const scope = fx.host.openSubject(subject({ a: 1 }, key));
    await scope.port.run({ toolId: "good-tool", checkId: "c-ran" });
    await scope.port.run({ toolId: "drift-tool", checkId: "c-blocked" });
    await scope.close();
    // A second evaluate of the same subject: its rows belong to its own attempt.
    const retry = fx.host.openSubject(subject({ a: 1 }, { ...key, attempt: 4 }));
    await retry.port.run({ toolId: "good-tool", checkId: "c-ran" });
    await retry.close();

    expect(subjectRuns(fx.host, key).map((row) => [row.checkId, row.outcome])).toEqual([
      ["c-ran", "executed"],
      ["c-blocked", "sandbox"],
    ]);
    expect(required(hostNonResult(fx.host, key), "non-result row").checkId).toBe("c-blocked");
    expect(hostNonResult(fx.host, { ...key, attempt: 4 })).toBeNull();

    const external = [
      { checkId: "c-ran", adapterId: "good-tool" },
      { checkId: "c-blocked", adapterId: "drift-tool" },
      { checkId: "c-absent", adapterId: "good-tool" },
      { checkId: "c-two", adapterId: "good-tool" },
      { checkId: "c-two", adapterId: "drift-tool" },
    ];
    const pass: CorrectnessModelResult = { ok: true, issues: [], checkReceipts: [] };
    const failedBy = (...checkIds: string[]): CorrectnessModelResult => ({
      ok: false,
      issues: checkIds.map((checkId) => ({ checkId, message: "" })),
      checkReceipts: [],
    });
    const ungrounded = (verdict: CorrectnessModelResult, deciding: string[], at = key) =>
      ungroundedPassChecks(verdict, deciding, external, fx.host.executedBindings(), at);
    // A pass rests on every check that decided it, so any whose tool never completed, refused or
    // never asked for, voids it, and each names the tools it skipped.
    expect(ungrounded(pass, ["c-ran", "c-blocked", "c-absent"])).toEqual([
      { checkId: "c-absent", toolIds: ["good-tool"] },
      { checkId: "c-blocked", toolIds: ["drift-tool"] },
    ]);
    // A check that did not decide this verdict is not this subject's problem.
    expect(ungrounded(pass, ["c-ran"])).toEqual([]);
    // And the same bindings do not cover a different subject.
    expect(ungrounded(pass, ["c-ran"], { ...key, subjectId: "case-other" })).toEqual([
      { checkId: "c-ran", toolIds: ["good-tool"] },
    ]);
    // A fail stands whichever checks went without their tools: a check may reject on a
    // precondition before it reaches its tool.
    expect(ungrounded(failedBy("c-absent"), ["c-ran", "c-absent"])).toEqual([]);
    expect(ungrounded(failedBy("c-ran"), ["c-ran", "c-absent"])).toEqual([]);

    // One clause per check, each naming its missing tools in the right number.
    expect(ungroundedSentence(ungrounded(pass, ["c-blocked", "c-two"], { ...key, attempt: 4 }))).toBe(
      'EXTERNAL_VERDICT_UNGROUNDED: check "c-blocked" passed without a completed run of its required tool "drift-tool"; check "c-two" passed without a completed run of its required tools "drift-tool", "good-tool"',
    );

    const evidence = executionEvidence(fx.host);
    expect(evidence.executed).toEqual([
      { phase: "battery", subjectId: "case-rows", attempt: 3, checkId: "c-ran", adapterId: "good-tool" },
      { phase: "battery", subjectId: "case-rows", attempt: 4, checkId: "c-ran", adapterId: "good-tool" },
    ]);
    expect(Object.keys(evidence.tools)).toEqual(["good-tool"]);
    expect(evidence.tools["good-tool"]).toEqual({
      digest: sha256OfFile(toolPath(fx, "good-tool")),
      source: "workspace-toolchain",
      kind: "script",
      interpreter: "sh",
      interpreterDigest: sha256OfFile("/bin/sh"),
    });
    expect(evidence.verifierEnvironmentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("names the environment by tool bytes, not by where the checkout put them", async () => {
    // Two worktrees hold the same compiler at two absolute paths. Hashing the host's own entries
    // included that path, so the same bytes gave two environment identities and a claim compared
    // across checkouts read as a moved environment when nothing about the tool had moved.
    const body = ["exit 0"];
    const one = hostFixture({ "same-tool": body });
    const two = hostFixture({ "same-tool": body });
    const changed = hostFixture({ "same-tool": [...body, "# different bytes"] });
    for (const fx of [one, two, changed]) {
      expect((await runOnce(fx.host, subject({}), { toolId: "same-tool", checkId: "c" })).executed).toBe(
        true,
      );
    }
    expect(toolPath(one, "same-tool")).not.toBe(toolPath(two, "same-tool"));

    const first = executionEvidence(one.host);
    const second = executionEvidence(two.host);
    expect(first.tools).toEqual(second.tools);
    expect(first.verifierEnvironmentHash).toBe(second.verifierEnvironmentHash);
    // The hash is the digest of the bytes-and-source projection of the map the evidence carries,
    // so a reader can recompute it from the claim alone; kind and interpreter sit beside it.
    expect(first.verifierEnvironmentHash).toBe(verifierEnvironmentHashOfTools(first.tools));
    // Different tool bytes are a different environment.
    expect(executionEvidence(changed.host).verifierEnvironmentHash).not.toBe(first.verifierEnvironmentHash);
  });

  it("has no environment identity when nothing ran", () => {
    const evidence = executionEvidence(createVerifierHost());
    expect(evidence).toEqual({ executed: [], verifierEnvironmentHash: null, tools: {} });
  });
});
