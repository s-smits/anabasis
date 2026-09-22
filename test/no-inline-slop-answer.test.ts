/**
 * The rule that keeps `tools/oxlint/not-slop.tsv` the only store for an answer to an `ana/` or
 * `anti-slop/` finding.
 *
 * A disable comment naming one of those rules is reported in every spelling oxlint reads: next
 * line, same line, a block, and the `eslint-` prefix it also honours, with or without a reason
 * after `--`. A core rule keeps its comment, `oxlint-enable` answers nothing, and prose that
 * mentions a directive is not one. There is no fixer: the answer needs an id only a lint run
 * computes and a sentence only the author can check.
 */
import { describe, expect, it } from "bun:test";
import { expectedLines, reportedLines, reportedMessages } from "./helpers/oxlint-rule-fixture.ts";

const COMMENTS = `
// oxlint-disable-next-line anti-slop/no-runtime-typeof // REPORT the next-line spelling
export const kind = (value: string | number) => typeof value;
export const size = 1; // oxlint-disable-line ana/no-deep-nesting -- a reason still belongs in a row // REPORT the same-line spelling
/* oxlint-disable anti-slop/no-reflect-get */ // REPORT a block disable
/* oxlint-enable anti-slop/no-reflect-get */ // ADMITTED an enable answers nothing
// eslint-disable-next-line no-console, ana/no-tangled-ternary // REPORT one slop rule in a list is enough
// oxlint-disable-next-line no-console -- a core rule keeps its comment // ADMITTED
/** The inline oxlint-disable comment was the weaker store. */ // ADMITTED prose, not a directive
export const said = "// oxlint-disable-next-line ana/no-deep-nesting"; // ADMITTED a string, not a comment
`.trimStart();

describe("ana/no-inline-slop-answer", () => {
  it("reports a disable naming an ana or anti-slop rule, and leaves core rules and prose alone", () => {
    const expected = expectedLines(COMMENTS);
    expect(expected).toHaveLength(4);
    expect(reportedLines("ana", "no-inline-slop-answer", COMMENTS, "src/example.ts")).toStrictEqual(expected);
  });

  it("names every slop rule the comment silences", () => {
    const [message] = reportedMessages(
      "ana",
      "no-inline-slop-answer",
      "// oxlint-disable-next-line ana/no-deep-nesting, anti-slop/no-runtime-typeof -- why\nexport const one = 1;\n",
      "src/example.ts",
    );
    expect(message).toContain(
      "ana/no-deep-nesting, anti-slop/no-runtime-typeof answered by a disable comment",
    );
  });
});
