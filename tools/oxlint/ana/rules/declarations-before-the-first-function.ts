import { defineRule, type ESTree, type Scope, type SourceCode } from "@oxlint/plugins";

/**
 * Every type, interface and module constant at the front of the file, then the code.
 *
 * What the tree does instead is alternate: a function, the interface it returns, another function,
 * the union that interface joins. `src/solve/built-starter.ts` had 23 declarations after its first
 * function and `src/builder/command-guard.ts` 18. A reader looking for the shape of
 * `GeneratedToolStart` has to read the whole file to learn whether it is there at all, and a reader
 * looking for the constant a default came from has the same problem.
 *
 * A `type` and an `interface` move unconditionally: both are erased, so their position is a reading
 * decision and nothing else. A `const` has an initialisation order to break, so it moves only when
 * hoisting it to the front cannot be observed. Two things make that observable and the rule tests
 * for both:
 *
 *  - an **effect** in the initialiser — a call, `new`, `await`, a tagged template, an assignment or
 *    an update — unless it is one of the pure builders below, which have no result but their value;
 *  - a **read of a name whose value depends on where the read happens**. A name is safe when
 *    nothing can change it between the front of the file and here: an import, a function
 *    declaration (hoisted, so it exists before any statement runs), a built-in namespace, and any
 *    `const`, `class` or `enum` the file already declares above the first line of code. A module
 *    `let`, a `var`, and a `const` still sitting below the code are not safe, because a statement
 *    in between can assign to the first two and the last two have not been initialised yet.
 *
 * So `const cwd = process.cwd()` fails on the call and `const flag = process.env.CI` on the
 * global read. `const SIZE = LATER.one` fails on a third test: `const` fixes the binding and not
 * what it holds, so a part of a name this file declares can be written to by a statement in
 * between, and the read is barred whether or not `LATER` has moved yet. `let`, `var` and a
 * `const` holding a function are left alone.
 *
 * Two more refusals came out of reading what the rule caught once the read test was widened.
 * A **narrowed** read is position-dependent in the type system rather than at runtime: after
 * `if (runner === undefined) throw …`, `const bun: string = runner` compiles only below the guard,
 * so a read of a name some test above it narrows is barred exactly like an unsafe one. And a
 * const wedged into a run of module `let`s is part of a block of state, not a constant a reader
 * goes looking for at the front; `src/backends/pi-built-child.ts` had three of them among six
 * `let`s, and hoisting those three alone left the block worse than it was found.
 *
 * The fixer is the reason the rule is worth having: this is a reordering pass, not a set of
 * judgements. The comment is the part a hand edit gets wrong — a JSDoc block left behind above the
 * next function now documents the wrong thing, and nothing fails.
 */

/** An initialiser that makes a binding a function rather than a value. */
const FUNCTION_VALUE = new Set(["ArrowFunctionExpression", "FunctionExpression", "ClassExpression"]);

/** Erased at compile time, so its position is a reading decision and nothing else. */
const ERASED = new Set(["TSTypeAliasDeclaration", "TSInterfaceDeclaration"]);

/** Declares a name without running a statement, so the file's code has not started yet. */
const DECLARES_ONLY = new Set([
  "ImportDeclaration",
  "TSTypeAliasDeclaration",
  "TSInterfaceDeclaration",
  "TSEnumDeclaration",
  "TSModuleDeclaration",
  "TSDeclareFunction",
  "TSImportEqualsDeclaration",
]);

/** A binding no later statement can reassign, so reading it higher up reads the same value. */
const FIXED_KINDS = new Set(["ClassDeclaration", "TSEnumDeclaration"]);

/** Constructors of a constant value. `Date` is not one of them: `new Date()` reads the clock. */
const PURE_CONSTRUCTORS = new Set(["Set", "Map", "WeakSet", "WeakMap", "RegExp", "URL"]);

/** Called on their own, these convert rather than do anything. */
const PURE_CALLEES = new Set(["BigInt", "Boolean", "Number", "String", "Symbol"]);

/** Built-in methods with no result but their value. `Math.random` and `Date.now` are absent. */
const PURE_METHODS = new Map([
  ["Object", new Set(["entries", "freeze", "fromEntries", "keys", "values"])],
  ["Array", new Set(["from", "isArray", "of"])],
  ["Math", new Set(["abs", "ceil", "floor", "log2", "max", "min", "pow", "round", "sign", "sqrt", "trunc"])],
  ["Number", new Set(["isFinite", "isInteger", "parseFloat", "parseInt"])],
  ["JSON", new Set(["parse", "stringify"])],
  ["String", new Set(["raw"])],
  ["Symbol", new Set(["for"])],
]);

/** Namespaces no module statement here can replace, so reading one is the same from anywhere. */
const CONSTANT_GLOBALS = new Set([
  ...PURE_CONSTRUCTORS,
  ...PURE_CALLEES,
  ...PURE_METHODS.keys(),
  "Error",
  "Infinity",
  "NaN",
  "Promise",
  "undefined",
]);

/** One module-level read: the name, where it was read, and whether a part of it was taken or
 *  its contents read through as a whole. */
interface Read {
  name: string;
  at: number;
  member: boolean;
  consumed: boolean;
}

/** The declaration a statement carries, past `export`. */
function declaredBy(statement: ESTree.Node): ESTree.Node {
  const exported =
    statement.type === "ExportNamedDeclaration" || statement.type === "ExportDefaultDeclaration";
  if (!exported) return statement;
  return statement.declaration ?? statement;
}

/**
 * Whether this statement only declares a name, which is the question "has the code started yet".
 *
 * Asked from this side it is exhaustive: an import, a re-export, a type, an enum, a directive and
 * a constant are declarations, and everything else — a function, a class, an `if`, a loop, a
 * `try`, a bare call — is the code. A `const` holding an arrow is a function under another
 * spelling, so it starts the code too, and a computed `const` does not: `const REPO = resolve(…)`
 * is still one of the declarations a reader expects to find at the front.
 */
function declaresOnly(statement: ESTree.Node): boolean {
  if (statement.type === "ExportAllDeclaration") return true;
  if (statement.type === "ExportNamedDeclaration" && statement.declaration == null) return true;
  if (statement.type === "ExpressionStatement") return statement.expression.type === "Literal";
  const inner = declaredBy(statement);
  if (DECLARES_ONLY.has(inner.type)) return true;
  if (inner.type !== "VariableDeclaration") return false;
  return !inner.declarations.some((one) => one.init != null && FUNCTION_VALUE.has(one.init.type));
}

/** A `String(…)`, `Object.freeze({…})` or `Math.max(…)`, which has no result but its value. */
function isPureCall(node: ESTree.CallExpression): boolean {
  const callee = node.callee;
  if (callee.type === "Identifier") return PURE_CALLEES.has(callee.name);
  if (callee.type !== "MemberExpression" || callee.computed) return false;
  if (callee.object.type !== "Identifier" || callee.property.type !== "Identifier") return false;
  return PURE_METHODS.get(callee.object.name)?.has(callee.property.name) === true;
}

/** A `` String.raw`…` ``, which is a string literal with a different escape rule. */
function isPureTag(tag: ESTree.Node): boolean {
  if (tag.type !== "MemberExpression" || tag.computed) return false;
  if (tag.object.type !== "Identifier" || tag.object.name !== "String") return false;
  return tag.property.type === "Identifier" && tag.property.name === "raw";
}

/** The plain names a declaration binds. A destructured one binds none of them, conservatively. */
function boundNames(inner: ESTree.Node): string[] {
  if (inner.type === "VariableDeclaration") {
    return inner.declarations.flatMap((one) => (one.id.type === "Identifier" ? [one.id.name] : []));
  }
  const id = "id" in inner ? inner.id : null;
  return id?.type === "Identifier" ? [id.name] : [];
}

/**
 * Every name a hoisted initialiser may read: the ones whose value does not depend on the position
 * of the read. Imports and function declarations qualify wherever they sit — both exist before the
 * first statement runs — and a `const`, `class` or `enum` qualifies once it is above the code.
 */
function readableFromTheFront(body: readonly ESTree.Node[], firstCode: number): Set<string> {
  const names = new Set(CONSTANT_GLOBALS);
  for (const [index, statement] of body.entries()) {
    if (statement.type === "ImportDeclaration") {
      for (const one of statement.specifiers) names.add(one.local.name);
      continue;
    }
    const inner = declaredBy(statement);
    if (inner.type === "FunctionDeclaration" || ERASED.has(inner.type)) {
      for (const name of boundNames(inner)) names.add(name);
      continue;
    }
    if (index >= firstCode) continue;
    const fixed =
      FIXED_KINDS.has(inner.type) || (inner.type === "VariableDeclaration" && inner.kind === "const");
    if (fixed) for (const name of boundNames(inner)) names.add(name);
  }
  return names;
}

/** Every name this file reads at module level, with the offset it was read at. */
function moduleReads(scope: Scope): Read[] {
  const read = (name: string, identifier: ESTree.Node): Read => {
    const parent: ESTree.Node | null = identifier.parent;
    return {
      name,
      at: identifier.start,
      // A part of the name, rather than the name itself: `CONFIG` in `CONFIG.limit`.
      member: parent?.type === "MemberExpression" && parent.object === identifier,
      // Handed whole to a builder or spread, which reads its contents: `VALUES` in
      // `new Set(VALUES)`, `Object.keys(VALUES)` or `[...VALUES]`.
      consumed:
        parent?.type === "SpreadElement" ||
        ((parent?.type === "CallExpression" || parent?.type === "NewExpression") &&
          parent.arguments.some((argument) => argument === identifier)),
    };
  };
  const reads = scope.variables.flatMap((variable) =>
    variable.references.map((reference) => read(variable.name, reference.identifier)),
  );
  for (const reference of scope.through) {
    reads.push(read(reference.identifier.name, reference.identifier));
  }
  return reads;
}

/**
 * Where an initialiser must not read: a name nothing keeps still, or one a test above has narrowed.
 *
 * The second is the type system rather than the runtime, and it is the reason a read of a name
 * this file itself declares is not automatically safe. `const runner = Bun.argv[0]` is a `string |
 * undefined` above the code; `if (runner === undefined) throw …` is the first line of code; and
 * `const bun: string = runner` below it compiles only because of that guard. Hoisting it is a
 * clean runtime move and a type error, so a read inside a guarded name's shadow is barred too.
 *
 * Only a binding this file declares is narrowable. A test mentions plenty of names it cannot
 * narrow — `if (isBoolean(value))` names the imported predicate it calls, and `if (x ===
 * undefined)` names the global — and barring a later read of those refuses a constant for no
 * reason. Two of the first ten refusals were exactly that.
 *
 * The third bar is what `const` does not promise. The binding cannot be reassigned; what it holds
 * can be written to all day. `const CONFIG = { limit: 1 }` above the code, `CONFIG.limit =
 * measured()` in the code, and `export const SIZE = CONFIG.limit` below it reads the measured
 * value today and `1` once it is hoisted above the write — the same program, a different number,
 * and nothing to compile against. So a read that takes a *part* of a name this file declares is
 * barred, while the name itself still reads safely. `Object.freeze({…})`, `Math.max(…)` and a
 * part of an imported namespace are untouched, because none of those is a binding this file owns.
 *
 * A pure builder does the same read without a member expression. `VALUES.add(2)` in the code and
 * `export const SNAPSHOT = new Set(VALUES)` below it copies two values today and one once hoisted:
 * the builder has no effect, but its result depends on when it reads what it was given. So a name
 * this file owns handed whole to a call, a constructor or a spread is barred like a part of it.
 */
function barredReadPositions(
  reads: readonly Read[],
  guards: readonly { start: number; end: number }[],
  safe: ReadonlySet<string>,
  owned: ReadonlySet<string>,
): number[] {
  const narrowed = reads.flatMap((read) => {
    if (!owned.has(read.name)) return [];
    const guard = guards.find((one) => read.at >= one.start && read.at < one.end);
    return guard === undefined ? [] : [{ name: read.name, from: guard.start }];
  });
  return reads.flatMap((read) => {
    const barred =
      !safe.has(read.name) ||
      ((read.member || read.consumed) && owned.has(read.name)) ||
      narrowed.some((one) => one.name === read.name && one.from < read.at);
    return barred ? [read.at] : [];
  });
}

/**
 * Whether this declaration stands directly beside module mutable state, which it is part of.
 *
 * `src/backends/pi-built-child.ts` keeps six `let`s and four collections in one block under its
 * bootstrap call, and the rule never moves a `let`. Hoisting the collections out of the middle of
 * that block leaves it worse than it was found, so a `const` whose neighbour is a module `let` or
 * `var` stays where it is. A blank line between them says the author meant two blocks, and a
 * comment between them does not: two of those six `let`s are documented in place.
 */
function besideMutableState(text: string, body: readonly ESTree.Node[], index: number): boolean {
  const here = body[index];
  if (here === undefined) return false;
  return [-1, 1].some((step) => {
    const next = body[index + step];
    if (next === undefined) return false;
    const gap = step === -1 ? text.slice(next.end, here.start) : text.slice(here.end, next.start);
    if (/\n[^\S\n]*\n/u.test(gap)) return false;
    const inner = declaredBy(next);
    return inner.type === "VariableDeclaration" && inner.kind !== "const";
  });
}

/** A `const` of plain data that evaluates to the same value wherever the file puts it. */
function isMovableConstant(
  inner: ESTree.Node,
  effects: readonly number[],
  reads: readonly number[],
): boolean {
  if (inner.type !== "VariableDeclaration" || inner.kind !== "const" || inner.declare === true) {
    return false;
  }
  return inner.declarations.every((one) => {
    const init = one.init;
    if (init == null || FUNCTION_VALUE.has(init.type)) return false;
    const inside = (at: number): boolean => at >= init.start && at < init.end;
    return !effects.some(inside) && !reads.some(inside);
  });
}

/** The offset the declaration starts at once its own comment block is counted in. */
function withLeadingComments(
  source: SourceCode,
  statement: ESTree.Node,
  previous: ESTree.Node | undefined,
): number {
  const text = source.text;
  const floor = previous?.end ?? 0;
  let start = statement.start;
  for (const comment of source.getCommentsBefore(statement).toReversed()) {
    // Below the previous statement's end, or with anything but whitespace between it and what
    // follows, and it is a comment about something else that happens to sit above this one.
    if (comment.start < floor || /\S/u.test(text.slice(comment.end, start))) break;
    // `getCommentsBefore` also answers with the comment that *trails* the line above, and that one
    // belongs to the declaration it sits beside: moving the next declaration must not carry away
    // the reason written next to the previous one.
    if (previous !== undefined && !text.slice(floor, comment.start).includes("\n")) break;
    start = comment.start;
  }
  return start;
}

/**
 * The end of the declaration's own line, plus the blank lines under it.
 *
 * The move carries the author's vertical spacing rather than dropping it at the old site. The
 * first sweep did not, and the arithmetic says what that costs: it came out 660 lines shorter than
 * it went in, and left the front of a file as one wall of declarations with an interface body
 * abutting the constant above it. A blank line under a declaration is part of how it reads.
 */
function throughBlankLines(text: string, end: number): number {
  const first = text.indexOf("\n", end);
  if (first === -1) return end;
  // A second statement written on the same line is not part of this one, and the move would
  // carry it to the front without ever deciding it could go. A trailing comment may follow.
  if (/\S/u.test(text.slice(end, first).replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//gu, ""))) return end;
  let at = first + 1;
  for (let next = text.indexOf("\n", at); next !== -1; next = text.indexOf("\n", at)) {
    if (/\S/u.test(text.slice(at, next))) break;
    at = next + 1;
  }
  return at;
}

/** The first offset a statement may occupy: below the hashbang, which has to stay on line one. */
function belowTheHashbang(text: string): number {
  if (!text.startsWith("#!")) return 0;
  const line = text.indexOf("\n");
  return line === -1 ? text.length : line + 1;
}

/** The name a reader would look the declaration up by, and the node to underline. */
function named(inner: ESTree.Node): { node: ESTree.Node; name: string } {
  if (inner.type === "VariableDeclaration") {
    const [first] = inner.declarations;
    const id = first?.id;
    return id?.type === "Identifier" ? { node: id, name: id.name } : { node: inner, name: "the constant" };
  }
  const id = "id" in inner ? inner.id : null;
  return id?.type === "Identifier" ? { node: id, name: id.name } : { node: inner, name: "the declaration" };
}

export const declarationsBeforeTheFirstFunctionRule = defineRule({
  meta: {
    type: "suggestion",
    fixable: "code",
    docs: {
      description: "Declare every type, interface and module constant before the first function.",
    },
    messages: {
      erasedAfterCode:
        "`{{name}}` is declared after this file's first line of code, so a reader looking for the shape has to scan past the code to find out whether it is there. Types and interfaces go at the front.",
      constantAfterCode:
        "`{{name}}` is a module constant declared after this file's first line of code. It reads nothing that can change, so it has the same value wherever it sits and belongs at the front with the other declarations.",
    },
  },
  createOnce(context) {
    /** Where every call, `new`, `await` and assignment that is not a pure builder starts. */
    const effects: number[] = [];
    /** The spans a read inside of is a read the surrounding test may have narrowed. */
    const guards: Array<{ start: number; end: number }> = [];
    const guard = (test: ESTree.Node): number => guards.push({ start: test.start, end: test.end });

    return {
      IfStatement: (node) => guard(node.test),
      WhileStatement: (node) => guard(node.test),
      ConditionalExpression: (node) => guard(node.test),
      SwitchStatement: (node) => guard(node.discriminant),
      CallExpression: (node) => {
        if (!isPureCall(node)) effects.push(node.start);
      },
      NewExpression: (node) => {
        // A `new Set([…])` or `new URL(…)` carries no effect; every other construction does.
        const pure = node.callee.type === "Identifier" && PURE_CONSTRUCTORS.has(node.callee.name);
        if (!pure) effects.push(node.start);
      },
      TaggedTemplateExpression: (node) => {
        if (!isPureTag(node.tag)) effects.push(node.start);
      },
      AwaitExpression: (node) => effects.push(node.start),
      AssignmentExpression: (node) => effects.push(node.start),
      UpdateExpression: (node) => effects.push(node.start),

      // Everything gathered on the way down belongs to one file. `Program:exit` has several
      // return paths and one rule instance sees every file, so the reset goes at the door.
      before: () => {
        effects.length = 0;
        guards.length = 0;
        return true;
      },

      // Everything above is gathered on the way down, so the decision waits for the whole file.
      "Program:exit": (program) => {
        const body = program.body;
        const firstCode = body.findIndex((statement) => !declaresOnly(statement));
        const opening = body[firstCode];
        if (opening === undefined) return;

        const outer = context.sourceCode.getScope(program);
        const module = outer.childScopes.find((scope) => scope.type === "module") ?? outer;
        const safe = readableFromTheFront(body, firstCode);
        // Every value binding this file owns: narrowable by a test above the read, and writable
        // through a part of it wherever it sits. A name declared below the code is unsafe for
        // other reasons already; keeping one set rather than two costs nothing and says one thing.
        const owned = new Set(
          body.flatMap((statement) => {
            const inner = declaredBy(statement);
            const value = inner.type === "VariableDeclaration" || FIXED_KINDS.has(inner.type);
            return value ? boundNames(inner) : [];
          }),
        );
        const reads = barredReadPositions(moduleReads(module), guards, safe, owned);
        const text = context.sourceCode.text;
        const anchor = Math.max(
          belowTheHashbang(text),
          withLeadingComments(context.sourceCode, opening, body[firstCode - 1]),
        );
        for (const [index, statement] of body.entries()) {
          if (index <= firstCode) continue;
          const inner = declaredBy(statement);
          const erased = ERASED.has(inner.type);
          if (!erased && !isMovableConstant(inner, effects, reads)) continue;
          if (!erased && besideMutableState(text, body, index)) continue;

          const from = withLeadingComments(context.sourceCode, statement, body[index - 1]);
          const to = throughBlankLines(text, statement.end);
          const subject = named(inner);
          context.report({
            node: subject.node,
            messageId: erased ? "erasedAfterCode" : "constantAfterCode",
            data: { name: subject.name },
            // One range, not a remove plus an insert: a single replacement cannot half-apply and
            // needs no assumption about the order the host applies a fix array in. Two of these
            // overlap, so oxlint lands one per pass and the sweep runs to convergence.
            fix: (fixer) =>
              fixer.replaceTextRange([anchor, to], text.slice(from, to) + text.slice(anchor, from)),
          });
        }
      },
    };
  },
});
