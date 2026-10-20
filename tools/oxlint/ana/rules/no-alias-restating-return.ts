import { defineRule, type ESTree } from "@oxlint/plugins";
import type { RuleExample } from "../../rule-examples.ts";

/**
 * Rung 3 of the simplify skill's ladder, at the type level: the function already owns this
 * shape, so writing it out again as an alias gives one fact two authors.
 *
 *     interface FindingArgs { code: string; detail: string; owner: FeedbackOwner | null }
 *     function findingArgs(row: Row): FindingArgs { … }
 *
 * The alias is spelled once, as that one function's return annotation, and nothing else in the
 * file names it. Its body written as the annotation says the same thing in the one place it is
 * decided: today, adding a field to what the function returns and forgetting the alias is a
 * compile error at the function, which reads as the alias being right and the function being
 * wrong.
 *
 * A simplify pass made exactly this cut twice inside one review (`8c162e5f`): `FindingArgs`
 * became `ReturnType<typeof findingArgs>` and `ProbeArgs` was deleted outright. The same pass
 * recorded the trap that goes with it — dropping the `satisfies` beside the annotation widened
 * a narrowed `severity` back to `string` — which is why this reports and does not fix.
 *
 * Only a module-local alias is read. An exported one has readers this rule cannot see, and
 * `unusedExports` in `tools/loc/source-policy.ts` is the scan that can. An alias named twice
 * keeps its name: at two mentions the alias is doing the job a name is for.
 *
 * An alias whose annotation is not a function's return type is invisible here, so a parameter
 * type, a variable annotation or a generic argument never reaches the report.
 *
 * So the alias has to be one the signature can absorb, and three kinds are not. A union is a set
 * of answers, and naming a set of answers is the job a name is for: `LockFile` spells out
 * absent, unreadable and read, and hiding all three behind the function that produces them
 * reads worse at every call site. An object shape written out is a declaration with its fields,
 * often a doc comment on each — `SlotChoice` explains at its `model` field why a defaulted model
 * is still recorded — and it is also the one case `anti-slop/no-known-value-widening` refuses: an
 * anonymous object type on a return value discards the evidence a named contract carries, and
 * that rule gates. A body too wide for the signature is the same failure at one line; inlining
 * `Pick<CaseRecord, "acceptedSubmit" | "truthOk" | "pass" | …>` produced a 160-character
 * signature, which is not the smaller form.
 *
 * What is left is a short alias over a contract that is already named —
 * `Omit<OutcomeMetrics["tools"], "byName">`, `GeneratedToolWorkerEvidence["termination"]`,
 * `Map<string, Set<string>>` — where the name states nothing the annotation would not.
 * Measured 2026-09-20: 30 sites, 19 with unions excluded, 9 with wide bodies excluded, 5 once
 * object shapes were excluded too.
 *
 * Until 20 October the message asked for `ReturnType<typeof findingArgs>`, which cannot be
 * written as `findingArgs`'s own annotation, since that is circular; the only edit left was to
 * delete the alias and the annotation and let the return infer, and an inferred return is not
 * the annotated one: that is the `satisfies` trap the same pass recorded, where dropping the
 * annotation widened a narrowed `severity` back to `string`. The message now asks for the
 * alias's body as the annotation, which keeps the annotation and is the same type. The rule
 * reports only a body of 60 characters or fewer, so the signature stays one line.
 *
 * There is no fix yet. The edit is mechanical where the alias takes no type parameter and
 * carries no comment, and no site in the tree has asked for it.
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
    /** Module-local alias declarations in this file, by name. */
    const aliases = new Map<string, ESTree.TSTypeAliasDeclaration>();
    /** How many times each name is written as a type reference, anywhere in the file. */
    const mentions = new Map<string, number>();
    /** The function each name annotates as a return type, when it does so exactly once. */
    const returnedBy = new Map<string, string>();

    /** The function whose return annotation this reference is, by name, or null. */
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
      return declarator.id.type === "Identifier" ? declarator.id.name : null;
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
