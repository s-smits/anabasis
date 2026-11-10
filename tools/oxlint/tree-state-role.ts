/**
 * Whether a set of literals that readers group by hand is a state or an enumeration of kinds, for
 * the literal kinds of `tools/oxlint/tree-implicit-state.ts`. A state changes: some value of it is
 * written where a value is replaced. An enumeration names what a thing is and stays as it was read:
 * a file extension, an HTTP method, the direction of a handle, the role on a chat message. Both are
 * grouped by hand the same way, so the syntax of the grouping cannot tell them apart; where the
 * literals are written can.
 *
 * A set reads as a state when one of its literals is written in an update: the right side of an
 * assignment (`job.state = "done"`), the argument of a setter (`setStatus("done")`), or a property
 * of an object that updates another (`{ ...element, type: "arrow" }`) or is handed to a setter
 * (`setState({ mode: "edit" })`). The write has to land in the set's own place: the type the
 * compiler expects there (its contextual type) spells two or more of the set's literals, or, where
 * the type is not known, the place has the name the readers compare (`status` for
 * `issue.status === "closed"`). An object created whole, a value returned and a comparison write
 * nothing, so a set written only there is an enumeration.
 *
 * The types come from the TypeScript compiler API over the files already parsed for the syntactic
 * scan, so nothing is parsed twice, and the program is built only where a candidate write exists.
 * It loads no library and resolves relative imports alone, so a type behind a path alias or a
 * package reads as unknown and the name decides. `"persisted"` (written to a file or a store) is
 * not read: such a value is written first, which is what this reads.
 */
import * as ts from "typescript5";
import { setterState } from "./implicit-state/shared/syntax.ts";

/** One set the syntactic scan found, with the subjects its readers compare. */
export interface LiteralSet {
  values: ReadonlySet<string>;
  subjects: readonly string[];
}

/** One literal written in an update, with the name of the place it lands in. */
interface Write {
  text: string;
  at: ts.Expression;
  target: string;
}

const ROOT = "/";

/** The last word of a compared subject: `status` for `issue.status`, `kind` for `a?.kind()`. */
const lastWord = (subject: string): string => /(\w+)\W*$/u.exec(subject)?.[1] ?? subject;

/** The state a call's setter sets, by its name or its method's name. */
const setterOf = (callee: ts.Expression): string | null =>
  setterState(
    ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : null,
  );

/** The expression a literal stands as: climbed through parentheses, a ternary's arm, `as`, `??`
 *  and `||`, so `x = ready ? "done" : "failed"` writes both. */
function standing(literal: ts.Expression): ts.Expression {
  let at: ts.Expression = literal;
  for (;;) {
    const { parent } = at;
    const through =
      ts.isParenthesizedExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isSatisfiesExpression(parent) ||
      (ts.isConditionalExpression(parent) && parent.condition !== at) ||
      (ts.isBinaryExpression(parent) &&
        parent.right === at &&
        [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(parent.operatorToken.kind));
    if (!through) {
      return at;
    }
    at = parent;
  }
}

/** Whether an object literal updates a value: it spreads one, or a setter receives it. */
function updates(object: ts.ObjectLiteralExpression): boolean {
  const { parent } = object;
  const toSetter =
    ts.isCallExpression(parent) && parent.arguments.includes(object) && setterOf(parent.expression) !== null;
  return toSetter || object.properties.some(ts.isSpreadAssignment);
}

/** The name of the place a literal is written in an update, or null where it writes nothing. */
function targetOf(at: ts.Expression): string | null {
  const { parent } = at;
  if (
    ts.isBinaryExpression(parent) &&
    parent.right === at &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
  ) {
    return lastWord(parent.left.getText());
  }
  if (ts.isCallExpression(parent) && parent.arguments.includes(at)) {
    return setterOf(parent.expression);
  }
  if (
    ts.isPropertyAssignment(parent) &&
    parent.initializer === at &&
    ts.isObjectLiteralExpression(parent.parent)
  ) {
    return updates(parent.parent) ? lastWord(parent.name.getText()) : null;
  }
  return null;
}

/** Every literal of `wanted` written in an update, over the files the scan reads. */
function writesIn(sources: ReadonlyMap<string, ts.SourceFile>, wanted: ReadonlySet<string>): Write[] {
  const found: Write[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node) && wanted.has(node.text)) {
      const at = standing(node);
      const target = targetOf(at);
      if (target !== null) {
        found.push({ text: node.text, at, target });
      }
    }
    ts.forEachChild(node, visit);
  };
  for (const file of sources.values()) {
    visit(file);
  }
  return found;
}

/** A checker over the parsed files, reading no library and resolving relative imports alone. */
function checkerOver(sources: ReadonlyMap<string, ts.SourceFile>): ts.TypeChecker {
  const options: ts.CompilerOptions = {
    noLib: true,
    types: [],
    noEmit: true,
    allowImportingTsExtensions: true,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.Latest,
    jsx: ts.JsxEmit.Preserve,
  };
  const byName = new Map([...sources].map(([path, file]) => [`${ROOT}${path}`, file]));
  const host = ts.createCompilerHost(options);
  host.getCurrentDirectory = () => ROOT;
  host.fileExists = (name) => byName.has(name);
  host.readFile = (name) => byName.get(name)?.text;
  host.directoryExists = () => true;
  host.getSourceFile = (name) => byName.get(name);
  return ts.createProgram({ rootNames: [...byName.keys()], options, host }).getTypeChecker();
}

/** The string literals a type spells, through unions and intersections. */
function literalsOf(type: ts.Type | undefined): Set<string> {
  if (type === undefined) {
    return new Set();
  }
  if (type.isUnionOrIntersection()) {
    return new Set(type.types.flatMap((one) => [...literalsOf(one)]));
  }
  return type.isStringLiteral() ? new Set([type.value]) : new Set();
}

/**
 * For each set, whether it is a state: a literal of it written in an update to a place typed by two
 * or more of its literals, or named as its readers' subject. The checker is built only where some
 * literal is written in an update at all.
 */
export function statefulSets(
  sources: ReadonlyMap<string, ts.SourceFile>,
  sets: readonly LiteralSet[],
): boolean[] {
  const wanted = new Set(sets.flatMap((one) => [...one.values]));
  const writes = writesIn(sources, wanted);
  if (writes.length === 0) {
    return sets.map(() => false);
  }
  const checker = checkerOver(sources);
  const typed = writes.map((write) => ({
    ...write,
    spelled: literalsOf(checker.getContextualType(write.at)),
  }));
  return sets.map(({ values, subjects }) => {
    const names = new Set(subjects.map(lastWord));
    return typed.some(
      (write) =>
        values.has(write.text) &&
        ([...values].filter((value) => write.spelled.has(value)).length >= 2 || names.has(write.target)),
    );
  });
}
