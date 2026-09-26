#!/usr/bin/env bun
/**
 * Prompt-surface census: extract candidate strings a model could see, with the code condition
 * that selects each string.
 *
 * Reads the TypeScript AST (no typechecker, no build) and reports, per surface:
 *   - the holder name (systemPrompt, description, MANIFEST, ...) and file:line
 *   - "reached when": the enclosing if / ternary / switch / try-catch chain, innermost last
 *   - up to N lines of preceding source as context (default 3)
 *   - the literal text itself, plus the named constants it composes
 *
 * Not every model-visible byte is a literal in a compiled file. `--doc` adds whole non-code files
 * — a starter guide, an operating guide, a tool-spec seed — as one surface each, because a
 * document copied into a model's workspace may be read in full and the AST never sees it.
 *
 * Usage:
 *   bun extract-prompt-surface.mjs [--root DIR] [--dir src] [--out FILE.md]
 *                                   [--doc PATHS] [--context 3] [--min-chars 24]
 *                                   [--include-tests] [--vocab 'extra|words']
 *                                   [--deny 'noise|names'] [--strong 'exact|holders']
 *                                   [--audience NAME] [--miss-chars 120]
 *                                   [--json FILE.json] [--ts MODULE]
 *
 * TypeScript is resolved from the target repo's node_modules.
 */
import { exitWith, parseOrDie } from "#skills/main/cli.ts";
import { boundText } from "#src/meta/bounded-text.ts";
import { sha256 } from "#src/meta/digest.ts";
import { gitMaybe } from "#skills/main/git.ts";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "#src/meta/filesystem.ts";
import path from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { errorMessage } from "#src/meta/runtime-values.ts";
import { isFunction, isString } from "#src/meta/json-shape.ts";
import { hasText } from "#src/meta/text.ts";
import { readJsonFile, writeJsonFile } from "#src/meta/completed-json.ts";

const ARGS = parseOrDie(exitWith("extract-prompt-surface"), {
  values: [
    "root",
    "dir",
    "doc",
    "out",
    "json",
    "context",
    "min-chars",
    "miss-chars",
    "vocab",
    "deny",
    "strong",
    "audience",
    "ts",
  ],
  flags: ["help", "include-tests"],
});
/** Names that match the vocabulary but never reach a model. Match identifier tokens rather than
 * raw substrings: `promptDigest` is noise, while `shape` must not be rejected because it has
 * letters `sha`, nor `profile` because it ends in `file`. */
const DEFAULT_DENY_TOKENS = new Set([
  "digest",
  "hash",
  "sha",
  "path",
  "file",
  "dir",
  "url",
  "id",
  "key",
  "regex",
  "pattern",
  "code",
  "error",
  "log",
  "schema",
  "version",
  "type",
  "types",
  "kind",
  "stderr",
  "stdout",
  "jsonl",
]);
/**
 * Audience guesses by source location. A lexical AST scan cannot prove delivery, but a path label
 * narrows the model-call boundary that must be checked. Override per repo with
 * `.prompt-surface.json` → { "audiences": { "src/foo": "name" } }.
 */
const DEFAULT_AUDIENCES = {
  "src/solve": "built agent",
  "src/author": "builder",
  "src/builder": "builder",
  "src/critic": "policy and thresholds (verify: may reach no model)",
  "src/analyse": "judge review and feedback routing",
  "src/review": "reviewers (Judge, diagnosis reader, Epoch Reviewer)",
  "src/gate": "builder (check and submit results)",
  "src/truth/judge": "judge",
  "src/truth": "shared contracts",
  "src/backends": "transport (all audiences)",
  "src/observe": "telemetry (verify: may reach no model)",
  "src/run": "orchestration",
  // Receipt and wall layers: written for an operator, but a feedback packet can quote them back to a
  // model. Labelled rather than dropped — the census may not decide that silently.
  "src/claim": "receipts (operator; reaches a model only if a packet quotes it)",
  "src/verify": "sandbox walls (operator)",
  "src/meta": "internal",
  // Files that are not compiled here but are copied into a model's workspace. The starter guide is
  // the Builder's first read; the operating guide is prepended to every Built Harness case prompt.
  "starters/pi-built-harness/agent": "built agent",
  "starters": "builder",
};
const DOC_EXTENSIONS = /\.(md|markdown|txt|json|ya?ml|py|sh)$/;

const flag = (name, fallback) => ARGS.single.get(name) ?? fallback;
const has = (name) => ARGS.flags.has(name);

if (has("help")) {
  console.log(`Usage: extract-prompt-surface.mjs [options]

Options:
  --root DIR          repository root (default: current directory)
  --dir DIRS          comma-separated source directories (default: src). Name every directory a
                      model can read, not only the compiler's source root.
  --doc PATHS         comma-separated non-code files or directories (.md/.txt/.json/.yaml/.py/.sh)
                      reported whole, one surface per file
  --out FILE          Markdown output, relative to root (default: artifacts/prompt-surface.md)
  --json FILE         optional JSON output
  --context 0..3      preceding non-empty source lines (default: 3; never more than 3)
  --min-chars N       minimum candidate length outside strong holders (default: 24)
  --miss-chars N      minimum unclaimed-string length (default: 120)
  --vocab REGEX       add candidate-holder vocabulary
  --deny REGEX        add model-invisible/noise holder names
  --strong REGEX      add exact high-confidence holder names
  --audience TEXT     keep one audience substring
  --include-tests     scan test files and directories
  --ts MODULE         TypeScript compiler API module override
  --help              show this help

Optional .prompt-surface.json keys: dirs, doc, audiences, vocab, deny, strong.
A flag always wins over the config; the config only replaces the bare default.`);
  runtimeProcess.exit(0);
}

const root = path.resolve(flag("root", runtimeProcess.cwd()));
const integerFlag = (name, fallback, min, max = Number.MAX_SAFE_INTEGER) => {
  const value = Number(flag(name, fallback));
  if (!Number.isInteger(value) || value < min || value > max) {
    console.error(`--${name} must be an integer from ${min} to ${max}`);
    runtimeProcess.exit(2);
  }
  return value;
};
const contextLines = integerFlag("context", 3, 0, 3);
const minChars = integerFlag("min-chars", 24, 1);
const missChars = integerFlag("miss-chars", 120, 1);
const includeTests = has("include-tests");
const outPath = path.resolve(root, flag("out", "artifacts/prompt-surface.md"));
const jsonPath = flag("json") ? path.resolve(root, flag("json")) : null;

let config = {};
const configPath = path.join(root, ".prompt-surface.json");
try {
  config = readJsonFile(configPath);
} catch (error) {
  if (error?.code !== "ENOENT") {
    console.error(`Cannot read ${configPath}: ${errorMessage(error)}`);
    runtimeProcess.exit(2);
  }
}

const regexParts = (value) => {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value.filter((part) => isString(part)) : [String(value)];
};

const pathList = (value) =>
  (value ?? "")
    .toString()
    .split(",")
    .flatMap((part) => part.trim() || []);

/**
 * Which directories and documents to scan is the one setting a census gets wrong silently: the
 * report looks complete while a whole tree the model reads was never opened. `--dir` and `--doc`
 * fall back to `.prompt-surface.json`, so a repository states its own answer once instead of
 * every caller remembering it. Only the bare defaults lose to the config; an explicit flag wins.
 */
const dirs = pathList(flag("dir", null) ?? config.dirs ?? "src");
const docPaths = pathList(flag("doc", null) ?? config.doc ?? "");

/**
 * TypeScript is resolved from the target repo. `typescript` 7 ships only `version` here — no
 * compiler API — so every candidate is probed for `createSourceFile` and the first usable one wins.
 * Repos on TS 7 keep the old API under an alias (`typescript5` in anabasis).
 */
let ts = null;
const tsCandidates = [flag("ts", null), "typescript", "typescript5"].filter(Boolean);
for (const name of tsCandidates) {
  try {
    const module = await import(Bun.resolveSync(name, root));
    const api = isFunction(module.createSourceFile) ? module : module.default;
    if (api && isFunction(api.createSourceFile) && api.SyntaxKind) {
      ts = api;
      break;
    }
  } catch {
    /* try the next candidate */
  }
}
if (!ts) {
  console.error(
    `No usable TypeScript compiler API in ${root} (tried ${tsCandidates.join(", ")}). ` +
      `Install typescript there, or pass --ts <module-name>.`,
  );
  runtimeProcess.exit(2);
}

/** Names likely to hold model-visible text. Tuned by reviewing generated reports and callers.
 *  `policy` was here and is not: in this repo it holds config words like "openrouter". */
const STRONG = new RegExp(
  `^(systemPrompt|prompt|instructions?|description|manifest|preamble|framing|guide|operatingGuide|rubric|doctrine|nudge|question|template|banner|hint${[
    ...regexParts(config.strong),
    ...regexParts(flag("strong", null)),
  ]
    .map((part) => `|${part}`)
    .join("")})$`,
  "i",
);
const VOCAB = new RegExp(
  [
    "prompt",
    "instruction",
    "guide",
    "manifest",
    "preamble",
    "framing",
    "doctrine",
    "rubric",
    "brief",
    "nudge",
    "steer",
    "banner",
    "hint",
    "advice",
    "remedy",
    "description",
    "template",
    "wording",
    "phrase",
    "sentence",
    "line[s]?$",
    "text$",
    // Earned by the first run's unclaimed-strings table: findings, cards, and memory files are
    // routed back into a model turn as feedback, so their prose is model-visible.
    "claim",
    "detail",
    "reason",
    "remedy",
    "rule",
    "card",
    "memory",
    "condition",
    "note",
    "finding",
    // Earned by the second run and checked at their authoring call sites: candidate-check `shape`
    // findings, `authorJson` calls, task guidance, and prompt suffix/history assembly.
    "shape",
    "author",
    "guidance",
    "suffix",
    "marker",
    "history",
    "feedback",
    "representation",
    // Earned by the 2026-08-23 review of five prior censuses. `clause` and `refuse` carry the
    // controller's refusal and prompt-clause text back into an authoring session; `message` is
    // the ordinary carrier for a validator or tool result; `rationale` and `summary` are written
    // by code and read by the next model turn. Together they claimed 113 rows the earlier
    // vocabulary left in the unclaimed table run after run.
    "clause",
    "message",
    "refuse",
    "rationale",
    "summary",
    // Earned by the 2026-08-31 census of the composed PR stack. `kickoff` is this repo's word for
    // the Builder's first turn, and `directKickoff` — the user's verbatim request plus the
    // research instruction — had never been claimed. `refus` is `refuse` widened by two letters:
    // seven holders spelled `Refusal` and none of them matched. `nextAction` is the field every
    // authoring tool returns to say what to do next, and `caution`/`warning` carry advisory text
    // into the difficulty author.
    "kickoff",
    "refus",
    "nextaction",
    "caution",
    "warning",
    ...regexParts(config.vocab),
    flag("vocab", null),
  ]
    .filter(Boolean)
    .join("|"),
  "i",
);
const customDenyParts = [...regexParts(config.deny), ...regexParts(flag("deny", null))];
const CUSTOM_DENY = customDenyParts.length > 0 ? new RegExp(customDenyParts.join("|"), "i") : null;
/** The deny tokens name what a value *is*, so they decide on the head noun — the last token —
 * rather than anywhere in the name. `promptDigest` is still a digest and stays out; `fileLine`,
 * which renders the Built agent's draft-file sentence, is a line and no longer leaves its two
 * carried clauses in the unclaimed table because the word `file` appears in front of it. */
const isDenied = (name) => {
  const tokens = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .flatMap((part) => part.toLowerCase() || []);
  const head = tokens.at(-1);
  return (head !== undefined && DEFAULT_DENY_TOKENS.has(head)) || CUSTOM_DENY?.test(name) === true;
};

const AUDIENCES = config.audiences ? { ...DEFAULT_AUDIENCES, ...config.audiences } : DEFAULT_AUDIENCES;
/** Longest matching prefix wins, so `src/truth/judge` beats `src/truth`. A prefix matches a
 *  directory or a file stem, so `src/truth/judge` also claims `judge.ts` and `judge-census.ts`. */
function audienceOf(relFile) {
  let best = { prefix: "", name: "unclassified" };
  for (const [prefix, name] of Object.entries(AUDIENCES)) {
    const boundary = relFile.startsWith(prefix) ? relFile[prefix.length] : null;
    const matches = relFile === prefix || boundary === "/" || boundary === "-" || boundary === ".";
    if (matches && prefix.length > best.prefix.length) {
      best = { prefix, name };
    }
  }
  return best.name;
}

const sha8 = (s) => sha256(s).slice(0, 8);
const oneLine = (s) => s.replace(/\s+/g, " ").trim();

function sourceFiles() {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue;
        if (!includeTests && /^(test|tests|__tests__)$/.test(e.name)) continue;
        walk(p);
        // Include TypeScript and JavaScript sources, their module suffixes and JSX forms.
        // Declaration files and tests remain governed by the exclusions below.
      } else if (/\.([mc]?[jt]sx?)$/u.test(e.name) && !e.name.endsWith(".d.ts")) {
        if (!includeTests && /\.(test|spec)\.[a-z]+$/.test(e.name)) continue;
        out.push(p);
      }
    }
  };
  for (const d of dirs) walk(path.resolve(root, d));
  return out.sort();
}

/**
 * Documents a model reads whole. A starter guide copied into a Builder workspace, or an operating
 * guide prepended to every case prompt, is model-visible text that no AST walk can reach: it is
 * not a literal in a compiled file. Reported as one surface per file, unconditional by
 * construction — the guard question is whether the file is delivered, and that is a source claim
 * to verify, not something this scan can read.
 */
function documentSurfaces() {
  const files = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue;
        walk(p);
      } else if (DOC_EXTENSIONS.test(e.name)) {
        files.push(p);
      }
    }
  };
  for (const entry of docPaths) {
    const abs = path.resolve(root, entry);
    let stat;
    try {
      stat = statSync(abs);
    } catch {
      console.error(`--doc path not found: ${entry}`);
      runtimeProcess.exit(2);
    }
    if (stat.isDirectory()) walk(abs);
    else files.push(abs);
  }
  return [...new Set(files)].sort().map((file) => {
    const body = readFileSync(file, "utf8");
    const rel = path.relative(root, file);
    return {
      file: rel,
      audience: audienceOf(rel),
      line: 1,
      name: rel,
      fn: null,
      kind: "document",
      guards: [],
      composes: [],
      context: [],
      text: body,
      bytes: new TextEncoder().encode(body).byteLength,
      digest: sha8(body),
    };
  });
}

const isLiteral = (n) =>
  ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n);

/**
 * A string in a type position is not text a model reads — it is a union member or a record key.
 * Without this, `type Steering = "start-prompt" | "runtime-nudge"` reports as a prompt, which is
 * how the first run produced its noisiest rows.
 */
function inTypePosition(node) {
  for (let cur = node.parent; cur; cur = cur.parent) {
    if (ts.isLiteralTypeNode(cur) || ts.isTypeAliasDeclaration(cur) || ts.isInterfaceDeclaration(cur)) {
      return true;
    }
    if (ts.isTypeReferenceNode(cur) || ts.isTypeLiteralNode(cur) || ts.isUnionTypeNode(cur)) return true;
    if (ts.isAsExpression(cur) && contains(cur.type, node)) return true;
    if (ts.isSourceFile(cur)) return false;
  }
  return false;
}

/** A module specifier names a file the loader resolves, never text a model reads. It has no
 * declaration above it, so without this rule 16 import paths were the largest `(unnamed)` group
 * once `--miss-chars` was lowered far enough to look for short hidden surfaces. */
function isModuleSpecifier(node) {
  const p = node.parent;
  if (!p) return false;
  if ((ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) && p.moduleSpecifier === node) return true;
  if (ts.isExternalModuleReference(p) && p.expression === node) return true;
  return ts.isCallExpression(p) && p.expression.kind === ts.SyntaxKind.ImportKeyword;
}

/** A string handed straight to console/process output goes to an operator, not a model. */
function isDiagnosticSink(node) {
  for (let cur = node.parent; cur; cur = cur.parent) {
    if (ts.isCallExpression(cur)) {
      const callee = cur.expression.getText();
      return /^(console\.|process\.(stdout|stderr)|log|debug|warn)/.test(callee);
    }
    if (ts.isStatement(cur)) return false;
  }
  return false;
}

/** Text a literal contributes. Template expressions keep their ${...} holes so a reader sees the shape. */
function literalText(n, sf) {
  if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
  return n.getText(sf).replace(/^`|`$/g, "");
}

/** The named holder a literal belongs to: a declaration, property, or returning function. */
function holderOf(node, sf) {
  let cur = node;
  while (cur) {
    const p = cur.parent;
    if (!p) return null;
    if (ts.isVariableDeclaration(p) && p.initializer && contains(p.initializer, cur)) {
      return { name: p.name.getText(sf), node: p, kind: "const" };
    }
    if (ts.isPropertyAssignment(p) && contains(p.initializer, cur)) {
      // A bare `description:` names nothing a reader can act on; the sibling `name:` (the tool id)
      // does. Twelve rows called `description` in the first run were unattributable without this.
      // A top-level `const ACTIVE_JUDGE_PROMPTS = { census: "…" }` has no sibling `name:` and no
      // enclosing function, so the property used to report as the bare word `census` — the live
      // Judge prompt, unclaimed in every census before 2026-08-31. The declaration that owns the
      // object names it.
      const owner = siblingName(p, sf) ?? enclosingFunctionName(p, sf) ?? enclosingDeclarationName(p, sf);
      const label =
        ts.isStringLiteral(p.name) || ts.isNumericLiteral(p.name) ? p.name.text : p.name.getText(sf);
      return { name: owner ? `${owner}.${label}` : label, node: p, kind: "property" };
    }
    if (ts.isPropertyDeclaration(p) && p.initializer && contains(p.initializer, cur)) {
      return { name: p.name.getText(sf), node: p, kind: "field" };
    }
    if (
      ts.isBinaryExpression(p) &&
      p.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      contains(p.right, cur)
    ) {
      return { name: p.left.getText(sf), node: p, kind: "assign" };
    }
    if (ts.isReturnStatement(p)) {
      const fn = enclosingFunctionName(p, sf);
      if (fn) return { name: fn, node: p, kind: "return" };
    }
    // Text passed straight into a call or `new` — `finding("code", "…")` is this repo's feedback
    // builder, `new Error("…")` its diagnostics — has no declaration to name it. The callee names
    // it instead. Without the `new` case, 70 of the 313 unclaimed rows read "(unnamed)" and could
    // not be classified as a group at all; with it they read `Error()`. Trace those callers
    // before adding a deny rule: public feedback may carry an error to a model.
    if (
      (ts.isCallExpression(p) || ts.isNewExpression(p)) &&
      (p.arguments ?? []).some((a) => contains(a, cur))
    ) {
      const callee = p.expression.getText(sf);
      if (
        !/^(JSON|String|Number|Boolean|Array|Object|Math|Map|Set|WeakMap|WeakSet|Date|RegExp|Promise|URL)\b/.test(
          callee,
        )
      ) {
        // `blocks.push("prompt text")` is assembly inside the enclosing renderer; `push` does not
        // describe the surface. Use the renderer name so suffix/prompt vocabulary can classify it.
        const collectionMutation = /\.(push|unshift)$/.test(callee);
        const label = collectionMutation ? (enclosingFunctionName(p, sf) ?? callee) : callee;
        return { name: `${label}()`, node: p, kind: "call-arg" };
      }
    }
    // A literal inside an array/call climbs further so `const LINES = [...]` reports once, not per element.
    cur = p;
  }
  return null;
}

const contains = (parent, child) => parent.pos <= child.pos && parent.end >= child.end;

/** The `name`/`toolName`/`id` property sitting beside this one in the same object literal. */
function siblingName(prop, sf) {
  const obj = prop.parent;
  if (!obj || !ts.isObjectLiteralExpression(obj)) return null;
  for (const member of obj.properties) {
    if (!ts.isPropertyAssignment(member)) continue;
    if (!/^(name|toolName|id|label)$/.test(member.name.getText(sf))) continue;
    const init = member.initializer;
    if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) return init.text;
    if (ts.isIdentifier(init)) return init.getText(sf);
  }
  return null;
}

/** The owner a declared holder inherits its classification from: the object or namespace its
 *  dotted name already names, otherwise the function it is declared inside. An argument has no
 *  qualifier, because the callee owns that text rather than the caller. */
function qualifierOf(holder, name, sf) {
  if (!["const", "property", "field", "assign"].includes(holder.kind)) return null;
  if (name.includes(".")) return name.slice(0, name.lastIndexOf("."));
  return enclosingFunctionName(holder.node, sf);
}

function enclosingFunctionName(node, sf) {
  let cur = node.parent;
  while (cur) {
    if (ts.isFunctionDeclaration(cur) && cur.name) return cur.name.getText(sf);
    if (ts.isMethodDeclaration(cur) && cur.name) return cur.name.getText(sf);
    if ((ts.isArrowFunction(cur) || ts.isFunctionExpression(cur)) && ts.isVariableDeclaration(cur.parent)) {
      return cur.parent.name.getText(sf);
    }
    cur = cur.parent;
  }
  return null;
}

/** The nearest `const`/field declaration above this node, for a property with no other owner. */
function enclosingDeclarationName(node, sf) {
  let cur = node.parent;
  while (cur) {
    if (ts.isVariableDeclaration(cur) && ts.isIdentifier(cur.name)) return cur.name.getText(sf);
    if (ts.isPropertyDeclaration(cur) && cur.name) return cur.name.getText(sf);
    cur = cur.parent;
  }
  return null;
}

/** The if / ternary / switch / try chain gating this node, outermost first. */
function guardChain(node, sf) {
  const chain = [];
  let child = node;
  let cur = node.parent;
  while (cur) {
    if (ts.isIfStatement(cur)) {
      const cond = oneLine(cur.expression.getText(sf));
      if (child === cur.thenStatement) chain.push({ kind: "if", text: cond });
      else if (child === cur.elseStatement) chain.push({ kind: "else", text: `not (${cond})` });
    } else if (ts.isConditionalExpression(cur)) {
      const cond = oneLine(cur.condition.getText(sf));
      if (child === cur.whenTrue) chain.push({ kind: "ternary", text: cond });
      else if (child === cur.whenFalse) chain.push({ kind: "ternary", text: `not (${cond})` });
    } else if (ts.isCaseClause(cur)) {
      chain.push({ kind: "case", text: `case ${oneLine(cur.expression.getText(sf))}` });
    } else if (ts.isDefaultClause(cur)) {
      chain.push({ kind: "case", text: "default case" });
    } else if (ts.isCatchClause(cur)) {
      chain.push({ kind: "catch", text: "on a thrown error (catch)" });
    } else if (ts.isTryStatement(cur)) {
      if (child === cur.tryBlock) chain.push({ kind: "try", text: "inside try" });
      else if (child === cur.finallyBlock) chain.push({ kind: "finally", text: "finally" });
    } else if (ts.isBinaryExpression(cur)) {
      const op = cur.operatorToken.getText(sf);
      if (["&&", "||", "??"].includes(op) && child === cur.right) {
        const left = oneLine(cur.left.getText(sf));
        const text = op === "&&" ? left : op === "||" ? `not (${left})` : `${left} is nullish`;
        chain.push({ kind: "shortcircuit", text });
      }
    }
    child = cur;
    cur = cur.parent;
  }
  return chain.toReversed();
}

/** Named constants the surface composes, so the assembly graph is readable without a typechecker. */
function composedNames(node, sf) {
  const names = new Set();
  const visit = (n) => {
    if (ts.isIdentifier(n)) {
      const t = n.getText(sf);
      if (/^[A-Z][A-Z0-9_]{3,}$/.test(t) || (VOCAB.test(t) && !isDenied(t))) names.add(t);
    }
    n.forEachChild(visit);
  };
  node.forEachChild(visit);
  return [...names].sort();
}

function precedingLines(lines, startLine, n) {
  const out = [];
  for (let i = startLine - 1; i >= 0 && out.length < n; i -= 1) {
    const t = lines[i];
    if (t.trim() === "") continue;
    out.unshift(t);
  }
  return out;
}

/**
 * A census that reports only what its vocabulary matched reads as complete while being partial.
 * Every long string the vocabulary did NOT claim is listed instead, so the blind spot is visible
 * and the vocabulary can be tuned against evidence rather than guessed at.
 */
function collect() {
  const surfaces = [];
  const misses = [];
  for (const file of sourceFiles()) {
    const text = readFileSync(file, "utf8");
    const lines = text.split("\n");
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const seen = new Map();

    const visit = (node) => {
      if (isLiteral(node) && !inTypePosition(node) && !isModuleSpecifier(node) && !isDiagnosticSink(node)) {
        const holder = holderOf(node, sf);
        if (holder) {
          // A previously claimed holder already gathered every literal below it. Do not list its
          // second and later literals again as misses while the visitor walks those children.
          if (seen.has(holder.node)) return;
          // The same applies one level in: `const feedback = { "absence-sentinel": "…" }` reports
          // the object once, and the property inside it must not repeat those bytes as a second
          // row. A strong holder is the deliberate exception, so a reviewed name still surfaces
          // from inside a settled parent.
          let above = holder.node.parent;
          while (above && !seen.has(above)) above = above.parent;
          const settledAbove = Boolean(above);
          const name = holder.name;
          const bare = (name.split(".").pop() ?? name).replace(/\(\)$/, "");
          const strong = STRONG.test(bare);
          const denied = isDenied(name) || isDenied(bare);
          if (settledAbove && !strong) return;
          // A SCREAMING_SNAKE_CASE holder is already treated as significant by `composedNames`,
          // which lists it under **Composes** — but its own text was never reported. That is how
          // `PUBLIC_VALIDITY_AUDIT_CLAUSE` (4,581 bytes) and `TOOL_ACQUISITION_CLAUSE` (2,578),
          // both inside the Builder start prompt, stayed out of five consecutive censuses. It
          // enters at the vocabulary tier, not the strong tier, so the deny tokens and
          // `--min-chars` still drop `..._DIR`, `..._FILE` and `..._SCHEMA` constants.
          const screaming = /^[A-Z][A-Z0-9_]{3,}$/.test(bare);
          // A local const inside a prompt builder is part of that prompt, however it is named:
          // `responseContract` in `buildPacketPrompt`, `expectation` and `census` in
          // `kickoffTaskCardPrompts`, `census` under `ACTIVE_JUDGE_PROMPTS`. Each was live
          // model-visible text sitting in the unclaimed table because only its own last segment
          // was ever tested. A declared holder inherits its owner's classification; an argument
          // (`nonResult("…")`) does not, because the callee owns that text, not the caller.
          const qualifier = qualifierOf(holder, name, sf);
          const qualified =
            qualifier !== null &&
            !isDenied(qualifier) &&
            (/^[A-Z][A-Z0-9_]{3,}$/.test(qualifier) || STRONG.test(qualifier) || VOCAB.test(qualifier));
          if (strong || (!denied && (screaming || VOCAB.test(bare) || qualified))) {
            seen.set(holder.node, true);
            const pieces = [];
            const gather = (n) => {
              if (isLiteral(n)) pieces.push(literalText(n, sf));
              else n.forEachChild(gather);
            };
            gather(holder.node);
            const body = pieces.join("\n");
            // Claimed either way: its inner literals are already part of the body above, so the
            // walk of this holder ends here whether or not the body was long enough to report.
            if (body.trim().length < (strong ? 1 : minChars)) return;
            const { line } = sf.getLineAndCharacterOfPosition(holder.node.getStart(sf));
            const rel = path.relative(root, file);
            surfaces.push({
              file: rel,
              audience: audienceOf(rel),
              line: line + 1,
              name,
              fn: enclosingFunctionName(holder.node, sf),
              kind: holder.kind,
              guards: guardChain(holder.node, sf),
              composes: composedNames(holder.node, sf),
              context: precedingLines(lines, line, contextLines),
              text: body,
              bytes: new TextEncoder().encode(body).byteLength,
              digest: sha8(body),
            });
            return;
          }
          // A deny rule classifies the whole holder as structural or operator-only. Do not list
          // its literals as unclaimed after declining it as a candidate above. Strong holders
          // remain an explicit exception for a deliberately reviewed name.
          if (denied && !strong) {
            seen.set(holder.node, true);
            return;
          }
        }
        const raw = literalText(node, sf);
        if (raw.trim().length >= missChars && !seen.has(node)) {
          seen.set(node, true);
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
          const rel = path.relative(root, file);
          misses.push({
            file: rel,
            audience: audienceOf(rel),
            line: line + 1,
            holder: holder?.name ?? "(unnamed)",
            preview: boundText(oneLine(raw), 140).shown,
          });
        }
      }
      node.forEachChild(visit);
    };
    visit(sf);
  }
  return { surfaces: [...documentSurfaces(), ...surfaces], misses };
}

const gitHead = () => gitMaybe(root, "rev-parse", "--short", "HEAD") ?? "unknown";

const mdCell = (value) => String(value).replace(/\|/g, String.raw`\|`).replace(/\r?\n/g, " ");
const fenceFor = (value, language) => {
  const runs = String(value).match(/`+/g) ?? [];
  const ticks = "`".repeat(Math.max(3, ...runs.map((run) => run.length + 1)));
  return { open: `${ticks}${language}`, close: ticks };
};

function render(surfaces, misses) {
  const byFile = new Map();
  for (const s of surfaces) {
    if (!byFile.has(s.file)) byFile.set(s.file, []);
    byFile.get(s.file).push(s);
  }
  const guarded = surfaces.filter((s) => s.guards.length > 0).length;
  const out = [];
  out.push("# Candidate prompt-surface census");
  out.push("");
  out.push(
    `Candidate strings a model could read, with the condition that decides whether code selects them. ` +
      `Derived from the AST — nothing is annotated in source. Confirm delivery at the model-call or receipt boundary.`,
  );
  out.push("");
  const docNote = docPaths.length > 0 ? `; documents from \`${docPaths.join("`, `")}\`` : "";
  out.push(`- root: \`${root}\` at commit \`${gitHead()}\` (scanned \`${dirs.join("`, `")}\`${docNote})`);
  const documents = surfaces.filter((s) => s.kind === "document").length;
  out.push(`- ${surfaces.length} surfaces in ${byFile.size} files; ${guarded} sit behind a condition`);
  if (documents > 0) {
    out.push(
      `- ${documents} of them are whole documents (\`--doc\`): the AST cannot reach these bytes, so ` +
        `check in source that each file is copied or prepended where the census claims`,
    );
  } else if (docPaths.length === 0) {
    out.push(
      `- no \`--doc\` paths given: any guide, operating document or seed file a model reads whole ` +
        `is outside this census`,
    );
  }
  out.push(`- context budget: ${contextLines} preceding lines per surface`);
  out.push("");
  const audiences = [...new Set(surfaces.map((s) => s.audience))].sort();
  out.push(
    `- audiences: ${audiences.map((a) => `${a} (${surfaces.filter((s) => s.audience === a).length})`).join(", ")}`,
  );
  out.push("");
  out.push("## Index");
  out.push("");
  out.push("| surface | audience | file:line | reached when | bytes |");
  out.push("|---|---|---|---|---|");
  for (const s of surfaces) {
    const when =
      s.kind === "document"
        ? "delivered whole (verify)"
        : s.guards.length === 0
          ? "always"
          : boundText(s.guards.map((g) => g.text).join(" · "), 60).shown;
    out.push(
      `| \`${mdCell(s.name)}\` | ${mdCell(s.audience)} | ${mdCell(`${s.file}:${s.line}`)} | ${mdCell(when)} | ${s.bytes} |`,
    );
  }
  out.push("");

  for (const [file, group] of byFile) {
    out.push(`## ${file}`);
    out.push("");
    for (const s of group) {
      out.push(
        `### \`${s.name}\` — L${s.line} · ${s.kind} · audience guess: ${s.audience} · sha \`${s.digest}\``,
      );
      out.push("");
      out.push(
        s.kind === "document"
          ? `**Reached when:** whenever this file is delivered — verify the copy or prepend in source.`
          : s.guards.length === 0
            ? `**Reached when:** unconditionally${s.fn ? ` (whenever \`${s.fn}\` runs)` : ""}.`
            : `**Reached when:** ${s.guards.map((g) => `${g.text}`).join(" → ")}${s.fn ? `, in \`${s.fn}\`` : ""}`,
      );
      if (s.composes.length > 0) out.push(`**Composes:** ${s.composes.map((n) => `\`${n}\``).join(", ")}`);
      out.push("");
      if (s.context.length > 0) {
        const contextText = s.context.join("\n");
        const contextFence = fenceFor(contextText, "ts");
        out.push("<details><summary>context</summary>");
        out.push("");
        out.push(contextFence.open);
        out.push(contextText);
        out.push(contextFence.close);
        out.push("");
        out.push("</details>");
        out.push("");
      }
      const textFence = fenceFor(s.text, "text");
      out.push(textFence.open);
      out.push(s.text);
      out.push(textFence.close);
      out.push("");
    }
  }

  out.push("## Not claimed by the vocabulary");
  out.push("");
  out.push(
    `Strings of ${missChars}+ characters whose holder name did not match. Some are prose that never ` +
      `reaches a model; a prompt appearing here means the vocabulary needs a word, not that the ` +
      `census is complete.`,
  );
  out.push("");
  if (misses.length === 0) {
    out.push("None.");
  } else {
    out.push("| holder | file:line | preview |");
    out.push("|---|---|---|");
    for (const m of misses) {
      out.push(`| \`${mdCell(m.holder)}\` | ${mdCell(`${m.file}:${m.line}`)} | ${mdCell(m.preview)} |`);
    }
  }
  out.push("");
  return out.join("\n");
}

const audienceFilter = flag("audience", null);
let { surfaces, misses } = collect();
if (audienceFilter) {
  const before = surfaces.length;
  surfaces = surfaces.filter((s) => s.audience.toLowerCase().includes(audienceFilter.toLowerCase()));
  const missesBefore = misses.length;
  misses = misses.filter((m) => m.audience.toLowerCase().includes(audienceFilter.toLowerCase()));
  console.log(
    `audience filter "${audienceFilter}": ${surfaces.length} of ${before} surfaces, ` +
      `${misses.length} of ${missesBefore} unclaimed strings`,
  );
}
mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, render(surfaces, misses));
if (hasText(jsonPath)) {
  mkdirSync(path.dirname(jsonPath), { recursive: true });
  writeJsonFile(jsonPath, { root, commit: gitHead(), surfaces, misses });
}
console.log(
  `${surfaces.length} surfaces (${surfaces.filter((s) => s.guards.length > 0).length} conditional), ` +
    `${misses.length} unclaimed long strings → ${path.relative(root, outPath)}`,
);
