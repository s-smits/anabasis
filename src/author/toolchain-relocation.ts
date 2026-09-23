/** Relocate known Python launchers; refuse executable dependencies the copy cannot relocate. */
import {
  closeSync,
  existsSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  writeFileSync,
} from "../meta/filesystem.ts";
import { basename, dirname, join, relative } from "../meta/path.ts";
import { hostTool } from "../meta/host-tool.ts";
import { containsPath } from "../meta/path-containment.ts";
import { runtimeProcess } from "../meta/process.ts";

/** What the copy did to one file: a Python launcher header rewritten (uv's single-quoted form
 *  reported separately, since run 8729bb aborted on it), a Mach-O install name moved (run e6e332
 *  aborted on one), nothing, or `retains-adopted-path` -- the copy still names the tree it came
 *  from and nothing here can move that name. The caller drops such a file; this function only
 *  reports it. */
type LauncherRelocation =
  | "rewritten"
  | "rewritten-single-quoted"
  | "install-name"
  | "retains-adopted-path"
  | null;

/** Whether a file still names `root`. Read in overlapping chunks rather than whole, so binaries
 *  can be scanned too without holding an installed executable in memory. */
function retainsRoot(path: string, root: string): boolean {
  const needle = Buffer.from(`${root}/`);
  const overlap = needle.length - 1;
  const bytes = Buffer.alloc(64 * 1024 + overlap);
  const handle = openSync(path, "r");
  let kept = 0;
  try {
    for (;;) {
      const read = readSync(handle, bytes, kept, 64 * 1024, null);
      if (read === 0) return false;
      const length = kept + read;
      if (bytes.subarray(0, length).includes(needle)) return true;
      kept = Math.min(overlap, length);
      bytes.copyWithin(0, length - kept, length);
    }
  } finally {
    closeSync(handle);
  }
}

/** A Mach-O library records its own absolute path as its install name. Nothing here loads the copy
 *  through it -- cpython's interpreter reaches its library by `@executable_path`, which the copy
 *  keeps -- so the identity is moved rather than the whole tree refused over an address nothing
 *  reads. `install_name_tool` ships with the Command Line Tools and re-signs ad hoc, and `hostTool`
 *  skips its xcrun shim. On another platform, for a file that is not Mach-O, or with the tool
 *  absent, the bytes stay as they were and the caller still refuses. The platform guard is separate
 *  because inlining it reads `relocateToolLauncher` at 22 against the ceiling of 21 in
 *  `tools/loc/complexity-policy.ts`. */
function relocateInstallName(file: string, target: string): void {
  if (runtimeProcess.platform !== "darwin") return;
  Bun.spawnSync({
    cmd: [hostTool("install_name_tool"), "-id", target, file],
    stdout: "ignore",
    stderr: "ignore",
  });
}

export function relocateToolLauncher(
  file: string,
  source: string,
  destination: string,
  name: string,
): LauncherRelocation {
  const stat = lstatSync(file);
  const activation =
    existsSync(join(dirname(dirname(file)), "pyvenv.cfg")) &&
    ["activate", "activate.csh", "activate.fish", "Activate.ps1"].includes(basename(file));
  if (!stat.isFile() || ((stat.mode & 0o111) === 0 && !activation)) return null;
  let relocated: LauncherRelocation = null;
  // Only known text launchers are rewritten. Arbitrary binaries and package data stay byte-identical.
  if (stat.size <= 1_048_576) {
    const text = readFileSync(file, "utf8");
    const direct = /^#!(\/[^\n]+\/python[\d.]*)\r?\n/.exec(text);
    // uv quotes the interpreter with single quotes; pip and the rewrite below use double or none.
    const wrapped = /^#!\/bin\/sh\n'''exec' ("[^"\n]+"|'[^'\n]+'|[^\s]+) "\$0" "\$@"\n' '''\n/.exec(text);
    const launcher = direct ?? wrapped;
    // Only the wrapped form quotes the interpreter; the replace leaves a bare path as it is.
    const interpreter = launcher?.[1]?.replace(/^(["'])(.*)\1$/, "$2");
    if (launcher !== null && interpreter !== undefined && /^python[\d.]*$/.test(basename(interpreter))) {
      // Resolve the directory, not the interpreter: a venv's python is usually a link to the host.
      const absolute = join(realpathSync(dirname(interpreter)), basename(interpreter));
      if (containsPath(absolute, source)) {
        const target = join(destination, relative(source, absolute));
        // The header below quotes the target inside an `sh` string, so a destination carrying a
        // quote, a backslash, a backtick, `$` or a newline cannot be written into one safely. That
        // destination derives from the project slug and the campaign root, so it is the same for
        // every launcher in the tree: throwing here ended the whole rebuild, with advice to
        // recreate the environment in a repair workspace the throw had just prevented. Reporting
        // instead says what is true -- the launcher still names the adopted tree -- and the caller
        // drops it.
        if (/['"`$\n\\]/.test(target)) return "retains-adopted-path";
        const header = `#!/bin/sh\n'''exec' "${target}" "$0" "$@"\n' '''\n`;
        writeFileSync(file, header + text.slice(launcher[0].length));
        relocated = wrapped?.[1]?.startsWith("'") === true ? "rewritten-single-quoted" : "rewritten";
      }
    } else if (activation) {
      // venv owns these templates and the VIRTUAL_ENV path; no replacement in arbitrary scripts.
      const venv = dirname(dirname(join(destination, name)));
      const original = join(source, relative(destination, venv));
      writeFileSync(file, text.replaceAll(original, venv));
    }
  }
  if (retainsRoot(file, source)) {
    relocateInstallName(file, join(destination, name));
    if (retainsRoot(file, source)) return "retains-adopted-path";
    relocated = "install-name";
  }
  return relocated;
}
