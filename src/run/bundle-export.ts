/**
 * Write one Built Harness bundle as a directory that runs on its own: the bundle's `agent/` and
 * `correctness-model/`, the source tree those files import (`src/`, `vendor/`, `starters/`), the
 * pinned lock, and `tools/harness/cli.ts` behind two package scripts — `solve` runs one task,
 * `check` checks one artifact. The export runs the same command file and the same solve and
 * verifier implementation from the exporting checkout. This is a fresh invocation, not a replay
 * of an earlier run's source and environment.
 */
import { capturedJsonStringify } from "../meta/json-runtime.ts";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "../meta/filesystem.ts";
import { type JsonObject, isRecord } from "../meta/json-shape.ts";
import { join, relative, resolve } from "../meta/path.ts";
import { containsPath } from "../meta/path-containment.ts";
import { WORKSPACE_TOOL_TREE } from "../verify/wall-policy.ts";
import { OPERATOR_BACKENDS_DIR } from "../backends/operator-selection.ts";
import { bundleSlug, loadContract } from "./bundle-entry.ts";
import { externalChecksOf } from "../truth/brief.ts";
import { relocateToolLauncher } from "../author/toolchain-relocation.ts";
import { readJsonFile, writeJsonFile } from "../meta/completed-json.ts";

/** Repository parts an exported bundle imports at runtime. `bun.lock` carries every version pin;
 *  `tsconfig.json` only serves an editor. */
const REPO_PARTS = [
  "src",
  "vendor",
  "starters",
  "tools/harness",
  "bun.lock",
  ".bun-version",
  "tsconfig.json",
] as const;
const BUNDLE_PARTS = ["agent", "correctness-model"] as const;
/** Root manifest keys copied as they are, so the lock stays frozen-valid. */
const MANIFEST_KEYS = [
  "type",
  "packageManager",
  "engines",
  "workspaces",
  "dependencies",
  "devDependencies",
] as const;

interface ExportedBundle {
  outDir: string;
  slug: string;
  /** Top-level entries of the exported directory, sorted. */
  entries: string[];
  toolTree: "copied" | "absent";
  /** Tool-tree links to host files or to nothing, and files that still name the adopted tree after
   *  relocation, left out; such a tool resolves from the host PATH. */
  leftOut: string[];
}

/** The export's README is the repository README's section on exports, so the two cannot drift. */
function readme(
  repoRoot: string,
  slug: string,
  toolTree: string,
  leftOut: readonly string[],
  needs: readonly string[],
): string {
  const title = "Take the Harness along";
  const section = readFileSync(join(repoRoot, "README.md"), "utf8")
    .split("\n## ")
    .find((part) => part.startsWith(title));
  if (section === undefined) throw new Error(`${repoRoot}/README.md: no "${title}" section`);
  const links = leftOut.length > 0 ? `; left out, resolved from the host PATH: ${leftOut.join(", ")}` : "";
  const checks = needs.length > 0 ? ` Its checks run: ${needs.join(", ")}.` : "";
  return `# ${slug}\n\nA Built Harness exported from Anabasis. Tool tree at export: ${toolTree}${links}.${checks}\n\n## ${section.trimEnd()}\n`;
}

function packageManifest(repoRoot: string, slug: string): string {
  const parsed: unknown = readJsonFile(join(repoRoot, "package.json"));
  if (!isRecord(parsed)) throw new Error(`${repoRoot}/package.json: not an object`);
  const manifest: JsonObject = {
    name: slug,
    private: true,
    ...Object.fromEntries(
      MANIFEST_KEYS.values()
        .filter((key) => key in parsed)
        .map((key) => [key, parsed[key]] as const)
        .toArray(),
    ),
    scripts: { solve: "bun tools/harness/cli.ts run .", check: "bun tools/harness/cli.ts check ." },
  };
  return `${capturedJsonStringify(manifest, null, 2)}\n`;
}

export function exportBundle(repoRoot: string, bundleDirInput: string, outDirInput: string): ExportedBundle {
  const bundleDir = resolve(bundleDirInput);
  const outDir = resolve(outDirInput);
  for (const part of BUNDLE_PARTS) {
    if (!existsSync(join(bundleDir, part))) {
      throw new Error(`${bundleDir}: not a Built Harness bundle (no ${part}/)`);
    }
  }
  if (existsSync(outDir) && readdirSync(outDir).length > 0) {
    throw new Error(`${outDir}: exists and is not empty`);
  }
  // The tools its checks run, read before copying so an invalid brief refuses before gigabytes move.
  const needs = [
    ...new Set(externalChecksOf(loadContract(bundleDir).brief).map((check) => check.adapterId)),
  ].sort();
  mkdirSync(outDir, { recursive: true });
  for (const part of REPO_PARTS) cpSync(join(repoRoot, part), join(outDir, part), { recursive: true });
  for (const part of BUNDLE_PARTS) cpSync(join(bundleDir, part), join(outDir, part), { recursive: true });
  const toolTreeSource = join(bundleDir, WORKSPACE_TOOL_TREE);
  const toolTree = existsSync(toolTreeSource) ? "copied" : "absent";
  const leftOut: string[] = [];
  // Resolve the controller's adopted-tree link once. Nested links may name only this tree's bytes;
  // a link to a host file or to nothing is left out and named, and the exported tool then finds
  // that program on the host PATH.
  if (toolTree === "copied") {
    const root = realpathSync(toolTreeSource);
    const copy = join(outDir, WORKSPACE_TOOL_TREE);
    cpSync(root, copy, {
      recursive: true,
      dereference: true,
      filter: (source) => {
        const inside = existsSync(source) && containsPath(realpathSync(source), root);
        if (!inside) leftOut.push(relative(root, source));
        return inside;
      },
    });
    // The copy runs from its new place, as a rebuild's seed copy does: a Python launcher or Mach-O
    // install name naming the adopted tree moves with it, and a file that cannot move is left out.
    for (const name of new Bun.Glob("**/*").scanSync({ cwd: copy, dot: true })) {
      if (relocateToolLauncher(join(copy, name), root, copy, name) !== "retains-adopted-path") continue;
      rmSync(join(copy, name));
      leftOut.push(name);
    }
  }
  // A package name is lowercase with no separators beyond `-`, `.` and `_`.
  const slug =
    bundleSlug(bundleDir)
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^[-._]+/, "") || "built-harness";
  writeFileSync(join(outDir, "package.json"), packageManifest(repoRoot, slug));
  writeJsonFile(join(outDir, "harness.json"), {
    slug,
    exportedFrom: bundleDir,
    exportedAt: new Date().toISOString(),
  });
  writeFileSync(join(outDir, "README.md"), readme(repoRoot, slug, toolTree, leftOut, needs));
  // An export solves and checks; it runs no reviewer, so it says so rather than warn on every solve.
  mkdirSync(join(outDir, OPERATOR_BACKENDS_DIR), { recursive: true });
  writeJsonFile(join(outDir, OPERATOR_BACKENDS_DIR, "default.json"), { review: { disabled: true } });
  return { outDir, slug, entries: readdirSync(outDir).sort(), toolTree, leftOut };
}
