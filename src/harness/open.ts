/**
 * A Built Harness, opened for a solve: its guide, its selection of pi's coding tools and its tool
 * tree, named by one digest.
 *
 * On disk a harness is `agent/BUILT_AGENTS.md`, `agent/tools-spec.json` and `.toolchain/`.
 * `agent/config.yaml` is never read: the host owns every limit a solve runs under (`AGENTS.md`,
 * rule 11), so a harness's own figures for turns, minutes or command seconds change nothing.
 * `presets` names pi's coding tools, any of `read`, `bash`, `edit` and `write`
 * (`src/tools/coding.ts`).
 *
 * The host reads the guide and the spec and builds or runs nothing from a harness's files: what a
 * harness computes is a program under `.toolchain/bin`, which the solver starts in its shell. An
 * older harness may also hold `agent/tools.ts`, a module of tools of its own that the host once
 * bundled; few harnesses ever declared a tool, and an export dropped them. Nobody reads the file
 * now, and a harness that declares a tool is refused by the names it declares.
 */
import { AGENT_DIR, BYTECODE, GUIDE_FILE, TOOLS_SPEC_FILE, TOOL_TREE_DIR } from "../meta/bundle-layout.ts";
import { sha256OfFile } from "../meta/digest.ts";
import { existsSync, lstatSync, readlinkSync, realpathSync } from "../meta/filesystem.ts";
import { capturedJsonParse, capturedJsonStringify } from "../meta/json-runtime.ts";
import { asRecord, isRecord, isString } from "../meta/json-shape.ts";
import { join, resolve } from "../meta/path.ts";
import { containsPath } from "../meta/path-containment.ts";
import { hashJsonValue } from "../meta/stable-json.ts";
import { plural } from "../meta/text.ts";

export interface Harness {
  /** `agent/BUILT_AGENTS.md` as written, untrimmed; null when the state has none. */
  readonly guide: string | null;
  readonly presets: readonly string[];
  /** `.toolchain`, for the wall's `toolTree`; null when the state has none. */
  readonly toolTree: string | null;
  /** sha256 over everything a solve under the harness depends on: spec, guide and the tool tree's
   *  files but its Python bytecode caches (`BYTECODE`). */
  readonly digest: string;
}

/**
 * What the tool module of every harness without a tool bundled to, as the digest read it. A
 * condition on record names its harness by a digest that held that text, so it stays in the
 * digest: each kept harness that declares no tool held the Starter's module but for its comments,
 * and keeps its name (`test/harness-open.test.ts`).
 */
const NO_TOOLS_MODULE =
  "// @bun\n\nvar createDomainHarness = () => ({\n  tools: []\n});\nexport {\n  createDomainHarness\n};\n";

export async function openHarness(dir: string): Promise<Harness> {
  // The two files the host reads by name are the harness's own: a guide or a spec linked to a host
  // file would be read here, outside every wall, and handed to the solver.
  const root = realpathSync(dir);
  const guideName = `${AGENT_DIR}${GUIDE_FILE}`;
  for (const name of [guideName, TOOLS_SPEC_FILE]) {
    const file = join(dir, name);
    if (existsSync(file) && !containsPath(realpathSync(file), root)) {
      throw new Error(`${name} links outside the harness`);
    }
  }
  const guideFile = join(dir, guideName);
  const guide = existsSync(guideFile) ? await Bun.file(guideFile).text() : null;
  const spec = capturedJsonParse(await Bun.file(join(dir, TOOLS_SPEC_FILE)).text());
  const fields = asRecord(spec);
  const presets = Array.isArray(fields?.presets) && fields.presets.every(isString) ? fields.presets : null;
  const declared = Array.isArray(fields?.tools) ? fields.tools : null;
  if (presets === null || declared === null) {
    throw new Error(`${TOOLS_SPEC_FILE} needs presets and tools lists`);
  }
  if (declared.length > 0) {
    const names = declared.map((row) =>
      isRecord(row) && isString(row.name) ? row.name : capturedJsonStringify(row),
    );
    throw new Error(
      `${TOOLS_SPEC_FILE} declares ${plural(names.length, "tool")} (${names.join(", ")}): a harness gives its solver programs under ${TOOL_TREE_DIR}/bin and a guide, and its tools list stays empty`,
    );
  }
  const toolchain = resolve(dir, TOOL_TREE_DIR);
  const toolTree = existsSync(toolchain) ? toolchain : null;
  const tree = toolTree === null ? null : keptTreeContent(toolTree);
  return { guide, presets, toolTree, digest: hashJsonValue({ module: NO_TOOLS_MODULE, spec, guide, tree }) };
}

/**
 * Every path under `dir`, sorted, hidden ones too, a link listed but never entered. Bun's recursive
 * `readdirSync` enters linked directories, and a v1 harness state links its `node_modules` entries into
 * the run that built it, so one loop there ended a live solve with ELOOP before its first turn.
 */
export function pathsUnder(dir: string): string[] {
  const glob = new Bun.Glob("**");
  return [...glob.scanSync({ cwd: dir, dot: true, onlyFiles: false, followSymlinks: false })].toSorted();
}

/** Each entry under `dir` by path, mode and content: a file by its sha256, a link by its target. */
export function treeContent(dir: string) {
  return pathsUnder(dir).map((path) => {
    const full = join(dir, path);
    const stat = lstatSync(full);
    const content = stat.isSymbolicLink() ? readlinkSync(full) : stat.isFile() ? sha256OfFile(full) : null;
    return { path, mode: stat.mode, content };
  });
}

/** Each tool tree's content by where it really is, with the stamp it was read under. */
const TREES = new Map<string, { stamp: string; content: ReturnType<typeof treeContent> }>();

/** Whether a tree changed, links unfollowed: a file in it added, removed, resized, rewritten or with
 *  its mode changed changes it. A tool tree is read under it, and a solve's harness is compared by
 *  it for moved-files (`run.ts`). It holds each entry's change time with its modification time:
 *  `tar` and `cp -p` set the modification time back, so a stamp of size and modification time alone
 *  survived a rewrite of the same size under them, and a freeze reused the copy from before it. No
 *  process can set the change time back, and hashing the content, which the stamp stands in for,
 *  can read a tree of hundreds of megabytes. A stamp without the change time, mode or inode would
 *  miss a solve that rewrote a harness file so. */
export function treeStamp(real: string): string {
  return hashJsonValue(
    pathsUnder(real).map((path) => {
      const stat = lstatSync(join(real, path));
      return [path, stat.size, stat.mtimeMs, stat.ctimeMs, stat.mode, stat.ino];
    }),
  );
}

/**
 * A tool tree's content as the digest reads it, its bytecode caches left out (`BYTECODE`), read once
 * for as long as its stamp holds. Every solve opens its harness, and a tool tree runs to thousands
 * of files and gigabytes, so hashing it afresh each time was a full read of it per solve.
 */
function keptTreeContent(toolTree: string) {
  const real = realpathSync(toolTree);
  const stamp = treeStamp(real);
  const kept = TREES.get(real);
  if (kept?.stamp === stamp) return kept.content;
  const content = treeContent(real).filter(({ path }) => !BYTECODE.test(path));
  TREES.set(real, { stamp, content });
  return content;
}
