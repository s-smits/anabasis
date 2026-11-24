import * as ts from "typescript5";
import {
  bare,
  endLineOf,
  type ImportGraph,
  importsOf,
  isExported,
  isFunctionValue,
  isTestPath,
  lineOf,
  OPTED_OUT,
  resolveImport,
  type TopCallable,
  topLevelCallables,
} from "./tree-ast.ts";
import type { TreeFinding } from "./tree-findings.ts";

interface ExportedDecl {
  readonly name: string;
  readonly localName: string;
  readonly node: ts.Identifier;
  readonly role: "callable" | "other";
}

interface ParamSummary {
  readonly name: string;
  readonly optional: boolean;
}

interface ExportedFn {
  readonly path: string;
  readonly name: string;
  readonly line: number;
  readonly params: readonly ParamSummary[];
}

interface CallStats {
  count: number;
  readonly passed: number[];
  readonly values: Set<string>[];
  escaped: boolean;
}

interface TypeSite {
  readonly path: string;
  readonly line: number;
  readonly end: number;
  readonly name: string;
}

interface FnSite {
  readonly path: string;
  readonly line: number;
  readonly end: number;
  readonly name: string;
  readonly tokens: number;
}

const K = ts.SyntaxKind;
const FIELD_LENGTH_FLOOR = 4;
const DUPLICATE_TYPE_FIELDS = 4;
const DUPLICATE_FN_TOKENS = 22;
const CONSTANT_CALL_FLOOR = 3;
const OPTIONAL_CALL_FLOOR = 2;
const NAMED_PLACES = 3;
const CONSTANT_LITERAL_KINDS = new Set([K.TrueKeyword, K.FalseKeyword, K.NullKeyword]);

const isDefaultExport = (node: ts.Node): boolean =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((one) => one.kind === K.DefaultKeyword);

function fileOptedOut(file: ts.SourceFile): boolean {
  return OPTED_OUT.test(file.text.slice(0, file.statements[0]?.getStart(file)));
}

function localExportAliases(file: ts.SourceFile): Map<string, string[]> {
  const aliases = new Map<string, string[]>();
  for (const statement of file.statements) {
    if (
      !ts.isExportDeclaration(statement) ||
      statement.moduleSpecifier !== undefined ||
      statement.exportClause === undefined ||
      !ts.isNamedExports(statement.exportClause)
    ) {
      continue;
    }
    for (const el of statement.exportClause.elements) {
      const local = (el.propertyName ?? el.name).text;
      const list = aliases.get(local);
      if (list === undefined) aliases.set(local, [el.name.text]);
      else list.push(el.name.text);
    }
  }
  return aliases;
}

function exportedDecls(file: ts.SourceFile): ExportedDecl[] {
  const seen = new Set<string>();
  const out: ExportedDecl[] = [];
  const aliases = localExportAliases(file);
  const add = (
    node: ts.Identifier,
    visibility: "direct" | "default" | "aliased",
    role: "callable" | "other",
  ): void => {
    const directNames = visibility === "default" ? ["default"] : visibility === "direct" ? [node.text] : [];
    for (const exportedName of [...directNames, ...(aliases.get(node.text) ?? [])]) {
      if (seen.has(exportedName)) continue;
      seen.add(exportedName);
      out.push({ name: exportedName, localName: node.text, node, role });
    }
  };
  for (const statement of file.statements) {
    const exportedKind = isDefaultExport(statement) ? "default" : "direct";
    const visibility = isExported(statement) ? exportedKind : "aliased";
    if (
      ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isEnumDeclaration(statement)
    ) {
      if (statement.name !== undefined) {
        const role =
          ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) ? "callable" : "other";
        add(statement.name, visibility, role);
      }
      continue;
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const one of statement.declarationList.declarations) {
      if (!ts.isIdentifier(one.name)) continue;
      const role =
        one.initializer !== undefined && isFunctionValue(bare(one.initializer)) ? "callable" : "other";
      add(one.name, visibility, role);
    }
  }
  return out;
}

function selfUses(file: ts.SourceFile, name: string, declNode: ts.Identifier): number {
  let count = 0;
  const walk = (node: ts.Node): void => {
    if (node === declNode) return;
    if (ts.isIdentifier(node) && node.text === name) {
      const parent = node.parent;
      const ignored =
        ts.isExportSpecifier(parent) ||
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isPropertyAssignment(parent) && parent.name === node) ||
        (ts.isPropertySignature(parent) && parent.name === node);
      if (!ignored) count += 1;
    }
    ts.forEachChild(node, walk);
  };
  walk(file);
  return count;
}

export function deadExports(owned: ReadonlyMap<string, ts.SourceFile>, graph: ImportGraph): TreeFinding[] {
  const rows: TreeFinding[] = [];
  for (const [path, file] of owned) {
    if (isTestPath(path) || fileOptedOut(file)) continue;
    for (const decl of exportedDecls(file)) {
      const prod = graph.starProd.has(path) ? 1 : (graph.prodReaders.get(path)?.get(decl.name)?.size ?? 0);
      const tests = graph.starTest.has(path) ? 1 : (graph.testReaders.get(path)?.get(decl.name)?.size ?? 0);
      if (prod > 0) continue;
      const line = lineOf(file, decl.node);
      if (tests === 0) {
        rows.push({
          kind: "no-unused-export",
          path,
          line,
          detail: `\`${decl.name}\` is exported and no other module imports it; drop \`export\` or delete it`,
        });
      } else if (decl.role === "callable" && selfUses(file, decl.localName, decl.node) === 0) {
        const testFiles = [...(graph.testReaders.get(path)?.get(decl.name) ?? [])].toSorted();
        const who =
          testFiles.length === 1
            ? (testFiles[0] ?? "tests")
            : tests === 1
              ? "1 test file"
              : `${String(tests)} test files`;
        rows.push({
          kind: "no-test-only-export",
          path,
          line,
          detail: `\`${decl.name}\` is unused in its own module and imported only by ${who}`,
        });
      }
    }
  }
  return rows;
}

function unusedReexportsIn(
  path: string,
  file: ts.SourceFile,
  graph: ImportGraph,
  allPaths: ReadonlySet<string>,
): TreeFinding[] {
  const imported = importsOf(path, file, allPaths);
  const readFromHere = (name: string): boolean =>
    (graph.prodReaders.get(path)?.get(name)?.size ?? 0) > 0 ||
    (graph.testReaders.get(path)?.get(name)?.size ?? 0) > 0;
  const rows: TreeFinding[] = [];
  for (const statement of file.statements) {
    if (!ts.isExportDeclaration(statement) || statement.exportClause === undefined) continue;
    if (!ts.isNamedExports(statement.exportClause)) continue;
    const from =
      statement.moduleSpecifier !== undefined && ts.isStringLiteral(statement.moduleSpecifier)
        ? statement.moduleSpecifier.text
        : null;
    if (from?.startsWith("node:") === true) continue;
    const unread = statement.exportClause.elements.flatMap((el) => {
      const local = (el.propertyName ?? el.name).text;
      const exported = el.name.text;
      if (from === null && !imported.has(local)) return [];
      return readFromHere(exported) ? [] : [`\`${exported}\``];
    });
    if (unread.length === 0) continue;
    const line = lineOf(file, statement);
    const [verb, them] = unread.length === 1 ? ["is", "it"] : ["are", "them"];
    rows.push({
      kind: "no-unused-reexport",
      path,
      line,
      detail: `${unread.join(", ")} ${verb} re-exported here and no file imports ${them} from this module`,
      places: [{ path, line, end: endLineOf(file, statement) }],
    });
  }
  return rows;
}

export function unusedReexports(
  owned: ReadonlyMap<string, ts.SourceFile>,
  graph: ImportGraph,
  allPaths: ReadonlySet<string>,
): TreeFinding[] {
  const rows: TreeFinding[] = [];
  for (const [path, file] of owned) {
    if (isTestPath(path) || fileOptedOut(file) || /(?:^|\/)index\.tsx?$/u.test(path)) continue;
    if (graph.starProd.has(path) || graph.starTest.has(path)) continue;
    rows.push(...unusedReexportsIn(path, file, graph, allPaths));
  }
  return rows;
}

export function unusedFields(
  owned: ReadonlyMap<string, ts.SourceFile>,
  identCounts: ReadonlyMap<string, number>,
): TreeFinding[] {
  const rows: TreeFinding[] = [];
  for (const [path, file] of owned) {
    if (isTestPath(path) || fileOptedOut(file)) continue;
    const walk = (node: ts.Node): void => {
      if (ts.isPropertySignature(node) && ts.isIdentifier(node.name)) {
        const name = node.name.text;
        if (name.length >= FIELD_LENGTH_FLOOR && identCounts.get(name) === 1) {
          rows.push({
            kind: "no-unused-field",
            path,
            line: lineOf(file, node),
            detail: `\`${name}\` is declared and never spelled again`,
          });
        }
      }
      ts.forEachChild(node, walk);
    };
    walk(file);
  }
  return rows;
}

function argLiteral(node: ts.Expression, file: ts.SourceFile): string {
  const inner = bare(node);
  if (ts.isStringLiteralLike(inner)) return JSON.stringify(inner.text);
  if (ts.isNumericLiteral(inner) || CONSTANT_LITERAL_KINDS.has(inner.kind)) return inner.getText(file);
  if (ts.isIdentifier(inner) && inner.text === "undefined") return "undefined";
  return "<expr>";
}

function isDeclarationName(node: ts.Identifier): boolean {
  const parent = node.parent;
  return (
    ts.isImportSpecifier(parent) ||
    ts.isExportSpecifier(parent) ||
    (ts.isFunctionDeclaration(parent) && parent.name === node) ||
    (ts.isVariableDeclaration(parent) && parent.name === node) ||
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    ts.isTypeReferenceNode(parent)
  );
}

function exportedFunctionsOf(
  owned: ReadonlyMap<string, ts.SourceFile>,
): Map<string, Map<string, ExportedFn>> {
  const byFile = new Map<string, Map<string, ExportedFn>>();
  for (const [path, file] of owned) {
    if (isTestPath(path) || fileOptedOut(file)) continue;
    const map = new Map<string, ExportedFn>();
    for (const callable of topLevelCallables(file)) {
      if (!callable.exported || isDefaultExport(callable.node) || callable.node.parameters.length === 0) {
        continue;
      }
      if (callable.node.parameters.some((one) => one.dotDotDotToken !== undefined)) continue;
      map.set(callable.name, {
        path,
        name: callable.name,
        line: callable.line,
        params: callable.node.parameters.map((one) => ({
          name: ts.isIdentifier(one.name) ? one.name.text : "_",
          optional: one.questionToken !== undefined || one.initializer !== undefined,
        })),
      });
    }
    if (map.size > 0) byFile.set(path, map);
  }
  return byFile;
}

function recordCall(call: ts.CallExpression, fn: ExportedFn, stats: CallStats, file: ts.SourceFile): void {
  if (call.arguments.some(ts.isSpreadElement)) {
    stats.escaped = true;
    return;
  }
  stats.count += 1;
  for (const [index] of fn.params.entries()) {
    const arg = call.arguments[index];
    if (arg === undefined) {
      stats.values[index]?.add("<omitted>");
    } else {
      stats.passed[index] = (stats.passed[index] ?? 0) + 1;
      stats.values[index]?.add(argLiteral(arg, file));
    }
  }
}

function visibleExportedFns(
  path: string,
  file: ts.SourceFile,
  byFile: ReadonlyMap<string, ReadonlyMap<string, ExportedFn>>,
  paths: ReadonlySet<string>,
): Map<string, ExportedFn> {
  const local = new Map<string, ExportedFn>(byFile.get(path));
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const home = resolveImport(path, statement.moduleSpecifier.text, paths);
    const bindings = statement.importClause?.namedBindings;
    if (home === undefined || bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const el of bindings.elements) {
      const fn = byFile.get(home)?.get((el.propertyName ?? el.name).text);
      if (fn !== undefined) local.set(el.name.text, fn);
    }
  }
  return local;
}

function recordFileCalls(
  file: ts.SourceFile,
  local: ReadonlyMap<string, ExportedFn>,
  statsMap: ReadonlyMap<ExportedFn, CallStats>,
): void {
  const walk = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      const fn = local.get(node.text);
      const stats = fn === undefined || isDeclarationName(node) ? undefined : statsMap.get(fn);
      if (fn !== undefined && stats !== undefined) {
        const parent = node.parent;
        if (ts.isCallExpression(parent) && parent.expression === node) recordCall(parent, fn, stats, file);
        else stats.escaped = true;
      }
    }
    ts.forEachChild(node, walk);
  };
  walk(file);
}

function constantFindingsOf(fn: ExportedFn, stats: CallStats): TreeFinding[] {
  if (stats.escaped || stats.count < OPTIONAL_CALL_FLOOR) return [];
  const rows: TreeFinding[] = [];
  for (const [index, param] of fn.params.entries()) {
    if (param.name === "_" || param.name.startsWith("_")) continue;
    const values = stats.values[index] ?? new Set<string>();
    if (param.optional && (stats.passed[index] ?? 0) === 0) {
      rows.push({
        kind: "no-constant-parameter",
        path: fn.path,
        line: fn.line,
        detail: `\`${fn.name}\` parameter \`${param.name}\` is never passed across ${String(stats.count)} calls; drop it`,
      });
    } else if (
      stats.count >= CONSTANT_CALL_FLOOR &&
      values.size === 1 &&
      !values.has("<expr>") &&
      !values.has("<omitted>")
    ) {
      const [only] = values;
      rows.push({
        kind: "no-constant-parameter",
        path: fn.path,
        line: fn.line,
        detail: `\`${fn.name}\` parameter \`${param.name}\` is always ${only ?? ""} across ${String(stats.count)} calls; inline it`,
      });
    }
  }
  return rows;
}

export function constantParameters(
  owned: ReadonlyMap<string, ts.SourceFile>,
  parsedAll: ReadonlyMap<string, ts.SourceFile>,
  graph: ImportGraph,
): TreeFinding[] {
  const byFile = exportedFunctionsOf(owned);
  const paths = new Set(parsedAll.keys());
  const statsMap = new Map<ExportedFn, CallStats>();
  for (const [path, fns] of byFile) {
    const star = graph.starProd.has(path) || graph.starTest.has(path);
    const forwarded = graph.reexported.get(path);
    for (const fn of fns.values()) {
      const reexported = forwarded?.has("*") === true || forwarded?.has(fn.name) === true;
      statsMap.set(fn, {
        count: 0,
        passed: fn.params.map(() => 0),
        values: fn.params.map(() => new Set()),
        escaped: star || reexported,
      });
    }
  }
  for (const [path, file] of parsedAll) {
    const local = visibleExportedFns(path, file, byFile, paths);
    if (local.size > 0) recordFileCalls(file, local, statsMap);
  }
  return [...statsMap].flatMap(([fn, stats]) => constantFindingsOf(fn, stats));
}

function typeMemberSignature(member: ts.TypeElement, file: ts.SourceFile): string | null {
  if (!ts.isPropertySignature(member) || !ts.isIdentifier(member.name) || member.type === undefined) {
    return null;
  }
  const opt = member.questionToken === undefined ? "" : "?";
  const typeText = member.type.getText(file).replaceAll(/\s+/gu, "");
  return `${member.name.text}${opt}:${typeText}`;
}

export function duplicateTypes(owned: ReadonlyMap<string, ts.SourceFile>): TreeFinding[] {
  const byFields = new Map<string, TypeSite[]>();
  for (const [path, file] of [...owned].toSorted(([a], [b]) => a.localeCompare(b))) {
    if (isTestPath(path) || fileOptedOut(file)) continue;
    for (const statement of file.statements) {
      let name: string | null = null;
      let members: readonly ts.TypeElement[] | null = null;
      if (ts.isInterfaceDeclaration(statement) && statement.heritageClauses === undefined) {
        name = statement.name.text;
        members = statement.members;
      } else if (ts.isTypeAliasDeclaration(statement) && ts.isTypeLiteralNode(statement.type)) {
        name = statement.name.text;
        members = statement.type.members;
      }
      if (name === null || members === null || members.length < DUPLICATE_TYPE_FIELDS) continue;
      const signatures = members.map((one) => typeMemberSignature(one, file));
      if (signatures.some((one) => one === null)) continue;
      const key = signatures
        .filter((one): one is string => one !== null)
        .toSorted()
        .join(", ");
      const site: TypeSite = { path, line: lineOf(file, statement), end: endLineOf(file, statement), name };
      const list = byFields.get(key);
      if (list === undefined) byFields.set(key, [site]);
      else list.push(site);
    }
  }
  return [...byFields].flatMap(([fields, sites]): TreeFinding[] => {
    if (new Set(sites.map((one) => one.path)).size < 2) return [];
    const [first, ...others] = sites;
    if (first === undefined) return [];
    const named = others
      .slice(0, NAMED_PLACES)
      .map((one) => `${one.path}:${String(one.line)} (\`${one.name}\`)`);
    const rest = others.length > NAMED_PLACES ? ` and ${String(others.length - NAMED_PLACES)} more` : "";
    return [
      {
        kind: "no-duplicate-type",
        path: first.path,
        line: first.line,
        detail: `\`${first.name}\` duplicates { ${fields} } also defined in ${named.join(", ")}${rest}`,
        places: sites.map(({ path, line, end }) => ({ path, line, end })),
      },
    ];
  });
}

function bindParamPattern(
  name: ts.BindingName,
  locals: Map<string, string>,
  tokens: string[],
  nextId: () => string,
  walk: (node: ts.Node) => void,
): void {
  if (ts.isIdentifier(name)) {
    const id = nextId();
    locals.set(name.text, id);
    tokens.push(id);
    return;
  }
  tokens.push(ts.isObjectBindingPattern(name) ? "{" : "[");
  for (const el of name.elements) {
    if (ts.isOmittedExpression(el)) {
      tokens.push(",");
      continue;
    }
    if (ts.isObjectBindingPattern(name)) {
      const prop = el.propertyName ?? el.name;
      if (ts.isIdentifier(prop) || ts.isStringLiteralLike(prop)) tokens.push(`K:${prop.text}`);
    }
    bindParamPattern(el.name, locals, tokens, nextId, walk);
    if (el.initializer !== undefined) {
      tokens.push("=");
      walk(el.initializer);
    }
  }
  tokens.push(ts.isObjectBindingPattern(name) ? "}" : "]");
}

function normalizedBody(callable: TopCallable): string[] {
  const locals = new Map<string, string>();
  let next = 0;
  const nextId = (prefix: "P" | "L"): string => {
    const id = `${prefix}${String(next)}`;
    next += 1;
    return id;
  };
  const tokens: string[] = [];
  const walk = (node: ts.Node): void => {
    if (ts.isTypeNode(node) || node.kind === K.TypeParameter) return;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && !locals.has(node.name.text)) {
      locals.set(node.name.text, nextId("L"));
    }
    if (ts.isIdentifier(node)) {
      const parent = node.parent;
      const prop =
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isPropertyAssignment(parent) && parent.name === node);
      tokens.push(!prop && locals.has(node.text) ? (locals.get(node.text) ?? node.text) : `N:${node.text}`);
    } else if (ts.isStringLiteralLike(node)) tokens.push(`S:${JSON.stringify(node.text)}`);
    else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      tokens.push(`T:${JSON.stringify(node.text)}`);
    } else if (ts.isNumericLiteral(node) || ts.isBigIntLiteral(node)) tokens.push(`#:${node.text}`);
    else if (ts.isRegularExpressionLiteral(node)) tokens.push(`R:${node.text}`);
    else if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) {
      tokens.push(`${String(node.kind)}:${String(node.operator)}`);
      walk(node.operand);
      tokens.push(")");
    } else {
      tokens.push(String(node.kind));
      ts.forEachChild(node, walk);
      tokens.push(")");
    }
  };
  for (const param of callable.node.parameters) {
    bindParamPattern(param.name, locals, tokens, () => nextId("P"), walk);
    if (param.initializer !== undefined) {
      tokens.push("=");
      walk(param.initializer);
    }
  }
  const bodyStart = tokens.length;
  if (callable.node.body !== undefined) walk(callable.node.body);
  return tokens.length - bodyStart >= DUPLICATE_FN_TOKENS ? tokens : [];
}

export function duplicateFunctions(owned: ReadonlyMap<string, ts.SourceFile>): TreeFinding[] {
  const byBody = new Map<string, FnSite[]>();
  for (const [path, file] of [...owned].toSorted(([a], [b]) => a.localeCompare(b))) {
    if (isTestPath(path) || fileOptedOut(file)) continue;
    for (const callable of topLevelCallables(file)) {
      const tokens = normalizedBody(callable);
      if (tokens.length === 0) continue;
      const key = tokens.join(" ");
      const site: FnSite = {
        path,
        line: callable.line,
        end: endLineOf(file, callable.node),
        name: callable.name,
        tokens: tokens.length,
      };
      const list = byBody.get(key);
      if (list === undefined) byBody.set(key, [site]);
      else list.push(site);
    }
  }
  return [...byBody.values()].flatMap((sites): TreeFinding[] => {
    if (new Set(sites.map((one) => one.path)).size < 2) return [];
    const [first, ...others] = sites;
    if (first === undefined) return [];
    const named = others
      .slice(0, NAMED_PLACES)
      .map((one) => `${one.path}:${String(one.line)} (\`${one.name}\`)`);
    const rest = others.length > NAMED_PLACES ? ` and ${String(others.length - NAMED_PLACES)} more` : "";
    return [
      {
        kind: "no-duplicate-function",
        path: first.path,
        line: first.line,
        detail: `\`${first.name}\` (${String(first.tokens)} tokens) duplicates ${named.join(", ")}${rest}`,
        places: sites.map(({ path, line, end }) => ({ path, line, end })),
      },
    ];
  });
}
