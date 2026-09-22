/**
 * What bounds a tool run: its time limit, the identity of the bytes it may execute, the OS wall it
 * requires, the output it may hand back and the environment it starts in.
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
import { commandSearchPath } from "../src/verify/solve-command-isolation.ts";
import { executionEvidence } from "../src/truth/tool-runs.ts";
import { verifierEnvironmentHashOfTools } from "../src/truth/verifier-environment.ts";
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
    expect(TOOL_TIMEOUT_CEILING_MS).toBe(300_000);
    expect(DEFAULT_TOOL_TIMEOUT_MS).toBe(TOOL_TIMEOUT_CEILING_MS);
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
  it("truncates stdout at the cap and keeps the last of stderr", async () => {
    const double32 = (name: string, seed: string, times: number) => [
      `${name}=${seed}`,
      "i=0",
      `while [ $i -lt ${String(times)} ]; do ${name}="$${name}$${name}"; i=$((i+1)); done`,
    ];
    const fx = hostFixture({
      "loud-tool": [
        // A short header lands as its own chunk, so the cap is reached mid-chunk rather than on
        // a convenient boundary — the case where a drop-whole-chunks rule splices the stream.
        `printf 'HDR\\n'`,
        "sleep 0.2",
        ...double32("s", "a".repeat(32), 15), // 32 * 2^15 = 1,048,576 bytes
        `printf '%s%s' "$s" "$s"`,
        `printf 'END-MARK'`,
        ...double32("e", "b".repeat(32), 14), // 32 * 2^14 = 524,288 bytes, twice the stderr cap
        `printf '%sTAIL-MARK' "$e" 1>&2`,
      ],
    });
    const written = `HDR\n${"a".repeat(2 * 1024 * 1024)}END-MARK`;

    const out = await runOnce(fx.host, subject({}), { toolId: "loud-tool", checkId: "c-loud" });
    expect(out.executed).toBe(true);
    expect(out.evidence.stdoutBytes).toBe(written.length);
    // What the evaluator reads is an exact PREFIX of what the tool wrote. Dropping a whole
    // oversized chunk and keeping a later small one would splice the stream: the evaluator would
    // parse a document the tool never emitted, with the middle silently missing and the final
    // line still in place.
    expect(out.stdout.length).toBeLessThanOrEqual(1024 * 1024);
    expect(out.stdout.length).toBeLessThan(out.evidence.stdoutBytes);
    expect(written.startsWith(out.stdout)).toBe(true);
    expect(out.evidence.stderrBytes).toBe(524_288 + "TAIL-MARK".length);
    // The capture stops at its cap; the tail follows the stream to its end, because a chatty
    // compiler's closing summary is exactly the part past the cap.
    expect(out.stderr.length).toBe(256 * 1024);
    expect(out.evidence.stderrTail).toHaveLength(2000);
    expect(out.evidence.stderrTail.endsWith("TAIL-MARK")).toBe(true);
  });

  it("starts the tool in a fresh cell home without inherited credentials or search path", async () => {
    const stage = scratchDir("ana-host-env-");
    const parentHome = join(stage, "parent-home");
    // The launcher's PATH names an interpreter directory first; the cell must not search it, or a
    // `#!/usr/bin/env python3` tool would run under a different Python than the Builder shell's.
    const launcherBin = join(stage, "launcher-bin");
    script(launcherBin, "python3", ["echo launcher-python"]);
    const fx = hostFixture(
      { "env-tool": ["/usr/bin/env"] },
      {
        parentEnv: {
          PATH: `${launcherBin}:${TOOL_PATH}`,
          HOME: parentHome,
          AWS_SECRET_ACCESS_KEY: "leak-one",
          DATABASE_URL: "postgres://user:leak-two@host/db",
          OPENROUTER_API_KEY: "leak-three",
        },
      },
    );

    const out = await runOnce(fx.host, subject({}), { toolId: "env-tool", checkId: "c-env" });
    expect(out.executed).toBe(true);
    const env = Object.fromEntries(
      out.stdout
        .split("\n")
        .filter((line) => line.includes("="))
        .map((line): [string, string] => [
          line.slice(0, line.indexOf("=")),
          line.slice(line.indexOf("=") + 1),
        ]),
    );

    // The cell env is built up from empty, so nothing crosses that was not named.
    const cellPrefix = join(fx.cells, "ana-cell-");
    expect(required(env.HOME, "HOME").startsWith(cellPrefix)).toBe(true);
    expect(required(env.TMPDIR, "TMPDIR").startsWith(cellPrefix)).toBe(true);
    expect(env.HOME).not.toBe(parentHome);
    expect(env.PATH).toBe(commandSearchPath(fx.toolTree));
    expect(required(env.PATH, "PATH").startsWith(join(fx.toolTree, "bin"))).toBe(true);
    expect(env.PATH).not.toContain(launcherBin);
    for (const secret of ["leak-one", "leak-two", "leak-three"]) expect(out.stdout).not.toContain(secret);
    const shellOwned = new Set(["HOME", "PATH", "TMPDIR", "PWD", "SHLVL", "_"]);
    expect(Object.keys(env).filter((name) => !shellOwned.has(name))).toEqual([]);
  });
});
