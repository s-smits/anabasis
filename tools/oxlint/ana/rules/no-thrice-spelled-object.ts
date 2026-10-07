import { defineRule, type ESTree } from "@oxlint/plugins";
import { isTestFile } from "../shared/file-role.ts";

/** The fewest properties a repeated literal must carry before naming it is worth a function. */
const PROPERTY_FLOOR = 3;

/**
 * The fewest spellings that make an owner, in source and in a test.
 *
 * In source, three spellings are three callers and the floor holds. A test is the other case:
 * the literal is usually the case being read, and a reader who has to resolve a name to know
 * what a case was given has lost more than the three edits cost. Measured 2026-09-20: 47 of the
 * 48 sites were in tests, 30 of them at exactly three spellings. At five the file is no longer
 * showing a case — it is repeating a fixture, and `draft-authority.test.ts` spells one eight
 * times. Ten sites survive both floors, every one of them a test.
 */
const SPELLING_FLOOR = { source: 3, test: 5 };

/**
 * Rung 5 of the simplify skill's ladder, second clause: "three spellings of one object literal
 * are one small function (one owner, even when the line count is equal)."
 *
 * The commit lane found this in five of the 138 net-negative commits the recorded simplify
 * passes produced — `66a1ba978`, `23086a056`, `c273c01a7`, `32950a6fb`, `602397c8d`. The shape
 * is always the same: a row, a finding, a fixture or an options bag written out in full at
 * three or more places in one file, so that changing what the shape means is three edits and
 * forgetting one of them is a silent drift.
 *
 * Three is the floor in source and it is load-bearing. At two spellings the extraction is a
 * one-caller helper, which `ana/no-single-caller-helper` exists to remove, so a catcher that
 * fired at two would ask for the thing another rule takes away. At three the owner has three
 * callers and both rules agree. The skill states the same floor in the same words. A test
 * carries a higher floor and an assertion carries none; both are argued where they are set.
 *
 * Comparison is over the printed text with whitespace collapsed, so the same literal spelled
 * across three lines in one place and on one line in another still counts as the same literal.
 * That is a deliberately blunt instrument: it cannot see two literals that differ only in a
 * value the owner would take as a parameter, which is the more common and more valuable
 * version of this finding. It reports what it can prove and leaves the rest to a reader.
 *
 * A literal under two properties is not reported. `{}` and `{ ok: true }` are spelled everywhere
 * and naming them buys nothing. One report is made per group, at its first spelling, naming the
 * lines the others sit on, because three reports of one finding read as three findings.
 *
 * There is no fix: the function needs a name and a parameter list, and which fields vary across
 * the three spellings is what the parameter list is.
 */

/**
 * The constants that carry no domain content: a literal of only these is a set of flags.
 *
 * `{ recursive: true, force: true }` is 16 of this shape's 168 sites and the largest single
 * spelling in it, and it is not this repository's shape to redefine: Node owns it, so "changing
 * what the shape means" is not a change anybody here can make. `{ answered: false, refusal: null }`
 * and `{ done: true, value: undefined }` are the same case written locally — a state, already
 * named by the union type the function returns. Naming a flag set again buys a second name for
 * one state and an object three call sites now share.
 */
function valueless(value: ESTree.Node): boolean {
  if (value.type === "Literal") return value.value === true || value.value === false || value.value === null;
  if (value.type === "Identifier") return value.name === "undefined";
  if (value.type === "ArrayExpression") return value.elements.length === 0;
  return value.type === "ObjectExpression" && value.properties.length === 0;
}

/** Whether an expression is rooted at `expect`, through any chain of members and calls. */
function assertionRoot(node: ESTree.Node): boolean {
  if (node.type === "Identifier") return node.name === "expect";
  if (node.type === "MemberExpression") return assertionRoot(node.object);
  return node.type === "CallExpression" && assertionRoot(node.callee);
}

/**
 * Whether the literal sits inside an assertion, where the point is to read it where it is.
 *
 * `expect(slots.review).toMatchObject({ enabled: true, kind: "claude", source: "operator" })`
 * spelled three times is three expectations, not one shape. Naming it once means a reader of any
 * one assertion can no longer see what it asserts, and changing what one of them expects changes
 * the other two — which is the coupling a test exists not to have. Ten of 48 sites.
 */
function asserted(node: ESTree.ObjectExpression): boolean {
  // Only the Program has no parent, and it answers `null`, so one spelling ends the walk.
  for (let at: ESTree.Node | null = node.parent; at !== null; at = at.parent) {
    if (at.type === "CallExpression" && assertionRoot(at.callee)) return true;
  }
  return false;
}

export const noThriceSpelledObjectRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description: "One object literal spelled three times in a file is one function with three callers.",
    },
    messages: {
      thrice:
        "This literal is spelled {{count}} times in this file (also at {{lines}}). Three spellings of one object are one small function: today, changing what the shape means is {{count}} edits.",
    },
  },
  createOnce(context) {
    /** Every literal seen in this file, by its text with runs of whitespace collapsed to one. */
    const spellings = new Map<string, ESTree.ObjectExpression[]>();

    return {
      before: () => {
        spellings.clear();
        return true;
      },

      ObjectExpression(node) {
        const named = node.properties.filter((property) => property.type === "Property");
        if (named.length < PROPERTY_FLOOR || named.length !== node.properties.length) return;
        if (named.every((property) => valueless(property.value)) || asserted(node)) return;
        const key = context.sourceCode.getText(node).replaceAll(/\s+/gu, " ");
        const found = spellings.get(key);
        if (found === undefined) spellings.set(key, [node]);
        else found.push(node);
      },

      "Program:exit": () => {
        const floor = isTestFile(context.filename) ? SPELLING_FLOOR.test : SPELLING_FLOOR.source;
        for (const group of spellings.values()) {
          const [first, ...rest] = group;
          if (first === undefined || group.length < floor) continue;
          const lines = rest.map((node) => context.sourceCode.getLoc(node).start.line).join(", ");
          context.report({ node: first, messageId: "thrice", data: { count: String(group.length), lines } });
        }
      },
    };
  },
});
