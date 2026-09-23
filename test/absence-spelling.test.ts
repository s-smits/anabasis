/**
 * Where the reference answer writes null, a writer schema that also accepts the empty string gives
 * one meaning two spellings, and nothing stops the agent picking the spelling the check will not
 * admit. That is the defect `absenceSpellingAdmitted` refuses on the writer side, in
 * src/truth/solvability-submission.ts, and this file is where the refusal is pinned.
 *
 * The shape it catches is a writer declaring `Type.Union([Type.String(), Type.Null()])` for a field
 * the reference answer leaves null: the agent writes "" on exactly those rows and the cases fail on
 * that alone, with every count and every other field already correct. Nothing else refuses the
 * schema first, because F2 accepts the reference artifact and the representation census reads that
 * same reference answer, which used null correctly. So this probe is the enforcement for the
 * Builder prompt rule that a nullable writer field gives its string branch a minimum length.
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

  // The probe pairs every artifact-writer with the WHOLE artifact, and a non-strict Check ignores
  // undeclared properties, so without this a subset writer is charged with every null root it
  // never typed and the only repair that clears the refusal is a writer schema that rejects the
  // whole artifact.
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
