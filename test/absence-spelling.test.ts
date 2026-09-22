/**
 * Tests for the writer-side absence check (src/truth/solvability-submission.ts,
 * absenceSpellingAdmitted): where the reference answer writes null, a writer schema that also
 * accepts the empty string gives one meaning two spellings.
 *
 * Run w6 is the case. Its writer declared `Type.Union([Type.String(), Type.Null()])` for a finding's
 * table id, the reference answer wrote null on the rows no table owns, and the agent wrote "" on
 * exactly those rows — eight of twenty-five cases failed on that alone, five batteries running,
 * with every count and every other field already correct. Nothing refused the schema first: F2
 * accepted the reference artifact, and the representation census reads the reference answer,
 * which used null correctly. This probe is the enforcement for the Builder prompt rule that a
 * nullable writer field gives its string branch a minimum length.
 */
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type, type TSchema } from "typebox";
import { describe, expect, it } from "bun:test";
import { double } from "./helpers/doubles.ts";
import { absenceSpellingAdmitted } from "../src/truth/solvability-submission.ts";

const artifact = {
  findings: [
    { code: "seat-conflict", tableId: "t3" },
    { code: "budget-overrun", tableId: null },
  ],
};

function writer(parameters: TSchema): AgentTool<never> {
  return double<AgentTool<never>>({ name: "write_report", description: "", parameters });
}

const loose = writer(
  Type.Object({
    findings: Type.Array(
      Type.Object({
        code: Type.String(),
        tableId: Type.Union([Type.String(), Type.Null()]),
      }),
    ),
  }),
);

describe("absenceSpellingAdmitted", () => {
  it("names the path where a writer allows two forms of absence, as in run w6", () => {
    expect(absenceSpellingAdmitted(loose, artifact)?.path).toBe("findings[].tableId");
  });

  it("a narrowed string branch is clean — null stays the only way to state absence", () => {
    const tight = writer(
      Type.Object({
        findings: Type.Array(
          Type.Object({
            code: Type.String(),
            tableId: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
          }),
        ),
      }),
    );
    expect(absenceSpellingAdmitted(tight, artifact)).toBeNull();
  });

  it("an artifact with no null writes nothing to confuse — the check is silent", () => {
    expect(
      absenceSpellingAdmitted(loose, { findings: [{ code: "seat-conflict", tableId: "t3" }] }),
    ).toBeNull();
  });

  it("a path the writer types as null-only is unambiguous, whatever the vocabulary says", () => {
    const nullOnly = writer(Type.Object({ note: Type.Null() }));
    expect(absenceSpellingAdmitted(nullOnly, { note: null })).toBeNull();
  });

  it("a top-level nullable root is probed like any other position", () => {
    const root = writer(Type.Object({ note: Type.Union([Type.String(), Type.Null()]) }));
    expect(absenceSpellingAdmitted(root, { note: null })?.path).toBe("note");
  });

  it("a tuple types its positions separately, so a clean first element cannot clear a loose second", () => {
    const tuple = writer(
      Type.Object({ rows: Type.Tuple([Type.Null(), Type.Union([Type.String(), Type.Null()])]) }),
    );
    expect(absenceSpellingAdmitted(tuple, { rows: [null, null] })?.path).toBe("rows[]");
  });

  // run w12: the probe pairs every artifact-writer with the WHOLE artifact, and a non-strict Check
  // ignores undeclared properties — so a subset writer "admitted" every null root it never typed,
  // and eight iterations repaired blind until every writer schema rejected the whole artifact.
  it("does not charge a subset writer with a null root its schema never declares", () => {
    const subset = writer(Type.Object({ summary: Type.String() }));
    expect(absenceSpellingAdmitted(subset, { summary: "ok", tableId: null })).toBeNull();
  });

  it("walks past a clean null to the ambiguous one deeper in the artifact", () => {
    const mixed = writer(
      Type.Object({
        head: Type.Null(),
        body: Type.Object({ tail: Type.Union([Type.String(), Type.Null()]) }),
      }),
    );
    expect(absenceSpellingAdmitted(mixed, { head: null, body: { tail: null } })?.path).toBe("body.tail");
  });
});
