import { defineRule, type ESTree } from "@oxlint/plugins";
import { isTestFile } from "../shared/file-role.ts";

/**
 * A table of constants built inside a function body is rebuilt on every call, and it sits where
 * the work is rather than where the shapes are.
 *
 *     function pathRecordRow(value: JsonValue) {
 *       const strings = ["at", "sessionId", "capability", "guardId", "policyDigest", ...];
 *       if (strings.some((key) => !isString(row[key]))) return null;
 *
 * The operator's shape for a file is the declarations at the front and the work below, which
 * `declarations-before-the-first-function` asks of module scope. This asks the same of a function
 * body: a value that closes over nothing and never changes is a declaration, and its place is the
 * top of the file where a reader looking for the data finds it without reading the code around it.
 *
 * Two conditions, both read off the syntax, and together they are the admission test. Every entry
 * is a primitive written as a constant, so the table closes over nothing and module scope can hold
 * it exactly as written. And the binding never escapes the declaration: in this whole file the
 * name appears only as the object of a property read. That second one is what makes the hoist safe
 * rather than merely legal — at module scope one object is shared by every call, where an inline
 * one was fresh each time, so anything that could write to it withdraws the report.
 *
 * Primitive is stricter than constant, and the difference is the entry a property read hands out.
 * A nested `{ a: [1, 2], b: [3], c: [4] }` is constant throughout and still has `t.a.push(5)` in
 * it, and a `use(t.a)` that no rule can follow; hoisted, one call's array would be every call's.
 * A flat table has nothing to hand out but a string or a number, which no caller can write to. It
 * costs nothing measurable here — all five sites are flat, and of the six fixtures it withdraws
 * one, `const authored: CorrectnessModelResult = { ok: false, issues: [], ... }`, whose empty
 * nested array is the thing there is no rule for. It removes the class rather than the spellings
 * of it somebody thought of.
 *
 * It is the escape rule that does the work, and it was written after reading what a weaker one
 * reported. Withdrawing only on a bare call argument still reported `segment-actor.mts`'s
 * `const state: BuilderTurnState = { accepted: null, attempts: 0, ... }`, six constants that the
 * turn loop then writes to, handed on as the shorthand `{ session, state, ... }` — a property
 * value, not an argument. Hoisting it would have shared one actor's turn state with every other
 * actor. A rule in the gate has to be wrong in the other direction, so every use that is not a
 * property read now withdraws: passed, returned, assigned, spread, destructured or iterated.
 *
 * Names are matched across the file rather than by scope, which over-withdraws where two
 * functions each hold their own `rows` and under-withdraws nothing.
 *
 * Test files are exempt, and the reason is what a fixture is rather than how many there are. The
 * five sites the test tree holds are each a made-up input standing next to the assertion that
 * explains it — `const scratchpad = ["a", "b", "a", "c"]` under a comment reading `A → B → A → C`,
 * a ten-label shortlist, a four-commit history. Moved to the top of the file they would be read
 * before the case that gives them meaning, which is the opposite of what this rule is for.
 *
 * Measured over `src`, `tools`, `vendor`, `starters`, `test`, `packages` and `.claude` on
 * 2026-09-20, five sites outside tests: `path-record.ts`'s seven required row keys,
 * `luna-sessions.mjs`'s five quick-launch option names, `wall-policy.ts`'s three run-data
 * directory names, `prose-classify.mjs`'s three case kinds and `archive-scaffold.mjs`'s
 * lane-state lookup. Each of those five files already carried module constants of exactly this
 * shape — `PROTECTED_HOME_NAMES`, `BACKENDS`, `EFFECT_STATES` — so the rule found the exception
 * rather than a new style, and all five are now hoisted. It enters the gate at zero, where it
 * costs nothing and keeps the shape from arriving.
 *
 * There is no fix, and the five sites say why. Moving the declaration is mechanical; the four
 * things a reader gets out of the move are not. Each of the five was renamed on the way up --
 * `strings` became `REQUIRED_STRINGS`, `runData` became `RUN_DATA_NAMES`, `outcomes` became
 * `CASE_OUTCOMES`, `stateOf` became `LANE_STATES` -- and only `quickOptionNames` is the name a
 * casing rule reaches. That is the point rather than a detail: a name that read well beside the
 * one function using it says nothing at the top of a file, so the hoist is the moment the table
 * has to be named for what it holds. Four of the five also gained the sentence saying what the
 * table is for, which no fixer can write either. A mechanical hoist would leave `const strings`
 * at module scope, uncommented, and stop the rule reporting -- compliance with the letter of it
 * and none of the benefit, and no second chance to do it properly.
 */

/** Entries below which an inline literal is one argument written out, not a table. */
const ENTRY_FLOOR = 3;

/** Methods that write to their receiver. A call to one is a write to the binding. */
const MUTATING = new Set([
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "sort",
  "reverse",
  "fill",
  "copyWithin",
  "set",
  "add",
  "delete",
  "clear",
]);

/** `{…} as const` declares the same table; the assertion is not what is being declared. */
function unwrapAssertion(node: ESTree.Node): ESTree.Node {
  let value = node;
  while (value.type === "TSAsExpression" || value.type === "TSSatisfiesExpression") value = value.expression;
  return value;
}

/** Whether the value is a primitive written as a constant, which nothing can write through. */
function primitiveConstant(node: ESTree.Node): boolean {
  if (node.type === "Literal") return true;
  if (node.type === "TemplateLiteral") return node.expressions.length === 0;
  if (node.type === "UnaryExpression") return node.operator === "-" && primitiveConstant(node.argument);
  return false;
}

/** Whether every entry of the table is one of those, so no entry can be aliased out of it. */
function flatConstantTable(node: ESTree.Node): boolean {
  if (node.type === "ArrayExpression") {
    return node.elements.every((element) => element !== null && primitiveConstant(element));
  }
  if (node.type !== "ObjectExpression") return false;
  return node.properties.every(
    (property) => property.type === "Property" && !property.computed && primitiveConstant(property.value),
  );
}

/** How many entries the literal states, or zero for anything that is not one. */
function entryCount(node: ESTree.Node): number {
  if (node.type === "ArrayExpression") return node.elements.length;
  return node.type === "ObjectExpression" ? node.properties.length : 0;
}

/** Whether the declaration sits inside a function rather than at module scope. */
function insideFunction(node: ESTree.Node): boolean {
  for (let walk = node.parent; walk !== null; walk = walk.parent) {
    if (walk.type === "FunctionDeclaration" || walk.type === "FunctionExpression") return true;
    if (walk.type === "ArrowFunctionExpression") return true;
  }
  return false;
}

/** Whether a property read of the binding writes through it: `t.x = 1`, `t.rows.push(…)`, `delete t.x`. */
function writesThrough(member: ESTree.Node): boolean {
  const { parent } = member;
  if (parent === null) return false;
  if (parent.type === "AssignmentExpression") return parent.left === member;
  if (parent.type === "UpdateExpression") return true;
  if (parent.type === "UnaryExpression") return parent.operator === "delete";
  if (parent.type !== "CallExpression" || parent.callee !== member) return false;
  return (
    member.type === "MemberExpression" &&
    !member.computed &&
    member.property.type === "Identifier" &&
    MUTATING.has(member.property.name)
  );
}

export const noInlineSchemaLiteralRule = defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "A constant table built inside a function body belongs at module scope." },
    messages: {
      inline:
        "`{{name}}` is {{count}} constant entries rebuilt on every call, declared where the work is rather than where the shapes are. It closes over nothing and this file only reads it, so move it to module scope.",
    },
  },
  createOnce(context) {
    /** Declarations that passed the syntactic test, by name, in source order. */
    const candidates = new Map<string, ESTree.VariableDeclarator[]>();

    /** Names this file does anything with other than read a property of. */
    const escaped = new Set<string>();

    return {
      before: () => {
        candidates.clear();
        escaped.clear();
        return !isTestFile(context.filename);
      },

      VariableDeclarator(node) {
        const { id, init, parent } = node;
        if (init === null) return;
        if (parent.type !== "VariableDeclaration" || parent.kind !== "const") return;
        if (id.type !== "Identifier" || !insideFunction(node)) return;
        const table = unwrapAssertion(init);
        if (entryCount(table) < ENTRY_FLOOR || !flatConstantTable(table)) return;
        candidates.set(id.name, [...(candidates.get(id.name) ?? []), node]);
      },

      Identifier(node) {
        const { parent } = node;
        // The declaration itself, and a property name that happens to match, say nothing.
        if (parent.type === "VariableDeclarator" && parent.id === node) return;
        if (parent.type === "Property" && parent.key === node && parent.value !== node) return;
        if (parent.type === "MemberExpression" && parent.property === node && !parent.computed) return;
        // A property read is the one use that keeps the value inside this declaration.
        if (parent.type === "MemberExpression" && parent.object === node && !writesThrough(parent)) return;
        escaped.add(node.name);
      },

      "Program:exit": () => {
        for (const [name, nodes] of candidates) {
          if (escaped.has(name)) continue;
          for (const node of nodes) {
            const { init } = node;
            if (init === null) continue;
            context.report({
              node,
              messageId: "inline",
              data: { name, count: String(entryCount(unwrapAssertion(init))) },
            });
          }
        }
      },
    };
  },
});
