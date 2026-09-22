import { defineRule, type ESTree } from "@oxlint/plugins";

import { subpathAlias } from "../shared/subpath-alias.ts";

/**
 * An import that climbs three or more directories is spelled through its package's subpath alias:
 * `#src/meta/path.ts`, not `../../../../src/meta/path.ts`.
 *
 * The relative form encodes where the importing file sits, so it is right only at one depth. A
 * reader counts the dots to learn which tree it reaches, a moved file breaks every such line, and
 * a codebase grown by pasting imports between files of different depths collects hundreds of them:
 * 570 stood under this repository's `.claude` on 2026-09-21, most at four levels. `package.json`'s
 * `imports` field is the form Node, Bun, TypeScript's NodeNext and bundler resolution and the oxc
 * resolver all read without further configuration; `paths` in `tsconfig.json` would satisfy the
 * type checker and leave the runtime unable to load the file.
 *
 * The aliases come from the nearest `package.json` above the linted file, which is where every one
 * of those resolvers looks, so a package with a manifest of its own is judged by its own `imports`
 * and never handed its parent's. One and two levels stay relative: a sibling or a parent's
 * neighbour is local, and spelling it from the root would hide that. `relativeOnly` names trees,
 * relative to the package root, whose files are also loaded some other way — copied under a
 * manifest without `imports`, or resolved as plain paths — where an alias would not resolve.
 *
 * The fix is the alias itself, in the quote the line already used. The target is the same file by
 * construction: the alias is read off the manifest that resolves it, and a key the manifest does
 * not map is never written.
 */
export const preferSubpathImportRule = defineRule({
  meta: {
    type: "suggestion",
    fixable: "code",
    docs: { description: "Spell an import that climbs three or more directories through its subpath alias." },
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
