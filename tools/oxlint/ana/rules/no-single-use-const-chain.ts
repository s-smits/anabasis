import { defineRule, type ESTree } from "@oxlint/plugins";
import type { RuleExample } from "../../rule-examples.ts";
import { everyStatementList, identifierName, singleConst } from "../shared/statements.ts";

/** How many threaded steps make a chain worth a reader's attention. */
const MINIMUM_LINKS = 3;

/**
 * Flags a run of three or more consecutive `const` declarations that thread one value from step to
 * step, each read once and ending in the statement directly below. Steps carrying a leading comment,
 * a type annotation, or a function/arrow initialiser terminate the chain. There is no fix.
 */
export const noSingleUseConstChainRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description: "A run of single-use consts threading one value is one expression.",
      examples: [
        {
          before:
            "export function taskIds(text: string) {\n  const parsed = parseJsonAs(text, isBundle);\n  const rows = parsed.tasks;\n  const ids = rows.map(byId);\n  return ids.filter(unique);\n}",
          after:
            "export function taskIds(text: string) {\n  return parseJsonAs(text, isBundle).tasks.map(byId).filter(unique);\n}",
        },
        {
          before:
            "export function scoredCount(log: LogEvent[]) {\n  const last = log.findLast(isComparisonStart);\n  const terms = last?.terms;\n  const tasks = terms?.tasks ?? [];\n  return tasks.length;\n}",
          after:
            "export function scoredCount(log: LogEvent[]) {\n  return log.findLast(isComparisonStart)?.terms.tasks.length ?? 0;\n}",
        },
      ] satisfies RuleExample[],
    },
    messages: {
      chain:
        "`{{names}}` thread one value through {{count}} lines, each read once, into the statement below. Compose the steps that need no name, and keep the one or two names that say something the expression does not.",
    },
  },
  createOnce(context) {
    function step(statement: ESTree.Statement): ESTree.VariableDeclarator | null {
      const single = singleConst(statement);
      if (single === null) return null;
      return single.declared.init === null ? null : single.declared;
    }

    function bound(declarator: ESTree.VariableDeclarator): string {
      return identifierName(declarator.id) ?? "";
    }

    /** Not after a dot, not before a colon, `...name` included. */
    function spelling(name: string): RegExp {
      return new RegExp(String.raw`(?<![\w$])(?<!(?<!\.\.)\.)${name}(?![\w$:])`, "gu");
    }

    function scopeText(node: ESTree.Node): string {
      for (let at: ESTree.Node | null = node.parent; at !== null; at = at.parent) {
        const kind = at.type;
        if (kind === "FunctionDeclaration" || kind === "FunctionExpression") {
          return context.sourceCode.getText(at);
        }
        if (kind === "ArrowFunctionExpression" || kind === "Program") return context.sourceCode.getText(at);
      }
      return context.sourceCode.getText(node);
    }

    function readOnce(declarator: ESTree.VariableDeclarator): boolean {
      const uses = scopeText(declarator).match(spelling(bound(declarator)));
      // The declaration itself is one occurrence; a second is the single read.
      return uses?.length === 2;
    }

    function explained(above: ESTree.Statement | undefined, statement: ESTree.Statement): boolean {
      if (above === undefined) return false;
      const between = context.sourceCode.getText().slice(above.end, statement.start);
      const line = between.indexOf("\n");
      return line !== -1 && /\/\/|\/\*/u.test(between.slice(line));
    }

    function carriesBody(declarator: ESTree.VariableDeclarator): boolean {
      return /=>|\bfunction\b/u.test(context.sourceCode.getText(declarator));
    }

    function threads(declarator: ESTree.VariableDeclarator, above: string): boolean {
      return declarator.init !== null && spelling(above).test(context.sourceCode.getText(declarator.init));
    }

    function chain(body: readonly ESTree.Statement[], from: number): ESTree.VariableDeclarator[] {
      const links: ESTree.VariableDeclarator[] = [];
      for (let at = from; at < body.length; at += 1) {
        const statement = body[at];
        if (statement === undefined) break;
        const declarator = step(statement);
        if (declarator === null || carriesBody(declarator) || !readOnce(declarator)) break;
        if (explained(body[at - 1], statement)) break;
        const above = links.at(-1);
        if (above !== undefined && !threads(declarator, bound(above))) break;
        links.push(declarator);
      }
      return links;
    }

    function landsBelow(body: readonly ESTree.Statement[], after: number, last: string): boolean {
      const next = body[after];
      return next !== undefined && spelling(last).test(context.sourceCode.getText(next));
    }

    function scan(body: readonly ESTree.Statement[]): void {
      for (let at = 0; at < body.length; at += 1) {
        const links = chain(body, at);
        if (links.length < MINIMUM_LINKS) continue;
        const names = links.map(bound);
        at += links.length - 1;
        if (!landsBelow(body, at + 1, names.at(-1) ?? "")) continue;
        const [first] = links;
        if (first === undefined) continue;
        context.report({
          node: first.parent,
          messageId: "chain",
          data: { names: names.join("`, `"), count: String(links.length) },
        });
      }
    }

    return everyStatementList(scan);
  },
});
