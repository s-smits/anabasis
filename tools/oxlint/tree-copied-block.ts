/**
 * Two or more consecutive statements written out at two or more places, once the names each
 * function binds for itself and every literal are abstracted away.
 */
import * as ts from "typescript5";
import type { TreeFinding } from "./tree-findings.ts";

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
/** Places a detail names before it counts the rest. */
const NAMED_PLACES = 3;

interface Place {
  path: string;
  host: string;
  /** The statement list, and the run of it this place spans. */
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
    if (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node)) bind(node.name);
    else if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) {
      names.add(node.name.text);
    } else if (ts.isCatchClause(node) && node.variableDeclaration) bind(node.variableDeclaration.name);
    ts.forEachChild(node, walk);
  };
  for (const parameter of fn.parameters) bind(parameter.name);
  if (fn.body) walk(fn.body);
  return names;
}

const pushMap = <K, V>(map: Map<K, V[]>, key: K, item: V) => map.get(key)?.push(item) ?? map.set(key, [item]);

/** The functions a finding can name, each with its name. An anonymous callback is its host's. */
function hostsOf(file: ts.SourceFile): [string, ts.FunctionLikeDeclaration][] {
  const hosts: [string, ts.FunctionLikeDeclaration][] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
      node.body !== undefined &&
      node.name &&
      ts.isIdentifier(node.name)
    ) {
      hosts.push([node.name.text, node]);
    } else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      hosts.push([node.name.text, node.initializer]);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return hosts;
}

/** A node as the comparison reads it: kinds, bound names as one token, literals as their kind. */
function spell(node: ts.Node, bound: ReadonlySet<string>, out: string[]): string[] {
  if (ts.isTypeNode(node) || ts.isTypeParameterDeclaration(node)) return out;
  if (ts.isIdentifier(node)) {
    const { parent } = node;
    const field =
      (ts.isPropertyAccessExpression(parent) || ts.isPropertyAssignment(parent)) && parent.name === node;
    out.push(bound.has(node.text) && !field ? "I" : `N:${node.text}`);
  } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) out.push("S");
  else if (ts.isNumericLiteral(node)) out.push("#");
  else if (
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isParenthesizedExpression(node)
  ) {
    spell(node.expression, bound, out);
  } else {
    out.push(String(node.kind));
    ts.forEachChild(node, (child) => {
      spell(child, bound, out);
    });
    out.push(")");
  }
  return out;
}

/** Every run of two or more statements of one file, keyed by its spelling. */
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
          if (tokens < TOKEN_FLOOR) continue;
          const place = { path, host, statements, first, last, tokens, line: start.line, end: stop.end };
          pushMap(into, key, place);
        }
      }
    };
    const collect = (node: ts.Node): void => {
      if (ts.isBlock(node) || ts.isCaseClause(node) || ts.isDefaultClause(node)) runs(node.statements);
      if (node === fn.body || !ts.isFunctionLike(node)) ts.forEachChild(node, collect);
    };
    if (fn.body) collect(fn.body);
  }
}

/** A place's literals in order, and the share of its nodes inside object and array literals. */
function contentOf(place: Place): { literals: string[]; data: number } {
  const literals: string[] = [];
  let [nodes, data] = [0, 0];
  const walk = (node: ts.Node, within: "data" | "code"): void => {
    if (ts.isTypeNode(node) || ts.isTypeParameterDeclaration(node)) return;
    [nodes, data] = [nodes + 1, data + (within === "data" ? 1 : 0)];
    if (ts.isStringLiteral(node) || ts.isNumericLiteral(node) || ts.isTemplateLiteralToken(node)) {
      literals.push(node.text);
      return;
    }
    const literal = ts.isObjectLiteralExpression(node) || ts.isArrayLiteralExpression(node);
    ts.forEachChild(node, (child) => {
      walk(child, literal ? "data" : within);
    });
  };
  for (const statement of place.statements.slice(place.first, place.last + 1)) walk(statement, "code");
  return { literals, data: data / Math.max(nodes, 1) };
}

/** Whether the places are one shape filled with different content: a table, not a copy of work. */
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
  for (const [path, file] of [...parsed].toSorted(([a], [b]) => (a < b ? -1 : 1))) {
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
      .toSorted((a, b) => (a.path === b.path ? a.line - b.line : a.path < b.path ? -1 : 1));
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
