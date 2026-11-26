import { AGENT_DIR, BYTECODE, GUIDE_FILE, TOOLS_SPEC_FILE, TOOL_TREE_DIR } from "../meta/bundle-layout.ts";
import { sha256, sha256OfFile } from "../meta/digest.ts";
import { existsSync, lstatSync, readlinkSync, realpathSync } from "../meta/filesystem.ts";
import { capturedJsonParse, capturedJsonStringify } from "../meta/json-runtime.ts";
import { asRecord, isRecord, isString } from "../meta/json-shape.ts";
import { join, resolve } from "../meta/path.ts";
import { containsPath } from "../meta/path-containment.ts";
import { hashJsonValue } from "../meta/stable-json.ts";
import { plural } from "../meta/text.ts";

export interface Harness {
  readonly guide: string | null;
  readonly presets: readonly string[];
  readonly toolTree: string | null;
  readonly digest: string;
}

const NO_TOOLS_MODULE =
  "// @bun\n\nvar createDomainHarness = () => ({\n  tools: []\n});\nexport {\n  createDomainHarness\n};\n";
const FILE_HASH_CAP = 50_000;
const RACY_MS = 2000;
const FILE_HASHES = new Map<string, string>();
const TREES = new Map<string, { stamp: string; content: ReturnType<typeof treeContent> }>();

export async function openHarness(dir: string): Promise<Harness> {
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

export function pathsUnder(dir: string): string[] {
  const glob = new Bun.Glob("**");
  return [...glob.scanSync({ cwd: dir, dot: true, onlyFiles: false, followSymlinks: false })].toSorted();
}

const isRacy = (stat: NonNullable<ReturnType<typeof lstatSync>>, now = Date.now()): boolean =>
  Math.abs(now - Number(stat.ctimeMs)) < RACY_MS;

function fileHash(full: string, stat: NonNullable<ReturnType<typeof lstatSync>>): string {
  if (isRacy(stat)) return sha256OfFile(full);
  const key = `${String(stat.dev)}:${String(stat.ino)}:${String(stat.size)}:${String(stat.mtimeMs)}:${String(stat.ctimeMs)}`;
  const cached = FILE_HASHES.get(key);
  if (cached !== undefined) return cached;
  const digest = sha256OfFile(full);
  if (FILE_HASHES.size >= FILE_HASH_CAP) FILE_HASHES.clear();
  FILE_HASHES.set(key, digest);
  return digest;
}

function statEntries(dir: string) {
  return pathsUnder(dir).map((path) => {
    const full = join(dir, path);
    return { path, full, stat: lstatSync(full) };
  });
}

function stampOf(entries: ReturnType<typeof statEntries>): string {
  return sha256(
    entries
      .map(
        ({ path, stat }) =>
          `${path}\0${String(stat.size)}\0${String(stat.mtimeMs)}\0${String(stat.ctimeMs)}\0${String(stat.mode)}\0${String(stat.ino)}`,
      )
      .join("\0\0"),
  );
}

function entryContent({ path, full, stat }: ReturnType<typeof statEntries>[number]) {
  return {
    path,
    mode: stat.mode,
    content: stat.isSymbolicLink() ? readlinkSync(full) : stat.isFile() ? fileHash(full, stat) : null,
  };
}

export function treeContent(dir: string) {
  return statEntries(dir).map(entryContent);
}

export function treeStamp(real: string): string {
  return stampOf(statEntries(real));
}

function keptTreeContent(toolTree: string) {
  const real = realpathSync(toolTree);
  const entries = statEntries(real);
  const stamp = stampOf(entries);
  const now = Date.now();
  const racy = entries.some(({ stat }) => isRacy(stat, now));
  const kept = racy ? undefined : TREES.get(real);
  if (kept?.stamp === stamp) return kept.content;
  const content = entries.filter(({ path }) => !BYTECODE.test(path)).map(entryContent);
  if (!racy) TREES.set(real, { stamp, content });
  return content;
}
