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
import { join, relative } from "../src/meta/path.ts";
import { osIsolationSupport } from "../src/verify/os-isolation.ts";
import { hostScratch } from "../src/verify/wall-policy.ts";

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
  lapses: async (_req, runtime) => {
    await runtime.tools.run({ toolId: "sleeper", args: [], timeoutMs: 100 });
    throw new Error("no evidence");
  },
  host: async (req) => (await req.runtime.tools.run({ toolId: "sh", args: ["-c", "exit 0"] })).exitCode === 0,
  slow: async (_req, runtime) => {
    await runtime.tools.run({ toolId: "sleeper", args: [], timeoutMs: 100 });
    return true;
  },
  ran: async (req) => (await req.runtime.tools.run({ toolId: req.publicTask.publicInput.tool })).exitCode === 0,
};
`;

/** A check program with an objective: the mass of an answer, lower being better, which the
 *  evaluator computes from the answer and the public input alone. `mode` in the public input makes
 *  it misbehave, so one program covers each way the measure can fail. */
const MEASURED_EVALUATOR = `export const checks = {
  value: (req) => req.artifact.value > 0,
  sees: (req) => req.hidden.length === 0,
};
export const objective = (req) => {
  const mode = req.publicTask.publicInput.mode;
  if (mode === "nan") return Number.NaN;
  if (mode === "string") return "light";
  if (mode === "throws") throw new Error("no scale");
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
    { id: "lapses", execution: execution(["lapses"], [], [], ["sleeper"]) },
    { id: "slow", execution: execution(["slow"], [], [], ["sleeper"]) },
    { id: "host", execution: execution(["host"], [], [], ["sh"]) },
    {
      id: "ran",
      execution: execution(
        ["ran"],
        [],
        ["$.tool"],
        ["killed", "unlaunched", "unstarted", "refuses", "compiles"],
      ),
    },
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
tool("killed", "kill -KILL $$");
tool("unlaunched", 'exec "$(dirname "$0")/missing"');
tool("unstarted", "echo 'Fatal Python error: init_fs_encoding: failed to get the Python codec' >&2; exit 1");
tool("refuses", "echo no; exit 127");
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

  it("reads a check that throws after its tool lapsed as the verifier's non-result", async () => {
    expect(await verify(task("lapses"), {})).toEqual({
      kind: "non-result",
      reason: "lapses: sleeper ran past 100 ms",
    });
  });

  it("reads a tool that runs out its time as a non-result, whatever the check returns", async () => {
    expect(await verify(task("slow"), {})).toEqual({
      kind: "non-result",
      reason: "slow: sleeper ran past 100 ms",
    });
  });

  it("reads a tool a signal ended, or whose program never started, as a non-result, not a refusal", async () => {
    const ran = async (toolId: string) => await verify(task("ran", { tool: toolId }), {});
    expect(await ran("killed")).toEqual({ kind: "non-result", reason: "ran: killed was ended by SIGKILL" });
    for (const toolId of ["unlaunched", "unstarted"]) {
      expect(await ran(toolId)).toMatchObject({
        kind: "non-result",
        reason: expect.stringMatching(new RegExp(`^ran: ${toolId} exited 1\\d* before its program ran: `)),
      });
    }
    // A program may exit 127 itself; having printed, it answered.
    expect(await ran("refuses")).toEqual({ kind: "fail", blocking: ["ran"] });
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

  it("reads an objective that is no finite number, or throws, as faulty under its own name", async () => {
    for (const [mode, reason] of [
      ["nan", "the objective returned NaN"],
      ["string", "the objective returned string"],
      ["throws", "the objective threw: no scale"],
    ] as const) {
      expect(await verify(task("plain", { density: 3, mode }), { value: 7 })).toEqual({
        kind: "faulty",
        check: "objective",
        reason,
      });
    }
  });

  it("reads a brief that declares an objective its program does not export as faulty", async () => {
    const unexported = join(root, "unexported");
    mkdirSync(unexported);
    writeFileSync(join(unexported, "brief.json"), JSON.stringify(MEASURED_BRIEF));
    writeFileSync(
      join(unexported, "evaluator.ts"),
      MEASURED_EVALUATOR.replace("export const objective", "const objective"),
    );
    const bare = openVerifier({ checks: unexported, tools: join(root, "tools") });
    expect(await bare(task("plain", { density: 3 }), { value: 7 })).toEqual({
      kind: "faulty",
      check: "objective",
      reason: "the check program has no objective",
    });
  });

  it("refuses a brief with a check named objective, and measures nothing where none is declared", async () => {
    const named = join(root, "named");
    mkdirSync(named);
    writeFileSync(
      join(named, "brief.json"),
      JSON.stringify({
        ...MEASURED_BRIEF,
        truthChecks: [
          ...MEASURED_BRIEF.truthChecks,
          { id: "objective", execution: execution(["plain"], [], []) },
        ],
      }),
    );
    writeFileSync(join(named, "evaluator.ts"), MEASURED_EVALUATOR);
    expect(() => openVerifier({ checks: named, tools: join(root, "tools") })).toThrow(
      "a check is named objective, which names the objective",
    );
    const undeclared = join(root, "undeclared");
    mkdirSync(undeclared);
    const { objective: _declared, ...rest } = MEASURED_BRIEF;
    writeFileSync(join(undeclared, "brief.json"), JSON.stringify(rest));
    writeFileSync(join(undeclared, "evaluator.ts"), MEASURED_EVALUATOR);
    const plain = openVerifier({ checks: undeclared, tools: join(root, "tools") });
    expect(await plain(task("plain", { density: 3 }), { value: 7 })).toEqual({ kind: "pass" });
  });
});
