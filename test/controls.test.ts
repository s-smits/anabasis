/**
 * Controls are what calibrate the checks, so validation has to refuse a corpus that would let a
 * check pass without ever having been shown a case it ought to fail on. The file widens in three
 * steps.
 *
 * The shape gate comes first, because nothing downstream can reason about a control it cannot
 * read: an array that is really an object, an entry missing its `taskId`, a duplicate id, a reject
 * naming no `expectedCheckId`. Then coverage, which is one reject per check and one per family, a
 * single reject being allowed to serve both. The rule it replaced demanded one per
 * check-by-family cell, which asks a 6-check, 5-family domain for 30 rejects. The two cases that
 * matter are the ones short in only one dimension, and each is refused exactly once, named by the
 * dimension that is actually missing rather than once per cell it touches.
 *
 * The last group is about external checks, where a reject has to fail on the check it names and
 * not merely somewhere. A decoy that names a different check than the one it targets is a
 * mismatch; a boundary reject may not also claim a join decoy, because one artifact cannot be the
 * witness for two obligations at once. Ownership is keyed on the whole check-path-constant
 * triple, and the case for that is the one where two checks declare the same `$.limit` and
 * `public-limit`: naming either check is still unambiguous, so the reject is admitted, and only a
 * triple no check declares is refused — with every declared triple listed back, so the author can
 * see what to match.
 */
import { describe, expect, it } from "bun:test";
import type { Brief, ValidationResult } from "../src/correctness-bundle/brief.ts";
import {
  type AcceptControl,
  type RejectControl,
  validateAcceptControls,
  validateControls,
} from "../src/correctness-bundle/controls.ts";
import { projectPublic } from "../src/correctness-bundle/task-split.ts";
import {
  MATCHING_ACCEPTS,
  MATCHING_BRIEF,
  MATCHING_REJECTS,
  MATCHING_TASKS,
} from "./helpers/matching-fixture.ts";

const codes = (result: ValidationResult): string[] => result.findings.map((f) => f.code);
const MATCHING_CONTROL_BRIEF = structuredClone(MATCHING_BRIEF);

describe("invalid JSON structure returns a finding (falsifier-claude-001)", () => {
  it("validates the control array and its entries", () => {
    expect(codes(validateAcceptControls({ accepts: [] }))).toContain("shape-mismatch");
    expect(codes(validateAcceptControls([{ artifact: {} }]))).toContain("shape-mismatch");
    expect(codes(validateAcceptControls([]))).toContain("controls-no-accept");
    expect(
      codes(validateAcceptControls([{ id: "a1", artifact: {}, authoredBy: "accept-controls" }])),
    ).toContain("shape-mismatch");
    expect(
      validateAcceptControls([{ id: "a1", taskId: "t1", artifact: {}, authoredBy: "accept-controls" }]).ok,
    ).toBe(true);
    expect(
      codes(
        validateAcceptControls([
          { id: "a1", taskId: "t1", artifact: {}, authoredBy: "accept-controls" },
          { id: "a1", taskId: "t1", artifact: {}, authoredBy: "accept-controls" },
        ]),
      ),
    ).toContain("controls-accept-duplicate-id");
  });

  it("validates a reject's hidden field when loading an adopted corpus", () => {
    const tasks = MATCHING_TASKS.map(projectPublic);
    const base = MATCHING_REJECTS[0];
    if (base === undefined) throw new Error("fixture reject missing");
    // SAFETY: JSON.parse returns the reject fields with one deliberately invalid `hidden`
    // (a map instead of the canonical row array) to exercise the adopted-corpus shape gate.
    const mapHidden = JSON.parse(
      JSON.stringify({ ...base, id: "live-hw3-object-map", hidden: { "ghost-ref": { ids: [true] } } }),
    ) as RejectControl;
    const result = validateControls(
      MATCHING_CONTROL_BRIEF,
      { accept: MATCHING_ACCEPTS, reject: [...MATCHING_REJECTS, mapHidden] },
      tasks,
    );
    expect(result.findings.filter((f) => f.code === "shape-mismatch").map((f) => f.path)).toEqual([
      `reject[${MATCHING_REJECTS.length}].hidden`,
    ]);
    const duplicate = { ...base, id: "duplicate" };
    expect(
      codes(
        validateControls(
          MATCHING_CONTROL_BRIEF,
          { accept: MATCHING_ACCEPTS, reject: [...MATCHING_REJECTS, duplicate, duplicate] },
          tasks,
        ),
      ),
    ).toContain("controls-duplicate-id");
  });

  // The expected check is the reject's contract; mutationClass is an optional label.
  it("admits a reject without a mutationClass and refuses one without an expectedCheckId", () => {
    const tasks = MATCHING_TASKS.map(projectPublic);
    const base = MATCHING_REJECTS[0];
    if (base === undefined) throw new Error("fixture reject missing");
    const { mutationClass: _dropped, ...rest } = base;
    // SAFETY: the JSON round trip removes the field the type declares required, the shape a
    // Builder-authored controls.json actually carried.
    const unnamed = JSON.parse(JSON.stringify({ ...rest, id: "no-mutation-class" })) as RejectControl;
    const result = validateControls(
      MATCHING_CONTROL_BRIEF,
      { accept: MATCHING_ACCEPTS, reject: [...MATCHING_REJECTS, unnamed] },
      tasks,
    );
    expect(result.findings).toEqual([]);
    const { expectedCheckId: _check, ...unchecked } = base;
    // SAFETY: the same round trip drops the check a reject must name, which validation refuses.
    const noCheck = JSON.parse(JSON.stringify({ ...unchecked, id: "no-check" })) as RejectControl;
    const refused = validateControls(
      MATCHING_CONTROL_BRIEF,
      { accept: MATCHING_ACCEPTS, reject: [...MATCHING_REJECTS, noCheck] },
      tasks,
    );
    expect(refused.findings.map((f) => [f.code, f.path])).toEqual([
      ["shape-mismatch", `reject[${MATCHING_REJECTS.length}]`],
    ]);
  });
});

describe("public semantic obligations on external checks", () => {
  const brief: Brief = {
    slug: "source-boundary",
    correctnessContract: "check-program/v1",
    domain: "source behaviour",
    decisions: ["implement the public limit rule"],
    gates: ["submitted source must be present"],
    truthChecks: [
      {
        id: "source-behaviour",
        assertion: "submitted source applies every public case at the exact limit",
        numericBoundaries: [{ publicInputPath: "$.limit", constantName: "public-limit" }],
        joinIds: ["cases-to-source"],
        execution: {
          families: "all",
          artifactPaths: ["$.files"],
          publicInputPaths: ["$.limit"],
          hidden: "none",
          evidence: { kind: "external", requiredToolIds: ["source-checker"] },
        },
      },
      {
        id: "another-check",
        assertion: "submitted source parses",
        execution: {
          families: "all",
          artifactPaths: ["$.files"],
          publicInputPaths: [],
          hidden: "none",
          evidence: { kind: "external", requiredToolIds: ["source-checker"] },
        },
      },
    ],
    joins: [
      {
        id: "cases-to-source",
        description: "public cases joined to observed source behaviour by exact case id",
        decoyClasses: ["lookalike-case", "ignored-case"],
      },
    ],
    artifactSchema: [{ name: "files", "shape": "source file map", fileMap: true }],
    designRuleConstants: [
      {
        name: "public-limit",
        value: 25,
        unit: "items",
        authority: "public device specification",
        citation: "Device Specification section 4",
      },
    ],
  };
  const tasks = [
    {
      taskId: "edge-25",
      family: "edge",
      publicInput: { limit: 25 },
      hidden: [{ checkId: "source-behaviour", expectation: { kind: "controller-owned-external-verifier" } }],
    },
    {
      taskId: "ordinary-24",
      family: "ordinary",
      publicInput: { limit: 24 },
      hidden: [{ checkId: "source-behaviour", expectation: { kind: "controller-owned-external-verifier" } }],
    },
  ];
  const accepts: AcceptControl[] = [
    { id: "accept-edge", taskId: "edge-25", artifact: { files: { "src/main.c": "correct" } } },
  ];
  const reject = (
    id: string,
    taskId: string,
    decoyClass: string,
    expectedCheckId = "source-behaviour",
  ): RejectControl => ({
    id,
    taskId,
    artifact: { files: { "src/main.c": "incorrect" } },
    mutationClass: decoyClass,
    targetsJoin: "cases-to-source",
    decoyClass,
    expectedCheckId,
  });

  it("attributes every external semantic-join decoy to its owning check", () => {
    const rejects = [
      reject("wrong-owner", "edge-25", "lookalike-case", "another-check"),
      reject("ignored", "edge-25", "ignored-case"),
    ];
    expect(codes(validateControls(brief, { accept: accepts, reject: rejects }, tasks))).toContain(
      "controls-join-check-mismatch",
    );
  });

  it("refuses a boundary reject that also claims a join decoy", () => {
    const boundaryReject: RejectControl = {
      id: "threshold-edge",
      taskId: "edge-25",
      artifact: { files: { "src/main.c": "incorrect" } },
      mutationClass: "strict-vs-inclusive-boundary",
      targetsBoundary: { publicInputPath: "$.limit", constantName: "public-limit" },
      expectedCheckId: "source-behaviour",
    };
    expect(
      codes(validateControls(brief, { accept: accepts, reject: [boundaryReject] }, tasks)),
    ).not.toContain("controls-boundary-join-witness-overloaded");
    expect(
      codes(
        validateControls(
          brief,
          {
            accept: accepts,
            reject: [{ ...boundaryReject, targetsJoin: "cases-to-source", decoyClass: "lookalike-case" }],
          },
          tasks,
        ),
      ),
    ).toContain("controls-boundary-join-witness-overloaded");
  });

  it("keeps boundary ownership on the full check, path, and constant triple", () => {
    const sharedTarget: Brief = {
      ...brief,
      truthChecks: brief.truthChecks.map((check) =>
        check.id === "another-check"
          ? { ...check, numericBoundaries: [{ publicInputPath: "$.limit", constantName: "public-limit" }] }
          : check,
      ),
    };
    const rejectOnFirstCheck: RejectControl = {
      id: "threshold-edge",
      taskId: "edge-25",
      artifact: { files: { "src/main.c": "incorrect" } },
      mutationClass: "strict-vs-inclusive-boundary",
      targetsBoundary: { publicInputPath: "$.limit", constantName: "public-limit" },
      expectedCheckId: "source-behaviour",
    };
    expect(
      codes(validateControls(sharedTarget, { accept: accepts, reject: [rejectOnFirstCheck] }, tasks)),
    ).not.toContain("controls-boundary-check-mismatch");
    // A triple no check declares names itself and every declared triple, so the author can match one.
    const undeclared = validateControls(
      sharedTarget,
      {
        accept: accepts,
        reject: [
          {
            ...rejectOnFirstCheck,
            targetsBoundary: { publicInputPath: "$.limit", constantName: "other-limit" },
          },
        ],
      },
      tasks,
    ).findings.find((f) => f.code === "controls-boundary-check-mismatch");
    expect(undeclared?.detail).toContain('names the boundary ("source-behaviour", "$.limit", "other-limit")');
    expect(undeclared?.detail).toContain('("another-check", "$.limit", "public-limit")');
  });
});
