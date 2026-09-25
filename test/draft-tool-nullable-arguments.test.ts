/**
 * A nullable number through Pi's pinned argument validator. `Type.Union([Type.Number(),
 * Type.Null()])` is the shape a draft tool declares for a value that may be absent, and null, zero
 * and a real number have to survive it exactly: a null coerced to 0, or a 0 read as absent, is a
 * different artifact. The rewrite that makes the union validate must also leave a genuinely
 * ambiguous union alone and must not touch schema-shaped annotation data it happens to walk past.
 */
import { describe, expect, it } from "bun:test";
import { Type, validateToolArguments } from "@earendil-works/pi-ai";
import { defineDraftTool } from "../src/solve/draft-tool.ts";
import { double } from "./helpers/doubles.ts";

describe("draft-tool nullable numeric arguments", () => {
  const tool = defineDraftTool({
    name: "write_nullable",
    label: "Write nullable",
    description: "Write exact nullable numbers.",
    parameters: Type.Object({
      numberFirst: Type.Union([Type.Number(), Type.Null()]),
      nullFirst: Type.Union([Type.Null(), Type.Number()]),
      constrainedNumber: Type.Union([Type.Number({ minimum: 0, maximum: 10 }), Type.Null()]),
      constrainedInteger: Type.Union([Type.Null(), Type.Integer({ minimum: 0, maximum: 10 })]),
      optional: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
    }),
    run: (params, draft) => {
      draft.setArtifact(params);
      return { text: "written" };
    },
  });

  const VALID = { numberFirst: 7, nullFirst: 0, constrainedNumber: 7.5, constrainedInteger: 7 };
  const validate = (args: Record<string, number | null | undefined>) =>
    validateToolArguments(tool, double({ name: tool.name, arguments: args }));

  it("keeps null, zero and a number exact through Pi's pinned validator in either union order", () => {
    const raw = {
      numberFirst: null,
      nullFirst: 0,
      constrainedNumber: null,
      constrainedInteger: 0,
    };
    const validated = validate(raw);
    expect(validated).toEqual(raw);
    expect(validated).not.toBe(raw);
    expect(validate(VALID)).toEqual(VALID);
  });

  // Missing and undefined stay distinct inputs, and both are refused for a required value; the
  // numeric constraints survive the union rewrite without coercing null or zero.
  it.each<[string, Record<string, number | null | undefined>, RegExp]>([
    [
      "a missing required value",
      { nullFirst: 7, constrainedNumber: 7.5, constrainedInteger: 7 },
      /numberFirst.*required/,
    ],
    ["an undefined required value", { ...VALID, numberFirst: undefined }, /numberFirst/],
    ["a number above its declared maximum", { ...VALID, constrainedNumber: 11 }, /constrainedNumber.*<= 10/],
    [
      "a fraction where an integer is declared",
      { ...VALID, constrainedInteger: 1.5 },
      /constrainedInteger.*integer/,
    ],
  ])("refuses %s", (_, args, refusal) => {
    expect(() => validate(args)).toThrow(refusal);
  });

  it("leaves an ambiguous three-way union unchanged", () => {
    const ambiguous = defineDraftTool({
      name: "ambiguous",
      label: "Ambiguous",
      description: "Keep a composed union.",
      parameters: Type.Object({
        value: Type.Union([Type.Number({ minimum: 0 }), Type.Null(), Type.Literal("auto")]),
      }),
      run: () => ({ text: "unused" }),
    });
    // SAFETY: the schema literal above declares value as a three-member union, so the rewriter
    // leaves it as an anyOf node.
    expect((ambiguous.parameters.properties.value as { anyOf?: unknown[] }).anyOf).toHaveLength(3);
  });

  it("rewrites nested schema positions without changing schema-shaped annotation data", () => {
    const annotated = defineDraftTool({
      name: "annotated",
      label: "Annotated",
      description: "Keep annotation data exact.",
      parameters: Type.Object({
        example: Type.Number({
          default: { anyOf: [{ type: "number" }, { type: "null" }] },
          examples: [{ anyOf: [{ type: "number" }, { type: "null" }] }],
        }),
        nested: Type.Array(Type.Object({ value: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]) })),
      }),
      run: () => ({ text: "unused" }),
    });
    // SAFETY: the schema literal above sets both annotation keys on example, and the rewriter
    // under test must leave annotation data untouched, so both reads are present.
    expect((annotated.parameters.properties.example as { examples?: unknown }).examples).toEqual([
      { anyOf: [{ type: "number" }, { type: "null" }] },
    ]);
    // SAFETY: the same schema literal sets default on example, and annotation data stays exact.
    expect((annotated.parameters.properties.example as { default?: unknown }).default).toEqual({
      anyOf: [{ type: "number" }, { type: "null" }],
    });
    expect(annotated.parameters.properties.nested.items.properties.value).toMatchObject({
      type: ["number", "null"],
      minimum: 0,
    });
  });
});
