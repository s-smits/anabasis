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

const nullable = () => Type.Union([Type.String(), Type.Null()]);
const findings = (tableId: TSchema) =>
  Type.Object({ findings: Type.Array(Type.Object({ code: Type.String(), tableId })) });

// The probe pairs every artifact-writer with the WHOLE artifact, and a non-strict Check ignores
// undeclared properties, so the subset row keeps a writer from being charged with every null root it
// never typed — a refusal whose only repair would be a writer schema rejecting the whole artifact.
describe("absenceSpellingAdmitted", () => {
  it.each([
    ["a writer allowing two forms of absence", findings(nullable()), artifact, "findings[].tableId"],
    [
      "a narrowed string branch",
      findings(Type.Union([Type.String({ minLength: 1 }), Type.Null()])),
      artifact,
      null,
    ],
    [
      "an artifact with no null",
      findings(nullable()),
      { findings: [{ code: "seat-conflict", tableId: "t3" }] },
      null,
    ],
    ["a null-only path", Type.Object({ note: Type.Null() }), { note: null }, null],
    ["a top-level nullable root", Type.Object({ note: nullable() }), { note: null }, "note"],
    [
      "a loose second tuple position behind a clean first",
      Type.Object({ rows: Type.Tuple([Type.Null(), nullable()]) }),
      { rows: [null, null] },
      "rows[]",
    ],
    [
      "a subset writer beside a null root it never declares",
      Type.Object({ summary: Type.String() }),
      { summary: "ok", tableId: null },
      null,
    ],
    [
      "an ambiguous null deeper than a clean one",
      Type.Object({ head: Type.Null(), body: Type.Object({ tail: nullable() }) }),
      { head: null, body: { tail: null } },
      "body.tail",
    ],
  ] as const)("%s names %p", (_name, parameters, written, path) => {
    expect(absenceSpellingAdmitted(writer(parameters), written)?.path ?? null).toBe(path);
  });
});
