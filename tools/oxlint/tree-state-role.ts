/**
 * Whether a set of literals that readers group by hand is a state or an enumeration of kinds, for
 * the literal kinds of `tools/oxlint/tree-implicit-state.ts`.
 */
import * as ts from "typescript5";
import { setterState } from "./implicit-state/shared/syntax.ts";

export interface LiteralSet {
  values: ReadonlySet<string>;
  subjects: readonly string[];
}

interface Write {
  text: string;
  at: ts.Expression;
  target: string;
}

const K = ts.SyntaxKind;
const ROOT = "/";
const TRANSPARENT = new Set([K.ParenthesizedExpression, K.AsExpression, K.SatisfiesExpression]);
const FALLBACK_OPS = new Set([K.QuestionQuestionToken, K.BarBarToken]);

const lastWord = (subject: string): string => /(\w+)\W*$/u.exec(subject)?.[1] ?? subject;

const setterOf = (callee: ts.Expression): string | null =>
  setterState(
    ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : null,
  );

function standing(literal: ts.Expression): ts.Expression {
  let at: ts.Expression = literal;
  for (;;) {
    const { parent } = at;
    const through =
      TRANSPARENT.has(parent.kind) ||
      (ts.isConditionalExpression(parent) && parent.condition !== at) ||
      (ts.isBinaryExpression(parent) && parent.right === at && FALLBACK_OPS.has(parent.operatorToken.kind));
    if (!through) return at;
    // SAFETY: `through` holds only for expression parents (transparent wrappers, conditional, binary).
    at = parent as ts.Expression;
  }
}

function updates(object: ts.ObjectLiteralExpression): boolean {
  const { parent } = object;
  const toSetter =
    ts.isCallExpression(parent) && parent.arguments.includes(object) && setterOf(parent.expression) !== null;
  return toSetter || object.properties.some(ts.isSpreadAssignment);
}

function targetOf(at: ts.Expression): string | null {
  const { parent } = at;
  if (ts.isBinaryExpression(parent) && parent.right === at && parent.operatorToken.kind === K.EqualsToken) {
    return lastWord(parent.left.getText());
  }
  if (ts.isCallExpression(parent) && parent.arguments.includes(at)) return setterOf(parent.expression);
  if (
    ts.isPropertyAssignment(parent) &&
    parent.initializer === at &&
    ts.isObjectLiteralExpression(parent.parent)
  ) {
    return updates(parent.parent) ? lastWord(parent.name.getText()) : null;
  }
  return null;
}

function writesIn(sources: ReadonlyMap<string, ts.SourceFile>, wanted: ReadonlySet<string>): Write[] {
  const found: Write[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isTypeNode(node)) return;
    if (ts.isStringLiteralLike(node) && wanted.has(node.text)) {
      const at = standing(node);
      const target = targetOf(at);
      if (target !== null) found.push({ text: node.text, at, target });
    }
    ts.forEachChild(node, visit);
  };
  for (const file of sources.values()) visit(file);
  return found;
}

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

function literalsOf(type: ts.Type | undefined): Set<string> {
  if (type === undefined) return new Set();
  if (type.isUnionOrIntersection()) return new Set(type.types.flatMap((one) => [...literalsOf(one)]));
  return type.isStringLiteral() ? new Set([type.value]) : new Set();
}

/** For each set, whether it is a state (building the type checker only where syntactic targets leave any unresolved). */
export function statefulSets(
  sources: ReadonlyMap<string, ts.SourceFile>,
  sets: readonly LiteralSet[],
): boolean[] {
  if (sets.length === 0) return [];
  const wanted = new Set(sets.flatMap((one) => [...one.values]));
  const writes = writesIn(sources, wanted);
  if (writes.length === 0) return sets.map(() => false);
  const syntactic = sets.map(({ values, subjects }) => {
    const names = new Set(subjects.map(lastWord));
    return writes.some((write) => values.has(write.text) && names.has(write.target));
  });
  const unresolved = sets.some(
    ({ values }, index) => syntactic[index] !== true && writes.some((write) => values.has(write.text)),
  );
  if (!unresolved) return syntactic;
  const checker = checkerOver(sources);
  const typed = writes.map((write) => ({
    ...write,
    spelled: literalsOf(checker.getContextualType(write.at)),
  }));
  return sets.map(
    ({ values }, index) =>
      syntactic[index] === true ||
      typed.some(
        (write) =>
          values.has(write.text) && [...values].filter((value) => write.spelled.has(value)).length >= 2,
      ),
  );
}
