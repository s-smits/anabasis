/**
 * What bounds a tool run: its time limit, the identity of the bytes it may execute, the OS wall it
 * requires and the output it may hand back.
 *
 * Each of these ends a run without an answer rather than letting a doubtful one through, so each
 * case pins both the refusal and the typed non-result it records. A missing sandbox, a changed
 * tool, a changed interpreter and a timeout are all the environment's; none of them is a fail.
 */
import { afterAll, describe, expect, it } from "bun:test";

import { chmodSync, readFileSync, rmSync, writeFileSync } from "../src/meta/filesystem.ts";
import { sha256OfFile } from "../src/meta/digest.ts";
import { join } from "../src/meta/path.ts";
import { processGroupExists } from "../src/meta/subprocess.ts";
import {
  DEFAULT_TOOL_TIMEOUT_MS,
  TOOL_TIMEOUT_CEILING_MS,
  createVerifierHost,
  resolveToolTimeoutMs,
} from "../src/verify/host.ts";
import { resolveToolInventory } from "../src/verify/tool-inventory.ts";
import { executionEvidence } from "../src/correctness-bundle/tool-runs.ts";
import { verifierEnvironmentHashOfTools } from "../src/correctness-bundle/verifier-environment.ts";
import { createVerifierLifetime } from "../src/verify/verifier-lifetime.ts";
import { required } from "./helpers/doubles.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import { TOOL_PATH, hostFixture, runOnce, script, subject, toolPath } from "./helpers/verifier-host.ts";

afterAll(cleanupScratch);

describe("execution limits and sandbox requirements", () => {
  it("kills the whole process group when a tool exceeds its time limit", async () => {
    const fx = hostFixture({ "slow-tool": ['echo $$ > "$1"', "sleep 30"] });
    const pidFile = join(fx.dir, "slow.pid");

    const out = await runOnce(fx.host, subject({}), {
      toolId: "slow-tool",
      checkId: "c-slow",
      args: [pidFile],
      // Generous enough that a loaded machine still starts the shell and writes its pid before
      // the timeout fires; the case is about the kill, not about how fast a process starts.
      timeoutMs: 10_000,
    });

    expect(out).toMatchObject({ executed: false, timedOut: true, stdout: "" });
    expect(out.nonResult?.kind).toBe("timeout");
    expect(out.evidence.outcome).toBe("timeout");
    expect(out.evidence.timedOut).toBe(true);
    expect(out.evidence.nonResultReason).toContain("exceeded 10000ms");
    const pid = Number(readFileSync(pidFile, "utf8").trim());
    expect(Number.isSafeInteger(pid) && pid > 1).toBe(true);
    expect(processGroupExists(pid)).toBe(false);
    expect(fx.host.executedBindings()).toEqual([]);
  });

  it("bounds the timeout between one millisecond and the host ceiling", async () => {
    expect(resolveToolTimeoutMs(undefined)).toBe(DEFAULT_TOOL_TIMEOUT_MS);
    expect(resolveToolTimeoutMs(1_500)).toBe(1_500);
    expect(resolveToolTimeoutMs(0)).toBe(1);
    expect(resolveToolTimeoutMs(-5)).toBe(1);
    expect(resolveToolTimeoutMs(TOOL_TIMEOUT_CEILING_MS + 5_000)).toBe(TOOL_TIMEOUT_CEILING_MS);
    // A harness's own tool-run wall is both its default and its ceiling.
    expect(resolveToolTimeoutMs(undefined, 900_000)).toBe(900_000);
    expect(resolveToolTimeoutMs(1_200_000, 900_000)).toBe(900_000);
    expect(resolveToolTimeoutMs(undefined, 60_000)).toBe(60_000);

    // And the spawn path uses that same value: a zero ask becomes the one-millisecond limit.
    const fx = hostFixture({ "slow-tool": ["sleep 30"] });
    const out = await runOnce(fx.host, subject({}), { toolId: "slow-tool", checkId: "c", timeoutMs: 0 });
    expect(out.nonResult?.kind).toBe("timeout");
    expect(out.evidence.nonResultReason).toContain("exceeded 1ms");
  });

  it("refuses a tool whose bytes moved since the candidate snapshot", async () => {
    const fx = hostFixture({ "drift-tool": ["exit 0"] });
    const path = toolPath(fx, "drift-tool");
    const snapshot = required(fx.inventory["drift-tool"], "drift-tool").digest;
    writeFileSync(path, "#!/bin/sh\nexit 0\n# a different tool\n");
    chmodSync(path, 0o755);

    const out = await runOnce(fx.host, subject({}), { toolId: "drift-tool", checkId: "c" });
    expect(out.executed).toBe(false);
    expect(out.nonResult?.kind).toBe("sandbox");
    expect(out.nonResult?.message).toContain("bytes changed since the candidate snapshot");
    expect(out.evidence.outcome).toBe("sandbox");
    expect(out.evidence.toolDigest).toBe(sha256OfFile(path));
    expect(out.evidence.toolDigest).not.toBe(snapshot);
    expect(out.evidence.durationMs).toBe(0);
    expect(out.evidence.exitCode).toBeNull();
    expect(fx.host.tools()).toEqual({});

    // And a tool that is gone altogether is the environment's, not the author's.
    rmSync(path, { force: true });
    const gone = await runOnce(fx.host, subject({}), { toolId: "drift-tool", checkId: "c" });
    expect(gone.nonResult?.kind).toBe("verifierUnavailable");
    expect(gone.evidence.toolDigest).toBeNull();
  });

  it("binds a script's interpreter into the environment and refuses one that moved since the snapshot", async () => {
    // eaf98f (2026-09-14): one script digest, graded under python3 3.9 in the shell and 3.14 in the cell.
    const fx = hostFixture({ interp: ['exec /bin/sh "$@"'] });
    const tool = join(fx.toolTree, "bin", "env-tool");
    writeFileSync(tool, "#!/usr/bin/env interp\nexit 0\n");
    chmodSync(tool, 0o755);
    const resolved = resolveToolInventory({ toolIds: ["env-tool"], toolTree: fx.toolTree, pathDirs: [] });
    const entry = required(resolved.inventory["env-tool"], "env-tool");
    const interp = join(fx.toolTree, "bin", "interp");
    expect(entry.interpreterDigest).toBe(sha256OfFile(interp));
    const host = createVerifierHost({
      inventory: resolved.inventory,
      toolTree: fx.toolTree,
      baseDir: fx.cells,
      parentEnv: { PATH: TOOL_PATH },
      requireOsSandbox: false,
      lifetime: createVerifierLifetime({ root: join(fx.dir, "lifetime-env") }),
    });
    expect((await runOnce(host, subject({}), { toolId: "env-tool", checkId: "c" })).executed).toBe(true);
    const recorded = executionEvidence(host);
    expect(recorded.tools["env-tool"]?.interpreterDigest).toBe(entry.interpreterDigest);
    // A record without the field hashes as it always did; the interpreter's bytes change the identity.
    const bare = { "env-tool": { digest: entry.digest, source: entry.source } };
    expect(recorded.verifierEnvironmentHash).not.toBe(verifierEnvironmentHashOfTools(bare));

    writeFileSync(interp, '#!/bin/sh\nexec /bin/sh "$@"\n# another interpreter\n');
    chmodSync(interp, 0o755);
    const moved = await runOnce(host, subject({}), { toolId: "env-tool", checkId: "c" });
    expect(moved.executed).toBe(false);
    expect(moved.nonResult?.kind).toBe("sandbox");
    expect(moved.nonResult?.message).toContain("resolves a different interp since the candidate snapshot");
  });

  it("refuses a script whose interpreter was unresolvable at snapshot and resolves by the time it runs", async () => {
    // The drift check used to read an absent snapshot digest as "nothing moved" and skip the live
    // re-read entirely, so an interpreter that vanished was refused while one that appeared was
    // waved through -- and that one decides the grade with no run having ever hashed it.
    const fx = hostFixture({});
    const tool = join(fx.toolTree, "bin", "late-tool");
    writeFileSync(tool, "#!/usr/bin/env latecomer\nexit 0\n");
    chmodSync(tool, 0o755);
    const resolved = resolveToolInventory({ toolIds: ["late-tool"], toolTree: fx.toolTree, pathDirs: [] });
    const entry = required(resolved.inventory["late-tool"], "late-tool");
    // The snapshot names the interpreter it could not find, which is the pair the check reads.
    expect(entry).toMatchObject({ kind: "script", interpreter: "latecomer" });
    expect(entry.interpreterDigest).toBeUndefined();
    const openHost = () =>
      createVerifierHost({
        inventory: resolved.inventory,
        toolTree: fx.toolTree,
        baseDir: fx.cells,
        parentEnv: { PATH: TOOL_PATH },
        requireOsSandbox: false,
        lifetime: createVerifierLifetime({ root: join(fx.dir, "lifetime-late") }),
      });
    // Still unresolvable: both sides absent is not movement, and the exec fails on its own.
    const absent = await runOnce(openHost(), subject({}), { toolId: "late-tool", checkId: "c" });
    expect(absent.nonResult?.kind).not.toBe("sandbox");

    // `.toolchain/bin` is on the cell's own search path, so this is the interpreter that would run.
    script(join(fx.toolTree, "bin"), "latecomer", ['exec /bin/sh "$@"']);
    const appeared = await runOnce(openHost(), subject({}), { toolId: "late-tool", checkId: "c" });
    expect(appeared.executed).toBe(false);
    expect(appeared.nonResult?.kind).toBe("sandbox");
    expect(appeared.nonResult?.message).toContain("not pinned at snapshot");
  });

  it("fails closed without spawning when a required OS wall is unavailable", async () => {
    const fx = hostFixture(
      { "any-tool": ["echo ran"] },
      {
        requireOsSandbox: true,
        osSandbox: {
          platform: "linux",
          bwrapPath: join(scratchDir("ana-host-wall-"), "no-such-bwrap"),
          outerSandboxed: false,
        },
      },
    );

    const out = await runOnce(fx.host, subject({}), { toolId: "any-tool", checkId: "c" });
    expect(out.executed).toBe(false);
    expect(out.nonResult?.kind).toBe("sandbox");
    expect(out.nonResult?.message).toContain("requires Linux bubblewrap");
    expect(out.stdout).toBe("");
    expect(out.evidence).toMatchObject({
      outcome: "sandbox",
      durationMs: 0,
      exitCode: null,
      sandboxPolicyHash: null,
    });
    expect(fx.host.executedBindings()).toEqual([]);
    expect(fx.host.tools()).toEqual({});
  });
});

describe("the bytes the host hands back", () => {
  const double32 = (name: string, seed: string, times: number) => [
    `${name}=${seed}`,
    "i=0",
    `while [ $i -lt ${String(times)} ]; do ${name}="$${name}$${name}"; i=$((i+1)); done`,
  ];

  it("hands back no answer when stdout ran past the cap", async () => {
    const fx = hostFixture({
      "loud-tool": [
        ...double32("s", "a".repeat(32), 15), // 32 * 2^15 = 1,048,576 bytes
        `printf '%s%s' "$s" "$s"`,
        `printf 'END-MARK'`,
      ],
    });

    const out = await runOnce(fx.host, subject({}), { toolId: "loud-tool", checkId: "c-loud" });
    // The first megabyte of a longer document is a different document: a check parsing it would
    // read a cut as a wrong answer and reject an artifact the tool never judged.
    expect(out).toMatchObject({ executed: false, stdout: "", exitCode: 0 });
    expect(out.nonResult?.kind).toBe("protocol");
    expect(out.evidence.outcome).toBe("protocol");
    expect(out.evidence.stdoutBytes).toBe(2 * 1024 * 1024 + "END-MARK".length);
    expect(out.evidence.nonResultReason).toContain("over the 1048576 the host reads");
    expect(fx.host.executedBindings()).toEqual([]);
  });

  it("hands back no answer when the tool's shell could not execute or find its program", async () => {
    // A wrapper whose `exec` the cell refuses leaves the shell's 126 and nothing on stdout; read as
    // an answer, every accept control the check runs through it becomes a rejected artifact.
    const fx = hostFixture({
      "refused-tool": ["exec /dev/null"],
      "missing-tool": ['/nonexistent/python "$@"'],
    });
    for (const [toolId, code] of [
      ["refused-tool", 126],
      ["missing-tool", 127],
    ] as const) {
      const out = await runOnce(fx.host, subject({}), { toolId, checkId: "c" });
      expect(out).toMatchObject({ executed: false, stdout: "", exitCode: code });
      expect(out.nonResult?.kind).toBe("protocol");
      expect(out.evidence.nonResultReason).toContain(`exited ${String(code)} without writing stdout`);
    }

    // The same codes after an answer, and an ordinary rejection with nothing printed, are answers.
    const answered = hostFixture({
      "late-tool": ["printf 'verdict: fail'", "exit 126"],
      "quiet-tool": ["exit 1"],
      "stderr-126": [String.raw`printf 'candidate rejected after check ran\n' 1>&2`, "exit 126"],
      "stderr-127": [String.raw`printf 'candidate rejected after check ran\n' 1>&2`, "exit 127"],
    });
    // A checker that ran and chose 126 or 127 itself, saying so on stderr alone, still answered.
    for (const [toolId, code] of [
      ["stderr-126", 126],
      ["stderr-127", 127],
    ] as const) {
      const out = await runOnce(answered.host, subject({}), { toolId, checkId: "c" });
      expect(out).toMatchObject({ executed: true, exitCode: code, stdout: "" });
      expect(out.stderr).toContain("candidate rejected after check ran");
    }
    const late = await runOnce(answered.host, subject({}), { toolId: "late-tool", checkId: "c" });
    expect(late).toMatchObject({ executed: true, exitCode: 126, stdout: "verdict: fail" });
    const quiet = await runOnce(answered.host, subject({}), { toolId: "quiet-tool", checkId: "c" });
    expect(quiet).toMatchObject({ executed: true, exitCode: 1, stdout: "" });
  });

  it("keeps stdout whole at the cap and the last of stderr past its own", async () => {
    const fx = hostFixture({
      "chatty-tool": [
        ...double32("s", "a".repeat(32), 15),
        `printf '%s' "$s"`,
        ...double32("e", "b".repeat(32), 14), // 32 * 2^14 = 524,288 bytes, twice the stderr cap
        `printf '%sTAIL-MARK' "$e" 1>&2`,
      ],
    });

    const out = await runOnce(fx.host, subject({}), { toolId: "chatty-tool", checkId: "c-chatty" });
    expect(out.executed).toBe(true);
    expect(out.stdout).toBe("a".repeat(1024 * 1024));
    expect(out.evidence.stdoutBytes).toBe(1024 * 1024);
    expect(out.evidence.stderrBytes).toBe(524_288 + "TAIL-MARK".length);
    // The capture stops at its cap; the tail follows the stream to its end, because a chatty
    // compiler's closing summary is exactly the part past the cap.
    expect(out.stderr.length).toBe(256 * 1024);
    expect(out.evidence.stderrTail).toHaveLength(2000);
    expect(out.evidence.stderrTail.endsWith("TAIL-MARK")).toBe(true);
  });
});
