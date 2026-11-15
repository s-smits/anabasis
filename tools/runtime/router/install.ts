/**
 * Puts the bun router on this machine.
 *
 *   bun tools/runtime/router/install.ts
 *
 * The router is `bun` in this folder, installed as `~/.local/bin/bun`, with `run.js` (this folder's
 * `run.ts`, bundled) and `task.sh` in `~/.local/share/ana-runner/`: it runs the Bun a tree pins and
 * runs the tree's check tasks here or on a host `ANA_HOSTS` lists (`run.ts` says how). One installed
 * runner serves every tree, whatever its commit. The folder is renamed over the old one, since a
 * running task still reads its own, and nothing changes when every installed byte already matches. The first install
 * over something it did not write moves that aside as `<path>.before-router-<time>`. `INSTALLED` keeps
 * the commit it came from, which `bun run runs sync` reads. It edits no shell startup file, since
 * where PATH is set is the operator's, and says so where a login shell's `bun` is not the router.
 */
import { runtimeProcess } from "#src/meta/process.ts";
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "#src/meta/filesystem.ts";
import { dirname, join } from "#src/meta/path.ts";
import { capturedJsonStringify } from "#src/meta/json-runtime.ts";
import { gitMaybe } from "#src/meta/git.ts";
import { decodeOutput, runSync } from "#src/meta/subprocess.ts";

const RECEIPT = "INSTALLED";
const TREE = join(import.meta.dir, "..", "..", "..");

const say = (line: string): void => console.log(`router: ${line}`);

const present = (path: string): boolean => lstatSync(path, { throwIfNoEntry: false }) !== undefined;

function textAt(path: string): string | null {
  return present(path) ? readFileSync(path, "utf8") : null;
}

/** Every file of the runner's folder, by name, as this tree makes it. */
async function payload(): Promise<Map<string, string>> {
  const built = await Bun.build({ entrypoints: [join(import.meta.dir, "run.ts")], target: "bun" });
  const [bundle] = built.outputs;
  if (!built.success || bundle === undefined) {
    throw new Error(`run.ts did not bundle: ${built.logs.map(String).join("\n")}`);
  }
  return new Map([
    ["task.sh", readFileSync(join(import.meta.dir, "task.sh"), "utf8")],
    ["run.js", await bundle.text()],
  ]);
}

/** Says so where a login shell does not find the router as `bun`. */
function warnOfPath(shim: string): void {
  const shell = runtimeProcess.env.SHELL ?? "/bin/sh";
  const found = decodeOutput(runSync([shell, "-lic", "command -v bun"], { timeout: 30_000 }).stdout)
    .trim()
    .split("\n")
    .at(-1);
  if (found !== shim) {
    say(
      `a login shell's bun is ${found ?? "missing"}, not the router: put this last in ${shell}'s startup file`,
    );
    say(`  export PATH="$HOME/.local/bin:$PATH"`);
  }
}

async function main(): Promise<void> {
  // The `$HOME` the router itself reads.
  const home = runtimeProcess.env.HOME ?? "";
  if (home === "") throw new Error("HOME is not set, so there is no ~/.local to install into");
  const shim = join(home, ".local", "bin", "bun");
  const dir = join(home, ".local", "share", "ana-runner");
  const files = await payload();
  const router = readFileSync(join(import.meta.dir, "bun"), "utf8");
  const ours = present(join(dir, RECEIPT));
  const commit = gitMaybe(TREE, "rev-parse", "HEAD") ?? "an unknown commit";
  const dirty =
    (gitMaybe(TREE, "status", "--porcelain", "--untracked-files=no") ?? "") === "" ? "" : ", dirty";
  if (
    ours &&
    textAt(shim) === router &&
    [...files].every(([name, text]) => textAt(join(dir, name)) === text)
  ) {
    say(`${shim} and ${dir} already match ${commit}${dirty}; nothing changed`);
  } else {
    const stamp = new Date().toISOString().replaceAll(/[-:]/gu, "").replace(/\..*$/u, "");
    for (const from of ours ? [] : [shim, dir].filter(present)) {
      const to = `${from}.before-router-${stamp}`;
      renameSync(from, to);
      say(`moved ${from} aside to ${to}`);
    }
    const staging = `${dir}.new-${String(runtimeProcess.pid)}`;
    mkdirSync(staging, { recursive: true });
    for (const [name, text] of files) writeFileSync(join(staging, name), text);
    const receipt = { commit: `${commit}${dirty}`, tree: TREE, installed: stamp };
    writeFileSync(join(staging, RECEIPT), `${capturedJsonStringify(receipt, null, 2)}\n`);
    if (present(dir)) {
      const old = `${dir}.old-${String(runtimeProcess.pid)}`;
      renameSync(dir, old);
      renameSync(staging, dir);
      rmSync(old, { recursive: true, force: true });
    } else {
      renameSync(staging, dir);
    }
    mkdirSync(dirname(shim), { recursive: true });
    const next = `${shim}.new-${String(runtimeProcess.pid)}`;
    writeFileSync(next, router, { mode: 0o755 });
    renameSync(next, shim);
    say(`wrote ${shim} and ${dir}, from ${commit}${dirty}`);
  }
  warnOfPath(shim);
}

await main();
