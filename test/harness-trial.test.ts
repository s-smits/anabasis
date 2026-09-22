import { mkdtempSync, rmSync, readFileSync, readdirSync, existsSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { afterEach, describe, expect, it } from "bun:test";
import { createHarnessInspectTool } from "../src/builder/harness-inspect.ts";
import { createHarnessTrialTool } from "../src/builder/harness-trial.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import type { JsonObject, JsonValue } from "../src/meta/json-shape.ts";
import {
  writeMatchingBuildFixture,
  MATCHING_BRIEF,
  MATCHING_TASKS,
  MATCHING_ACCEPTS,
} from "./helpers/matching-fixture.ts";
import { createVerifierLifetime } from "../src/verify/verifier-lifetime.ts";
import { processGroupExists } from "../src/meta/subprocess.ts";
import { loadValidatedBundle } from "../src/author/candidate-check.ts";
import { createGeneratedToolStarter } from "../src/solve/generated-tool-worker.ts";
import { loadBuiltControllerInterface } from "../src/truth/contracts.ts";
import { type Solver, type SolverNonResult, withSolverBuiltStarterFactory } from "../src/truth/solve.ts";
import { keyIfDefined } from "../src/meta/optional-key.ts";
import { double, text } from "./helpers/doubles.ts";
import { runtimeProcess } from "../src/meta/process.ts";

const scratch: string[] = [];
const SOLVES = [
  { tool: "declare_part", arguments: { name: "alpha" } },
  { tool: "set_assignments", arguments: { assignments: [{ part: "alpha", slot: "s3" }] } },
  { tool: "submit", arguments: {} },
];

afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function workspace(): string {
  // The production workspace sits below the repository and resolves its admitted dependencies
  // from that root. Place this fixture below the repository too, so its imports resolve.
  const dir = mkdtempSync(join(runtimeProcess.cwd(), ".ana-scratch-harness-trial-"));
  scratch.push(dir);
  writeMatchingBuildFixture(dir);
  return dir;
}

/** A solver standing where the measured Built solver stands: the same confined generated-tool
 *  starter the production factory opens, driven by a fixed call list instead of a provider. What
 *  the tool does with the result — grade it, project it, bound it — is what these tests read. */
function scriptedBuiltSolver(
  calls: Array<{ tool: string; arguments: JsonObject }>,
  nonResult?: SolverNonResult,
): Solver {
  const solver: Solver = async (_task, toolset) => {
    const byName = new Map(toolset.tools.map((tool) => [tool.name, tool]));
    let seq = 0;
    for (const call of calls) {
      const tool = byName.get(call.tool);
      if (tool === undefined) throw new Error(`generated toolset is missing tool "${call.tool}"`);
      await tool.execute(`blind-${++seq}`, double(call.arguments));
    }
    await toolset.close?.();
    return {
      turns: 2,
      completedTurns: 2,
      errors: [],
      toolCalls: calls.length,
      ...keyIfDefined("nonResult", nonResult),
    };
  };
  return withSolverBuiltStarterFactory(solver, async (slugDir, task, submission, publicArtifactSchema) =>
    createGeneratedToolStarter({
      slugDir,
      task,
      submission,
      publicArtifactSchema,
      contract: await loadBuiltControllerInterface(slugDir),
    }),
  );
}

async function trial(
  dir: string,
  taskId: string,
  calls: Array<{ tool: string; arguments: JsonObject }> = SOLVES,
  nonResult?: SolverNonResult,
) {
  const root = mkdtempSync(join(runtimeProcess.cwd(), ".ana-scratch-trial-lifetime-"));
  scratch.push(root);
  const verifierLifetime = createVerifierLifetime({ root });
  const tool = createHarnessTrialTool({
    workspace: dir,
    context: { slug: "matching", exactTasks: 4 },
    builtSolver: () => scriptedBuiltSolver(calls, nonResult),
    verifierLifetime,
  });
  const result = await tool.execute("trial", { taskId });
  expect(verifierLifetime.pendingReceipts()).toEqual([]);
  expect(await verifierLifetime.close()).toEqual([]);
  const block = result.content[0];
  if (block?.type !== "text") throw new Error("harness_trial returned no text block");
  return parseJsonAs<Record<string, JsonValue>>(block.text);
}

describe("harness_trial", () => {
  it("solves one authored task with the measured solver and grades what it submitted", async () => {
    const result = await trial(workspace(), "t1");

    expect(result.status, JSON.stringify(result)).toBe("completed");
    expect(result.task).toMatchObject({ taskId: "t1", family: "single-part" });
    expect(result.solve).toMatchObject({ accepted: true, turns: 2, toolCalls: 3, nonResult: null });
    expect(result.validation).toEqual({
      outcome: "completed",
      submitted: true,
      truthVerdict: "pass",
      rehearsalsLeft: 5,
    });
    expect(result.candidate).toMatchObject({ stable: true, candidateId: expect.any(String) });
    expect(result.verifier).toEqual({ status: "completed" });
    expect(result.truth).toMatchObject({ verdict: "pass" });
    expect(JSON.stringify(result)).not.toContain("expected-binding");
    // The one reading the Builder needs and the only one this bit supports.
    expect(text(result.nextAction)).toContain("passed this task on its first unaided attempt");
  });

  it("reports a solver miss as a miss rather than a check failure", async () => {
    const result = await trial(workspace(), "t1", [{ tool: "declare_part", arguments: { name: "alpha" } }]);
    expect(result.status).toBe("unaccepted");
    expect(result.solve).toMatchObject({ accepted: false });
    expect(result.truth).toMatchObject({ verdict: "not-run" });
    expect(text(result.nextAction)).toContain("solver miss, not a check failure");
  });

  it("rehearses a single task before admission coverage exists", async () => {
    const dir = workspace();
    const tasks = structuredClone(MATCHING_TASKS);
    await Bun.write(join(dir, "correctness-model/tasks.json"), JSON.stringify(tasks.slice(0, 1)));
    await Bun.write(
      join(dir, "correctness-model/controls.json"),
      JSON.stringify({ accept: MATCHING_ACCEPTS.slice(0, 1), reject: [] }),
    );
    expect(loadValidatedBundle(dir, { slug: "matching", exactTasks: 4 }).battery).toBeNull();
    const inspect = createHarnessInspectTool({
      workspace: dir,
      context: { slug: "matching", exactTasks: 4 },
    });
    // The task projection is one of three public surfaces the solver reads, not all of them.
    expect(inspect.description).toContain(
      "public resources (validity assertions, rule decisions, artifact schema, constants and value sets) and the operating guide",
    );
    const readiness = await inspect.execute("inspect", { action: "readiness" });
    const block = readiness.content[0];
    if (block?.type !== "text") throw new Error("missing readiness text");
    const view = JSON.parse(block.text);
    expect(view.rehearsalReady).toBe(true);
    expect(view.suggestedTrials).toContainEqual({ family: "single-part", taskId: "t1" });
    expect(await trial(dir, "t1")).toMatchObject({ status: "completed", verifier: { status: "completed" } });
    tasks[0]!.hidden = [];
    await Bun.write(join(dir, "correctness-model/tasks.json"), JSON.stringify(tasks.slice(0, 1)));
    expect(await trial(dir, "t1")).toMatchObject({ status: "blocked", stage: "candidate" });
  });

  it("publishes the aggregate verdict and keeps protected check detail out of the public result", async () => {
    const dir = workspace();
    const projections = new Map<string, Record<string, JsonValue>>();
    const expected = new Map([
      ["return true", "pass"],
      ["return false", "fail"],
    ]);
    for (const body of [
      "return true",
      "return false",
      'throw new Error("PRIVATE_A")',
      'throw new Error("PRIVATE_B")',
    ]) {
      await Bun.write(
        join(dir, "correctness-model/evaluator.ts"),
        `export const checks = { "parts-assigned": () => { ${body} }, "expected-binding": () => true };`,
      );
      const result = await trial(dir, "t1");
      expect(result.verifier).toEqual({
        status: body.startsWith("return") ? "completed" : "execution-failed",
      });
      expect(JSON.stringify(result)).not.toContain("PRIVATE_");
      expect(JSON.stringify(result)).not.toContain("parts-assigned");
      // The one bit crosses: a check that accepted and one that rejected are distinguishable.
      const verdict = expected.get(body) ?? "not-run";
      expect(result.truth).toEqual({ verdict });
      // Nothing beside it does. Two different private exceptions still project identically,
      // and candidate identity may change with source bytes; content must not.
      const { candidate: _candidate, ...publicResult } = result;
      const previous = projections.get(verdict);
      if (previous === undefined) {
        projections.set(verdict, publicResult);
      } else {
        expect(publicResult).toEqual(previous);
      }
    }
  });

  it.each([false, true])(
    "runs installed tools and drains cancelled processes (cancel=%s)",
    async (cancel) => {
      const dir = workspace();
      const root = mkdtempSync(join(runtimeProcess.cwd(), ".ana-scratch-trial-process-"));
      scratch.push(root);
      const lifetime = createVerifierLifetime({ root });
      const brief = structuredClone(MATCHING_BRIEF);
      for (const check of brief.truthChecks) {
        check.execution.evidence =
          check.id === "parts-assigned"
            ? { kind: "authored" }
            : { kind: "external", requiredToolIds: [cancel ? "sleep" : "cat"] };
        if (check.execution.evidence.kind === "authored") {
          check.execution.requiredToolIds = [cancel ? "sleep" : "cat"];
        }
      }
      await Bun.write(join(dir, "correctness-model/brief.json"), JSON.stringify(brief));
      await Bun.write(
        join(dir, "correctness-model/evaluator.ts"),
        `
      async function run(request, runtime) {
        await runtime.tools.run(${cancel ? '{ toolId: "sleep", args: ["60"] }' : '{ toolId: "cat", stdin: JSON.stringify(request.artifact) }'});
        return false;
      }
      export const checks = { "parts-assigned": run, "expected-binding": run };
    `,
      );
      const abort = new AbortController();
      const tool = createHarnessTrialTool({
        workspace: dir,
        context: { slug: "matching" },
        builtSolver: () => scriptedBuiltSolver(SOLVES),
        verifierLifetime: lifetime,
      });
      const pending = tool.execute("trial", { taskId: "t1" }, abort.signal);
      if (cancel) {
        try {
          let spawned = false;
          for (let attempt = 0; attempt < 500 && !spawned; attempt++) {
            spawned = readdirSync(root).some(
              (id) =>
                parseJsonAs<{ role: string }>(readFileSync(join(root, id, "intent.json"), "utf8")).role ===
                  "tool" && existsSync(join(root, id, "spawned.json")),
            );
            if (!spawned) await Bun.sleep(10);
          }
          expect(spawned).toBe(true);
        } finally {
          abort.abort();
        }
      }
      const result = await pending;
      const block = result.content[0];
      if (block?.type !== "text") throw new Error("missing trial result");
      const body = parseJsonAs<Record<string, JsonValue>>(block.text);
      expect(body.verifier, block.text).toEqual(
        cancel ? { status: "non-result", kind: "cancelled" } : { status: "completed" },
      );
      const receipts = readdirSync(root).map((id) => join(root, id));
      // Four completed `cat` runs start three processes: one asks a question the host already answered.
      expect(receipts).toHaveLength(cancel ? 2 : 3);
      for (const receipt of receipts) {
        expect(
          parseJsonAs<{ groupReaped: boolean }>(readFileSync(join(receipt, "settlement.json"), "utf8"))
            .groupReaped,
        ).toBe(true);
        const { pid } = parseJsonAs<{ pid: number }>(readFileSync(join(receipt, "spawned.json"), "utf8"));
        expect(processGroupExists(pid)).toBe(false);
      }
      expect(lifetime.pendingReceipts()).toEqual([]);
      lifetime.assertUsable();
      expect(await lifetime.close()).toEqual([]);
    },
  );

  it("grades as the battery does: a grounded check that ran no tool, or a solver non-result, is no pass", async () => {
    const dir = workspace();
    const brief = structuredClone(MATCHING_BRIEF);
    for (const check of brief.truthChecks) {
      if (check.id === "expected-binding") {
        check.execution.evidence = { kind: "external", requiredToolIds: ["cat"] };
      }
    }
    await Bun.write(join(dir, "correctness-model/brief.json"), JSON.stringify(brief));
    await Bun.write(
      join(dir, "correctness-model/evaluator.ts"),
      'export const checks = { "parts-assigned": () => true, "expected-binding": () => true };',
    );
    const ungrounded = await trial(dir, "t1");
    expect(ungrounded.verifier).toEqual({ status: "non-result", kind: "verifier" });
    expect(ungrounded.truth).toEqual({ verdict: "not-run" });
    const stopped = await trial(workspace(), "t1", SOLVES, {
      kind: "provider",
      message: "provider stopped after submit",
    });
    expect(stopped.status).toBe("non-result");
    expect(stopped.solve).toMatchObject({ accepted: true });
    expect(stopped.truth).toEqual({ verdict: "not-run" });
  });

  it("reports a schema-rejected submission without presenting it as a correctness verdict", async () => {
    const dir = workspace();
    await Bun.write(
      join(dir, "correctness-model/evaluator.ts"),
      'throw new Error("must not execute without an artifact");',
    );
    const result = await trial(dir, "t1", [{ tool: "submit", arguments: {} }]);
    expect(result.status).toBe("unaccepted");
    expect(result.solve).toMatchObject({ accepted: false });
    expect(result.truth).toMatchObject({ verdict: "not-run" });
  });

  it("keeps unrelated static candidate findings visible beside the solve", async () => {
    const dir = workspace();
    await Bun.write(join(dir, "agent/BUILT_AGENTS.md"), "");
    const result = await trial(dir, "t1");
    expect(result.candidate).toMatchObject({
      staticFindings: {
        totalFindings: 1,
        groups: [{ code: { text: "operating-guide-shape", complete: true } }],
      },
    });
  });

  it("refuses an unknown task before any worker opens", async () => {
    const result = await trial(workspace(), "hidden-task");
    expect(result).toMatchObject({ status: "blocked", stage: "task", taskId: "hidden-task" });
    expect(result.availableTaskIds).toEqual(["t1", "t1b", "t2", "t2b"]);
  });

  it("names the candidate's own cause for a blocked call rather than reporting a solver miss", async () => {
    // The blocked body already named the available taskIds. The summary then recomputed the reading
    // from the status alone and wrote "Your solver missed this task" over it: a solver verdict for a
    // call in which no solver ran, and the only reading the Builder acts on.
    const result = await trial(workspace(), "hidden-task");
    expect(text(result.nextAction)).toContain("harness_inspect inventory");
    expect(text(result.nextAction)).not.toContain("Your solver missed this task");
    // A call blocked before its solve measured nothing and cost no case, so it spends no rehearsal.
    expect(result.validation).toMatchObject({ outcome: "blocked", rehearsalsLeft: 6 });
  });

  it("reports a call that named no task as a request that rehearsed nothing", async () => {
    const result = await trial(workspace(), " ");
    expect(result).toMatchObject({ status: "blocked", stage: "request" });
    expect(text(result.nextAction)).toContain("named no task");
    expect(result.validation).toMatchObject({ outcome: "blocked", rehearsalsLeft: 6 });
  });

  it("opens no solve for a call the host has already cancelled", async () => {
    // A Built solve runs under the harness's own wall, which may be hours. The caller's signal
    // reached only the verifier stage, so a cancelled rehearsal paid for its whole solve first and
    // then discarded it.
    let solverOpened = false;
    const tool = createHarnessTrialTool({
      workspace: workspace(),
      context: { slug: "matching" },
      builtSolver: () => {
        solverOpened = true;
        return scriptedBuiltSolver(SOLVES);
      },
    });
    const result = await tool.execute("trial", { taskId: "t1" }, AbortSignal.abort());
    const block = result.content[0];
    if (block?.type !== "text") throw new Error("missing trial result");
    const body = parseJsonAs<Record<string, JsonValue>>(block.text);
    expect(body).toMatchObject({ status: "blocked", stage: "cancelled" });
    expect(solverOpened).toBe(false);
    expect(text(body.nextAction)).toContain("cancelled this call");
    expect(body.validation).toMatchObject({ rehearsalsLeft: 6 });
  });

  it("refuses rather than measuring a different agent when no Built solver is bound", async () => {
    const tool = createHarnessTrialTool({ workspace: workspace(), context: { slug: "matching" } });
    const result = await tool.execute("trial", { taskId: "t1" });
    const block = result.content[0];
    if (block?.type !== "text") throw new Error("missing trial result");
    expect(parseJsonAs<Record<string, JsonValue>>(block.text)).toMatchObject({
      status: "non-result",
      stage: "solver",
    });
  });

  it("writes each rehearsal's solve evidence and stops at the session bound", async () => {
    const dir = workspace();
    const evidence = mkdtempSync(join(runtimeProcess.cwd(), ".ana-scratch-trial-evidence-"));
    scratch.push(evidence);
    const tool = createHarnessTrialTool({
      workspace: dir,
      context: { slug: "matching" },
      rehearsalDir: evidence,
      builtSolver: () => scriptedBuiltSolver(SOLVES),
    });
    const bodies: Array<Record<string, JsonValue>> = [];
    for (let call = 0; call < 7; call++) {
      const result = await tool.execute("trial", { taskId: "t1" });
      const block = result.content[0];
      if (block?.type !== "text") throw new Error("missing trial result");
      bodies.push(parseJsonAs<Record<string, JsonValue>>(block.text));
    }
    // No verifier lifetime is bound here, so each solve reaches no verdict. It still spent a
    // rehearsal: the solve ran and cost a case, and a typed non-result is not free measurement.
    expect(bodies.slice(0, 6).map((body) => body.status)).toEqual(
      Array.from({ length: 6 }, () => "non-result"),
    );
    expect(bodies[5]).toMatchObject({ validation: { rehearsalsLeft: 0 } });
    expect(bodies[6]).toMatchObject({ status: "blocked", stage: "budget", rehearsalsLeft: 0 });
    expect(readdirSync(evidence).sort()).toEqual(
      Array.from({ length: 6 }, (_row, index) => `rehearsal-${index + 1}`),
    );
    expect(existsSync(join(evidence, "rehearsal-1", "cases/t1/public-task.json"))).toBe(true);
  });

  it("keeps an earlier session's rehearsal evidence when a second session rehearses", async () => {
    // The ordinal counts rehearsals within a session; the directory is the campaign's. A second
    // authoring session therefore opened at rehearsal-1 again and wrote over the first session's
    // solve, which is the one record rule 6 asks each session to keep.
    const dir = workspace();
    const evidence = mkdtempSync(join(runtimeProcess.cwd(), ".ana-scratch-trial-sessions-"));
    scratch.push(evidence);
    const session = () =>
      createHarnessTrialTool({
        workspace: dir,
        context: { slug: "matching" },
        rehearsalDir: evidence,
        builtSolver: () => scriptedBuiltSolver(SOLVES),
      });
    const first = session();
    await first.execute("trial", { taskId: "t1" });
    await first.execute("trial", { taskId: "t1" });
    await session().execute("trial", { taskId: "t1" });
    expect(readdirSync(evidence).sort()).toEqual(["rehearsal-1", "rehearsal-2", "rehearsal-3"]);
    for (const name of ["rehearsal-1", "rehearsal-2", "rehearsal-3"]) {
      expect(existsSync(join(evidence, name, "cases/t1/public-task.json"))).toBe(true);
    }
  });

  it("describes a blind measurement and publishes no construction detail", () => {
    const described = createHarnessTrialTool({
      workspace: workspace(),
      context: { slug: "matching" },
    }).description;
    expect(described).toContain("solves the named task blind");
    expect(described).toContain("no hidden expectations, no reference solve");
    expect(described).toContain("A task your solver passes first time is a task the battery will pass");
    // The author-driven scenario is gone: nothing here asks the Builder to supply calls.
    expect(described).not.toContain("deliberately ordinary answer");
    expect(described).not.toContain("calls");
  });
});
