/** The scoring program's content address: the package bytes the host verifier runs or reads to reach
 *  a verdict, apart from the battery. That is brief.json, which declares the checks, and evaluator.ts
 *  with every file it reaches through relative imports. The evaluator bundle admits nothing else from
 *  the package (`evaluator-process-bundle.ts`), so a reference solve or a test the evaluator never
 *  imports can change with the battery without moving what scores it.
 *
 *  correctnessModelHash stays the byte identity of the whole package, and candidate identity and
 *  snapshot integrity need that: a reference-only repair is a new candidate even when it scores
 *  nothing differently. This hash answers the narrower question every task-only reading asks.
 *
 *  The walk is static, and static is the whole closure, because the bundle refuses builtins and
 *  every runtime loader (`import()`, `Bun`, `require`, `eval`, through
 *  `assertGeneratedSourceLoaders`). A module's name decides nothing: a test the evaluator imports
 *  is scoring. The walk errs towards movement — a type-only import is erased and skipped, while an
 *  unused, side-effect or re-export import keeps its file inside — so the reading can over-report a
 *  change but never hide a module the evaluator bundle runs.
 *
 *  A program a check executes as a tool is not such a module, however much of the verdict it
 *  decides. An installed solver, or an analyser the Builder wrote under `.toolchain`, runs in its
 *  own process, outside the package and outside this hash, so an analyser rewritten underneath an
 *  unchanged evaluator leaves the hash where it was. Those bytes are named by the bundle snapshot's
 *  portable tool tree digest (`BundleSnapshotFact.toolTreeDigest`) and by the claim's
 *  `verifierEnvironmentHash`, and a reading that asks whether scoring moved has to read one of them
 *  beside this hash.
 *
 *  Bun also compiles each module under the nearest tsconfig.json or jsconfig.json, following its
 *  `extends`, and the nearest package.json: `useDefineForClassFields`, `experimentalDecorators` or
 *  a `.js` file's `type` change the bundle while every walked byte stays put. A package carrying
 *  any such file is therefore read whole. A file above the package is outside this hash and
 *  correctnessModelHash alike.
 *
 *  The same walk, `runtimeClosure`, names the code the capability-escape scan reads
 *  (`verifierSourceFiles`), from the reference solve's entry as well as the evaluator's. */
import { existsSync, readFileSync, readdirSync, realpathSync } from "../meta/filesystem.ts";
import { basename, dirname, extname, join, relative } from "../meta/path.ts";
import { containsPath } from "../meta/path-containment.ts";
import { sha256 } from "../meta/digest.ts";
import { canonicalJson } from "../meta/stable-json.ts";
import { capturedJsonParse } from "../meta/json-runtime.ts";
import { type JsonObject, asRecord, isString } from "../meta/json-shape.ts";
import { isBuiltin } from "../meta/modules.ts";
import { BRIEF_FILE, EVALUATOR_FILE } from "../meta/bundle-layout.ts";
import type { ArtifactField, Brief, BriefTruthCheck, CheckExecution } from "../correctness-bundle/brief.ts";

/** What a package's program modules reach at run time from their entries. */
interface RuntimeClosure {
  /** Every file reached through relative imports, entries included, relative to the package root. */
  files: string[];
  /** Whether the walk followed every import it met. */
  complete: boolean;
  /** Whether an import it did not follow may still run package code it never read: a module it
   *  could not scan, or a bare specifier naming neither a Node builtin nor a controller package. */
  opaque: boolean;
}

/** One import of a program module: the package file it resolves to, or null when the walk does not
 *  follow it, and whether that unfollowed import may run code the walk never read. */
interface RuntimeImport {
  resolved: string | null;
  opaque: boolean;
}

/** Whether a verdict depends on a field of the brief or of one of its rows. A field added to
 *  any of these types fails to compile until it is classified here, so the closure cannot go on
 *  missing a field the host starts to act on, nor start counting one that only carries text. */
type FieldRole = "verdict" | "other";

/** Controller packages the evaluator may import. The evaluator bundle resolves them from the
 *  controller whatever the candidate's configuration says, so their bytes are never the
 *  candidate's and the closure stops at them. */
export const VERIFIER_PUBLIC_PACKAGES: ReadonlySet<string> = new Set([
  "@ana/correctness-model-bundle",
  "@ana/correctness-model-prims",
  "typebox",
]);

const BUILD_CONFIGURATION = new Set(["tsconfig.json", "jsconfig.json", "package.json"]);

const LOADERS = new Map<string, "ts" | "tsx" | "js" | "jsx">([
  [".ts", "ts"],
  [".mts", "ts"],
  [".cts", "ts"],
  [".tsx", "tsx"],
  [".js", "js"],
  [".mjs", "js"],
  [".cjs", "js"],
  [".jsx", "jsx"],
]);

// Each brief field and row key, as the host reads it: one read by a check, a submission or the
// verifier's runner decides a verdict, and the rest only carry text or constants.
const BRIEF_ROLES = {
  correctnessContract: "verdict",
  // Text the Judge card and the coverage map carry, and the tools the Built shell withholds from the
  // solver: none of them grades an artifact.
  slug: "other",
  domain: "other",
  decisions: "other",
  gates: "other",
  checkOnlyTools: "other",
  truthChecks: "verdict",
  // What the solver reads (`briefPublicResources`) or what a control or probe is validated against,
  // never what a check decides on.
  ruleDecisions: "other",
  joins: "other",
  designRuleConstants: "other",
  designRuleSets: "other",
  artifactSchema: "verdict",
} satisfies Record<keyof Brief, FieldRole>;

const CHECK_ROLES = {
  id: "verdict",
  execution: "verdict",
  assertion: "other",
  citedDecisionIds: "other",
  joinIds: "other",
  numericBoundaries: "other",
} satisfies Record<keyof BriefTruthCheck, FieldRole>;

const EXECUTION_ROLES = {
  families: "verdict",
  artifactPaths: "verdict",
  publicInputPaths: "verdict",
  hidden: "verdict",
  requiredToolIds: "verdict",
  evidence: "verdict",
} satisfies Record<keyof CheckExecution, FieldRole>;

// A field's `shape` is the sentence the solver reads; the submission is read against the rest.
const ARTIFACT_FIELD_ROLES = {
  name: "verdict",
  allowedValues: "verdict",
  fileMap: "verdict",
  openMapPaths: "verdict",
  "shape": "other",
} satisfies Record<keyof ArtifactField, FieldRole>;

/** The files one program module imports at run time, resolved, with null for each import the walk
 *  does not follow: one that leaves the package, names any other package or does not resolve, all of
 *  which the evaluator bundle refuses too. A module that cannot be scanned is one such import. */
function runtimeImports(root: string, file: string, source: Uint8Array): RuntimeImport[] {
  const loader = LOADERS.get(extname(file));
  if (loader === undefined) return [];
  let imports: Bun.Import[];
  try {
    imports = new Bun.Transpiler({ loader }).scanImports(source);
  } catch {
    return [{ resolved: null, opaque: true }];
  }
  return imports.flatMap(({ path }): RuntimeImport[] => {
    if (VERIFIER_PUBLIC_PACKAGES.has(path)) return [];
    if (path.startsWith(".")) return [{ resolved: resolvedInside(root, path, dirname(file)), opaque: false }];
    return [{ resolved: null, opaque: !isBuiltin(path) }];
  });
}

function resolvedInside(root: string, path: string, from: string): string | null {
  try {
    const resolved = Bun.resolveSync(path, from);
    return containsPath(resolved, root) ? resolved : null;
  } catch {
    return null;
  }
}

/** The runtime closure of `entries`, given relative to `root`; an entry that does not exist is
 *  skipped. */
export function runtimeClosure(root: string, entries: readonly string[]): RuntimeClosure {
  const files = new Set<string>();
  let complete = true;
  let opaque = false;
  const pending = entries.flatMap((entry) => (existsSync(join(root, entry)) ? [join(root, entry)] : []));
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    const name = relative(root, file);
    if (files.has(name)) continue;
    files.add(name);
    for (const { resolved, opaque: unread } of runtimeImports(root, file, readFileSync(file))) {
      if (resolved === null) complete = false;
      else pending.push(resolved);
      opaque ||= unread;
    }
  }
  return { files: [...files], complete, opaque };
}

/** The digest of every file the evaluator reaches, or null when that closure cannot be read: a
 *  package carrying build configuration, or an import the walk could not follow. */
function evaluatorDigests(root: string): Record<string, string> | null {
  const files = readdirSync(root, { recursive: true, encoding: "utf8" });
  if (files.some((path) => BUILD_CONFIGURATION.has(basename(path)))) return null;
  const closure = runtimeClosure(root, [basename(EVALUATOR_FILE)]);
  if (!closure.complete) return null;
  return Object.fromEntries(closure.files.map((name) => [name, sha256(readFileSync(join(root, name)))]));
}

/** Null when the closure cannot be read; callers then compare the whole package's bytes. */
export function scoringClosureHash(correctnessModelDir: string): string | null {
  try {
    const root = realpathSync(correctnessModelDir);
    const evaluator = evaluatorDigests(root);
    if (evaluator === null) return null;
    const briefName = basename(BRIEF_FILE);
    const brief = join(root, briefName);
    const digests = existsSync(brief)
      ? { [briefName]: sha256(readFileSync(brief)), ...evaluator }
      : evaluator;
    return sha256(canonicalJson(digests));
  } catch {
    return null;
  }
}

/** The fields of one row that `roles` marks as deciding a verdict, with any key no role names left
 *  out as the host leaves it out. Null when the value is no object. */
function verdictFields(value: unknown, roles: Record<string, FieldRole>): JsonObject | null {
  const row = asRecord(value);
  return row === null
    ? null
    : Object.fromEntries(Object.entries(row).filter(([key]) => roles[key] === "verdict"));
}

/** What the brief decides in a verdict: which checks run, by id, under which execution
 *  declaration, and the artifact schema a submission is read against. Null when the brief does not
 *  declare them, so no identity is named over a brief the host would not run. */
function briefMechanics(root: string): JsonObject | null {
  const brief = verdictFields(
    capturedJsonParse(readFileSync(join(root, basename(BRIEF_FILE)), "utf8")),
    BRIEF_ROLES,
  );
  const { truthChecks, artifactSchema } = brief ?? {};
  if (brief === null || !Array.isArray(truthChecks) || !Array.isArray(artifactSchema)) return null;
  const checks = truthChecks.map((check) => {
    const row = verdictFields(check, CHECK_ROLES);
    const execution = verdictFields(row?.execution, EXECUTION_ROLES);
    return row !== null && isString(row.id) && execution !== null ? { ...row, execution } : null;
  });
  const fields = artifactSchema.map((field) => verdictFields(field, ARTIFACT_FIELD_ROLES));
  if (checks.includes(null) || fields.includes(null)) return null;
  return { ...brief, truthChecks: checks, artifactSchema: fields };
}

/** The identity of what executes to a verdict: the evaluator closure with the brief's check ids,
 *  execution declarations and the artifact schema fields a submission is read against, and none of
 *  its text. Equal hashes mean an artifact replayed against the checks gets the same verdict,
 *  however the public rules were reworded or their numbers restated between: an assertion, a rule
 *  decision, a constant, a decision, a gate and a join are read by people and models and run
 *  nothing. `scoringClosureHash` stays the identity the task-probe freeze holds fixed, because there
 *  a changed public rule is exactly the change to catch; this one answers only whether a recheck's
 *  checks are the checks that observed the issue. Null when either half cannot be read. */
export function verdictClosureHash(correctnessModelDir: string): string | null {
  try {
    const root = realpathSync(correctnessModelDir);
    const evaluator = evaluatorDigests(root);
    const brief = briefMechanics(root);
    return evaluator === null || brief === null ? null : sha256(canonicalJson({ evaluator, brief }));
  } catch {
    return null;
  }
}
