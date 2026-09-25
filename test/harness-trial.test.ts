/**
 * The one bounded hole in the evaluator-coaching wall, tested as a boundary rather than as a
 * function at a time.
 *
 * The Builder writes the tasks and the hidden expectations, so anything the verifier learns is, to
 * the Builder, its own answer key. AGENTS.md rule 4 therefore protects verifier stdout and stderr,
 * issue and remedy text, verifier source and internal payloads, generated counterexamples,
 * reference artifacts and per-task failure locations, and lets none of it reach an authoring
 * prompt. `harness_trial` is granted one exception and it is exactly four facts wide: the aggregate
 * pass/fail/not-run verdict over the bytes the confined Built solver submitted unaided, whether it
 * submitted at all, how many turns it took, and any typed non-result.
 *
 * A boundary is tested by pushing protected detail at it and finding none of it on the other side,
 * and by freezing what does cross so that a field added upstream fails here rather than arriving in
 * a prompt. So the cases below do two things a per-function test cannot. They hand the projection a
 * verifier result dense with every protected class — including the check-naming sentences
 * `acceptedOutcome` in `src/truth/solve-case.ts` composes today and `rehearseCase` happens to drop
 * — and assert the crossing key set rather than a list of strings someone thought of. And they take
 * a census of every key path in the model-visible result of a real rehearsal, so that a new field
 * anywhere fails by default.
 *
 * Which surface is model-visible matters for reading these assertions. `defineTool` returns an
 * `AgentToolResult`, pi-agent-core turns it into a `toolResult` message carrying both `content` and
 * `details`, and `convertToolResult` in `@earendil-works/pi-ai` puts only `content` on the wire.
 * `text` is therefore the whole model-visible result and `details` is host evidence, which is what
 * AGENTS.md rule 14 says. The marker sweeps below run over the whole tool result all the same, so
 * they hold whichever of the two a future transport decides to send.
 */
import { afterAll, describe, expect, it } from "bun:test";
import { Type } from "typebox";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "../src/meta/filesystem.ts";
import { join } from "../src/meta/path.ts";
import { keyIfNotNull, keysIf } from "../src/meta/optional-key.ts";
import { asRecord, isString, type JsonObject } from "../src/meta/json-shape.ts";
import { createHarnessTrialTool, verifierView } from "../src/builder/harness-trial.ts";
import { RehearsalTraces } from "../src/builder/context-tool.ts";
import type { RehearsalRow } from "../src/author/experiment-plan.ts";
import { createBuiltStarter } from "../src/solve/built-starter.ts";
import { defineDraftTool } from "../src/solve/draft-tool.ts";
import { type Solver, withSolverBuiltStarterFactory } from "../src/truth/solve.ts";
import { REHEARSAL_VERIFIER_DEADLINE_MS } from "../src/truth/solve-case.ts";
import { createVerifierLifetime } from "../src/verify/verifier-lifetime.ts";
import {
  MATCHING_BRIEF,
  MATCHING_OPERATING_GUIDE,
  writeMatchingBuildFixture,
} from "./helpers/matching-fixture.ts";
import { cleanupScratch, scratchDir } from "./helpers/scratch.ts";
import { double, required } from "./helpers/doubles.ts";

/** The task every case rehearses: one part, one slot, two applicable checks. */
const TASK_ID = "t1";
const RIGHT_SLOT = "s3";
const WRONG_SLOT = "s9";
const SOLE_PART = "alpha";
const WRITER = "write_answer";
const SUBMIT = "submit";
const GUIDE_FILE = "agent/BUILT_AGENTS.md";

/** The two check ids the fixture's evaluator declares. Every one of them is a check identity, which
 *  rule 4 withholds whatever the verdict was, so they double as search markers below. */
const FAILING_CHECK = "expected-binding";
const PASSING_CHECK = "parts-assigned";

/**
 * A verifier result carrying every class of detail rule 4 protects.
 *
 * The first four fields are what `rehearseCase` returns today. The next two are the sentences
 * `acceptedOutcome` composes for a tool that reached no completed run and for an externally
 * grounded check that ran no tool: both name a check id, both exist in source right now, and both
 * survive only because `rehearseCase` returns `outcome.nonResultKind` rather than `outcome`. The
 * rest stand in for the classes the rule names that have no producer here yet.
 */
const DENSE_VERIFIER_RESULT = {
  status: "completed",
  kind: "verifier",
  truthOk: false,
  reason: `tool "z3-marker" for check "${FAILING_CHECK}" reached no completed run (timeout)`,
  nonResultKind: `externally grounded check(s) "${PASSING_CHECK}" ran no tool for this case`,
  failedCheckIds: [FAILING_CHECK],
  checkResults: { [PASSING_CHECK]: true, [FAILING_CHECK]: false },
  stdout: `stdout-marker: slot ${RIGHT_SLOT} expected, ${WRONG_SLOT} given`,
  stderr: "stderr-marker: evaluator.ts:31",
  issues: [{ code: "issue-marker", remedy: `remedy-marker: bind ${SOLE_PART} to ${RIGHT_SLOT}` }],
  counterexample: { assignments: [{ part: SOLE_PART, slot: RIGHT_SLOT }] },
  referenceArtifact: { assignments: [{ part: SOLE_PART, slot: RIGHT_SLOT }] },
  failureLocation: "$.assignments[0].slot",
  diagnostics: ["diagnostic-marker: 1 of 2 checks ran"],
  evaluatorSource: "export const checks = { 'parts-assigned': () => false }",
};

/** Substrings that must not appear anywhere in the tool result. Each one belongs to a class rule 4
 *  names, and each is distinctive enough that a search for it means what it says. */
const PROTECTED_MARKERS = [
  FAILING_CHECK,
  PASSING_CHECK,
  "z3-marker",
  "stdout-marker",
  "stderr-marker",
  "issue-marker",
  "remedy-marker",
  "diagnostic-marker",
  "counterexample",
  "referenceArtifact",
  "failureLocation",
  "evaluatorSource",
  "failedCheckIds",
  "checkResults",
  "truthOk",
  WRONG_SLOT,
];

/**
 * Every key path the model-visible body of a rehearsal may carry, over every branch these cases
 * reach. Freezing the union is what makes the protected-detail assertion structural: a field added
 * to the verifier result, to the solve view or to the candidate view arrives as a path that is not
 * in this list, and fails here rather than in a Builder's prompt.
 */
const PERMITTED_KEY_PATHS: readonly string[] = [
  // The one bit rule 4 lets a rehearsal return, and the reach of the execution that produced it.
  "truth.verdict",
  "verifier.status",
  "verifier.kind",
  "verifier.reason",
  "status",
  "stage",
  // Whether it submitted at all, how many turns it took, and any typed non-result.
  "solve.accepted",
  "solve.turns",
  "solve.toolCalls",
  "solve.nonResult",
  // What the solve spent, as a plain fact: minutes against the wall, tool calls and cost.
  "solve.effort",
  // Where EXPERIMENT.json and the round's rehearsal verdicts disagree: the verdicts already returned.
  "planAdvice[]",
  "error",
  // Public identities of the task the caller selected, which the caller authored.
  "task.taskId",
  "task.family",
  "task.publicTaskDigest",
  "taskId",
  "availableTaskIds[]",
  "totalTasks",
  // The candidate's own bytes and the candidate's own static authoring findings.
  "candidate.candidateId",
  "candidate.stable",
  "candidate.staticFindings.totalFindings",
  "candidate.staticFindings.totalGroups",
  "candidate.staticFindings.from",
  "candidate.staticFindings.to",
  "candidate.staticFindings.more",
  "candidate.staticFindings.groups[]",
  "candidate.staticFindings.navigation",
  "findings.totalFindings",
  "findings.totalGroups",
  "findings.from",
  "findings.to",
  "findings.more",
  "findings.groups[]",
  "findings.navigation",
  // The round's own budget arithmetic, which is the sum of bits already returned.
  "validation.outcome",
  "validation.submitted",
  "validation.truthVerdict",
  "validation.rehearsalsLeft",
  "validation.round.graded",
  "validation.round.passed",
  "validation.round.passedInOneTurn",
  "rehearsalsLeft",
  "nextAction",
];

/** The exact census of a rehearsal that reached a verdict. The union above catches an addition
 *  anywhere; this catches a removal on the branch that matters most. */
const VERDICT_KEY_PATHS: readonly string[] = [
  "candidate.candidateId",
  "candidate.stable",
  "candidate.staticFindings.from",
  "candidate.staticFindings.groups[]",
  "candidate.staticFindings.more",
  "candidate.staticFindings.navigation",
  "candidate.staticFindings.to",
  "candidate.staticFindings.totalFindings",
  "candidate.staticFindings.totalGroups",
  "nextAction",
  "solve.accepted",
  "solve.effort",
  "solve.nonResult",
  "solve.toolCalls",
  "solve.turns",
  "status",
  "task.family",
  "task.publicTaskDigest",
  "task.taskId",
  "truth.verdict",
  "validation.outcome",
  "validation.rehearsalsLeft",
  "validation.round.graded",
  "validation.round.passed",
  "validation.round.passedInOneTurn",
  "validation.submitted",
  "validation.truthVerdict",
  "verifier.status",
];

afterAll(cleanupScratch);

/** A candidate workspace holding the shared matching bundle. The scratch root sits inside the
 *  checkout so the compiled correctness model resolves `@ana/*` through the root node_modules. */
function workspace(): string {
  const dir = scratchDir(".ana-scratch-harness-trial-", import.meta.dir);
  writeMatchingBuildFixture(dir);
  return dir;
}

/** Every key path in a parsed body, arrays rendered once as `name[]` and walked through their
 *  first element. Sorted, so a census reads as a set rather than as an insertion order. */
function keyPaths(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value)) {
    const head = value[0];
    return [`${prefix}[]`, ...(head === undefined ? [] : keyPaths(head, `${prefix}[]`))];
  }
  const row = asRecord(value);
  if (row === null) return prefix === "" ? [] : [prefix];
  return Object.keys(row)
    .flatMap((key) => keyPaths(row[key], prefix === "" ? key : `${prefix}.${key}`))
    .sort();
}

/** The model-visible half of a tool result: the text content, parsed. */
function modelVisible(result: unknown): JsonObject {
  const content = asRecord(result)?.content;
  if (!Array.isArray(content)) throw new Error("the tool result carries no content");
  const body = asRecord(content[0])?.text;
  if (!isString(body)) throw new Error("the first content block carries no text");
  return required(asRecord(JSON.parse(body)), "a parsed rehearsal body");
}

function expectNoProtectedDetail(subject: string): void {
  for (const marker of PROTECTED_MARKERS) expect(subject).not.toContain(marker);
}

function expectWithinCensus(body: JsonObject): void {
  for (const path of keyPaths(body)) expect(PERMITTED_KEY_PATHS).toContain(path);
}

/**
 * A solver that writes the assignments it is given and submits, or stops short when told to. It is
 * the measured Built solver's stand-in: it reaches the registered tools through the starter the
 * trial builds, and it is never told what the hidden expectations are.
 */
function assigningSolver(slot: string | null, submitting = true, onSolve?: () => void): Solver {
  const solver: Solver = async (_task, toolset) => {
    onSolve?.();
    const byName = new Map(toolset.tools.map((tool) => [tool.name, tool]));
    const call = async (name: string, params: JsonObject) => {
      const tool = required(byName.get(name), `a registered "${name}" tool`);
      await tool.execute("call", double(params), undefined);
    };
    if (slot !== null) await call(WRITER, { assignments: [{ part: SOLE_PART, slot }] });
    if (submitting) await call(SUBMIT, {});
    return { turns: 1, completedTurns: 1, errors: [], toolCalls: 2, startedToolCalls: 2 };
  };
  return withSolverBuiltStarterFactory(solver, async (_slugDir, task, submission, schema) =>
    createBuiltStarter(
      task,
      () => ({
        tools: [
          defineDraftTool({
            name: WRITER,
            label: "Write answer",
            description: "Write the complete structured answer.",
            executionMode: "sequential",
            parameters: Type.Object({ assignments: Type.Unknown() }),
            run(params, draft) {
              draft.setArtifact(double(params));
              return { text: "answer written" };
            },
          }),
        ],
      }),
      submission,
      {
        domainToolAuthorities: [{ name: WRITER, authority: "artifact-writer" }],
        publicArtifactSchema: schema,
      },
    ),
  );
}

/** One round: a workspace, its evidence directory and the tool the Builder would call. A round with
 *  no lifetime is the bound the caller wants when the verifier must not run. */
function round(
  dir: string,
  solver: Solver | null,
  verifying = true,
  plan: Pick<Parameters<typeof createHarnessTrialTool>[0], "rehearsals" | "onRehearsal"> = {},
) {
  const rehearsalDir = join(dir, "rehearsals");
  const tool = createHarnessTrialTool({
    workspace: dir,
    context: { slug: "matching" },
    rehearsalDir,
    ...plan,
    ...keyIfNotNull("builtSolver", solver === null ? null : () => solver),
    ...keysIf(verifying, () => ({
      verifierLifetime: createVerifierLifetime({ root: join(dir, ".verifier") }),
    })),
  });
  return { rehearsalDir, tool };
}

async function rehearse(tool: ReturnType<typeof round>["tool"], taskId = TASK_ID, signal?: AbortSignal) {
  return tool.execute("call", double({ taskId }), signal);
}

describe("what a rehearsal may tell its author about its own answer key", () => {
  it("passes on the execution status and the typed non-result kind, and nothing else in the verifier result", () => {
    const view = verifierView(DENSE_VERIFIER_RESULT);

    expect(Object.keys(view).sort()).toEqual(["execution", "truthOk"]);
    expect(Object.keys(view.execution).sort()).toEqual(["kind", "status"]);
    expect(view.execution).toEqual({ status: "completed", kind: "verifier" });
    expectNoProtectedDetail(JSON.stringify(view.execution));
  });

  it("carries none of the protected classes into either surface of a real failing rehearsal", async () => {
    const dir = workspace();
    const { tool } = round(dir, assigningSolver(WRONG_SLOT));
    const result = await rehearse(tool);
    const body = modelVisible(result);

    expect(body.truth).toEqual({ verdict: "fail" });
    expect(body.verifier).toEqual({ status: "completed" });
    // Both surfaces at once, so the sweep does not depend on which one a transport sends today.
    expectNoProtectedDetail(JSON.stringify(result));
    expect(keyPaths(body)).toEqual([...VERDICT_KEY_PATHS]);
  }, 60_000);

  /**
   * The boundary runs in both directions, and this is the inbound half. A caller that could supply
   * the solve would be the author playing solver while holding the answer key, so the measurement
   * would say nothing about the battery. A schema naming one task is what closes that off, and it
   * closes it harder than any sentence in the description: a parameter that does not exist cannot
   * be passed.
   */
  it("lets the author name a task and nothing else, so it cannot supply the solve", () => {
    const { tool } = round(workspace(), assigningSolver(RIGHT_SLOT));

    expect(Object.keys(tool.parameters.properties)).toEqual(["taskId"]);
    expect(tool.parameters.required).toEqual(["taskId"]);
  });

  /**
   * The dense fixture above stands in for a verifier result; this drives the real one. An external
   * check whose declared tool never runs makes `acceptedOutcome` compose a sentence naming that
   * check by id, and the whole of rule 4's wall on that branch is that `rehearseCase` returns the
   * kind and drops the sentence. So this asserts over the sentence's own words rather than over a
   * shape: the two checks both pass here, and the only reason there is no verdict is the missing
   * tool run — which the Builder is told about as `verifier`, and not by name.
   */
  it("names no check when a grounded check decided without running its tool", async () => {
    const dir = workspace();
    const brief = structuredClone(MATCHING_BRIEF);
    for (const check of brief.truthChecks) {
      if (check.id === FAILING_CHECK) {
        check.execution.evidence = { kind: "external", requiredToolIds: ["cat"] };
      }
    }
    writeFileSync(join(dir, "correctness-model/brief.json"), JSON.stringify(brief));
    writeFileSync(
      join(dir, "correctness-model/evaluator.ts"),
      `export const checks = { "${PASSING_CHECK}": () => true, "${FAILING_CHECK}": () => true };`,
    );
    const result = await rehearse(round(dir, assigningSolver(RIGHT_SLOT)).tool);
    const body = modelVisible(result);

    expect(body.verifier).toEqual({ status: "non-result", kind: "verifier" });
    expect(body.truth).toEqual({ verdict: "not-run" });
    expectNoProtectedDetail(JSON.stringify(result));
    expectWithinCensus(body);
  }, 60_000);
});

describe("what a rehearsal hands the round plan", () => {
  // The plan's evidence and the traces source receive the verdict the result already states and
  // what the solve spent; a failing solve's trace would show where a check bit, so it stays out.
  it("records the verdict and effort, returns the plan's advice, and offers only a passing trace", async () => {
    const dir = workspace();
    const rehearsals = new RehearsalTraces();
    const rows: RehearsalRow[] = [];
    const plan = {
      rehearsals,
      onRehearsal: (row: RehearsalRow) => {
        rows.push(row);
        return row.verdict === "pass" ? ["Advice: a stand-in line."] : [];
      },
    };
    const passing = modelVisible(await rehearse(round(dir, assigningSolver(RIGHT_SLOT), true, plan).tool));
    const failing = modelVisible(await rehearse(round(dir, assigningSolver(WRONG_SLOT), true, plan).tool));

    expect(passing.planAdvice).toEqual(["Advice: a stand-in line."]);
    expect(failing.planAdvice).toBeUndefined();
    expectWithinCensus(passing);
    expect(rows.map((row) => [row.taskId, row.verdict, row.toolCalls, row.wallMinutes])).toEqual([
      [TASK_ID, "pass", 2, 120],
      [TASK_ID, "fail", 2, 120],
    ]);
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual([
      "costUsd",
      "family",
      "minutes",
      "taskId",
      "toolCalls",
      "verdict",
      "wallMinutes",
    ]);
    expect(rehearsals.list().map((doc) => doc.id)).toEqual([`traces/rehearsal-1/${TASK_ID}`]);
    for (const doc of rehearsals.list()) expectNoProtectedDetail("text" in doc ? doc.text() : "");
  }, 60_000);
});

describe("the four facts that do cross", () => {
  // A pass crosses the same fields as a fail, so the census is not the verdict's, and the host
  // receipt holds only identities the text already states.
  it("decides the verdict from the bytes the solver submitted, not from the task", async () => {
    const dir = workspace();
    const passed = await rehearse(round(dir, assigningSolver(RIGHT_SLOT)).tool);
    const passing = modelVisible(passed);
    const failing = modelVisible(await rehearse(round(dir, assigningSolver(WRONG_SLOT)).tool));

    expect(asRecord(passing.task)?.taskId).toBe(asRecord(failing.task)?.taskId);
    expect(passing.truth).toEqual({ verdict: "pass" });
    expect(failing.truth).toEqual({ verdict: "fail" });
    expect(keyPaths(passing)).toEqual([...VERDICT_KEY_PATHS]);
    const details = required(asRecord(passed.details), "the tool details");
    expect(Object.keys(details).sort()).toEqual(["receipt", "taskId"]);
    expect(Object.keys(required(asRecord(details.receipt), "the receipt")).sort()).toEqual([
      "candidateId",
      "outcome",
      "submitted",
      "truthVerdict",
      "turns",
    ]);
    // A miss is stated as the mirror of a pass and names no next task: a first battery is authored to
    // be missed, so steering towards an easier rehearsal would choose the Builder's course for it.
    const missed = isString(failing.nextAction) ? failing.nextAction : "";
    expect(missed).toContain("a battery of tasks like it scores near zero");
    expect(missed).not.toMatch(/easier|rehearse a/);
    expect(passing.solve).toEqual({
      accepted: true,
      turns: 1,
      toolCalls: 2,
      effort: "unrecorded minutes of a 120-minute solve wall, 2 tool calls, cost unreported",
      nonResult: null,
    });
  }, 60_000);

  it("says a solve that submitted nothing is unaccepted, and reaches no verdict over bytes that do not exist", async () => {
    const dir = workspace();
    const body = modelVisible(await rehearse(round(dir, assigningSolver(RIGHT_SLOT, false)).tool));

    expect(body.status).toBe("unaccepted");
    expect(asRecord(body.solve)?.accepted).toBe(false);
    expect(body.truth).toEqual({ verdict: "not-run" });
    expect(body.verifier).toEqual({ status: "not-run" });
    expectWithinCensus(body);
  }, 60_000);

  it("refuses a rehearsal with no Built solver bound rather than measuring a different agent", async () => {
    const dir = workspace();
    const { tool } = round(dir, null);
    const body = modelVisible(await rehearse(tool));

    expect(body.status).toBe("non-result");
    expect(body.stage).toBe("solver");
    expect(body.error).toContain("no Built solver is bound");
    // No solver ran, so no bytes were graded and the body states no verdict of its own. The one
    // place a verdict is spelled says not-run, which is the honest reading: a rehearsal that
    // measured nothing is neither hard nor easy evidence.
    expect(body.truth).toBeUndefined();
    expect(asRecord(body.validation)?.truthVerdict).toBe("not-run");
    expectWithinCensus(body);
  }, 60_000);

  it("reports a verifier it could not reach as a typed non-result, never as a miss", async () => {
    const dir = workspace();
    const { tool } = round(dir, assigningSolver(RIGHT_SLOT), false);
    const body = modelVisible(await rehearse(tool));

    expect(body.verifier).toEqual({ status: "non-result", kind: "verifierUnavailable" });
    expect(body.status).toBe("non-result");
    expect(body.truth).toEqual({ verdict: "not-run" });
    expect(isString(body.nextAction) ? body.nextAction : "").toContain("neither hard nor easy evidence");
    expectWithinCensus(body);
  }, 60_000);

  it("withholds a verdict when the candidate moved under the solve", async () => {
    const dir = workspace();
    const { tool } = round(
      dir,
      assigningSolver(RIGHT_SLOT, true, () => {
        writeFileSync(join(dir, GUIDE_FILE), `${MATCHING_OPERATING_GUIDE}\nedited mid-solve\n`);
      }),
    );
    const body = modelVisible(await rehearse(tool));

    expect(body.status).toBe("candidate-changed");
    expect(body.verifier).toEqual({ status: "not-run", reason: "candidate-changed" });
    expect(body.truth).toEqual({ verdict: "not-run" });
    expect(asRecord(body.candidate)?.candidateId).toBeNull();
    expectWithinCensus(body);
  }, 60_000);
});

describe("what one round of rehearsals costs", () => {
  it("spends six measured cases and then refuses, and says the same number it enforces", async () => {
    const dir = workspace();
    let solves = 0;
    const { tool } = round(
      dir,
      assigningSolver(RIGHT_SLOT, true, () => {
        solves += 1;
      }),
    );
    const left: unknown[] = [];
    for (let attempt = 0; attempt < 7; attempt += 1) {
      const body = modelVisible(await rehearse(tool));
      left.push(asRecord(body.validation)?.rehearsalsLeft ?? body.rehearsalsLeft);
    }

    expect(left).toEqual([5, 4, 3, 2, 1, 0, 0]);
    expect(solves).toBe(6);
    const blocked = modelVisible(await rehearse(tool));
    expect(blocked.stage).toBe("budget");
    expect(isString(blocked.nextAction) ? blocked.nextAction : "").not.toMatch(/\bDecide\b/);
    expect(tool.description).toContain(`At most ${String(solves)} rehearsals per round`);
    expect(tool.description).toContain(
      `${String(REHEARSAL_VERIFIER_DEADLINE_MS / 1000)}-second total verifier deadline`,
    );
  }, 120_000);

  it("charges nothing for a call that never reached a solve", async () => {
    const dir = workspace();
    let solves = 0;
    const { tool } = round(
      dir,
      assigningSolver(RIGHT_SLOT, true, () => {
        solves += 1;
      }),
    );
    const unknownTask = modelVisible(await rehearse(tool, "no-such-task"));
    expect(unknownTask.status).toBe("blocked");
    expect(unknownTask.stage).toBe("task");
    expect(unknownTask.rehearsalsLeft ?? asRecord(unknownTask.validation)?.rehearsalsLeft).toBe(6);
    expectWithinCensus(unknownTask);

    const blank = modelVisible(await rehearse(tool, "   "));
    expect(blank.stage).toBe("request");

    const cancelled = modelVisible(await rehearse(tool, TASK_ID, AbortSignal.abort()));
    expect(cancelled.stage).toBe("cancelled");

    expect(solves).toBe(0);
    expect(asRecord(modelVisible(await rehearse(tool)).validation)?.rehearsalsLeft).toBe(5);
  }, 60_000);

  it("gives each round its own budget, because the tool instance is the round", async () => {
    const dir = workspace();
    const first = round(dir, assigningSolver(RIGHT_SLOT));
    await rehearse(first.tool);
    const second = round(dir, assigningSolver(RIGHT_SLOT));
    const body = modelVisible(await rehearse(second.tool));

    expect(asRecord(body.validation)?.rehearsalsLeft).toBe(5);
    expect(asRecord(body.validation)?.round).toEqual({ graded: 1, passed: 1, passedInOneTurn: 1 });
  }, 60_000);

  it("adds the round's own record to a result once two rehearsals have been graded", async () => {
    const dir = workspace();
    const { tool } = round(dir, assigningSolver(RIGHT_SLOT));
    const first = modelVisible(await rehearse(tool));
    const second = modelVisible(await rehearse(tool));

    expect(isString(first.nextAction) ? first.nextAction : "").not.toContain("Across this round");
    expect(isString(second.nextAction) ? second.nextAction : "").toContain(
      "Across this round your solver has now passed 2 of 2 graded rehearsals",
    );
    expect(asRecord(second.validation)?.round).toEqual({ graded: 2, passed: 2, passedInOneTurn: 2 });
  }, 60_000);
});

describe("where a rehearsal's solve evidence is kept", () => {
  it("writes one directory per rehearsal under the campaign, named by its ordinal", async () => {
    const dir = workspace();
    const { rehearsalDir, tool } = round(dir, assigningSolver(RIGHT_SLOT));
    await rehearse(tool);
    await rehearse(tool);

    expect(readdirSync(rehearsalDir).sort()).toEqual(["rehearsal-1", "rehearsal-2"]);
    const caseDir = join(rehearsalDir, "rehearsal-1", "cases", TASK_ID);
    expect(existsSync(join(caseDir, "public-task.json"))).toBe(true);
    expect(existsSync(join(caseDir, "final-submission.json"))).toBe(true);
  }, 60_000);

  it("takes the next free name rather than writing over an earlier session's solve", async () => {
    const dir = workspace();
    const { rehearsalDir, tool } = round(dir, assigningSolver(RIGHT_SLOT));
    mkdirSync(join(rehearsalDir, "rehearsal-1"), { recursive: true });
    await rehearse(tool);

    expect(readdirSync(rehearsalDir).sort()).toEqual(["rehearsal-1", "rehearsal-2"]);
    expect(existsSync(join(rehearsalDir, "rehearsal-1", "cases"))).toBe(false);
    expect(existsSync(join(rehearsalDir, "rehearsal-2", "cases", TASK_ID))).toBe(true);
  }, 60_000);

  it("discards the evidence and changes nothing else when the round has nowhere to write it", async () => {
    const dir = workspace();
    const tool = createHarnessTrialTool({
      workspace: dir,
      context: { slug: "matching" },
      builtSolver: () => assigningSolver(RIGHT_SLOT),
      verifierLifetime: createVerifierLifetime({ root: join(dir, ".verifier") }),
    });
    const body = modelVisible(await rehearse(tool));

    expect(body.truth).toEqual({ verdict: "pass" });
    expect(existsSync(join(dir, "rehearsals"))).toBe(false);
  }, 60_000);
});
