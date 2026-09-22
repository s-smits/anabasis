import { defineRule, type ESTree } from "@oxlint/plugins";
import { everyStatementList, singleConst } from "../shared/statements.ts";

/** How many threaded steps make a chain worth a reader's attention. The dial the shape was queued with. */
const MINIMUM_LINKS = 3;

/**
 * A run of `const`s that thread one value from step to step, each read exactly once, ending in the
 * statement below:
 *
 *     const parsed = parseJsonAs(text, isBundle);
 *     const rows = parsed.tasks;
 *     const ids = rows.map(byId);
 *     return ids.filter(unique);
 *
 *     return parseJsonAs(text, isBundle).tasks.map(byId).filter(unique);
 *
 * This is the twenty-lines-to-four shape the operator keeps naming, stated so a scan can find it.
 * `ana/no-renaming-temporary` is its N=1 case restricted to a rename; this one admits work in the
 * initialiser, which is why it has no fixer — see below.
 *
 * The threading is what separates the shape from an ordinary block of locals. Each step after the
 * first has to read the step above it, so the run is one value moving rather than four unrelated
 * bindings that happen to sit together, and the last one has to be read in the statement directly
 * below the run, so the whole chain lands in one place. A binding read twice, read further down or
 * read from a nested function ends the run where it stands.
 *
 * Three exemptions, each of them a way a `const` earns its line.
 *
 * A step carrying a comment is explained, and the explanation is what the name is holding. The
 * text between the statement above and the declaration is read for `//` or a block opener; finding
 * either ends the run there. This is the "a const whose name explains a non-obvious expression is
 * exempt" dial the shape was queued with, in the one form a rule can decide: the author wrote the
 * sentence or they did not.
 *
 * A step with a type annotation ends the run for the reason the rename rule gives — the annotation
 * is a narrowing the expression does not carry — and it is the read count that ends it, not a test
 * of its own. `const rows: string[]` spells the binding's name before a colon, and the count skips
 * a name in that position so a property key is not read as a use, which leaves one occurrence where
 * two are wanted. An explicit check for the annotation stood here and was deleted: no mutation of
 * it changed the fixture, and the tree reports the same no sites without it, so the line was
 * restating a decision the count had already made. The fixture holds the behaviour instead — it
 * asserts the run starts *below* an annotated step rather than at it — so a change to how
 * occurrences are counted fails there rather than dropping the exemption in silence.
 *
 * A step whose initialiser holds a function or an arrow is not one expression to compose. Inlining
 * a callback's binding puts a body inside an argument list, which is the direction this repository
 * reads in the other order.
 *
 * The dial is the link count, and the tree chose it. At three links this repository has **no site**,
 * over `src`, `tools`, `test`, `vendor`, `starters`, `packages` and `.claude` (measured
 * 2026-09-20). At two it has 80, and reading them settles the question rather than leaving it a
 * preference: 60 are a test arranging a fixture and then reading a result, which is the shape a
 * test is meant to have, and twelve of the twenty elsewhere were read one by one — `decision`,
 * `readable`, `contradicts`, `violations`, `counted`, `observer`, `shareMount`, `judge`,
 * `promptOptions`, `mins`, `indexed`, `verdict`. Every one of them says something its expression
 * does not, and composing any of them reads worse. So two threaded steps are ordinary and three are
 * the shape, and the rule gates from zero: it costs nothing today, and the chain cannot arrive
 * without being seen.
 *
 * There is no fix. The repair is the composition, and the composition is a reading: which two of
 * the four steps stay named, what the surviving name becomes, and whether the chain wants to be one
 * expression at all or two statements with better names. A fixer would answer all three the same
 * way at every site, which is the answer nobody comes back to.
 */
export const noSingleUseConstChainRule = defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "A run of single-use consts threading one value is one expression." },
    messages: {
      chain:
        "`{{names}}` thread one value through {{count}} lines, each read once, into the statement below. Compose the steps that need no name, and keep the one or two names that say something the expression does not.",
    },
  },
  createOnce(context) {
    /** The declarator a chain step is, or null when the statement is anything else. */
    function step(statement: ESTree.Statement): ESTree.VariableDeclarator | null {
      const single = singleConst(statement);
      if (single === null) return null;
      return single.declared.init === null ? null : single.declared;
    }

    /** The name a declarator binds, which `step` has already proved is a plain identifier. */
    function bound(declarator: ESTree.VariableDeclarator): string {
      return declarator.id.type === "Identifier" ? declarator.id.name : "";
    }

    /** A name matched where it is read: not after a dot, not before a colon, `...name` included. */
    function spelling(name: string): RegExp {
      return new RegExp(String.raw`(?<![\w$])(?<!(?<!\.\.)\.)${name}(?![\w$:])`, "gu");
    }

    /** The enclosing function or program, as source text, for counting a binding's reads. */
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

    /** Whether the binding is read exactly once in the scope that declares it. */
    function readOnce(declarator: ESTree.VariableDeclarator): boolean {
      const uses = scopeText(declarator).match(spelling(bound(declarator)));
      // The declaration itself is one occurrence; a second is the single read that keeps it.
      return uses?.length === 2;
    }

    /**
     * Whether a comment sits on its own line above this statement, explaining the step.
     *
     * The slice runs from the end of the statement above, so it opens with whatever that
     * statement's own line still held — a trailing `// ...` explains the line it is on, not the
     * next one. Dropping the first line of the slice is what separates the two.
     */
    function explained(above: ESTree.Statement | undefined, statement: ESTree.Statement): boolean {
      if (above === undefined) return false;
      const between = context.sourceCode.getText().slice(above.end, statement.start);
      const line = between.indexOf("\n");
      return line !== -1 && /\/\/|\/\*/u.test(between.slice(line));
    }

    /** Whether the initialiser holds a function body, which is not one expression to compose. */
    function carriesBody(declarator: ESTree.VariableDeclarator): boolean {
      return /=>|\bfunction\b/u.test(context.sourceCode.getText(declarator));
    }

    /** Whether this step reads the name the step above it bound. */
    function threads(declarator: ESTree.VariableDeclarator, above: string): boolean {
      return declarator.init !== null && spelling(above).test(context.sourceCode.getText(declarator.init));
    }

    /** The chain starting at `from`, as its declarators, longest first and possibly empty. */
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

    /** Whether the statement below the run reads the last name the run bound. */
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
