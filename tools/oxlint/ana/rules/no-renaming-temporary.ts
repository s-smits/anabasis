import { defineRule, type ESTree } from "@oxlint/plugins";
import type { RuleExample } from "../../rule-examples.ts";
import { withoutProse } from "../shared/masked.ts";
import { statementBelow } from "../shared/statements.ts";

/**
 * Flags an unannotated `const` whose initialiser is a bare identifier or dotted property path and
 * whose only read is the next statement, unless the scope writes to the path or a closure below
 * would lose a narrowing. Auto-fixes when evaluation order and closure capture are unaffected.
 */
const OPENS = new Map([
  ["(", ")"],
  ["[", "]"],
  ["{", "}"],
]);

/** Whether text ahead of a read can change the value first: an update, an assignment, a `delete`,
 *  an `await` or `yield`, or a completed call or group. Text rather than a proof, so it errs
 *  towards leaving the edit to the author. */
function changedBefore(ahead: string): boolean {
  return /\+\+|--|\bdelete\b|\bawait\b|\byield\b|\)|(?<![=!<>])=(?![=>])/u.test(ahead);
}

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
    function rename(node: ESTree.Expression): string | null {
      if (node.type === "Identifier") return node.name;
      if (node.type !== "MemberExpression" || node.computed || node.optional) return null;
      return rename(node.object) === null ? null : context.sourceCode.getText(node);
    }

    function replaced(scope: string, path: string): boolean {
      const escaped = path.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
      return new RegExp(String.raw`(?<!\b(?:const|let|var)\s{1,4})${escaped}\s*=(?!=)`, "u").test(scope);
    }

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
     * In `{ label }` the name is the key as well as the value, and `reader()` on a binding of
     * `stream.read` calls an unbound function where `stream.read()` binds a receiver.
     */
    function substitutable(text: string, index: number, name: string, value: string): boolean {
      const after = text.slice(index + name.length).trimStart();
      const before = text.slice(0, index).trimEnd();
      const shorthand = /[{,]$/u.test(before) && /^[},]/u.test(after) && enclosing(text, index) === "{";
      return !shorthand && !(value.includes(".") && after.startsWith("("));
    }

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
        const uses = scopeText(node).match(spelling);
        if (uses?.length !== 2) return;
        // That read has to be the next statement: further down, the binding is a snapshot.
        const next = statementBelow(declaration);
        if (next === null) return;
        const below = context.sourceCode.getText(next);
        if (below.match(spelling) === null) return;
        const scope = scopeText(node);
        if (replaced(scope, value)) return;
        if (/=>|\bfunction\b/u.test(below) && narrowedIn(scope, value)) return;

        const name = node.id.name;
        context.report({
          node,
          messageId: "renamed",
          data: { name, value },
          fix: (fixer) => {
            // In the text the read may also be a word in a string, a template or a comment, so only
            // masked text is edited.
            const masked = withoutProse(below);
            const reads = [...masked.matchAll(spelling)];
            const [read] = reads;
            if (reads.length !== 1 || read?.index === undefined) return null;
            if (!substitutable(masked, read.index, name, value)) return null;
            // Removing one declarator of several would leave its comma to place, so that statement is
            // reported but not edited.
            if (declaration.declarations.length !== 1) return null;
            // The path reads the value where the name stood, so a change ahead of the read or a read in
            // a closure is not edited.
            if (changedBefore(masked.slice(0, read.index)) || /=>|\bfunction\b/u.test(masked)) return null;
            const at = next.start + read.index;
            // Removing the declaration alone leaves a comment on its line or below it where its author
            // put it.
            return [fixer.remove(declaration), fixer.replaceTextRange([at, at + name.length], value)];
          },
        });
      },
    };
  },
});
