import { defineRule, type ESTree } from "@oxlint/plugins";
import { everyStatementList } from "../shared/statements.ts";

/**
 * Three or more branches testing one name against one literal each are a table:
 *
 *     if (kind === "verified") return 1;
 *     if (kind === "unaccepted") return 0;
 *     if (kind === "non-result") return null;
 *
 *     const WEIGHT = { verified: 1, unaccepted: 0, "non-result": null } as const;
 *
 * A table is not shorter by much, and shortness is not the argument. The argument is that the
 * chain hides two things a table states. It hides whether the set is closed — a reader has to
 * reach the bottom to find out whether a fourth kind falls through or throws — and it hides
 * which values are covered, so `satisfies Record<Kind, …>` cannot check them and a new member
 * of the union compiles clean while returning nothing.
 *
 * Three is the floor because two branches are a decision and three are a set. At two, building
 * a table means naming something that has one reader, which `ana/no-single-caller-helper`
 * would then read as a helper to inline.
 *
 * The chain must test one subject, each arm must compare it to a literal with `===`, and each
 * arm must be a single return. A `switch` over the same subject is the same finding in a
 * different spelling and is not read here, because the language already makes its set visible
 * and `default` says what falls through.
 *
 * Two more conditions, measured on 2026-09-20 over 13 sites, where ten were not tables.
 *
 * No arm may read the subject. When it does, the chain is splitting a discriminated union and
 * the arms are the variants: `if (value.type === "Literal") return value.value === true` reads
 * a field that exists in that variant alone, and a table entry would have to be a function of a
 * different parameter type per key. Six sites, every one of them an AST or schema walk.
 *
 * Every arm has to fit on its line. Where it does not, the entries are not values but closures
 * over a dozen lines each — `if (kind === "claude") { return createClaudeBackend({ effort: …,
 * cwd: …, repoRoot, builtinTools: […], …}); }` — and the reader gains the visible set at the
 * cost of a record of thunks. Four sites.
 *
 * And the set has to be closed, which is the whole claim above. The chain must reach the end of
 * its block, so that a run covering five of a schema walk's twelve kinds yields no
 * `Partial<Record<…>>` beside the seven branches that still need the chain — one mechanism
 * split in two is not what this rule asks for. Two sites, both the leading leaf cases of a
 * longer walk.
 *
 * What follows the chain then has to say the set is closed: nothing, a `throw`, or the
 * exhaustiveness assert, which is the one fallthrough that reads the subject. A plain
 * `return "inspect and repair that contract"` says the opposite — `publicAct` names three of
 * seven finding kinds and lets the rest through — and a table for a subset is a
 * `Partial<Record<…>>`, which checks no more than the chain it replaced. One site.
 *
 * There is no fix. Whether the table is a `Record`, a `Map`, or a `satisfies`
 * against the union depends on the key type, and a missing-key answer has to be chosen.
 */

/** Branches over one subject below which a chain is still a decision rather than a set. */
const ARM_FLOOR = 3;

export const preferLookupOverEqualityChainRule = defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "Three branches comparing one name to literals are a lookup table." },
    messages: {
      spelledTable:
        "{{count}} branches compare `{{subject}}` against a literal and return. A table states the same thing and makes the set visible: `satisfies Record<…>` then checks the cases, which a chain cannot.",
    },
  },
  createOnce(context) {
    /** The subject an `if` tests against a literal with `===`, or null for any other test. */
    function subjectOf(node: ESTree.IfStatement): string | null {
      const { test } = node;
      if (test.type !== "BinaryExpression" || test.operator !== "===") return null;
      if (test.right.type !== "Literal" || test.right.value === null) return null;
      if (test.left.type !== "Identifier" && test.left.type !== "MemberExpression") return null;
      return context.sourceCode.getText(test.left);
    }

    /** Whether a branch body is a single `return` on one line, with or without its block. */
    function returnsOnly(node: ESTree.Statement): boolean {
      const statement = node.type === "BlockStatement" && node.body.length === 1 ? node.body[0] : node;
      if (statement?.type !== "ReturnStatement") return false;
      // The arm as written, so a one-line return inside a three-line block still spans lines.
      return !context.sourceCode.getText(node).includes("\n");
    }

    /** Whether an arm reads the subject, which makes the chain a union split, not a lookup. */
    function readsSubject(node: ESTree.Statement, subject: string): boolean {
      // The leading identifier, so a subject like `idsOf(brief).length` gives `idsOf`.
      const root = /^[\w$]+/u.exec(subject)?.[0];
      if (root === undefined) return true;
      return new RegExp(String.raw`(?<![\w$.])${root}(?![\w$])`, "u").test(context.sourceCode.getText(node));
    }

    /** Consecutive `if`s in one statement list, from `index`, all testing `subject`. */
    function run(body: readonly ESTree.Statement[], index: number, subject: string): number {
      let count = 0;
      for (let at = index; at < body.length; at += 1) {
        const statement = body[at];
        if (statement?.type !== "IfStatement") break;
        if (statement.alternate !== null) break;
        if (subjectOf(statement) !== subject || !returnsOnly(statement.consequent)) break;
        if (readsSubject(statement.consequent, subject)) break;
        count += 1;
      }
      return count;
    }

    function scan(body: readonly ESTree.Statement[]): void {
      let at = 0;
      while (at < body.length) {
        const statement = body[at];
        if (statement?.type !== "IfStatement") {
          at += 1;
          continue;
        }
        const subject = subjectOf(statement);
        const length = subject === null ? 0 : run(body, at, subject);
        // A closed set: the chain reaches the end of its block, and what follows says so.
        const after = body[at + length];
        const closed =
          at + length >= body.length - 1 &&
          (after === undefined ||
            after.type === "ThrowStatement" ||
            (subject !== null && readsSubject(after, subject)));
        if (subject !== null && length >= ARM_FLOOR && closed) {
          context.report({
            node: statement,
            messageId: "spelledTable",
            data: { count: String(length), subject },
          });
        }
        at += Math.max(length, 1);
      }
    }

    return everyStatementList(scan);
  },
});
