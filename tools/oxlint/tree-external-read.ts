import * as ts from "typescript5";
import { bare, type Callable, importsOf, isTestPath, lineOf } from "./tree-ast.ts";
import type { TreeFinding } from "./tree-findings.ts";

interface Module {
  readonly path: string;
  readonly file: ts.SourceFile;
  readonly functions: ReadonlyMap<string, Callable>;
  readonly constants: ReadonlyMap<string, ts.Expression>;
  readonly imports: ReadonlyMap<string, { readonly home: string; readonly name: string }>;
  readonly spawnModules: ReadonlySet<string>;
  readonly mutables: ReadonlySet<string>;
}

type Tally = Map<string, { readonly count: number; readonly lines: number[] }>;

interface Moves {
  waits: boolean;
  signals: boolean;
  readonly paths: Set<string>;
}

interface Graph {
  readonly modules: ReadonlyMap<string, Module>;
  readonly open: Set<Callable>;
  readonly memo: Map<Callable, Map<string, readonly string[]>>;
  readonly moving: Map<Callable, Moves>;
  readonly cached: Map<Callable, boolean>;
}

interface Scope {
  readonly module: Module;
  readonly bound: Map<string, string | null>;
  readonly locals: Map<string, ts.Expression>;
  readonly items: Set<string> | null;
  readonly depth: number;
  readonly graph: Graph;
}

const K = ts.SyntaxKind;
const EMPTY: Tally = new Map();
const SPAWNS = new Set(["spawnSync", "execSync", "execFileSync", "spawn", "execFile", "execa", "execaSync"]);
const DIRECT_VERBS = new Map<string, string>([
  ["readFileSync", "read"],
  ["readFile", "read"],
  ["readJson", "read"],
  ["readJsonSync", "read"],
  ["readJSON", "read"],
  ["readJSONSync", "read"],
  ["readdirSync", "list"],
  ["readdir", "list"],
]);
const OPTION_KEYS = new Set(["cwd", "input", "stdin", "env"]);
const BODY_READS = new Set(["text", "json", "bytes", "arrayBuffer"]);
const PATH_JOINS = new Set(["join", "resolve"]);
const SPAWN_MODULE = /^(?:node:)?child_process$/u;
const SHELL_TAG = /^(?:Bun\.)?\$$/u;
const COLLECTION = /^new (?:Map|Set|WeakMap)\b/u;
const KEEPS = new Set(["set", "add", "push"]);
const CALLABLE_KINDS = new Set([K.FunctionDeclaration, K.ArrowFunction, K.FunctionExpression]);
const SKIPPED_LOOP_KINDS = new Set([K.WhileStatement, K.DoStatement, K.ClassDeclaration, K.ClassExpression]);
const FOR_KINDS = new Set([K.ForStatement, K.ForOfStatement, K.ForInStatement]);
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
const WAITS = new Set(["sleep", "delay", "setTimeout", "wait"]);
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
const PROCESS_TABLE = /^run (?:ps|pgrep|lsof)\b/u;
const UNKNOWN = "‹?›";
const PER_ITEM = " (one item's)";

const isCallable = (node: ts.Node | undefined): node is Callable =>
  node !== undefined && CALLABLE_KINDS.has(node.kind);

const withPrefix = (verb: string, key: string | null): string | null =>
  key === null ? null : `${verb} ${key}`;

function nameOf(call: ts.CallExpression): string | null {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  return ts.isPropertyAccessExpression(callee) ? callee.name.text : null;
}

function recordVars(
  statement: ts.VariableStatement,
  file: ts.SourceFile,
  functions: Map<string, Callable>,
  constants: Map<string, ts.Expression>,
  mutables: Set<string>,
): void {
  const constant = (statement.declarationList.flags & ts.NodeFlags.Const) !== 0;
  for (const one of statement.declarationList.declarations) {
    if (!ts.isIdentifier(one.name)) continue;
    const { initializer } = one;
    if (!constant || (initializer !== undefined && COLLECTION.test(initializer.getText(file)))) {
      mutables.add(one.name.text);
    }
    if (isCallable(initializer)) functions.set(one.name.text, initializer);
    else if (initializer !== undefined) constants.set(one.name.text, initializer);
  }
}

function moduleOf(path: string, file: ts.SourceFile, paths: ReadonlySet<string>): Module {
  const functions = new Map<string, Callable>();
  const constants = new Map<string, ts.Expression>();
  const spawnModules = new Set<string>();
  const mutables = new Set<string>();
  for (const statement of file.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
      functions.set(statement.name.text, statement);
    } else if (ts.isVariableStatement(statement)) {
      recordVars(statement, file, functions, constants, mutables);
    } else if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      SPAWN_MODULE.test(statement.moduleSpecifier.text)
    ) {
      const clause = statement.importClause;
      const bindings = clause?.namedBindings;
      if (clause?.name !== undefined) spawnModules.add(clause.name.text);
      if (bindings !== undefined && ts.isNamespaceImport(bindings)) spawnModules.add(bindings.name.text);
    }
  }
  return { path, file, functions, constants, imports: importsOf(path, file, paths), spawnModules, mutables };
}

function spelledTemplate(node: ts.TemplateExpression, scope: Scope): string | null {
  let out = node.head.text;
  for (const span of node.templateSpans) {
    const part = spelled(span.expression, scope);
    if (part === null) return null;
    out += part + span.literal.text;
  }
  return out;
}

function spelledIdentifier(name: string, scope: Scope): string | null {
  if (scope.bound.has(name)) return scope.bound.get(name) ?? null;
  const constant = scope.module.constants.get(name);
  if (constant !== undefined) return ts.isStringLiteralLike(constant) ? constant.text : `‹${name}›`;
  return scope.module.imports.has(name) ? `‹${name}›` : null;
}

function spelled(raw: ts.Expression, scope: Scope): string | null {
  const node = bare(raw);
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isTemplateExpression(node)) return spelledTemplate(node, scope);
  if (ts.isIdentifier(node)) return spelledIdentifier(node.text, scope);
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements
      .map((one) => spelled(ts.isSpreadElement(one) ? one.expression : one, scope) ?? UNKNOWN)
      .join(" ");
  }
  if (ts.isPropertyAccessExpression(node)) {
    const base = spelled(node.expression, scope);
    return base === null ? null : `${base}.${node.name.text}`;
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === K.PlusToken) {
    const [left, right] = [spelled(node.left, scope), spelled(node.right, scope)];
    return left === null || right === null ? null : left + right;
  }
  if (!ts.isCallExpression(node) || !PATH_JOINS.has(nameOf(node) ?? "")) return null;
  const parts = node.arguments.map((one) => spelled(one, scope));
  return parts.includes(null) ? null : parts.join("/");
}

function optionWordsOf(settings: ts.Expression | undefined, scope: Scope): string[] {
  if (settings === undefined) return [];
  if (!ts.isObjectLiteralExpression(settings)) return [UNKNOWN];
  return settings.properties
    .filter((one) => ts.isSpreadAssignment(one) || OPTION_KEYS.has(one.name.getText()))
    .map((one) => {
      const value = ts.isPropertyAssignment(one) ? spelled(one.initializer, scope) : null;
      return value === null || ts.isSpreadAssignment(one) ? UNKNOWN : `${one.name.getText()}=${value}`;
    });
}

function argvOf(call: ts.CallExpression, scope: Scope): string | null {
  const local = (node: ts.Expression | undefined): ts.Expression | undefined =>
    node !== undefined && ts.isIdentifier(node) ? (scope.locals.get(node.text) ?? node) : node;
  const [first, second, third] = call.arguments.map(local);
  let argv: string | null = null;
  let settings = first;
  if (first !== undefined && ts.isObjectLiteralExpression(first)) {
    const cmd = first.properties.find((one) => ts.isPropertyAssignment(one) && one.name.getText() === "cmd");
    argv = cmd !== undefined && ts.isPropertyAssignment(cmd) ? spelled(cmd.initializer, scope) : null;
  } else if (first !== undefined) {
    const options =
      second === undefined ||
      ts.isObjectLiteralExpression(second) ||
      ts.isArrayLiteralExpression(first) ||
      (!ts.isArrayLiteralExpression(second) && /^exec(?:Sync)?$/u.test(nameOf(call) ?? ""));
    const rest = options ? "" : (spelled(second, scope) ?? UNKNOWN);
    argv = `${spelled(first, scope) ?? UNKNOWN} ${rest}`;
    settings = options ? second : third;
  }
  const words = [...(argv ?? "").split(/\s+/u), ...optionWordsOf(settings, scope)].filter(Boolean);
  const short = (one: string): boolean => one.startsWith("-") && !one.startsWith("--");
  const kept = words.filter((word, index) => !short(word) && !(index > 1 && short(words[index - 1] ?? "")));
  return kept.length === 0 || kept.includes(UNKNOWN) ? null : kept.join(" ");
}

function readKey(call: ts.CallExpression, scope: Scope): string | null {
  const name = nameOf(call);
  if (name === null) return null;
  const callee = call.expression;
  const receiver = ts.isPropertyAccessExpression(callee) ? callee.expression : null;
  if (
    SPAWNS.has(name) &&
    (name !== "exec" ||
      receiver === null ||
      (ts.isIdentifier(receiver) && scope.module.spawnModules.has(receiver.text)))
  ) {
    return withPrefix("run", argvOf(call, scope));
  }
  const [first] = call.arguments;
  const direct = DIRECT_VERBS.get(name);
  if (direct !== undefined && first !== undefined) return withPrefix(direct, spelled(first, scope));
  if (name === "fetch" && receiver === null && first !== undefined) {
    return withPrefix("fetch", spelled(first, scope));
  }
  if (!BODY_READS.has(name) || receiver === null || !ts.isCallExpression(receiver)) return null;
  const [path] = receiver.arguments;
  return nameOf(receiver) === "file" && path !== undefined ? withPrefix("read", spelled(path, scope)) : null;
}

function add(into: Tally, from: Tally, times = 1): Tally {
  if (from.size === 0) return into;
  const out: Tally = into === EMPTY ? new Map() : into;
  for (const [key, { count, lines }] of from) {
    const had = out.get(key);
    const delta = count * (key.endsWith(PER_ITEM) ? 1 : times);
    out.set(
      key,
      had === undefined
        ? { count: delta, lines }
        : { count: had.count + delta, lines: [...had.lines, ...lines] },
    );
  }
  return out;
}

function larger(...arms: Tally[]): Tally {
  let out: Tally = EMPTY;
  for (const arm of arms) {
    if (arm.size === 0) continue;
    if (out === EMPTY) out = new Map();
    for (const [key, entry] of arm) {
      const prev = out.get(key);
      if (prev === undefined || prev.count < entry.count) out.set(key, entry);
    }
  }
  return out;
}

function calleeOf(call: ts.CallExpression, scope: Scope): [Callable, Module] | null {
  const callee = call.expression;
  const { module } = scope;
  const { modules } = scope.graph;
  if (ts.isIdentifier(callee)) {
    const own = module.functions.get(callee.text);
    if (own !== undefined) return [own, module];
    const from = module.imports.get(callee.text);
    const home = from === undefined ? undefined : modules.get(from.home);
    const found = from === undefined ? undefined : home?.functions.get(from.name);
    return found === undefined || home === undefined ? null : [found, home];
  }
  if (!ts.isPropertyAccessExpression(callee) || !ts.isIdentifier(callee.expression)) return null;
  const from = module.imports.get(callee.expression.text);
  const home = from?.name === "*" ? modules.get(from.home) : undefined;
  const found = home?.functions.get(callee.name.text);
  return found === undefined || home === undefined ? null : [found, home];
}

function cached(fn: Callable, module: Module, graph: Graph): boolean {
  const memo = graph.cached.get(fn);
  if (memo !== undefined) return memo;
  const keeps = (node: ts.Node): boolean => {
    if (ts.isTypeNode(node)) return false;
    if (ts.isBinaryExpression(node) && ts.isIdentifier(node.left) && module.mutables.has(node.left.text)) {
      return node.operatorToken.kind >= K.FirstAssignment && node.operatorToken.kind <= K.LastAssignment;
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        KEEPS.has(callee.name.text) &&
        module.mutables.has(callee.expression.text)
      ) {
        return true;
      }
    }
    return ts.forEachChild(node, keeps) === true;
  };
  const result = module.mutables.size > 0 && fn.body !== undefined && keeps(fn.body);
  graph.cached.set(fn, result);
  return result;
}

function readsOfCall(call: ts.CallExpression, scope: Scope): Tally {
  const reached = calleeOf(call, scope);
  const { graph } = scope;
  if (reached === null || scope.depth >= DEPTH || graph.open.has(reached[0])) return EMPTY;
  const [fn, home] = reached;
  if (cached(fn, home, graph)) return EMPTY;
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
  return keys.length === 0 ? EMPTY : once(keys, call, scope);
}

function mentions(node: ts.Node, names: ReadonlySet<string>): boolean {
  if (ts.isIdentifier(node)) return names.has(node.text);
  return ts.forEachChild(node, (child) => mentions(child, names) || undefined) === true;
}

function once(
  keys: readonly string[],
  node: ts.CallExpression | ts.TaggedTemplateExpression,
  scope: Scope,
): Tally {
  const { items } = scope;
  const given = ts.isCallExpression(node) ? node.arguments : [node.template];
  const varies = items !== null && given.some((one) => mentions(one, items));
  const line = lineOf(scope.module.file, node);
  return new Map(
    keys.map((key) => [
      varies && !key.endsWith(PER_ITEM) ? key + PER_ITEM : key,
      { count: 1, lines: [line] },
    ]),
  );
}

function boundBy(node: ts.Node | undefined, into: Set<string>): Set<string> {
  if (node === undefined) return into;
  if (ts.isIdentifier(node)) into.add(node.text);
  else {
    ts.forEachChild(node, (child) => {
      boundBy(ts.isBindingElement(child) ? child.name : child, into);
    });
  }
  return into;
}

function leaves(node: ts.Statement): boolean {
  if (ts.isReturnStatement(node) || ts.isThrowStatement(node)) return true;
  const last = ts.isBlock(node) ? node.statements.at(-1) : undefined;
  return last !== undefined && leaves(last);
}

function mentionsCall(node: ts.Node, names: ReadonlySet<string>): boolean {
  if (ts.isCallExpression(node) && names.has(nameOf(node) ?? "")) return true;
  return ts.forEachChild(node, (child) => mentionsCall(child, names) || undefined) === true;
}

function perItem(node: Callable): boolean {
  const call = node.parent;
  return (
    ts.isCallExpression(call) &&
    call.arguments.some((one) => one === node) &&
    ITERATIONS.has(nameOf(call) ?? "")
  );
}

function recordCallMove(node: ts.CallExpression, scope: Scope, into: Moves): void {
  const name = nameOf(node) ?? "";
  const [first, signal] = node.arguments;
  into.waits ||= name === "sleepSync";
  into.signals ||= name === "kill" && signal?.getText() !== "0";
  const path = WRITES.has(name) && first !== undefined ? spelled(first, scope) : null;
  if (path !== null) into.paths.add(path);
  const reached = calleeOf(node, scope);
  if (reached === null || scope.depth >= DEPTH) return;
  const [fn, home] = reached;
  const { moving } = scope.graph;
  let sub = moving.get(fn);
  if (sub === undefined) {
    sub = { waits: false, signals: false, paths: new Set() };
    moving.set(fn, sub);
    sub = movesOf(fn.body ?? fn, {
      ...scope,
      module: home,
      bound: new Map(),
      locals: new Map(),
      depth: scope.depth + 1,
    });
    moving.set(fn, sub);
  }
  into.waits ||= sub.waits;
  into.signals ||= sub.signals;
}

function movesOf(
  node: ts.Node,
  scope: Scope,
  into: Moves = { waits: false, signals: false, paths: new Set() },
): Moves {
  if (ts.isTypeNode(node) || ts.isTypeParameterDeclaration(node)) return into;
  if (ts.isAwaitExpression(node) && mentionsCall(node.expression, WAITS)) into.waits = true;
  if (isCallable(node) && !perItem(node)) return into;
  if (ts.isCallExpression(node)) recordCallMove(node, scope, into);
  ts.forEachChild(node, (child) => {
    movesOf(child, scope, into);
  });
  return into;
}

function across(before: Tally, after: Tally, moves: Moves): Tally {
  const refreshed = (key: string): boolean =>
    moves.waits ||
    (moves.signals && PROCESS_TABLE.test(key)) ||
    [...moves.paths].some((path) => key === `read ${path}` || key === `list ${path}`);
  const kept: Tally = new Map();
  const renewed: Tally = new Map();
  for (const [key, entry] of after) (refreshed(key) ? renewed : kept).set(key, entry);
  const unmoved: Tally = new Map();
  const both: Tally = new Map();
  for (const [key, entry] of before) (renewed.has(key) ? both : unmoved).set(key, entry);
  return add(add(unmoved, kept), larger(both, renewed));
}

function sequence(statements: readonly ts.Statement[], scope: Scope, total: Tally = EMPTY): Tally {
  let acc = total;
  for (let index = 0; index < statements.length; index += 1) {
    const statement = statements[index];
    if (statement === undefined) continue;
    if (
      ts.isIfStatement(statement) &&
      statement.elseStatement === undefined &&
      leaves(statement.thenStatement)
    ) {
      acc = add(acc, tallyOf(statement.expression, scope));
      const arm = add(new Map(acc), tallyOf(statement.thenStatement, scope));
      return larger(arm, sequence(statements.slice(index + 1), scope, new Map(acc)));
    }
    acc = add(acc, tallyOf(statement, scope));
    if (acc.size > 0 && index < statements.length - 1) {
      const moves = movesOf(statement, scope);
      if (moves.waits || moves.signals || moves.paths.size > 0) {
        return across(acc, sequence(statements.slice(index + 1), scope), moves);
      }
    }
  }
  return acc;
}

function itemScope(scope: Scope, names: ts.Node | readonly ts.Node[] | undefined): Scope {
  const items = new Set(scope.items);
  for (const one of Array.isArray(names) ? names : [names]) boundBy(one, items);
  return { ...scope, items };
}

function tallyControl(node: ts.Node, scope: Scope): Tally | null {
  const walk = (one: ts.Node | undefined): Tally => tallyOf(one, scope);
  if (ts.isBlock(node) || ts.isSourceFile(node)) return sequence(node.statements, scope);
  if (ts.isIfStatement(node)) {
    return add(walk(node.expression), larger(walk(node.thenStatement), walk(node.elseStatement)));
  }
  if (ts.isConditionalExpression(node)) {
    return add(walk(node.condition), larger(walk(node.whenTrue), walk(node.whenFalse)));
  }
  if (ts.isSwitchStatement(node)) {
    return add(
      walk(node.expression),
      larger(...node.caseBlock.clauses.map((clause) => sequence(clause.statements, scope))),
    );
  }
  if (SKIPPED_LOOP_KINDS.has(node.kind) || (ts.isForStatement(node) && node.condition === undefined)) {
    return EMPTY;
  }
  if (FOR_KINDS.has(node.kind)) {
    // SAFETY: `FOR_KINDS` enumerates the three `for` loop AST node kinds.
    const loop = node as ts.ForStatement | ts.ForOfStatement | ts.ForInStatement;
    const head = ts.isForStatement(loop)
      ? add(walk(loop.initializer), walk(loop.condition))
      : walk(loop.expression);
    return add(head, tallyOf(loop.statement, itemScope(scope, loop.initializer)), 2);
  }
  if (isCallable(node)) {
    return perItem(node)
      ? add(
          EMPTY,
          tallyOf(
            node.body,
            itemScope(
              scope,
              node.parameters.map((one) => one.name),
            ),
          ),
          2,
        )
      : EMPTY;
  }
  return null;
}

function tallyOf(node: ts.Node | undefined, scope: Scope): Tally {
  if (node === undefined || ts.isTypeNode(node) || ts.isTypeParameterDeclaration(node)) return EMPTY;
  const branch = tallyControl(node, scope);
  if (branch !== null) return branch;
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
    scope.bound.set(node.name.text, node.initializer === undefined ? null : spelled(node.initializer, scope));
    if (node.initializer !== undefined) scope.locals.set(node.name.text, node.initializer);
    scope.items?.add(node.name.text);
  }
  let total: Tally = EMPTY;
  ts.forEachChild(node, (child) => {
    total = add(total, tallyOf(child, scope));
  });
  if (ts.isCallExpression(node)) {
    const key = readKey(node, scope);
    if (key !== null) total = add(total, once([key], node, scope));
    return add(total, readsOfCall(node, scope));
  }
  if (!ts.isTaggedTemplateExpression(node) || !SHELL_TAG.test(node.tag.getText())) return total;
  const key = withPrefix("run", spelled(node.template, scope));
  return key === null ? total : add(total, once([key], node, scope));
}

function rowsOf(path: string, name: string, tally: Tally): TreeFinding[] {
  if (tally.size === 0) return [];
  const repeated = [...tally].filter(([, { count }]) => count >= 2);
  if (repeated.length === 0) return [];
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
    const times = lines.length === 1 ? "once for each item of a loop" : `${String(count)} times`;
    return {
      kind: "no-repeated-external-read",
      path,
      line: lines[0] ?? 0,
      detail: `${name} reads ${reads} ${times} on one path (line ${at}): read once where the paths join and pass the answer on`,
      places: lines.map((line) => ({ path, line, end: line })),
    };
  });
}

export function repeatedExternalReads(parsed: ReadonlyMap<string, ts.SourceFile>): TreeFinding[] {
  const paths = new Set(parsed.keys());
  const modules = new Map([...parsed].map(([path, file]) => [path, moduleOf(path, file, paths)]));
  const graph: Graph = { modules, open: new Set(), memo: new Map(), moving: new Map(), cached: new Map() };
  const rows: TreeFinding[] = [];
  for (const module of modules.values()) {
    if (isTestPath(module.path)) continue;
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
      if (fn !== null) graph.open.add(fn);
      rows.push(
        ...rowsOf(
          module.path,
          name,
          tallyOf(body, { module, bound, locals: new Map(), items: null, depth: 0, graph }),
        ),
      );
    }
  }
  return rows;
}
