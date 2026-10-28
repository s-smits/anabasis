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
import { describe, it } from "bun:test";
import { lintRules } from "./helpers/lint-rule.ts";

const COMMENTS = `
// oxlint-disable-next-line anti-slop/no-runtime-typeof // REPORT the next-line spelling
export const kind = (value: string | number) => typeof value;
export const size = 1; // oxlint-disable-line ana/no-deep-nesting -- a reason still belongs in a row // REPORT the same-line spelling
/* oxlint-disable anti-slop/no-chained-type-assertions */ // REPORT a block disable
/* oxlint-enable anti-slop/no-chained-type-assertions */ // ADMITTED an enable answers nothing
// eslint-disable-next-line no-console, ana/no-tangled-ternary // REPORT one slop rule in a list is enough
// oxlint-disable-next-line no-console -- a core rule keeps its comment // ADMITTED
/** The inline oxlint-disable comment was the weaker store. */ // ADMITTED prose, not a directive
/* oxlint-disable-next-line */ // REPORT no rule named silences every rule
export const silenced = 1;
/* eslint-disable-next-line -- a reason without a rule */ // REPORT and so does one with only a reason
export const alsoSilenced = 2;
export const said = "// oxlint-disable-next-line ana/no-deep-nesting"; // ADMITTED a string, not a comment
`.trimStart();

describe("ana/no-inline-slop-answer", () => {
  it("reports only the marked lines in every fixture and scope", async () => {
    await lintRules("ana", [["no-inline-slop-answer", COMMENTS, 6, "src/example.ts"]]);
  });
});
