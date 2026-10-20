/**
 * The before-and-after pairs a lint run shows once for each rule that fired, after its findings.
 *
 * A finding names a shape in a sentence, and the sentence is read by an agent that has to write
 * the repair in the next commit. On 20 October the operator asked for the shape itself beside
 * the sentence: one or two short pairs a rule owns, the code it reports and the code that passes
 * it. Each rule keeps its pairs in its own `meta.docs.examples`, and each tree scan in
 * `TREE_FINDING_EXAMPLES` beside its argument, so a pair changes in the change that changes the
 * rule. `test/rule-examples.test.ts` lints every pair: a `before` its own rule reports, and an
 * `after` that no rule of either plugin reports, so an example cannot teach a shape another rule
 * then refuses.
 */
import type { Plugin, RuleDocs } from "@oxlint/plugins";
import { isRecord, isString } from "../../src/meta/json-shape.ts";
import anaPlugin from "./ana/index.ts";
import antiSlopPlugin from "./anti-slop/index.ts";

/**
 * One pair: `before` is the shape the rule reports and `after` the repair, each a few lines.
 * `path` places both where the rule reads them, for a rule that speaks to one part of the tree.
 */
export interface RuleExample {
  readonly before: string;
  readonly after: string;
  readonly path?: string;
}

/** The pairs a rule keeps in `meta.docs.examples`, which oxlint types as an open record. */
function examplesIn(docs: RuleDocs | undefined): RuleExample[] {
  const examples = docs?.examples;
  if (!Array.isArray(examples)) return [];
  return examples.flatMap((example) => {
    if (!isRecord(example) || !isString(example.before) || !isString(example.after)) return [];
    const { before, after, path } = example;
    return [isString(path) ? { before, after, path } : { before, after }];
  });
}

/** Every rule of the two plugins, keyed as a finding names it (`ana/no-deep-nesting`), with its pairs. */
export function ruleExamples(): Map<string, RuleExample[]> {
  const plugins: readonly [string, Plugin][] = [
    ["ana", anaPlugin],
    ["anti-slop", antiSlopPlugin],
  ];
  return new Map(
    plugins.flatMap(([name, plugin]) =>
      Object.entries(plugin.rules).map(([rule, { meta }]) => [`${name}/${rule}`, examplesIn(meta?.docs)]),
    ),
  );
}

/** Each line of `text`, indented under its label. */
const indented = (text: string): string[] => text.split("\n").map((line) => `      ${line}`);

/** The block a run prints once for one rule: its name, then each pair. */
export function renderedExamples(rule: string, examples: readonly RuleExample[]): string[] {
  return [
    `  ${rule}, for example:`,
    ...examples.flatMap(({ before, after }) => [
      "    reported:",
      ...indented(before),
      "    passes:",
      ...indented(after),
    ]),
  ];
}
