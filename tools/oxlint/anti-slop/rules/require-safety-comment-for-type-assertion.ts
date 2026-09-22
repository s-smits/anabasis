import { defineRule } from "@oxlint/plugins";

import type { ESTree, SourceCode } from "@oxlint/plugins";
import { asRecord, isString, type JsonValue } from "#src/meta/json-shape.ts";

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
  const configured = asRecord(option)?.["markers"];
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
 * `(/* SAFETY *\/ x as T)` and `/* SAFETY *\/ (x as T)` put the justification in the same place and
 * say the same thing; only the parenthesis falls on the other side of it. `getCommentsBefore` stops
 * at that parenthesis, so the second spelling read as an unjustified assertion — which is what
 * `biome format` produced at five sites here the first time it ran, by moving the comment out of the
 * parentheses nobody had asked it to keep. Nothing but whitespace and opening parentheses may
 * separate the comment from the assertion, so no neighbouring expression can borrow the sentence.
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
 * Require every non-const type assertion to state the invariant TypeScript cannot express.
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
