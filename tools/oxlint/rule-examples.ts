/**
 * The before-and-after pairs a lint run shows once for each rule that fired, so the agent writing
 * the repair sees the shape beside the sentence. Each rule keeps its pairs in its own
 * `meta.docs.examples`, and each tree scan in `TREE_FINDING_EXAMPLES`, so a pair changes with its
 * rule; `test/rule-examples.test.ts` checks that its rule reports each `before` and no rule of
 * either plugin reports an `after`.
 */
import type { RuleDocs } from "@oxlint/plugins";
import { isRecord, isString } from "../../src/meta/json-shape.ts";
import { PLUGINS } from "./plugins.ts";

/** `path` places both where the rule reads them, for a rule that speaks to one part of the tree. */
export interface RuleExample {
  readonly before: string;
  readonly after: string;
  readonly path?: string;
}

function examplesIn(docs: RuleDocs | undefined): RuleExample[] {
  const examples = docs?.examples;
  if (!Array.isArray(examples)) return [];
  return examples.flatMap((example) => {
    if (!isRecord(example) || !isString(example.before) || !isString(example.after)) return [];
    const { before, after, path } = example;
    return [isString(path) ? { before, after, path } : { before, after }];
  });
}

export function ruleExamples(): Map<string, RuleExample[]> {
  return new Map(
    [...PLUGINS].flatMap(([name, plugin]) =>
      Object.entries(plugin.rules).map(([rule, { meta }]) => [`${name}/${rule}`, examplesIn(meta?.docs)]),
    ),
  );
}

const indented = (text: string): string[] => text.split("\n").map((line) => `      ${line}`);

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
