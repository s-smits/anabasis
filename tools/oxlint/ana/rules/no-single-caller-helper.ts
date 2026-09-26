import { defineRule, type ESTree } from "@oxlint/plugins";
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

/** `tools/loc/source-policy.ts` refuses a function over this many nonblank lines. Formatted
 *  lines since 2026-09-20; the comment there says why the number moved from 80. */
const CALLER_LINES = 115;

/** `tools/loc/complexity-policy.ts` refuses a function at or above this cyclomatic complexity. */
const CALLER_COMPLEXITY = 22;

/** Operands a boolean chain needs before a call in it reads as one term among peers. Two is
 *  `a || b`, where the other term is usually a literal and there is no vocabulary to keep. */
const CHAIN_PEERS = 3;

/**
 * A module-scope function nobody exports, whose body is a couple of statements, called from exactly
 * one place. It is not an abstraction; it is a name standing between a reader and two lines of
 * code, and reading the caller now means jumping somewhere else and back.
 *
 * The measured tree had a hundred of these. They are the reason a fifteen-line function reads as
 * forty: `toArgs`, `packageName`, `sizedManifest`, `unchangedCommitOf`, each used once, each a line
 * or two. Put the lines where they run and the caller states its whole job in one place.
 *
 * Both measures have to hold, and the line count is the one that was missing. Counting statements
 * alone reported 322 sites, and 210 of them were validators whose whole body is a single
 * `return a && b && c && …` running to fifteen lines: one statement, and inlining it hands the
 * caller a forty-line boolean expression. That is the shape this rule exists to remove, so
 * producing it would have been an own goal.
 *
 * How short is short depends on where the one call stands, and that is the second measure after
 * the span. A call that is a statement — its own expression, a `return`'s value, the initialiser
 * of a declaration — takes the body's statements as statements, one under the other, and three of
 * them still read as the caller's own work. A call in an expression — an argument, a property
 * value, a spread, a ternary arm, the body of a concise arrow — has to hold the whole body as one
 * term, and two statements is where that stops being a ternary and starts being a puzzle. So the
 * expression site keeps 2 statements and 5 lines and the statement site takes 3 and 7.
 *
 * Measured 2026-09-20 on the tree at `ce72b1f49`: a flat 3 and 7 reported 77 sites, and reading
 * fourteen of them found nine that could not be spelled at the call site at all. `epochBindingKeys`
 * is called inside a `...spread`, `starterAuthority` and `presetAuthority` inside a `.map` arrow's
 * object literal, `bindsProject` and `isRegularFileDeny` inside a `.some` and a `.flatMap` arrow
 * whose bodies are expressions, `probeOutcomeStatus` inside an `.every`. Three of those bodies
 * hold a `throw` or a `try`, which an expression cannot hold at all. The dial was not wrong about
 * the size; it was wrong about where the lines would go.
 *
 * Ten things keep their name.
 *
 * A helper with two or more callers is shared, and this rule never sees it. An exported one is an
 * interface. A recursive one counts its own call, so it needs three references before it looks
 * single-caller, and never reaches two. A type guard — `function complete(b): b is Complete` — is
 * not two lines of code with a name on it: the name is where the narrowing is declared, and
 * inlining the body gives the caller a boolean and no narrowed value.
 *
 * And a caller with no room keeps it. Two other gates in this tree measure the function the
 * inlined lines would land in — 115 nonblank lines in `tools/loc/source-policy.ts`, cyclomatic
 * complexity 22 in `tools/loc/complexity-policy.ts` — and a caller already at either has no legal
 * spelling that also absorbs a helper. Reporting there asks for a change the gate then refuses,
 * which is the admission test failing at one site. It happened six times in one pass over
 * `src/backends`, `src/correctness-bundle`, `src/author` and `src/solve` before the rule was taught to check,
 * every time after the push gate had already run; the arithmetic is cheap and the reader of the
 * report should not have to do it.
 *
 * That room is spent rather than only measured, because a caller can have room for either of two
 * helpers and not for both. `settle` in `src/builder/verifier-workshop.ts` measured 19 and called
 * two one-statement helpers, one of them a null guard worth two branches; each report fitted on
 * its own and following both took the function to 22 against a ceiling of 21. Each report now
 * charges the caller for what it would land there, so the second helper reads as a caller with no
 * room, which is what it is.
 *
 * And a call that is one term among peers in an `&&` or `||` chain keeps its name, because the same
 * argument applies a second time. `tools/outcome/builder-execution-current.ts` holds twenty
 * predicates of one shape — `validBackend`, `currentInvocation`, `findingDelta`,
 * `currentFailedCalls` — each read once, each an operand of a long `&&`. They are a vocabulary the
 * chains are written in, not helpers hiding two lines, and substituting one body into a thirty-term
 * chain lengthens the caller and leaves that one term spelled differently from its nineteen peers.
 *
 * The peers are the whole reason, so the exemption asks for them: three operands in the chain the
 * call sits in. `x ?? fallback()` and `a || b` have none — there is one other term, it is usually a
 * literal, and nothing is being spelled consistently with anything. Measured 2026-09-20, before
 * this line existed: the exemption covered 15 sites, of which 8 were chains of three or more and 7
 * were not, including `defaultOpenRouterModel`, which sat behind `deps.model?.trim() || …` and had
 * had exactly one caller since it was written.
 *
 * And a body that opens a `using` resource keeps its name, whatever its size, because `using`
 * disposes at the end of the block that declares it. `admissionPayload` in `src/run/admission.ts`
 * opens the controller ledger, reads one string and returns, closing it there; the same three
 * lines in `readAdmission` would hold the ledger open for the rest of that function. That is not
 * the same program, and no reader of the report would be told so.
 *
 * And two bodies keep their name because there is no legal spelling of them at a call site, which
 * is a stronger reason than size. A body that catches: JavaScript has no try expression, so
 * `symlinkText` in `src/verify/exact-read-attestation.ts` — a decoded link or a thrown refusal —
 * becomes a `let`, a try and a catch inside a loop that already holds two of each. And a body that
 * leaves before its last statement, because a `return` belongs to the function that declares it:
 * the same line at a call site returns from the caller, so the inline is a restructuring into a
 * local and one assignment per escape rather than a relocation of the lines. `leafCategory` in
 * `src/correctness-bundle/draft-summary.ts` is three `if (…) return a;` lines and a final `return`, and none
 * of its spellings inside `boundedDraftSummary` is the same program moved.
 *
 * That second one was measured as the chain it happened to be, and reading it back a day later
 * showed the chain was the shape and not the reason. `const t = value.trim(); if (t === "")
 * return null; return t.length;` is no more relocatable and the chain predicate admitted it. The
 * first justification named `ana/no-tangled-ternary` and `ana/no-arms-differing-in-one-term` as
 * the two rules that refuse every expression form of a decision chain, which was true and made
 * this refusal only as durable as its two siblings; the census that proposed retiring one of them
 * is what sent us back to it. The one call in tail position is the exception the wider predicate
 * earns: `return helper(x)` takes the escapes exactly as written. The size dial cannot see any of
 * this, and it was found by reading the twenty-six sites the dial produced.
 *
 * And a name read as a value keeps it, because there is no call site to put the lines at. A member
 * of a rule table, a default parameter value, a predicate handed to `.filter` — `curriculumInput`
 * sits in a `FindingRule` array in `epoch-review-findings.ts` beside eleven siblings that read as
 * words, and the only spelling that removes the name puts an anonymous arrow in the table. The
 * message would be asking for something the site does not have.
 *
 * There is no fix, and one was written and thrown away. Substituting the arguments into a
 * one-`return` body is mechanical enough — the parameter ranges come from the scope analysis, so
 * even an identifier inside a string is safe — but the result is a longer expression where the
 * author wanted a statement, and the caller ends up holding the same density under a different
 * shape. What this rule asks for is a caller that reads as one piece of work, and where the lines
 * go, what the local is called once it is no longer a return value, and whether a guard clause
 * belongs there instead are the reader's decisions. A fixer would have produced, at three hundred
 * sites, exactly the shape the rule exists to remove.
 */
export const noSingleCallerHelperRule = defineRule({
  meta: {
    type: "suggestion",
    docs: { description: "Inline a short module-scope helper that has a single caller." },
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
      // Statements alone are the wrong measure: a validator whose whole body is one 15-line
      // `return a && b && c && …` is one statement, and inlining it gives the caller a forty-line
      // boolean expression. What the rule is about is a name standing in front of a couple of
      // lines, so the lines have to be counted too.
      if (
        context.sourceCode.getText(value).split("\n").length > (site === "term" ? SHORT_SPAN : STATEMENT_SPAN)
      ) {
        return null;
      }
      // A `declare function` has no body, so there is nothing to inline into the caller.
      if (value.body === null) return null;
      // An expression-bodied arrow is already at the call site's level of detail: one term.
      if (value.body.type !== "BlockStatement") return 1;
      // A `using` declaration disposes at the end of the block holding it, so the same lines in
      // the caller keep the resource open for everything the caller does after the call.
      // `admissionPayload` in `src/run/admission.ts` opens the controller ledger and closes it at
      // its return; inlined, it would hold the ledger for the rest of `readAdmission`.
      if (
        value.body.body.some(
          (statement) => statement.type === "VariableDeclaration" && statement.kind.endsWith("using"),
        )
      ) {
        return null;
      }
      // JavaScript has no try expression, so a body that catches is the one shape the call site
      // cannot spell: `symlinkText` in `src/verify/exact-read-attestation.ts` returns a decoded
      // link or throws a refusal, and the same lines in its caller are a `let`, a try and a catch
      // inside a loop that already holds two of each.
      if (value.body.body.some((statement) => statement.type === "TryStatement")) return null;
      if (site !== "tail" && escaping.has(value)) return null;
      return value.body.body.length;
    }

    /** The functions control leaves before their last statement, filled as the linter walks.
     *
     *  A `return` belongs to the function that declares it. Standing at a call site, the same
     *  line returns from the caller instead, so the inline is a restructuring and not a
     *  relocation: the caller has to invent a local and turn each escape into an assignment to
     *  it. The one exception is a call that is itself the caller's `return`, where the escapes
     *  land exactly as written and nothing follows them; `cost` reads that and passes it in.
     *
     *  Written first as the narrower thing in front of us, a body of `if (…) return a;` lines
     *  and a final `return z`, which is what `leafCategory` in `src/correctness-bundle/draft-summary.ts` is,
     *  and justified by two of this repository's own rules refusing every expression form of
     *  one: `ana/no-tangled-ternary` on a nested ternary and `ana/no-arms-differing-in-one-term`
     *  on one assignment per arm. Both were true and neither was the reason. `const t =
     *  value.trim(); if (t === "") return null; return t.length;` relocates no better and the
     *  narrow predicate admitted it, and a refusal that rests on two sibling rules is only as
     *  durable as the shorter-lived of them. */
    const escaping = new Set<ESTree.Node>();

    /** Mark the function a `return` leaves, when it is not that body's last statement.
     *
     *  Read from the `return` upwards rather than from the body down. Walking down means
     *  enumerating every statement type that can hold one — block, `if`, five loops, `switch`,
     *  a label — and being wrong about whichever was forgotten; upwards, the first block that
     *  stands directly under a function is the body, and the node this walk came through is its
     *  statement. A `return` inside a nested function stops at that function's own body, which
     *  is where it belongs. */
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
     *  A `statement` site — the call as its own expression, the value of a `return`, the
     *  initialiser of a statement-level declaration — takes the body's statements as statements,
     *  one under the other. A `term` site — an argument, a property value, a spread, a ternary
     *  arm, a concise arrow body, a `for` header — has to hold the whole body as one term, which
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
    type Cost = {
      declaring: ESTree.Node;
      name: string;
      statements: number;
      grown: ESTree.Node | null;
      lines: number;
      branching: ESTree.Node | null;
      branches: number;
    };

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
      // A default value is a branch to `eslint(complexity)`, which is the counter
      // `tools/loc/complexity-policy.ts` reads and therefore the only one whose number decides
      // anything. `settle` in `src/builder/verifier-workshop.ts` measures 21 there and 19 here
      // without its two default parameters, and those two were the difference between a helper
      // this rule could ask for and one the gate then refused.
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
