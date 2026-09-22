/**
 * The readers in `src/truth/tool-runs.ts`, over rows a real host recorded.
 *
 * The verification runner never reads the host's evidence array directly: it asks which runs
 * belong to one evaluation, whether that evaluation hit a non-result, which external checks no
 * completed tool covered, and what the environment identity is. Each of those is keyed by phase,
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
  uncoveredExternalCheckIds,
} from "../src/truth/tool-runs.ts";
import { verifierEnvironmentHashOfTools } from "../src/truth/verifier-environment.ts";
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
    ];
    // A check whose tool never completed is uncovered, whether it was refused or never asked for.
    expect(
      uncoveredExternalCheckIds(
        ["c-ran", "c-blocked", "c-absent"],
        external,
        fx.host.executedBindings(),
        key,
      ),
    ).toEqual(["c-absent", "c-blocked"]);
    // A check applicable to nothing here is not this subject's problem.
    expect(uncoveredExternalCheckIds(["c-ran"], external, fx.host.executedBindings(), key)).toEqual([]);
    // And the same bindings do not cover a different subject.
    expect(
      uncoveredExternalCheckIds(["c-ran"], external, fx.host.executedBindings(), {
        ...key,
        subjectId: "case-other",
      }),
    ).toEqual(["c-ran"]);

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
