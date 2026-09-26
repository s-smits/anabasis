/**
 * Checks imports in the agent bundle. Agent files may not import correctnessModel files, unknown packages,
 * hidden-answer files, or Node built-ins. `projectPublic` separately keeps hidden fields out of
 * agent input, and the runtime sandbox blocks reads of correctnessModel paths. Each check covers a different
 * route to hidden data.
 */
import { readFileSync } from "../meta/filesystem.ts";
import { isBuiltin } from "../meta/modules.ts";
import { dirname, isAbsolute, join, relative, resolve } from "../meta/path.ts";
import * as ts from "typescript5";
import { IrregularBundleEntryError, hashBundle } from "./bundle-hash.ts";

type BundleValidationFindingCode =
  | "cross-isolation-import"
  | "escape-import"
  | "unvetted-import"
  | "builtin-import"
  | "key-material-file"
  | "missing-bundle"
  | "non-regular-entry"
  | "correctness-model-capability-escape";

export interface BundleValidationFinding {
  code: BundleValidationFindingCode;
  /** Posix path relative to the bundle root. */
  file: string;
  detail: string;
}

interface BundleValidationResult {
  ok: boolean;
  findings: BundleValidationFinding[];
  scannedFiles: number;
}

/** The only packages an agent bundle may import; every other package is refused. */
const ALLOWED_PACKAGES: ReadonlySet<string> = new Set([
  "@ana/agent-bundle",
  "@ana/correctness-model-prims",
  "@earendil-works/pi-ai",
  "typebox",
]);

const CORRECTNESS_MODEL_PACKAGE = "@ana/correctness-model-bundle";

const CODE_EXT = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;

/**
 * Detect possible answer keys by filename. A name cannot prove what a file contains, and the
 * public projection and the sandbox are what restrict the data actually available to the agent.
 * Every leaked answer key observed so far had a recognisable filename, so this inexpensive check
 * catches the known mistakes without pretending to be the wall.
 */
const KEY_MATERIAL_RE =
  /(answer[-_]?keys?|answers?\.(json|ts|js|mjs|sql|csv)$|hidden[-_]?(expectations?|answers?)|expected[-_]?(outputs?|answers?)|reference[-_]?(solver|solution))/i;

/** Parse once for the import and ambient-capability checks over the same source bytes. */
export function parseGeneratedSource(source: string, filePath: string): ts.SourceFile {
  return ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
}

/** Collect module specifiers from the syntax tree. The regular-expression check this replaced
 *  matched the words from, import and require inside unrelated string and array literals:
 *  `["from", "fromJoint"]` produced the false specifier ", " and refused a valid bundle. The
 *  syntax-tree walk reads actual dependencies —
 *  import and export declarations, `import =` external references, dynamic import() and require()
 *  calls — and `loads` keeps each literal operand node. */
export function specifiersIn(sourceFile: ts.SourceFile) {
  const loads: ts.StringLiteralLike[] = [];
  const opaque: string[] = [];
  const record = (expr: ts.Expression | undefined, edge: string, node: ts.Node): void => {
    if (expr !== undefined && ts.isStringLiteralLike(expr)) {
      loads.push(expr);
      return;
    }
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    opaque.push(`${edge} at line ${line}`);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) record(node.moduleSpecifier, "import", node);
    // export {x} refers to local names; a module clause makes it a re-export from another file.
    else if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined) {
      record(node.moduleSpecifier, "export", node);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      record(node.moduleReference.expression, "import = require", node);
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const dynamicImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      const bareRequire = ts.isIdentifier(callee) && callee.text === "require";
      // With no first argument, record() reports that the import target cannot be inspected.
      if (dynamicImport || bareRequire) {
        record(node.arguments[0], dynamicImport ? "import()" : "require()", node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { specifiers: [...new Set(loads.map((load) => load.text))], opaque, loads };
}

/** One generated file's import graph: the edges this check cannot read, then each one it can. */
function importFindings(path: string, abs: string, agentDir: string): BundleValidationFinding[] {
  const findings: BundleValidationFinding[] = [];
  const scan = specifiersIn(parseGeneratedSource(readFileSync(abs, "utf8"), path));
  for (const edge of scan.opaque) {
    findings.push({
      code: "unvetted-import",
      file: path,
      detail: `${edge}: the import target must be a string literal so this check can inspect it`,
    });
  }
  for (const spec of scan.specifiers) {
    if (spec.startsWith(".")) {
      const rel = relative(agentDir, resolve(dirname(abs), spec));
      if (rel.startsWith("..") || isAbsolute(rel)) {
        findings.push({
          code: "escape-import",
          file: path,
          detail: `"${spec}" resolves outside agent/; agent code may import only files inside agent/`,
        });
      }
      continue;
    }
    if (isAbsolute(spec)) {
      findings.push({
        code: "escape-import",
        file: path,
        detail: `"${spec}" is an absolute-path import; agent code may not use absolute-path imports`,
      });
      continue;
    }
    if (isBuiltin(spec)) {
      // Agent tools execute in the host process, outside the solver's OS read restrictions.
      // A `node:fs` import could read hidden data; tools must use the provided package exports.
      findings.push({
        code: "builtin-import",
        file: path,
        detail: `"${spec}" imports a Node built-in. Agent tools run in the host process, so built-ins could read hidden files; use the provided tool package instead`,
      });
      continue;
    }
    const segments = spec.split("/");
    const pkg = spec.startsWith("@") ? segments.slice(0, 2).join("/") : (segments[0] ?? spec);
    if (pkg === CORRECTNESS_MODEL_PACKAGE) {
      findings.push({
        code: "cross-isolation-import",
        file: path,
        detail: `"${spec}" imports correctnessModel code into agent/; correctnessModel code is not available to the solver`,
      });
    } else if (!ALLOWED_PACKAGES.has(pkg)) {
      findings.push({
        code: "unvetted-import",
        file: path,
        detail: `"${spec}" is not allowed in agent/; use one of [${[...ALLOWED_PACKAGES].join(", ")}]`,
      });
    }
  }
  return findings;
}

// Gate audit 2026-09-25 (docs/gate-audit.md, bundle-walls): kept: agent code may not import the correctness
// model, unvetted packages or built-ins, nor ship key material or unhashable entries, which is the isolation
// of hidden data from the solver.
export function validateAgentBundle(agentDir: string): BundleValidationResult {
  const findings: BundleValidationFinding[] = [];
  let files: ReturnType<typeof hashBundle>["files"];
  try {
    files = hashBundle(agentDir).files;
  } catch (error) {
    if (!(error instanceof IrregularBundleEntryError)) throw error;
    // A symlink the walker skipped would be unhashed and unscanned, so validation would approve a
    // bundle whose runtime import graph it never saw. Refusing the whole
    // bundle is the only answer available here, because the entry that was skipped is exactly the
    // one whose content nothing below can read.
    return {
      ok: false,
      findings: error.entries.map((path) => ({
        code: "non-regular-entry" as const,
        file: path,
        detail:
          "unsupported or excluded entry in the agent bundle; unhashed content could bypass the import check",
      })),
      scannedFiles: 0,
    };
  }

  let scannedFiles = 0;
  for (const file of files) {
    if (KEY_MATERIAL_RE.test(file.path)) {
      findings.push({
        code: "key-material-file",
        file: file.path,
        detail:
          "filename matches hidden-answer material; keep hidden expectations in correctness-model/, not agent/",
      });
    }
    if (!CODE_EXT.test(file.path)) continue;
    scannedFiles += 1;
    findings.push(...importFindings(file.path, join(agentDir, file.path), agentDir));
  }

  return { ok: findings.length === 0, findings, scannedFiles };
}
