import { existsSync, lstatSync, readHeadSync, readlinkSync } from "#src/meta/filesystem.ts";
import { TOOL_TREE_DIR } from "#src/meta/bundle-layout.ts";
import { dirname, isAbsolute, join, normalize } from "#src/meta/path.ts";
import { pathsUnder } from "./open.ts";

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
      }
    } else if (stat.isFile()) {
      const why = foreignHead(readHeadSync(full, 128), place);
      if (why !== null) foreign.push({ path, why });
    }
  }
  return Promise.resolve(foreign);
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
