/**
 * A call into another file whose arguments are named for one another's parameters, crossed.
 *
 * `ana/no-transposed-argument` reads this shape where the callee is declared in the calling file,
 * since an oxlint rule sees one file and its plugin API offers no other module's declarations. Most
 * calls go to an import, so this scan reads the rest: a call by a named or namespace import of a
 * top-level function or `const` function, `new` of an imported class (its constructor's
 * parameters), and a call of a method of an imported object literal (`paths.relative(a, b)`). What
 * counts as crossed is the rule's own reading (`crossings`, `tools/oxlint/ana/shared/crossed.ts`),
 * so the two never disagree about a name. A call within one file is the rule's and is not read
 * here. A name declared twice in its file (overloads) has no one parameter list and is skipped.
 */
import * as ts from "typescript5";
import { crossings } from "./ana/shared/crossed.ts";
import type { TreeFinding } from "./tree-findings.ts";
import { parsedSources, resolved } from "./tree-overwritten-key.ts";

/** One parameter list a file declares, under the name a caller reaches it by. */
interface Declared {
  path: string;
  line: number;
  params: (string | null)[];
}

/** What an argument is named: an identifier, or the property that ends a member read. */
function argumentName(node: ts.Expression): string | null {
  if (ts.isIdentifier(node)) return node.text;
  return ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name) ? node.name.text : null;
}

function isFunctionValue(node: ts.Node | undefined): node is ts.ArrowFunction | ts.FunctionExpression {
  return node !== undefined && (ts.isArrowFunction(node) || ts.isFunctionExpression(node));
}

/** The methods of an object literal, under `object.method`. */
function methodsOf(
  object: string,
  literal: ts.ObjectLiteralExpression,
): [string, ts.SignatureDeclarationBase][] {
  return literal.properties.flatMap((property): [string, ts.SignatureDeclarationBase][] => {
    const name = property.name;
    if (name === undefined || !ts.isIdentifier(name)) return [];
    const key = `${object}.${name.text}`;
    if (ts.isMethodDeclaration(property)) return [[key, property]];
    if (ts.isPropertyAssignment(property) && isFunctionValue(property.initializer)) {
      return [[key, property.initializer]];
    }
    return [];
  });
}

/** The signatures a file's top level declares: functions, `const` functions, classes' constructors
 *  and object literals' methods, keyed by how a caller reaches them. */
function signaturesOf(file: ts.SourceFile): [string, ts.SignatureDeclarationBase][] {
  return file.statements.flatMap((statement): [string, ts.SignatureDeclarationBase][] => {
    if (ts.isFunctionDeclaration(statement) && statement.name !== undefined) {
      return [[statement.name.text, statement]];
    }
    if (ts.isClassDeclaration(statement) && statement.name !== undefined) {
      const built = statement.members.find(ts.isConstructorDeclaration);
      return built === undefined ? [] : [[`new ${statement.name.text}`, built]];
    }
    if (!ts.isVariableStatement(statement)) return [];
    return statement.declarationList.declarations.flatMap((one): [string, ts.SignatureDeclarationBase][] => {
      if (!ts.isIdentifier(one.name) || one.initializer === undefined) return [];
      if (isFunctionValue(one.initializer)) return [[one.name.text, one.initializer]];
      if (ts.isObjectLiteralExpression(one.initializer)) return methodsOf(one.name.text, one.initializer);
      return [];
    });
  });
}

/** Each file's parameter lists by the name a caller reaches them by, a name declared twice left out. */
function declaredIn(path: string, file: ts.SourceFile): Map<string, Declared> {
  const all = signaturesOf(file);
  const declared = new Map<string, Declared>();
  for (const [name, fn] of all) {
    if (all.filter(([other]) => other === name).length > 1) continue;
    const line = file.getLineAndCharacterOfPosition(fn.getStart(file)).line + 1;
    const params = fn.parameters.map((one) => (ts.isIdentifier(one.name) ? one.name.text : null));
    declared.set(name, { path, line, params });
  }
  return declared;
}

/** The file each imported binding of a file comes from, and the name it has there (`*` for a
 *  namespace import). */
function importsOf(path: string, file: ts.SourceFile, files: ReadonlySet<string>) {
  const bound = new Map<string, { home: string; name: string }>();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const home = resolved(path, statement.moduleSpecifier.text, files);
    const bindings = statement.importClause?.namedBindings;
    if (home === undefined || bindings === undefined) continue;
    if (ts.isNamespaceImport(bindings)) bound.set(bindings.name.text, { home, name: "*" });
    else {
      for (const element of bindings.elements) {
        bound.set(element.name.text, { home, name: (element.propertyName ?? element.name).text });
      }
    }
  }
  return bound;
}

/** The name a callee is declared by in its own file, and the local binding it is reached through. */
function reachOf(node: ts.CallExpression | ts.NewExpression): { local: string; rest: string } | null {
  const callee = node.expression;
  if (ts.isIdentifier(callee)) return { local: callee.text, rest: "" };
  if (ts.isNewExpression(node) || !ts.isPropertyAccessExpression(callee)) return null;
  return ts.isIdentifier(callee.expression)
    ? { local: callee.expression.text, rest: callee.name.text }
    : null;
}

/** Every call into another file whose arguments cross the callee's parameters. */
export function crossedArguments(files: ReadonlyMap<string, string>): TreeFinding[] {
  const parsed = parsedSources(files);
  const paths = new Set(parsed.keys());
  const byFile = new Map([...parsed].map(([path, file]) => [path, declaredIn(path, file)]));
  const rows: TreeFinding[] = [];
  for (const [path, file] of parsed) {
    const bound = importsOf(path, file, paths);
    if (bound.size === 0) continue;
    const lookUp = (node: ts.CallExpression | ts.NewExpression): Declared | undefined => {
      const reach = reachOf(node);
      const from = reach === null ? undefined : bound.get(reach.local);
      if (reach === null || from === undefined) return undefined;
      const prefix = ts.isNewExpression(node) ? "new " : "";
      const name = from.name === "*" ? reach.rest : [from.name, reach.rest].filter(Boolean).join(".");
      return name === "" ? undefined : byFile.get(from.home)?.get(`${prefix}${name}`);
    };
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const args = node.arguments ?? ts.factory.createNodeArray();
        const declared = args.some(ts.isSpreadElement) ? undefined : lookUp(node);
        if (declared !== undefined) {
          const names = args.map(argumentName);
          for (const crossing of crossings(names, declared.params)) {
            const given = crossing.map((i) => `\`${names[i] ?? ""}\` at \`${declared.params[i] ?? ""}\``);
            rows.push({
              kind: "crossed-argument",
              path,
              line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
              detail: `\`${node.expression.getText(file)}\` (${declared.path}:${declared.line}) receives ${given.join(", ")}: each argument is named for the parameter of another`,
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return rows;
}
