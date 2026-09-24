/** The Builder toolkit's staged writes. The host stages bytes in scratch; the candidate
 *  access policy still governs both directory creation and copying. */
import { mkdtempSync, rmSync, writeFileSync } from "../meta/filesystem.ts";
import { tmpdir } from "../meta/os.ts";
import { basename, dirname, join, relative } from "../meta/path.ts";
import { runIsolated } from "./candidate-isolation-runtime.ts";
import { formatSize, type truncateTail } from "./pi-coding/truncate.ts";
import type { BuilderIsolation } from "./tools.ts";

export async function stageAndCopy(
  isolation: BuilderIsolation,
  capability: string,
  target: string,
  content: string,
): Promise<void> {
  const scratch = mkdtempSync(join(tmpdir(), "ana-isolation-write-"));
  const staged = join(scratch, basename(target));
  try {
    writeFileSync(staged, content);
    const parent = dirname(target);
    // mkdir -p must take a relative path from inside the allowed tree: on an absolute path it
    // calls mkdir(2) on every ancestor, and the sandbox answers EPERM before the filesystem can
    // say EEXIST, so it dies at "/private". Every component under workDir is profile-allowed,
    // because subpath rules match their own root, and a parent outside workDir never reaches this
    // spawn at all — the guard denies the write first.
    const mkdir = await runIsolated(isolation.policy, isolation.record, {
      capability,
      mode: "write",
      command: "/bin/mkdir",
      args: ["-p", relative(isolation.workDir, parent) || "."],
      cwd: isolation.workDir,
      paths: [parent],
    });
    if (mkdir.status !== 0) throw new Error(mkdir.stderr.trim() || `mkdir exited ${mkdir.status}`);
    // Named as a controller read: the Linux cell lays a fresh tmpfs over the host scratch root.
    const copy = await runIsolated(isolation.policy, isolation.record, {
      capability,
      mode: "write",
      command: "/bin/cp",
      args: [staged, target],
      cwd: isolation.workDir,
      paths: [target],
      controllerReadFiles: [staged],
    });
    if (copy.status !== 0) throw new Error(copy.stderr.trim() || `write exited ${copy.status}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Where a truncated command's whole output is kept. Dot-prefixed so ripgrep and the listing tools
 *  pass over it, and never fingerprinted, so it cannot reach a candidate: `createBundleSnapshot`
 *  copies exactly the fingerprinted file lists, and a stray unhashed file in the slug tree never
 *  enters the snapshot. */
const WHOLE_OUTPUT_DIR = ".bash-output";
let wholeOutputSeq = 0;

/** Keep the bytes a truncated result dropped, where the read tool can page them. A draft is
 *  windowed in place because it can be read again; a command's output cannot, so recovering it
 *  needs the bytes stored somewhere first. Nothing prunes these: they are written only where output
 *  was truncated, and the workspace they sit in is disposable. A store that fails returns null: it
 *  costs the pointer, never the command's result. */
export async function spillWholeOutput(isolation: BuilderIsolation, content: string): Promise<string | null> {
  wholeOutputSeq += 1;
  const name = `bash-${Date.now().toString(36)}-${wholeOutputSeq.toString(36)}.txt`;
  try {
    await stageAndCopy(isolation, "bash", join(isolation.workDir, WHOLE_OUTPUT_DIR, name), content);
  } catch {
    return null;
  }
  return join(WHOLE_OUTPUT_DIR, name);
}

/**
 * The line a cut command result ends with, shared by every tool that shows a tail of unstructured
 * output: which lines the result holds, why it stopped there, and where the whole output was
 * stored with how to page it. It is prime-agent's shell notice with the pager added, because the
 * tool that pages the stored file differs by wall. A spill that could not be written passes
 * `stored` as null, and the line then states the cut without advertising a file that is not there.
 * `caveat` carries anything the tool knows about the stored file itself.
 */
export function cutOutputNotice(
  whole: string,
  tail: ReturnType<typeof truncateTail>,
  stored: string | null,
  pager: string,
  caveat = "",
): string {
  if (!tail.truncated) return "";
  const end = tail.totalLines;
  const location = stored === null ? "" : ` Full output: ${stored} — ${pager}.`;
  if (tail.lastLinePartial) {
    const body = whole.endsWith("\n") ? whole.slice(0, -1) : whole;
    const line = new TextEncoder().encode(body.slice(body.lastIndexOf("\n") + 1)).byteLength;
    return `[Showing last ${formatSize(tail.outputBytes)} of line ${end} (line is ${formatSize(line)}).${location}${caveat}]`;
  }
  const limit = tail.truncatedBy === "bytes" ? ` (${formatSize(tail.maxBytes)} limit)` : "";
  return `[Showing lines ${end - tail.outputLines + 1}-${end} of ${end}${limit}.${location}${caveat}]`;
}
