import { defineRule, type ESTree } from "@oxlint/plugins";

import { subpathAlias } from "../shared/subpath-alias.ts";
import type { RuleExample } from "../../rule-examples.ts";

/**
 * An import that climbs three or more directories is spelled through its package's subpath alias:
 * `#src/meta/path.ts`, not `../../../../src/meta/path.ts`.
 */
export const preferSubpathImportRule = defineRule({
  meta: {
    type: "suggestion",
    fixable: "code",
    docs: {
      description: "Spell an import that climbs three or more directories through its subpath alias.",
      examples: [
        {
          before: 'import { join } from "../../../../src/meta/path.ts";',
          after: 'import { join } from "#src/meta/path.ts";',
          path: ".claude/skills/zip-run/scripts/pack.ts",
        },
        {
          before: 'const { receipts } = await import("../../../../tools/runs/receipt.ts");',
          after: 'const { receipts } = await import("#tools/runs/receipt.ts");',
          path: ".claude/skills/zip-run/scripts/pack.ts",
        },
      ] satisfies RuleExample[],
    },
    messages: {
      climbing:
        'Import "{{alias}}" rather than "{{specifier}}": package.json maps it to the same file, and the alias reads the same from every depth.',
    },
    schema: [
      {
        type: "object",
        properties: { relativeOnly: { type: "array", items: { type: "string" } } },
        additionalProperties: false,
      },
    ],
    defaultOptions: [{ relativeOnly: [] }],
  },
  createOnce(context) {
    /** Report a string-literal specifier that climbs into a tree an alias names. */
    function check(source: ESTree.Node): void {
      const option = context.options?.[0];
      const listed = option instanceof Object && !Array.isArray(option) ? option.relativeOnly : undefined;
      // The source text rather than the value, because the fix keeps the quote the line used.
      const spelled = context.sourceCode.getText(source);
      const specifier = spelled.slice(1, -1);
      const alias = subpathAlias(
        context.filename,
        specifier,
        Array.isArray(listed) ? listed.map(String) : [],
      );
      if (alias === null) return;
      context.report({
        node: source,
        messageId: "climbing",
        data: { alias, specifier },
        fix: (fixer) => fixer.replaceText(source, spelled.charAt(0) + alias + spelled.charAt(0)),
      });
    }

    return {
      ImportDeclaration: ({ source }) => check(source),
      ExportAllDeclaration: ({ source }) => check(source),
      ExportNamedDeclaration({ source }) {
        if (source !== null) check(source);
      },
      TSImportType: ({ source }) => check(source),
      ImportExpression({ source }) {
        if (source.type === "Literal") check(source);
      },
    };
  },
});
