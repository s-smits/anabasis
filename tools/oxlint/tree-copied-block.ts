/**
 * Two or more consecutive statements written out at two or more places, once the names each
 * function binds for itself and every literal are abstracted away.
 *
 * The comparison is over syntax, not lines. Each file is parsed, and every function that has a
 * name to report — a declaration, an arrow or function expression held by a variable, a method —
 * is read as a host. A name the host binds (a parameter, a local, a catch variable) becomes one
 * token whatever it is called; any other name (an import, a module constant, a property, a
 * global) keeps its spelling, so two blocks calling different functions never match. String and
 * number literals become their kind, and type annotations, `as`, `satisfies`, `!` and parentheses
 * are dropped. Formatting, comments and import lists are gone before anything is compared, which is
 * what a line-based scan spent most of its rules removing by hand.
 *
 * Every window of one to six consecutive statements in a block or a `case`, and every expression,
 * of at least 32 tokens is a unit, and units with one spelling are one class. Classes are taken
 * largest first and grown over every statement their places still share on either side, so a copy
 * longer than a window is one place; a class all of whose places lie inside places already taken
 * is that copy seen through a window, and goes. What is reported is narrower than what is grouped:
 * at least two statements, at least 64 tokens, every place at least three lines, two or more
 * places outside tests, all under the caller's roots, and none in a file that declares itself
 * generated or unchecked.
 *
 * Normalising literals is what lets a copy that prints a different word match, and it also lets
 * a table match another table with the same keys. A class is therefore not reported when its
 * places say different things: five or more word-bearing literals differ between them, or the
 * block is mostly object and array literal data and most of its literals differ. That is a
 * translation file per locale, a dispatch over different events, a row per case — the same shape
 * filled with different content, which is the content's structure and not a copy of work.
 *
 * Where a copy sits decides whether anyone can own it. A place in a test, a fixture, an example,
 * a project template or vendored code, by its directory or its first line, is written to stand
 * alone, and is not counted. Separately
 * published packages do not import each other, so only the places in the package holding most of
 * them count, by the nearest `package.json`. And a copy across four or more parallel
 * implementations — a dialect, an adapter, a platform per directory — is written out per variant on
 * purpose.
 *
 * Measured 2026-09-21 against blind judges asked "should this get one owner?", calibrated on
 * answered rows (7 of 7 answered no were judged no; 7 of 13 answered yes were judged yes, so a
 * judge's yes rate understates the operator's). This repository is where it is tuned and where the
 * figure that decides is taken: every site it reports at 25 revisions of main since 2026-07-15,
 * with the rule frozen before any new site was judged, is 51 of 71 (0.72, Wilson 0.60–0.81); the
 * 22 of those no judge had seen before are 14 (0.64, 0.43–0.80). Earlier holdouts of the same
 * lineage here read 24 of 32, 25 of 32 and 35 of 49. What was answered no is a frozen legacy
 * validator beside its successor and two short adjacent branches of one function; neither became
 * a condition, because both would be fitted on those verdicts and the second also holds yes answers.
 *
 * Abroad it is weaker. On six pre-registered sets of other TypeScript repositories, judged for a
 * maintainer, the shipped rule of the day read 0.25 to 0.44, and 0.28 (9 of 32) on the last —
 * tldraw, vercel/ai, vueuse, prisma. Those projects keep more copies on purpose, a visitor per node
 * or an SDK per framework, and a judge's guess at a stranger's taste is an opinion rather than a
 * label. The path and package conditions above removed only no answers there. Two richer rules
 * were tried and not kept: a logistic score over forty features and a test on differing literals
 * and loops each read 0.22 on the last set, and the second cost 18 yes answers here.
 */
import * as ts from "typescript5";

import type { TreeFinding } from "./tree-findings.ts";

/** A test or fixture file in the spellings TypeScript projects use. A copy between them is data. */
const TEST_PATH =
  /(?:^|\/)(?:test|tests|__tests__|__testfixtures__|__fixtures__|fixtures?|__mocks__|__snapshots__|testdata|test-data)\/|\.(?:test|spec)\.|_test\./u;

/** Code a project keeps as someone else wrote it or as it was once run: a vendored upstream, a
 *  codemod, a migration. A copy into or between them is frozen on purpose. */
const FROZEN_PATH =
  /(?:^|\/)(?:vendor|vendored|third[-_]party|[\w-]*codemods?|migrations?|examples?|template-[\w.-]+)\//iu;

/** Source the parser reads. A declaration file holds no statements. */
const SOURCE = /\.(?:[cm]?[jt]s|[jt]sx)$/u;
const DECLARATION_FILE = /\.d\.[cm]?ts$/u;

/** What a file's leading comments say when nobody edits it by hand or the checker skips it. A
 *  file whose first comment line reads "Vendored from <upstream>" is vendored code outside a
 *  vendor directory, such as the pi-mono utilities under `src/builder/pi-coding` kept verbatim for
 *  their upstream test; a comment that only mentions something vendored says nothing of its file. */
const OPTED_OUT =
  /@ts-nocheck|@generated\b|\bauto-?generated\b|\bdo not edit\b|\/\*\s*eslint-disable\s*\*\/|^\/\/\s*vendored from\s+\S/iu;

/** A literal that says something, as opposed to a separator, a flag or a number. */
const WORDY = /\p{L}{3}/u;

/** Most consecutive statements one unit spans. */
const WINDOW = 6;

/** Tokens a unit needs to be grouped at all. Units under `TOKEN_FLOOR` are never reported; they
 *  are grouped so that a copy taken at its full extent covers the smaller copies inside it. */
const UNIT_FLOOR = 32;

/** Tokens a reported copy carries. */
const TOKEN_FLOOR = 64;

/** Lines every reported place spans. */
const LINE_FLOOR = 3;

/** Word-bearing literals that may differ between places before they say different things. */
const DIVERGENT_WORDS = 5;

/** Share of a block inside object and array literals, and of its literals differing, above which
 *  it is a table with different rows. */
const DATA_SHARE = 0.5;
const DIVERGENT_SHARE = 0.5;

/** Parallel implementations beside each other from which a copy between them is written out per
 *  variant on purpose: a dialect, a framework adapter, a platform. */
const FAMILY = 4;

/** A path segment as words and the characters between them, which rejoin to the segment. */
const PIECE = /[A-Z]+(?![a-z])|[A-Z]?[a-z]+|\d+|[^A-Za-z\d]+/gu;

/** Places a detail names before it counts the rest. */
const NAMED_PLACES = 3;

interface Host {
  name: string;
  body: ts.Node;
  bound: ReadonlySet<string>;
}

interface Unit {
  key: string;
  tokens: number;
  line: number;
  end: number;
  host: string;
  /** Statements in the window, or 0 for an expression. */
  statements: number;
  file: ts.SourceFile;
  /** The statement list the window is cut from, or the expression alone, and where it starts. */
  from: readonly ts.Node[];
  first: number;
  /** Each statement's digest and token count, shared by every window of one list. */
  keys: readonly string[];
  sizes: readonly number[];
}

interface Place {
  path: string;
  unit: Unit;
}

/** What a place says rather than how it is built: its literals in order, and how much is data. */
interface Content {
  literals: string[];
  nodes: number;
  data: number;
}

/** Every name a function binds for itself: parameters, locals, nested declarations, catch variables. */
function boundNames(fn: ts.FunctionLikeDeclaration): Set<string> {
  const names = new Set<string>();
  const bind = (name: ts.BindingName): void => {
    if (ts.isIdentifier(name)) names.add(name.text);
    else for (const element of name.elements) if (!ts.isOmittedExpression(element)) bind(element.name);
  };
  for (const parameter of fn.parameters) bind(parameter.name);
  const walk = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node)) bind(node.name);
    else if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) {
      names.add(node.name.text);
    } else if (ts.isCatchClause(node) && node.variableDeclaration) bind(node.variableDeclaration.name);
    ts.forEachChild(node, walk);
  };
  if (fn.body) walk(fn.body);
  return names;
}

/** The functions a finding can name. An anonymous callback is part of its host, not a host. */
function hostsOf(file: ts.SourceFile): Host[] {
  const hosts: Host[] = [];
  const visit = (node: ts.Node): void => {
    let name = "";
    let fn: ts.FunctionLikeDeclaration | null = null;
    if (ts.isFunctionDeclaration(node) && node.name) [name, fn] = [node.name.text, node];
    else if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) [name, fn] = [node.name.text, node];
    else if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      [name, fn] = [node.name.text, node.initializer];
    }
    if (fn?.body) hosts.push({ name, body: fn.body, bound: boundNames(fn) });
    ts.forEachChild(node, visit);
  };
  visit(file);
  return hosts;
}

/** A node as the comparison reads it: kinds, bound names as one token, literals as their kind. */
function spell(node: ts.Node, bound: ReadonlySet<string>, out: string[]): string[] {
  if (ts.isTypeNode(node) || ts.isTypeParameterDeclaration(node)) return out;
  if (ts.isIdentifier(node)) {
    // A property's name after a dot or before a colon names a field, not a binding, even where a
    // local of the same spelling exists. Reading it as bound made `const version =
    // text(runtime?.version)` four times over one object a copy of `const id = text(snapshot?.id)`
    // four times over another; kept as spelled, they are four reads of different fields.
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

function digest(tokens: readonly string[]): string {
  return Bun.hash(tokens.join(" ")).toString(36);
}

function lineOf(file: ts.SourceFile, position: number): number {
  return file.getLineAndCharacterOfPosition(position).line + 1;
}

/** Every statement window and expression of one file with `UNIT_FLOOR` tokens or more. */
function unitsOf(file: ts.SourceFile): Unit[] {
  const units: Unit[] = [];
  for (const host of hostsOf(file)) {
    const windows = (statements: ts.NodeArray<ts.Statement>): void => {
      const spelled = statements.map((statement) => spell(statement, host.bound, []));
      const keys = spelled.map(digest);
      const sizes = spelled.map((tokens) => tokens.length);
      for (let first = 0; first < statements.length; first += 1) {
        let tokens = 0;
        for (let last = first; last < Math.min(statements.length, first + WINDOW); last += 1) {
          tokens += sizes[last] ?? 0;
          if (tokens < UNIT_FLOOR) continue;
          units.push({
            key: keys.slice(first, last + 1).join(","),
            tokens,
            line: lineOf(file, statements[first]?.getStart(file) ?? 0),
            end: lineOf(file, statements[last]?.getEnd() ?? 0),
            host: host.name,
            statements: last - first + 1,
            file,
            from: statements,
            first,
            keys,
            sizes,
          });
        }
      }
    };
    const collect = (node: ts.Node): void => {
      if (ts.isBlock(node) || ts.isCaseClause(node) || ts.isDefaultClause(node)) windows(node.statements);
      if (node !== host.body && ts.isFunctionLike(node)) return;
      if (ts.isExpression(node) && !ts.isIdentifier(node) && !ts.isLiteralExpression(node)) {
        const tokens = spell(node, host.bound, []);
        if (tokens.length >= UNIT_FLOOR) {
          const [line, end] = [lineOf(file, node.getStart(file)), lineOf(file, node.getEnd())];
          const [keys, sizes] = [[digest(tokens)], [tokens.length]];
          units.push({
            key: keys[0] ?? "",
            tokens: tokens.length,
            line,
            end,
            host: host.name,
            statements: 0,
            file,
            from: [node],
            first: 0,
            keys,
            sizes,
          });
        }
      }
      ts.forEachChild(node, collect);
    };
    collect(host.body);
  }
  return units;
}

/** The unit one statement wider on the side `step` names, or null where the list ends. */
function widened(unit: Unit, step: -1 | 1): Unit | null {
  const at = step === 1 ? unit.first + unit.statements : unit.first - 1;
  const statement = unit.from[at];
  if (unit.statements === 0 || statement === undefined) return null;
  const first = Math.min(unit.first, at);
  const line = step === 1 ? unit.line : lineOf(unit.file, statement.getStart(unit.file));
  const end = step === 1 ? lineOf(unit.file, statement.getEnd()) : unit.end;
  return {
    ...unit,
    first,
    line,
    end,
    statements: unit.statements + 1,
    tokens: unit.tokens + (unit.sizes[at] ?? 0),
  };
}

/**
 * The places grown over every statement they all share next, on each side in turn, while no two
 * places in one file come to overlap: a copy longer than `WINDOW` becomes one place per copy.
 */
function grown(places: readonly Place[]): Place[] {
  let current = [...places];
  for (const step of [1, -1] as const) {
    for (;;) {
      const next = current.map((place) => ({ path: place.path, unit: widened(place.unit, step) }));
      const at = (place: { unit: Unit | null }): string | undefined =>
        place.unit
          ? place.unit.keys[step === 1 ? place.unit.first + place.unit.statements - 1 : place.unit.first]
          : undefined;
      const key = at(next[0] ?? { unit: null });
      if (key === undefined || !next.every((place) => at(place) === key)) break;
      const units = next.flatMap((place) => (place.unit ? [{ path: place.path, unit: place.unit }] : []));
      const overlapping = units.some((one, index) =>
        units.some(
          (other, later) =>
            later > index &&
            other.path === one.path &&
            other.unit.line <= one.unit.end &&
            one.unit.line <= other.unit.end,
        ),
      );
      if (overlapping) break;
      current = units;
    }
  }
  return current;
}

/**
 * Units spelled at two or more places, one class per spelling, largest first and grown to their
 * full extent. A class whose places all lie inside places a larger class took is the larger copy
 * seen through a window, and goes.
 */
function copyClasses(files: ReadonlyMap<string, string>): Place[][] {
  const groups = new Map<string, Place[]>();
  const paths = [...files.keys()].filter((path) => SOURCE.test(path) && !DECLARATION_FILE.test(path)).sort();
  for (const path of paths) {
    const kind = path.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const file = ts.createSourceFile(path, files.get(path) ?? "", ts.ScriptTarget.Latest, true, kind);
    for (const unit of unitsOf(file)) {
      const group = groups.get(unit.key);
      if (group) group.push({ path, unit });
      else groups.set(unit.key, [{ path, unit }]);
    }
  }
  const taken = new Map<string, [number, number][]>();
  const covered = (place: Place): boolean =>
    (taken.get(place.path) ?? []).some(([line, end]) => line <= place.unit.line && place.unit.end <= end);
  const classes: Place[][] = [];
  const repeated = [...groups.values()].filter((group) => group.length >= 2);
  repeated.sort((left, right) => (right[0]?.unit.tokens ?? 0) - (left[0]?.unit.tokens ?? 0));
  for (const group of repeated) {
    // Two windows of one file that overlap are one place, whichever comes first.
    const distinct = group.filter(
      (place, index) =>
        group.findIndex(
          (other) =>
            other.path === place.path &&
            other.unit.line <= place.unit.end &&
            place.unit.line <= other.unit.end,
        ) === index,
    );
    if (distinct.length < 2 || distinct.every(covered)) continue;
    const places = grown(distinct);
    for (const place of places) {
      const ranges = taken.get(place.path) ?? [];
      ranges.push([place.unit.line, place.unit.end]);
      taken.set(place.path, ranges);
    }
    classes.push(places);
  }
  return classes;
}

/** A place's literals in the order the spelling meets them, and how much of it is literal data. */
function contentOf(place: Place): Content {
  const content: Content = { literals: [], nodes: 0, data: 0 };
  const walk = (node: ts.Node, inData: boolean): void => {
    if (ts.isTypeNode(node) || ts.isTypeParameterDeclaration(node)) return;
    content.nodes += 1;
    if (inData) content.data += 1;
    if (ts.isStringLiteral(node) || ts.isNumericLiteral(node) || ts.isTemplateLiteralToken(node)) {
      content.literals.push(node.text);
      return;
    }
    const data = inData || ts.isObjectLiteralExpression(node) || ts.isArrayLiteralExpression(node);
    ts.forEachChild(node, (child) => {
      walk(child, data);
    });
  };
  for (const node of place.unit.from.slice(
    place.unit.first,
    place.unit.first + Math.max(1, place.unit.statements),
  )) {
    walk(node, false);
  }
  return content;
}

/** Whether the places are one shape filled with different content: a table, not a copy of work. */
function saysDifferentThings(places: readonly Place[]): boolean {
  const [first, ...others] = places.map(contentOf);
  if (first === undefined || first.literals.length === 0) return false;
  const differing = first.literals.filter((literal, index) =>
    others.some((other) => other.literals[index] !== literal),
  );
  if (differing.filter((literal) => WORDY.test(literal)).length >= DIVERGENT_WORDS) return true;
  return (
    first.data / first.nodes >= DATA_SHARE && differing.length / first.literals.length >= DIVERGENT_SHARE
  );
}

/**
 * How many variants there are of the family two paths belong to, when one differs from the other
 * by one word put in place of another wherever it occurs: `pg-core/dialect.ts` and
 * `gel-core/dialect.ts` are two of however many `*-core` directories sit beside them. Zero when
 * the paths differ in any other way.
 */
function familySize(left: string, right: string, paths: readonly string[]): number {
  const [a, b] = [left, right].map((path) => path.split("/").map((segment) => segment.match(PIECE) ?? []));
  if (!a || !b || a.length !== b.length) return 0;
  const swaps = new Set<string>();
  let [last, word] = [-1, ""];
  for (let index = 0; index < a.length; index += 1) {
    const [mine, theirs] = [a[index] ?? [], b[index] ?? []];
    if (mine.length !== theirs.length) return 0;
    for (let at = 0; at < mine.length; at += 1) {
      const [one, other] = [mine[at]?.toLowerCase() ?? "", theirs[at]?.toLowerCase() ?? ""];
      if (one === other) continue;
      swaps.add(`${one}/${other}`);
      [last, word] = [index, one];
    }
  }
  if (swaps.size !== 1) return 0;
  let named = false;
  const pattern = a.slice(0, last + 1).map((segment) =>
    segment
      .map((piece) => {
        if (piece.toLowerCase() !== word) return piece.replace(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
        const group = named ? String.raw`\k<variant>` : String.raw`(?<variant>[A-Za-z\d]+)`;
        named = true;
        return group;
      })
      .join(""),
  );
  const variants = new RegExp(`^${pattern.join("/")}${last < a.length - 1 ? "/" : "$"}`, "iu");
  return new Set(paths.flatMap((path) => variants.exec(path)?.groups?.["variant"]?.toLowerCase() ?? [])).size;
}

/** A file's role beside its siblings under directory `at`: the path with that directory as a
 *  wildcard and the words of the file name that spell it taken out, so that
 *  `driver/cockroachdb/CockroachQueryRunner.ts` is `driver/ * /QueryRunner.ts`. */
function roleOf(path: string, at: number): string | null {
  const segments = path.split("/");
  const name = segments.at(-1) ?? "";
  if (at >= segments.length - 1) return null;
  const variant = (segments[at] ?? "").toLowerCase().replace(/[^a-z\d]/gu, "");
  const dot = name.indexOf(".");
  const stem = (dot < 0 ? name : name.slice(0, dot)).match(PIECE) ?? [];
  const kept = stem.filter(
    (piece) => !/^[A-Za-z\d]{2,}$/u.test(piece) || !variant.includes(piece.toLowerCase()),
  );
  return [
    ...segments.slice(0, at),
    "*",
    ...segments.slice(at + 1, -1),
    kept.join("").toLowerCase() + (dot < 0 ? "" : name.slice(dot)),
  ].join("/");
}

/** How many sibling directories hold a file in the role two paths share, when they differ in one
 *  directory and in the file name only where it spells that directory. Zero otherwise. */
function roleFamilySize(left: string, right: string, paths: readonly string[]): number {
  const [a, b] = [left.split("/"), right.split("/")];
  if (a.length !== b.length) return 0;
  const differ = a.flatMap((segment, index) => (index < a.length - 1 && segment !== b[index] ? [index] : []));
  const at = differ[0];
  if (at === undefined || differ.length > 1) return 0;
  const role = roleOf(left, at);
  if (role === null || role !== roleOf(right, at)) return 0;
  return new Set(
    paths.flatMap((path) => (roleOf(path, at) === role ? [path.split("/")[at]?.toLowerCase() ?? ""] : [])),
  ).size;
}

/** Whether the places sit in `FAMILY` or more parallel implementations, per dialect or adapter. */
function spansFamily(places: readonly Place[], paths: readonly string[]): boolean {
  const files = [...new Set(places.map((place) => place.path))];
  return files.some((left, index) =>
    files
      .slice(index + 1)
      .some(
        (right) => Math.max(familySize(left, right, paths), roleFamilySize(left, right, paths)) >= FAMILY,
      ),
  );
}

/** The directory of the nearest manifest above a path: the package the file is published in. */
function packageOf(path: string, manifests: ReadonlySet<string>): string {
  for (let at = path.lastIndexOf("/"); at > 0; at = path.lastIndexOf("/", at - 1)) {
    if (manifests.has(`${path.slice(0, at)}/package.json`)) return path.slice(0, at);
  }
  return "";
}

/**
 * One row per copied block, at its first place outside tests, naming the others.
 *
 * `roots` is where a place may be: a class with a place outside them is not reported, since the
 * precision above was measured on classes whose every place was authored source. Tests and files
 * outside the roots are still read, so that a larger copy reaching into them covers its windows.
 */
export function copiedBlocks(files: ReadonlyMap<string, string>, roots: readonly string[]): TreeFinding[] {
  const rows: TreeFinding[] = [];
  const paths = [...files.keys()].filter((path) => SOURCE.test(path));
  const manifests = new Set([...files.keys()].filter((path) => /(?:^|\/)package\.json$/u.test(path)));
  const inRoots = (path: string): boolean => roots.some((root) => path.startsWith(`${root}/`));
  for (const places of copyClasses(files)) {
    const authored = places.filter((place) => !TEST_PATH.test(place.path) && !FROZEN_PATH.test(place.path));
    // The places in the package holding most of them; a copy across packages has no owner both call.
    const kept = [...Map.groupBy(authored, (place) => packageOf(place.path, manifests)).values()]
      .reduce<Place[]>((best, group) => (group.length > best.length ? group : best), [])
      .sort((left, right) =>
        left.path === right.path ? left.unit.line - right.unit.line : left.path < right.path ? -1 : 1,
      );
    const [first, ...others] = kept;
    if (first === undefined || others.length === 0) continue;
    if (first.unit.statements < 2 || first.unit.tokens < TOKEN_FLOOR) continue;
    const small = (place: Place): boolean => place.unit.end - place.unit.line + 1 < LINE_FLOOR;
    // A file whose leading comments say it is generated or unchecked.
    const optedOut = (place: Place): boolean =>
      OPTED_OUT.test(place.unit.file.text.slice(0, place.unit.file.statements[0]?.getStart(place.unit.file)));
    if (kept.some((place) => small(place) || !inRoots(place.path) || optedOut(place))) continue;
    if (saysDifferentThings(kept) || spansFamily(kept, paths)) continue;
    const named = others
      .slice(0, NAMED_PLACES)
      .map((place) => `${place.path}:${place.unit.line} in \`${place.unit.host}\``);
    const rest = others.length > NAMED_PLACES ? ` and ${others.length - NAMED_PLACES} more` : "";
    rows.push({
      kind: "copied-block",
      path: first.path,
      line: first.unit.line,
      detail:
        `${first.unit.statements} statements, ${first.unit.tokens} tokens, lines ${first.unit.line}–${first.unit.end} ` +
        `in \`${first.unit.host}\`; also ${named.join(", ")}${rest}`,
      places: kept.map((place) => ({ path: place.path, line: place.unit.line, end: place.unit.end })),
    });
  }
  return rows;
}
