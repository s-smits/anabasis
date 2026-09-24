import { spawnTextSync as spawnSync } from "./helpers/bun-spawn-sync.ts";

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { homedir, tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { afterAll, describe, expect, it } from "bun:test";
import { CandidateIsolationUnavailable, openPathRecord } from "../src/builder/candidate-isolation-runtime.ts";
import { deriveCandidateIsolation } from "../src/builder/candidate-isolation.ts";
import { createPublicSourceTool } from "../src/builder/public-source-tool.ts";
import {
  type PublicSourceBroker,
  PublicSourceFailure,
  isPublicNetworkAddress,
  resolvePublicHttpsTarget,
} from "../src/builder/public-source.ts";
import { createVerifierWorkshopTool } from "../src/builder/verifier-workshop-tool.ts";

type WorkshopCall = {
  command: string;
  envKeys: string[];
  controllerReadFiles: string[];
  stdinBytes: number | null;
  stdin: string | null;
};

/** A test-side address row; production takes the family from the resolver. */
const literal = (address: string) => ({ address, family: address.includes(":") ? 6 : 4 });
import {
  actionRequestDigest,
  verifierWorkshopCommand,
  workshopEnvironment,
} from "../src/builder/verifier-workshop-input.ts";
import { type VerifierWorkshopRunner, createVerifierWorkshop } from "../src/builder/verifier-workshop.ts";
import { surveyVerifierSource } from "../src/builder/verifier-workshop-survey.ts";
import { osIsolationSupport } from "../src/verify/os-isolation.ts";
import { PROTECTED_HOME_NAMES } from "../src/verify/wall-policy.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { required } from "./helpers/doubles.ts";
import { seedIsolationFixture } from "./helpers/isolation-fixture.ts";

const protectedHomeReadRoots = (): string[] => PROTECTED_HOME_NAMES.map((name) => join(homedir(), name));

const SCRATCH = realpathSync.native(mkdtempSync(join(tmpdir(), "ana-workshop-")));
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

function fixture(label: string) {
  const { repoRoot, epochDir, iterationDir, ossRoot, binding } = seedIsolationFixture(SCRATCH, label, {
    iterationName: "workspace",
    askText: "one line\n",
  });
  return {
    repoRoot,
    epochDir,
    iterationDir,
    ossRoot,
    policy: deriveCandidateIsolation(binding, "workshop"),
    record: openPathRecord(epochDir, "builder-primary"),
    evidencePath: join(epochDir, "verifier-workshop.jsonl"),
  };
}

function text(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content[0]?.text ?? "";
}

function filesUnder(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) out.push(path);
    }
  };
  walk(root);
  return out;
}

function outcome(stdout = "", stderr = "", status: number | null = 0) {
  return {
    stdout,
    stderr,
    stdoutTruncated: false,
    stderrTruncated: false,
    status,
    signal: null,
    timedOut: false,
  };
}

function fakeRunner(calls: WorkshopCall[]): VerifierWorkshopRunner {
  return async (_policy, _ledger, request) => {
    calls.push({
      command: request.command,
      envKeys: Object.keys(request.env ?? {}).sort(),
      controllerReadFiles: request.controllerReadFiles ?? [],
      stdinBytes: request.stdin === undefined ? null : new TextEncoder().encode(request.stdin).byteLength,
      stdin: request.stdin ?? null,
    });
    if (request.command === "rg") {
      const target = required(request.args.at(-1), "the ripgrep target");
      return outcome(`${filesUnder(target).join("\n")}\n`);
    }
    if (request.command === "/bin/cat") {
      return outcome(readFileSync(required(request.args[0], "the cat path"), "utf8"));
    }
    if (request.command === "/bin/mkdir") {
      mkdirSync(join(request.cwd, required(request.args.at(-1), "the mkdir path")), { recursive: true });
      return outcome();
    }
    if (request.command === "/bin/cp") {
      copyFileSync(
        required(request.args[0], "the copy source"),
        required(request.args[1], "the copy target"),
      );
      return outcome();
    }
    if (
      request.command === "/bin/sh" &&
      request.stdin !== undefined &&
      request.args.at(-2) === "workshop-write"
    ) {
      writeFileSync(required(request.args.at(-1), "the write target"), request.stdin);
      return outcome();
    }
    if (request.command === "/bin/sh") return outcome("smoke ok\n");
    throw new Error(`unexpected command ${request.command}`);
  };
}

function fakeSource(content = "archive bytes\n"): PublicSourceBroker {
  return async (value) => {
    const scratch = mkdtempSync(join(SCRATCH, "public-source-"));
    const path = join(scratch, "source");
    writeFileSync(path, content);
    return {
      initialUrl: value,
      finalUrl: value,
      bytes: new TextEncoder().encode(content).byteLength,
      sha256: new Bun.CryptoHasher("sha256").update(content).digest("hex"),
      path,
      cleanup: () => rmSync(scratch, { recursive: true, force: true }),
    };
  };
}

function tools(
  f: ReturnType<typeof fixture>,
  options: { runner?: VerifierWorkshopRunner; sourceBroker?: PublicSourceBroker } = {},
) {
  const workshop = createVerifierWorkshop({
    ...f,
    root: f.ossRoot,
    ...keyIfDefined("runner", options.runner),
    ...keyIfDefined("sourceBroker", options.sourceBroker),
  });
  return {
    owner: workshop,
    source: createPublicSourceTool(workshop),
    workshop: createVerifierWorkshopTool(workshop),
  };
}

describe("the correctness-model workshop authority boundary", () => {
  // Serial on purpose: this case sets BENIGN_WORKSHOP_CANARY on the process environment and then
  // deletes it, and every other case in this file builds a workshop from that same environment.
  // Concurrency would let a sibling capture the canary during the window and assert against a
  // value this case owns. Keep this environment mutation serial; cases whose state lives in their
  // own temporary directories can run concurrently.
  it("mediates public bytes and runs setup offline without creating admission state", async () => {
    const f = fixture("happy");
    const calls: WorkshopCall[] = [];
    Bun.env.BENIGN_WORKSHOP_CANARY = "fixture-value";
    const mounted = tools(f, { runner: fakeRunner(calls), sourceBroker: fakeSource() });
    Reflect.deleteProperty(Bun.env, "BENIGN_WORKSHOP_CANARY");
    expect(mounted.workshop.description).toContain(
      "List the installed executable in execution.requiredToolIds for authored computation or execution.evidence.requiredToolIds for external evidence and call runtime.tools.run",
    );
    expect(mounted.workshop.description).toContain("create safe missing directories");
    expect(mounted.source.description).toContain("archive or package");
    // Web search is a per-backend fact the system prompt states only where it exists.
    expect(mounted.source.description).not.toMatch(/web search/i);
    expect(mounted.workshop.description).toContain("Supply public requests through run.stdin");
    expect(mounted.workshop.description).toContain("Workshop commands cannot read the candidate workspace");
    expect(mounted.workshop.description).toContain(
      "copy candidate text with write. Ordinary workspace tools cannot read .oss; use this tool's actions.",
    );
    expect(mounted.workshop.description).toContain("export copies one binary, script or package file");
    expect(mounted.workshop.description).toContain("workshop PATH");
    expect(mounted.workshop.description).not.toContain("host toolchain");
    expect(mounted.workshop.description).not.toContain("propose");

    const fetched = JSON.parse(
      text(await mounted.source.execute("fetch", { url: "https://example.com/verifier.tar.gz" })),
    );
    expect(fetched).toMatchObject({
      status: "completed",
      result: {
        bytes: 14,
        sha256: new Bun.CryptoHasher("sha256").update("archive bytes\n").digest("hex"),
      },
    });
    expect(readFileSync(join(f.ossRoot, fetched.result.path), "utf8")).toBe("archive bytes\n");
    const checkerSource = '#!/bin/sh\nprintf "%s\\n" "$1"\n# literal $(not-executed)\n';
    const written = JSON.parse(
      text(
        await mounted.workshop.execute("write", {
          action: "write",
          path: "verifier/checker.sh",
          content: checkerSource,
        }),
      ),
    );
    expect(written).toMatchObject({
      status: "completed",
      result: {
        path: "verifier/checker.sh",
        bytes: new TextEncoder().encode(checkerSource).byteLength,
        sha256: new Bun.CryptoHasher("sha256").update(checkerSource).digest("hex"),
      },
    });
    expect(readFileSync(join(f.ossRoot, "verifier", "checker.sh"), "utf8")).toBe(checkerSource);
    const inspected = JSON.parse(
      text(await mounted.workshop.execute("inspect", { action: "inspect", path: "verifier" })),
    );
    expect(inspected).toMatchObject({
      status: "completed",
      result: {
        path: "verifier",
        files: 1,
        filesCaptured: 1,
        surveyed: 1,
        inventoryComplete: true,
        truncated: false,
      },
    });
    const requestInput = '{"protocol":"checker/v1","artifact":"$(not-executed)"}\n';
    const ranResult = await mounted.workshop.execute("run", {
      action: "run",
      cwd: "verifier",
      command: "make && ./smoke",
      stdin: requestInput,
    });
    const ran = JSON.parse(text(ranResult));
    expect(ran).toMatchObject({
      status: "completed",
      result: {
        exitCode: 0,
        output: "smoke ok\n",
        outputMode: "complete",
        outputTruncated: false,
      },
    });
    expect(ranResult.details).toMatchObject({
      sequence: 4,
      receipt: { workshopSequence: 4 },
    });
    expect(ran.message).toContain("not a checker verdict or truth result");
    expect(calls.every((call) => !call.envKeys.includes("BENIGN_WORKSHOP_CANARY"))).toBe(true);
    expect(
      calls
        .filter((call) => call.command === "/bin/cp")
        .every((call) => call.controllerReadFiles.length === 1),
    ).toBe(true);
    expect(
      calls.find((call) => call.stdinBytes === new TextEncoder().encode(checkerSource).byteLength),
    ).toBeDefined();
    expect(calls.find((call) => call.stdin === requestInput)).toBeDefined();

    const evidence = readFileSync(f.evidencePath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(evidence.map((row) => [row.action, row.outcome])).toEqual([
      ["fetch", "completed"],
      ["write", "completed"],
      ["inspect", "completed"],
      ["run", "completed"],
    ]);
    expect(evidence.map((row) => [row.schema, row.sequence])).toEqual([
      ["verifier-workshop-action/v2", 1],
      ["verifier-workshop-action/v2", 2],
      ["verifier-workshop-action/v2", 3],
      ["verifier-workshop-action/v2", 4],
    ]);
    expect(evidence.every((row) => /^[0-9a-f]{64}$/.test(row.requestDigest))).toBe(true);
    expect(evidence[3].requestDigest).toBe(
      actionRequestDigest("run", {
        command: "make && ./smoke",
        cwd: "verifier",
        stdinBytes: new TextEncoder().encode(requestInput).byteLength,
        stdinSha256: new Bun.CryptoHasher("sha256").update(requestInput).digest("hex"),
      }),
    );
    expect(evidence[0].subjectDigest).toBe(
      new Bun.CryptoHasher("sha256").update("archive bytes\n").digest("hex"),
    );
    expect(evidence[1].subjectDigest).toBe(
      new Bun.CryptoHasher("sha256").update(checkerSource).digest("hex"),
    );
    expect(evidence[0].origin).toEqual({
      initialUrl: "https://example.com/verifier.tar.gz",
      finalUrl: "https://example.com/verifier.tar.gz",
    });
    expect(evidence.slice(1).some((row) => "origin" in row)).toBe(false);
    expect(readFileSync(f.evidencePath, "utf8")).not.toContain("not-executed");
  });

  it.concurrent("refuses non-text or oversized run input before a process opens", async () => {
    const f = fixture("run-stdin-refusal");
    const calls: WorkshopCall[] = [];
    const mounted = tools(f, { runner: fakeRunner(calls) });
    for (const stdin of ["public\0request", "x".repeat(256 * 1024 + 1)]) {
      expect(
        JSON.parse(
          text(
            await mounted.workshop.execute("run", { action: "run", command: "python3 checker.py", stdin }),
          ),
        ),
      ).toMatchObject({ status: "failed", reason: "request-refused" });
    }
    expect(calls).toHaveLength(0);
  });

  it.concurrent("separates candidate failures from typed infrastructure non-results", async () => {
    const unavailable = fixture("unavailable");
    const unavailableRunner: VerifierWorkshopRunner = async () => {
      throw new CandidateIsolationUnavailable("seatbelt absent");
    };
    const missing = tools(unavailable, { runner: unavailableRunner });
    expect(
      JSON.parse(text(await missing.workshop.execute("run", { action: "run", command: "make" }))),
    ).toMatchObject({
      status: "non-result",
      reason: "mechanism-unavailable",
    });

    const signalled = fixture("signalled");
    const signalledRunner: VerifierWorkshopRunner = async () => ({
      stdout: "",
      stderr: "",
      stdoutTruncated: false,
      stderrTruncated: false,
      status: null,
      signal: "SIGKILL",
      timedOut: false,
    });
    const killed = tools(signalled, { runner: signalledRunner });
    expect(
      JSON.parse(text(await killed.workshop.execute("run", { action: "run", command: "kill -9 $$" }))),
    ).toMatchObject({
      status: "failed",
      reason: "process-signalled",
      message: expect.stringContaining("No checker verdict or truth was established"),
    });

    const verbose = fixture("verbose-failure");
    const verboseRunner: VerifierWorkshopRunner = async () =>
      outcome(`discarded-prefix-${"x".repeat(20_000)}-visible-tail`, "", 2);
    const verboseTool = tools(verbose, { runner: verboseRunner });
    const failed = JSON.parse(
      text(await verboseTool.workshop.execute("run", { action: "run", command: "make" })),
    );
    expect(failed).toMatchObject({
      status: "failed",
      reason: "command-failed",
      process: { exitCode: 2, outputMode: "tail", outputTruncated: true },
    });
    expect(failed.process.output).not.toContain("discarded-prefix");
    expect(failed.process.output).toContain("visible-tail");
    // This runner fails every command, the spill's own writes included, so nothing was stored and
    // the cut is still stated without advertising a file that does not exist.
    expect(failed.process.output).toContain("[Showing last");
    expect(failed.process.output).not.toContain("Full output");
    // The recorded row keeps the exit facts apart from the output: a chosen exit code here, the
    // signal for the simulated killed run, and null when isolation refused before launch.
    const recordedProcess = (path: string) =>
      readFileSync(path, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line).process);
    expect(recordedProcess(verbose.evidencePath)).toEqual([{ exitCode: 2, signal: null, timedOut: false }]);
    expect(recordedProcess(signalled.evidencePath)).toEqual([
      { exitCode: null, signal: "SIGKILL", timedOut: false },
    ]);
  });

  // The positive case and its nearest hostile neighbours: a long compiler failure keeps every line
  // where the workshop's own read can page it, output that fits stores nothing, and output past the
  // capture says the stored file stops where the capture did.
  it.concurrent("stores the whole output of a cut run where the workshop read can page it", async () => {
    const f = fixture("spilled-output");
    const calls: WorkshopCall[] = [];
    const files = fakeRunner(calls);
    let printed = outcome("");
    const runner: VerifierWorkshopRunner = async (policy, record, request) =>
      request.command === "/bin/sh" && request.args.at(-2) !== "workshop-write"
        ? printed
        : files(policy, record, request);
    const mounted = tools(f, { runner });
    const lines = Array.from({ length: 30_000 }, (_, index) => `line ${index + 1} of the build log`);
    printed = outcome(`first-error: undefined reference\n${lines.join("\n")}\n`, "", 2);
    const failed = JSON.parse(
      text(await mounted.workshop.execute("run", { action: "run", command: "make" })),
    );
    expect(failed).toMatchObject({
      status: "failed",
      process: { outputMode: "tail", outputTruncated: true },
    });
    const output: string = failed.process.output;
    expect(output).not.toContain("first-error");
    expect(output).toContain("line 30000 of the build log");
    const named =
      /\[Showing lines \d+-30001 of 30001 \(16\.0KB limit\)\. Full output: (\.run-output\/[^ ]+\.txt)/.exec(
        output,
      );
    const stored = named?.[1];
    if (stored === undefined) throw new Error(`cut run output named no stored file: ${output.slice(-400)}`);
    expect(output).toContain("verifier_workshop read");
    expect(failed.message).toContain(stored);
    expect(readFileSync(join(f.ossRoot, stored), "utf8")).toStartWith("first-error: undefined reference\n");

    // The stored file is larger than a whole-file read admits, and the window still reaches its head.
    const head = JSON.parse(
      text(await mounted.workshop.execute("read", { action: "read", path: stored, offset: 1, limit: 2 })),
    );
    expect(head).toMatchObject({ status: "completed", result: { from: 1, to: 2, more: true } });
    expect(head.result.text).toContain("first-error: undefined reference");

    printed = outcome("smoke ok\n");
    const small = JSON.parse(
      text(await mounted.workshop.execute("run", { action: "run", command: "./smoke" })),
    );
    expect(small.result.output).toBe("smoke ok\n");
    expect(readdirSync(join(f.ossRoot, ".run-output"))).toHaveLength(1);

    printed = { ...outcome(`${lines.join("\n")}\n`), stdoutTruncated: true };
    const capped = JSON.parse(
      text(await mounted.workshop.execute("run", { action: "run", command: "make" })),
    );
    expect(capped.result).toMatchObject({ outputMode: "captured-tail", captureTruncated: true });
    expect(capped.result.output).toContain("Full output: .run-output/");
    expect(capped.result.output).toContain("stops where the 4 MiB capture did");
  });

  it.concurrent("rejects lexical, physical, controller-staging, and non-public address escapes", async () => {
    const f = fixture("escape");
    const outside = join(f.epochDir, "outside.txt");
    writeFileSync(outside, "protected");
    symlinkSync(outside, join(f.ossRoot, "outside-link"));
    const calls: WorkshopCall[] = [];
    const mounted = tools(f, { runner: fakeRunner(calls) });
    expect(
      JSON.parse(text(await mounted.workshop.execute("lexical", { action: "read", path: "../outside.txt" }))),
    ).toMatchObject({ status: "failed", reason: "request-refused" });
    expect(
      JSON.parse(text(await mounted.workshop.execute("physical", { action: "read", path: "outside-link" }))),
    ).toMatchObject({ status: "failed", reason: "request-refused" });
    expect(
      JSON.parse(
        text(
          await mounted.workshop.execute("write-escape", {
            action: "write",
            path: "../escaped.txt",
            content: "must stay confined\n",
          }),
        ),
      ),
    ).toMatchObject({ status: "failed", reason: "request-refused" });
    expect(
      JSON.parse(
        text(
          await mounted.workshop.execute("write-symlink", {
            action: "write",
            path: "outside-link",
            content: "must not overwrite protected bytes\n",
          }),
        ),
      ),
    ).toMatchObject({ status: "failed", reason: "request-refused" });
    expect(calls).toHaveLength(0);
    expect(readFileSync(outside, "utf8")).toBe("protected");
    expect(
      readFileSync(f.evidencePath, "utf8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
        .map((evidence) => [evidence.action, evidence.outcome, evidence.reason]),
    ).toEqual([
      ["read", "failed", "request-refused"],
      ["read", "failed", "request-refused"],
      ["write", "failed", "request-refused"],
      ["write", "failed", "request-refused"],
    ]);
    for (const address of [
      "127.0.0.1",
      "10.0.0.1",
      "192.168.0.1",
      "::",
      "::1",
      "::ffff:127.0.0.1",
      "fe80::1",
      "2001:db8::1",
    ]) {
      expect(isPublicNetworkAddress(literal(address)), address).toBe(false);
    }
    expect(isPublicNetworkAddress(literal("8.8.8.8"))).toBe(true);
    expect(isPublicNetworkAddress(literal("2606:4700:4700::1111"))).toBe(true);

    const symlinked = fixture("controller-staging");
    const outsideTmp = join(symlinked.epochDir, "outside-tmp");
    mkdirSync(outsideTmp);
    symlinkSync(outsideTmp, join(symlinked.ossRoot, ".tmp"));
    expect(() => tools(symlinked)).toThrow(/directory escapes its cell/);
  });

  it.concurrent("settles broker refusals as failed source candidates", async () => {
    const f = fixture("source-refusal");
    const sourceBroker: PublicSourceBroker = async () => {
      throw new PublicSourceFailure(
        "failed",
        "source-refused",
        "source URL must resolve only to public network addresses",
      );
    };
    const mounted = tools(f, { sourceBroker });
    expect(
      JSON.parse(text(await mounted.source.execute("fetch", { url: "https://localhost/source" }))),
    ).toMatchObject({
      status: "failed",
      action: "fetch",
      reason: "source-refused",
    });
  });

  it.concurrent("pins a hostname only when every DNS answer is public", async () => {
    const publicLookup = async () => [{ address: "8.8.8.8", family: 4 as const }];
    await expect(
      resolvePublicHttpsTarget("https://sources.example/archive.tar.gz", publicLookup),
    ).resolves.toMatchObject({
      hostname: "sources.example",
      address: { address: "8.8.8.8", family: 4 },
    });
    const mixedLookup = async () => [
      { address: "8.8.8.8", family: 4 as const },
      { address: "127.0.0.1", family: 4 as const },
    ];
    await expect(
      resolvePublicHttpsTarget("https://sources.example/archive.tar.gz", mixedLookup),
    ).rejects.toMatchObject({
      outcome: "failed",
      reason: "source-refused",
    });
  });

  it.concurrent("makes a bounded inspect survey explicit instead of reporting a partial count as complete", () => {
    const paths = Array.from({ length: 8_002 }, (_, index) => `/cell/file-${index}.c`).join("\n");
    expect(surveyVerifierSource(`${paths}\n`, "/cell")).toMatchObject({
      files: 8_002,
      filesCaptured: 8_002,
      surveyed: 8_000,
      inventoryComplete: false,
      truncated: true,
    });
  });
});

describe.if(osIsolationSupport().ok)("the executed correctness-model workshop isolation", () => {
  it.concurrent("inspects its files without reading the enclosing checkout's Git metadata", async () => {
    const f = fixture("physical-inspect-worktree");
    // Worktree .git is a file. Ripgrep reads it during VCS discovery even with --no-ignore-parent.
    writeFileSync(join(f.repoRoot, ".git"), "gitdir: /unreadable-controller-history\n");
    writeFileSync(join(f.ossRoot, "checker.c"), "int main(void) { return 0; }\n");
    const mounted = tools(f);
    const inspected = JSON.parse(text(await mounted.workshop.execute("inspect", { action: "inspect" })));
    expect(inspected).toMatchObject({
      status: "completed",
      result: { files: 1, inventoryComplete: true, truncated: false },
    });
    for (const name of [".git", "node_modules", ".venv"]) {
      mkdirSync(join(f.ossRoot, name));
      writeFileSync(join(f.ossRoot, name, "excluded"), "excluded\n");
    }
    const excluded = JSON.parse(text(await mounted.workshop.execute("excluded", { action: "inspect" })));
    expect(excluded).toMatchObject({
      status: "completed",
      result: { files: 1, inventoryComplete: true, truncated: false },
    });
    const denied = JSON.parse(
      text(
        await mounted.workshop.execute("private", {
          action: "run",
          command: `/bin/cat '${join(f.repoRoot, ".git")}'`,
        }),
      ),
    );
    expect(denied).toMatchObject({ status: "failed", reason: "command-failed", process: { exitCode: 1 } });
    expect(denied.process.output).not.toContain("gitdir:");
  });

  it.concurrent("copies only the controller-staged public source into its cell", async () => {
    const f = fixture("physical-source-copy");
    const mounted = tools(f, { sourceBroker: fakeSource("physical archive\n") });
    const result = JSON.parse(
      text(await mounted.source.execute("fetch", { url: "https://example.com/source.tar.gz" })),
    );
    expect(result).toMatchObject({ status: "completed", action: "fetch" });
    expect(readFileSync(join(f.ossRoot, result.result.path), "utf8")).toBe("physical archive\n");
  });

  it.concurrent("refuses an offline network connection while the host control can reach it", async () => {
    const f = fixture("physical-network");
    let requests = 0;
    // `Bun.listen` binds before it returns and `stop(true)` closes the live connections with it, so
    // the fixture keeps no socket set of its own and asserts nothing about `address()`.
    const server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open: (socket) => {
          requests += 1;
          socket.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok");
        },
        data: () => {},
      },
    });
    try {
      expect(await (await fetch(`http://127.0.0.1:${server.port}`)).text()).toBe("ok");
      const mounted = tools(f);
      const result = JSON.parse(
        text(
          await mounted.workshop.execute("run", {
            action: "run",
            command: `/usr/bin/curl --fail --silent --max-time 2 http://127.0.0.1:${server.port}`,
          }),
        ),
      );
      expect(result).toMatchObject({ status: "failed", reason: "command-failed" });
      expect(requests).toBe(1);
    } finally {
      server.stop(true);
    }
  });

  it.concurrent("writes its own cell while refusing the named credential roots", async () => {
    const f = fixture("physical-files");
    {
      const mounted = tools(f);
      // The workshop gained platform-file and ordinary home-file reads to let installed tools
      // resolve their prefixes, trust stores and SDKs. Those grants include paths outside its own
      // directory, so the credential exclusions must still apply within the broader read area.
      // This test exercises the configured protected roots while allowing a write inside the cell.
      // It covers those named exclusions, not every possible location where a secret might exist.
      for (const denied of protectedHomeReadRoots().map((root) => join(root, "id_ed25519"))) {
        const result = JSON.parse(
          text(
            await mounted.workshop.execute("run", {
              action: "run",
              command: `printf allowed > marker.txt; /bin/cat ${JSON.stringify(denied)}`,
            }),
          ),
        );
        expect(result).toMatchObject({ status: "failed", reason: "command-failed" });
      }
      expect(readFileSync(join(f.ossRoot, "marker.txt"), "utf8")).toBe("allowed");
    }
  });

  it.concurrent("writes exact multiline source through standard input without shell interpolation", async () => {
    const f = fixture("physical-exact-write");
    const mounted = tools(f);
    const source = '#!/bin/sh\nprintf "%s\\n" "$1"\n# $(touch should-not-run)\n';
    const result = JSON.parse(
      text(
        await mounted.workshop.execute("write", {
          action: "write",
          path: "checker.sh",
          content: source,
        }),
      ),
    );
    expect(result).toMatchObject({ status: "completed", action: "write" });
    expect(readFileSync(join(f.ossRoot, "checker.sh"), "utf8")).toBe(source);
    expect(existsSync(join(f.ossRoot, "should-not-run"))).toBe(false);
  });

  it.concurrent("passes exact public request input without shell interpretation", async () => {
    const f = fixture("physical-exact-stdin");
    const mounted = tools(f);
    const stdin = '{"value":"$(touch should-not-run)"}\n';
    const result = JSON.parse(
      text(await mounted.workshop.execute("run", { action: "run", command: "/bin/cat", stdin })),
    );
    expect(result).toMatchObject({ status: "completed", result: { output: stdin } });
    expect(existsSync(join(f.ossRoot, "should-not-run"))).toBe(false);
  });

  it.concurrent("compiles and runs a real C checker without ambient user scratch authority", async () => {
    const f = fixture("physical-c-compiler");
    writeFileSync(
      join(f.ossRoot, "checker.c"),
      '#include <stdio.h>\nint main(void) { puts("checker-ok"); return 0; }\n',
    );
    const mounted = tools(f);
    const result = JSON.parse(
      text(
        await mounted.workshop.execute("compile", {
          action: "run",
          command: "cc checker.c -o checker && ./checker",
        }),
      ),
    );
    expect(result).toMatchObject({
      status: "completed",
      result: { exitCode: 0, output: "checker-ok\n", outputMode: "complete" },
    });
  });

  it.concurrent.if(runtimeProcess.platform === "darwin")(
    "shares Darwin's ambient user temp with the authoring session and still refuses run data there",
    async () => {
      // The workshop gained these scratch roots when `--workshop-tmp` was removed and the host
      // scratch grant became unconditional. The historical reason was a download-and-unpack handoff:
      // one process downloaded a toolchain and another unpacked it in the offline workshop.
      // Recorded on 2026-08-19: a Builder installing a scientific library unpacked 71 MB of wheels
      // through this route. Shared scratch also makes other processes' temporary files readable.
      // This test states that access explicitly and checks the remaining filename exclusions.
      // The permitted scratch location does not override a denial for a protected filename;
      // files with other names remain outside the protection this test establishes.
      const f = fixture("physical-user-scratch");
      const roots = ["DARWIN_USER_TEMP_DIR", "DARWIN_USER_CACHE_DIR"].map((name) => {
        const value = spawnSync("/usr/bin/getconf", [name]).stdout.trim();
        return realpathSync.native(value);
      });
      const canaryDirs = roots.map((root) => mkdtempSync(join(root, "ana-workshop-canary-")));
      try {
        const mounted = tools(f);
        for (const dir of canaryDirs) {
          const canary = join(dir, "read.txt");
          const target = join(dir, "write.txt");
          writeFileSync(canary, "AMBIENT-SCRATCH-CANARY\n");
          const read = JSON.parse(
            text(
              await mounted.workshop.execute("scratch-read", {
                action: "run",
                command: `/bin/cat ${JSON.stringify(canary)}`,
              }),
            ),
          );
          expect(read).toMatchObject({ status: "completed", result: { exitCode: 0 } });
          expect(read.result.output).toContain("AMBIENT-SCRATCH-CANARY");
          const write = JSON.parse(
            text(
              await mounted.workshop.execute("scratch-write", {
                action: "run",
                command: `printf staged > ${JSON.stringify(target)}`,
              }),
            ),
          );
          expect(write).toMatchObject({ status: "completed", result: { exitCode: 0 } });
          expect(existsSync(target)).toBe(true);

          // The hidden-tasks filename remains denied within these permitted scratch roots.
          // Staging that file here must not make it readable, and the returned failure must not
          // include its contents.
          const hidden = join(dir, "hidden-tasks.json");
          writeFileSync(hidden, '{"HIDDEN-TASKS-CANARY": true}\n');
          const denied = JSON.parse(
            text(
              await mounted.workshop.execute("hidden-read", {
                action: "run",
                command: `/bin/cat ${JSON.stringify(hidden)}`,
              }),
            ),
          );
          expect(denied).toMatchObject({ status: "failed", reason: "command-failed" });
          expect(JSON.stringify(denied)).not.toContain("HIDDEN-TASKS-CANARY");
        }
      } finally {
        for (const dir of canaryDirs) rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it.concurrent("the cell neutralises OPENSSL_CONF and accepts a multi-line command (run w11: 5 Node startup failures, 10 newline refusals)", () => {
    const root = join(SCRATCH, "cell-profile");
    mkdirSync(root, { recursive: true });
    expect(workshopEnvironment(realpathSync.native(root)).OPENSSL_CONF).toBe("/dev/null");
    expect(verifierWorkshopCommand("make\n./smoke", 1024)).toBe("make\n./smoke");
    expect(() => verifierWorkshopCommand("make\0./smoke", 1024)).toThrow(/NUL/);
  });
});
