import { afterAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { type Task, openVerifier } from "../src/kernel/verify.ts";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { join } from "../src/meta/path.ts";
import { killProcessGroupId } from "../src/meta/subprocess.ts";
import { osIsolationSupport } from "../src/wall/os-isolation.ts";
import { hostScratch } from "../src/wall/policy.ts";

const DETACHED_MARKER = `ana-verifier-deadline-child-${crypto.randomUUID()}`;

const EVALUATOR = `import { readFileSync } from "node:fs";
import { same } from "./reference/model.ts";
export const checks = {
  value: (req) => same(req.artifact.value, req.publicTask.publicInput.target),
  tool: async (req) => {
    const run = await req.runtime.tools.run({ toolId: "double", args: [], stdin: String(req.artifact.value) });
    return run.exitCode === 0 && run.stdout.trim() === String(req.artifact.value * 2);
  },
  walled: async (req) => {
    let read = true;
    try { readFileSync(req.publicTask.publicInput.secret); } catch { read = false; }
    let fetched = true;
    try { await fetch(req.publicTask.publicInput.url); } catch { fetched = false; }
    return !read && !fetched;
  },
  projection: (req) => !("note" in req.artifact),
  throws: () => { throw new Error("no such rule"); },
  answers: () => "yes",
  host: async (req) => (await req.runtime.tools.run({ toolId: "sh", args: ["-c", "exit 0"] })).exitCode === 0,
  slow: async (_req, runtime) => {
    await runtime.tools.run({ toolId: "sleeper", args: [], timeoutMs: 100 });
    return true;
  },
  late: async () => {
    await Bun.sleep(500);
    throw new Error("decided late");
  },
  early: () => "no",
  first: async () => (await Bun.sleep(1000), true),
  second: async () => (await Bun.sleep(1000), true),
  ran: async (req) => (await req.runtime.tools.run({ toolId: req.publicTask.publicInput.tool })).exitCode === 0,
  deadline: async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        "-e",
        "setTimeout(() => process.exit(75), 10000); setInterval(() => undefined, 1000); await new Promise(() => {})",
        "${DETACHED_MARKER}",
      ],
      {
        detached: true,
        stdout: "ignore",
        stderr: "inherit",
      },
    );
    await child.exited;
    return true;
  },
};
`;

/** A check program with an objective computed from the answer and the public input alone. */
const MEASURED_EVALUATOR = `export const checks = {
  value: (req) => req.artifact.value > 0,
  sees: (req) => req.hidden.length === 0,
};
export const objective = (req) => {
  return req.artifact.value * req.publicTask.publicInput.density;
};
`;
setDefaultTimeout(60_000);

const root = mkdtempSync(join(tmpdir(), "ana-verify-"));
/** Where a concurrent check's cell would hold its answer. */
const sibling = hostScratch("cell-");
const secret = join(sibling, "answer.json");

function execution(
  families: string[],
  artifactPaths: string[],
  publicInputPaths: string[],
  tools?: string[],
) {
  return {
    families,
    artifactPaths,
    publicInputPaths,
    hidden: "none",
    ...keyIfDefined("requiredToolIds", tools),
    evidence: { kind: "authored" },
  };
}

const BRIEF = {
  correctnessContract: "check-program/v1",
  truthChecks: [
    { id: "value", execution: execution(["plain"], ["$.value"], ["$.target"]) },
    { id: "tool", execution: execution(["plain"], ["$.value"], [], ["double"]) },
    { id: "walled", execution: execution(["walled"], [], ["$.secret", "$.url"]) },
    { id: "projection", execution: execution(["projection"], ["$.value"], []) },
    { id: "throws", execution: execution(["throws"], [], []) },
    { id: "answers", execution: execution(["answers"], [], []) },
    { id: "slow", execution: execution(["slow"], [], [], ["sleeper"]) },
    { id: "host", execution: execution(["host"], [], [], ["sh"]) },
    { id: "late", execution: execution(["order"], [], []) },
    { id: "early", execution: execution(["order"], [], []) },
    { id: "first", execution: execution(["pair"], [], []) },
    { id: "second", execution: execution(["pair"], [], []) },
    {
      id: "ran",
      execution: execution(["ran"], [], ["$.tool"], ["compiles"]),
    },
    { id: "deadline", execution: execution(["deadline"], [], []) },
  ],
};

const MEASURED_BRIEF = {
  correctnessContract: "check-program/v1",
  truthChecks: [
    { id: "value", execution: execution(["plain"], ["$.value"], []) },
    { id: "sees", execution: execution(["plain"], [], []) },
  ],
  objective: { quantity: "mass in kg", direction: "lower" },
};

function task(family: string, publicInput: Task["publicInput"] = {}): Task {
  return { taskId: `${family}-01`, family, publicInput, hidden: [] };
}

function tool(name: string, script: string): void {
  const path = join(root, "tools", "bin", name);
  writeFileSync(path, `#!/bin/sh\n${script}\n`);
  chmodSync(path, 0o755);
}

function markedProcesses(): string[] {
  const result = Bun.spawnSync({
    cmd: ["ps", "-axo", "pid=,command="],
    stdout: "pipe",
    stderr: "ignore",
  });
  if (result.exitCode !== 0) throw new Error(`ps failed with exit ${String(result.exitCode)}`);
  return result.stdout
    .toString()
    .split("\n")
    .filter((line) => line.includes(DETACHED_MARKER));
}

async function waitForMarkedProcess(present: boolean): Promise<void> {
  const deadline = performance.now() + 2_000;
  while (performance.now() < deadline) {
    const found = markedProcesses().length > 0;
    if (found === present) return;
    await Bun.sleep(10);
  }
  throw new Error(`the detached verifier child was ${present ? "not started" : "not reaped"}`);
}

function killMarkedProcesses(): void {
  for (const line of markedProcesses()) {
    const pid = Number(line.trim().split(/\s+/, 1)[0]);
    if (Number.isSafeInteger(pid)) killProcessGroupId(pid, "SIGKILL");
  }
}

// The tree is written at load, because the suite below opens its verifier when it is collected.
mkdirSync(join(root, "checks"));
mkdirSync(join(root, "tools", "bin"), { recursive: true });
writeFileSync(join(root, "checks", "brief.json"), JSON.stringify(BRIEF));
writeFileSync(join(root, "checks", "evaluator.ts"), EVALUATOR);
// As both check programs v1 wrote on 7 October do, the program imports a module from a directory.
mkdirSync(join(root, "checks", "reference"));
writeFileSync(join(root, "checks", "reference", "model.ts"), "export const same = (a, b) => a === b;\n");
writeFileSync(secret, "another answer");
tool("double", "read n; echo $((n * 2))");
tool("sleeper", "sleep 30");
tool("compiles", 'echo "int main(void) { return 0; }" > p.c && /usr/bin/cc p.c -o p && ./p');
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("open") });

afterAll(async () => {
  await server.stop(true);
  for (const dir of [root, sibling]) rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!osIsolationSupport().ok)("the verifier", () => {
  const verify = openVerifier({ checks: join(root, "checks"), tools: join(root, "tools") });

  it("passes an answer every check accepts, running a module the program imports and a tool from the verifier's tree", async () => {
    expect(await verify(task("plain", { target: 21 }), { value: 21 })).toEqual({ kind: "pass" });
  });

  it("fails an answer and names the checks that refused it", async () => {
    expect(await verify(task("plain", { target: 21 }), { value: 20 })).toEqual({
      kind: "fail",
      blocking: ["value"],
    });
  });

  it("keeps a check offline and out of a concurrent check's cell", async () => {
    // Both are open to the host, so a pass is the wall refusing them.
    expect(readFileSync(secret, "utf8")).toBe("another answer");
    expect(await (await fetch(server.url)).text()).toBe("open");
    expect(await verify(task("walled", { secret, url: server.url.href }), {})).toEqual({ kind: "pass" });
  });

  it("hands a check only the answer paths it declares", async () => {
    expect(await verify(task("projection"), { value: 1, note: "undeclared" })).toEqual({ kind: "pass" });
  });

  it("runs a verdict's checks at once, and lets the first in the brief's order decide", async () => {
    // Two checks of a second each, one after the other, took two seconds.
    const started = performance.now();
    expect(await verify(task("pair"), {})).toEqual({ kind: "pass" });
    expect(performance.now() - started).toBeLessThan(1800);
    // The later check is faulty first, and the earlier one still names the verdict.
    expect(await verify(task("order"), {})).toEqual({
      kind: "faulty",
      check: "late",
      reason: "the check threw: decided late",
    });
  });

  it("reads a check that throws or returns no boolean as faulty, neither a fail nor a non-result", async () => {
    expect(await verify(task("throws"), {})).toEqual({
      kind: "faulty",
      check: "throws",
      reason: "the check threw: no such rule",
    });
    expect(await verify(task("answers"), {})).toEqual({
      kind: "faulty",
      check: "answers",
      reason: "the check returned string",
    });
  });

  it("reads a tool that runs out its time as a non-result, whatever the check returns", async () => {
    expect(await verify(task("slow"), {})).toEqual({
      kind: "non-result",
      reason: "slow: sleeper ran past 100 ms",
    });
  });

  // The verifier's own deny-default wall once refused clang its toolchain and the scratch it takes
  // through `confstr` rather than `TMPDIR`; a check's tool that builds what it runs needs both.
  it.if(existsSync("/usr/bin/cc"))("lets a check's tool compile through the host toolchain", async () => {
    expect(await verify(task("ran", { tool: "compiles" }), {})).toEqual({ kind: "pass" });
  });

  it("finds a check's tool only in the verifier's tree, never the host's copy", async () => {
    expect(await verify(task("host"), {})).toEqual({
      kind: "non-result",
      reason: "host: sh is not on the verifier's tool path",
    });
  });

  it("cancels a check and its detached descendant before returning", async () => {
    const controller = new AbortController();
    const pending = verify(task("deadline"), {}, controller.signal);
    try {
      await waitForMarkedProcess(true);
      controller.abort();
      const outcome = await Promise.race([pending, Bun.sleep(3_000).then(() => null)]);
      if (outcome === null) {
        // Bound the old implementation, which ignored the signal and awaited the descendant's pipe.
        killMarkedProcesses();
        await waitForMarkedProcess(false);
        await pending;
        throw new Error("the verifier did not return after cancellation");
      } else {
        expect(outcome).toMatchObject({ kind: "non-result" });
        expect(markedProcesses()).toEqual([]);
      }
    } finally {
      controller.abort();
      killMarkedProcesses();
      await waitForMarkedProcess(false);
    }
    expect(await verify(task("plain", { target: 21 }), { value: 21 })).toEqual({ kind: "pass" });

    const preAborted = new AbortController();
    preAborted.abort();
    await expect(verify(task("deadline"), {}, preAborted.signal)).resolves.toMatchObject({
      kind: "non-result",
    });
    expect(markedProcesses()).toEqual([]);
  });

  it("refuses a check program with a symlink in it when it opens", () => {
    const linked = join(root, "linked");
    cpSync(join(root, "checks"), linked, { recursive: true });
    symlinkSync(secret, join(linked, "reference", "answer.json"));
    expect(() => openVerifier({ checks: linked, tools: join(root, "tools") })).toThrow(
      "the check program's reference/answer.json is neither a file nor a directory",
    );
  });
});

describe.skipIf(!osIsolationSupport().ok)("the objective", () => {
  const checks = join(root, "measured");
  mkdirSync(checks);
  writeFileSync(join(checks, "brief.json"), JSON.stringify(MEASURED_BRIEF));
  writeFileSync(join(checks, "evaluator.ts"), MEASURED_EVALUATOR);
  const verify = openVerifier({ checks, tools: join(root, "tools") });

  it("measures a valid answer after its checks pass, and measures no refused answer", async () => {
    expect(await verify(task("plain", { density: 3 }), { value: 7 })).toEqual({
      kind: "pass",
      objective: 21,
    });
    expect(await verify(task("plain", { density: 3 }), { value: 0 })).toEqual({
      kind: "fail",
      blocking: ["value"],
    });
  });
});
