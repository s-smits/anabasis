import { defineRule, type ESTree } from "@oxlint/plugins";
import type { RuleExample } from "../../rule-examples.ts";
import { isComponentFile, isTestFile } from "../shared/file-role.ts";

/** A body this short says nothing a reader could not have read at the call site. */
const SHORT_BODY = 2;

/** Signature, up to three lines of body, closing brace. Longer is a function, not a name. */
const SHORT_SPAN = 5;

/** What a call standing as its own statement may take instead. An expression call site has to hold
 *  the whole body as one term, and two statements is where that stops reading as one; a statement
 *  call site takes statements as statements, so it affords one more of them and two more lines. */
const STATEMENT_BODY = 3;

/** The span that goes with `STATEMENT_BODY`: signature, up to five lines of body, closing brace. */
const STATEMENT_SPAN = 7;

/** A declaration in one of these is a loop header, not a place to put lines. */
const LOOP_HEADERS = new Set(["ForStatement", "ForInStatement", "ForOfStatement"]);

/** The three nodes a `return` can belong to, and the three a helper can be written as. */
const FUNCTIONS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);

/** Where the one call stands. `tail` is a statement site too, and the only one an escaping body
 *  relocates to unchanged, so it is a third kind rather than a second flag. */
type Site = "tail" | "statement" | "term";

/** `tools/loc/source-policy.ts` refuses a function over this many nonblank lines, counted as
 *  formatted; the comment there says why the number is not 80. */
const CALLER_LINES = 115;

/** The cyclomatic complexity at which a caller has no room for a helper's branches (v1's gate). */
const CALLER_COMPLEXITY = 22;

/** Operands a boolean chain needs before a call in it reads as one term among peers. Two is
 *  `a || b`, where the other term is usually a literal and there is no vocabulary to keep. */
const CHAIN_PEERS = 3;

/**
 * Flags a non-exported module-scope function or arrow helper called from a single call site whose
 * body fits within the call site's budget (`SHORT_BODY`/`SHORT_SPAN` at expression sites,
 * `STATEMENT_BODY`/`STATEMENT_SPAN` at statement/tail sites) without pushing the enclosing caller
 * past `CALLER_LINES` (115 nonblank lines) or `CALLER_COMPLEXITY` (22 branches). Type predicates,
 * helpers using `using` or `try`, helpers with early `return`s outside tail position, and calls
 * standing as one term among three or more peers in a boolean chain (`CHAIN_PEERS`) are exempt.
 * There is no fix.
 */
export const noSingleCallerHelperRule = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description: "Inline a short module-scope helper that has a single caller.",
      examples: [
        {
          before:
            'function logOf(dir: string) {\n  return join(dir, "ledger.jsonl");\n}\nexport function readLog(dir: string) {\n  return readFileSync(logOf(dir), "utf8");\n}',
          after:
            'export function readLog(dir: string) {\n  return readFileSync(join(dir, "ledger.jsonl"), "utf8");\n}',
        },
        {
          before:
            'function heldOut(tasks: Task[]) {\n  return tasks.filter((task) => task.state === "held");\n}\nexport const scored = (tasks: Task[]) => heldOut(tasks).slice(0, 24);',
          after:
            'export const scored = (tasks: Task[]) => tasks.filter((task) => task.state === "held").slice(0, 24);',
        },
      ] satisfies RuleExample[],
    },
    messages: {
      singleCaller:
        "`{{name}}` is {{statements}} statement(s) long, is not exported, and is called once. Put those lines at the call site: a name standing in front of them costs one reader a jump and buys nothing.",
    },
  },
  createOnce(context) {
    /** Nonblank lines of the block comment immediately above a declaration, which moves with it. */
    function leadingCommentLines(declaring: ESTree.Node): number {
      const before = context.sourceCode.getCommentsBefore(declaring);
      return before.reduce(
        (total, comment) => total + comment.value.split("\n").filter((line) => line.trim() !== "").length,
        0,
      );
    }

    /** How many statements a callable's body holds, or null when there is nothing to inline.
     *  The site is the caller's, because both what the lines may cost and whether they relocate
     *  at all depend on where they would land. */
    function bodyLength(value: ESTree.Node, site: Site): number | null {
      if (
        value.type !== "FunctionDeclaration" &&
        value.type !== "FunctionExpression" &&
        value.type !== "ArrowFunctionExpression"
      ) {
        return null;
      }
      // `value is T` and `asserts value` declare a narrowing the call site cannot restate.
      if (value.returnType?.typeAnnotation.type === "TSTypePredicate") return null;
      if (
        context.sourceCode.getText(value).split("\n").length > (site === "term" ? SHORT_SPAN : STATEMENT_SPAN)
      ) {
        return null;
      }
      if (value.body === null) return null;
      if (value.body.type !== "BlockStatement") return 1;
      // A `using` declaration disposes at the end of its enclosing block, and JavaScript has no try expression.
      if (
        value.body.body.some(
          (statement) => statement.type === "VariableDeclaration" && statement.kind.endsWith("using"),
        )
      ) {
        return null;
      }
      if (value.body.body.some((statement) => statement.type === "TryStatement")) return null;
      if (site !== "tail" && escaping.has(value)) return null;
      return value.body.body.length;
    }

    /** Functions whose control flow leaves before their last statement, which relocate unchanged only in tail position. */
    const escaping = new Set<ESTree.Node>();

    /** Mark the enclosing function when a `return` is not that function body's last statement. */
    function noteEscape(node: ESTree.Node): void {
      let child: ESTree.Node = node;
      let holder: ESTree.Node | null = node.parent;
      while (holder !== null && !FUNCTIONS.has(holder.type)) {
        if (holder.type === "BlockStatement" && holder.parent !== null && FUNCTIONS.has(holder.parent.type)) {
          if (holder.body.at(-1) !== child) escaping.add(holder.parent);
          return;
        }
        child = holder;
        holder = holder.parent;
      }
    }

    /** Nonblank lines of a node's own text, counted the way `tools/loc/source-policy.ts` counts. */
    function nonblankLines(node: ESTree.Node): number {
      return context.sourceCode
        .getText(node)
        .split("\n")
        .filter((line) => line.trim() !== "").length;
    }

    /** Decision points per function, filled by the visitors below as the linter walks. A nested
     *  function is measured on its own, exactly as `eslint/complexity` measures it, because each
     *  branch is attributed to the nearest function that encloses it. */
    const branchCount = new Map<ESTree.Node, number>();

    function countBranch(node: ESTree.Node): void {
      const owner = enclosing(node, "innermost");
      if (owner !== null) branchCount.set(owner, (branchCount.get(owner) ?? 0) + 1);
    }

    /** `a?.b` is a branch to this counter, because it is one to the counter that owns the ceiling:
     *  `relocateToolLauncher` measures 21 there and 16 without its five optional accesses. */
    function countOptional(node: ESTree.MemberExpression | ESTree.CallExpression): void {
      if (node.optional) countBranch(node);
    }

    /** The function a node sits in. `"innermost"` is the one `eslint/complexity` measures, so it
     *  owns a branch; `"outermost"` is the largest function the inlined lines would grow, and it
     *  is the one `tools/loc/source-policy.ts` refuses first. A call inside a callback inside an
     *  exported function grows both, and only the outer one was anywhere near its ceiling. */
    function enclosing(use: ESTree.Node, which: "innermost" | "outermost"): ESTree.Node | null {
      let found: ESTree.Node | null = null;
      let current: ESTree.Node | null = use.parent;
      while (current !== null) {
        if (
          current.type === "FunctionDeclaration" ||
          current.type === "FunctionExpression" ||
          current.type === "ArrowFunctionExpression"
        ) {
          if (which === "innermost") return current;
          found = current;
        }
        current = current.parent;
      }
      return found;
    }

    /** The leaves of a boolean chain: `a && b && c` is three, and anything that is not itself a
     *  chain is one. */
    function operands(node: ESTree.Node): number {
      if (node.type !== "LogicalExpression") return 1;
      return operands(node.left) + operands(node.right);
    }

    /** Whether this use of the name is one term among peers in a boolean chain, stopping at the
     *  function that holds it so an enclosing caller's own chain does not answer for it. Three
     *  operands, because the peers are the reason: see the paragraph above. */
    function chainTerm(use: ESTree.Node): boolean {
      let outermost: ESTree.Node | null = null;
      let current: ESTree.Node | null = use.parent;
      while (current !== null) {
        if (current.type === "LogicalExpression") outermost = current;
        else if (FUNCTIONS.has(current.type)) break;
        else if (outermost !== null) break;
        current = current.parent;
      }
      return outermost !== null && operands(outermost) >= CHAIN_PEERS;
    }

    /** Where the one call stands, which decides both how much body the site can take and whether
     *  an escaping body relocates there at all.
     *
     *  A `statement` site (the call as its own expression, the value of a `return`, the
     *  initialiser of a statement-level declaration) takes the body's statements as statements,
     *  one under the other. A `term` site (an argument, a property value, a spread, a ternary
     *  arm, a concise arrow body, a `for` header) has to hold the whole body as one term, which
     *  is why its limits are lower. `tail` is the statement site that is the caller's own
     *  `return`, and the only one where an escaping body lands as written; `return await
     *  helper(x)` is not it, because the awaited value is not what the escapes return. */
    function callSite(use: ESTree.Node): Site {
      let node = use;
      while (node.parent?.type === "AwaitExpression") node = node.parent;
      const parent: ESTree.Node | null = node.parent;
      if (parent === null) return "term";
      if (parent.type === "ReturnStatement") return node === use ? "tail" : "statement";
      if (parent.type === "ExpressionStatement") return "statement";
      if (parent.type !== "VariableDeclarator" || parent.init !== node) return "term";
      const held = parent.parent?.parent ?? null;
      return held !== null && !LOOP_HEADERS.has(held.type) ? "statement" : "term";
    }

    /** What one report would cost the two functions the inlined lines land in: the outermost one
     *  grows by `lines` and the innermost one by `branches`. */
    interface Cost {
      declaring: ESTree.Node;
      name: string;
      statements: number;
      grown: ESTree.Node | null;
      lines: number;
      branching: ESTree.Node | null;
      branches: number;
    }

    function cost(declaring: ESTree.Node, name: string, callable: ESTree.Node): Cost | null {
      const declared = context.sourceCode
        .getDeclaredVariables(declaring)
        .find((variable) => variable.name === name);
      // Reads only. `const helper = () => …` counts its own initialiser as a write reference, so
      // counting every reference put the whole arrow-function half of the tree out of reach: the
      // first census reported 304 sites and not one of them was a `const`.
      const reads =
        declared === undefined ? [] : declared.references.filter((reference) => reference.isRead());
      const [only] = reads;
      if (reads.length !== 1 || only === undefined || chainTerm(only.identifier)) return null;
      // The report says to put the lines at the call site, so there has to be one. A name read as a
      // value has nowhere to inline into; see the seventh exemption above.
      const use: ESTree.Node | null = only.identifier.parent;
      if (use.type !== "CallExpression" || use.callee !== only.identifier) return null;
      const site = callSite(use);
      const statements = bodyLength(callable, site);
      if (statements === null || statements === 0) return null;
      if (statements > (site === "term" ? SHORT_BODY : STATEMENT_BODY)) return null;
      return {
        declaring,
        name,
        statements,
        grown: enclosing(only.identifier, "outermost"),
        // The declaration's own text starts at the signature, so a doc comment that would move
        // with the lines is counted here too: it is part of what the caller would carry.
        lines: nonblankLines(declaring) + leadingCommentLines(declaring) - 2,
        branching: enclosing(only.identifier, "innermost"),
        branches: branchCount.get(callable) ?? 0,
      };
    }

    /** Report in source order, charging each caller for the helper it takes, so two helpers of one
     *  caller cannot both be reported into a function with room for one. */
    function reportAffordable(costs: readonly Cost[]): void {
      const takenLines = new Map<ESTree.Node, number>();
      const takenBranches = new Map<ESTree.Node, number>();
      for (const item of costs) {
        const lines =
          item.grown === null
            ? 0
            : nonblankLines(item.grown) + (takenLines.get(item.grown) ?? 0) + item.lines;
        const branches =
          item.branching === null
            ? 0
            : (branchCount.get(item.branching) ?? 0) +
              (takenBranches.get(item.branching) ?? 0) +
              item.branches +
              1;
        if (lines > CALLER_LINES || branches >= CALLER_COMPLEXITY) continue;
        if (item.grown !== null) takenLines.set(item.grown, lines - nonblankLines(item.grown));
        if (item.branching !== null) {
          takenBranches.set(item.branching, branches - (branchCount.get(item.branching) ?? 0) - 1);
        }
        context.report({
          node: item.declaring,
          messageId: "singleCaller",
          data: { name: item.name, statements: item.statements },
        });
      }
    }

    return {
      // A test's fixtures and its assertions are different readers; a named builder used once is
      // how a fixture says what it is. This rule speaks to production only.
      before: () => {
        // One rule instance serves every file, so the per-function counts start empty each time.
        branchCount.clear();
        escaping.clear();
        return !isTestFile(context.filename) && !isComponentFile(context.filename);
      },

      IfStatement: countBranch,
      ForStatement: countBranch,
      ForInStatement: countBranch,
      ForOfStatement: countBranch,
      WhileStatement: countBranch,
      DoWhileStatement: countBranch,
      CatchClause: countBranch,
      ReturnStatement: noteEscape,
      ConditionalExpression: countBranch,
      LogicalExpression: countBranch,
      MemberExpression: countOptional,
      CallExpression: countOptional,
      // A default value is a branch to `eslint(complexity)`, the counter v1's
      // `5bc9988:tools/loc/complexity-policy.ts` read and this rule's limit is measured in. In v1,
      // `settle` measured 21 there and 19 here without its two default parameters, and those two
      // were the difference between a helper this rule could ask for and one the gate refused.
      AssignmentPattern: countBranch,
      AssignmentExpression: (node) => {
        if (node.operator === "&&=" || node.operator === "||=" || node.operator === "??=") countBranch(node);
      },
      // `default:` is where a switch stops branching, not another branch.
      SwitchCase: (node) => {
        if (node.test !== null) countBranch(node);
      },

      // Module scope only, and an exported one arrives wrapped in ExportNamedDeclaration, so this
      // one visitor settles both "local" and "not an interface". It runs on the way out, so every
      // branch above has been counted before a caller's room is measured.
      "Program:exit": (program) => {
        const costs: Cost[] = [];
        for (const statement of program.body) {
          if (statement.type === "FunctionDeclaration" && statement.id !== null) {
            const found = cost(statement, statement.id.name, statement);
            if (found !== null) costs.push(found);
            continue;
          }
          if (statement.type !== "VariableDeclaration") continue;
          for (const declarator of statement.declarations) {
            const { init } = declarator;
            if (declarator.id.type !== "Identifier" || init === null) continue;
            if (init.type !== "ArrowFunctionExpression" && init.type !== "FunctionExpression") continue;
            const found = cost(declarator, declarator.id.name, init);
            if (found !== null) costs.push(found);
          }
        }
        reportAffordable(costs);
      },
    };
  },
});
