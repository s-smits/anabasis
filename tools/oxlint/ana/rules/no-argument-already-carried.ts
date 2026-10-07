import { defineRule, type ESTree, type Fix, type Fixer, type Scope, type Variable } from "@oxlint/plugins";
import { holdsProse } from "../shared/masked.ts";
import { narrowedIn } from "../shared/narrowed.ts";
import { calls, writes } from "../shared/predicate-effect.ts";

/**
 * A call that passes a value and then passes a part of that same value beside it. The callee
 * already holds the part; the second argument is the same information travelling twice.
 *
 *     toolsView(bundle, bundle.findings)
 *     settleEnvironment(iteration, iteration.harness, options)
 *
 * The commit lane found five of the recorded simplify passes making this cut — `c273c01a7`,
 * `2f5642bc7`, `32950a6fb`, `66a1ba978`, `0fd7b12ee`. `c273c01a7` states the reason in one
 * line: "every call site read `bundle.findings` and passed both, so the same value travelled
 * twice through four frames."
 *
 * The fix is a signature change, so the rule reports only where this file can make it: the
 * callee is a function declared here, and every call to it in this file passes the same dotted
 * part beside the same whole. Both halves were measured on 2026-09-20, over 24 sites.
 *
 * Without the first, the rule asked for a signature it cannot reach. Six sites were platform
 * calls whose shape is the interface: `readSync(handle, chunk, 0, chunk.length, position)` names
 * how much of the buffer to fill, and `chunk.length` is allowed to be more than that. Telling
 * a reader to drop an argument Node requires is a finding that cannot be closed.
 *
 * Without the second, it asked for a parameter that carries different information at another
 * call. `bundle-validation.ts` calls `record(node.moduleSpecifier, "import", node)` and
 * `record(node.moduleReference.expression, "import = require", node)` — the same whole, two
 * different parts, and the callee can derive neither. One consistent suffix across every call
 * is what makes the parameter derivable, and a single call site is consistent with itself.
 *
 * A narrowing the caller already made also crosses the call as a part.
 * `fakeModel(message, message.fakeResponses)` sits in the arm where `message.fakeResponses` is
 * not `undefined`, and `check(declarator, declarator.id.name, init)` under a guard that settled
 * `declarator.id.type`. Both survive the two structural filters, so a part the enclosing
 * function tests — at that path or above it — is left alone as well.
 *
 * A computed member keeps its argument, because `rows[index]` is not a fixed part of `rows`;
 * the callee would have to be told the index as well, and then the same information is not
 * travelling twice. A call with one argument is skipped before anything else, which is most
 * calls in the tree and keeps the cost of this rule near nothing.
 *
 * ## The fix, and the shape it is confined to
 *
 * The edit is three parts that have to land together: the parameter goes, every call drops the
 * argument, and the body's reads of that parameter become the dotted path. The rule used to
 * refuse all three, and named the one it could reach — "the module-private callee whose body
 * reads the parameter in one place" — as the shape to build first. That is what this is.
 *
 * What makes it safe is that the third part is decided by scope analysis rather than by text. The
 * parameter's reads are its resolved references, so a shadow inside the body is a different
 * variable whose reads are not among them; and at each of those reads the whole's name is resolved
 * again and has to come back as the same parameter, so a nested binding that reuses the name
 * withdraws the fix instead of silently changing what the body reads.
 *
 * Six conditions withdraw it, and each one is a thing the edit would otherwise decide:
 *
 * - **An exported callee** has callers this file cannot see, and a name used as anything other
 *   than the callee of a call — passed as a callback, stored, re-exported — has the same problem
 *   one scope down. Arity is part of what a caller relies on.
 * - **A parameter that is not a plain name** — destructured, defaulted, a rest — is not one
 *   position to remove, and a call whose arity differs from the declaration, or that spreads,
 *   does not line up with the parameter list position by position.
 * - **A written parameter** would need the write to become an assignment through the caller's
 *   object, which changes what the caller holds rather than what this frame reads.
 * - **A read in shorthand position** — `{ findings }` — cannot take a dotted path, and the
 *   repair there is to write the key out, which is an edit about the object rather than this one.
 * - **A narrowed call anywhere in the file** withdraws the fix even though only that call
 *   withdraws the report: the parameter carries a type the callee cannot re-derive, and the
 *   remaining calls cannot be changed without changing the signature for that one too.
 * - **A callee whose body does anything before the read** — a call, an assignment, an `await` —
 *   and **an argument after the dropped one holding a call**. Both are the same defect from two
 *   sides, and `entrySettled` states it.
 *
 * TypeScript owns the remainder. If the callee is reached in a way none of this saw, the arity is
 * wrong at a call and the compiler says so at the line; the failure this fixer cannot have is the
 * quiet one, and scope analysis is what rules it out.
 */

/** One argument as text, and whether it is a bare name rather than a dotted path into one. */
interface Argument {
  text: string;
  bare: boolean;
}

/** One recorded call to a locally declared function. */
interface Call {
  node: ESTree.CallExpression;
  args: (Argument | null)[];
}

/** The two node shapes this file declares a function as, whose signature a fix here can change. */
type Callee = ESTree.Function | ESTree.ArrowFunctionExpression;

/** A function this file declares, and whether anything outside this file's calls can reach it. */
interface Declared {
  fn: Callee;
  exported: boolean;
}

/** One derivable position: the callee, its calls, which argument, and the suffix it re-reads. */
interface Position {
  name: string;
  list: readonly Call[];
  part: number;
  whole: number;
  root: string;
  suffix: string;
}

/** The parameters as plain names, or null where one is destructured, defaulted or a rest. */
function plainParams(fn: ESTree.Node): ESTree.BindingIdentifier[] | null {
  if (!("params" in fn) || !Array.isArray(fn.params)) return null;
  const params: ESTree.BindingIdentifier[] = [];
  for (const param of fn.params) {
    if (param.type !== "Identifier") return null;
    params.push(param);
  }
  return params;
}

/** One item of a comma-separated list removed, taking the comma that joined it to its neighbour. */
function dropItem(
  fixer: Fixer,
  items: readonly ESTree.Span[],
  index: number,
  comments: readonly ESTree.Span[],
): Fix | null {
  const target = items[index];
  if (target === undefined) return null;
  const before = items[index - 1];
  const after = items[index + 1];
  const from = before?.end ?? target.start;
  const to = before === undefined ? (after?.start ?? target.end) : target.end;
  // The span reaches to a neighbour to take the comma, so it also reaches over a line written
  // between the two. The argument that line explains is the one going away, so there is nowhere
  // to carry it: `carriedFix` refuses the whole rewrite rather than delete the sentence.
  if (holdsProse(comments, from, to)) return null;
  return fixer.replaceTextRange([from, to], "");
}

/**
 * Whether nothing between the callee's entry and its body's reads can change what the whole holds.
 *
 * The argument is evaluated at the call; the rewritten read happens wherever the body reads it.
 * The fix moves the read from the first moment to the second, and everything the callee does in
 * between now runs first. `reset(state, state.count)` whose body writes `state.count = 0` before
 * returning `count` returns the count the caller had today and zero afterwards — the same
 * program, a different answer, at no line a compiler will look at.
 *
 * Blunt in the same direction as `shared/predicate-effect.ts`: a call, an assignment or an
 * `await` anywhere in the text withdraws the fix. A call is the one thing in an expression whose
 * effects are not in the expression, so no list of safe callees can be written here. It costs
 * the fix on a body that merely declares a local, and the report — which is the part of this
 * rule that pays — stands either way.
 */
function entrySettled(text: string): boolean {
  return !calls(text) && !writes(text) && !/\b(?:await|yield)\b/u.test(text);
}

/**
 * Whether the rewritten read evaluates the path once, before any other property read in the body.
 *
 * The argument evaluated `owner.value` once, at the call. The rewrite evaluates it at every read,
 * and a property can be a getter: `twice(state, state.value)` whose body returns `value + value`
 * returned 2 from a counting getter and 3 once rewritten. The rule cannot see a getter, so it keeps
 * what it can check: one read, and no property access ahead of it in the body that a getter's
 * effect could be ordered against.
 */
function evaluatedOnceFirst(body: string, start: number, reads: readonly ESTree.Node[]): boolean {
  const [read] = reads;
  return reads.length === 1 && read !== undefined && !body.slice(0, read.start - start).includes(".");
}

/** A read that cannot take a dotted path in its place, because the shorthand is the key as well. */
function inShorthand(identifier: ESTree.Node): boolean {
  const parent: ESTree.Node | null = identifier.parent;
  return parent?.type === "Property" && parent.shorthand;
}

export const noArgumentAlreadyCarriedRule = defineRule({
  meta: {
    type: "suggestion",
    fixable: "code",
    docs: { description: "An argument the callee already holds inside another argument travels twice." },
    messages: {
      carried:
        "`{{part}}` is a part of `{{whole}}`, which this call already passes. The callee can read it; passing both sends the same value through the frame twice and lets the two disagree.",
    },
  },
  createOnce(context) {
    /** Functions declared in this file, whose signature a fix here can change. */
    const declared = new Map<string, Declared>();
    /** Every call to a plain name, by that name, so one callee's sites are read together. */
    const madeCalls = new Map<string, Call[]>();
    /** Names this file mentions somewhere other than as the callee of a call. */
    const escaped = new Set<string>();

    /** The function a call sits in, whose text says what the caller has already tested. */
    function owner(node: ESTree.Node): ESTree.Node | null {
      for (let at = node.parent; at !== null; at = at.parent) {
        if (
          at.type === "FunctionDeclaration" ||
          at.type === "FunctionExpression" ||
          at.type === "ArrowFunctionExpression"
        ) {
          return at;
        }
      }
      return null;
    }

    /** Whether every call to this callee passes `args[part]` as `args[whole]` plus one suffix. */
    function derivable(list: readonly Call[], part: number, whole: number, suffix: string): boolean {
      return list.every((call) => {
        const held = call.args[whole];
        const carried = call.args[part];
        return held?.bare === true && carried?.text === held.text + suffix;
      });
    }

    /** Whether the caller has already tested the path this argument spells. */
    function narrowed(call: Call, part: number): boolean {
      const argument = call.node.arguments[part];
      const text = call.args[part]?.text;
      if (argument === undefined || text === undefined) return true;
      return narrowedIn(context.sourceCode.getText(owner(argument) ?? argument), text);
    }

    /** Whether this name, read here, is the same binding as the parameter that declares it. */
    function resolvesTo(at: ESTree.Node, name: string, expected: Variable): boolean {
      let scope: Scope | null = context.sourceCode.getScope(at);
      while (scope !== null) {
        const found = scope.set.get(name);
        if (found !== undefined) return found === expected;
        scope = scope.upper;
      }
      return false;
    }

    /** The body reads to rewrite, or null where one of them decides something the fix cannot. */
    function readsToRewrite(fn: ESTree.Node, part: string, whole: string): ESTree.Node[] | null {
      const variables = context.sourceCode.getDeclaredVariables(fn);
      const carried = variables.find((variable) => variable.name === part);
      const held = variables.find((variable) => variable.name === whole);
      if (carried === undefined || held === undefined) return null;
      if (carried.references.some((reference) => reference.isWrite())) return null;
      const reads = carried.references
        .filter((reference) => reference.isRead())
        .map((reference) => reference.identifier);
      if (reads.some(inShorthand)) return null;
      return reads.every((read) => resolvesTo(read, whole, held)) ? reads : null;
    }

    /** Whether every call lines up with the declaration position by position, and none is narrowed. */
    function uniform(at: Position, params: readonly ESTree.BindingIdentifier[]): boolean {
      return at.list.every(
        (call) =>
          call.node.arguments.length === params.length &&
          !call.node.arguments.some((argument) => argument.type === "SpreadElement") &&
          !narrowed(call, at.part) &&
          // The dropped argument is evaluated where it stands, before everything written to its
          // right. `render(view, view.rows, refresh(view))` reads `view.rows` and then refreshes;
          // dropping the argument reads it inside the callee, after. Only what follows the
          // dropped position moves relative to it, so only that suffix is read here.
          call.node.arguments
            .slice(at.part + 1)
            .every((argument) => entrySettled(context.sourceCode.getText(argument))),
      );
    }

    /** Every edit that drops one carried argument from this callee, or null where one withdraws it. */
    function carriedFix(fixer: Fixer, at: Position): Fix[] | null {
      const site = declared.get(at.name);
      if (site === undefined || site.exported || escaped.has(at.name)) return null;
      const params = plainParams(site.fn);
      const dropped = params?.[at.part];
      const held = params?.[at.whole];
      if (params === null || dropped === undefined || held === undefined) return null;
      if (!uniform(at, params)) return null;
      const { body } = site.fn;
      if (body === null || !entrySettled(context.sourceCode.getText(body))) return null;
      const reads = readsToRewrite(site.fn, dropped.name, held.name);
      if (reads === null || !evaluatedOnceFirst(context.sourceCode.getText(body), body.start, reads)) {
        return null;
      }
      const comments = context.sourceCode.getAllComments();
      const edits: (Fix | null)[] = [
        dropItem(fixer, params, at.part, comments),
        ...at.list.map((call) => dropItem(fixer, call.node.arguments, at.part, comments)),
        ...reads.map((read) => fixer.replaceText(read, held.name + at.suffix)),
      ];
      return edits.some((edit) => edit === null) ? null : edits.filter((edit) => edit !== null);
    }

    /** One call's carried argument, unless the caller has already tested that path. */
    function reportOne(call: Call, at: Position): void {
      const argument = call.node.arguments[at.part];
      const text = call.args[at.part]?.text;
      if (argument === undefined || text === undefined || narrowed(call, at.part)) return;
      context.report({
        node: argument,
        messageId: "carried",
        data: { part: text, whole: call.args[at.whole]?.text ?? at.root },
        fix: (fixer) => carriedFix(fixer, at),
      });
    }

    /** Every argument position this callee could drop, read over all of its calls at once. */
    function reportCarried(name: string, list: readonly Call[]): void {
      const settled = new Set<number>();
      for (const seed of list) {
        for (const [part, carried] of seed.args.entries()) {
          if (carried === null || carried.bare || settled.has(part)) continue;
          const root = carried.text.slice(0, carried.text.indexOf("."));
          const suffix = carried.text.slice(root.length);
          const whole = seed.args.findIndex((held) => held?.bare === true && held.text === root);
          if (whole < 0 || !derivable(list, part, whole, suffix)) continue;
          settled.add(part);
          for (const call of list) reportOne(call, { name, list, part, whole, root, suffix });
        }
      }
    }

    return {
      before: () => {
        declared.clear();
        madeCalls.clear();
        escaped.clear();
        return true;
      },

      FunctionDeclaration: (node) => {
        if (node.id !== null) {
          declared.set(node.id.name, { fn: node, exported: node.parent.type !== "Program" });
        }
      },
      VariableDeclarator: (node) => {
        const init = node.init;
        if (node.id.type !== "Identifier" || init === null) return;
        if (init.type !== "ArrowFunctionExpression" && init.type !== "FunctionExpression") return;
        declared.set(node.id.name, { fn: init, exported: node.parent.parent?.type !== "Program" });
      },

      Identifier: (node) => {
        const { parent } = node;
        if (parent.type === "CallExpression" && parent.callee === node) return;
        if (parent.type === "FunctionDeclaration" && parent.id === node) return;
        if (parent.type === "VariableDeclarator" && parent.id === node) return;
        if (parent.type === "MemberExpression" && parent.property === node && !parent.computed) return;
        if (parent.type === "Property" && parent.key === node && parent.value !== node) return;
        escaped.add(node.name);
      },

      CallExpression: (node) => {
        if (node.callee.type !== "Identifier") return;
        // A call too short to carry the pair is never reported, so the fix would not see it: an
        // optional parameter it leaves unset would be read off the whole instead. It escapes.
        if (node.arguments.length < 2) {
          escaped.add(node.callee.name);
          return;
        }
        const args = node.arguments.map((argument) => {
          if (argument.type === "Identifier") return { text: argument.name, bare: true };
          if (argument.type !== "MemberExpression" || argument.computed) return null;
          return { text: context.sourceCode.getText(argument), bare: false };
        });
        const list = madeCalls.get(node.callee.name) ?? [];
        list.push({ node, args });
        madeCalls.set(node.callee.name, list);
      },

      "Program:exit": () => {
        for (const [name, list] of madeCalls) {
          if (declared.has(name)) reportCarried(name, list);
        }
      },
    };
  },
});
