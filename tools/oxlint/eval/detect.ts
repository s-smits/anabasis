/**
 * Runs the implicit-state detectors of a lint worktree over one tree and returns their hits in one
 * form: the per-file Oxlint rules of `implicit-state` and `implicit-state-opinionated`, and the
 * tree scans `tree-implicit-state.ts` exports. The detectors are read from the worktree passed in,
 * never from this one, so the eval scores whatever the lint lane has written, committed or not.
 *
 * Each rule runs once at its most permissive setting, and a sweep then reads each hit's
 * `strength` (the count its message states) against a threshold. That gives every setting of a
 * threshold from one run, and is exact for any rule whose threshold is "more than N of something
 * its message counts".
 */
import { readdirSync, readFileSync, writeFileSync } from "#src/meta/filesystem.ts";
import { isFunction, isNumber, isRecord, isString, type JsonValue } from "#src/meta/json-shape.ts";
import { capturedJsonParse, capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { join } from "#src/meta/path.ts";
import { runtimeProcess } from "#src/meta/process.ts";
import { decodeOutput, runSync } from "#src/meta/subprocess.ts";
import { OXLINT_BINARY } from "../../runtime/lint.ts";

export type Tier = "generic" | "opinionated";

/** One place a hit names: a file of the tree and a line in it. */
export interface Place {
  file: string;
  line: number;
}

export interface Hit {
  rule: string;
  tier: Tier;
  file: string;
  line: number;
  /** Every place the hit names: its own line, and for a tree scan each reader it lists. */
  places: Place[];
  message: string;
  /** The count a threshold reads, or the subject word a categorical option reads. */
  strength: number | string | null;
}

/** The detector sources whose bytes key a cached result. */
export const DETECTOR_SOURCES = [
  "tools/oxlint/implicit-state",
  "tools/oxlint/implicit-state-opinionated",
  "tools/oxlint/tree-implicit-state.ts",
  "tools/oxlint/tree-external-read.ts",
  "tools/oxlint/tree-overwritten-key.ts",
];

/**
 * The permissive options each rule runs at, each rule run only where its plugin's index names it, so
 * a lint worktree from before a rule still scores. `flag-count` reports from two flags so a sweep can
 * set its floor anywhere above; `name-encoded-state` reads every subject word its head comment
 * names, the three left out by default included, so the sweep can weigh each word.
 */
const PERMISSIVE = {
  "implicit-state/co-assigned-flags": "warn",
  "implicit-state/files-as-phase": "warn",
  "implicit-state/mtime-as-lock": "warn",
  "implicit-state-opinionated/flag-count": ["warn", { max: 1, params: 1 }],
  "implicit-state-opinionated/flags-as-state": "warn",
  "implicit-state-opinionated/name-encoded-state": [
    "warn",
    {
      subjects: [
        "name",
        "branch",
        "ref",
        "label",
        "slug",
        "title",
        "file",
        "dir",
        "path",
        "id",
        "key",
        "tag",
      ],
    },
  ],
} satisfies Record<string, JsonValue>;
const SKIPPED_DIRECTORY =
  /^(?:node_modules|dist|build|out|coverage|vendor|vendored|third[-_]party|generated)$/u;
/** Dot folders a tree scan reads: this repository keeps skill scripts under `.claude`. */
const READ_DOT_DIRECTORIES = new Set([".claude"]);
const SOURCE = /\.(?:ts|tsx|mts|cts)$/u;
const DECLARATION = /\.d\.[cm]?ts$/u;
const OXLINT_CODE = /^(?<plugin>[\w-]+)\((?<rule>[\w-]+)\)$/u;
/** A rule's count in its message: booleans held, parameters taken, readers, or times read. */
const COUNTS: readonly [string, RegExp][] = [
  ["flag-count", /(?:holds|takes) (\d+) boolean/u],
  ["state-literal-spread", /grouped by hand in (\d+) other files/u],
  ["repeated-external-read", /(\d+) times on one path/u],
];

/** The count or word a sweep reads off a hit's message, or null where its rule has none. */
function strengthOf(rule: string, message: string): number | string | null {
  if (rule === "files-as-phase") return (/\(`[^)]*\)/u.exec(message)?.[0] ?? "").split("`, `").length;
  if (rule === "repeated-external-read" && message.includes("once for each item")) return 2;
  if (rule === "name-encoded-state") {
    const subject = /^`(?<subject>[^`]+)`/u.exec(message)?.groups?.subject ?? "";
    const word = /(?<word>[A-Za-z]+)\W*$/u.exec(subject)?.groups?.word ?? "";
    return (word.split(/_|(?=[A-Z])/u).at(-1) ?? "").toLowerCase().replace(/s$/u, "");
  }
  const pattern = COUNTS.find(([name]) => name === rule)?.[1];
  const count = pattern?.exec(message)?.[1];
  return count === undefined ? null : Number(count);
}

/** The Oxlint config that loads both plugins from the lint worktree at their permissive options. */
function configOf(detectors: string): JsonValue {
  return {
    jsPlugins: [
      { name: "implicit-state", specifier: join(detectors, "tools/oxlint/implicit-state/index.ts") },
      {
        name: "implicit-state-opinionated",
        specifier: join(detectors, "tools/oxlint/implicit-state-opinionated/index.ts"),
      },
    ],
    categories: { correctness: "off" },
    ignorePatterns: ["**/node_modules/**", "**/vendor/**", "**/dist/**", "**/*.d.ts"],
    rules: Object.fromEntries(
      Object.entries(PERMISSIVE).filter(([name]) => {
        const [plugin = "", rule = ""] = name.split("/");
        return readFileSync(join(detectors, "tools/oxlint", plugin, "index.ts"), "utf8").includes(
          `"${rule}"`,
        );
      }),
    ),
  };
}

/** One diagnostic of Oxlint's JSON report as a hit, or null where it is not an implicit-state one. */
function hitOfDiagnostic(row: JsonValue): Hit | null {
  if (!isRecord(row) || !isString(row.code) || !isString(row.filename) || !isString(row.message)) return null;
  const { plugin, rule } = OXLINT_CODE.exec(row.code)?.groups ?? {};
  if (plugin === undefined || rule === undefined || !plugin.startsWith("implicit-state")) return null;
  const [label] = Array.isArray(row.labels) ? row.labels : [];
  const span = isRecord(label) && isRecord(label.span) ? label.span : {};
  const line = isNumber(span.line) ? span.line : 0;
  const file = row.filename.replace(/^\.\//u, "");
  const tier: Tier = plugin === "implicit-state" ? "generic" : "opinionated";
  return {
    rule,
    tier,
    file,
    line,
    places: [{ file, line }],
    message: row.message,
    strength: strengthOf(rule, row.message),
  };
}

/** The per-file rules' hits over a tree, through the lint worktree's own Oxlint. */
export function ruleHits(detectors: string, root: string, scratch: string): Hit[] {
  // One config a process: scorers of other lint worktrees may share the cache and run at once.
  const config = join(scratch, `implicit-state-eval-${String(runtimeProcess.pid)}.oxlintrc.json`);
  writeFileSync(config, capturedJsonStringify(configOf(detectors)));
  const roots = ["."];
  if (readdirSync(root).includes(".claude")) roots.push(".claude");
  const oxlint = join(detectors, OXLINT_BINARY);
  const result = runSync(
    [runtimeProcess.execPath, "--no-env-file", oxlint, "-c", config, "--format=json", ...roots],
    { cwd: root },
  );
  const text = decodeOutput(result.stdout);
  const parsed = text.trim() === "" ? null : capturedJsonParse(text);
  if (!isRecord(parsed) || !Array.isArray(parsed.diagnostics)) {
    throw new Error(
      `oxlint gave no report over ${root} (exit ${String(result.exitCode)}): ${decodeOutput(result.stderr).slice(0, 400)}`,
    );
  }
  return parsed.diagnostics.flatMap((row) => hitOfDiagnostic(row) ?? []);
}

/** Every TypeScript file a tree scan reads, by its path under the root. */
function sourcesUnder(root: string, at = root, files = new Map<string, string>()): Map<string, string> {
  for (const entry of readdirSync(at, { withFileTypes: true })) {
    const path = join(at, entry.name);
    const hidden = entry.name.startsWith(".") && !READ_DOT_DIRECTORIES.has(entry.name);
    if (entry.isDirectory() && !hidden && !SKIPPED_DIRECTORY.test(entry.name)) {
      sourcesUnder(root, path, files);
    } else if (entry.isFile() && SOURCE.test(entry.name) && !DECLARATION.test(entry.name)) {
      files.set(path.slice(root.length + 1), readFileSync(path, "utf8"));
    }
  }
  return files;
}

/** One row a tree scan returns as a hit, or null where the row is not one. */
function hitOfFinding(row: unknown): Hit | null {
  if (
    !isRecord(row) ||
    !isString(row.kind) ||
    !isString(row.path) ||
    !isNumber(row.line) ||
    !isString(row.detail)
  ) {
    return null;
  }
  const listed = Array.isArray(row.places) ? row.places : [];
  const places = listed.flatMap((one) =>
    isRecord(one) && isString(one.path) && isNumber(one.line) ? [{ file: one.path, line: one.line }] : [],
  );
  const own = { file: row.path, line: row.line };
  return {
    rule: row.kind,
    tier: row.kind === "unowned-state-literal" ? "opinionated" : "generic",
    file: row.path,
    line: row.line,
    places: [own, ...places],
    message: row.detail,
    strength: strengthOf(row.kind, row.detail),
  };
}

/**
 * The tree scans' hits, by importing the lint worktree's `implicitStateFindings` and handing it the
 * tree's sources. The scan's own command skips every dot folder; this reads `.claude` too.
 */
export async function scanHits(detectors: string, root: string): Promise<Hit[]> {
  const loaded: unknown = await import(join(detectors, "tools/oxlint/tree-implicit-state.ts"));
  const scan = isRecord(loaded) ? loaded.implicitStateFindings : undefined;
  if (!isFunction(scan)) throw new Error(`${detectors} exports no implicitStateFindings`);
  const rows: unknown = Reflect.apply(scan, undefined, [sourcesUnder(root)]);
  return (Array.isArray(rows) ? rows : []).flatMap((row) => hitOfFinding(row) ?? []);
}
