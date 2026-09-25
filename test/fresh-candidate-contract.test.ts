/**
 * What a candidate owes before it may be measured: a readable bundle, an author-visible refusal
 * that leaks no protected byte, published rules the solver can read, an agent that can actually
 * solve, and one accepted byte identity.
 *
 * Every case runs against one fixture bundle — the matching slug, which is complete enough for a
 * fresh build — and changes exactly one fact of it. The gate stages that consume an accepted
 * candidate (conformance, census, F2) are proved by their own files; this one owns the contract
 * that decides whether those stages ever run.
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "../src/meta/filesystem.ts";
import { tmpdir } from "../src/meta/os.ts";
import { join } from "../src/meta/path.ts";
import { afterEach, describe, expect, it } from "bun:test";
import { initWorkspace, workspaceHead, workspaceStatus } from "../src/author/domain-repo.ts";
// Gate audit 2026-09-25 (docs/gate-audit.md, operating-guide-retired-tool): commented out (unsure): only the
// retired-tool cases below read it.
// import { commitAll } from "../src/author/domain-repo.ts";
import { freshCandidateFindings } from "../src/author/fresh-candidate-contract.ts";
import {
  type CandidateCheckContext,
  type CandidateCheckOutcome,
  loadValidatedBundle,
  checkCandidate,
  // Gate audit 2026-09-25 (docs/gate-audit.md, operating-guide-retired-tool): commented out (unsure): only
  // the retired-tool cases below read it.
  // retiredToolFindings,
  validatedBundle,
} from "../src/author/candidate-check.ts";
import { double, required } from "./helpers/doubles.ts";
import { projectFindingForAuthor } from "../src/truth/brief.ts";
// Gate audit 2026-09-25 (docs/gate-audit.md, published-rules): commented out (unsure): only the
// published-rule cases below read it.
// import type { Brief } from "../src/truth/brief.ts";
import { parseJsonAs } from "../src/meta/json-runtime.ts";
import type { JsonObject } from "../src/meta/json-shape.ts";
import { probeGeneratedCorrectnessModelModule } from "../src/truth/contracts.ts";
import { createVerifierLifetime } from "../src/verify/verifier-lifetime.ts";
import {
  MATCHING_ACCEPTS,
  MATCHING_BRIEF,
  // Gate audit 2026-09-25 (docs/gate-audit.md, operating-guide-policy, operating-guide-retired-tool):
  // commented out (unsure): only the guide cases below read it.
  // MATCHING_OPERATING_GUIDE,
  MATCHING_REJECTS,
  MATCHING_TASKS,
  MATCHING_TOOLS_SPEC,
  padToCalibrationFloor,
  writeMatchingBuildFixture,
} from "./helpers/matching-fixture.ts";

const scratch: string[] = [];
const ASK = { slug: "matching" };
type Ask = Partial<CandidateCheckContext>;
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** One workspace per case, so an edit cannot reach another. Git-initialised, because a refusal is
 *  memory: candidate validation commits the tree it refused. */
function workspace(): string {
  const dir = mkdtempSync(join(import.meta.dir, ".ana-scratch-candidate-"));
  scratch.push(dir);
  initWorkspace(dir);
  writeMatchingBuildFixture(dir);
  return dir;
}

function lifetime(): ReturnType<typeof createVerifierLifetime> {
  const root = mkdtempSync(join(tmpdir(), "ana-candidate-receipts-"));
  scratch.push(root);
  return createVerifierLifetime({ root });
}

const codes = (findings: Array<{ code: string }>): string[] => findings.map((finding) => finding.code);
const bundleCodes = (dir: string, context: Ask = {}): string[] =>
  codes(loadValidatedBundle(dir, { ...ASK, ...context }).findings);

function refusal(outcome: CandidateCheckOutcome): Extract<CandidateCheckOutcome, { ok: false }> {
  if (outcome.ok) throw new Error("expected a refusal");
  return outcome;
}

function refuse(dir: string, context: Ask = {}): Extract<CandidateCheckOutcome, { ok: false }> {
  return refusal(checkCandidate(dir, { ...ASK, ...context }));
}

function accept(dir: string, context: Ask = {}): void {
  const outcome = checkCandidate(dir, { ...ASK, ...context });
  if (!outcome.ok) throw new Error(JSON.stringify(outcome.findings));
}

/** The fixture's own typed values go back to disk as they are; JSON.stringify owns the shape. */
const writeJson = <T>(dir: string, path: string, value: T): void =>
  writeFileSync(join(dir, path), JSON.stringify(value));

const readSpec = (dir: string): JsonObject =>
  parseJsonAs<JsonObject>(readFileSync(join(dir, "agent/tools-spec.json"), "utf8"));

const corpus = () => ({
  accept: padToCalibrationFloor("accept", structuredClone(MATCHING_ACCEPTS)),
  reject: padToCalibrationFloor("reject", structuredClone(MATCHING_REJECTS)),
});

const T1 = required(MATCHING_TASKS[0], "first fixture task");
const T2 = required(MATCHING_TASKS[1], "second fixture task");

describe("the bundle a candidate must present", () => {
  it.each(["correctness-model/controls.json", "agent/BUILT_AGENTS.md"])(
    "names a missing %s and still commits the tree, because a refusal is memory",
    (path) => {
      const dir = workspace();
      unlinkSync(join(dir, path));
      const outcome = refuse(dir);
      expect(outcome.stage).toBe("bundle");
      expect(outcome.findings).toEqual([expect.objectContaining({ code: "missing-bundle-file", path })]);
      expect(workspaceStatus(dir)).toEqual({ clean: true, dirtyPaths: [] });
      expect(outcome.commit).toMatch(/^[0-9a-f]{40}$/);
    },
  );

  it("reads malformed JSON as the absent-file repair instead of throwing", () => {
    const dir = workspace();
    writeFileSync(join(dir, "correctness-model/tasks.json"), "{");
    expect(bundleCodes(dir)).toContain("missing-bundle-file");
  });

  // Run 766284 (2026-09-16) met one validator per check, four checks in 60 seconds: the tools spec,
  // the guide and the controls envelope do not read the brief, so an unreadable brief must not
  // hide them.
  it("reports the tools spec, operating guide and controls envelope beside an unreadable brief", () => {
    const dir = workspace();
    writeFileSync(join(dir, "correctness-model/brief.json"), "{}");
    writeFileSync(join(dir, "correctness-model/controls.json"), "[]");
    writeJson(dir, "agent/tools-spec.json", { presets: ["bogus"], tools: [] });
    writeFileSync(join(dir, "agent/BUILT_AGENTS.md"), " ");
    const { findings, brief } = loadValidatedBundle(dir, ASK);
    expect(brief).toBeNull();
    const named = findings.map(({ code, path }) => `${code} ${path}`);
    // Gate audit 2026-09-25 (docs/gate-audit.md, operating-guide-policy): commented out (unsure): a blank
    // guide is no longer refused by shape.
    // expect(named).toContain("operating-guide-shape agent/BUILT_AGENTS.md");
    expect(named).toContain("shape-mismatch correctness-model/controls.json");
    expect(named.some((row) => row.startsWith("tools-"))).toBe(true);
    expect(named.some((row) => row.includes("correctnessContract"))).toBe(true);
  });

  // The shape Run 36 attempt 2 invented and kept through 16 submits.
  it("names the required task shape instead of one fail-closed label", () => {
    const dir = workspace();
    writeJson(dir, "correctness-model/tasks.json", [
      { id: "t1", title: "desk fan", prompt: "pick parts", input: {}, expected: {} },
    ]);
    const outcome = refuse(dir);
    expect(outcome.findings).toContainEqual({
      code: "shape-mismatch",
      path: "tasks[0]",
      detail: expect.stringContaining('{"taskId": string, "family": string, "publicInput": any'),
      disclosure: { class: "authored" },
    });
    expect(codes(outcome.findings)).not.toContain("generated-execution-unclassified");
  });

  // The fixture authors four tasks. An exact ask counts them; a probe round's minTasks turns that
  // into a range, and the refusal must name the range rather than a size the round never required.
  it("counts the battery against the size the ask requires", () => {
    const dir = workspace();
    expect(refuse(dir, { exactTasks: 5 }).findings).toContainEqual({
      code: "tasks-exact-census",
      path: "tasks",
      detail: expect.stringContaining("requires exactly 5 tasks; found 4"),
      disclosure: { class: "authored" },
    });
    accept(dir, { exactTasks: 5, minTasks: 3 });
    expect(refuse(dir, { exactTasks: 8, minTasks: 5 }).findings).toContainEqual({
      code: "tasks-exact-census",
      path: "tasks",
      detail: expect.stringContaining("requires between 5 and 8 tasks; found 4"),
      disclosure: { class: "authored" },
    });
  });

  it("refuses a VCS or dependency root while hashing ordinary named directories", () => {
    const dependencies = workspace();
    mkdirSync(join(dependencies, "correctness-model/node_modules"), { recursive: true });
    writeFileSync(
      join(dependencies, "correctness-model/node_modules/loaded.js"),
      "export const hidden = true;\n",
    );
    expect(refuse(dependencies).findings).toContainEqual(
      expect.objectContaining({ code: "non-regular-entry", path: "node_modules" }),
    );

    const nested = workspace();
    mkdirSync(join(nested, "agent/nested/.git"), { recursive: true });
    writeFileSync(join(nested, "agent/nested/.git/config"), "[core]\n\tbare = false\n");
    expect(refuse(nested).findings).toContainEqual(
      expect.objectContaining({ code: "non-regular-entry", path: "nested/.git" }),
    );

    // Ordinary names that happen to look like build output are the Builder's own files.
    for (const name of ["dist", "runs", "coverage"]) {
      const dir = workspace();
      mkdirSync(join(dir, "correctness-model", name), { recursive: true });
      writeFileSync(join(dir, "correctness-model", name, "loaded.js"), "export const measured = true;\n");
      const outcome = checkCandidate(dir, ASK);
      expect(outcome.ok, name).toBe(true);
      if (outcome.ok) {
        expect(outcome.fingerprint.correctnessModelFiles.map((file) => file.path)).toContain(
          `${name}/loaded.js`,
        );
      }
    }
  });
});

describe("what the refusal may tell the author", () => {
  it("returns findings with only code, detail, path and disclosure", () => {
    const dir = workspace();
    symlinkSync("/etc/hosts", join(dir, "agent/escape-link"));
    const outcome = refuse(dir);
    expect(outcome.stage).toBe("bundle");
    expect(codes(outcome.findings)).toContain("non-regular-entry");
    for (const finding of outcome.findings) {
      expect(Object.keys(finding).sort()).toEqual(["code", "detail", "disclosure", "path"]);
    }
  });

  // Marking the task validator's return public replaced the fail-closed default for that whole
  // producer, so the boundary needs its own check: it reads the brief and the battery, never the
  // control corpus, whose artifacts are protected reference bytes.
  it("keeps task findings byte-identical when only protected control bytes change", () => {
    const breakTasks = (dir: string) => {
      const tasks = double<JsonObject[]>(structuredClone([T1, T2]));
      const [first, second] = tasks;
      if (first === undefined || second === undefined) throw new Error("fixture");
      const { taskId, hidden } = first;
      if (taskId === undefined || !Array.isArray(hidden)) throw new Error("fixture");
      second.taskId = taskId;
      first.hidden = [...hidden, { checkId: "no-such-check", expectation: 1 }];
      writeJson(dir, "correctness-model/tasks.json", tasks);
    };
    const taskOwned = (outcome: Extract<CandidateCheckOutcome, { ok: false }>) =>
      outcome.findings.filter(
        (finding) => finding.code.startsWith("tasks-") || finding.path.startsWith("tasks"),
      );

    const plain = workspace();
    breakTasks(plain);
    const before = taskOwned(refuse(plain, { exactTasks: 3 }));

    const swapped = workspace();
    breakTasks(swapped);
    const controls = parseJsonAs<{
      accept: Array<{ artifact: unknown }>;
      reject: Array<{ artifact: unknown }>;
    }>(readFileSync(join(swapped, "correctness-model/controls.json"), "utf8"));
    for (const row of [...controls.accept, ...controls.reject]) {
      row.artifact = { assignments: [{ part: "PROTECTED-PART", slot: "PROTECTED-SLOT" }] };
    }
    writeJson(swapped, "correctness-model/controls.json", controls);
    const after = taskOwned(refuse(swapped, { exactTasks: 3 }));

    expect(before.length).toBeGreaterThan(2);
    expect(after).toEqual(before);
    expect(JSON.stringify(before)).not.toContain("PROTECTED");
  });

  it("shows a deterministic brief-schema finding and projects an unmarked one as the generic label", () => {
    const dir = workspace();
    writeJson(dir, "correctness-model/brief.json", {
      correctnessContract: "check-program/v1",
      domain: "document-routing",
    });
    const outcome = refuse(dir);
    expect(outcome.findings).toContainEqual({
      code: "shape-mismatch",
      path: "slug",
      detail: "expected a string, got undefined",
      disclosure: { class: "authored" },
    });
    expect(codes(outcome.findings)).not.toContain("generated-execution-unclassified");

    expect(
      projectFindingForAuthor({ code: "protected-code", path: "protected-path", detail: "protected detail" }),
    ).toEqual({
      code: "generated-execution-unclassified",
      path: "generated-execution",
      detail:
        "a check failed while executing your generated code and carries no public detail; use harness_inspect for static diagnostics, harness_trial for the generated solve path, or verifier_workshop for the correctnessModel path",
      disclosure: { class: "authored" },
    });
  });
});

// Gate audit 2026-09-25 (docs/gate-audit.md, published-rules): commented out (unsure): these cases pin the
// published-rule citation refusals and their accepted neighbours.
// /** run23 stated its panel frame, ordering, threshold and latch rules in `decisions`, which the
//  *  public projection withholds, and the family scored 0 of 35 against a checker that enforced them.
//  *  A check may cite the rule it enforces, and the citation must resolve to a row the Built Harness
//  *  actually receives. */
// describe("the rules the solver receives", () => {
//   const findingsFor = (brief: Brief) => freshCandidateFindings({ brief, corpus: corpus() });
//
//   const accepted: Array<[string, (brief: Brief) => void]> = [
//     // truss eaf98f: "model-resolution-rule" governed "design-audit", whose checks cite other rules.
//     // The reverse family-coverage rule was removed 2026-09-15.
//     [
//       "a rule governing a family no citing check applies to",
//       (brief) => {
//         required(brief.ruleDecisions?.[0], "public rule").families = ["single-part", "two-part"];
//         for (const check of brief.truthChecks) check.execution.families = ["single-part"];
//       },
//     ],
//     [
//       "a rule that lists no family at all",
//       (brief) => {
//         delete required(brief.ruleDecisions?.[0], "public rule").families;
//       },
//     ],
//     // Controls decide whether a check reads the rule's inputs; a declared-path match proved nothing
//     // and refused ancestor paths such as `$.limits` for `$.limits.slenderness` (run 077e56).
//     [
//       "a check citing a decision about paths it does not list",
//       (brief) => {
//         required(brief.ruleDecisions?.[0], "public rule").publicInputPaths = ["$.usedAreas"];
//       },
//     ],
//   ];
//   for (const [name, change] of accepted) {
//     it(`accepts ${name}`, () => {
//       const brief = structuredClone(MATCHING_BRIEF);
//       change(brief);
//       expect(findingsFor(brief)).toEqual([]);
//     });
//   }
//
//   // Each row names the identity its refusal must carry: an unpublished rule names the check that
//   // owes one, a dangling citation names the decision id nothing declares.
//   const refused: Array<[string, string, string, (brief: Brief) => void]> = [
//     [
//       "a check that cites no rule",
//       "brief-rule-unpublished",
//       'truth check "parts-assigned"',
//       (brief) => {
//         required(brief.truthChecks[0], "first check").citedDecisionIds = [];
//       },
//     ],
//     // A check may depend on a hidden operand or an external engine. Its assertion alone does not
//     // publish the rule the Built Harness has to satisfy.
//     [
//       "a hidden-expectation check that publishes no rule at all",
//       "brief-rule-unpublished",
//       'truth check "expected-binding"',
//       (brief) => {
//         for (const check of brief.truthChecks) delete check.citedDecisionIds;
//       },
//     ],
//     [
//       "a citation resolving to no declared decision",
//       "brief-cited-decision-withheld",
//       '"binding-completeness"',
//       (brief) => {
//         brief.ruleDecisions = [];
//       },
//     ],
//   ];
//   for (const [name, code, identity, change] of refused) {
//     it(`refuses ${name}`, () => {
//       const brief = structuredClone(MATCHING_BRIEF);
//       change(brief);
//       expect(findingsFor(brief)).toContainEqual(
//         expect.objectContaining({ code, detail: expect.stringContaining(identity) }),
//       );
//     });
//   }
//
//   it("refuses a check citing a decision the projection withholds, naming identities and not the statement", () => {
//     const brief = structuredClone(MATCHING_BRIEF);
//     const decision = required(brief.ruleDecisions?.[0], "public rule");
//     decision.visibility = "private";
//     const found = findingsFor(brief);
//     expect(found).toContainEqual(
//       expect.objectContaining({
//         code: "brief-cited-decision-withheld",
//         path: "truthChecks[0].citedDecisionIds",
//         detail: expect.stringContaining('truth check "parts-assigned"'),
//       }),
//     );
//     const detail = found.find((row) => row.code === "brief-cited-decision-withheld")?.detail ?? "";
//     expect(detail).toContain('"binding-completeness"');
//     expect(detail).not.toContain(decision.statement);
//   });
// });

describe("the agent the solver gets", () => {
  it("refuses a spec declaring both the files and the shell preset", () => {
    const dir = workspace();
    writeJson(dir, "agent/tools-spec.json", { ...readSpec(dir), presets: ["files", "shell"] });
    expect(bundleCodes(dir)).toContain("tools-shell-preset-overlap");
  });

  // Run 8x checked for one file-map root only when starting the worker, so an invalid bundle
  // reached a paid battery and reported a protocol non-result 71 minutes later.
  it("refuses a files preset whose public artifact root cannot carry files", () => {
    const dir = workspace();
    writeJson(dir, "agent/tools-spec.json", { presets: ["files"], tools: MATCHING_TOOLS_SPEC.tools });
    const outcome = refuse(dir);
    expect(outcome.stage).toBe("bundle");
    expect(outcome.findings).toContainEqual(
      expect.objectContaining({
        code: "tools-files-preset-artifact-root",
        path: "agent/tools-spec.json",
        detail: expect.stringContaining("files preset"),
      }),
    );
  });

  it("admits the controller data preset without generated database files", () => {
    const dir = workspace();
    writeJson(dir, "agent/tools-spec.json", {
      presets: ["public-data", "shell"],
      tools: MATCHING_TOOLS_SPEC.tools,
    });
    accept(dir);
  });

  // The controller owns that database. A candidate-authored copy, with or without its reader, is
  // refused rather than loaded: availability is never inferred from a file the candidate wrote.
  for (const extra of [["agent/data.sqlite"], ["agent/data.sqlite", "agent/controller-data-reader.ts"]]) {
    it(`refuses candidate-authored public-data state (${String(extra.length)} file(s))`, () => {
      const dir = workspace();
      for (const path of extra) writeFileSync(join(dir, path), "");
      const outcome = refuse(dir);
      expect(outcome.stage).toBe("bundle");
      expect(outcome.findings).toContainEqual(
        expect.objectContaining({ code: "tools-data-reader-state", path: "agent" }),
      );
    });
  }
});

// Gate audit 2026-09-25 (docs/gate-audit.md, operating-guide-policy): commented out (unsure): these cases pin
// the empty, oversized, placeholder and task-naming guide refusals and their accepted neighbours.
// /** The Built Harness reads this guide. Validation checks for nonempty bounded text carrying no
//  *  task identifier; it does not judge whether the advice is useful. The Builder remains
//  *  responsible for writing a procedure that serves the domain. */
// describe("the operating guide", () => {
//   const guide = (dir: string, text: string) => writeFileSync(join(dir, "agent/BUILT_AGENTS.md"), text);
//
//   const refused: Array<[string, string, string]> = [
//     ["an empty guide", "  \n", "operating-guide-shape"],
//     [
//       `a guide naming task ${T1.taskId}`,
//       `${MATCHING_OPERATING_GUIDE}\nOn ${T1.taskId}, bind first.\n`,
//       "operating-guide-task-identifier",
//     ],
//   ];
//   for (const [name, text, code] of refused) {
//     it(`refuses ${name}`, () => {
//       const dir = workspace();
//       guide(dir, text);
//       expect(codes(refuse(dir).findings)).toContain(code);
//     });
//   }
//
//   it("names the size bound and the starter placeholder in its refusal", () => {
//     const dir = workspace();
//     guide(dir, `${MATCHING_OPERATING_GUIDE}${"Declare every part before binding. ".repeat(300)}`);
//     expect(refuse(dir).findings).toContainEqual(
//       expect.objectContaining({
//         code: "operating-guide-shape",
//         detail: expect.stringContaining("the limit is 8192"),
//       }),
//     );
//
//     // The starter guide carries an explicit marker, so the unchanged seed is refused by name.
//     guide(
//       dir,
//       readFileSync(join(import.meta.dir, "../starters/pi-built-harness/agent/BUILT_AGENTS.md"), "utf8"),
//     );
//     expect(refuse(dir).findings).toContainEqual(
//       expect.objectContaining({
//         code: "operating-guide-shape",
//         path: "agent/BUILT_AGENTS.md",
//         detail: expect.stringContaining("starter placeholder marker"),
//       }),
//     );
//   });
//
//   // The scan uses identifier boundaries: `t1x` and `slot-t1` hold a task id inside a longer word,
//   // and a substring search would refuse the whole candidate over either. Declared advisers and
//   // readers are ordinary guide content; their names are not answers.
//   const accepted: Array<[string, string]> = [
//     [
//       "prose holding a task id only inside longer words",
//       `${MATCHING_OPERATING_GUIDE}\n<!-- rule:name-the-slot -->\nName each slot t1x, not slot-t1, and check the output.\n`,
//     ],
//     [
//       "plain prose with no rule marker",
//       "# Operating Guide\n\nDeclare every part before binding a slot to it.\n",
//     ],
//     [
//       "a repeated legacy rule marker",
//       `${MATCHING_OPERATING_GUIDE}\n<!-- rule:understand-before-writing -->\nDeclare again.\n`,
//     ],
//     [
//       "a guide coordinating a declared advisor",
//       `${MATCHING_OPERATING_GUIDE}\n<!-- rule:review-before-submit -->\nRun hint before binding a slot.\n`,
//     ],
//   ];
//   for (const [name, text] of accepted) {
//     it(`accepts ${name}`, () => {
//       const dir = workspace();
//       guide(dir, text);
//       accept(dir);
//     });
//   }

// Gate audit 2026-09-25 (docs/gate-audit.md, operating-guide-retired-tool): commented out (unsure): these
// cases pin the retired-tool scan over the workspace history.
//   // A guide names tools the solver will not have when the roster moved and the guide did not. The
//   // workspace's own history is what tells a retired tool from any other word in a code span, so the
//   // case declares one, commits, and then retires it.
//   const retire = (dir: string, name: string): void => {
//     const retired = { name, kind: "advisor", description: "an adviser this bundle later removed" };
//     writeJson(dir, "agent/tools-spec.json", {
//       ...MATCHING_TOOLS_SPEC,
//       tools: [...MATCHING_TOOLS_SPEC.tools, retired],
//     });
//     commitAll(dir, "declare an adviser");
//     writeJson(dir, "agent/tools-spec.json", MATCHING_TOOLS_SPEC);
//   };
//
//   it("refuses a guide still naming a tool this bundle has since retired", () => {
//     const dir = workspace();
//     retire(dir, "signal_reference");
//     guide(dir, `${MATCHING_OPERATING_GUIDE}\nCall \`signal_reference\` before binding a slot.\n`);
//     expect(refuse(dir).findings).toContainEqual(
//       expect.objectContaining({
//         code: "operating-guide-retired-tool",
//         path: "agent/BUILT_AGENTS.md",
//         detail: expect.stringContaining("signal_reference"),
//       }),
//     );
//   });
//
//   it("refuses each retired tool a guide names on its own, so every finding names one tool", () => {
//     const dir = workspace();
//     retire(dir, "signal_reference");
//     commitAll(dir, "retire the first adviser");
//     retire(dir, "pin_advisor");
//     guide(dir, `${MATCHING_OPERATING_GUIDE}\nCall \`signal_reference\`, then \`pin_advisor(slot)\`.\n`);
//     const retired = refuse(dir).findings.filter((finding) => finding.code === "operating-guide-retired-tool");
//     expect(retired.map((finding) => finding.detail)).toEqual([
//       expect.stringContaining("names pin_advisor as a tool"),
//       expect.stringContaining("names signal_reference as a tool"),
//     ]);
//   });
//
//   const unretired: Array<[string, string]> = [
//     ["the retired name in prose only", "The old signal_reference adviser is gone; bind from the parts list."],
//     ["the retired name inside a longer code token", "Read `signal_reference_table` in the public input."],
//     ["a current tool in a code span", "Run `hint` before binding a slot."],
//     ["a field that was never a tool", "Every row carries a `slot` and a `part`."],
//   ];
//   for (const [name, line] of unretired) {
//     it(`accepts ${name}`, () => {
//       const dir = workspace();
//       retire(dir, "signal_reference");
//       guide(dir, `${MATCHING_OPERATING_GUIDE}\n${line}\n`);
//       accept(dir);
//     });
//   }
//
//   // The Builder keeps committing while a preview runs, so the workspace's HEAD can move past the
//   // captured candidate before its history is read. The verdict belongs to the captured bytes.
//   it("reads the history the candidate was captured at, not the history HEAD has reached since", () => {
//     const dir = workspace();
//     guide(dir, `${MATCHING_OPERATING_GUIDE}\nCall \`signal_reference\` before binding a slot.\n`);
//     const captured = checkCandidate(dir, ASK);
//     if (!captured.ok) throw new Error(JSON.stringify(captured.findings));
//     retire(dir, "signal_reference");
//     commitAll(dir, "retire the adviser");
//     const verdict = (commit: string) =>
//       codes(retiredToolFindings(dir, commit, captured.snapshotDir, captured.bundle.toolsSpec));
//     expect(verdict(captured.commit)).toEqual([]);
//     expect(verdict(workspaceHead(dir))).toEqual(["operating-guide-retired-tool"]);
//   });
// });

describe("what a candidate owes beyond a readable bundle", () => {
  it("refuses an accept the public schema cannot hold", () => {
    const rows = corpus();
    Object.assign(required(rows.accept[0], "first accept"), { artifact: { assignments: () => undefined } });
    expect(codes(freshCandidateFindings({ brief: structuredClone(MATCHING_BRIEF), corpus: rows }))).toContain(
      "controls-accept-public-schema-inconsistent",
    );
  });

  // Gate audit 2026-09-25 (docs/gate-audit.md, task-variation): commented out (unsure): the variation floor
  // at admission is the rule this case pins.
  // it("applies the family variation floor at admission and not to a rehearsal", () => {
  //   const dir = workspace();
  //   const tasks = structuredClone(MATCHING_TASKS);
  //   for (const task of tasks) {
  //     delete task.intendedFeatures;
  //     task.publicInput = required(
  //       tasks.find((member) => member.family === task.family),
  //       "family sibling",
  //     ).publicInput;
  //   }
  //   writeJson(dir, "correctness-model/tasks.json", tasks);
  //   expect(bundleCodes(dir, { exactTasks: 2 })).toContain("tasks-structural-variation-shortfall");
  //   expect(codes(loadValidatedBundle(dir, { ...ASK, exactTasks: 2 }, "rehearsal").findings)).not.toContain(
  //     "tasks-structural-variation-shortfall",
  //   );
  // });

  // Levels are ordinal labels, not difficulty: only a kickoff-pinned level is enforced, and that
  // has its own finding (tasks-kickoff-level-mismatch).
  it("reads task levels and parents in fresh and historical bundles alike", () => {
    const dir = workspace();
    const tasks = structuredClone(MATCHING_TASKS);
    tasks.forEach((task, index) => {
      task.level = 1;
      task.parentTaskId = `parent-${String(index)}`;
    });
    writeJson(dir, "correctness-model/tasks.json", tasks);
    for (const context of [{ exactTasks: 2, fresh: true as const }, { exactTasks: 2 }]) {
      expect(
        bundleCodes(dir, context).filter((code) => code.includes("level") || code.includes("parent")),
      ).toEqual([]);
    }
  });
});

describe("the generated correctness model", () => {
  it("names a declared check missing from the executable check map", async () => {
    const dir = workspace();
    const brief = structuredClone(MATCHING_BRIEF);
    brief.truthChecks.push({
      id: "engine-check",
      assertion: "the engine checks assignments",
      execution: {
        families: "all",
        artifactPaths: ["$.assignments"],
        publicInputPaths: ["$.bindings"],
        hidden: "none",
        evidence: { kind: "external", requiredToolIds: ["missing"] },
      },
    });
    writeJson(dir, "correctness-model/brief.json", brief);
    expect(await probeGeneratedCorrectnessModelModule(dir, undefined, lifetime())).toContainEqual(
      expect.objectContaining({
        code: "generated-module-contract",
        detail: expect.stringContaining("engine-check"),
      }),
    );
  });

  it("names the missing public reference entry at its owning boundary", async () => {
    const dir = workspace();
    unlinkSync(join(dir, "correctness-model/reference/index.ts"));
    expect(await probeGeneratedCorrectnessModelModule(dir, undefined, lifetime())).toContainEqual(
      expect.objectContaining({
        code: "reference-solve-entry-missing",
        path: "correctness-model/reference/index.ts",
      }),
    );
  });

  it("checks the real named-program export and the public package API", async () => {
    const dir = workspace();
    writeFileSync(join(dir, "correctness-model/evaluator.ts"), "export const unrelated = true;");
    expect(codes(await probeGeneratedCorrectnessModelModule(dir, undefined, lifetime()))).toContain(
      "generated-module-types",
    );

    writeFileSync(
      join(dir, "correctness-model/evaluator.ts"),
      'import { missingApi } from "@ana/correctness-model-bundle"; export const checks = { "parts-assigned": () => missingApi() };',
    );
    expect(await probeGeneratedCorrectnessModelModule(dir, undefined, lifetime())).toContainEqual(
      expect.objectContaining({
        code: "generated-module-types",
        detail: expect.stringContaining("missingApi"),
      }),
    );
  });
});

describe("acceptance", () => {
  it("records the fixture's hashes, commits the workspace and reuses the commit on unchanged bytes", () => {
    const dir = workspace();
    const before = workspaceHead(dir);
    const outcome = checkCandidate(dir, ASK);
    if (!outcome.ok) throw new Error(JSON.stringify(outcome.findings));
    expect(outcome.fingerprint.agentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(outcome.fingerprint.taskSetHash).toMatch(/^[0-9a-f]{64}$/);
    expect(outcome.baseCommit).toBe(before);
    expect(outcome.changedPaths).toContain("correctness-model/brief.json");
    expect(workspaceStatus(dir)).toEqual({ clean: true, dirtyPaths: [] });

    // The accepted value carries the snapshot's validated contracts: the gate stages read these
    // instead of parsing the same bytes again.
    expect(outcome.bundle).toEqual(
      validatedBundle(outcome.snapshotDir, loadValidatedBundle(outcome.snapshotDir, ASK)),
    );
    expect(outcome.bundle.battery.tasks.length).toBeGreaterThan(0);

    const again = checkCandidate(dir, ASK);
    if (!again.ok) throw new Error(JSON.stringify(again.findings));
    expect(again.changedPaths).toEqual([]);
    expect(again.commit).toBe(outcome.commit);
  });
});
