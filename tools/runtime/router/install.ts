/**
 * Installs the local Bun router (`~/.local/bin/bun`) and the check-runner bundle
 * (`~/.local/share/ana-runner/`). The router runs the Bun the active worktree pins and routes
 * checks locally or across `ANA_HOSTS` (`run.ts`); one install serves every worktree. It installs
 * by directory rename so running tasks are undisturbed, refreshes only the `INSTALLED` receipt when
 * the bytes already match, backs up unmanaged files as `<path>.before-router-<time>`, and warns
 * where a login shell resolves `bun` elsewhere.
 *
 *   bun tools/runtime/router/install.ts
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
/** What the installed runner is made of: this folder, and what `run.ts` bundles from beyond it. */
export const RUNNER_SOURCE = [
  "tools/runtime/router",
  "tools/runs/host-config.ts",
  "tools/runs/host-command.ts",
  "tools/runs/load.ts",
  "src/meta",
];

const say = (line: string): void => console.log(`router: ${line}`);

const present = (path: string): boolean => lstatSync(path, { throwIfNoEntry: false }) !== undefined;

function textAt(path: string): string | null {
  return present(path) ? readFileSync(path, "utf8") : null;
}

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
  const changed = gitMaybe(TREE, "status", "--porcelain", "--untracked-files=no", "--", ...RUNNER_SOURCE);
  const dirty = (changed ?? "") === "" ? "" : ", dirty";
  const stamp = new Date().toISOString().replaceAll(/[-:]/gu, "").replace(/\..*$/u, "");
  const receipt = `${capturedJsonStringify({ commit: `${commit}${dirty}`, tree: TREE, installed: stamp }, null, 2)}\n`;
  if (
    ours &&
    textAt(shim) === router &&
    [...files].every(([name, text]) => textAt(join(dir, name)) === text)
  ) {
    // The bytes match, so the receipt names this commit: else `runs sync` reads a lag no install
    // clears.
    const next = join(dir, `${RECEIPT}.new-${String(runtimeProcess.pid)}`);
    writeFileSync(next, receipt);
    renameSync(next, join(dir, RECEIPT));
    say(`${shim} and ${dir} already match ${commit}${dirty}; the receipt names it`);
  } else {
    for (const from of ours ? [] : [shim, dir].filter(present)) {
      const to = `${from}.before-router-${stamp}`;
      renameSync(from, to);
      say(`moved ${from} aside to ${to}`);
    }
    const staging = `${dir}.new-${String(runtimeProcess.pid)}`;
    mkdirSync(staging, { recursive: true });
    for (const [name, text] of files) writeFileSync(join(staging, name), text);
    writeFileSync(join(staging, RECEIPT), receipt);
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

if (import.meta.main) await main();
