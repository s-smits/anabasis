/**
 * `repeated-external-read` (generic): one call path makes the same external read twice. A command
 * that asks the process table, a file or a URL in two places holds two answers to one question,
 * taken at two moments; a process that starts or ends between them, or a file rewritten between
 * them, makes the two halves of the command disagree about which state the world is in. Read once,
 * at the join, and pass the answer on.
 *
 * An external read is a platform form: a spawn (`spawnSync`, `execSync`, `execFileSync`, `spawn`,
 * `execFile`, `execa`, `Bun.spawn`, `Bun.spawnSync`, `child_process.exec`, or a `$` template), a
 * file read (`readFileSync`, `readFile`, `readJson`, `readdirSync`, `Bun.file(p).text()` and its
 * kin), or a `fetch`. It is keyed by what it reads: the program and its literal arguments, the
 * path, the URL. A part spelled by a literal, a module constant or an import keys; a part a caller
 * passes is substituted at each call, so a local wrapper (`ps(args)` around `spawnSync("ps",
 * args)`) reads what its caller asks; any other part makes the read unkeyed and it is not counted.
 *
 * The call graph is syntactic: top-level functions and `const` functions of each file, reached by
 * their name in the file or through a named or namespace import. A call to a function counts each
 * read it makes once, so a function reports only the repetition its own body makes: two calls, two
 * reads, or one inside a `for` loop or an iteration callback (`map`, `forEach`, `filter` and kin),
 * which runs once per item. The two arms of an `if`, a ternary or a `switch`, and the code after an
 * `if` whose arm returns or throws, are alternatives, so they combine by the larger count. A read
 * inside `while` or `do` is polling, which wants a fresh answer each time, and one inside any other
 * function (a callback, a handler) runs later; neither is counted. A statement that moves what is
 * read splits a run of statements into two moments, whose reads of what it moved combine by the
 * larger count: an awaited wait (`sleep`, `delay`, a `setTimeout` promise, or a call to a function
 * that waits) moves everything, a signal to a process (`kill`, any signal but 0) moves the process
 * table (`ps`, `pgrep`, `lsof`), and a write or removal moves the path it names. A re-read after
 * one of these asks a later question on purpose. Tests are not read.
 */
import * as ts from "typescript5";
import type { TreeFinding } from "./tree-findings.ts";
import { resolved } from "./tree-overwritten-key.ts";

type Callable = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;

/** What one file declares at its top level and binds by import. */
interface Module {
  path: string;
  file: ts.SourceFile;
  functions: ReadonlyMap<string, Callable>;
  constants: ReadonlyMap<string, ts.Expression>;
  imports: ReadonlyMap<string, { home: string; name: string }>;
  spawnModules: ReadonlySet<string>;
  /** Top-level `let` and `var` bindings, and `const` collections: where a cache keeps an answer. */
  mutables: ReadonlySet<string>;
}

/** How often each keyed read happens on the worst path, and the lines that make it. */
type Tally = Map<string, { count: number; lines: number[] }>;

/** What a statement changes that a later read would see: time, the process table, files. */
interface Moves {
  waits: boolean;
  signals: boolean;
  paths: Set<string>;
}

/** The whole tree's call graph, the calls under way, and what each call already read. */
interface Graph {
  modules: ReadonlyMap<string, Module>;
  open: Set<Callable>;
  /** Per function, per binding of its parameters, the keys one call reads. */
  memo: Map<Callable, Map<string, readonly string[]>>;
  /** Per function, whether a call to it lets time pass or signals a process (`movesOf`). */
  moving: Map<Callable, Moves>;
}

/** One evaluation's view: the module it reads in and what each local name is bound to. */
interface Scope {
  module: Module;
  /** Each parameter and local, spelled where it can be. */
  bound: Map<string, string | null>;
  /** Each local's initialiser, for a spawn handed an options object built a line above. */
  locals: Map<string, ts.Expression>;
  /** Inside a loop or an iteration callback, the names that differ from one item to the next. */
  items: Set<string> | null;
  depth: number;
  graph: Graph;
}

const TEST_PATH = /(?:^|\/)(?:test|tests|__tests__|__mocks__|fixtures?)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/u;
const SPAWNS = new Set(["spawnSync", "execSync", "execFileSync", "spawn", "execFile", "execa", "execaSync"]);
const FILE_READS = new Set([
  "readFileSync",
  "readFile",
  "readJson",
  "readJsonSync",
  "readJSON",
  "readJSONSync",
]);
const LISTS = new Set(["readdirSync", "readdir"]);
const BODY_READS = new Set(["text", "json", "bytes", "arrayBuffer"]);
const PATH_JOINS = new Set(["join", "resolve"]);
const SPAWN_MODULE = /^(?:node:)?child_process$/u;
const SHELL_TAG = /^(?:Bun\.)?\$$/u;
const COLLECTION = /^new (?:Map|Set|WeakMap)\b/u;
const KEEPS = new Set(["set", "add", "push"]);
const ITERATIONS = new Set([
  "map",
  "flatMap",
  "forEach",
  "filter",
  "some",
  "every",
  "find",
  "findIndex",
  "findLast",
  "reduce",
  "toSorted",
  "sort",
]);
const DEPTH = 12;
/** Calls that let time pass when awaited. */
const WAITS = new Set(["sleep", "delay", "setTimeout", "wait"]);
/** Calls that write or remove the path they are first handed. */
const WRITES = new Set([
  "writeFileSync",
  "writeFile",
  "appendFileSync",
  "appendFile",
  "rmSync",
  "rm",
  "unlinkSync",
  "unlink",
  "renameSync",
  "rename",
]);
/** The keys of a process-table read, which a signal to a process changes. */
const PROCESS_TABLE = /^run (?:ps|pgrep|lsof)\b/u;
/** A word of an argv that is not spelled, kept in place so the words around it keep their order. */
const UNKNOWN = "‹?›";
/** Marks a read whose arguments change with each item of a loop, which the loop does not repeat. */
const PER_ITEM = " (one item's)";

function isCallable(node: ts.Node | undefined): node is Callable {
  return (
    node !== undefined &&
    (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node))
  );
}

function moduleOf(path: string, file: ts.SourceFile, paths: ReadonlySet<string>): Module {
  const functions = new Map<string, Callable>();
  const constants = new Map<string, ts.Expression>();
  const imports = new Map<string, { home: string; name: string }>();
  const spawnModules = new Set<string>();
  const mutables = new Set<string>();
  for (const statement of file.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
      functions.set(statement.name.text, statement);
    }
    const constant =
      ts.isVariableStatement(statement) && (statement.declarationList.flags & ts.NodeFlags.Const) !== 0;
    for (const one of ts.isVariableStatement(statement) ? statement.declarationList.declarations : []) {
      if (!ts.isIdentifier(one.name)) {
        continue;
      }
      const { initializer } = one;
      if (!constant || (initializer !== undefined && COLLECTION.test(initializer.getText(file)))) {
        mutables.add(one.name.text);
      }
      if (initializer !== undefined && isCallable(initializer)) {
        functions.set(one.name.text, initializer);
      } else if (initializer !== undefined) {
        constants.set(one.name.text, initializer);
      }
    }
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const specifier = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    const bindings = clause?.namedBindings;
    if (SPAWN_MODULE.test(specifier)) {
      if (clause?.name !== undefined) {
        spawnModules.add(clause.name.text);
      }
      if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
        spawnModules.add(bindings.name.text);
      }
    }
    const home = resolved(path, specifier, paths);
    if (home === undefined || bindings === undefined) {
      continue;
    }
    if (ts.isNamespaceImport(bindings)) {
      imports.set(bindings.name.text, { home, name: "*" });
    } else {
      for (const element of bindings.elements) {
        imports.set(element.name.text, { home, name: (element.propertyName ?? element.name).text });
      }
    }
  }
  return { path, file, functions, constants, imports, spawnModules, mutables };
}

/** The text an expression always spells in this scope, or null where it depends on something else. */
function spelled(node: ts.Expression, scope: Scope): string | null {
  if (ts.isStringLiteralLike(node)) {
    return node.text;
  }
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) {
    return spelled(node.expression, scope);
  }
  if (ts.isTemplateExpression(node)) {
    const parts = node.templateSpans.map((span) => [spelled(span.expression, scope), span.literal.text]);
    return parts.flat().includes(null) ? null : node.head.text + parts.flat().join("");
  }
  if (ts.isIdentifier(node)) {
    if (scope.bound.has(node.text)) {
      return scope.bound.get(node.text) ?? null;
    }
    const constant = scope.module.constants.get(node.text);
    if (constant !== undefined) {
      return ts.isStringLiteralLike(constant) ? constant.text : `‹${node.text}›`;
    }
    return scope.module.imports.has(node.text) ? `‹${node.text}›` : null;
  }
  if (ts.isArrayLiteralExpression(node)) {
    const parts = node.elements.map(
      (one) => spelled(ts.isSpreadElement(one) ? one.expression : one, scope) ?? UNKNOWN,
    );
    return parts.join(" ");
  }
  if (ts.isPropertyAccessExpression(node)) {
    const base = spelled(node.expression, scope);
    return base === null ? null : `${base}.${node.name.text}`;
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const [left, right] = [spelled(node.left, scope), spelled(node.right, scope)];
    return left === null || right === null ? null : left + right;
  }
  if (!ts.isCallExpression(node) || !PATH_JOINS.has(nameOf(node) ?? "")) {
    return null;
  }
  const parts = node.arguments.map((one) => spelled(one, scope));
  return parts.includes(null) ? null : parts.join("/");
}

/** The name a call is made by: `f` for `f()` and `a.f()`. */
function nameOf(call: ts.CallExpression): string | null {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) {
    return callee.text;
  }
  return ts.isPropertyAccessExpression(callee) ? callee.name.text : null;
}

/**
 * What a spawn reads, from its argv: the program, its subcommand and arguments, and its long flags.
 * A short flag and the word after it are dropped, so `ps -axo pid=,args=` and `ps -o pid=` both
 * read the process table, while `git rev-parse --show-toplevel` and `git rev-parse HEAD` differ. A
 * word that is not spelled where it is kept leaves the read without a key.
 */
function argvOf(call: ts.CallExpression, scope: Scope): string | null {
  const local = (node: ts.Expression | undefined): ts.Expression | undefined =>
    node !== undefined && ts.isIdentifier(node) ? (scope.locals.get(node.text) ?? node) : node;
  const [first, second] = call.arguments.map(local);
  let argv: string | null = null;
  if (first !== undefined && ts.isObjectLiteralExpression(first)) {
    const cmd = first.properties.find((one) => ts.isPropertyAssignment(one) && one.name.getText() === "cmd");
    argv = cmd !== undefined && ts.isPropertyAssignment(cmd) ? spelled(cmd.initializer, scope) : null;
  } else if (first !== undefined) {
    // After a program, the second argument is its argument list, which keys the read as the program
    // does; after a whole argv it is options, and after a shell command line (`exec`, `execSync`)
    // a name that is not a list is options too.
    const options =
      second === undefined ||
      ts.isObjectLiteralExpression(second) ||
      ts.isArrayLiteralExpression(first) ||
      (!ts.isArrayLiteralExpression(second) && /^exec(?:Sync)?$/u.test(nameOf(call) ?? ""));
    const rest = options ? "" : (spelled(second, scope) ?? UNKNOWN);
    argv = `${spelled(first, scope) ?? UNKNOWN} ${rest}`;
  }
  const words = (argv ?? "").split(/\s+/u).filter((word) => word !== "");
  const kept = words.filter((word, index) => {
    const previous = words[index - 1] ?? "";
    const short = (one: string): boolean => one.startsWith("-") && !one.startsWith("--");
    return !short(word) && !(index > 1 && short(previous));
  });
  return kept.length === 0 || kept.includes(UNKNOWN) ? null : kept.join(" ");
}

/** The key of the external read a call makes itself, or null where it makes none or names no key. */
function readKey(call: ts.CallExpression, scope: Scope): string | null {
  const name = nameOf(call);
  const callee = call.expression;
  const receiver = ts.isPropertyAccessExpression(callee) ? callee.expression : null;
  const spawns =
    (name !== null && SPAWNS.has(name) && (receiver === null || name !== "exec")) ||
    (name === "exec" &&
      (receiver === null || (ts.isIdentifier(receiver) && scope.module.spawnModules.has(receiver.text))));
  if (spawns) {
    return withPrefix("run", argvOf(call, scope));
  }
  const [first] = call.arguments;
  if (name !== null && FILE_READS.has(name) && first !== undefined) {
    return withPrefix("read", spelled(first, scope));
  }
  if (name !== null && LISTS.has(name) && first !== undefined) {
    return withPrefix("list", spelled(first, scope));
  }
  if (name === "fetch" && receiver === null && first !== undefined) {
    return withPrefix("fetch", spelled(first, scope));
  }
  if (name === null || !BODY_READS.has(name) || receiver === null || !ts.isCallExpression(receiver)) {
    return null;
  }
  const [path] = receiver.arguments;
  return nameOf(receiver) === "file" && path !== undefined ? withPrefix("read", spelled(path, scope)) : null;
}

const withPrefix = (verb: string, key: string | null): string | null =>
  key === null ? null : `${verb} ${key}`;

function add(into: Tally, from: Tally, times = 1): Tally {
  for (const [key, { count, lines }] of from) {
    const had = into.get(key) ?? { count: 0, lines: [] };
    into.set(key, {
      count: had.count + count * (key.endsWith(PER_ITEM) ? 1 : times),
      lines: [...had.lines, ...lines],
    });
  }
  return into;
}

/** The larger count of each key across alternatives. */
function larger(...arms: Tally[]): Tally {
  const out: Tally = new Map();
  for (const arm of arms) {
    for (const [key, entry] of arm) {
      if ((out.get(key)?.count ?? 0) < entry.count) out.set(key, entry);
    }
  }
  return out;
}

/** The function a call reaches by name, with the module it is declared in. */
function calleeOf(call: ts.CallExpression, scope: Scope): [Callable, Module] | null {
  const callee = call.expression;
  const { module } = scope;
  const { modules } = scope.graph;
  if (ts.isIdentifier(callee)) {
    const own = module.functions.get(callee.text);
    if (own !== undefined) {
      return [own, module];
    }
    const from = module.imports.get(callee.text);
    const home = from === undefined ? undefined : modules.get(from.home);
    const found = from === undefined ? undefined : home?.functions.get(from.name);
    return found === undefined || home === undefined ? null : [found, home];
  }
  if (!ts.isPropertyAccessExpression(callee) || !ts.isIdentifier(callee.expression)) {
    return null;
  }
  const from = module.imports.get(callee.expression.text);
  const home = from?.name === "*" ? modules.get(from.home) : undefined;
  const found = home?.functions.get(callee.name.text);
  return found === undefined || home === undefined ? null : [found, home];
}

/**
 * Whether a function keeps what it computes in its module: it assigns a top-level `let`, or adds to
 * a top-level collection. A second call then answers from the first, so it reads nothing again.
 */
function cached(fn: Callable, module: Module): boolean {
  const keeps = (node: ts.Node): boolean => {
    if (ts.isBinaryExpression(node) && ts.isIdentifier(node.left) && module.mutables.has(node.left.text)) {
      return (
        node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
      );
    }
    const callee = ts.isCallExpression(node) ? node.expression : null;
    const member =
      callee !== null && ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)
        ? callee
        : null;
    if (member !== null && KEEPS.has(member.name.text) && module.mutables.has(member.expression.getText())) {
      return true;
    }
    return ts.forEachChild(node, keeps) === true;
  };
  return fn.body !== undefined && keeps(fn.body);
}

/** Every key a call to a function reads at least once, its parameters bound to the call's arguments. */
function readsOfCall(call: ts.CallExpression, scope: Scope): Tally {
  const reached = calleeOf(call, scope);
  const { graph } = scope;
  if (reached === null || scope.depth >= DEPTH || graph.open.has(reached[0])) {
    return new Map();
  }
  const [fn, home] = reached;
  if (cached(fn, home)) {
    return new Map();
  }
  const bound = new Map<string, string | null>();
  for (const [index, parameter] of fn.parameters.entries()) {
    const argument = call.arguments[index];
    if (ts.isIdentifier(parameter.name)) {
      bound.set(parameter.name.text, argument === undefined ? null : spelled(argument, scope));
    }
  }
  const signature = JSON.stringify([...bound]);
  const known = graph.memo.get(fn) ?? new Map<string, readonly string[]>();
  let keys = known.get(signature);
  if (keys === undefined) {
    graph.open.add(fn);
    keys = [
      ...tallyOf(fn.body, {
        module: home,
        bound,
        locals: new Map(),
        items: null,
        depth: scope.depth + 1,
        graph,
      }).keys(),
    ];
    graph.open.delete(fn);
    graph.memo.set(fn, known.set(signature, keys));
  }
  return once(keys, call, scope);
}

/** Whether any identifier under a node is one of `names`. */
function mentions(node: ts.Node, names: ReadonlySet<string>): boolean {
  if (ts.isIdentifier(node)) {
    return names.has(node.text);
  }
  return ts.forEachChild(node, (child) => mentions(child, names) || undefined) === true;
}

/**
 * One read of each key at a call or tagged template. Inside a loop, a call whose arguments name what
 * changes per item reads something else for each item, so its keys are marked not to multiply.
 */
function once(
  keys: readonly string[],
  node: ts.CallExpression | ts.TaggedTemplateExpression,
  scope: Scope,
): Tally {
  const { items } = scope;
  const given = ts.isCallExpression(node) ? node.arguments : [node.template];
  const varies = items !== null && given.some((one) => mentions(one, items));
  const { file } = scope.module;
  const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
  return new Map(
    keys.map((key) => [
      varies && !key.endsWith(PER_ITEM) ? key + PER_ITEM : key,
      { count: 1, lines: [line] },
    ]),
  );
}

/** The names a loop head or a callback's parameters bind, which change with each item. */
function boundBy(node: ts.Node | undefined, into: Set<string>): Set<string> {
  if (node === undefined) {
    return into;
  }
  if (ts.isIdentifier(node)) {
    into.add(node.text);
  } else {
    ts.forEachChild(node, (child) => {
      boundBy(ts.isBindingElement(child) ? child.name : child, into);
    });
  }
  return into;
}

/** Whether a statement always leaves its function: it returns or throws, or a block ending so. */
function leaves(node: ts.Statement): boolean {
  if (ts.isReturnStatement(node) || ts.isThrowStatement(node)) {
    return true;
  }
  const last = ts.isBlock(node) ? node.statements.at(-1) : undefined;
  return last !== undefined && leaves(last);
}

/**
 * What a node changes before a later read: whether it lets time pass (an awaited `sleep`, `delay`
 * or `setTimeout`, or a call to a function that does), whether it signals a process (`kill` with
 * any signal but 0), and which spelled paths it writes or removes. A function reached by its name
 * passes on its waits and signals, not its paths, which its parameters spell.
 */
function movesOf(
  node: ts.Node,
  scope: Scope,
  into: Moves = { waits: false, signals: false, paths: new Set() },
): Moves {
  if (ts.isAwaitExpression(node) && mentionsCall(node.expression, WAITS)) {
    into.waits = true;
  }
  if (isCallable(node) && !perItem(node)) {
    return into;
  }
  if (ts.isCallExpression(node)) {
    const name = nameOf(node) ?? "";
    const [first, signal] = node.arguments;
    into.waits ||= name === "sleepSync";
    into.signals ||= name === "kill" && signal?.getText() !== "0";
    const path = WRITES.has(name) && first !== undefined ? spelled(first, scope) : null;
    if (path !== null) into.paths.add(path);
    const reached = calleeOf(node, scope);
    if (reached !== null && scope.depth < DEPTH) {
      const [fn, home] = reached;
      const { moving } = scope.graph;
      if (!moving.has(fn)) {
        moving.set(fn, { waits: false, signals: false, paths: new Set() });
        const local: Scope = {
          ...scope,
          module: home,
          bound: new Map(),
          locals: new Map(),
          depth: scope.depth + 1,
        };
        moving.set(fn, movesOf(fn.body ?? fn, local));
      }
      into.waits ||= moving.get(fn)?.waits === true;
      into.signals ||= moving.get(fn)?.signals === true;
    }
  }
  ts.forEachChild(node, (child) => {
    movesOf(child, scope, into);
  });
  return into;
}

/** Whether a call named in `names` is made anywhere under a node, callbacks included (`new
 *  Promise((done) => setTimeout(done, ms))`). */
function mentionsCall(node: ts.Node, names: ReadonlySet<string>): boolean {
  if (ts.isCallExpression(node) && names.has(nameOf(node) ?? "")) {
    return true;
  }
  return ts.forEachChild(node, (child) => mentionsCall(child, names) || undefined) === true;
}

/**
 * The reads of a run before and after a statement that moves what they read, combined: a read the
 * move refreshes (every read after a wait, the process table after a signal, a path after its
 * write) is a reading of a later moment, so the two sides combine by the larger count.
 */
function across(before: Tally, after: Tally, moves: Moves): Tally {
  const refreshed = (key: string): boolean =>
    moves.waits ||
    (moves.signals && PROCESS_TABLE.test(key)) ||
    [...moves.paths].some((path) => key === `read ${path}` || key === `list ${path}`);
  const kept: Tally = new Map([...after].filter(([key]) => !refreshed(key)));
  const renewed: Tally = new Map([...after].filter(([key]) => refreshed(key)));
  const unmoved: Tally = new Map([...before].filter(([key]) => !renewed.has(key)));
  const both: Tally = new Map([...before].filter(([key]) => renewed.has(key)));
  return add(add(unmoved, kept), larger(both, renewed));
}

/** A run of statements: an `if` whose arm leaves makes the rest the other arm, and a statement that
 *  moves what is read splits the run into two moments. */
function sequence(statements: readonly ts.Statement[], scope: Scope, total: Tally = new Map()): Tally {
  for (const [index, statement] of statements.entries()) {
    if (
      ts.isIfStatement(statement) &&
      statement.elseStatement === undefined &&
      leaves(statement.thenStatement)
    ) {
      add(total, tallyOf(statement.expression, scope));
      const arm = add(new Map(total), tallyOf(statement.thenStatement, scope));
      return larger(arm, sequence(statements.slice(index + 1), scope, new Map(total)));
    }
    const moves = index < statements.length - 1 ? movesOf(statement, scope) : null;
    add(total, tallyOf(statement, scope));
    if (moves !== null && (moves.waits || moves.signals || moves.paths.size > 0)) {
      return across(total, sequence(statements.slice(index + 1), scope), moves);
    }
  }
  return total;
}

/** Whether a function is a callback run once per item, here and now. */
function perItem(node: Callable): boolean {
  const call = node.parent;
  return (
    ts.isCallExpression(call) &&
    call.arguments.some((one) => one === node) &&
    ITERATIONS.has(nameOf(call) ?? "")
  );
}

/** How often each keyed read happens on the worst path through a node. */
function tallyOf(node: ts.Node | undefined, scope: Scope): Tally {
  if (node === undefined) {
    return new Map();
  }
  const walk = (one: ts.Node | undefined): Tally => tallyOf(one, scope);
  if (ts.isBlock(node) || ts.isSourceFile(node)) {
    return sequence(node.statements, scope);
  }
  if (ts.isIfStatement(node)) {
    return add(walk(node.expression), larger(walk(node.thenStatement), walk(node.elseStatement)));
  }
  if (ts.isConditionalExpression(node)) {
    return add(walk(node.condition), larger(walk(node.whenTrue), walk(node.whenFalse)));
  }
  if (ts.isSwitchStatement(node)) {
    const arms = node.caseBlock.clauses.map((clause) => sequence(clause.statements, scope));
    return add(walk(node.expression), larger(...arms));
  }
  const retries = ts.isForStatement(node) && node.condition === undefined;
  if (ts.isWhileStatement(node) || ts.isDoStatement(node) || retries || ts.isClassLike(node)) {
    return new Map();
  }
  const each = (names: ts.Node | readonly ts.Node[] | undefined): Scope => {
    const items = new Set(scope.items);
    for (const one of Array.isArray(names) ? names : [names]) {
      boundBy(one, items);
    }
    return { ...scope, items };
  };
  if (ts.isForStatement(node) || ts.isForOfStatement(node) || ts.isForInStatement(node)) {
    const head = ts.isForStatement(node)
      ? add(walk(node.initializer), walk(node.condition))
      : walk(node.expression);
    return add(head, tallyOf(node.statement, each(node.initializer)), 2);
  }
  if (isCallable(node)) {
    return perItem(node)
      ? add(new Map(), tallyOf(node.body, each(node.parameters.map((one) => one.name))), 2)
      : new Map();
  }
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
    scope.bound.set(node.name.text, node.initializer === undefined ? null : spelled(node.initializer, scope));
    if (node.initializer !== undefined) {
      scope.locals.set(node.name.text, node.initializer);
    }
    scope.items?.add(node.name.text);
  }
  const total: Tally = new Map();
  ts.forEachChild(node, (child) => {
    add(total, walk(child));
  });
  if (ts.isCallExpression(node)) {
    const key = readKey(node, scope);
    if (key !== null) {
      add(total, once([key], node, scope));
    }
    return add(total, readsOfCall(node, scope));
  }
  if (!ts.isTaggedTemplateExpression(node) || !SHELL_TAG.test(node.tag.getText())) {
    return total;
  }
  const key = withPrefix("run", spelled(node.template, scope));
  return key === null ? total : add(total, once([key], node, scope));
}

/**
 * One finding per set of lines a function repeats reads at: a wrapper that asks `ps` and then
 * `lsof` repeats both at the same calls. A read marked as one item's is left out where the same
 * read repeats unmarked, which already covers it.
 */
function rowsOf(path: string, name: string, tally: Tally): TreeFinding[] {
  const repeated = [...tally].filter(([, { count }]) => count >= 2);
  const plain = new Set(repeated.map(([key]) => key));
  const kept = repeated.filter(
    ([key]) => !(key.endsWith(PER_ITEM) && plain.has(key.slice(0, -PER_ITEM.length))),
  );
  const byLines = Map.groupBy(kept, ([, { lines }]) =>
    [...new Set(lines)].toSorted((a, b) => a - b).join(", "),
  );
  return [...byLines].map(([at, under]) => {
    const lines = at.split(", ").map(Number);
    const count = Math.max(...under.map(([, entry]) => entry.count));
    const reads = under.map(([key]) => `\`${key.replace(PER_ITEM, "")}\``).join(" and ");
    const times = lines.length === 1 ? "once for each item of a loop" : `${count} times`;
    return {
      kind: "repeated-external-read",
      path,
      line: lines[0] ?? 0,
      detail: `${name} reads ${reads} ${times} on one path (line ${at}): read once where the paths join and pass the answer on`,
      places: lines.map((line) => ({ path, line, end: line })),
    };
  });
}

/** Every function, and every module's top level, that makes one keyed external read twice. */
export function repeatedExternalReads(parsed: ReadonlyMap<string, ts.SourceFile>): TreeFinding[] {
  const paths = new Set(parsed.keys());
  const modules = new Map([...parsed].map(([path, file]) => [path, moduleOf(path, file, paths)]));
  const graph: Graph = { modules, open: new Set(), memo: new Map(), moving: new Map() };
  const rows: TreeFinding[] = [];
  for (const module of modules.values()) {
    if (TEST_PATH.test(module.path)) {
      continue;
    }
    const entries: [string, ts.Node, Callable | null][] = [
      ["the module's top level", module.file, null],
      ...[...module.functions].map(([name, fn]): [string, ts.Node, Callable] => [
        `\`${name}\``,
        fn.body ?? fn,
        fn,
      ]),
    ];
    for (const [name, body, fn] of entries) {
      const bound = new Map(
        (fn?.parameters ?? []).flatMap((one) => (ts.isIdentifier(one.name) ? [[one.name.text, null]] : [])),
      );
      graph.open.clear();
      if (fn !== null) {
        graph.open.add(fn);
      }
      const tally = tallyOf(body, { module, bound, locals: new Map(), items: null, depth: 0, graph });
      rows.push(...rowsOf(module.path, name, tally));
    }
  }
  return rows;
}
