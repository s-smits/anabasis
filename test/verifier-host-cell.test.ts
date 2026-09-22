/**
 * What the verifier host does with one evaluation scope: what a completed run records, what may
 * enter its cell, what the cell may produce, and what happens on either side of the scope.
 *
 * Every case runs a real child process. The order below is the order the host decides: a run
 * completes with whatever exit code the tool chose, its operands must come from the artifact or
 * the public task, a program an earlier call built may run from the cell, and a call that arrives
 * after the scope closed spawns nothing.
 */
import { afterAll, describe, expect, it } from "bun:test";

import { readFileSync } from "../src/meta/filesystem.ts";
import { sha256, sha256OfFile } from "../src/meta/digest.ts";
import { join } from "../src/meta/path.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import { hostFixture, runOnce, subject, toolPath } from "./helpers/verifier-host.ts";

afterAll(cleanupScratch);

describe("a completed run", () => {
  it("records exit 0 and exit 2 alike, with the bytes and the subject they answered for", async () => {
    const fx = hostFixture({
      "ok-tool": ['echo "out-$1"', 'echo "err" 1>&2', "exit 0"],
      "reject-tool": ["echo rejected", "exit 2"],
    });
    const subj = subject({ design: "x" });
    const scope = fx.host.openSubject(subj);
    const ok = await scope.port.run({ toolId: "ok-tool", checkId: "c-ok", args: ["one"] });
    const rejected = await scope.port.run({ toolId: "reject-tool", checkId: "c-reject" });
    await scope.close();

    expect(ok).toMatchObject({ executed: true, exitCode: 0, signal: null, timedOut: false, nonResult: null });
    expect(ok.stdout).toBe("out-one\n");
    expect(ok.stderr).toBe("err\n");
    // A compiler that rejects the artifact has answered: non-zero is still a completed run.
    expect(rejected).toMatchObject({ executed: true, exitCode: 2, timedOut: false, nonResult: null });
    expect(rejected.stdout).toBe("rejected\n");

    const row = ok.evidence;
    expect(row).toMatchObject({
      outcome: "executed",
      toolId: "ok-tool",
      checkId: "c-ok",
      args: ["one"],
      runId: "run-test",
      phase: "battery",
      subjectId: subj.subjectId,
      attempt: 1,
      toolSource: "workspace-toolchain",
      sandbox: "workdir+env-allowlist",
      sandboxPolicyHash: null,
      publicTaskDigest: null,
      filesDigest: null,
      stdinDigest: null,
      exitCode: 0,
      timedOut: false,
    });
    expect(row.command).toBe(toolPath(fx, "ok-tool"));
    expect(row.toolDigest).toBe(sha256OfFile(toolPath(fx, "ok-tool")));
    expect(row.artifactDigest).toBe(sha256(JSON.stringify({ design: "x" })));
    expect(row.requestDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(row.requestId).toBe(`req-${row.requestDigest.slice(0, 32)}`);
    expect(row.durationMs).toBeGreaterThanOrEqual(0);
    expect(row.nonResultReason).toBeUndefined();
    // Two different questions are two different request identities.
    expect(rejected.evidence.requestDigest).not.toBe(row.requestDigest);
  });

  it("digests the exact public-task bytes the scope was opened on", async () => {
    // The proof row's publicTaskDigest names the full solver-visible commitment; this row names
    // the EVALUATOR-side bytes, which the declared-operand projection narrows. A later dispute
    // has to cite the right stream.
    const full = {
      taskId: "t-lanes",
      family: "lanes",
      publicInput: { laneCount: 4, usb3DataRequired: true },
    };
    const projected = { taskId: "t-lanes", family: "lanes", publicInput: { laneCount: 4 } };
    const fx = hostFixture({ "ok-tool": ["exit 0"] });

    const out = await runOnce(fx.host, subject({ lanes: 4 }, { publicTask: projected }), {
      toolId: "ok-tool",
      checkId: "c-lanes",
    });
    expect(out.evidence.publicTaskDigest).toBe(sha256(JSON.stringify(projected)));
    expect(out.evidence.publicTaskDigest).not.toBe(sha256(JSON.stringify(full)));
  });
});

describe("what may enter the cell", () => {
  it("writes an artifact leaf and refuses a string the Builder authored", async () => {
    const artifact = { source: "module top;\nendmodule\n", name: "top" };
    const fx = hostFixture({ "cat-tool": ['cat "$1"'], "stdin-tool": ["cat"] });
    const scope = fx.host.openSubject(subject(artifact, { publicTask: { budget: "40ns" } }));

    const leaf = await scope.port.run({
      toolId: "cat-tool",
      checkId: "c-compile",
      args: ["design.v"],
      files: { "design.v": artifact.source },
    });
    expect(leaf.executed).toBe(true);
    expect(leaf.stdout).toBe(artifact.source);
    expect(leaf.evidence.filesDigest).toMatch(/^[0-9a-f]{64}$/);

    // The whole artifact JSON is also an allowed operand, as is a public-task string leaf.
    const whole = await scope.port.run({
      toolId: "cat-tool",
      checkId: "c-compile",
      args: ["a.json"],
      files: { "a.json": JSON.stringify(artifact) },
    });
    expect(whole.stdout).toBe(JSON.stringify(artifact));
    const piped = await scope.port.run({ toolId: "stdin-tool", checkId: "c-compile", stdin: "40ns" });
    expect(piped.stdout).toBe("40ns");
    expect(piped.evidence.stdinDigest).toBe(sha256("40ns"));
    const noInput = await scope.port.run({ toolId: "stdin-tool", checkId: "c-compile" });
    expect(noInput.executed).toBe(true);
    expect(noInput.stdout).toBe("");
    expect(noInput.evidence.stdinDigest).toBeNull();
    const publicJson = JSON.stringify({ budget: "40ns" });
    const publicWhole = await scope.port.run({
      toolId: "stdin-tool",
      checkId: "c-compile",
      stdin: publicJson,
    });
    expect(publicWhole.stdout).toBe(publicJson);
    expect(publicWhole.evidence.inputPaths).toEqual(["task:$"]);
    // Every row says WHICH artifact or task leaf reached the tool, so a reader can tell a check
    // that compiled the submitted source from one that only read the whole JSON back.
    expect(leaf.evidence.inputPaths).toEqual(["artifact:$.source"]);
    expect(leaf.evidence.toolKind).toBe("script");
    expect(whole.evidence.inputPaths).toEqual(["artifact:$"]);
    expect(piped.evidence.inputPaths).toEqual(["task:$.budget"]);

    // The hostile case the 2026-09 shim-header runs shipped: a header its author supplied.
    const before = fx.host.evidence().length;
    for (const request of [
      {
        toolId: "cat-tool",
        checkId: "c-compile",
        args: ["Arduino.h"],
        files: { "Arduino.h": "#define FAKE 1\n" },
      },
      { toolId: "cat-tool", checkId: "c-compile", args: ["x"], files: { "../escape.v": artifact.source } },
      { toolId: "stdin-tool", checkId: "c-compile", stdin: "author-supplied" },
      { toolId: "stdin-tool", checkId: "c-compile", stdin: "" },
    ]) {
      // An authoring defect throws — it is never an environment non-result the score may absorb.
      await expect(scope.port.run(request)).rejects.toThrow(/tool run refused: /);
    }
    expect(fx.host.evidence()).toHaveLength(before);
    await scope.close();
  });
});

describe("a program an earlier tool call produced", () => {
  it("treats a cell program that ends by signal as a completed run, and an inventory tool's signal as a crash", async () => {
    const fx = hostFixture({
      "build-tool": [`printf '#!/bin/sh\\nkill -ABRT $$\\n' > prog`, "chmod +x prog"],
      "abort-tool": ["kill -ABRT $$"],
    });
    const scope = fx.host.openSubject(subject({ v: "1" }));
    expect((await scope.port.run({ toolId: "build-tool", checkId: "c-build" })).executed).toBe(true);
    // The reject control's behaviour test asserts and aborts: that abort is its answer.
    const ran = await scope.port.run({ toolId: "cell:prog", checkId: "c-build" });
    expect(ran).toMatchObject({ executed: true, exitCode: null, signal: "SIGABRT", nonResult: null });
    expect(ran.evidence.outcome).toBe("executed");
    const crashed = await scope.port.run({ toolId: "abort-tool", checkId: "c-abort" });
    expect(crashed.executed).toBe(false);
    expect(crashed.nonResult?.kind).toBe("crash");
    await scope.close();
  });

  it("runs a program produced in the cell and refuses a cell path that leaves the cell", async () => {
    const fx = hostFixture({
      "build-tool": [`printf '#!/bin/sh\\necho compiled-$1\\n' > prog`, "chmod +x prog"],
    });
    const scope = fx.host.openSubject(subject({ v: "1" }));

    expect((await scope.port.run({ toolId: "build-tool", checkId: "c-build" })).executed).toBe(true);
    const ran = await scope.port.run({ toolId: "cell:prog", checkId: "c-build", args: ["ok"] });
    expect(ran.executed).toBe(true);
    expect(ran.stdout).toBe("compiled-ok\n");
    expect(ran.evidence.toolSource).toBe("cell");
    expect(ran.evidence.toolDigest).toMatch(/^[0-9a-f]{64}$/);

    for (const toolId of ["cell:../escape", "cell:/bin/sh", "cell:"]) {
      await expect(scope.port.run({ toolId, checkId: "c-run" })).rejects.toThrow(
        /is not a cell-relative path/,
      );
    }
    // Naming a tool nothing installed is an authoring defect, not a non-result.
    await expect(scope.port.run({ toolId: "not-installed", checkId: "c" })).rejects.toThrow(
      /is not in the resolved tool inventory/,
    );
    await expect(scope.port.run({ toolId: "build-tool", checkId: "   " })).rejects.toThrow(
      /checkId must name the truth check/,
    );
    // A cell path no run produced has no bytes to hash: an environment fact, not a defect.
    const absent = await scope.port.run({ toolId: "cell:never-built", checkId: "c-run" });
    expect(absent.nonResult?.kind).toBe("verifierUnavailable");
    expect(absent.evidence.outcome).toBe("verifierUnavailable");
    await scope.close();

    // A cell program grounds its check but is no part of the environment identity: it is the
    // submission's own output, not an installed tool.
    expect(Object.keys(fx.host.tools())).toEqual(["build-tool"]);
    expect(
      fx.host
        .executedBindings()
        .map((binding) => binding.adapterId)
        .sort(),
    ).toEqual(["build-tool", "cell:prog"]);
  });

  it("answers an identical installed-tool question once, and replays it before a later run in the reused cell", async () => {
    const launches = join(scratchDir("ana-host-launch-"), "launches");
    const fx = hostFixture({
      "build-tool": [
        `echo launch >> ${launches}`,
        `printf '#!/bin/sh\\necho compiled-$1\\n' > prog`,
        "chmod +x prog",
      ],
    });
    const count = () => readFileSync(launches, "utf8").split("\n").filter(Boolean).length;
    const scope = fx.host.openSubject(subject({ v: "1" }));
    const first = await scope.port.run({ toolId: "build-tool", checkId: "c-a" });
    const reused = await scope.port.run({ toolId: "build-tool", checkId: "c-b" });
    expect(count()).toBe(1);
    expect(reused).toMatchObject({ executed: true, stdout: first.stdout, exitCode: 0 });
    expect(reused.evidence).toMatchObject({
      checkId: "c-b",
      durationMs: 0,
      reusedFrom: { subjectId: first.evidence.subjectId, requestId: first.evidence.requestId },
    });
    // Without the replay the reused cell holds no prog, and this run would find nothing to hash.
    const ran = await scope.port.run({ toolId: "cell:prog", checkId: "c-b", args: ["ok"] });
    expect(ran.stdout).toBe("compiled-ok\n");
    expect(count()).toBe(2);
    expect(
      (await scope.port.run({ toolId: "build-tool", checkId: "c-c", args: ["other"] })).evidence.reusedFrom,
    ).toBeUndefined();
    expect(count()).toBe(3);
    await scope.close();
    expect(
      fx.host
        .executedBindings()
        .map((binding) => `${binding.checkId}:${binding.adapterId}`)
        .sort(),
    ).toEqual(["c-a:build-tool", "c-b:build-tool", "c-b:cell:prog", "c-c:build-tool"]);
  });

  // A scope closed while it waits on another scope's identical run must neither wait for that run
  // nor start the question afresh when the run ends without an answer.
  it("starts nothing for a scope closed while it waited on an identical run that then failed", async () => {
    const launches = join(scratchDir("ana-host-waiter-"), "launches");
    const fx = hostFixture({ "slow-tool": [`echo launch >> ${launches}`, "sleep 30"] });
    const owner = fx.host.openSubject(subject({ v: "1" }));
    const waiter = fx.host.openSubject(subject({ v: "2" }));
    const owned = owner.port.run({ toolId: "slow-tool", checkId: "c", timeoutMs: 4_000 });
    const waited = waiter.port.run({ toolId: "slow-tool", checkId: "c", timeoutMs: 4_000 });
    await Bun.sleep(200);
    const closing = Date.now();
    await waiter.close();
    expect(Date.now() - closing).toBeLessThan(2_000);
    expect(await waited).toMatchObject({ executed: false, nonResult: { kind: "sandbox" } });
    expect((await owned).nonResult?.kind).toBe("timeout");
    await owner.close();
    expect(readFileSync(launches, "utf8").split("\n").filter(Boolean)).toHaveLength(1);
    expect(fx.host.executedBindings()).toEqual([]);
  });
});

describe("the scope boundary", () => {
  it("fails a run that arrives after its evaluate closed, without spawning", async () => {
    const fx = hostFixture({ "ok-tool": ["echo ran"] });
    const scope = fx.host.openSubject(subject({}));
    await scope.close();

    const out = await scope.port.run({ toolId: "ok-tool", checkId: "c-late" });
    expect(out.executed).toBe(false);
    expect(out.nonResult?.kind).toBe("sandbox");
    expect(out.nonResult?.message).toContain("after its evaluate scope closed");
    expect(out.evidence).toMatchObject({ outcome: "sandbox", command: "", toolSource: null, durationMs: 0 });
    expect(out.evidence.checkId).toBe("c-late");
    expect(fx.host.evidence()).toHaveLength(1);
    expect(fx.host.executedBindings()).toEqual([]);
  });

  it("reports a run the evaluator never awaited as a pending invocation", async () => {
    const fx = hostFixture({ "slow-tool": ["sleep 1"] });
    const scope = fx.host.openSubject(subject({}));

    const fireAndForget = scope.port.run({ toolId: "slow-tool", checkId: "c-pending", timeoutMs: 20_000 });
    const closed = await scope.close();
    expect(closed.pendingInvocations).toBe(1);

    // Close cancelled the queued call before spawn and retained its refusal row.
    expect((await fireAndForget).executed).toBe(false);
    expect(fx.host.evidence()).toHaveLength(1);
    expect(fx.host.executedBindings()).toEqual([]);
    expect(fx.host.tools()).toEqual({});
  });
});
