/** Bundle generated verifier bytes without importing them into the controller. */
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import { existsSync, lstatSync, mkdtempSync, realpathSync, rmSync } from "../meta/filesystem.ts";
import { tmpdir } from "../meta/os.ts";
import { dirname, join, relative, resolve } from "../meta/path.ts";
import { sha256, sha256OfFile } from "../meta/digest.ts";
import { runtimeProcess } from "../meta/process.ts";
import { errorMessage } from "../meta/runtime-values.ts";
import { buildWorkerBundle } from "../meta/subprocess.ts";
import { hashBundle } from "../claim/bundle-hash.ts";
import { VERIFIER_PUBLIC_PACKAGES } from "../claim/scoring-closure.ts";
import {
  assertGeneratedSourceLoaders,
  generatedBuiltinRefusal,
} from "../solve/generated-tool-source-policy.ts";

/** `digest` names the exact bundle file; `portableDigest` names the same bytes with the snapshot
 *  and temporary locations removed from its module path comments, so a stage key can match
 *  identical source bundled from two snapshots. */
export interface EvaluatorBundle {
  dir: string;
  file: string;
  digest: string;
  portableDigest: string;
}
export const REFERENCE_SOLVE_ENTRY = "correctness-model/reference/index.ts";
/** The same entry with the export a finding names, so a rename carries both. */
export const REFERENCE_SOLVE_ENTRY_SOLVE = `${REFERENCE_SOLVE_ENTRY}#solve`;
export const REFERENCE_SOLVE_MIGRATION = `${REFERENCE_SOLVE_ENTRY} must export solve(task). Move the public reference implementation and its helpers into correctness-model/reference/; that package cannot import private evaluator files, tasks or controls`;
type Role = "evaluate" | "reference";
const bundles = new Map<string, Promise<EvaluatorBundle>>();
const directories = new Set<string>();

/** Check containment including the root itself, without confusing a sibling prefix with a child.
 *  An empty entrypoint importer resolves relative to the working directory. */
function inside(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === "" || (rel !== ".." && !rel.startsWith("../") && !rel.startsWith("/"));
}
runtimeProcess.once("exit", () => {
  for (const dir of directories) rmSync(dir, { recursive: true, force: true });
});

/** An unreaped process still owns these bytes; its lifetime record, not exit cleanup, releases them. */
export function retainEvaluatorBundle(dir: string): void {
  directories.delete(dir);
}

export async function bundleEvaluator(slugDir: string): Promise<EvaluatorBundle> {
  return bundle(slugDir, "evaluate");
}

export async function bundleReferenceSolve(slugDir: string): Promise<EvaluatorBundle> {
  if (!existsSync(join(slugDir, REFERENCE_SOLVE_ENTRY))) throw new Error(REFERENCE_SOLVE_MIGRATION);
  return bundle(slugDir, "reference");
}

async function bundle(slugDir: string, role: Role): Promise<EvaluatorBundle> {
  const root = join(slugDir, "correctness-model");
  if (lstatSync(root).isSymbolicLink()) {
    throw new Error("correctness-model package root must be a direct directory");
  }
  const identity = hashBundle(root);
  const key = `${root}:${identity.hash}:${role}`;
  const cached = bundles.get(key);
  if (cached !== undefined) return cached;
  const pending = build(realpathSync(root), role)
    .then((built) => {
      if (hashBundle(root).hash !== identity.hash) throw new Error("evaluator source changed while bundling");
      return built;
    })
    .catch((error) => {
      bundles.delete(key);
      throw error;
    });
  bundles.set(key, pending);
  return pending;
}

/** Bun names each inlined module in a `// <path>` comment relative to the working directory. Only
 *  those comment lines lose the package root and bundle directory; a location inside executable
 *  code stays in the digest, so such a bundle can only miss a stage key, never match a different one. */
async function portableDigest(file: string, root: string): Promise<string> {
  const cwd = runtimeProcess.cwd();
  const bundleDir = dirname(file);
  const locations: Array<[string, string]> = [
    [root, "<package>"],
    [relative(cwd, root), "<package>"],
    [bundleDir, "<bundle>"],
    [relative(cwd, bundleDir), "<bundle>"],
  ];
  const text = await Bun.file(file).text();
  return sha256(
    text
      .split("\n")
      .map((line) =>
        line.startsWith("// ")
          ? locations.reduce((named, [location, token]) => named.replaceAll(location, token), line)
          : line,
      )
      .join("\n"),
  );
}

async function build(root: string, role: Role): Promise<EvaluatorBundle> {
  const publicRoot = join(root, "reference");
  const sourceRoot = role === "reference" ? publicRoot : root;
  const dir = mkdtempSync(join(tmpdir(), `ana-${role}-`));
  const entry = join(dir, "entry.ts");
  const child = Bun.fileURLToPath(
    new URL(
      role === "reference" ? "./reference-solve-child.ts" : "./evaluator-process-child.ts",
      import.meta.url,
    ),
  );
  const run = role === "reference" ? "runReferenceSolveProcess" : "runEvaluatorProcess";
  const generatedEntry = role === "reference" ? join(publicRoot, "index.ts") : join(root, "evaluator.ts");
  try {
    await Bun.write(
      entry,
      `import { ${run} } from ${capturedJsonStringify(child)};\n` +
        `await ${run}(() => import(${capturedJsonStringify(generatedEntry)}));\n`,
    );
    const output = await buildWorkerBundle("evaluator bundle failed", entry, dir, [
      generatedBuiltinRefusal(root),
      {
        name: "evaluator-runtime-source",
        setup(plugin) {
          // OS isolation cannot hide a private file already embedded in the bundle.
          plugin.onResolve({ filter: /.*/ }, (args) => {
            if (!inside(root, args.importer)) return undefined;
            // Resolved from the controller, so a candidate tsconfig `paths` alias or workspace
            // node_modules cannot put candidate bytes behind a public name the scoring closure skips.
            if (VERIFIER_PUBLIC_PACKAGES.has(args.path)) {
              return { path: Bun.resolveSync(args.path, import.meta.dir) };
            }
            // A public helper must stay public even when imported by the evaluator: the reference
            // solve must be able to load it without also loading private dependencies.
            const boundary = inside(publicRoot, args.importer) ? publicRoot : sourceRoot;
            if (args.path.startsWith(".") && inside(boundary, resolve(dirname(args.importer), args.path))) {
              return undefined;
            }
            throw new Error(`evaluator import outside its bundle or public contract: ${args.path}`);
          });
          // Inspect only modules the runtime actually loads. An unimported evaluator.test.ts
          // may legitimately import bun:test and is not part of the execution closure.
          plugin.onLoad({ filter: /.*/ }, (args) => {
            const path = relative(root, args.path);
            if (inside(root, args.path)) {
              const physical = realpathSync(args.path);
              if (!inside(sourceRoot, physical)) {
                throw new Error(`generated source escapes its ${role} package: ${path}`);
              }
              const program = /\.[cm]?[jt]sx?$/.test(physical);
              if (!program && !inside(publicRoot, physical)) {
                throw new Error(
                  `evaluator cannot import private operand data: ${path}; use the check request, or put public support data in reference/`,
                );
              }
              if (program) assertGeneratedSourceLoaders(root, [{ path }]);
            }
            return undefined;
          });
        },
      },
    ]);
    rmSync(entry, { force: true });
    const file = realpathSync(output);
    directories.add(dir);
    return { dir, file, digest: sha256OfFile(file), portableDigest: await portableDigest(file, root) };
  } catch (error) {
    rmSync(dir, { recursive: true, force: true });
    if (error instanceof AggregateError) {
      throw new Error(
        `evaluator bundle failed: ${error.errors.map((item) => errorMessage(item)).join("; ")}`,
        { cause: error },
      );
    }
    throw error;
  }
}
