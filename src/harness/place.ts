import { existsSync, lstatSync, readFileSync, readHeadSync, readlinkSync } from "#src/meta/filesystem.ts";
import { TOOL_TREE_DIR, TOOL_TREE_ENV } from "#src/meta/bundle-layout.ts";
import { dirname, isAbsolute, join, normalize } from "#src/meta/path.ts";
import { decodeOutput, runSync } from "#src/meta/subprocess.ts";
import { textOr } from "#src/meta/text.ts";
import { pathsUnder } from "./open.ts";

const MACOS_HOST_ROOT =
  /(?:^|[\s"'=:(]|-[IL])(\/(?:Users|opt\/homebrew|usr\/local\/Cellar|Library|Applications|Volumes|System|var\/folders|private\/(?:var|tmp))\/)/u;
const PORTABILITY_GUARD = /\b(?:uname|OSTYPE|Darwin)\b|\[\s*-[defx]\s+/u;

export const UNAME_PLACES = new Map([
  ["Linux x86_64", "linux-x64"],
  ["Linux aarch64", "linux-arm64"],
  ["Darwin arm64", "darwin-arm64"],
  ["Darwin x86_64", "darwin-x64"],
]);

const X86_64 = 62;
export const AARCH64 = 183;

export type Place = Readonly<{
  name: string;
  mac: boolean;
  machine: number;
  roots: readonly string[] | null;
  python?: string;
}>;

const CONTAINER: Place = {
  name: "a Linux x86-64 container",
  mac: false,
  machine: X86_64,
  roots: ["/usr/", "/bin/"],
};

export function placeOf(named: string, name = named): Place {
  const [platform = "", arch = ""] = named.split("-");
  if (!["darwin", "linux"].includes(platform) || !["arm64", "x64"].includes(arch)) {
    throw new Error(`'${named}' names no machine: darwin or linux, then arm64 or x64, as linux-x64`);
  }
  return { name, mac: platform === "darwin", machine: arch === "arm64" ? AARCH64 : X86_64, roots: null };
}

export async function foreignPrograms(tree: string, place: Place = CONTAINER): Promise<void> {
  const foreign = (await foreignFiles(tree, place)).map(({ path, why }) => `${path} (${why})`);
  if (foreign.length > 0) {
    const shown = foreign.slice(0, 5).join(", ");
    throw new Error(
      `the harness's ${TOOL_TREE_DIR} holds ${String(foreign.length)} programs ${place.name} cannot run: ${shown}${foreign.length > 5 ? ", and more" : ""}`,
    );
  }
}

export function foreignFiles(tree: string, place: Place): Promise<{ path: string; why: string }[]> {
  if (!existsSync(tree)) return Promise.resolve([]);
  const foreign: { path: string; why: string }[] = [];
  for (const path of pathsUnder(tree)) {
    const full = join(tree, path);
    const stat = lstatSync(full);
    if (stat.isSymbolicLink()) {
      const target = readlinkSync(full);
      const to = normalize(join(dirname(path), target));
      if (isAbsolute(target) || to === ".." || to.startsWith("../")) {
        foreign.push({ path, why: `a link to ${target}, outside the tree` });
      } else if (path === TOOL_TREE_ENV) {
        foreign.push({ path, why: `${TOOL_TREE_ENV} must be a regular file` });
      }
    } else if (stat.isFile()) {
      const why =
        path === TOOL_TREE_ENV ? foreignEnv(full, place) : foreignHead(readHeadSync(full, 128), place);
      if (why !== null) foreign.push({ path, why });
    }
  }
  return Promise.resolve(foreign);
}

function stripShellComment(line: string): string {
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote === null && ch === "\\") i += 1;
    else if (quote === null && (ch === "'" || ch === '"')) quote = ch;
    else if (ch === quote) quote = null;
    else if (quote === null && ch === "#" && (i === 0 || /\s/u.test(line[i - 1] ?? ""))) {
      return line.slice(0, i);
    }
  }
  return line;
}

export function bashSyntaxFault(file: string): string | null {
  const parsed = runSync(["/bin/bash", "-n", file], { timeout: 5000 });
  if (parsed.exitCode === null || parsed.signal !== null) return "could not check bash syntax";
  if (parsed.exitCode === 0) return null;
  const detail = textOr(decodeOutput(parsed.stderr).trim().split("\n").at(0), "syntax error");
  return `a bash syntax error: ${detail}`;
}

function foreignEnv(full: string, place: Place): string | null {
  const syntax = bashSyntaxFault(full);
  if (syntax !== null || place.mac) return syntax;
  const active = readFileSync(full, "utf8").split("\n").map(stripShellComment).join("\n");
  return !PORTABILITY_GUARD.test(active) && MACOS_HOST_ROOT.test(active)
    ? "references a macOS host path"
    : null;
}

export function foreignHead(head: Buffer, place: Place = CONTAINER): string | null {
  const magic = head.length >= 4 ? head.readUInt32BE(0) : 0;
  if ([0xfe_ed_fa_ce, 0xfe_ed_fa_cf, 0xce_fa_ed_fe, 0xcf_fa_ed_fe, 0xca_fe_ba_be].includes(magic)) {
    return place.mac ? null : "a Mach-O binary";
  }
  if (magic === 0x7f_45_4c_46 && head.length >= 20) {
    const machine = head.readUInt16LE(18);
    return place.mac || machine !== place.machine ? `an ELF binary for machine ${String(machine)}` : null;
  }
  const text = head.toString("latin1");
  if (place.roots === null || !text.startsWith("#!")) return null;
  const interpreter = text.slice(2).trimStart().split(/\s/u, 1)[0] ?? "";
  return place.roots.some((root) => interpreter.startsWith(root))
    ? null
    : `its interpreter ${interpreter} is a host path`;
}
