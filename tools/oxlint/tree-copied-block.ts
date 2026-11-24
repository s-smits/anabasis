/**
 * Two or more consecutive statements written out at two or more places, once the names each
 * function binds for itself and every literal are abstracted away.
 */
import * as ts from "typescript5";
import type { TreeFinding } from "./tree-findings.ts";

const K = ts.SyntaxKind;
const SKIPPED_PATH =
  /(?:^|\/)(?:test|tests|__tests__|fixtures?|__mocks__)\/|\.(?:test|spec)\.|(?:^|\/)(?:vendor|vendored|third[-_]party|migrations?|examples?)\/|(?:^|[/._-])legacy[._-][^/]*$/iu;
/** A file's opening comment when nobody edits it by hand, or it is kept as its upstream wrote it. */
export const OPTED_OUT =
  /@ts-nocheck|@generated\b|\bauto-?generated\b|\bdo not edit\b|^\/\/\s*vendored from\s+\S/iu;
const WORDY = /\p{L}{3}/u;
const TOKEN_FLOOR = 64;
const LINE_FLOOR = 3;
const DIVERGENT_WORDS = 5;
const DATA_SHARE = 0.5;
const NAMED_PLACES = 3;

const DECL_KINDS = new Set([K.VariableDeclaration, K.Parameter, K.BindingElement]);
const NAMED_KINDS = new Set([K.FunctionDeclaration, K.ClassDeclaration]);
const METHOD_KINDS = new Set([K.FunctionDeclaration, K.MethodDeclaration]);
const FN_VALUE_KINDS = new Set([K.ArrowFunction, K.FunctionExpression]);
const STRING_KINDS = new Set([K.StringLiteral, K.NoSubstitutionTemplateLiteral]);
const PROP_KINDS = new Set([K.PropertyAccessExpression, K.PropertyAssignment]);
const WRAPPER_KINDS = new Set([
  K.AsExpression,
  K.SatisfiesExpression,
  K.NonNullExpression,
  K.ParenthesizedExpression,
]);
const BLOCK_KINDS = new Set([K.Block, K.CaseClause, K.DefaultClause]);
const LITERAL_KINDS = new Set([
  K.StringLiteral,
  K.NumericLiteral,
  K.NoSubstitutionTemplateLiteral,
  K.TemplateHead,
  K.TemplateMiddle,
  K.TemplateTail,
]);
const DATA_KINDS = new Set([K.ObjectLiteralExpression, K.ArrayLiteralExpression]);

interface Place {
  path: string;
  host: string;
  statements: readonly ts.Statement[];
  first: number;
  last: number;
  tokens: number;
  line: number;
  end: number;
}

/** Every name a function binds for itself: parameters, locals, nested declarations, catch variables. */
export function boundNames(fn: ts.FunctionLikeDeclaration): Set<string> {
  const names = new Set<string>();
  const bind = (name: ts.BindingName): void => {
    if (ts.isIdentifier(name)) names.add(name.text);
    else for (const element of name.elements) if (!ts.isOmittedExpression(element)) bind(element.name);
  };
  const walk = (node: ts.Node): void => {
    if (DECL_KINDS.has(node.kind)) {
      // SAFETY: `DECL_KINDS` enumerates the three declarations carrying `.name: ts.BindingName`.
      bind((node as ts.VariableDeclaration).name);
    } else if (NAMED_KINDS.has(node.kind)) {
      // SAFETY: `NAMED_KINDS` enumerates `FunctionDeclaration` and `ClassDeclaration`.
      const name = (node as ts.FunctionDeclaration).name;
      if (name !== undefined) names.add(name.text);
    } else if (ts.isCatchClause(node) && node.variableDeclaration !== undefined) {
      bind(node.variableDeclaration.name);
    }
    ts.forEachChild(node, walk);
  };
  for (const parameter of fn.parameters) bind(parameter.name);
  if (fn.body !== undefined) walk(fn.body);
  return names;
}

const pushMap = <Key, Value>(map: Map<Key, Value[]>, key: Key, item: Value) => {
  const list = map.get(key);
  if (list === undefined) map.set(key, [item]);
  else list.push(item);
};

function hostsOf(file: ts.SourceFile): [string, ts.FunctionLikeDeclaration][] {
  const hosts: [string, ts.FunctionLikeDeclaration][] = [];
  const visit = (node: ts.Node): void => {
    if (METHOD_KINDS.has(node.kind)) {
      // SAFETY: `METHOD_KINDS` enumerates `FunctionDeclaration` and `MethodDeclaration`.
      const fn = node as ts.FunctionDeclaration | ts.MethodDeclaration;
      if (fn.body !== undefined && fn.name !== undefined && ts.isIdentifier(fn.name)) {
        hosts.push([fn.name.text, fn]);
      }
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      FN_VALUE_KINDS.has(node.initializer.kind)
    ) {
      // SAFETY: `FN_VALUE_KINDS` enumerates `ArrowFunction` and `FunctionExpression`.
      hosts.push([node.name.text, node.initializer as ts.ArrowFunction | ts.FunctionExpression]);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return hosts;
}

function spell(node: ts.Node, bound: ReadonlySet<string>, out: string[]): string[] {
  if (ts.isTypeNode(node) || node.kind === K.TypeParameter) return out;
  if (ts.isIdentifier(node)) {
    const { parent } = node;
    // SAFETY: `PROP_KINDS` enumerates `PropertyAccessExpression` and `PropertyAssignment`, both having `.name`.
    const field = PROP_KINDS.has(parent.kind) && (parent as ts.PropertyAccessExpression).name === node;
    out.push(bound.has(node.text) && !field ? "I" : `N:${node.text}`);
  } else if (STRING_KINDS.has(node.kind)) out.push("S");
  else if (node.kind === K.NumericLiteral) out.push("#");
  else if (WRAPPER_KINDS.has(node.kind)) {
    // SAFETY: every kind in `WRAPPER_KINDS` wraps an `.expression: ts.Expression`.
    spell((node as ts.ParenthesizedExpression).expression, bound, out);
  } else {
    out.push(String(node.kind));
    ts.forEachChild(node, (child) => {
      spell(child, bound, out);
    });
    out.push(")");
  }
  return out;
}

function unitsOf(path: string, file: ts.SourceFile, into: Map<string, Place[]>): void {
  const lineOf = (position: number): number => file.getLineAndCharacterOfPosition(position).line + 1;
  for (const [host, fn] of hostsOf(file)) {
    const bound = boundNames(fn);
    const runs = (statements: readonly ts.Statement[]): void => {
      const spelled = statements.map((statement) => {
        const parts = spell(statement, bound, []);
        return {
          text: parts.join(" "),
          tokens: parts.length,
          line: lineOf(statement.getStart(file)),
          end: lineOf(statement.getEnd()),
        };
      });
      for (const [first, start] of spelled.entries()) {
        let [key, tokens] = [start.text, start.tokens];
        for (let last = first + 1; last < spelled.length; last += 1) {
          const stop = spelled[last];
          if (stop === undefined) break;
          key = Bun.hash(`${key}|${stop.text}`).toString(36);
          tokens += stop.tokens;
          if (tokens >= TOKEN_FLOOR) {
            pushMap(into, key, {
              path,
              host,
              statements,
              first,
              last,
              tokens,
              line: start.line,
              end: stop.end,
            });
          }
        }
      }
    };
    const collect = (node: ts.Node): void => {
      if (BLOCK_KINDS.has(node.kind)) {
        // SAFETY: `BLOCK_KINDS` enumerates `Block`, `CaseClause`, and `DefaultClause`, all having `.statements`.
        runs((node as ts.Block).statements);
      }
      if (node === fn.body || !ts.isFunctionLike(node)) ts.forEachChild(node, collect);
    };
    if (fn.body !== undefined) collect(fn.body);
  }
}

function contentOf(place: Place): { literals: string[]; data: number } {
  const literals: string[] = [];
  let [nodes, data] = [0, 0];
  const walk = (node: ts.Node, within: "data" | "code"): void => {
    if (ts.isTypeNode(node) || node.kind === K.TypeParameter) return;
    nodes += 1;
    data += Number(within === "data");
    if (LITERAL_KINDS.has(node.kind)) {
      // SAFETY: every kind in `LITERAL_KINDS` is a literal token carrying `.text: string`.
      literals.push((node as ts.LiteralLikeNode).text);
      return;
    }
    const next = DATA_KINDS.has(node.kind) ? "data" : within;
    ts.forEachChild(node, (child) => {
      walk(child, next);
    });
  };
  for (const statement of place.statements.slice(place.first, place.last + 1)) walk(statement, "code");
  return { literals, data: data / Math.max(nodes, 1) };
}

function saysDifferentThings(places: readonly Place[]): boolean {
  const [first, ...others] = places.map(contentOf);
  if (first === undefined || first.literals.length === 0) return false;
  const differing = first.literals.filter((literal, index) =>
    others.some((other) => other.literals[index] !== literal),
  );
  return (
    differing.filter((literal) => WORDY.test(literal)).length >= DIVERGENT_WORDS ||
    (first.data >= DATA_SHARE && differing.length / first.literals.length >= DATA_SHARE)
  );
}

/** One row per copied block, at its first place, naming the others. */
export function copiedBlocks(parsed: ReadonlyMap<string, ts.SourceFile>): TreeFinding[] {
  const groups = new Map<string, Place[]>();
  for (const [path, file] of [...parsed].toSorted(([a], [b]) => a.localeCompare(b))) {
    if (SKIPPED_PATH.test(path)) continue;
    if (!OPTED_OUT.test(file.text.slice(0, file.statements[0]?.getStart(file)))) unitsOf(path, file, groups);
  }
  const taken = new Map<string, Place[]>();
  const overlaps = (one: Place, other: Place): boolean =>
    one.path === other.path && one.line <= other.end && other.line <= one.end;
  const covered = (place: Place): boolean =>
    (taken.get(place.path) ?? []).some((big) => big.line <= place.line && place.end <= big.end);
  const tokensOf = (group: readonly Place[]) => group[0]?.tokens ?? 0;
  const rows: TreeFinding[] = [];
  for (const group of [...groups.values()]
    .filter((one) => one.length > 1)
    .toSorted((a, b) => tokensOf(b) - tokensOf(a))) {
    const distinct = group.filter(
      (place, index) => group.findIndex((other) => overlaps(place, other)) === index,
    );
    if (distinct.length < 2 || distinct.every(covered)) continue;
    for (const place of distinct) pushMap(taken, place.path, place);
    const packages = Map.groupBy(distinct, (place) => /^packages\/[^/]+\//u.exec(place.path)?.[0] ?? "");
    const kept = [...packages.values()]
      .reduce((best, one) => (one.length > best.length ? one : best), [])
      .toSorted((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
    const [first, ...others] = kept;
    if (
      first === undefined ||
      others.length === 0 ||
      kept.some((place) => place.end - place.line + 1 < LINE_FLOOR) ||
      saysDifferentThings(kept)
    ) {
      continue;
    }
    const named = others
      .slice(0, NAMED_PLACES)
      .map((place) => `${place.path}:${place.line} in \`${place.host}\``);
    const rest = others.length > NAMED_PLACES ? ` and ${others.length - NAMED_PLACES} more` : "";
    rows.push({
      kind: "no-duplicate-block",
      path: first.path,
      line: first.line,
      detail:
        `${first.last - first.first + 1} statements, ${first.tokens} tokens, lines ${first.line}–${first.end} ` +
        `in \`${first.host}\`; also ${named.join(", ")}${rest}`,
      places: kept.map(({ path, line, end }) => ({ path, line, end })),
    });
  }
  return rows;
}
