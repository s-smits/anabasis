import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

import {
  createTypeAliasEnvironment,
  resolvedTypeMatches,
  type TypeAliasEnvironment,
} from "../shared/type-alias-resolution.ts";

/**
 * A `type` declaration that resolves to `unknown`, directly or through other aliases.
 *
 * The other `unknown` rules — `no-unknown-returns`, `unproven-unknown-parameter`,
 * `no-unsafe-dictionary-type` — all read a written annotation, and an alias is the one move that
 * takes the word out of the annotation without taking the top type out of the program. `type
 * Payload = unknown` reads at every use as though someone had decided something. This rule is
 * what stops the rest of the set being answered by a rename.
 *
 * The resolution follows aliases through aliases, through parentheses, and into any member of a
 * union, so `type A = B`, `type B = unknown | Other` is reported at `A` as well as at `B`. It
 * stops where the name is not the alias it looks like: `visibleTypeAlias` walks out to the
 * nearest scope that declares the name, refuses to resolve one a type parameter is binding, and
 * refuses again when two declarations of the name tie at the same distance, because there is then
 * no single thing the name stands for.
 *
 * `unknown` itself is not banned, only the alias hiding it. The message says where it stays legal:
 * at a parsing boundary, where the value genuinely has not been read yet, and on a `cause` field.
 * Both of those are written `unknown` at the site, which is the point — the reader sees the top
 * type where it is.
 *
 * There is no fix: the repair is the type the alias was avoiding, and an alias exists because
 * someone did not want to write it.
 */
export const noUnknownTypeAliasesRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow type aliases whose resolved type is unknown; unknown must remain visible at an allowed boundary.",
    },
    messages: {
      unknownAlias:
        "Type alias `{{alias}}` hides `unknown`. Keep `unknown` explicit at the parsing boundary or on an allowed `cause` field; otherwise use the parsed owner type.",
    },
  },
  createOnce(context) {
    let environment: TypeAliasEnvironment | null = null;

    const resolvesToUnknown = (type: ESTree.TSType): boolean =>
      environment !== null &&
      resolvedTypeMatches(type, environment, (resolved, matches) => {
        if (resolved.type === "TSUnknownKeyword") return true;
        if (resolved.type === "TSParenthesizedType") {
          return matches(resolved.typeAnnotation);
        }
        return resolved.type === "TSUnionType" && resolved.types.some(matches);
      });

    return {
      Program(node) {
        environment = createTypeAliasEnvironment(node, context.sourceCode.visitorKeys);
      },
      TSTypeAliasDeclaration(node) {
        if (!resolvesToUnknown(node.typeAnnotation)) return;
        context.report({
          node: node.id,
          messageId: "unknownAlias",
          data: { alias: node.id.name },
        });
      },
    };
  },
});
