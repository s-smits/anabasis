import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { EVALUATOR_FILE } from "../src/meta/bundle-layout.ts";
import {
  checkEvaluationRequest,
  engineReadRoots,
  openVerifier,
  pinnedEngines,
  type Task,
  type Verdict,
} from "../src/kernel/verify.ts";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { killProcessGroupId } from "../src/meta/subprocess.ts";
import { osIsolationSupport } from "../src/sandbox/os-isolation.ts";
import { hostScratch } from "../src/sandbox/policy.ts";
import { releaseRoot } from "../src/sandbox/sandbox-root.ts";

/** A word only the processes a test starts carry on their command line, so `ps` finds them. */
const MARK = `ana-verify-${crypto.randomUUID().slice(0, 8)}`;
/** A tool that outlives any check that runs it, and a process a check detaches, each named so that
 *  `ps` finds it alone. */
const LINGER = `linger-${MARK}`;
const DETACHED = `detached-${MARK}`;

/** One check program for every case, each case a family of the brief, so one opening serves all. */
const PROGRAM = `import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { same } from "./reference/model.ts";
const meet = async (own, other) => {
  writeFileSync(own, "here");
  for (let waited = 0; waited < 2000; waited += 50) {
    if (existsSync(other)) return true;
    await Bun.sleep(50);
  }
  return false;
};
export const checks = {
  value: (req) => same(req.artifact.value, req.publicTask.publicInput.target),
  doubled: async (req) => {
    const run = await req.runtime.tools.run({ toolId: "double", stdin: String(req.artifact.value) });
    return run.exitCode === 0 && run.stdout.trim() === String(req.artifact.value * 2);
  },
  walled: async (req) => {
    let read = true;
    try { readFileSync(req.publicTask.publicInput.secret); } catch { read = false; }
    let fetched = true;
    try { await fetch(req.publicTask.publicInput.url); } catch { fetched = false; }
    return !read && !fetched;
  },
  projected: (req) => !("note" in req.artifact),
  throws: () => { throw new Error("no such rule"); },
  says: () => "yes",
  hostShell: async (req) => (await req.runtime.tools.run({ toolId: "sh", args: ["-c", "exit 0"] })).exitCode === 0,
  slowTool: async (_req, runtime) => {
    await runtime.tools.run({ toolId: "sleeper", timeoutMs: 100 });
    return true;
  },
  nanTimeout: async (_req, runtime) => {
    await runtime.tools.run({ toolId: "sleeper", timeoutMs: Number.NaN });
    return true;
  },
  hungTool: async (_req, runtime) => {
    await runtime.tools.run({ toolId: "sleeper" });
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
  left: () => meet("mark-left", "mark-right"),
  right: () => meet("mark-right", "mark-left"),
  hangs: () => new Promise(() => {}),
  lingers: async (req) => (await req.runtime.tools.run({ toolId: "${LINGER}" }), true),
  answers: () => true,
  fast: () => true,
  spins: () => { for (;;) {} },
  spinsAfterFast: async () => {
    await Bun.sleep(40);
    for (;;) {}
  },
  exits: () => process.exit(0),
  detaches: async () => {
    const child = Bun.spawn([process.execPath, "-e", "await new Promise(() => {})", "${DETACHED}"], {
      detached: true,
      stdout: "ignore",
    });
    await child.exited;
    return true;
  },
};
`;

/** A program with an objective: of the answer and public input against the hidden value (mode
 *  `truth`), of what a check left in the cell (mode `cell`), or no finite number. */
const MEASURED = `import { existsSync, writeFileSync } from "node:fs";
export const checks = {
  value: (req) => (writeFileSync("mark-value", "here"), req.artifact.value > 0),
  sees: (req) => req.hidden.length === 0,
};
export const objective = (req) => {
  const mode = req.publicTask.publicInput.mode;
  if (mode === "nan") return Number.NaN;
  if (mode === "infinity") return Number.POSITIVE_INFINITY;
  if (mode === "string") return "light";
  if (mode === "throws") throw new Error("no scale");
  if (mode === "truth") return Math.abs(req.artifact.value - req.hidden.truth);
  if (mode === "cell") return existsSync("mark-value") ? 1 : 0;
  return req.artifact.value * req.publicTask.publicInput.density;
};
`;

const root = mkdtempSync(join(tmpdir(), "ana-verify-"));
const tools = join(root, "tools");
const sibling = hostScratch("cell-");
const secret = join(sibling, "answer.json");

const check = (
  id: string,
  family: string,
  paths: { artifact?: string[]; input?: string[]; tools?: string[] } = {},
) => ({
  id,
  execution: {
    families: [family],
    artifactPaths: paths.artifact ?? [],
    publicInputPaths: paths.input ?? [],
    hidden: "none",
    ...keyIfDefined("requiredToolIds", paths.tools),
    evidence: { kind: "authored" },
  },
});

const BRIEF = {
  correctnessContract: "check-program/v1",
  truthChecks: [
    check("value", "plain", { artifact: ["$.value"], input: ["$.target"] }),
    check("doubled", "plain", { artifact: ["$.value"], tools: ["double"] }),
    check("walled", "walled", { input: ["$.secret", "$.url"] }),
    check("projected", "projected", { artifact: ["$.value"] }),
    check("throws", "throws"),
    check("says", "says"),
    check("slowTool", "slowTool", { tools: ["sleeper"] }),
    check("nanTimeout", "nanTimeout", { tools: ["sleeper"] }),
    check("hungTool", "hungTool", { tools: ["sleeper"] }),
    check("hostShell", "hostShell", { tools: ["sh"] }),
    check("late", "order"),
    check("early", "order"),
    check("first", "pair"),
    check("second", "pair"),
    check("ran", "ran", {
      input: ["$.tool"],
      tools: ["compiles", "killed", "unlaunched", "unstarted", "refuses"],
    }),
    check("left", "cell"),
    check("right", "cell"),
    check("hangs", "hang"),
    check("answers", "hang"),
    check("lingers", "linger", { tools: [LINGER] }),
    check("spins", "spin"),
    check("spinsAfterFast", "spinRace"),
    check("fast", "spinRace"),
    check("exits", "exit"),
    check("detaches", "detach"),
  ],
};

function task(family: string, publicInput: Task["publicInput"] = {}): Task {
  return { taskId: `${family}-01`, family, publicInput, hidden: [] };
}

function tool(name: string, script: string): void {
  const path = join(tools, "bin", name);
  writeFileSync(path, `#!/bin/sh\n${script}\n`);
  chmodSync(path, 0o755);
}

function marked(word = MARK): number[] {
  const listed = Bun.spawnSync({ cmd: ["ps", "-axo", "pid=,command="], stdout: "pipe", stderr: "ignore" });
  if (listed.exitCode !== 0) throw new Error(`ps exited ${String(listed.exitCode)}`);
  return listed.stdout
    .toString()
    .split("\n")
    .filter((line) => line.includes(word))
    .map((line) => Number(line.trim().split(/\s+/u, 1)[0]));
}

async function untilMarked(word: string, present: boolean): Promise<void> {
  for (const started = performance.now(); performance.now() - started < 3000; await Bun.sleep(20)) {
    if (marked(word).length > 0 === present) return;
  }
  throw new Error(`a marked process was ${present ? "never started" : "left running"}`);
}

/** The verdict, or a word saying none came within `ms`, so a verifier that waits out a check's
 *  whole time fails here rather than at the suite's limit. */
const within = (pending: Promise<Verdict>, ms: number) =>
  Promise.race([pending, Bun.sleep(ms).then(() => `no verdict in ${String(ms)} ms`)]);

const checks = join(root, "checks");
setDefaultTimeout(60_000);

let verify: ReturnType<typeof openVerifier>;
let brief: ReturnType<typeof openVerifier>;

beforeAll(() => {
  mkdirSync(join(checks, "reference"), { recursive: true });
  mkdirSync(join(tools, "bin"), { recursive: true });
  writeFileSync(join(checks, "brief.json"), JSON.stringify(BRIEF));
  writeFileSync(join(checks, "evaluator.ts"), PROGRAM);
  // As v1's check programs do, the program imports a module of its own.
  writeFileSync(join(checks, "reference", "model.ts"), "export const same = (a, b) => a === b;\n");
  writeFileSync(secret, "another answer");
  tool("double", "read n; echo $((n * 2))");
  tool("sleeper", "sleep 30");
  tool(LINGER, "sleep 30");
  tool("killed", "kill -KILL $$");
  tool("unlaunched", 'exec "$(dirname "$0")/missing"');
  tool(
    "unstarted",
    "echo 'Fatal Python error: init_fs_encoding: failed to get the Python codec' >&2; exit 1",
  );
  tool("refuses", "echo no; exit 127");
  tool("compiles", 'echo "int main(void) { return 0; }" > p.c && /usr/bin/cc p.c -o p && ./p');
  verify = openVerifier({ checks, tools });
  brief = openVerifier({ checks, tools, checkMs: 300 });
});

afterAll(async () => {
  for (const pid of marked()) killProcessGroupId(pid, "SIGKILL");
  rmSync(root, { recursive: true, force: true });
  await releaseRoot(sibling);
});

describe.skipIf(!osIsolationSupport().ok)("a verdict's checks", () => {
  it("pass an answer every check passes and fail one a check refuses, through an imported module and a tree tool", async () => {
    expect(await verify(task("plain", { target: 21 }), { value: 21 })).toEqual({ kind: "pass" });
    expect(await verify(task("plain", { target: 21 }), { value: 20 })).toEqual({
      kind: "fail",
      blocking: ["value"],
    });
  });

  it("run in one cell, so the checks of one verdict see each other's files", async () => {
    expect(await verify(task("cell"), {})).toEqual({ kind: "pass" });
  });

  it("run offline and out of every other cell of the host", async () => {
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("open") });
    try {
      // The host reaches both, so a pass is the wall refusing them.
      expect(readFileSync(secret, "utf8")).toBe("another answer");
      expect(await (await fetch(server.url)).text()).toBe("open");
      expect(await verify(task("walled", { secret, url: server.url.href }), {})).toEqual({ kind: "pass" });
    } finally {
      await server.stop(true);
    }
  });

  it("read only the answer paths they declare", async () => {
    expect(await verify(task("projected"), { value: 1, note: "undeclared" })).toEqual({ kind: "pass" });
  });

  it("run at once, and the first in the brief's order names the verdict", async () => {
    const started = performance.now();
    expect(await verify(task("pair"), {})).toEqual({ kind: "pass" });
    // Two checks of a second each, one after the other, would take two.
    expect(performance.now() - started).toBeLessThan(1800);
    // The later check is at fault first, and the earlier one still names the verdict.
    expect(await verify(task("order"), {})).toEqual({
      kind: "faulty",
      check: "late",
      reason: "the check threw: decided late",
    });
  });

  it("are at fault when one throws or returns no boolean", async () => {
    expect(await verify(task("throws"), {})).toEqual({
      kind: "faulty",
      check: "throws",
      reason: "the check threw: no such rule",
    });
    expect(await verify(task("says"), {})).toEqual({
      kind: "faulty",
      check: "says",
      reason: "the check returned string",
    });
  });

  it("are at fault when one runs past its own time, while the others still answer", async () => {
    expect(await within(brief(task("hang"), {}), 5000)).toEqual({
      kind: "faulty",
      check: "hangs",
      reason: "the check timed out after 300 ms",
    });
  });

  it("leave no tool running once a check has run past its time", async () => {
    expect(await within(brief(task("linger"), {}), 5000)).toMatchObject({ kind: "faulty", check: "lingers" });
    await untilMarked(LINGER, false);
  });

  it("fault one that holds the cell's thread, and decide nothing when one ends the cell's process", async () => {
    expect(await within(brief(task("spin"), {}), 5000)).toEqual({
      kind: "faulty",
      check: "spins",
      reason: "the check timed out, holding the cell past 900 ms",
    });
    // A sibling check that finished must not take the blame when a later check spins synchronously past
    // the cell timeout.
    expect(await within(brief(task("spinRace"), {}), 5000)).toEqual({
      kind: "faulty",
      check: "spinsAfterFast",
      reason: "the check timed out, holding the cell past 900 ms",
    });
    expect(await verify(task("exit"), {})).toMatchObject({ kind: "non-result" });
  });
});

describe.skipIf(!osIsolationSupport().ok)("a check's tools", () => {
  it("decide nothing when one runs out its time, whatever the check returns", async () => {
    expect(await verify(task("slowTool"), {})).toEqual({
      kind: "non-result",
      reason: "slowTool: sleeper ran past 100 ms",
    });
  });

  it("decide nothing when one is killed, never launched or never started its interpreter, and fail on a program's own exit 127", async () => {
    for (const name of ["killed", "unlaunched", "unstarted"]) {
      expect(await verify(task("ran", { tool: name }), {})).toMatchObject({ kind: "non-result" });
    }
    expect(await verify(task("ran", { tool: "refuses" }), {})).toEqual({ kind: "fail", blocking: ["ran"] });
  });

  // The wall must leave clang its toolchain and the scratch it takes through `confstr`.
  it.if(existsSync("/usr/bin/cc"))("compile through the host's toolchain", async () => {
    expect(await verify(task("ran", { tool: "compiles" }), {})).toEqual({ kind: "pass" });
  });

  it("come from the verifier's tree only, never the host's", async () => {
    expect(await verify(task("hostShell"), {})).toEqual({
      kind: "non-result",
      reason: "hostShell: sh is not on the verifier's tool path",
    });
  });
});

describe.skipIf(!osIsolationSupport().ok)("a cancel", () => {
  it("ends the cell and a process a check detached before the verdict returns, and one given before the start runs nothing", async () => {
    const controller = new AbortController();
    const pending = verify(task("detach"), {}, controller.signal);
    await untilMarked(DETACHED, true);
    controller.abort();
    expect(await within(pending, 3000)).toMatchObject({ kind: "non-result" });
    expect(marked(DETACHED)).toEqual([]);
    expect(await verify(task("plain", { target: 21 }), { value: 21 })).toEqual({ kind: "pass" });
    expect(await verify(task("detach"), {}, AbortSignal.abort())).toMatchObject({ kind: "non-result" });
    expect(marked(DETACHED)).toEqual([]);
  });
});

describe("a check program", () => {
  it("with a symlink in it is refused at the opening", () => {
    const linked = join(root, "linked");
    cpSync(checks, linked, { recursive: true });
    symlinkSync(secret, join(linked, "reference", "answer.json"));
    expect(() => openVerifier({ checks: linked, tools })).toThrow(
      "the check program's reference/answer.json is neither a file nor a directory",
    );
  });

  it.skipIf(!osIsolationSupport().ok)(
    "hands a check only the files it declares, and the objective every file",
    async () => {
      const fileChecks = join(root, "file-checks");
      mkdirSync(fileChecks);
      const truth = {
        id: "file",
        citedDecisionIds: [],
        execution: {
          families: ["plain"],
          artifactPaths: ["$"],
          publicInputPaths: [],
          evidence: { kind: "authored" as const },
          hidden: "none" as const,
          filePaths: ["report.txt"],
        },
      };
      const objective = { quantity: "value", direction: "min" };
      writeFileSync(
        join(fileChecks, "brief.json"),
        JSON.stringify({ correctnessContract: "check-program/v1", truthChecks: [truth], objective }),
      );
      writeFileSync(
        join(fileChecks, "evaluator.ts"),
        `export const checks = { file: (req) => req.files.length === 1 && req.files[0].path === "report.txt" && req.files[0].text === "good" };
export const objective = (req) => ("files" in req ? req.files.length : 42);`,
      );
      const files = [
        { path: "report.txt", base64: "Z29vZA==", text: "good" },
        { path: "secret.txt", base64: "eA==", text: "x" },
      ];
      expect(
        await openVerifier({ checks: fileChecks, tools })(task("plain"), { value: 1 }, undefined, files),
      ).toEqual({
        kind: "pass",
        objective: 2,
      });
      const request = { artifact: { value: 1 }, publicTask: task("plain"), hidden: null, files };
      const missing = { ...truth, execution: { ...truth.execution, filePaths: ["missing.txt"] } };
      expect(checkEvaluationRequest(missing, request).files).toEqual([]);
      const { filePaths: _declared, ...undeclared } = truth.execution;
      expect(checkEvaluationRequest({ ...truth, execution: undeclared }, request)).not.toHaveProperty(
        "files",
      );
    },
  );
});

describe.skipIf(!osIsolationSupport().ok)("the objective", () => {
  let measured: ReturnType<typeof openVerifier>;
  beforeAll(() => {
    const dir = join(root, "measured");
    mkdirSync(dir);
    const measuredBrief = {
      correctnessContract: "check-program/v1",
      truthChecks: [check("value", "plain", { artifact: ["$.value"] }), check("sees", "plain")],
      objective: { quantity: "mass in kg", direction: "lower" },
    };
    writeFileSync(join(dir, "brief.json"), JSON.stringify(measuredBrief));
    writeFileSync(join(dir, "evaluator.ts"), MEASURED);
    measured = openVerifier({ checks: dir, tools });
  });

  it("measures a valid answer once its checks pass, and no refused one", async () => {
    expect(await measured(task("plain", { density: 3 }), { value: 7 })).toEqual({
      kind: "pass",
      objective: 21,
    });
    expect(await measured(task("plain", { density: 3 }), { value: 0 })).toEqual({
      kind: "fail",
      blocking: ["value"],
    });
  });

  it("measures in the verdict's own cell, after its checks", async () => {
    expect(await measured(task("plain", { mode: "cell" }), { value: 7 })).toEqual({
      kind: "pass",
      objective: 1,
    });
  });

  it("measures against the hidden values the task was built from, while a check that reads none sees none", async () => {
    const built = { ...task("plain", { mode: "truth" }), hidden: { truth: 10 } };
    expect(await measured(built, { value: 7 })).toEqual({ kind: "pass", objective: 3 });
    expect(await measured({ ...built, hidden: { truth: 4 } }, { value: 7 })).toEqual({
      kind: "pass",
      objective: 3,
    });
    expect(await measured({ ...built, hidden: { truth: 7 } }, { value: 7 })).toEqual({
      kind: "pass",
      objective: 0,
    });
  });

  it("is at fault under its own name when it gives no finite number or throws", async () => {
    for (const mode of ["nan", "infinity", "string", "throws"]) {
      expect(await measured(task("plain", { density: 3, mode }), { value: 7 })).toMatchObject({
        kind: "faulty",
        check: "objective",
      });
    }
  });

  it("faults under brief when no check applies to the task's family instead of passing vacuously", async () => {
    expect(await measured(task("unknown-family"), { value: 7 })).toEqual({
      kind: "faulty",
      check: "brief",
      reason: "no check applies to family unknown-family",
    });
  });

  it("faults on non-finite tool timeoutMs and default-timeout hangs, never reopens home itself, and marks external symlinks", async () => {
    const quick = openVerifier({ checks: join(root, "checks"), tools, checkMs: 300 });
    expect(await quick(task("nanTimeout"), { value: 1 })).toMatchObject({
      kind: "faulty",
      check: "nanTimeout",
    });
    expect(await quick(task("hungTool"), { value: 1 })).toMatchObject({
      kind: "faulty",
      check: "hungTool",
    });

    // `engineReadRoots` must never reopen `home` itself for depth-1 or depth-2 binaries under `home`.
    const fakeHome = join(root, "fake-home");
    const fakeTools = join(fakeHome, "bundle-tools");
    mkdirSync(join(fakeHome, "bin"), { recursive: true });
    mkdirSync(join(fakeHome, "opt", "pkg", "bin"), { recursive: true });
    mkdirSync(join(fakeTools, "bin"), { recursive: true });
    const d1 = join(fakeHome, "root-tool");
    const d2 = join(fakeHome, "bin", "depth2-tool");
    const d3 = join(fakeHome, "opt", "pkg", "bin", "depth3-tool");
    const inside = join(fakeTools, "bin", "bundled");
    for (const file of [d1, d2, d3, inside]) {
      writeFileSync(file, "#!/bin/sh\nexit 0\n");
      chmodSync(file, 0o755);
    }
    const realHome = realpathSync(fakeHome);
    const roots = engineReadRoots(fakeTools, [d1, d2, d3, inside], realHome);
    expect(roots).not.toContain(realHome);
    expect(roots).toEqual([
      realpathSync(d1),
      realpathSync(join(fakeHome, "bin")),
      realpathSync(join(fakeHome, "opt", "pkg")),
    ]);

    // `pinnedEngines` distinguishes external symlinked tools (`external: true`) from self-contained pack tools.
    const linkTools = join(root, "link-tools");
    mkdirSync(join(linkTools, "bin"), { recursive: true });
    symlinkSync(d2, join(linkTools, "bin", "double"));
    const ext = pinnedEngines({ checks: join(root, "checks"), tools: linkTools }).find(
      (e) => e.name === "double",
    );
    const local = pinnedEngines({ checks: join(root, "checks"), tools }).find((e) => e.name === "double");
    expect(ext?.external).toBe(true);
    expect(local?.external).toBe(false);
  });

  it("computes host-verified weighted rubric scores on [0, 1] and faults missing or out-of-range item scores", async () => {
    const rubricDir = join(root, "rubric-checks");
    mkdirSync(rubricDir, { recursive: true });
    writeFileSync(
      join(rubricDir, "brief.json"),
      JSON.stringify({
        correctnessContract: "check-program/v1",
        truthChecks: [check("valid", "rubric", { artifact: ["$.ok"] })],
        objective: {
          quantity: "weighted analytical quality",
          direction: "higher",
          scale: "unit",
          items: [
            { id: "accuracy", weight: 3 },
            { id: "calibration", weight: 1 },
          ],
        },
      }),
    );
    writeFileSync(
      join(rubricDir, EVALUATOR_FILE),
      [
        "export const checks = { valid: (req) => req.artifact.ok === true };",
        "export const scores = {",
        "  accuracy: (req) => req.artifact.acc,",
        "  calibration: (req) => req.artifact.cal,",
        "};",
      ].join("\n"),
    );
    const verifyRubric = openVerifier({ checks: rubricDir, tools });
    const rubricTask: Task = { taskId: "r-1", family: "rubric", publicInput: {}, hidden: {} };
    const good = await verifyRubric(rubricTask, { ok: true, acc: 0.8, cal: 0.4 });
    expect(good).toMatchObject({ kind: "pass", scores: { accuracy: 0.8, calibration: 0.4 } });
    expect(good.kind === "pass" ? good.objective : null).toBeCloseTo(0.7, 12);
    expect(await verifyRubric(rubricTask, { ok: true, acc: -0, cal: 0 })).toEqual({
      kind: "pass",
      objective: 0,
      scores: { accuracy: 0, calibration: 0 },
    });
    expect(await verifyRubric(rubricTask, { ok: true, acc: 1 + 1e-15, cal: -1e-15 })).toEqual({
      kind: "pass",
      objective: 0.75,
      scores: { accuracy: 1, calibration: 0 },
    });
    expect(await verifyRubric(rubricTask, { ok: false, acc: 0.8, cal: 0.4 })).toEqual({
      kind: "fail",
      blocking: ["valid"],
    });
    for (const bad of [-0.01, -1e-6, 1 + 1e-6, 1.01, Number.NaN, "high"]) {
      expect(await verifyRubric(rubricTask, { ok: true, acc: bad, cal: 0.5 })).toMatchObject({
        kind: "faulty",
        check: "objective",
      });
    }

    const edgeDir = join(root, "rubric-edge-checks");
    mkdirSync(edgeDir, { recursive: true });
    writeFileSync(
      join(edgeDir, "brief.json"),
      JSON.stringify({
        correctnessContract: "check-program/v1",
        truthChecks: [check("valid", "rubric", { artifact: ["$.ok"] })],
        objective: {
          quantity: "extreme weighted quality",
          direction: "higher",
          scale: "unit",
          items: [
            { id: "accuracy", weight: 1e308 },
            { id: "calibration", weight: 1e308 },
          ],
        },
      }),
    );
    writeFileSync(
      join(edgeDir, EVALUATOR_FILE),
      [
        "export const checks = { valid: (req) => req.artifact.ok === true };",
        "export const scores = {",
        "  accuracy: (req) => { if (req.artifact.mutate) req.artifact.cal = 0; if (req.artifact.mutateArr) req.artifact.list.push(1); return req.artifact.acc; },",
        "  calibration: (req) => req.artifact.cal,",
        "};",
      ].join("\n"),
    );
    const verifyEdge = openVerifier({ checks: edgeDir, tools });
    const big = await verifyEdge(rubricTask, { ok: true, acc: 0.8, cal: 0.4, list: [] });
    expect(big).toMatchObject({ kind: "pass", scores: { accuracy: 0.8, calibration: 0.4 } });
    expect(big.kind === "pass" ? big.objective : null).toBeCloseTo(0.6, 12);
    expect(await verifyEdge(rubricTask, { ok: true, acc: 0.8, cal: 0.4, mutate: true })).toMatchObject({
      kind: "faulty",
      check: "objective",
    });
    expect(
      await verifyEdge(rubricTask, { ok: true, acc: 0.8, cal: 0.4, list: [], mutateArr: true }),
    ).toMatchObject({
      kind: "faulty",
      check: "objective",
    });

    writeFileSync(
      join(edgeDir, EVALUATOR_FILE),
      "export const checks = { valid: () => true };\nexport const scores = { accuracy: () => 1 };\n",
    );
    const missingItem = await openVerifier({ checks: edgeDir, tools })(rubricTask, { ok: true });
    expect(missingItem).toMatchObject({
      kind: "faulty",
      check: "objective",
      reason: "score calibration is missing from the check program",
    });
    writeFileSync(join(edgeDir, EVALUATOR_FILE), "export const checks = { valid: () => true };\n");
    expect(await openVerifier({ checks: edgeDir, tools })(rubricTask, { ok: true })).toMatchObject({
      kind: "faulty",
      check: "objective",
      reason: "score accuracy is missing from the check program",
    });

    const singleDir = join(root, "rubric-single-item");
    mkdirSync(singleDir, { recursive: true });
    writeFileSync(
      join(singleDir, "brief.json"),
      JSON.stringify({
        correctnessContract: "check-program/v1",
        truthChecks: [check("valid", "rubric", { artifact: ["$.ok"] })],
        objective: {
          quantity: "single item rubric",
          direction: "higher",
          scale: "unit",
          items: [{ id: "only", weight: 2 }],
        },
      }),
    );
    writeFileSync(
      join(singleDir, EVALUATOR_FILE),
      "export const checks = { valid: () => true };\nexport const scores = { only: () => 0.75 };\n",
    );
    expect(await openVerifier({ checks: singleDir, tools })(rubricTask, { ok: true })).toEqual({
      kind: "pass",
      objective: 0.75,
      scores: { only: 0.75 },
    });

    const unitDir = join(root, "unit-scalar-checks");
    mkdirSync(unitDir, { recursive: true });
    writeFileSync(
      join(unitDir, "brief.json"),
      JSON.stringify({
        correctnessContract: "check-program/v1",
        truthChecks: [check("valid", "rubric", { artifact: ["$.ok"] })],
        objective: { quantity: "bounded score", direction: "higher", scale: "unit" },
      }),
    );
    writeFileSync(
      join(unitDir, EVALUATOR_FILE),
      "export const checks = { valid: (req) => req.artifact.ok === true };\nexport const objective = (req) => req.artifact.score;\n",
    );
    const verifyUnit = openVerifier({ checks: unitDir, tools });
    expect(await verifyUnit(rubricTask, { ok: true, score: 0.5 })).toEqual({ kind: "pass", objective: 0.5 });
    expect(await verifyUnit(rubricTask, { ok: true, score: 1 + 1e-15 })).toEqual({
      kind: "pass",
      objective: 1,
    });
    expect(await verifyUnit(rubricTask, { ok: true, score: -1e-15 })).toEqual({ kind: "pass", objective: 0 });
    for (const bad of [-0.1, 1.5]) {
      expect(await verifyUnit(rubricTask, { ok: true, score: bad })).toMatchObject({
        kind: "faulty",
        check: "objective",
      });
    }
    writeFileSync(
      join(unitDir, EVALUATOR_FILE),
      'export const checks = { valid: () => true };\nexport const objective = () => { Bun.write("result.json", JSON.stringify({ results: [{ passed: true }], measured: { value: 1.5 } })); process.exit(0); };\n',
    );
    expect(await openVerifier({ checks: unitDir, tools })(rubricTask, { ok: true })).toMatchObject({
      kind: "non-result",
    });
  });
});
