/**
 * Puts the bun router on this machine, or takes it away again.
 *
 *   bun tools/runtime/router/install.ts [--uninstall]
 *
 * The router is `bun` in this folder, installed as `~/.local/bin/bun`, with `lib.sh`, `run.sh`,
 * `host.sh` and `hosts.js` (this folder's `hosts.ts`, bundled) in `~/.local/share/ana-runner/`: it
 * runs the Bun a tree pins and sends the tree's check tasks to a host `ANA_HOSTS` lists (`run.sh`
 * says how). Until 25 October it lived only on stijn-pro, as a Git repository of its own with three
 * days of uncommitted changes, while the Air ran its global Bun 1.4.2 against trees that pin 1.4.4
 * and the Linux host had no `bun` on a login shell's PATH at all. Its scripts are copied here from
 * that repository's working tree as it stood (`51a491a` and the changes on top of it), with the
 * changes `run.sh` and `bun` name in their comments.
 *
 * An install writes each file to a new name and renames it over the old, since a running `run.sh`
 * still reads its folder, and changes nothing when every installed byte already matches. The first
 * install over something it did not write moves that aside as `<path>.before-router-<time>` and
 * keeps the list in `INSTALLED`, beside the commit it came from; later installs carry the list on,
 * and `--uninstall` removes what it installed and moves those back. Every step is printed. It then
 * says whether a login shell's `bun` is the router, and which version `bun --version` gives in this
 * tree; it edits no shell startup file, since where PATH is set is the operator's.
 */
import { parseArgs, runtimeProcess } from "#src/meta/process.ts";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "#src/meta/filesystem.ts";
import { dirname, join } from "#src/meta/path.ts";
import { capturedJsonParse, capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { asRecord, isString } from "#src/meta/json-shape.ts";
import { gitMaybe } from "#src/meta/git.ts";
import { decodeOutput, runSync } from "#src/meta/subprocess.ts";

interface Backup {
  readonly from: string;
  readonly to: string;
}

interface Places {
  readonly shim: string;
  readonly dir: string;
}

/** The scripts copied as they are; `run.sh` is the one run by its path. */
const SCRIPTS = ["lib.sh", "run.sh", "host.sh"] as const;
const RECEIPT = "INSTALLED";
const TREE = join(import.meta.dir, "..", "..", "..");

const say = (line: string): void => console.log(`router: ${line}`);

const present = (path: string): boolean => lstatSync(path, { throwIfNoEntry: false }) !== undefined;

function textAt(path: string): string | null {
  return present(path) ? readFileSync(path, "utf8") : null;
}

/** What an earlier install recorded it moved aside, or null where the folder is not one it wrote. */
function backupsOf(dir: string): Backup[] | null {
  const text = textAt(join(dir, RECEIPT));
  if (text === null) return null;
  const receipt = asRecord(capturedJsonParse(text));
  const listed = receipt?.backups;
  if (!Array.isArray(listed)) throw new Error(`${join(dir, RECEIPT)} lists no backups`);
  return listed.flatMap((entry) => {
    const backup = asRecord(entry);
    return backup !== null && isString(backup.from) && isString(backup.to)
      ? [{ from: backup.from, to: backup.to }]
      : [];
  });
}

/** Every file of the runner's folder, by name, as this tree makes it. */
async function payload(): Promise<Map<string, string>> {
  const files = new Map<string, string>(
    SCRIPTS.map((name) => [name, readFileSync(join(import.meta.dir, name), "utf8")]),
  );
  const built = await Bun.build({ entrypoints: [join(import.meta.dir, "hosts.ts")], target: "bun" });
  const [bundle] = built.outputs;
  if (!built.success || bundle === undefined) {
    throw new Error(`hosts.ts did not bundle: ${built.logs.map(String).join("\n")}`);
  }
  files.set("hosts.js", await bundle.text());
  return files;
}

/** Whether a login shell finds the router as `bun`, and what the router runs in this tree. */
function report(shim: string): void {
  const shell = runtimeProcess.env.SHELL ?? "/bin/sh";
  const found = decodeOutput(runSync([shell, "-lic", "command -v bun"], { timeout: 30_000 }).stdout)
    .trim()
    .split("\n")
    .at(-1);
  if (found === shim) {
    say(`a login shell's bun is ${shim}`);
  } else {
    say(
      `a login shell's bun is ${found ?? "missing"}, not the router: put this last in ${shell}'s startup file`,
    );
    say(`  export PATH="$HOME/.local/bin:$PATH"`);
  }
  const version = runSync([shim, "--version"], { cwd: TREE, timeout: 30_000 });
  say(
    `bun --version in ${TREE} gives ${decodeOutput(version.stdout).trim()} (exit ${String(version.exitCode)})`,
  );
}

async function install(places: Places): Promise<void> {
  const { shim, dir } = places;
  const files = await payload();
  const router = readFileSync(join(import.meta.dir, "bun"), "utf8");
  const earlier = backupsOf(dir);
  const commit = gitMaybe(TREE, "rev-parse", "HEAD") ?? "an unknown commit";
  const dirty =
    (gitMaybe(TREE, "status", "--porcelain", "--untracked-files=no") ?? "") === "" ? "" : ", dirty";
  if (
    earlier !== null &&
    textAt(shim) === router &&
    [...files].every(([name, text]) => textAt(join(dir, name)) === text)
  ) {
    say(`${shim} and ${dir} already match ${commit}${dirty}; nothing changed`);
    report(shim);
    return;
  }
  const stamp = new Date().toISOString().replaceAll(/[-:]/gu, "").replace(/\..*$/u, "");
  const backups = earlier ?? [];
  if (earlier === null) {
    for (const from of [shim, dir].filter(present)) {
      const to = `${from}.before-router-${stamp}`;
      renameSync(from, to);
      backups.push({ from, to });
      say(`moved ${from} aside to ${to}`);
    }
  }
  const staging = `${dir}.new-${String(runtimeProcess.pid)}`;
  mkdirSync(staging, { recursive: true });
  // Each file is new, so its mode is the one it is created with; `run.sh` is run by its path.
  for (const [name, text] of files) {
    writeFileSync(join(staging, name), text, { mode: name === "run.sh" ? 0o755 : 0o644 });
  }
  const receipt = { commit: `${commit}${dirty}`, tree: TREE, installed: stamp, backups };
  writeFileSync(join(staging, RECEIPT), `${capturedJsonStringify(receipt, null, 2)}\n`);
  if (present(dir)) {
    const old = `${dir}.old-${String(runtimeProcess.pid)}`;
    renameSync(dir, old);
    renameSync(staging, dir);
    rmSync(old, { recursive: true, force: true });
  } else {
    renameSync(staging, dir);
  }
  say(`wrote ${[...files.keys(), RECEIPT].join(", ")} to ${dir}`);
  mkdirSync(dirname(shim), { recursive: true });
  const next = `${shim}.new-${String(runtimeProcess.pid)}`;
  writeFileSync(next, router, { mode: 0o755 });
  renameSync(next, shim);
  say(`wrote ${shim}, from ${commit}${dirty}`);
  report(shim);
}

function uninstall(places: Places): void {
  const { shim, dir } = places;
  const backups = backupsOf(dir);
  if (backups === null) {
    say(`${dir} holds no router this command installed; nothing changed`);
    runtimeProcess.exitCode = 1;
    return;
  }
  rmSync(shim, { force: true });
  rmSync(dir, { recursive: true, force: true });
  say(`removed ${shim} and ${dir}`);
  for (const { from, to } of backups) {
    if (present(to) && !present(from)) {
      renameSync(to, from);
      say(`moved ${to} back to ${from}`);
    } else {
      say(`left ${to} where it is: ${present(to) ? `${from} exists again` : "it is gone"}`);
    }
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: runtimeProcess.argv.slice(2),
    options: { uninstall: { type: "boolean", default: false } },
  });
  // The `$HOME` the router itself reads.
  const home = runtimeProcess.env.HOME ?? "";
  if (home === "") throw new Error("HOME is not set, so there is no ~/.local to install into");
  const places = {
    shim: join(home, ".local", "bin", "bun"),
    dir: join(home, ".local", "share", "ana-runner"),
  };
  if (values.uninstall) uninstall(places);
  else await install(places);
}

await main();
