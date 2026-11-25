import { defineRule } from "@oxlint/plugins";

import type { ESTree, SourceCode } from "@oxlint/plugins";
import { asRecord, isString, type JsonValue } from "#src/meta/json-shape.ts";
import type { RuleExample } from "../../rule-examples.ts";

type TypeAssertion = ESTree.TSAsExpression | ESTree.TSTypeAssertion;

const DEFAULT_SAFETY_MARKERS = ["SAFETY"] as const;

const commentOwnerKinds = new Set([
  "ExpressionStatement",
  "PropertyDefinition",
  "ReturnStatement",
  "ThrowStatement",
  "VariableDeclaration",
]);

function isConstAssertion(node: TypeAssertion): boolean {
  return (
    node.typeAnnotation.type === "TSTypeReference" &&
    node.typeAnnotation.typeName.type === "Identifier" &&
    node.typeAnnotation.typeName.name === "const"
  );
}

// The rule parses its own options here: this is the boundary it asks others to have.
function configuredSafetyMarkers(option: JsonValue | undefined): readonly string[] {
  const configured = asRecord(option)?.markers;
  if (!Array.isArray(configured)) return DEFAULT_SAFETY_MARKERS;
  const markers = configured.flatMap((marker) =>
    isString(marker) && marker.trim().length > 0 ? [marker.trim()] : [],
  );
  return markers.length > 0 ? markers : DEFAULT_SAFETY_MARKERS;
}

function markerPattern(markers: readonly string[]): RegExp {
  const alternation = markers
    .map((marker) => marker.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`))
    .join("|");
  return new RegExp(String.raw`(?:^|[^\p{L}\p{N}_])(?:${alternation})\s*:\s*\S`, "u");
}

function hasSafetyJustificationBefore(
  sourceCode: SourceCode,
  owner: ESTree.Node,
  assertion: TypeAssertion,
  pattern: RegExp,
): boolean {
  return sourceCode
    .getCommentsBefore(owner)
    .some((comment) => comment.end <= assertion.start && pattern.test(comment.value));
}

/**
 * `(/* SAFETY *\/ x as T)` and `/* SAFETY *\/ (x as T)` say the same thing, and `biome format`
 * produces the second by moving the comment out of the parentheses, where `getCommentsBefore`
 * stops. Only whitespace and opening parentheses may separate the comment from the assertion, so no
 * neighbouring expression can borrow the sentence.
 */
function justifiedAcrossParentheses(
  sourceCode: SourceCode,
  assertion: TypeAssertion,
  pattern: RegExp,
): boolean {
  const text = sourceCode.getText();
  return sourceCode
    .getAllComments()
    .some(
      (comment) =>
        comment.end <= assertion.start &&
        pattern.test(comment.value) &&
        /^[\s(]*$/u.test(text.slice(comment.end, assertion.start)),
    );
}

function hasSafetyComment(sourceCode: SourceCode, node: TypeAssertion, pattern: RegExp): boolean {
  if (justifiedAcrossParentheses(sourceCode, node, pattern)) return true;
  let current: ESTree.Node = node;
  while (true) {
    if (hasSafetyJustificationBefore(sourceCode, current, node, pattern)) return true;
    if (commentOwnerKinds.has(current.type)) {
      const exportDeclaration = current.parent;
      return (
        exportDeclaration.type === "ExportNamedDeclaration" &&
        exportDeclaration.declaration === current &&
        hasSafetyJustificationBefore(sourceCode, exportDeclaration, node, pattern)
      );
    }
    if (current.parent.type === "Program") return false;
    current = current.parent;
  }
}

/**
 * Every type assertion but `as const` has to carry a marked sentence saying what the author
 * checked that the compiler could not: the word `SAFETY`, a colon, and the reason.
 *
 * There is no fix: the comment's content is the entire requirement. A generated one would satisfy
 * the rule and prove nothing, which is worse than the missing comment.
 */
export const requireSafetyCommentForTypeAssertionRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Require a nearby SAFETY comment for every TypeScript type assertion except const assertions.",
      examples: [
        {
          before: "const kind = row.kind as ToolKind;",
          after:
            "// SAFETY: `KINDS.has(row.kind)` admitted the kind above.\nconst kind = row.kind as ToolKind;",
        },
        {
          before:
            "function keyed<K extends string, V>(key: K, value: V) {\n  return { [key]: value } as Key<K, V>;\n}",
          after:
            "function keyed<K extends string, V>(key: K, value: V) {\n  // SAFETY: built from `key` and `value` alone, so it holds exactly one key `K`.\n  return { [key]: value } as Key<K, V>;\n}",
        },
      ] satisfies RuleExample[],
    },
    messages: {
      missingSafetyComment:
        "This type assertion has no `{{marker}}:` justification. State the checked invariant immediately before the assertion or its containing statement.",
    },
    schema: [
      {
        type: "object",
        properties: {
          markers: {
            type: "array",
            items: { type: "string", minLength: 1 },
            minItems: 1,
            uniqueItems: true,
          },
        },
        additionalProperties: false,
      },
    ],
    defaultOptions: [{ markers: ["SAFETY"] }],
  },
  createOnce(context) {
    const patterns = new Map<string, RegExp>();

    const checkAssertion = (node: TypeAssertion) => {
      if (isConstAssertion(node)) return;
      const markers = configuredSafetyMarkers(context.options?.[0]);
      const patternKey = markers.join("\u0000");
      const pattern = patterns.get(patternKey) ?? markerPattern(markers);
      patterns.set(patternKey, pattern);
      if (hasSafetyComment(context.sourceCode, node, pattern)) return;
      context.report({
        node,
        messageId: "missingSafetyComment",
        data: { marker: markers[0] ?? DEFAULT_SAFETY_MARKERS[0] },
      });
    };

    return {
      TSAsExpression: checkAssertion,
      TSTypeAssertion: checkAssertion,
    };
  },
});
