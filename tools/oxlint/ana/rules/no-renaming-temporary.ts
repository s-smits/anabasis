import { defineRule, type ESTree } from "@oxlint/plugins";
import type { RuleExample } from "../../rule-examples.ts";
import { withoutProse } from "../shared/masked.ts";
import { statementBelow } from "../shared/statements.ts";

/**
 * Flags a `const` without a type annotation whose initialiser is a bare identifier or dotted
 * property path and whose only read in the enclosing function is in the immediately following
 * statement (unless the path is later reassigned in the same scope or narrowed across a closure).
 * Auto-fixes when evaluation order and closure capture are unaffected.
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

/** Whether this text narrows a dotted path, or any dotted prefix of it but the root, in a
 *  comparison, a `typeof` or an `instanceof`, which is how this tree narrows. */
function narrowedIn(text: string, path: string): boolean {
  const dots: number[] = [];
  for (let at = path.indexOf(".", path.indexOf(".") + 1); at > 0; at = path.indexOf(".", at + 1)) {
    dots.push(at);
  }
  return [path, ...dots.toReversed().map((at) => path.slice(0, at))].some((prefix) => {
    const escaped = prefix.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
    return (
      new RegExp(`${escaped}\\b[^\\n]{0,40}?(?:===|!==|instanceof )`, "u").test(text) ||
      text.includes(`typeof ${prefix}`)
    );
  });
}

export const noRenamingTemporaryRule = defineRule({
  meta: {
    type: "suggestion",
    fixable: "code",
    docs: {
      description: "A const that renames an expression and is read once is the expression.",
      examples: [
        {
          before:
            "export function caseIds(bundle: Bundle) {\n  const rows = bundle.rows;\n  return rows.map(toCase);\n}",
          after: "export function caseIds(bundle: Bundle) {\n  return bundle.rows.map(toCase);\n}",
        },
        {
          before:
            'export function openLog(campaignDir: string) {\n  const dir = campaignDir;\n  return readLog(join(dir, "notes.jsonl"));\n}',
          after:
            'export function openLog(campaignDir: string) {\n  return readLog(join(campaignDir, "notes.jsonl"));\n}',
        },
      ] satisfies RuleExample[],
    },
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
     * the name is the key as well as the value, so substituting renames the key, or, with a
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

        // Not after a dot, so a property of the same name is not a use, but `...name` is one.
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
            // stood. Those differ when the statement changes the value first (`state.value++ -
            // before`) or when the read waits in a closure, so neither is edited.
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
