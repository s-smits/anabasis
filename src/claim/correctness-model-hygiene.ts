/**
 * Reject direct process loading and ambient-environment forwarding in authored verifier source
 * before bundling. External execution belongs to the verifier host; the confined evaluator
 * process remains a separate runtime boundary.
 */
import { sha256 } from "../meta/digest.ts";
import { readFileSync } from "../meta/filesystem.ts";
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { join } from "../meta/path.ts";
import * as ts from "typescript5";
import type { BundleFile } from "./bundle-hash.ts";
import { parseGeneratedSource, specifiersIn } from "./bundle-validation.ts";

type GeneratedCorrectnessModelCapabilityEscapeKind = "child-process" | "ambient-environment-spread";

interface GeneratedCorrectnessModelCapabilityEscape {
  kind: GeneratedCorrectnessModelCapabilityEscapeKind;
  token: string;
  position: number;
}

const CODE_EXTENSION = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;
const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;

/** One agent module and one correctness-model module carrying the same computations. */
interface SharedDecidingComputation {
  agentFile: string;
  correctnessModelFile: string;
  /** The correctness-model names of the shared computations, sorted. */
  shared: string[];
}

/** How many computations two modules must share before the agent counts as carrying the deciding
 *  one. Measured: across the 386 recorded bundles under `campaigns/`, 351 share none and 35 share
 *  five or more, so the band from one to four is empty. The name comparison this replaced split
 *  that corpus identically, so no recorded verdict moves. The identity below was narrowed on
 *  2026-09-20 to stop collapsing distinct named operations; a narrower identity can only drop
 *  collisions, and a genuine copy keeps the globals and members that now separate them. */
const SHARED_COMPUTATION_FLOOR = 2;

function unwrapParentheses(node: ts.Expression): ts.Expression {
  let current = node;
  while (ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

/** The member name (null when computed) and target of `a.b` or `a["b"]`. */
function memberAccess(node: ts.Expression): { name: string | null; target: ts.Expression } | null {
  const expression = unwrapParentheses(node);
  if (ts.isPropertyAccessExpression(expression)) {
    return { name: expression.name.text, target: expression.expression };
  }
  if (!ts.isElementAccessExpression(expression)) return null;
  const argument = expression.argumentExpression;
  return { name: ts.isStringLiteralLike(argument) ? argument.text : null, target: expression.expression };
}

function bindsProcess(name: ts.BindingName): boolean {
  if (ts.isIdentifier(name)) return name.text === "process";
  return name.elements.some((element) => !ts.isOmittedExpression(element) && bindsProcess(element.name));
}

function listBindsProcess(list: ts.VariableDeclarationList): boolean {
  return list.declarations.some((declaration) => bindsProcess(declaration.name));
}

function statementDeclaresProcess(statement: ts.Statement): boolean {
  if (ts.isVariableStatement(statement)) return listBindsProcess(statement.declarationList);
  if (ts.isImportDeclaration(statement)) {
    const clause = statement.importClause;
    const bindings = clause?.namedBindings;
    const names =
      bindings === undefined
        ? []
        : ts.isNamespaceImport(bindings)
          ? [bindings.name]
          : bindings.elements.map((element) => element.name);
    return [clause?.name, ...names].some((name) => name?.text === "process");
  }
  const named =
    ts.isFunctionDeclaration(statement) ||
    ts.isClassDeclaration(statement) ||
    ts.isEnumDeclaration(statement) ||
    ts.isImportEqualsDeclaration(statement);
  return named && statement.name?.text === "process";
}

/** Whether this node opens a scope that declares its own `process` value. */
function scopeDeclaresProcess(node: ts.Node): boolean {
  if (ts.isSourceFile(node) || ts.isBlock(node)) return node.statements.some(statementDeclaresProcess);
  if (ts.isFunctionLike(node)) {
    return (
      node.parameters.some((parameter) => bindsProcess(parameter.name)) ||
      (ts.isFunctionExpression(node) && node.name?.text === "process")
    );
  }
  if (ts.isCatchClause(node)) {
    return node.variableDeclaration !== undefined && bindsProcess(node.variableDeclaration.name);
  }
  const initializer =
    ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node)
      ? node.initializer
      : undefined;
  return (
    initializer !== undefined && ts.isVariableDeclarationList(initializer) && listBindsProcess(initializer)
  );
}

function isGlobalProcess(node: ts.Expression): boolean {
  const expression = unwrapParentheses(node);
  if (ts.isIdentifier(expression)) {
    for (let scope: ts.Node | undefined = expression.parent; scope !== undefined; scope = scope.parent) {
      if (scopeDeclaresProcess(scope)) return false;
    }
    return expression.text === "process";
  }
  const access = memberAccess(expression);
  const target = access === null ? null : unwrapParentheses(access.target);
  return (
    access?.name === "process" &&
    target !== null &&
    ts.isIdentifier(target) &&
    ["globalThis", "global"].includes(target.text)
  );
}

function isProcessEnvironment(node: ts.Expression): boolean {
  const access = memberAccess(node);
  return access?.name === "env" && isGlobalProcess(access.target);
}

/** Find direct child-process imports and process.env spreads in generated correctness-model code. */
export function generatedCorrectnessModelCapabilityEscapes(
  sourceFile: ts.SourceFile,
): GeneratedCorrectnessModelCapabilityEscape[] {
  const candidates: GeneratedCorrectnessModelCapabilityEscape[] = [];
  for (const load of specifiersIn(sourceFile).loads.filter(({ text }) =>
    ["child_process", "node:child_process"].includes(text),
  )) {
    candidates.push({ kind: "child-process", token: load.text, position: load.getStart(sourceFile) });
  }
  const visit = (node: ts.Node): void => {
    if ((ts.isSpreadAssignment(node) || ts.isSpreadElement(node)) && isProcessEnvironment(node.expression)) {
      candidates.push({
        kind: "ambient-environment-spread",
        token: sourceFile.text.slice(node.getStart(sourceFile), node.end),
        position: node.getStart(sourceFile),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  candidates.sort((left, right) => left.position - right.position);
  return candidates;
}

function isBundleCode(file: BundleFile): boolean {
  return CODE_EXTENSION.test(file.path);
}

/** Correctness-model files this scan reads: authored modules, never the Builder's own tests, which
 *  sit outside the verifier's runtime closure. Agent modules are read whatever they are named,
 *  since a `.test.ts` there is an ordinary module a registered tool can import. */
export function scannableBundleSource(file: BundleFile): boolean {
  return isBundleCode(file) && !TEST_FILE.test(file.path);
}

/** Every name the module itself declares: imports, types, functions, parameters, locals and the
 *  names a binding pattern introduces. These are what a copier renames, so these are the ones a
 *  computation's identity may not depend on. */
function declaredNames(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const add = (name: ts.Node | undefined): void => {
    if (name === undefined) return;
    if (ts.isIdentifier(name)) names.add(name.text);
    else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
      for (const element of name.elements) if (ts.isBindingElement(element)) add(element.name);
    }
  };
  const visit = (node: ts.Node): void => {
    if (
      ts.isParameter(node) ||
      ts.isVariableDeclaration(node) ||
      ts.isBindingElement(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isEnumDeclaration(node) ||
      ts.isTypeParameterDeclaration(node) ||
      ts.isImportSpecifier(node) ||
      ts.isImportClause(node) ||
      ts.isNamespaceImport(node) ||
      ts.isModuleDeclaration(node)
    ) {
      add(node.name);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return names;
}

/** An identifier naming a member rather than a binding: `Math.min`, `{ min: 1 }`, `{ span: number }`.
 *  Renaming it changes what the computation does, so its spelling is part of the identity. */
function isMemberName(node: ts.Identifier, parent: ts.Node | null): boolean {
  if (parent === null) return false;
  if (ts.isPropertyAccessExpression(parent)) return parent.name === node;
  if (ts.isQualifiedName(parent)) return parent.right === node;
  if (
    ts.isPropertyAssignment(parent) ||
    ts.isPropertySignature(parent) ||
    ts.isPropertyDeclaration(parent) ||
    ts.isMethodDeclaration(parent) ||
    ts.isMethodSignature(parent) ||
    ts.isEnumMember(parent)
  ) {
    return parent.name === node;
  }
  return false;
}

/** One identifier's part of the identity: an ordinal when the module declares the name, and the
 *  name itself otherwise. Until 2026-09-20 every identifier became an ordinal, which made
 *  `Math.min` and `Math.max` one computation — two agent-side computations that differed only in
 *  the named operation they called then reached the floor below and refused a valid bundle. */
function identifierPart(
  node: ts.Identifier,
  parent: ts.Node | null,
  declared: ReadonlySet<string>,
  seen: Map<string, number>,
): string {
  if (isMemberName(node, parent) || !declared.has(node.text)) return `n:${node.text}`;
  const index = seen.get(node.text) ?? seen.size;
  seen.set(node.text, index);
  return `i${index}`;
}

/** A computation's identity with its renameable spellings removed: node kinds in source order,
 *  each module-declared identifier replaced by the order it first appears in, every other name and
 *  every literal kept, because a copied formula keeps its constants, its globals and the members it
 *  reaches for. Renaming an export, type, parameter or local leaves it unchanged. */
function computationId(root: ts.Node, declared: ReadonlySet<string>): string {
  const seen = new Map<string, number>();
  const parts: string[] = [];
  const visit = (node: ts.Node, parent: ts.Node | null): void => {
    if (ts.isIdentifier(node)) {
      parts.push(identifierPart(node, parent, declared, seen));
    } else if (ts.isStringLiteral(node) || ts.isNumericLiteral(node)) {
      parts.push(`l${String(node.kind)}:${capturedJsonStringify(node.text)}`);
    } else {
      parts.push(String(node.kind));
    }
    ts.forEachChild(node, (child) => visit(child, node));
  };
  visit(root, null);
  return sha256(parts.join(","));
}

/** One file's exported computations, keyed by identity and named for the report. A shared
 *  interface or schema constant is the representation contract the two bundles are required to
 *  agree on (rule 13); only a shared computation is the finding. */
function computationsOf(dir: string, file: BundleFile): Map<string, string> {
  const source = parseGeneratedSource(readFileSync(join(dir, file.path), "utf8"), file.path);
  const declared = declaredNames(source);
  return new Map(
    source.statements.flatMap((statement) => {
      const exported =
        ts.canHaveModifiers(statement) &&
        (ts.getModifiers(statement) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
      if (!exported) return [];
      if (ts.isFunctionDeclaration(statement)) {
        return statement.name === undefined
          ? []
          : [[computationId(statement, declared), statement.name.text] as const];
      }
      if (!ts.isVariableStatement(statement)) return [];
      return statement.declarationList.declarations.flatMap((declaration) => {
        const value = declaration.initializer;
        const isFunction =
          value !== undefined && (ts.isArrowFunction(value) || ts.isFunctionExpression(value));
        return isFunction && ts.isIdentifier(declaration.name)
          ? [[computationId(value, declared), declaration.name.text] as const]
          : [];
      });
    }),
  );
}

/**
 * Agent modules carrying the verifier's own computation. `bundle-validation` closes the import
 * route; a copy leaves no import to find, and two runs on 2026-09-18 shipped exactly that.
 * Comparing structure rather than name closes the cheapest way out of this refusal, a rename of
 * the copied exports. A partly rewritten computation is still not detected, and scoring a
 * candidate the solver already wrote against published limits is legitimate support (rule 9),
 * which is why the floor is several computations, not one.
 */
export function agentCarriesDecidingComputation(
  agentDir: string,
  agentFiles: readonly BundleFile[],
  correctnessModelDir: string,
  correctnessModelFiles: readonly BundleFile[],
): SharedDecidingComputation[] {
  const deciding = correctnessModelFiles.flatMap((file) =>
    scannableBundleSource(file) ? [{ path: file.path, own: computationsOf(correctnessModelDir, file) }] : [],
  );
  const found: SharedDecidingComputation[] = [];
  for (const file of agentFiles.filter(isBundleCode)) {
    const mine = computationsOf(agentDir, file);
    for (const other of deciding) {
      const shared = [...mine.keys()].flatMap((id) => other.own.get(id) ?? []).sort();
      if (shared.length >= SHARED_COMPUTATION_FLOOR) {
        found.push({ agentFile: file.path, correctnessModelFile: other.path, shared });
      }
    }
  }
  return found;
}
