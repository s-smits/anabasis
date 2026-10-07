import { afterAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { type Task, openVerifier } from "../src/kernel/verify.ts";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { join, relative } from "../src/meta/path.ts";
import { osIsolationSupport } from "../src/verify/os-isolation.ts";

const EVALUATOR = `import { readFileSync } from "node:fs";
export const checks = {
  value: (req) => req.artifact.value === req.publicTask.publicInput.target,
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
  slow: async (_req, runtime) => {
    await runtime.tools.run({ toolId: "sleeper", args: [], timeoutMs: 100 });
    return true;
  },
};
`;

setDefaultTimeout(60_000);

const root = mkdtempSync(join(tmpdir(), "ana-verify-"));
/** Where a concurrent check's cell would hold its answer. */
const sibling = mkdtempSync(join(tmpdir(), "ana-cell-"));
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
    { id: "slow", execution: execution(["slow"], [], [], ["sleeper"]) },
  ],
};

function task(family: string, publicInput: Task["publicInput"] = {}): Task {
  return { taskId: `${family}-01`, family, publicInput, hidden: [] };
}

function tool(name: string, script: string): void {
  const path = join(root, "tools", "bin", name);
  writeFileSync(path, `#!/bin/sh\n${script}\n`);
  chmodSync(path, 0o755);
}

// The tree is written at load, because the suite below opens its verifier when it is collected.
mkdirSync(join(root, "checks"));
mkdirSync(join(root, "tools", "bin"), { recursive: true });
writeFileSync(join(root, "checks", "brief.json"), JSON.stringify(BRIEF));
writeFileSync(join(root, "checks", "evaluator.ts"), EVALUATOR);
writeFileSync(secret, "another answer");
tool("double", "read n; echo $((n * 2))");
tool("sleeper", "sleep 30");
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("open") });

afterAll(async () => {
  await server.stop(true);
  for (const dir of [root, sibling]) rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!osIsolationSupport().ok)("the verifier", () => {
  const verify = openVerifier({ checks: join(root, "checks"), tools: join(root, "tools") });

  it("passes an answer every check accepts, running a check's tool from the verifier's tree off the request", async () => {
    expect(await verify(task("plain", { target: 21 }), { value: 21 })).toEqual({ kind: "pass" });
  });

  it("takes its tree by a relative path as well, since the wall it builds wants absolute roots", async () => {
    const near = openVerifier({
      checks: relative(".", join(root, "checks")),
      tools: relative(".", join(root, "tools")),
    });
    expect(await near(task("plain", { target: 21 }), { value: 21 })).toEqual({ kind: "pass" });
  });

  it("fails an answer and names the checks that refused it", async () => {
    expect(await verify(task("plain", { target: 21 }), { value: 20 })).toEqual({
      kind: "fail",
      blocking: ["value"],
    });
  });

  it("fails no answer without running a check", async () => {
    expect(await verify(task("throws"), undefined)).toEqual({ kind: "fail", blocking: [] });
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

  it("reads a check that throws as a non-result, not a fail", async () => {
    const verdict = await verify(task("throws"), {});
    expect(verdict).toEqual({ kind: "non-result", reason: "throws: the check threw: no such rule" });
  });

  it("reads a tool that runs out its time as a non-result, whatever the check returns", async () => {
    expect(await verify(task("slow"), {})).toEqual({
      kind: "non-result",
      reason: "slow: sleeper ran past 100 ms",
    });
  });
});
