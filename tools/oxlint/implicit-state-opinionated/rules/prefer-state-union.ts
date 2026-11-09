import { defineRule, type ESTree } from "@oxlint/plugins";
import type { RuleExample } from "../../rule-examples.ts";
import { isBoolean } from "#src/meta/json-shape.ts";
import { isFlagType } from "../../ana/shared/flags.ts";
import { bindsName, identifierName, literalValue, propertyName } from "../../ana/shared/statements.ts";
import {
  enclosingFunction,
  innermost,
  isTestPath,
  objectValues,
  outermost,
} from "../../implicit-state/shared/syntax.ts";

/**
 * Tier: opinionated. Booleans that are one state spelled as flags, found by what the code does
 * with them rather than by how many there are (`max-boolean-fields` counts them).
 *
 * Reported, two shapes:
 *
 * - A class whose methods move two or more of its boolean fields at different times: `_started`
 *   set in `start()` and `_closed` in `close()` are a lifecycle (created, started, closed) held as
 *   flags, and every reader has to know that closed without started never happens. A field is
 *   boolean when it is annotated so or initialised to `true` or `false`, and a method moves it when
 *   the method, the constructor aside, assigns `this.<field>`. Flags the same methods always move
 *   together (modifier keys a key handler reads off one event) are left alone. Reported at the
 *   class body.
 * - An object holding a flag derived from two of its own other fields:
 *   `{ isOverEither: h || v, isOverHorizontal: h, isOverVertical: v }`, directly or through a
 *   `const`. The three admit eight combinations where four happen. The fields must be flags: the
 *   declared return type says so, or the two sources are comparisons, negations or boolean
 *   literals, so a default (`title || name`) stays silent. Reported at the declared return type
 *   where there is one, and at the object otherwise.
 *
 * Not reported: fields only the constructor sets (configuration), records of independent options
 * however many, and a value derived from another object's fields. Test and declaration files are
 * not read. There is no fix: which states the flags stand for is the change.
 *
 * The shapes do not reach the generic floor. Scored against both implicit-state corpora, 16 of 29
 * labelled hits on nine foreign repositories were a state spelled as flags: a large class keeps
 * unrelated latches (a warn-once flag, a lazy load, a restore guard) that its methods move at
 * different times, which the syntax cannot tell from a lifecycle.
 */
const DECLARATION = /\.d\.[cm]?ts$/u;
const COMPARISON = new Set(["===", "!==", "==", "!=", "<", "<=", ">", ">=", "in", "instanceof"]);

type Member = ESTree.MethodDefinition | ESTree.PropertyDefinition;

/** The boolean fields a class body declares, by name. */
function booleanFields(body: ESTree.ClassBody): Set<string> {
  return new Set(
    body.body.flatMap((member) => {
      if (member.type !== "PropertyDefinition" || member.static) return [];
      const flag = isFlagType(member.typeAnnotation?.typeAnnotation) || isBoolean(literalValue(member.value));
      const name = identifierName(member.key);
      return flag && name !== null ? [name] : [];
    }),
  );
}

/** The class member a node sits in, or null at the top of a constructor or outside a class. */
function memberOf(node: ESTree.Node): Member | null {
  for (let at = node.parent; at !== null && at !== undefined; at = at.parent) {
    if (at.type === "MethodDefinition") return at.kind === "constructor" ? null : at;
    if (at.type === "PropertyDefinition" && at.parent?.type === "ClassBody") return at;
  }
  return null;
}

export const preferStateUnionRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Flags a class's methods move apart, or one flag derived from two others, are one state; name it.",
      examples: [
        {
          before:
            "class Server {\n  started = false;\n  closed = false;\n  start() { this.started = true; }\n  close() { this.closed = true; }\n}",
          after:
            'class Server {\n  phase: "created" | "started" | "closed" = "created";\n  start() { this.phase = "started"; }\n  close() { this.phase = "closed"; }\n}',
        },
      ] satisfies RuleExample[],
    },
    messages: {
      lifecycle:
        "This class holds {{count}} boolean fields its methods move at different times ({{names}}). Flags admit every combination; one field naming the phase admits only the ones that happen.",
      derived:
        "This record holds 3 booleans where `{{derived}}` is derived from `{{a}}` and `{{b}}`, so only some of their combinations happen. Hold the state once and derive the rest where it is read.",
    },
  },
  create(context) {
    if (isTestPath(context.filename) || DECLARATION.test(context.filename)) {
      return {};
    }
    const text = (node: ESTree.Node): string => context.sourceCode.getText(node).replaceAll(/\s+/gu, "");
    const bound = new Map<string, ESTree.Node>();
    const objects: ESTree.ObjectExpression[] = [];
    /** For each class body, the methods that move each of its boolean fields. */
    const moves = new Map<ESTree.ClassBody, Map<string, Set<string>>>();
    const resolved = (node: ESTree.Node): ESTree.Node => {
      const value = innermost(node);
      return innermost(bound.get(identifierName(value) ?? "") ?? value);
    };
    const isFlagValue = (node: ESTree.Node): boolean => {
      const value = resolved(node);
      if (value.type === "BinaryExpression") return COMPARISON.has(value.operator);
      return (value.type === "UnaryExpression" && value.operator === "!") || isBoolean(literalValue(value));
    };

    /** The first field of an object derived by `||` or `&&` from two other flags of it. */
    function derivedField(
      object: ESTree.ObjectExpression,
      declared: ESTree.TSType | undefined,
    ): string[] | null {
      const sources = objectValues(object);
      const values = new Map([...sources].map(([name, value]) => [text(value), name]));
      const members = declared?.type === "TSTypeLiteral" ? declared.members : [];
      for (const [name, value] of sources) {
        const source = resolved(value);
        if (source.type !== "LogicalExpression" || source.operator === "??") continue;
        const a = values.get(text(source.left));
        const b = values.get(text(source.right));
        const typed = members.some(
          (member) =>
            member.type === "TSPropertySignature" &&
            identifierName(member.key) === name &&
            isFlagType(member.typeAnnotation?.typeAnnotation),
        );
        const flags = typed || (isFlagValue(source.left) && isFlagValue(source.right));
        const others = a !== undefined && b !== undefined && a !== b && a !== name && b !== name;
        if (others && flags) return [name, a, b];
      }
      return null;
    }

    return {
      VariableDeclarator: (node) => {
        if (bindsName(node)) bound.set(node.id.name, node.init);
      },
      ObjectExpression: (node) => {
        objects.push(node);
      },
      ClassBody: (node) => {
        moves.set(node, new Map([...booleanFields(node)].map((field) => [field, new Set<string>()])));
      },
      AssignmentExpression: (node) => {
        const field = propertyName(node.left);
        const member = memberOf(node);
        const body = member?.parent;
        const target = node.left.type === "MemberExpression" && node.left.object.type === "ThisExpression";
        if (!target || field === null || member === null || body?.type !== "ClassBody") return;
        moves.get(body)?.get(field)?.add(text(member.key));
      },
      "ClassBody:exit": (node) => {
        const moved = [...(moves.get(node) ?? [])].filter(([, by]) => by.size > 0);
        const times = new Set(moved.map(([, by]) => [...by].toSorted().join(" ")));
        if (moved.length < 2 || times.size < 2) return;
        const names = moved.map(([field]) => `\`${field}\``).join(", ");
        context.report({ node, messageId: "lifecycle", data: { count: String(moved.length), names } });
      },
      "Program:exit": () => {
        for (const object of objects) {
          const at = outermost(object).parent;
          const returned = at?.type === "ReturnStatement" || at?.type === "ArrowFunctionExpression";
          const declared = returned ? enclosingFunction(object)?.returnType?.typeAnnotation : undefined;
          const [derived, a, b] = derivedField(object, declared) ?? [];
          if (derived === undefined || a === undefined || b === undefined) continue;
          const node = declared?.type === "TSTypeLiteral" ? declared : object;
          context.report({ node, messageId: "derived", data: { derived, a, b } });
        }
      },
    };
  },
});
