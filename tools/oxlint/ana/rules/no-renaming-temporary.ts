import { defineRule, type ESTree } from "@oxlint/plugins";
import { withoutProse } from "../shared/masked.ts";
import { narrowedIn } from "../shared/narrowed.ts";
import { statementBelow } from "../shared/statements.ts";

/**
 * A `const` whose value is another name, or a part of one, and which is then used once:
 *
 *     const rows = bundle.rows;
 *     return rows.map(toCase);
 *
 *     return bundle.rows.map(toCase);
 *
 * A temporary earns its line in two ways: it holds work that would otherwise be repeated, or
 * its name says something the expression does not. A single use rules out the first, and an
 * initialiser that is only an identifier or a dotted path rules out the second — `rows` and
 * `bundle.rows` carry the same word.
 *
 * This is rung 5 of the simplify ladder read at its smallest: the line exists, and removing it
 * loses nothing. It is also the shape that grows: once a rename is in the file, the next edit
 * has a name to reach for and adds a second read of it, and then the temporary is load-bearing
 * for a reason that was never decided.
 *
 * A computed member, a call, an `await`, an object or anything with an operator in it all keep
 * their temporary, because each is either work or a decision. A binding with a type annotation
 * keeps it too: the annotation is a narrowing the expression does not carry.
 *
 * The single use has to be in the very next statement, and that is the rule's main defence. A
 * name read further down is often a snapshot rather than a rename — `const before = store.seq;`
 * three statements above the mutation it is measured against, or `const reader = activeReader;`
 * one statement above `activeReader = null` — and inlining either of those changes what the
 * code does. Adjacency is also where the reading cost actually is: two lines saying one thing.
 *
 * Uses are counted by name over the enclosing function's text, ignoring positions after a dot
 * and before a colon so a property with the same name does not read as a use. A spread is a
 * use: `[...hostScratchRoots]` was the second read of a binding this rule called single-use. That is a
 * heuristic, and a shadowed name inside a nested scope will read as a use and silence the
 * report — which is the safe direction for a catcher that a person reads.
 *
 * Two more exemptions, measured on 2026-09-20 over 13 sites.
 *
 * A name for a value the same scope then replaces is a moment, not a second name. `const original =
 * console.error` reads `console.error` once, in the `finally` that puts it back, and by then
 * `console.error` is the stub the test installed. The file assigning to that same path is what
 * separates the two, and it took three sites — the saved `globalThis.fetch`, `Bun.dns.lookup`
 * and `console.error` of three tests.
 *
 * It fixes what it reports: the value is an identifier or a dotted path, so it is atomic and
 * needs no parentheses wherever the name stood, and the name has exactly one read by
 * construction. The read is found in the statement below with its comments and quoted strings
 * blanked out, because a word matching the binding inside a string is not a read and editing it
 * would be the one kind of mistake nobody sees again.
 *
 * A narrowing does not cross into a closure, so a binding read inside a nested function below a
 * guard is carrying the guard. `const key = options.apiKey` under `if (options.apiKey !==
 * undefined)` is `string`; `options.apiKey` inside the `env` callback two lines down is
 * `string | undefined` again. Three sites, one of them — `start.credential` under a guard on
 * `start.credential.token` — narrowed a level deeper than the binding, which the shared reader
 * admits on purpose: a missed narrowing is a finding a reader cannot act on.
 *
 * The report and the edit part at evaluation order. `const before = state.value;` then `return
 * state.value++ - before;` reads once in the next statement, and the edit would read after the
 * increment: 0 becomes -1. `return () => saved` turns a snapshot into a live lookup. Both are
 * still reported; the edit is left to the author.
 */
/** Each opening bracket against the closing one that would balance it. */
const OPENS = new Map([
  ["(", ")"],
  ["[", "]"],
  ["{", "}"],
]);

/** Whether statement text ahead of a read can change a value before the read takes it: an update,
 *  an assignment, a `delete`, an `await` or `yield`, or a completed call or group. Text rather
 *  than a proof, so it errs towards leaving the edit to the author. */
function changedBefore(ahead: string): boolean {
  return /\+\+|--|\bdelete\b|\bawait\b|\byield\b|\)|(?<![=!<>])=(?![=>])/u.test(ahead);
}

export const noRenamingTemporaryRule = defineRule({
  meta: {
    type: "suggestion",
    fixable: "code",
    docs: { description: "A const that renames an expression and is read once is the expression." },
    messages: {
      renamed:
        "`{{name}}` is `{{value}}` under a second name and is read once. The line holds no work and adds no word the expression does not already have; using `{{value}}` at its one reader removes it.",
    },
  },
  createOnce(context) {
    /** The dotted text of an initialiser worth no line, or null when it is work or a decision. */
    function rename(node: ESTree.Expression): string | null {
      if (node.type === "Identifier") return node.name;
      if (node.type !== "MemberExpression" || node.computed || node.optional) return null;
      return rename(node.object) === null ? null : context.sourceCode.getText(node);
    }

    /** Whether this scope writes to the path, which makes the binding the value before the write. */
    function replaced(scope: string, path: string): boolean {
      const escaped = path.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
      return new RegExp(String.raw`(?<!\b(?:const|let|var)\s{1,4})${escaped}\s*=(?!=)`, "u").test(scope);
    }

    /** The nearest bracket still open at `index`, or "" at the statement's own level. */
    function enclosing(text: string, index: number): string {
      const closed = new Map([
        [")", 0],
        ["]", 0],
        ["}", 0],
      ]);
      for (let at = index - 1; at >= 0; at -= 1) {
        const character = text[at] ?? "";
        const depth = closed.get(character);
        if (depth !== undefined) closed.set(character, depth + 1);
        const opens = OPENS.get(character);
        if (opens === undefined) continue;
        const pending = closed.get(opens) ?? 0;
        if (pending === 0) return character;
        closed.set(opens, pending - 1);
      }
      return "";
    }

    /**
     * Whether the value's text can stand where the name stands.
     *
     * Two positions where it cannot, and neither is visible to the match alone. In `{ label }`
     * the name is the key as well as the value, so substituting renames the key — or, with a
     * dotted value, writes `{ row.name }`, which does not parse. And `reader()` on a binding of
     * `stream.read` calls an unbound function, where `stream.read()` binds a receiver: the same
     * call with a different `this`.
     */
    function substitutable(text: string, index: number, name: string, value: string): boolean {
      const after = text.slice(index + name.length).trimStart();
      const before = text.slice(0, index).trimEnd();
      const shorthand = /[{,]$/u.test(before) && /^[},]/u.test(after) && enclosing(text, index) === "{";
      return !shorthand && !(value.includes(".") && after.startsWith("("));
    }

    /** The nearest enclosing function or program body, as source text. */
    function scopeText(node: ESTree.Node): string {
      for (let at: ESTree.Node | null = node.parent; at !== null; at = at.parent) {
        const kind = at.type;
        if (
          kind === "FunctionDeclaration" ||
          kind === "FunctionExpression" ||
          kind === "ArrowFunctionExpression"
        ) {
          return context.sourceCode.getText(at);
        }
        if (kind === "Program") return context.sourceCode.getText(at);
      }
      return context.sourceCode.getText(node);
    }

    return {
      VariableDeclarator(node) {
        const declaration = node.parent;
        if (declaration.type !== "VariableDeclaration") return;
        if (declaration.kind !== "const") return;
        if (node.id.type !== "Identifier") return;
        // An annotation is a narrowing the expression does not carry, so the binding earns its line.
        if (node.id.typeAnnotation !== undefined && node.id.typeAnnotation !== null) return;
        if (node.init === null) return;

        const value = rename(node.init);
        if (value === null) return;

        // Not after a dot, so a property of the same name is not a use — but `...name` is one.
        const spelling = new RegExp(String.raw`(?<![\w$])(?<!(?<!\.\.)\.)${node.id.name}(?![\w$:])`, "gu");
        // The declaration itself is one occurrence; a second is the single read that keeps it.
        const uses = scopeText(node).match(spelling);
        if (uses?.length !== 2) return;
        // That read has to be the next statement: further down, the binding is a snapshot.
        const next = statementBelow(declaration);
        if (next === null) return;
        const below = context.sourceCode.getText(next);
        if (below.match(spelling) === null) return;
        // The value before a write this scope makes, and a guard a closure below would lose.
        const scope = scopeText(node);
        if (replaced(scope, value)) return;
        if (/=>|\bfunction\b/u.test(below) && narrowedIn(scope, value)) return;

        const name = node.id.name;
        context.report({
          node,
          messageId: "renamed",
          data: { name, value },
          fix: (fixer) => {
            // In the tree the read is an identifier; in the text it may also be a word in a
            // string, a template or a comment, and substituting there would be a silent wrong edit.
            const masked = withoutProse(below);
            const reads = [...masked.matchAll(spelling)];
            const [read] = reads;
            if (reads.length !== 1 || read?.index === undefined) return null;
            if (!substitutable(masked, read.index, name, value)) return null;
            // The visitor decides one declarator and the edit removes the statement that holds
            // it, so `const one = input.value, keep = 2;` took `keep` with it. Removing the
            // declarator alone would leave its comma to place, which is a layout decision; the
            // report stands and the author makes that edit.
            if (declaration.declarations.length !== 1) return null;
            // The binding read the value when it was declared; the path reads it where the name
            // stood. Those differ when the statement changes the value first — `state.value++ -
            // before` — or when the read waits in a closure, so neither is edited.
            if (changedBefore(masked.slice(0, read.index)) || /=>|\bfunction\b/u.test(masked)) return null;
            const at = next.start + read.index;
            // Removing the declaration alone, rather than the span up to the next statement,
            // leaves a comment written on its line or below it where its author put it.
            return [fixer.remove(declaration), fixer.replaceTextRange([at, at + name.length], value)];
          },
        });
      },
    };
  },
});
