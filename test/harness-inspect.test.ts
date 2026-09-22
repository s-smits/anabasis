/**
 * `harness_inspect`, the Builder's static read-only view of the workspace it is authoring, and the
 * on-disk task shape the candidate check reads beside it. Both open the same miniature bundle, so
 * a change to what a workspace looks like on disk reaches the tool and the check together.
 *
 * Every case here asks what the tool returns rather than whether it throws; the hostile-argument
 * half lives in builder-tool-hostile-arguments.test.ts, where the assertion is the same for three
 * tools at once.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { controllerValidatedFindings } from "../src/truth/brief.ts";
import { mkdirSync, readFileSync, writeFileSync } from "../src/meta/filesystem.ts";
import { isRecord, type JsonValue } from "../src/meta/json-shape.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { runtimeProcess } from "../src/meta/process.ts";
import { loadValidatedBundle } from "../src/author/candidate-check.ts";
import { BuilderAuthorFeedback } from "../src/builder/author-feedback.ts";
import { createHarnessInspectTool } from "../src/builder/harness-inspect.ts";
import { commitPublicTask } from "../src/truth/task-split.ts";
import { MATCHING_OPERATING_GUIDE } from "./helpers/matching-fixture.ts";
import { fence } from "./helpers/starter-contracts.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import { text } from "./helpers/doubles.ts";

const CONTEXT = { slug: "duty-roster" };

afterAll(cleanupScratch);

function workspace(tasksBytes = fence("## Task battery contract", "json"), parent = tmpdir()): string {
  const dir = scratchDir("ana-inspect-", parent);
  mkdirSync(join(dir, "correctness-model"), { recursive: true });
  mkdirSync(join(dir, "agent"), { recursive: true });
  writeFileSync(join(dir, "correctness-model/brief.json"), fence("## The worked domain", "json"));
  writeFileSync(join(dir, "correctness-model/tasks.json"), tasksBytes);
  writeFileSync(join(dir, "correctness-model/controls.json"), fence("## Control corpus contract", "json"));
  writeFileSync(join(dir, "agent/tools-spec.json"), fence("## Agent tool list contract", "json"));
  writeFileSync(join(dir, "agent/BUILT_AGENTS.md"), MATCHING_OPERATING_GUIDE);
  return dir;
}

it("reads controller-bound history even while the authored workspace is incomplete", async () => {
  const calls: unknown[][] = [];
  const tool = createHarnessInspectTool({
    workspace: "/not-an-authored-workspace",
    context: CONTEXT,
    readHistory: (...args) => {
      calls.push(args);
      return JSON.stringify({ public: "older experiment" });
    },
  });
  const result = await tool.execute("history", {
    action: "history",
    runId: "r1",
    taskId: "t1",
    offset: 100,
    limit: 20,
  });
  expect(calls).toEqual([["r1", "t1", 100, 20]]);
  expect(JSON.stringify(result.content)).toContain("older experiment");
  const unbound = createHarnessInspectTool({ workspace: "/not-an-authored-workspace", context: CONTEXT });
  expect(JSON.stringify(await unbound.execute("history", { action: "history" }))).toContain(
    "No measured history",
  );
});

async function inspect<T = Record<string, JsonValue>>(
  dir: string,
  action: "readiness" | "summary" | "task" | "tools" | "typecheck" | "inventory" | "feedback" | "coverage",
  taskId?: string,
  options: Record<string, JsonValue> = {},
): Promise<T> {
  const tool = createHarnessInspectTool({ workspace: dir, context: CONTEXT });
  const result = await tool.execute("inspect-1", {
    action,
    ...keyIfDefined("taskId", taskId),
    ...options,
  });
  const block = result.content[0];
  if (block?.type !== "text") throw new Error("harness_inspect returned no text block");
  return parseJsonAs<T>(block.text);
}

describe("the candidate check's on-disk task shape", () => {
  // The check wraps the file as {tasks: fileContents} before validating. A file that carries the
  // wrapper itself therefore validates as a battery of one object, and the diagnostic quotes back
  // `{"tasks": [...]}` at an author who wrote exactly that — a refusal that cannot be acted on.
  it.concurrent("accepts the bare array and refuses a wrapped file in terms of the file", () => {
    expect(loadValidatedBundle(workspace(), CONTEXT).battery).not.toBeNull();
    const wrapped = loadValidatedBundle(
      workspace(JSON.stringify({ tasks: JSON.parse(fence("## Task battery contract", "json")) })),
      CONTEXT,
    );
    expect(wrapped.battery).toBeNull();
    const finding = wrapped.findings.find((f) => f.path === "correctness-model/tasks.json");
    expect(finding?.code).toBe("tasks-shape");
    expect(finding?.detail).toContain("the array is the whole file");
  });
});

describe("harness_inspect", () => {
  it.concurrent("routes an early feedback call back to readiness", () => {
    expect(new BuilderAuthorFeedback().page()).toMatchObject({
      available: false,
      phase: "before-submit",
      nextAction: expect.stringContaining("harness_inspect readiness"),
    });
  });

  it.concurrent("combines static readiness and chooses one sample trial task per family", async () => {
    const dir = workspace(fence("## Task battery contract", "json"), runtimeProcess.cwd());
    const blocked = await inspect<{
      staticStatus: string;
      missing: string[];
      modules: Array<{ module: string; present: boolean; diagnostics: number }>;
      toolContract: { registerExactly: string[] };
      taskCoverage: {
        count: number;
        familiesTotal: number;
        families: Array<{ family: string; sampleTaskId: string }>;
      };
      suggestedTrials: Array<{ family: string; taskId: string }>;
    }>(dir, "readiness");
    expect(blocked.staticStatus).toBe("blocked");
    expect(blocked.missing).toEqual(["correctness-model/evaluator.ts", "agent/tools.ts"]);
    expect(blocked.modules.every((module) => !module.present)).toBe(true);
    expect(blocked.toolContract.registerExactly).toContain("submit");
    expect(blocked.taskCoverage).toMatchObject({ count: 4, familiesTotal: 2 });
    expect(blocked.suggestedTrials).toEqual([
      { family: "single-shift", taskId: "single-shift-01" },
      { family: "two-shift", taskId: "two-shift-01" },
    ]);

    writeFileSync(join(dir, "agent/tools.ts"), "export const tools: string[] = [];\n");
    writeFileSync(
      join(dir, "correctness-model/evaluator.ts"),
      'export const checks = { "assignments-match": () => true };\n',
    );
    mkdirSync(join(dir, "correctness-model/reference"));
    writeFileSync(join(dir, "correctness-model/reference/index.ts"), "export const solve = () => ({});\n");
    const ready = await inspect<{
      staticStatus: string;
      modules: Array<{ module: string; present: boolean; diagnostics: number }>;
      validationFindings: { totalFindings: number };
    }>(dir, "readiness");
    expect(ready).toMatchObject({
      staticStatus: "static-checks-clear",
      modules: [
        { module: "agent/tools.ts", present: true, diagnostics: 0 },
        { module: "correctness-model/evaluator.ts", present: true, diagnostics: 0 },
      ],
      validationFindings: { totalFindings: 0 },
    });
    const briefPath = join(dir, "correctness-model/brief.json");
    const brief = JSON.parse(readFileSync(briefPath, "utf8"));
    for (const toolId of ["no-such-tool-readiness", "sh"]) {
      brief.truthChecks[0].execution.evidence = { kind: "external", requiredToolIds: [toolId] };
      writeFileSync(briefPath, JSON.stringify(brief));
      const checked = await inspect<{ staticStatus: string; nextAction: string }>(dir, "readiness");
      expect(checked.staticStatus).toBe(toolId === "sh" ? "static-checks-clear" : "blocked");
      if (toolId !== "sh") expect(checked.nextAction).toContain("installed tool");
    }
    // The readiness path builds real tsc probe programs over the vendored package types; under a
    // fully loaded 8-worker run two cold programs can exceed 20s without any defect.
  }, 60_000);

  it.concurrent("joins declared public rules, check inputs and controls without claiming semantic coverage", async () => {
    const dir = workspace();
    const first = await inspect<{ basis: string; coverageText: string; more: boolean }>(dir, "coverage");
    expect(first.basis).toBe("declarations-only");
    const coverage = JSON.parse(first.coverageText);
    expect(coverage.rules[0]).toMatchObject({
      id: "qualification-rule",
      families: ["single-shift", "two-shift"],
      checks: ["assignments-match"],
    });
    expect(coverage.checks[0]).toMatchObject({
      id: "assignments-match",
      publicInputPaths: ["$.staff", "$.shifts"],
      artifactPaths: ["$.assignments"],
      applicableTasks: 4,
      accepts: 3,
      rejects: [
        { id: "reject-alias-swap", taskId: "single-shift-01", mutationClass: "alias-swap" },
        { id: "reject-wrong-shift-two-shift", taskId: "two-shift-01", mutationClass: "wrong-shift" },
      ],
    });
    expect(first.more).toBe(false);
    expect(coverage).not.toHaveProperty("passed");
    expect(first.coverageText).not.toContain("scan-order");
    expect(first.coverageText).not.toContain("staffId");
    const family = await inspect<typeof first>(dir, "coverage", undefined, { family: "two-shift" });
    expect(JSON.parse(family.coverageText).checks[0]).toMatchObject({
      applicableTasks: 2,
      accepts: 2,
      rejects: [{ id: "reject-wrong-shift-two-shift", taskId: "two-shift-01", mutationClass: "wrong-shift" }],
    });
    await expect(inspect(dir, "coverage", undefined, { family: "missing" })).rejects.toThrow(
      "unknown task family",
    );
    const briefPath = join(dir, "correctness-model/brief.json");
    const brief = JSON.parse(readFileSync(briefPath, "utf8"));
    brief.ruleDecisions[1].statement = "private-recipe-changed";
    writeFileSync(briefPath, JSON.stringify(brief));
    expect(await inspect<typeof first>(dir, "coverage")).toEqual(first);
    brief.ruleDecisions.push({ id: "uncited", visibility: "public", statement: "A separate public rule." });
    writeFileSync(briefPath, JSON.stringify(brief));
    const changed = await inspect<typeof first>(dir, "coverage");
    expect(JSON.parse(changed.coverageText).rules).toContainEqual({
      id: "uncited",
      statement: "A separate public rule.",
      families: null,
      checks: [],
    });
    brief.ruleDecisions[0].statement = `start-${"public-λ-".repeat(10_000)}-end`;
    writeFileSync(briefPath, JSON.stringify(brief));
    const parts: string[] = [];
    let offset = 1;
    for (;;) {
      const page = await inspect<{ coverageText: string; more: boolean; to: number }>(
        dir,
        "coverage",
        undefined,
        { offset, limit: Number.MAX_SAFE_INTEGER },
      );
      expect(JSON.stringify(page).length).toBeLessThan(64_000);
      parts.push(page.coverageText);
      if (!page.more) break;
      offset = page.to + 1;
    }
    expect(JSON.parse(parts.join("")).rules[0].statement).toBe(brief.ruleDecisions[0].statement);
    expect(await inspect(workspace("[]"), "coverage")).toMatchObject({ available: false });
  });

  it.concurrent("summarises the contract state of a clean candidate without opening any value", async () => {
    const body = await inspect<{
      files: Record<string, boolean>;
      modules: Record<string, boolean>;
      staticStatus: string;
      findings: { totalFindings: number };
      tasks: Record<string, JsonValue>;
      brief: Record<string, JsonValue>;
    }>(workspace(), "summary");
    expect(body.files).toEqual({
      "correctness-model/brief.json": true,
      "correctness-model/tasks.json": true,
      "correctness-model/controls.json": true,
      "correctness-model/evaluator.ts": false,
      "agent/tools-spec.json": true,
      "agent/tools.ts": false,
      "agent/BUILT_AGENTS.md": true,
    });
    expect(body.staticStatus).toBe("blocked");
    expect(body.findings.totalFindings).toBe(0);
    expect(body.tasks).toMatchObject({ count: 4, families: { "single-shift": 2, "two-shift": 2 } });
    // Check ids and counts only: how often each declared check is exercised, never what it expects.
    expect(body.tasks.hiddenChecksByCheckId).toEqual({});
    expect(body.brief).toMatchObject({ slug: "duty-roster", artifactFields: ["assignments"] });
  }, 60_000);

  it.concurrent("resolves each declared tool where the host will, and names the one that resolves nowhere", async () => {
    // run22: the whole truth logic lived in a checker the registry materialised and no inspection
    // view named it. Now the summary lists each tool an external check names with the path and
    // digest the host will bind at submit, or the reason it will not run.
    const dir = workspace();
    const briefPath = join(dir, "correctness-model/brief.json");
    const parsed: unknown = JSON.parse(readFileSync(briefPath, "utf8"));
    const brief = isRecord(parsed) ? parsed : {};
    const truthChecks = [
      ...(Array.isArray(brief.truthChecks) ? brief.truthChecks : []),
      {
        id: "compiles",
        execution: { evidence: { kind: "external", requiredToolIds: ["sh", "no-such-tool-xyz"] } },
      },
      { id: "simulates", execution: { evidence: { kind: "external", requiredToolIds: ["sh"] } } },
      // Inspection remains available while the Builder is still repairing declaration fields.
      null,
      { execution: null },
      { execution: { evidence: { kind: "external", requiredToolIds: [null, 42] } } },
      { execution: { evidence: { kind: "external", requiredToolIds: "sh" } } },
    ];
    writeFileSync(briefPath, JSON.stringify({ ...brief, truthChecks }));
    const body = await inspect<{ installedTools: JsonValue }>(dir, "summary");
    expect(body.installedTools).toEqual([
      { toolId: "no-such-tool-xyz", missing: "no executable under .toolchain or on the host PATH" },
      {
        toolId: "sh",
        path: expect.stringMatching(/\/sh$/),
        source: "host",
        kind: "binary",
        interpreter: null,
        digest: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
    ]);
  });

  it.concurrent("reports no external checks as an empty list and an unreadable brief honestly", async () => {
    const none = await inspect<{ installedTools: JsonValue }>(workspace(), "summary");
    expect(none.installedTools).toEqual([]);
    const dir = workspace();
    writeFileSync(join(dir, "correctness-model/brief.json"), "not json");
    const invalid = await inspect<{ installedTools: { invalid: string } }>(dir, "summary");
    // toMatch rejects a non-string, so this asserts both the shape and a non-empty reason.
    expect(invalid.installedTools.invalid).toMatch(/\S/);
  });

  it.concurrent("shows the exact public task one case presents, carrying no hidden row", async () => {
    const tasks = JSON.parse(fence("## Task battery contract", "json"));
    for (const task of tasks) {
      task.hidden = [{ checkId: "assignments-match", expectation: { shiftId: "private-answer" } }];
    }
    const dir = workspace(JSON.stringify(tasks));
    const briefPath = join(dir, "correctness-model/brief.json");
    const brief = JSON.parse(readFileSync(briefPath, "utf8"));
    brief.truthChecks[0].execution.hidden = "required";
    writeFileSync(briefPath, JSON.stringify(brief));
    const body = await inspect<{
      publicTask: Record<string, JsonValue>;
      hiddenChecks: number;
      publicTaskDigest: string;
    }>(dir, "task", "two-shift-01");
    const { publicTask } = body;
    expect(Object.keys(publicTask).sort()).toEqual(["family", "publicInput", "taskId"]);
    expect(publicTask.taskId).toBe("two-shift-01");
    // The projection PICKS public fields, so the answer key cannot ride along even though the
    // task the inspection read carries it. The count is reported; the value never is.
    expect(JSON.stringify(publicTask)).not.toContain("assignments-match");
    expect(JSON.stringify(publicTask)).not.toContain("shiftId");
    expect(body.hiddenChecks).toBe(1);
    expect(body.publicTaskDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it.concurrent("selects a task from the requested family and refuses conflicting selectors", async () => {
    const dir = workspace();
    const selected = await inspect<{ taskId: string; family: string }>(dir, "task", undefined, {
      family: "two-shift",
    });
    expect(selected).toMatchObject({ taskId: "two-shift-01", family: "two-shift" });
    await expect(inspect(dir, "task", "single-shift-01", { family: "two-shift" })).rejects.toThrow(
      'taskId "single-shift-01" belongs to family "single-shift", not "two-shift"',
    );
    await expect(inspect(dir, "task", undefined, { family: "missing" })).rejects.toThrow(
      "unknown task family: missing",
    );
  });

  it.concurrent("pages every readiness family instead of cutting the battery after 200", async () => {
    const [base] = JSON.parse(fence("## Task battery contract", "json"));
    const tasks = Array.from({ length: 201 }, (_, index) => ({
      ...structuredClone(base),
      taskId: `task-${index + 1}`,
      family: `family-${String(index + 1).padStart(3, "0")}`,
    }));
    const dir = workspace(JSON.stringify(tasks));
    const first = await inspect<{
      taskCoverage: {
        from: number;
        to: number;
        more: boolean;
        families: Array<{ family: string; sampleTaskId: string }>;
      };
      nextAction: string;
    }>(dir, "readiness");
    const second = await inspect<typeof first>(dir, "readiness", undefined, { offset: 201 });
    expect(first.taskCoverage).toMatchObject({ from: 1, to: 200, more: true });
    expect(first.nextAction).toContain("readiness offset 201");
    expect(second.taskCoverage).toMatchObject({ from: 201, to: 201, more: false });
    expect<unknown>(second.taskCoverage.families).toEqual([
      { family: "family-201", tasks: 1, publicInputPaths: expect.any(Number), sampleTaskId: "task-201" },
    ]);
    expect(
      new Set(first.taskCoverage.families.map((row) => row.family)).has(
        second.taskCoverage.families[0]?.family ?? "",
      ),
    ).toBe(false);
  });

  it.concurrent("names the exact tool list agent/tools.ts must register", async () => {
    const body = await inspect<{ registerExactly: string[]; declared: Array<{ name: string }> }>(
      workspace(),
      "tools",
    );
    const register = body.registerExactly;
    // The three starter names the conformance probe expects on every Built Harness, plus whatever
    // the spec and its presets contribute — one derivation, shared with the probe.
    expect(register).toEqual([...register].sort());
    for (const name of ["inspect_draft", "preview_artifact", "submit"]) expect(register).toContain(name);
    for (const declared of body.declared) expect(register).toContain(declared.name);
  });

  // A public projection can be larger than one tool result. Before paging, this threw above 64 KB.
  // Large tasks still need to be inspectable, so the projection is returned in pages
  // and the digest still identifies the whole of it. A long string inside a row does this without
  // touching maxPublicRows or publicCollections, so the task still validates.
  it.concurrent("pages every character and the digest when a projection exceeds one tool result", async () => {
    const tasks = JSON.parse(fence("## Task battery contract", "json"));
    tasks[0].publicInput.staff[0].id = `st-${"x".repeat(60_000)}`;
    const dir = workspace(JSON.stringify(tasks));
    const body = await inspect<{
      publicTaskDigest: string;
      publicTaskBytes: number;
      note: string;
      publicTaskText: string;
      to: number;
      more: boolean;
    }>(dir, "task", "single-shift-01");
    expect(body).not.toHaveProperty("publicTask");
    expect(body.publicTaskDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(body.publicTaskBytes).toBeGreaterThan(60_000);
    expect(body.note).toContain("exact public projection is paged");
    expect(body.publicTaskText.length).toBeGreaterThan(1_000);
    // Still a projection: the hidden expectation cannot ride along on the cut path either.
    expect(body.publicTaskText).not.toContain("shiftId");

    const pages = [body.publicTaskText];
    let page = body;
    while (page.more) {
      page = await inspect(dir, "task", "single-shift-01", { offset: page.to + 1 });
      pages.push(page.publicTaskText);
    }
    const loaded = loadValidatedBundle(dir, CONTEXT).battery?.tasks[0];
    if (loaded === undefined) throw new Error("the paged fixture task did not validate");
    expect(pages.join("")).toBe(commitPublicTask(loaded).publicTaskJson);
  });

  it.concurrent("reports an unvalidated file as a state instead of throwing", async () => {
    const body = await inspect<{ tasksValid: boolean; findings: { totalFindings: number } }>(
      workspace("[]"),
      "task",
    );
    expect(body.tasksValid).toBe(false);
    expect(body.findings.totalFindings).toBeGreaterThan(0);
  });

  // The summary can only say the two modules exist, so before this action a Builder learned that
  // its module did not compile by spending a submission on it. These are the same diagnostics
  // submit produces, from the same owner, over the model's own file.
  it.concurrent("separates a module not written yet from one that does not compile", async () => {
    interface TypecheckBody {
      diagnostics?: number;
      modules: Array<{ module: string; present?: boolean; diagnostics: number }>;
      findings: {
        groups: Array<{
          code: { text: string };
          path: { text: string };
          detail: { text: string };
        }>;
      };
    }
    const agentModule = (body: TypecheckBody) => body.modules.find((row) => row.module === "agent/tools.ts");

    const dir = workspace();
    expect(agentModule(await inspect<TypecheckBody>(dir, "typecheck"))).toEqual({
      module: "agent/tools.ts",
      present: false,
      diagnostics: 0,
    });

    writeFileSync(join(dir, "agent/tools.ts"), "export const tools: string[] = [1];\n");
    const broken = await inspect<TypecheckBody>(dir, "typecheck");
    expect(broken.diagnostics).toBe(1);
    const [first] = broken.findings.groups;
    expect(first?.code.text).toBe("generated-module-types");
    expect(first?.path.text).toBe("agent/tools.ts");
    expect(first?.detail.text).toMatch(/^agent\/tools\.ts:1:\d+ TS2322: /);

    writeFileSync(join(dir, "agent/tools.ts"), "export const tools: string[] = [];\n");
    expect(agentModule(await inspect<TypecheckBody>(dir, "typecheck"))?.diagnostics).toBe(0);
    expect(await inspect(dir, "typecheck", undefined, { group: 1, field: "detail" })).toMatchObject({
      findings: {
        totalGroups: 0,
        group: 1,
        stale: true,
        navigation: expect.stringContaining("without group"),
      },
    });
  });

  it.concurrent("lists every task family and the public paths its generated tools may read", async () => {
    const dir = workspace();
    const inventory = await inspect<{
      total: number;
      tasks: Array<{ taskId: string; family: string }>;
      families: Array<{ family: string; tasks: number; publicInputPaths: number }>;
    }>(dir, "inventory");
    expect(inventory.total).toBe(4);
    expect(inventory.tasks.map((task) => task.taskId)).toEqual([
      "single-shift-01",
      "single-shift-02",
      "two-shift-01",
      "two-shift-02",
    ]);
    expect(inventory.families).toEqual([
      { family: "single-shift", tasks: 2, publicInputPaths: expect.any(Number) },
      { family: "two-shift", tasks: 2, publicInputPaths: expect.any(Number) },
    ]);
    const family = await inspect<{ publicInputPaths: string[]; total: number }>(dir, "inventory", undefined, {
      family: "two-shift",
    });
    expect(family.total).toBeGreaterThan(0);
    expect(family.publicInputPaths).toContain("$.staff[]");
    expect(family.publicInputPaths).toContain("$.shifts[]");
  });

  it.concurrent("keeps a large refusal bounded while every grouped field remains reachable", async () => {
    const dir = workspace();
    const feedback = new BuilderAuthorFeedback();
    expect(feedback.page()).toMatchObject({
      available: false,
      nextAction: expect.stringContaining("readiness"),
    });
    const longDetail = `start-${"x".repeat(20_000)}-end`;
    feedback.record(
      { attempt: 3, turn: 7, stage: "gates", commit: "a".repeat(40) },
      controllerValidatedFindings([
        ...Array.from({ length: 25 }, (_, index) => ({
          code: `code-${index}`,
          path: `agent/tools.ts#tool-${index}`,
          detail: index === 0 ? longDetail : `fix-${index}`,
        })),
        { code: "code-0", path: "agent/tools.ts#tool-0", detail: longDetail },
      ]),
    );
    const tool = createHarnessInspectTool({ workspace: dir, context: CONTEXT, feedback });
    expect(tool.description).toContain("Use feedback after correctness_check or submit findings");
    const call = async (args: Record<string, JsonValue>) => {
      const result = await tool.execute("feedback", { action: "feedback", ...args });
      const block = result.content[0];
      if (block?.type !== "text") throw new Error("feedback returned no text");
      return parseJsonAs<Record<string, JsonValue>>(block.text);
    };
    const overview = await call({});
    expect(overview).toMatchObject({ totalFindings: 26, totalGroups: 25, from: 1, to: 20, more: true });
    expect(await call({ group: 26 })).toMatchObject({ totalGroups: 25, navigation: expect.any(String) });
    expect(JSON.stringify(overview).length).toBeLessThan(30_000);

    const parts: string[] = [];
    let offset = 1;
    let more = true;
    while (more) {
      const page = await call({ group: 1, field: "detail", offset });
      parts.push(text(page.text));
      more = page.more === true;
      offset = Number(page.to) + 1;
    }
    expect(parts.join("")).toBe(longDetail);
  });

  it.concurrent("folds one defect with per-task detail variants into one group that keeps every variant", async () => {
    const dir = workspace();
    const feedback = new BuilderAuthorFeedback();
    feedback.record(
      { attempt: 1, turn: 2, stage: "gates", commit: "b".repeat(40) },
      controllerValidatedFindings([
        {
          code: "grounding-unexecuted",
          path: "correctness-model/engines.json#checker",
          detail: "task-a: never executed",
        },
        {
          code: "grounding-unexecuted",
          path: "correctness-model/engines.json#checker",
          detail: "task-b: never executed",
        },
        {
          code: "grounding-unexecuted",
          path: "correctness-model/engines.json#checker",
          detail: "task-a: never executed",
        },
      ]),
    );
    const tool = createHarnessInspectTool({ workspace: dir, context: CONTEXT, feedback });
    const result = await tool.execute("feedback", { action: "feedback" });
    const block = result.content[0];
    if (block?.type !== "text") throw new Error("feedback returned no text");
    const overview = parseJsonAs<{
      totalFindings: number;
      totalGroups: number;
      groups: Array<{
        count: number;
        variants: number;
        detail: { text: string };
      }>;
    }>(block.text);
    expect(overview).toMatchObject({ totalFindings: 3, totalGroups: 1 });
    const { groups } = overview;
    expect(groups[0]?.count).toBe(3);
    expect(groups[0]?.variants).toBe(2);
    // Multiplicity survives the fold: each variant is framed with its own count and exact
    // character length, so 2×A + 1×B never reads as two equally common paragraphs.
    expect(groups[0]?.detail.text).toBe(
      "[variant 1/2 ×2, 22 chars]\ntask-a: never executed\n" +
        "[variant 2/2 ×1, 22 chars]\ntask-b: never executed",
    );
  });
});
