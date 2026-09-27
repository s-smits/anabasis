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
import { portableToolTreeDigest, resolveToolInventory } from "../src/verify/tool-inventory.ts";
import { createVerifierLifetime } from "../src/verify/verifier-lifetime.ts";
import { join } from "../src/meta/path.ts";
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
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import { TOOL_PATH, hostFixture, runOnce, script, subject, toolPath } from "./helpers/verifier-host.ts";

afterAll(cleanupScratch);

describe("reading the host's rows", () => {
  it("separates each evaluation's tool runs, non-result and checks without tool coverage", async () => {
    // The drifting tool sits on the host path: an edit inside the workspace tree would move every
    // workspace tool's identity, the good one's included.
    const pathDir = scratchDir("ana-host-path-");
    const drift = script(pathDir, "drift-tool", ["exit 0"]);
    const onPath = resolveToolInventory({ toolIds: ["drift-tool"], toolTree: null, pathDirs: [pathDir] });
    const workspaceTools = hostFixture({ "good-tool": ["exit 0"] });
    const fx = {
      ...workspaceTools,
      host: createVerifierHost({
        inventory: { ...workspaceTools.inventory, ...onPath.inventory },
        toolTree: workspaceTools.toolTree,
        baseDir: workspaceTools.cells,
        parentEnv: { PATH: TOOL_PATH },
        requireOsSandbox: false,
        lifetime: createVerifierLifetime({ root: join(workspaceTools.dir, "lifetime-rows") }),
      }),
    };
    writeFileSync(drift, "#!/bin/sh\nexit 0\n# moved\n");
    chmodSync(drift, 0o755);

    const key = { phase: "battery" as const, subjectId: "case-rows", attempt: 3 };
    const scope = fx.host.openSubject(subject({ a: 1 }, key));
    const stdin = JSON.stringify({ a: 1 });
    await scope.port.run({ toolId: "good-tool", checkId: "c-ran", stdin });
    await scope.port.run({ toolId: "drift-tool", checkId: "c-blocked", stdin });
    await scope.close();
    // A second evaluate of the same subject: its rows belong to its own attempt.
    const retry = fx.host.openSubject(subject({ a: 1 }, { ...key, attempt: 4 }));
    await retry.port.run({ toolId: "good-tool", checkId: "c-ran", stdin });
    await retry.close();

    expect(subjectRuns(fx.host, key).map((row) => [row.checkId, row.outcome])).toEqual([
      ["c-ran", "executed"],
      ["c-blocked", "sandbox"],
    ]);
    expect(required(hostNonResult(fx.host, key), "non-result row").checkId).toBe("c-blocked");
    expect(hostNonResult(fx.host, { ...key, attempt: 4 })).toBeNull();

    const external = [
      { checkId: "c-ran", adapterId: "good-tool", kind: "external" as const },
      { checkId: "c-blocked", adapterId: "drift-tool", kind: "external" as const },
      { checkId: "c-absent", adapterId: "good-tool", kind: "external" as const },
      { checkId: "c-two", adapterId: "good-tool", kind: "external" as const },
      { checkId: "c-two", adapterId: "drift-tool", kind: "external" as const },
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
    expect(evidence.executed).toEqual(
      [3, 4].map((attempt) => ({
        phase: "battery" as const,
        subjectId: "case-rows",
        attempt,
        checkId: "c-ran",
        adapterId: "good-tool",
        artifactInput: true,
      })),
    );
    expect(Object.keys(evidence.tools)).toEqual(["good-tool"]);
    expect(evidence.tools["good-tool"]).toEqual({
      digest: sha256OfFile(toolPath(fx, "good-tool")),
      source: "workspace-toolchain",
      kind: "script",
      interpreter: "sh",
      interpreterDigest: sha256OfFile("/bin/sh"),
      treeDigest: portableToolTreeDigest(fx.toolTree),
      // A tool that never names its own tree counts by its plain bytes.
      portableDigest: sha256OfFile(toolPath(fx, "good-tool")),
    });
    expect(evidence.verifierEnvironmentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("grounds an external pass only on a run that was handed the artifact", async () => {
    // `decode` fails the way a JSON reader fails on empty input; `reject` reads its input and
    // exits 1 whatever it was given. Neither exit code is what decides grounding.
    const fx = hostFixture({
      decode: ['input=$(cat); [ -n "$input" ] || { echo "JSONDecodeError" >&2; exit 1; }', "exit 0"],
      reject: ["cat >/dev/null", "exit 1"],
    });
    const artifact = { source: "int main(void) { return 0; }", note: "" };
    const publicTask = { taskId: "t", family: "f", publicInput: { span: "12" } };
    const pass: CorrectnessModelResult = { ok: true, issues: [], checkReceipts: [] };
    const check = (checkId: string, kind: "authored" | "external" = "external") => ({
      checkId,
      adapterId: checkId === "c-exit1" ? "reject" : "decode",
      kind,
    });
    const key = { phase: "battery" as const, subjectId: "case-input", attempt: 1 };
    const scope = fx.host.openSubject(subject(artifact, { ...key, publicTask }));
    const run = (
      checkId: string,
      toolId: string,
      input: { stdin?: string; files?: Record<string, string> },
    ) => scope.port.run({ toolId, checkId, ...input });
    // The stdin was dropped: the tool ran, exited 1 on empty input, and the evaluator passed anyway.
    const dropped = await run("c-dropped", "decode", {});
    expect([dropped.executed, dropped.exitCode]).toEqual([true, 1]);
    // Artifact bytes on stdin ground the pass even though this tool exits 1.
    expect((await run("c-exit1", "reject", { stdin: JSON.stringify(artifact) })).exitCode).toBe(1);
    // A file holding one artifact leaf grounds it too.
    await run("c-file", "decode", { files: { "main.c": artifact.source } });
    // The public task alone, or an empty artifact leaf, hands the tool nothing of the artifact.
    await run("c-task-only", "decode", { stdin: "12" });
    await run("c-empty-leaf", "decode", { stdin: "" });
    // One run with the artifact among a check's runs grounds it, in either order.
    await run("c-later", "decode", {});
    await run("c-later", "decode", { stdin: JSON.stringify(artifact) });
    await scope.close();

    const ids = ["c-dropped", "c-exit1", "c-file", "c-task-only", "c-empty-leaf", "c-later"];
    const bindings = fx.host.executedBindings();
    expect(
      ungroundedPassChecks(
        pass,
        ids,
        ids.map((id) => check(id)),
        bindings,
        key,
      ),
    ).toEqual([
      { checkId: "c-dropped", toolIds: ["decode"] },
      { checkId: "c-empty-leaf", toolIds: ["decode"] },
      { checkId: "c-task-only", toolIds: ["decode"] },
    ]);
    // The fact is recorded on the binding, one per check, whichever of its runs carried it.
    expect(bindings.map((row) => [row.checkId, row.artifactInput])).toEqual(
      ids.map((id) => [id, ["c-exit1", "c-file", "c-later"].includes(id)]),
    );
    // An authored check never claimed its tool decided on the artifact, so any completed run counts.
    expect(
      ungroundedPassChecks(pass, ["c-dropped"], [check("c-dropped", "authored")], bindings, key),
    ).toEqual([]);
    // A fail still stands without grounding.
    const failed: CorrectnessModelResult = {
      ok: false,
      issues: [{ checkId: "c-dropped", message: "" }],
      checkReceipts: [],
    };
    expect(ungroundedPassChecks(failed, ["c-dropped"], [check("c-dropped")], bindings, key)).toEqual([]);
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
