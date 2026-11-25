import { defineRule, type ESTree } from "@oxlint/plugins";
import type { RuleExample } from "../../rule-examples.ts";
import { identifierName } from "../shared/statements.ts";

/**
 * Rung 3 of the simplify ladder: a module-local type alias used only once as a single function's
 * return annotation (and within `INLINE_WIDTH` characters, excluding unions and object shapes)
 * should be inlined directly into that function's return annotation. There is no fix.
 */
/** Annotation width above which the alias is carrying the signature, not restating it. */
const INLINE_WIDTH = 60;

export const noAliasRestatingReturnRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description: "A type alias used only as one function's return type belongs in that annotation.",
      examples: [
        {
          before:
            "type Usage = Map<string, number>;\nfunction usageOf(rows: Row[]): Usage {\n  return new Map(rows.map((row) => [row.model, row.billed]));\n}",
          after:
            "function usageOf(rows: Row[]): Map<string, number> {\n  return new Map(rows.map((row) => [row.model, row.billed]));\n}",
        },
        {
          before:
            'type TurnSummary = Omit<Turn, "trace">;\nfunction summaryOf({ trace, ...rest }: Turn): TurnSummary {\n  return rest;\n}',
          after: 'function summaryOf({ trace, ...rest }: Turn): Omit<Turn, "trace"> {\n  return rest;\n}',
        },
      ] satisfies RuleExample[],
    },
    messages: {
      restated:
        "`{{alias}}` is named once, as `{{owner}}`'s return type. Write its body as `{{owner}}`'s return annotation and delete the alias, so the shape is stated where it is decided; two spellings of one shape can disagree, and the compiler will blame the wrong one.",
    },
  },
  createOnce(context) {
    const aliases = new Map<string, ESTree.TSTypeAliasDeclaration>();
    const mentions = new Map<string, number>();
    const returnedBy = new Map<string, string>();

    function owningReturn(node: ESTree.TSTypeReference): string | null {
      const annotation = node.parent;
      if (annotation.type !== "TSTypeAnnotation") return null;
      const owner = annotation.parent;
      if (owner.type === "FunctionDeclaration" && owner.returnType === annotation && owner.id !== null) {
        return owner.id.name;
      }
      // `const parse = (row: Row): Parsed => …` names the function at the declarator.
      if (owner.type !== "ArrowFunctionExpression" && owner.type !== "FunctionExpression") return null;
      if (owner.returnType !== annotation) return null;
      const declarator = owner.parent;
      if (declarator.type !== "VariableDeclarator") return null;
      return identifierName(declarator.id);
    }

    return {
      before: () => {
        aliases.clear();
        mentions.clear();
        returnedBy.clear();
        return true;
      },

      TSTypeAliasDeclaration(node) {
        // An exported alias has readers this file cannot see; the whole-tree scan owns that half.
        if (node.parent.type === "ExportNamedDeclaration") return;
        aliases.set(node.id.name, node);
      },

      TSTypeReference(node) {
        if (node.typeName.type !== "Identifier") return;
        const { name } = node.typeName;
        mentions.set(name, (mentions.get(name) ?? 0) + 1);
        const owner = owningReturn(node);
        if (owner !== null) returnedBy.set(name, owner);
      },

      "Program:exit": () => {
        for (const [alias, node] of aliases) {
          const owner = returnedBy.get(alias);
          if (owner === undefined || (mentions.get(alias) ?? 0) !== 1) continue;
          const body = node.typeAnnotation;
          if (body.type === "TSUnionType" || body.type === "TSTypeLiteral") continue;
          if (context.sourceCode.getText(body).length > INLINE_WIDTH) continue;
          context.report({ node, messageId: "restated", data: { alias, owner } });
        }
      },
    };
  },
});
